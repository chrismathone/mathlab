/** 실제 로컬 Next API + 임시 DB 레코드의 권한/캐시/차단 검사. AI 호출과 사용자 데이터 변경 없음. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';
import { encode } from 'next-auth/jwt';
import { PrismaClient, type Prisma } from '@prisma/client';
import { ENGLISH_COMMENTARY_LIVE_FIXTURES } from '../fixtures/english-commentary';
import { buildEnglishCommentaryContext, englishCommentarySignature, ENGLISH_COMMENTARY_VERSION, readEnglishCommentary } from '../../src/lib/exam-analysis/english/commentary';

async function main() {
  loadEnvConfig(process.cwd());
  const base = process.env.MATHLAB_QA_BASE_URL || 'http://127.0.0.1:3100';
  assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  assert.notEqual(process.env.VERCEL_ENV, 'production');
  assert(process.env.NEXTAUTH_SECRET);
  const db = new PrismaClient();
  const tenantIds: string[] = []; const userIds: string[] = []; const paperIds: string[] = [];
  const tag = `en-api-${Date.now().toString(36)}`;
  let passed = 0;
  try {
    const tenant = await db.tenant.create({ data: { slug: tag, name: '영어 총평 API 검사', isActive: false } }); tenantIds.push(tenant.id);
    const other = await db.tenant.create({ data: { slug: `${tag}-other`, name: 'API 검사 타지점', isActive: false } }); tenantIds.push(other.id);
    const makeUser = async (suffix: string, tenantId: string, role: 'TEACHER' | 'STUDENT') => {
      const user = await db.user.create({ data: { username: `${tag}-${suffix}`, name: 'API 검증', passwordHash: '!disabled-test-account', role, tenantId } }); userIds.push(user.id);
      return encode({ secret: process.env.NEXTAUTH_SECRET!, maxAge: 3600, token: { id: user.id, sub: user.id, username: user.username, name: user.name, role, tenantId } });
    };
    const teacher = await makeUser('teacher', tenant.id, 'TEACHER');
    const foreign = await makeUser('other', other.id, 'TEACHER');
    const student = await makeUser('student', tenant.id, 'STUDENT');
    const fixture = ENGLISH_COMMENTARY_LIVE_FIXTURES[0].input;
    const paper = await db.examPaper.create({ data: {
      teacherId: userIds[0], tenantId: tenant.id, title: '영어 API 검증용', subject: 'ENGLISH', grade: '중2',
      schoolName: '검증용 학교', examScope: fixture.examPaper.examScope as Prisma.InputJsonValue,
      fileUrls: '', fileType: 'pdf', status: 'COMPLETED',
    } }); paperIds.push(paper.id);
    const analysis = await db.examAnalysis.create({ data: {
      examPaperId: paper.id, questions: fixture.analysis.questions as Prisma.InputJsonValue, summary: fixture.analysis.summary as Prisma.InputJsonValue,
      totalQuestions: (fixture.analysis.questions as unknown[]).length, totalPoints: fixture.analysis.totalPoints,
      modelVersion: 'API check / prompt en-v1.5.0', analyzedAt: new Date(),
    } });
    const ctx = buildEnglishCommentaryContext({ examPaper: paper, analysis });
    const live = JSON.parse(await readFile('test-results/english-commentary-live/middle-objective.json', 'utf8'));
    assert.equal(live.status, 'completed');
    const document = {
      kind: 'english-commentary', contract: 1, version: ENGLISH_COMMENTARY_VERSION,
      inputSignature: englishCommentarySignature(ctx), generatedAt: new Date().toISOString(), context: ctx,
      report: live.report, generation: { repaired: false, durationMs: 1 }, migratedFrom: null,
    };
    assert(readEnglishCommentary(document));
    await db.examAnalysisExtension.create({ data: { analysisId: analysis.id, agentType: 'commentary', result: document as unknown as Prisma.InputJsonValue } });
    const post = async (token: string | null, suffix = 'analyze-extended') => {
      const response = await fetch(`${base}/api/exam-analysis/${paper.id}/${suffix}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `next-auth.session-token=${token}` } : {}) },
        body: JSON.stringify({ agents: ['commentary'], forceRegenerate: false }), signal: AbortSignal.timeout(60000),
      });
      return { status: response.status, body: await response.json() };
    };
    const check = async (name: string, token: string | null, status: number, code?: string, suffix?: string) => {
      const result = await post(token, suffix); assert.equal(result.status, status, name);
      if (code) assert.equal(result.body.error?.code, code, name);
      console.log(`PASS ${name}`); passed++; return result;
    };
    await check('미로그인 차단', null, 401);
    await check('학생 차단', student, 403);
    await check('타지점 시험 접근 차단', foreign, 404);
    await check('무료 플랜 차단', teacher, 403, 'FEATURE_LOCKED');
    await db.tenantSubscription.create({ data: { tenantId: tenant.id, plan: 'pro', status: 'active' } });
    // 캐시가 확실히 맞는 경우에만 POST한다. 강제 생성은 호출하지 않는다.
    const cached = await check('일반 교사 Pro 저장 총평 재사용', teacher, 200);
    assert.equal(cached.body.data[0].code, 'cached');
    assert.equal(cached.body.data[0].status, 'completed');
    assert.equal(cached.body.data[0].result.inputSignature, document.inputSignature);
    await db.tenant.update({ where: { id: tenant.id }, data: { settings: { demo: true, accountPerms: { [userIds[0]]: { commentary: false, blog: false } } } } });
    await check('데모 총평 권한 차단', teacher, 403, 'DEMO_FEATURE_DENIED');
    await check('데모 이미지 업로드 권한 차단', teacher, 403, 'DEMO_FEATURE_DENIED', 'upload-section-image');
    await db.tenant.update({ where: { id: tenant.id }, data: { settings: { demo: false } } });
    await check('영어 수학 메타데이터 우회 차단', teacher, 400, undefined, 'generate-metadata');
    await check('영어 V4 덮어쓰기 우회 차단', teacher, 400, undefined, 'generate-v4');
    await db.examAnalysis.update({ where: { id: analysis.id }, data: { totalPoints: 101, summary: { completeness: { status: 'partial', declaredQuestions: 30, declaredPoints: 100 } } } });
    await check('미완성 분석 서버 readiness 차단', teacher, 400, 'COMMENTARY_NOT_READY');
    const kept = await db.examAnalysisExtension.findUnique({ where: { analysisId_agentType: { analysisId: analysis.id, agentType: 'commentary' } } });
    assert.deepEqual(kept?.result, document, '차단된 요청은 저장된 총평을 변경하지 않음');
    console.log(`PASS 실제 HTTP·DB ${passed}건. 실제 AI 호출 없음.`);
  } finally {
    if (paperIds.length) await db.examPaper.deleteMany({ where: { id: { in: paperIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.$disconnect();
    console.log('본 실행의 임시 레코드 정리 완료');
  }
}
void main().catch(error => {
  console.error(String(error instanceof Error ? error.message : error).replace(/postgres(?:ql)?:\/\/\S+/gi, '[DB 연결 정보]'));
  process.exitCode = 1;
});
