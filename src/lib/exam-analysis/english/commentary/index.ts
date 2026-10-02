/**
 * 영어 총평 — **클라이언트 안전** 진입점 (DB·AI SDK import 없음).
 * 서버 전용: `./generate`(AI 호출), `./service`(저장·lease), `./prisma-store`(Prisma 어댑터).
 */
export * from './schema';
export {
  buildEnglishCommentaryContext, checkEnglishCommentaryReadiness, representativeCap,
  SMALL_EXAM_MAX_QUESTIONS, MAX_REPRESENTATIVE_CANDIDATES, MAX_ACTIONS,
  type EnglishCommentaryInput, type EnglishCommentaryReadiness,
} from './context';
export { englishCommentarySignature, stableStringify } from './signature';
export { validateEnglishCommentaryReport, FIELD_LENGTHS, TOTAL_LENGTH } from './validate';
export { migrateEnglishCommentaryForReanalysis } from './migrate';
