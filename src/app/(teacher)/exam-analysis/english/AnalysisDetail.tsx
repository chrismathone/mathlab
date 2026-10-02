'use client';

import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { EnglishAnalysisResultView } from '@/components/exam-analysis/english/AnalysisResultView';
import { EnglishAnalysisCommentTab } from '@/components/exam-analysis/english/AnalysisCommentTab';
import { EnglishStudyStrategyTab } from '@/components/exam-analysis/EnglishStudyStrategyTab';
import { useSubscription } from '@/components/providers/SubscriptionProvider';
import type { AnalysisSummary } from '@/lib/exam-analysis/types';
import { DIFFICULTY_BAR_COLORS } from '@/lib/exam-analysis/constants';
import { toUserFacingError } from '@/lib/exam-analysis/shared/error-message';
import type { ExamPaperData, AnalysisTab } from '../types';
import { getConfidenceInfo, getOverallDifficultyLevel, getDifficultyBreakdown, interpolateDifficultyColor } from '../helpers';
import { weightedAverageDifficulty } from '@/lib/exam-analysis/difficulty';
import { ENGLISH_STUDY_AGENT } from '@/lib/exam-analysis/english-study-pack';
import { DIFF_LEVEL_LABELS } from '../constants';
import { AnalyzingProgress } from '../AnalyzingProgress';
import { ExamStatsPanel } from '@/components/exam-analysis/ExamStatsPanel';
import { EnglishCommentarySection } from './EnglishCommentarySection';

/** 난이도 1~5 연속축 그라데이션 (녹→빨). 0/25/50/75/100% = 1/2/3/4/5단계 위치. */
const DIFF_GRADIENT = `linear-gradient(to right, ${DIFFICULTY_BAR_COLORS[0]} 0%, ${DIFFICULTY_BAR_COLORS[1]} 25%, ${DIFFICULTY_BAR_COLORS[2]} 50%, ${DIFFICULTY_BAR_COLORS[3]} 75%, ${DIFFICULTY_BAR_COLORS[4]} 100%)`;
/** 난이도 값(1~5) → 연속축 위치(%). 1=0%, 3=50%, 5=100%. 연속값이라 마커가 축 위치와 정확히 일치. */
const diffLinePos = (v: number) => ((Math.max(1, Math.min(5, v)) - 1) / 4) * 100;
const DIFF_ZONE_SHORT = ['기본', '표준', '응용', '심화', '최고'];

/**
 * 시험 난이도 수직선(연속축) — 1~5 그라데이션 위에 정확한 가중평균 위치를 마커로 표시.
 * 이산 박스(1·2·3·4·5 강조)는 연속값(예 3.9)과 시각적으로 어긋나므로(헤더 3.9 vs 박스 4) 연속축으로 대체.
 * aiAvg가 보정 후 avg와 유의미하게 다르면(≥0.05) "보정 전(AI)" 마커를 트랙 아래에 함께 표시.
 */
