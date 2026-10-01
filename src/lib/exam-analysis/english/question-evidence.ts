/** 영어 문항의 근거 기록. ExamAnalysis.questions JSON 안에 저장하며 구형 분석도 안전하게 읽는다. */
import type { AnalyzedQuestion } from '../types';
import { roundPoints, sumPoints } from '../shared/points';

export const SOURCE_LABELS = {
  unknown: '미확인', textbook: '교과서', workbook: '부교재', mock: '학력평가·모의고사',
  handout: '프린트', external: '외부 지문', other: '기타',
} as const;
export const VERIFICATION_LABELS = { unverified: '미확인', printed: '시험지 명시', teacher_verified: '교사 확인' } as const;
export const TRANSFORMATION_LABELS = {
  unknown: '원문 대조 전', unchanged: '거의 그대로', modified: '일부 변형',
  reconstructed: '재구성', new: '새 지문·응용',
} as const;
export const THINKING_LABELS = { recall: '기억', understand: '정확한 이해', apply: '적용', infer: '추론', produce: '변형·생산' } as const;
/** 상위 평가 영역과 세부 유형은 별도 축으로 보존한다. */
export const SUBTYPE_LABELS = {
  word_meaning: '단어 뜻', english_definition: '영영풀이', contextual_word: '문맥 어휘',
  synonym_antonym: '유의어·반의어', word_form: '어형 변화', collocation: '연어·다의어',
  grammar_rule: '어법 규칙 확인', grammar_error: '문장 속 어법 오류', grammar_production: '어법 적용 영작',
  main_idea: '주제·제목·요지', detail: '내용 일치·불일치', blank: '빈칸 추론', summary: '요약',
  sequence: '글의 순서', insertion: '문장 삽입', irrelevant: '무관한 문장', reference: '지칭 추론', inference: '함축·추론',
  extract: '본문 찾아 쓰기', conditional_writing: '조건 영작', sentence_order: '문장 배열',
  correction: '어법 고쳐 쓰기', summary_writing: '요약 영작', dialogue: '대화·상황 표현',
  listening_detail: '듣기 세부 정보', listening_inference: '듣기 추론', other: '기타',
} as const;

export interface EnglishQuestionAnalysis {
  version: 1;
  source: {
    kind: keyof typeof SOURCE_LABELS;
    title: string | null;
    location: string | null;
    evidence: string | null;
    verification: keyof typeof VERIFICATION_LABELS;
  };
  transformation: keyof typeof TRANSFORMATION_LABELS;
  transformation_evidence: string | null;
  passage_id: string | null;
  subtype: keyof typeof SUBTYPE_LABELS | null;
  skills: string[];
  thinking: keyof typeof THINKING_LABELS | null;
  distractors: string | null;
  writing_conditions: string[];
  accepted_answers: string | null;
  scoring_criteria: string | null;
  scoring_source: string | null;
  achievement_standards: string[];
  standards_source: string | null;
  next_practice: string | null;
  subquestions: Array<{ label: string; points: number | null; conditions: string[]; scoring_criteria: string | null }>;
  observation: {
    respondents: number;
    incorrect: number;
    group: string;
    source: string;
    observed_at: string | null;
  } | null;
}

function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}
function text(raw: unknown, max = 500): string | null {
  return typeof raw === 'string' ? raw.trim().slice(0, max) || null : null;
}
function list(raw: unknown, max = 12): string[] {
  return Array.isArray(raw) ? [...new Set(raw.map(v => text(v, 200)).filter((v): v is string => !!v))].slice(0, max) : [];
}
function key<T extends Record<string, string>>(labels: T, raw: unknown): keyof T | null {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(labels, raw) ? raw as keyof T : null;
}
function points(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? roundPoints(raw) : null;
}

/** 구형·손상 JSON은 빈 기록으로 정규화하며 미확인 값을 사실로 승격하지 않는다. */
export function readEnglishQuestionAnalysis(raw: unknown): EnglishQuestionAnalysis {
  const r = object(raw);
  const s = object(r.source);
  const o = object(r.observation);
  const n = o.respondents;
  const incorrect = o.incorrect;
  const group = text(o.group, 120);
  const source = text(o.source);
  const observation = typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 100000
    && typeof incorrect === 'number' && Number.isInteger(incorrect) && incorrect >= 0 && incorrect <= n && group && source
    ? { respondents: n, incorrect, group, source, observed_at: text(o.observed_at, 40) } : null;
  const evidence = text(s.evidence);
  const verification = key(VERIFICATION_LABELS, s.verification) ?? 'unverified';
  const transformEvidence = text(r.transformation_evidence);
  return {
    version: 1,
    source: {
      kind: key(SOURCE_LABELS, s.kind) ?? 'unknown', title: text(s.title, 200), location: text(s.location, 200), evidence,
      verification: evidence ? verification : 'unverified',
    },
    transformation: transformEvidence ? key(TRANSFORMATION_LABELS, r.transformation) ?? 'unknown' : 'unknown',
    transformation_evidence: transformEvidence,
    passage_id: text(r.passage_id, 80), subtype: key(SUBTYPE_LABELS, r.subtype), skills: list(r.skills, 8),
    thinking: key(THINKING_LABELS, r.thinking), distractors: text(r.distractors), writing_conditions: list(r.writing_conditions),
    accepted_answers: text(r.accepted_answers), scoring_criteria: text(r.scoring_criteria), scoring_source: text(r.scoring_source),
    achievement_standards: list(r.achievement_standards, 8), standards_source: text(r.standards_source),
    next_practice: text(r.next_practice),
    subquestions: Array.isArray(r.subquestions) ? r.subquestions.slice(0, 20).flatMap(rawPart => {
      const part = object(rawPart);
      const label = text(part.label, 30);
      return label ? [{ label, points: points(part.points), conditions: list(part.conditions), scoring_criteria: text(part.scoring_criteria) }] : [];
    }) : [],
    observation,
  };
}

