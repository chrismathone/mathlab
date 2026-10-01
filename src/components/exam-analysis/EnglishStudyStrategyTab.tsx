'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Brain, GraduationCap, Languages, Lightbulb, Quote, Repeat2, Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MathSpinner } from '@/components/ui/MathSpinner';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import {
  EXAM_CLI_STORAGE_KEY,
  parseCliKind,
} from '@/lib/exam-analysis/cli-kind';
import {
  buildEnglishStudyFromQuestions,
  countUnitLabel,
  frequentEmptyText,
  frequentTitle,
  isCurrentEnglishStudyPack,
  parseEnglishStudyResult,
  splitEnglishStudy,
  trapEmptyText,
  trapHint,
  trapTitle,
  type EnglishStudyExtracted,
  type EnglishStudyStructure,
  type EnglishStudyTerm,
} from '@/lib/exam-analysis/english-study-pack';
import { isHighDifficulty } from '@/lib/exam-analysis/shared/difficulty';
import { isEssay } from '@/lib/exam-analysis/shared/question-format';
import { collectQuestionEvidence } from '@/lib/exam-analysis/shared/question-evidence';
import { QuestionEvidenceList } from './QuestionEvidenceList';
import { buildAbilityBreakdown } from '@/lib/exam-analysis/shared/ability-breakdown';
import { AbilityBreakdownView } from './AbilityBreakdownView';
import { englishLevelStrategiesFor } from '@/lib/exam-analysis/shared/english-level-strategy';
import { weightedAverageDifficulty } from '@/lib/exam-analysis/shared/difficulty';
import { EnglishLevelStrategies } from './EnglishLevelStrategies';
import { buildEnglishTopicStrategies, matchedStrategyCount } from '@/lib/exam-analysis/shared/english-topic-strategy';
import { EnglishTopicStrategies } from './EnglishTopicStrategies';
import { formatPoints, sumPoints } from '@/lib/exam-analysis/shared/points';
import { readEnglishQuestionAnalysis, SUBTYPE_LABELS } from '@/lib/exam-analysis/english/question-evidence';
import { renderInlineMath } from '@/lib/exam-analysis/rendering';

interface EnglishStudyStrategyTabProps {
  questions: AnalyzedQuestion[];
  grade?: string;
  examPaperId: string;
  analysisId?: string;
  storedPack?: unknown;
  onStored?: () => void;
  /**
   * 분석 직후 페이지가 백그라운드로 추출을 돌리는 중인가.
   * true 면 이 탭은 **직접 호출하지 않는다** — 같은 AI 호출이 두 번 나가는 걸 막는다.
   */
  preparing?: boolean;
  /**
   * 저장된 팩에 실패·잘림 표시(errorMessage)가 붙어 있는가.
   * true 면 완결본이 아니므로 seed 로 인정하지 않고 다시 뽑는다.
   */
  storedIncomplete?: boolean;
}

function studyRequestBody(extra: Record<string, unknown> = {}): string {
  let cli: ReturnType<typeof parseCliKind>;
  try {
    cli = parseCliKind(
      typeof window !== 'undefined' ? window.localStorage.getItem(EXAM_CLI_STORAGE_KEY) : null,
    );
  } catch {
    cli = undefined;
  }
  return JSON.stringify({ ...extra, ...(cli ? { cli } : {}) });
}

