/**
 * 기출 분석 — 단일 문항 수동 수정 API
 *
 * PATCH /api/exam-analysis/[id]/questions/[questionNumber]
 * Body: { topic?, confidence?, difficulty?, points?, question_type?, ability_domain? }
 *
 * 통합 메타데이터 보정 — 교정 가능한 모든 필드를 ground truth 로 수집.
 * 각 필드 최초 교정 시 AI 원본을 ai_<field> 에 보존 (보정 플라이휠 학습셋):
 *   수치형: difficulty→ai_difficulty, points→ai_points
 *   범주형: topic→ai_topic, question_type→ai_question_type, ability_domain→ai_ability_domain
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import {
  requireTeacher,
  isResponse,
  badRequest,
  notFound,
} from '@/lib/api';
import { getExamScope } from '@/lib/demo/accounts';
import { tallyQuestions } from '@/lib/exam-analysis/shared/summary-tally';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';

type Params = { params: Promise<{ id: string; questionNumber: string }> };

const patchSchema = z.object({
  topic: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).optional(),
  difficulty: z.enum(['1', '2', '3', '4', '5']).optional(),
  points: z.number().min(0).max(100).optional(),
  // 교육과정 영역 — 표준은 2022 개정 4영역(TYPE_TO_STANDARD 가 정규화하는 canonical 셋).
  // UI 드롭다운(TYPE_OPTIONS)은 이 4개만 제공한다. 뒤의 레거시 5분류는 과거 분석본에 저장돼 있어
  // 하위호환으로 열어둔다(읽을 때 TYPE_TO_STANDARD 로 4영역에 매핑됨).
  // ⚠️ 여기 enum이 드롭다운 옵션보다 좁으면 교정이 400으로 조용히 실패한다 — 반드시 동기화할 것.
  question_type: z.string().max(40).optional(),
  ability_domain: z.string().max(40).optional(),
});

const MATH_TYPES = new Set([
  'number', 'change_relation', 'shape_measure', 'data_possibility',
  'algebra', 'function', 'geometry', 'statistics',
]);
const ENGLISH_TYPES = new Set([
  'grammar', 'vocabulary', 'reading', 'listening', 'writing', 'communication',
]);
const MATH_ABILITIES = new Set(['calculation', 'understanding', 'problem_solving', 'reasoning']);
const ENGLISH_ABILITIES = new Set(['accuracy', 'understanding', 'reasoning', 'expression']);

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;

  const { id, questionNumber } = await params;
  if (!id || !questionNumber) return badRequest('파라미터가 올바르지 않습니다');

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest('입력값이 올바르지 않습니다');

    const tenantWhere = await getExamScope(user);
    const examPaper = await prisma.examPaper.findFirst({
      where: { id, ...tenantWhere },
      select: { id: true, tenantId: true, grade: true, subject: true },
    });
    if (!examPaper) return notFound('시험지를 찾을 수 없습니다');

    const isEnglish = examPaper.subject === 'ENGLISH';
    if (parsed.data.question_type) {
      const allowed = isEnglish ? ENGLISH_TYPES : MATH_TYPES;
      if (!allowed.has(parsed.data.question_type)) {
        return badRequest('입력값이 올바르지 않습니다');
      }
    }
    if (parsed.data.ability_domain) {
      const allowed = isEnglish ? ENGLISH_ABILITIES : MATH_ABILITIES;
      if (!allowed.has(parsed.data.ability_domain)) {
        return badRequest('입력값이 올바르지 않습니다');
      }
    }

    // 최신 분석 가져오기 (여러 분석 있을 수 있음 — 가장 최근 것만 수정)
    const latest = await prisma.examAnalysis.findFirst({
      where: { examPaperId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, questions: true, summary: true },
    });
    if (!latest) return notFound('분석 결과가 없습니다');

    const questionsArr = Array.isArray(latest.questions)
      ? (latest.questions as unknown[])
      : [];

    // question_number 매칭 (문자열/숫자 모두 허용)
    const idx = questionsArr.findIndex((q) => {
      const item = q as Record<string, unknown>;
      return String(item.question_number) === String(questionNumber);
    });

    if (idx === -1) return notFound('해당 문항을 찾을 수 없습니다');

    const current = questionsArr[idx] as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };

    if (parsed.data.confidence !== undefined) {
      next.confidence = parsed.data.confidence;
    }
    // 보정 학습 대상 필드 — 최초 교정 시 AI 원본을 ai_<field> 에 보존 (ground truth)
    // + 실제 변경된 필드는 corrections 에 모아 append-only 이벤트 로그로 기록 (순수 수집 레이어)
    const corrections: { field: string; aiValue: string | null; fromValue: string | null; toValue: string | null }[] = [];
    const applyField = (field: string, aiKey: string, value: unknown) => {
      const fromRaw = current[field];
      const from = fromRaw == null ? null : String(fromRaw);
      const to = value == null ? null : String(value);
      // AI 원본: 이미 보존돼 있으면 그 값, 아니면 현재값(= 최초 교정 직전이 AI 원본)
      const aiRaw = current[aiKey] != null ? current[aiKey] : current[field];
      const ai = aiRaw == null ? null : String(aiRaw);
      if (current[aiKey] == null) next[aiKey] = current[field] ?? null;
      next[field] = value;
      if (from !== to) corrections.push({ field, aiValue: ai, fromValue: from, toValue: to });
    };
    if (parsed.data.topic !== undefined) applyField('topic', 'ai_topic', parsed.data.topic.trim() || null);
    if (parsed.data.difficulty !== undefined) applyField('difficulty', 'ai_difficulty', parsed.data.difficulty);
    if (parsed.data.points !== undefined) applyField('points', 'ai_points', parsed.data.points);
    if (parsed.data.question_type !== undefined) applyField('question_type', 'ai_question_type', parsed.data.question_type);
    if (parsed.data.ability_domain !== undefined) applyField('ability_domain', 'ai_ability_domain', parsed.data.ability_domain);
    // 수동 편집 표시
    next.manually_edited = true;
    next.manually_edited_at = new Date().toISOString();

    const updatedQuestions = [...questionsArr];
    updatedQuestions[idx] = next;

    // summary 는 questions 에서 파생되는 값이다(엔진과 같은 tallyQuestions). 교정 뒤 맞춰 두지 않으면
    // 저장된 분포를 읽는 곳 — 유형 차트 · 블로그 차트 PNG · AI 총평 프롬프트 · 주변학교 비교 — 가
    // 교정 전 값을 계속 쓴다(2026-09-17: 유형 2문항 교정 후에도 '변화와 관계 22문항 100%').
    // summary 가 없거나 객체가 아니면(구형·손상) 새로 지어내지 않고 그대로 둔다.
    const summaryRaw = latest.summary;
    let nextSummary: Record<string, unknown> | null = null;
    if (summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)) {
      // tallyQuestions 는 difficulty · question_type · 형식 필드를 방어적으로만 읽는다 — 객체가 아닌 항목만 거른다.
      const tallySource = updatedQuestions.filter(
        (q): q is Record<string, unknown> => !!q && typeof q === 'object',
      ) as unknown as AnalyzedQuestion[];
      const dist = tallyQuestions(tallySource, examPaper.subject);
      nextSummary = {
        ...(summaryRaw as Record<string, unknown>),
        difficulty_distribution: dist.difficulty,
        type_distribution: dist.type,
        average_difficulty: dist.dominantDifficulty,
        dominant_type: dist.dominantType,
      };
    }

    await prisma.examAnalysis.update({
      where: { id: latest.id },
      data: {
        questions: updatedQuestions as never,
        ...(nextSummary ? { summary: nextSummary as never } : {}),
      },
    });

    // ── 교정 이벤트 로그 (append-only, best-effort) — 실패해도 교정 저장 자체는 성공 처리 ──
    if (corrections.length > 0) {
      try {
        const ctxTopic = next.topic ?? current.topic;
        const ctxType = next.question_type ?? current.question_type;
        const ctxAiDiff = current.ai_difficulty ?? current.difficulty;
        await prisma.metadataCorrectionLog.createMany({
          data: corrections.map((c) => ({
            examPaperId: id,
            tenantId: examPaper.tenantId ?? null,
            questionNumber: String(questionNumber),
            field: c.field,
            aiValue: c.aiValue,
            fromValue: c.fromValue,
            toValue: c.toValue,
            topic: ctxTopic != null ? String(ctxTopic) : null,
            questionType: ctxType != null ? String(ctxType) : null,
            aiDifficulty: ctxAiDiff != null ? String(ctxAiDiff) : null,
            grade: examPaper.grade ?? null,
            userId: user.id,
          })),
        });
      } catch (logErr) {
        console.error('[correction-log] 이벤트 기록 실패(무시):', logErr);
      }
    }

    return NextResponse.json({ data: { question: next } });
  } catch (error) {
    console.error('[exam-analysis question PATCH] 수정 에러:', error);
    return NextResponse.json(
      { error: { code: 'UPDATE_FAILED', message: '문항 수정에 실패했습니다' } },
      { status: 500 },
    );
  }
}
