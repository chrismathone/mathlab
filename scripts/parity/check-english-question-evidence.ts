/** 영어 근거 기록의 신뢰 경계·배점 분모·재분석 보존 회귀 검사. 외부 AI/DB 호출 없음. */
import assert from 'node:assert/strict';
import {
  readEnglishQuestionAnalysis as read, parseEnglishQuestionAnalysisFromAI as fromAI,
  buildEnglishEvidenceBreakdown as breakdown, preserveEnglishQuestionReview as preserve, difficultyBasis,
} from '../../src/lib/exam-analysis/english/question-evidence';
import { englishQuestionAnalysisSchema as schema, validateEnglishSubquestionPoints } from '../../src/lib/exam-analysis/english/question-evidence-schema';
import { ExamPromptBuilder } from '../../src/lib/exam-analysis/prompt-builder';
import type { AnalyzedQuestion, ExamContext } from '../../src/lib/exam-analysis/types';

let count = 0;
function test(name: string, run: () => void) { run(); count++; console.log(`PASS ${name}`); }
function q(fields: Partial<AnalyzedQuestion> = {}): AnalyzedQuestion {
  return { question_number: 1, question_format: 'objective', difficulty: '3', difficulty_reason: null,
    question_type: 'grammar', ability_domain: 'accuracy', points: 10, topic: null, ai_comment: null,
    confidence: 0.9, confidence_reason: null, is_correct: null, student_answer: null, earned_points: null, error_type: null, ...fields };
}
const verified = read({ source: { kind: 'textbook', title: '교과서', verification: 'teacher_verified', evidence: '교사가 원문 3과에서 확인' }, subtype: 'grammar_error' });
const observation = { respondents: 20, incorrect: 5, group: '중2 A반', source: '채점표', observed_at: '2026-10-02' };

