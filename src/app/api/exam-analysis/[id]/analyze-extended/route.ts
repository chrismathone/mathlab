import { NextRequest, NextResponse } from 'next/server';
import { toUserFacingError } from '@/lib/exam-analysis/shared/error-message';
import { prisma } from '@/lib/db';
import { requireTeacher, isResponse, notFound, badRequest } from '@/lib/api';
import { getExamScope } from '@/lib/demo/accounts';
import { analyzeExtendedRequestSchema } from '@/lib/exam-analysis/schemas';
import { runExtendedAnalysis } from '@/lib/exam-analysis/agents/orchestrator';
import type { AgentType } from '@/lib/exam-analysis/constants';
import { assertPlanFeature } from '@/lib/billing/guard';
import { assertDemoFeature } from '@/lib/demo/accounts';
import { toExamSubjectKey } from '@/lib/exam-analysis/shared/subject';
import { checkEnglishCommentaryReadiness } from '@/lib/exam-analysis/english/commentary/context';

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

/** POST /api/exam-analysis/[id]/analyze-extended — 확장 분석 (에이전트) 실행 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await requireTeacher();
  if (isResponse(user)) return user;
  const { id } = await params;

  const body = await request.json();
  const parsed = analyzeExtendedRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest('분석 에이전트를 선택하세요');

  const { agents, forceRegenerate, includeNearby, includeYearCompare } = parsed.data;

  const tenantWhere = await getExamScope(user);
  const examPaper = await prisma.examPaper.findFirst({
    where: { id, ...tenantWhere },
  });
  if (!examPaper) return notFound('시험지를 찾을 수 없습니다');

  // 총평(commentary) 에이전트 게이트 — 데모 계정은 계정별 권한, 그 외는 플랜(Pro+). 다른 에이전트는 게이트 없음
  if (agents.includes('commentary')) {
    const demo = await assertDemoFeature(user, 'commentary');
    if (demo.response) return demo.response;
    if (!demo.handled) {
      const featureGate = await assertPlanFeature(user.viewingTenantId ?? user.tenantId, 'commentary');
      if (featureGate) return featureGate;
    }
  }

  // 최신 분석 결과 조회
  const latestAnalysis = await prisma.examAnalysis.findFirst({
    where: { examPaperId: id },
    orderBy: { createdAt: 'desc' },
  });
  if (!latestAnalysis) return badRequest('기본 분석을 먼저 실행하세요');

  // 영어 총평 — 서버 readiness 차단(누락·배점·단원·번호 중복·소문항 배점). 화면과 같은 함수.
  // 출처 미확인·세부 근거 부족은 차단하지 않는다(구조 중심 보고서로 생성).
  const englishCommentary = toExamSubjectKey(examPaper.subject) === 'ENGLISH' && agents.includes('commentary');
  if (englishCommentary) {
    const readiness = checkEnglishCommentaryReadiness({ examPaper, analysis: latestAnalysis });
    if (!readiness.ready) {
      return NextResponse.json(
        { error: { code: 'COMMENTARY_NOT_READY', message: `총평을 만들기 전에 확인할 항목이 있습니다: ${readiness.reasons.join(' · ')}` } },
        { status: 400 },
      );
    }
  }

  try {
    const results = await runExtendedAnalysis({
      analysisId: latestAnalysis.id,
      agentTypes: agents as AgentType[],
      forceRegenerate,
      includeNearby,
      includeYearCompare,
      userId: user.id, // 각 extension의 lastRunBy 추적
    });

    // 영어 총평: 진행 중(다른 요청이 lease 보유) → 409, 그 사이 준비 상태가 깨졌으면 400. 둘 다 AI 호출 없음.
    // 그 외(생성 실패 포함)는 기존 배열 계약 그대로 — 클라이언트가 항목 status 를 본다.
    const english = englishCommentary ? results.find((r) => r.agentType === 'commentary') : undefined;
    if (english?.code === 'in_progress') {
      return NextResponse.json({ error: { code: 'COMMENTARY_IN_PROGRESS', message: english.error ?? '이미 총평을 만드는 중입니다' } }, { status: 409 });
    }
    if (english?.code === 'not_ready') {
      return NextResponse.json({ error: { code: 'COMMENTARY_NOT_READY', message: english.error ?? '총평을 만들기 전에 확인할 항목이 있습니다' } }, { status: 400 });
    }

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('[기출분석] 확장 분석 실패:', error);
    const errorMsg = toUserFacingError(error, '확장 분석에 실패했습니다. 다시 시도해 주세요.');
    return NextResponse.json(
      { error: { code: 'EXTENDED_ANALYSIS_FAILED', message: errorMsg } },
      { status: 500 }
    );
  }
}
