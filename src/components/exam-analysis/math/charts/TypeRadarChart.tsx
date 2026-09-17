'use client';

import { useState, useMemo } from 'react';
import { countAbilities, countTypes } from '@/lib/exam-analysis/shared/chart-axes';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import {
  ABILITY_DOMAIN_LABELS,
  ABILITY_DOMAIN_COLORS,
  QUESTION_TYPE_KEYS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_COLORS,
  TYPE_TO_STANDARD,
} from '@/lib/exam-analysis/constants';
import type { TypeRadarChartProps } from '../../shared/view-props';

type ViewMode = 'type' | 'ability';

export function MathTypeRadarChart({ data, questions }: TypeRadarChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('ability');

  // 능력 영역 데이터 계산
  // 서버 차트(블로그 PNG)와 **같은 함수**를 쓴다 — 두 곳이 다르게 세면
  // 사용자는 어느 쪽을 믿어야 할지 모른다 (CLAUDE.md #12-4).
  const abilityData = useMemo(
    () => (questions?.length ? countAbilities('MATH', questions) : {}),
    [questions],
  );

  // 유형도 능력처럼 문항에서 직접 센다. 저장된 summary 는 분석 당시 값이라 선생님 교정이 안 잡힌다
  // (표는 '수와 연산' 2문항인데 차트는 '변화와 관계 100%' — 2026-09-17). 문항이 없을 때만 저장 분포로 폴백.
  const standardTypeData = useMemo(() => {
    if (questions?.length) return countTypes('MATH', questions);
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value <= 0) continue;
      const standard = TYPE_TO_STANDARD[key] || key;
      counts[standard] = (counts[standard] || 0) + value;
    }
    return counts;
  }, [data, questions]);

  const allItems = useMemo(() => {
    if (viewMode === 'ability') {
      const keys = ['calculation', 'understanding', 'problem_solving', 'reasoning'] as const;
      return keys.map((key) => ({
        key,
        label: ABILITY_DOMAIN_LABELS[key],
        value: abilityData[key] || 0,
        color: ABILITY_DOMAIN_COLORS[key] || '#94A3B8',
      }));
    }
    return QUESTION_TYPE_KEYS.map((key) => ({
      key,
      label: QUESTION_TYPE_LABELS[key],
      value: standardTypeData[key] || 0,
      color: QUESTION_TYPE_COLORS[key] || '#94A3B8',
    }));
  }, [abilityData, standardTypeData, viewMode]);

  const total = allItems.reduce((s, i) => s + i.value, 0);
  // 레이더 차트 데이터 (값이 있는 항목만 다각형 구성, 0인 항목은 범례에만 표시)
  const activeItems = allItems.filter((i) => i.value > 0);
  const maxValue = Math.max(...activeItems.map((i) => i.value), 1);
  const radarData = activeItems.map((item) => ({
    name: item.label,
    value: item.value,
    fullMark: maxValue,
  }));

  return (
    <div className="bg-white border rounded-sm p-4">
      <Header viewMode={viewMode} setViewMode={setViewMode} />
      <div className="flex gap-4 mt-2">
        {/* 3개 이상: 레이더 다각형 / 2개 이하: 수평 바 */}
        <div className="flex-1 min-h-[220px]">
          {activeItems.length >= 3 ? (
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart
                data={radarData}
                cx="50%"
                cy="50%"
                outerRadius="65%"
              >
                <defs>
                  <linearGradient
                    id="radarGradient"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#818CF8" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#A78BFA" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <PolarGrid
                  stroke="#E2E8F0"
                  strokeDasharray="3 3"
                  gridType="polygon"
                  fill="#F8FAFC"
                />
                <PolarAngleAxis
                  dataKey="name"
                  tickLine={false}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tick={(props: any) => {
                    const { x, y, payload, cx, cy } = props;
                    const dx = (x as number) - (cx as number);
                    const dy = (y as number) - (cy as number);
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const push = dist > 0 ? 20 / dist : 0;
                    const nx = (x as number) + dx * push;
                    const ny = (y as number) + dy * push;
                    return (
                      <text
                        x={nx}
                        y={ny}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="text-[11px] fill-slate-600 font-medium"
                      >
                        {payload.value}
                      </text>
                    );
                  }}
                />
                <Radar
                  dataKey="value"
                  stroke="#7C3AED"
                  strokeWidth={2}
                  fill="url(#radarGradient)"
                  dot={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex flex-col justify-center gap-3 px-4">
              {activeItems.length === 0 ? (
                <p className="text-xs text-slate-400 text-center">데이터가 없습니다</p>
              ) : (
                activeItems.map((item) => {
                  const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                  return (
                    <div key={item.key} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">{item.label}</span>
                        <span className="text-xs font-semibold text-slate-800 tabular-nums">{item.value}문항 ({pct}%)</span>
                      </div>
                      <div className="h-6 bg-slate-100 rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-all"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${item.color}CC, ${item.color}99)`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 범례 (0개 포함 전체 표시) — 4대 영역 라벨(변화와 관계/자료와 가능성 6자)이 한 줄에 들어가도록 폭 확보 */}
        <div className="w-44 flex flex-col justify-center gap-2">
          {allItems.map((item) => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            return (
              <div key={item.key} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-slate-600 flex-1 truncate">
                  {item.label}
                </span>
                <span className="text-xs font-semibold text-slate-800 tabular-nums">
                  {item.value}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 헤더 ──
function Header({
  viewMode,
  setViewMode,
}: {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-900">
        {viewMode === 'type' ? '유형 분포' : '능력 영역 분포'}
      </h3>
      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex bg-slate-100 rounded-sm p-0.5">
          <button
            onClick={() => setViewMode('ability')}
            className={`px-2 py-0.5 text-[10px] rounded-sm transition-colors ${
              viewMode === 'ability' ? 'bg-white shadow-sm font-semibold text-slate-800' : 'text-slate-400'
            }`}
          >
            능력
          </button>
          <button
            onClick={() => setViewMode('type')}
            className={`px-2 py-0.5 text-[10px] rounded-sm transition-colors ${
              viewMode === 'type' ? 'bg-white shadow-sm font-semibold text-slate-800' : 'text-slate-400'
            }`}
          >
            유형
          </button>
        </div>
      </div>
    </div>
  );
}
