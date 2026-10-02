'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, RotateCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { useSubscription } from '@/components/providers/SubscriptionProvider';
import { buildEnglishCommentaryContext, checkEnglishCommentaryReadiness } from '@/lib/exam-analysis/english/commentary/context';
import { englishCommentarySignature } from '@/lib/exam-analysis/english/commentary/signature';
import { readEnglishCommentaryState } from '@/lib/exam-analysis/english/commentary/schema';
import { isStalePromptVersion } from '@/lib/exam-analysis/constants';
import { readCommentaryOutcome } from '@/lib/exam-analysis/shared/commentary-outcome';
import { toUserFacingError } from '@/lib/exam-analysis/shared/error-message';
import { COMMENTARY_THEMES } from '@/lib/exam-analysis/commentary-themes';
import { DEFAULT_TEMPLATE, parseTemplateConfig } from '@/lib/exam-analysis/blocks/default-template';
import type { ExamPaperData } from '../types';
import { EnglishCommentaryView } from './EnglishCommentaryView';
import { copyEnglishCommentaryImages } from './commentary-copy';

interface Props {
  detail: ExamPaperData;
  gen: { phase: 'metadata' | 'commentary' | 'englishStudy'; startMs: number; willChain: boolean } | null;
  autoCommentary: boolean;
  onToggleAutoCommentary?: (value: boolean) => void;
  onRefresh: () => void;
  onGenerationChange?: (id: string, started: boolean) => void;
  onReanalyze: () => void;
  reanalyzing: boolean;
}

