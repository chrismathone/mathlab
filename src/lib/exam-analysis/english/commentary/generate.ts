/**
 * 영어 총평 생성 — **서버 전용** (AI 게이트웨이 import).
 *
 * 규칙 (2차 합의)
 * - 본 생성 1회 + 검증 실패 시 보완 1회까지만. 그 이상 재시도하지 않는다.
 * - 잘린 응답은 부분 복구하지 않고 실패로 처리한다(수학 extractJson 의 partial 복구를 쓰지 않는다).
 * - BaseAgent 의 규칙 기반 폴백을 쓰지 않는다 — 실패는 실패로 돌려준다.
 * - provider/model 선택은 shared/commentary-llm 그대로 (여기서 바꾸지 않는다).
 * - 테스트는 `generateText` 를 주입한다. 실제 호출은 하지 않는다.
 */
import { generateText as defaultGenerateText, type LlmTextRequest, type LlmTextResult } from '../../shared/commentary-llm';
import { toUserFacingError } from '../../shared/error-message';
import { englishCommentaryReportSchema, type EnglishCommentaryContext, type EnglishCommentaryReport } from './schema';
import { validateEnglishCommentaryReport } from './validate';
import {
  buildEnglishCommentaryRepairPrompt, buildEnglishCommentarySystemPrompt, buildEnglishCommentaryUserPrompt,
} from './prompt';

export type GenerateTextFn = (req: LlmTextRequest) => Promise<LlmTextResult>;

/** 한글 본문 2,000~3,500자 + JSON 오버헤드 — §12-1 (본문 작성형 최소 16,384) */
export const ENGLISH_COMMENTARY_MAX_TOKENS = 16384;
const TEMPERATURE = 0.4;

export type EnglishCommentaryGeneration =
  | { ok: true; report: EnglishCommentaryReport; repaired: boolean; attempts: number; durationMs: number }
  | {
      ok: false;
      /** truncated: 출력 상한 도달 / invalid: 검증 2회 실패 / llm_error: 호출 자체 실패 */
      code: 'truncated' | 'invalid' | 'llm_error';
      /** 사용자 노출 한국어 */
      message: string;
      /** 서버 로그·테스트용 검증 오류 */
      errors: string[];
      attempts: number;
      durationMs: number;
    };

const MESSAGES = {
  truncated: '총평 응답이 끝까지 완성되지 않았습니다. 잠시 후 다시 생성해 주세요',
  invalid: '총평이 품질 기준을 통과하지 못했습니다. 다시 생성해 주세요',
  llm_error: '총평 생성에 실패했습니다. 잠시 후 다시 시도해 주세요',
} as const;

/** 문자열 정리 — 공백 정규화. 산문은 단락 없이 한 덩어리로 렌더한다 */
function clean(v: unknown): unknown {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v;
}
function toRef(v: unknown): unknown {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : v;
}
function cleanRefs(v: unknown): unknown {
  return Array.isArray(v) ? [...new Set(v.map(toRef))] : v;
}

/**
 * 모델 원문 → 보고서 + 오류 목록. 예외를 던지지 않는다.
 * 숫자 ref 는 문자열로만 바꾼다(그 외 의미 보정은 하지 않는다 — 고칠 것은 검증기가 보완 요청으로 돌려보낸다).
 */
