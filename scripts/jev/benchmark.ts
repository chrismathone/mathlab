/**
 * Offline: npx tsx scripts/jev/benchmark.ts
 * Live:    npx tsx scripts/jev/benchmark.ts --live
 * Extended: add --challenge for 24 harder synthetic + 18 anonymized demo-consistency cases.
 * Add --holdout (48 cases) or --confirmation (32 cases); choose only one suite.
 * Add --v2 for the multi-signal experiment or --v3 for the revised single-Choice rubric.
 * v1 remains the default so old baseline commands are reproducible.
 * Sends only these fixtures to the official TypeSafe endpoint.
 * No production DB access, application writes or secret values in reports/logs.
 */
import { loadEnvConfig } from '@next/env';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { checkAntiPatterns } from '../../src/lib/exam-analysis/article-anti-patterns';
import { CASES, RUBRICS, type Language, type Task } from './fixtures';
import { CHALLENGE_CASES } from './challenge-fixtures';
import { HOLDOUT_CASES } from './holdout-fixtures';
import { CONFIRMATION_CASES } from './confirmation-fixtures';
import { ACCEPTANCE_POLICY, groundingPolicy, questionsFor, readSignals, type HarnessVersion, type Signals } from './harness';

const MODEL = 'jev-1.13.0';
const INPUT_USD_PER_MILLION = 0.042; // Official models page checked 2026-10-02.
const LANGUAGES: Language[] = ['ko', 'en'];
const REPEATS = 2;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
const THRESHOLD = 0.9; // Predeclared exploration threshold, NOT production calibrated.
const MAX_REQUESTS = 300;
const TASKS = Object.keys(RUBRICS) as Task[];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type ChoiceAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
interface Measurement {
  id: string; task: Task; language: Language; repeat: number; expected: string;
  correct: boolean | null; answer?: ChoiceAnswer; model?: string; latencyMs: number;
  inputTokens?: number; outputTokens?: number; status?: number; error?: string;
  signals?: Signals; policy?: 'accept' | 'review'; policyError?: string;
}

function validateAnswer(raw: unknown, keys: string[]): ChoiceAnswer {
  assert(raw && typeof raw === 'object');
  const value = raw as Record<string, unknown>;
  assert.equal(value.type, 'choice');
  assert(typeof value.choice === 'string' && keys.includes(value.choice));
  assert(typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1);
  assert(value.probabilities && typeof value.probabilities === 'object' && !Array.isArray(value.probabilities));
  const probabilities = value.probabilities as Record<string, unknown>;
  assert.deepEqual(Object.keys(probabilities).sort(), [...keys].sort());
  for (const p of Object.values(probabilities)) assert(typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1);
  const values = Object.values(probabilities) as number[];
  assert(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 0.03);
  assert(Number(probabilities[value.choice]) + 0.02 >= Math.max(...values));
  return value as unknown as ChoiceAnswer;
}

function percentile(values: number[], p: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}

