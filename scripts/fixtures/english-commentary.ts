/**
 * 영어 총평 검증 fixture.
 *
 * 개발 DB 의 en-v1.5.0 영어 분석은 0건이다. 이 파일은 실제 학교 시험이 아니라
 * 합의된 총평 계약에 맞춘 검증 입력이다. 학교명과 제목은 '검증용'만 쓴다.
 * 발문·선지·지문 원문은 넣지 않는다. 문항 근거는 readEnglishQuestionAnalysis 로
 * 정규화한 뒤 AnalyzedQuestion 에 싣는다.
 *
 * 생성기에 넘기는 값은 fixture.input 이 아니라
 * buildEnglishCommentaryContext(fixture.input) 이 돌려주는 EnglishCommentaryContext 다.
 * 실행: npx tsx scripts/verify-english-commentary-live.ts
 */
import {
  buildEnglishCommentaryContext, checkEnglishCommentaryReadiness, englishCommentaryContextSchema,
  type EnglishCommentaryContext, type EnglishCommentaryInput,
} from '../../src/lib/exam-analysis/english/commentary';
import { readEnglishQuestionAnalysis } from '../../src/lib/exam-analysis/english/question-evidence';
import { englishQuestionAnalysisSchema } from '../../src/lib/exam-analysis/english/question-evidence-schema';
import { checkAnalysisReadiness } from '../../src/lib/exam-analysis/readiness';
import { sumPoints } from '../../src/lib/exam-analysis/shared/points';
import type { EnglishKeyStructure, EnglishKeyTerm, AnalyzedQuestion, AnalysisSummary } from '../../src/lib/exam-analysis/types';
import type { ExamQuestionFormat } from '../../src/lib/exam-analysis/shared/constants';

export const FIVE_AXIS_RUBRIC = [
  { axis: '근거 정확성', check: '문항 번호, 배점, 유형, 출처 확인, 변형, 채점, 실측이 이 fixture 의 스냅샷과 같은가. 없는 지문이나 선지를 인용하지 않는가.' },
  { axis: '시험 구체성', check: '이 검증 시험의 형식 구성과 단원, 대표 문항이 드러나는가.' },
  { axis: '행동 실행성', check: '학습 행동이 문항 요구와 연결되는가. 구조 중심에서 대표 문항과 행동 배열이 비어 있는 것은 허용된다.' },
  { axis: '학부모 가독성', check: '쉬운 한국어인가. 내부 코드, 모델명, HTML 이 보이지 않는가.' },
  { axis: '과장 없음', check: '등급컷, 전국 기준, 킬러, 학생 실력 단정, 다른 학교 비교, 교육과정 어휘 수 인용이 없는가. 실측을 학교 전체로 넓히지 않는가.' },
] as const;

export type EnglishCommentaryAxis = (typeof FIVE_AXIS_RUBRIC)[number]['axis'];

/** 실제 호출은 generate.ts 의 이 수출만 탄다. index.ts 는 클라이언트 안전 수출이라 생성 함수가 없다. */
export const ENGLISH_COMMENTARY_GENERATOR = {
  module: 'src/lib/exam-analysis/english/commentary/generate.ts',
  exportName: 'generateEnglishCommentary',
  context: 'EnglishCommentaryContext',
  result: '{ ok:true, report, repaired, attempts, durationMs } | { ok:false, code, message, errors, attempts, durationMs }',
} as const;

export const ENGLISH_COMMENTARY_LIVE_DIR = 'test-results/english-commentary-live';

type Category = 'MIDTERM' | 'FINAL' | 'MOCK' | 'OTHER';
type Scope = 'structure' | 'evidence' | 'teacher';

export interface EnglishCommentaryFixtureExpect {
  scope: Scope;
  examCategory: Category;
  isMock: boolean;
  grade: string;
  semester: '1' | '2';
  questionCount: number;
  totalPoints: number;
  objective: number;
  shortAnswer: number;
  essay: number;
  typeCounts: Record<string, number>;
  listening: boolean;
  written: boolean;
  writingConditions: boolean;
  scoringSourced: number;
  observed: number;
  transformationEvidenced: number;
  verifiedSources: number;
  passageGroups: number;
  linkedPassages: number;
  readiness: boolean;
  /** 공통 readiness(배점 합·단원·누락)만. 소문항 초과는 여기 포함되지 않는다. */
  baseReadiness: boolean;
}

export interface EnglishCommentaryFixture {
  id: string;
  title: string;
  /** 실제 학교·실제 시험이 아니다. */
  validationOnly: true;
  note: string;
  run: 'generate' | 'block' | 'normalize';
  rich: boolean;
  repeat: boolean;
  /** 스냅샷에는 복사되지 않는다. examScope.textbookId 로만 남아 있다. */
  textbookId: string | null;
  input: EnglishCommentaryInput;
  expect: EnglishCommentaryFixtureExpect;
  normalizationCases?: Array<{ name: string; raw: unknown; kind: string; verification: string; title: string | null }>;
}

const DIFFICULTY = ['2', '3', '3', '4', '2', '3', '4', '5'] as const;
const ABILITY: Record<string, string> = {
  grammar: 'accuracy', vocabulary: 'accuracy', reading: 'understanding',
  listening: 'understanding', writing: 'expression', communication: 'expression',
};
function cycle<T>(values: readonly T[], index: number): T {
  return values[index % values.length];
}

/** 단원 문자열의 마지막 단계. 소견과 자리표시자 기능은 이 이름만 따른다. */
function topicLeaf(topic: string): string {
  const parts = topic.split('>').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '기록된 단원';
}

