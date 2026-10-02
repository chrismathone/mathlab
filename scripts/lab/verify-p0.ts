/**
 * 🚧 Lab P0 — end-to-end 스모크 검증 (개발용, 읽기/쓰기)
 *   HTTP 인증 게이트(/api/lab/*) 우회: 게이트 아래 service 함수를 직접 호출해
 *   진단→처방→공급→채점→진단 한 바퀴가 lab_* 테이블에 닫히는지 확인한다.
 *
 *   실행: npx tsx scripts/lab/verify-p0.ts
 *   전제: scripts/lab/seed-synthetic.ts 로 합성 데이터 시드 완료(lab-student-demo).
 *
 *   ⚠️ 기출분석/공유 테이블 무관 — lab_* 만 읽고 쓴다. 데모 학생 1명 범위.
 *      시작 시 데모 학생의 lab_* 트랜잭션 행(워크시트/제출/채점/숙련도/처방)을 정리해
 *      재실행해도 결정적이다. 시드(개념·문항·진도)는 건드리지 않는다.
 */
import { prisma } from '@/lib/db';
import { runStudentCycle, simulateManualGrading, loadMasteryMap } from '@/lib/lab/service';

const SID = 'lab-student-demo';

function line() { console.log('─'.repeat(60)); }
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  return ok;
}

async function clean() {
  // children → parents 순서로 데모 학생의 트랜잭션 행만 제거
  await prisma.labGradedItem.deleteMany({ where: { submission: { studentId: SID } } });
  await prisma.labSubmission.deleteMany({ where: { studentId: SID } });
  await prisma.labWorksheetProblem.deleteMany({ where: { worksheet: { studentId: SID } } });
  await prisma.labWorksheet.deleteMany({ where: { studentId: SID } });
  await prisma.labMasteryRecord.deleteMany({ where: { studentId: SID } });
  await prisma.labPrescriptionItem.deleteMany({ where: { prescription: { studentId: SID } } });
  await prisma.labPrescription.deleteMany({ where: { studentId: SID } });
}

async function counts() {
  const [worksheets, wproblems, submissions, gradedItems, mastery] = await Promise.all([
    prisma.labWorksheet.count({ where: { studentId: SID } }),
    prisma.labWorksheetProblem.count({ where: { worksheet: { studentId: SID } } }),
    prisma.labSubmission.count({ where: { studentId: SID } }),
    prisma.labGradedItem.count({ where: { submission: { studentId: SID } } }),
    prisma.labMasteryRecord.count({ where: { studentId: SID } }),
  ]);
  return { worksheets, wproblems, submissions, gradedItems, mastery };
}

async function main() {
  let allPass = true;

  line();
  console.log('🚧 Lab P0 end-to-end 검증 — student:', SID);
  line();

  await clean();
  console.log('초기화 후 상태:', JSON.stringify(await counts()));

  // ── 1) 첫 사이클: 채점결과 없음 → dumb 처방(자연수의 덧셈) → 워크시트 생성
  console.log('\n[1] runStudentCycle (cold start)');
  const ws1 = await runStudentCycle(SID);
  const ws1row = await prisma.labWorksheet.findUnique({ where: { id: ws1.worksheetId } });
  console.log('    → worksheetId:', ws1.worksheetId, '| status:', ws1row?.status, '| problemIds:', ws1.problemIds.length);
  const c1 = await counts();
  allPass = check('1차: 워크시트 생성', c1.worksheets === 1, `worksheets=${c1.worksheets}`) && allPass;
  allPass = check('1차: 문항 공급', ws1.problemIds.length > 0 && c1.wproblems === ws1.problemIds.length,
    `worksheet_problems=${c1.wproblems} (DTO ${ws1.problemIds.length}문항)`) && allPass;
  allPass = check('1차: 상태 PRESCRIBED', ws1row?.status === 'PRESCRIBED', `status=${ws1row?.status}`) && allPass;

  // ── 2) 채점 시뮬레이션(정답률 0.6) → 제출 + 채점항목, 워크시트 GRADED
  console.log('\n[2] simulateManualGrading (correctRate=0.6)');
  const sub = await simulateManualGrading(ws1.worksheetId, 0.6);
  const correctN = sub.items.filter((i: { correct: boolean }) => i.correct).length;
  console.log('    → submission:', sub.id, '| items:', sub.items.length, `| 정답 ${correctN}/${sub.items.length}`);
  const c2 = await counts();
  const ws1after = await prisma.labWorksheet.findUnique({ where: { id: ws1.worksheetId } });
  allPass = check('2차: 제출 생성', c2.submissions === 1, `submissions=${c2.submissions}`) && allPass;
  allPass = check('2차: 채점항목 생성', c2.gradedItems === sub.items.length, `graded_items=${c2.gradedItems}`) && allPass;
  allPass = check('2차: 워크시트 GRADED', ws1after?.status === 'GRADED', `status=${ws1after?.status}`) && allPass;

  // ── 3) 두 번째 사이클: 채점결과 먹고 진단 갱신 → 숙련도 기록 → 새 워크시트
  console.log('\n[3] runStudentCycle (채점결과 반영 → 진단 → 숙련도)');
  const ws2 = await runStudentCycle(SID);
  console.log('    → worksheetId:', ws2.worksheetId, '| problemIds:', ws2.problemIds.length);
  const c3 = await counts();
  const mastery = await loadMasteryMap(SID);
  const masteryEntries = Object.values(mastery);
  allPass = check('3차: 새 워크시트', c3.worksheets === 2, `worksheets=${c3.worksheets}`) && allPass;
  allPass = check('3차: 숙련도 기록(역방향 데이터 흐름)', masteryEntries.length > 0,
    `mastery_records=${c3.mastery}, entries=${masteryEntries.length}`) && allPass;
  if (masteryEntries.length > 0) {
    for (const m of masteryEntries) {
      const concept = await prisma.labConcept.findUnique({ where: { id: m.conceptId } });
      console.log(`      · ${concept?.name ?? m.conceptId}: score=${m.score.toFixed(3)} (관측 ${m.observationCount})`);
    }
  }

  line();
  console.log(allPass ? '🎉 P0 루프 PASS — 진단→처방→공급→채점→진단 닫힘' : '⚠️  P0 일부 단언 실패 (위 ❌ 확인)');
  line();
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('❌ 검증 중 오류:', e);
  await prisma.$disconnect();
  process.exit(1);
});