export function parseEnglishCommentaryResponse(
  ctx: EnglishCommentaryContext,
  text: string,
): { report: EnglishCommentaryReport | null; errors: string[] } {
  const unfenced = text.replace(/```(?:json)?/g, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return { report: null, errors: ['JSON 객체 하나만 출력하세요 (객체를 찾지 못했습니다)'] };

  let raw: unknown;
  try {
    raw = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return { report: null, errors: ['올바른 JSON 이 아닙니다 — 따옴표·쉼표를 확인하고 JSON 객체 하나만 출력하세요'] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { report: null, errors: ['JSON 객체 하나만 출력하세요'] };
  }

  const r = raw as Record<string, unknown>;
  const coerced = {
    headline: clean(r.headline),
    dek: clean(r.dek),
    overview: clean(r.overview),
    features: Array.isArray(r.features)
      ? r.features.map((f) => (f && typeof f === 'object' && !Array.isArray(f)
        ? { title: clean((f as Record<string, unknown>).title), body: clean((f as Record<string, unknown>).body), refs: cleanRefs((f as Record<string, unknown>).refs) }
        : f))
      : r.features,
    representatives: Array.isArray(r.representatives)
      ? r.representatives.map((p) => (p && typeof p === 'object' && !Array.isArray(p)
        ? {
            ref: toRef((p as Record<string, unknown>).ref),
            demand: clean((p as Record<string, unknown>).demand),
            reason: clean((p as Record<string, unknown>).reason),
            prep: clean((p as Record<string, unknown>).prep),
          }
        : p))
      : r.representatives,
    actions: Array.isArray(r.actions)
      ? r.actions.map((a) => (a && typeof a === 'object' && !Array.isArray(a)
        ? {
            title: clean((a as Record<string, unknown>).title),
            body: clean((a as Record<string, unknown>).body),
            check: clean((a as Record<string, unknown>).check),
            refs: cleanRefs((a as Record<string, unknown>).refs),
          }
        : a))
      : r.actions,
    conclusion: clean(r.conclusion),
  };

  const parsed = englishCommentaryReportSchema.safeParse(coerced);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(전체)'}: 형식이 맞지 않습니다 — ${i.message}`);
    return { report: null, errors };
  }
  return { report: parsed.data, errors: validateEnglishCommentaryReport(ctx, parsed.data) };
}

export async function generateEnglishCommentary(
  ctx: EnglishCommentaryContext,
  opts: { generateText?: GenerateTextFn; now?: () => number } = {},
): Promise<EnglishCommentaryGeneration> {
  const generate = opts.generateText ?? defaultGenerateText;
  const now = opts.now ?? Date.now;
  const started = now();
  const system = buildEnglishCommentarySystemPrompt(ctx);
  const elapsed = () => now() - started;

  let attempts = 0;
  let lastErrors: string[] = [];
  let draft = '';

  for (const phase of ['initial', 'repair'] as const) {
    const user = phase === 'initial'
      ? buildEnglishCommentaryUserPrompt(ctx)
      : buildEnglishCommentaryRepairPrompt(ctx, draft, lastErrors);
    let res: LlmTextResult;
    attempts += 1;
    try {
      res = await generate({
        label: phase === 'initial' ? 'en-commentary' : 'en-commentary-repair',
        system,
        user,
        maxTokens: ENGLISH_COMMENTARY_MAX_TOKENS,
        temperature: TEMPERATURE,
        json: true,
      });
    } catch (e) {
      console.error(`[en-commentary] ${phase} 호출 실패:`, e);
      return {
        ok: false, code: 'llm_error', message: toUserFacingError(e, MESSAGES.llm_error),
        errors: [], attempts, durationMs: elapsed(),
      };
    }
    if (res.truncated) {
      // 잘린 JSON 은 복구하지 않는다 — 뒤쪽 섹션이 빠진 보고서가 '완성'으로 저장되는 것을 막는다
      console.warn(`[en-commentary] ${phase} 출력 상한 도달 — 저장하지 않음`);
      return { ok: false, code: 'truncated', message: MESSAGES.truncated, errors: ['출력이 잘렸습니다'], attempts, durationMs: elapsed() };
    }
    const { report, errors } = parseEnglishCommentaryResponse(ctx, res.text);
    if (report && errors.length === 0) {
      return { ok: true, report, repaired: phase === 'repair', attempts, durationMs: elapsed() };
    }
    draft = res.text;
    lastErrors = errors;
    console.warn(`[en-commentary] ${phase} 검증 실패 ${errors.length}건:`, errors.slice(0, 10));
  }

  return { ok: false, code: 'invalid', message: MESSAGES.invalid, errors: lastErrors, attempts, durationMs: elapsed() };
}
