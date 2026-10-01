'use client';

import React, { useState, useMemo } from 'react';
import { normalizeDifficultyKey as normalizeDifficulty } from '@/lib/exam-analysis/shared/difficulty';
import { DIFFICULTY_COLORS, DIFFICULTY_LABELS as DIFF_LABELS_MAP, ENGLISH_TYPE_TO_DOMAIN, ENGLISH_ABILITY_DOMAIN_COLORS } from '@/lib/exam-analysis/constants';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import { sumPoints, roundPoints, formatPoints } from '@/lib/exam-analysis/points';
import { ChevronRight, AlertTriangle, Pencil, Check, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { toast } from '@/components/ui/Toast';
import { getEnglishTopicOptionsByGrade, getEnglishTopicOptionsGrouped } from './topic-options';
import type { AnalysisResultViewProps } from '../shared/view-props';

// 차트 컴포넌트 (recharts는 SSR 미지원이므로 lazy load)
const TypeRadarChart = dynamic(() => import('./charts/TypeRadarChart').then(m => ({ default: m.EnglishTypeRadarChart })), { ssr: false });
const QuestionPointsChart = dynamic(() => import('../charts/QuestionPointsChart').then(m => ({ default: m.QuestionPointsChart })), { ssr: false });
const DifficultyDonutChart = dynamic(() => import('../charts/DifficultyDonutChart').then(m => ({ default: m.DifficultyDonutChart })), { ssr: false });

// 추가 분석 섹션
import { EssayAnalysisSection } from '../EssayAnalysisSection';
import { EnglishEvidencePanel } from './EnglishEvidencePanel';
import { readCompleteness } from '@/lib/exam-analysis/readiness';
import { InfoTooltip } from '../InfoTooltip';
import { QuestionFeedbackButton } from '../QuestionFeedbackButton';
import { groupByFormat } from '@/lib/exam-analysis/shared/question-format';

const DIFFICULTY_LABELS: Record<string, string> = {
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
  concept: '1', pattern: '2', reasoning: '4', creative: '5',
};

/** 난이도 키를 5단계로 정규화 */

const _FORMAT_LABELS: Record<string, string> = {
  objective: '객관식', short_answer: '단답형', essay: '서술형',
};

const ENGLISH_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'grammar', label: '어법' }, { value: 'vocabulary', label: '어휘' },
  { value: 'reading', label: '독해' },
  { value: 'writing', label: '서술·영작' }, { value: 'communication', label: '의사소통' },
];
const ENGLISH_LISTENING_OPTION = { value: 'listening', label: '듣기' };
const ENGLISH_ABILITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'accuracy', label: '정확성' }, { value: 'understanding', label: '이해력' },
  { value: 'reasoning', label: '추론력' }, { value: 'expression', label: '표현력' },
];

/** 만점·문항별 배점을 모두 확인하고 합계를 대조한다. */
function checkPointsReliable(qs: AnalyzedQuestion[], expectedTotal: number | null) {
  const total = (expectedTotal && expectedTotal > 0) ? roundPoints(expectedTotal) : 0;
  const nullCount = qs.filter((q) => q.points == null).length;
  const pointsSum = sumPoints(qs.map((q) => q.points)); // 부동소수점 오차 제거
  const deviationPct = total > 0 ? Math.round(Math.abs(pointsSum - total) / total * 100) : 0;

  if (!total) return { reliable: false, pointsSum, total, deviationPct, reason: '시험지 만점을 확인하지 못했습니다' };
  if (nullCount > 0) {
    return { reliable: false, pointsSum, total, deviationPct, reason: `${nullCount}개 문항의 배점을 인식하지 못했습니다` };
  }
  if (roundPoints(pointsSum - total) !== 0) {
    return { reliable: false, pointsSum, total, deviationPct, reason: `배점 합계 ${formatPoints(pointsSum)}점 (기준 ${total}점, ${deviationPct}% 차이)` };
  }
  return { reliable: true, pointsSum, total, deviationPct, reason: '' };
}

/**
 * 배점 자동 보정 제안 — 합계가 만점에서 ±1~10점 벗어나면 가장 신뢰도 낮은 문항을 조정 후보로 제시.
 * 사용자 보고 (2026-05-27): 101점으로 분석된 케이스 → 11번 배점이 11→3점으로 잘못 인식되어 -8점,
 * 다른 보정으로 +9점 → 순 +1점 초과. 100점 만점이 알려져 있으면 가장 낮은 신뢰도 문항을 ±1점 조정 제안.
 */
function getPointsSuggestion(qs: AnalyzedQuestion[], expectedTotal: number | null): {
  needed: boolean;
  diff: number; // (현재 합계) - (기준 만점). 양수면 초과, 음수면 부족
  target: AnalyzedQuestion;
  newPoints: number;
  reason: string;
} | null {
  if (expectedTotal == null || expectedTotal <= 0 || qs.some(q => q.points == null)) return null;
  const total = roundPoints(expectedTotal);
  const pointsSum = sumPoints(qs.map((q) => q.points)); // 부동소수점 오차 제거
  const diff = roundPoints(pointsSum - total);
  // 표준 만점에서 ±1~10점 벗어난 경우만 보정 제안 (그 이상이면 별도 검토 필요).
  // diff가 0이면(부동소수점 오차 포함 정확히 만점) 보정 불필요 → null.
  if (diff === 0 || Math.abs(diff) > 10) return null;
  // 가장 신뢰도 낮은 문항 (배점 > 0 + null/0이 아닌 것 중) → confidence ASC 정렬
  const candidates = qs
    .filter((q) => (q.points ?? 0) > 0 && (q.confidence ?? 1) < 1)
    .sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1));
  if (candidates.length === 0) return null;
  const target = candidates[0];
  const currentPts = target.points ?? 0;
  const newPts = roundPoints(currentPts - diff); // diff>0(초과)이면 -, diff<0(부족)이면 + (반올림으로 노이즈 제거)
  if (newPts < 1 || newPts > 50) return null; // 비현실적 배점은 제외
  return {
    needed: true,
    diff,
    target,
    newPoints: newPts,
    reason: target.confidence_reason || (target.confidence === 0 ? '배점 추정' : '신뢰도 낮음'),
  };
}