/** 유형별 고정 문장 대신 그 문항의 단원 이름을 쓴다. 출처·채점·변형 근거는 만들지 않는다. */
function commentFor(topic: string, format: ExamQuestionFormat, type: string): string {
  const leaf = topicLeaf(topic);
  const kind = format === 'essay' ? '서술형' : format === 'short_answer' ? '서답형' : type === 'listening' ? '듣기 문항' : '객관식';
  return `${leaf}의 쓰임을 묻는 ${kind}이다.`;
}

/** `검증 기능` 자리표시자만 단원 이름으로 바꾼다. `조건 영작`처럼 이미 적은 기능은 유지한다. */
function withUnitSkill(evidence: unknown, leaf: string): unknown {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;
  const record = { ...(evidence as Record<string, unknown>) };
  if (Array.isArray(record.skills) && record.skills.length === 1 && record.skills[0] === '검증 기능') {
    record.skills = [leaf];
  }
  return record;
}

/** 근거 문장이 없으면 read() 가 확인 상태를 미확인으로 내린다. extra 가 기본 필드를 덮어쓴다. */
function unverifiedItem(subtype: string, extra: Record<string, unknown> = {}) {
  return {
    source: { kind: 'textbook', title: '검증용 교과서', location: '3과 검증 레슨', verification: 'teacher_verified' },
    subtype, skills: ['검증 기능'], thinking: 'apply', distractors: '비슷한 형태를 고르게 한 선택지',
    ...extra,
  };
}

function confirmedItem(
  kind: 'textbook' | 'workbook' | 'mock',
  verification: 'teacher_verified' | 'printed',
  evidence: string,
  subtype: string,
  extra: Record<string, unknown> = {},
) {
  const title = kind === 'mock' ? '검증용 모의 문항' : kind === 'workbook' ? '검증용 부교재' : '검증용 교과서';
  return {
    subtype, skills: ['검증 기능'], thinking: 'understand', distractors: '세부 정보를 바꾸어 놓은 선택지',
    ...extra,
    source: { kind, title, location: '3과 검증 레슨', evidence, verification },
  };
}

function question(row: {
  question_number: number | string;
  question_format: ExamQuestionFormat;
  question_type: string;
  points: number;
  topic: string;
  difficulty?: string;
  ai_comment?: string | null;
  key_vocab?: EnglishKeyTerm[] | null;
  key_structures?: EnglishKeyStructure[] | null;
  evidence?: unknown;
}): AnalyzedQuestion {
  const type = row.question_type;
  const leaf = topicLeaf(row.topic);
  return {
    question_number: row.question_number,
    question_format: row.question_format,
    difficulty: row.difficulty ?? cycle(DIFFICULTY, typeof row.question_number === 'number' ? row.question_number : 0),
    difficulty_reason: '검증용 난도 메모',
    question_type: type,
    ability_domain: ABILITY[type] ?? 'understanding',
    points: row.points,
    topic: row.topic,
    ai_comment: row.ai_comment === undefined ? commentFor(row.topic, row.question_format, type) : row.ai_comment,
    key_vocab: row.key_vocab ?? null,
    key_structures: row.key_structures ?? null,
    english_analysis: readEnglishQuestionAnalysis(withUnitSkill(row.evidence ?? null, leaf)),
    confidence: 0.86,
    confidence_reason: '검증용 기록',
    is_correct: null,
    student_answer: null,
    earned_points: null,
    error_type: null,
  };
}

function numbered(count: number, start: number, build: (index: number, n: number) => AnalyzedQuestion): AnalyzedQuestion[] {
  return Array.from({ length: count }, (_, index) => build(index, start + index));
}

function summaryFor(questions: AnalyzedQuestion[], declaredPoints: number): AnalysisSummary {
  const difficulty_distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const type_distribution: Record<string, number> = {};
  for (const q of questions) {
    if (q.difficulty === '1' || q.difficulty === '2' || q.difficulty === '3' || q.difficulty === '4' || q.difficulty === '5') {
      difficulty_distribution[q.difficulty] += 1;
    }
    const type = q.question_type ?? 'unknown';
    type_distribution[type] = (type_distribution[type] ?? 0) + 1;
  }
  const pointsSum = sumPoints(questions.map((q) => q.points));
  const dominant = Object.entries(type_distribution).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'grammar';
  const modal = Object.entries(difficulty_distribution).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '3';
  return {
    difficulty_distribution, type_distribution, average_difficulty: modal, dominant_type: dominant,
    completeness: {
      status: 'ok', declaredQuestions: questions.length, declaredPoints, emittedQuestions: questions.length,
      pointsSum, pointsShortfall: declaredPoints - pointsSum, filledQuestions: 0, retried: false, reason: '',
    },
  };
}

function topicsOf(questions: AnalyzedQuestion[]): string[] {
  const out: string[] = [];
  for (const q of questions) if (q.topic && !out.includes(q.topic)) out.push(q.topic);
  return out;
}

function asInput(opts: {
  id: string;
  title: string;
  schoolName: string;
  grade: string;
  semester: 1 | 2;
  examCategory: Category;
  textbookId: string | null;
  questions: AnalyzedQuestion[];
  totalPoints: number;
}): EnglishCommentaryInput {
  const sum = sumPoints(opts.questions.map((q) => q.points));
  if (sum !== opts.totalPoints) throw new Error(`${opts.id} 배점 합 ${sum} !== ${opts.totalPoints}`);
  return {
    examPaper: {
      id: `validation-paper-${opts.id}`,
      title: opts.title,
      schoolName: opts.schoolName,
      grade: opts.grade,
      category: opts.examCategory,
      examScope: {
        topics: topicsOf(opts.questions),
        examSemester: opts.semester,
        examCategory: opts.examCategory,
        textbookId: opts.textbookId,
      },
    },
    analysis: {
      id: `validation-analysis-${opts.id}`,
      questions: opts.questions,
      summary: summaryFor(opts.questions, opts.totalPoints),
      totalPoints: opts.totalPoints,
    },
  };
}

