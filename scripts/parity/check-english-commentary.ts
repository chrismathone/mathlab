/**
 * 영어 총평 백엔드 회귀 검사 — 외부 AI·DB 호출 없음 (생성은 주입 fake, 저장은 메모리 가짜 어댑터).
 *
 * 범위: 컨텍스트·readiness·서명·저장 JSON 리더·산문 검증기·생성(본 1 + 보완 1, 잘림 불복구)·
 *       저장 서비스(이전 성공 보존·lease 단일 실행·만료 인계·교정 중 저장 거절·재분석 이관).
 * 실행: npx tsx scripts/parity/check-english-commentary.ts
 */
import assert from 'node:assert/strict';
import {
  buildEnglishCommentaryContext, checkEnglishCommentaryReadiness, type EnglishCommentaryInput,
} from '../../src/lib/exam-analysis/english/commentary/context';
import {
  englishCommentaryContextSchema, englishCommentaryDocumentSchema, readEnglishCommentary, readEnglishCommentaryState,
  isEnglishCommentaryStale, ENGLISH_COMMENTARY_LEASE_MS,
  type EnglishCommentaryContext, type EnglishCommentaryReport,
} from '../../src/lib/exam-analysis/english/commentary/schema';
import { englishCommentarySignature } from '../../src/lib/exam-analysis/english/commentary/signature';
import { validateEnglishCommentaryReport } from '../../src/lib/exam-analysis/english/commentary/validate';
import {
  buildEnglishCommentarySystemPrompt, buildEnglishCommentaryUserPrompt,
} from '../../src/lib/exam-analysis/english/commentary/prompt';
import {
  generateEnglishCommentary, parseEnglishCommentaryResponse, type GenerateTextFn,
} from '../../src/lib/exam-analysis/english/commentary/generate';
import { migrateEnglishCommentaryForReanalysis } from '../../src/lib/exam-analysis/english/commentary/migrate';
import {
  runEnglishCommentary, type EnglishCommentaryRowSnapshot, type EnglishCommentaryStore,
} from '../../src/lib/exam-analysis/english/commentary/service';
import type { EnglishCommentaryGeneration } from '../../src/lib/exam-analysis/english/commentary/generate';

let count = 0;
const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>) { tests.push({ name, run }); }

// ── 픽스처 ─────────────────────────────────────────────────────────────
type Q = Record<string, unknown>;
function q(n: number | string, fields: Q = {}): Q {
  return {
    question_number: n, question_format: 'objective', difficulty: '3', difficulty_reason: null,
    question_type: 'reading', ability_domain: 'understanding', points: 5, topic: '고1 영어 > 독해 > 빈칸 추론',
    ai_comment: '앞뒤 문장의 논리 연결을 확인하는 문항입니다', confidence: 0.9, confidence_reason: null,
    is_correct: null, student_answer: null, earned_points: null, error_type: null, ...fields,
  };
}
function ev(fields: Q = {}): Q {
  return { subtype: 'blank', skills: ['연결어와 논리 흐름'], thinking: 'infer', distractors: '본문 낱말을 그대로 쓴 선택지', ...fields };
}

/** 풍부한 근거 — 20문항 100점, 서술형 포함, 듣기 없음, 출처 미확인 */
function richQuestions(): Q[] {
  const qs: Q[] = [];
  for (let i = 1; i <= 16; i++) {
    const grammar = i % 4 === 0;
    qs.push(q(i, {
      points: i <= 12 ? 4 : 5.5,
      question_type: grammar ? 'grammar' : 'reading',
      ability_domain: grammar ? 'accuracy' : 'reasoning',
      english_analysis: grammar
        ? ev({ subtype: 'grammar_error', skills: ['수일치', '관계사 뒤 문장 구조'], thinking: 'apply', distractors: '수식어구로 멀어진 주어와 동사', passage_id: 'P1' })
        : i % 3 === 0
          ? ev({ subtype: 'sequence', skills: ['지시어와 연결어'], distractors: '시간 순서만 보고 고른 배열', passage_id: `P${i}` })
          : ev({ passage_id: `P${i}` }),
      key_vocab: [{ word: 'reluctant', meaning: '꺼리는' }],
      key_structures: [{ pattern: 'not only A but also B', meaning: '상관접속사' }],
    }));
  }
  for (const [n, pts] of [['서술형1', 6], ['서술형2', 7]] as const) {
    qs.push(q(n, {
      question_format: 'essay', question_type: 'writing', ability_domain: 'expression', points: pts,
      english_analysis: ev({
        subtype: 'conditional_writing', skills: ['주어진 단어 활용'], thinking: 'produce', distractors: null,
        writing_conditions: ['주어진 단어를 모두 사용', '어형을 바꾸어 쓸 것'],
        scoring_criteria: '어순 오류 시 감점', // 채점 출처 없음 → 스냅샷에서 지워져야 한다
      }),
    }));
  }
  return qs; // 12×4 + 4×5.5 + 6 + 7 = 48 + 22 + 13 = 83 → 아래에서 맞춘다
}
function fixPoints(qs: Q[], total = 100): Q[] {
  const sum = qs.reduce((s, x) => s + (x.points as number), 0);
  const last = qs[qs.length - 1];
  last.points = (last.points as number) + (total - sum);
  return qs;
}
const summary = (declaredPoints = 100, n = 18) => ({
  completeness: { status: 'ok', declaredQuestions: n, declaredPoints, emittedQuestions: n, pointsSum: declaredPoints, pointsShortfall: 0, filledQuestions: 0, retried: false, reason: '' },
});
function input(questions: Q[], over: Partial<EnglishCommentaryInput['examPaper']> = {}, analysisId = 'an1'): EnglishCommentaryInput {
  return {
    examPaper: {
      id: 'paper1', title: '2025년 1학기 중간고사 영어', schoolName: '테스트고', grade: '고1', category: null,
      examScope: { topics: ['Lesson 1', 'Lesson 2'], examYear: 2025, examSemester: 1, examCategory: 'MIDTERM' },
      examStats: null, ...over,
    },
    analysis: { id: analysisId, questions, summary: summary(100, questions.length), totalPoints: 100 },
  };
}
const RICH = () => input(fixPoints(richQuestions()));
const STRUCTURE = () => input(fixPoints(Array.from({ length: 10 }, (_, i) => q(i + 1, { points: 10, ai_comment: null }))));
const OBJECTIVE_ONLY = () => input(fixPoints(Array.from({ length: 10 }, (_, i) => q(i + 1, { points: 10, english_analysis: ev() }))));

function goodReport(ctx: EnglishCommentaryContext): EnglishCommentaryReport {
  const refs = ctx.questions.map((x) => x.ref);
  const reps = ctx.candidates.slice(0, ctx.limits.representatives.max);
  const verbatim = ctx.questions.filter((x) => (x.evidence.distractors ?? '').includes('그대로')).slice(0, 2).map((x) => x.ref);
  return {
    headline: '문장 단위로 근거를 찾는 독해 시험',
    dek: '어법은 문장 속 판단을, 독해는 앞뒤 문맥의 연결을, 쓰기는 조건을 지키는 정확성을 요구했습니다.',
    overview: '이번 시험은 낱말 뜻을 아는 것만으로는 풀기 어려운 문항이 중심이었습니다. 문장 안에서 어법을 판단하고, 글의 흐름을 따라 빈칸과 순서를 결정하며, 주어진 조건대로 문장을 완성해야 합니다. 그래서 지문을 읽을 때 답의 이유를 함께 확인하는 습관이 점수와 직접 연결됩니다.',
    features: [
      { title: '문장 속 어법 판단', refs: [refs[3]], body: '밑줄 친 부분이 문장 구조 안에서 맞는지 판단해야 합니다. 주어와 동사의 수 일치, 관계사 뒤의 문장 구조처럼 기록된 확인 기술이 반복해서 나타났습니다. 문장을 끊어 읽으며 주어와 동사를 먼저 표시하는 연습이 필요합니다.' },
      // 묶음 문단은 같은 함정이 기록된 문항끼리만 — 함정 문구를 붙이려면 refs 전원이 그 계열이어야 한다
      verbatim.length
        ? { title: '앞뒤 문맥을 잇는 빈칸', refs: [verbatim[0]], body: '빈칸 문항은 연결어와 앞뒤 문장의 관계를 근거로 답을 고르게 합니다. 본문 낱말을 그대로 옮긴 선택지가 정답처럼 보이기 쉬우므로, 낱말이 겹치는지보다 논리가 이어지는지를 먼저 확인해야 합니다.' }
        : { title: '앞뒤 문맥을 잇는 빈칸', refs: [refs[0]], body: '빈칸 문항은 연결어와 앞뒤 문장의 관계를 근거로 답을 고르게 합니다. 낱말이 겹치는지보다 논리가 이어지는지를 먼저 확인하는 읽기 습관이 필요합니다.' },
    ],
    representatives: reps.map((ref) => ({
      ref,
      demand: '연결어와 앞뒤 문장의 관계를 따져 알맞은 내용을 고르게 합니다.',
      // 대표 문항의 이유는 그 문항에 기록된 함정에서 — 다른 문항의 함정을 붙이면 검증기가 거절한다
      reason: `기록된 함정인 '${ctx.questions.find((x) => x.ref === ref)?.evidence.distractors ?? '선택지 함정'}' 때문에 정답처럼 보이는 선택지를 가려내야 합니다.`,
      prep: '문단마다 연결어에 표시하고 앞 문장을 한 줄로 요약한 뒤 답을 골라 보는 연습을 합니다.',
    })),
    actions: [
      { title: '연결어 표시하며 읽기', refs: [refs[0]], body: '지문을 읽을 때 연결어와 대명사에 표시하고, 앞뒤 문장이 어떤 관계인지 한 줄로 적어 봅니다.', check: '다시 풀 때 표시한 연결어만으로 답의 이유를 설명할 수 있는지 확인합니다.' },
    ],
    conclusion: '이번 시험은 아는 낱말보다 문장을 정확하게 읽는 힘을 요구했습니다. 남은 기간에는 문장 구조와 글의 흐름을 근거로 답을 고르는 연습에 시간을 쓰는 것이 효과적입니다.',
  };
}
function withProse(r: EnglishCommentaryReport, patch: Partial<EnglishCommentaryReport>): EnglishCommentaryReport {
  return { ...r, ...patch };
}
/** 묶음 refs 를 일부러 쓰는 회귀(방어 깊이) — 단일 ref 규칙 오류는 빼고 나머지 판정만 본다 */
function nonSingleRefErrors(ctx: EnglishCommentaryContext, report: EnglishCommentaryReport): string[] {
  return validateEnglishCommentaryReport(ctx, report).filter((e) => !e.includes('문항 하나만 연결') && !e.includes('서로 다른 문항을 하나씩'));
}
function expectError(ctx: EnglishCommentaryContext, report: EnglishCommentaryReport, fragment: string) {
  const errors = validateEnglishCommentaryReport(ctx, report);
  assert.ok(errors.some((e) => e.includes(fragment)), `"${fragment}" 오류 기대 — 실제: ${JSON.stringify(errors)}`);
}
function setOverview(r: EnglishCommentaryReport, extra: string): EnglishCommentaryReport {
  return withProse(r, { overview: `${r.overview} ${extra}` });
}

