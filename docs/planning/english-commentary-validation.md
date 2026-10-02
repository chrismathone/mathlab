# 영어 총평 검증 fixture

개발 DB의 `en-v1.5.0` 영어 분석은 0건이다. 아래 자료는 실제 학교 시험이 아니라, 합의된 총평 계약에 맞춘 검증 입력이다. 학교명과 제목은 모두 `검증용`이다.

실제 모델의 생성 6건과 반복 2건을 평가하고, Codex·Claude·Grok의 내용 검토에서 발견한 출처·채점·작성 조건·함정 해석의 근거 확대를 보완했다. 최종 산출물 8건에 세 검토자가 동의했다. 순수 회귀 39건, 실제 DB 5건, 실제 HTTP 10건, 브라우저·캡처 및 최종 프로덕션 빌드가 통과했다. 아래 마지막 기록이 최신 상태다.

```text
npx tsx scripts/verify-english-commentary-live.ts
npx tsx scripts/verify-english-commentary-live.ts --live
```

인자 없이는 생성 모듈을 불러오지 않는다. 환경 변수만으로는 호출되지 않는다. `--live`는 코디네이터가 러너 준비를 확인한 뒤 실행한다.

## 원문과 근거 조건

저장된 발문, 선지, 지문 본문, 해설은 없다. `passage_id`는 묶음 번호일 뿐이고 본문이 아니다. 입력은 `english_analysis`, `ai_comment`, `key_vocab`, `key_structures`와 형식·배점·단원·유형뿐이다. 학교 평균, 등급, 응시 인원 통계는 넣지 않았다. 연도도 넣지 않아 스냅샷의 `exam.year`는 null이다.

`textbookId`는 fixture의 `examScope.textbookId`에만 있다. `buildEnglishCommentaryContext`는 이 값을 스냅샷으로 복사하지 않는다.

| fixture | 실행 | 범위 | 출처 | 채점 | 변형 | 실측 | 지문 id |
|---|---|---|---|---|---|---|---|
| `middle-objective` | 생성 | 문항 근거 포함 | 미확인 22. 원자료의 교사 확인은 근거 문장이 없어 내려간다 | 없음 | 없음 | 없음 | 없음 |
| `middle-constructed` | 생성 | 문항 근거 포함 | 미확인 | 서술형 2문항. 서술형1 소문항 4+6=10 | 없음 | 없음 | 없음 |
| `high-conditional-writing` | 생성, 반복 | 교사 확인 포함 | 확인 6 / 미확인 14 | 서술형 4. 소문항 5+7=12 | 2 | 2 | 1종, 3문항. 본문 없음 |
| `explicit-source` | 생성, 반복 | 교사 확인 포함 | 교사 확인 8, 인쇄 6, 미확인 6 | 없음 | 4 | 2 | 2종, 6문항. 본문 없음 |
| `listening-mock` | 생성 | 문항 근거 포함 | 듣기 10은 인쇄, 독해 10은 미확인 | 없음 | 없음 | 없음 | 1종, 5문항. 본문 없음 |
| `structure-centered` | 생성 | 구조 중심 | 없음 | 없음 | 없음 | 없음 | 없음 |
| `subquestion-points-incomplete` | 호출 전 차단 | 문항 근거 포함 | 미확인 | 없음 | 없음 | 없음 | 없음 |
| `damaged-json` | 정규화만 | 구조 중심 | 손상 원본은 확정하지 않음 | 없음 | 없음 | 없음 | 없음 |

범위 라벨은 제품 함수가 정한다. 교사 확인이 하나라도 있으면 `교사 확인 포함`, 세부 근거만 있으면 `문항 근거 포함`, 둘 다 없으면 `구조 중심`이다.

구조 중심 2개(`structure-centered`, 정규화 뒤의 `damaged-json`)는 대표 문항 후보가 0이고, 대표 문항·학습 행동의 최소 개수도 0이다. 빈 배열이 정상이다.

## 호출 전 차단

`subquestion-points-incomplete`는 객관식 11문항×8점과 서술형1 12점이다. 부모 배점 합은 100점이고 단원도 있다. 공통 `checkAnalysisReadiness`는 통과한다.

서술형1의 소문항은 8점+8점이다. `checkEnglishCommentaryReadiness`의 사유는 소문항 배점 불일치뿐이다. `--live`에서도 이 fixture는 `generateEnglishCommentary`를 부르기 전에 `*.blocked.json`으로 기록한다.

손상 JSON과 출처 미확인, 세부 근거 부족은 차단 사유가 아니다.

