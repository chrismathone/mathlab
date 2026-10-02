/**
 * 분석 에이전트 오케스트레이터
 * Python orchestrator.py에서 1:1 이식
 *
 * 순차 의존성: weakness → learning → prediction
 * 독립 실행 가능: commentary, topic-strategy, exam-prep, score-level-plan
 */

import { prisma } from '@/lib/db';
import type { AgentType } from '../constants';
import type { WeaknessProfile, LearningPlan, BasicAnalysisResult } from '../types';
import type { AgentInput } from './base-agent';
import { findNearbyExamData } from '../nearby-school-data';
import { formatDistribution, type FormatSourceQuestion } from '../shared/question-format';
import { readExamStats, hasAnyExamStats } from '../shared/exam-stats';
import { toExamSubjectKey } from '../shared/subject';
import { toUserFacingError } from '../shared/error-message';

// 에이전트 lazy import (순환 참조 방지)
async function getAgent(agentType: AgentType) {
  switch (agentType) {
    case 'weakness': return new (await import('./weakness-agent')).WeaknessAgent();
    case 'learning': return new (await import('./learning-agent')).LearningAgent();
    case 'prediction': return new (await import('./prediction-agent')).PredictionAgent();
    case 'commentary': return new (await import('./commentary-agent')).CommentaryAgent();
    case 'topic-strategy': return new (await import('./topic-strategy-agent')).TopicStrategyAgent();
    case 'exam-prep': return new (await import('./exam-prep-agent')).ExamPrepAgent();
    case 'score-level-plan': return new (await import('./score-level-plan-agent')).ScoreLevelPlanAgent();
    default: throw new Error(`알 수 없는 에이전트: ${agentType}`);
  }
}

// 순차 의존성 에이전트 (weakness → learning → prediction)
const SEQUENTIAL_AGENTS: AgentType[] = ['weakness', 'learning', 'prediction'];

export interface OrchestratorResult {
  agentType: AgentType;
  result: unknown;
  status: 'completed' | 'failed';
  error?: string;
  /** 영어 총평 판정 코드 (completed·cached·in_progress·not_ready 등) — route 가 HTTP 상태로 옮긴다 */
  code?: string;
}

/**
 * 확장 분석 실행
 */
