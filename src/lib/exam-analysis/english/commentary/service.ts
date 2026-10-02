/**
 * 영어 총평 실행·저장 — **서버 전용**. 저장소는 주입(`EnglishCommentaryStore`)이라 가짜 어댑터로 검증한다.
 *
 * 흐름
 *  1. 입력 로드 → readiness(서버) 차단 → 컨텍스트·서명
 *  2. 같은 서명의 유효 문서가 있고 강제 재생성이 아니면 그대로 반환(cached)
 *  3. lease 획득 — 기존 행의 lastRunAt 을 CAS 조건으로 써서 **한 건만** 진행. 진행 중이면 AI 호출 없이 in_progress
 *  4. 생성(본 1 + 보완 1)
 *  5. 저장 — `store.finalize` 한 번의 원자 구간 안에서 재확인과 쓰기를 함께 한다.
 *     (운영 어댑터: 짧은 트랜잭션에서 분석·시험지 행을 FOR SHARE 로 잠그고 최신 입력을 다시 읽은 뒤
 *      extension 을 CAS 갱신 — 재확인과 쓰기 사이에 교정이 끼어들 틈이 없다. LLM 호출은 트랜잭션 밖.)
 *     행이 사라졌거나(재분석) lease 소유가 바뀌었거나(만료 후 인계) 재분석 중이거나 입력 서명이 바뀌었으면(교정) 문서를 쓰지 않는다
 *  6. 성공: 문서 교체 + errorMessage=null / 실패: **이전 문서 보존** + lastFailure·errorMessage 갱신
 *
 * 수학 경로(BaseAgent 폴백·metadata·v4 병합)는 쓰지 않는다. 새 Prisma 모델 없음.
 */
import {
  ENGLISH_COMMENTARY_CONTRACT, ENGLISH_COMMENTARY_KIND, ENGLISH_COMMENTARY_VERSION,
  englishCommentaryDocumentSchema, readEnglishCommentaryState,
  type EnglishCommentaryDocument, type EnglishCommentaryFailure, type EnglishCommentaryStoredRow,
} from './schema';
import { buildEnglishCommentaryContext, checkEnglishCommentaryReadiness, type EnglishCommentaryInput } from './context';
import { englishCommentarySignature } from './signature';
import type { EnglishCommentaryGeneration, GenerateTextFn } from './generate';
import type { EnglishCommentaryContext } from './schema';

export interface EnglishCommentaryRowSnapshot {
  id: string;
  result: unknown;
  lastRunAt: Date | null;
  errorMessage: string | null;
}

export interface EnglishCommentaryRowWrite {
  result: EnglishCommentaryStoredRow;
  lastRunAt: Date;
  lastRunBy: string | null;
  /** undefined = 바꾸지 않음 */
  errorMessage?: string | null;
}

export interface EnglishCommentaryLoaded {
  input: EnglishCommentaryInput;
  /** 그 시험지의 최신 분석인가 */
  isLatest: boolean;
  /** 시험지가 재분석 중인가 (ExamPaper.status === 'ANALYZING') */
  reanalyzing: boolean;
}

/** finalize 가 잠근 상태에서 넘겨주는 현재 상태 */
export interface EnglishCommentaryFinalizeView {
  /** 다시 읽은 최신 입력. 분석이 사라졌거나 영어가 아니면 null */
  fresh: EnglishCommentaryLoaded | null;
  row: EnglishCommentaryRowSnapshot | null;
}

/** finalize 의 결정 — write 가 null 이면 아무것도 쓰지 않는다. 쓰기는 CAS(rowId + lastRunAt) */
export interface EnglishCommentaryFinalizeDecision {
  write: { rowId: string; expectedLastRunAt: Date | null; data: EnglishCommentaryRowWrite } | null;
}

