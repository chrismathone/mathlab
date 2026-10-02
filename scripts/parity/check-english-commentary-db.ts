/**
 * 영어 총평 — **실제 Prisma 어댑터** 대상 통합 검사. AI 호출 없음(generateText 는 주입 fake).
 *
 * 검사
 *  1. 동시 시작 두 건 → 모델 호출 1회만, 다른 한 건은 in_progress
 *  2. 재생성 실패 → 이전 성공 문서 보존 + 실패 기록
 *  3. 생성 중 교정(분석 행 UPDATE) → input_changed, 문서 보존
 *  4. 원자 저장 — finalize 가 행을 잠근 동안 교정 UPDATE 가 대기했다가 커밋 뒤에 반영된다(경합 창 없음)
 *  5. 재분석 이관 — analyze 라우트와 같은 순서(이관 문서 생성 → deleteMany Cascade → 새 분석 + 이관 행),
 *     옛 분석의 진행 중 실행은 저장되지 않음, 새 분석에서 '이전 근거'로 보이고 재생성 시 교체
 *
 * 안전
 *  - 이 스크립트가 만든 임시 Tenant·User·ExamPaper·ExamAnalysis 만 만들고, finally 에서 **그 id 만** 지운다.
 *  - 기존 사용자 데이터는 읽지도 고치지도 않는다. 환경변수 값은 출력하지 않는다.
 *
 * 실행: npx tsx scripts/parity/check-english-commentary-db.ts
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../src/lib/db';
import { createPrismaEnglishCommentaryStore } from '../../src/lib/exam-analysis/english/commentary/prisma-store';
import { runEnglishCommentary } from '../../src/lib/exam-analysis/english/commentary/service';
import { buildEnglishCommentaryContext } from '../../src/lib/exam-analysis/english/commentary/context';
import { englishCommentarySignature } from '../../src/lib/exam-analysis/english/commentary/signature';
import { migrateEnglishCommentaryForReanalysis } from '../../src/lib/exam-analysis/english/commentary/migrate';
import {
  readEnglishCommentary, readEnglishCommentaryState, isEnglishCommentaryStale,
  type EnglishCommentaryContext, type EnglishCommentaryReport,
} from '../../src/lib/exam-analysis/english/commentary/schema';
import type { GenerateTextFn } from '../../src/lib/exam-analysis/english/commentary/generate';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 없어 DB 검사를 건너뜁니다 (값은 출력하지 않음)');
  process.exit(1);
}
if (process.env.VERCEL_ENV === 'production') {
  console.error('운영 환경에서는 실행하지 않습니다');
  process.exit(1);
}

// ── 임시 데이터 추적 (정리 대상은 이 목록뿐) ──
const created = { tenantId: '', userId: '', paperIds: [] as string[] };
const TAG = `encomm-db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const store = createPrismaEnglishCommentaryStore();
let passed = 0;
function pass(name: string) { passed++; console.log(`PASS ${name}`); }

// ── 픽스처 (scripts/parity/check-english-commentary.ts 와 같은 모양) ──
type Q = Record<string, unknown>;
function q(n: number | string, fields: Q = {}): Q {
  return {
    question_number: n, question_format: 'objective', difficulty: '3', difficulty_reason: null,
    question_type: 'reading', ability_domain: 'understanding', points: 4, topic: '고1 영어 > 독해 > 빈칸 추론',
    ai_comment: '앞뒤 문장의 논리 연결을 확인하는 문항입니다', confidence: 0.9, confidence_reason: null,
    is_correct: null, student_answer: null, earned_points: null, error_type: null, ...fields,
  };
}
function ev(fields: Q = {}): Q {
  return { subtype: 'blank', skills: ['연결어와 논리 흐름'], thinking: 'infer', distractors: '본문 낱말을 그대로 쓴 선택지', ...fields };
}
function questions(): Q[] {
  const qs: Q[] = [];
  for (let i = 1; i <= 16; i++) {
    const grammar = i % 4 === 0;
    qs.push(q(i, {
      points: i <= 12 ? 4 : 5.5,
      question_type: grammar ? 'grammar' : 'reading',
      ability_domain: grammar ? 'accuracy' : 'reasoning',
      english_analysis: grammar
        ? ev({ subtype: 'grammar_error', skills: ['수일치', '관계사 뒤 문장 구조'], thinking: 'apply', distractors: '수식어구로 멀어진 주어와 동사', passage_id: 'P1' })
        : ev({ passage_id: `P${i}` }),
      key_vocab: [{ word: 'reluctant', meaning: '꺼리는' }],
    }));
  }
  qs.push(q('서술형1', {
    question_format: 'essay', question_type: 'writing', ability_domain: 'expression', points: 6,
    english_analysis: ev({ subtype: 'conditional_writing', skills: ['주어진 단어 활용'], thinking: 'produce', distractors: null, writing_conditions: ['주어진 단어를 모두 사용'] }),
  }));
  qs.push(q('서술형2', {
    question_format: 'essay', question_type: 'writing', ability_domain: 'expression', points: 24,
    english_analysis: ev({ subtype: 'conditional_writing', skills: ['어순'], thinking: 'produce', distractors: null, writing_conditions: ['어형을 바꾸어 쓸 것'] }),
  }));
  return qs; // 48 + 22 + 6 + 24 = 100
}
const SUMMARY = {
  completeness: { status: 'ok', declaredQuestions: 18, declaredPoints: 100, emittedQuestions: 18, pointsSum: 100, pointsShortfall: 0, filledQuestions: 0, retried: false, reason: '' },
};

function goodReport(ctx: EnglishCommentaryContext): EnglishCommentaryReport {
  const refs = ctx.questions.map((x) => x.ref);
  return {
    headline: '문장 단위로 근거를 찾는 독해 시험',
    dek: '어법은 문장 속 판단을, 독해는 앞뒤 문맥의 연결을, 쓰기는 조건을 지키는 정확성을 요구했습니다.',
    overview: '이번 시험은 낱말 뜻을 아는 것만으로는 풀기 어려운 문항이 중심이었습니다. 문장 안에서 어법을 판단하고, 글의 흐름을 따라 빈칸과 순서를 결정하며, 주어진 조건대로 문장을 완성해야 합니다. 그래서 지문을 읽을 때 답의 이유를 함께 확인하는 습관이 점수와 직접 연결됩니다.',
    features: [
      { title: '문장 속 어법 판단', refs: [refs[3]], body: '밑줄 친 부분이 문장 구조 안에서 맞는지 판단해야 합니다. 주어와 동사의 수 일치, 관계사 뒤의 문장 구조처럼 기록된 확인 기술이 반복해서 나타났습니다. 문장을 끊어 읽으며 주어와 동사를 먼저 표시하는 연습이 필요합니다.' },
      { title: '앞뒤 문맥을 잇는 빈칸', refs: [refs[0]], body: '빈칸 문항은 연결어와 앞뒤 문장의 관계를 근거로 답을 고르게 합니다. 본문 낱말을 그대로 옮긴 선택지가 정답처럼 보이기 쉬우므로, 낱말이 겹치는지보다 논리가 이어지는지를 먼저 확인해야 합니다.' },
    ],
    representatives: ctx.candidates.slice(0, ctx.limits.representatives.max).map((ref) => ({
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

/** 실제 생성 경로(파싱·검증 포함)를 타되 모델 대신 응답을 돌려주는 fake. gate 가 있으면 열릴 때까지 대기 */
function fakeText(textFor: () => Promise<string>, opts: { gate?: Promise<void> } = {}) {
  let calls = 0;
  const fn: GenerateTextFn = async () => {
    calls++;
    if (opts.gate) await opts.gate;
    return { text: await textFor(), provider: 'gemini', model: 'fake', truncated: false };
  };
  // Object.assign 은 getter 를 값으로 복사해 버리므로 defineProperty 로 살아 있는 getter 를 단다
  return Object.defineProperty(fn, 'calls', { get: () => calls }) as GenerateTextFn & { readonly calls: number };
}
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { promise: p, open: () => open() };
}
async function reportTextFor(analysisId: string): Promise<string> {
  const loaded = await store.loadInput(analysisId);
  assert.ok(loaded, '임시 분석을 읽을 수 있어야 한다');
  return JSON.stringify(goodReport(buildEnglishCommentaryContext(loaded!.input)));
}
async function currentSignature(analysisId: string): Promise<string> {
  const loaded = await store.loadInput(analysisId);
  assert.ok(loaded);
  return englishCommentarySignature(buildEnglishCommentaryContext(loaded!.input));
}
async function extensionResult(analysisId: string): Promise<{ result: unknown; errorMessage: string | null } | null> {
  return prisma.examAnalysisExtension.findUnique({
    where: { analysisId_agentType: { analysisId, agentType: 'commentary' } },
    select: { result: true, errorMessage: true },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(cond: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('대기 시간 초과');
    await sleep(25);
  }
}

async function makeExam(label: string): Promise<{ paperId: string; analysisId: string }> {
  const paper = await prisma.examPaper.create({
    data: {
      tenantId: created.tenantId, teacherId: created.userId, title: `2025년 1학기 중간고사 영어 (${label})`,
      subject: 'ENGLISH', grade: '고1', examScope: { topics: ['Lesson 1'], examYear: 2025, examSemester: 1, examCategory: 'MIDTERM' },
      schoolName: 'DB검사고', fileUrls: '', fileType: 'pdf', status: 'COMPLETED',
    },
    select: { id: true },
  });
  created.paperIds.push(paper.id);
  const analysis = await prisma.examAnalysis.create({
    data: {
      examPaperId: paper.id, questions: questions() as never, summary: SUMMARY as never,
      totalQuestions: 18, totalPoints: 100, modelVersion: 'db-check / prompt en-v1.5.0', analyzedAt: new Date(),
    },
    select: { id: true },
  });
  return { paperId: paper.id, analysisId: analysis.id };
}

async function main() {
  const tenant = await prisma.tenant.create({ data: { slug: TAG, name: '영어 총평 DB 검사(임시)', isActive: false }, select: { id: true } });
  created.tenantId = tenant.id;
  const user = await prisma.user.create({
    data: { username: TAG, passwordHash: '!disabled-test-account', name: 'DB검사', role: 'TEACHER', tenantId: tenant.id },
    select: { id: true },
  });
  created.userId = user.id;
  console.log(`임시 데이터 태그: ${TAG}`);

  // ── 1. 동시 시작 → 모델 1회 ──
  const A = await makeExam('A');
  {
    const g = gate();
    const text = fakeText(() => reportTextFor(A.analysisId), { gate: g.promise });
    const results: Array<{ code: string } | null> = [null, null];
    const r1 = runEnglishCommentary({ analysisId: A.analysisId, userId: created.userId, store, generateText: text }).then((r) => { results[0] = r; return r; });
    const r2 = runEnglishCommentary({ analysisId: A.analysisId, userId: created.userId, store, generateText: text }).then((r) => { results[1] = r; return r; });
    // 한쪽이 lease 를 잡고 모델 대기 중이면 다른 쪽은 AI 호출 없이 끝나야 한다
    const errors: unknown[] = [];
    r1.catch((e) => errors.push(e));
    r2.catch((e) => errors.push(e));
    await waitUntil(() => results.some((r) => r !== null) && text.calls === 1).catch((e) => {
      throw new Error(`${e instanceof Error ? e.message : e} — 결과 ${JSON.stringify(results.map((r) => r && { code: r.code, error: (r as { error?: string }).error }))}, 모델 호출 ${text.calls}, 예외 ${errors.map((x) => (x instanceof Error ? x.message : String(x))).join(' | ')}`);
    });
    g.open();
    const [a, b] = await Promise.all([r1, r2]);
    const codes = [a.code, b.code].sort();
    assert.deepEqual(codes, ['completed', 'in_progress']);
    assert.equal(text.calls, 1, '모델은 한 번만 호출');
    const ext = await extensionResult(A.analysisId);
    assert.ok(readEnglishCommentary(ext?.result), '유효 문서 저장');
    assert.equal(ext?.errorMessage, null);
    pass('동시 시작 두 건 — 모델 1회, 나머지는 in_progress');
  }

  // ── 2. 재생성 실패 → 이전 문서 보존 ──
  {
    const before = readEnglishCommentary((await extensionResult(A.analysisId))?.result)!;
    const text = fakeText(async () => '{"headline": "잘못된 응답"');
    const res = await runEnglishCommentary({ analysisId: A.analysisId, store, generateText: text, forceRegenerate: true });
    assert.equal(res.code, 'generation_failed');
    assert.equal(text.calls, 2, '본 1 + 보완 1');
    const ext = await extensionResult(A.analysisId);
    const state = readEnglishCommentaryState(ext?.result);
    assert.equal(state.status, 'ready');
    assert.deepEqual(state.document!.report, before.report);
    assert.equal(state.document!.inputSignature, before.inputSignature);
    assert.equal(state.lastFailure?.code, 'generation_failed');
    assert.equal(state.running, null);
    assert.ok(ext?.errorMessage);
    pass('재생성 실패 — 이전 성공 문서 보존, 실패만 기록');
  }

  // ── 3. 생성 중 교정 → 저장 거부 ──
  {
    const before = readEnglishCommentary((await extensionResult(A.analysisId))?.result)!;
    const g = gate();
    const text = fakeText(() => reportTextFor(A.analysisId), { gate: g.promise });
    const pending = runEnglishCommentary({ analysisId: A.analysisId, store, generateText: text, forceRegenerate: true });
    await waitUntil(() => text.calls === 1);
    const qs = questions();
    qs[0].ai_comment = '교사가 고친 소견입니다';
    await prisma.examAnalysis.update({ where: { id: A.analysisId }, data: { questions: qs as never } });
    g.open();
    const res = await pending;
    assert.equal(res.code, 'input_changed');
    const state = readEnglishCommentaryState((await extensionResult(A.analysisId))?.result);
    assert.deepEqual(state.document!.report, before.report, '이전 문서 그대로');
    assert.equal(state.lastFailure?.code, 'input_changed');
    assert.equal(isEnglishCommentaryStale(state.document!, await currentSignature(A.analysisId)), true);
    pass('생성 중 교정 — input_changed, 문서 보존, 이전 근거로 표시');
  }

  // ── 4. 원자 저장 — 잠긴 동안 교정 UPDATE 는 대기, 커밋 뒤 반영 ──
  {
    const B = await makeExam('B');
    let editDone = false;
    let editDuringLock = true;
    let edit: Promise<unknown> | null = null;
    // 교정은 **별도 클라이언트(별도 커넥션 풀)** 로 보낸다 — 같은 풀을 쓰면 커넥션 대기만으로도 '대기'처럼 보여
    // 잠금을 검증하지 못한다. 별도 풀이면 대기 원인은 행 잠금뿐이다.
    const editor = new PrismaClient();
    const lockingStore = createPrismaEnglishCommentaryStore({
      onLocked: async () => {
        const qs = questions();
        qs[1].ai_comment = '잠금 중 들어온 교정';
        edit = editor.examAnalysis.update({ where: { id: B.analysisId }, data: { questions: qs as never } })
          .then(() => { editDone = true; });
        await sleep(1200);
        editDuringLock = editDone; // 잠금이 유효하면 아직 커밋되지 못했어야 한다
      },
    });
    const text = fakeText(() => reportTextFor(B.analysisId));
    const res = await runEnglishCommentary({ analysisId: B.analysisId, store: lockingStore, generateText: text });
    assert.equal(editDuringLock, false, '교정 UPDATE 가 잠금 구간 안에서 커밋되면 안 된다');
    assert.equal(res.code, 'completed', '잠금 시점의 입력으로 서명이 일치해 저장된다');
    await edit;
    await editor.$disconnect();
    assert.equal(editDone, true, '잠금이 풀린 뒤 교정이 반영된다');
    const doc = readEnglishCommentary((await extensionResult(B.analysisId))?.result)!;
    assert.equal(isEnglishCommentaryStale(doc, await currentSignature(B.analysisId)), true, '교정이 저장 뒤에 들어왔으므로 이전 근거로 보인다');
    pass('원자 저장 — 재확인~쓰기 사이 교정 끼어들기 없음(잠금 후 직렬화)');
  }

  // ── 5. 재분석 이관 ──
  {
    const prev = await prisma.examAnalysis.findFirst({
      where: { examPaperId: A.paperId }, orderBy: { createdAt: 'desc' }, include: { extensions: true },
    });
    assert.ok(prev);
    // 옛 분석에서 진행 중인 실행 — 재분석 뒤에 끝나도 저장되면 안 된다
    const g = gate();
    const oldText = await reportTextFor(A.analysisId); // 재분석 후엔 옛 분석을 읽을 수 없으므로 미리 만든다
    const text = fakeText(async () => oldText, { gate: g.promise });
    const oldRun = runEnglishCommentary({ analysisId: A.analysisId, store, generateText: text, forceRegenerate: true });
    await waitUntil(() => text.calls === 1);

    // analyze 라우트와 같은 순서: 이관 문서를 먼저 만들고 → deleteMany(Cascade) → 새 분석 + 이관 행
    const ext = (await prisma.examAnalysis.findFirst({
      where: { id: prev!.id }, include: { extensions: true },
    }))!.extensions.find((e) => e.agentType === 'commentary');
    const migrated = ext ? migrateEnglishCommentaryForReanalysis(ext.result, prev!.id) : null;
    assert.ok(migrated, '유효 문서는 이관 대상');
    await prisma.examAnalysis.deleteMany({ where: { examPaperId: A.paperId } });
    const fresh = await prisma.examAnalysis.create({
      data: {
        examPaperId: A.paperId, questions: questions() as never, summary: SUMMARY as never,
        totalQuestions: 18, totalPoints: 100, modelVersion: 'db-check / prompt en-v1.5.0', analyzedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.examAnalysisExtension.create({
      data: { analysisId: fresh.id, agentType: 'commentary', result: migrated as never, lastRunAt: new Date() },
    });

    g.open();
    const oldRes = await oldRun;
    assert.equal(oldRes.code, 'superseded', '삭제된 옛 분석의 실행은 저장되지 않는다');
    assert.equal(await prisma.examAnalysisExtension.count({ where: { analysisId: A.analysisId } }), 0);

    const movedDoc = readEnglishCommentary((await extensionResult(fresh.id))?.result);
    assert.ok(movedDoc, '이관 문서는 새 분석에서도 유효');
    assert.equal(movedDoc!.migratedFrom?.analysisId, prev!.id);
    assert.equal(isEnglishCommentaryStale(movedDoc!, await currentSignature(fresh.id)), true, '새 분석에서는 이전 근거');

    const regen = fakeText(() => reportTextFor(fresh.id));
    const res = await runEnglishCommentary({ analysisId: fresh.id, store, generateText: regen });
    assert.equal(res.code, 'completed', '이전 근거 문서는 재생성으로 교체된다');
    const newDoc = readEnglishCommentary((await extensionResult(fresh.id))?.result)!;
    assert.equal(newDoc.migratedFrom, null);
    assert.equal(isEnglishCommentaryStale(newDoc, await currentSignature(fresh.id)), false);
    pass('재분석 이관 — 옛 실행 저장 안 됨, 이관 문서는 이전 근거, 재생성으로 교체');
  }
}

async function cleanup() {
  // 이 스크립트가 만든 id 만 지운다 (ExamPaper → Cascade 로 분석·확장 행)
  if (created.paperIds.length) await prisma.examPaper.deleteMany({ where: { id: { in: created.paperIds } } });
  if (created.userId) await prisma.user.deleteMany({ where: { id: created.userId } });
  if (created.tenantId) await prisma.tenant.deleteMany({ where: { id: created.tenantId } });
  const left = await Promise.all([
    created.paperIds.length ? prisma.examPaper.count({ where: { id: { in: created.paperIds } } }) : 0,
    created.userId ? prisma.user.count({ where: { id: created.userId } }) : 0,
    created.tenantId ? prisma.tenant.count({ where: { id: created.tenantId } }) : 0,
  ]);
  console.log(`정리: 임시 시험지 ${created.paperIds.length}건·교사 1·지점 1 삭제, 잔존 ${left.reduce((s, n) => s + n, 0)}건`);
}

main()
  .then(() => console.log(`\n${passed}/5 통과`))
  .catch((e) => {
    console.error('FAIL', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await cleanup(); } catch (e) { console.error('정리 실패 — 태그로 수동 확인 필요:', TAG, e instanceof Error ? e.message : e); process.exitCode = 1; }
    await prisma.$disconnect();
  });
