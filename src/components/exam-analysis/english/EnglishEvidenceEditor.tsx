'use client';

import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import {
  readEnglishQuestionAnalysis, SOURCE_LABELS, VERIFICATION_LABELS, SUBTYPE_LABELS,
  TRANSFORMATION_LABELS, THINKING_LABELS, type EnglishQuestionAnalysis,
} from '@/lib/exam-analysis/english/question-evidence';

const inputClass = 'w-full border border-slate-200 rounded-sm bg-white px-2 py-1.5 text-sm';
const asText = (v: string) => v || null;
const cleanList = (values: string[]) => values.map(s => s.trim()).filter(Boolean);

interface Props {
  question: AnalyzedQuestion; examPaperId: string; analysisId?: string;
  onCancel: () => void; onSaved: (value: EnglishQuestionAnalysis) => void;
}
export function EnglishEvidenceEditor({ question, examPaperId, analysisId, onCancel, onSaved }: Props) {
  const [draft, setDraft] = useState(() => readEnglishQuestionAnalysis(question.english_analysis));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof EnglishQuestionAnalysis>(key: K, value: EnglishQuestionAnalysis[K]) => setDraft(prev => ({ ...prev, [key]: value }));
  const source = <K extends keyof EnglishQuestionAnalysis['source']>(key: K, value: EnglishQuestionAnalysis['source'][K]) => setDraft(prev => ({ ...prev, source: { ...prev.source, [key]: value } }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/exam-analysis/${examPaperId}/questions/${encodeURIComponent(String(question.question_number))}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ english_analysis: {
          ...draft, skills: cleanList(draft.skills), writing_conditions: cleanList(draft.writing_conditions),
          achievement_standards: cleanList(draft.achievement_standards),
          subquestions: draft.subquestions.map(p => ({ ...p, conditions: cleanList(p.conditions) })),
        }, analysisId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || '문항 기록 저장에 실패했습니다');
      onSaved(readEnglishQuestionAnalysis(json.data?.question?.english_analysis));
      toast.success('문항 분석 기록을 저장했습니다');
    } catch (e) {
      const message = e instanceof Error ? e.message : '문항 기록 저장에 실패했습니다';
      setError(message); toast.error(message);
    } finally { setBusy(false); }
  }

  return <form onSubmit={save} className="rounded-sm border border-indigo-200 bg-indigo-50/30 p-4 space-y-4" aria-label={`${question.question_number}번 문항 근거 수정`}>
    <div><h4 className="text-sm font-semibold">{question.question_number}번 문항 확인·수정</h4><p className="mt-1 text-xs text-slate-500">시험지·원문·채점표에서 확인한 내용을 기록하세요. 여러 조건은 한 줄에 하나씩 입력합니다.</p></div>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="주 출처" value={draft.source.kind} labels={SOURCE_LABELS} onChange={v => source('kind', v)} />
        <Text label="교재·자료명" value={draft.source.title} onChange={v => source('title', v)} maxLength={200} />
        <Text label="단원·회차·쪽" value={draft.source.location} onChange={v => source('location', v)} maxLength={200} />
        <Select label="출처 확인 상태" value={draft.source.verification} labels={VERIFICATION_LABELS} onChange={v => source('verification', v)} />
        <Text label="출처 확인 근거" value={draft.source.evidence} onChange={v => source('evidence', v)} />
        <Text label="동일 지문 식별자" value={draft.passage_id} onChange={v => update('passage_id', v)} maxLength={80} hint="같은 지문을 쓰는 문항에 같은 이름을 입력" />
        <Select label="원문 관계" value={draft.transformation} labels={TRANSFORMATION_LABELS} onChange={v => update('transformation', v)} />
        <Text label="원문 대조 근거" value={draft.transformation_evidence} onChange={v => update('transformation_evidence', v)} />
        <Select label="세부 유형" value={draft.subtype} labels={SUBTYPE_LABELS} onChange={v => update('subtype', v)} nullable />
        <Select label="요구 사고" value={draft.thinking} labels={THINKING_LABELS} onChange={v => update('thinking', v)} nullable />
        <Lines label="확인할 지식·기술" value={draft.skills} onChange={v => update('skills', v)} />
        <Text label="오답 유도 지점" value={draft.distractors} onChange={v => update('distractors', v)} multiline />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Lines label="서술형 조건" value={draft.writing_conditions} onChange={v => update('writing_conditions', v)} />
        <Text label="정답 인정 범위" value={draft.accepted_answers} onChange={v => update('accepted_answers', v)} multiline />
        <Text label="부분점수·감점 기준" value={draft.scoring_criteria} onChange={v => update('scoring_criteria', v)} multiline />
        <Text label="채점 기준 출처" value={draft.scoring_source} onChange={v => update('scoring_source', v)} hint="채점표 이름·페이지 또는 학교 안내 문구" />
        <Lines label="성취기준 코드·내용" value={draft.achievement_standards} onChange={v => update('achievement_standards', v)} />
        <Text label="성취기준 출처" value={draft.standards_source} onChange={v => update('standards_source', v)} hint="교육과정 버전·과목·학교 평가계획" />
        <Text label="다음 학습 과제" value={draft.next_practice} onChange={v => update('next_practice', v)} multiline />
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-semibold">소문항별 배점·조건</h5>
        <p className="text-xs text-slate-500">소문항 배점은 위 문항 배점에 포함됩니다. 모두 입력하면 합계가 문항 배점과 일치해야 합니다.</p>
        {draft.subquestions.map((part, i) => <div key={i} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[5rem_5rem_1fr_1fr_auto] items-end">
          <Text label="소문항 번호" value={part.label} maxLength={30} onChange={v => update('subquestions', draft.subquestions.map((p, idx) => idx === i ? { ...p, label: v || '' } : p))} />
          <Field label="배점"><input aria-label={`소문항 ${i + 1} 배점`} className={inputClass} type="number" min="0" max="100" step="0.01" value={part.points ?? ''} onChange={e => update('subquestions', draft.subquestions.map((p, idx) => idx === i ? { ...p, points: e.target.value === '' ? null : Number(e.target.value) } : p))} /></Field>
          <Lines label="조건" value={part.conditions} onChange={v => update('subquestions', draft.subquestions.map((p, idx) => idx === i ? { ...p, conditions: v } : p))} />
          <Text label="채점 기준" value={part.scoring_criteria} onChange={v => update('subquestions', draft.subquestions.map((p, idx) => idx === i ? { ...p, scoring_criteria: v } : p))} />
          <Button type="button" size="sm" variant="ghost" onClick={() => update('subquestions', draft.subquestions.filter((_, idx) => idx !== i))}>삭제</Button>
        </div>)}
        <Button type="button" size="sm" variant="secondary" disabled={draft.subquestions.length >= 20} onClick={() => update('subquestions', [...draft.subquestions, { label: `(${draft.subquestions.length + 1})`, points: null, conditions: [], scoring_criteria: null }])}>소문항 추가</Button>
      </div>
      <div className="space-y-2 border-t border-indigo-100 pt-3">
        <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={!!draft.observation} onChange={e => update('observation', e.target.checked ? { respondents: 1, incorrect: 0, group: '', source: '', observed_at: null } : null)} />실제 응답 통계 기록</label>
        <p className="text-xs text-slate-500">응답 집단과 출처를 함께 기록합니다. 외부 응시자의 오답률을 이 학교 학생의 오답률로 사용하지 마세요.</p>
        {draft.observation && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="응답 인원"><input className={inputClass} type="number" min="1" max="100000" required value={draft.observation.respondents} onChange={e => update('observation', { ...draft.observation!, respondents: Number(e.target.value) })} /></Field>
          <Field label="오답 인원"><input className={inputClass} type="number" min="0" max={draft.observation.respondents} required value={draft.observation.incorrect} onChange={e => update('observation', { ...draft.observation!, incorrect: Number(e.target.value) })} /></Field>
          <Text label="응답 집단" value={draft.observation.group} maxLength={120} onChange={v => update('observation', { ...draft.observation!, group: v || '' })} />
          <Text label="응답 자료 출처" value={draft.observation.source} onChange={v => update('observation', { ...draft.observation!, source: v || '' })} />
          <Field label="응답 기준일"><input className={inputClass} type="date" value={draft.observation.observed_at ?? ''} onChange={e => update('observation', { ...draft.observation!, observed_at: asText(e.target.value) })} /></Field>
        </div>}
      </div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2"><Button size="sm" type="submit" loading={busy}>저장</Button><Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>취소</Button></div>
  </form>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">{label}</span>{children}{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</label>;
}
function Text({ label, value, onChange, multiline = false, maxLength = 500, hint }: { label: string; value: string | null; onChange: (v: string | null) => void; multiline?: boolean; maxLength?: number; hint?: string }) {
  return <Field label={label} hint={hint}>{multiline ? <textarea aria-label={label} className={inputClass} rows={2} value={value ?? ''} maxLength={maxLength} onChange={e => onChange(asText(e.target.value))} /> : <input aria-label={label} className={inputClass} value={value ?? ''} maxLength={maxLength} onChange={e => onChange(asText(e.target.value))} />}</Field>;
}
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  // 입력 중 공백·마지막 줄바꿈을 유지하고 저장할 때만 빈 줄을 제거한다.
  return <Field label={label}><textarea aria-label={label} className={inputClass} rows={2} maxLength={2400} value={value.join('\n')} onChange={e => onChange(e.target.value.split('\n'))} /></Field>;
}
function Select<T extends string>({ label, value, labels, onChange, nullable = false }: { label: string; value: T | null; labels: Record<T, string>; onChange: (value: T) => void; nullable?: boolean }) {
  return <Field label={label}><select aria-label={label} className={inputClass} value={value ?? ''} onChange={e => onChange((e.target.value || null) as T)}>
    {nullable && <option value="">미확인</option>}{(Object.entries(labels) as [T, string][]).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select></Field>;
}
