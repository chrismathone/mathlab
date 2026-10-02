/**
 * 영어 총평 — 저장·표시·생성 계약 (클라이언트 안전: DB·AI SDK import 없음).
 *
 * ## 왜 수학 총평 필드(V3/v4_*)를 쓰지 않나
 * 수학 슬롯(등급 전략·단원 정답률·킬러 문항)에 영어를 끼워 넣으면 빈 칸을 채우라는 기존 지시가
 * 다시 살아난다. 영어는 이 파일의 계약만 저장하고, 화면·이미지 복사는 이 계약만 그린다.
 *
 * ## 저장 위치
 * 기존 `ExamAnalysisExtension(agentType='commentary').result` 한 행. 새 모델 없음.
 * 행 하나에 **마지막 성공 문서**와 **진행 중/최근 실패 상태**가 함께 산다 —
 * 실패해도 문서는 그대로 남는다(이전 성공 보존).
 *
 * ## 스냅샷
 * `context` 는 생성 당시의 시험·문항·코드 집계다. 화면과 캡처는 이 스냅샷만 쓴다.
 * 교정 후의 최신 숫자와 옛 산문을 섞지 않는다. 최신 여부는 `inputSignature` 비교로 판단한다.
 *
 * Json 필드는 런타임에 무엇이든 올 수 있다(CLAUDE.md §11) — 읽을 때는 반드시
 * `readEnglishCommentary` / `readEnglishCommentaryState` 를 거친다. 타입 캐스팅 금지.
 */
import { z } from 'zod';
import {
  SOURCE_LABELS, VERIFICATION_LABELS, TRANSFORMATION_LABELS, SUBTYPE_LABELS, THINKING_LABELS,
} from '../question-evidence';

export const ENGLISH_COMMENTARY_KIND = 'english-commentary' as const;
/** 저장 형태(스키마) 버전. 형태가 바뀌면 올린다 — 다른 값의 문서는 '구형'으로 읽는다. */
export const ENGLISH_COMMENTARY_CONTRACT = 1 as const;
/**
 * 생성 파이프라인(프롬프트·검증 규칙) 버전. 수학 `AGENT_PROMPT_VERSIONS.commentary` 와 독립.
 * 입력 서명에 포함되므로 올리면 기존 보고서에 '이전 기준' 배너가 뜬다.
 */
export const ENGLISH_COMMENTARY_VERSION = 'en-c-v1.0.0';

function enumKeys<T extends Record<string, string>>(labels: T) {
  return z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);
}
const text = z.string();
const nullableText = z.string().nullable();

// ── 스냅샷 안의 문항 근거 (question-evidence.ts 의 EnglishQuestionAnalysis 와 같은 모양) ──
// 편집용 스키마(question-evidence-schema.ts)는 교차 규칙(superRefine)으로 쓰기를 막는다.
// 여기는 **이미 정규화된 스냅샷을 읽는** 경계라 모양만 엄격히 본다.
export const snapshotEvidenceSchema = z.object({
  version: z.literal(1),
  source: z.object({
    kind: enumKeys(SOURCE_LABELS),
    title: nullableText,
    location: nullableText,
    evidence: nullableText,
    verification: enumKeys(VERIFICATION_LABELS),
  }).strict(),
  transformation: enumKeys(TRANSFORMATION_LABELS),
  transformation_evidence: nullableText,
  passage_id: nullableText,
  subtype: enumKeys(SUBTYPE_LABELS).nullable(),
  skills: z.array(text),
  thinking: enumKeys(THINKING_LABELS).nullable(),
  distractors: nullableText,
  writing_conditions: z.array(text),
  accepted_answers: nullableText,
  scoring_criteria: nullableText,
  scoring_source: nullableText,
  achievement_standards: z.array(text),
  standards_source: nullableText,
  next_practice: nullableText,
  subquestions: z.array(z.object({
    label: text,
    points: z.number().nullable(),
    conditions: z.array(text),
    scoring_criteria: nullableText,
  }).strict()),
  observation: z.object({
    respondents: z.number().int(),
    incorrect: z.number().int(),
    group: text,
    source: text,
    observed_at: nullableText,
  }).strict().nullable(),
}).strict();

const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export const QUESTION_FORMAT_KEYS = ['objective', 'short_answer', 'essay'] as const;

