import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTeacher, isResponse, notFound, badRequest } from '@/lib/api';
import { getExamScope } from '@/lib/demo/accounts';
import { CommentaryAgent } from '@/lib/exam-analysis/agents/commentary-agent';
import type { BasicAnalysisResult, AnalyzedQuestion } from '@/lib/exam-analysis/types';
import { COMMENTARY_V4_PROMPT_VERSION } from '@/lib/exam-analysis/constants';
import { assertPlanFeature } from '@/lib/billing/guard';
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
 * POST /api/exam-analysis/[id]/generate-v4
 *
 * V4 (갈수학학원 스타일) 데이터 lazy 생성.
 * - V3와 독립 — V3 데이터 없어도 실행 가능
 * - ExamAnalysisExtension agentType='commentary' 의 result.v4_* 필드에 머지 저장
 * - 사용자 V4 토글 클릭 시 호출되며, 이미 V4 데이터 있으면 force 옵션 필요
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  const tenantWhere = await getExamScope(user);
  const examPaper = await prisma.examPaper.findFirst({
    where: { id, ...tenantWhere },
  });
  if (!examPaper) return notFound('시험지를 찾을 수 없습니다');

  // 영어 총평은 영어 전용 계약(english/commentary)으로만 만든다. 이 수학용 경로를 직접 호출해도
  // 영어 commentary 행(또는 metadata)을 수학 모양으로 덮어쓰지 못하게 명시적으로 거부한다.
  if (toExamSubjectKey(examPaper.subject) === 'ENGLISH') {
    return NextResponse.json(
      { error: { code: 'ENGLISH_NOT_SUPPORTED', message: '영어 시험지는 이 기능을 지원하지 않습니다. 총평 생성 버튼을 이용해 주세요' } },
      { status: 400 },
    );
  }

  // AI 총평(V4)은 Pro+ 기능
  const featureGate = await assertPlanFeature(user.viewingTenantId ?? user.tenantId, 'commentary');
  if (featureGate) return featureGate;

  // 사용자 소속 지점(학원) 이름 조회 — V4 본문의 {학원명} placeholder 치환에 사용
  // 없으면 후처리에서 "우리 학원"으로 fallback
  let academyName: string | null = null;
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });
    academyName = tenant?.name?.trim() || null;
  }

  // 최신 분석 결과 조회
  const latestAnalysis = await prisma.examAnalysis.findFirst({
    where: { examPaperId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (!latestAnalysis) return badRequest('기본 분석을 먼저 실행하세요');

  // 기존 commentary extension 조회
  const existing = await prisma.examAnalysisExtension.findUnique({
    where: { analysisId_agentType: { analysisId: latestAnalysis.id, agentType: 'commentary' } },
  });

  // 이미 V4 데이터 있고 force 아니면 그대로 반환 (재호출 방지)
  if (!force && existing && existing.result) {
    const existingResult = existing.result as Record<string, unknown>;
    if (existingResult.v4_exam_overview) {
      return NextResponse.json({
        data: {
          ...existingResult,
          _cached: true,
        },
      });
    }
  }

  try {
    // CommentaryAgent를 직접 인스턴스화하여 generateV4Extension 호출
    const agent = new CommentaryAgent();

    // AgentInput 구성 — basicAnalysis 필요
    const questions = latestAnalysis.questions as unknown as AnalyzedQuestion[];
    const summary = latestAnalysis.summary as unknown as BasicAnalysisResult['summary'] | null;
    const basicAnalysis: BasicAnalysisResult = {
      exam_info: {
        total_questions: latestAnalysis.totalQuestions || questions.length,
        total_points: latestAnalysis.totalPoints || 100,
        school_name: examPaper.schoolName || null,
        // 예전엔 0,0,0 을 넣어 총평 프롬프트가 "객관식 0문항"을 읽었다.
        format_distribution: formatDistribution(questions),
      },
      summary: summary || {
        difficulty_distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        type_distribution: { number: 0, change_relation: 0, shape_measure: 0, data_possibility: 0 },
        average_difficulty: '3',
        dominant_type: 'change_relation',
      },
      questions,
    };

    // examScope에서 시험 종류 / 학기 / 연도 추출 (다음 시험 식별용)
    const scopeRaw = examPaper.examScope as unknown;
    let examYear: number | null = null;
    let examSemester: number | null = null;
    let examCategory: 'MIDTERM' | 'FINAL' | 'MOCK' | 'OTHER' | null = null;
    if (scopeRaw && typeof scopeRaw === 'object' && !Array.isArray(scopeRaw)) {
      const obj = scopeRaw as Record<string, unknown>;
      if (typeof obj.examYear === 'number') examYear = obj.examYear;
      if (typeof obj.examSemester === 'number') examSemester = obj.examSemester;
      if (typeof obj.examCategory === 'string') {
        const cat = obj.examCategory.toUpperCase();
        if (cat === 'MIDTERM' || cat === 'FINAL' || cat === 'MOCK' || cat === 'OTHER') {
          examCategory = cat;
        }
      }
    }

    const v4Extension = await agent.generateV4Extension({
      basicAnalysis,
      // 과목 — 프롬프트 페르소나("너는 … 영어 학원 강사다") 분기용
      subject: examPaper.subject,
      // 다음 시험 인식용 메타 (buildV4UserPrompt가 사용)
      examCategory,
      grade: examPaper.grade,
      examYear,
      examSemester,
      // 학원명 (V4 본문 {학원명} placeholder 치환용)
      academyName,
    } as unknown as Parameters<typeof agent.generateV4Extension>[0]);

    // 기존 commentary extension에 V4 필드 머지 저장
    const now = new Date();
    const mergedResult = {
      ...(existing?.result as Record<string, unknown> | undefined ?? {}),
      ...v4Extension,
      _v4_meta: { promptVersion: COMMENTARY_V4_PROMPT_VERSION, generatedAt: now.toISOString() },
    };

    await prisma.examAnalysisExtension.upsert({
      where: { analysisId_agentType: { analysisId: latestAnalysis.id, agentType: 'commentary' } },
      create: {
        analysisId: latestAnalysis.id,
        agentType: 'commentary',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result: mergedResult as any,
        lastRunBy: user.id,
        lastRunAt: now,
      },
      update: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result: mergedResult as any,
        lastRunBy: user.id,
        lastRunAt: now,
      },
    });

    return NextResponse.json({ data: mergedResult });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'V4 생성에 실패했습니다';
    console.error('[generate-v4] 실패:', error);
    return NextResponse.json(
      { error: { code: 'V4_GENERATION_FAILED', message: errorMsg } },
      { status: 500 }
    );
  }
}
