/**
 * 영어 기출 분석 프롬프트 빌더 — 영어 전용.
 *
 * 2026-08 과목 분리: 옛 prompt-builder.ts 에서 영어 가지만 남기고 분기를 접었다.
 * **프롬프트 텍스트는 한 글자도 바꾸지 않았다.**
 *
 * 이 파일은 영어 만 책임진다. 다른 과목 키를 넣지 말 것.
 * 공통 하네스·조립 순서는 `../shared/prompt-frame` 에 있다.
 */

import {
  POINTS_VALIDATION_RULES,
  EXAM_SUBJECT_CLASSIFICATION,
  SCHOOL_LEVEL_RULES,
} from '../prompt-config-common';
import {
  ENGLISH_DIFFICULTY_SYSTEM_4LEVEL,
  getEnglishTopicsForGrade,
  getEnglishMistakesForGrade,
  getEnglishWritingGuideIfNeeded,
} from '../prompt-config-english';
import { ENGLISH_QUESTION_STRATEGIES_INLINE, ENGLISH_TYPE_TAXONOMY } from './constants';
import { formatEnglishAllowedTopicsPrompt, getEnglishAllowedTopicValues } from '../english-topics';
import { describeEnglishExamScope } from '../english-textbooks';
import { combinePrompts, getPaperTypeInstructions } from '../shared/prompt-frame';
import type { ExamContext, BuildPromptResponse } from '../types';
import { englishEvidencePrompt } from './question-evidence-prompt';

/** H3~H4 — 영어 전용 하드 제약 (공통 프레임에 주입) */
const HARD_CONSTRAINTS = `H3. 영어 유형(question_type)은 **정확히** 다음 6개 중 하나: grammar | vocabulary | reading | listening | writing | communication. 그 외 값 금지.
   - 대화문·회화 지문만으로 듣기로 분류하지 않는다. communication 또는 reading으로 분류한다.
   - listening은 시험지에 듣기 전용 문항이 명시된 경우에만.
H4. 능력(ability_domain)은 **정확히** 다음 4개 중 하나: accuracy | understanding | reasoning | expression. 대문자, 한글, 기타 값 금지.`;

/** V3~V5, V14 — 영어 전용 자기검증 (공통 프레임에 주입) */
const SELF_VERIFY = `V3. 모든 question_type 값이 6개 허용값 내인가? (grammar/vocabulary/reading/listening/writing/communication)
V4. 모든 ability_domain 값이 4개 허용값 내인가? (accuracy/understanding/reasoning/expression)
V5. 지문·선지에 raw LaTeX/\`$...$\` 를 넣지 않았는가?
V14. key_vocab / key_structures 는 해당 문항에 실제로 나온 표현만인가? 없으면 빈 배열 [] 인가?`;

/**
 * H11~H14 — **영어 내신 전용** 난이도 기준.
 *
 * 공용 프레임에 있던 수학 기준(정답률 90%+, 개념 결합 수, 식 변형, 추상도, 번호 위치)이
 * 영어 루브릭(85%+, 어법·독해 축)과 정면 충돌해 한 프롬프트에 경계 두 벌이 들어가 있었다
 * (적대적 리뷰 1.3). 경계는 ENGLISH_DIFFICULTY_SYSTEM_4LEVEL 한 곳만 쓰도록 위임한다.
 */
