'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { normalizeDifficultyKey as normalizeDiff } from '@/lib/exam-analysis/shared/difficulty';
import { DIFFICULTY_COLORS, QUESTION_TYPE_COLORS, ABILITY_DOMAIN_LABELS, ENGLISH_TYPE_TO_DOMAIN, ENGLISH_ABILITY_DOMAIN_LABELS, ENGLISH_ABILITY_DOMAIN_COLORS } from '@/lib/exam-analysis/constants';
import { questionTypeLabel } from '@/lib/exam-analysis/subject';
import { renderInlineMath } from '@/lib/exam-analysis/rendering';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import { Pencil } from 'lucide-react';
import { toast } from '@/components/ui/Toast';
import { QuestionFeedbackButton } from '../QuestionFeedbackButton';
import type { AnalysisCommentTabProps } from '../shared/view-props';

const DIFFICULTY_LABELS: Record<string, string> = {
  '1': '1', '2': '2', '3': '3', '4': '4', '5': '5',
  concept: '1', pattern: '2', reasoning: '4', creative: '5',
};


export function EnglishAnalysisCommentTab({ questions, examPaperId, analysisId, onDifficultyEdit }: AnalysisCommentTabProps) {
  const [showDiffReason, setShowDiffReason] = useState(false);

  const sortedQuestions = useMemo(() =>
    [...questions].sort((a, b) => {
      const aNum = typeof a.question_number === 'string' ? parseInt(a.question_number) || 999 : a.question_number;
      const bNum = typeof b.question_number === 'string' ? parseInt(b.question_number) || 999 : b.question_number;
      return aNum - bNum;
    }),
  [questions]);

  return (
    <div>
      {/* 상단 안내 + 토글 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">
          AI가 각 문항에 대해 분석한 코멘트입니다. 문항을 클릭하면 상세 분석을 볼 수 있습니다.
        </p>
        <button
          onClick={() => setShowDiffReason(!showDiffReason)}
          className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${
            showDiffReason ? 'bg-primary/10 text-primary font-medium' : 'bg-slate-100 text-slate-500'
          }`}
        >
          추정 난도 분석 ({questions.length})
        </button>
      </div>

      {/* 난이도 보정 요약 — 어느 문항을 선생님이 보정했는지 한 줄로(배지는 미수정과 동일하게 깔끔히 유지) */}
      {(() => {
        const edited = questions.filter((q) => {
          const ai = q.ai_difficulty != null ? normalizeDiff(String(q.ai_difficulty)) : null;
          return ai != null && ai !== normalizeDiff(q.difficulty);
        });
        if (edited.length === 0) return null;
        return (
          <div className="flex items-start gap-1.5 mb-3 text-[11px] flex-wrap">
            <span className="inline-flex items-center gap-1 font-medium text-primary shrink-0">
              <Pencil className="w-3 h-3" />선생님 난이도 보정 {edited.length}문항
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400">{edited.map((q) => q.question_number).join(' · ')}</span>
          </div>
        );
      })()}

      {/* 테이블 */}
      <div className="border rounded-sm overflow-hidden">
        <div className="grid grid-cols-[50px_140px_1fr_50px] bg-slate-50 px-3 py-2 border-b text-xs font-medium text-slate-500">
          <span className="text-center">번호</span>
          <span>단원</span>
          <span>AI 코멘트</span>
          <span className="text-center">피드백</span>
        </div>

        <div className="divide-y divide-slate-100">
          {sortedQuestions.map((q) => (
            <CommentRow
              key={String(q.question_number)}
              q={q}
              showDiffReason={showDiffReason}
              examPaperId={examPaperId}
              analysisId={analysisId}
              onDifficultyEdit={onDifficultyEdit}
            />
          ))}
        </div>
      </div>

      {sortedQuestions.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-400">AI 코멘트가 없습니다.</div>
      )}
    </div>
  );
}

// ── 개별 행 ──