export const contextQuestionSchema = z.object({
  /** 원본 문항 번호 문자열 그대로("서술형2" 포함). 참조(refs)의 조인 키. */
  ref: text,
  /** 시험지 순서 (0부터) */
  order: z.number().int(),
  format: z.enum(QUESTION_FORMAT_KEYS),
  formatLabel: text,
  /** 영어 6유형 키 (grammar 등) — 화면은 typeLabel 만 쓴다 */
  type: nullableText,
  typeLabel: text,
  ability: nullableText,
  abilityLabel: text,
  topic: nullableText,
  /** 미확인은 null. 0으로 채우지 않는다. */
  points: z.number().nullable(),
  difficulty: levelSchema.nullable(),
  /** 난도의 근거 — 교사 판단 / AI 추정 / 미판독 */
  difficultyBasis: z.enum(['teacher', 'ai', 'unknown']),
  aiComment: nullableText,
  keyVocab: z.array(z.object({ word: text, meaning: nullableText }).strict()),
  keyStructures: z.array(z.object({ pattern: text, meaning: nullableText }).strict()),
  evidence: snapshotEvidenceSchema,
  /** 교사가 근거를 검토·저장했는가 */
  evidenceReviewed: z.boolean(),
  /** 세부유형 + (기술·함정·조건 중 하나 이상)이 있는가 — 해설 근거로 쓸 수 있는 문항 */
  hasDetail: z.boolean(),
  subtypeLabel: nullableText,
  thinkingLabel: nullableText,
  /** 출처가 확인된 경우만 라벨, 아니면 '미확인' */
  sourceLabel: text,
  verificationLabel: text,
  /** 원문 대조 근거가 있을 때만 라벨, 아니면 null */
  transformationLabel: nullableText,
}).strict();

const groupSchema = z.object({
  key: nullableText,
  label: text,
  count: z.number().int(),
  points: z.number(),
  /** 그룹의 모든 문항 배점이 확인됐는가 — false 면 배점 비율을 표시하지 않는다 */
  pointsComplete: z.boolean(),
  countPercent: z.number(),
  /** 분모를 모르거나 배점 미확인이 섞이면 null */
  pointsPercent: z.number().nullable(),
  questions: z.array(text),
}).strict();

const examStatsSchema = z.object({
  subjectAverage: z.number().nullable(),
  examinees: z.number().nullable(),
  standardDeviation: z.number().nullable(),
  achievement: z.object({
    A: z.number().nullable(), B: z.number().nullable(), C: z.number().nullable(),
    D: z.number().nullable(), E: z.number().nullable(),
  }).strict().nullable(),
  source: nullableText,
  enteredBy: nullableText,
  enteredAt: nullableText,
}).strict();

const rangeSchema = z.object({ min: z.number().int(), max: z.number().int() }).strict();

export const EVIDENCE_SCOPE_LABELS = {
  structure: '구조 중심',
  evidence: '문항 근거 포함',
  teacher: '교사 확인 포함',
} as const;

export const englishCommentaryContextSchema = z.object({
  contextVersion: z.literal(1),
  analysisId: text,
  exam: z.object({
    examPaperId: text,
    title: nullableText,
    schoolName: nullableText,
    grade: nullableText,
    year: nullableText,
    semester: nullableText,
    /** '중간' | '기말' | '모의' | null */
    categoryKo: nullableText,
    examCategory: z.enum(['MIDTERM', 'FINAL', 'MOCK', 'OTHER']).nullable(),
    isMock: z.boolean(),
    scopeTopics: z.array(text),
  }).strict(),
  totals: z.object({
    questionCount: z.number().int(),
    declaredQuestions: z.number().nullable(),
    declaredPoints: z.number().nullable(),
    /** 확인된 배점의 합 (미확인 문항은 더하지 않는다) */
    knownPoints: z.number(),
    unknownPointsCount: z.number().int(),
    /** 배점 비율의 분모 — 신고 만점, 없으면 전 문항 배점이 확인될 때만 그 합. 모르면 null */
    pointsDenominator: z.number().nullable(),
    completeness: z.enum(['ok', 'incomplete', 'unverifiable']).nullable(),
  }).strict(),
  formats: z.array(groupSchema),
  types: z.array(groupSchema),
  subtypes: z.array(groupSchema),
  sources: z.array(groupSchema),
  difficulty: z.object({
    /** 1~5 단계별 문항 수 */
    counts: z.array(z.number().int()).length(5),
    unknown: z.number().int(),
    teacher: z.number().int(),
    ai: z.number().int(),
  }).strict(),
  passages: z.object({
    /** 기록된 passage_id 의 종류 수 (기록 범위 안에서만 의미 있음) */
    groups: z.number().int(),
    linkedQuestions: z.number().int(),
  }).strict(),
  evidence: z.object({
    scope: z.enum(['structure', 'evidence', 'teacher']),
    scopeLabel: text,
    detailed: z.number().int(),
    reviewed: z.number().int(),
    verifiedSources: z.number().int(),
    transformationEvidenced: z.number().int(),
    scoringSourced: z.number().int(),
    observed: z.number().int(),
  }).strict(),
  flags: z.object({
    hasListening: z.boolean(),
    /** 서술형·단답형(직접 답을 쓰는 형식)이 하나라도 있는가 — 형식 기준, 영작 유형 객관식은 제외 */
    hasWrittenResponse: z.boolean(),
    hasWritingConditions: z.boolean(),
  }).strict(),
  /** 대표 문항 후보 ref (우선순위 순) — AI 는 이 안에서만 고른다 */
  candidates: z.array(text),
  limits: z.object({
    features: rangeSchema,
    representatives: rangeSchema,
    actions: rangeSchema,
  }).strict(),
  /** 학교 공지 실측 지표 — 사람이 입력한 값이 있을 때만 */
  examStats: examStatsSchema.nullable(),
  questions: z.array(contextQuestionSchema),
}).strict();