test('구형·손상 JSON도 추측 없이 읽는다', () => {
  for (const raw of [null, undefined, [], 'bad', 12, { source: [], skills: [null, 1], observation: { respondents: -1 } }]) {
    const value = read(raw); assert.equal(value.source.kind, 'unknown'); assert.equal(value.observation, null);
  }
  assert.equal(read({ source: { kind: 'toString' } }).source.kind, 'unknown');
});
test('확인 근거 없는 출처와 원문 변형은 확정하지 않는다', () => {
  const value = read({ source: { kind: 'textbook', verification: 'teacher_verified' }, transformation: 'unchanged' });
  assert.equal(value.source.verification, 'unverified'); assert.equal(value.transformation, 'unknown');
});
test('AI 출력은 실측·교사 확인·원문 대조를 생성할 수 없다', () => {
  const value = fromAI({ ...verified, observation, transformation: 'unchanged', transformation_evidence: '생성한 근거',
    achievement_standards: ['가짜 기준'], standards_source: '가짜 출처', scoring_criteria: '철자 1점 감점', scoring_source: null });
  assert.equal(value.source.verification, 'unverified'); assert.equal(value.observation, null);
  assert.equal(value.transformation, 'unknown'); assert.deepEqual(value.achievement_standards, []); assert.equal(value.scoring_criteria, null);
});
test('시험지 명시 출처는 AI에서도 별도 상태로 보존', () => {
  assert.equal(fromAI({ ...verified, source: { ...verified.source, verification: 'printed' } }).source.verification, 'printed');
});
test('출처·채점·성취기준 근거가 빠지면 API 입력을 거절', () => {
  assert(schema.safeParse(read(null)).success);
  assert(!schema.safeParse({ ...verified, source: { ...verified.source, evidence: null } }).success);
  assert(!schema.safeParse({ ...verified, scoring_criteria: '단어별 1점', scoring_source: null }).success);
  assert(!schema.safeParse({ ...verified, achievement_standards: ['9영01-01'], standards_source: null }).success);
  assert(!schema.safeParse({ ...verified, transformation: 'modified', transformation_evidence: null }).success);
});
test('실측 오답 0명은 유효하며 과대 인원·빈 출처·잘못된 날짜는 거절', () => {
  assert(schema.safeParse({ ...verified, observation: { ...observation, incorrect: 0 } }).success);
  for (const override of [{ incorrect: 21 }, { respondents: 0 }, { source: '' }, { group: '' }, { observed_at: '2026-02-30' }]) {
    assert(!schema.safeParse({ ...verified, observation: { ...observation, ...override } }).success);
  }
});
test('문항 수와 배점 비중은 독립이며 미확인 출처도 분모에 포함', () => {
  const value = breakdown([q({ english_analysis: verified, points: 20 }), q({ question_number: 2, points: 80 })], 'source', 100);
  assert.deepEqual(value.groups.map(g => [g.label, g.countPercent, g.pointsPercent]), [['미확인', 50, 80], ['교과서', 50, 20]]);
});
test('판독 누락으로 배점 합이 80점이어도 100점 기준 유지', () => {
  const value = breakdown([q({ english_analysis: verified, points: 80 })], 'source', 100);
  assert.equal(value.groups[0].pointsPercent, 80); assert.equal(value.denominator, 100);
});
test('미확인 배점은 0점·100%로 둔갑하지 않는다', () => {
  const value = breakdown([q({ english_analysis: verified, points: null })], 'source', null);
  assert.equal(value.denominator, null); assert.equal(value.groups[0].pointsPercent, null); assert.equal(value.unknownPoints, 1);
  assert.equal(value.groups[0].pointsComplete, false);
});
test('소문항은 부모 배점에 포함되어 중복 집계하지 않는다', () => {
  const value = breakdown([q({ points: 10, english_analysis: { ...verified, subquestions: [
    { label: '(1)', points: 4, conditions: ['3단어'], scoring_criteria: null },
    { label: '(2)', points: 6, conditions: [], scoring_criteria: null },
  ] } })], 'subtype', 10);
  assert.equal(value.knownPoints, 10); assert.equal(value.totalQuestions, 1);
  assert.equal(validateEnglishSubquestionPoints([{ points: 4.6 }, { points: 5.4 }], 10), null);
  assert(validateEnglishSubquestionPoints([{ points: 11 }, { points: null }], 10));
  assert(validateEnglishSubquestionPoints([{ points: 4 }, { points: 5 }], 10));
});
test('소문항 번호 중복을 거절', () => {
  const part = { label: '(1)', points: 5, conditions: [], scoring_criteria: null };
  assert(!schema.safeParse({ ...verified, subquestions: [part, part] }).success);
});
test('재분석 후 교사 기록과 삭제한 필드·실측값이 보존된다', () => {
  const review = { reviewed_at: '2026-10-02T00:00:00Z', reviewed_by: 'teacher-test' };
  const old = { english_analysis: { ...verified, observation, next_practice: null }, english_analysis_review: review, difficulty: '2', difficulty_reviewed: review };
  const next = q({ difficulty: '4', english_analysis: { ...read(null), next_practice: '새 AI 과제' } });
  const result = preserve(old, next);
  assert.equal(result.english_analysis?.next_practice, null); assert.deepEqual(result.english_analysis?.observation, observation);
  assert.equal(result.difficulty, '2'); assert.equal(result.ai_difficulty, '4'); assert.deepEqual(result.english_analysis_review, review);
  assert.equal(difficultyBasis(result), '교사 판단 난도'); assert.equal(difficultyBasis(next), 'AI 추정 난도');
});
test('교사 확인하지 않은 옛 AI 기록은 새 분석으로 교체', () => {
  const next = q({ english_analysis: read(null) });
  assert.deepEqual(preserve({ english_analysis: verified }, next), next);
});
test('JSON 저장·재조회 후에도 채점·소문항·실측 기록 유지', () => {
  const data = { ...verified, observation, scoring_criteria: '수일치 2점', scoring_source: '학교 채점표 p.1' };
  assert.deepEqual(read(JSON.parse(JSON.stringify(schema.parse(data)))), data);
});
test('영어 내신·모의 맥락과 수학 프롬프트가 분리된다', () => {
  const ctx: ExamContext = { subject: 'ENGLISH', grade_level: '고1', category: null, unit: null, exam_scope: null, paper_type: 'blank', has_essay: true, exam_category: 'MIDTERM' };
  const naesin = ExamPromptBuilder.build(ctx).combined_prompt;
  const mock = ExamPromptBuilder.build({ ...ctx, exam_category: 'MOCK' }).combined_prompt;
  const math = ExamPromptBuilder.build({ ...ctx, subject: 'MATH' }).combined_prompt;
  assert(naesin.includes('학교 내신:')); assert(mock.includes('학력평가·모의고사:'));
  assert(naesin.includes('english_analysis.subquestions')); assert(!math.includes('english_analysis'));
  assert(!naesin.includes('정답률 60-85% 예상')); assert(naesin.includes('분포를 강제하지 않는다'));
});
console.log(`${count} scenarios passed`);
