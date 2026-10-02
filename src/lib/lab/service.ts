// 🚧 Lab P0 — 서비스 계층 (DB 인지 오케스트레이션)
//   stages.ts의 순수 runCycle을 감싸 DB에서 컨텍스트(숙련도·진도)를 로드하고
//   채점 결과를 먹여 한 사이클을 돈다. 데이터는 역방향(채점→진단)으로 닫힌다.
import { prisma } from '@/lib/db';
import type { MasteryMap, GradedItemDTO } from './stages';
import { runCycle } from './stages';
import { p0Pipeline } from './pipeline';

/** 학생의 현재 masteryMap 로드 (conceptId → entry) */
export async function loadMasteryMap(studentId: string): Promise<MasteryMap> {
  const records = await prisma.labMasteryRecord.findMany({ where: { studentId } });
  const map: MasteryMap = {};
  for (const r of records) {
    map[r.conceptId] = {
      conceptId: r.conceptId,
      score: r.score,
      observationCount: r.observationCount,
    };
  }
  return map;
}

/**
 * 한 사이클 실행:
 *   1) 최신 제출의 채점결과 수집(grader)
 *   2) 진단(diagnoser) → 숙련도 갱신
 *   3) 처방(prescriber) → 4) 공급(supplier) → 다음 시험지
 * 채점결과가 없으면(최초) graded=[]로 시작 → dumb 처방으로 cold start 회피.
 */
export async function runStudentCycle(studentId: string) {
  const pacing = await prisma.labPacingPosition.findUnique({ where: { studentId } });
  if (!pacing) throw new Error('학생의 진도(pacing) 위치가 없습니다. 시드/배치가 필요합니다.');

  // 최신 제출에서 채점결과 수집
  let graded: GradedItemDTO[] = [];
  const latestSub = await prisma.labSubmission.findFirst({
    where: { studentId },
    orderBy: { createdAt: 'desc' },
  });
  if (latestSub) {
    const res = await p0Pipeline.grader.run({
      worksheetId: latestSub.worksheetId,
      answerRef: latestSub.answerRef ?? '',
    });
    graded = res.items;
  }

  const mastery = await loadMasteryMap(studentId);
  const worksheet = await runCycle(p0Pipeline, {
    studentId,
    graded,
    mastery,
    track: pacing.track,
    monthIdx: pacing.monthIdx,
    sessionIdx: pacing.sessionIdx,
  });
  return worksheet;
}

/**
 * [DEV] 사람 채점 시뮬레이션 — 워크시트의 각 문항에 정/오를 무작위 입력해
 * LabSubmission + LabGradedItem 생성(선생님이 채점지를 입력한 것과 동일 효과).
 * 합성 데이터로 P0 루프를 닫기 위한 개발 보조. 실제 채점 UI/스캔으로 대체된다.
 */
export async function simulateManualGrading(worksheetId: string, correctRate = 0.6) {
  const ws = await prisma.labWorksheet.findUnique({
    where: { id: worksheetId },
    include: { problems: true },
  });
  if (!ws) throw new Error('worksheet를 찾을 수 없습니다');

  const submission = await prisma.labSubmission.create({
    data: {
      worksheetId,
      studentId: ws.studentId,
      genMode: 'MANUAL',
      gradedAt: new Date(),
      items: {
        create: ws.problems.map((wp) => {
          const correct = Math.random() < correctRate;
          return {
            problemId: wp.problemId,
            correct,
            errorType: correct ? 'NONE' : 'CONCEPT',
          };
        }),
      },
    },
    include: { items: true },
  });

  await prisma.labWorksheet.update({
    where: { id: worksheetId },
    data: { status: 'GRADED' },
  });

  return submission;
}