/** 시험지만 받는 AI 경로에서 원문 대조·교사 확인·실측 응답을 생성하지 못하게 한다. */
export function parseEnglishQuestionAnalysisFromAI(raw: unknown): EnglishQuestionAnalysis {
  const result = readEnglishQuestionAnalysis(raw);
  result.observation = null;
  result.transformation = 'unknown';
  result.transformation_evidence = null;
  result.achievement_standards = [];
  result.standards_source = null;
  if (!result.scoring_source) {
    result.scoring_criteria = null;
    result.accepted_answers = null;
    result.subquestions = result.subquestions.map(p => ({ ...p, scoring_criteria: null }));
  }
  if (result.source.verification !== 'printed') result.source.verification = 'unverified';
  return result;
}

export function difficultyBasis(q: Pick<AnalyzedQuestion, 'difficulty' | 'ai_difficulty' | 'difficulty_reviewed'>): string {
  if (q.difficulty == null) return '난도 미확인';
  return q.difficulty_reviewed || q.ai_difficulty != null ? '교사 판단 난도' : 'AI 추정 난도';
}

export interface EvidenceGroup {
  label: string; count: number; points: number; pointsComplete: boolean; countPercent: number; pointsPercent: number | null; questions: string[];
}
export function buildEnglishEvidenceBreakdown(questions: AnalyzedQuestion[], axis: 'source' | 'subtype', declaredPoints: number | null) {
  const knownPoints = sumPoints(questions.map(q => points(q.points)));
  const unknownPoints = questions.filter(q => points(q.points) == null).length;
  // 만점을 알아도 문항별 배점의 미확인 부분을 임의로 채우지 않는다.
  const denominator = declaredPoints != null && declaredPoints > 0 ? declaredPoints : unknownPoints === 0 ? knownPoints : null;
  const buckets = new Map<string, { count: number; points: number; questions: string[]; complete: boolean }>();
  for (const q of questions) {
    const a = readEnglishQuestionAnalysis(q.english_analysis);
    const label = axis === 'source'
      ? a.source.verification !== 'unverified' && a.source.kind !== 'unknown' ? SOURCE_LABELS[a.source.kind] : '미확인'
      : a.subtype ? SUBTYPE_LABELS[a.subtype] : '미분류';
    const b = buckets.get(label) ?? { count: 0, points: 0, questions: [], complete: true };
    const value = points(q.points);
    b.count++; b.points += value ?? 0; b.complete &&= value != null; b.questions.push(String(q.question_number));
    buckets.set(label, b);
  }
  const groups: EvidenceGroup[] = [...buckets.entries()].map(([label, b]) => ({
    label, count: b.count, points: roundPoints(b.points), pointsComplete: b.complete, questions: b.questions,
    countPercent: questions.length ? roundPoints(b.count / questions.length * 100) : 0,
    pointsPercent: b.complete && denominator != null && denominator > 0 ? roundPoints(b.points / denominator * 100) : null,
  })).sort((a, b) => b.points - a.points);
  return { groups, knownPoints, unknownPoints, denominator, totalQuestions: questions.length };
}

/** 재분석 시 교사가 저장한 기록을 보존한다. 명시적으로 비운 필드도 보존한다. */
export function preserveEnglishQuestionReview(previous: unknown, next: AnalyzedQuestion): AnalyzedQuestion {
  const old = object(previous);
  const review = object(old.english_analysis_review);
  const difficultyReview = object(old.difficulty_reviewed);
  return {
    ...next,
    ...(typeof review.reviewed_at === 'string' && typeof review.reviewed_by === 'string' ? {
      english_analysis: readEnglishQuestionAnalysis(old.english_analysis),
      english_analysis_review: { reviewed_at: review.reviewed_at, reviewed_by: review.reviewed_by },
    } : {}),
    ...(typeof difficultyReview.reviewed_at === 'string' && typeof difficultyReview.reviewed_by === 'string' && typeof old.difficulty === 'string'
      ? { difficulty: old.difficulty, ai_difficulty: next.difficulty, difficulty_reviewed: { reviewed_at: difficultyReview.reviewed_at, reviewed_by: difficultyReview.reviewed_by } } : {}),
  };
}
