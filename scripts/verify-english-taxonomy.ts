/**
 * 영어 기출 분석 정규화·프롬프트 과목 분기 스모크.
 * 실행: npx tsx scripts/verify-english-taxonomy.ts
 */
import { ExamPromptBuilder } from '../src/lib/exam-analysis/prompt-builder';
import { simplifyExamKorean } from '../src/lib/exam-analysis/simple-korean';
import {
  defaultQuestionType,
  isMathSubject,
  normalizeAbilityDomain,
  normalizeQuestionType,
  toExamSubjectKey,
} from '../src/lib/exam-analysis/subject';
import type { ExamContext } from '../src/lib/exam-analysis/types';
import {
  describeEnglishExamScope,
  findEnglishLessonByScopeValue,
  getEnglishCoursesForGrade,
  getEnglishLessonScopeOptions,
  getEnglishTextbooks,
} from '../src/lib/exam-analysis/english-textbooks';
import { getEnglishTopicOptionsGrouped } from '../src/lib/exam-analysis/english-topics';
import {
  buildEnglishStudyFromQuestions,
  isEnglishStudyJunk,
  parseEnglishStudyResult,
  splitEnglishStudy,
} from '../src/lib/exam-analysis/english-study-pack';
import type { AnalyzedQuestion } from '../src/lib/exam-analysis/types';
import { ANALYZING_STEP_LOGS } from '../src/lib/exam-analysis/analyzing-progress-copy';
import { progressFromCliNdjsonLine } from '../src/lib/exam-analysis/analysis-progress';

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

assert(toExamSubjectKey('MATH') === 'MATH', 'MATH 키');
assert(toExamSubjectKey('영어') === 'ENGLISH', '한글 영어 → ENGLISH');
assert(isMathSubject('MATH') && !isMathSubject('ENGLISH'), 'isMathSubject');

assert(normalizeQuestionType('ENGLISH', 'grammar') === 'grammar', 'grammar 유지');
assert(normalizeQuestionType('ENGLISH', 'GRAMMAR') === 'grammar', 'GRAMMAR → grammar');
assert(normalizeQuestionType('ENGLISH', '어법') === 'grammar', '어법 → grammar');
assert(normalizeQuestionType('ENGLISH', 'reading-main-idea') === 'reading', 'reading-main-idea → reading');
assert(normalizeQuestionType('ENGLISH', 'change_relation') === null, '영어에서 수학 키는 null');
assert(normalizeQuestionType('MATH', 'grammar') !== 'grammar', '수학에서 grammar 를 grammar 로 두지 않음');
assert(normalizeQuestionType('MATH', 'number') === 'number', '수학 number 유지');
assert(normalizeQuestionType('MATH', 'algebra') === 'change_relation', 'algebra → change_relation');

assert(normalizeAbilityDomain('ENGLISH', 'ACCURACY') === 'accuracy', 'ACCURACY → accuracy');
assert(normalizeAbilityDomain('ENGLISH', 'calculation') === 'accuracy', 'calculation → accuracy');
assert(normalizeAbilityDomain('ENGLISH', 'problem-solving') === 'expression', 'problem-solving → expression');
assert(normalizeAbilityDomain('MATH', 'CALCULATION') === 'calculation', '수학 CALCULATION → calculation');
assert(defaultQuestionType('ENGLISH') === 'reading', '영어 placeholder reading');

const mathCtx: ExamContext = {
  subject: 'MATH',
  grade_level: '중2',
  unit: null,
  category: '중2-1',
  exam_scope: null,
  paper_type: 'blank',
  has_essay: true,
  exam_year: 2025,
  exam_semester: 1,
  exam_category: 'MIDTERM',
};
const enCtx: ExamContext = { ...mathCtx, subject: 'ENGLISH', category: null };

const mathPrompt = ExamPromptBuilder.build(mathCtx).combined_prompt;
const enPrompt = ExamPromptBuilder.build(enCtx).combined_prompt;

