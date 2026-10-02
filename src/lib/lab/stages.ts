// 🚧 수학 랩실 자동화 파이프라인 — 단계 계약 (Stage Contracts)
//
// ⚠️ 격리 규칙: CLAUDE.md "최우선 하드 경계 — Lab 서브시스템 격리" 참조.
//    이 디렉토리(src/lib/lab/**)는 기출분석 코드를 일절 import/수정하지 않는다.
//
// 각 단계는 척추(prisma Lab* 모델)에 대한 순수 함수다.
// 모든 단계는 동일 형태: { mode } + run(input) => output.
// manual↔auto 전환은 "어떤 클래스가 이 인터페이스를 구현하느냐"를 바꾸는 것뿐이다.
//   - ManualGrader  → 사람이 채점, 결과만 기록
//   - AutoGrader    → VEHME/VLM 채점
// 둘 다 Grader 계약을 만족하므로 파이프라인은 손 안 댄다.

import type { LabTrack, LabErrorType, LabGenMode } from '@prisma/client';

// ── 공유 DTO ────────────────────────────────────────

export interface MasteryEntry {
  conceptId: string;
  score: number; // 0..1
  observationCount: number;
}

export type MasteryMap = Record<string, MasteryEntry>; // conceptId → entry

export interface MasteryDelta {
  studentId: string;
  updates: MasteryEntry[]; // 변경된 개념만
}

export interface DiagnosticResult {
  conceptId: string;
  correct: boolean;
  errorType: LabErrorType;
}

export interface GradedItemDTO {
  problemId: string;
  conceptId: string;
  correct: boolean;
  partialScore?: number;
  errorType: LabErrorType;
}

export interface PrescriptionItemDTO {
  conceptId: string;
  difficulty: number; // 1..5
  count: number;
  order: number;
  reason?: string;
}

export interface PrescriptionDTO {
  studentId: string;
  items: PrescriptionItemDTO[];
  rationale?: string;
}

export interface WorksheetDTO {
  worksheetId: string;
  hwpUrl: string;
  problemIds: string[];
}

export interface ReportDTO {
  studentId: string;
  type: 'PARENT' | 'DIRECTOR';
  url: string;
  summary: Record<string, unknown>;
}

// ── 단계 계약 ───────────────────────────────────────

export interface Stage<I, O> {
  readonly mode: LabGenMode;
  run(input: I): Promise<O>;
}

// 1. 진단: 채점 결과(+선택적 진단시험) → 숙련도 갱신
export type Diagnoser = Stage<
  { studentId: string; graded: GradedItemDTO[]; diagnostic?: DiagnosticResult[] },
  MasteryDelta
>;

// 2. 처방: 숙련도 + 진도 → 처방
export type Prescriber = Stage<
  {
    studentId: string;
    mastery: MasteryMap;
    track: LabTrack;
    monthIdx: number;
    sessionIdx: number;
  },
  PrescriptionDTO
>;

// 3. 공급: 처방 → HWP 시험지
export type Supplier = Stage<{ prescription: PrescriptionDTO }, WorksheetDTO>;

// 4. 채점: 시험지 + 답안 → 문항별 정오 (기존 GradingProvider가 여기 해당)
export type Grader = Stage<
  { worksheetId: string; answerRef: string },
  { items: GradedItemDTO[] }
>;

// 5. 보고: 숙련도 변화 → 리포트
export type Reporter = Stage<
  {
    studentId: string;
    masteryDelta: MasteryDelta;
    periodStart: Date;
    periodEnd: Date;
    type: 'PARENT' | 'DIRECTOR';
  },
  ReportDTO
>;

// ── 루프 오케스트레이터 ──────────────────────────────
// 데이터는 역방향(채점→진단)으로 닫힌다.
// 한 사이클 = 채점된 제출물을 받아 → 진단 갱신 → 처방 → 다음 공급.
// (보고는 주기적으로 별도 호출)

export interface Pipeline {
  diagnoser: Diagnoser;
  prescriber: Prescriber;
  supplier: Supplier;
  grader: Grader;
  reporter: Reporter;
}

export async function runCycle(
  p: Pipeline,
  ctx: {
    studentId: string;
    graded: GradedItemDTO[];
    mastery: MasteryMap;
    track: LabTrack;
    monthIdx: number;
    sessionIdx: number;
  },
): Promise<WorksheetDTO> {
  // 진단: 이번 채점 결과로 숙련도 갱신
  const delta = await p.diagnoser.run({
    studentId: ctx.studentId,
    graded: ctx.graded,
  });
  const mastery = applyDelta(ctx.mastery, delta);

  // 처방: 갱신된 숙련도 + 진도로 다음 처방
  const prescription = await p.prescriber.run({
    studentId: ctx.studentId,
    mastery,
    track: ctx.track,
    monthIdx: ctx.monthIdx,
    sessionIdx: ctx.sessionIdx,
  });

  // 공급: 처방 → 다음 시험지
  return p.supplier.run({ prescription });
}

export function applyDelta(map: MasteryMap, delta: MasteryDelta): MasteryMap {
  const next = { ...map };
  for (const u of delta.updates) next[u.conceptId] = u;
  return next;
}