## 손상 JSON

문항에는 `readEnglishQuestionAnalysis` 결과만 들어간다. 원본은 `DAMAGED_NORMALIZATION_CASES`에 있다.

null, 문자열, 배열, 숫자, `toString` 키, 인원이 넘는 실측, 근거 없는 변형은 출처 `unknown`, 확인 `unverified`, 변형 `unknown`, 실측 null이 된다. 근거 문장 없는 교과서·교사 확인 주장은 종류 `textbook`만 남고 확인은 `unverified`, 변형은 `unknown`이다.

`UNSOURCED_SCORING_SAMPLE`은 별도 탐침이다. `read()`는 출처 없는 채점 문구를 남기고 편집 스키마는 거절한다. 총평 스냅샷은 그 문구와 근거 없는 변형을 싣지 않는다.

## 생성기에 넘기는 타입

fixture가 보유하는 입력은 `EnglishCommentaryInput`이다.

```ts
interface EnglishCommentaryInput {
  examPaper: {
    id: string;
    title?: string | null;
    schoolName?: string | null;
    grade?: string | null;
    category?: string | null;
    examScope?: unknown;
    examStats?: unknown;
  };
  analysis: {
    id: string;
    questions: unknown;
    summary?: unknown;
    totalPoints?: number | null;
  };
}
```

검증 id는 `validation-paper-*`, `validation-analysis-*`이다. DB를 읽거나 쓰지 않는다.

실제 인자 `ctx`는 그 입력을 `buildEnglishCommentaryContext`에 넣은 `EnglishCommentaryContext`다. 모듈은 `src/lib/exam-analysis/english/commentary/generate.ts`이고, 클라이언트 안전 진입점인 `index.ts`에는 생성 함수가 없다.

```ts
generateEnglishCommentary(
  ctx: EnglishCommentaryContext,
  opts?: { generateText?: GenerateTextFn; now?: () => number },
): Promise<
  | { ok: true; report: EnglishCommentaryReport; repaired: boolean; attempts: number; durationMs: number }
  | { ok: false; code: 'truncated' | 'invalid' | 'llm_error'; message: string; errors: string[]; attempts: number; durationMs: number }
>
```

러너는 `generateEnglishCommentary(ctx)`만 호출한다. `generateText`를 넘기지 않으므로 생성 모듈 안의 기존 총평 게이트웨이가 사용된다. 러너가 게이트웨이를 직접 부르지는 않는다.

## 결과 파일

`--live`가 쓰면 `test-results/english-commentary-live/`에 JSON을 남긴다.

- 정상 6개: `<id>.json`
- 풍부한 2개의 두 번째 호출: `high-conditional-writing.repeat.json`, `explicit-source.repeat.json`
- 차단 1개: `subquestion-points-incomplete.blocked.json`
- 손상 JSON은 모델에 넘기지 않는다

각 파일에는 `durationMs`, `attempts`, `repairCount`(보완 횟수. 성공 시 `repaired`면 1, 아니면 0), `validation`, `report`, `context`, `blockReasons`, 빈 `reviews`가 있다. 키와 DB 접속 문자열은 저장 전에 지운다. 독립 검토는 Claude/Grok 검토 문서와 아래 Codex 기록에 남긴다. 첫 결과는 `test-results/english-commentary-live/first-pass/`에 보존했다.

## 다섯 축

사람 검토용이다. 점수로 완료를 가르지 않는다. 운영자 채점도 완료 조건이 아니다. 문구의 원본은 `FIVE_AXIS_RUBRIC`이다.

| 축 | 볼 것 |
|---|---|
| 근거 정확성 | 문항 번호, 배점, 유형, 출처 확인, 변형, 채점, 실측이 스냅샷과 같은가. 없는 지문이나 선지를 인용하지 않는가. |
| 시험 구체성 | 이 검증 시험의 형식 구성과 단원, 대표 문항이 드러나는가. |
| 행동 실행성 | 학습 행동이 문항 요구와 연결되는가. 구조 중심에서 대표 문항과 행동 배열이 비어 있는 것은 허용된다. |
| 학부모 가독성 | 쉬운 한국어인가. 내부 코드, 모델명, HTML이 보이지 않는가. |
| 과장 없음 | 등급컷, 전국 기준, 킬러, 학생 실력 단정, 다른 학교 비교, 교육과정 어휘 수 인용이 없는가. 실측을 학교 전체로 넓히지 않는가. |