function DifficultyNumberLine({ avg, aiAvg, width, zoneLabels = false }: {
  avg: number;
  aiAvg?: number | null;
  width?: number | string;
  zoneLabels?: boolean;
}) {
  const color = interpolateDifficultyColor(avg);
  const hasShift = aiAvg != null && aiAvg > 0 && Math.abs(aiAvg - avg) >= 0.05;
  return (
    <div className="relative" style={{ width: width ?? '100%' }}>
      {/* 보정 후(현재) 마커 — 트랙 위, 값 + ▼ */}
      <div className="relative h-4">
        <div
          className="absolute -translate-x-1/2 top-0 flex flex-col items-center"
          style={{ left: `${diffLinePos(avg)}%` }}
          title={`가중평균 ${avg.toFixed(2)}`}
        >
          <span className="text-[10px] font-extrabold leading-none whitespace-nowrap" style={{ color }}>{avg.toFixed(1)}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" className="mt-0.5"><polygon points="5,6 0,0 10,0" fill={color} /></svg>
        </div>
      </div>
      {/* 그라데이션 트랙 */}
      <div className="h-2.5 rounded-full" style={{ background: DIFF_GRADIENT }} />
      {/* 보정 전(AI) 마커 — 트랙 아래, 유의미한 차이가 있을 때만 */}
      {hasShift && (
        <div className="relative h-4">
          <div
            className="absolute -translate-x-1/2 top-0 flex flex-col items-center"
            style={{ left: `${diffLinePos(aiAvg!)}%` }}
            title={`보정 전(AI 분석) ${aiAvg!.toFixed(2)}`}
          >
            <svg width="10" height="6" viewBox="0 0 10 6"><polygon points="5,0 0,6 10,6" fill="#94A3B8" /></svg>
            <span className="text-[9px] font-medium leading-none text-slate-400 whitespace-nowrap mt-0.5">AI {aiAvg!.toFixed(1)}</span>
          </div>
        </div>
      )}
      {/* 눈금 1~5 (+ 선택적 구간 라벨) */}
      <div className={`relative ${zoneLabels ? 'h-8' : 'h-3'} mt-0.5`}>
        {[1, 2, 3, 4, 5].map((lv) => (
          <div
            key={lv}
            className="absolute -translate-x-1/2 top-0 flex flex-col items-center"
            style={{ left: `${diffLinePos(lv)}%` }}
          >
            <span className="text-[9px] text-slate-400 leading-none">{lv}</span>
            {zoneLabels && <span className="text-[9px] text-slate-500 leading-tight mt-1">{DIFF_ZONE_SHORT[lv - 1]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface AnalysisDetailProps {
  detail: ExamPaperData;
  analyzing: boolean;
  onAnalyze: (id: string) => void;
  onRefresh: () => void;
  /** 분석 시 총평 자동 생성 옵션 (page.tsx에서 localStorage 관리) */
  autoCommentary?: boolean;
  onToggleAutoCommentary?: (v: boolean) => void;
  /** 현재 시험지의 생성 단계 (page.tsx genState) — metadata(준비) / commentary(자동 총평) + 진행시각 */
  gen?: { phase: 'metadata' | 'commentary' | 'englishStudy'; startMs: number; willChain: boolean } | null;
  /** 수동 [총평 생성] 시작/종료를 page.tsx에 알림 → 사이드바 배지 실시간 반영 + 완료 시 목록 갱신 */
  onCommentaryGenChange?: (id: string, started: boolean) => void;
}

export function EnglishAnalysisDetail({ detail, analyzing, onAnalyze, onRefresh, autoCommentary = false, onToggleAutoCommentary, gen = null, onCommentaryGenChange }: AnalysisDetailProps) {
  const { demo } = useSubscription();
  const [activeTab, setActiveTab] = useState<AnalysisTab>('basic');
  const [showDiffModal, setShowDiffModal] = useState(false);
  useEffect(() => { setActiveTab('basic'); setShowDiffModal(false); }, [detail.id]);

  const latestAnalysis = detail.analyses?.[0];
  // 선생님 난이도 교정 오버레이 — 수정 즉시 종합 난이도 재계산 (서버 저장은 PATCH 가 별도 처리)
  const [diffEdits, setDiffEdits] = useState<Record<string, { difficulty: string; ai_difficulty: string | null }>>({});
  // 분석본 전환 시 오버레이 초기화
  useEffect(() => { setDiffEdits({}); }, [latestAnalysis?.id]);
  const questions = useMemo(() =>
    (Array.isArray(latestAnalysis?.questions) ? latestAnalysis.questions : []).map((q) => {
      const e = diffEdits[String(q.question_number)];
      return e ? { ...q, difficulty: e.difficulty, ai_difficulty: e.ai_difficulty, manually_edited: true } : q;
    }),
  [latestAnalysis?.questions, diffEdits]);
  const summary = (latestAnalysis?.summary || null) as AnalysisSummary | null;
  const totalPoints = latestAnalysis?.totalPoints;

  const confidenceInfo = useMemo(() => getConfidenceInfo(questions), [questions]);
  const diffLevel = useMemo(() => getOverallDifficultyLevel(summary, questions), [summary, questions]);

  const englishStudyExt = latestAnalysis?.extensions?.find((e) => e.agentType === ENGLISH_STUDY_AGENT);
  const demoAcct = demo && demo.isDemo ? demo : null;
  const analyzeBlocked = !!demoAcct && (!demoAcct.perms.analyze || demoAcct.remaining <= 0);
  const analyzeBlockReason = !demoAcct ? undefined : !demoAcct.perms.analyze
    ? '이 데모 계정은 기출분석 체험 권한이 없습니다'
    : demoAcct.remaining <= 0 ? '데모 체험 횟수를 모두 사용했습니다' : undefined;

  const tabItems = [
    { key: 'basic' as const, label: '기본 분석' },
    { key: 'comments' as const, label: 'AI 코멘트', count: questions.length },
    { key: 'strategy' as const, label: '학습 대책' },
  ];

  return (
    <div className="max-w-[960px] mx-auto">
      {/* ── 헤더 ── */}
      <div className="mb-5">
        {/* 좁은 창에서 우측 그룹(버튼+난이도 카드)이 전역 헤더 사용자 메뉴와 겹치지 않도록 flex-wrap →
            좁아지면 우측 그룹이 제목 아래 줄로 내려감 (2026-05-29 사용자 보고) */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-900 leading-tight">{detail.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-sm">
                {detail.grade}
              </span>
              <span className="inline-flex px-2 py-0.5 bg-sky-100 text-sky-700 text-xs font-medium rounded-sm">
                영어
              </span>
              {detail.status === 'COMPLETED' && questions.length > 0 && (
                <>
                  <span className="text-xs text-slate-500">
                    총 {questions.length}문항{totalPoints ? ` · ${totalPoints}점 만점` : ''}
                  </span>
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-sm ${confidenceInfo.color}`}>
                    신뢰도 {confidenceInfo.avg}%
                  </span>
                  {latestAnalysis?.modelVersion && (() => {
                    // modelVersion은 "gemini-… / prompt vX.Y.Z" 형태 — 모델명 비노출 규칙(#0): 툴팁 포함 prompt 버전만 표시
                    const promptLabel = latestAnalysis.modelVersion.includes('prompt')
                      ? latestAnalysis.modelVersion.split('/ ').pop()
                      : 'prompt v0';
                    return (
                      <span className="text-[10px] text-slate-400" title={promptLabel}>
                        {promptLabel}
                      </span>
                    );
                  })()}
                </>
              )}
            </div>
          </div>

          {/* 우측: 버튼 + 등급 뱃지 — 매우 좁을 땐 내부도 wrap */}
          <div className="flex flex-wrap items-center gap-3">
            {(detail.status === 'PENDING' || detail.status === 'FAILED') && (
              <div className="flex items-center gap-3">
                <Button onClick={() => onAnalyze(detail.id)} disabled={analyzing || analyzeBlocked} title={analyzeBlockReason}>
                  {analyzing ? '분석 중...' : '분석 실행'}
                </Button>
              </div>
            )}

            {/* 종합 난이도 카드 — 클릭 시 판단 기준 모달 */}
            {detail.status === 'COMPLETED' && diffLevel > 0 && (() => {
              const breakdown = getDifficultyBreakdown(summary, questions);
              // 가중평균이 있으면 소수점 위치 기준 그라데이션, 없으면 정수 Level 색
              const avg = breakdown?.weightedAvg ?? diffLevel;
              const activeColor = interpolateDifficultyColor(avg);
              return (
                <button
                  type="button"
                  onClick={() => setShowDiffModal(true)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-sm border cursor-pointer hover:shadow-sm transition-all text-left"
                  style={{ borderColor: `${activeColor}50`, backgroundColor: `${activeColor}0A` }}
                  aria-label="시험 난이도 판단 기준 보기"
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500">시험 추정 난도</span>
                    {/* 연속축 수직선 — 정확한 가중평균 위치에 마커(이산 박스 대비 헤더 값과 정확히 일치) */}
                    <DifficultyNumberLine avg={avg} width={150} />
                  </div>
                  <div className="border-l pl-3" style={{ borderColor: `${activeColor}30` }}>
                    <span className="text-base font-extrabold" style={{ color: activeColor }}>{avg.toFixed(1)}단계</span>
                    {breakdown && (
                      <div className="text-[10px] text-slate-500 font-medium mt-0.5">
                        {breakdown.total}문항 {breakdown.usedPoints ? '배점·영향력 가중평균' : '영향력 가중평균'}
                      </div>
                    )}
                    {(() => {
                      const editedCount = questions.filter((q) => q.manually_edited && q.ai_difficulty != null).length;
                      return editedCount > 0 ? (
                        <div className="text-[10px] text-primary font-medium mt-0.5">선생님 교정 {editedCount}건 반영</div>
                      ) : null;
                    })()}
                  </div>
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── 에러 상태 ── */}
      {detail.status === 'FAILED' && detail.errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-sm p-3 mb-4 text-sm text-red-700">
          {/* 서버가 이미 정제해 저장하지만, 그 전에 쌓인 레거시 행엔 환경변수목·CLI 플래그가
              그대로 남아 있다 — 표시 시점에도 같은 함수로 한 번 더 거른다 (적대적 리뷰 2.2) */}
          {toUserFacingError(detail.errorMessage)}
        </div>
      )}

      {/* ── 분석 중 ── (latestAnalysis가 있으면 stale status 무시 — 분석 결과가 있다 = 완료) */}
      {detail.status === 'ANALYZING' && !latestAnalysis && (
        <AnalyzingProgress
          key={detail.id}
          serverStep={detail.analysisStep}
          subject="ENGLISH"
          serverLogs={detail.analysisProgress}
        />
      )}

      {/* ── 분석 완료 ── */}
      {latestAnalysis && detail.status === 'COMPLETED' && (
        <>
          {/* 학교 공지 지표 — 값이 없으면 카드 대신 한 줄짜리 입력 경로만 렌더된다.
              성적표는 시험 2~4주 뒤에 나오므로 발행 후 갱신이 정상 경로다. */}
          <div className="mb-4">
            <ExamStatsPanel examPaperId={detail.id} raw={detail.examStats} onSaved={onRefresh} />
          </div>

          <EnglishCommentarySection
            key={detail.id}
            detail={detail}
            gen={gen}
            autoCommentary={autoCommentary}
            onToggleAutoCommentary={onToggleAutoCommentary}
            onRefresh={onRefresh}
            onGenerationChange={onCommentaryGenChange}
            onReanalyze={() => onAnalyze(detail.id)}
            reanalyzing={analyzing || analyzeBlocked}
          />

          {/* 탭 */}
          <div className="mb-5">
            <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} variant="underline" />
          </div>

          {/* 탭 컨텐츠 */}
          {activeTab === 'basic' && (
            <EnglishAnalysisResultView
              key={`${detail.id}:${latestAnalysis.id}`}
              questions={questions}
              summary={summary}
              totalPoints={totalPoints ?? null}
              earnedPoints={latestAnalysis.earnedPoints ?? null}
              examType={detail.examType}
              examPaperId={detail.id}
              analysisId={latestAnalysis?.id}
              onDifficultyEdit={(qNum, difficulty, aiDifficulty) => {
                setDiffEdits((prev) => ({ ...prev, [String(qNum)]: { difficulty, ai_difficulty: aiDifficulty } }));
                onRefresh();
              }}
              grade={detail.grade}
              onRefresh={onRefresh}
            />
          )}
          {activeTab === 'comments' && (
            <EnglishAnalysisCommentTab
              questions={questions}
              examPaperId={detail.id}
              analysisId={latestAnalysis?.id}
              onDifficultyEdit={(qNum, difficulty, aiDifficulty) => {
                setDiffEdits((prev) => ({ ...prev, [String(qNum)]: { difficulty, ai_difficulty: aiDifficulty } }));
                onRefresh();
              }}
            />
          )}
          {activeTab === 'strategy' && (
            <EnglishStudyStrategyTab
              preparing={gen?.phase === 'englishStudy'}
              questions={questions}
              grade={detail.grade}
              examPaperId={detail.id}
              analysisId={latestAnalysis?.id}
              storedPack={englishStudyExt?.result}
              // 저장분에 실패 표시가 붙어 있으면 완결본이 아니다 → 탭이 다시 뽑도록 알린다.
              // 예전엔 result 만 넘겨서, 서버가 재시도용으로 남긴 errorMessage 가 여기서 사라졌다
              // (적대적 리뷰 1.11 — 자동 복구가 영영 안 돌았다).
              storedIncomplete={!!englishStudyExt?.errorMessage}
              onStored={onRefresh}
            />
          )}
        </>
      )}
      {/* 시험 난이도 판단 기준 — 간이 모달 */}
      {showDiffModal && diffLevel > 0 && (() => {
        const breakdown = getDifficultyBreakdown(summary, questions);
        const avg = breakdown?.weightedAvg ?? diffLevel;
        const avgLabel = breakdown?.usedPoints ? '배점·영향력 가중평균' : '영향력 가중평균';
        const activeColor = interpolateDifficultyColor(avg);
        const levelLabel = DIFF_LEVEL_LABELS[diffLevel] ?? '';
        // 보정 전(AI 원본) 가중평균 — 각 문항의 difficulty를 ai_difficulty(없으면 현재값)로 치환해 동일 공식 적용
        const aiAvg = weightedAverageDifficulty(
          questions.map((q) => ({ ...q, difficulty: String(q.ai_difficulty ?? q.difficulty) })),
        ).avg;
        const hasShift = !!breakdown && aiAvg > 0 && Math.abs(aiAvg - avg) >= 0.05;
        // 선생님 수동 난이도 보정 내역 (AI 원본 ≠ 교사 교정값인 문항)
        const normLevel = (v: unknown): string => {
          const k = String(v ?? '');
          const legacy: Record<string, string> = { concept: '1', pattern: '2', reasoning: '4', creative: '5' };
          return legacy[k] || (/^[1-5]$/.test(k) ? k : '');
        };
        const diffCorrections = questions
          .filter((q) => q.manually_edited && q.ai_difficulty != null)
          .map((q) => ({ num: q.question_number, ai: normLevel(q.ai_difficulty), teacher: normLevel(q.difficulty) }))
          .filter((c) => c.ai && c.teacher && c.ai !== c.teacher);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setShowDiffModal(false)}
          >
            <div
              className="bg-white rounded-sm shadow-xl max-w-md w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    시험 난이도 <span style={{ color: activeColor }}>{avg.toFixed(1)}단계</span>
                    <span className="text-slate-500 font-medium"> ({levelLabel})</span>
                  </h3>
                  {breakdown && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {avgLabel} {breakdown.weightedAvg.toFixed(2)}/5 · 총 {breakdown.total}문항
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowDiffModal(false)}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label="닫기"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-sm leading-relaxed text-slate-700">
                <p>
                  AI가 시험지의 모든 문항을 <strong>1~5단계</strong> (1=기본 · 2=표준 · 3=응용 · 4=심화 · 5=최고난도) 로 분류한 뒤, 각 문항에 <strong>배점</strong>과 <strong>난이도별 영향력 가중치</strong>(3단계 2배 · 4단계 5배 · 5단계 10배)를 함께 곱해 가중평균을 냅니다. 어려운 문항일수록 종합 난이도를 강하게 끌어올립니다 — 변별 문항이 시험의 체감 난이도를 좌우하기 때문입니다. (배점이 인식되지 않으면 영향력 가중치만 적용)
                </p>
                {breakdown && (
                  <div>
                    {/* 연속축 수직선 — 보정 전(AI)/후 위치를 정확히 표시 */}
                    <div className="px-3 pt-1 pb-2">
                      <DifficultyNumberLine avg={avg} aiAvg={aiAvg} zoneLabels />
                    </div>
                    <p className="mb-2 text-center text-[13px]">
                      {hasShift ? (
                        <>
                          AI 분석 <strong className="text-slate-400 line-through">{aiAvg.toFixed(1)}</strong>
                          <span className="mx-1 text-slate-400">→</span>
                          선생님 교정 후 <strong style={{ color: activeColor }}>{avg.toFixed(1)}단계</strong>
                          <span className="text-slate-400"> ({diffCorrections.length}건 반영)</span>
                        </>
                      ) : (
                        <>{avgLabel} <strong style={{ color: activeColor }}>{avg.toFixed(2)}</strong> / 5단계</>
                      )}
                    </p>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">난이도별 문항 분포</p>
                    <div className="rounded-sm border border-slate-100 overflow-hidden">
                      {[1, 2, 3, 4, 5].map((lv) => {
                        const c = breakdown.counts[lv - 1] ?? 0;
                        return (
                          <div key={lv} className={`flex items-center justify-between px-2.5 py-1 text-xs ${lv > 1 ? 'border-t border-slate-50' : ''}`}>
                            <span className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-sm flex items-center justify-center text-[11px] font-bold text-white" style={{ backgroundColor: interpolateDifficultyColor(lv) }}>{lv}</span>
                              <span className="text-slate-600">{DIFF_LEVEL_LABELS[lv]}</span>
                            </span>
                            <span className="font-semibold text-slate-700">{c}문항</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {diffCorrections.length > 0 && (
                  <div className="rounded-sm bg-primary/5 border border-primary/10 p-2.5">
                    <p className="text-xs font-semibold text-primary mb-1.5">✎ 선생님 난이도 보정 {diffCorrections.length}건 반영됨</p>
                    <div className="flex flex-wrap gap-1.5">
                      {diffCorrections.map((c) => (
                        <span key={String(c.num)} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-white border border-slate-200 text-[11px]">
                          <span className="font-semibold text-slate-700">{c.num}번</span>
                          <span className="text-slate-400 line-through">{c.ai}</span>
                          <span className="text-slate-300">→</span>
                          <span className="font-bold" style={{ color: interpolateDifficultyColor(Number(c.teacher)) }}>{c.teacher}</span>
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">AI 원본 난이도를 선생님이 직접 교정한 문항입니다. 종합 난이도는 교정값 기준으로 재계산됩니다.</p>
                  </div>
                )}
                <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                  평균 2.5점 미만은 평이한 시험(Lv 1~2), 3.5점 이상은 변별력이 높은 시험(Lv 4~5)으로 봅니다. 4·5단계 문항 비율이 높을수록 상위권 변별 의도가 강한 시험입니다.
                </p>
              </div>

              <div className="mt-4 flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => setShowDiffModal(false)}>닫기</Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