export function EnglishCommentarySection({ detail, gen, autoCommentary, onToggleAutoCommentary, onRefresh, onGenerationChange, onReanalyze, reanalyzing }: Props) {
  const { features, demo } = useSubscription();
  const analysis = detail.analyses[0];
  const extension = analysis?.extensions.find(e => e.agentType === 'commentary');
  const [clock, setClock] = useState(Date.now());
  const state = useMemo(() => readEnglishCommentaryState(extension?.result, new Date(clock)), [extension?.result, clock]);
  const document = state.document;
  const input = useMemo(() => ({ examPaper: detail, analysis }), [detail, analysis]);
  const context = useMemo(() => buildEnglishCommentaryContext(input), [input]);
  const readiness = useMemo(() => checkEnglishCommentaryReadiness(input), [input]);
  const signature = useMemo(() => englishCommentarySignature(context), [context]);
  const stale = !!document && document.inputSignature !== signature;
  const oldAnalysis = isStalePromptVersion(analysis?.modelVersion, 'ENGLISH');
  const locked = !features.commentary;
  const lockMessage = demo?.isDemo ? '이 데모 계정은 총평 생성 권한이 없습니다.' : 'AI 총평은 Pro 플랜 이상에서 생성할 수 있습니다.';
  const blogDenied = !!demo?.isDemo && !demo.perms.blog;
  const [expanded, setExpanded] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const generatingRef = useRef(false);
  const copyRef = useRef(false);
  const [copying, setCopying] = useState(false);
  const [progress, setProgress] = useState('');
  const [confirmOldCopy, setConfirmOldCopy] = useState(false);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const refreshing = useRef(onRefresh);
  refreshing.current = onRefresh;
  const savedRunning = state.running && !state.running.expired;
  const busy = startedAt != null || gen?.phase === 'commentary' || !!savedRunning;
  const blocked = locked || !readiness.ready || oldAnalysis || !!gen || busy || reanalyzing;
  const start = startedAt ?? (gen?.phase === 'commentary' ? gen.startMs : null) ?? (savedRunning ? Date.parse(state.running!.startedAt) : null);
  const elapsed = start == null ? 0 : Math.max(0, Math.floor((clock - start) / 1000));
  const failure = attemptError || state.lastFailure?.message || extension?.errorMessage;
  const [template, setTemplate] = useState({ ...DEFAULT_TEMPLATE, themeId: 'brand' });
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeLoaded, setThemeLoaded] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  // 다른 탭에서 시작한 생성이나 새로고침 후에도 완료 결과를 다시 조회한다.
  useEffect(() => {
    if (!savedRunning || startedAt != null || gen?.phase === 'commentary') return;
    const timer = setInterval(() => refreshing.current(), 5000);
    return () => clearInterval(timer);
  }, [savedRunning, startedAt, gen?.phase]);
  useEffect(() => {
    let active = true;
    setThemeLoaded(false);
    void fetch(`/api/exam-analysis/${detail.id}/template`, { cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error('테마를 불러오지 못했습니다.');
      const body = await res.json();
      if (active) { setTemplate(parseTemplateConfig(body.data?.config)); setThemeLoaded(true); }
    }).catch(() => { if (active) toast.error('총평 테마를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'); });
    return () => { active = false; };
  }, [detail.id, analysis.id]);

  const generate = async () => {
    if (generatingRef.current || blocked) return;
    generatingRef.current = true;
    setStartedAt(Date.now()); setClock(Date.now()); setAttemptError(null); setConfirmOldCopy(false);
    onGenerationChange?.(detail.id, true);
    try {
      const res = await fetch(`/api/exam-analysis/${detail.id}/analyze-extended`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: ['commentary'], forceRegenerate: !!extension }),
      });
      const outcome = readCommentaryOutcome(await res.json().catch(() => null));
      if (!res.ok || !outcome.completed) { setAttemptError(outcome.error); toast.error(outcome.error); }
      else { toast.success('영어 총평이 생성되었습니다'); setExpanded(true); }
      onRefresh();
    } catch (error) {
      const message = toUserFacingError(error, '총평을 생성하지 못했습니다. 다시 시도해 주세요.');
      setAttemptError(message); toast.error(message);
    } finally {
      setStartedAt(null); generatingRef.current = false; onGenerationChange?.(detail.id, false);
    }
  };

  const changeTheme = async (themeId: string) => {
    const prior = template;
    const next = { ...template, themeId };
    setTemplate(next); setThemeSaving(true);
    try {
      const res = await fetch(`/api/exam-analysis/${detail.id}/template`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: next }),
      });
      if (!res.ok) throw new Error('총평 테마를 저장하지 못했습니다.');
    } catch { setTemplate(prior); toast.error('총평 테마를 저장하지 못했습니다. 다시 선택해 주세요.'); }
    finally { setThemeSaving(false); }
  };

  const copy = async (confirmed = false) => {
    if (!document || copyRef.current || blogDenied) return;
    if (stale && !confirmed) { setConfirmOldCopy(true); return; }
    setConfirmOldCopy(false); setExpanded(true); setCopying(true); copyRef.current = true;
    const notification = toast.loading('총평 이미지를 준비합니다');
    try {
      // 펼침 상태의 DOM 반영만 기다린다. 보고서의 생성·검증 단계로 가장하지 않는다.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const root = host.current?.querySelector<HTMLElement>('[aria-label="영어 시험 총평 보고서"]');
      if (!root) throw new Error('총평을 펼친 뒤 다시 복사해 주세요.');
      const count = await copyEnglishCommentaryImages({ root, examId: detail.id, report: document,
        onProgress: (done, total) => setProgress(`${done} / ${total} 이미지 준비`),
      });
      toast.success(`${count}개 총평 이미지와 요약을 복사했습니다. 네이버 블로그에 붙여넣으세요.`, undefined, notification);
    } catch (error) { console.error('[EnglishCommentary] image copy failed', error); toast.error(toUserFacingError(error, '총평 이미지 복사에 실패했습니다.'), undefined, notification); }
    finally { copyRef.current = false; setCopying(false); setProgress(''); }
  };

  return <section className="mb-6 rounded-sm border border-slate-200 bg-white" aria-label="영어 총평">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-slate-900">영어 시험 총평</h3></div>
      <div className="flex flex-wrap items-center gap-2">
        {document && <Button variant="secondary" size="sm" onClick={() => setExpanded(v => !v)} disabled={copying} aria-expanded={expanded}>
          {expanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}{expanded ? '접기' : '총평 보기'}</Button>}
        {document && <Button variant="secondary" size="sm" onClick={() => void copy()} disabled={copying || blogDenied || busy} title={blogDenied ? '이 데모 계정은 블로그 복사 권한이 없습니다' : undefined}><Copy className="mr-1 h-3.5 w-3.5" />{copying ? '이미지 준비 중' : '네이버 이미지 복사'}</Button>}
        <Button size="sm" onClick={() => void generate()} disabled={blocked || copying} title={locked ? lockMessage : readiness.reasons.join('\n')}>
          {busy && <RotateCw className="mr-1 h-3.5 w-3.5 animate-spin" />}{busy ? '총평 작성 중' : document ? '총평 재생성' : '총평 생성'}
        </Button>
      </div>
    </div>

    <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
      {!document && <p className="leading-relaxed">시험 구성과 문항 근거를 연결해 핵심 특징, 대표 문항, 학습 방법을 정리합니다. 작성한 총평은 저장하고 블로그용 이미지로 공유할 수 있습니다.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {onToggleAutoCommentary && <label className="flex items-center gap-2"><input type="checkbox" checked={autoCommentary} disabled={locked || busy || !!gen} onChange={e => onToggleAutoCommentary(e.target.checked)} className="rounded-sm border-slate-300 text-primary focus:ring-primary" />분석 후 총평 자동 생성</label>}
        {document && <label className="flex items-center gap-2">지면 테마<select aria-label="총평 지면 테마" value={template.themeId} disabled={themeSaving || !themeLoaded || copying} onChange={e => void changeTheme(e.target.value)} className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-slate-700 focus:outline-primary">{COMMENTARY_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>}
      </div>
      {locked && <p className="text-slate-700">{lockMessage}</p>}
      {oldAnalysis && <div className="rounded-sm border border-amber-200 bg-amber-50 p-3"><p>이전 기준으로 분석한 시험지입니다. 재분석 후 영어 총평을 생성하세요.</p><Button size="sm" variant="secondary" className="mt-2" disabled={reanalyzing || !!gen} onClick={onReanalyze}>시험지 재분석</Button></div>}
      {!readiness.ready && !oldAnalysis && <div className="rounded-sm border border-amber-200 bg-amber-50 p-3"><p className="font-semibold">총평 생성 전 문항 정보를 확인해 주세요.</p><ul className="mt-1 list-inside list-disc">{readiness.reasons.map(r => <li key={r}>{r}</li>)}</ul><p className="mt-2">아래 문항 분석에서 근거·배점을 수정하거나 시험지를 재분석하세요.</p></div>}
      {(state.status === 'legacy' || state.status === 'invalid') && <p className="rounded-sm bg-amber-50 p-3">이전에 저장된 총평은 새 영어 보고서 형식으로 다시 생성해야 합니다.</p>}
      {stale && <p role="status" className="rounded-sm border border-amber-200 bg-amber-50 p-3">이전 근거로 만든 총평입니다. 문항 또는 시험 정보가 변경되었습니다. 아래 보고서는 작성 당시 내용을 유지하며, 최신 근거를 반영하려면 총평을 재생성하세요.</p>}
      {failure && !busy && <p role="alert" className="rounded-sm border border-rose-200 bg-rose-50 p-3 text-rose-800">{document ? '최근 재생성 실패 — 이전 총평 표시 중. ' : ''}{toUserFacingError(failure)}</p>}
      {busy && <div aria-live="polite"><p>문항 근거를 바탕으로 총평을 작성하고 있습니다. 완료되면 저장됩니다. <span className="tabular-nums">{elapsed}초</span></p>{!document && <div className="mt-3 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>}</div>}
      {gen?.phase === 'englishStudy' && <p>학습 대책을 준비하고 있습니다.{gen.willChain ? ' 완료 후 총평을 이어서 생성합니다.' : ''}</p>}
      {copying && <p role="status">{progress || '총평 이미지 준비 중'}</p>}
      {confirmOldCopy && <div role="alert" className="rounded-sm border border-amber-300 bg-amber-50 p-3"><p>교정 전 기준의 보고서를 복사합니다. 최신 문항 정보를 반영하려면 먼저 재생성하세요.</p><div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setConfirmOldCopy(false)}>취소</Button><Button size="sm" onClick={() => void copy(true)}>이전 총평으로 복사</Button></div></div>}
    </div>
    {document && expanded && <div ref={host} className="border-t border-slate-200"><EnglishCommentaryView document={document} themeId={template.themeId} stale={stale} /></div>}
  </section>;
}