const DIFFICULTY_RULES = `────────────────────────────────────────────────
📊 H11~H14. 난이도(difficulty) 기준 — 영어 문항
────────────────────────────────────────────────
H11. **5단계는 위 "영어 난이도 5단계 시스템"의 언어 능력·사고 요구를 기준으로 판단한다.**
   실제 응답 자료가 없으므로 AI 추정 난도이며 정답률을 생성하지 않는다.

H12. **난이도는 다음 6개 축으로 종합 판단** — 한 축만 보지 말 것:
   ① **어휘 수준**: 교과서 필수어 ↔ 문맥 추론이 필요한 다의어·관용구
   ② **구문 복잡도**: 단문 ↔ 관계절·분사구문·도치 등 중첩 구조
   ③ **추론 단계**: 지문에 그대로 있음 ↔ 두 문장 이상을 엮어야 답이 나옴
   ④ **지문 길이·정보량**: 짧은 대화 ↔ 여러 단락 + 세부정보 대조
   ⑤ **선지 함정**: 오답이 명백 ↔ 지문 일부만 맞는 매력적 오답
   ⑥ **친숙도**: 교과서에 나온 그대로 ↔ 처음 보는 소재·변형

H13. **분포를 강제하지 않는다.** 각 문항의 근거에 따라 독립적으로 판단한다.
   - 난도를 모르면 null. 문항 수나 유형만으로 높은 난도를 부여하지 않는다.
   - 특정 학교의 정답률·변별력·서술형 비중을 추정하지 않는다.

H14. **문항 유형별 경향 (참고용)** — 강제 아니지만 의심 신호:
   - 단순 어법·어휘 문항이 4~5단계? → 의심 (보통 기본 확인)
   - 빈칸 추론·순서·삽입·조건 영작이 1~2단계? → 의심 (보통 다단계 추론)
   - ⚠️ 영어 내신은 유형별로 묶어 출제하는 경우가 많아 **번호 위치보다 유형**이 신호다.
     위 신호가 발생하면 추론 단계와 어휘·구문 수준을 다시 점검할 것`;

/** V10~V11 — 영어 기준 자기검증 (번호 위치 대신 문항 유형으로 판단) */
const DIFFICULTY_SELF_VERIFY = `V10. **난이도 근거 검증** — 분포를 맞추기 위해 난도를 바꾸지 않았는가? 실제 정답률을 지어내지 않았는가?
V11. **난이도 유형 검증** — 어법·어휘 문항이 모두 4단계 이상? 또는 빈칸 추론·영작이 모두 1~2단계? H14 신호 점검 후 재평가했는가?`;

export class EnglishExamPromptBuilder {
  /** 전체 프롬프트를 조립하여 반환한다. */
  static build(context: ExamContext): BuildPromptResponse {
    const base = this.getBasePrompt(context);
    const { guidelines, paperType, schema } = this.collectParts(context);

    const combined = combinePrompts(
      { base, guidelines, paperType, schema },
      {
        hardConstraints: HARD_CONSTRAINTS,
        selfVerify: SELF_VERIFY,
        difficultyRules: DIFFICULTY_RULES,
        difficultySelfVerify: DIFFICULTY_SELF_VERIFY,
      },
    );

    return {
      base_prompt: base,
      analysis_guidelines: guidelines.join('\n\n'),
      error_patterns_prompt: null,
      examples_prompt: null,
      combined_prompt: combined,
      used_templates: this.collectUsedTemplates(context),
      matched_problem_types: this.collectMatchedProblemTypes(),
    };
  }