export async function runExtendedAnalysis(params: {
  analysisId: string;
  agentTypes: AgentType[];
  forceRegenerate?: boolean;
  includeNearby?: boolean;
  includeYearCompare?: boolean;
  /** 실행자 userId — extension의 lastRunBy 추적용 */
  userId?: string;
}): Promise<OrchestratorResult[]> {
  const { analysisId, agentTypes, forceRegenerate = false, includeNearby = true, includeYearCompare = true, userId } = params;
  const now = new Date();

  // 기본 분석 조회
  const analysis = await prisma.examAnalysis.findUnique({
    where: { id: analysisId },
    include: { examPaper: { select: { subject: true, examStats: true } } },
  });
  if (!analysis) throw new Error('분석 결과를 찾을 수 없습니다');

  // 과목 — 에이전트 프롬프트 페르소나·라벨 분기용. 없으면 에이전트가 수학으로 폴백한다.
  const subject = analysis.examPaper?.subject ?? null;

  // 학교 공지 실측 지표 — 대부분의 시험지에서 null 이다.
  // 값이 있을 때만 에이전트에 넘긴다 — 빈 블록을 붙이면 AI 가 채우려 든다(§12-14).
  const examStats = readExamStats(analysis.examPaper?.examStats);
  const hasExamStats = hasAnyExamStats(examStats);

  // `questions` 는 Prisma `Json` 이라 런타임에 무엇이든 올 수 있다 — 배열 메서드를 쓰기 전에
  // 한 번 정규화한다(CLAUDE.md §11). 배열이 아니면 형식 분포는 빈 집계가 된다.
  const questionList = Array.isArray(analysis.questions)
    ? (analysis.questions as unknown as FormatSourceQuestion[])
    : [];

  const basicResult = {
    questions: analysis.questions,
    summary: analysis.summary,
    exam_info: {
      total_questions: analysis.totalQuestions || 0,
      total_points: analysis.totalPoints || 0,
      // 예전엔 0,0,0 이라 에이전트가 형식 구성을 전혀 모른 채 분석했다.
      format_distribution: formatDistribution(questionList),
    },
  } as unknown as BasicAnalysisResult;

  const results: OrchestratorResult[] = [];

  // 영어 총평은 독립 계약 경로(english/commentary)로 보낸다 — BaseAgent 폴백·metadata·주변 비교·v4 병합을 타지 않는다.
  // 수학(또는 영어의 다른 에이전트)은 아래 기존 경로 그대로다.
  const englishCommentary = toExamSubjectKey(subject) === 'ENGLISH' && agentTypes.includes('commentary');
  const genericTypes = englishCommentary ? agentTypes.filter(t => t !== 'commentary') : agentTypes;

  // 순차 의존성 에이전트 분리
  const sequentialRequested = genericTypes.filter(t => SEQUENTIAL_AGENTS.includes(t));
  const independentRequested = genericTypes.filter(t => !SEQUENTIAL_AGENTS.includes(t));

  // 중간 결과 저장 (순차 의존성용)
  let weaknessProfile: WeaknessProfile | undefined;
  let learningPlan: LearningPlan | undefined;

  // 순차 에이전트 실행 (weakness → learning → prediction 순서 보장)
  for (const agentType of SEQUENTIAL_AGENTS) {
    if (!sequentialRequested.includes(agentType)) continue;

    // 기존 결과 확인
    if (!forceRegenerate) {
      const existing = await prisma.examAnalysisExtension.findUnique({
        where: { analysisId_agentType: { analysisId, agentType } },
      });
      if (existing && !existing.errorMessage) {
        // 기존 결과에서 중간값 복원
        if (agentType === 'weakness') weaknessProfile = existing.result as unknown as WeaknessProfile;
        if (agentType === 'learning') learningPlan = existing.result as unknown as LearningPlan;
        results.push({ agentType, result: existing.result, status: 'completed' });
        continue;
      }
    }

    try {
      const agent = await getAgent(agentType);
      const input: AgentInput = {
        basicAnalysis: basicResult,
        subject,
        weaknessProfile,
        learningPlan,
      };

      const agentResult = await agent.run(input);

      // 중간 결과 저장
      if (agentType === 'weakness') weaknessProfile = agentResult as unknown as WeaknessProfile;
      if (agentType === 'learning') learningPlan = agentResult as unknown as LearningPlan;

      // DB 저장 — _meta에 에이전트별 프롬프트 버전 기록 (버전별 품질 비교용)
      // 폴백 발생 시 errorMessage 에 AI 실패 원인 기록 → orchestrator 가 다음 호출 시 캐시 무시 + 진단 정보 노출
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsonResult = JSON.parse(JSON.stringify(agentResult)) as any;
      jsonResult._meta = { promptVersion: agent.promptVersion, generatedAt: new Date().toISOString() };
      // V4 데이터 보존 — commentary 재분석이 V4 필드(v4_*)를 덮어쓰지 않도록 머지 (사용자 보고 2026-05-28)
      if (agentType === 'commentary') {
        const existing = await prisma.examAnalysisExtension.findUnique({
          where: { analysisId_agentType: { analysisId, agentType } },
        });
        const existingResult = (existing?.result as Record<string, unknown>) || {};
        // V3 강화(2026-05-29): commentary가 이제 v4_* 를 직접 생성 → 새 값 우선.
        // 새 결과에 없는 v4_* 키만 기존값 보존 (V4 비활성 전 데이터 graceful 유지).
        for (const key of Object.keys(existingResult)) {
          if ((key.startsWith('v4_') || key === '_v4_meta') && jsonResult[key] === undefined) {
            jsonResult[key] = existingResult[key];
          }
        }
      }
      const fallbackMsg = agent.lastAiFailure ? `AI 실패(폴백): ${agent.lastAiFailure}` : null;
      await prisma.examAnalysisExtension.upsert({
        where: { analysisId_agentType: { analysisId, agentType } },
        create: { analysisId, agentType, result: jsonResult, errorMessage: fallbackMsg, lastRunBy: userId ?? null, lastRunAt: now },
        update: { result: jsonResult, errorMessage: fallbackMsg, lastRunBy: userId ?? null, lastRunAt: now },
      });

      results.push({ agentType, result: agentResult, status: 'completed' });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : '에이전트 실행 실패';
      await prisma.examAnalysisExtension.upsert({
        where: { analysisId_agentType: { analysisId, agentType } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: { analysisId, agentType, result: {} as any, errorMessage: errorMsg, lastRunBy: userId ?? null, lastRunAt: now },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: { result: {} as any, errorMessage: errorMsg, lastRunBy: userId ?? null, lastRunAt: now },
      });
      results.push({ agentType, result: null, status: 'failed', error: errorMsg });
    }
  }

  // commentary 에이전트용 주변 학교 + 연도 비교 데이터 사전 수집
  let nearbyComparisonData: Awaited<ReturnType<typeof findNearbyExamData>> | undefined;
  if (independentRequested.includes('commentary') && (includeNearby || includeYearCompare)) {
    try {
      nearbyComparisonData = await findNearbyExamData(analysisId);
      // 토글에 따라 데이터 필터링
      if (nearbyComparisonData) {
        if (!includeNearby) nearbyComparisonData.nearbyExams = [];
        if (!includeYearCompare) nearbyComparisonData.sameSchoolExams = [];
      }
    } catch (e) {
      console.error('[orchestrator] 주변 학교 데이터 수집 실패 (무시):', e);
    }
  }

  // commentary용 메타데이터(base scaffolding) 사전 로드 — 분석 직후 백그라운드 생성된 'metadata' extension.
  // 있으면 commentary 에이전트가 base 인라인 호출 없이 V3 단독 생성 → 속도 ↑ (2026-05-29).
  // 없으면 에이전트가 폴백으로 즉석 base 생성.
  let commentaryMetadata: Record<string, unknown> | undefined;
  if (independentRequested.includes('commentary')) {
    const metaExt = await prisma.examAnalysisExtension.findUnique({
      where: { analysisId_agentType: { analysisId, agentType: 'metadata' } },
    });
    const metaResult = metaExt?.result as Record<string, unknown> | undefined;
    if (metaResult?.isReady && !metaExt?.errorMessage) {
      commentaryMetadata = metaResult;
    }
  }

  // 독립 에이전트 병렬 실행
  const independentPromises = independentRequested.map(async (agentType) => {
    if (!forceRegenerate) {
      const existing = await prisma.examAnalysisExtension.findUnique({
        where: { analysisId_agentType: { analysisId, agentType } },
      });
      if (existing && !existing.errorMessage) {
        return { agentType, result: existing.result, status: 'completed' as const };
      }
    }

    try {
      const agent = await getAgent(agentType);
      const input: AgentInput = {
        basicAnalysis: basicResult,
        subject,
        weaknessProfile,
        learningPlan,
        ...(agentType === 'commentary' && nearbyComparisonData ? { nearbyComparison: nearbyComparisonData } : {}),
        ...(agentType === 'commentary' && commentaryMetadata ? { metadata: commentaryMetadata } : {}),
        ...(agentType === 'commentary' && hasExamStats ? { examStats } : {}),
      };

      const agentResult = await agent.run(input);

      // 폴백 발생 시 errorMessage 에 AI 실패 원인 기록 → 다음 호출 시 캐시 무시 + 진단 정보 노출
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsonResult = JSON.parse(JSON.stringify(agentResult)) as any;
      jsonResult._meta = { promptVersion: agent.promptVersion, generatedAt: new Date().toISOString() };
      // V4 데이터 보존 — commentary 재분석이 V4 필드(v4_*)를 덮어쓰지 않도록 머지 (병렬 경로)
      if (agentType === 'commentary') {
        const existing = await prisma.examAnalysisExtension.findUnique({
          where: { analysisId_agentType: { analysisId, agentType } },
        });
        const existingResult = (existing?.result as Record<string, unknown>) || {};
        // V3 강화(2026-05-29): commentary가 이제 v4_* 를 직접 생성 → 새 값 우선.
        // 새 결과에 없는 v4_* 키만 기존값 보존 (V4 비활성 전 데이터 graceful 유지).
        for (const key of Object.keys(existingResult)) {
          if ((key.startsWith('v4_') || key === '_v4_meta') && jsonResult[key] === undefined) {
            jsonResult[key] = existingResult[key];
          }
        }
      }
      const fallbackMsg = agent.lastAiFailure ? `AI 실패(폴백): ${agent.lastAiFailure}` : null;
      await prisma.examAnalysisExtension.upsert({
        where: { analysisId_agentType: { analysisId, agentType } },
        create: { analysisId, agentType, result: jsonResult, errorMessage: fallbackMsg, lastRunBy: userId ?? null, lastRunAt: now },
        update: { result: jsonResult, errorMessage: fallbackMsg, lastRunBy: userId ?? null, lastRunAt: now },
      });

      return { agentType, result: agentResult, status: 'completed' as const };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : '에이전트 실행 실패';
      await prisma.examAnalysisExtension.upsert({
        where: { analysisId_agentType: { analysisId, agentType } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: { analysisId, agentType, result: {} as any, errorMessage: errorMsg, lastRunBy: userId ?? null, lastRunAt: now },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: { result: {} as any, errorMessage: errorMsg, lastRunBy: userId ?? null, lastRunAt: now },
      });
      return { agentType, result: null, status: 'failed' as const, error: errorMsg };
    }
  });

  const independentResults = await Promise.all(independentPromises);
  results.push(...independentResults);

  if (englishCommentary) {
    try {
      const { runEnglishCommentary } = await import('../english/commentary/service');
      results.push(await runEnglishCommentary({ analysisId, userId, forceRegenerate }));
    } catch (e) {
      // 저장소 예외 등 — 이전 성공 문서는 건드리지 않은 채 실패만 돌려준다
      console.error('[orchestrator] 영어 총평 실행 실패:', e);
      results.push({
        agentType: 'commentary', result: null, status: 'failed', code: 'generation_failed',
        error: toUserFacingError(e, '총평 생성 중 오류가 발생했습니다. 다시 시도해 주세요.'),
      });
    }
  }

  return results;
}