const MIDDLE_TOPICS = ['중2 영어 > 문법 > 현재완료', '중2 영어 > 어휘 > 문맥 속 낱말', '중2 영어 > 독해 > 세부 정보'] as const;
const MIDDLE3_TOPICS = ['중3 영어 > 문법 > to부정사', '중3 영어 > 독해 > 주제와 요지', '중3 영어 > 어휘 > 어형 변화'] as const;
const HIGH_TOPICS = ['고1 영어 > 문법 > 관계대명사', '고1 영어 > 독해 > 빈칸 추론', '고1 영어 > 어휘 > 연어'] as const;
const HIGH2_TOPICS = ['고2 영어 > 독해 > 글의 순서', '고2 영어 > 문법 > 가정법', '고2 영어 > 어휘 > 문맥 속 낱말'] as const;
const LISTEN_TOPICS = ['고1 영어 > 듣기 > 세부 정보', '고1 영어 > 독해 > 주제와 요지'] as const;
const STRUCT_TOPICS = ['중1 영어 > 문법 > 현재진행', '중1 영어 > 어휘 > 기본 낱말', '중1 영어 > 독해 > 세부 정보'] as const;

const MIDDLE_TYPES = ['grammar', 'vocabulary', 'reading', 'communication'] as const;

function middleObjectiveQuestions(): AnalyzedQuestion[] {
  return numbered(22, 1, (index, n) => {
    const type = cycle(MIDDLE_TYPES, index);
    return question({
      question_number: n, question_format: 'objective', question_type: type,
      points: index < 12 ? 4 : index < 20 ? 5 : 6,
      difficulty: cycle(DIFFICULTY, index), topic: cycle(MIDDLE_TOPICS, index),
      key_vocab: type === 'vocabulary' ? [{ word: 'since', meaning: '이후' }] : null,
      key_structures: type === 'grammar' ? [{ pattern: 'have p.p.', meaning: '완료나 경험' }] : null,
      evidence: unverifiedItem(type === 'grammar' ? 'grammar_error' : type === 'vocabulary' ? 'contextual_word' : type === 'reading' ? 'detail' : 'dialogue'),
    });
  });
}

function essayScoring(points: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    subtype: 'conditional_writing',
    skills: ['조건 영작'],
    thinking: 'produce',
    writing_conditions: ['주어진 낱말을 모두 쓸 것', '두 문장으로 쓸 것'],
    scoring_criteria: '조건 누락과 어법 오류를 감점한다',
    scoring_source: '검증용 채점 메모',
    next_practice: '같은 조건으로 문장을 다시 써 본다',
    subquestions: points.map(([label, value]) => ({
      label, points: value, conditions: ['주어진 낱말을 모두 쓸 것'], scoring_criteria: '조건 누락을 감점한다',
    })),
  };
}

function middleConstructedQuestions(): AnalyzedQuestion[] {
  const objective = numbered(12, 1, (index, n) => question({
    question_number: n, question_format: 'objective', question_type: index % 2 === 0 ? 'grammar' : 'reading',
    points: 4, difficulty: cycle(DIFFICULTY, index), topic: cycle(MIDDLE3_TOPICS, index),
    evidence: unverifiedItem(index % 2 === 0 ? 'grammar_error' : 'detail'),
  }));
  const shorts = [1, 2].map((n) => question({
    question_number: `서답형${n}`, question_format: 'short_answer', question_type: 'writing', points: 6,
    difficulty: '3', topic: MIDDLE3_TOPICS[0],
    evidence: unverifiedItem('correction', { writing_conditions: ['틀린 한 곳을 바른 형태로 고친다'], thinking: 'apply' }),
  }));
  const essays = [1, 2, 3, 4].map((n) => question({
    question_number: `서술형${n}`, question_format: 'essay', question_type: 'writing', points: 10,
    difficulty: n > 2 ? '4' : '3', topic: MIDDLE3_TOPICS[0],
    evidence: n === 1
      ? unverifiedItem('conditional_writing', essayScoring([['(1)', 4], ['(2)', 6]]))
      : n === 2
        ? unverifiedItem('summary_writing', {
          writing_conditions: ['글의 뜻을 한 문장으로 쓴다'], scoring_criteria: '핵심 내용의 누락을 감점한다', scoring_source: '검증용 채점 메모',
        })
        : unverifiedItem('conditional_writing', { writing_conditions: ['주어진 뜻을 한 문장으로 쓴다'] }),
  }));
  return [...objective, ...shorts, ...essays];
}

