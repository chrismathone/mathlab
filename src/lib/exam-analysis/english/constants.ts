/**
 * 영어 기출 분석 상수 — 수학 파이프라인과 공유하지 않는 영어 전용 정의.
 * 2026-08 과목 분리: 옛 constants.ts 에서 행 단위로 잘라냈다. **값은 한 글자도 바꾸지 않았다.**
 * 여기에 수학 키를 넣지 말 것.
 */

// ── 프롬프트 버전 ──
// en-v1.1.0: 교과서 레슨 출제범위
// en-v1.2.0: 내신 지필고사는 원칙적으로 듣기 없음. 대화문은 communication/reading.
// en-v1.3.0: 문항 코멘트는 쉬운 한국어 (호혜적·함축·환언·스캔 품질 등 금지)
// key_vocab / key_structures 는 영어 학습 대책용 선택 필드. 분류 규칙 변경이 아니라서 버전은 유지.
// en-v1.4.0: 난이도 기준 단일화 — 공용 프레임의 수학 기준(90%+·개념결합·식변형·번호위치)과
//            DIFFICULTY_SYSTEM_FRAMEWORK 를 제거하고 영어 루브릭 하나만 남김.
//            H12 평가 축을 어휘·구문·추론·지문량·선지함정·친숙도로 교체, H14 는 번호 대신 유형 기준.
// en-v1.5.0: 문항별 근거·소문항 보존, 내신/모의 문맥 분리, 추정 난도와 실측 분리.
export const ENGLISH_PROMPT_VERSION = 'en-v1.5.0';

// ── 영어 문항 유형 (내신 6유형) — 수학 TYPE_TO_STANDARD 와 분리 ──
export const ENGLISH_QUESTION_TYPES = {
  GRAMMAR: { label: '어법', labelEn: 'Grammar' },
  VOCABULARY: { label: '어휘', labelEn: 'Vocabulary' },
  READING: { label: '독해', labelEn: 'Reading' },
  LISTENING: { label: '듣기', labelEn: 'Listening' },
  WRITING: { label: '서술·영작', labelEn: 'Writing' },
  COMMUNICATION: { label: '의사소통', labelEn: 'Communication' },
} as const;

export const ENGLISH_QUESTION_TYPE_KEYS = [
  'grammar', 'vocabulary', 'reading', 'listening', 'writing', 'communication',
] as const;

/** 내신 화면 기본 축 — 듣기는 문항이 있을 때만 범례/레이더에 합류. */
export const ENGLISH_NAESIN_TYPE_KEYS = ENGLISH_QUESTION_TYPE_KEYS.filter(
  (k) => k !== 'listening',
) as Exclude<(typeof ENGLISH_QUESTION_TYPE_KEYS)[number], 'listening'>[];

export type EnglishQuestionTypeKey = (typeof ENGLISH_QUESTION_TYPE_KEYS)[number];

export const ENGLISH_QUESTION_TYPE_LABELS: Record<string, string> = {
  grammar: '어법',
  vocabulary: '어휘',
  reading: '독해',
  listening: '듣기',
  writing: '서술·영작',
  communication: '의사소통',
};

/** Gemini raw → 영어 6유형. 수학 TYPE_TO_STANDARD 에 영어 키를 넣지 말 것. */
export const ENGLISH_TYPE_TO_STANDARD: Record<string, string> = {
  grammar: 'grammar',
  어법: 'grammar',
  문법: 'grammar',
  grammar_error: 'grammar',
  vocabulary: 'vocabulary',
  vocab: 'vocabulary',
  어휘: 'vocabulary',
  reading: 'reading',
  독해: 'reading',
  reading_main_idea: 'reading',
  reading_detail: 'reading',
  reading_inference: 'reading',
  listening: 'listening',
  듣기: 'listening',
  writing: 'writing',
  영작: 'writing',
  서술형: 'writing',
  sentence_completion: 'writing',
  communication: 'communication',
  회화: 'communication',
  대화: 'communication',
  conversation: 'communication',
};

export const ENGLISH_ABILITY_DOMAINS = {
  ACCURACY: { label: '정확성', labelEn: 'Accuracy', color: '#3B82F6' },
  UNDERSTANDING: { label: '이해력', labelEn: 'Understanding', color: '#10B981' },
  REASONING: { label: '추론력', labelEn: 'Reasoning', color: '#8B5CF6' },
  EXPRESSION: { label: '표현력', labelEn: 'Expression', color: '#F97316' },
} as const;

export const ENGLISH_ABILITY_KEYS = ['accuracy', 'understanding', 'reasoning', 'expression'] as const;

export const ENGLISH_ABILITY_DOMAIN_LABELS: Record<string, string> = {
  accuracy: '정확성',
  understanding: '이해력',
  reasoning: '추론력',
  expression: '표현력',
};

export const ENGLISH_ABILITY_DOMAIN_COLORS: Record<string, string> = {
  accuracy: ENGLISH_ABILITY_DOMAINS.ACCURACY.color,
  understanding: ENGLISH_ABILITY_DOMAINS.UNDERSTANDING.color,
  reasoning: ENGLISH_ABILITY_DOMAINS.REASONING.color,
  expression: ENGLISH_ABILITY_DOMAINS.EXPRESSION.color,
};

export const ENGLISH_TYPE_TO_DOMAIN: Record<string, string> = {
  grammar: 'accuracy',
  vocabulary: 'accuracy',
  reading: 'understanding',
  listening: 'understanding',
  writing: 'expression',
  communication: 'expression',
};

/** 프롬프트용 6유형 표. prompt-config-english 의 ENGLISH_EVALUATION_SYSTEM(내신 이원화)과 다름. */
export const ENGLISH_TYPE_TAXONOMY = `📊 **영어 평가 유형 분류:**

| 유형 | 설명 |
|------|------|
| grammar | 어법/문법 |
| vocabulary | 어휘 |
| reading | 독해 |
| listening | 듣기 (시험지에 듣기 전용 문항이 명시된 경우) |
| writing | 서술형/영작 |
| communication | 의사소통 |

**분류 규칙:** 대화문·회화 지문은 communication 또는 reading. listening은 시험지에 듣기 전용 문항이 명시된 경우에만. 내신·모의고사 모두 시험지의 실제 구성을 확인한다.`;

export const ENGLISH_QUESTION_STRATEGIES_INLINE = `📝 **영어 문항 유형별 분석 전략:**

- **어법(grammar)**: 밑줄 친 부분의 문법 요소 파악, 준동사/시제/수일치 등
- **어휘(vocabulary)**: 문맥상 의미 파악, 동의어/반의어
- **독해(reading)**: 주제, 요지, 제목, 빈칸, 순서, 삽입, 요약
- **듣기(listening)**: 시험지에 듣기 전용 문항이 명시된 경우만
- **서술형(writing)**: 문장 완성, 영작, 조건 영작
- **의사소통(communication)**: 대화문·상황 표현 (듣기가 아님)`;

// ── 문항 유형 색상 (UI용) — 영어 몫 ──
export const ENGLISH_QUESTION_TYPE_COLORS: Record<string, string> = {
  // 영어 (별도 체계)
  grammar: '#6366F1',
  vocabulary: '#8B5CF6',
  reading: '#EC4899',
  listening: '#14B8A6',
  writing: '#F59E0B',
  communication: '#06B6D4',
};
