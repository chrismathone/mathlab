/**
 * 영어 총평 입력 서명 — 서버(저장)와 화면(비교)이 **같은 함수**를 쓴다(§12-4).
 * 클라이언트 안전(순수 함수, crypto 불필요).
 *
 * 서명 대상 = 생성에 실제로 들어간 입력 전부:
 *   시험 식별·범위·회차, analysisId, 문항 번호·형식·유형·능력·topic·배점·난도(+근거)·정규화 근거·
 *   ai_comment·어휘·구문, 신고 만점/문항수·완결성, 학교 공지 지표, 파이프라인 버전.
 * 라벨·집계처럼 위 값에서 파생되는 것은 넣지 않는다 — 문구 수정만으로 모든 보고서가 '이전 근거'로 뜨지 않게.
 * ai_comment 도 생성 입력이므로 포함한다(2차 합의).
 */
import type { EnglishCommentaryContext } from './schema';
import { ENGLISH_COMMENTARY_VERSION } from './schema';

/** 키 순서를 정규화한 JSON — 객체 키는 정렬, 배열 순서는 보존, undefined 키는 생략 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** cyrb53 — 53비트 비암호 해시. 변경 감지용이며 보안 용도가 아니다. */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 서명에 들어가는 입력만 추린다 (테스트에서도 사용) */
export function englishCommentarySignatureInput(ctx: EnglishCommentaryContext): unknown {
  return {
    version: ENGLISH_COMMENTARY_VERSION,
    analysisId: ctx.analysisId,
    exam: ctx.exam,
    totals: {
      declaredQuestions: ctx.totals.declaredQuestions,
      declaredPoints: ctx.totals.declaredPoints,
      completeness: ctx.totals.completeness,
    },
    examStats: ctx.examStats,
    questions: ctx.questions.map((q) => ({
      ref: q.ref,
      format: q.format,
      type: q.type,
      ability: q.ability,
      topic: q.topic,
      points: q.points,
      difficulty: q.difficulty,
      difficultyBasis: q.difficultyBasis,
      aiComment: q.aiComment,
      keyVocab: q.keyVocab,
      keyStructures: q.keyStructures,
      evidence: q.evidence,
      evidenceReviewed: q.evidenceReviewed,
    })),
  };
}

export function englishCommentarySignature(ctx: EnglishCommentaryContext): string {
  const s = stableStringify(englishCommentarySignatureInput(ctx));
  return `en1:${cyrb53(s, 0).toString(16)}${cyrb53(s, 0x9e3779b1).toString(16)}:${s.length.toString(36)}`;
}