출력에 근거 정확성이나 과장 문제가 있으면 그 보고서를 고친 뒤 같은 fixture로 다시 생성한다.

## 통합 검증 — Codex

2026-10-02, 로컬 Next 15 앱에서 실행했다. 브라우저 검증은 실제 화면과 캡처 엔진을 사용하되 API 응답을 명시적인 메모리 fixture로 대체한다. HTTP 권한 검사와 Prisma 동시성 검사는 별도 임시 DB 레코드를 사용한다. 실제 생성 검사만 외부 모델을 호출한다.

| 검사 | 확인한 내용 | 결과 |
|---|---|---|
| `verify:en-commentary-browser` | 일반 교사 생성·재조회·실패 시 이전 총평 보존·교정 후 이전 근거 안내·재생성 후 해제 | 통과 |
| 같은 브라우저 검사 | 테마 저장·실제 PNG 12장과 클립보드 HTML의 이미지 수/요약 일치·캐시 재사용·이전 근거 복사 확인 | 통과 |
| 같은 브라우저 검사 | 자동 옵션 OFF에서는 기존 총평이 있어도 생성 안 함, ON에서는 학습 대책 실패 후 총평을 순차 생성, metadata 요청 없음 | 통과 |
| 같은 브라우저 검사 | 수동 생성 중 다른 시험을 선택해도 늦은 완료 응답이 화면을 되돌리지 않음, 시험별 화면 상태 분리 | 통과 |
| 같은 브라우저 검사 | 독립 지면 720/375px 가로 넘침 없음, 브랜드/다크 테마의 렌더된 텍스트 대비 4.5:1 이상, 페이지 오류 없음 | 통과 |
| `verify:en-commentary-api` | 미로그인 401·학생 403·타지점 404·무료 플랜 403·일반 교사 Pro의 캐시 재사용 200 | 통과 |
| 같은 실제 HTTP 검사 | 데모 총평/이미지 권한 403·영어의 수학 metadata/V4 우회 400·미완성 분석 readiness 400, 기존 보고서 불변 | 통과, 총 10건 |
| `verify:en-commentary` | 생성 계약·잘림·보완 상한·근거 주장·단일 참조·서명·보존·lease·재분석 회귀 | 39건 통과, 모델 호출 없음 |
| `verify:en-commentary-db` | 실제 Prisma 동시 요청·실패 보존·생성 중 교정·행 잠금·재분석 이관 | 5건 통과, 임시 레코드 잔존 0 |
| TypeScript / 변경 UI·검사 코드 ESLint | 타입 검사 및 린트 오류 | 오류 0, console 경고만 |
| 기존 회귀 검사 | 영어 분류/문항 근거/claims/template/render/capture signature/contrast | 통과 |
| `npm run build` | Prisma 생성 + Next 프로덕션 컴파일·타입·정적 페이지 생성 | 통과, 기존 lint 경고만 |

HTTP·DB 검사는 본 실행이 만든 임시 ID만 `finally`에서 삭제했다. 실제 교사/학생 데이터나 과거 시험 결과는 변경하지 않았다. API 검사는 강제 생성을 호출하지 않고 미리 저장한 동일 서명의 문서를 재사용하여 추가 모델 호출을 하지 않았다.

시각 증거: `test-results/english-commentary-browser/brand.png`, `dark.png`, `narrow.png`, `capture-*.png`, `clipboard.html`, `actual-model-720.png`. 마지막 이미지는 실제 모델 산출물을 동일한 보고서 뷰에 표시한 것이다. API 모킹 검증을 실제 모델 생성 또는 실제 저장 검증으로 표현하지 않는다.

### 첫 실제 생성의 내용 검토와 수정

6가지 시험 구성 + 풍부한 2가지 반복, 총 8회. 성공 8, 보완 1, 지연 5.5~17.2초. 소문항 배점 초과 사례는 모델 호출 전에 차단했다.

자동 검사만으로는 다음 오류를 잡지 못했다. Codex가 먼저 확인한 뒤 Claude와 Grok도 독립적으로 같은 사례를 보고했다.

- `middle-constructed`: 감점 기준이 없는 서답형·서술형까지 묶어 감점을 설명했다.
- `high-conditional-writing` 및 반복: 일부 서술형의 출처·변형 근거를 다른 서답형에 확대했다.
- `explicit-source` 및 반복: 출처 미확인 문항을 교과서·부교재 문항과 함께 확정적으로 설명했다.
- 기록에 없는 구체 문법 항목과 개별 문항의 작성 조건을 다른 문항의 준비 방법까지 확대하는 문제가 있었다.