// ── 메인 컴포넌트 ──

export function EnglishAnalysisResultView({ questions: questionsProp, summary, totalPoints: _totalPoints, earnedPoints: _earnedPoints, examType, examPaperId, analysisId, onDifficultyEdit, grade, onRefresh }: AnalysisResultViewProps) {
  // 수동 편집 로컬 오버레이 (페이지 리로드 없이 즉시 표시) — 종합 통계도 즉시 갱신
  const [editedTopics, setEditedTopics] = React.useState<Record<string, string>>({});
  const [editedPoints, setEditedPoints] = React.useState<Record<string, number>>({});
  const [editedTypes, setEditedTypes] = React.useState<Record<string, string>>({});
  const [editedAbilities, setEditedAbilities] = React.useState<Record<string, string>>({});
  const questions = React.useMemo(() => {
    const anyEdit = Object.keys(editedTopics).length || Object.keys(editedPoints).length
      || Object.keys(editedTypes).length || Object.keys(editedAbilities).length;
    if (!anyEdit) return questionsProp;
    return questionsProp.map((q) => {
      const key = String(q.question_number);
      const topic = editedTopics[key];
      const points = editedPoints[key];
      const qtype = editedTypes[key];
      const ability = editedAbilities[key];
      if (topic === undefined && points === undefined && qtype === undefined && ability === undefined) return q;
      return {
        ...q,
        ...(topic !== undefined ? { topic } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(qtype !== undefined ? { question_type: qtype as typeof q.question_type } : {}),
        ...(ability !== undefined ? { ability_domain: ability as typeof q.ability_domain } : {}),
      };
    });
  }, [questionsProp, editedTopics, editedPoints, editedTypes, editedAbilities]);
  const handleTopicUpdate = React.useCallback((qNum: string | number, newTopic: string) => {
    setEditedTopics((prev) => ({ ...prev, [String(qNum)]: newTopic }));
  }, []);
  const handlePointsUpdate = React.useCallback((qNum: string | number, newPoints: number) => {
    setEditedPoints((prev) => ({ ...prev, [String(qNum)]: newPoints }));
  }, []);
  const handleTypeUpdate = React.useCallback((qNum: string | number, v: string) => {
    setEditedTypes((prev) => ({ ...prev, [String(qNum)]: v }));
  }, []);
  const handleAbilityUpdate = React.useCallback((qNum: string | number, v: string) => {
    setEditedAbilities((prev) => ({ ...prev, [String(qNum)]: v }));
  }, []);
  const isStudentExam = examType === 'student';
  const completeness = readCompleteness(summary);
  const expectedTotal = completeness ? completeness.declaredPoints : _totalPoints;

  // 배점 신뢰도 판정
  const pointsCheck = useMemo(
    () => checkPointsReliable(questions, expectedTotal),
    [questions, expectedTotal]
  );

  // 배점 자동 보정 제안 (101점/99점 같은 small deviation에 대해 가장 낮은 신뢰도 문항 조정)
  const pointsSuggestion = useMemo(
    () => getPointsSuggestion(questions, expectedTotal),
    [questions, expectedTotal]
  );

  // 자동 보정 적용 핸들러 — 제안된 문항의 배점을 PATCH 후 로컬 state 갱신
  const [applyingFix, setApplyingFix] = React.useState(false);
  const handleApplyPointsFix = async () => {
    if (!pointsSuggestion || !examPaperId) return;
    setApplyingFix(true);
    try {
      const qNum = pointsSuggestion.target.question_number;
      const res = await fetch(
        `/api/exam-analysis/${examPaperId}/questions/${encodeURIComponent(String(qNum))}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: pointsSuggestion.newPoints }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || '배점 수정 실패');
      }
      toast.success(`${qNum}번 배점이 ${pointsSuggestion.target.points}점 → ${pointsSuggestion.newPoints}점으로 보정되었습니다`);
      // 페이지 새로고침으로 새 데이터 fetch (questions 상태가 prop이라 직접 변경 불가)
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '보정 실패');
    } finally {
      setApplyingFix(false);
    }
  };

  // 난이도 분포 (5단계, 레거시 키 통합)
  const diffData = useMemo(() => {
    if (!summary?.difficulty_distribution) return [];
    const d = summary.difficulty_distribution as Record<string, number>;
    // 레거시 키 통합
    const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const [key, val] of Object.entries(d)) {
      if (!val || typeof val !== 'number') continue;
      const normalized = normalizeDifficulty(key);
      if (normalized != null && counts[normalized] !== undefined) {
        counts[normalized] += val;
      }
    }
    const LEVELS = ['1', '2', '3', '4', '5'] as const;
    const items = LEVELS.map(key => ({
      key,
      count: counts[key] || 0,
      color: DIFFICULTY_COLORS[key] || '#94A3B8',
      label: DIFF_LABELS_MAP[key] || key,
    }));
    const total = items.reduce((s, i) => s + i.count, 0);
    return items.map(i => ({ ...i, pct: total > 0 ? Math.round((i.count / total) * 100) : 0 }));
  }, [summary]);

  // 유형 분포는 하단 TypeRadarChart에서 표시

  // 배점 평균 (객관식 / 단답형 / 서술형)
  const pointsAvg = useMemo(() => {
    // groupByFormat 은 반드시 세 칸 중 하나에 넣는다 — 형식이 비어 있거나
    // AI 가 'Essay' 같은 변형을 준 문항이 어느 칸에도 안 들어가 합계가 모자라던 문제.
    const { objective: obj, short_answer: short, essay: ess } = groupByFormat(questions);
    const avg = (arr: typeof questions) => arr.length > 0
      ? Math.round(arr.reduce((s, q) => s + (q.points || 0), 0) / arr.length * 10) / 10
      : 0;
    const totalPts = (arr: typeof questions) => sumPoints(arr.map((q) => q.points));
    return {
      objective: { count: obj.length, avg: avg(obj), total: totalPts(obj) },
      shortAnswer: { count: short.length, avg: avg(short), total: totalPts(short) },
      essay: { count: ess.length, avg: avg(ess), total: totalPts(ess) },
    };
  }, [questions]);

  // 단원별 출제현황 (중단원 그룹핑)
  const topicGroups = useMemo(() => {
    const map = new Map<string, { count: number; totalPts: number; minors: Map<string, { count: number; pts: number }> }>();
    for (const q of questions) {
      const topic = q.topic || '미분류';
      const parts = topic.split(' > ');
      const middle = parts.length >= 2 ? parts.slice(0, 2).join(' > ') : topic;
      const minor = parts.length >= 3 ? parts[2] : '';

      if (!map.has(middle)) map.set(middle, { count: 0, totalPts: 0, minors: new Map() });
      const group = map.get(middle)!;
      group.count++;
      group.totalPts += q.points || 0;
      if (minor) {
        const m = group.minors.get(minor) || { count: 0, pts: 0 };
        m.count++;
        m.pts += q.points || 0;
        group.minors.set(minor, m);
      }
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name: name.split(' > ').pop() || name,
        fullName: name,
        ...data,
        totalPts: roundPoints(data.totalPts), // 부동소수점 누적 오차 제거 (60.40000000000006 → 60.4)
        minorList: Array.from(data.minors.entries()).map(([n, d]) => ({ name: n, count: d.count, pts: roundPoints(d.pts) })),
      }))
      .sort((a, b) => b.count - a.count);
  }, [questions]);

  // 문항 그룹 (객관식 / 단답형 / 서술형 분리)
  const grouped = useMemo(() => {
    // 형식 미상 문항이 표에서 통째로 사라지던 버그 — groupByFormat 은 전수 분배를 보장한다.
    const g = groupByFormat(questions);
    return { objective: g.objective, shortAnswer: g.short_answer, essay: g.essay };
  }, [questions]);

  const total = questions.length;
  const colSpan = isStudentExam ? 9 : 8;
  const maxTopic = Math.max(...topicGroups.map(t => t.count), 1);

  // 신뢰도 평균
  const avgConfidence = questions.length > 0
    ? Math.round(questions.reduce((s, q) => s + (q.confidence || 0), 0) / questions.length * 100)
    : 0;

  const CHART_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#06b6d4', '#ef4444', '#84cc16'];

  return (
    <div className="space-y-4">
      {/* ── AI 분석 신뢰도 ── */}
      <div className="bg-white border rounded-sm p-3 flex items-center gap-3">
        <span className="text-sm text-slate-600">AI 분석 신뢰도</span>
        <InfoTooltip content={
          <>
            <p className="font-semibold mb-1">신뢰도란?</p>
            <p className="mb-2">AI가 각 문항의 <strong>메타데이터(난이도·유형·단원·배점)</strong>를 판별하면서 <strong>스스로 매긴</strong> 확신도의 평균입니다.</p>
            <p className="mb-2">정답과 대조해 측정한 정확도가 <strong>아니므로</strong>, 이 수치가 높다고 분석이 맞다는 보장은 아닙니다. <strong>어느 문항부터 검토할지 고를 때</strong> 쓰세요 — 난이도·단원은 문항별로 직접 교정할 수 있습니다.</p>
            <p className="font-semibold mb-1">신뢰도가 낮아지는 경우:</p>
            <ul className="list-disc list-inside space-y-0.5 mb-2">
              <li>문항 텍스트가 불명확하거나 스캔 품질이 낮음</li>
              <li>비정형적인 문제 유형이나 출제 형식</li>
              <li>교육과정에 없는 내용이 포함됨</li>
              <li>배점이 추정값인 경우 (시험지에 점수 표기 누락)</li>
              <li>출제범위 외 단원이 의심되는 경우</li>
            </ul>
            <p className="text-xs text-slate-500 leading-relaxed">ℹ️ AI는 시험지의 메타데이터만 추출하며 문제 풀이를 직접 수행하지는 않습니다. 다만 자율 추론 과정에서 &ldquo;계산 결과가 선택지에 없음&rdquo; 같은 자체 검산 사유가 표시될 수 있습니다 (이 경우 OCR 오인식 또는 출제 오류일 수 있으니 해당 문항은 수동 확인 권장).</p>
          </>
        } />
        <span className={`text-sm font-bold ${avgConfidence >= 90 ? 'text-emerald-600' : avgConfidence >= 70 ? 'text-yellow-600' : 'text-red-500'}`}>
          {avgConfidence}%
        </span>
        <span className="text-xs text-slate-400">
          {avgConfidence >= 90 ? '분석 결과를 신뢰할 수 있습니다.' : avgConfidence >= 70 ? '대부분 신뢰할 수 있습니다.' : '일부 문항의 정확도가 낮습니다.'}
        </span>
        <div className="ml-auto flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />90%+</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />70-89%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />&lt;70%</span>
        </div>
      </div>

      {/* ══ 배점 인식 경고 배너 ══ */}
      {!pointsCheck.reliable && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">배점 인식 불안정</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {pointsCheck.reason} — 배점 기반 분석(배점 분포, 서술형 분석, 문항별 배점, 변별력)이 숨겨집니다.
              난이도·유형·단원 분석은 정상 표시됩니다.
            </p>
          </div>
        </div>
      )}

      {/* ══ 배점 자동 보정 제안 (small deviation ±1~10점) ══ */}
      {pointsCheck.reliable && pointsSuggestion?.needed && examPaperId && (
        <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800">
              배점 합계 {formatPoints(pointsCheck.pointsSum)}점 · 만점 {pointsCheck.total}점에서 {pointsSuggestion.diff > 0 ? '+' : ''}{formatPoints(pointsSuggestion.diff)}점 차이
            </p>
            <p className="text-xs text-blue-700 mt-1">
              신뢰도 낮은 문항 배점을 제안값으로 조정하면 합계가 만점과 맞습니다:
              <span className="font-semibold mx-1">
                {pointsSuggestion.target.question_number}번 {formatPoints(pointsSuggestion.target.points)}점 → {formatPoints(pointsSuggestion.newPoints)}점
              </span>
              <span className="text-blue-500">(사유: {pointsSuggestion.reason})</span>
            </p>
            <p className="text-xs font-bold text-red-600 mt-1.5 flex items-start gap-1">
              <span className="shrink-0">⚠️</span>
              <span>이 제안은 <u>신뢰도 기반 추정</u>입니다. <strong>반드시 시험지 원본을 확인</strong>한 후 적용하거나, 아래 문항 테이블에서 정확한 배점을 직접 수정해 주세요.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleApplyPointsFix}
            disabled={applyingFix}
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 rounded-sm shrink-0"
          >
            {applyingFix ? '적용 중...' : '배점 제안 적용'}
          </button>
        </div>
      )}

      {/* ══ Row 1: 난이도/배점 도넛 + 유형 레이더 (2컬럼) ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 난이도/배점 분포 (도넛차트, 토글) */}
        <DifficultyDonutChart diffData={diffData} total={total} pointsData={pointsCheck.reliable ? pointsAvg : undefined} />

        {/* 유형/능력 레이더 */}
        {summary?.type_distribution && (
          <TypeRadarChart data={summary.type_distribution as Record<string, number>} questions={questions} />
        )}
      </div>

      {/* ══ Row 2: 단원별 출제현황 (풀 와이드) ══ */}
      <div className="bg-white border rounded-sm p-4">
        <TopicSection topicGroups={topicGroups} maxTopic={maxTopic} total={total} chartColors={CHART_COLORS} />
      </div>

      {/* ══ Row 3: 서술형 분석 (배점 신뢰 시만) ══ */}
      {pointsCheck.reliable && (
        <EssayAnalysisSection
          questions={questions}
          totalQuestions={total}
          totalPoints={sumPoints(questions.map((q) => q.points))}
          subject="ENGLISH"
        />
      )}

      {/* ══ Row 4: 문항별 배점 (배점 신뢰 시만) ══ */}
      {pointsCheck.reliable && <QuestionPointsChart questions={questions} />}

      <p className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        난도는 AI 추정 또는 교사 판단입니다. 실제 오답률·변별력을 뜻하지 않습니다.
        문항별 응답 통계가 있으면 아래 확인·수정에서 응답 집단과 출처를 함께 기록할 수 있습니다.
      </p>
      <EnglishEvidencePanel
        key={`${examPaperId}:${analysisId}`} questions={questions}
        declaredPoints={readCompleteness(summary)?.declaredPoints ?? null}
        examPaperId={examPaperId} analysisId={analysisId} onSaved={onRefresh}
      />

      {/* ── Row 4: 문항 테이블 ── */}
      <Card title="문항별 분석">
        {(() => {
          // 난이도 보정 요약 — 어느 문항을 선생님이 보정했는지 한 줄로(배지는 깔끔히 유지)
          const edited = questions.filter((q) => {
            const ai = q.ai_difficulty != null ? normalizeDifficulty(String(q.ai_difficulty)) : null;
            return ai != null && ai !== normalizeDifficulty(q.difficulty);
          });
          if (edited.length === 0) return null;
          return (
            <div className="flex items-start gap-1.5 mb-3 px-0.5 text-[11px] flex-wrap">
              <span className="inline-flex items-center gap-1 font-medium text-primary shrink-0">
                <Pencil className="w-3 h-3" />선생님 난이도 보정 {edited.length}문항
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400">{edited.map((q) => q.question_number).join(' · ')}</span>
            </div>
          );
        })()}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 w-14">번호</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-16">난이도</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-20">유형</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-16">능력</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">단원</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-14">
                  배점{!pointsCheck.reliable && <AlertTriangle className="inline w-3 h-3 text-amber-400 ml-0.5 -mt-0.5" />}
                </th>
                {isStudentExam && <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-14">정답</th>}
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-16">신뢰도</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 w-16">피드백</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grouped.objective.length > 0 && (
                <>
                  <tr><td colSpan={colSpan} className="px-3 py-1.5 bg-sky-50 border-y border-sky-100">
                    <span className="text-xs font-semibold text-sky-600">객관식</span>
                    <span className="text-xs text-slate-400 ml-2">{grouped.objective.length}문항</span>
                  </td></tr>
                  {grouped.objective.map((q, i) => <QRow key={`o-${i}`} q={q} isStudent={isStudentExam} examPaperId={examPaperId} analysisId={analysisId} onDifficultyEdit={onDifficultyEdit} grade={grade} onTopicUpdate={handleTopicUpdate} onPointsUpdate={handlePointsUpdate} onTypeUpdate={handleTypeUpdate} onAbilityUpdate={handleAbilityUpdate} />)}
                </>
              )}
              {grouped.shortAnswer.length > 0 && (
                <>
                  <tr><td colSpan={colSpan} className="px-3 py-1.5 bg-teal-50 border-y border-teal-100">
                    <span className="text-xs font-semibold text-teal-600">단답형</span>
                    <span className="text-xs text-slate-400 ml-2">{grouped.shortAnswer.length}문항</span>
                  </td></tr>
                  {grouped.shortAnswer.map((q, i) => <QRow key={`s-${i}`} q={q} isStudent={isStudentExam} examPaperId={examPaperId} analysisId={analysisId} onDifficultyEdit={onDifficultyEdit} grade={grade} onTopicUpdate={handleTopicUpdate} onPointsUpdate={handlePointsUpdate} onTypeUpdate={handleTypeUpdate} onAbilityUpdate={handleAbilityUpdate} />)}
                </>
              )}
              {grouped.essay.length > 0 && (
                <>
                  <tr><td colSpan={colSpan} className="px-3 py-1.5 bg-amber-50 border-y border-amber-100">
                    <span className="text-xs font-semibold text-amber-600">서술형</span>
                    <span className="text-xs text-slate-400 ml-2">{grouped.essay.length}문항</span>
                  </td></tr>
                  {grouped.essay.map((q, i) => <QRow key={`e-${i}`} q={q} isStudent={isStudentExam} examPaperId={examPaperId} analysisId={analysisId} onDifficultyEdit={onDifficultyEdit} grade={grade} onTopicUpdate={handleTopicUpdate} onPointsUpdate={handlePointsUpdate} onTypeUpdate={handleTypeUpdate} onAbilityUpdate={handleAbilityUpdate} />)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── 서브 컴포넌트 ──

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}


function TopicSection({ topicGroups, maxTopic, total, chartColors }: {
  topicGroups: Array<{ name: string; fullName: string; count: number; totalPts: number; minorList: Array<{ name: string; count: number; pts: number }> }>;
  maxTopic: number; total: number; chartColors: string[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(topicGroups.map(t => t.fullName)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">단원별 출제현황</h3>
        <span className="text-xs text-slate-400">{topicGroups.length}개 중단원 · {total}문항</span>
      </div>
      <div className="space-y-1">
        {topicGroups.map((t, idx) => {
          const isOpen = expanded.has(t.fullName);
          const hasMinors = t.minorList.length > 0;
          const barColor = chartColors[idx % chartColors.length];

          return (
            <div key={t.fullName}>
              {/* 중단원 행 */}
              <div
                className={`flex items-center gap-2 py-1.5 ${hasMinors ? 'cursor-pointer' : ''}`}
                onClick={() => hasMinors && toggle(t.fullName)}
              >
                {hasMinors ? (
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                ) : (
                  <span className="w-3.5" />
                )}
                <span className="flex items-center gap-1.5 w-28 sm:w-36 shrink-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
                  <span className="text-xs text-slate-800 font-medium truncate">{t.name}</span>
                </span>
                <div className="flex-1 bg-slate-100 rounded-sm h-5 overflow-hidden">
                  <div
                    className="h-full rounded-sm flex items-center justify-end pr-2 text-white text-[10px] font-medium"
                    style={{ width: `${Math.max((t.count / maxTopic) * 100, 12)}%`, backgroundColor: barColor }}
                  >
                    {t.count}문항
                  </div>
                </div>
                <span className="w-12 text-right text-xs text-slate-500 tabular-nums shrink-0">{t.totalPts}점</span>
              </div>

              {/* 소단원 (확장) */}
              {isOpen && hasMinors && (
                <div className="ml-6 pl-4 border-l-2 border-slate-200 space-y-0.5 pb-2">
                  {t.minorList.map(m => (
                    <div key={m.name} className="flex items-center gap-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                      <span className="flex-1 text-xs text-slate-600">{m.name}</span>
                      <span className="w-12 text-right text-xs text-slate-400">{m.count}문항</span>
                      <span className="w-10 text-right text-xs text-slate-400">{m.pts}점</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {topicGroups.some(t => t.minorList.length > 0) && (
        <div className="text-right mt-2">
          <button
            onClick={expanded.size > 0 ? collapseAll : expandAll}
            className="text-xs text-primary hover:underline font-medium"
          >
            {expanded.size > 0 ? '모두 접기' : '모두 펼치기'}
          </button>
        </div>
      )}
    </>
  );
}


function QRow({ q, isStudent, examPaperId, analysisId, onDifficultyEdit, grade, onTopicUpdate, onPointsUpdate, onTypeUpdate, onAbilityUpdate }: {
  q: AnalyzedQuestion;
  isStudent: boolean;
  examPaperId?: string;
  analysisId?: string;
  onDifficultyEdit?: (qNum: string | number, difficulty: string, aiDifficulty: string | null) => void;
  grade?: string | null;
  onTopicUpdate?: (qNum: string | number, newTopic: string) => void;
  onPointsUpdate?: (qNum: string | number, newPoints: number) => void;
  onTypeUpdate?: (qNum: string | number, v: string) => void;
  onAbilityUpdate?: (qNum: string | number, v: string) => void;
}) {
  const TYPE_OPTIONS = q.question_type === 'listening'
    ? [...ENGLISH_TYPE_OPTIONS, ENGLISH_LISTENING_OPTION]
    : ENGLISH_TYPE_OPTIONS;
  const ABILITY_OPTIONS = ENGLISH_ABILITY_OPTIONS;
  const confPct = Math.round((q.confidence || 0) * 100);
  const confColor = confPct >= 90 ? 'text-emerald-600' : confPct >= 70 ? 'text-yellow-600' : 'text-red-500';
  const confBg = confPct >= 90 ? 'bg-emerald-50' : confPct >= 70 ? 'bg-yellow-50' : 'bg-red-50';
  const qNum = String(q.question_number);
  const numSize = qNum.length > 2 ? 'text-[10px]' : 'text-sm';
  // AI가 대문자 enum(CALCULATION/UNDERSTANDING/...)으로 반환하므로 소문자 정규화.
  // 유형·능력이 **둘 다** 없으면(= 분석 실패 문항) 추론으로 채우지 않는다 — 'calculation' 기본값을
  // 넣으면 AI가 판정한 것처럼 보여 오히려 교정을 막는다. 빈 값 → EnumCell이 '미정' 편집 버튼 렌더.
  const domainFallback = q.question_type
    ? ENGLISH_TYPE_TO_DOMAIN[q.question_type]
    : undefined;
  const rawDomain = q.ability_domain || domainFallback || (q.question_type ? 'accuracy' : '');
  const domain = String(rawDomain || '').toLowerCase();
  const domainColor = ENGLISH_ABILITY_DOMAIN_COLORS[domain] || '#94A3B8';
  // 난이도 보정 여부 — 번호 옆 점(•)으로 표시(배지는 미수정과 동일하게 깔끔히 유지)
  const curDiff = normalizeDifficulty(q.difficulty);
  const aiDiff = q.ai_difficulty != null ? normalizeDifficulty(String(q.ai_difficulty)) : null;
  const diffEdited = aiDiff != null && aiDiff !== curDiff;

  // ── Placeholder 판별 (v1.0.5 갭 자동 보정) ──
  // confidence=0이고 ai_comment가 ⚠️로 시작하면 자동 분석 실패 placeholder.
  // ⚠️ 이 행도 **정상 행과 동일한 편집 셀**을 써야 한다 — AI가 못 읽어 선생님이 직접 채워야 하는
  // 문항인데, 예전엔 전 칸을 정적 '—'로 렌더해 유일하게 수정 불가능한 행이었다(2026-07-21 수정).
  const isPlaceholder = q.confidence === 0 && (q.ai_comment?.startsWith('⚠️') ?? false);
  const placeholderTooltip = q.ai_comment || '자동 분석 실패';
  // 핵심 4개(난이도·유형·능력·단원)가 모두 채워지면 경고 표시 해제 → 정상 행과 동일하게 보인다
  const unresolved = isPlaceholder && !(q.difficulty && q.question_type && q.ability_domain && q.topic);

  return (
    <tr
      className={unresolved ? 'bg-amber-50 hover:bg-amber-100/60' : 'hover:bg-slate-50'}
      title={unresolved ? placeholderTooltip : undefined}
    >
      <td className={`px-3 py-2 font-semibold whitespace-nowrap ${numSize} ${unresolved ? 'text-amber-700' : 'text-slate-700'}`}>
        <span className="inline-flex items-center gap-1">
          {unresolved && <AlertTriangle className="w-3 h-3 shrink-0" />}
          {q.question_number}
          {diffEdited && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
              title={`선생님 난이도 보정 (AI 원본 ${aiDiff} → ${curDiff})`}
            />
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        <DifficultyCell q={q} examPaperId={examPaperId} onDifficultyEdit={onDifficultyEdit} />
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <EnumCell
          value={q.question_type}
          aiValue={q.ai_question_type}
          options={TYPE_OPTIONS}
          questionNumber={q.question_number}
          examPaperId={examPaperId}
          field="question_type"
          onUpdate={onTypeUpdate}
        />
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <EnumCell
          value={domain}
          aiValue={q.ai_ability_domain}
          options={ABILITY_OPTIONS}
          questionNumber={q.question_number}
          examPaperId={examPaperId}
          field="ability_domain"
          color={domainColor}
          onUpdate={onAbilityUpdate}
        />
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">
        <TopicCell
          topic={q.topic}
          questionNumber={q.question_number}
          examPaperId={examPaperId}
          grade={grade}
          onTopicUpdate={onTopicUpdate}
        />
      </td>
      <td className="px-3 py-2 text-center font-medium text-slate-700 whitespace-nowrap">
        <PointsCell
          points={q.points}
          questionNumber={q.question_number}
          examPaperId={examPaperId}
          onPointsUpdate={onPointsUpdate}
        />
      </td>
      {isStudent && (
        <td className="px-3 py-2 text-center">
          {q.is_correct === true && <span className="text-emerald-600 font-bold">O</span>}
          {q.is_correct === false && <span className="text-red-500 font-bold">X</span>}
          {q.is_correct == null && <span className="text-slate-300">-</span>}
        </td>
      )}
      <td className="px-3 py-2 text-center">
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
            isPlaceholder ? 'text-amber-700 bg-amber-100 cursor-help' : `${confColor} ${confBg} ${q.confidence_reason ? 'cursor-help' : ''}`
          }`}
          title={isPlaceholder ? (q.confidence_reason || placeholderTooltip) : (q.confidence_reason || undefined)}
        >
          {confPct}%
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        <QuestionFeedbackButton q={q} examPaperId={examPaperId} analysisId={analysisId} />
      </td>
    </tr>
  );
}

// ══════════════════════════════════════════
// 난이도 셀 — 인라인 1~5 교정 (AI 코멘트 탭과 동일 동작, 종합 난이도 즉시 재계산)
// ══════════════════════════════════════════

function DifficultyCell({ q, examPaperId, onDifficultyEdit }: {
  q: AnalyzedQuestion;
  examPaperId?: string;
  onDifficultyEdit?: (qNum: string | number, difficulty: string, aiDifficulty: string | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const cur = normalizeDifficulty(q.difficulty);
  // 분석 실패(placeholder) 문항은 difficulty=null — 빈 배지 대신 '미정' 입력 유도
  const unset = !q.difficulty;

  React.useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const save = async (lv: string) => {
    if (lv === cur) { setEditing(false); return; }
    if (!examPaperId) { toast.error('시험지 정보가 없습니다'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/exam-analysis/${examPaperId}/questions/${encodeURIComponent(String(q.question_number))}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ difficulty: lv }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || '난이도 수정 실패'); }
      const preservedAi = q.ai_difficulty != null ? String(q.ai_difficulty) : q.difficulty;
      onDifficultyEdit?.(q.question_number, lv, preservedAi);
      setEditing(false);
      toast.success(`${q.question_number}번 난이도 ${lv}로 수정`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '난이도 수정에 실패했습니다');
    } finally { setSaving(false); }
  };

  return (
    <div className="relative inline-flex items-center justify-center gap-0.5" ref={ref}>
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        title={unset ? '난이도 미인식 — 클릭하여 지정' : '클릭하여 난이도 수정'}
        className={
          unset
            ? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium hover:bg-amber-100'
            : 'inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-bold text-white hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 transition-all'
        }
        style={unset ? undefined : { backgroundColor: DIFFICULTY_COLORS[cur ?? ''] || DIFFICULTY_COLORS[q.difficulty ?? ''] || '#94A3B8' }}
      >
        {unset ? <><AlertTriangle className="w-3 h-3 shrink-0" />미정</> : (DIFFICULTY_LABELS[q.difficulty ?? ''] || cur)}
      </button>
      {editing && (
        <div className="absolute left-1/2 -translate-x-1/2 top-7 z-50 bg-white rounded-sm shadow-lg border p-1.5 flex items-center gap-1">
          {['1', '2', '3', '4', '5'].map((lv) => (
            <button
              key={lv}
              type="button"
              disabled={saving}
              onClick={() => save(lv)}
              className={`w-6 h-6 rounded-sm text-[11px] font-bold text-white transition-transform hover:scale-110 disabled:opacity-50 ${lv === cur ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
              style={{ backgroundColor: DIFFICULTY_COLORS[lv] }}
            >
              {lv}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// 단원 셀 — 표시/편집 모드 전환
// ══════════════════════════════════════════

function TopicCell({
  topic,
  questionNumber,
  examPaperId,
  grade,
  onTopicUpdate,
}: {
  topic: string | null | undefined;
  questionNumber: string | number;
  examPaperId?: string;
  grade?: string | null;
  onTopicUpdate?: (qNum: string | number, newTopic: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const currentTopic = (topic || '').trim();
  const isUnknown = !currentTopic || /UNKNOWN|미정|unknown/i.test(currentTopic);
  const includeListening = currentTopic.includes(' > 듣기');
  const options = React.useMemo(
    () => getEnglishTopicOptionsByGrade(grade, { includeListening }),
    [grade, includeListening],
  );
  const groupedOptions = React.useMemo(
    () => getEnglishTopicOptionsGrouped(grade, { includeListening }),
    [grade, includeListening],
  );
  const canEdit = !!examPaperId;

  // currentTopic을 옵션 value 형식으로 정규화 — AI가 저장하는 형식은
  // "중2 수학 > 수와 연산 > 유리수" (prefix 포함)이지만 옵션 value는
  // "수와 연산 > 유리수" (대단원 > 소단원)이라 직접 매칭 안 됨.
  // 모든 옵션 value를 모은 뒤 currentTopic의 끝부분과 매칭하거나, 단순히 마지막 2단계만 사용.
  const allOptionValues = React.useMemo(() => {
    const set = new Set<string>();
    groupedOptions.forEach((g) => g.options.forEach((o) => set.add(o.value)));
    options.forEach((o) => set.add(o));
    return set;
  }, [groupedOptions, options]);
  const normalizedCurrentTopic = React.useMemo(() => {
    if (!currentTopic || isUnknown) return '';
    // 1차: 그대로 매칭
    if (allOptionValues.has(currentTopic)) return currentTopic;
    // 2차: 마지막 2단계로 매칭 (대단원 > 소단원)
    const parts = currentTopic.split(' > ');
    if (parts.length >= 2) {
      const last2 = parts.slice(-2).join(' > ');
      if (allOptionValues.has(last2)) return last2;
    }
    // 3차: 부분 매칭 (옵션 value가 currentTopic의 일부로 포함)
    for (const v of allOptionValues) {
      if (currentTopic.endsWith(v) || currentTopic.includes(v)) return v;
    }
    return currentTopic;
  }, [currentTopic, isUnknown, allOptionValues]);

  const handleOpen = () => {
    setValue(isUnknown ? '' : normalizedCurrentTopic);
    setEditing(true);
  };
  const handleCancel = () => {
    setEditing(false);
    setValue('');
  };
  const handleSave = async () => {
    if (!examPaperId) return;
    const next = value.trim();
    if (!next) {
      toast.warning('단원을 선택하거나 입력하세요');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/exam-analysis/${examPaperId}/questions/${encodeURIComponent(String(questionNumber))}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: next }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || '저장 실패');
      }
      onTopicUpdate?.(questionNumber, next);
      toast.success('단원이 수정되었습니다');
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        {options.length > 0 ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 text-xs border rounded-sm focus:ring-1 focus:ring-primary focus:border-primary"
            disabled={saving}
            autoFocus
          >
            <option value="">선택</option>
            {groupedOptions.length > 0
              ? groupedOptions.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                ))
              : options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="단원 입력"
            className="flex-1 min-w-0 px-2 py-1 text-xs border rounded-sm focus:ring-1 focus:ring-primary focus:border-primary"
            disabled={saving}
            autoFocus
          />
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="p-1 rounded-sm text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
          title="저장"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="p-1 rounded-sm text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          title="취소"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (isUnknown) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={canEdit ? handleOpen : undefined}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium ${canEdit ? 'hover:bg-amber-100 cursor-pointer' : 'cursor-help'}`}
        title={canEdit
          ? 'AI가 단원을 확신하지 못했습니다. 클릭하여 수동으로 지정하세요.'
          : 'AI가 단원을 확신하지 못했습니다.'}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        {canEdit ? '미정 · 클릭하여 지정' : '미정'}
      </button>
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <span className="line-clamp-1 flex-1 min-w-0">{currentTopic}</span>
      {canEdit && (
        <button
          type="button"
          onClick={handleOpen}
          className="opacity-0 group-hover:opacity-100 p-1 rounded-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-opacity"
          title="단원 수정"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// 배점 셀 — 표시/편집 모드 전환 (사용자 수동 보정)
// ══════════════════════════════════════════

function PointsCell({
  points,
  questionNumber,
  examPaperId,
  onPointsUpdate,
}: {
  points: number | null;
  questionNumber: string | number;
  examPaperId?: string;
  onPointsUpdate?: (qNum: string | number, newPoints: number) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const canEdit = !!examPaperId;

  const handleOpen = () => {
    setValue(String(points ?? ''));
    setEditing(true);
  };
  const handleCancel = () => {
    setEditing(false);
    setValue('');
  };
  const handleSave = async () => {
    if (!examPaperId) return;
    // 소수 배점(4.5, 4.6 등) 허용 — parseInt는 4.6→4로 잘라 데이터를 손상시킴
    const next = roundPoints(parseFloat(value));
    if (!Number.isFinite(next) || next < 0 || next > 100) {
      toast.warning('배점은 0~100 사이의 숫자입니다');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/exam-analysis/${examPaperId}/questions/${encodeURIComponent(String(questionNumber))}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: next }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || '저장 실패');
      }
      onPointsUpdate?.(questionNumber, next);
      toast.success('배점이 수정되었습니다');
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-0.5 justify-center">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            else if (e.key === 'Escape') handleCancel();
          }}
          className="w-14 px-1.5 py-0.5 text-xs text-center border rounded-sm focus:ring-1 focus:ring-primary focus:border-primary"
          disabled={saving}
          autoFocus
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="p-0.5 rounded-sm text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
          title="저장"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="p-0.5 rounded-sm text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          title="취소"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const isMissing = points === null || points === 0;
  if (isMissing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={canEdit ? handleOpen : undefined}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium ${canEdit ? 'hover:bg-amber-100 cursor-pointer' : 'cursor-help'}`}
        title={canEdit ? '배점 미인식 — 클릭하여 입력' : '배점 미인식'}
      >
        <AlertTriangle className="w-3 h-3" />
        {canEdit ? '입력' : '?'}
      </button>
    );
  }

  return (
    <div className="group inline-flex items-center gap-0.5">
      <span>{formatPoints(points)}</span>
      {canEdit && (
        <button
          type="button"
          onClick={handleOpen}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-opacity"
          title="배점 수정"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── 유형·능력 인라인 교정 셀 (혼동맵 학습용 ground truth 수집) ──
function EnumCell({ value, aiValue, options, questionNumber, examPaperId, field, color, onUpdate }: {
  value: string | null | undefined; // 분석 실패 문항은 null — '미정'으로 표시하고 편집은 열어둔다
  aiValue?: string | null;
  options: { value: string; label: string }[];
  questionNumber: string | number;
  examPaperId?: string;
  field: 'question_type' | 'ability_domain';
  color?: string;
  onUpdate?: (qNum: string | number, v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const cur = value ? String(value).toLowerCase() : '';
  const unset = !cur;
  const label = unset ? '미정' : (options.find((o) => o.value === cur)?.label || value);
  const aiNorm = aiValue != null ? String(aiValue).toLowerCase() : null;
  const edited = aiNorm != null && aiNorm !== cur;

  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const save = async (v: string) => {
    if (v === cur) { setOpen(false); return; }
    if (!examPaperId) { toast.error('시험지 정보가 없습니다'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/exam-analysis/${examPaperId}/questions/${questionNumber}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: v }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || '수정 실패'); }
      onUpdate?.(questionNumber, v);
      setOpen(false);
      toast.success(`${questionNumber}번 ${field === 'question_type' ? '유형' : '능력'} 수정`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '수정 실패');
    } finally { setSaving(false); }
  };

  return (
    <div className="relative inline-flex items-center gap-0.5" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          unset
            ? 'AI가 인식하지 못했습니다 — 클릭하여 지정'
            : edited
              ? `선생님 수정 (AI 원본: ${options.find((o) => o.value === aiNorm)?.label || aiNorm})`
              : '클릭하여 수정'
        }
        className={
          unset
            ? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium hover:bg-amber-100'
            : 'text-xs font-medium hover:underline decoration-dotted'
        }
        style={!unset && color ? { color } : undefined}
      >
        {unset && <AlertTriangle className="w-3 h-3 shrink-0" />}
        {label}
      </button>
      {edited && <Pencil className="w-2.5 h-2.5 text-slate-400" />}
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-6 z-50 bg-white rounded-sm shadow-lg border py-1 min-w-[110px]">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={saving}
              onClick={() => save(o.value)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${o.value === cur ? 'font-bold text-primary' : 'text-slate-700'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