// ── 컨텍스트 · readiness ───────────────────────────────────────────────
test('컨텍스트가 계약 스키마를 통과하고 코드 집계를 담는다', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  assert.equal(englishCommentaryContextSchema.safeParse(ctx).success, true);
  assert.equal(ctx.totals.questionCount, 18);
  assert.equal(ctx.formats.reduce((s, g) => s + g.count, 0), 18);
  assert.equal(ctx.formats[0].key, 'objective');
  assert.equal(ctx.exam.examCategory, 'MIDTERM');
  assert.equal(ctx.exam.isMock, false);
  assert.deepEqual(ctx.exam.scopeTopics, ['Lesson 1', 'Lesson 2']);
  assert.equal(ctx.evidence.scope, 'evidence');
  assert.equal(ctx.flags.hasWrittenResponse, true);
  assert.equal(ctx.flags.hasListening, false);
  const essay = ctx.questions.find((x) => x.ref === '서술형1')!;
  assert.equal(essay.evidence.scoring_criteria, null, '채점 출처 없는 채점 기준은 스냅샷에 싣지 않는다');
  assert.equal(essay.typeLabel, '서술·영작');
  assert.equal(ctx.questions[0].sourceLabel, '미확인');
  assert.equal(ctx.passages.groups > 0, true);
  // 대표 문항 상한 = min(4, max(2, ceil(18/8)=3)) = 3
  assert.equal(ctx.limits.representatives.max, 3);
  assert.ok(ctx.candidates.every((r) => ctx.questions.find((x) => x.ref === r)!.hasDetail));
  assert.equal(ctx.limits.features.max, 5);
});

test('근거가 없는 시험은 구조 중심 — 대표 문항·행동을 비울 수 있다', () => {
  const ctx = buildEnglishCommentaryContext(STRUCTURE());
  assert.equal(ctx.evidence.scope, 'structure');
  assert.equal(ctx.evidence.scopeLabel, '구조 중심');
  assert.deepEqual(ctx.candidates, []);
  assert.deepEqual(ctx.limits.representatives, { min: 0, max: 0 });
  assert.equal(ctx.limits.actions.min, 0);
  assert.equal(ctx.limits.features.max, 3, '소형 시험은 핵심 특징 최대 3');
});

test('직접 쓰기 판정은 형식 기준 — 영작 유형을 객관식으로 물으면 서술형이 아니다', () => {
  const qs = fixPoints(Array.from({ length: 10 }, (_, i) => q(i + 1, {
    points: 10,
    ...(i === 0 ? { question_type: 'writing', ability_domain: 'expression', english_analysis: ev({ subtype: 'sentence_order', writing_conditions: ['주어진 낱말 배열'] }) } : { english_analysis: ev() }),
  })));
  const ctx = buildEnglishCommentaryContext(input(qs));
  assert.equal(ctx.questions[0].format, 'objective');
  assert.equal(ctx.questions[0].type, 'writing');
  assert.equal(ctx.flags.hasWrittenResponse, false, '객관식 영작 유형은 직접 쓰기 아님');
  assert.equal(ctx.flags.hasWritingConditions, false, '조건 플래그도 직접 쓰는 형식만');
  expectError(ctx, setOverview(goodReport(ctx), '서술형 대비도 필요합니다.'), '서술·단답형 문항이 없습니다');
  const rich = buildEnglishCommentaryContext(RICH());
  assert.equal(rich.flags.hasWrittenResponse, true);
  assert.equal(rich.flags.hasWritingConditions, true);
});

test('배점 미확인은 0으로 채우지 않고 비율을 숨긴다', () => {
  const base = RICH();
  const qs = base.analysis.questions as Q[];
  qs[0].points = null;
  const ctx = buildEnglishCommentaryContext({ ...base, analysis: { ...base.analysis, summary: {} } });
  assert.equal(ctx.questions[0].points, null);
  assert.equal(ctx.totals.unknownPointsCount, 1);
  assert.equal(ctx.totals.pointsDenominator, null);
  assert.ok(ctx.formats.every((g) => g.key !== 'objective' || g.pointsPercent === null));
});

test('readiness — 출처 미확인은 통과, 번호 중복·소문항 초과·배점 누락은 차단', () => {
  assert.equal(checkEnglishCommentaryReadiness(RICH()).ready, true);
  assert.equal(checkEnglishCommentaryReadiness(STRUCTURE()).ready, true);

  const dup = RICH();
  (dup.analysis.questions as Q[])[1].question_number = 1;
  const d = checkEnglishCommentaryReadiness(dup);
  assert.equal(d.ready, false);
  assert.ok(d.reasons.some((r) => r.includes('중복')));

  const over = RICH();
  const essay = (over.analysis.questions as Q[]).find((x) => x.question_number === '서술형2')!;
  essay.english_analysis = ev({ subtype: 'conditional_writing', subquestions: [{ label: '(1)', points: 5 }, { label: '(2)', points: 5 }] });
  const o = checkEnglishCommentaryReadiness(over);
  assert.equal(o.ready, false);
  assert.ok(o.reasons.some((r) => r.includes('소문항')));

  const missing = RICH();
  (missing.analysis.questions as Q[])[0].points = null;
  assert.equal(checkEnglishCommentaryReadiness(missing).ready, false);

  assert.equal(checkEnglishCommentaryReadiness(input([])).ready, false);
  assert.equal(checkEnglishCommentaryReadiness({ ...RICH(), analysis: { id: 'x', questions: { bad: true } } }).ready, false);
});

// ── 서명 ──────────────────────────────────────────────────────────────
test('서명 — 같은 입력이면 같고, ai_comment·배점·근거·분석 id 가 바뀌면 달라진다', () => {
  const sig = (i: EnglishCommentaryInput) => englishCommentarySignature(buildEnglishCommentaryContext(i));
  const base = sig(RICH());
  assert.equal(sig(RICH()), base);
  // 키 순서가 달라도 같다
  const reordered = RICH();
  reordered.analysis.questions = (reordered.analysis.questions as Q[]).map((x) => Object.fromEntries(Object.entries(x).reverse()));
  assert.equal(sig(reordered), base);

  const mutate = (fn: (qs: Q[]) => void) => { const i = RICH(); fn(i.analysis.questions as Q[]); return sig(i); };
  assert.notEqual(mutate((qs) => { qs[0].ai_comment = '다른 소견'; }), base, 'ai_comment 는 생성 입력이므로 서명에 포함');
  assert.notEqual(mutate((qs) => { qs[0].points = 3; qs[1].points = 5; }), base);
  assert.notEqual(mutate((qs) => { qs[0].english_analysis = ev({ skills: ['다른 기술'] }); }), base);
  assert.notEqual(mutate((qs) => { qs[0].difficulty = '5'; }), base);
  assert.notEqual(sig({ ...RICH(), analysis: { ...RICH().analysis, id: 'an2' } }), base);
  assert.notEqual(sig(RICH()), sig(input(fixPoints(richQuestions()), { schoolName: '다른고' })));
  assert.match(base, /^en1:/);
});

// ── 저장 JSON 리더 ────────────────────────────────────────────────────
test('리더 — 손상·구형·빈 값에도 예외 없이 상태를 돌려준다', () => {
  for (const raw of [null, undefined, [], 'bad', 12, {}, { kind: 'other' }]) {
    const s = readEnglishCommentaryState(raw);
    assert.equal(s.document, null);
    assert.ok(['empty', 'invalid'].includes(s.status));
    assert.equal(readEnglishCommentary(raw), null);
  }
  assert.equal(readEnglishCommentaryState({ overall_comment: '옛 총평', blog_qa: [] }).status, 'legacy');
  const corrupt = readEnglishCommentaryState({ kind: 'english-commentary', contract: 1, report: [], context: 'x' });
  assert.equal(corrupt.status, 'invalid');
  assert.equal(readEnglishCommentaryState({ kind: 'english-commentary', contract: 1, lastFailure: { at: 'x', message: '실패', code: 'generation_failed' } }).status, 'pending');
  const old = new Date(Date.now() - ENGLISH_COMMENTARY_LEASE_MS - 1000).toISOString();
  const run = readEnglishCommentaryState({ kind: 'english-commentary', contract: 1, run: { token: 't', startedAt: old, inputSignature: 's' } });
  assert.equal(run.running?.expired, true);
  assert.equal(readEnglishCommentaryState({ kind: 'english-commentary', contract: 99 }).status, 'invalid', '다른 계약 버전은 구형으로');
});

