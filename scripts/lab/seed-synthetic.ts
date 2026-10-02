/**
 * 🚧 Lab P0 — 합성 개념 그래프 시드 (개발용)
 *
 * 84개월 진도표 JSON 확보 전, P0 루프를 닫기 위한 소규모 합성 데이터.
 *   - LabConcept 5개 (현행 track, 선수개념 체인)
 *   - LabConceptEdge 5개 (선수→의존)
 *   - LabProblem 개념당 6개
 *   - LabStudent 1명 + LabPacingPosition (현행 1개월 1회차)
 *
 * 실행: npx tsx scripts/lab/seed-synthetic.ts   (DATABASE_URL 필요)
 *       node --env-file=.env.local node_modules/.bin/tsx scripts/lab/seed-synthetic.ts
 * 재실행 안전(upsert).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONCEPTS = [
  { id: 'lab-c1', name: '자연수의 덧셈', monthIdx: 1, sessionIdx: 1 },
  { id: 'lab-c2', name: '자연수의 뺄셈', monthIdx: 1, sessionIdx: 2 },
  { id: 'lab-c3', name: '자연수의 곱셈', monthIdx: 2, sessionIdx: 1 },
  { id: 'lab-c4', name: '자연수의 나눗셈', monthIdx: 2, sessionIdx: 2 },
  { id: 'lab-c5', name: '분수의 개념', monthIdx: 3, sessionIdx: 1 },
];

const EDGES = [
  ['lab-c1', 'lab-c2'],
  ['lab-c1', 'lab-c3'],
  ['lab-c3', 'lab-c4'],
  ['lab-c2', 'lab-c5'],
  ['lab-c4', 'lab-c5'],
];

const STUDENT_ID = 'lab-student-demo';
const DIFFS = [1, 2, 2, 3, 2, 1]; // 개념당 6문항 난이도 분포

async function main() {
  // 개념
  for (const c of CONCEPTS) {
    await prisma.labConcept.upsert({
      where: { id: c.id },
      create: { ...c, track: 'CURRENT', domain: '수와 연산' },
      update: { name: c.name, monthIdx: c.monthIdx, sessionIdx: c.sessionIdx },
    });
  }

  // 선수개념 그래프
  for (const [prereqId, dependentId] of EDGES) {
    await prisma.labConceptEdge.upsert({
      where: { prereqId_dependentId: { prereqId, dependentId } },
      create: { prereqId, dependentId },
      update: {},
    });
  }

  // 문제은행 (개념당 6개)
  for (const c of CONCEPTS) {
    for (let i = 0; i < DIFFS.length; i++) {
      const id = `lab-p-${c.id}-${i + 1}`;
      const isMc = i % 2 === 0;
      await prisma.labProblem.upsert({
        where: { id },
        create: {
          id,
          conceptId: c.id,
          type: isMc ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER',
          difficulty: DIFFS[i],
          source: 'synthetic-seed',
          isGenerated: false,
          bodyRef: `synthetic://${c.id}/${i + 1}`, // HWP 부재 → 본문 참조 자리표시
          answer: isMc ? { choice: (i % 5) + 1 } : { value: String(i + 1) },
        },
        update: { difficulty: DIFFS[i], type: isMc ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER' },
      });
    }
  }

  // 학생 + 진도
  await prisma.labStudent.upsert({
    where: { id: STUDENT_ID },
    create: { id: STUDENT_ID, name: '데모 학생', grade: '초3' },
    update: { name: '데모 학생' },
  });
  await prisma.labPacingPosition.upsert({
    where: { studentId: STUDENT_ID },
    create: { studentId: STUDENT_ID, track: 'CURRENT', monthIdx: 1, sessionIdx: 1 },
    update: { track: 'CURRENT', monthIdx: 1, sessionIdx: 1 },
  });

  const counts = {
    concepts: await prisma.labConcept.count(),
    edges: await prisma.labConceptEdge.count(),
    problems: await prisma.labProblem.count(),
    students: await prisma.labStudent.count(),
  };
  console.log('✅ Lab 합성 시드 완료:', counts);
  console.log(`   데모 학생 id = ${STUDENT_ID} (진도: 현행 1개월 1회차 → dumb 처방 = 자연수의 덧셈)`);
}

main()
  .catch((e) => {
    console.error('❌ 시드 실패:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
