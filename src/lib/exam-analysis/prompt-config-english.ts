// 영어 과목 프롬프트 설정
// topic 카탈로그: docs/planning/english-exam-data/ (2026-08-26 수집)
// 영역은 내신 분류용 문법/어휘/독해/듣기. 2022 교육과정 공식 영역은 이해/표현.

export const ENGLISH_TOPICS: Record<string, Record<string, string[]>> = {
  "중1": {
    "문법": [
      "be동사 (am, is, are)",
      "일반동사 (현재시제)",
      "일반동사 (과거시제)",
      "There is/are",
      "의문문",
      "명령문",
      "감탄문",
      "현재진행형",
      "조동사 (can, will)",
      "to부정사 (명사적 용법)",
      "비인칭 주어 it",
      "동명사",
      "감각동사",
      "비교급",
      "접속사 (when, that)",
      "수여동사",
      "관사 (a, an, the)",
      "형용사, 부사",
      "전치사",
    ],
    "어휘": [
      "교육과정 기본 어휘",
    ],
    "독해": [
      "세부 정보 파악",
      "주제·요지",
      "대화문",
      "안내문·실용문",
      "일기·편지",
    ],
    "듣기": [
      "세부 정보 파악",
      "기초 대화",
    ],
  },
  "중2": {
    "문법": [
      "to부정사 (명사적·형용사적·부사적 용법)",
      "too ~ to / enough to",
      "동명사",
      "접속사",
      "비교급, 최상급",
      "조동사 (can, may, must, should, will)",
      "현재진행형, 과거진행형",
      "문장 형식",
    ],
    "어휘": [
      "교육과정 기본 어휘",
    ],
    "독해": [
      "세부 정보 파악",
      "문맥상 어휘",
      "논리적 관계",
    ],
    "듣기": [
      "세부 정보 파악",
    ],
  },
  "중3": {
    "문법": [
      "관계대명사 (who, which, that)",
      "현재완료",
      "수동태",
      "분사 (현재분사, 과거분사)",
      "간접의문문",
      "관계부사",
    ],
    "어휘": [
      "교육과정 기본 어휘",
    ],
    "독해": [
      "주제·요지",
      "필자 의도·심정",
      "함축적 의미",
    ],
    "듣기": [
      "의도·목적 파악",
    ],
  },
  "고1": {
    "문법": [
      "가정법 과거, 과거완료",
      "분사구문",
      "명사절",
      "부사절",
      "형용사절 (관계대명사 심화)",
      "관계부사",
      "강조, 도치",
      "시제 일치·완료시제 심화",
    ],
    "어휘": [
      "교육과정 기본 어휘 (공통영어)",
    ],
    "독해": [
      "세부 정보 파악",
      "주제·요지",
      "함축적 의미",
      "글의 구조",
      "빈칸 추론 (단어·구)",
    ],
    "듣기": [
      "세부 정보 파악",
    ],
  },
  "고2": {
    "문법": [
      "복합 관계사",
      "가정법 도치",
      "병렬구조",
    ],
    "어휘": [
      "문맥상 적절한 어휘",
    ],
    "독해": [
      "빈칸 추론",
      "글의 순서",
      "문장 삽입",
      "요약문",
      "실용문",
    ],
    "듣기": [
      "맥락·목적 파악",
    ],
  },
  "고3": {
    "문법": [
      "준동사 종합",
      "복합 구문",
    ],
    "어휘": [
      "함축적 의미",
    ],
    "독해": [
      "빈칸 추론",
      "함축적 의미",
      "장문 독해",
      "글의 구조",
    ],
    "듣기": [
      "맥락·목적 파악",
    ],
  },
};


// ============================================================
// 영어 난이도 시스템 (정량 기준 포함)
// ============================================================