export function EnglishStudyStrategyTab({
  questions,
  grade,
  examPaperId,
  analysisId,
  storedPack,
  onStored,
  preparing = false,
  storedIncomplete = false,
}: EnglishStudyStrategyTabProps) {
  const fromQuestions = useMemo(() => buildEnglishStudyFromQuestions(questions), [questions]);
  const practiceTasks = useMemo(() => questions.flatMap(q => {
    const a = readEnglishQuestionAnalysis(q.english_analysis);
    return a.next_practice ? [{ number: q.question_number, task: a.next_practice, subtype: a.subtype }] : [];
  }), [questions]);

  // ── 이 시험에서 특히 볼 문항 ──
  // 이 탭은 여태 단어·구문 목록뿐이었다. 무엇을 외울지는 알려 주는데 **어느 문항이 왜 어려웠는지**
  // 는 한 줄도 없었다. 문항마다 AI 소견(ai_comment/difficulty_reason)이 붙어 있는데 문항표에서만
  // 쓰이고 여기서는 버려졌다. 수학 탭의 킬러 문항 블록과 같은 근거·같은 술어를 쓴다.
  const focusQuestions = useMemo(
    () => questions.filter((q) => isHighDifficulty(q.difficulty) || isEssay(q)),
    [questions],
  );
  const focusEvidence = useMemo(() => collectQuestionEvidence(focusQuestions), [focusQuestions]);
  const focusMissing = focusQuestions.length - focusEvidence.length;

  // 능력 축 — 문항 메타데이터만 쓰므로 단어·구문 추출과 무관하다(같은 이유로 로딩·실패 때도 보인다).
  const abilityBreakdown = useMemo(() => buildAbilityBreakdown('ENGLISH', questions), [questions]);

  // 수준별 전략 — 고등 전용 데이터라 중학 시험지에서는 빈 배열이 오고 블록이 안 생긴다.
  const levelStrategies = useMemo(() => englishLevelStrategiesFor(grade), [grade]);
  // 단원별 전략 — 매칭 못 한 단원에는 전략을 붙이지 않는다(문항 근거만 남는다).
  const topicGroups = useMemo(() => buildEnglishTopicStrategies(questions), [questions]);
  const examProfile = useMemo(() => {
    if (!questions.length) return undefined;
    const hard = questions.filter((q) => isHighDifficulty(q.difficulty)).length;
    const w = weightedAverageDifficulty(questions);
    return { hardRatio: hard / questions.length, avgDifficulty: w.avg > 0 ? w.avg : null };
  }, [questions]);
  // 저장된 팩이라도 **구버전이면 쓰지 않는다** — 추출 규칙이 바뀌었는데 옛 결과를 보여주면
  // 규칙 개선이 영원히 사용자에게 도달하지 않는다.
  const parsedStored = useMemo(() => {
    // 구버전이거나 실패·잘림 표시가 붙은 저장분은 쓰지 않는다 —
    // 서버가 재시도하라고 남긴 신호를 여기서 삼키면 자동 복구가 영영 돌지 않는다.
    if (storedIncomplete) return null;
    const parsed = parseEnglishStudyResult(storedPack);
    return parsed && isCurrentEnglishStudyPack(parsed) ? parsed : null;
  }, [storedPack, storedIncomplete]);
  const seed = parsedStored ?? fromQuestions;
  const seedEnough = !!seed && seed.vocab.length + seed.structures.length >= 5;

  const [pack, setPack] = useState<EnglishStudyExtracted | null>(seed);
  const [loading, setLoading] = useState(!seedEnough);
  const [error, setError] = useState<string | null>(null);
  /** 결과는 보여주되 "이건 완전한 결과가 아니다"를 알리는 문구 (조용한 폴백 방지). */
  const [notice, setNotice] = useState<string | null>(null);
  const startedKey = useRef<string>('');

  useEffect(() => {
    if (seed) setPack(seed);
    if (seedEnough) {
      setLoading(false);
      setError(null);
    }
  }, [seed, seedEnough]);

  useEffect(() => {
    // 페이지가 이미 백그라운드로 뽑고 있으면 여기서 또 부르지 않는다 (중복 과금 방지).
    // 끝나면 부모가 storedPack 을 갱신해 주므로 seed 로 자연히 채워진다.
    if (preparing) return;
    if (seedEnough || !examPaperId || !analysisId) {
      if (!analysisId) {
        setLoading(false);
        setError('기본 분석을 먼저 실행하세요');
      }
      return;
    }
    const key = `${examPaperId}:${analysisId}`;
    if (startedKey.current === key) return;
    startedKey.current = key;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/exam-analysis/${examPaperId}/english-study`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: studyRequestBody(),
        });
        const json = await res.json() as {
          data?: unknown;
          error?: { message?: string };
        };
        if (!res.ok) throw new Error(json.error?.message || '단어·구문 정리에 실패했습니다');
        const next = parseEnglishStudyResult(json.data);
        if (!next) throw new Error('시험지에서 단어·구문을 찾지 못했습니다');
        if (!cancelled) {
          setPack(next);
          onStored?.();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '단어·구문 정리에 실패했습니다';
        if (!cancelled) {
          if (fromQuestions) {
            // 폴백은 하되 **조용히 하지 않는다.** 예전엔 setError(null) 로 삼켜서
            // 사용자가 얇은 결과를 완전한 결과로 오해했다.
            setPack(fromQuestions);
            setError(null);
            setNotice(`시험지 본문을 훑지 못해 문항 분석에 있던 표현만 보여줍니다. (${msg})`);
          } else {
            setError(msg);
            toast.error(msg);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [examPaperId, analysisId, seedEnough, fromQuestions, onStored, preparing]);

  const retry = async () => {
    if (!examPaperId) return;
    startedKey.current = `${examPaperId}:${analysisId || ''}:retry`;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/exam-analysis/${examPaperId}/english-study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: studyRequestBody({ forceRegenerate: true }),
      });
      const json = await res.json() as { data?: unknown; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message || '단어·구문 정리에 실패했습니다');
      const next = parseEnglishStudyResult(json.data);
      if (!next) throw new Error('시험지에서 단어·구문을 찾지 못했습니다');
      setPack(next);
      if (next.source === 'questions') {
        setNotice('시험지 본문에서는 표현을 뽑지 못해 문항 분석분을 그대로 보여줍니다.');
      }
      onStored?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '단어·구문 정리에 실패했습니다';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // 분석 직후 백그라운드 추출 중 — 탭을 먼저 눌러도 진행 상황이 보여야 한다.
  if (preparing) {
    return <PreparingView hasSeed={!!pack} />;
  }

  // 단어·구문 추출과 **무관한** 근거이므로, 추출이 로딩 중이거나 실패해도 같이 숨기지 않는다.
  // (수학 킬러 섹션에서 카탈로그 매칭 실패가 우리 근거까지 가리던 것과 같은 실수를 반복하지 않는다.)
  const focusBoard = focusEvidence.length > 0 ? (
    <Board
      title="이 시험에서 특히 볼 문항"
      hint={`${focusEvidence.length}개`}
      icon={<Target className="w-3.5 h-3.5 text-red-600" />}
      iconBg="bg-red-500/15"
    >
      <p className="text-[11px] text-slate-400 mb-2">
        난이도 4~5단계이거나 서술형인 문항입니다. 아래 문장은 AI가 시험지를 보고 적은 소견입니다.
      </p>
      <QuestionEvidenceList items={focusEvidence} keyPrefix="en" />
      {/* 대상 문항과 목록 개수가 다를 수 있다 — 세는 쪽이 알려 줘야 잘린 줄 알지 않는다 */}
      {focusMissing > 0 && (
        <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
          대상 {focusQuestions.length}문항 중 소견이 기록된 {focusEvidence.length}개입니다
        </p>
      )}
    </Board>
  ) : null;

  const abilityBoard = abilityBreakdown.groups.length > 0 ? (
    <Board
      title="능력 영역별 배점"
      hint={`${abilityBreakdown.groups.length}개 영역`}
      icon={<Brain className="w-3.5 h-3.5 text-teal-600" />}
      iconBg="bg-teal-500/15"
    >
      <p className="mb-2 text-xs text-slate-500">
        전체 {questions.length}문항 중 능력이 분류된 {abilityBreakdown.totalQuestions}문항의 확인 배점 {formatPoints(abilityBreakdown.totalPoints)}점 기준입니다.
        {questions.some(q => q.points == null) && ' 배점 미확인 문항은 비율에 포함되지 않습니다.'}
      </p>
      <AbilityBreakdownView breakdown={abilityBreakdown} partial={abilityBreakdown.totalQuestions !== questions.length || questions.some(q => q.points == null)} />
    </Board>
  ) : null;

  const levelBoard = levelStrategies.length > 0 ? (
    <Board
      title="수준별 학습 전략"
      hint={`${levelStrategies.length}단계`}
      icon={<GraduationCap className="w-3.5 h-3.5 text-blue-600" />}
      iconBg="bg-blue-500/15"
    >
      <EnglishLevelStrategies strategies={levelStrategies} profile={examProfile} />
    </Board>
  ) : null;

  const topicBoard = topicGroups.length > 0 ? (
    <Board
      title="단원별 학습 전략"
      hint={`${topicGroups.length}개 단원 · 전략 ${matchedStrategyCount(topicGroups)}개`}
      icon={<Lightbulb className="w-3.5 h-3.5 text-indigo-600" />}
      iconBg="bg-indigo-500/15"
    >
      <p className="mb-2 text-xs text-slate-500">
        전체 {questions.length}문항 중 단원이 분류된 {topicGroups.reduce((sum, g) => sum + g.questionCount, 0)}문항의 확인 배점 {formatPoints(sumPoints(topicGroups.map(g => g.points)))}점 기준입니다.
        {questions.some(q => q.points == null) && ' 배점 미확인 문항은 비율에 포함되지 않습니다.'}
      </p>
      <EnglishTopicStrategies groups={topicGroups} />
    </Board>
  ) : null;

  // 문항 메타데이터만 쓰는 블록들 — 세 분기 어디서나 같이 보여야 한다.
  const headBoards = (
    <>
      {focusBoard}
      {abilityBoard}
      {practiceTasks.length > 0 && <Board title="문항별 다음 학습" hint={`${practiceTasks.length}문항`} icon={<Lightbulb className="w-3.5 h-3.5 text-indigo-600" />} iconBg="bg-indigo-500/15">
        <p className="text-xs text-slate-500 mb-2">이번 시험의 문항 기술을 연습하는 과제입니다. 학생 개인의 오답 진단과는 구분됩니다.</p>
        <ul className="space-y-2 text-xs text-slate-700">{practiceTasks.map(p => <li key={String(p.number)}>
          <span className="font-semibold">{p.number}번{p.subtype ? ` · ${SUBTYPE_LABELS[p.subtype]}` : ''}</span> — {renderInlineMath(p.task, `practice-${p.number}`)}
        </li>)}</ul>
      </Board>}
      {topicBoard}
      {levelBoard}
    </>
  );

  if (loading && !pack) {
    return (
      <div className="space-y-4">
        {headBoards}
        <p className="text-sm text-slate-600">
          시험지에 적힌 영어 단어와 구문을 찾고 있습니다. 빈칸 추론 같은 유형 이름이 아니라, 실제로 나온 표현만 모읍니다.
        </p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-28 rounded-sm" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="space-y-4">
        {headBoards}
        <div className="border rounded-sm bg-white p-6 text-center space-y-3">
          <p className="text-sm text-slate-600">{error || '시험지에서 단어·구문을 찾지 못했습니다'}</p>
          <Button size="sm" onClick={retry}>다시 정리</Button>
        </div>
      </div>
    );
  }

  const split = splitEnglishStudy(pack);
  const source = pack.source;
  const unit = countUnitLabel(source);
  const traps = [
    ...split.trapVocab.map((v) => ({ kind: 'vocab' as const, text: v.word, meaning: v.meaning, count: v.count })),
    ...split.trapStructures.map((s) => ({ kind: 'structure' as const, text: s.pattern, meaning: s.meaning, count: s.count })),
  ];

  return (
    <div className="space-y-4">
      {/* 문항 메타데이터 블록을 먼저 — 아래 안내문은 단어·구문 보드를 설명하는 것이라
          그 문장과 보드 사이에 다른 블록이 끼면 글이 어긋난다. */}
      {headBoards}

      <p className="text-sm text-slate-600 leading-relaxed">
        {source === 'questions' ? (
          <>
            문항 분석에서 뽑아 둔 <strong className="font-semibold text-slate-800">문항별 핵심 표현</strong>을 모았습니다.
            옆의 숫자는 그 표현이 나온 <strong className="font-semibold text-slate-800">문항 수</strong>입니다.
          </>
        ) : (
          <>
            이번 시험지에 <strong className="font-semibold text-slate-800">실제로 적혀 있던</strong> 단어와 구문입니다.
            옆의 숫자는 시험지에서 <strong className="font-semibold text-slate-800">보인 횟수</strong>입니다.
          </>
        )}
        {' '}빈칸 추론·글의 구조 같은 유형 이름은 넣지 않았습니다.
      </p>

      {notice && <NoticeStrip text={notice} onRetry={retry} />}
      {!notice && source === 'questions' && (
        <NoticeStrip
          text="문항 분석에서 모은 표현입니다. 시험지 본문까지 훑으면 더 많이 나옵니다."
          onRetry={retry}
          retryLabel="본문에서 다시 뽑기"
        />
      )}

      <Board
        title={frequentTitle(source, '단어')}
        hint={split.frequentVocab.length ? `${split.frequentVocab.length}개` : undefined}
        icon={<Repeat2 className="w-3.5 h-3.5 text-emerald-600" />}
        iconBg="bg-emerald-500/15"
      >
        {split.frequentVocab.length === 0 ? (
          <EmptyLine text={frequentEmptyText(source, '단어')} />
        ) : (
          <TermChips items={split.frequentVocab} unit={unit} />
        )}
      </Board>

      <Board
        title={frequentTitle(source, '구문')}
        hint={split.frequentStructures.length ? `${split.frequentStructures.length}개` : undefined}
        icon={<Repeat2 className="w-3.5 h-3.5 text-violet-600" />}
        iconBg="bg-violet-500/15"
      >
        {split.frequentStructures.length === 0 ? (
          <EmptyLine text={frequentEmptyText(source, '구문')} />
        ) : (
          <StructureChips items={split.frequentStructures} unit={unit} />
        )}
      </Board>

      {/* ⚠️ 예전 제목 "자주 틀리는 단어·구문" 은 틀린 라벨이었다 —
          이 제품은 학생 답안지를 받지 않아 오답률을 알 수 없다. 실제 근거로 제목을 바꿨다. */}
      <Board
        title={trapTitle(source)}
        hint={traps.length ? `${traps.length}개` : undefined}
        icon={<AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
        iconBg="bg-red-500/15"
      >
        <p className="text-[11px] text-slate-400 mb-2">{trapHint(source)}</p>
        {traps.length === 0 ? (
          <EmptyLine text={trapEmptyText(source)} />
        ) : (
          <MixedChips items={traps} />
        )}
      </Board>

      <Board
        title="이번 시험 단어장"
        hint={`${pack.vocab.length}개`}
        icon={<Languages className="w-3.5 h-3.5 text-emerald-600" />}
        iconBg="bg-emerald-500/15"
      >
        {pack.vocab.length === 0 ? (
          <EmptyLine text="뽑아 둔 단어가 없습니다." />
        ) : (
          <TermTable items={pack.vocab} unit={unit} />
        )}
      </Board>

      <Board
        title="이번 시험 구문"
        hint={`${pack.structures.length}개`}
        icon={<Quote className="w-3.5 h-3.5 text-violet-600" />}
        iconBg="bg-violet-500/15"
      >
        {pack.structures.length === 0 ? (
          <EmptyLine text="뽑아 둔 구문이 없습니다." />
        ) : (
          <StructureTable items={pack.structures} unit={unit} />
        )}
      </Board>

      <div className="flex justify-end">
        <button type="button" onClick={retry} className="text-xs text-primary hover:underline font-medium px-3 py-1.5">
          다시 정리
        </button>
      </div>
    </div>
  );
}

function Board({
  title, hint, icon, iconBg, children,
}: {
  title: string;
  hint?: string;
  icon: ReactNode;
  iconBg: string;
  children: ReactNode;
}) {
  return (
    <div className="border rounded-sm overflow-hidden bg-white">
      <div className="px-4 py-3 flex items-center gap-3 border-b">
        <div className={`w-7 h-7 rounded-sm ${iconBg} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {hint && <span className="text-xs text-slate-400 ml-2">{hint}</span>}
        </div>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/** 분석 직후 백그라운드 추출이 도는 동안의 화면. 끝나면 부모가 새 팩을 내려준다. */
function PreparingView({ hasSeed }: { hasSeed: boolean }) {
  return (
    <div className="space-y-4">
      <div className="border rounded-sm bg-white px-4 py-5 flex items-start gap-3">
        <MathSpinner size="sm" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">시험지에서 단어·구문을 뽑고 있습니다</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            분석 직후 자동으로 진행됩니다. 끝나면 이 화면이 바뀌니 다른 탭을 보고 계셔도 됩니다.
            {hasSeed && ' 지금은 문항 분석에서 모은 표현만 있습니다.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-sm" />
        ))}
      </div>
    </div>
  );
}

/** 결과는 보여주되 "완전한 결과가 아니다"를 알리는 줄. 조용한 폴백을 막는다. */
function NoticeStrip({
  text, onRetry, retryLabel = '다시 정리',
}: {
  text: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="border border-amber-200 bg-amber-50/70 rounded-sm px-3 py-2 flex items-start gap-2">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
      <p className="text-xs text-amber-900 leading-relaxed flex-1 min-w-0">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs text-amber-900 font-semibold underline underline-offset-2 shrink-0"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 text-center py-3">{text}</p>;
}

function TermChips({ items, unit }: { items: EnglishStudyTerm[]; unit: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.word}
          className="inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-sm border bg-emerald-50/60"
        >
          <span className="text-sm font-semibold text-slate-900">{item.word}</span>
          {item.meaning && <span className="text-xs text-slate-500">{item.meaning}</span>}
          {item.count >= 2 && <span className="text-[10px] font-medium text-indigo-600">{item.count}{unit}</span>}
        </span>
      ))}
    </div>
  );
}