function highWritingQuestions(): AnalyzedQuestion[] {
  const objective = numbered(14, 1, (index, n) => {
    const type = index % 2 === 0 ? 'grammar' : 'reading';
    const confirmed = index < 2;
    return question({
      question_number: n, question_format: 'objective', question_type: type, points: 3,
      difficulty: cycle(DIFFICULTY, index), topic: cycle(HIGH_TOPICS, index),
      key_structures: type === 'grammar' ? [{ pattern: 'too ~ to', meaning: '너무 해서 할 수 없다' }] : null,
      evidence: confirmed
        ? confirmedItem('textbook', 'teacher_verified', '검증용 교사 확인 메모', type === 'grammar' ? 'grammar_error' : 'blank')
        : unverifiedItem(type === 'grammar' ? 'grammar_error' : 'blank', index >= 2 && index <= 4 ? { passage_id: '검증-지문-1' } : {}),
    });
  });
  const shorts = [1, 2].map((n) => question({
    question_number: `서답형${n}`, question_format: 'short_answer', question_type: 'writing', points: 5,
    difficulty: '3', topic: HIGH_TOPICS[0],
    evidence: unverifiedItem('correction', { writing_conditions: ['바른 형태로 한 줄만 고친다'] }),
  }));
  const essays = [0, 1, 2, 3].map((index) => question({
    question_number: `서술형${index + 1}`, question_format: 'essay', question_type: 'writing', points: 12,
    difficulty: index >= 2 ? '5' : '4', topic: HIGH_TOPICS[0],
    key_vocab: [{ word: 'although', meaning: '비록' }],
    evidence: confirmedItem('textbook', 'teacher_verified', '검증용 교사 확인 메모', 'conditional_writing', {
      ...essayScoring([['(1)', 5], ['(2)', 7]]),
      ...(index < 2 ? { transformation: 'modified', transformation_evidence: '검증용 대조 메모: 문장 순서를 바꿈' } : {}),
      ...(index < 2 ? { observation: { respondents: 24, incorrect: 9, group: '검증용 응답 집단', source: '검증용 채점 집계', observed_at: '2026-03-15' } } : {}),
      ...(index === 0 ? { achievement_standards: ['조건에 맞는 문장으로 의견을 쓴다'], standards_source: '검증용 교사 메모이며 교육과정 고시 인용이 아님' } : {}),
    }),
  }));
  return [...objective, ...shorts, ...essays];
}

function explicitSourceQuestions(): AnalyzedQuestion[] {
  const types = ['grammar', 'vocabulary', 'reading', 'communication'] as const;
  const subtypes = ['grammar_error', 'contextual_word', 'sequence', 'dialogue'] as const;
  return numbered(20, 1, (index, n) => {
    const type = cycle(types, index);
    const subtype = cycle(subtypes, index);
    const passage = index >= 4 && index <= 7 ? '검증-지문-2' : index === 10 || index === 11 ? '검증-지문-3' : null;
    const transform = [0, 1, 8, 9].includes(index)
      ? { transformation: 'unchanged', transformation_evidence: '검증용 대조 메모: 문장을 그대로 썼다' }
      : {};
    const observation = index === 2 || index === 3
      ? { observation: { respondents: index === 2 ? 24 : 30, incorrect: index === 2 ? 9 : 4, group: '검증용 응답 집단', source: '검증용 채점 집계', observed_at: '2026-03-15' } }
      : {};
    const evidence = index < 8
      ? confirmedItem('textbook', 'teacher_verified', '검증용 교사 확인 메모', subtype, { ...transform, ...observation, ...(passage ? { passage_id: passage } : {}) })
      : index < 14
        ? confirmedItem('workbook', 'printed', '시험지에 검증용 부교재라고 인쇄되어 있음', subtype, { ...transform, ...(passage ? { passage_id: passage } : {}) })
        : unverifiedItem(subtype);
    return question({
      question_number: n, question_format: 'objective', question_type: type, points: 5,
      difficulty: cycle(DIFFICULTY, index), topic: cycle(HIGH2_TOPICS, index),
      key_vocab: type === 'vocabulary' ? [{ word: 'although', meaning: '비록' }] : null,
      evidence,
    });
  });
}

function listeningQuestions(): AnalyzedQuestion[] {
  const listening = numbered(10, 1, (index, n) => question({
    question_number: n, question_format: 'objective', question_type: 'listening', points: 3,
    difficulty: cycle(DIFFICULTY, index), topic: LISTEN_TOPICS[0],
    evidence: confirmedItem('mock', 'printed', '시험지에 듣기 문항이라고 인쇄되어 있음', index % 2 === 0 ? 'listening_detail' : 'listening_inference', {
      thinking: 'understand', distractors: '대화에 없는 세부 정보를 넣은 선택지', ...(index < 5 ? { passage_id: '검증-듣기-1' } : {}),
    }),
  }));
  const reading = numbered(10, 11, (index, n) => question({
    question_number: n, question_format: 'objective', question_type: 'reading', points: 7,
    difficulty: cycle(DIFFICULTY, index + 3), topic: LISTEN_TOPICS[1],
    evidence: unverifiedItem('main_idea', { source: { kind: 'mock', title: '검증용 모의 문항', verification: 'unverified' } }),
  }));
  return [...listening, ...reading];
}

function structureQuestions(): AnalyzedQuestion[] {
  const types = ['grammar', 'vocabulary', 'reading'] as const;
  return numbered(15, 1, (index, n) => question({
    question_number: n, question_format: 'objective', question_type: cycle(types, index),
    points: index < 10 ? 6 : 8, difficulty: cycle(DIFFICULTY, index), topic: cycle(STRUCT_TOPICS, index),
    ai_comment: null, evidence: null,
  }));
}

function blockedQuestions(): AnalyzedQuestion[] {
  const objective = numbered(11, 1, (index, n) => question({
    question_number: n, question_format: 'objective', question_type: 'grammar', points: 8,
    difficulty: cycle(DIFFICULTY, index), topic: cycle(MIDDLE_TOPICS, index),
    evidence: unverifiedItem('grammar_error'),
  }));
  const essay = question({
    question_number: '서술형1', question_format: 'essay', question_type: 'writing', points: 12,
    difficulty: '4', topic: MIDDLE_TOPICS[0],
    evidence: unverifiedItem('conditional_writing', {
      writing_conditions: ['주어진 낱말을 모두 쓸 것'],
      subquestions: [
        { label: '(1)', points: 8, conditions: ['검증용 조건'], scoring_criteria: null },
        { label: '(2)', points: 8, conditions: ['검증용 조건'], scoring_criteria: null },
      ],
    }),
  });
  return [...objective, essay];
}