export const ENGLISH_DIFFICULTY_SYSTEM_4LEVEL = `🚨 **영어 난이도 5단계 시스템 (언어 능력·사고 기준)**

**핵심 원칙: 문제를 푸는데 필요한 사고의 깊이와 언어 능력으로 판단!**
**난이도 값은 반드시 문자열 "1", "2", "3", "4", "5" 중 하나를 사용하세요.**

### 1️⃣ "1" (기본) - 기초 언어 지식과 직접 정보 확인
**정의**: 기초 문법 규칙, 교과서 필수 어휘, 지문에 직접 언급된 정보

**문법 예시**:
- be동사와 일반동사 구분
- 3인칭 단수 -s
- 기본 시제 (현재/과거/미래)
- 단순 의문문/부정문

**어휘 예시**:
- 교과서 본문 어휘 (굵은 글씨, 단어장 수록)
- 일상 기본 어휘 (가족, 학교, 음식)

**독해 예시**:
- 주제문이 첫 문장/마지막 문장에 명시적
- 지문에 답이 그대로 있음 (Not, True 문제)
- 대화문에서 직접 언급된 정보

**판정 키워드**: "직접 언급", "기본 문법", "교과서 어휘", "명시적"

---

### 2️⃣ "2" (표준) - 문맥 이해와 익숙한 규칙 적용
**정의**: 중급 문법 적용, 문맥 기반 추론, 2-3문장 연결 필요

**문법 예시**:
- to부정사 vs 동명사 구분 (enjoy + 동명사)
- 관계대명사 격 선택 (who/whom/which)
- 시제 일치 (주절 과거 → 종속절 과거완료)
- 수동태 vs 능동태 구분

**어휘 예시**:
- 문맥상 의미 추론 (동의어 선택)
- 비슷한 단어 구분 (borrow vs lend)

**독해 예시**:
- 환언된 정보 찾기 (paraphrase)
- 2-3문장 연결 추론
- 빈칸에 적절한 단어/구 (기본)

**판정 키워드**: "문맥 파악", "문법 적용", "유형 문제", "추론 1-2단계"

---

### 3️⃣ "3" (응용) - 여러 정보 연결과 문법 적용
**정의**: 문맥 기반 응용, 문법 복합 적용, 환언/연결 추론

**문법 예시**:
- 준동사 종합 (to부정사+동명사+분사 선택)
- 시제 일치 + 조건절 복합
- 관계사 + 수동태 결합

**어휘 예시**:
- 문맥 기반 다의어 구분 (run: 달리다/운영하다)
- 숙어/관용 표현 응용

**독해 예시**:
- 빈칸에 적절한 구/절 (중급)
- 3문장 이상 연결 추론
- 글의 요지/주제 파악 (비명시적)

**판정 키워드**: "응용", "복합 적용", "문맥 추론", "연결 파악"

---

### 4️⃣ "4" (심화) - 복합 추론과 까다로운 조건 적용
**정의**: 복합 구문 해석, 다단계 추론, 필자 의도/함축 의미 파악

**문법 예시**:
- 분사구문 (시간/이유/양보 판단)
- 관계사 + 분사 중첩 구문
- 가정법 (현실 반대 상황 이해)
- 도치 구문 (부정어 도치, 강조 구문)

**어휘 예시**:
- 다의어 문맥 판단 (run: 달리다/운영하다/흐르다)
- 함축적 의미 (긍정적/부정적 뉘앙스)

**독해 예시**:
- 수능형 빈칸 추론 (문단 전체 흐름 파악)
- 글의 순서 배열, 문장 삽입
- 필자의 태도/어조 파악
- 3문장 이상 종합 추론

**판정 키워드**: "추론 필요", "함축 의미", "복합 구문", "다단계 논리"

---

### 5️⃣ "5" (최고난도) - 복합 언어 능력과 여러 단계의 추론
**정의**: 수능 33-34번급 고난도, 복합 추론 + 어휘 + 구문 동시 요구

**문법 예시**:
- 준동사 종합 (to부정사+동명사+분사 중첩)
- 복합 관계사 + 가정법 + 분사구문 결합
- 고난도 어법 (특수 구문 연속)

**어휘 예시**:
- 추상적 어휘 (perspective, implication, nuance)
- 학술적 표현 (empirical, paradigm, hypothesis)

**독해 예시**:
- 장문 독해 (20문장 이상, 2지문 연계)
- 고난도 빈칸 (전체 논지 + 세부 + 어휘 모두 필요)
- 함축적 주제 (행간 의미, 비판적 독해)
- 복잡한 논리 구조 (역설, 반전, 다층 추론)

**판정 키워드**: "복합 능력", "고난도", "수능 최상위", "창의적 사고"

---

## 난이도 판정 시 체크리스트

1. **문법**: 기본 규칙 → "1" / 복합 적용 → "2" / 응용 결합 → "3" / 구문 분석 → "4" / 중첩 구조 → "5"
2. **어휘**: 교과서 필수 → "1" / 문맥 추론 → "2" / 응용·숙어 → "3" / 다의어·함축 → "4" / 추상·학술 → "5"
3. **독해**: 직접 언급 → "1" / 환언·연결 → "2" / 요지·비명시적 → "3" / 빈칸·순서·태도 → "4" / 장문·복합 → "5"
4. **난도별 문항 수를 강제하지 않는다**: 시험별 구성이 다르므로 5단계 문항 수를 미리 정하지 않는다.

## 경계선 판단 기준

- **"1" ↔ "2"**: 문맥 파악 필요 여부가 핵심
  - 단순 규칙 적용만으로 풀림 → "1"
  - 문맥/상황 판단 필요 → "2"

- **"2" ↔ "3"**: 응용/결합 여부가 핵심
  - 단일 패턴 적용 → "2"
  - 복합 적용 또는 응용 → "3"

- **"3" ↔ "4"**: 추론 단계 수가 핵심
  - 2단계 이하 추론 → "3"
  - 3단계 이상 또는 복합 구문 → "4"

- **"4" ↔ "5"**: 복합도와 출제 의도가 핵심
  - 수능 일반 문항 수준 → "4"
  - 수능 최상위 변별 문항 (33-34번) → "5"`;


