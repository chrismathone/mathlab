import { z } from 'zod';
import { SOURCE_LABELS, VERIFICATION_LABELS, TRANSFORMATION_LABELS, SUBTYPE_LABELS, THINKING_LABELS } from './question-evidence';
import { pointsEqual, sumPoints } from '../shared/points';

function enumKeys<T extends Record<string, string>>(labels: T) {
  return z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);
}
const note = z.string().trim().max(500).nullable();
const notes = z.array(z.string().trim().min(1).max(200)).max(12);
export const englishQuestionAnalysisSchema = z.object({
  version: z.literal(1),
  source: z.object({
    kind: enumKeys(SOURCE_LABELS), title: z.string().trim().max(200).nullable(), location: z.string().trim().max(200).nullable(),
    evidence: note, verification: enumKeys(VERIFICATION_LABELS),
  }).strict(),
  transformation: enumKeys(TRANSFORMATION_LABELS), transformation_evidence: note,
  passage_id: z.string().trim().max(80).nullable(), subtype: enumKeys(SUBTYPE_LABELS).nullable(),
  skills: notes.max(8), thinking: enumKeys(THINKING_LABELS).nullable(), distractors: note,
  writing_conditions: notes, accepted_answers: note, scoring_criteria: note, scoring_source: note,
  achievement_standards: notes.max(8), standards_source: note, next_practice: note,
  subquestions: z.array(z.object({
    label: z.string().trim().min(1).max(30), points: z.number().min(0).max(100).nullable(),
    conditions: notes, scoring_criteria: note,
  }).strict()).max(20),
  observation: z.object({
    respondents: z.number().int().min(1).max(100000), incorrect: z.number().int().min(0),
    group: z.string().trim().min(1).max(120), source: z.string().trim().min(1).max(500),
    observed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, '유효한 날짜를 입력하세요').nullable(),
  }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string, path: string[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if (value.source.verification !== 'unverified' && (!value.source.evidence || value.source.kind === 'unknown')) {
    issue('출처를 확인하려면 출처 종류와 확인 근거를 입력하세요', ['source', 'evidence']);
  }
  if (value.transformation !== 'unknown' && !value.transformation_evidence) issue('원문 대조 근거를 입력하세요', ['transformation_evidence']);
  if ((value.scoring_criteria || value.accepted_answers || value.subquestions.some(p => p.scoring_criteria)) && !value.scoring_source) {
    issue('채점 기준의 출처를 입력하세요', ['scoring_source']);
  }
  if (value.achievement_standards.length && !value.standards_source) issue('성취기준의 출처를 입력하세요', ['standards_source']);
  if (value.observation && value.observation.incorrect > value.observation.respondents) issue('오답 인원은 응답 인원을 초과할 수 없습니다', ['observation', 'incorrect']);
  const labels = value.subquestions.map(p => p.label);
  if (new Set(labels).size !== labels.length) issue('소문항 번호가 중복됩니다', ['subquestions']);
});

/** 부모 배점은 소문항을 포함한다. 일부 배점만 알아도 알려진 합이 부모를 넘으면 오류다. */
export function validateEnglishSubquestionPoints(parts: Array<{ points: number | null }>, parentPoints: unknown): string | null {
  if (!parts.length || typeof parentPoints !== 'number') return null;
  const sum = sumPoints(parts.map(p => p.points));
  if (sum > parentPoints || (parts.every(p => p.points != null) && !pointsEqual(sum, parentPoints))) {
    return '소문항 배점 합계가 문항 배점과 일치해야 합니다';
  }
  return null;
}