// ── 산문 검증기 ───────────────────────────────────────────────────────
test('검증기 — 정상 보고서는 통과한다', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  assert.deepEqual(validateEnglishCommentaryReport(ctx, goodReport(ctx)), []);
});

test('검증기 — 참조·개수 위반', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  expectError(ctx, withProse(r, { features: [{ ...r.features[0], refs: ['99'] }, r.features[1]] }), '시험에 없는 문항 번호');
  expectError(ctx, withProse(r, { features: [{ ...r.features[0], refs: [] }, r.features[1]] }), '근거 문항 번호를 하나 이상');
  expectError(ctx, withProse(r, { representatives: [r.representatives[0], r.representatives[0]] }), '같은 문항을 두 번');
  const notCandidate = ctx.questions.find((x) => !ctx.candidates.includes(x.ref))!.ref;
  expectError(ctx, withProse(r, { representatives: [{ ...r.representatives[0], ref: notCandidate }] }), '대표 문항 후보가 아닙니다');
  expectError(ctx, withProse(r, { features: [r.features[0]] }), 'features: 2~5개');
  expectError(ctx, withProse(r, { actions: [r.actions[0], r.actions[0], r.actions[0], r.actions[0]] }), 'actions: 1~3개');
  expectError(ctx, withProse(r, { actions: [] }), 'actions: 1~3개');
});

test('검증기 — 숫자·양 표현은 거절하되 3인칭·5형식 같은 문법 용어는 통과', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  expectError(ctx, setOverview(r, '독해가 12문항입니다.'), '숫자는 쓰지 마세요');
  expectError(ctx, setOverview(r, '독해가 높은 비중(60%)입니다.'), '숫자는 쓰지 마세요');
  expectError(ctx, setOverview(r, '세 문항이 서술형입니다.'), '개수 표현');
  expectError(ctx, setOverview(r, '한 문항만 서술형입니다.'), '개수 표현');
  assert.ok(!validateEnglishCommentaryReport(ctx, setOverview(r, '연결어를 중심으로 한 문항이 이어집니다.')).some((e) => e.includes('개수')), "'중심으로 한 문항'은 개수 아님");
  expectError(ctx, setOverview(r, '절반이 빈칸 추론입니다.'), '비율·양 표현');
  expectError(ctx, setOverview(r, '전 문항이 객관식입니다.'), '비율·양 표현');
  assert.ok(!validateEnglishCommentaryReport(ctx, setOverview(r, '이전 문항에서 익힌 방법을 다시 적용합니다.')).some((e) => e.includes('비율·양')), "'이전 문항'은 양 표현 아님");
  expectError(ctx, setOverview(r, '②번 선택지가 함정입니다.'), '선지 번호');
  // 숫자 검사만 보면 문법 용어의 숫자는 통과한다 (5형식은 아래 문법 항목 근거 검사의 대상이라 기록이 있는 fixture 로 본다)
  const ok = setOverview(r, '3인칭 단수 동사와 2형식 동사를 구분해야 합니다.');
  assert.deepEqual(validateEnglishCommentaryReport(ctx, ok), []);
  const fiveCtx = buildEnglishCommentaryContext(input(fixPoints(richQuestions().map((x, i) => (i === 3
    ? { ...x, english_analysis: ev({ subtype: 'grammar_error', skills: ['5형식 목적격 보어', '수일치', '관계사 뒤 문장 구조'] }) } : x)))));
  const five = setOverview(goodReport(fiveCtx), '3인칭 단수 동사와 5형식 문장 구조를 구분해야 합니다.');
  assert.ok(!validateEnglishCommentaryReport(fiveCtx, five).some((e) => e.includes('숫자')), '5형식의 숫자는 숫자 규칙 예외');
});

test('검증기 — 등급컷·변별·예측·비교·홍보·실력 단정 금지', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  expectError(ctx, setOverview(r, '등급컷이 높게 형성될 것입니다.'), '등급컷');
  expectError(ctx, setOverview(r, '변별력이 높은 시험입니다.'), '변별');
  expectError(ctx, setOverview(r, '다음 시험에도 나올 수 있습니다.'), '예측');
  expectError(ctx, setOverview(r, '작년보다 어려워졌습니다.'), '비교');
  expectError(ctx, setOverview(r, '저희 학원은 이 유형을 대비했습니다.'), '홍보');
  expectError(ctx, setOverview(r, '학생들이 어법에서 많이 부족합니다.'), '실력·오답을 단정');
  expectError(ctx, setOverview(r, '정답률이 낮은 문항이었습니다.'), '응답 기록이 있을 때만');
  // 독해 전략으로서의 '예측하며 읽기'는 통과
  assert.deepEqual(validateEnglishCommentaryReport(ctx, setOverview(r, '글의 흐름을 예측하며 읽는 습관도 도움이 됩니다.')), []);
});

test('검증기 — 근거 없는 출처·변형·채점 주장 금지, 근거가 있으면 허용', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  expectError(ctx, setOverview(r, '교과서 지문이 그대로 나왔습니다.'), '확인된 출처가 있을 때만');
  expectError(ctx, setOverview(r, '지문을 변형해 출제했습니다.'), '원문 대조 근거(일부 변형');
  expectError(ctx, setOverview(r, '어순이 틀리면 감점됩니다.'), '채점 근거가 있을 때만');
  assert.deepEqual(validateEnglishCommentaryReport(ctx, setOverview(r, '주어진 단어를 어형 변형하여 쓰는 조건이 있었습니다.')), [], "'어형 변형'은 문법 용어");
  assert.deepEqual(validateEnglishCommentaryReport(ctx, setOverview(r, '지문 출처가 확인되지 않아 범위 판단은 보류합니다. 기본원리를 정리한 프린트로 복습해 보세요.')), [], '유보 문장·학습 조언은 통과');
  expectError(ctx, setOverview(r, '학교 프린트에서 그대로 나왔습니다.'), '확인된 출처가 있을 때만');
  expectError(ctx, setOverview(r, '본원에서 미리 다룬 유형입니다.'), '홍보');

  const verified = RICH();
  const qs = verified.analysis.questions as Q[];
  qs[0].english_analysis = ev({ source: { kind: 'textbook', title: '교과서', verification: 'teacher_verified', evidence: '교사가 확인' } });
  qs[17].english_analysis = ev({ subtype: 'conditional_writing', writing_conditions: ['주어진 단어 사용'], scoring_criteria: '어순 오류 감점', scoring_source: '시험지 하단 채점 안내' });
  const vctx = buildEnglishCommentaryContext(verified);
  assert.equal(vctx.evidence.scope, 'teacher');
  const vr = goodReport(vctx);
  const feat = { title: '교과서에서 확인된 지문', refs: [vctx.questions[0].ref], body: '교사가 확인한 교과서 지문에서 빈칸 문항이 나왔습니다. 연결어를 근거로 답을 고르는 연습이 필요하며, 앞뒤 문장의 관계를 한 줄로 정리하는 습관이 도움이 됩니다.' };
  assert.deepEqual(validateEnglishCommentaryReport(vctx, withProse(vr, { features: [feat, vr.features[0]] })), []);
  expectError(vctx, withProse(vr, { features: [{ ...feat, refs: [vctx.questions[1].ref] }, vr.features[0]] }), '확인된 출처가 있을 때만');
  const scoringFeat = { title: '감점 기준이 있는 조건 영작', refs: [vctx.questions[17].ref], body: '안내된 채점 기준에 따라 어순 오류는 감점됩니다. 주어진 단어를 모두 쓰고 어순을 확인하는 점검 습관이 필요하며, 문장을 다 쓴 뒤 조건을 하나씩 대조해야 합니다.' };
  assert.deepEqual(validateEnglishCommentaryReport(vctx, withProse(vr, { features: [scoringFeat, vr.features[0]] })), []);
});

/** 근거가 일부 문항에만 있는 묶음 — 실제 출력에서 확인된 확장 사례를 고정한다 */
function evidenceMixCtx() {
  const qs = fixPoints(richQuestions());
  qs[0].english_analysis = ev({ source: { kind: 'textbook', title: '교과서', verification: 'teacher_verified', evidence: '교사 확인' }, transformation: 'unchanged', transformation_evidence: '원문과 대조', distractors: '세부 정보를 바꾸어 놓은 선택지' });
  qs[1].english_analysis = ev({ source: { kind: 'textbook', title: '교과서', verification: 'printed', evidence: '시험지 인쇄' }, transformation: 'modified', transformation_evidence: '문장 순서를 바꿈' });
  qs[2].english_analysis = ev({ source: { kind: 'workbook', title: '부교재', verification: 'printed', evidence: '시험지 인쇄' }, skills: ['불규칙 동사의 과거형'] });
  // qs[4]: 출처 미확인
  qs[16].english_analysis = ev({ subtype: 'conditional_writing', writing_conditions: ['주어진 단어 사용'], scoring_criteria: '어순 오류 감점', scoring_source: '시험지 채점 안내', observation: { respondents: 20, incorrect: 5, group: '고1 A반', source: '채점표' } });
  qs[17].english_analysis = ev({ subtype: 'conditional_writing', writing_conditions: ['주어진 단어 사용'] });
  const ctx = buildEnglishCommentaryContext(input(qs));
  const ref = (i: number) => ctx.questions[i].ref;
  const body = (t: string) => `${t} 연결어와 앞뒤 문장의 관계를 근거로 답을 고르는 연습이 필요하며, 지문을 읽을 때 문장 사이의 논리를 한 줄로 정리하는 습관이 도움이 됩니다.`;
  const withFeature = (refs: string[], text: string) => {
    const r = goodReport(ctx);
    return withProse(r, { features: [{ title: '근거 문단', refs, body: body(text) }, r.features[1]] });
  };
  return { ctx, ref, withFeature };
}

