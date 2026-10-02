// 🚧 Lab P0 — 보고(Reporter) manual 구현체
//   현재 숙련도 스냅샷을 요약한 LabReport 레코드 생성. PDF/HWP URL은 보류('').
//   AI 부원장 리포트는 P4에서 autoReporter로 교체.
//   genMode=MANUAL.
import { prisma } from '@/lib/db';
import type { Reporter, ReportDTO } from '../stages';

export const manualReporter: Reporter = {
  mode: 'MANUAL',
  async run({ studentId, masteryDelta, periodStart, periodEnd, type }): Promise<ReportDTO> {
    const records = await prisma.labMasteryRecord.findMany({
      where: { studentId },
      include: { concept: true },
    });

    const avgScore = records.length
      ? records.reduce((s, r) => s + r.score, 0) / records.length
      : 0;
    const summary = {
      conceptCount: records.length,
      avgScore,
      weakConcepts: records
        .filter((r) => r.score < 0.6)
        .map((r) => ({ concept: r.concept.name, score: r.score })),
      updatedThisCycle: masteryDelta.updates.length,
    };

    await prisma.labReport.create({
      data: { studentId, type, periodStart, periodEnd, summary, genMode: 'MANUAL' },
    });

    return { studentId, type, url: '', summary };
  },
};