export type EnglishCommentaryContext = z.infer<typeof englishCommentaryContextSchema>;
export type EnglishCommentaryContextQuestion = z.infer<typeof contextQuestionSchema>;
export type EnglishCommentaryGroup = z.infer<typeof groupSchema>;

// ── AI 가 쓰는 산문 (구조 필드·숫자는 쓰지 않는다 — 코드가 context 에서 그린다) ──
const refs = z.array(text);
export const englishCommentaryReportSchema = z.object({
  headline: text,
  dek: text,
  overview: text,
  features: z.array(z.object({ title: text, body: text, refs }).strict()),
  /** ref 는 context.candidates 중 하나. 번호·형식·배점·함정·조건은 화면이 context 에서 표시 */
  representatives: z.array(z.object({ ref: text, demand: text, reason: text, prep: text }).strict()),
  actions: z.array(z.object({ title: text, body: text, check: text, refs }).strict()),
  conclusion: text,
}).strict();

export type EnglishCommentaryReport = z.infer<typeof englishCommentaryReportSchema>;

/** 마지막 **성공** 문서 — 화면·캡처가 그리는 유일한 대상 */
export const englishCommentaryDocumentSchema = z.object({
  kind: z.literal(ENGLISH_COMMENTARY_KIND),
  contract: z.literal(ENGLISH_COMMENTARY_CONTRACT),
  version: text,
  inputSignature: text,
  generatedAt: text,
  context: englishCommentaryContextSchema,
  report: englishCommentaryReportSchema,
  generation: z.object({ repaired: z.boolean(), durationMs: z.number() }).strict(),
  /** 재분석으로 옛 분석에서 옮겨 온 문서면 그 출처 (서명이 달라 '이전 근거' 배너가 뜬다) */
  migratedFrom: z.object({ analysisId: text, at: text }).strict().nullable(),
}).strict();

export type EnglishCommentaryDocument = z.infer<typeof englishCommentaryDocumentSchema>;

/** 진행 중 표시 — lease. token 은 소유 확인용이며 비밀이 아니다. */
export const englishCommentaryRunSchema = z.object({
  token: text,
  startedAt: text,
  inputSignature: text,
}).strict();

/**
 * 최근 실패. message 는 사용자 노출용 한국어(벤더·내부 사정 없음).
 * code: 'generation_failed' | 'input_changed' | 'not_ready' | 'superseded'
 */
export const englishCommentaryFailureSchema = z.object({
  at: text,
  message: text,
  code: text,
}).strict();

/** extension.result 에 저장되는 전체 모양. 문서 필드는 성공 이력이 없으면 비어 있다. */
export interface EnglishCommentaryStoredRow extends Partial<EnglishCommentaryDocument> {
  kind: typeof ENGLISH_COMMENTARY_KIND;
  contract: typeof ENGLISH_COMMENTARY_CONTRACT;
  run?: z.infer<typeof englishCommentaryRunSchema> | null;
  lastFailure?: z.infer<typeof englishCommentaryFailureSchema> | null;
  /** 영어 계약 이전에 저장돼 있던 구형 총평 — 새 문서가 성공하면 버린다 */
  legacy?: unknown;
}