test('검증기 — 근거는 연결한 모든 문항에 있어야 한다 (일부 근거의 확장 금지)', () => {
  const { ctx, ref, withFeature } = evidenceMixCtx();
  const pass = (r: EnglishCommentaryReport) => assert.deepEqual(nonSingleRefErrors(ctx, r), []);
  // 출처: 확인된 문항끼리만 묶으면 통과, 미확인을 섞으면 거절, 전역 문단은 전 문항이 확인돼야 한다
  pass(withFeature([ref(0), ref(1)], '교과서 지문에서 나온 문항입니다.'));
  expectError(ctx, withFeature([ref(0), ref(4)], '교과서 지문에서 나온 문항입니다.'), '연결한 문항 모두에 확인된 출처');
  expectError(ctx, setOverview(goodReport(ctx), '교과서와 부교재 지문을 바탕으로 출제되었습니다.'), '시험의 모든 문항에 확인된 출처');
  // 출처 종류가 맞아야 한다
  expectError(ctx, withFeature([ref(0), ref(1)], '부교재 지문에서 나온 문항입니다.'), '출처 종류');
  expectError(ctx, withFeature([ref(0), ref(2)], '교과서 지문에서 나온 문항입니다.'), '출처 종류');
  pass(withFeature([ref(0), ref(2)], '교과서와 부교재 지문에서 나온 문항입니다.'));
  // 변형 상태가 맞아야 한다
  pass(withFeature([ref(1)], '문장 순서를 바꾼 변형 지문입니다.'));
  expectError(ctx, withFeature([ref(0), ref(1)], '문장 순서를 바꾼 변형 지문입니다.'), '원문 대조 근거(일부 변형');
  pass(withFeature([ref(0)], '원문을 거의 그대로 활용한 문항입니다.'));
  expectError(ctx, withFeature([ref(1)], '원문을 거의 그대로 활용한 문항입니다.'), "'그대로 출제'");
  pass(withFeature([ref(0)], '세부 정보를 변형한 선택지가 함정입니다.'));
  // 채점·응답 기록
  pass(withFeature([ref(16)], '어순 오류는 감점되는 채점 기준이 있습니다.'));
  expectError(ctx, withFeature([ref(16), ref(17)], '어순 오류는 감점되는 채점 기준이 있습니다.'), '채점 근거가 있을 때만');
  pass(withFeature([ref(16)], '응답 기록이 있는 문항입니다.'));
  expectError(ctx, withFeature([ref(16), ref(17)], '응답 기록이 있는 문항입니다.'), '응답 기록이 있을 때만');
});

test('검증기 — 기록에 없는 문법 항목·킬러 표현 금지, 경계 오탐 없음', () => {
  const { ctx, ref, withFeature } = evidenceMixCtx();
  expectError(ctx, withFeature([ref(0)], '불규칙 동사의 과거형을 확인합니다.'), "'불규칙 동사'");
  assert.deepEqual(validateEnglishCommentaryReport(ctx, withFeature([ref(2)], '불규칙 동사의 과거형을 확인합니다.')), [], '연결 문항 기록에 있으면 허용');
  expectError(ctx, setOverview(goodReport(ctx), '분사구문을 정확히 해석해야 합니다.'), "'분사구문'");
  expectError(ctx, setOverview(goodReport(ctx), '킬러 문항이 있었습니다.'), "'킬러'");
  assert.deepEqual(validateEnglishCommentaryReport(ctx, setOverview(goodReport(ctx), '하도 치밀하게 짜인 글이라 끝까지 읽어야 합니다.')), [], "'하도 치밀'은 '도치'가 아니다");
});

test('검증기 — 함정 유형·주어진 재료·구문 명칭은 기록대로 (실출력 회귀)', () => {
  const { ctx, ref, withFeature } = evidenceMixCtx();
  const pass = (r: EnglishCommentaryReport) => assert.deepEqual(nonSingleRefErrors(ctx, r), []);
  // 함정: 기록('본문 낱말을 그대로 쓴 선택지')에 없는 '일부 내용만' 유형은 거절 (listening-mock R2 사례)
  pass(withFeature([ref(4)], '본문 낱말을 그대로 쓴 선택지에 유의해야 합니다.'));
  expectError(ctx, withFeature([ref(4)], '일부 내용만 담은 선택지에 유의해야 합니다.'), "'일부 내용만 담은 선택지'");
  expectError(ctx, withFeature([ref(4)], '본문과 반대로 진술한 선택지가 있습니다.'), "'반대로 진술한 선택지'");
  // 주어진 재료: 작성 조건 '주어진 단어 사용'은 낱말 계열로 통과, 접속사 계열·영어 낱말 지정은 거절 (high-conditional-writing R0 사례)
  pass(withFeature([ref(16)], '주어진 낱말을 모두 넣어 문장을 완성해야 합니다.'));
  expectError(ctx, withFeature([ref(16)], '주어진 접속사 표현을 활용해 문장을 완성해야 합니다.'), "'주어진 접속사'");
  expectError(ctx, withFeature([ref(16)], '주어진 낱말 although 를 넣어 문장을 완성해야 합니다.'), "'although'을(를) 주어진 낱말로");
  expectError(ctx, withFeature([ref(16), ref(5)], '주어진 낱말을 모두 넣어 문장을 완성해야 합니다.'), '연결한 문항 모두의 작성 조건');
  // 구문 명칭: 'too ~ to' 만 기록된 문항을 '상관 구문'으로 부르면 거절, 상관접속사 기록이 있으면 통과
  const qs = fixPoints(richQuestions());
  qs[0].key_structures = [{ pattern: 'too ~ to', meaning: '너무 해서 할 수 없다' }];
  const tctx = buildEnglishCommentaryContext(input(qs));
  const tr = goodReport(tctx);
  const tooTo = withProse(tr, { features: [{ title: '구문 판단', refs: [tctx.questions[0].ref], body: '핵심 구문인 상관 구문의 쓰임을 확인합니다. 연결어와 앞뒤 문장의 관계를 근거로 답을 고르는 연습이 필요하며, 문장 사이의 논리를 한 줄로 정리하는 습관이 도움이 됩니다.' }, tr.features[1]] });
  expectError(tctx, tooTo, "'상관 구문'");
  const corr = withProse(tr, { features: [{ ...tooTo.features[0], refs: [tctx.questions[1].ref] }, tr.features[1]] });
  assert.deepEqual(validateEnglishCommentaryReport(tctx, corr), [], 'not only A but also B 기록이 있으면 상관 구문 허용');
});

