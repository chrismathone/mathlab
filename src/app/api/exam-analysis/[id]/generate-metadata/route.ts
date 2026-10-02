import { NextRequest, NextResponse } from 'next/server';
import { toUserFacingError } from '@/lib/exam-analysis/shared/error-message';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireTeacher, isResponse, notFound, badRequest } from '@/lib/api';
import { getExamScope } from '@/lib/demo/accounts';
import { CommentaryAgent } from '@/lib/exam-analysis/agents/commentary-agent';
import { findNearbyExamData } from '@/lib/exam-analysis/nearby-school-data';
import type { BasicAnalysisResult, AnalyzedQuestion } from '@/lib/exam-analysis/types';
import { AGENT_PROMPT_VERSIONS } from '@/lib/exam-analysis/constants';
import { formatDistribution } from '@/lib/exam-analysis/shared/question-format';
import { toExamSubjectKey } from '@/lib/exam-analysis/shared/subject';

/**
 * 이 라우트는 AI 호출이 끝날 때까지 요청 안에서 기다린다 — 짧은 API 가 아니다.
 * 300초는 Hobby 플랜의 함수 실행 상한이자 기본값이며(fluid compute 기준),
 * Pro 로 올라가도 그대로 유효하다. 분석 자체 예산은 GEMINI_ANALYZE_TIMEOUT_MS(180초)라
 * 여유가 있다. 이 값을 줄이면 분석이 끝나기 전에 함수가 잘린다.
 *
 * ⚠️ vercel.json 의 `supportsCancellation` 을 켜지 말 것. Vercel 은 기본적으로
 * 클라이언트 연결이 끊겨도 함수를 끝까지 돌린다(취소는 opt-in). 그래서 사용자가
 * 분석 도중 페이지를 떠나도 결과가 DB 에 저장된다 — 켜는 순간 그게 깨진다.
 */
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/exam-analysis/[id]/generate-metadata
 *
 * V3 총평용 "분석 메타데이터"(base scaffolding)를 생성해 DB에만 저장 (화면 비노출).
 * - 분석 직후 백그라운드로 fire-and-forget 호출됨 → 총평 클릭 시 base 호출 없이 V3 단독 생성
 * - 저장 위치: ExamAnalysisExtension(agentType='metadata').result = { ...base 필드, isReady, _meta }
 * - 동시성: 같은 analysisId 동시 호출은 in-memory dedup lock으로 1회만 생성
 */

// ── 동시성 dedup (인스턴스 단위) ──
const inFlight = new Map<string, Promise<void>>();

