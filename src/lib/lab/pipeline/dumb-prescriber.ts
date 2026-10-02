// 🚧 Lab P0 — 처방(Prescriber) dumb 구현체
//   약점맵(mastery)을 의도적으로 무시하고, 진도표 현재 위치의 개념만 처방.
//   smart 처방(약점 반영·선수개념 게이팅)은 P3에서 교체.
//   genMode=MANUAL.
import { prisma } from '@/lib/db';
import type { Prescriber, PrescriptionDTO, PrescriptionItemDTO } from '../stages';

const P0_DEFAULT_DIFFICULTY = 2; // 표준
const P0_DEFAULT_COUNT = 5;

export const dumbPrescriber: Prescriber = {
  mode: 'MANUAL',
  // mastery 인자는 P0에서 미사용(약점맵 무시) — destructure에서 생략
  async run({ studentId, track, monthIdx, sessionIdx }): Promise<PrescriptionDTO> {
    const concepts = await prisma.labConcept.findMany({
      where: { track, monthIdx, sessionIdx },
      orderBy: { id: 'asc' },
    });

    const items: PrescriptionItemDTO[] = concepts.map((c, i) => ({
      conceptId: c.id,
      difficulty: P0_DEFAULT_DIFFICULTY,
      count: P0_DEFAULT_COUNT,
      order: i,
      reason: 'P0 dumb: 진도표 현재 위치 (약점맵 미반영)',
    }));

    return {
      studentId,
      items,
      rationale: `P0 처방 — ${track} ${monthIdx}개월 ${sessionIdx}회차 개념 ${concepts.length}개`,
    };
  },
};