test('검증기 — 비슷한 형태는 본문 유사·낱말 조합의 근거가 아니다 (listening-mock 실출력 회귀)', () => {
  const shapeOnly = '비슷한 형태를 고르게 한 선택지';
  const build = (distractors: string) => {
    const qs = fixPoints(richQuestions());
    qs[12].english_analysis = ev({ subtype: 'blank', skills: ['주제와 요지'], distractors });
    const ctx = buildEnglishCommentaryContext(input(qs));
    const ref = ctx.questions[12].ref;
    assert.equal(ref, '13');
    assert.ok(ctx.candidates.includes(ref), '배점 높은 객관식은 대표 후보');
    const r = goodReport(ctx);
    const others = r.representatives.filter((p) => p.ref !== ref);
    const withReason = (reason: string, prep = '지문을 읽고 고른 답의 의미가 중심 내용과 같은지 문장마다 대조하는 연습을 합니다.') => withProse(r, {
      representatives: [{
        ref,
        demand: '글의 중심 요지를 선택지에서 가려 고르도록 요구합니다.',
        reason,
        prep,
      }, ...others].slice(0, ctx.limits.representatives.max),
    });
    const withAction = (body: string, check: string) => withProse(r, {
      actions: [{ title: '요지 선택지 가리기', refs: [ref], body, check }],
    });
    const cleared = (report: EnglishCommentaryReport) => !validateEnglishCommentaryReport(ctx, report).some((e) => e.includes('본문·지문과 비슷') || e.includes('지문 단어를 조합'));
    return { ctx, withReason, withAction, cleared };
  };
  const shape = build(shapeOnly);
  const badReason = '본문의 문장과 형태가 비슷하게 꾸며진 선택지가 구성되어 있어 겉모습만 보고 답을 고르면 오답으로 이어지기 쉽습니다.';
  expectError(shape.ctx, shape.withReason(badReason), '본문·지문과 비슷');
  const badBody = '글을 읽고 중심 요지를 도출할 때 지문의 단어를 단순히 조합하여 만든 비슷한 모양의 선택지에 주의해야 합니다. 겉형태가 닮았더라도 실제 의미가 글의 요지와 일치하는지 끝까지 확인하며 고릅니다.';
  const badCheck = '선택지를 고를 때 본문의 표현과 형태만 비슷한 것인지 실제 요지를 담고 있는지 스스로 따져봅니다.';
  expectError(shape.ctx, shape.withAction(badBody, '고른 답이 중심 요지와 같은지 대조해 봅니다.'), '지문 단어를 조합');
  expectError(shape.ctx, shape.withAction('글을 읽고 중심 요지를 고를 때 선택지의 겉모양이 비슷한 경우에 주의해야 합니다.', badCheck), '본문·지문과 비슷');
  // 선택지끼리 닮았다는 말, 답을 지문 의미와 대조하는 대비는 그대로 허용
  assert.ok(shape.cleared(shape.withReason(`기록된 함정인 ${shapeOnly} 때문에 겉모양만 보고 고르기 쉽습니다.`)), '형태 기록 그대로는 허용');
  const meaning = shape.withAction(
    '고른 답의 의미가 지문의 중심 내용과 같은지 문장마다 대조하며 요지를 확인하는 연습을 합니다.',
    '선택지의 뜻이 지문 내용과 맞는지 대조해 봅니다.',
  );
  assert.deepEqual(validateEnglishCommentaryReport(shape.ctx, meaning), [], '지문 의미 대조는 허용');
  const readThenShape = shape.withAction(
    '본문을 읽고 형태가 비슷한 선택지를 가려 낸 뒤 중심 요지와 맞는 것을 고르는 연습을 합니다.',
    '겉모양이 비슷한 선택지를 남기고 요지가 다른 것을 지웠는지 확인합니다.',
  );
  assert.ok(shape.cleared(readThenShape), '본문을 읽은 뒤 형태를 가리는 말은 비교 대상을 바꾸지 않는다');
  // 기록된 함정이 겹침·조합을 말하면 그 문장만 통과. '형태가 비슷'을 같이 쓰면 기존 형태 함정은 별도다.
  const mixed = build('지문 단어를 조합한 선택지');
  assert.ok(mixed.cleared(mixed.withReason('지문의 단어를 단순히 조합하여 만든 선택지가 정답처럼 보이므로 요지와 맞는지 따로 확인해야 합니다.')), '조합 기록이 있으면 허용');
  const like = build('본문 표현과 비슷한 선택지');
  assert.ok(like.cleared(like.withReason('본문의 표현과 비슷하게 보이는 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.')), '본문 표현 유사 기록이 있으면 허용');
  const copied = build('본문 낱말을 그대로 쓴 선택지');
  assert.ok(copied.cleared(copied.withReason('본문의 표현과 비슷하게 보이는 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.')), '그대로 기록이면 본문 표현 유사 허용');
  assert.deepEqual(validateEnglishCommentaryReport(copied.ctx, copied.withAction(
    '본문 낱말을 그대로 옮긴 선택지가 정답처럼 보이므로 요지와 맞는지를 따로 확인하는 연습이 필요합니다.',
    '낱말이 겹치는지보다 요지가 같은지 대조해 봅니다.',
  )), [], '그대로 기록의 기존 양성 문장 유지');
  // 겹침과 조합은 근거가 따로다 — '본문 + 낱말'만, 또는 '본문을 읽고 … 비슷한 형태' 같은 기록은 어느 쪽 근거도 아니다 (root 요청)
  const composedClaim = '지문의 단어를 단순히 조합하여 만든 선택지가 정답처럼 보이므로 요지와 맞는지 따로 확인해야 합니다.';
  const similarClaim = '본문의 표현과 비슷하게 보이는 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.';
  for (const record of ['본문 낱말의 뜻을 바꾼 선택지', '본문을 읽고 비슷한 형태를 고르게 한 선택지', '지문 문장의 순서를 바꾼 선택지']) {
    const b = build(record);
    expectError(b.ctx, b.withReason(composedClaim), '지문 단어를 조합');
    expectError(b.ctx, b.withReason(similarClaim), '본문·지문과 비슷');
  }
  expectError(copied.ctx, copied.withReason(composedClaim), '지문 단어를 조합');
  expectError(mixed.ctx, mixed.withReason(similarClaim), '본문·지문과 비슷');
  // 바꿔 쓴 표현도 같은 주장으로 잡는다 (형태 기록만 있을 때)
  for (const [claim, fragment] of [
    ['지문에 나온 단어들을 조합해 만든 선택지가 있어 요지와 맞는지 따로 확인해야 합니다.', '지문 단어를 조합'],
    ['지문 단어의 조합으로 만든 선택지가 있어 요지와 맞는지 따로 확인해야 합니다.', '지문 단어를 조합'],
    ['본문 어구를 짜깁기한 선택지가 있어 요지와 맞는지 따로 확인해야 합니다.', '지문 단어를 조합'],
    ['지문 속 표현을 엮어 만든 선택지가 있어 요지와 맞는지 따로 확인해야 합니다.', '지문 단어를 조합'],
    ['본문과 겹치는 표현을 쓴 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.', '본문·지문과 비슷'],
    ['본문 표현과 같은 단어를 넣은 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.', '본문·지문과 비슷'],
    ['본문의 표현을 비슷하게 바꿔 쓴 선택지가 있어 요지와 맞는지 다시 확인해야 합니다.', '본문·지문과 비슷'],
  ] as const) expectError(shape.ctx, shape.withReason(claim), fragment);
  // 전역 문단은 기록 한 건 안에서 근거를 찾는다 — 다른 문항의 '본문'과 '비슷한 형태'를 이어 붙여 통과시키지 않는다
  const crossQs = fixPoints(richQuestions());
  crossQs[0].english_analysis = ev({ distractors: '본문 내용과 반대되는 선택지' });
  crossQs[12].english_analysis = ev({ subtype: 'blank', skills: ['주제와 요지'], distractors: shapeOnly });
  const crossCtx = buildEnglishCommentaryContext(input(crossQs));
  expectError(crossCtx, setOverview(goodReport(crossCtx), '지문의 단어를 조합해 만든 선택지를 가려야 합니다.'), '지문 단어를 조합');
  const oneQs = fixPoints(richQuestions());
  oneQs[12].english_analysis = ev({ subtype: 'blank', skills: ['주제와 요지'], distractors: '지문 단어를 조합한 선택지' });
  const oneCtx = buildEnglishCommentaryContext(input(oneQs));
  assert.ok(!validateEnglishCommentaryReport(oneCtx, setOverview(goodReport(oneCtx), '지문의 단어를 조합해 만든 선택지를 가려야 합니다.')).some((e) => e.includes('지문 단어를 조합')), '조합이 기록된 문항이 하나라도 있으면 전역 문단 허용');
});

test('검증기 — 묶음 문단의 구체 항목은 각 문항 기록에 있어야 한다 (Grok·root 실출력 회귀)', () => {
  const qs = fixPoints(richQuestions());
  qs[0].key_vocab = [{ word: 'although', meaning: '비록' }];
  qs[1].key_vocab = [];
  qs[4].english_analysis = ev({ subtype: 'collocation', skills: ['연어'], distractors: '비슷한 형태를 고르게 한 선택지' });
  qs[5].english_analysis = ev({ subtype: 'blank', skills: ['연결어와 논리 흐름'], distractors: '세부 정보를 바꾸어 놓은 선택지' });
  qs[6].english_analysis = ev({ transformation: 'unchanged', transformation_evidence: '원문과 대조' });
  const ctx = buildEnglishCommentaryContext(input(qs));
  const ref = (i: number) => ctx.questions[i].ref;
  const r = goodReport(ctx);
  const feat = (refs: string[], text: string) => withProse(r, { features: [{ title: '근거 문단', refs, body: `${text} 앞뒤 문장의 관계를 근거로 답을 고르는 연습이 필요하며, 문장 사이의 논리를 한 줄로 정리하는 습관이 도움이 됩니다.` }, r.features[1]] });
  const pass = (rep: EnglishCommentaryReport) => assert.deepEqual(nonSingleRefErrors(ctx, rep), []);
  // 영어 낱말: although 가 0번에만 기록 → 0번 단독은 통과, 0·1번 묶음은 거절
  pass(feat([ref(0)], 'although 가 이끄는 문장의 흐름을 확인합니다.'));
  expectError(ctx, feat([ref(0), ref(1)], 'although 가 이끄는 문장의 흐름을 확인합니다.'), '연결한 문항 모두의 기록에 있는 영어 표현이 아닙니다');
  // 어휘 항목: 연어는 4번에만
  pass(feat([ref(4)], '연어 표현의 쓰임을 확인합니다.'));
  expectError(ctx, feat([ref(4), ref(1)], '연어 표현의 쓰임을 확인합니다.'), "'연어'은(는) 연결한 문항 모두의 기록");
  // 함정 계열: 세부 바꿈은 5번에만
  pass(feat([ref(5)], '세부 정보를 바꾼 선택지에 유의합니다.'));
  expectError(ctx, feat([ref(5), ref(1)], '세부 정보를 바꾼 선택지에 유의합니다.'), "'세부 정보를 바꾼 선택지'은(는) 연결한 문항 모두");
  // 원문: 원문 대조 근거는 6번에만
  pass(feat([ref(6)], '원문의 흐름을 바탕으로 한 문항입니다.'));
  expectError(ctx, feat([ref(6), ref(1)], '원문의 흐름을 바탕으로 한 문항입니다.'), "'원문'은 연결한 문항 모두");
  // 직접 쓰기·고치기: 객관식이 섞이면 거절, 서술형만이면 통과
  const essay = ctx.questions.find((x) => x.format === 'essay')!.ref;
  pass(feat([essay], '어순 오류를 직접 고쳐 쓰는 능력을 요구합니다.'));
  expectError(ctx, feat([ref(1), essay], '어순 오류를 직접 고쳐 쓰는 능력을 요구합니다.'), '직접 쓰거나 고치는 요구');
  // 학습 행동은 연습 조언이라 직접 쓰기 규칙을 적용하지 않는다
  const act = withProse(r, { actions: [{ ...r.actions[0], refs: [ref(1)], body: '오류를 찾아 바른 형태로 고쳐 쓰는 연습을 문장 단위로 반복합니다.' }] });
  assert.ok(!validateEnglishCommentaryReport(ctx, act).some((e) => e.includes('직접 쓰거나')), '행동 조언은 허용');
  // 대표 문항: 객관식의 요구(demand)로 '고쳐 쓰기'는 거절, 연습 제안(prep)으로는 허용
  const objRef = ctx.candidates.find((c) => ctx.questions.find((x) => x.ref === c)?.format === 'objective')!;
  const repBase = r.representatives.filter((p) => p.ref !== objRef);
  const withRep = (demand: string, prep: string) => withProse(r, { representatives: [{ ref: objRef, demand, reason: `기록된 함정인 '${ctx.questions.find((x) => x.ref === objRef)!.evidence.distractors}' 때문에 헷갈리기 쉽습니다.`, prep }, ...repBase].slice(0, ctx.limits.representatives.max) });
  expectError(ctx, withRep('틀린 부분을 찾아 바른 형태로 고쳐 쓰는 능력을 요구합니다.', '연결어에 표시하며 앞뒤 문장을 한 줄로 요약하는 연습을 합니다.'), '직접 쓰거나 고치는 요구');
  assert.ok(!validateEnglishCommentaryReport(ctx, withRep('앞뒤 문장의 관계를 따져 알맞은 내용을 고르게 합니다.', '틀린 문장을 찾아 바른 형태로 고쳐 쓰는 연습도 함께 합니다.')).some((e) => e.includes('직접 쓰거나')), 'prep 연습 제안은 허용');
  // 전역 문단은 시험 전체 범위 소개 — 어느 문항에든 기록된 항목이면 통과
  pass(setOverview(r, '연어와 연결어의 쓰임을 함께 확인합니다.'));
});