export async function POST(_request: NextRequest, { params }: Params) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;
  const { id } = await params;

  const tenantWhere = await getExamScope(user);
  const examPaper = await prisma.examPaper.findFirst({ where: { id, ...tenantWhere } });
  if (!examPaper) return notFound('시험지를 찾을 수 없습니다');

  // 영어 총평은 영어 전용 계약(english/commentary)으로만 만든다. 이 수학용 경로를 직접 호출해도
  // 영어 commentary 행(또는 metadata)을 수학 모양으로 덮어쓰지 못하게 명시적으로 거부한다.
  if (toExamSubjectKey(examPaper.subject) === 'ENGLISH') {
    return NextResponse.json(
      { error: { code: 'ENGLISH_NOT_SUPPORTED', message: '영어 시험지는 이 기능을 지원하지 않습니다. 총평 생성 버튼을 이용해 주세요' } },
      { status: 400 },
    );
  }

  const latestAnalysis = await prisma.examAnalysis.findFirst({
    where: { examPaperId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (!latestAnalysis) return badRequest('기본 분석을 먼저 실행하세요');

  // 이미 준비된 메타데이터가 있으면 그대로 반환 (재생성 방지)
  const existing = await prisma.examAnalysisExtension.findUnique({
    where: { analysisId_agentType: { analysisId: latestAnalysis.id, agentType: 'metadata' } },
  });
  if (existing && (existing.result as Record<string, unknown> | null)?.isReady && !existing.errorMessage) {
    return NextResponse.json({ data: { isReady: true, _cached: true } });
  }

  const analysisId = latestAnalysis.id;
  const lockKey = analysisId;

  // 진행 중이면 그 Promise를 재사용 (중복 생성 방지)
  let pending = inFlight.get(lockKey);
  if (!pending) {
    pending = (async () => {
      try {
        const agent = new CommentaryAgent();

        const questions = latestAnalysis.questions as unknown as AnalyzedQuestion[];
        const summary = latestAnalysis.summary as unknown as BasicAnalysisResult['summary'] | null;
        // 형식 분포 정확 집계 (base 프롬프트가 사용)
        const fmt = formatDistribution(questions);
        const basicAnalysis: BasicAnalysisResult = {
          exam_info: {
            total_questions: latestAnalysis.totalQuestions || questions.length,
            total_points: latestAnalysis.totalPoints || 100,
            school_name: examPaper.schoolName || null,
            format_distribution: fmt,
          },
          summary: summary || {
            difficulty_distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
            type_distribution: { number: 0, change_relation: 0, shape_measure: 0, data_possibility: 0 },
            average_difficulty: '3',
            dominant_type: 'change_relation',
          },
          questions,
        };

        // 주변/연도 비교 데이터 — 메타데이터는 풀 비교 포함 (V3가 토글로 취사)
        let nearbyComparison: Awaited<ReturnType<typeof findNearbyExamData>> | undefined;
        try {
          nearbyComparison = await findNearbyExamData(analysisId) || undefined;
        } catch (e) {
          console.warn('[generate-metadata] 주변 학교 데이터 수집 실패 (무시):', e instanceof Error ? e.message : e);
        }

        const metadata = await agent.generateMetadata({
          basicAnalysis,
          subject: examPaper.subject,
          ...(nearbyComparison ? { nearbyComparison } : {}),
        } as unknown as Parameters<typeof agent.generateMetadata>[0]);

        const now = new Date();
        const result = {
          ...metadata,
          isReady: true,
          _meta: { promptVersion: AGENT_PROMPT_VERSIONS.commentary, generatedAt: now.toISOString() },
        };
        await prisma.examAnalysisExtension.upsert({
          where: { analysisId_agentType: { analysisId, agentType: 'metadata' } },
          create: {
            analysisId,
            agentType: 'metadata',
            result: result as unknown as Prisma.InputJsonValue,
            errorMessage: null,
            lastRunBy: user.id,
            lastRunAt: now,
          },
          update: {
            result: result as unknown as Prisma.InputJsonValue,
            errorMessage: null,
            lastRunBy: user.id,
            lastRunAt: now,
          },
        });
      } catch (e) {
        const msg = toUserFacingError(e, '메타데이터 생성에 실패했습니다. 다시 시도해 주세요.');
        console.error('[generate-metadata] 실패:', e);
        // 실패 기록 — UI가 재시도 가능하도록
        const now = new Date();
        await prisma.examAnalysisExtension.upsert({
          where: { analysisId_agentType: { analysisId, agentType: 'metadata' } },
          create: { analysisId, agentType: 'metadata', result: { isReady: false } as unknown as Prisma.InputJsonValue, errorMessage: msg, lastRunBy: user.id, lastRunAt: now },
          update: { result: { isReady: false } as unknown as Prisma.InputJsonValue, errorMessage: msg, lastRunAt: now },
        }).catch(() => { /* 무시 */ });
        throw e;
      } finally {
        inFlight.delete(lockKey);
      }
    })();
    inFlight.set(lockKey, pending);
  }

  try {
    await pending;
    return NextResponse.json({ data: { isReady: true } });
  } catch {
    return NextResponse.json(
      { error: { code: 'METADATA_GEN_FAILED', message: '메타데이터 생성 중 오류가 발생했습니다' } },
      { status: 500 },
    );
  }
}
