// 🚧 Lab P0 — 채점(Grader) manual 구현체
//   사람이 입력한 채점 결과(LabGradedItem)를 읽어 DTO로 반환.
//   자동채점(객관식·단답)은 P1, 서술형 VEHME는 P5에서 autoGrader로 교체.
//   genMode=MANUAL.
import { prisma } from '@/lib/db';
import type { Grader, GradedItemDTO } from '../stages';

export const manualGrader: Grader = {
  mode: 'MANUAL',
  // answerRef는 manual에서 미사용(사람이 이미 LabGradedItem으로 입력) — 생략
  async run({ worksheetId }): Promise<{ items: GradedItemDTO[] }> {
    const submission = await prisma.labSubmission.findUnique({
      where: { worksheetId },
      include: { items: { include: { problem: true } } },
    });
    if (!submission) return { items: [] };

    const items: GradedItemDTO[] = submission.items.map((gi) => ({
      problemId: gi.problemId,
      conceptId: gi.problem.conceptId,
      correct: gi.correct,
      partialScore: gi.partialScore ?? undefined,
      errorType: gi.errorType,
    }));

    return { items };
  },
};