  /**
   * DB 템플릿 + 에러 패턴을 포함한 확장 빌드 (async).
   */
  static async buildWithDbContext(context: ExamContext): Promise<BuildPromptResponse> {
    // 기본 빌드
    const result = this.build(context);

    try {
      const { prisma } = await import('@/lib/db');

      // DB 템플릿 조회 (활성, 최신 버전)
      const dbTemplate = await prisma.examPromptTemplate.findFirst({
        where: {
          subject: 'ENGLISH',
          agentType: 'basic',
          isActive: true,
        },
        orderBy: { version: 'desc' },
      });

      // DB 에러 패턴 조회
      const errorPatterns = await prisma.examErrorPattern.findMany({
        where: {
          subject: 'ENGLISH',
          isActive: true,
        },
        orderBy: { frequency: 'desc' },
        take: 10,
      });

      // 에러 패턴 프롬프트 구성
      let errorPatternsPrompt: string | null = null;
      if (errorPatterns.length > 0) {
        const patternLines = errorPatterns.map(p =>
          `- **${p.name}** (${p.errorType}, 빈도: ${p.frequency}): ${p.feedbackMessage || p.description}`
        ).join('\n');
        errorPatternsPrompt = `⚠️ **알려진 오류 패턴 (분석 시 참고):**\n\n${patternLines}`;
      }

      // DB 템플릿이 있으면 base_prompt 교체
      if (dbTemplate) {
        const customBase = dbTemplate.template;
        result.base_prompt = customBase;
        // ⚠️ combined_prompt 도 **반드시** 다시 조립한다.
        //    실제 AI 호출은 combined_prompt 하나만 쓰는데(analyze/route.ts) 예전에는
        //    base_prompt·used_templates 만 바꿔서, 관리자는 템플릿이 적용됐다고 믿지만
        //    분석은 코드 기본값 그대로였다 (적대적 리뷰 1.9).
        result.combined_prompt = this.assembleCombined(context, customBase);
        result.used_templates.push(`DB:${dbTemplate.name}(v${dbTemplate.version})`);
      }

      if (errorPatternsPrompt) {
        result.error_patterns_prompt = errorPatternsPrompt;
        // combined_prompt에도 에러 패턴 추가
        result.combined_prompt = result.combined_prompt + '\n\n' + errorPatternsPrompt;
      }

      // 승인된 레퍼런스 조회 (같은 grade, 최대 5건)
      const approvedRefs = await prisma.examQuestionReference.findMany({
        where: {
          subject: 'ENGLISH',
          reviewStatus: 'approved',
          ...(context.grade_level ? { grade: context.grade_level } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (approvedRefs.length > 0) {
        const refLines = approvedRefs.map(r =>
          `- 단원: ${r.topicHierarchy || r.grade}, 난이도: ${r.difficulty}, 유형: ${r.questionType}${r.confidence && r.confidence < 0.7 ? ' (주의: 분석 시 주의 필요)' : ''}`
        ).join('\n');
        result.combined_prompt += `\n\n📚 **[참고 레퍼런스 문제]:**\n\n${refLines}`;
      }

      // ⚠️ 범주형 혼동 few-shot 경고 주입 — 비활성(2026-06-02).
      // 자가진화 자동반영 전면 정지 방침에 따라 누적 교정→프롬프트 자동 주입 중단.
      // 누적 교정은 측정 벤치마크로만 사용(/admin/evolution). 복원 필요 시 git 이력 참조.
    } catch {
      // DB 접근 실패 시 기본 빌드 결과 그대로 반환
    }

    return result;
  }

  /** 기본 시스템 프롬프트 (역할 정의) */
  private static getBasePrompt(context: ExamContext): string {
    const gradeInfo = context.grade_level ? ` (${context.grade_level})` : '';
    const categoryInfo = context.category ? ` — ${context.category}` : '';

    return `당신은 한국 중·고등학교 **영어 시험지 분석 전문가**입니다${gradeInfo}${categoryInfo}.

주어진 시험지 이미지를 분석하여 각 문항의 난이도, 유형, 단원, 배점을 정확히 판별합니다.
분석 결과는 반드시 지정된 JSON 형식으로만 출력하세요.

**핵심 원칙:**
1. 큰 문항은 빠짐없이 한 번씩 분석. 소문항 (1)(2)의 배점·조건은 english_analysis.subquestions에 보존하고 부모와 중복 집계하지 않는다.
2. 난이도는 5단계 시스템("1"~"5")을 엄격히 적용
3. topic 형식: "과목명 > 대단원 > 소단원" (공백 포함 > 구분)
4. ai_comment: 정확히 2문장, 존댓말(~입니다/~합니다), 각 문장 20~40자
5. confidence: 0.0~1.0 (불확실하면 낮게)`;
  }

  /**
   * 프롬프트에 실제로 들어가는 블록을 **이름과 함께** 만든다.
   *
   * 이 하나가 프롬프트 본문(`getAnalysisGuidelines`)과 진단용 목록(`collectUsedTemplates`)의
   * 공통 출처다. 예전엔 둘이 따로 적혀 있어서, 넣지도 않은 `ENGLISH_EVALUATION_SYSTEM`/
   * `ENGLISH_QUESTION_STRATEGIES` 를 썼다고 보고하고 실제 주입한 `ENGLISH_TYPE_TAXONOMY`/
   * `ENGLISH_QUESTION_STRATEGIES_INLINE` 은 빠뜨렸다. 난이도 표 이름도 실제(_4LEVEL)와
   * 다른 `_5LEVEL` 로 기록됐다 (적대적 리뷰 3.4).
   * 진단 metadata 가 틀리면 "무엇으로 분석했는가"를 되짚을 수 없다.
   */
  private static getGuidelineBlocks(context: ExamContext): Array<{ name: string; text: string }> {
    const blocks: Array<{ name: string; text: string }> = [];

    // 공통 규칙
    blocks.push({ name: 'SCHOOL_LEVEL_RULES', text: SCHOOL_LEVEL_RULES });
    blocks.push({ name: 'EXAM_SUBJECT_CLASSIFICATION', text: EXAM_SUBJECT_CLASSIFICATION });
    blocks.push({ name: 'POINTS_VALIDATION_RULES', text: POINTS_VALIDATION_RULES });

    // 영어 전용 가이드라인 — 공통 프레임워크 + 영어 루브릭 (기존 유지, 별도 지시 전까지 불변)
    // 세 번째 난이도 기준을 넣지 않는다 — DIFFICULTY_SYSTEM_FRAMEWORK 는 옛 개념-수 정의 +
    // "애매하면 한 단계 낮게" 하향 편향이라 영어 루브릭과 충돌한다
    // (수학도 v1.4.0 에서 같은 이유로 제외했다). 영어의 유일한 기준은 아래 한 장이다.
    blocks.push({ name: 'ENGLISH_DIFFICULTY_SYSTEM_4LEVEL', text: ENGLISH_DIFFICULTY_SYSTEM_4LEVEL });
    blocks.push({ name: 'ENGLISH_TYPE_TAXONOMY', text: ENGLISH_TYPE_TAXONOMY });
    blocks.push({ name: 'ENGLISH_QUESTION_STRATEGIES_INLINE', text: ENGLISH_QUESTION_STRATEGIES_INLINE });
    blocks.push({ name: 'ENGLISH_QUESTION_EVIDENCE', text: englishEvidencePrompt(context.exam_category) });

    // 학년별 토픽
    const topics = getEnglishTopicsForGrade(context.grade_level);
    if (topics) {
      blocks.push({ name: 'ENGLISH_TOPICS', text: `📖 **영어 단원 분류표:**\n\n${topics}` });
    }

    // 학년별 흔한 실수
    const mistakes = getEnglishMistakesForGrade(context.grade_level);
    if (mistakes) {
      blocks.push({ name: 'ENGLISH_COMMON_MISTAKES', text: `⚠️ **흔한 실수 유형:**\n\n${mistakes}` });
    }

    // 영어 서술형 가이드
    const writingGuide = getEnglishWritingGuideIfNeeded(context.has_essay);
    if (writingGuide) {
      blocks.push({ name: 'ENGLISH_WRITING_GUIDE', text: writingGuide });
    }

    return blocks.filter(b => b.text.trim() !== '');
  }

  /** 학년별 분석 가이드라인 조합 */
  private static getAnalysisGuidelines(context: ExamContext): string[] {
    return this.getGuidelineBlocks(context).map(b => b.text);
  }

  /** 요구 JSON 스키마 출력 */
  static getJsonSchema(paperType: string, gradeLevel: string | null): string {
    const isStudent = paperType === 'student';

    // 문항 유형 분류 키
    const typeKeys = '"grammar", "vocabulary", "reading", "listening", "writing", "communication"';

    // 난이도 키
    const difficultyKeys = '"1", "2", "3", "4", "5"';

    // 문항 형식
    const formatKeys = '"objective", "short_answer", "essay"';

    // topic 예시
    const topicExample = this.getEnglishTopicExample(gradeLevel);

    const studentFields = isStudent
      ? `
      "is_correct": true,
      "student_answer": "②",
      "earned_points": 3,
      "error_type": null`
      : '';

    const studentFieldsWrong = isStudent
      ? `
      "is_correct": false,
      "student_answer": "③",
      "earned_points": 0,
      "error_type": "concept_gap"`
      : '';

    // 분포 키 (유형)
    const typeDistExample = `"grammar": 0, "vocabulary": 0, "reading": 0, "listening": 0, "writing": 0, "communication": 0`;

    const dominantTypeExample = 'reading';
    const q1Type = 'grammar';
    const q1Ability = 'accuracy';
    const q2Type = 'vocabulary';
    const q2Ability = 'accuracy';
    const q16Type = 'reading';
    const q16Ability = 'reasoning';
    const qEssayType = 'writing';
    const qEssayAbility = 'expression';
    const q1Comment = '기본 어법 규칙을 직접 확인하는 문제입니다. 주어와 동사의 형태를 함께 확인하는 연습이 필요합니다.';
    const q2Comment = '문맥에 맞는 어휘를 고르는 문제입니다. 주변 문장을 함께 보면 안정적으로 정답할 수 있습니다.';
    const q16Comment = '빈칸의 논리를 추론해야 하는 독해 문제입니다. 앞뒤 문장의 연결을 확인하는 것이 핵심입니다.';
    const qEssayComment = '조건에 맞는 문장을 영작하는 서술형입니다. 요구 문법 요소를 빠짐없이 써야 합니다.';
    const enKeyGrammar = `,
      "key_vocab": [],
      "key_structures": [{ "pattern": "who / which / that", "meaning": "사람 who, 사물 which" }]`;
    const enKeyVocab = `,
      "key_vocab": [{ "word": "however", "meaning": "그러나" }],
      "key_structures": []`;
    const enKeyEmpty = `,
      "key_vocab": [],
      "key_structures": []`;
    const typeFieldRule = `${typeKeys} 중 하나 — **어법·어휘·독해 등 문항 유형** 기준`;
    const abilityFieldRule = '"accuracy"(정확성), "understanding"(이해력), "reasoning"(추론력), "expression"(표현력) 중 하나 — **풀이에 요구되는 사고력** 기준';
    const typeVsAbility = `**⚠️ question_type vs ability_domain 구분 (매우 중요!):**

| | question_type (유형) | ability_domain (능력) |
|---|---|---|
| **기준** | 문항의 **평가 영역** | 풀이에 **요구되는 사고력** |
| **판단법** | "이 문제는 어법/어휘/독해/듣기/영작 중 무엇인가?" | "정확성·이해·추론·표현 중 무엇이 핵심인가?" |

- **accuracy**(정확성): 어법 형태, 수일치, 시제, 어휘 형태가 핵심
- **understanding**(이해력): 세부정보, 문맥 어휘, 듣기 정보 파악이 핵심
- **reasoning**(추론력): 빈칸, 함축, 순서, 삽입이 핵심
- **expression**(표현력): 영작, 문장 완성, 대화 완성이 핵심

예: "3인칭 단수 -s" → question_type: **grammar**, ability_domain: **accuracy**
예: "빈칸 추론" → question_type: **reading**, ability_domain: **reasoning**
예: "조건 영작" → question_type: **writing**, ability_domain: **expression**`;

    return `🔧 **[필수] JSON 출력 형식**

반드시 아래 형식의 JSON만 출력하세요. 추가 텍스트 없이 JSON만!

**⚠️ JSON 안전 출력 — 절대 위반 금지:**
- **ai_comment 안에 LaTeX 수식($...$) 사용 금지!** 모두 한글로 풀어쓰기 (예: "이차방정식의 근의 공식을 적용합니다", "분수 형태의 식을 정리합니다")
- topic / difficulty_reason 등 다른 문자열에도 백슬래시(\\\\) 포함 금지. 모두 한글/한국어로만 표기
- 절대 금지: \`undefined\` (반드시 \`null\` 사용), trailing comma, \`//\` 주석, 문자열 안 raw 줄바꿈
- 큰따옴표(\\"")는 반드시 \\\\\\" 로 이스케이프

\`\`\`json
{
  "exam_info": {
    "total_questions": 21,
    "total_points": 100,
    "school_name": "시험지에 적힌 학교명 또는 null (예: 정화중학교, 영남고등학교)",
    "format_distribution": {
      "objective": 16,
      "short_answer": 0,
      "essay": 5
    }
  },
  "summary": {
    "difficulty_distribution": {
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0
    },
    "type_distribution": {
      ${typeDistExample}
    },
    "average_difficulty": "2",
    "dominant_type": "${dominantTypeExample}"
  },
  "questions": [
    {
      "question_number": 1,
      "question_format": "objective",
      "difficulty": "1",
      "difficulty_reason": "1단계 풀이",
      "question_type": "${q1Type}",
      "ability_domain": "${q1Ability}",
      "points": 3,
      "topic": "${topicExample}",
      "ai_comment": "${q1Comment}"${enKeyGrammar},
      "confidence": 0.97,
      "confidence_reason": "문항 내용 명확"${studentFields ? ',' + studentFields : ''}
    },
    {
      "question_number": 2,
      "question_format": "objective",
      "difficulty": "2",
      "difficulty_reason": "유형 적용",
      "question_type": "${q2Type}",
      "ability_domain": "${q2Ability}",
      "points": 3,
      "topic": "${topicExample}",
      "ai_comment": "${q2Comment}"${enKeyVocab},
      "confidence": 0.92,
      "confidence_reason": "문항 내용 명확"${studentFieldsWrong ? ',' + studentFieldsWrong : ''}
    },
    {
      "question_number": 16,
      "question_format": "objective",
      "difficulty": "4",
      "difficulty_reason": "3단계 + 함정",
      "question_type": "${q16Type}",
      "ability_domain": "${q16Ability}",
      "points": 5,
      "topic": "${topicExample}",
      "ai_comment": "${q16Comment}"${enKeyEmpty},
      "confidence": 0.82,
      "confidence_reason": "배점 추정"
    },
    {
      "question_number": "서술형1",
      "question_format": "essay",
      "difficulty": "3",
      "difficulty_reason": "수일치와 어순 적용",
      "question_type": "${qEssayType}",
      "ability_domain": "${qEssayAbility}",
      "points": 8,
      "topic": "${topicExample}",
      "ai_comment": "${qEssayComment}"${enKeyEmpty},
      "confidence": 0.78,
      "confidence_reason": "비정형 유형"
    }
  ]
}
\`\`\`

**필드 규칙:**

| 필드 | 규칙 |
|------|------|
| question_number | 시험지에 표기된 큰 문항 번호. 소문항은 english_analysis.subquestions에 보존 |
| english_analysis | 영어 문항별 근거 기록 구조를 따른다. source·subtype·skills·thinking·writing_conditions·subquestions·next_practice 포함 |
| question_format | ${formatKeys} 중 하나 |
| difficulty | ${difficultyKeys} 중 하나 또는 판독 불가 시 null. **H11 언어 기준 + H12 6축 + H13 분포 강제 금지 + H14 유형 근거 점검**. 실제 정답률이 아닌 추정 난도. |
| difficulty_reason | 난이도 이유, **최대 15자, 쉬운 말**. 예: "바꿔 말하기", "숨은 뜻", "조건 영작". 호혜적·함축·환언·스캔 품질 금지 |
| question_type | ${typeFieldRule} |
| ability_domain | ${abilityFieldRule} |
| points | 배점 (숫자), 불분명 시 null |
| topic | "과목명 > 대단원 > 소단원" (공백 포함 > 구분) |
| ai_comment | **정확히 2문장, 존댓말, 각 문장 20~40자. 중학교 학부모가 바로 읽는 쉬운 말만.** 호혜적·함축·환언·스캔 품질·준학술 한자어 금지. 1문장: 무엇을 묻는지, 2문장: 어떻게 보면 되는지. 예: "서로 주고받는 이야기의 중심 생각을 묻습니다. 글 전체를 먼저 읽고 고르면 됩니다." |
| key_vocab | 그 문항 지문·선지·빈칸에 **실제로 나온** 핵심 단어만. 최대 4개. \`{ "word", "meaning" }\`. meaning은 쉬운 한국어 10자 안. 없으면 \`[]\`. 없는 단어 창작 금지. |
| key_structures | 그 문항에 **실제로 나온** 문법 구문만. 최대 3개. \`{ "pattern", "meaning" }\`. 예: "too ~ to", "If I were ~". 없으면 \`[]\`. 없는 구문 창작 금지. |
| confidence | 0.0~1.0. **H15 5단계 매핑 엄수 + H17 분포 강제**. 모든 문항을 0.95로 출력 금지 — 약 30%는 0.85 이하가 정상. |
| confidence_reason | 신뢰도 판정 근거 (최대 20자). **허용 사유만 사용**: "문항 내용 명확"(0.90+), "비정형 유형"(0.75~0.89), "배점 추정"(0.70~0.89), "출제범위 의심"(0.60~0.79), "스캔 품질 낮음"(0.50~0.74), "판독 실패 — 번호만 인식"(0.00~0.29). **H16 매핑 엄수**. ❌ "계산 결과가 선택지에 없음", "정답이 보기에 없음", "문제 오류 의심" 등 풀이 검산 기반 사유 금지 — 너는 메타데이터만 추출하며 풀이를 수행하지 않는다. |${isStudent ? `
| is_correct | true/false/null (정오 판별, 판단 불가 시 null) |
| student_answer | 학생 답안 문자열 (판독 불가 시 null) |
| earned_points | 획득 점수 (서술형 부분점수 가능, 판단 불가 시 null) |
| error_type | "calculation_error"/"concept_gap"/"careless"/"time_pressure"/"misread"/null |` : ''}

${typeVsAbility}

**summary 규칙:**
- difficulty_distribution: 각 난이도별 문항 수 (합계 = questions 배열 길이)
- type_distribution: 각 유형별 문항 수 (합계 = questions 배열 길이)
- average_difficulty: 가장 많은 난이도 (동률이면 낮은 쪽)
- dominant_type: 가장 많은 유형

**format_distribution 규칙:**
- objective + short_answer + essay = questions 배열 길이

**🚨 exam_info.total_questions / total_points — 시험지에서 "직접 읽은" 값 (최우선 규칙):**
이 두 값은 **네가 분석한 결과의 합계가 아니라, 시험지 자체에 있는 값**이다. 누락 검증의 유일한 기준이므로 절대 자기 출력에 맞추지 마라.
- **total_points**: 시험지에 인쇄된 **만점**(대개 100점). 시험지 머리말/안내문의 "100점 만점" 같은 표기를 그대로 읽어라. 네가 매긴 배점들의 합이 아니다.
  - 만점 표기가 없으면 시험지에 실제로 인쇄된 각 문항 배점의 총합을 세어라.
- **total_questions**: 시험지에 실제로 인쇄된 **전체 문항 수**. questions 배열의 길이가 아니다.
  - 객관식 + 단답형 + 서술형을 **모두** 세어라. 서술형이 뒤쪽 별지에 있어도 반드시 포함.
- 두 값이 네 questions 배열과 어긋나도 **그대로 신고하라.** 시스템이 그 차이로 누락을 감지해 재분석한다.
  억지로 맞추면 누락이 영원히 은폐된다.

**🚨 문항 누락 금지 — 마지막 문항까지:**
- 시험지의 **모든** 문항을 questions 배열에 담아라. 특히 **마지막 페이지의 서술형**이 빠지는 사고가 잦다.
- 출력 전 스스로 점검: ① questions 배열 길이 = total_questions 인가? ② 배점 합계 = total_points 인가?
  다르면 빠뜨린 문항이 있는 것이니 **시험지를 다시 훑어 채운 뒤** 출력하라.`;
  }

  // ── Private 헬퍼 ──

  /**
   * 영어 topic 예시 생성
   */
  private static getEnglishTopicExample(gradeLevel: string | null): string {
    const values = getEnglishAllowedTopicValues(gradeLevel);
    if (values[0]) return values[0];
    return '중1 영어 > 문법 > be동사 (am, is, are)';
  }

  /**
   * 사용된 템플릿 목록 — **실제 주입된 블록에서 그대로 뽑는다**(별도 목록을 손으로 적지 않는다).
   * 손으로 적으면 프롬프트가 바뀔 때마다 어긋난다 (적대적 리뷰 3.4).
   */
  private static collectUsedTemplates(context: ExamContext): string[] {
    return this.getGuidelineBlocks(context).map(b => b.name);
  }

  /** 매칭된 문제 유형 수집 */
  private static collectMatchedProblemTypes(): string[] {
    return ['grammar', 'vocabulary', 'reading', 'listening', 'writing', 'communication'];
  }

  /**
   * 가이드라인·시험지유형·스키마를 모은다. `build()` 와 DB 템플릿 재조립이 **같은 것**을 써야
   * 커스텀 base 를 얹어도 나머지가 어긋나지 않는다 (적대적 리뷰 1.9).
   */
  private static collectParts(context: ExamContext): { guidelines: string[]; paperType: string; schema: string } {
    const guidelines = this.getAnalysisGuidelines(context);
    const paperType = getPaperTypeInstructions(context.paper_type);
    const schema = this.getJsonSchema(context.paper_type, context.grade_level);

    // 허용 소단원 목록 (DB 1:1 매칭용) — 드롭다운과 동일 함수
    const enTopics = formatEnglishAllowedTopicsPrompt(context.grade_level);
    if (enTopics) guidelines.push(enTopics);

    // 수학과 달리 학기 힌트를 쓰지 않는다 — 교과서 레슨 출제범위가 그 자리를 대신한다.
    if (context.exam_scope && context.exam_scope.length > 0) {
      guidelines.push(`📘 **[참고] 이 시험의 교과서 출제 레슨**

선생님이 선택한 출제범위(교과서 Lesson/Unit)는 다음과 같습니다:

${describeEnglishExamScope(context.exam_scope)}

**규칙:**
- 지문·대화 소재가 위 레슨과 맞는지 **참고**하라.
- 레슨에 **문법**이 있으면 어법 문항 분류의 힌트로만 쓴다. 시험지에 없는 문법을 만들어 넣지 말 것.
- 문항 \`topic\` 필드는 레슨 제목이 아니라 **허용 소단원 목록**(문법/어휘/독해 항목)을 사용하라.
- 레슨명을 topic 에 복사하지 말 것.`);
    }

    return { guidelines, paperType, schema };
  }

  /** DB 템플릿이 base 를 교체했을 때 실제 호출용 프롬프트를 다시 조립한다. */
  private static assembleCombined(context: ExamContext, base: string): string {
    return combinePrompts(
      { base, ...this.collectParts(context) },
      {
        hardConstraints: HARD_CONSTRAINTS,
        selfVerify: SELF_VERIFY,
        difficultyRules: DIFFICULTY_RULES,
        difficultySelfVerify: DIFFICULTY_SELF_VERIFY,
      },
    );
  }
}
