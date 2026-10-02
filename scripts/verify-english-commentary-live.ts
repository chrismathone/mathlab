/**
 * 영어 총평 fixture 사전검증과, 코디네이터 실행용 실제 모델 평가.
 *
 *   npx tsx scripts/verify-english-commentary-live.ts
 *   npx tsx scripts/verify-english-commentary-live.ts --live
 *   npx tsx scripts/verify-english-commentary-live.ts --live --only=listening-mock,high-conditional-writing
 *
 * 인자 없이는 모델을 부르지 않는다. 환경 변수만으로는 호출되지 않는다.
 * --live 는 generateEnglishCommentary(ctx) 만 사용한다. 게이트웨이를 직접 부르지 않는다.
 * 키와 DB 접속 문자열은 출력·저장 전에 지운다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { checkEnglishCommentaryReadiness, validateEnglishCommentaryReport } from '../src/lib/exam-analysis/english/commentary';
import type { EnglishCommentaryContext, EnglishCommentaryReport } from '../src/lib/exam-analysis/english/commentary';
import {
  ENGLISH_COMMENTARY_BLOCKED_FIXTURES, ENGLISH_COMMENTARY_GENERATOR, ENGLISH_COMMENTARY_LIVE_DIR,
  ENGLISH_COMMENTARY_LIVE_FIXTURES, ENGLISH_COMMENTARY_REPEATED_FIXTURES, FIVE_AXIS_RUBRIC,
  commentaryContextFor, preflightEnglishCommentaryFixtures,
  type EnglishCommentaryFixture,
} from './fixtures/english-commentary';

interface LiveRecord {
  fixtureId: string;
  title: string;
  note: string;
  runIndex: 1 | 2;
  rich: boolean;
  scopeLabel: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  attempts: number | null;
  repairCount: number | null;
  status: 'completed' | 'failed' | 'blocked';
  calledModel: boolean;
  code: string | null;
  blockReasons: string[];
  validation: { ok: boolean; errors: string[] } | null;
  report: unknown;
  error: string | null;
  reviews: [];
  rubric: typeof FIVE_AXIS_RUBRIC;
  context: EnglishCommentaryContext | null;
}

function scrub(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[secret]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[secret]')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[secret]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[secret]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [secret]')
    .replace(/(api[_-]?key|secret|token|password|authorization|database_url|direct_url)\s*[:=]\s*\S+/gi, '$1=[secret]');
}

function repoRoot(): string {
  return path.resolve(path.dirname(process.argv[1] ?? ''), '..');
}

function recordPath(dir: string, id: string, runIndex: number, blocked: boolean): string {
  if (blocked) return path.join(dir, `${id}.blocked.json`);
  if (runIndex === 2) return path.join(dir, `${id}.repeat.json`);
  return path.join(dir, `${id}.json`);
}

function writeRecord(file: string, record: LiveRecord) {
  fs.writeFileSync(file, scrub(JSON.stringify(record, null, 2)), 'utf8');
}

function baseRecord(fixture: EnglishCommentaryFixture, runIndex: 1 | 2, ctx: EnglishCommentaryContext | null): LiveRecord {
  const now = new Date().toISOString();
  return {
    fixtureId: fixture.id, title: fixture.title, note: fixture.note, runIndex, rich: fixture.rich,
    scopeLabel: ctx?.evidence.scopeLabel ?? '', startedAt: now, finishedAt: now, durationMs: null,
    attempts: null, repairCount: null, status: 'failed', calledModel: false, code: null,
    blockReasons: [], validation: null, report: null, error: null, reviews: [], rubric: FIVE_AXIS_RUBRIC, context: ctx,
  };
}

async function loadGenerator(): Promise<(ctx: EnglishCommentaryContext) => Promise<unknown>> {
  const abs = path.join(repoRoot(), ENGLISH_COMMENTARY_GENERATOR.module);
  if (!fs.existsSync(abs)) throw new Error('영어 총평 생성 모듈이 없습니다');
  const mod = await import(pathToFileURL(abs).href) as Record<string, unknown>;
  const fn = mod[ENGLISH_COMMENTARY_GENERATOR.exportName];
  if (typeof fn !== 'function') throw new Error('영어 총평 생성 함수 export 가 없습니다');
  return (ctx) => fn(ctx) as Promise<unknown>;
}

function applyGeneration(record: LiveRecord, value: unknown, ctx: EnglishCommentaryContext) {
  if (!value || typeof value !== 'object' || !('ok' in value)) {
    record.status = 'failed';
    record.error = '생성 결과 형식이 계약과 다릅니다';
    return;
  }
  const result = value as { ok?: boolean; report?: unknown; repaired?: boolean; attempts?: number; durationMs?: number; code?: string; message?: string; errors?: unknown };
  if (typeof result.durationMs === 'number') record.durationMs = result.durationMs;
  if (typeof result.attempts === 'number') {
    record.attempts = result.attempts;
    record.repairCount = Math.max(0, result.attempts - 1);
  }
  if (result.ok === true) {
    const errors = result.report ? validateEnglishCommentaryReport(ctx, result.report as EnglishCommentaryReport) : ['보고서가 없습니다'];
    record.report = result.report ?? null;
    record.validation = { ok: errors.length === 0, errors };
    record.status = errors.length === 0 ? 'completed' : 'failed';
    record.code = errors.length === 0 ? null : 'invalid';
    record.repairCount = result.repaired === true ? 1 : 0;
    if (errors.length) record.error = '생성 결과가 검증을 통과하지 못했습니다';
    return;
  }
  const errors = Array.isArray(result.errors) ? result.errors.filter((e): e is string => typeof e === 'string') : [];
  record.status = 'failed';
  record.code = typeof result.code === 'string' ? result.code : 'llm_error';
  record.validation = { ok: false, errors };
  record.error = scrub(typeof result.message === 'string' ? result.message : '총평 생성에 실패했습니다').slice(0, 500);
}

async function runLive(only: Set<string> | null) {
  const dir = path.join(repoRoot(), ENGLISH_COMMENTARY_LIVE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  let failed = 0;

  for (const fixture of ENGLISH_COMMENTARY_BLOCKED_FIXTURES) {
    const ctx = commentaryContextFor(fixture);
    const record = baseRecord(fixture, 1, ctx);
    record.blockReasons = checkEnglishCommentaryReadiness(fixture.input).reasons;
    record.status = 'blocked';
    record.calledModel = false;
    record.finishedAt = new Date().toISOString();
    writeRecord(recordPath(dir, fixture.id, 1, true), record);
    console.log(`${fixture.id} blocked before generate (${record.blockReasons.length} reasons)`);
    if (!record.blockReasons.length) failed += 1;
  }

  const generate = await loadGenerator();
  const jobs = [
    ...ENGLISH_COMMENTARY_LIVE_FIXTURES.map((fixture) => ({ fixture, runIndex: 1 as const })),
    ...ENGLISH_COMMENTARY_REPEATED_FIXTURES.map((fixture) => ({ fixture, runIndex: 2 as const })),
  ];
  const selectedJobs = only ? jobs.filter((job) => only.has(job.fixture.id)) : jobs;
  if (only) {
    const known = new Set(jobs.map((job) => job.fixture.id));
    const unknown = [...only].filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`알 수 없는 fixture: ${unknown.join(', ')}`);
  }
  console.log(`이번 실행: ${selectedJobs.length}회`);
  for (const job of selectedJobs) {
    const ctx = commentaryContextFor(job.fixture);
    const record = baseRecord(job.fixture, job.runIndex, ctx);
    const started = Date.now();
    record.startedAt = new Date(started).toISOString();
    record.calledModel = true;
    try {
      applyGeneration(record, await generate(ctx), ctx);
    } catch (e) {
      record.status = 'failed';
      record.code = 'llm_error';
      record.error = scrub(e instanceof Error ? e.message : '총평 생성에 실패했습니다').slice(0, 500);
      record.durationMs = Date.now() - started;
    }
    record.finishedAt = new Date().toISOString();
    if (record.durationMs === null) record.durationMs = Date.now() - started;
    writeRecord(recordPath(dir, job.fixture.id, job.runIndex, false), record);
    console.log(`${job.fixture.id} run ${job.runIndex} ${record.status} ${record.durationMs}ms repairs ${record.repairCount ?? '-'}`);
    if (record.status !== 'completed') failed += 1;
  }
  if (failed) throw new Error(`실제 호출 결과 ${failed}건이 완료되지 않았습니다`);
}

async function main() {
  loadEnvConfig(repoRoot());
  const live = process.argv.includes('--live');
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
  if (only && !only.size) throw new Error('--only에는 fixture ID가 필요합니다');
  const lines = preflightEnglishCommentaryFixtures();
  for (const line of lines) console.log(`PASS ${line}`);
  console.log(`생성 ${ENGLISH_COMMENTARY_LIVE_FIXTURES.length}개, 반복 ${ENGLISH_COMMENTARY_REPEATED_FIXTURES.length}개, 호출 전 차단 ${ENGLISH_COMMENTARY_BLOCKED_FIXTURES.length}개`);
  if (!live) {
    const generator = path.join(repoRoot(), ENGLISH_COMMENTARY_GENERATOR.module);
    console.log(fs.existsSync(generator) ? '생성 모듈은 있다. 이번 실행은 부르지 않았다.' : '생성 모듈이 아직 없다.');
    console.log('실제 모델 호출은 하지 않았습니다.');
    return;
  }
  await runLive(only);
}

main().catch((e) => {
  console.error(scrub(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
