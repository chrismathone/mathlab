/** Aggregate explicit run paths, without any additional API calls.
 * npx tsx scripts/jev/summarize.ts test-results/jev/<run>/report.json ...
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

interface Row {
  id: string; task: string; language: string; repeat: number; expected: string;
  correct: boolean | null; latencyMs: number; inputTokens?: number; outputTokens?: number;
  answer?: { choice: string; confidence: number; probabilities: Record<string, number> };
  error?: string;
}
interface Run {
  metadata: { runId: string; cases: number; suite?: string; version?: string; model: string; threshold: number; completed: boolean; fixtureHash: string; questionHash: string; inputUsdPerMillion: number };
  repeatChanges: unknown[];
  rules: { unsupportedTotal: number; unsupportedFlagged: number; supportedFlagged: number };
  results: Row[];
}
interface InputCase { id: string; task: string; state: Record<string, unknown>; expected: string; tags: string[] }

const paths = process.argv.slice(2).map((p) => resolve(p));
assert(paths.length > 0, 'Provide explicit report.json paths');
const runs = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')) as Run);
assert.equal(new Set(runs.map((r) => r.metadata.runId)).size, runs.length, 'Duplicate run');
assert.equal(new Set(runs.map((r) => r.metadata.version ?? 'v1')).size, 1, 'Use compare.ts to compare harness versions');
assert.equal(new Set(runs.map((r) => r.metadata.suite ?? 'synthetic')).size, runs.length, 'Do not double-count reruns of one suite');
assert(runs.every((r) => r.metadata.completed && Array.isArray(r.results)));
const casesByRun = paths.map((p) => JSON.parse(readFileSync(join(p, '..', 'inputs.json'), 'utf8')).cases as InputCase[]);
const rows = runs.flatMap((r) => r.results);
const valid = rows.filter((r) => r.answer);
const p = (values: number[], quantile: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1];
const tally = (rs: Row[]) => ({ calls: rs.length, correct: rs.filter((r) => r.correct).length, errors: rs.filter((r) => !r.answer).length });
const tasks = [...new Set(rows.map((r) => r.task))];
const threshold = runs[0].metadata.threshold;
assert(runs.every((r) => r.metadata.threshold === threshold));
const accepted = valid.filter((r) => r.task === 'grounding' && r.answer!.choice === 'supported' && r.answer!.confidence >= threshold);
const failures = runs.flatMap((run, index) => run.results.filter((r) => r.correct === false || r.error).map((r) => ({
  ...r, runId: run.metadata.runId, case: casesByRun[index].find((c) => c.id === r.id),
})));
const summary = {
  version: runs[0].metadata.version ?? 'v1',
  model: [...new Set(runs.map((r) => r.metadata.model))],
  uniqueCases: runs.reduce((s, r) => s + r.metadata.cases, 0),
  caseSources: { synthetic: casesByRun.flat().filter((c) => !c.tags.includes('demo_consistency')).length, demoConsistency: casesByRun.flat().filter((c) => c.tags.includes('demo_consistency')).length },
  ...tally(rows),
  caseLanguagesAllRepeatsCorrect: casesByRun.flat().map((c) => ({ id: c.id, en: rows.filter((r) => r.id === c.id && r.language === 'en').every((r) => r.correct), ko: rows.filter((r) => r.id === c.id && r.language === 'ko').every((r) => r.correct) })),
  byTask: Object.fromEntries(tasks.map((task) => [task, tally(rows.filter((r) => r.task === task))])),
  byLanguage: Object.fromEntries(['ko', 'en'].map((language) => [language, tally(rows.filter((r) => r.language === language))])),
  latencyMs: { p50: p(rows.map((r) => r.latencyMs), .5), p95: p(rows.map((r) => r.latencyMs), .95), max: Math.max(...rows.map((r) => r.latencyMs)) },
  inputTokens: rows.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
  outputTokens: rows.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
  estimatedUsd: runs.reduce((s, r) => s + r.results.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0) * r.metadata.inputUsdPerMillion / 1_000_000, 0),
  threshold,
  confidentCalls: valid.filter((r) => r.answer!.confidence >= threshold).length,
  confidentWrong: valid.filter((r) => r.answer!.confidence >= threshold && !r.correct).length,
  acceptedClaims: accepted.length,
  unsupportedClaimsAccepted: accepted.filter((r) => r.expected !== 'supported').length,
  repeatLabelChanges: runs.reduce((s, r) => s + r.repeatChanges.length, 0),
  currentRegex: {
    unsupportedCases: runs.reduce((s, r) => s + r.rules.unsupportedTotal, 0),
    unsupportedFlagged: runs.reduce((s, r) => s + r.rules.unsupportedFlagged, 0),
    supportedFlagged: runs.reduce((s, r) => s + r.rules.supportedFlagged, 0),
  },
  failures,
  reports: paths,
};
const labels: Record<string, string> = { grounding: '총평 근거 검사', math_type: '수학 유형', english_type: '영어 유형', practice_fit: '학습 과제 적합성', inquiry_type: '문의 분류' };
const text = [
  'MathLab — Jev 실제 호출 파일럿 결과 (2026-10-02 KST)',
  '',
  `모델: ${summary.model.join(', ')}`,
  `하네스: ${summary.version}`,
  `사례: ${summary.uniqueCases}개 (합성 ${summary.caseSources.synthetic}, 익명화 공개 데모 일관성 ${summary.caseSources.demoConsistency})`,
  '각 사례를 한국어/영어 지시문으로 각각 2회 반복. 반복 호출은 독립적인 시험 문항 수가 아니다.',
  `판정 일치: ${summary.correct}/${summary.calls}회 (${(summary.correct / summary.calls * 100).toFixed(2)}%), API/응답 검증 오류 ${summary.errors}회`,
  ...Object.entries(summary.byTask).map(([task, t]) => `- ${labels[task]}: ${t.correct}/${t.calls}`),
  '',
  `지시문 언어: 한국어 ${summary.byLanguage.ko.correct}/${summary.byLanguage.ko.calls}, 영어 ${summary.byLanguage.en.correct}/${summary.byLanguage.en.calls}`,
  `반복 호출 간 최종 선택지 변경: ${summary.repeatLabelChanges}건 (확률과 확신도는 달라질 수 있음)`,
  `요청별 지연: 중앙값 ${summary.latencyMs.p50}ms, 95백분위 ${summary.latencyMs.p95}ms, 최대 ${summary.latencyMs.max}ms (동시 요청 4개)`,
  `토큰: 입력 ${summary.inputTokens}, 출력 ${summary.outputTokens}`,
  `예상 API 비용: $${summary.estimatedUsd.toFixed(6)} (입력 100만 토큰당 $0.042, 출력 무료 가정)`,
  '별도 연결 확인 1회(입력 423토큰)는 위 호출 수/비용에서 제외. 기존 OCR·생성 비용도 제외.',
  '',
  `사전 지정 확신도 기준 ${threshold}: ${summary.confidentCalls}회가 기준 이상, 이 중 오분류 ${summary.confidentWrong}회.`,
  `근거 있음 + 확신도 기준 이상: ${summary.acceptedClaims}회, 이 중 잘못 통과한 주장 ${summary.unsupportedClaimsAccepted}회.`,
  '위 결과는 운영 임계값의 보정이나 무오류 보장을 의미하지 않는다.',
  '',
  '오분류:',
  ...failures.map((r) => `- ${r.id} / ${r.language} / 반복 ${r.repeat}: 기대 ${r.expected}, 실제 ${r.answer?.choice ?? r.error}, 확신도 ${r.answer?.confidence ?? '없음'}`),
  '',
  `기존 checkAntiPatterns는 근거 부족/충돌 사례 ${summary.currentRegex.unsupportedCases}개 중 ${summary.currentRegex.unsupportedFlagged}개에서 문체 경고를 표시했다.`,
  '이 함수는 문체용 정규식 검사이므로 Jev와 동등한 의미분류 정확도로 비교하면 안 된다.',
  '기존 생성 모델과 같은 원본 PDF를 이용한 정확도·비용 대조는 수행하지 않았다.',
  '',
  '해석과 제약:',
  '- 테스트 작성자가 기대값을 부여했다. 교사가 독립 검수한 실제 시험지 정확도가 아니다.',
  '- synthetic/challenge는 개발용 자료다. holdout도 v2 평가 후 v3 설계에 사용했다. 원래 기대값은 수정하지 않았다.',
  '- confirmation은 v3 실행 전에 고정한 근거 판단 전용 32개 사례다. 세트별 비교는 compare.ts 보고서를 참고한다.',
  '- 공개 데모 사례는 저장된 분석과의 일관성을 확인할 뿐, 원본 시험지나 교육학적 해석의 진실성을 증명하지 않는다.',
  '- 명시적 근거가 있는 짧은 사례가 많다. 긴 원문, OCR 오류, 여러 교사 판단 차이는 별도 검증해야 한다.',
  '- 이번 결과는 총평 검토와 분류 제안에 유망하다. 교사 수정값이나 자동 발행 정책에 연결하지 않았다.',
  '- 외부 전송은 합성 데이터와 공개 데모의 숫자·분류 필드로 제한했다. 사용자·학교 식별자와 API 키는 결과에 저장하지 않았다.',
  '',
  '재실행:',
  ...runs.map((run) => `npx tsx scripts/jev/benchmark.ts${run.metadata.suite && run.metadata.suite !== 'synthetic' ? ` --${run.metadata.suite}` : ''}${summary.version !== 'v1' ? ` --${summary.version}` : ''} --live`),
  '',
  '공식 API: https://docs.typesafe.ai/api',
  '공식 가격/모델: https://docs.typesafe.ai/models',
  '',
  '원시 결과:',
  ...paths,
].join('\n');
const output = join(process.cwd(), 'test-results', 'jev');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, `summary-${summary.version}.json`), JSON.stringify(summary, null, 2));
writeFileSync(join(output, `summary-${summary.version}.txt`), text);
console.log(text);
