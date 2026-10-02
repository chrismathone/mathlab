/**
 * 영어 총평 저장소 — Prisma 어댑터 (**서버 전용**). 새 모델 없이 기존
 * `ExamAnalysisExtension(agentType='commentary')` 한 행을 쓴다.
 *
 * CAS: `updateMany({ where: { id, lastRunAt: 기대값 } })` — JSON 비교 대신 스칼라 시각을 버전으로 쓴다.
 * lastRunAt 은 앱이 JS Date(ms)로만 쓰므로 정확히 같은 값으로 비교된다.
 *
 * finalize(원자 저장): 짧은 대화형 트랜잭션에서
 *   ① ExamAnalysis·ExamPaper 행을 `FOR SHARE` 로 잠근다 — 잠금 이후 커밋된 최신 값만 읽히고,
 *      교정 PATCH(분석 행 UPDATE)·시험지 수정·재분석 삭제는 이 트랜잭션이 끝날 때까지 대기한다.
 *   ② 같은 트랜잭션에서 입력·extension 행을 다시 읽어 decide(동기) → ③ CAS 쓰기.
 * 그래서 '서명 재확인'과 '쓰기' 사이에 교정이 끼어드는 경합이 없다. LLM 호출은 이 구간 밖에서 끝난다.
 * 잠금 순서는 분석 → 시험지 고정(재분석·교정 경로는 시험지 잠금을 먼저 쥐지 않으므로 교착 경로 없음).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db';
import { toExamSubjectKey } from '../../shared/subject';
import type {
  EnglishCommentaryLoaded, EnglishCommentaryRowSnapshot, EnglishCommentaryRowWrite, EnglishCommentaryStore,
} from './service';

const AGENT = 'commentary';
const ROW_SELECT = { id: true, result: true, lastRunAt: true, errorMessage: true } as const;
/** 원자 저장 구간 상한 — 잠금 대기 포함. 넘으면 저장하지 않고 실패(lease 는 만료 후 인계) */
const FINALIZE_TX = { maxWait: 5000, timeout: 15000 } as const;

type Db = PrismaClient | Prisma.TransactionClient;

function toData(data: EnglishCommentaryRowWrite) {
  return {
    result: data.result as unknown as Prisma.InputJsonValue,
    lastRunAt: data.lastRunAt,
    lastRunBy: data.lastRunBy,
    ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
  };
}

async function loadInputWith(db: Db, analysisId: string): Promise<EnglishCommentaryLoaded | null> {
  const analysis = await db.examAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true, examPaperId: true, questions: true, summary: true, totalPoints: true,
      examPaper: {
        select: {
          id: true, title: true, schoolName: true, grade: true, category: true, examScope: true, examStats: true,
          subject: true, status: true,
        },
      },
    },
  });
  if (!analysis?.examPaper || toExamSubjectKey(analysis.examPaper.subject) !== 'ENGLISH') return null;
  const latest = await db.examAnalysis.findFirst({
    where: { examPaperId: analysis.examPaperId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const p = analysis.examPaper;
  return {
    isLatest: latest?.id === analysis.id,
    reanalyzing: p.status === 'ANALYZING',
    input: {
      examPaper: {
        id: p.id, title: p.title, schoolName: p.schoolName, grade: p.grade, category: p.category,
        examScope: p.examScope, examStats: p.examStats,
      },
      analysis: { id: analysis.id, questions: analysis.questions, summary: analysis.summary, totalPoints: analysis.totalPoints },
    },
  };
}

function getRowWith(db: Db, analysisId: string): Promise<EnglishCommentaryRowSnapshot | null> {
  return db.examAnalysisExtension.findUnique({
    where: { analysisId_agentType: { analysisId, agentType: AGENT } },
    select: ROW_SELECT,
  });
}

async function casUpdateWith(
  db: Db, rowId: string, expectedLastRunAt: Date | null, data: EnglishCommentaryRowWrite,
): Promise<EnglishCommentaryRowSnapshot | null> {
  const { count } = await db.examAnalysisExtension.updateMany({
    where: { id: rowId, lastRunAt: expectedLastRunAt },
    data: toData(data),
  });
  if (count !== 1) return null;
  return db.examAnalysisExtension.findUnique({ where: { id: rowId }, select: ROW_SELECT });
}

export interface PrismaEnglishCommentaryStoreOptions {
  client?: PrismaClient;
  /**
   * 검증 전용 훅 — finalize 가 행을 잠근 직후(재읽기 전) 호출된다.
   * DB 검사 스크립트가 '잠긴 동안 교정 쓰기가 대기하는지'를 확인할 때만 쓴다.
   */
  onLocked?: () => Promise<void>;
}

export function createPrismaEnglishCommentaryStore(opts: PrismaEnglishCommentaryStoreOptions = {}): EnglishCommentaryStore {
  const db = opts.client ?? defaultPrisma;
  return {
    loadInput: (analysisId) => loadInputWith(db, analysisId),
    getRow: (analysisId) => getRowWith(db, analysisId),

    async createRow(analysisId, data) {
      try {
        return await db.examAnalysisExtension.create({
          data: { analysisId, agentType: AGENT, ...toData(data) },
          select: ROW_SELECT,
        });
      } catch (e) {
        // 동시에 다른 요청이 먼저 행을 만들었다(유니크 충돌) → 진행 중으로 본다
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
        throw e;
      }
    },

    casUpdate: (rowId, expectedLastRunAt, data) => casUpdateWith(db, rowId, expectedLastRunAt, data),

    finalize(analysisId, decide) {
      return db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ examPaperId: string }>>`
          SELECT "examPaperId" FROM "ExamAnalysis" WHERE "id" = ${analysisId} FOR SHARE`;
        if (locked.length) {
          await tx.$queryRaw`SELECT "id" FROM "ExamPaper" WHERE "id" = ${locked[0].examPaperId} FOR SHARE`;
        }
        if (opts.onLocked) await opts.onLocked();
        const fresh = locked.length ? await loadInputWith(tx, analysisId) : null;
        const row = await getRowWith(tx, analysisId);
        const { write } = decide({ fresh, row });
        if (!write) return { written: null };
        return { written: await casUpdateWith(tx, write.rowId, write.expectedLastRunAt, write.data) };
      }, FINALIZE_TX);
    },
  };
}

export const prismaEnglishCommentaryStore: EnglishCommentaryStore = createPrismaEnglishCommentaryStore();
