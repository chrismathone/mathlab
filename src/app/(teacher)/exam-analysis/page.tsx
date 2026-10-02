'use client';

import { useState, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { ExamPaperList } from '@/components/exam-analysis/ExamPaperList';
import { ExamUploadForm } from '@/components/exam-analysis/ExamUploadForm';
import { DevCliPicker } from '@/components/exam-analysis/DevCliPicker';
import {
  ANALYZE_STUCK_BUFFER_MS,
  CLI_ANALYZE_TIMEOUT_MS,
  EXAM_CLI_STORAGE_KEY,
  GEMINI_ANALYZE_TIMEOUT_MS,
  parseCliKind,
} from '@/lib/exam-analysis/cli-kind';
import { toast } from '@/components/ui/Toast';
import Link from 'next/link';
import { Plus, X, Settings2, PanelLeftClose, PanelLeftOpen, FileSearch, Search, Gauge } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasMinRole } from '@/lib/constants/navigation';
import type { ExamPaperData } from './types';
import { AnalysisDetail } from './AnalysisDetail';
import { checkAnalysisReadiness } from '@/lib/exam-analysis/readiness';
import { readCommentaryOutcome } from '@/lib/exam-analysis/shared/commentary-outcome';
import { NarrowScreenGuard } from '@/components/ui/NarrowScreenGuard';
import { MathSpinner } from '@/components/ui/MathSpinner';
import { ProfileMenu } from '@/components/layout/ExamOnlyTopBar';
import { useSubscription, quotaExceeded } from '@/components/providers/SubscriptionProvider';

// 기출 분석 필터 — 학년 옵션 (DB grade는 한글 문자열로 저장: 중1/고1 등)
const GRADE_OPTIONS = ['중1', '중2', '중3', '고1', '고2', '고3'];

/** 학습 대책 추출 요청 — 항상 재생성. dev CLI 선택은 분석과 동일하게 따른다. */
function buildStudyRequest(): RequestInit {
  const body: Record<string, unknown> = { forceRegenerate: true };
  if (process.env.NODE_ENV === 'development') {
    try {
      const cli = parseCliKind(window.localStorage.getItem(EXAM_CLI_STORAGE_KEY));
      if (cli) body.cli = cli;
    } catch {
      /* localStorage 접근 불가 — 기본 실행기 사용 */
    }
  }
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function buildAnalyzeRequest(): RequestInit {
  if (process.env.NODE_ENV !== 'development') return { method: 'POST' };
  let cli: ReturnType<typeof parseCliKind>;
  try {
    cli = parseCliKind(window.localStorage.getItem(EXAM_CLI_STORAGE_KEY));
  } catch {
    cli = undefined;
  }
  if (!cli) return { method: 'POST' };
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cli }),
  };
}

