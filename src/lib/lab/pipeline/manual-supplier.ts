// 🚧 Lab P0 — 공급(Supplier) manual 구현체
//   처방 개념별로 문제은행(LabProblem)에서 문항 선택 → LabWorksheet 생성.
//   HWP 출제 엔진 부재 → hwpUrl 보류(''), status=PRESCRIBED.
//   (HWP 자동 생성은 추후 반자동 단계에서 채움.)
//   prescription↔worksheet FK 링크는 service 계층에서 부여(계약은 id를 모름).
import { prisma } from '@/lib/db';
import type { Supplier, WorksheetDTO } from '../stages';

export const manualSupplier: Supplier = {
  mode: 'MANUAL',
  async run({ prescription }): Promise<WorksheetDTO> {
    const problemIds: string[] = [];

    for (const item of prescription.items) {
      // 1차: 개념 + 난이도 정확 매칭
      const exact = await prisma.labProblem.findMany({
        where: { conceptId: item.conceptId, difficulty: item.difficulty },
        take: item.count,
      });
      let picked = exact;
      // 2차: 부족하면 같은 개념 내 아무 난이도로 보충
      if (picked.length < item.count) {
        const more = await prisma.labProblem.findMany({
          where: { conceptId: item.conceptId, id: { notIn: picked.map((p) => p.id) } },
          take: item.count - picked.length,
        });
        picked = [...picked, ...more];
      }
      problemIds.push(...picked.map((p) => p.id));
    }

    const worksheet = await prisma.labWorksheet.create({
      data: {
        studentId: prescription.studentId,
        status: 'PRESCRIBED',
        genMode: 'MANUAL',
        problems: {
          create: problemIds.map((problemId, order) => ({ problemId, order })),
        },
      },
    });

    return { worksheetId: worksheet.id, hwpUrl: '', problemIds };
  },
};