// ============================================================
// 영어 흔한 실수 가이드 (학년별 상세화)
// ============================================================

export interface EnglishMistake {
  category: string;
  examples: string[];
  reason: string;
  strategy: string;
  related_grammar: string;
}

export const ENGLISH_COMMON_MISTAKES: Record<string, EnglishMistake[]> = {
  "중1": [
    {
      category: "be동사/일반동사 혼용",
      examples: [
        "❌ I am like pizza → ✅ I like pizza",
        "❌ She is plays tennis → ✅ She plays tennis",
        "❌ They are go to school → ✅ They go to school",
      ],
      reason: "be동사 문장에서는 일반동사를 쓰지 않음",
      strategy: "'be동사 문장에는 일반동사 X' 원칙 암기",
      related_grammar: "be동사, 일반동사",
    },
    {
      category: "3인칭 단수 -s 누락",
      examples: [
        "❌ He play soccer → ✅ He plays soccer",
        "❌ She study English → ✅ She studies English",
        "❌ It work well → ✅ It works well",
      ],
      reason: "3인칭 단수 주어일 때 동사에 -(e)s 필수",
      strategy: "주어 확인 → 3인칭 단수면 -s 추가",
      related_grammar: "일반동사 현재시제",
    },
    {
      category: "과거시제 불규칙 동사",
      examples: [
        "❌ I goed to school → ✅ I went to school",
        "❌ She eated lunch → ✅ She ate lunch",
        "❌ They buyed books → ✅ They bought books",
      ],
      reason: "불규칙 동사는 과거형이 따로 있음",
      strategy: "불규칙 동사 50개 암기 (go-went-gone, eat-ate-eaten 등)",
      related_grammar: "과거시제",
    },
    {
      category: "의문문 어순 오류",
      examples: [
        "❌ You are happy? → ✅ Are you happy?",
        "❌ He is a student? → ✅ Is he a student?",
        "❌ They can swim? → ✅ Can they swim?",
      ],
      reason: "의문문은 be동사/조동사를 주어 앞으로",
      strategy: "의문사/be동사/조동사 + 주어 + ... 어순 암기",
      related_grammar: "의문문",
    },
  ],
  "중2": [
    {
      category: "to부정사/동명사 혼동",
      examples: [
        "❌ I enjoy to read → ✅ I enjoy reading",
        "❌ She finished to study → ✅ She finished studying",
        "❌ He wants going → ✅ He wants to go",
      ],
      reason: "동사마다 to부정사 또는 동명사만 가능",
      strategy: "'메가펍스드' 암기 (mind, enjoy, give up, avoid, put off, finish, stop, deny)",
      related_grammar: "to부정사, 동명사",
    },
    {
      category: "비교급 이중 사용",
      examples: [
        "❌ more bigger → ✅ bigger",
        "❌ more better → ✅ better",
        "❌ most easiest → ✅ easiest",
      ],
      reason: "more/most와 -er/-est 동시 사용 금지",
      strategy: "1음절 -er, 3음절↑ more, 예외 암기 (good-better-best)",
      related_grammar: "비교급, 최상급",
    },
    {
      category: "조동사 뒤 동사원형 미사용",
      examples: [
        "❌ She can plays → ✅ She can play",
        "❌ He must goes → ✅ He must go",
        "❌ They will studying → ✅ They will study",
      ],
      reason: "조동사 뒤는 항상 동사원형",
      strategy: "can, will, must, should + 동사원형 철저히",
      related_grammar: "조동사",
    },
  ],
  "중3": [
    {
      category: "관계대명사 격 오류",
      examples: [
        "❌ The man which I saw → ✅ The man who(m) I saw",
        "❌ The book who I read → ✅ The book which/that I read",
      ],
      reason: "선행사가 사람이면 who, 사물이면 which",
      strategy: "선행사 확인 → 사람 who, 사물 which, 둘 다 that",
      related_grammar: "관계대명사",
    },
    {
      category: "현재완료 vs 과거시제",
      examples: [
        "❌ I have went yesterday → ✅ I went yesterday",
        "❌ She has seen him last week → ✅ She saw him last week",
        "❌ Have you finished it just now? → ✅ Did you finish it just now?",
      ],
      reason: "과거 특정 시점(yesterday, last week)은 과거시제",
      strategy: "ago, yesterday, last → 과거 / just, already, yet → 현재완료",
      related_grammar: "현재완료, 과거시제",
    },
    {
      category: "수동태 by 생략 불가",
      examples: [
        "❌ The book was written. (행위자 중요 시) → ✅ The book was written by him.",
        "❌ English is spoke → ✅ English is spoken",
      ],
      reason: "행위자가 중요하면 by 필수, 과거분사 형태 정확히",
      strategy: "be + p.p. 공식, 행위자 중요도 판단",
      related_grammar: "수동태",
    },
  ],
  "고1": [
    {
      category: "가정법 시제 혼동",
      examples: [
        "❌ If I am rich, I would buy a car → ✅ If I were rich, I would buy a car",
        "❌ If she studied, she will pass → ✅ If she had studied, she would have passed",
      ],
      reason: "가정법 과거: 현재 사실 반대, 가정법 과거완료: 과거 사실 반대",
      strategy: "현재 반대 → If S + 과거, S + would + 원형 / 과거 반대 → If S + 과거완료, S + would have p.p.",
      related_grammar: "가정법",
    },
    {
      category: "분사구문 의미 오해",
      examples: [
        "분사구문이 시간인지 이유인지 양보인지 문맥으로 판단 필요",
        "Being tired (이유) vs Having finished (시간) 구분",
      ],
      reason: "분사구문은 접속사 생략되어 의미가 모호",
      strategy: "문맥으로 판단, 필요시 접속사 복원해보기",
      related_grammar: "분사구문",
    },
  ],
  "고2": [
    {
      category: "문맥상 어휘 오답",
      examples: [
        "❌ He is very interested (X, 문맥상 interesting 필요할 수도)",
        "영향을 주다: affect vs influence 뉘앙스 차이",
      ],
      reason: "비슷한 의미 단어의 뉘앙스 차이",
      strategy: "문맥 전체 읽고 긍정/부정, 강도 차이 파악",
      related_grammar: "어휘",
    },
    {
      category: "수능형 함정 선지",
      examples: [
        "부분만 맞는 선지 (일부 맞지만 전체는 틀림)",
        "극단적 표현 (all, never, always, only) 주의",
      ],
      reason: "매력적 오답이 정답처럼 보임",
      strategy: "전체 흐름 파악 후 선지 검증, 극단 표현 경계",
      related_grammar: "독해 전략",
    },
  ],
  "고3": [
    {
      category: "수능 빈칸 추론 오류",
      examples: [
        "부분만 보고 판단 → 전체 논지 파악 필요",
        "첫 문장만 읽고 선택 → 마지막 문장까지 확인",
      ],
      reason: "빈칸은 전체 흐름과 핵심 주제를 반영",
      strategy: "주제 파악 → 빈칸 전후 문맥 → 선택지 소거",
      related_grammar: "독해 추론",
    },
    {
      category: "장문 독해 시간 부족",
      examples: [
        "20문장 이상 지문을 끝까지 읽다가 시간 소진",
        "불필요한 세부사항까지 정독",
      ],
      reason: "스캐닝/스키밍 전략 부족",
      strategy: "주제문 먼저, 세부는 문제 나올 때 찾기",
      related_grammar: "독해 전략",
    },
  ],
};