function summarize(rows: Measurement[]) {
  const valid = rows.filter((r) => r.answer);
  const confident = valid.filter((r) => r.answer!.confidence >= THRESHOLD);
  const claims = valid.filter((r) => r.task === 'grounding');
  const acceptedClaims = claims.filter((r) => r.answer!.choice === 'supported' && r.answer!.confidence >= THRESHOLD);
  const policyRows = claims.filter((r) => r.policy);
  const policyAccepted = policyRows.filter((r) => r.policy === 'accept');
  return {
    attempts: rows.length, valid: valid.length, errors: rows.length - valid.length,
    correct: valid.filter((r) => r.correct).length,
    accuracy: valid.length ? valid.filter((r) => r.correct).length / valid.length : null,
    confident: confident.length, confidentWrong: confident.filter((r) => !r.correct).length,
    highConfidenceAcceptance: { threshold: THRESHOLD, acceptedClaims: acceptedClaims.length, unsupportedAccepted: acceptedClaims.filter((r) => r.expected !== 'supported').length },
    harnessPolicy: policyRows.length ? {
      ...ACCEPTANCE_POLICY, evaluated: policyRows.length, accepted: policyAccepted.length,
      incorrectAccepted: policyAccepted.filter((r) => r.expected !== 'supported').length,
      correctClaimsSentToReview: policyRows.filter((r) => r.expected === 'supported' && r.policy === 'review').length,
      invalidSignals: policyRows.filter((r) => r.policyError).length,
    } : null,
    latencyMs: { p50: percentile(rows.map((r) => r.latencyMs), 0.5), p95: percentile(rows.map((r) => r.latencyMs), 0.95) },
    inputTokens: rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
    estimatedUsd: rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0) * INPUT_USD_PER_MILLION / 1_000_000,
  };
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every((arg) => ['--live', '--challenge', '--holdout', '--confirmation', '--v2', '--v3'].includes(arg)), 'Unknown benchmark argument');
  assert(['--challenge', '--holdout', '--confirmation'].filter((arg) => args.includes(arg)).length <= 1, 'Choose only one suite');
  assert(!(args.includes('--v2') && args.includes('--v3')), 'Choose one harness version');
  const suite = args.includes('--confirmation') ? 'confirmation' : args.includes('--holdout') ? 'holdout' : args.includes('--challenge') ? 'challenge' : 'synthetic';
  const version: HarnessVersion = args.includes('--v3') ? 'v3' : args.includes('--v2') ? 'v2' : 'v1';
  const cases = suite === 'confirmation' ? CONFIRMATION_CASES : suite === 'holdout' ? HOLDOUT_CASES : suite === 'challenge' ? CHALLENGE_CASES : CASES;
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.equal(cases.length, suite === 'confirmation' ? 32 : suite === 'holdout' ? 48 : suite === 'challenge' ? 42 : 64);
  for (const test of cases) {
    assert(Object.hasOwn(RUBRICS[test.task].ko, test.expected), test.id);
    assert.deepEqual(Object.keys(RUBRICS[test.task].ko).sort(), Object.keys(RUBRICS[test.task].en).sort());
    assert(!Object.hasOwn(test.state, 'expected'));
    for (const language of LANGUAGES) assert(JSON.stringify({ state: test.state, questions: questionsFor(test, language, version) }).length < 12_000);
  }
  const fixtureHash = digest(JSON.stringify(cases));
  const questionHash = digest(JSON.stringify(cases.flatMap((c) => LANGUAGES.map((l) => questionsFor(c, l, version)))));
  const scriptHash = digest(readFileSync(join(process.cwd(), 'scripts/jev/benchmark.ts'), 'utf8'));
  const grounding = cases.filter((c) => c.task === 'grounding');
  const ruleBaseline = grounding.map((c) => ({
    id: c.id, expected: c.expected,
    warnings: checkAntiPatterns(String(c.state.claim)).map((w) => w.type),
  }));
  // The existing rule is a style warning filter, not a semantic grounding classifier.
  const rules = {
    purpose: 'Current checkAntiPatterns warning coverage on the same claims; not an equivalent semantic classifier.',
    flagged: ruleBaseline.filter((r) => r.warnings.length).length,
    unsupportedTotal: ruleBaseline.filter((r) => r.expected !== 'supported').length,
    unsupportedFlagged: ruleBaseline.filter((r) => r.expected !== 'supported' && r.warnings.length).length,
    supportedFlagged: ruleBaseline.filter((r) => r.expected === 'supported' && r.warnings.length).length,
    cases: ruleBaseline,
  };
  const count = cases.length * LANGUAGES.length * REPEATS;
  assert(count <= MAX_REQUESTS);
  const metadata = { suite, version, model: MODEL, fixtureHash, questionHash, scriptHash, cases: cases.length, repeats: REPEATS, languages: LANGUAGES, plannedRequests: count, concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS, threshold: THRESHOLD, inputUsdPerMillion: INPUT_USD_PER_MILLION };
  console.log(JSON.stringify({ mode: args.includes('--live') ? 'live' : 'offline', ...metadata, rules: { ...rules, cases: undefined } }));
  if (!args.includes('--live')) { console.log(`PASS offline: ${cases.length} labels/rubrics validated; no API request.`); return; }

  loadEnvConfig(process.cwd());
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
  const jobs = LANGUAGES.flatMap((language) => Array.from({ length: REPEATS }, (_, repeat) =>
    cases.map((test) => ({ test, language, repeat: repeat + 1 })))).flat();
  // Deterministic shuffle spreads task/language/repeat across time and warm connections.
  jobs.sort((a, b) => digest(`${a.test.id}:${a.language}:${a.repeat}`).localeCompare(digest(`${b.test.id}:${b.language}:${b.repeat}`)));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(process.cwd(), 'test-results', 'jev', runId);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'inputs.json'), JSON.stringify({ metadata, cases, questions: Object.fromEntries(TASKS.filter((task) => cases.some((c) => c.task === task)).map((task) => [task, LANGUAGES.map((language) => ({ language, questions: questionsFor(cases.find((c) => c.task === task)!, language, version) }))])) }, null, 2));
  const results: Measurement[] = [];
  let cursor = 0;
  let stop = false;
  let completed = 0;
  const startedAt = Date.now();
  async function worker() {
    while (!stop && cursor < jobs.length) {
      const { test, language, repeat } = jobs[cursor++];
      const start = performance.now();
      const row: Measurement = { id: test.id, task: test.task, language, repeat, expected: test.expected, correct: null, latencyMs: 0 };
      try {
        const response = await fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, state: test.state, questions: questionsFor(test, language, version) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        row.status = response.status;
        if (!response.ok) {
          row.error = `HTTP_${response.status}`; // Never log server error bodies or request headers.
          // Do not spend more requests after authentication, quota or service errors.
          stop = true;
        } else {
          const raw: unknown = await response.json();
          assert(raw && typeof raw === 'object' && !Array.isArray(raw));
          const body = raw as Record<string, unknown>;
          if (body.model !== MODEL) {
            row.error = 'MODEL_MISMATCH';
            stop = true;
          }
          try {
            assert(body.usage && typeof body.usage === 'object' && !Array.isArray(body.usage));
            const usage = body.usage as Record<string, unknown>;
            for (const name of ['input_tokens', 'output_tokens']) {
              assert(typeof usage[name] === 'number' && Number.isSafeInteger(usage[name]) && usage[name] >= 0);
            }
            row.inputTokens = usage.input_tokens as number;
            row.outputTokens = usage.output_tokens as number;
            if (!row.error) {
              row.model = MODEL;
              row.answer = validateAnswer((body.answers as Record<string, unknown> | undefined)?.verdict, Object.keys(RUBRICS[test.task][language]));
              row.correct = row.answer.choice === test.expected;
              if (version === 'v2' && test.task === 'grounding') {
                try { row.signals = readSignals(body.answers); } catch { row.policyError = 'INVALID_SIGNALS'; }
                row.policy = groundingPolicy(row.answer.choice, row.answer.confidence, row.signals);
              }
            }
          } catch { row.error ??= 'INVALID_ANSWER_OR_USAGE'; }
        }
      } catch { row.error = 'NETWORK_TIMEOUT_OR_INVALID_JSON'; }
      row.latencyMs = Math.round(performance.now() - start);
      results.push(row);
      completed += 1;
      if (completed % 32 === 0) console.log(`Progress ${completed}/${jobs.length}; ${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  results.sort((a, b) => a.id.localeCompare(b.id) || a.language.localeCompare(b.language) || a.repeat - b.repeat);
  const repeatChanges = cases.flatMap((test) => LANGUAGES.flatMap((language) => {
    const rows = results.filter((r) => r.id === test.id && r.language === language && r.answer);
    return rows.length === REPEATS && new Set(rows.map((r) => r.answer!.choice)).size > 1 ? [{ id: test.id, language, choices: rows.map((r) => r.answer!.choice) }] : [];
  }));
  const report = {
    metadata: { ...metadata, runId, elapsedMs: Date.now() - startedAt, completed: results.length === jobs.length },
    limitations: [
      `${cases.length} author-labelled pilot cases, not teacher-adjudicated production exams.`,
      'Demo cases measure consistency with saved analysis, not original PDF correctness.',
      'v2 used synthetic/challenge failures for development. The 48-case holdout was then inspected to develop v3.',
      'The 32-case confirmation suite was frozen before either v1/v3 confirmation run; it is grounding-only.',
      'Repeated calls are not independent examples. Sequential version runs do not isolate all service variation.',
      'Existing regex warnings measure prose style, not semantic-classification accuracy.',
      'Confidence and Noul thresholds are predeclared but uncalibrated; confidence is not an observed correctness rate.',
      'Policy coverage and incorrect acceptance must be reported together. Review is not a correct verdict.',
      'Cost excludes preliminary connectivity and existing OCR/generation costs; missing usage makes cost incomplete.',
    ],
    overall: summarize(results),
    byLanguage: Object.fromEntries(LANGUAGES.map((language) => [language, summarize(results.filter((r) => r.language === language))])),
    byTask: Object.fromEntries(TASKS.map((task) => [task, Object.fromEntries(LANGUAGES.map((language) => [language, summarize(results.filter((r) => r.task === task && r.language === language))]))])),
    repeatChanges, rules, results,
  };
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: join(outputDir, 'report.json'), ...report.overall, repeatChanges, byLanguage: report.byLanguage, failures: results.filter((r) => r.correct === false || r.error).map((r) => ({ id: r.id, language: r.language, repeat: r.repeat, expected: r.expected, actual: r.answer?.choice, confidence: r.answer?.confidence, error: r.error })) }, null, 2));
  if (!report.metadata.completed || report.overall.errors) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Only local assertions/config failures reach this handler; no raw network error logging.
  console.error(error instanceof Error && /TYPESAFE_API_KEY|Only --live/.test(error.message) ? error.message : 'Benchmark setup failed; check fixtures and local file access.');
  process.exitCode = 1;
});