보강 방향은 참조 묶음의 모든 문항에 해당 근거가 있어야 관련 주장을 허용하고, 전역 산문의 확정적인 출처·채점·변형 표현을 제한하는 것이다. 구체 문법 항목은 연결된 문항의 기록과 대조한다. 보강된 생성기로 전체 사례를 다시 만들고 세 검토자가 재평가한다.

### 두 번째 실제 생성의 독립 검토

8회 모두 자동 검사를 통과했다. 보완 3회, 지연 6.9~33.7초였다. 결과는 `second-pass/`에 보존했다. 첫 검토에서 발견한 출처·감점 확대는 해소됐지만, 독립 검토에서 다음 문제가 남아 최종 동의는 보류했다.

- Claude: 기록에 없는 '일부 내용만 담은 선택지', 핵심 어휘를 '주어진 접속사' 조건으로 바꾸는 추론, `too ~ to`를 '상관 구문'이라고 새로 부르는 표현.
- Grok: 참조 일부에만 있는 연어·although·원문 대조·함정 유형을 참조 전체로 확대하거나, 객관식 문항을 직접 고쳐 쓰는 문항으로 설명하는 표현.

자동 검사를 통과했다는 이유만으로 품질 합의를 선언하지 않았다. 다중 참조의 공통 근거 확인, 함정·제시 재료·구체 용어 검증을 보강한 뒤 실제 출력을 다시 평가한다.

### 세 번째 실제 생성의 내용 검토

8회 모두 자동 검사를 통과했다. 보완 6회, 지연 8.2~21.8초였다. 결과는 `third-pass/`에 보존했다. per-ref 검사로 이전에 발견한 구체 문법·어휘·함정 확대는 해소됐다. 다만 `explicit-source`에서 일반적인 유형 설명이 가정법 문항까지 묶었고, 고1 조건 영작에서 핵심 어휘 `although`를 답안 필수 표현처럼 설명했다. Codex와 Claude가 직접 대조해 두 문제를 확인했다.

추가 조정안은 특징·행동을 각각 한 문항에 연결하고, 시험 전체 경향은 개요와 코드 집계표에서 설명하는 것이다. 핵심 어휘·구문이 기록됐다는 사실과 필수 답안 조건도 구분한다. 이전 산출물은 수작업으로 고쳐 합격시키지 않고, 생성 규칙을 수정한 후 새로 평가한다.

### 최종 생성 세트와 Codex 판정

단일 참조 계약에 대한 3자 동의 후 8건을 생성했다. 자동 검사에는 모두 통과했지만 고1 첫 보고서가 조건 영작을 '의견 작성'으로 설명하여, 기록된 쓰기 목적과 대조하는 검사를 추가했다. 이 결과는 `fourth-pass/`에 보관했다. 해당 고1 사례를 두 번 다시 생성했고 둘 다 보완 없이 통과했다. 나머지 6건도 최종 검사기로 다시 검증했다. 최신 세트는 아래와 같다.

| 산출물 | 생성 시작(UTC, 2026-10-01) | 지연 | 보완 |
|---|---|---:|---:|
| middle-objective | 19:13:09 | 19.109초 | 1 |
| middle-constructed | 19:13:29 | 6.467초 | 0 |
| high-conditional-writing | 19:18:14 | 7.544초 | 0 |
| explicit-source | 19:13:58 | 13.139초 | 1 |
| listening-mock | 19:39:00 | 5.057초 | 0 |
| structure-centered | 19:14:19 | 12.346초 | 0 |
| high-conditional-writing.repeat | 19:18:22 | 6.103초 | 0 |
| explicit-source.repeat | 19:14:45 | 19.663초 | 1 |

최종 8건의 자동 계약 검증은 모두 통과했다. 추가 모델 호출 없이 최신 검증기로 오프라인 재검사했다. 소문항 배점 불일치 사례는 호출 전에 차단했다. 최종 산출물의 SHA-256과 참조 문항 근거는 `test-results/english-commentary-review-bundle.json`에 함께 기록했다.

Codex 최종 판정: **동의(AGREE)**. 문항 참조·출처·조건·채점·어휘의 근거 범위를 지키며, 문항 요구에서 학습 행동과 확인 방법으로 이어진다. 8건 모두 근거 정확성·시험 구체성·행동 실행성·학부모 가독성·과장 없음 기준에 부합한다. 구조 중심 보고서는 상세 문항 해설을 지어내지 않고 기본 유형과 단원에서 확인되는 요구만 설명한다. 이 판정은 명시된 검증 입력과 산출물에 대한 것으로, 원문이 확보되지 않은 실제 학교 시험을 검증한 결과가 아니다.