test('검증기 — 핵심 어휘를 답안 필수 제시어로 추론하지 않는다 (high-conditional-writing 실출력 회귀)', () => {
  const build = (conditions: string[]) => {
    const qs = fixPoints(richQuestions());
    const essay = qs.find((x) => x.question_number === '서술형1')!;
    essay.key_vocab = [{ word: 'although', meaning: '비록' }];
    essay.english_analysis = ev({ subtype: 'conditional_writing', skills: ['조건 영작'], thinking: 'produce', distractors: '세부 정보를 바꾸어 놓은 선택지', writing_conditions: conditions });
    const ctx = buildEnglishCommentaryContext(input(qs));
    assert.ok(ctx.candidates.includes('서술형1'), '서술형1 은 대표 문항 후보');
    const r = goodReport(ctx);
    const others = r.representatives.filter((p) => p.ref !== '서술형1');
    const withRep = (demand: string, reason: string, prep: string) =>
      withProse(r, { representatives: [{ ref: '서술형1', demand, reason, prep }, ...others].slice(0, ctx.limits.representatives.max) });
    return { ctx, withRep };
  };
  const general = build(['주어진 낱말을 모두 쓸 것', '두 문장으로 쓸 것']);
  const neutralReason = '조건 누락이 생기지 않도록 낱말과 문장 수를 함께 확인해야 하기 때문입니다.';
  const neutralPrep = '같은 조건으로 문장을 다시 써 보며 조건을 하나씩 대조하는 연습을 합니다.';
  // 실출력 두 문장 — 조건이 일반적('주어진 낱말 모두')이면 although 를 필수 요소로 단정할 수 없다
  expectError(general.ctx, general.withRep('교과서 문장의 순서가 일부 바뀐 지문에서 관계대명사와 although를 활용하여 주어진 조건을 만족하는 두 문장을 작성하도록 요구합니다.', neutralReason, neutralPrep), "'although'을(를) 답안에 써야 하는 요소로");
  expectError(general.ctx, general.withRep('주어진 낱말을 모두 사용하여 두 문장으로 완성하도록 요구합니다.', '조건 누락과 어법 오류에 대한 감점 기준이 있으며, although와 관계대명사를 문맥에 맞게 정확히 조합해야 하기 때문입니다.', neutralPrep), "'although'을(를) 답안에 써야 하는 요소로");
  // 조건에 낱말이 적혀 있으면 통과
  const named = build(['although를 사용하여 두 문장으로 쓸 것']);
  assert.ok(!validateEnglishCommentaryReport(named.ctx, named.withRep('although를 활용하여 두 문장을 작성하도록 요구합니다.', neutralReason, neutralPrep)).some((e) => e.includes('답안에 써야')), '조건에 명시되면 허용');
  // 연습 제안(prep)·'쓰임' 이해는 허용
  assert.ok(!validateEnglishCommentaryReport(general.ctx, general.withRep('주어진 낱말을 모두 사용하여 두 문장으로 완성하도록 요구합니다.', neutralReason, 'although 같은 연결어를 활용해 문장을 써 보는 연습을 합니다.')).some((e) => e.includes('답안에 써야')), 'prep 연습 제안 허용');
  assert.ok(!validateEnglishCommentaryReport(general.ctx, general.withRep('although의 쓰임을 이해하고 조건에 맞게 두 문장을 완성하도록 요구합니다.', neutralReason, neutralPrep)).some((e) => e.includes('답안에 써야')), "'쓰임' 이해는 허용");
});

test('검증기 — v1 단일 ref 계약: 특징·행동은 서로 다른 문항 하나씩, 요구 문단의 복수 일반화 금지', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  assert.deepEqual(validateEnglishCommentaryReport(ctx, r), [], '단일 ref 정상 보고서 통과');
  const refs = ctx.questions.map((x) => x.ref);
  expectError(ctx, withProse(r, { features: [{ ...r.features[0], refs: [refs[3], refs[7]] }, r.features[1]] }), '문항 하나만 연결');
  expectError(ctx, withProse(r, { features: [r.features[0], { ...r.features[1], refs: r.features[0].refs }] }), '서로 다른 문항을 하나씩');
  expectError(ctx, withProse(r, { actions: [{ ...r.actions[0], refs: [refs[0], refs[1]] }] }), '문항 하나만 연결');
  expectError(ctx, withProse(r, { features: [{ ...r.features[0], body: `${r.features[0].body} 이런 문항들은 비슷한 연습이 필요합니다.` }, r.features[1]] }), '연결한 문항 하나에 대해서만');
  // 학습 행동의 일반 조언('비슷한 문항을 더 풀어 보기', '이전 문항 복습')은 허용
  const adv = withProse(r, { actions: [{ ...r.actions[0], body: '비슷한 문항을 더 풀어 보며 이전 문항에서 표시한 연결어를 다시 확인합니다.' }] });
  assert.deepEqual(validateEnglishCommentaryReport(ctx, adv), [], '행동의 학습 조언 허용');
});

test('검증기 — 쓰기 목적은 기록대로 (high-conditional-writing R0 의견 작성 실출력 회귀)', () => {
  const build = (subtype: string, conditions: string[]) => {
    const qs = fixPoints(richQuestions());
    const essay = qs.find((x) => x.question_number === '서술형1')!;
    essay.english_analysis = ev({ subtype, skills: ['조건 영작'], thinking: 'produce', distractors: '세부 정보를 바꾸어 놓은 선택지', writing_conditions: conditions });
    const ctx = buildEnglishCommentaryContext(input(qs));
    const r = goodReport(ctx);
    const others = r.representatives.filter((p) => p.ref !== '서술형1');
    const withDemand = (demand: string, prep = '같은 조건으로 문장을 다시 써 보며 조건을 하나씩 대조하는 연습을 합니다.') =>
      withProse(r, { representatives: [{ ref: '서술형1', demand, reason: '조건 누락이 생기지 않도록 낱말과 문장 수를 함께 확인해야 하기 때문입니다.', prep }, ...others].slice(0, ctx.limits.representatives.max) });
    return { ctx, withDemand };
  };
  const cond = build('conditional_writing', ['주어진 낱말을 모두 쓸 것', '두 문장으로 쓸 것']);
  expectError(cond.ctx, cond.withDemand('관계대명사를 활용하여 조건에 맞는 문장으로 의견을 작성하는 서술형 문항입니다.'), "'의견 쓰기'");
  expectError(cond.ctx, cond.withDemand('지문 내용을 요약하여 두 문장으로 쓰도록 요구합니다.'), "'요약하기'");
  assert.ok(!validateEnglishCommentaryReport(cond.ctx, cond.withDemand('주어진 낱말을 모두 써서 두 문장으로 완성하도록 요구합니다.')).some((e) => e.includes('쓰기 목적')), '기록된 조건대로 쓰면 통과');
  assert.ok(!validateEnglishCommentaryReport(cond.ctx, cond.withDemand('주어진 낱말을 모두 써서 두 문장으로 완성하도록 요구합니다.', '자신의 의견을 두 문장으로 써 보는 연습도 해 봅니다.')).some((e) => e.includes('쓰기 목적')), 'prep 연습 제안은 허용');
  const summary = build('summary_writing', ['글의 뜻을 한 문장으로 쓴다']);
  assert.ok(!validateEnglishCommentaryReport(summary.ctx, summary.withDemand('글의 중심 내용을 요약하여 한 문장으로 쓰도록 요구합니다.')).some((e) => e.includes('쓰기 목적')), '요약 영작 기록이면 요약 허용');
});

test('검증기 — 없는 영역·원문 인용·내부 키·표기 금지', () => {
  const objCtx = buildEnglishCommentaryContext(OBJECTIVE_ONLY());
  const objReport = goodReport(objCtx);
  expectError(objCtx, setOverview(objReport, '서술형 대비도 필요합니다.'), '서술·단답형 문항이 없습니다');
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  expectError(ctx, setOverview(r, '듣기 문항도 대비해야 합니다.'), '듣기 문항이 없습니다');
  expectError(ctx, setOverview(r, '지문의 the main idea of the passage 를 찾아야 합니다.'), '영어 문장·구절을 인용하지');
  expectError(ctx, setOverview(r, 'photosynthesis 같은 낱말이 나왔습니다.'), '기록에 있는 영어 표현이 아닙니다');
  assert.deepEqual(validateEnglishCommentaryReport(ctx, setOverview(r, 'reluctant 같은 낱말과 that절 구분이 필요합니다.')), [], '기록된 어휘·문법 용어는 허용');
  expectError(ctx, setOverview(r, 'grammar_error 유형이 많았습니다.'), '내부 영문 분류 키');
  expectError(ctx, setOverview(r, 'READING 영역이 중심입니다.'), '영문 분류명');
  expectError(ctx, setOverview(r, '<b>중요</b>합니다.'), 'HTML');
  expectError(ctx, setOverview(r, '**중요**합니다.'), '마크다운');
  expectError(ctx, setOverview(r, '가격 표기 $ 는 쓰지 않습니다.'), '달러');
  expectError(ctx, setOverview(r, 'Claude 분석입니다.'), '모델·회사 이름');
  const mock = buildEnglishCommentaryContext(input(fixPoints(richQuestions()), { examScope: { examCategory: 'MOCK' }, title: '모의고사' }));
  expectError(mock, setOverview(goodReport(mock), '내신처럼 대비해야 합니다.'), '학력평가·모의고사');
});

