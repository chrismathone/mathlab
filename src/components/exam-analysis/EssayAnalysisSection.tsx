'use client';

import { useMemo } from 'react';
import { normalizeDifficultyKey as normalizeDiff } from '@/lib/exam-analysis/shared/difficulty';
import { DIFFICULTY_COLORS } from '@/lib/exam-analysis/constants';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import { sumPoints } from '@/lib/exam-analysis/points';
import { FileText } from 'lucide-react';
import { isEssay } from '@/lib/exam-analysis/shared/question-format';

interface EssayAnalysisSectionProps {
  questions: AnalyzedQuestion[];
  totalQuestions: number;
  totalPoints: number;
  subject?: string;
}


const DIFFICULTY_LABELS: Record<string, string> = {
  '1': '1(기본)', '2': '2(표준)', '3': '3(응용)', '4': '4(심화)', '5': '5(최고)',
  concept: '1(기본)', pattern: '2(표준)', reasoning: '4(심화)', creative: '5(최고)',
};

const DIFFICULTY_ORDER = ['1', '2', '3', '4', '5'] as const;

export function EssayAnalysisSection({ questions, totalQuestions, totalPoints, subject }: EssayAnalysisSectionProps) {
  // 서술형 문항만 필터
  const essayQuestions = useMemo(
    () => questions.filter(isEssay),
    [questions],
  );

  // 기본 통계
  const stats = useMemo(() => {
    const count = essayQuestions.length;
    const pts = sumPoints(essayQuestions.map((q) => q.points));
    const avgPtsPerQ = count > 0 ? (pts / count) : 0;

    // 평균 난이도 계산
    const diffLevels: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, concept: 1, pattern: 2, reasoning: 4, creative: 5 };
    const avgDiffLevel = count > 0
      ? essayQuestions.reduce((s, q) => s + (diffLevels[normalizeDiff(q.difficulty) ?? ''] || diffLevels[q.difficulty ?? ''] || 3), 0) / count
      : 0;
    const avgDiffKey = avgDiffLevel >= 4.5 ? '5'
      : avgDiffLevel >= 3.5 ? '4'
      : avgDiffLevel >= 2.5 ? '3'
      : avgDiffLevel >= 1.5 ? '2'
      : '1';

    return {
      count,
      countPct: totalQuestions > 0 ? Math.round((count / totalQuestions) * 100) : 0,
      totalPts: pts,
      ptsPct: totalPoints > 0 ? Math.round((pts / totalPoints) * 100) : 0,
      avgDiffLabel: DIFFICULTY_LABELS[avgDiffKey] || '유형',
      avgDiffKey,
      avgPtsPerQ: avgPtsPerQ.toFixed(1),
    };
  }, [essayQuestions, totalQuestions, totalPoints]);

  // 난이도 분포 (5단계, 레거시 통합)
  const diffDistribution = useMemo(() => {
    const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const q of essayQuestions) {
      const nd = normalizeDiff(q.difficulty);
      if (nd != null) counts[nd] = (counts[nd] || 0) + 1;   // 미정 제외
    }
    const total = essayQuestions.length || 1;
    return DIFFICULTY_ORDER
      .map(key => ({
        key,
        label: DIFFICULTY_LABELS[key],
        count: counts[key] || 0,
        pct: Math.round(((counts[key] || 0) / total) * 100),
        color: DIFFICULTY_COLORS[key],
      }))
      .filter(d => d.count > 0);
  }, [essayQuestions]);

  // 단원별 출제 현황
  const topicList = useMemo(() => {
    const map = new Map<string, { count: number; pts: number }>();
    for (const q of essayQuestions) {
      const topic = q.topic || '미분류';
      // 마지막 소단원 이름만 추출
      const shortTopic = topic.split(' > ').pop() || topic;
      const existing = map.get(shortTopic) || { count: 0, pts: 0 };
      existing.count++;
      existing.pts += q.points || 0;
      map.set(shortTopic, existing);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [essayQuestions]);

  // 서술형 문항이 없으면 미표시
  if (essayQuestions.length === 0) return null;

  const maxDiff = Math.max(...diffDistribution.map(d => d.count), 1);

  return (
    <div className="rounded-sm overflow-hidden bg-white border">
      {/* 헤더 */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-sm bg-amber-500/15 flex items-center justify-center">
            <FileText className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="text-sm font-bold text-amber-900">서술형 문항 집중 분석</h3>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-sm bg-amber-500/15 text-xs font-bold text-amber-700">
          배점 가중치 {stats.ptsPct}%
        </span>
      </div>

      {/* 4개 통계 카드 */}
      <div className="px-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="문항 수"
          value={`${stats.count}문항`}
          sub={`전체의 ${stats.countPct}%`}
        />
        <StatCard
          label="총 배점"
          value={`${stats.totalPts}점`}
          sub={`전체의 ${stats.ptsPct}%`}
        />
        <StatCard
          label="평균 난이도"
          value={stats.avgDiffLabel}
          sub={subject === 'ENGLISH' ? 'AI 추정·교사 판단' : '5단계 기준'}
          valueColor={DIFFICULTY_COLORS[stats.avgDiffKey]}
        />
        <StatCard
          label="문항당 배점"
          value={`${stats.avgPtsPerQ}점`}
          sub="평균"
        />
      </div>

      {/* 2컬럼 그리드: 난이도 분포 + 단원별 출제 현황 */}
      <div className="px-5 pt-4 pb-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 난이도 분포 */}
        <div className="bg-white/70 backdrop-blur-sm rounded-sm p-4 shadow-sm">
          <h4 className="text-xs font-semibold text-amber-900 mb-3">난이도 분포</h4>
          <div className="space-y-2.5">
            {diffDistribution.map(d => (
              <div key={d.key} className="flex items-center gap-2.5">
                <span className="w-10 text-xs font-medium text-slate-700 shrink-0">{d.label}</span>
                <div className="flex-1 bg-amber-100/60 rounded-sm h-5 overflow-hidden">
                  <div
                    className="h-full rounded-sm flex items-center justify-end pr-2 text-white text-[10px] font-bold transition-all"
                    style={{
                      width: `${Math.max((d.count / maxDiff) * 100, 18)}%`,
                      backgroundColor: d.color,
                    }}
                  >
                    {d.count}
                  </div>
                </div>
                <span className="w-10 text-right text-xs text-slate-500 tabular-nums shrink-0">{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* 단원별 출제 현황 */}
        <div className="bg-white/70 backdrop-blur-sm rounded-sm p-4 shadow-sm">
          <h4 className="text-xs font-semibold text-amber-900 mb-3">단원별 출제 현황</h4>
          {topicList.length > 0 ? (
            <div className="space-y-2">
              {topicList.map((t, i) => (
                <div key={t.name} className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center text-[10px] font-bold text-amber-700 shrink-0">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-xs text-slate-700 truncate">{t.name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{t.count}문항</span>
                  <span className="text-[10px] text-slate-400 w-10 text-right shrink-0">{t.pts}점</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-3">단원 정보가 없습니다</p>
          )}
        </div>
      </div>

      {/* 하단 안내 메시지 */}
      <div className="px-5 pb-5 pt-2">
        <p className="text-xs text-amber-800/80 leading-relaxed bg-amber-500/8 rounded-sm px-3.5 py-2.5 border border-amber-300/30">
          {subject === 'ENGLISH'
            ? `서술형 배점은 전체의 ${stats.ptsPct}%입니다. 실제 변별력은 학생 응답으로 확인해야 하며, 부분점수·감점은 문항별 채점 기준을 따릅니다.`
            : <>서술형 문항은 배점이 높고 변별력이 큰 문항입니다. 전체 배점의 {stats.ptsPct}%로 {stats.ptsPct >= 30 ? '높은' : stats.ptsPct >= 15 ? '적절한' : '낮은'} 비중을 차지하고 있습니다.</>}
        </p>
      </div>
    </div>
  );
}

// ── 통계 카드 서브 컴포넌트 ──

function StatCard({ label, value, sub, valueColor }: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-sm p-3 text-center shadow-sm">
      <p className="text-[10px] font-medium text-amber-700/70 mb-1">{label}</p>
      <p className="text-base font-bold text-slate-800" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </p>
      <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}