assert(mathPrompt.includes('number | algebra | function | geometry | statistics'), '수학 H3 문자열 유지');
assert(!mathPrompt.includes('grammar | vocabulary | reading | listening | writing | communication'), '수학 프롬프트에 영어 6유형 H3 없음');
assert(enPrompt.includes('grammar | vocabulary | reading | listening | writing | communication'), '영어 H3 6유형');
assert(enPrompt.includes('듣기 전용 문항이 명시된 경우'), '영어 듣기는 시험지 근거로 분류');
assert(enPrompt.includes('호혜적'), '영어 코멘트 쉬운 말 규칙');
assert(
  simplifyExamKorean('호혜적 교환의 함축 의미를 파악하는 독해입니다.') === '서로 주고받는 관계의 숨은 뜻을 파악하는 독해입니다.',
  '호혜적·함축 표시 치환',
);
assert(!enPrompt.includes('number | algebra | function | geometry | statistics'), '영어 프롬프트에 수학 5키 H3 없음');
assert(enPrompt.includes('accuracy | understanding | reasoning | expression'), '영어 H4 소문자 4능력');
assert(mathPrompt.includes('\\dfrac'), '수학 H5 KaTeX 유지');
assert(!enPrompt.includes('숫자와 영문 변수는'), '영어에 KaTeX 강제 없음');
assert(enPrompt.includes('중2 영어 >'), '영어 허용 topic 주입');

assert(
  !getEnglishTopicOptionsGrouped('중1').some((g) => g.label === '듣기'),
  '중1 단원 드롭다운에서 듣기 숨김',
);
assert(
  getEnglishTopicOptionsGrouped('중1', { includeListening: true }).some((g) => g.label === '듣기'),
  '기존 듣기 문항은 듣기 그룹 유지',
);

assert(getEnglishTextbooks('중1').length === 10, '중1 교과서 10종');
assert(getEnglishTextbooks('중2').length === 10, '중2 교과서 10종');
assert(getEnglishTextbooks('중3').length === 0, '중3 단원 미공고');
assert(getEnglishCoursesForGrade('고1').includes('공통영어1'), '고1 공통영어1');
assert(
  getEnglishTextbooks('고1', '공통영어1').some((b) => b.displayName === 'NE능률 민병천'),
  '공통영어1 NE능률 민병천',
);
assert(
  getEnglishLessonScopeOptions(getEnglishTextbooks('중1').find((b) => b.displayName === '능률 김기택')?.id)
    .some((o) => o.label === 'L1. About You and Me'),
  '능률 김기택 L1 제목',
);
const kitakL1 = getEnglishTextbooks('중1').find((b) => b.displayName === '능률 김기택')
  ?.lessons.find((l) => l.title.startsWith('L1.'));
assert(kitakL1?.passage === 'Me and My Three Emojis', '능률 김기택 L1 본문');
assert(!!kitakL1?.grammar?.includes('be동사'), '능률 김기택 L1 문법');
const jihakL1 = findEnglishLessonByScopeValue(
  '공통영어1 > 지학사 신상근 > Lesson 1. Hi, High School',
);
assert(!!jihakL1?.functions?.includes('관심 표현하기'), '지학사 공통영어1 L1 의사소통');
assert(
  describeEnglishExamScope(['중1 > 능률 김기택 > L1. About You and Me']).includes('be동사'),
  '출제범위 프롬프트에 문법',
);
assert(
  !getEnglishTextbooks('고2', '영어Ⅰ').some((b) => b.displayName.startsWith('I ')),
  '영어Ⅰ에 영어Ⅱ 복제 블록 없음',
);

const enScoped = ExamPromptBuilder.build({
  ...enCtx,
  exam_scope: ['중1 > 능률 김기택 > L1. About You and Me'],
}).combined_prompt;
assert(enScoped.includes('교과서 출제 레슨'), '영어 출제범위는 레슨 참고');
assert(!enScoped.includes('출제범위의 개념(인수분해'), '영어 출제범위에 수학 ABSOLUTE 없음');
assert(!enScoped.includes('소인수분해'), '영어에 수학 학기 힌트 없음');

const enLogs = ANALYZING_STEP_LOGS.ENGLISH.join('\n');
assert(enLogs.includes('유형/영역'), '영어 step 로그는 영역');
assert(!enLogs.includes('듣기'), '영어 진행로그에 듣기 없음');
assert(!enLogs.includes('수와 연산'), '영어 진행로그에 수학 유형 없음');
assert(ANALYZING_STEP_LOGS.MATH.join('\n').includes('단원'), '수학 step 로그는 단원');
assert(
  progressFromCliNdjsonLine('{"type":"tool_call","name":"read_file"}') === '시험지 파일을 읽는 중',
  'CLI 툴콜 로그',
);

assert(enPrompt.includes('key_vocab'), '영어 스키마에 key_vocab');
assert(enPrompt.includes('key_structures'), '영어 스키마에 key_structures');
assert(!mathPrompt.includes('key_vocab'), '수학 스키마에 key_vocab 없음');
assert(enPrompt.includes('V14. key_vocab'), '영어 V14 실문 표현만');
assert(!mathPrompt.includes('V14. key_vocab'), '수학에 V14 없음');

