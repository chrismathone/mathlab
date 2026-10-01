'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles, FileText, X, Copy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/Toast';
import { EnglishAnalysisResultView } from '@/components/exam-analysis/english/AnalysisResultView';
import { EnglishAnalysisCommentTab } from '@/components/exam-analysis/english/AnalysisCommentTab';
import { EnglishStudyStrategyTab } from '@/components/exam-analysis/EnglishStudyStrategyTab';
import { useAuth, hasRoleClient } from '@/hooks/useAuth';
import { useSubscription } from '@/components/providers/SubscriptionProvider';
import type { AnalysisSummary } from '@/lib/exam-analysis/types';
import type { CommentaryResult } from '@/lib/exam-analysis/agents/commentary-agent';
import { DIFFICULTY_BAR_COLORS, isStalePromptVersion, extractPromptVersion, CURRENT_PROMPT_VERSION } from '@/lib/exam-analysis/constants';
import { toUserFacingError } from '@/lib/exam-analysis/shared/error-message';
import { checkAnalysisReadiness } from '@/lib/exam-analysis/readiness';
import { koImg } from '@/lib/exam-analysis/section-blocks';
import { getDemoNaverBlocks } from '@/lib/demo/naver-blocks';
import { isDemoExamId } from '@/lib/demo/util';
import type { ExamPaperData, AnalysisTab } from '../types';
import { getConfidenceInfo, getOverallDifficultyLevel, getDifficultyBreakdown, interpolateDifficultyColor } from '../helpers';
import { weightedAverageDifficulty } from '@/lib/exam-analysis/difficulty';
import { ENGLISH_STUDY_AGENT } from '@/lib/exam-analysis/english-study-pack';
import { DIFF_LEVEL_LABELS } from '../constants';
import { CommentarySection } from '../CommentarySection';
import { AnalyzingProgress } from '../AnalyzingProgress';
import { buildNaverV3Html } from '@/lib/exam-analysis/naver-v3-renderer';
import { buildNaverV4Html } from '@/lib/exam-analysis/naver-v4-renderer';
import { sumPoints } from '@/lib/exam-analysis/points';
import { buildNaverCaptureSig, NAVER_CAPTURE_VERSION } from '@/lib/exam-analysis/naver-capture-sig';
import { COMMENTARY_BLOCKS, clipCaption } from '../v3/blocks/registry';
import { readExamRound } from '@/lib/exam-analysis/shared/exam-round';
import { ExamStatsPanel } from '@/components/exam-analysis/ExamStatsPanel';

const ArticleEditorModal = dynamic(
  () => import('@/components/exam-analysis/ArticleEditorModal').then((m) => ({ default: m.ArticleEditorModal })),
  { ssr: false },
);

// V3 강화 (2026-05-29): V4 콘텐츠를 V3에 흡수 → [V4 네이버 복사] 버튼 비활성화.
// handleCopyV4Naver + buildNaverV4Html 코드는 보존 (재활성 시 true로).
const V4_NAVER_COPY_ENABLED = false;

// V3 일원화 (2026-05-29): 기존 V2 "기출 분석 글 작성"(ArticleEditorModal — 차트 블로그 글) 비활성화.
// V3 총평 + [네이버 복사]로 일원화. ArticleEditorModal/article-generator 코드는 보존(MD 문서 백업).
const V2_ARTICLE_ENABLED = false;

// 캡처 캐시 버전·시그니처 조립은 naver-capture-sig.ts (v4). 여기 TTL 만 둔다.
// 클라 캐시 유효기간 — 서버 cleanup(3일)과 동일. 만료 시 재캡처(서버가 이미 지웠을 수 있어 죽은 URL 재사용 방지).
const NAVER_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** el 내부 모든 <img>가 로드될 때까지 대기 (최대 timeoutMs). 자동 펼침 직후 차트 PNG 누락 캡처 방지. */
function waitForImages(el: HTMLElement, timeoutMs: number): Promise<void> {
  const pending = (Array.from(el.querySelectorAll('img')) as HTMLImageElement[])
    .filter((img) => !img.complete || img.naturalWidth === 0);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map((img) => new Promise<void>((res) => {
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => res(), { once: true });
    }))).then(() => undefined),
    new Promise<void>((res) => setTimeout(res, timeoutMs)),
  ]);
}

/**
 * 캡처 backdrop 색 — 섹션 자신이 투명이면 불투명 조상까지 거슬러 올라간다.
 * 다크 톤은 `.v3` 루트에만 배경이 있고 자식은 투명인 경우가 있어, 자식만 보면 흰 바탕에 밝은 글자가 찍힌다.
 */
function nearestOpaqueBackground(el: HTMLElement): string {
  let cur: HTMLElement | null = el;
  while (cur) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    cur = cur.parentElement;
  }
  return '#ffffff';
}

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

