// 🚧 Lab P0 — 진단(Diagnoser) manual 구현체
//   관측 기반 단순 추정기 (누적 정답률). BKT는 P2에서 autoDiagnoser로 교체.
//   genMode=MANUAL — 시스템은 채점 결과를 기록·집계만 한다.
import { prisma } from '@/lib/db';
import type { Diagnoser, MasteryDelta, MasteryEntry } from '../stages';

export const manualDiagnoser: Diagnoser = {
  mode: 'MANUAL',
  async run({ studentId, graded }): Promise<MasteryDelta> {
    // 개념별로 이번 채점 결과 집계
    const byConcept = new Map<string, { correct: number; total: number }>();
    for (const g of graded) {
      const c = byConcept.get(g.conceptId) ?? { correct: 0, total: 0 };
      c.total += 1;
      if (g.correct) c.correct += 1;
      byConcept.set(g.conceptId, c);
    }

    const updates: MasteryEntry[] = [];
    for (const [conceptId, agg] of byConcept) {
      const existing = await prisma.labMasteryRecord.findUnique({
        where: { studentId_conceptId: { studentId, conceptId } },
      });
      const prevObs = existing?.observationCount ?? 0;
      const prevScore = existing?.score ?? 0;
      const newObs = prevObs + agg.total;
      // 누적 정답률 = (이전점수 × 이전관측 + 이번정답수) / 새관측
      const newScore = newObs > 0 ? (prevScore * prevObs + agg.correct) / newObs : 0;

      await prisma.labMasteryRecord.upsert({
        where: { studentId_conceptId: { studentId, conceptId } },
        create: {
          studentId,
          conceptId,
          score: newScore,
          observationCount: newObs,
          lastObservedAt: new Date(),
          genMode: 'MANUAL',
        },
        update: { score: newScore, observationCount: newObs, lastObservedAt: new Date() },
      });
      updates.push({ conceptId, score: newScore, observationCount: newObs });
    }

    return { studentId, updates };
  },
};
