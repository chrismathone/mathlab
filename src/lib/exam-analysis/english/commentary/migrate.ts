/**
 * 재분석 이관 — 재분석은 기존 ExamAnalysis 를 지우고(Cascade 로 총평 행도 삭제) 새로 만든다.
 * 직전 **유효한** 영어 보고서를 새 분석으로 옮겨 붙여, 재분석 한 번에 보고서를 잃지 않게 한다.
 * 옮긴 문서의 inputSignature 는 옛 analysisId 기준이라 새 분석과 서명이 달라 '이전 근거' 배너가 뜬다.
 * 진행 중 lease·최근 실패는 옮기지 않는다. 구형(수학 모양) 총평·손상 문서는 옮기지 않는다.
 * 클라이언트 안전(순수 함수).
 */
import { readEnglishCommentary, type EnglishCommentaryStoredRow } from './schema';

export function migrateEnglishCommentaryForReanalysis(
  previousResult: unknown,
  fromAnalysisId: string,
  at: Date = new Date(),
): EnglishCommentaryStoredRow | null {
  const document = readEnglishCommentary(previousResult);
  if (!document) return null;
  return {
    ...document,
    migratedFrom: { analysisId: fromAnalysisId, at: at.toISOString() },
    run: null,
    lastFailure: null,
  };
}
