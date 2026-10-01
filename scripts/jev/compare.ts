/** Compare matched baseline/candidate reports. Add --v3 to compare v1/v3 instead of v1/v2.
 * No API calls; reports actual verdicts and review coverage separately.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

interface Row {
  id: string; task: string; language: string; repeat: number; expected: string;
  correct: boolean | null; latencyMs: number; inputTokens?: number;
  answer?: { choice: string; confidence: number };
  policy?: 'accept' | 'review'; policyError?: string;
}
interface Run {
  metadata: { runId: string; suite?: string; version?: string; model: string; threshold: number; cases: number; fixtureHash: string; completed: boolean; inputUsdPerMillion: number };
  results: Row[];
}
const args = process.argv.slice(2);
assert(args.every((arg) => !arg.startsWith('--') || arg === '--v3'), 'Unknown comparison flag');
const candidateVersion = args.includes('--v3') ? 'v3' : 'v2';
const paths = args.filter((arg) => arg !== '--v3').map((p) => resolve(p));
assert(paths.length > 0, 'Supply matching baseline/candidate report paths');
const runs = paths.map((path) => ({ path, ...JSON.parse(readFileSync(path, 'utf8')) as Run }));
const suites = [...new Set(runs.map((r) => r.metadata.suite ?? 'synthetic'))];
const key = (r: Row) => `${r.id}:${r.language}:${r.repeat}`;
for (const run of runs) {
  assert.equal(new Set(run.results.map(key)).size, run.results.length, 'Duplicate case/language/repeat');
  for (const row of run.results) {
    assert.equal(row.correct, row.answer ? row.answer.choice === row.expected : null, 'Stored verdict disagrees with expected label');
  }
}
const percentile = (rows: Row[], q: number) => [...rows].map((r) => r.latencyMs).sort((a, b) => a - b)[Math.ceil(rows.length * q) - 1];
const summarize = (run: Run, version: string) => {
  const claims = run.results.filter((r) => r.task === 'grounding');
  const accepted = claims.filter((r) => version === 'v2' ? r.policy === 'accept' : r.answer?.choice === 'supported' && r.answer.confidence >= .9);
  return {
    calls: run.results.length, correct: run.results.filter((r) => r.correct).length,
    errors: run.results.filter((r) => !r.answer).length,
    primaryVerdictAccuracy: run.results.filter((r) => r.correct).length / run.results.length,
    confidentWrong: run.results.filter((r) => r.answer && r.answer.confidence >= .9 && !r.correct).length,
    supportedClaims: claims.filter((r) => r.expected === 'supported').length,
    acceptedClaims: accepted.length,
    incorrectAccepted: accepted.filter((r) => r.expected !== 'supported').length,
    correctClaimsSentToReview: claims.filter((r) => r.expected === 'supported' && !accepted.includes(r)).length,
    invalidSignals: run.results.filter((r) => r.policyError).length,
    p50Ms: percentile(run.results, .5), p95Ms: percentile(run.results, .95),
    inputTokens: run.results.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    estimatedUsd: run.results.reduce((s, r) => s + (r.inputTokens ?? 0), 0) * run.metadata.inputUsdPerMillion / 1_000_000,
    failures: run.results.filter((r) => !r.correct).map((r) => ({ id: r.id, language: r.language, repeat: r.repeat, expected: r.expected, actual: r.answer?.choice, confidence: r.answer?.confidence, policy: r.policy })),
  };
};
const comparison = suites.map((suite) => {
  const pair = runs.filter((r) => (r.metadata.suite ?? 'synthetic') === suite);
  assert.equal(pair.length, 2, `Need one v1 and one ${candidateVersion} for ${suite}`);
  const v1 = pair.find((r) => (r.metadata.version ?? 'v1') === 'v1')!;
  const candidate = pair.find((r) => r.metadata.version === candidateVersion)!;
  assert(v1 && candidate && v1.metadata.completed && candidate.metadata.completed);
  assert.equal(v1.metadata.model, candidate.metadata.model, 'Different models');
  assert.equal(v1.metadata.cases, candidate.metadata.cases, 'Different case counts');
  assert.equal(v1.metadata.threshold, .9, 'Unexpected baseline threshold');
  assert.equal(candidate.metadata.threshold, .9, 'Unexpected candidate threshold');
  assert.equal(v1.metadata.fixtureHash, candidate.metadata.fixtureHash, 'Input/label drift between versions');
  assert.deepEqual(v1.results.map(key).sort(), candidate.results.map(key).sort(), 'Mismatched cases');
  const improved: string[] = [], regressed: string[] = [];
  for (const before of v1.results) {
    const after = candidate.results.find((r) => key(r) === key(before))!;
    assert.equal(before.expected, after.expected, 'Expected label changed');
    if (!before.correct && after.correct) improved.push(key(before));
    if (before.correct && !after.correct) regressed.push(key(before));
  }
  return { suite, cases: v1.metadata.cases, fixtureHash: v1.metadata.fixtureHash, candidateVersion, baseline: summarize(v1, 'v1'), candidate: summarize(candidate, candidateVersion), improved, regressed, paths: [v1.path, candidate.path] };
});
const text = [
  `MathLab — Jev 하네스 v1/${candidateVersion} 비교 (2026-10-02 KST)`,
  '',
  ...(candidateVersion === 'v2' ? [
    '변경: 명시적 사실/직접적 의미상 귀결/관측 결과를 구분하고 JSON 필드와 유도 지시 처리 기준을 명시.',
    'v2 근거 검사는 Choice 판정 외에 전체 근거 충족과 명시적 충돌을 각각 Noul로 질문한다.',
    '승인 후보 기준: supported + confidence≥0.9 + support≥0.95 + conflict≤0.05. 응답 누락/불일치는 검토 대상.',
  ] : [
    '변경: 같은 대상·시험·시기·집단의 반대 사실과 자료 부재를 선택 기준에서 명확히 구분한다.',
    'v3는 Choice 한 개로 판정한다. 추가 Noul 질문은 새 사례 정확도를 높이지 못해 채택하지 않았다.',
    'v1/v3 공통 승인 후보 기준: supported + confidence≥0.9. 기준 미달은 검토 대상으로 남긴다.',
  ]),
  '아래 정확도는 검토로 보낸 오답도 포함한 원래 Choice 판정 정확도다. 검토율로 정확도를 부풀리지 않았다.',
  '각 사례는 한국어/영어 지시문 × 2회 반복. 호출 수와 독립 사례 수를 구분해야 한다.',
  '',
  ...comparison.flatMap((c) => [
    `${c.suite}: ${c.cases}개 사례`,
    `- v1 판정: ${c.baseline.correct}/${c.baseline.calls} (${(c.baseline.primaryVerdictAccuracy * 100).toFixed(2)}%)`,
    `- ${candidateVersion} 판정: ${c.candidate.correct}/${c.candidate.calls} (${(c.candidate.primaryVerdictAccuracy * 100).toFixed(2)}%)`,
    `- 개선 ${c.improved.length}회 / 회귀 ${c.regressed.length}회 / 확신도≥0.9 오분류 v1 ${c.baseline.confidentWrong}, ${candidateVersion} ${c.candidate.confidentWrong}`,
    `- 근거 있는 주장 ${c.candidate.supportedClaims}회 중 승인 후보: v1 ${c.baseline.acceptedClaims}, ${candidateVersion} ${c.candidate.acceptedClaims}; 잘못 승인: v1 ${c.baseline.incorrectAccepted}, ${candidateVersion} ${c.candidate.incorrectAccepted}`,
    `- ${candidateVersion} 정상 주장 검토 회송: ${c.candidate.correctClaimsSentToReview}회; 검증 신호 오류: ${c.candidate.invalidSignals}회`,
    `- 지연 p50/p95: v1 ${c.baseline.p50Ms}/${c.baseline.p95Ms}ms, ${candidateVersion} ${c.candidate.p50Ms}/${c.candidate.p95Ms}ms`,
    `- 비용: v1 $${c.baseline.estimatedUsd.toFixed(6)}, ${candidateVersion} $${c.candidate.estimatedUsd.toFixed(6)}`,
    `- ${candidateVersion} 오분류: ${JSON.stringify(c.candidate.failures)}`,
    '',
  ]),
  '평가 제약:',
  '- synthetic/challenge는 개발용 자료다. holdout 48개도 v2 평가 후 v3 설계에 사용했으므로 v3의 미사용 평가 자료가 아니다.',
  '- confirmation 32개는 v3 실행 전에 고정한 새 합성 사례다. 모든 세트의 기대값은 테스트 작성자가 부여했으며 독립 교사 검수는 아직 없다.',
  '- 공개 데모는 저장 분석 일관성 평가이며 원본 PDF의 정확도 평가가 아니다.',
  '- 모든 임계값은 사전 지정한 파일럿 기준이다. 다른 문항·학교·언어의 운영 보정값이 아니다.',
  '- API 가격은 입력 100만 토큰당 $0.042, 출력 무료로 추산. 기존 OCR/생성 비용은 제외.',
  '- 독립 판단 결과를 평균내거나 확률 합이 1이라고 가정하지 않는다. 더 많은 질문 자체가 더 높은 정확도를 보장하지 않는다.',
  '',
  '원시 결과:', ...paths,
].join('\n');
writeFileSync(join(process.cwd(), `test-results/jev/comparison-${candidateVersion}.json`), JSON.stringify(comparison, null, 2));
writeFileSync(join(process.cwd(), `test-results/jev/comparison-${candidateVersion}.txt`), text);
console.log(text);