// ── 응답 파싱 · 생성 ─────────────────────────────────────────────────
function fakeText(responses: Array<{ text: string; truncated?: boolean } | Error>): GenerateTextFn & { calls: Array<{ label: string; user: string }> } {
  const calls: Array<{ label: string; user: string }> = [];
  const fn = (async (req) => {
    calls.push({ label: req.label, user: req.user });
    const next = responses.shift();
    if (!next) throw new Error('응답 없음');
    if (next instanceof Error) throw next;
    return { text: next.text, provider: 'gemini' as const, model: 'fake', truncated: !!next.truncated };
  }) as GenerateTextFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

test('파싱 — 숫자 ref 를 문자열로, 코드펜스 허용, 잘못된 JSON 은 오류', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const r = goodReport(ctx);
  const numeric = { ...r, features: r.features.map((f) => ({ ...f, refs: f.refs.map((x) => (/^\d+$/.test(x) ? Number(x) : x)) })) };
  const parsed = parseEnglishCommentaryResponse(ctx, '```json\n' + JSON.stringify(numeric) + '\n```');
  assert.deepEqual(parsed.errors, []);
  assert.equal(typeof parsed.report!.features[0].refs[0], 'string');
  assert.ok(parseEnglishCommentaryResponse(ctx, '{"headline": ').errors.length > 0);
  assert.ok(parseEnglishCommentaryResponse(ctx, '[]').errors.length > 0);
  assert.ok(parseEnglishCommentaryResponse(ctx, JSON.stringify({ headline: 1 })).errors.length > 0);
});

test('생성 — 첫 응답 통과 시 1회 호출', async () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const gen = fakeText([{ text: JSON.stringify(goodReport(ctx)) }]);
  const out = await generateEnglishCommentary(ctx, { generateText: gen });
  assert.equal(out.ok, true);
  assert.equal(gen.calls.length, 1);
  if (out.ok) assert.equal(out.repaired, false);
});

test('생성 — 잘린 응답은 복구하지 않고 실패, 보완 호출도 없다', async () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const gen = fakeText([{ text: JSON.stringify(goodReport(ctx)).slice(0, 300), truncated: true }]);
  const out = await generateEnglishCommentary(ctx, { generateText: gen });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'truncated');
  assert.equal(gen.calls.length, 1);
});

test('생성 — 검증 실패 → 보완 1회로 통과', async () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const bad = setOverview(goodReport(ctx), '등급컷은 높을 것입니다.');
  const gen = fakeText([{ text: JSON.stringify(bad) }, { text: JSON.stringify(goodReport(ctx)) }]);
  const out = await generateEnglishCommentary(ctx, { generateText: gen });
  assert.equal(out.ok, true);
  if (out.ok) { assert.equal(out.repaired, true); assert.equal(out.attempts, 2); }
  assert.equal(gen.calls.length, 2);
  assert.ok(gen.calls[1].user.includes('고쳐야 할 점') && gen.calls[1].user.includes('등급컷'));
});

test('생성 — 보완 후에도 위반이면 실패 (최대 2회)', async () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const bad = JSON.stringify(setOverview(goodReport(ctx), '변별력이 높습니다.'));
  const gen = fakeText([{ text: bad }, { text: bad }, { text: JSON.stringify(goodReport(ctx)) }]);
  const out = await generateEnglishCommentary(ctx, { generateText: gen });
  assert.equal(out.ok, false);
  if (!out.ok) { assert.equal(out.code, 'invalid'); assert.ok(out.errors.some((e) => e.includes('변별'))); }
  assert.equal(gen.calls.length, 2);
});

test('생성 — 호출 예외는 사용자용 문구로 (벤더·내부 정보 없음)', async () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const gen = fakeText([new Error('When using --print, GEMINI_API_KEY missing')]);
  const out = await generateEnglishCommentary(ctx, { generateText: gen });
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, 'llm_error');
    assert.ok(!/gemini|api_key|--print/i.test(out.message), out.message);
  }
});

test('프롬프트 — 한글 라벨만, 영문 분류 키·수학 지시 없음, 없는 영역 명시', () => {
  const ctx = buildEnglishCommentaryContext(RICH());
  const user = buildEnglishCommentaryUserPrompt(ctx);
  const system = buildEnglishCommentarySystemPrompt(ctx);
  assert.ok(!/grammar_error|conditional_writing|"reading"|"grammar"|teacher_verified|unverified/.test(user), '입력에 영문 키 없음');
  assert.ok(user.includes('문장 속 어법 오류') && user.includes('대표 문항 후보'));
  assert.ok(system.includes('듣기 문항이 없다'));
  assert.ok(!/1\/3|전국 표준|v4_|blog_qa/.test(system + user), '수학 V3 지시가 섞이지 않음');
  assert.ok(!user.includes('킬러'), '입력에 킬러 라벨 없음');
  assert.ok(user.includes('"단원 기록": "고1 영어 > 독해 > 빈칸 추론"'), '문항 기록에 단원 기록 포함');
  assert.ok(system.includes('단원명만 보고 함정') && system.includes('공통으로 기록된'), '단원명 추측 금지·다중 refs 공통 조건 규칙');
  assert.ok(!/claude|gemini|anthropic/i.test(system + user));
  const mock = buildEnglishCommentaryContext(input(fixPoints(richQuestions()), { examScope: { examCategory: 'MOCK' } }));
  assert.ok(buildEnglishCommentarySystemPrompt(mock).includes('학력평가·모의고사다'));
});

// ── 저장 서비스 (메모리 가짜 어댑터) ─────────────────────────────────
class FakeStore implements EnglishCommentaryStore {
  inputs = new Map<string, { input: EnglishCommentaryInput; isLatest: boolean; reanalyzing?: boolean }>();
  rows = new Map<string, EnglishCommentaryRowSnapshot & { lastRunBy: string | null }>();
  writes = 0;
  private seq = 0;
  private clone<T>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  async loadInput(id: string) { const v = this.inputs.get(id); return v ? { ...this.clone(v), reanalyzing: v.reanalyzing ?? false } : null; }
  async getRow(id: string) {
    const r = this.rows.get(id);
    return r ? { id: r.id, result: this.clone(r.result), lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null, errorMessage: r.errorMessage } : null;
  }
  async createRow(analysisId: string, data: Parameters<EnglishCommentaryStore['createRow']>[1]) {
    if (this.rows.has(analysisId)) return null;
    this.writes++;
    this.rows.set(analysisId, { id: `row${++this.seq}`, result: this.clone(data.result), lastRunAt: data.lastRunAt, errorMessage: data.errorMessage ?? null, lastRunBy: data.lastRunBy });
    return this.getRow(analysisId);
  }
  /** 단일 스레드라 재읽기·결정·CAS 사이에 테스트 쪽 변경이 끼지 않는다 — 운영 어댑터의 잠금 구간과 같은 의미 */
  async finalize(analysisId: string, decide: Parameters<EnglishCommentaryStore['finalize']>[1]) {
    const fresh = await this.loadInput(analysisId);
    const row = await this.getRow(analysisId);
    const { write } = decide({ fresh, row });
    if (!write) return { written: null };
    return { written: await this.casUpdate(write.rowId, write.expectedLastRunAt, write.data) };
  }
  async casUpdate(rowId: string, expected: Date | null, data: Parameters<EnglishCommentaryStore['casUpdate']>[2]) {
    const entry = [...this.rows.entries()].find(([, r]) => r.id === rowId);
    if (!entry) return null;
    const [aid, row] = entry;
    if ((row.lastRunAt?.getTime() ?? null) !== (expected?.getTime() ?? null)) return null;
    this.writes++;
    this.rows.set(aid, {
      ...row, result: this.clone(data.result), lastRunAt: data.lastRunAt, lastRunBy: data.lastRunBy,
      errorMessage: data.errorMessage === undefined ? row.errorMessage : data.errorMessage,
    });
    return this.getRow(aid);
  }
}