### 마지막 함정 해석 보완

Grok은 듣기 사례의 독해 문항에서 '비슷한 형태의 선택지'를 '본문 표현과 비슷한 선택지' 또는 '지문 단어를 조합한 선택지'로 확대한 두 문장을 지적했다. Codex와 Claude는 처음에 같은 함정 계열의 설명으로 허용했지만, 기록되지 않은 비교 대상·구성 방법을 추가했다는 지적을 수용했다. 프롬프트와 검증기에 해당 구분을 추가하고, 기존 두 문장 거절과 근거가 있는 문장·일반적인 의미 대조 연습 허용을 회귀 검사에 넣었다.

듣기 사례는 실제 모델로 다시 생성했다(19:39:00 UTC, 5.057초, 보완 0회). 새 대표 문항은 '형태가 유사한 선택지들'로 설명하고, 학습 행동은 '지문 요지와 선택지 의미의 대조'를 제안한다. 원문 표현의 복사·조합을 주장하지 않는다. Codex는 새 산문을 참조 문항 기록과 대조해 **동의(AGREE)**로 판정했다. 다른 7건의 파일은 이전 판정 대상과 동일하며, 최종 8건은 자동 계약 검증을 다시 통과했다. 최종 지연 범위는 5.057~19.663초, 보완은 3/8건이다.

최종 3자 판정: **Codex·Claude·Grok 모두 동의(AGREE)**. Grok의 최종 완료 메시지는 `msg_e5b696082bbb`, Claude의 마지막 변경분 검토 완료 메시지는 `msg_0134208f09c5`다. 각 에이전트가 직접 남긴 [Claude 검토](./english-commentary-claude-review.md), [Grok 검토](./english-commentary-grok-review.md)에 문항별 대조와 판정이 있다.

마지막 코드 검토에서 Codex와 Claude는 '본문이라는 말 + 표현 명사'만으로 겹침과 조합을 함께 허용하던 조건을 분리했다. 겹침·복사와 낱말 조합은 각각 기록된 관계가 필요하고, 전역 산문도 서로 다른 문항 기록을 이어 붙여 근거로 삼지 않는다. 새 함정 규칙의 추가 탐침은 부정 사례 14/14 차단, 양성 사례 2/2 및 일반 조언 6/6 허용이었다(중간 보고의 '16/16 차단'은 이 14개와 2개를 합쳐 잘못 표현한 수치이며, 이 기록으로 정정한다). 최종 순수 회귀 39/39, 생성 산출물 오프라인 검증 8/8, 타입 검사·린트 오류 0, 마지막 `npm run build` 종료 코드 0을 확인했다. 기존 린트 경고는 남아 있다.

함정 유형 검증은 패턴 기반이므로 모든 새로운 바꿔 쓰기를 보장하지 않는다. 실제 학교 분석본이 확보되면 같은 기준으로 첫 운영 샘플을 대조하고, 보완·실패 비율과 과한 수식어를 관찰하는 것이 후속 품질 과제다. 이는 합성 입력에 대한 현재 검증 범위와 구분한다.

### 외부 편집기 검증 범위

Orca 브라우저에서 네이버 블로그 홈을 열어 로그인되지 않은 상태임을 확인했다. 로그인된 편집기에 접근할 수 없어 네이버 자체의 이미지 재호스팅·붙여넣기는 미검증이다. 대신 실제 PNG 생성, 동일 스냅샷 사용, 클립보드 HTML/요약, 캐시 무효화, 실패 시 완료 처리 방지를 로컬 브라우저에서 검증했다. 검증을 위해 외부 글을 발행하지 않았다.

### 최신 원격 반영 후 커밋 전 확인

후속 정리에서 원격 커밋 `8ea1a0dd`(Jev 벤치마크 검증)를 추가로 반영했다. 영어 총평 변경 파일과 겹치지 않아 충돌 없이 복원했고, 기존 수정 파일의 diff와 신규 파일 25개의 Git 객체 해시가 보관본과 같음을 확인했다. 최신 기준으로 `npm run build`를 다시 실행해 종료 코드 0을 확인했다(`test-results/english-commentary-build-after-sync.log`). 커밋 대상 38개 파일의 `git diff --cached --check`도 통과했다. 생성 결과를 바꾸거나 모델을 추가 호출하지 않았다.
