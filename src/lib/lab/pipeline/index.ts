// 🚧 Lab P0 — 파이프라인 조립
//   전 단계 MANUAL(시스템 = 기록기). manual↔auto 플립은 이 객체의 필드 1개를
//   다른 구현체로 교체하는 것뿐 — runCycle/서비스는 손대지 않는다.
//   예) P1: grader: manualGrader → autoGrader
import type { Pipeline } from '../stages';
import { manualDiagnoser } from './manual-diagnoser';
import { dumbPrescriber } from './dumb-prescriber';
import { manualSupplier } from './manual-supplier';
import { manualGrader } from './manual-grader';
import { manualReporter } from './manual-reporter';

export const p0Pipeline: Pipeline = {
  diagnoser: manualDiagnoser,
  prescriber: dumbPrescriber,
  supplier: manualSupplier,
  grader: manualGrader,
  reporter: manualReporter,
};

export {
  manualDiagnoser,
  dumbPrescriber,
  manualSupplier,
  manualGrader,
  manualReporter,
};
