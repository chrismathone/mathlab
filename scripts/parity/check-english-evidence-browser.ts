/** 로컬 실행 중인 앱에서 실제 UI를 검증. API만 메모리 fixture로 대체하여 DB·AI는 호출하지 않는다. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { loadEnvConfig } from '@next/env';
import { readEnglishQuestionAnalysis } from '../../src/lib/exam-analysis/english/question-evidence';
import { englishQuestionAnalysisSchema, validateEnglishSubquestionPoints } from '../../src/lib/exam-analysis/english/question-evidence-schema';

async function main() {
  loadEnvConfig(process.cwd());
  const base = process.env.MATHLAB_QA_BASE_URL || 'http://127.0.0.1:3100';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '로컬 앱에서만 실행');
  assert(process.env.NEXTAUTH_SECRET, '로컬 인증 설정 필요');
  const user = { id: 'english-evidence-qa', name: '검증 교사', username: 'qa-local', role: 'TEACHER', grade: null, tenantId: 'qa-local' };
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET, token: { ...user, sub: user.id }, maxAge: 3600 });
  const question = {
    question_number: '서술형1', question_format: 'essay', difficulty: '3', difficulty_reason: '수일치와 조건 적용',
    question_type: 'writing', ability_domain: 'expression', points: 10, topic: '중2 영어 > 문법 > to부정사',
    ai_comment: '조건을 지켜 문장을 만드는 문제입니다. 수일치와 어순을 함께 확인해야 합니다.',
    confidence: 0.95, confidence_reason: '문항 내용 명확', is_correct: null, student_answer: null, earned_points: null, error_type: null,
    english_analysis: readEnglishQuestionAnalysis(null),
  };
  const paper = {
    id: 'qa-english-evidence', title: '영어 근거 기록 검증', subject: 'ENGLISH', grade: '중2', category: null,
    examType: 'blank', examScope: { examYear: 2026, examSemester: 1, examCategory: 'MIDTERM', topics: [] },
    examStats: null, status: 'COMPLETED', analysisStep: 4, schoolName: '검증중학교', schoolId: null, school: null,
    errorMessage: null, extractedToBankAt: null, createdAt: '2026-10-02T00:00:00Z', teacher: { id: user.id, name: user.name }, student: null,
    analyses: [{ id: 'qa-analysis', questions: [question], totalQuestions: 1, totalPoints: 10, earnedPoints: null,
      modelVersion: 'AI / prompt en-v1.5.0', analyzedAt: '2026-10-02T00:00:00Z',
      summary: { difficulty_distribution: { '3': 1 }, type_distribution: { writing: 1 }, average_difficulty: '3', dominant_type: 'writing',
        completeness: { status: 'ok', declaredQuestions: 1, declaredPoints: 10, emittedQuestions: 1, pointsSum: 10, pointsShortfall: 0, filledQuestions: 0, retried: false, reason: '' } },
      extensions: [{ id: 'qa-study', agentType: 'english-study', createdAt: '2026-10-02T00:00:00Z', errorMessage: null,
        result: { source: 'exam', version: 'es-v1.1.0', vocab: ['book', 'read', 'learn', 'study', 'write'].map(word => ({ word, meaning: '학습', count: 1, trap: false })), structures: [] } }],
    }],
  };
  const browser = await chromium.launch({ headless: true, channel: process.env.MATHLAB_QA_BROWSER || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'next-auth.session-token', value: token, url: base }]);
    let patches = 0;
    let reads = 0;
    const errors: string[] = [];
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const respond = (body: unknown, status = 200) => route.fulfill({ status, json: body });
      if (path === '/api/auth/session') return respond({ user, expires: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/billing') return respond({ data: { plan: 'pro', status: 'active', usage: { used: 0, limit: 50, resetAt: null, poolBalance: 0 }, features: { commentary: true, nearby: true } } });
      if (path.includes('/questions/') && route.request().method() === 'PATCH') {
        patches++;
        const body = route.request().postDataJSON();
        const parsed = englishQuestionAnalysisSchema.safeParse(body.english_analysis);
        if (!parsed.success) return respond({ error: { code: 'BAD_REQUEST', message: parsed.error.issues[0].message } }, 400);
        const issue = validateEnglishSubquestionPoints(parsed.data.subquestions, question.points);
        if (issue) return respond({ error: { code: 'BAD_REQUEST', message: issue } }, 400);
        question.english_analysis = parsed.data;
        return respond({ data: { question } });
      }
      if (path === '/api/exam-analysis') return respond({ data: [paper], meta: { page: 1, limit: 20, total: 1 } });
      if (path === `/api/exam-analysis/${paper.id}`) { reads++; return respond({ data: paper }); }
      return respond({ data: [] });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/exam-analysis`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByText(paper.title, { exact: true }).first().click();
    const panel = page.getByRole('region', { name: '영어 문항 근거 분석' });
    await expect(panel).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('평균 변별력 지수:', { exact: false })).toHaveCount(0);
    await panel.getByRole('button', { name: '확인·수정' }).click();
    const editor = page.getByRole('form', { name: '서술형1번 문항 근거 수정' });
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.getByLabel('주 출처', { exact: true }).selectOption('textbook');
    await editor.getByLabel('교재·자료명', { exact: true }).fill('검증용 English Book');
    await editor.getByLabel('출처 확인 상태', { exact: true }).selectOption('teacher_verified');
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('확인 근거');
    await editor.getByLabel('출처 확인 근거', { exact: true }).fill('교과서 3과 원문 대조');
    await editor.getByLabel('세부 유형', { exact: true }).selectOption('conditional_writing');
    await editor.getByLabel('요구 사고', { exact: true }).selectOption('produce');
    await editor.getByLabel('확인할 지식·기술', { exact: true }).fill('수일치\n주어 찾기');
    await editor.getByLabel('서술형 조건', { exact: true }).fill('주어진 단어 모두 사용\n어형 변경 허용');
    await editor.getByLabel('다음 학습 과제', { exact: true }).fill('주어를 바꾸어 수일치 문장 5개 쓰기');
    await editor.getByRole('button', { name: '소문항 추가' }).click();
    await editor.getByLabel('소문항 1 배점', { exact: true }).fill('10');
    await editor.getByLabel('실제 응답 통계 기록', { exact: true }).check();
    await editor.getByLabel('응답 인원', { exact: true }).fill('20');
    await editor.getByLabel('오답 인원', { exact: true }).fill('5');
    await editor.getByLabel('응답 집단', { exact: true }).fill('검증 A반');
    await editor.getByLabel('응답 자료 출처', { exact: true }).fill('교사 채점표');
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(panel.getByText('주어를 바꾸어 수일치 문장 5개 쓰기', { exact: true })).toBeVisible();
    assert.equal(question.english_analysis.source.title, '검증용 English Book');
    assert.equal(question.english_analysis.observation?.incorrect, 5);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(paper.title, { exact: true }).first().click();
    await expect(panel.getByText('주어를 바꾸어 수일치 문장 5개 쓰기', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '학습 대책', exact: true }).click();
    await expect(page.getByText('문항별 다음 학습', { exact: true })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: '주어를 바꾸어 수일치 문장 5개 쓰기' })).toBeVisible();
    await page.getByRole('button', { name: '기본 분석', exact: true }).click();
    await panel.getByText('분석 근거·조건 보기', { exact: true }).click();
    await expect(panel.getByText('실제 응답: 검증 A반', { exact: false })).toBeVisible();
    await mkdir('test-results/english-evidence', { recursive: true });
    await panel.screenshot({ path: 'test-results/english-evidence/desktop.png' });
    await page.setViewportSize({ width: 1024, height: 844 });
    await panel.getByRole('button', { name: '확인·수정' }).click();
    await expect(editor).toBeVisible();
    await editor.screenshot({ path: 'test-results/english-evidence/narrow-editor.png' });
    await editor.getByRole('button', { name: '저장', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/english-evidence/narrow-editor-bottom.png' });
    await editor.getByRole('button', { name: '취소' }).click();
    assert.equal(patches, 2); assert(reads >= 2); assert.deepEqual(errors, []);
    const settledReads = reads;
    await page.waitForTimeout(800);
    assert.equal(reads, settledReads, '유휴 상태에서 재조회 루프 없음');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: '화면이 너무 좁습니다' })).toBeVisible();
    console.log('PASS 실제 화면: 근거 검증 오류 → 교정 저장 → 집계 반영 → 새로고침 → 최소 지원 폭 편집. API는 모의 응답이며 DB·AI 호출 없음.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