/** 저장소 — 운영은 prisma-store.ts, 검증은 메모리 가짜 */
export interface EnglishCommentaryStore {
  /** 분석이 없거나 영어가 아니면 null */
  loadInput(analysisId: string): Promise<EnglishCommentaryLoaded | null>;
  getRow(analysisId: string): Promise<EnglishCommentaryRowSnapshot | null>;
  /** 행이 없을 때만 생성. 동시에 다른 요청이 먼저 만들었으면(유니크 충돌) null */
  createRow(analysisId: string, data: EnglishCommentaryRowWrite): Promise<EnglishCommentaryRowSnapshot | null>;
  /** id 와 lastRunAt 이 기대값과 같을 때만 갱신(CAS). 조건 불일치·행 없음이면 null */
  casUpdate(rowId: string, expectedLastRunAt: Date | null, data: EnglishCommentaryRowWrite): Promise<EnglishCommentaryRowSnapshot | null>;
  /**
   * **원자 구간**: 입력·행을 다시 읽고(`view`) → `decide` → 결정된 CAS 쓰기까지 한 번에.
   * 운영 어댑터는 이 구간 동안 분석·시험지 행을 잠가 교정·재분석 쓰기가 끼어들지 못하게 한다.
   * `decide` 는 동기 순수 함수여야 한다(구간을 짧게). 쓰지 않았거나 CAS 가 실패하면 written=null.
   */
  finalize(
    analysisId: string,
    decide: (view: EnglishCommentaryFinalizeView) => EnglishCommentaryFinalizeDecision,
  ): Promise<{ written: EnglishCommentaryRowSnapshot | null }>;
}

export type EnglishCommentaryRunCode =
  | 'completed' | 'cached' | 'in_progress' | 'not_ready' | 'not_found'
  | 'input_changed' | 'superseded' | 'generation_failed';

/** OrchestratorResult 와 같은 모양 + 판정 코드 (route 가 HTTP 상태로 옮긴다) */
export interface EnglishCommentaryRunResult {
  agentType: 'commentary';
  status: 'completed' | 'failed';
  result: unknown;
  /** 사용자 노출 한국어 */
  error?: string;
  code: EnglishCommentaryRunCode;
}

type GenerateFn = (
  ctx: EnglishCommentaryContext,
  opts?: { generateText?: GenerateTextFn },
) => Promise<EnglishCommentaryGeneration>;

export interface RunEnglishCommentaryParams {
  analysisId: string;
  userId?: string | null;
  forceRegenerate?: boolean;
  store?: EnglishCommentaryStore;
  /** 생성 함수 주입 (기본: generateEnglishCommentary) */
  generate?: GenerateFn;
  /** 생성 함수에 넘길 텍스트 게이트웨이 주입 (테스트용) */
  generateText?: GenerateTextFn;
  now?: () => Date;
  newToken?: () => string;
}

export const ENGLISH_COMMENTARY_MESSAGES = {
  notFound: '분석 결과를 찾을 수 없습니다',
  inProgress: '이미 총평을 만드는 중입니다. 완료 후 다시 확인해 주세요',
  inputChanged: '생성하는 동안 문항 정보가 바뀌어 저장하지 않았습니다. 다시 생성해 주세요',
  superseded: '더 최신 분석 또는 요청이 있어 이번 결과는 저장하지 않았습니다',
  notReady: (reasons: string[]) => `총평을 만들기 전에 확인할 항목이 있습니다: ${reasons.join(' · ')}`,
  unexpected: '총평 생성 중 오류가 발생했습니다. 다시 시도해 주세요',
} as const;

function defaultToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 기존 행 결과 → 영어 행 기반. 영어 행이면 그대로(문서·legacy 보존),
 * 구형(수학 모양) 총평이면 legacy 로 감싸 보존, 그 외는 빈 영어 행.
 */
function baseRow(existing: unknown): EnglishCommentaryStoredRow {
  if (isPlainObject(existing) && existing.kind === ENGLISH_COMMENTARY_KIND) {
    return { ...(existing as unknown as EnglishCommentaryStoredRow), kind: ENGLISH_COMMENTARY_KIND, contract: ENGLISH_COMMENTARY_CONTRACT };
  }
  const row: EnglishCommentaryStoredRow = { kind: ENGLISH_COMMENTARY_KIND, contract: ENGLISH_COMMENTARY_CONTRACT };
  if (isPlainObject(existing) && Object.keys(existing).length > 0) row.legacy = existing;
  return row;
}

