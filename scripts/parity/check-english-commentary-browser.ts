/** 실제 Next 화면·캡처 검증. API만 메모리 fixture로 대체하며 실제 모델 검증은 별도 runner가 담당한다. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { loadEnvConfig } from '@next/env';
import { readEnglishQuestionAnalysis } from '../../src/lib/exam-analysis/english/question-evidence';
import { buildEnglishCommentaryContext } from '../../src/lib/exam-analysis/english/commentary/context';
import { englishCommentarySignature } from '../../src/lib/exam-analysis/english/commentary/signature';
import { ENGLISH_COMMENTARY_VERSION, readEnglishCommentary, type EnglishCommentaryReport } from '../../src/lib/exam-analysis/english/commentary/schema';
import { DEFAULT_TEMPLATE } from '../../src/lib/exam-analysis/blocks/default-template';

async function main() {
  loadEnvConfig(process.cwd());
  const base = process.env.MATHLAB_QA_BASE_URL || 'http://127.0.0.1:3100';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  assert(process.env.NEXTAUTH_SECRET);
  const user = { id: 'english-commentary-qa', name: '검증 교사', username: 'qa-local', role: 'TEACHER', grade: null, tenantId: 'qa-local' };
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET, token: { ...user, sub: user.id }, maxAge: 3600 });
  const questions = Array.from({ length: 8 }, (_, i) => ({
    question_number: i === 7 ? '서술형1' : i + 1,
    question_format: i === 7 ? 'essay' : 'objective', difficulty: '3', difficulty_reason: '문맥에서 수식 관계와 조건을 함께 판단',
    question_type: i === 7 ? 'writing' : i % 2 ? 'vocabulary' : 'grammar', ability_domain: i === 7 ? 'expression' : 'accuracy',
    points: i === 7 ? 30 : 10, topic: '고1 영어 > 문법 > 관계사',
    ai_comment: '관계절이 꾸미는 대상을 확인하고 주어와 동사의 호응을 판단해야 합니다.',
    confidence: 0.95, confidence_reason: '문항 내용 명확', is_correct: null, student_answer: null, earned_points: null, error_type: null,
    key_vocab: i === 1 ? [{ word: 'contrast', meaning: '대조' }] : [],
    english_analysis: readEnglishQuestionAnalysis({
      subtype: i === 7 ? 'conditional_writing' : i % 2 ? 'contextual_word' : 'grammar_error',
      skills: ['관계절의 수식 대상', '수일치'], thinking: i === 7 ? 'produce' : 'apply',
      distractors: i === 7 ? null : '관계절 안의 명사를 문장 전체의 주어로 오해하지 않도록 확인',
      writing_conditions: i === 7 ? ['주어진 단어 모두 사용', '어형 변화 허용'] : [],
      next_practice: '주절의 주어와 동사를 표시하고 관계절을 묶어 읽기',
    }),
  }));
  const analysis = { id: 'qa-commentary-analysis', questions, totalQuestions: 8, totalPoints: 100, earnedPoints: null,
    modelVersion: 'AI / prompt en-v1.5.0', analyzedAt: '2026-10-02T00:00:00Z',
    summary: { difficulty_distribution: { '3': 8 }, type_distribution: { grammar: 4, vocabulary: 3, writing: 1 }, average_difficulty: '3', dominant_type: 'grammar',
      completeness: { status: 'ok', declaredQuestions: 8, declaredPoints: 100, emittedQuestions: 8, pointsSum: 100, pointsShortfall: 0, filledQuestions: 0, retried: false, reason: '' } },
    extensions: [] as Array<{ id: string; agentType: string; result: unknown; errorMessage: string | null; createdAt: string }>,
  };
  const paper = { id: 'qa-english-commentary', title: '영어 총평 화면 검증용 시험', subject: 'ENGLISH', grade: '고1', category: null,
    examType: 'blank', examScope: { examYear: 2026, examSemester: 1, examCategory: 'MIDTERM', topics: ['관계절과 문맥 어휘'] },
    examStats: null, status: 'COMPLETED', analysisStep: 4, schoolName: '검증용 학교', schoolId: null, school: null,
    errorMessage: null, extractedToBankAt: null, createdAt: '2026-10-02T00:00:00Z', teacher: { id: user.id, name: user.name }, student: null, analyses: [analysis],
  };
  const otherPaper = { ...structuredClone(paper), id: 'qa-english-commentary-other', title: '전환 확인용 다른 영어 시험' };
  const report: EnglishCommentaryReport = {
    headline: '관계절을 읽는 정확성이 답안 완성으로 이어진 시험',
    dek: '문장에서 핵심 주어를 찾는 판단과 조건에 맞게 문장을 만드는 요구가 함께 담겼습니다.',
    overview: '이 시험은 문장의 구조를 정확하게 읽고 어휘의 쓰임을 문맥 안에서 확인하도록 요구합니다. 답을 고를 때의 판단을 문장 작성에서도 활용할 수 있는지 살펴보는 것이 이번 분석의 출발점입니다.',
    features: [
      { title: '가까운 명사보다 문장의 주어를 찾기', body: '관계절 안에 있는 명사가 눈에 먼저 들어오더라도 주절의 동사와 연결되는 주어를 따로 확인해야 합니다. 문장을 덩어리로 나누어 읽는 과정이 선택지를 판단하는 근거가 됩니다.', refs: ['1', '3'] },
      { title: '조건을 확인하며 문장 완성하기', body: '주어진 단어를 모두 쓰면서 문법에 맞는 형태로 바꾸어 문장을 완성하도록 요구합니다. 알고 있는 규칙을 떠올리는 것과 실제 답안에 빠짐없이 적용하는 것을 연결해 연습할 필요가 있습니다.', refs: ['서술형1'] },
    ],
    representatives: [
      { ref: '1', demand: '관계절의 수식 범위를 확인한 뒤 주절의 동사와 호응하는 주어를 찾아야 합니다.', reason: '가까이에 놓인 명사가 주어처럼 보일 수 있으므로 문장의 큰 구조를 먼저 읽어야 합니다.', prep: '관계절을 괄호로 묶고 주절의 주어와 동사를 연결한 뒤 선택지 판단의 이유를 말해 보세요.' },
      { ref: '서술형1', demand: '주어진 단어를 모두 사용하면서 어형을 문장에 맞게 바꾸어 답안을 완성해야 합니다.', reason: '문장의 뜻이 통하더라도 제시 조건을 빠뜨릴 수 있으므로 작성 후 별도 점검이 필요합니다.', prep: '제시 단어에 표시하며 답안을 쓰고 주어와 동사의 호응을 다시 읽어 조건 충족 여부를 확인하세요.' },
    ],
    actions: [{ title: '관계절을 묶고 주절의 뼈대 표시하기', body: '수식하는 부분을 괄호로 묶은 뒤 주절의 주어와 동사를 연결해 읽으세요. 그 근거를 말로 설명하면서 선택지를 판단해 보세요.', check: '관계절을 가려도 주절의 주어와 동사를 찾고 호응 관계를 설명할 수 있는지 확인하세요.', refs: ['1', '3'] }],
    conclusion: '답을 맞혔는지만 확인하기보다 어떤 문장 구조를 근거로 판단했는지 설명하는 연습이 필요합니다. 문장을 직접 쓸 때에도 같은 기준을 적용하고 제시 조건을 다시 점검해 보세요.',
  };
  const makeDocument = () => {
    const context = buildEnglishCommentaryContext({ examPaper: paper, analysis });
    return { kind: 'english-commentary', contract: 1, version: ENGLISH_COMMENTARY_VERSION, inputSignature: englishCommentarySignature(context), generatedAt: new Date().toISOString(), context, report, generation: { repaired: false, durationMs: 10 }, migratedFrom: null };
  };
  let template = { ...DEFAULT_TEMPLATE, themeId: 'brand' };
  let fail = false;
  let generations = 0;
  let uploads = 0;
  let copies = 0;
  let clipboardHtml = '';
  let releaseStudy: (() => void) | null = null;
  let holdCommentary = false;
  let releaseCommentary: (() => void) | null = null;
  let studyCalls = 0;
  const chain: string[] = [];
  const errors: string[] = [];
  const browser = await chromium.launch({ headless: true, channel: process.env.MATHLAB_QA_BROWSER || undefined });
  const out = 'test-results/english-commentary-browser';
  await mkdir(out, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'next-auth.session-token', value: token, url: base }]);
    await context.exposeBinding('qaCaptureClipboard', async (_source, text: string) => { clipboardHtml = text; });
    await context.addInitScript(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items) => {
        const blob = await items[0].getType('text/html');
        await window.qaCaptureClipboard(await blob.text());
      } } });
    })();`);
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const respond = (body: unknown, status = 200) => route.fulfill({ status, json: body });
      if (path === '/api/auth/session') return respond({ user, expires: new Date(Date.now() + 3600000).toISOString() });
      if (path === '/api/billing') return respond({ data: { plan: 'pro', status: 'active', usage: { used: 0, limit: 50, resetAt: null, poolBalance: 0 }, features: { commentary: true, nearby: true } } });
      if (path.endsWith('/template')) {
        if (route.request().method() === 'PUT') template = route.request().postDataJSON().config;
        return respond({ data: { config: template, source: 'analysis' } });
      }
      if (path.endsWith('/analyze-extended')) {
        chain.push('commentary');
        generations++;
        if (holdCommentary) await new Promise<void>(resolve => { releaseCommentary = resolve; });
        await new Promise(resolve => setTimeout(resolve, 120));
        const old = analysis.extensions.find(e => e.agentType === 'commentary');
        if (fail) { if (old) old.errorMessage = '검증 중 생성 실패'; return respond({ data: [{ agentType: 'commentary', status: 'failed', result: null, error: '검증 중 생성 실패' }] }); }
        const result = makeDocument(); assert(readEnglishCommentary(result));
        if (old) { old.result = result; old.errorMessage = null; }
        else analysis.extensions.push({ id: 'qa-commentary-extension', agentType: 'commentary', result, errorMessage: null, createdAt: result.generatedAt });
        return respond({ data: [{ agentType: 'commentary', status: 'completed', result }] });
      }
      if (path.endsWith('/analyze')) {
        chain.push('analyze'); analysis.id += '-new'; analysis.modelVersion = 'AI / prompt en-v1.5.0';
        return respond({ data: { id: analysis.id } });
      }
      if (path.endsWith('/english-study')) {
        chain.push('english-study'); studyCalls++;
        await new Promise<void>(resolve => { releaseStudy = resolve; });
        return respond({ error: { message: '검증용 학습 대책 실패' } }, 500);
      }
      assert(!path.endsWith('/generate-metadata'), '영어는 수학 메타데이터를 요청하지 않음');
      if (path.endsWith('/upload-section-image')) {
        const body = route.request().postDataJSON();
        assert.match(body.dataUrl, /^data:image\/png;base64,/);
        const bytes = Buffer.from(body.dataUrl.split(',')[1], 'base64');
        assert(bytes.length > 500);
        await writeFile(`${out}/capture-${uploads}.png`, bytes); uploads++;
        return respond({ data: { url: `https://qa.invalid/${body.section}.png` } });
      }
      if (path.endsWith('/article-copy')) { copies++; return respond({ data: { ok: true } }); }
      if (path === '/api/exam-analysis') return respond({ data: [{ ...paper, analyses: [{ ...analysis, extensions: analysis.extensions.map(e => ({ ...e, commentaryReady: !!readEnglishCommentary(e.result) && !e.errorMessage })) }] }, otherPaper], meta: { page: 1, limit: 20, total: 2 } });
      if (path === `/api/exam-analysis/${paper.id}`) return respond({ data: paper });
      if (path === `/api/exam-analysis/${otherPaper.id}`) return respond({ data: otherPaper });
      return respond({ data: [] });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
    const open = async () => { await page.goto(`${base}/exam-analysis`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.getByText(paper.title, { exact: true }).first().click(); };
    await open();
    const panel = page.getByRole('region', { name: '영어 총평', exact: true });
    const view = page.getByRole('article', { name: '영어 시험 총평 보고서' });
    const contrast = async () => {
      const pairs = await view.evaluate(el => {
        return Array.from(el.querySelectorAll<HTMLElement>('*')).filter(node =>
          Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()),
        ).map(node => {
          let parent: HTMLElement | null = node;
          while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
          return { text: node.textContent?.slice(0, 30), fg: getComputedStyle(node).color, bg: parent ? getComputedStyle(parent).backgroundColor : 'rgb(255, 255, 255)' };
        });
      });
      const luminance = (color: string) => {
        const values = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      for (const pair of pairs) {
        const values = [luminance(pair.fg), luminance(pair.bg)].sort((a, b) => b - a);
        const ratio = (values[0] + 0.05) / (values[1] + 0.05);
        assert(ratio >= 4.5, `글자 대비 ${ratio.toFixed(2)}: ${pair.text} (${pair.fg}/${pair.bg})`);
      }
    };
    const screenshot = async (name: string, width = 720, savedHtml?: string) => {
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      const html = savedHtml ?? await view.evaluate(el => el.outerHTML);
      await page.evaluate(({ html, width }) => {
        const fixture = document.createElement('div'); fixture.id = 'qa-independent-report';
        fixture.style.cssText = `position:absolute;top:0;left:0;width:${width}px;z-index:99999`; fixture.innerHTML = html;
        document.body.appendChild(fixture);
      }, { html, width });
      const independent = page.locator('#qa-independent-report');
      await independent.screenshot({ path: `${out}/${name}.png` });
      assert(await independent.evaluate((el, width) => el.scrollWidth <= width, width), `${width}px 보고서 가로 넘침 없음`);
      await independent.evaluate(el => el.remove());
    };
    await panel.getByRole('button', { name: '총평 생성', exact: true }).click();
    await expect(view.getByRole('heading', { level: 1 })).toHaveText(report.headline, { timeout: 60000 });
    assert.equal(generations, 1);
    const initialText = await view.innerText();
    assert(!initialText.includes('킬러')); assert(!initialText.includes('등급컷'));
    await contrast();
    await screenshot('brand');
    await open(); await expect(view).toBeVisible(); assert.equal(await view.innerText(), initialText);

    fail = true;
    await panel.getByRole('button', { name: '총평 재생성', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('이전 총평 표시 중');
    assert.equal(await view.innerText(), initialText); fail = false;
    questions[0].english_analysis.skills.push('주어와 동사의 거리 확인');
    await open(); await expect(panel.getByRole('status')).toContainText('이전 근거로 만든 총평');
    assert.equal(generations, 2, '교정으로 자동 생성하지 않음');
    await panel.getByRole('button', { name: '네이버 이미지 복사', exact: true }).click();
    await expect(panel.getByRole('button', { name: '이전 총평으로 복사', exact: true })).toBeVisible();
    assert.equal(uploads, 0, '이전 근거 복사는 확인 전 이미지를 만들지 않음');
    await panel.getByRole('button', { name: '취소', exact: true }).click();
    await panel.getByRole('button', { name: '총평 재생성', exact: true }).click();
    await expect(panel.getByText('이전 근거로 만든 총평입니다.', { exact: false })).toHaveCount(0);
    await expect(view).toContainText('주어와 동사의 거리 확인');
    await panel.getByLabel('총평 지면 테마').selectOption('terminal');
    await expect(panel.getByLabel('총평 지면 테마')).toBeEnabled();
    await contrast();
    await screenshot('dark');
    const dark = await view.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.notEqual(dark.background, dark.color);
    await open(); await expect(panel.getByLabel('총평 지면 테마')).toHaveValue('terminal');
    const blocks = await view.locator(':scope > *').count();
    await panel.getByRole('button', { name: '네이버 이미지 복사', exact: true }).click();
    await expect(panel.getByRole('button', { name: '네이버 이미지 복사', exact: true })).toBeVisible({ timeout: 180000 });
    if (!copies) console.error('Copy diagnostic', { uploads, copies, clipboardLength: clipboardHtml.length, errors, text: (await page.locator('body').innerText()).slice(-2500) });
    await expect.poll(() => copies, { timeout: 10000 }).toBe(1);
    assert.equal(uploads, blocks); assert.equal((clipboardHtml.match(/<img /g) || []).length, blocks);
    assert(clipboardHtml.includes(report.dek));
    await writeFile(`${out}/clipboard.html`, clipboardHtml);
    await panel.getByRole('button', { name: '네이버 이미지 복사', exact: true }).click();
    await expect.poll(() => copies).toBe(2); assert.equal(uploads, blocks, '같은 보고서·테마는 이미지 캐시 재사용');

    // 자동 옵션을 끄면 기존 총평이 있어도 재생성하지 않는다. 학습 대책 실패는 켠 체인을 막지 않는다.
    for (const auto of [false, true]) {
      analysis.modelVersion = 'AI / prompt en-v1.4.0'; await open();
      await panel.getByLabel('분석 후 총평 자동 생성').setChecked(auto);
      chain.length = 0; const priorGenerations = generations;
      await panel.getByRole('button', { name: '시험지 재분석', exact: true }).click();
      await expect.poll(() => studyCalls).toBe(auto ? 2 : 1);
      await expect(panel.getByRole('button', { name: '총평 재생성', exact: true })).toBeDisabled();
      assert.equal(generations, priorGenerations, '학습 대책과 수동·자동 총평이 동시에 실행되지 않음');
      const release = releaseStudy as (() => void) | null; assert(release); release();
      await expect(panel.getByRole('button', { name: '총평 재생성', exact: true })).toBeEnabled({ timeout: 30000 });
      assert.equal(generations, priorGenerations + (auto ? 1 : 0));
      assert.deepEqual(chain, auto ? ['analyze', 'english-study', 'commentary'] : ['analyze', 'english-study']);
    }

    // 수동 생성 도중 다른 시험을 열어도 완료 응답이 선택과 화면 상태를 되돌리지 않는다.
    holdCommentary = true;
    await panel.getByRole('button', { name: '총평 재생성', exact: true }).click();
    await expect.poll(() => !!releaseCommentary).toBe(true);
    await page.getByText(otherPaper.title, { exact: true }).first().click();
    await expect(panel.getByRole('button', { name: '총평 생성', exact: true })).toBeEnabled();
    await expect(view).toHaveCount(0);
    const completed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/analyze-extended'));
    const finishCommentary = releaseCommentary as (() => void) | null; assert(finishCommentary); finishCommentary();
    await completed; holdCommentary = false;
    await expect(page.getByText('영어 총평이 생성되었습니다', { exact: true }).last()).toBeVisible();
    await expect(panel.getByRole('button', { name: '총평 생성', exact: true })).toBeEnabled();
    await expect(view).toHaveCount(0);
    await page.getByText(paper.title, { exact: true }).first().click();
    await expect(view).toBeVisible();

    // 실제 모델 산출물이 있으면 같은 UI에 저장 스냅샷 그대로 넣어 지면을 별도 보존한다.
    const liveRaw = await readFile('test-results/english-commentary-live/high-conditional-writing.json', 'utf8').catch(() => null);
    if (liveRaw) {
      const live = JSON.parse(liveRaw);
      assert.equal(live.status, 'completed');
      const actual = { ...makeDocument(), context: live.context, report: live.report, inputSignature: englishCommentarySignature(live.context) };
      assert(readEnglishCommentary(actual)); analysis.extensions[0].result = actual;
      await open(); await panel.getByLabel('총평 지면 테마').selectOption('brand');
      await expect(view.getByRole('heading', { level: 1 })).toHaveText(live.report.headline);
      await screenshot('actual-model-720');
    }

    // 앱 전체는 좁은 화면 보호 정책이 있다. 독립 보고서를 실제 DOM/CSS로 375px에서 검증한다.
    const savedHtml = await view.evaluate(el => el.outerHTML);
    await page.setViewportSize({ width: 375, height: 900 });
    await screenshot('narrow', 375, savedHtml);
    assert.deepEqual(errors, []);
    console.log(`PASS 영어 총평 실제 UI: 일반 교사 생성/재조회/실패 보존/교정/재생성/테마 저장/실제 PNG ${uploads}장/클립보드 HTML/캐시/이전 근거 복사 확인/자동 옵션 OFF·ON/학습 대책 실패 후 순차 생성/375px. API는 fixture, 실제 AI 호출 없음.`);
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