// ============================================================
// 영작/서술형 채점 가이드
// ============================================================

export const ENGLISH_WRITING_GUIDE = `📝 **영작/서술형 채점 축**

고정 비율(40/30/20/10 등)은 고시되어 있지 않다. 문항 채점표의 배점을 따른다.
교육과정이 허용한 쓰기 평가 요소 중 해당 문항에 쓰인 축만 본다.

1. **내용 / 과업 완성도** — 조건·필수 정보 충족
2. **정확성** — 시제, 수일치, 어순, 준동사
3. **글의 조직** — 문단 이상일 때만 (연결·흐름)
4. 필요 시 **적절성**, **철자·구두점**

현장 루브릭의 최소 구조는 **내용(과제) + 언어 형식(정확성)** 이다.
단답형·완성형은 서술형으로 분류하지 않는다.

---

## 내신에서 자주 보이는 서술 유형 (가중치는 문항 채점표)

1. **단어 배열·문장 완성** — 주어진 단어를 빠짐없이, 문법적으로 완전한 문장
2. **조건 영작** — 지정 구조·단어 수·보기 변형을 모두 충족
3. **어법 고쳐 쓰기**
4. **요약·주제 문장** (표현 과업)

감점 폭은 학교 채점표의 칸 배점을 따른다. 일률 %를 추정하지 말 것.

## 흔한 오류 (정확성 축)

- 주어-동사 수 불일치: He play → He plays
- 시제: I go yesterday → I went yesterday
- 관사: I have dog → I have a dog
- to부정사/동명사: enjoy to read → enjoy reading
- 조동사 뒤 원형: can plays → can play`;