export function EnglishAnalysisDetail({ detail, analyzing, onAnalyze, onRefresh, gen = null, onCommentaryGenChange }: AnalysisDetailProps) {
  const { user } = useAuth();
  const { demo } = useSubscription();
  const [activeTab, setActiveTab] = useState<AnalysisTab>('basic');
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const copyingRef = useRef(false);              // 네이버 이미지 복사 진행 중 재진입(다중 클릭) 차단 — 즉시 동작하는 잠금
  const [copying, setCopying] = useState(false);  // 버튼 disabled 시각 표시용
  // 총평 생성 중인 시험지 추적 (examId → 시작 ms). 시험지 전환에도 살아남도록 Record로 보관.
  // AnalysisDetail은 시험지 전환 시 unmount되지 않으므로(key 없음) 진행 상태가 유지됨 →
  // 다른 시험지 봤다가 돌아와도 진행바 복원. fetch promise도 계속 진행되어 생성은 멈추지 않음.
  const [commentaryGen, setCommentaryGen] = useState<Record<string, number>>({});
  const [commentaryElapsed, setCommentaryElapsed] = useState(0);
  // 총평 생성 실시간 로그 — analyze-extended는 비스트리밍이라 경과시간 기준 마일스톤 메시지(V4/재분석과 동일 패턴)
  const [commentaryLogs, setCommentaryLogs] = useState<Array<{ time: string; msg: string }>>([]);
  // 외부(page.tsx 자동 체인) 생성 단계 — gen.phase로 metadata/commentary 분기.
  const metadataStartedAt = gen?.phase === 'metadata' ? gen.startMs : null;
  const externalCommentaryStartedAt = gen?.phase === 'commentary' ? gen.startMs : null;
  const metadataWillChain = !!gen?.willChain;
  const metadataPending = metadataStartedAt !== null;
  const [metadataElapsed, setMetadataElapsed] = useState(0);
  // 총평 진행 = 수동 버튼(commentaryGen) 또는 자동 체인(externalCommentaryStartedAt) 중 활성인 것.
  const genStartedAt = commentaryGen[detail.id] ?? externalCommentaryStartedAt ?? null;
  const commentaryLoading = genStartedAt !== null;
  const [includeNearby, setIncludeNearby] = useState(true);
  const [includeYearCompare, setIncludeYearCompare] = useState(true);
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);
  const [yearCount, setYearCount] = useState<number | null>(null);
  const [nearbySchools, setNearbySchools] = useState<string[]>([]); // hover 표시용 학교명
  const [years, setYears] = useState<string[]>([]); // hover 표시용 비교 연도

  // 주변/연도 기출 건수 + 목록 조회 (주변비교는 Pro+ 기능 — free면 호출 단락 + 403 스팸 방지)
  useEffect(() => {
    setNearbyCount(0);
    setYearCount(0);
    setNearbySchools([]);
    setYears([]);
  }, [detail.id]);

  // hover tooltip 문구
  const nearbyTitle = nearbySchools.length ? `포함 학교: ${nearbySchools.join(', ')}` : '같은 지역 동일 시기 기출이 없습니다';
  const yearTitle = years.length ? `비교 연도: ${years.map(y => `${y}년`).join(', ')}` : '같은 학교 다른 연도 기출이 없습니다';

  // 기출지 변경 시 탭 초기화 + 열린 모달 닫기 (모달이 이전 시험지 데이터로 남는 누수 방지).
  // 단, 총평 생성 상태(commentaryGen)는 리셋하지 않음 → 시험지 전환 후 돌아와도 진행바 유지
  // (해당 시험지가 commentaryGen에 있으면 자동 표시. 시험지별 격리는 Record 키로 보장).
  useEffect(() => {
    setActiveTab('basic');
    setShowArticleModal(false);
    setShowDiffModal(false);
  }, [detail.id]);

  // 총평 생성 경과 시간 타이머 — 현재 시험지의 생성 시작 시각(genStartedAt) 기준
  useEffect(() => {
    if (genStartedAt === null) {
      setCommentaryElapsed(0);
      return;
    }
    // 즉시 1회 반영 (전환 복귀 시 0→실제값 점프 최소화)
    setCommentaryElapsed(Math.floor((Date.now() - genStartedAt) / 1000));
    const interval = setInterval(() => {
      setCommentaryElapsed(Math.floor((Date.now() - genStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [genStartedAt]);

  // 총평 생성 마일스톤 로그 — 경과시간이 임계치를 넘을 때마다 단계 메시지 추가 (실제 진행을 모사)
  useEffect(() => {
    if (!commentaryLoading) { setCommentaryLogs([]); return; }
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const milestones: Array<{ at: number; msg: string }> = [
      { at: 1, msg: 'AI 분석 호출 시작' },
      { at: 6, msg: '시험 메타 + 문항별 난이도·단원 입력 중' },
      { at: 14, msg: '종합 평가 + 강·약점 분석 중' },
      { at: 26, msg: '주변 학교 · 작년 시험 비교 분석 중' },
      { at: 40, msg: 'V3 매거진 필드 생성 중 (헤드라인 · Q&A 인터뷰)' },
      { at: 56, msg: '등급컷 추정 · 단원별 성취 분석 중' },
      { at: 74, msg: '킬러 문항 맵 · 학습 전략 작성 중' },
      { at: 94, msg: 'JSON 응답 정규화 (영문 enum·수식 보정) 중' },
      { at: 115, msg: '거의 완료 — DB 저장 중' },
    ];
    setCommentaryLogs((prev) => {
      const toAdd = milestones.filter((m) => commentaryElapsed >= m.at && !prev.some((l) => l.msg === m.msg));
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd.map((m) => ({ time: stamp, msg: m.msg }))];
    });
  }, [commentaryLoading, commentaryElapsed]);

  // 메타데이터(V3 총평 준비) 경과 시간 타이머 — 프로그레스 바용
  useEffect(() => {
    if (metadataStartedAt === null) {
      setMetadataElapsed(0);
      return;
    }
    setMetadataElapsed(Math.floor((Date.now() - metadataStartedAt) / 1000));
    const interval = setInterval(() => {
      setMetadataElapsed(Math.floor((Date.now() - metadataStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [metadataStartedAt]);

  const latestAnalysis = detail.analyses?.[0];
  // 선생님 난이도 교정 오버레이 — 수정 즉시 종합 난이도 재계산 (서버 저장은 PATCH 가 별도 처리)
  const [diffEdits, setDiffEdits] = useState<Record<string, { difficulty: string; ai_difficulty: string | null }>>({});
  // 분석본 전환 시 오버레이 초기화
  useEffect(() => { setDiffEdits({}); }, [latestAnalysis?.id]);
  const questions = useMemo(() =>
    (latestAnalysis?.questions || []).map((q) => {
      const e = diffEdits[String(q.question_number)];
      return e ? { ...q, difficulty: e.difficulty, ai_difficulty: e.ai_difficulty, manually_edited: true } : q;
    }),
  [latestAnalysis?.questions, diffEdits]);
  const summary = (latestAnalysis?.summary || null) as AnalysisSummary | null;
  const totalPoints = latestAnalysis?.totalPoints;

  const confidenceInfo = useMemo(() => getConfidenceInfo(questions), [questions]);
  const diffLevel = useMemo(() => getOverallDifficultyLevel(summary, questions), [summary, questions]);

  // 총평 생성 사전 차단 — 문항 누락 / 배점 합계 불일치 / 배점·단원 미완성
  // ⚠️ 판정 로직은 page.tsx(자동 체인)와 공유해야 한다 — 복제하면 한쪽만 고쳐져 드리프트한다
  const readinessCheck = useMemo(
    () => checkAnalysisReadiness({ questions, totalPoints, summary }),
    [questions, totalPoints, summary],
  );
  // 문항 누락은 전용 배너(재분석 유도)가 따로 안내 — 인라인 편집으로 고칠 수 있는 사유만 남긴다
  const editableReasons = readinessCheck.fixableReasons;

  // 총평 데이터: extensions에서 commentary 에이전트 결과 추출
  const commentaryExt = latestAnalysis?.extensions?.find(e => e.agentType === 'commentary');
  const commentary = (commentaryExt?.result as unknown as CommentaryResult) ?? null;
  const englishStudyExt = latestAnalysis?.extensions?.find((e) => e.agentType === ENGLISH_STUDY_AGENT);

  // V3 메타데이터(base scaffolding) 준비 상태 — 분석 직후 백그라운드 생성됨 (DB 전용, 화면 비노출).
  // metadataPending(= gen.phase==='metadata')은 위에서 gen으로부터 파생. 클라이언트 신호로만 판단해
  // 기존 분석본(메타데이터 없음)이 영구 차단되지 않도록 함(폴백 총평 동작).

  // 구버전(이전 PROMPT_VERSION) 분석본 — 총평을 구버전 분석 데이터로 생성하면 품질 불일치.
  // → 총평 생성/재생성을 사전 차단하고 재분석을 유도한다 (사용자 요청 2026-05-30).
  const isStaleAnalysis = isStalePromptVersion(latestAnalysis?.modelVersion, 'ENGLISH');
  const stalePromptLabel = extractPromptVersion(latestAnalysis?.modelVersion);
  const isSuperAdmin = hasRoleClient(user?.role, 'SUPER_ADMIN');

  // 영어 총평은 아직 일반 계정 준비 중, 슈퍼만 생성.
  const commentaryLocked = !isSuperAdmin;

  // 데모 계정 체험 게이트 — 분석 잔여/권한, 블로그(네이버 복사) 권한
  const demoAcct = demo && demo.isDemo ? demo : null;
  const analyzeBlocked = !!demoAcct && (!demoAcct.perms.analyze || demoAcct.remaining <= 0);
  const analyzeBlockReason = !demoAcct
    ? undefined
    : !demoAcct.perms.analyze
      ? '이 데모 계정은 기출분석 체험 권한이 없습니다'
      : demoAcct.remaining <= 0
        ? `데모 체험 횟수(${demoAcct.limit}회)를 모두 사용했습니다`
        : undefined;
  const blogDenied = !!demoAcct && !demoAcct.perms.blog;
  // 총평 잠금 안내 — 데모면 권한 안내, 그 외는 Pro 업그레이드 안내
  const commentaryLockMsg = '영어 총평은 준비 중입니다';

  // 총평 생성 가능 = readiness 통과 + 메타데이터 준비 중 아님 + 구버전 아님 + 플랜 잠김 아님
  const commentaryReady = readinessCheck.ready && !metadataPending && !isStaleAnalysis && !commentaryLocked;

  const handleGenerateCommentary = async () => {
    if (!latestAnalysis) return;
    // Pro+ 플랜 기능 잠금 (서버에서도 403 FEATURE_LOCKED 방어)
    if (commentaryLocked) {
      toast.error(commentaryLockMsg);
      return;
    }
    // 구버전 분석본 차단 — 재분석 후에만 총평 생성 가능 (모든 진입점 방어: 버튼/재생성)
    if (isStaleAnalysis) {
      toast.error(`이전 버전(${stalePromptLabel || '구버전'})으로 분석된 시험지입니다. 먼저 [재분석]으로 최신 분석 후 총평을 생성하세요.`);
      return;
    }
    const startId = detail.id;
    // 생성 시작 — commentaryGen에 등록 (시험지 전환에도 유지). fetch는 계속 진행됨.
    setCommentaryGen((p) => ({ ...p, [startId]: Date.now() }));
    onCommentaryGenChange?.(startId, true); // 사이드바 배지 "총평 생성중"
    try {
      const res = await fetch(`/api/exam-analysis/${startId}/analyze-extended`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: ['commentary'], forceRegenerate: !!commentary, includeNearby, includeYearCompare }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error?.message || (res.status === 403 ? commentaryLockMsg : '총평지 생성에 실패했습니다'));
        return;
      }
      // 다른 시험지로 갔어도 완료 토스트는 표시 (생성이 멈추지 않았음을 알림).
      toast.success('총평이 생성되었습니다');
      // 현재 보고 있는 시험지면 즉시 갱신. 다른 시험지면 돌아올 때 page selection 효과가 자동 재조회.
      onRefresh();
    } catch {
      toast.error('총평지 생성 중 오류가 발생했습니다');
    } finally {
      // 이 시험지 생성 종료 — Record에서 제거 (동시에 다른 시험지 생성 중이면 그건 유지)
      setCommentaryGen((p) => {
        const n = { ...p };
        delete n[startId];
        return n;
      });
      onCommentaryGenChange?.(startId, false); // 배지 해제 + 목록 갱신(총평완료)
    }
  };

  /**
   * V3 시안 (Q&A 인터뷰) HTML을 RichText로 클립보드 복사 — 네이버 블로그 본문에 그대로 붙여넣기.
   *
   * 차트 PNG 통합 (2026-05-27):
   * - 차트는 V2 [기출 분석 글 작성]을 한 번이라도 누른 분석본에서만 사용 가능 (DB의 blog-article extension에 저장됨).
   * - HEAD 요청으로 chart endpoint 존재 확인 → 있으면 absolute URL로 buildNaverV3Html에 전달.
   * - 없으면 차트 없이 진행 + toast로 안내.
   */
  // dormant — [네이버 복사(서식)] 버튼 제거(2026-05-30). 네이버 이미지 복사로 일원화. 재활성 시 _ 제거.
  const _handleCopyV3Naver = async () => {
    if (!commentary || !commentary.blog_qa?.length) {
      toast.error('V3 데이터가 없습니다. 총평 재생성 후 다시 시도하세요.');
      return;
    }
    const tid = toast.loading('차트 이미지 생성 중... (최초 30~60초)');
    try {
      // 차트 PNG 미리 워밍업 + URL 수집 (lazy 생성 트리거)
      // ⚠️ 첫 호출은 serial로 — 4개 병렬 호출 시 각각 generateAllChartImages를 독립 실행 (4× 작업)
      // 첫 호출(difficulty) 완료 후 DB에 4종 캐시됨 → 나머지 3개 병렬은 cache hit으로 즉시.
      const baseUrl = window.location.origin;
      const chartUrls: { topicBar?: string; discrimination?: string; difficulty?: string; abilityRadar?: string } = {};
      const tryFetch = async (
        type: 'topic-bar' | 'discrimination' | 'difficulty' | 'ability-radar',
        key: 'topicBar' | 'discrimination' | 'difficulty' | 'abilityRadar',
      ) => {
        try {
          // ?v=v2 — 차트 버전 bump 시 새 PNG로 강제 갱신 (browser/Naver CDN 캐시 우회)
          const r = await fetch(`/api/exam-analysis/${detail.id}/chart/${type}?v=v2`);
          if (r.ok) chartUrls[key] = `${baseUrl}/api/exam-analysis/${detail.id}/chart/${type}?v=v2`;
        } catch { /* 차트 없음 — 무시 */ }
      };
      // 1단계: 첫 차트 단독 호출 — 4종 일괄 생성 + DB 저장
      await tryFetch('difficulty', 'difficulty');
      // 2단계: 나머지 3개 병렬 — DB cache hit으로 즉시
      await Promise.all([
        tryFetch('topic-bar', 'topicBar'),
        tryFetch('discrimination', 'discrimination'),
        tryFetch('ability-radar', 'abilityRadar'),
      ]);
      const hasCharts = Object.keys(chartUrls).length > 0;

      const html = buildNaverV3Html({
        commentary,
        questions,
        chartUrls: hasCharts ? chartUrls : undefined,
        meta: {
          examTitle: detail.title,
          grade: detail.grade,
          schoolName: detail.schoolName ?? null,
          analyzedAt: latestAnalysis?.analyzedAt ?? null,
        },
      });
      // RichText 복사 — V2 prepareForNaver 패턴 차용 (element별 inline style 강제)
      const container = document.createElement('div');
      container.innerHTML = html;
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.style.width = '720px';
      container.style.fontFamily = '"NanumGothic", "나눔고딕", "맑은 고딕", "Noto Serif KR", sans-serif';
      container.style.fontSize = '15px';
      container.style.fontWeight = 'normal';
      container.style.lineHeight = '1.7';
      container.style.color = '#333';
      container.style.textAlign = 'left';
      document.body.appendChild(container);

      // V2 패턴: element별 inline style 강제 (네이버가 컨테이너 스타일 무시)
      container.querySelectorAll('p, h2, h3, td, th, div, span').forEach((el) => {
        const blockEl = el as HTMLElement;
        if (!blockEl.style.textAlign) blockEl.style.textAlign = 'left';
      });
      container.querySelectorAll('table').forEach((tbl) => {
        const tableEl = tbl as HTMLTableElement;
        if (!tableEl.style.tableLayout) tableEl.style.tableLayout = 'fixed';
        if (!tableEl.style.borderCollapse) tableEl.style.borderCollapse = 'collapse';
      });
      container.querySelectorAll('td, th').forEach((el) => {
        const cellEl = el as HTMLElement;
        if (!cellEl.style.wordBreak) cellEl.style.wordBreak = 'keep-all';
      });

      try {
        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const ok = document.execCommand('copy');
        selection?.removeAllRanges();
        if (!ok) throw new Error('execCommand copy 실패');
        toast.success(
          hasCharts
            ? '총평이 클립보드에 복사되었습니다 (차트 포함). 네이버 블로그에 붙여넣으세요.'
            : '총평이 클립보드에 복사되었습니다. 네이버 블로그에 붙여넣으세요.',
          undefined,
          tid,
        );
      } finally {
        document.body.removeChild(container);
      }
    } catch (e) {
      toast.error('복사 실패: ' + (e instanceof Error ? e.message : String(e)), undefined, tid);
    }
  };

  /**
   * 네이버 "이미지 복사" — 실제 V3 화면(.v3)을 섹션별로 그대로 캡처(modern-screenshot) →
   * Supabase 업로드(공개 URL) → [이미지][핵심요약] 순으로 클립보드 복사.
   * 네이버가 매거진 HTML을 뭉개는 한계를 "실화면 이미지"로 우회 + 요약 텍스트로 검색 노출(이중첨부).
   */
  const handleCopyNaverImages = async () => {
    if (!commentary) { toast.error('총평이 없습니다. 먼저 총평을 생성하세요.'); return; }
    if (blogDenied) { toast.error('이 데모 계정은 블로그(네이버 복사) 체험 권한이 없습니다. 관리자에게 문의하세요.'); return; }
    // 다중 클릭 차단 — 캡처/업로드가 진행 중이면 추가 클릭 무시 (병렬 실행 방지)
    if (copyingRef.current) { toast.info('이미 복사 중입니다. 완료 후 다시 시도하세요.'); return; }
    copyingRef.current = true;
    setCopying(true);
    // .v3 폴링 — 헤더 버튼이 접힌 상태에서 자동으로 펼치므로, 매거진(.v3)이 마운트될 때까지 최대 ~2.5s 대기
    let root: HTMLElement | null = null;
    for (let i = 0; i < 25; i++) {
      root = document.querySelector('.v3') as HTMLElement | null;
      if (root) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!root) {
      toast.error('총평 매거진을 찾을 수 없습니다. 다시 시도해 주세요.');
      copyingRef.current = false;
      setCopying(false);
      return;
    }
    // 자동 펼침 직후 차트 이미지가 미로드면 빈 차트로 캡처됨 → 이미지 로드 완료 대기 (최대 4s)
    await waitForImages(root, 4000);
    // 서체 로딩 대기 — 레이아웃(골격)마다 다른 웹폰트를 쓰고 preload 를 끈 것도 있어서,
    // 기다리지 않으면 첫 캡처가 폴백 서체로 찍혀 블로그 이미지의 활자가 화면과 달라진다.
    // 폰트가 영영 안 오는 경우를 대비해 3초에서 끊는다(폴백 서체로라도 캡처하는 편이 낫다).
    try {
      await Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch { /* fonts API 미지원 브라우저 — 그대로 진행 */ }
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const summaryOf = (node: HTMLElement): string => {
      // 1순위: 블록 레지스트리가 심어 둔 의도된 요약 (v3/blocks/registry.tsx::blockAttrs).
      //   블로그 본문에 실제 텍스트로 들어가 검색 노출을 담당하므로, 블록이 스스로 문장을 정하는 편이 정확하다.
      const declared = node.dataset?.blockSummary?.trim();
      if (declared) return clipCaption(koImg(declared));
      // 2순위: DOM 휴리스틱 — 별도 컴포넌트가 루트를 만드는 블록(Q&A·피처 등)용 폴백.
      const heading = (node.querySelector('h1,h2,h3,h4,.v3-section-sub') as HTMLElement | null)?.innerText?.trim() || '';
      const para = (node.querySelector('p') as HTMLElement | null)?.innerText?.trim() || '';
      const firstSentence = para.split(/(?<=[.?!。])\s/)[0] || '';
      const merged = [heading, firstSentence].filter(Boolean).join(' — ');
      return clipCaption(koImg(merged));
    };
    const DISPLAY_W = 720; // 네이버 문서너비 표시 폭 (옆트임은 paste로 강제 불가 — 사용자가 네이버에서 수동 적용)

    // 내용 시그니처 — 총평/문항/지면 메타가 그대로면 재캡처·재업로드 없이 저장된 URL을 재사용.
    //   조립은 naver-capture-sig.ts (문항 PATCH 필드 전수 + BlockMeta + 레지스트리 구조).
    // 레이아웃 시그니처 — 모듈식 템플릿(테마·블록 순서/표시/variant)이 바뀌면 캡처를 다시 떠야 한다.
    //   템플릿 state 를 prop 으로 끌어오는 대신 **실제 렌더된 DOM**에서 뽑는다:
    //   캡처 대상이 곧 이 DOM 이므로 어떤 경로로 바뀌었든 항상 정확하다.
    //   data-template-signature 가 variant 까지 담는다. data-block-id 만으로는 표현 전환이 안 잡혀
    //   3일 캐시가 옛 이미지를 재사용했다. 구버전 DOM 은 빈 문자열로 폴백.
    const layoutSig = `${root.className}|${root.getAttribute('data-template-signature') ?? ''}|${Array.from(root.children)
      .map((el) => el.getAttribute('data-block-id') || el.className)
      .join(',')}`;
    const sig = buildNaverCaptureSig({
      commentary,
      questions,
      meta: {
        examTitle: detail.title || '',
        schoolName: detail.schoolName ?? null,
        grade: detail.grade || '',
        analyzedAt: latestAnalysis?.analyzedAt ?? null,
        totalQuestions: questions.length,
        totalPoints: sumPoints(questions.map((q) => q.points)),
      },
      layoutSig,
      registryBlocks: COMMENTARY_BLOCKS,
      version: NAVER_CAPTURE_VERSION,
    });
    const isDemo = isDemoExamId(detail.id);
    const cacheKey = `mathlab_naver_sec_${detail.id}_std`;
    let blocks: { url: string; summary: string }[] = [];
    if (!isDemo) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null') as { sig?: string; savedAt?: number; blocks?: { url: string; summary: string }[] } | null;
        // sig 일치 + 3일 이내(서버 cleanup TTL과 동일)일 때만 재사용. 만료/불일치면 재캡처.
        const fresh = cached?.savedAt != null && (Date.now() - cached.savedAt) < NAVER_CACHE_TTL_MS;
        if (cached && fresh && cached.sig === sig && Array.isArray(cached.blocks) && cached.blocks.length) blocks = cached.blocks;
      } catch { /* 캐시 파싱 실패 → 새로 캡처 */ }
    }

    const reused = blocks.length > 0;
    let captureComplete = true; // 캡처 누락 없이 전부 잡혔는지 — 부분 캡처면 캐시하지 않는다
    let failedSections = 0; // 캡처/업로드 실패 구간 — 침묵하면 붙여넣은 뒤에야 빈 자리를 안다
    const tid = toast.loading(reused ? '저장된 캡처 재사용 — 복사 준비 중...' : '실제 V3 화면 캡처·업로드 준비 중...');
    try {
      // 데모 — 사전 베이크된 열화 캡처(정적 자산) 사용. 실시간 캡처·업로드를 생략해
      // user-gesture/포커스 만료와 data URL 대용량(네이버 5MB 제한) 문제를 회피하고,
      // 진행 토스트로 실제와 같은 진행감만 연출한다 (실제 플로우와 동일한 "URL 목록" 페이로드).
      if (isDemo) {
        const demoList = getDemoNaverBlocks(detail.grade);
        for (let i = 1; i <= demoList.length; i++) {
          toast.loading('섹션 캡처·업로드 중...', tid, { current: i, total: demoList.length });
          await new Promise((r) => setTimeout(r, 280));
        }
        blocks = demoList.map((b) => ({ url: `${window.location.origin}${b.path}`, summary: b.summary }));
      }
      if (!reused && !isDemo) {
        const { domToPng } = await import('modern-screenshot');
        // V3 최상위 블록 모두 캡처 (header/kpi-row(div)/section들/conclusion(div)). footer(credits)·초소형 제외.
        const nodes = (Array.from(root.children) as HTMLElement[])
          .filter((el) => el.tagName.toLowerCase() !== 'footer' && el.offsetHeight >= 24);
        let i = 0;
        for (const node of nodes) {
          i += 1;
          toast.loading('섹션 캡처·업로드 중...', tid, { current: i, total: nodes.length });
          let dataUrl: string;
          try {
            // 섹션(또는 가장 가까운 불투명 조상)의 배경색을 backdrop으로 전달 —
            // 자식이 투명하고 .v3 루트만 어두우면 흰 바탕에 밝은 글자가 찍혀 사라지는 걸 막는다.
            const backgroundColor = nearestOpaqueBackground(node);
            dataUrl = await domToPng(node, {
              scale: 2,
              backgroundColor,
              // 브라우저 확장 프로그램이 주입한 floating 오버레이("AI 활용 설정" 토글 등) 제외.
              // V3 섹션 콘텐츠는 모두 정상 흐름(in-flow)이라 fixed 요소가 없음 → 안전.
              filter: (el: Node) => {
                if (el instanceof HTMLElement) {
                  if (getComputedStyle(el).position === 'fixed') return false;
                  if (el.hasAttribute('data-html2canvas-ignore')) return false;
                }
                return true;
              },
            });
          } catch (e) {
            // 한 구간 실패가 전체 복사를 막지 않게 건너뛰되, 침묵하면 블로그에서 빈 자리를 나중에야 안다
            failedSections += 1;
            console.warn('[블로그 이미지] 섹션 캡처 실패', e);
            continue;
          }
          try {
            const res = await fetch(`/api/exam-analysis/${detail.id}/upload-section-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ section: `std_s${i}`, dataUrl }),
            });
            if (!res.ok) {
              failedSections += 1;
              console.warn('[블로그 이미지] 섹션 업로드 실패', res.status);
              continue;
            }
            const json = await res.json();
            if (json?.data?.url) blocks.push({ url: json.data.url, summary: summaryOf(node) });
            else {
              failedSections += 1;
              console.warn('[블로그 이미지] 섹션 업로드 응답에 URL이 없습니다');
            }
          } catch (e) {
            failedSections += 1;
            console.warn('[블로그 이미지] 섹션 업로드 실패', e);
          }
        }
        // 캡처 끝 → 인라인 폭 제거(원래 CSS 흐름 복귀). 저장값 복원이 아니라 '' 클리어 = 동시 실행돼도 stuck 안 됨.
        root.style.width = '';
        // 모든 섹션을 빠짐없이 캡처했을 때만 캐시. 캡처 도중 화면 전환/클릭으로 .v3 가 떨어져
        // 일부만 잡히면(중단) 캐시하지 않아, 다음 복사에서 전체를 다시 캡처한다(부분 캡처가 굳는 버그 방지).
        captureComplete = nodes.length > 0 && blocks.length === nodes.length;
        try {
          if (captureComplete) localStorage.setItem(cacheKey, JSON.stringify({ sig, blocks, savedAt: Date.now() }));
          else localStorage.removeItem(cacheKey);
        } catch { /* 용량 초과 등 무시 */ }
      }
      if (!blocks.length) {
        toast.error(
          failedSections > 0
            ? `${failedSections}개 구간을 이미지로 만들지 못했습니다. 다시 시도해 주세요.`
            : '캡처/업로드된 섹션이 없습니다',
          undefined,
          tid,
        );
        return;
      }

      // 첫 이미지(상단 헤더) 캡션은 항상 "학교 연도 학기 시험종류"로 시작 (검색 노출 강화).
      //   회차는 shared/exam-round 가 examScope(Json — 신형 객체/레거시 배열/null)를
      //   정규화해 읽고, 없으면 제목에서 보충한다.
      //   ⚠️ 예전엔 `detail.examType` 을 MIDTERM/FINAL 로 매핑했는데, 그 필드는 실제로
      //   'blank' | 'student'(답안지 유무) 라 **항상 undefined** → 캡션에 중간/기말이
      //   한 번도 붙지 않았다. 시험종류는 examScope.examCategory 에 있다.
      const examLabel = (() => {
        const parts: string[] = [];
        if (detail.schoolName?.trim()) parts.push(detail.schoolName.trim());
        const round = readExamRound(detail);
        const tail: string[] = [];
        if (round.year) tail.push(`${round.year}년`);
        if (round.semester) tail.push(`${round.semester}학기`);
        if (round.categoryKo) tail.push(`${round.categoryKo}고사`);
        if (tail.length) parts.push(tail.join(' '));
        return koImg(parts.join(' ')).trim();
      })();

      const html = `<div style="width:${DISPLAY_W}px;max-width:100%;">${blocks.map((b, idx) => {
        const cap = idx === 0 && examLabel ? (b.summary ? `${examLabel} — ${b.summary}` : examLabel) : b.summary;
        return `<p style="text-align:center;margin:0 0 6px;"><img src="${b.url}" style="width:${DISPLAY_W}px;max-width:100%;" /></p>` +
          (cap ? `<p style="font-size:14px;color:#555;line-height:1.75;margin:0 0 30px;word-break:keep-all;">${esc(cap)}</p>` : '');
      }).join('')}</div>`;

      // 클립보드 복사 — 캡처/업로드(긴 async) 후에는 execCommand의 user-gesture가 만료돼 실패할 수 있음.
      //   → 모던 Clipboard API 우선(문서 포커스만 있으면 async 후에도 동작). 실패 시 execCommand 폴백.
      const plain = blocks.map((b) => b.summary).filter(Boolean).join('\n\n');
      let copied = false;
      if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
        try {
          if (!document.hasFocus()) window.focus();
          await navigator.clipboard.write([
            new window.ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([plain], { type: 'text/plain' }),
            }),
          ]);
          copied = true;
        } catch { /* execCommand 폴백으로 진행 */ }
      }
      if (!copied) {
        const container = document.createElement('div');
        container.innerHTML = html;
        container.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1000px;font-family:"맑은 고딕",sans-serif;color:#333;text-align:left;';
        document.body.appendChild(container);
        try {
          const range = document.createRange();
          range.selectNodeContents(container);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          copied = document.execCommand('copy');
          selection?.removeAllRanges();
        } finally {
          document.body.removeChild(container);
        }
      }
      if (!copied) throw new Error('클립보드 복사 실패 — 창을 클릭해 포커스를 둔 뒤 다시 시도하세요');
      if (failedSections > 0) {
        toast.warning(`${failedSections}개 구간을 이미지로 만들지 못했습니다. 다시 시도해 주세요.`, undefined, tid);
      } else if (captureComplete) {
        toast.success(`${blocks.length}개 섹션 이미지 + 요약이 복사되었습니다.${reused ? ' (저장된 캡처 재사용)' : ''} 네이버 블로그에 붙여넣으세요.`, undefined, tid);
      } else {
        toast.error(`일부 섹션만 캡처됐습니다(화면 전환 감지) — ${blocks.length}개만 복사됨. 화면을 그대로 둔 채 [블로그용 총평지]를 다시 누르면 전체가 캡처됩니다.`, undefined, tid);
      }
      // 복사 이벤트 기록 (강사 활동 추적 + 데모 모니터링 '복사' 카운트). fire-and-forget.
      void fetch(`/api/exam-analysis/${detail.id}/article-copy`, { method: 'POST' }).catch(() => {});
    } catch (e) {
      toast.error('블로그용 총평지 복사 실패: ' + (e instanceof Error ? e.message : String(e)), undefined, tid);
    } finally {
      root.style.width = ''; // 안전망: 에러/동시실행에도 인라인 폭 제거 (stuck 960px 방지)
      copyingRef.current = false;   // 잠금 해제 → 다시 클릭 가능
      setCopying(false);
    }
  };

  /**
   * V4 (갈수학학원 스타일) RichText 복사 → 네이버 SmartEditor 붙여넣기
   * V3와 동일 패턴, naver-v4-renderer 사용.
   */
  const handleCopyV4Naver = async () => {
    if (!commentary || !commentary.v4_exam_overview) {
      toast.error('V4 데이터가 없습니다. AI 시험 총평에서 V4 분석을 먼저 생성하세요.');
      return;
    }
    try {
      // 차트 PNG 미리 워밍업 + URL 수집 (lazy 생성 트리거)
      // ⚠️ 첫 호출은 serial로 — 병렬 시 각 요청이 generateAllChartImages를 독립 실행 (4× 작업).
      // 첫 호출(difficulty) 완료 후 DB에 4종 캐시됨 → 나머지 3개 병렬은 cache hit으로 즉시.
      const baseUrl = window.location.origin;
      toast.info('차트 이미지 생성 중... (최초 30~60초, 이후 즉시)');
      const chartUrls: { topicBar?: string; discrimination?: string; difficulty?: string; abilityRadar?: string } = {};
      const tryFetch = async (
        type: 'topic-bar' | 'discrimination' | 'difficulty' | 'ability-radar',
        key: 'topicBar' | 'discrimination' | 'difficulty' | 'abilityRadar',
      ) => {
        try {
          // ?v=v2 — 차트 버전 bump 시 새 PNG로 강제 갱신 (browser/Naver CDN 캐시 우회)
          const r = await fetch(`/api/exam-analysis/${detail.id}/chart/${type}?v=v2`);
          if (r.ok) chartUrls[key] = `${baseUrl}/api/exam-analysis/${detail.id}/chart/${type}?v=v2`;
        } catch { /* 차트 없음 무시 */ }
      };
      // 1단계: 첫 차트 단독 호출 — 4종 일괄 생성 + DB 저장
      await tryFetch('difficulty', 'difficulty');
      // 2단계: 나머지 3개 병렬 — DB cache hit으로 즉시
      await Promise.all([
        tryFetch('topic-bar', 'topicBar'),
        tryFetch('discrimination', 'discrimination'),
        tryFetch('ability-radar', 'abilityRadar'),
      ]);
      const hasCharts = Object.keys(chartUrls).length > 0;

      const html = buildNaverV4Html({
        commentary,
        chartUrls: hasCharts ? chartUrls : undefined,
        meta: {
          examTitle: detail.title,
          grade: detail.grade,
          schoolName: detail.schoolName ?? null,
          analyzedAt: latestAnalysis?.analyzedAt ?? null,
          // 학원명 — tenant.name (session에서 옴) → V4 본문 {학원명} placeholder 치환
          academyName: user?.tenantName ?? null,
          // 과목 고정 — 이 파일은 영어 전용 경로다.
          subject: 'ENGLISH',
        },
      });

      // RichText 복사 — V2 prepareForNaver 패턴 차용 (네이버가 컨테이너 스타일 무시 → element별 inline 강제)
      const container = document.createElement('div');
      container.innerHTML = html;
      // 컨테이너 기본 스타일 (V2 handleCopyRichText 동일)
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.style.width = '720px';
      container.style.fontFamily = '"NanumGothic", "나눔고딕", "맑은 고딕", "Noto Serif KR", sans-serif';
      container.style.fontSize = '15px';
      container.style.fontWeight = 'normal';
      container.style.lineHeight = '1.7';
      container.style.color = '#333';
      container.style.textAlign = 'left';
      document.body.appendChild(container);

      // V2 패턴: 네이버가 컨테이너 스타일 무시 → 개별 block 요소에 inline style 강제
      container.querySelectorAll('p, h2, h3, td, th, div, span').forEach((el) => {
        const blockEl = el as HTMLElement;
        if (!blockEl.style.textAlign) blockEl.style.textAlign = 'left';
      });
      // 모든 table에 table-layout: fixed 강제 (V3에서 학습한 네이버 호환 핵심)
      container.querySelectorAll('table').forEach((tbl) => {
        const tableEl = tbl as HTMLTableElement;
        if (!tableEl.style.tableLayout) tableEl.style.tableLayout = 'fixed';
        if (!tableEl.style.borderCollapse) tableEl.style.borderCollapse = 'collapse';
      });
      // 모든 td에 word-break: keep-all 강제 (한글 단어 분리 방지)
      container.querySelectorAll('td, th').forEach((el) => {
        const cellEl = el as HTMLElement;
        if (!cellEl.style.wordBreak) cellEl.style.wordBreak = 'keep-all';
      });

      try {
        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const ok = document.execCommand('copy');
        selection?.removeAllRanges();
        if (!ok) throw new Error('execCommand copy 실패');
        if (hasCharts) {
          toast.success('V4 시안 (차트 포함)이 클립보드에 복사되었습니다.');
        } else {
          toast.success('V4 시안이 클립보드에 복사되었습니다. (차트 추가하려면 [기출 분석 글 작성] 먼저 클릭)');
        }
      } finally {
        document.body.removeChild(container);
      }
    } catch (e) {
      toast.error('복사 실패: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

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

          {/* AI 총평 섹션 */}
          {!commentary ? (
            <div className="bg-gradient-to-br from-indigo-50 to-violet-50/60 border border-indigo-200 rounded-sm px-4 py-2.5 mb-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-[linear-gradient(100deg,#4F46E5,#7C3AED)] rounded-sm flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">AI 시험 총평</h3>
                    {!commentaryLoading && <p className="text-[11px] text-slate-500">시험 전체에 대한 전문가 수준의 종합 평가를 받아보세요</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 구버전/플랜잠김이면 상단 버튼/옵션 숨김 — 아래 배너의 CTA가 단일 진입 (버튼 중복 방지) */}
                  {!commentaryLoading && !isStaleAnalysis && !commentaryLocked && (
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary-hover text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
                      onClick={handleGenerateCommentary}
                      disabled={!commentaryReady}
                      title={
                        metadataPending
                          ? 'V3 총평 준비 중입니다 (분석 기반 데이터 생성). 잠시 후 가능합니다.'
                          : readinessCheck.ready
                          ? '총평지 생성'
                          : '먼저 다음을 완성하세요:\n' + readinessCheck.reasons.map(r => '• ' + r).join('\n')
                      }
                    >
                      {metadataPending ? '준비 중...' : '총평지 생성'}
                    </Button>
                  )}
                  {detail.schoolId && !commentaryLoading && !isStaleAnalysis && !commentaryLocked && (
                    <div className="flex items-center gap-3">
                      <label title={nearbyTitle} className={`flex items-center gap-1 text-[11px] cursor-pointer ${nearbyCount === 0 ? 'text-slate-400' : 'text-slate-500'}`}>
                        <input
                          type="checkbox"
                          checked={includeNearby && (nearbyCount ?? 0) > 0}
                          onChange={e => setIncludeNearby(e.target.checked)}
                          disabled={nearbyCount === 0}
                          className="w-3 h-3 rounded-sm border-slate-300 text-primary focus:ring-primary disabled:opacity-40"
                        />
                        주변 {nearbyCount != null && <span className={nearbyCount > 0 ? 'text-primary font-medium' : ''}>({nearbyCount}교)</span>}
                      </label>
                      <label title={yearTitle} className={`flex items-center gap-1 text-[11px] cursor-pointer ${yearCount === 0 ? 'text-slate-400' : 'text-slate-500'}`}>
                        <input
                          type="checkbox"
                          checked={includeYearCompare && (yearCount ?? 0) > 0}
                          onChange={e => setIncludeYearCompare(e.target.checked)}
                          disabled={yearCount === 0}
                          className="w-3 h-3 rounded-sm border-slate-300 text-primary focus:ring-primary disabled:opacity-40"
                        />
                        연도 {yearCount != null && <span className={yearCount > 0 ? 'text-primary font-medium' : ''}>({yearCount}건)</span>}
                      </label>
                    </div>
                  )}
                </div>
              </div>
              {/* ── 구버전 분석본 차단 (이전 PROMPT_VERSION) — 재분석 유도. 다른 경고보다 우선 ── */}
              {isStaleAnalysis && !commentaryLoading && (
                <div className="mt-3 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-sm flex items-start gap-2.5">
                  <span className="text-rose-500 text-sm mt-0.5 shrink-0">&#9888;</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-rose-800">
                      이전 버전(<b>{stalePromptLabel || '구버전'}</b>)으로 분석된 시험지입니다 — 현재 {CURRENT_PROMPT_VERSION.ENGLISH}
                    </p>
                    <p className="text-[11px] text-rose-600 mt-1 leading-relaxed">
                      구버전 분석 데이터로 총평을 생성하면 최신 난이도·단원 기준과 어긋납니다. <strong>재분석</strong>으로 최신 분석한 뒤 총평을 생성하세요.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => onAnalyze(detail.id)}
                      disabled={analyzing || analyzeBlocked}
                      title={analyzeBlockReason}
                      className="mt-2 bg-rose-600 hover:bg-rose-700 text-white disabled:bg-slate-300"
                    >
                      {analyzing ? '재분석 중...' : '최신 버전으로 재분석'}
                    </Button>
                  </div>
                </div>
              )}
              {/* ── 문항 누락 감지 — 배점·단원 수정으로 해결되지 않으므로 재분석을 유도 (구버전 다음 우선순위) ── */}
              {!isStaleAnalysis && !commentaryLoading && readinessCheck.completeness?.status === 'incomplete' && (
                <div className="mt-3 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-sm flex items-start gap-2.5">
                  <span className="text-rose-500 text-sm mt-0.5 shrink-0">&#9888;</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-rose-800">
                      {readinessCheck.completeness.pointsShortfall < 0
                        ? '분석된 배점이 시험지 만점과 맞지 않습니다'
                        : '자동 분석에서 문항이 누락되었습니다'}
                    </p>
                    <p className="text-[11px] text-rose-600 mt-1 leading-relaxed">
                      {readinessCheck.completeness.reason}
                      {readinessCheck.completeness.retried && ' (재분석 1회 후에도 동일)'}
                    </p>
                    {readinessCheck.completeness.filledQuestions > 0 && (
                      <p className="text-[11px] text-rose-600 mt-1 leading-relaxed">
                        누락된 자리에 <strong>임시 문항 {readinessCheck.completeness.filledQuestions}개</strong>를 추가해 두었습니다. 시험지와 대조해 직접 채우거나, <strong>재분석</strong>으로 다시 시도하세요.
                      </p>
                    )}
                    <Button
                      size="sm"
                      onClick={() => onAnalyze(detail.id)}
                      disabled={analyzing || analyzeBlocked}
                      title={analyzeBlockReason}
                      className="mt-2 bg-rose-600 hover:bg-rose-700 text-white disabled:bg-slate-300"
                    >
                      {analyzing ? '재분석 중...' : '재분석'}
                    </Button>
                  </div>
                </div>
              )}
              {/* ── 플랜 잠김 (AI 총평 = Pro+ 전용) — 구버전이 아닐 때, readiness보다 우선 ── */}
              {!isStaleAnalysis && commentaryLocked && !commentaryLoading && (
                <div className="mt-3 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-sm flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <>
                      <p className="text-xs font-semibold text-indigo-800">영어 총평은 준비 중입니다</p>
                      <p className="text-[11px] text-indigo-600 mt-1 leading-relaxed">
                        영어 시험 총평은 아직 열려 있지 않습니다. 문항별 분석은 아래에서 볼 수 있습니다.
                      </p>
                    </>
                  </div>
                </div>
              )}
              {/* ── 총평 생성 차단 경고 (배점/단원 미완성) — 구버전·플랜잠김이 아닐 때만 ── */}
              {!isStaleAnalysis && !commentaryLocked && editableReasons.length > 0 && !commentaryLoading && (
                <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-sm">
                  <p className="text-xs font-semibold text-amber-800 mb-1">총평지 생성 전 다음을 완성하세요:</p>
                  <ul className="text-[11px] text-amber-700 space-y-0.5 list-disc list-inside">
                    {editableReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-amber-600 mt-1.5 leading-relaxed">
                    아래 문항 테이블에서 <strong>배점은 클릭하여 직접 입력</strong>, <strong>단원은 ✏️ 아이콘으로 수정</strong> 가능합니다.
                  </p>
                </div>
              )}
              {/* ── 메타데이터 준비 중 (배점/단원 통과, V3 base 백그라운드 생성) — 시험지별 고유 프로그레스 바 ── */}
              {!isStaleAnalysis && !commentaryLocked && readinessCheck.ready && metadataPending && !commentaryLoading && (
                <div className="mt-3 px-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-indigo-700">V3 총평 준비 중...</span>
                    <span className="text-[11px] text-indigo-500 tabular-nums">{metadataElapsed}초</span>
                  </div>
                  <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand-indigo to-brand-cyan rounded-full transition-all duration-1000 ease-linear"
                      style={{ width: `${Math.min((metadataElapsed / 20) * 100, 95)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-indigo-600 mt-1.5 leading-relaxed">
                    분석 기반 데이터를 생성하고 있습니다.{' '}
                    {metadataWillChain ? '완료되면 자동으로 총평이 이어서 생성됩니다.' : '완료되면 [총평지 생성]이 활성화됩니다.'}
                  </p>
                </div>
              )}
              {commentaryLoading && (
                <div className="mt-3 px-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-indigo-700">AI 분석 중...</span>
                    <span className="text-[11px] text-indigo-500 tabular-nums">{commentaryElapsed}초</span>
                  </div>
                  <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand-indigo to-brand-cyan rounded-full transition-all duration-1000 ease-linear"
                      style={{ width: `${Math.min((commentaryElapsed / 110) * 100, 96)}%` }}
                    />
                  </div>
                  {/* 실시간 실행 로그 (분석 progress / V4 생성과 동일 디자인) — 바가 끝에 멈춰도 단계 메시지로 진행 체감 */}
                  {commentaryLogs.length > 0 && (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-indigo-800">실행 로그</span>
                        <span className="text-[10px] text-indigo-600">{commentaryLogs.length}개 항목</span>
                      </div>
                      <div className="bg-slate-900 text-slate-100 rounded-sm px-3 py-2 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed">
                        {commentaryLogs.map((entry, idx) => (
                          <div key={idx} className="flex gap-2">
                            <span className="text-slate-400 shrink-0">{entry.time}</span>
                            <span className="text-slate-100">{entry.msg}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <CommentarySection
              // 시험지별 격리 — 전환 시 remount하여 내부 상태(펼침/v4 진행·로그/viewMode)가
              // 다른 시험지로 새어나가지 않게 함. 총평 진행바(isRegenerating)는 부모의
              // 시험지별 commentaryGen에서 주입되므로 remount해도 정확히 유지됨.
              key={detail.id}
              commentary={commentary}
              questions={questions}
              onRegenerate={handleGenerateCommentary}
              isRegenerating={commentaryLoading}
              elapsedSeconds={commentaryElapsed}
              includeNearby={includeNearby}
              onIncludeNearbyChange={setIncludeNearby}
              nearbyCount={nearbyCount}
              nearbyTitle={nearbyTitle}
              includeYearCompare={includeYearCompare}
              onIncludeYearCompareChange={setIncludeYearCompare}
              yearCount={yearCount}
              yearTitle={yearTitle}
              hasSchool={false}
              staleVersion={isStaleAnalysis ? (stalePromptLabel || '구버전') : null}
              commentaryLocked={commentaryLocked}
              commentaryLockMsg={commentaryLockMsg}
              onReanalyze={() => onAnalyze(detail.id)}
              reanalyzing={analyzing}
              examMeta={{
                title: detail.title,
                subject: 'ENGLISH',
                grade: detail.grade,
                schoolName: detail.schoolName ?? null,
                analyzedAt: latestAnalysis?.analyzedAt ?? null,
              }}
              examPaperId={detail.id}
              onV4Generated={() => onRefresh()}
              onCopyImages={handleCopyNaverImages}
              copyingImages={copying}
            />
          )}

          {/* 기출 분석 글 / V4 네이버 복사 — 현재 모두 dormant(플래그 false)라 미렌더.
              네이버 이미지 복사는 "AI 시험 총평" 헤더로 이동(CommentarySection onCopyImages). */}
          {commentary && (V2_ARTICLE_ENABLED || V4_NAVER_COPY_ENABLED) && (() => {
            const hasArticle = latestAnalysis?.extensions?.some(e => e.agentType === 'blog-article');
            return (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {V2_ARTICLE_ENABLED && (
                  <Button
                    size="sm"
                    onClick={() => setShowArticleModal(true)}
                    className={hasArticle
                      ? 'bg-slate-700 hover:bg-slate-800 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
                  >
                    <FileText className="w-4 h-4 mr-1" />
                    {hasArticle ? '기출 분석 글 확인' : '기출 분석 글 작성'}
                  </Button>
                )}
                {V4_NAVER_COPY_ENABLED && commentary?.v4_exam_overview && (
                  <Button
                    size="sm"
                    onClick={handleCopyV4Naver}
                    className="bg-amber-700 hover:bg-amber-800 text-white"
                    title="V4 시안(갈수학학원 스타일 테이블 중심)을 네이버 블로그용 HTML로 클립보드에 복사"
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    V4 네이버 복사
                  </Button>
                )}
              </div>
            );
          })()}

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
      {/* 기출 분석 글 에디터 모달 */}
      {showArticleModal && (
        <ArticleEditorModal
          examPaperId={detail.id}
          schoolName={detail.schoolName}
          onClose={() => setShowArticleModal(false)}
        />
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
