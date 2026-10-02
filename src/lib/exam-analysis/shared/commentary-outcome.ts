import { toUserFacingError } from './error-message';

/** HTTP 성공과 총평 생성 성공은 다르다. 확장 분석은 실패도 응답 배열에 담는다. */
export function readCommentaryOutcome(raw: unknown): { completed: boolean; error: string } {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rows = Array.isArray(body.data) ? body.data : [];
  const item = rows.find((row): row is Record<string, unknown> => !!row && typeof row === 'object' && row.agentType === 'commentary');
  const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
  return {
    completed: item?.status === 'completed' && !!item.result && typeof item.result === 'object' && !Array.isArray(item.result) && Object.keys(item.result).length > 0,
    error: toUserFacingError(item?.error ?? error.message, '총평을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
  };
}