function runToken(raw: unknown): string | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.run)) return null;
  return typeof raw.run.token === 'string' ? raw.run.token : null;
}

async function defaultStore(): Promise<EnglishCommentaryStore> {
  return (await import('./prisma-store')).prismaEnglishCommentaryStore;
}
async function defaultGenerate(): Promise<GenerateFn> {
  return (await import('./generate')).generateEnglishCommentary;
}

export async function runEnglishCommentary(params: RunEnglishCommentaryParams): Promise<EnglishCommentaryRunResult> {
  const { analysisId, userId = null, forceRegenerate = false } = params;
  const store = params.store ?? await defaultStore();
  const generate = params.generate ?? await defaultGenerate();
  const now = params.now ?? (() => new Date());
  const newToken = params.newToken ?? defaultToken;
  const fail = (code: EnglishCommentaryRunCode, error: string, result: unknown = null): EnglishCommentaryRunResult =>
    ({ agentType: 'commentary', status: 'failed', result, error, code });

  // ── 1. 입력 · readiness · 서명 ──
  const loaded = await store.loadInput(analysisId);
  if (!loaded) return fail('not_found', ENGLISH_COMMENTARY_MESSAGES.notFound);
  if (!loaded.isLatest || loaded.reanalyzing) return fail('superseded', ENGLISH_COMMENTARY_MESSAGES.superseded);
  const readiness = checkEnglishCommentaryReadiness(loaded.input);
  if (!readiness.ready) return fail('not_ready', ENGLISH_COMMENTARY_MESSAGES.notReady(readiness.reasons));
  const ctx = buildEnglishCommentaryContext(loaded.input);
  const signature = englishCommentarySignature(ctx);

  // ── 2. 캐시 · 진행 중 ──
  const row = await store.getRow(analysisId);
  const state = readEnglishCommentaryState(row?.result, now());
  if (state.running && !state.running.expired) return fail('in_progress', ENGLISH_COMMENTARY_MESSAGES.inProgress, row?.result ?? null);
  if (!forceRegenerate && state.document && state.document.inputSignature === signature) {
    return { agentType: 'commentary', status: 'completed', result: row?.result ?? null, code: 'cached' };
  }

  // ── 3. lease 획득 (CAS) ──
  const token = newToken();
  const startedAt = now();
  const leaseResult: EnglishCommentaryStoredRow = {
    ...baseRow(row?.result),
    run: { token, startedAt: startedAt.toISOString(), inputSignature: signature },
  };
  const leased = row
    ? await store.casUpdate(row.id, row.lastRunAt, { result: leaseResult, lastRunAt: startedAt, lastRunBy: userId })
    : await store.createRow(analysisId, { result: leaseResult, lastRunAt: startedAt, lastRunBy: userId, errorMessage: null });
  if (!leased) return fail('in_progress', ENGLISH_COMMENTARY_MESSAGES.inProgress);

  // ── 4. 생성 ──
  let generation: EnglishCommentaryGeneration;
  try {
    generation = await generate(ctx, params.generateText ? { generateText: params.generateText } : undefined);
  } catch (e) {
    console.error('[en-commentary] 생성 중 예외:', e);
    generation = { ok: false, code: 'llm_error', message: ENGLISH_COMMENTARY_MESSAGES.unexpected, errors: [], attempts: 0, durationMs: 0 };
  }

  // ── 5·6. 원자 저장 — 재확인과 쓰기를 store.finalize 한 구간에서 ──
  const finishedAt = now();
  const at = finishedAt.toISOString();
  let document: EnglishCommentaryDocument | null = null;
  let generationFailure: EnglishCommentaryFailure | null = null;
  if (generation.ok) {
    const candidate: EnglishCommentaryDocument = {
      kind: ENGLISH_COMMENTARY_KIND,
      contract: ENGLISH_COMMENTARY_CONTRACT,
      version: ENGLISH_COMMENTARY_VERSION,
      inputSignature: signature,
      generatedAt: at,
      context: ctx,
      report: generation.report,
      generation: { repaired: generation.repaired, durationMs: generation.durationMs },
      migratedFrom: null,
    };
    // 저장 전 스키마 재검증 — 계약을 통과하지 못한 문서는 '완료'로 남기지 않는다
    if (englishCommentaryDocumentSchema.safeParse(candidate).success) document = candidate;
    else {
      console.error('[en-commentary] 저장 문서가 계약을 통과하지 못함 — 저장하지 않음');
      generationFailure = { at, message: ENGLISH_COMMENTARY_MESSAGES.unexpected, code: 'generation_failed' };
    }
  } else {
    generationFailure = { at, message: generation.message, code: 'generation_failed' };
  }

  // decide 는 잠긴 구간 안에서 동기로 실행된다 — 판정 결과를 여기에 남긴다
  const verdict: { code: EnglishCommentaryRunCode; message: string } = {
    code: 'superseded', message: ENGLISH_COMMENTARY_MESSAGES.superseded,
  };
  const decide = ({ fresh, row: current }: EnglishCommentaryFinalizeView): EnglishCommentaryFinalizeDecision => {
    if (!current || runToken(current.result) !== token) {
      // 재분석으로 행이 지워졌거나, lease 가 만료돼 다른 요청이 이어받았다 — 그쪽 결과를 덮지 않는다
      verdict.code = 'superseded';
      verdict.message = ENGLISH_COMMENTARY_MESSAGES.superseded;
      return { write: null };
    }
    const released: EnglishCommentaryStoredRow = { ...baseRow(current.result), run: null };
    const failWrite = (failure: EnglishCommentaryFailure, code: EnglishCommentaryRunCode): EnglishCommentaryFinalizeDecision => {
      verdict.code = code;
      verdict.message = failure.message;
      return {
        write: {
          rowId: current.id,
          expectedLastRunAt: current.lastRunAt,
          data: { result: { ...released, lastFailure: failure }, lastRunAt: finishedAt, lastRunBy: userId, errorMessage: failure.message },
        },
      };
    };
    if (!fresh || !fresh.isLatest || fresh.reanalyzing) {
      return failWrite({ at, message: ENGLISH_COMMENTARY_MESSAGES.superseded, code: 'superseded' }, 'superseded');
    }
    // 잠근 상태에서 다시 읽은 입력으로 서명 대조 — 교정이 끼어들 틈 없이 쓰기와 같은 구간
    if (englishCommentarySignature(buildEnglishCommentaryContext(fresh.input)) !== signature) {
      return failWrite({ at, message: ENGLISH_COMMENTARY_MESSAGES.inputChanged, code: 'input_changed' }, 'input_changed');
    }
    if (!document) {
      return failWrite(generationFailure ?? { at, message: ENGLISH_COMMENTARY_MESSAGES.unexpected, code: 'generation_failed' }, 'generation_failed');
    }
    verdict.code = 'completed';
    return {
      write: {
        rowId: current.id,
        expectedLastRunAt: current.lastRunAt,
        // 새 문서 성공 → 구형 총평(legacy)·최근 실패는 버린다
        data: { result: { ...document, run: null, lastFailure: null }, lastRunAt: finishedAt, lastRunBy: userId, errorMessage: null },
      },
    };
  };

  let written: EnglishCommentaryRowSnapshot | null;
  try {
    ({ written } = await store.finalize(analysisId, decide));
  } catch (e) {
    // 잠금 대기 초과·교착 감지 등 — 아무것도 쓰지 않았다. lease 는 만료(330초) 후 인계된다
    console.error('[en-commentary] 저장 구간 실패:', e);
    return fail('generation_failed', ENGLISH_COMMENTARY_MESSAGES.unexpected);
  }
  if (!written) return fail('superseded', ENGLISH_COMMENTARY_MESSAGES.superseded);
  if (verdict.code === 'completed') {
    return { agentType: 'commentary', status: 'completed', result: written.result, code: 'completed' };
  }
  return fail(verdict.code, verdict.message, written.result);
}