export default function ExamAnalysisPage() {
  const { user } = useAuth();
  const isOwnerPlus = user ? hasMinRole(user.role as 'TEACHER' | 'MANAGER' | 'OWNER' | 'SUPER_ADMIN', 'OWNER') : false;
  const isManagerPlus = user ? hasMinRole(user.role as 'TEACHER' | 'MANAGER' | 'OWNER' | 'SUPER_ADMIN', 'MANAGER') : false;
  const [items, setItems] = useState<ExamPaperData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [selectedDetail, setSelectedDetail] = useState<ExamPaperData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const { usage, demo, features, refetch: refetchSub } = useSubscription();
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  // 목록 패널 너비(px) — 경계 드래그로 조절. 기본 288(=w-72), 범위 220~560. localStorage 영속.
  const LIST_MIN_W = 220, LIST_MAX_W = 560, LIST_DEFAULT_W = 288;
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_W);
  const [draggingList, setDraggingList] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem('mathlab_exam_list_w');
      if (s) setListWidth(Math.min(LIST_MAX_W, Math.max(LIST_MIN_W, Number(s) || LIST_DEFAULT_W)));
    } catch { /* noop */ }
  }, []);
  const startListResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    let latest = startW;
    setDraggingList(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(LIST_MAX_W, Math.max(LIST_MIN_W, startW + (ev.clientX - startX)));
      setListWidth(latest);
    };
    const onUp = () => {
      setDraggingList(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('mathlab_exam_list_w', String(latest)); } catch { /* noop */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [listWidth]);
  const resetListWidth = useCallback(() => {
    setListWidth(LIST_DEFAULT_W);
    try { localStorage.setItem('mathlab_exam_list_w', String(LIST_DEFAULT_W)); } catch { /* noop */ }
  }, []);
  // 분석 시 총평 자동 생성 옵션 (localStorage 기억)
  const [autoCommentary, setAutoCommentary] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAutoCommentary(localStorage.getItem('mathlab_auto_commentary') === '1');
    }
  }, []);
  const toggleAutoCommentary = useCallback((v: boolean) => {
    setAutoCommentary(v);
    if (typeof window !== 'undefined') localStorage.setItem('mathlab_auto_commentary', v ? '1' : '0');
  }, []);

  // 필터 + 검색 (API route.ts가 grade/status/search 지원 — UI만 추가)
  const [filterSubject] = useState<string>('');   // 수학 전용이라 UI 미노출 (빈 값 = 전체)
  const [filterGrade, setFilterGrade] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>(''); // 입력값(즉시)
  const [search, setSearch] = useState<string>('');           // 디바운스된 검색어(API 전송)
  // 검색어 300ms 디바운스 + 페이지 1로 리셋 (마운트 시 빈 값이라 추가 fetch 없음)
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const limit = 20;

  const fetchList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterSubject) params.set('subject', filterSubject);
      if (filterGrade) params.set('grade', filterGrade);
      if (filterStatus) params.set('status', filterStatus);
      if (search) params.set('search', search);
      const res = await fetch(`/api/exam-analysis?${params}`);
      if (!res.ok) {
        // 503/500/403 등의 응답을 빈 목록으로 삼키지 말고 사용자에게 노출
        const err = await res.json().catch(() => null);
        const code = err?.error?.code as string | undefined;
        if (!silent) {
          if (res.status === 503 || code === 'MAINTENANCE') {
            toast.warning('시스템 점검 중입니다. 잠시 후 다시 이용해 주세요');
          } else if (res.status === 403) {
            toast.error(err?.error?.message || '시험지 목록에 접근할 권한이 없습니다');
          } else {
            toast.error(err?.error?.message || '시험지 목록을 불러오지 못했습니다');
          }
        }
        setItems([]);
        setTotal(0);
        return;
      }
      const json = await res.json();
      setItems(json.data || []);
      setTotal(json.meta?.total || 0);
    } catch {
      if (!silent) toast.error('시험지 목록을 불러오지 못했습니다');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, filterSubject, filterGrade, filterStatus, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 상세 조회 (cache:'no-store' — 분석 진행 중 stale 데이터 방지)
  const fetchDetail = useCallback(async (id: string) => {
    if (selectedIdRef.current !== id) return;
    try {
      const res = await fetch(`/api/exam-analysis/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (selectedIdRef.current === id) setSelectedDetail(json.data);
    } catch {
      if (selectedIdRef.current === id) toast.error('상세 정보를 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setSelectedDetail(null);
  }, [selectedId, fetchDetail]);

  // 분석 중 자동 폴링 — ref로 함수 참조하여 interval 재생성 방지
  // selectedDetail.status도 확인 — 사이드바 items 갱신 전이라도 detail이 ANALYZING이면 polling 시작
  const hasAnalyzing = items.some(i => i.status === 'ANALYZING') || selectedDetail?.status === 'ANALYZING';
  const pollCountRef = useRef(0);
  const fetchListRef = useRef(fetchList);
  fetchListRef.current = fetchList;
  const fetchDetailRef = useRef(fetchDetail);
  fetchDetailRef.current = fetchDetail;

  useEffect(() => {
    if (!hasAnalyzing) {
      pollCountRef.current = 0;
      return;
    }

    // 개발 CLI 는 최대 22분, 운영 Gemini 는 3분 + 버퍼. 서버 stuck 복구와 맞춤.
    const pollMs = 3000;
    const capMs = process.env.NODE_ENV === 'development'
      ? CLI_ANALYZE_TIMEOUT_MS + ANALYZE_STUCK_BUFFER_MS
      : GEMINI_ANALYZE_TIMEOUT_MS + ANALYZE_STUCK_BUFFER_MS;
    const maxPolls = Math.ceil(capMs / pollMs);
    const interval = setInterval(() => {
      pollCountRef.current++;
      if (pollCountRef.current > maxPolls) {
        clearInterval(interval);
        fetchListRef.current(true);
        if (selectedIdRef.current) fetchDetailRef.current(selectedIdRef.current);
        toast.warning('분석이 시간 제한에 가깝습니다. 상태를 다시 확인합니다.');
        return;
      }
      fetchListRef.current(true);
      if (selectedIdRef.current) fetchDetailRef.current(selectedIdRef.current);
    }, pollMs);

    return () => clearInterval(interval);
  }, [hasAnalyzing]);

  // 시험지별 생성 단계 추적 — 'metadata'(V3 base 선생성) → 'commentary'(자동 총평).
  // startMs로 진행 시간 프로그레스 바 표시, willChain으로 안내 문구 분기.
  // Record 키=examId라 다른 시험지 진행과 겹치지 않음(고유 프로그레스).
  type GenPhase = { phase: 'metadata' | 'commentary' | 'englishStudy'; startMs: number; willChain: boolean };
  const [genState, setGenState] = useState<Record<string, GenPhase>>({});
  const clearGen = useCallback((id: string) => {
    setGenState((p) => { const n = { ...p }; delete n[id]; return n; });
  }, []);
  // AnalysisDetail의 수동 [총평 생성]도 사이드바 배지에 실시간 반영 (genState 통합).
  // 시작: commentary 단계 등록 → 카드 "총평 생성중". 종료: 해제 + 목록 갱신 → "총평완료".
  const handleCommentaryGenChange = useCallback((id: string, started: boolean) => {
    if (started) {
      setGenState((p) => ({ ...p, [id]: { phase: 'commentary', startMs: Date.now(), willChain: false } }));
    } else {
      clearGen(id);
      fetchListRef.current(true); // 총평완료 상태 반영
    }
  }, [clearGen]);

  /**
   * 분석 완료 후: readiness 통과 시 V3 총평용 메타데이터를 백그라운드로 선생성.
   * (base scaffolding을 미리 만들어 두면 총평 클릭 시 V3 단독 호출로 빠르게 생성됨)
   * willChain(자동 총평)이면 메타데이터 준비 후 이어서 총평까지 생성.
   * 배점 합계 ≠ 만점 / 단원 UNKNOWN 이면 건너뛰고 안내 (AnalysisDetail readinessCheck 복제).
   */
  const prepareMetadataAndMaybeCommentary = useCallback(async (id: string, willChain: boolean) => {
    try {
      const res = await fetch(`/api/exam-analysis/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const analysis = json.data?.analyses?.[0];
      const questions: Array<{ points?: number | null; topic?: string | null }> = analysis?.questions || [];
      if (questions.length === 0) return;
      // ⚠️ AnalysisDetail 과 반드시 동일 판정 — 공유 헬퍼 사용 (복제 금지)
      const readiness = checkAnalysisReadiness({
        questions,
        totalPoints: analysis?.totalPoints,
        summary: analysis?.summary,
      });
      if (!readiness.ready) {
        // 문항 누락은 배점·단원 수정으로 해결되지 않는다 → 재분석을 유도하는 별도 문구
        toast.warning(
          readiness.completeness?.status === 'incomplete'
            ? '분석 완료 — 문항 누락이 감지되었습니다. 분석본을 확인하세요'
            : '분석 완료. 배점·단원 확인 후 총평을 생성하세요',
        );
        return;
      }

      // ① 메타데이터 단계 — V3 총평의 분석 기반(base) 선생성. 이 동안 총평 버튼은 "준비 중".
      setGenState((p) => ({ ...p, [id]: { phase: 'metadata', startMs: Date.now(), willChain } }));
      let metaOk = false;
      try {
        const mRes = await fetch(`/api/exam-analysis/${id}/generate-metadata`, { method: 'POST' });
        metaOk = mRes.ok;
        if (!mRes.ok) toast.error('총평 준비(메타데이터) 생성 실패 — 잠시 후 [총평지 생성]을 시도하세요');
      } catch {
        toast.error('총평 준비 중 오류가 발생했습니다');
      }
      fetchListRef.current(true);
      if (selectedIdRef.current === id) fetchDetailRef.current(id);
      if (!metaOk) { clearGen(id); return; }

      // ② willChain(자동 총평 / 기존 총평 있는 재분석)이면 이어서 총평 생성 → commentary 단계.
      // forceRegenerate: true — 체인은 항상 신선한 분석 직후 실행되므로 기존 총평을 반드시 갱신.
      if (willChain) {
        setGenState((p) => ({ ...p, [id]: { phase: 'commentary', startMs: Date.now(), willChain } }));
        try {
          const cRes = await fetch(`/api/exam-analysis/${id}/analyze-extended`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: ['commentary'], forceRegenerate: true, includeNearby: true, includeYearCompare: true }),
          });
          const outcome = readCommentaryOutcome(await cRes.json().catch(() => null));
          if (cRes.ok && outcome.completed) toast.success('분석 + V3 총평 자동 생성 완료');
          else toast.error(outcome.error);
        } catch {
          toast.error('총평 자동 생성 중 오류가 발생했습니다');
        } finally {
          clearGen(id);
          fetchListRef.current(true);
          if (selectedIdRef.current === id) fetchDetailRef.current(id);
        }
      } else {
        clearGen(id);
        toast.success('V3 총평 준비 완료 — [총평지 생성]을 누르면 빠르게 생성됩니다');
      }
    } catch {
      toast.error('총평 준비 중 오류가 발생했습니다');
      clearGen(id);
    }
  }, [clearGen]);

  /**
   * 영어 전용 후속 준비 — 학습 대책용 단어·구문 추출.
   *
   * 수학의 총평 체인과 같은 자리다: 기본 분석·AI 코멘트는 이미 화면에 떴고, 이건 뒤에서 돈다.
   * 학습 대책 탭을 먼저 눌러도 로딩만 보이도록 genState 로 진행 상태를 알린다
   * (탭이 스스로 또 호출하면 같은 AI 호출이 두 번 나가므로 반드시 이 신호로 막는다).
   */
  const prepareEnglishStudy = useCallback(async (id: string, willChain: boolean) => {
    try {
      const res = await fetch(`/api/exam-analysis/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const questions = json.data?.analyses?.[0]?.questions;
      if (!Array.isArray(questions) || questions.length === 0) return;

      setGenState((p) => ({ ...p, [id]: { phase: 'englishStudy', startMs: Date.now(), willChain } }));
      try {
        const sRes = await fetch(`/api/exam-analysis/${id}/english-study`, buildStudyRequest());
        if (!sRes.ok) {
          const err = await sRes.json().catch(() => null);
          // 실패해도 분석 자체는 성공이다 → error 가 아니라 warning + 탭에서 재시도 가능 안내
          toast.warning(err?.error?.message || '학습 대책 준비에 실패했습니다 — 학습 대책 탭에서 다시 시도할 수 있습니다');
        }
      } catch {
        toast.warning('학습 대책 준비 중 오류가 발생했습니다');
      } finally {
        fetchListRef.current(true);
        if (selectedIdRef.current === id) fetchDetailRef.current(id);
      }
      // 총평은 학습 대책 팩에 의존하지 않는다. 같은 진행 상태를 쓰므로 단계만 직렬로 연결한다.
      if (willChain) {
        setGenState((p) => ({ ...p, [id]: { phase: 'commentary', startMs: Date.now(), willChain } }));
        try {
          const cRes = await fetch(`/api/exam-analysis/${id}/analyze-extended`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: ['commentary'], forceRegenerate: true }),
          });
          const outcome = readCommentaryOutcome(await cRes.json().catch(() => null));
          if (cRes.ok && outcome.completed) toast.success('영어 총평이 생성되었습니다');
          else toast.error(outcome.error);
        } catch { toast.error('영어 총평 생성 중 오류가 발생했습니다'); }
      }
    } catch {
      toast.warning('영어 후속 준비를 마치지 못했습니다. 분석 화면에서 다시 시도해 주세요.');
    } finally {
      clearGen(id);
      fetchListRef.current(true);
      if (selectedIdRef.current === id) fetchDetailRef.current(id);
    }
  }, [clearGen]);

  const handleAnalyze = async (id: string) => {
    if (analyzing || genState[id]) return;
    // 데모 계정: 권한·잔여 횟수 사전 차단(서버 왕복 없이 즉시 안내). 그 외: 월 한도 사전 차단.
    if (demo && demo.isDemo) {
      if (!demo.perms.analyze) {
        toast.error('이 데모 계정은 기출분석 체험 권한이 없습니다. 관리자에게 문의하세요.');
        return;
      }
      if (demo.remaining <= 0) {
        toast.error(`데모 체험 횟수(${demo.limit}회)를 모두 사용했습니다. 정식 도입 문의를 통해 계속 이용하실 수 있습니다.`);
        return;
      }
    } else if (quotaExceeded(usage)) {
      toast.error(`이번 달 분석 한도(${usage.limit}회)를 초과했습니다 — 구독에서 업그레이드하세요`);
      return;
    }
    setAnalyzing(true);
    // 재분석 대상이 기존에 총평을 갖고 있었는지 (재분석 = 완전 최신화 → 총평도 V3로 자동 재생성)
    const target = items.find((it) => it.id === id);
    const hadCommentary = !!target?.analyses?.[0]?.extensions?.some((e) => e.agentType === 'commentary');
    // 즉시 로컬 상태를 ANALYZING으로 변경 (폴링 트리거 + UI 즉시 반영)
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'ANALYZING' as const } : item
    ));
    // 체크박스 ON 이거나, 기존에 총평이 있던 분석본의 재분석이면 → 총평까지 자동 V3 재생성
    const isEnglish = target?.subject === 'ENGLISH';
    const willChain = isEnglish ? autoCommentary && features.commentary : (autoCommentary || hadCommentary);
    toast.info(
      isEnglish
        ? (willChain ? 'AI 분석 후 학습 대책과 영어 총평을 이어서 준비합니다' : 'AI 분석 후 학습 대책을 준비합니다. 기존 영어 총평은 이전 근거 표시와 함께 보존됩니다')
        : willChain
          ? (hadCommentary && !autoCommentary
              ? 'AI 재분석 후 기존 V3 총평을 자동 갱신합니다'
              : 'AI 분석 후 V3 총평까지 자동 생성합니다')
          : 'AI 분석이 시작되었습니다',
    );
    try {
      // 후속 단계가 끝날 때까지 실행 버튼을 잠그고 현재 선택된 시험만 갱신한다.
      await fetch(`/api/exam-analysis/${id}/analyze`, buildAnalyzeRequest())
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            toast.error(err?.error?.message || (res.status === 403 ? '분석 한도를 초과했습니다 — 구독에서 업그레이드' : '분석 실패'));
            fetchList(true);
            refetchSub();
            if (selectedIdRef.current === id) fetchDetailRef.current(id);
            return;
          }
          // 분석 성공 → 즉시 목록/상세 갱신(결과 표시) 후 메타데이터 백그라운드 선생성
          // (readiness 통과 시. willChain이면 메타데이터 준비 후 총평까지 자동 생성)
          fetchList(true);
          refetchSub(); // 사용량 배지 즉시 갱신
          if (selectedIdRef.current === id) fetchDetailRef.current(id);
          if (isEnglish) await prepareEnglishStudy(id, willChain);
          else await prepareMetadataAndMaybeCommentary(id, willChain);
        })
        .catch(() => {
          toast.error('분석 요청에 실패했습니다');
          // 실패 시 상태 복원
          setItems(prev => prev.map(item =>
            item.id === id ? { ...item, status: 'FAILED' as const } : item
          ));
        });
      // 폴링이 3초마다 상태 확인하므로 여기서 fetchList 안 함
    } finally {
      setAnalyzing(false);
    }
  };

  // 사이드바 배지 — 데모 계정은 '체험 잔여/총', 그 외는 월 분석 한도.
  const dm = demo && demo.isDemo ? demo : null;
  const poolBal = usage.poolBalance ?? 0;
  // 이용권(지점 풀)이 있으면 그걸로 차감 → 한도초과 아님. 풀 0 + 무료한도 소진일 때만 초과.
  const quotaIsExceeded = dm ? dm.remaining <= 0 : (poolBal <= 0 && quotaExceeded(usage));
  const quotaIsUnlimited = !dm && usage.limit === null;
  const quotaBadgeText = dm
    ? `체험 ${dm.remaining}/${dm.limit}`
    : poolBal > 0 ? `이용권 ${poolBal}`
    : quotaIsUnlimited ? '무제한'
    : `무료 ${usage.used}/${usage.limit}`;
  const quotaTitle = dm
    ? (dm.remaining <= 0
        ? `데모 체험 분석을 모두 사용했습니다 (총 ${dm.limit}회). 정식 도입 문의로 계속 이용하실 수 있어요.`
        : `데모 체험 분석 — 남은 ${dm.remaining}회 / 총 ${dm.limit}회`)
    : poolBal > 0
      ? `기출분석 이용권 ${poolBal}회 남음. 분석할 때마다 1회씩 차감됩니다. 클릭하면 이용권·구독을 관리할 수 있어요.`
      : quotaIsExceeded
        ? `이용권이 없고 이번 달 무료 한도(${usage.limit}회)도 모두 사용했어요. 이용권을 충전하거나 플랜을 업그레이드하세요.`
        : quotaIsUnlimited
          ? `무제한 플랜입니다. 클릭하면 구독·한도를 관리할 수 있어요.`
          : `무료 분석 한도 ${usage.used}/${usage.limit}회 사용(이용권 없음). 클릭하면 이용권·구독을 관리할 수 있어요.`;

  return (
    <NarrowScreenGuard minWidth={1024} label="기출 분석">
    <div className="flex-1 flex min-h-0">
      {/* 좌측 사이드바 */}
      <aside
        className={`shrink-0 border-r border-slate-200 bg-white flex-col ${draggingList ? '' : 'transition-all duration-200'} ${
          leftPanelCollapsed ? 'w-12 hidden md:flex' : 'w-full md:flex'
        } ${selectedId ? 'hidden md:flex' : 'flex'}`}
        style={leftPanelCollapsed ? undefined : { width: listWidth }}
      >
        {/* 좌상단 개인 프로필 (이름·역할·관리메뉴·로그아웃) — 우상단 토스트와 겹침 방지로 여기로 이동 */}
        {!leftPanelCollapsed && <ProfileMenu variant="inline" />}
        <div className="flex items-center justify-between p-3 border-b border-slate-200">
          {!leftPanelCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <FileSearch className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-sm text-slate-800 truncate">기출 분석</span>
              <span className="ml-auto px-1.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary shrink-0">
                {total}
              </span>
              <Link
                href="/billing"
                title={quotaTitle}
                aria-label={quotaTitle}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold shrink-0 transition-colors ${quotaIsExceeded ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'}`}
              >
                <Gauge className="w-3 h-3 shrink-0" />
                <span>{quotaBadgeText}</span>
              </Link>
            </div>
          )}
          <button
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-400 hover:text-slate-600 shrink-0"
            title={leftPanelCollapsed ? '패널 열기' : '패널 접기'}
          >
            {leftPanelCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {!leftPanelCollapsed && (
          <div className="flex items-center gap-1 p-2 border-b">
            {isOwnerPlus && (
              <Link href="/exam-analysis/admin" className="flex-none">
                <Button size="sm" variant="ghost" title="분석 관리 (강사별 통계·레퍼런스·학습 패턴)">
                  <Settings2 className="w-4 h-4" />
                </Button>
              </Link>
            )}
            <Button size="sm" className="flex-1 bg-[linear-gradient(100deg,#4F46E5,#7C3AED)]" onClick={() => setShowUpload(true)}>
              <Plus className="w-4 h-4 mr-1" />
              업로드
            </Button>
          </div>
        )}
        {!leftPanelCollapsed && <DevCliPicker />}
        {/* 검색 + 필터 (학년 / 상태) — API route.ts가 grade/status/search 지원 */}
        {!leftPanelCollapsed && (
          <div className="px-2 py-2 border-b border-slate-200 space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="제목·학교 검색"
                className="w-full pl-7 pr-7 py-1.5 text-sm border border-slate-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                  title="검색어 지우기"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <select
                value={filterGrade}
                onChange={(e) => { setFilterGrade(e.target.value); setPage(1); }}
                className="flex-1 min-w-0 text-xs border border-slate-200 rounded-sm py-1.5 px-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">학년 전체</option>
                {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                className="flex-1 min-w-0 text-xs border border-slate-200 rounded-sm py-1.5 px-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">상태 전체</option>
                <option value="COMPLETED">완료</option>
                <option value="ANALYZING">분석중</option>
                <option value="PENDING">대기</option>
                <option value="FAILED">실패</option>
              </select>
            </div>
            {(search || filterGrade || filterStatus) && (
              <button
                onClick={() => { setSearchInput(''); setSearch(''); setFilterGrade(''); setFilterStatus(''); setPage(1); }}
                className="text-[11px] text-slate-400 hover:text-primary transition-colors"
              >
                필터 초기화
              </button>
            )}
          </div>
        )}
        {/* 목록 (flex-1 스크롤) */}
        {!leftPanelCollapsed && (
          <div className="flex-1 min-h-0">
            {loading ? (
              <div className="p-6 flex flex-col items-center gap-2.5 text-sm text-slate-400">
                <MathSpinner size="md" />
                불러오는 중...
              </div>
            ) : (
              <ExamPaperList
                items={items as unknown as Parameters<typeof ExamPaperList>[0]['items']}
                total={total}
                page={page}
                limit={limit}
                onPageChange={setPage}
                onSelect={setSelectedId}
                onAnalyze={handleAnalyze}
                onDelete={(id) => {
                  if (selectedId === id) { setSelectedId(null); setSelectedDetail(null); }
                  fetchList();
                }}
                selectedId={selectedId}
                canEditSchool={isManagerPlus}
                onUpdate={(id, data) => {
                  setItems(prev => prev.map(item =>
                    item.id === id ? { ...item, ...data } as ExamPaperData : item
                  ));
                }}
                genState={genState}
              />
            )}
          </div>
        )}
      </aside>

      {/* 목록 패널 너비 조절 드래그 핸들 (접힘 상태·모바일 제외). 더블클릭 시 기본폭 복원 */}
      {!leftPanelCollapsed && (
        <div
          onMouseDown={startListResize}
          onDoubleClick={resetListWidth}
          className={`hidden md:block shrink-0 w-1.5 cursor-col-resize transition-colors ${draggingList ? 'bg-primary/50' : 'bg-transparent hover:bg-primary/30'}`}
          title="드래그하여 목록 너비 조절 (더블클릭: 기본폭)"
          role="separator"
          aria-orientation="vertical"
        />
      )}

      {/* 우측 메인 */}
      <main className="flex-1 overflow-y-auto p-6 bg-brand-cream-2/50">
        {showUpload ? (
          <div className="max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">시험지 업로드</h2>
              <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ExamUploadForm
              onSuccess={(newId) => { setShowUpload(false); fetchList(); if (newId) setSelectedId(newId); }}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        ) : selectedDetail ? (
          <AnalysisDetail
            key={selectedDetail.id}
            detail={selectedDetail}
            analyzing={analyzing}
            onAnalyze={handleAnalyze}
            onRefresh={() => fetchDetail(selectedDetail.id)}
            autoCommentary={autoCommentary}
            onToggleAutoCommentary={toggleAutoCommentary}
            gen={genState[selectedDetail.id] ?? null}
            onCommentaryGenChange={handleCommentaryGenChange}
          />
        ) : selectedId && !selectedDetail ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <MathSpinner size="lg" className="mb-3" />
            <p className="text-sm">불러오는 중...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <p className="text-sm">시험지를 선택하거나 새로 업로드하세요</p>
          </div>
        )}
      </main>
    </div>
    </NarrowScreenGuard>
  );
}