export type EnglishCommentaryRun = z.infer<typeof englishCommentaryRunSchema>;
export type EnglishCommentaryFailure = z.infer<typeof englishCommentaryFailureSchema>;

/** lease 만료 — analyze-extended maxDuration(300초) + 여유. 지나면 다른 요청이 이어받을 수 있다. */
export const ENGLISH_COMMENTARY_LEASE_MS = 330_000;

export interface EnglishCommentaryState {
  /**
   * - empty   : 아무것도 없음
   * - legacy  : 영어 계약 이전의 구형 총평만 있음 → 재생성 안내
   * - invalid : 영어 계약 행이지만 문서가 손상됨 → 재생성 안내 (렌더 예외 없음)
   * - ready   : 유효한 문서가 있음
   * - pending : 문서는 없고 진행/실패 상태만 있음
   */
  status: 'empty' | 'legacy' | 'invalid' | 'ready' | 'pending';
  document: EnglishCommentaryDocument | null;
  running: { startedAt: string; inputSignature: string; expired: boolean } | null;
  lastFailure: EnglishCommentaryFailure | null;
  hasLegacy: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const DOCUMENT_KEYS = [
  'kind', 'contract', 'version', 'inputSignature', 'generatedAt', 'context', 'report', 'generation', 'migratedFrom',
] as const;

/** 저장 JSON → 유효한 성공 문서 또는 null. 어떤 입력에도 예외를 던지지 않는다. */
export function readEnglishCommentary(raw: unknown): EnglishCommentaryDocument | null {
  if (!isPlainObject(raw) || raw.kind !== ENGLISH_COMMENTARY_KIND) return null;
  const picked: Record<string, unknown> = {};
  for (const k of DOCUMENT_KEYS) picked[k] = raw[k];
  if (picked.migratedFrom === undefined) picked.migratedFrom = null;
  const parsed = englishCommentaryDocumentSchema.safeParse(picked);
  return parsed.success ? parsed.data : null;
}

/** 구형(수학 V3 모양) 총평인가 — 영어 계약 이전 SUPER_ADMIN 경로로 만들어진 행 */
function looksLikeLegacyCommentary(raw: Record<string, unknown>): boolean {
  return ['overall_comment', 'blog_headline', 'blog_qa', 'feature_callout', 'v4_key_questions']
    .some((k) => raw[k] !== undefined && raw[k] !== null);
}

/** 저장 JSON → 화면 상태. 어떤 입력에도 예외를 던지지 않는다. */
export function readEnglishCommentaryState(raw: unknown, now: Date = new Date()): EnglishCommentaryState {
  const empty: EnglishCommentaryState = { status: 'empty', document: null, running: null, lastFailure: null, hasLegacy: false };
  if (!isPlainObject(raw)) return empty;
  if (raw.kind !== ENGLISH_COMMENTARY_KIND) {
    return looksLikeLegacyCommentary(raw) ? { ...empty, status: 'legacy', hasLegacy: true } : empty;
  }
  const run = englishCommentaryRunSchema.safeParse(raw.run);
  const failure = englishCommentaryFailureSchema.safeParse(raw.lastFailure);
  const running = run.success
    ? {
        startedAt: run.data.startedAt,
        inputSignature: run.data.inputSignature,
        expired: isLeaseExpired(run.data.startedAt, now),
      }
    : null;
  const document = raw.contract === ENGLISH_COMMENTARY_CONTRACT ? readEnglishCommentary(raw) : null;
  const hasLegacy = raw.legacy !== undefined && raw.legacy !== null;
  const hasDocumentFields = raw.report !== undefined || raw.context !== undefined;
  const status: EnglishCommentaryState['status'] = document
    ? 'ready'
    : hasDocumentFields || raw.contract !== ENGLISH_COMMENTARY_CONTRACT
      ? 'invalid'
      : hasLegacy
        ? 'legacy'
        : running || failure.success
          ? 'pending'
          : 'empty';
  return { status, document, running, lastFailure: failure.success ? failure.data : null, hasLegacy };
}

export function isLeaseExpired(startedAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(startedAt);
  return !Number.isFinite(t) || now.getTime() - t > ENGLISH_COMMENTARY_LEASE_MS;
}

/** 문서가 현재 입력 기준과 다른가 (교정·재분석·버전 변경) — 화면의 '이전 근거' 배너 판단 */
export function isEnglishCommentaryStale(document: EnglishCommentaryDocument, currentSignature: string): boolean {
  return document.inputSignature !== currentSignature;
}