function clock(start = Date.parse('2026-10-02T00:00:00Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}
function okGen(): EnglishCommentaryGeneration & { ok: true } {
  return { ok: true, report: undefined as unknown as EnglishCommentaryReport, repaired: false, attempts: 1, durationMs: 5 };
}
/** ctx 에 맞춘 정상 생성기 (호출 수 기록) */
function generator(mode: 'ok' | 'fail' = 'ok') {
  const calls: EnglishCommentaryContext[] = [];
  const fn = async (ctx: EnglishCommentaryContext): Promise<EnglishCommentaryGeneration> => {
    calls.push(ctx);
    if (mode === 'fail') return { ok: false, code: 'invalid', message: '총평이 품질 기준을 통과하지 못했습니다. 다시 생성해 주세요', errors: ['x'], attempts: 2, durationMs: 5 };
    return { ...okGen(), report: goodReport(ctx) };
  };
  return Object.assign(fn, { calls });
}
/** 외부에서 끝낼 수 있는 생성기 — 동시성·교정 중 저장 검사용 */
function deferredGenerator() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const calls: EnglishCommentaryContext[] = [];
  const fn = async (ctx: EnglishCommentaryContext): Promise<EnglishCommentaryGeneration> => {
    calls.push(ctx);
    await gate;
    return { ...okGen(), report: goodReport(ctx) };
  };
  return Object.assign(fn, { calls, release: () => release() });
}
function setup(i: EnglishCommentaryInput = RICH()) {
  const store = new FakeStore();
  store.inputs.set(i.analysis.id, { input: i, isLatest: true });
  return { store, c: clock() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('서비스 — 첫 생성 성공: 유효 문서 저장, 오류 없음, 재요청은 캐시', async () => {
  const { store, c } = setup();
  const gen = generator();
  const res = await runEnglishCommentary({ analysisId: 'an1', userId: 'u1', store, generate: gen, now: c.now });
  assert.equal(res.status, 'completed');
  assert.equal(res.code, 'completed');
  const row = store.rows.get('an1')!;
  const doc = readEnglishCommentary(row.result);
  assert.ok(doc);
  assert.equal(englishCommentaryDocumentSchema.safeParse(doc).success, true);
  assert.equal(row.errorMessage, null);
  assert.equal(readEnglishCommentaryState(row.result).running, null);
  assert.equal(doc!.inputSignature, englishCommentarySignature(buildEnglishCommentaryContext(RICH())));

  const again = await runEnglishCommentary({ analysisId: 'an1', store, generate: gen, now: c.now });
  assert.equal(again.code, 'cached');
  assert.equal(gen.calls.length, 1, '같은 서명이면 AI 를 다시 부르지 않는다');
});

test('서비스 — 재생성 실패는 이전 성공 문서를 보존하고 실패만 기록', async () => {
  const { store, c } = setup();
  await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), now: c.now });
  const before = readEnglishCommentary(store.rows.get('an1')!.result)!;
  c.advance(1000);
  const res = await runEnglishCommentary({ analysisId: 'an1', store, generate: generator('fail'), forceRegenerate: true, now: c.now });
  assert.equal(res.status, 'failed');
  assert.equal(res.code, 'generation_failed');
  const row = store.rows.get('an1')!;
  const state = readEnglishCommentaryState(row.result);
  assert.equal(state.status, 'ready');
  assert.deepEqual(state.document!.report, before.report, '이전 보고서 그대로');
  assert.equal(state.lastFailure?.code, 'generation_failed');
  assert.equal(state.running, null);
  assert.ok(row.errorMessage && !/gemini|claude/i.test(row.errorMessage));
});

test('서비스 — 첫 생성 실패 행은 문서가 없다(완료로 보이지 않음)', async () => {
  const { store, c } = setup();
  const res = await runEnglishCommentary({ analysisId: 'an1', store, generate: generator('fail'), now: c.now });
  assert.equal(res.status, 'failed');
  const state = readEnglishCommentaryState(store.rows.get('an1')!.result);
  assert.equal(state.document, null);
  assert.equal(state.status, 'pending');
  assert.equal(readEnglishCommentary(store.rows.get('an1')!.result), null);
});

test('서비스 — 진행 중이면 두 번째 요청은 AI 호출 없이 in_progress', async () => {
  const { store, c } = setup();
  const slow = deferredGenerator();
  const first = runEnglishCommentary({ analysisId: 'an1', store, generate: slow, now: c.now });
  await tick();
  const second = generator();
  const res2 = await runEnglishCommentary({ analysisId: 'an1', store, generate: second, forceRegenerate: true, now: c.now });
  assert.equal(res2.code, 'in_progress');
  assert.equal(second.calls.length, 0);
  slow.release();
  const res1 = await first;
  assert.equal(res1.code, 'completed');
});

test('서비스 — 만료된 lease 는 인계되고, 늦게 끝난 옛 실행은 덮어쓰지 않는다', async () => {
  const { store, c } = setup();
  const slow = deferredGenerator();
  const first = runEnglishCommentary({ analysisId: 'an1', store, generate: slow, now: c.now });
  await tick();
  c.advance(ENGLISH_COMMENTARY_LEASE_MS + 1000);
  const second = await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), forceRegenerate: true, now: c.now });
  assert.equal(second.code, 'completed');
  const saved = store.rows.get('an1')!.result;
  slow.release();
  const res1 = await first;
  assert.equal(res1.code, 'superseded');
  assert.deepEqual(store.rows.get('an1')!.result, saved, '인계한 쪽의 결과가 유지된다');
});

test('서비스 — 생성 중 교정이 들어오면 저장하지 않는다 (이전 문서 보존)', async () => {
  const { store, c } = setup();
  await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), now: c.now });
  const before = readEnglishCommentary(store.rows.get('an1')!.result)!;
  c.advance(1000);
  const slow = deferredGenerator();
  const pending = runEnglishCommentary({ analysisId: 'an1', store, generate: slow, forceRegenerate: true, now: c.now });
  await tick();
  const edited = RICH();
  (edited.analysis.questions as Q[])[0].ai_comment = '교사가 고친 소견';
  store.inputs.set('an1', { input: edited, isLatest: true });
  slow.release();
  const res = await pending;
  assert.equal(res.code, 'input_changed');
  const state = readEnglishCommentaryState(store.rows.get('an1')!.result);
  assert.deepEqual(state.document!.report, before.report);
  assert.equal(state.lastFailure?.code, 'input_changed');
  assert.equal(state.running, null);
  assert.equal(isEnglishCommentaryStale(state.document!, englishCommentarySignature(buildEnglishCommentaryContext(edited))), true);
});

test('서비스 — 재분석으로 행이 사라지면 옛 실행은 저장하지 않는다', async () => {
  const { store, c } = setup();
  const slow = deferredGenerator();
  const pending = runEnglishCommentary({ analysisId: 'an1', store, generate: slow, now: c.now });
  await tick();
  store.rows.delete('an1');
  store.inputs.delete('an1');
  const writes = store.writes;
  slow.release();
  const res = await pending;
  assert.equal(res.code, 'superseded');
  assert.equal(store.writes, writes);
  assert.equal(store.rows.has('an1'), false);
});

test('서비스 — 생성 중 재분석이 시작되면 문서를 쓰지 않고 lease 만 푼다', async () => {
  const { store, c } = setup();
  await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), now: c.now });
  const before = readEnglishCommentary(store.rows.get('an1')!.result)!;
  c.advance(1000);
  const slow = deferredGenerator();
  const pending = runEnglishCommentary({ analysisId: 'an1', store, generate: slow, forceRegenerate: true, now: c.now });
  await tick();
  store.inputs.set('an1', { input: RICH(), isLatest: true, reanalyzing: true });
  slow.release();
  const res = await pending;
  assert.equal(res.code, 'superseded');
  const state = readEnglishCommentaryState(store.rows.get('an1')!.result);
  assert.deepEqual(state.document!.report, before.report);
  assert.equal(state.running, null);
  assert.equal(state.lastFailure?.code, 'superseded');
});

test('서비스 — readiness 실패·최신 아님은 행을 만들지 않고 AI 도 부르지 않는다', async () => {
  const dup = RICH();
  (dup.analysis.questions as Q[])[1].question_number = 1;
  const { store, c } = setup(dup);
  const gen = generator();
  const res = await runEnglishCommentary({ analysisId: 'an1', store, generate: gen, now: c.now });
  assert.equal(res.code, 'not_ready');
  assert.ok(res.error?.includes('중복'));
  assert.equal(store.rows.size, 0);
  assert.equal(gen.calls.length, 0);

  const old = setup();
  old.store.inputs.set('an1', { input: RICH(), isLatest: false });
  const r2 = await runEnglishCommentary({ analysisId: 'an1', store: old.store, generate: gen, now: old.c.now });
  assert.equal(r2.code, 'superseded');
  assert.equal(gen.calls.length, 0);
});

test('서비스 — 구형 총평은 실패 시 보존(구형 안내), 성공 시 교체', async () => {
  const { store, c } = setup();
  store.rows.set('an1', { id: 'legacy', result: { overall_comment: '옛 총평', blog_headline: '옛 제목' }, lastRunAt: null, errorMessage: null, lastRunBy: null });
  await runEnglishCommentary({ analysisId: 'an1', store, generate: generator('fail'), now: c.now });
  const failed = readEnglishCommentaryState(store.rows.get('an1')!.result);
  assert.equal(failed.status, 'legacy');
  assert.equal(failed.hasLegacy, true);
  c.advance(1000);
  const ok = await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), now: c.now });
  assert.equal(ok.code, 'completed');
  const state = readEnglishCommentaryState(store.rows.get('an1')!.result);
  assert.equal(state.status, 'ready');
  assert.equal(state.hasLegacy, false);
});

test('재분석 이관 — 유효 문서만 옮기고, 새 분석에서는 이전 근거로 보인다', async () => {
  const { store, c } = setup();
  await runEnglishCommentary({ analysisId: 'an1', store, generate: generator(), now: c.now });
  const prev = store.rows.get('an1')!.result;
  const migrated = migrateEnglishCommentaryForReanalysis(prev, 'an1', c.now());
  assert.ok(migrated);
  assert.equal(migrated!.run, null);
  assert.deepEqual(migrated!.migratedFrom, { analysisId: 'an1', at: c.now().toISOString() });
  const doc = readEnglishCommentary(migrated);
  assert.ok(doc, '이관 문서도 유효한 문서로 읽힌다');
  const newSig = englishCommentarySignature(buildEnglishCommentaryContext({ ...RICH(), analysis: { ...RICH().analysis, id: 'an2' } }));
  assert.equal(isEnglishCommentaryStale(doc!, newSig), true);
  assert.equal(migrateEnglishCommentaryForReanalysis({ overall_comment: '옛 총평' }, 'an1'), null);
  assert.equal(migrateEnglishCommentaryForReanalysis(null, 'an1'), null);
});

(async () => {
  for (const t of tests) {
    try {
      await t.run();
      count++;
      console.log(`PASS ${t.name}`);
    } catch (e) {
      console.error(`FAIL ${t.name}`);
      console.error(e);
      process.exitCode = 1;
    }
  }
  console.log(`\n${count}/${tests.length} 통과`);
})();