function StructureChips({ items, unit }: { items: EnglishStudyStructure[]; unit: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.pattern}
          className="inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-sm border bg-violet-50/60"
        >
          <span className="text-sm font-semibold text-slate-900">{item.pattern}</span>
          {item.meaning && <span className="text-xs text-slate-500">{item.meaning}</span>}
          {item.count >= 2 && <span className="text-[10px] font-medium text-indigo-600">{item.count}{unit}</span>}
        </span>
      ))}
    </div>
  );
}

function MixedChips({
  items,
}: {
  items: Array<{ kind: 'vocab' | 'structure'; text: string; meaning: string | null; count: number }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={`${item.kind}-${item.text}`}
          className={`inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-sm border ${
            item.kind === 'vocab' ? 'bg-emerald-50/60' : 'bg-violet-50/60'
          }`}
        >
          <span className="text-[10px] font-bold text-slate-500">{item.kind === 'vocab' ? '단어' : '구문'}</span>
          <span className="text-sm font-semibold text-slate-900">{item.text}</span>
          {item.meaning && <span className="text-xs text-slate-500">{item.meaning}</span>}
        </span>
      ))}
    </div>
  );
}

function TermTable({ items, unit }: { items: EnglishStudyTerm[]; unit: string }) {
  return (
    <div className="divide-y divide-slate-100">
      {items.map((item) => (
        <div key={item.word} className="flex items-baseline justify-between gap-3 py-1.5">
          <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{item.word}</span>
            {item.meaning && <span className="text-xs text-slate-500">{item.meaning}</span>}
          </div>
          {item.count >= 2 && (
            <span className="text-[10px] font-medium text-indigo-600 shrink-0">{item.count}{unit}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function StructureTable({ items, unit }: { items: EnglishStudyStructure[]; unit: string }) {
  return (
    <div className="divide-y divide-slate-100">
      {items.map((item) => (
        <div key={item.pattern} className="flex items-baseline justify-between gap-3 py-1.5">
          <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{item.pattern}</span>
            {item.meaning && <span className="text-xs text-slate-500">{item.meaning}</span>}
          </div>
          {item.count >= 2 && (
            <span className="text-[10px] font-medium text-indigo-600 shrink-0">{item.count}{unit}</span>
          )}
        </div>
      ))}
    </div>
  );
}
