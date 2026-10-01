'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';
import {
  buildEnglishEvidenceBreakdown, difficultyBasis, readEnglishQuestionAnalysis,
  SOURCE_LABELS, SUBTYPE_LABELS, THINKING_LABELS, TRANSFORMATION_LABELS, VERIFICATION_LABELS,
  type EnglishQuestionAnalysis,
} from '@/lib/exam-analysis/english/question-evidence';
import { formatPoints } from '@/lib/exam-analysis/shared/points';
import { renderInlineMath } from '@/lib/exam-analysis/rendering';

const EvidenceEditor = dynamic(() => import('./EnglishEvidenceEditor').then(m => m.EnglishEvidenceEditor));

interface Props {
  questions: AnalyzedQuestion[];
  declaredPoints: number | null;
  examPaperId?: string;
  analysisId?: string;
  onSaved?: () => void;
}

export function EnglishEvidencePanel({ questions, declaredPoints, examPaperId, analysisId, onSaved }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, { before: unknown; value: EnglishQuestionAnalysis }>>({});
  const current = useMemo(() => questions.map(q => {
    const edit = saved[String(q.question_number)];
    // 새 서버 응답을 받으면 서버 기록을 사용한다. 이전 오버레이가 후속 교정을 가리지 않는다.
    return edit && edit.before === q.english_analysis ? { ...q, english_analysis: edit.value } : q;
  }), [questions, saved]);
  const source = useMemo(() => buildEnglishEvidenceBreakdown(current, 'source', declaredPoints), [current, declaredPoints]);
  const subtype = useMemo(() => buildEnglishEvidenceBreakdown(current, 'subtype', declaredPoints), [current, declaredPoints]);
  const selected = current.find(q => String(q.question_number) === editing);

  async function copyTable() {
    const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ');
    const rows = current.map(q => {
      const a = readEnglishQuestionAnalysis(q.english_analysis);
      return [String(q.question_number), q.points == null ? '미확인' : formatPoints(q.points),
        sourceText(a), a.subtype ? SUBTYPE_LABELS[a.subtype] : '미분류', a.skills.join(' · '),
        a.thinking ? THINKING_LABELS[a.thinking] : '미확인', a.writing_conditions.join(' · '),
        a.scoring_criteria || '미확인', a.scoring_source || '미확인',
        q.difficulty ? `${difficultyBasis(q)} ${q.difficulty}단계` : '미확인',
        a.observation ? `${a.observation.group}: ${a.observation.incorrect}/${a.observation.respondents}명 오답 (${a.observation.source})` : '미확인',
        a.next_practice || '미기록'].map(clean).join('\t');
    });
    try {
      await navigator.clipboard.writeText(['번호\t배점\t출처·확인 상태\t세부 유형\t핵심 기술\t요구 사고\t서술형 조건\t채점 기준\t채점 출처\t추정 난도\t실제 응답\t다음 연습', ...rows].join('\n'));
      toast.success('문항 분석표를 복사했습니다');
    } catch { toast.error('분석표 복사에 실패했습니다'); }
  }

  return (
    <section className="rounded-sm border bg-white p-4 space-y-4" aria-label="영어 문항 근거 분석">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">출처·세부 유형·채점 조건</h3>
          <p className="mt-1 text-xs text-slate-500">시험지의 사실과 교사 판단을 구분해 기록합니다. 원문·채점표가 없으면 미확인으로 남깁니다.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={copyTable}>분석표 복사</Button>
      </div>
      <p className="text-xs text-slate-500">
        문항 수 기준: 전체 {source.totalQuestions}문항 · 배점 기준: {source.denominator == null ? '총점 미확인' : `${formatPoints(source.denominator)}점 (${declaredPoints != null ? '시험지 만점' : '확인된 문항 배점 합계'})`}
        {' '}· 확인된 배점 합계 {formatPoints(source.knownPoints)}점
        {source.unknownPoints > 0 && ` · 배점 미확인 ${source.unknownPoints}문항`}
        . 주 출처·세부 유형은 문항당 하나씩 집계하며 소문항 배점은 중복 합산하지 않습니다.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="출처별 문항 수와 배점" data={source} />
        <Breakdown title="세부 유형별 문항 수와 배점" data={subtype} />
      </div>
      {selected && examPaperId && (
        <EvidenceEditor
          key={`${analysisId}:${selected.question_number}`}
          question={selected} examPaperId={examPaperId} analysisId={analysisId}
          onCancel={() => setEditing(null)}
          onSaved={value => {
            setSaved(prev => ({ ...prev, [String(selected.question_number)]: { before: questions.find(q => String(q.question_number) === String(selected.question_number))?.english_analysis, value } }));
            setEditing(null); onSaved?.();
          }}
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="border-b bg-slate-50 text-slate-500"><tr>
            <th className="p-2 whitespace-nowrap">문항·배점</th><th className="p-2 min-w-28">주 출처</th>
            <th className="p-2 min-w-28">세부 유형</th><th className="p-2 min-w-56">근거·채점 조건·다음 연습</th><th className="p-2">기록</th>
          </tr></thead>
          <tbody>{current.map(q => {
            const a = readEnglishQuestionAnalysis(q.english_analysis);
            return <tr key={String(q.question_number)} className="border-b border-slate-100 align-top">
              <td className="p-2 whitespace-nowrap">{q.question_number}번<br /><span className="text-slate-500">{q.points == null ? '배점 미확인' : `${formatPoints(q.points)}점`}</span></td>
              <td className="p-2">{renderInlineMath(sourceText(a), `source-${q.question_number}`)}</td>
              <td className="p-2">{a.subtype ? SUBTYPE_LABELS[a.subtype] : '미분류'}<br /><span className="text-slate-500">{a.thinking ? THINKING_LABELS[a.thinking] : '요구 사고 미확인'}</span></td>
              <td className="p-2">
                <p className="text-slate-700">{renderInlineMath(a.next_practice || '학습 과제 미기록', `practice-${q.question_number}`)}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-primary">분석 근거·조건 보기</summary>
                  <EvidenceDetails analysis={a} question={q} />
                </details>
              </td>
              <td className="p-2 whitespace-nowrap">{examPaperId && <Button size="sm" variant="ghost" onClick={() => setEditing(String(q.question_number))} disabled={editing !== null}>확인·수정</Button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

function sourceText(a: EnglishQuestionAnalysis): string {
  return [SOURCE_LABELS[a.source.kind], a.source.title, a.source.location, VERIFICATION_LABELS[a.source.verification]].filter(Boolean).join(' · ');
}
function Breakdown({ title, data }: { title: string; data: ReturnType<typeof buildEnglishEvidenceBreakdown> }) {
  return <div className="overflow-x-auto rounded-sm border border-slate-100 p-3">
    <h4 className="mb-2 text-xs font-semibold">{title}</h4>
    <table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left">구분</th><th>문항 수</th><th>문항 비율</th><th>배점 합</th><th>배점 비율</th></tr></thead>
      <tbody>{data.groups.map(g => <tr key={g.label} className="border-t border-slate-100" title={`문항: ${g.questions.join(', ')}`}>
        <td className="py-2">{g.label}</td><td className="text-center">{g.count}</td><td className="text-center">{g.countPercent}%</td>
        <td className="text-center">{g.pointsComplete ? `${formatPoints(g.points)}점` : `${formatPoints(g.points)}점 + 미확인`}</td><td className="text-center">{g.pointsPercent == null ? '미확인' : `${g.pointsPercent}%`}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
function EvidenceDetails({ analysis: a, question: q }: { analysis: EnglishQuestionAnalysis; question: AnalyzedQuestion }) {
  const fields = [
    ['출처 근거', a.source.evidence], ['원문 관계', TRANSFORMATION_LABELS[a.transformation]], ['원문 대조 근거', a.transformation_evidence],
    ['동일 지문', a.passage_id], ['핵심 기술', a.skills.join(' · ')], ['오답 유도 지점', a.distractors],
    ['서술형 조건', a.writing_conditions.join(' · ')], ['정답 인정 범위', a.accepted_answers],
    ['채점 기준', a.scoring_criteria], ['채점 기준 출처', a.scoring_source],
    ['성취기준', a.achievement_standards.join(' · ')], ['성취기준 출처', a.standards_source],
    ['난도 근거', `${difficultyBasis(q)}${q.difficulty ? ` ${q.difficulty}단계` : ''}${q.difficulty_reason ? ` · ${q.difficulty_reason}` : ''}`],
  ];
  return <div className="mt-2 space-y-2 text-slate-600">
    <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">{fields.map(([label, value]) =>
      <div key={label} className="contents"><dt className="text-slate-400">{label}</dt><dd className="break-words">{renderInlineMath(value || '미확인', `${q.question_number}-${label}`)}</dd></div>)}</dl>
    {a.subquestions.map(p => <p key={p.label}>{p.label}: {p.points == null ? '배점 미확인' : `${formatPoints(p.points)}점`} · {renderInlineMath(p.conditions.join(' · ') || '조건 미확인', `part-${q.question_number}-${p.label}`)}{p.scoring_criteria && <> · {renderInlineMath(p.scoring_criteria, `score-${q.question_number}-${p.label}`)}</>}</p>)}
    {a.observation ? <p className="rounded-sm bg-slate-50 p-2">실제 응답: {a.observation.group} · {a.observation.respondents}명 중 {a.observation.incorrect}명 오답 ({(a.observation.incorrect / a.observation.respondents * 100).toFixed(1)}%)<br />출처: {a.observation.source}{a.observation.observed_at && ` · ${a.observation.observed_at}`}</p>
      : <p>실제 응답 통계: 미확인. 추정 난도는 실제 오답률과 다릅니다.</p>}
  </div>;
}