const parsedPack = parseEnglishStudyResult({
  vocab: [
    { word: 'nevertheless', meaning: '그럼에도', count: 3, trap: false },
    { word: 'despite', meaning: '~에도 불구하고', count: 2, trap: true },
    { word: '빈칸 추론', meaning: '독해', count: 10, trap: false },
    { word: '14번', meaning: '문항', count: 1, trap: false },
  ],
  structures: [
    { pattern: 'too ~ to', meaning: '너무 ~해서 못 함', count: 2, trap: true },
    { pattern: '글의 구조', meaning: '독해', count: 7, trap: false },
    { pattern: '주제·요지', count: 3 },
  ],
});
assert(parsedPack != null, '단어·구문 파싱');
assert(parsedPack!.vocab.some((v) => v.word === 'nevertheless'), 'nevertheless 유지');
assert(parsedPack!.vocab.some((v) => v.word === 'despite'), 'despite 유지');
assert(!parsedPack!.vocab.some((v) => v.word.includes('빈칸')), '독해 유형은 단어가 아님');
assert(!parsedPack!.vocab.some((v) => v.word.includes('번')), '문항 번호는 단어가 아님');
assert(parsedPack!.structures.some((s) => s.pattern === 'too ~ to'), 'too ~ to 구문 유지');
assert(!parsedPack!.structures.some((s) => s.pattern.includes('글의 구조')), '글의 구조는 구문이 아님');
assert(!parsedPack!.structures.some((s) => s.pattern.includes('주제')), '주제·요지는 구문이 아님');

const split = splitEnglishStudy(parsedPack!);
assert(split.frequentVocab.some((v) => v.word === 'nevertheless' && v.count === 3), '자주 나온 단어는 횟수');
assert(split.trapStructures.some((s) => s.pattern === 'too ~ to'), '함정 구문');
assert(parseEnglishStudyResult({ vocab: [], structures: [] }) == null, '빈 결과는 없음');
assert(parseEnglishStudyResult({ vocab: [{ word: '글의 구조' }] }) == null, '유형명만 있으면 없음');
assert(isEnglishStudyJunk('빈칸 추론 (단어·구)'), '빈칸 추론은 구문 아님');
assert(isEnglishStudyJunk('시제'), '한글 문법 항목은 구문 아님');
assert(!isEnglishStudyJunk('too ~ to'), 'too ~ to 는 구문');
assert(!isEnglishStudyJunk('nevertheless'), 'nevertheless 는 단어');

const fromQ = buildEnglishStudyFromQuestions([
  {
    question_number: 1,
    question_format: 'objective',
    difficulty: '4',
    difficulty_reason: null,
    question_type: 'reading',
    points: 4,
    topic: '고1 영어 > 독해 > 빈칸 추론 (단어·구)',
    ai_comment: '빈칸 추론',
    confidence: 0.9,
    confidence_reason: null,
    is_correct: null,
    student_answer: null,
    earned_points: null,
    error_type: null,
    key_vocab: [
      { word: 'nevertheless', meaning: '그럼에도' },
      { word: '빈칸 추론', meaning: '유형' },
    ],
    key_structures: [{ pattern: 'too ~ to', meaning: '너무 ~해서 못 함' }],
  },
  {
    question_number: 2,
    question_format: 'objective',
    difficulty: '3',
    difficulty_reason: null,
    question_type: 'reading',
    points: 3,
    topic: '고1 영어 > 독해 > 글의 구조',
    ai_comment: '글의 구조',
    confidence: 0.9,
    confidence_reason: null,
    is_correct: null,
    student_answer: null,
    earned_points: null,
    error_type: null,
    key_vocab: [{ word: 'nevertheless', meaning: '그럼에도' }],
  },
] as AnalyzedQuestion[]);
assert(fromQ != null, '문항 key_vocab 집계');
assert(fromQ!.vocab.some((v) => v.word === 'nevertheless' && v.count === 2), '같은 단어 횟수 합산');
assert(fromQ!.vocab.some((v) => v.word === 'nevertheless' && v.trap), '고난도 문항 단어는 함정');
assert(!fromQ!.vocab.some((v) => v.word.includes('빈칸')), '문항 topic/유형명은 단어 아님');
assert(fromQ!.structures.some((s) => s.pattern === 'too ~ to'), '문항 구문 유지');

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
