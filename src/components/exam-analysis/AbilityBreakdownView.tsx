'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AbilityBreakdown } from '@/lib/exam-analysis/shared/ability-breakdown';
import { dominantAbility } from '@/lib/exam-analysis/shared/ability-breakdown';
import { formatPoints } from '@/lib/exam-analysis/shared/points';
import { QuestionEvidenceList } from './QuestionEvidenceList';

/**
 * 능력 영역별 배점 — "이 시험은 어떤 힘을 물었나".
 *
 * 껍데기(수학은 아코디언 섹션, 영어는 Board)는 탭마다 다르므로 **내용만** 공유한다.
 * 이렇게 해야 같은 데이터가 두 탭에서 다르게 보이지 않는다(규칙 #3 뷰 일관성).
 *
 * 정적 조언 문장을 일부러 넣지 않았다. 이 탭의 기존 문제가 바로 그것이었다 —
 * "계산 연습을 매일 하세요" 는 전국 어느 시험에서나 같은 문장이다.
 * 대신 이 시험에서만 나오는 사실(배점 쏠림, 안 나온 영역, 해당 문항)을 보여준다.
 */
export function AbilityBreakdownView({ breakdown, partial = false }: { breakdown: AbilityBreakdown; partial?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const dominant = dominantAbility(breakdown);

  if (breakdown.groups.length === 0) {
    return <p className="text-xs text-slate-400 py-4 text-center">능력 영역 데이터가 없습니다</p>;
  }

  const toggle = (d: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  return (
    <div className="space-y-2">
      {/* 요약은 계산해서 나온 사실만 — 쏠림이 없으면 아무 말도 하지 않는다 */}
      {dominant && (
        <p className="text-xs text-slate-600 leading-relaxed">
          {partial ? '분류된 문항의 확인 배점 중 ' : '배점의 '}<strong className="font-semibold text-slate-800">{dominant.percent}%</strong>가{' '}
          <span className="font-semibold" style={{ color: dominant.color }}>{dominant.label}</span>
          에 몰려 있습니다.
        </p>
      )}

      {breakdown.groups.map((g) => {
        const isOpen = open.has(g.domain);
        return (
          <div key={g.domain} className="rounded-sm border border-slate-100 overflow-hidden">
            <button
              onClick={() => toggle(g.domain)}
              className="w-full px-3 py-2.5 flex items-center gap-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
              <span className="text-sm font-medium text-slate-800 text-left shrink-0">{g.label}</span>

              {/* 막대 — 퍼센트는 integerPercents 라 합이 정확히 100 이다 */}
              <span className="flex-1 min-w-0 h-1.5 rounded-sm bg-slate-100 overflow-hidden mx-1">
                <span
                  className="block h-full rounded-sm"
                  style={{ width: `${g.percent}%`, backgroundColor: g.color }}
                />
              </span>

              <span className="text-xs text-slate-500 shrink-0 tabular-nums">
                {g.questionCount}문항 · {formatPoints(g.points)}점
              </span>
              <span className="text-xs font-semibold text-slate-700 shrink-0 tabular-nums w-9 text-right">
                {g.percent}%
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 bg-white px-3 py-2">
                {g.evidence.length > 0 ? (
                  <QuestionEvidenceList items={g.evidence} keyPrefix={`ab-${g.domain}`} />
                ) : (
                  <p className="text-[11px] text-slate-400 py-1">이 영역 문항에 기록된 소견이 없습니다.</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* "안 나왔다" 도 정보다 — 다음 시험 대비에서 이 영역을 버릴지 판단할 근거가 된다 */}
      {breakdown.absent.length > 0 && (
        <p className="text-[11px] text-slate-400 pt-1">
          {partial ? '분류된 문항에서 확인되지 않은 영역: ' : '이 시험에 나오지 않은 영역: '}{breakdown.absent.map((a) => a.label).join(' · ')}
        </p>
      )}
    </div>
  );
}