export const DAMAGED_NORMALIZATION_CASES: Array<{ name: string; raw: unknown; kind: string; verification: string; title: string | null }> = [
  { name: 'null', raw: null, kind: 'unknown', verification: 'unverified', title: null },
  { name: '문자열', raw: 'bad', kind: 'unknown', verification: 'unverified', title: null },
  { name: '배열', raw: [], kind: 'unknown', verification: 'unverified', title: null },
  { name: '숫자', raw: 12, kind: 'unknown', verification: 'unverified', title: null },
  { name: '프로토타입 키와 근거 없는 변형', raw: { source: { kind: 'toString', verification: 'teacher_verified' }, transformation: 'unchanged', observation: { respondents: -1 } }, kind: 'unknown', verification: 'unverified', title: null },
  { name: '인원 초과 실측', raw: { source: [], skills: [null, 1], observation: { respondents: 10, incorrect: 30, group: '검증용 응답 집단', source: '검증용 채점 집계' } }, kind: 'unknown', verification: 'unverified', title: null },
  { name: '근거 없는 변형', raw: { transformation: 'modified' }, kind: 'unknown', verification: 'unverified', title: null },
  { name: '근거 없는 교사 확인 주장', raw: { source: { kind: 'textbook', title: '검증용 교과서', verification: 'teacher_verified' }, transformation: 'unchanged' }, kind: 'textbook', verification: 'unverified', title: '검증용 교과서' },
];

/** read() 는 출처 없는 채점 문구를 남긴다. 총평 스냅샷 빌더가 그 문구를 지운다. */
export const UNSOURCED_SCORING_SAMPLE = { scoring_criteria: '검증용 채점 문구', transformation: 'new' };

function damagedQuestions(): AnalyzedQuestion[] {
  return DAMAGED_NORMALIZATION_CASES.map((item, index) => question({
    question_number: index + 1, question_format: 'objective', question_type: 'grammar', points: 10,
    difficulty: cycle(DIFFICULTY, index), topic: cycle(STRUCT_TOPICS, index), ai_comment: null, evidence: item.raw,
  }));
}

function defineFixture(opts: Omit<EnglishCommentaryFixture, 'validationOnly' | 'input'> & {
  schoolName: string;
  grade: string;
  semester: 1 | 2;
  questions: AnalyzedQuestion[];
}): EnglishCommentaryFixture {
  return {
    id: opts.id, title: opts.title, validationOnly: true, note: opts.note, run: opts.run, rich: opts.rich, repeat: opts.repeat,
    textbookId: opts.textbookId, expect: opts.expect, normalizationCases: opts.normalizationCases,
    input: asInput({
      id: opts.id, title: opts.title, schoolName: opts.schoolName, grade: opts.grade, semester: opts.semester,
      examCategory: opts.expect.examCategory, textbookId: opts.textbookId, questions: opts.questions, totalPoints: opts.expect.totalPoints,
    }),
  };
}

