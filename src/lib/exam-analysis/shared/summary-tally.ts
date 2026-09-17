/**
 * 분석본 summary 파생 — questions 에서 분포를 다시 센다. **summary 는 절대 독립 저장하지 않는다.**
 *
 * 원래 ai-engine.ts 안에 있었다. 선생님 교정(PATCH)도 같은 계산으로 summary 를 맞춰야 하는데,
 * 엔진은 AI SDK 를 import 해서 라우트가 가져다 쓸 수 없었다 → 순수 모듈로 이관(2026-09-17).
 * 소비처: ai-engine(분석·placeholder 재동기화) · questions PATCH(교정 후 재동기화).
 *
 * ⚠️ placeholder 삽입(fillNumberGaps / appendMissingTail)은 분포 계산 뒤에 일어나므로,
 *    삽입 후 반드시 다시 돌려야 한다. 안 그러면 `questions.length` 와
 *    `difficulty_distribution` 합이 어긋난 모순된 분석본이 저장된다.
 *
 * 난이도가 null(판독 실패)인 문항은 어느 단계에도 계상하지 않는다 — 모르는 것을 아는 척하지 않는다.
 * 따라서 분포 합 ≤ questions.length 이며, 그 차이가 곧 '미정' 문항 수다.
 *
 * 순수 함수만 — React/prisma/AI SDK 미import.
 */

import type { AnalyzedQuestion } from '../types';
import { countTypes } from './chart-axes';
import { formatDistribution } from './question-format';
import { defaultQuestionType } from './subject';

export function tallyQuestions(questions: AnalyzedQuestion[], subject: string | null | undefined) {
  const difficulty: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const q of questions) {
    if (q.difficulty != null) {
      const diff = String(q.difficulty);
      if (difficulty[diff] !== undefined) difficulty[diff]++;
    }
  }

  // 유형은 화면 차트와 **같은 함수**로 센다(CLAUDE.md #12-4) — 옛 키도 현행 영역으로 흡수된다.
  const type = countTypes(subject, questions);

  // 형식 집계는 정규화를 거친다 — 예전엔 AI 가 'Essay' 같은 변형을 주면 세 칸
  // 어디에도 안 들어가 합계가 문항 수보다 작아졌다.
  const format = formatDistribution(questions);

  return {
    difficulty,
    type,
    format,
    dominantDifficulty: Object.entries(difficulty).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '3',
    dominantType: Object.entries(type).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultQuestionType(subject),
  };
}