function CommentRow({ q, showDiffReason, examPaperId, analysisId, onDifficultyEdit }: {
  q: AnalyzedQuestion;
  showDiffReason: boolean;
  examPaperId?: string;
  analysisId?: string;
  onDifficultyEdit?: (questionNumber: number | string, difficulty: string, aiDifficulty: string | null) => void;
}) {
  // 난이도 인라인 편집
  const [editingDiff, setEditingDiff] = useState(false);
  const [savingDiff, setSavingDiff] = useState(false);
  const diffRef = useRef<HTMLDivElement>(null);

  const curDiff = normalizeDiff(q.difficulty);
  const aiDiff = q.ai_difficulty != null ? normalizeDiff(String(q.ai_difficulty)) : null;
  const wasEdited = aiDiff != null && aiDiff !== curDiff;
  // 분석 실패 문항은 difficulty=null — 빈 배지가 아니라 '미정' 입력 유도 (문항별 분석 표와 동일)
  const diffUnset = !q.difficulty;

  // 난이도 편집 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!editingDiff) return;
    const handler = (e: MouseEvent) => {
      if (diffRef.current && !diffRef.current.contains(e.target as Node)) setEditingDiff(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingDiff]);

  const saveDifficulty = async (newDiff: string) => {
    if (newDiff === curDiff) { setEditingDiff(false); return; }
    if (!examPaperId) { toast.error('시험지 정보가 없습니다'); return; }
    setSavingDiff(true);
    try {
      const res = await fetch(`/api/exam-analysis/${examPaperId}/questions/${q.question_number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: newDiff }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || '난이도 수정 실패');
      }
      // AI 원본 보존: 최초 교정 시 현재 difficulty 가 원본
      const preservedAi = q.ai_difficulty != null ? String(q.ai_difficulty) : q.difficulty;
      onDifficultyEdit?.(q.question_number, newDiff, preservedAi);
      setEditingDiff(false);
      toast.success(`${q.question_number}번 난이도 ${newDiff}로 수정`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '난이도 수정에 실패했습니다');
    } finally {
      setSavingDiff(false);
    }
  };

  const shortTopic = q.topic ? q.topic.split(' > ').pop() || q.topic : '-';

  return (
    <div className="grid grid-cols-[50px_140px_1fr_50px] px-3 py-2.5 hover:bg-slate-50 items-start">
      {/* 번호 (+ 보정 점) */}
      <span className="text-sm font-bold text-slate-800 pt-0.5 inline-flex items-center justify-center gap-1">
        {q.question_number}
        {wasEdited && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title={`선생님 난이도 보정 (AI 원본 ${aiDiff} → ${curDiff})`} />
        )}
      </span>

      {/* 단원 */}
      <span className="text-xs text-slate-600 pt-1">{shortTopic}</span>

      {/* AI 코멘트 */}
      <div>
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[10px] font-medium text-slate-500">난이도</span>
          {/* 인라인 편집 가능 난이도 배지 */}
          <div className="relative inline-flex items-center" ref={diffRef}>
            <button
              type="button"
              onClick={() => setEditingDiff((v) => !v)}
              title={diffUnset ? '난이도 미인식 — 클릭하여 지정' : '클릭하여 난이도 수정'}
              className={
                diffUnset
                  ? 'px-1.5 py-0.5 rounded-sm text-[10px] font-medium inline-flex items-center gap-0.5 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100'
                  : 'px-1.5 py-0.5 rounded-sm text-[10px] font-bold text-white inline-flex items-center gap-0.5 hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 transition-all'
              }
              style={diffUnset ? undefined : { backgroundColor: DIFFICULTY_COLORS[curDiff ?? ''] || '#94A3B8' }}
            >
              {diffUnset ? '미정' : (DIFFICULTY_LABELS[q.difficulty ?? ''] || curDiff)}
            </button>
            {editingDiff && (
              <div className="absolute left-0 top-6 z-50 bg-white rounded-sm shadow-lg border p-1.5 flex items-center gap-1">
                {['1', '2', '3', '4', '5'].map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    disabled={savingDiff}
                    onClick={() => saveDifficulty(lv)}
                    className={`w-6 h-6 rounded-sm text-[11px] font-bold text-white transition-transform hover:scale-110 disabled:opacity-50 ${lv === curDiff ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                    style={{ backgroundColor: DIFFICULTY_COLORS[lv] }}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-slate-300 mx-0.5">·</span>
          <span className="text-[10px] font-medium text-slate-500">유형</span>
          {(() => {
            // AI 반환 키는 대소문자/변형이 섞일 수 있어 정규화 후 매칭 (규칙 12-3 — 아래 능력 블록과 동일 패턴)
            const type = String(q.question_type || '').toLowerCase();
            const typeColor = QUESTION_TYPE_COLORS[type] || '#94A3B8';
            return (
              <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-semibold"
                style={{ backgroundColor: `${typeColor}20`, color: typeColor }}>
                {questionTypeLabel(type, 'ENGLISH') || q.question_type}
              </span>
            );
          })()}
          <span className="text-[10px] text-slate-300 mx-0.5">·</span>
          <span className="text-[10px] font-medium text-slate-500">능력</span>
          {(() => {
            const fallback = q.question_type
              ? ENGLISH_TYPE_TO_DOMAIN[q.question_type]
              : undefined;
            const rawDomain = q.ability_domain || fallback || 'accuracy';
            const domain = String(rawDomain).toLowerCase();
            const domainColor = ENGLISH_ABILITY_DOMAIN_COLORS[domain] || '#94A3B8';
            const domainLabel = ENGLISH_ABILITY_DOMAIN_LABELS[domain] || ABILITY_DOMAIN_LABELS[domain] || domain;
            return (
              <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-semibold"
                style={{ backgroundColor: `${domainColor}20`, color: domainColor }}>
                {domainLabel}
              </span>
            );
          })()}
          {q.points != null && (
            <>
              <span className="text-[10px] text-slate-300 mx-0.5">·</span>
              <span className="text-[10px] font-medium text-slate-500">배점</span>
              <span className="text-[10px] font-bold text-slate-700">{q.points}점</span>
            </>
          )}
        </div>
        {q.ai_comment && (
          <p className="text-xs text-slate-700 leading-relaxed font-medium">
            {renderInlineMath(q.ai_comment, `ac-${q.question_number}`)}
          </p>
        )}
        {showDiffReason && q.difficulty_reason && (
          <p className="text-[11px] text-slate-400 mt-1">
            난이도 근거: {renderInlineMath(q.difficulty_reason, `dr-${q.question_number}`)}
          </p>
        )}
        {/* 이 문항에 실제로 나온 단어·구문. 분석 단계에서 문항별로 이미 뽑아 저장하는데
            (ai-engine 의 parseEnglishKeyFields) 문항 단위로 보여주는 곳이 없었다 —
            유일한 소비처인 학습팩이 전 문항을 하나로 병합하며 문항 귀속을 없앤다.
            구버전 분석본에는 필드 자체가 없으므로 optional 로만 읽는다. */}
        <KeyTermChips vocab={q.key_vocab} structures={q.key_structures} num={q.question_number} />
      </div>

      {/* 피드백 — 공유 컴포넌트(어느 탭에서든 동일 작동 + 문항 메타데이터 스냅샷 포함) */}
      <div className="text-center pt-0.5">
        <QuestionFeedbackButton q={q} examPaperId={examPaperId} analysisId={analysisId} align="right" />
      </div>
    </div>
  );
}

/**
 * 문항별 핵심 단어·구문 칩.
 *
 * 값이 없으면 (구버전 분석본·수학 시험지·AI 가 빈 배열을 준 문항) 아무것도 렌더하지
 * 않는다 — 빈 라벨만 남으면 "분석이 빠졌다"는 인상을 준다.
 */
function KeyTermChips({
  vocab,
  structures,
  num,
}: {
  vocab?: { word: string; meaning: string | null }[] | null;
  structures?: { pattern: string; meaning: string | null }[] | null;
  num: number | string;
}) {
  const words = Array.isArray(vocab) ? vocab.filter((v) => v?.word) : [];
  const patterns = Array.isArray(structures) ? structures.filter((s) => s?.pattern) : [];
  if (!words.length && !patterns.length) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {words.map((v, i) => (
        <span
          key={`kv-${num}-${i}`}
          title={v.meaning || undefined}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-slate-100 text-[10px] text-slate-600"
        >
          <span className="font-semibold text-slate-800">{v.word}</span>
          {v.meaning && <span className="text-slate-400">{v.meaning}</span>}
        </span>
      ))}
      {patterns.map((s, i) => (
        <span
          key={`ks-${num}-${i}`}
          title={s.meaning || undefined}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sky-50 text-[10px] text-sky-700 border border-sky-100"
        >
          <span className="font-semibold">{s.pattern}</span>
          {s.meaning && <span className="text-sky-400">{s.meaning}</span>}
        </span>
      ))}
    </div>
  );
}