// ============================================================
// 헬퍼 함수: 영어 학년별 선택적 포함
// ============================================================

/** 학년에 맞는 영어 토픽만 반환 (토큰 절감) */
export function getEnglishTopicsForGrade(gradeLevel: string | null | undefined): string {
  if (!gradeLevel || !(gradeLevel in ENGLISH_TOPICS)) {
    // 학년 미지정 시 전체 개괄만 반환
    return `
[영어 토픽 분류]
문법, 어휘, 독해, 듣기 영역으로 구분됩니다.
학년에 따라 세부 토픽이 달라집니다.
`;
  }

  const topics = ENGLISH_TOPICS[gradeLevel];
  const lines: string[] = [`\n[${gradeLevel} 영어 토픽]`];

  for (const [category, items] of Object.entries(topics)) {
    lines.push(`\n**${category}**:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

/** 학년에 맞는 영어 실수 유형만 반환 */
export function getEnglishMistakesForGrade(gradeLevel: string | null | undefined): string {
  if (!gradeLevel || !(gradeLevel in ENGLISH_COMMON_MISTAKES)) {
    return "";
  }

  const mistakes = ENGLISH_COMMON_MISTAKES[gradeLevel];
  const lines: string[] = [`\n**${gradeLevel} 주요 실수 유형:**\n`];

  mistakes.forEach((mistake, idx) => {
    lines.push(`${idx + 1}. **${mistake.category}**`);
    lines.push(`   - 이유: ${mistake.reason}`);
    lines.push(`   - 전략: ${mistake.strategy}`);
    lines.push(`   - 예시:`);
    for (const example of mistake.examples) {
      lines.push(`     ${example}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/** 영작/서술형 문항이 있을 때만 가이드 반환 */
export function getEnglishWritingGuideIfNeeded(hasEssay: boolean): string {
  return hasEssay ? ENGLISH_WRITING_GUIDE : "";
}