export const ENGLISH_COMMENTARY_FIXTURES: readonly EnglishCommentaryFixture[] = [
  defineFixture({
    id: 'middle-objective', title: '검증용 중2 객관식 구성', schoolName: '검증용 중학교', grade: '중2', semester: 1,
    textbookId: 'validation-textbook-middle', run: 'generate', rich: false, repeat: false,
    note: '중등 객관식만 있다. 원자료에 교사 확인이라고 적혀 있어도 확인 근거가 없어 미확인으로 남고, 세부 유형은 남는다.',
    questions: middleObjectiveQuestions(),
    expect: {
      scope: 'evidence', examCategory: 'MIDTERM', isMock: false, grade: '중2', semester: '1', questionCount: 22, totalPoints: 100,
      objective: 22, shortAnswer: 0, essay: 0, typeCounts: { grammar: 6, vocabulary: 6, reading: 5, communication: 5 },
      listening: false, written: false, writingConditions: false, scoringSourced: 0, observed: 0, transformationEvidenced: 0,
      verifiedSources: 0, passageGroups: 0, linkedPassages: 0, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'middle-constructed', title: '검증용 중3 서답형 구성', schoolName: '검증용 중학교', grade: '중3', semester: 2,
    textbookId: 'validation-textbook-middle', run: 'generate', rich: false, repeat: false,
    note: '중등 서답형. 서술형1의 소문항 배점은 부모 배점과 같다. 채점 출처는 일부 서술형에만 있다. 지문 출처는 미확인이다.',
    questions: middleConstructedQuestions(),
    expect: {
      scope: 'evidence', examCategory: 'FINAL', isMock: false, grade: '중3', semester: '2', questionCount: 18, totalPoints: 100,
      objective: 12, shortAnswer: 2, essay: 4, typeCounts: { grammar: 6, reading: 6, writing: 6 },
      listening: false, written: true, writingConditions: true, scoringSourced: 2, observed: 0, transformationEvidenced: 0,
      verifiedSources: 0, passageGroups: 0, linkedPassages: 0, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'high-conditional-writing', title: '검증용 고1 조건영작 구성', schoolName: '검증용 고등학교', grade: '고1', semester: 1,
    textbookId: 'validation-textbook-high', run: 'generate', rich: true, repeat: true,
    note: '고등 조건 영작. 소문항 합은 부모 배점과 같다. 교사 확인, 변형 근거, 채점 출처, 응답 집단 실측이 함께 있다. 반복 생성 대상이다.',
    questions: highWritingQuestions(),
    expect: {
      scope: 'teacher', examCategory: 'MIDTERM', isMock: false, grade: '고1', semester: '1', questionCount: 20, totalPoints: 100,
      objective: 14, shortAnswer: 2, essay: 4, typeCounts: { grammar: 7, reading: 7, writing: 6 },
      listening: false, written: true, writingConditions: true, scoringSourced: 4, observed: 2, transformationEvidenced: 2,
      verifiedSources: 6, passageGroups: 1, linkedPassages: 3, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'explicit-source', title: '검증용 고2 명시출처 구성', schoolName: '검증용 고등학교', grade: '고2', semester: 2,
    textbookId: 'validation-textbook-high', run: 'generate', rich: true, repeat: true,
    note: '객관식 20문항. 8문항은 교사 확인, 6문항은 시험지 인쇄 출처, 6문항은 미확인이다. 반복 생성 대상이다.',
    questions: explicitSourceQuestions(),
    expect: {
      scope: 'teacher', examCategory: 'FINAL', isMock: false, grade: '고2', semester: '2', questionCount: 20, totalPoints: 100,
      objective: 20, shortAnswer: 0, essay: 0, typeCounts: { grammar: 5, vocabulary: 5, reading: 5, communication: 5 },
      listening: false, written: false, writingConditions: false, scoringSourced: 0, observed: 2, transformationEvidenced: 4,
      verifiedSources: 14, passageGroups: 2, linkedPassages: 6, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'listening-mock', title: '검증용 듣기 모의 구성', schoolName: '검증용 모의평가', grade: '고1', semester: 1,
    textbookId: null, run: 'generate', rich: false, repeat: false,
    note: '듣기 모의. 듣기 10문항은 시험지에 듣기라고 인쇄된 출처만 있고, 독해 10문항은 출처 미확인이다. 지문 본문은 없다.',
    questions: listeningQuestions(),
    expect: {
      scope: 'evidence', examCategory: 'MOCK', isMock: true, grade: '고1', semester: '1', questionCount: 20, totalPoints: 100,
      objective: 20, shortAnswer: 0, essay: 0, typeCounts: { listening: 10, reading: 10 },
      listening: true, written: false, writingConditions: false, scoringSourced: 0, observed: 0, transformationEvidenced: 0,
      verifiedSources: 10, passageGroups: 1, linkedPassages: 5, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'structure-centered', title: '검증용 구조중심 구성', schoolName: '검증용 중학교', grade: '중1', semester: 1,
    textbookId: null, run: 'generate', rich: false, repeat: false,
    note: '배점·단원·형식은 완전하고 문항 세부 근거는 없다. 구조 중심 보고서로 생성을 허용한다.',
    questions: structureQuestions(),
    expect: {
      scope: 'structure', examCategory: 'MIDTERM', isMock: false, grade: '중1', semester: '1', questionCount: 15, totalPoints: 100,
      objective: 15, shortAnswer: 0, essay: 0, typeCounts: { grammar: 5, vocabulary: 5, reading: 5 },
      listening: false, written: false, writingConditions: false, scoringSourced: 0, observed: 0, transformationEvidenced: 0,
      verifiedSources: 0, passageGroups: 0, linkedPassages: 0, readiness: true, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'subquestion-points-incomplete', title: '검증용 소문항 배점 불완전', schoolName: '검증용 중학교', grade: '중2', semester: 1,
    textbookId: 'validation-textbook-middle', run: 'block', rich: false, repeat: false,
    note: '부모 배점 합은 만점과 같다. 서술형1의 소문항 8점+8점은 부모 12점을 넘는다. 생성 호출 전에 막혀야 한다.',
    questions: blockedQuestions(),
    expect: {
      scope: 'evidence', examCategory: 'MIDTERM', isMock: false, grade: '중2', semester: '1', questionCount: 12, totalPoints: 100,
      objective: 11, shortAnswer: 0, essay: 1, typeCounts: { grammar: 11, writing: 1 },
      listening: false, written: true, writingConditions: true, scoringSourced: 0, observed: 0, transformationEvidenced: 0,
      verifiedSources: 0, passageGroups: 0, linkedPassages: 0, readiness: false, baseReadiness: true,
    },
  }),
  defineFixture({
    id: 'damaged-json', title: '검증용 손상 JSON', schoolName: '검증용 중학교', grade: '중1', semester: 1,
    textbookId: null, run: 'normalize', rich: false, repeat: false,
    note: '손상 원본은 정규화 뒤에만 문항에 남는다. 실측·변형·교사 확인은 근거가 없으면 확정되지 않는다. 모델에는 넘기지 않는다.',
    questions: damagedQuestions(), normalizationCases: DAMAGED_NORMALIZATION_CASES,
    expect: {
      scope: 'structure', examCategory: 'MIDTERM', isMock: false, grade: '중1', semester: '1', questionCount: 8, totalPoints: 80,
      objective: 8, shortAnswer: 0, essay: 0, typeCounts: { grammar: 8 },
      listening: false, written: false, writingConditions: false, scoringSourced: 0, observed: 0, transformationEvidenced: 0,
      verifiedSources: 0, passageGroups: 0, linkedPassages: 0, readiness: true, baseReadiness: true,
    },
  }),
];

export const ENGLISH_COMMENTARY_LIVE_FIXTURES = ENGLISH_COMMENTARY_FIXTURES.filter((f) => f.run === 'generate');
export const ENGLISH_COMMENTARY_REPEATED_FIXTURES = ENGLISH_COMMENTARY_LIVE_FIXTURES.filter((f) => f.repeat);
export const ENGLISH_COMMENTARY_BLOCKED_FIXTURES = ENGLISH_COMMENTARY_FIXTURES.filter((f) => f.run === 'block');
export const ENGLISH_COMMENTARY_NORMALIZE_FIXTURES = ENGLISH_COMMENTARY_FIXTURES.filter((f) => f.run === 'normalize');

export function commentaryContextFor(fixture: EnglishCommentaryFixture): EnglishCommentaryContext {
  return buildEnglishCommentaryContext(fixture.input);
}

const FORBIDDEN_QUESTION_KEYS = ['content', 'choices', 'stem', 'passage', 'explanation', 'answer', 'source_text'];
const ENGLISH_SENTENCE = /[A-Za-z]+(?:\s+[A-Za-z]+){3,}/;
const FORBIDDEN_CLAIMS = ['등급컷', '전국', '킬러', '1등급', '1500', '3500', '적중'];

function formatCount(ctx: EnglishCommentaryContext, key: string): number {
  return ctx.formats.find((g) => g.key === key)?.count ?? 0;
}

export function preflightEnglishCommentaryFixtures(): string[] {
  const problems: string[] = [];
  const lines: string[] = [];
  const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
  const ids = ENGLISH_COMMENTARY_FIXTURES.map((f) => f.id);
  check(new Set(ids).size === ids.length, 'fixture id 가 중복된다');
  check(ENGLISH_COMMENTARY_LIVE_FIXTURES.length === 6, `생성 fixture ${ENGLISH_COMMENTARY_LIVE_FIXTURES.length}개`);
  check(ENGLISH_COMMENTARY_REPEATED_FIXTURES.length === 2, '반복 fixture 는 풍부한 근거 2개여야 한다');
  check(ENGLISH_COMMENTARY_BLOCKED_FIXTURES.length === 1, '차단 fixture 가 하나여야 한다');
  check(ENGLISH_COMMENTARY_NORMALIZE_FIXTURES.length === 1, '손상 JSON fixture 가 하나여야 한다');

  for (const fixture of ENGLISH_COMMENTARY_FIXTURES) {
    const expect = fixture.expect;
    check(fixture.title.includes('검증용') && (fixture.input.examPaper.schoolName ?? '').includes('검증용'), `${fixture.id} 이름이 검증용이어야 한다`);
    check(fixture.rich === fixture.repeat, `${fixture.id} 풍부한 근거와 반복 생성 표시가 어긋난다`);
    check(!fixture.input.examPaper.examStats, `${fixture.id} 에 학교 통계를 넣지 않는다`);
    const questions = fixture.input.analysis.questions;
    check(Array.isArray(questions), `${fixture.id} 문항이 배열이 아니다`);
    if (!Array.isArray(questions)) continue;
    const serialized = JSON.stringify(fixture.input);
    check(!ENGLISH_SENTENCE.test(serialized), `${fixture.id} 에 영어 문장이 있다`);
    for (const claim of FORBIDDEN_CLAIMS) check(!serialized.includes(claim), `${fixture.id} 에 금지 표현 ${claim}`);
    for (const q of questions) {
      if (!q || typeof q !== 'object') { check(false, `${fixture.id} 문항 모양`); continue; }
      for (const key of FORBIDDEN_QUESTION_KEYS) check(!(key in q), `${fixture.id} 에 ${key} 원문이 있다`);
      const analysis = (q as AnalyzedQuestion).english_analysis;
      check(JSON.stringify(readEnglishQuestionAnalysis(analysis)) === JSON.stringify(analysis), `${fixture.id} 근거가 read() 결과와 다르다`);
      const item = q as AnalyzedQuestion;
      const leaf = topicLeaf(item.topic ?? '');
      if (typeof item.ai_comment === 'string') {
        check(item.ai_comment.includes(leaf), `${fixture.id} ${item.question_number} 소견이 단원 ${leaf}와 다르다`);
        check(leaf === '현재완료' || !item.ai_comment.includes('현재완료'), `${fixture.id} ${item.question_number} 소견이 현재완료로 고정되어 있다`);
      }
      const skills = item.english_analysis?.skills ?? [];
      check(!skills.includes('검증 기능'), `${fixture.id} ${item.question_number} 기능 자리표시자가 남아 있다`);
      if (skills.length === 1 && skills[0] !== '조건 영작') {
        check(skills[0] === leaf, `${fixture.id} ${item.question_number} 기능이 단원과 다르다`);
      }
    }

    const ctx = commentaryContextFor(fixture);
    const parsed = englishCommentaryContextSchema.safeParse(ctx);
    if (!parsed.success) problems.push(`${fixture.id} 스냅샷 스키마: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    check(ctx.exam.year === null, `${fixture.id} 연도를 추정하면 안 된다`);
    check(ctx.examStats === null, `${fixture.id} 통계 스냅샷이 비어 있어야 한다`);
    check(ctx.evidence.scope === expect.scope, `${fixture.id} 범위 ${ctx.evidence.scope} !== ${expect.scope}`);
    check(ctx.exam.examCategory === expect.examCategory && ctx.exam.isMock === expect.isMock, `${fixture.id} 시험 종류`);
    check(ctx.exam.grade === expect.grade && ctx.exam.semester === expect.semester, `${fixture.id} 학년·학기`);
    check(ctx.totals.questionCount === expect.questionCount && ctx.totals.knownPoints === expect.totalPoints, `${fixture.id} 문항수·배점`);
    check(ctx.totals.unknownPointsCount === 0 && ctx.totals.completeness === 'ok', `${fixture.id} 배점 미확인`);
    check(formatCount(ctx, 'objective') === expect.objective && formatCount(ctx, 'short_answer') === expect.shortAnswer && formatCount(ctx, 'essay') === expect.essay, `${fixture.id} 형식 수`);
    for (const [type, count] of Object.entries(expect.typeCounts)) {
      check((ctx.types.find((g) => g.key === type)?.count ?? 0) === count, `${fixture.id} 유형 ${type}`);
    }
    check(ctx.flags.hasListening === expect.listening && ctx.flags.hasWrittenResponse === expect.written && ctx.flags.hasWritingConditions === expect.writingConditions, `${fixture.id} 플래그`);
    check(ctx.evidence.scoringSourced === expect.scoringSourced && ctx.evidence.observed === expect.observed && ctx.evidence.transformationEvidenced === expect.transformationEvidenced && ctx.evidence.verifiedSources === expect.verifiedSources, `${fixture.id} 근거 수`);
    check(ctx.passages.groups === expect.passageGroups && ctx.passages.linkedQuestions === expect.linkedPassages, `${fixture.id} 지문 id 수`);
    check(ctx.difficulty.unknown === 0 && ctx.difficulty.counts.reduce((s, n) => s + n, 0) === expect.questionCount, `${fixture.id} 난도 분포`);
    if (expect.scope === 'structure') {
      check(ctx.candidates.length === 0 && ctx.limits.representatives.min === 0 && ctx.limits.actions.min === 0, `${fixture.id} 구조 중심은 빈 대표·행동을 허용해야 한다`);
    }

    const readiness = checkEnglishCommentaryReadiness(fixture.input);
    const base = checkAnalysisReadiness({
      questions: ctx.questions.map((q) => ({ points: q.points, topic: q.topic })),
      totalPoints: fixture.input.analysis.totalPoints,
      summary: fixture.input.analysis.summary,
    });
    check(readiness.ready === expect.readiness, `${fixture.id} 총평 게이트 ${readiness.ready} (${readiness.reasons.join(' / ')})`);
    check(base.ready === expect.baseReadiness, `${fixture.id} 공통 게이트 ${base.ready} (${base.reasons.join(' / ')})`);
    if (fixture.run === 'block') {
      check(readiness.reasons.some((r) => r.includes('소문항 배점 합계가 문항 배점과 일치해야 합니다')), `${fixture.id} 소문항 사유가 없다`);
      check(readiness.reasons.every((r) => r.includes('소문항 배점')), `${fixture.id} 차단 사유가 소문항 배점 밖에 있으면 안 된다: ${readiness.reasons.join(' / ')}`);
    }

    if (fixture.normalizationCases) {
      check(fixture.normalizationCases.length === questions.length, `${fixture.id} 손상 사례 수`);
      fixture.normalizationCases.forEach((item, index) => {
        const read = readEnglishQuestionAnalysis(item.raw);
        const stored = (questions[index] as AnalyzedQuestion).english_analysis;
        check(!!stored && read.source.kind === item.kind && read.source.verification === item.verification, `${fixture.id} ${item.name} 정규화`);
        check(read.observation === null && read.transformation === 'unknown', `${fixture.id} ${item.name} 실측·변형`);
        check(read.source.title === item.title, `${fixture.id} ${item.name} 제목`);
        check(JSON.stringify(ctx.questions[index]?.evidence) === JSON.stringify(stored), `${fixture.id} ${item.name} 스냅샷`);
      });
    }
    lines.push(`${fixture.id} ${fixture.run} ${ctx.evidence.scopeLabel} ${ctx.totals.questionCount}문항 ${ctx.totals.knownPoints}점`);
  }

  const sample = ENGLISH_COMMENTARY_FIXTURES[0];
  const sampleQuestions = sample.input.analysis.questions;
  if (Array.isArray(sampleQuestions) && sampleQuestions.length > 0) {
    const dup = checkEnglishCommentaryReadiness({
      ...sample.input,
      analysis: { ...sample.input.analysis, questions: [sampleQuestions[0], sampleQuestions[0]] },
    });
    check(dup.reasons.some((r) => r.includes('중복')), '중복 문항 번호 게이트');
  }

  const stripped = commentaryContextFor(defineFixture({
    id: 'unsourced-scoring-probe', title: '검증용 채점출처 없음', schoolName: '검증용 중학교', grade: '중1', semester: 1,
    textbookId: null, run: 'normalize', rich: false, repeat: false, note: 'probe',
    questions: [question({ question_number: 1, question_format: 'objective', question_type: 'grammar', points: 10, topic: STRUCT_TOPICS[0], evidence: UNSOURCED_SCORING_SAMPLE })],
    expect: {
      scope: 'structure', examCategory: 'MIDTERM', isMock: false, grade: '중1', semester: '1', questionCount: 1, totalPoints: 10,
      objective: 1, shortAnswer: 0, essay: 0, typeCounts: { grammar: 1 }, listening: false, written: false, writingConditions: false,
      scoringSourced: 0, observed: 0, transformationEvidenced: 0, verifiedSources: 0, passageGroups: 0, linkedPassages: 0,
      readiness: true, baseReadiness: true,
    },
  }));
  check(readEnglishQuestionAnalysis(UNSOURCED_SCORING_SAMPLE).scoring_criteria === '검증용 채점 문구', 'read() 는 출처 없는 채점 문구를 보존한다');
  check(!englishQuestionAnalysisSchema.safeParse(readEnglishQuestionAnalysis(UNSOURCED_SCORING_SAMPLE)).success, '편집 스키마는 출처 없는 채점을 거절한다');
  check(stripped.questions[0]?.evidence.scoring_criteria === null && stripped.questions[0]?.evidence.transformation === 'unknown', '스냅샷은 출처 없는 채점과 변형을 싣지 않는다');

  if (problems.length) throw new Error(problems.join('\n'));
  return lines;
}
