# MathLab — 한국 수학 학습 플랫폼

> **⚠️ 현재 개발 버전입니다. DB의 모든 데이터는 더미 데이터이며, 초기화/삭제가 자유롭습니다.**

---

## 🚧 최우선 하드 경계 — 수학 랩실 자동화(Lab) 서브시스템 격리 (절대 규칙)

> **이 repo에는 두 개의 제품이 공존한다. ① 라이브 운영 중인 "기출분석"(exam-analysis) ② 은닉 개발 중인 "수학 랩실 자동화 파이프라인"(Lab). Lab 개발은 기출분석을 절대로 건드리지 않는다 — 코드도, DB도, 사용자 화면도.**

> **🧬 형제 라인 — "공유"가 아니다 (멘탈 모델 고정).** 기출분석과 Lab은 하나의 코드베이스를 *공유*하며 같이 진화하는 관계가 **아니다**. 같은 repo 안에 나란히 사는 **별개의 형제(sibling) 라인**이다.
> - **기출분석은 개발 내내 동결(frozen)**: Lab을 아무리 키워도 기출분석의 코드·DB·화면·동작은 **1비트도 변하지 않는다**. "리팩터링하는 김에", "공유 유틸 개선하는 김에", "여기도 같이 고치면 깔끔" — **전부 금지**. 기출분석은 손대는 대상이 아니라 *그대로 두는* 대상이다.
> - **두 라인은 교차하지 않는 평행선**: 물리적 접점은 오직 `prisma/schema.prisma` 파일 하나(그것도 `Lab*` 추가만)와, 기출분석 공유 유틸의 **읽기 전용 재사용**뿐. 그 외 어디서도 만나지 않는다.
> - **"공유 코드를 같이 수정한다"는 발상 자체가 위반**: 공통 로직이 필요하면 *공유 파일을 고치지 말고* `src/lib/lab/` 안에 복제/래핑한다(예: P1 `answer-compare.ts`는 삭제된 채점 로직을 Lab 안에 자체 복제). 중복이 격리보다 항상 우선.
> - **판단 기준 한 줄**: "이 변경이 기출분석을 단 한 줄이라도 바꾸는가?" → 예/애매하면 **하지 않는다**. Lab은 *추가만*, 기출분석은 *불변*.

### 0대원칙: ADDITIVE-ONLY (기존 코드 0줄 수정)
- **기출분석 파일은 단 한 줄도 수정하지 않는다.** Lab 작업은 전부 *새 파일 추가*로만 한다. 안 만진 코드는 안 바뀐다 = 회귀 불가능.
- 유일하게 손대는 공유 파일은 `prisma/schema.prisma` 뿐 → 그것도 **`Lab*` 모델 추가만** (기존 모델/필드/인덱스 무수정).
- 공유 유틸(`requireAuth`, Supabase 클라이언트, KaTeX, `curriculum.ts` 등)은 **읽기 전용으로 재사용**만. 수정 금지 — 필요하면 `src/lib/lab/` 안에 래퍼/복제.

### 🚫 절대 수정 금지 표면 (기출분석 = 사용자가 보는 모든 것)
| 표면 | 규칙 |
|------|------|
| `src/app/(teacher)/exam-analysis/**`, `src/lib/exam-analysis/**`, `src/components/exam-analysis/**` | 무수정 |
| `src/app/api/exam-analysis/**`, `billing`, `entitlements`, `admin` 등 기존 API | 무수정 |
| `navigation.ts` (사이드바/커맨드팔레트) | **무수정** → Lab 메뉴 어디에도 안 뜸 |
| 랜딩(`src/app/page.tsx`)·공개 페이지·결제/이용권 UI | 무수정 → 마케팅·플랜 변화 0 |
| `prisma/schema.prisma`의 기존 모델 | 무수정 (Lab* 추가만 허용) |

### 🔒 Lab 네임스페이스 (전부 새 파일)
- **모델**: `Lab` 프리픽스 — `LabStudent`, `LabConcept`, `LabConceptEdge`, `LabMasteryRecord`, `LabPacingPosition`, `LabPrescription`, `LabPrescriptionItem`, `LabProblem`, `LabWorksheet`, `LabWorksheetProblem`, `LabSubmission`, `LabGradedItem`, `LabReport`. `@@map("lab_*")`로 DB 테이블명 격리. (기존 `Concept`/`Question` 이름 충돌 영구 회피.)
- **enum**: `Lab` 프리픽스 — `LabTrack`, `LabGenMode`, `LabProblemType`, `LabErrorType`, `LabWorksheetStatus`, `LabReportType`.
- **라우트**: `src/app/lab/**` (URL `/lab/*`), **API** `src/app/api/lab/**`, **로직** `src/lib/lab/**`.

### 👻 은닉(dark launch) — 일반 사용자에겐 존재 자체가 없음
- **접근 게이트**: `/lab` 레이아웃에서 `requireSuperAdmin()` → 미인가 시 **`notFound()` (404)**. 리다이렉트 금지(흔적 남김) — 404라야 "원래 없는 페이지"처럼 보임. API도 동일하게 `requireSuperAdmin` 가드.
- **킬스위치**: 환경변수 `LAB_ENABLED` (기본 off). off면 SUPER_ADMIN도 404 → 프로덕션 배포돼도 아무도 도달 못 함.
- 사이드바·커맨드팔레트·랜딩·billing에 **링크/언급 일절 없음**. 접근은 직접 URL(북마크)로만.

### 🗄️ DB 안전 (기출분석 데이터 보호)
- `lab_*` 테이블에 **additive 마이그레이션만**. 기존 테이블 alter/drop 금지.
- 변경 전 `npm run db:backup`. **`prisma migrate reset` 절대 금지** (과거 개발 DB 증발 사고 — 본문 "DB 백업/복구 시스템" 참조).
- 실제 DB `migrate`/`db push`는 사용자 확인 후 실행.

### 🏗️ Lab 파이프라인 설계 요약 (척추 = StudentLearningState)
5단계는 척추 스키마에 대한 **순수 함수**. 모든 산출물 레코드가 `genMode(MANUAL|ASSISTED|AUTO)`를 들고 있어 단계별로 사람↔자동을 독립 플립. **데이터는 역방향으로 흐른다**(채점→진단→처방→공급, `runCycle`이 박제).

| 단계 | 인터페이스(`src/lib/lab/stages.ts`) | 자동화 |
|------|------|--------|
| 진단 | `Diagnoser`: 채점결과 → masteryMap(BKT) | 가능 |
| 처방 | `Prescriber`: mastery+진도 → prescription | 가능(핵심 해자) |
| 공급 | `Supplier`: prescription → 시험지(HWP) | 반자동 |
| 채점 | `Grader`: 시험지+답안 → 문항별 정오 | 병목(객관식 쉬움/서술형 어려움) |
| 보고 | `Reporter`: mastery delta → 리포트 | 가능 |

**빌드 순서** (쉬운 자동화 ≠ 가치 우선순위에 주의): **P0** 척추+dumb 처방(진도표만)+공급+채점 → **P1** 채점 auto(객관식·단답) → **P2** 진단 auto(누적 채점이 공짜로 켬) → **P3** 처방 smart화 → **P4** 보고 auto → **P5** 서술형 채점 auto. ⚠️ HWP 출제 엔진·84개월 진도표 JSON은 현재 repo에 **없음** → 확보 전까지 소규모 합성 개념 그래프로 루프 검증.

---

## 프로젝트 개요

초등~고등 수학 학원용 학습 관리 플랫폼 (LMS).
학생 개념학습, 빈칸암기(5단계), 연산연습, 시험, 레벨테스트, 실시간 퀴즈, 학습지, PDF 문제 추출, 게이미피케이션을 지원.

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript 5.8 |
| Database | PostgreSQL + Prisma 6 |
| Auth | NextAuth 4 (Credentials, JWT) |
| AI | Google Gemini 2.5 Flash (`@google/genai`), Anthropic Claude (`@anthropic-ai/sdk`) |
| Storage | Supabase Storage (시험지 PDF 업로드) |
| Editor | TipTap (기출 분석 블로그 글 리치 에디터) |
| PDF | pdfjs-dist (클라이언트 사이드 PDF 렌더링) |
| Styling | Tailwind CSS v4, Framer Motion |
| Math | KaTeX, MathLive, remark-math, remark-gfm |
| State | Zustand 5 |
| Validation | Zod |
| Testing | Vitest, Playwright |
| Icons | lucide-react |

## 핵심 규칙

### 0. 🔒 AI 모델명 비노출 (사용자 UI) — 항상 "AI"로 표기

**사용자에게 보이는 모든 UI에서 AI 모델명(Claude / Sonnet / Gemini / GPT / o3 등)을 절대 노출하지 않는다. 진행 로그·상태 문구·배지·툴팁 등은 모두 "AI"로만 표기.**
- 예: `'Claude Sonnet 4.6 호출 시작'` → `'AI 분석 호출 시작'`, `"Claude Sonnet 4.6이 생성 중..."` → `"AI가 생성 중..."`
- 적용 대상: 진행 milestone 로그, 분석/생성 상태 문구, 모델 배지, 비교 화면 등 *사용자에게 렌더되는 모든 텍스트*.
- 제외: 코드 주석 · 내부 기술 문서(이 CLAUDE.md의 기술 스택 표 등) · 서버 로그는 모델명 유지 가능(사용자 비노출).
- 새 UI/기능 추가 시 모델명 하드코딩 금지 — 반드시 "AI"로 통일.

### 0-1. 🔒 백엔드/벤더 식별 정보 + 내부 사정 비노출 (사용자 UI)

**사용자에게 보이는 모든 UI에서 결제사·인프라·외부 서비스의 식별 정보나 내부 개발 사정을 노출하지 않는다.** 모델명 규칙(#0)과 동일한 원칙 — 사용자가 알 필요 없는 백엔드 디테일은 전부 감춘다.
- **결제사명 금지**: "Lemon Squeezy", "레몬스퀴즈", "해외 결제 대행", "Stripe", "토스페이먼츠" 등 PG/결제대행사 이름을 사용자 문구에 쓰지 말 것. 결제 처리 주체는 "구독/결제" 같은 기능명으로만 표기.
- **내부 개발 사정 금지**: "상품 연결 후 확정", "API 연동 전", "DB 마이그레이션 중", "베타 빌드" 등 *개발자만 알면 되는 진행 상태*를 사용자 본문에 노출 금지. 사용자에겐 결과 상태("준비 중", "곧 제공")만 보여줄 것.
- **인프라/벤더 금지**: "Supabase", "Vercel", "Prisma", "Gemini", "Anthropic", "NEIS", "카카오 API" 등 내부 스택/외부 API 제공자 이름을 사용자 문구·에러 메시지에 노출 금지.
- 적용 대상: 안내 배너, footer, 토스트, 에러 메시지, 빈 상태 문구, 버튼 라벨 등 *사용자에게 렌더되는 모든 텍스트*.
- 제외: 코드 주석 · 내부 기술 문서(이 CLAUDE.md) · 서버 로그 · 환경변수명.
- 위반 사례(2026-06-01): billing 페이지 footer "결제는 Lemon Squeezy(해외 결제 대행)를 통해 처리되며 ... 가격은 상품 연결 후 확정됩니다" → "구독 변경·취소·결제수단 관리는 구독 관리에서 할 수 있습니다"로 정정.

### 1. API/DB 존재 여부 반드시 확인 — 모든 데이터는 DB에 저장

**원칙: 프론트엔드에 표시되는 모든 데이터는 반드시 DB를 거쳐야 한다.**
- 하드코딩/로컬 상태만으로 데이터를 관리하지 말 것 → 반드시 API + DB 저장
- 데이터 조회/생성/수정/삭제 모두 API 라우트를 통해 처리
- 프론트엔드에서 `fetch()` 호출 전, 해당 API 엔드포인트가 실제 존재하는지 확인

**새 기능 구현 전 항상 확인할 것:**
- `prisma/schema.prisma`에서 해당 모델/필드가 존재하는지 확인
- `src/app/api/` 에서 필요한 API 라우트가 이미 있는지 확인
- 없으면 먼저 스키마/API를 생성한 후 프론트엔드 구현
- 스키마 변경 후 반드시 `npx prisma generate` 실행
- 새 enum 값 추가 시 Prisma 클라이언트 재생성 필수

**구현 순서 (반드시 이 순서를 따를 것):**
1. Prisma 스키마에 모델/필드 추가 → `npx prisma generate`
2. API 라우트 생성 (CRUD 필요한 만큼)
3. 프론트엔드에서 API 호출하여 UI 구현

**비용 인식 — 작은 기능도 3단계를 거친다:**
- 필드 하나(boolean, string 등) 추가에도 스키마 → generate → API → 프론트 전 과정 필요
- API 라우트가 이미 162개+ → 무분별하게 늘리지 말 것
- 새 필드 추가 전 판단 기준:
  - **정규 필드**: 검색/필터/정렬에 쓰이거나, 여러 곳에서 참조되는 경우
  - **기존 Json 필드 활용**: 한 곳에서만 쓰이는 부가 정보는 `metadata Json?` 등 기존 유연한 필드에 포함 검토
- 위자드/임시 상태는 클라이언트 state로 관리하고, **최종 저장만 DB**로 보내는 것이 적절

### 2. 탭/페이지 간 유기적 연동

**모든 페이지는 독립적이 아니라 하나의 플로우로 연결되어야 함:**
- **학생 관리** → 학생 클릭 → 해당 학생의 학습현황/오답/진도 조회 가능
- **개념 관리** → 개념 생성 → 빈칸 자동생성 → 학생이 4단계 학습
- **문제 은행** → 시험 출제 → 학생 응시 → 결과 분석 → 학습 분석에 반영
- **연산 생성기** → 연산 숙제 → 학생 연습 → 대시보드에 성과 표시
- **레벨테스트** → 진단 결과 → 취약영역 파악 → 맞춤 학습 추천
- **PDF 문제 추출** → 문제은행에 일괄 저장 → 시험/숙제에 활용
- **학습지** → 3단계 위자드로 교육과정 기반 문제지 생성
- 새 기능 추가 시 관련 탭에서의 접근 경로도 함께 구현할 것
- 데이터 생성/수정 시 관련 페이지의 캐시/목록도 갱신되는지 확인

### 3. 뷰 일관성 — 같은 항목은 어디서나 같은 뷰

**원칙: 동일한 데이터는 어떤 페이지에서든 동일한 형태로 렌더링해야 한다.**
- 문제 내용, 객관식 보기, 블록인용(보기 박스), 정답/풀이 등 같은 항목은 모든 곳에서 동일 뷰
- 폭, 간격, 스타일이 페이지마다 달라지면 안 됨 → 편집/수정 시 이질감 발생
- 공통 렌더링 컴포넌트 `MathRenderer` 로 통일 (EditableMathRenderer 는 2026-04-15 에 흡수됨 — 별도 컴포넌트 없음)
- 객관식 보기: 항상 `grid-cols-2` + 테두리 박스 스타일 (`px-3 py-2 bg-slate-50 rounded-sm border`)
- 새 뷰/페이지 추가 시 기존 렌더링 패턴을 반드시 확인 후 동일하게 적용

**`<보기>` 블록 그리드 — 인라인 마커 방식:**
- blockquote(`>`) 안에 `<보기>` 또는 `<보기:cols=N>` 마커 작성 (N = 1|2|3|auto)
- 마커 없으면 기본 2열, `cols=auto`는 항목 개수 기반 자동(≥6 → 3열, ≥3 → 2열)
- 파싱/치환 유틸: `src/lib/utils/box-grid.ts` (`readBoxColsFromContent`, `writeBoxColsToContent`)
- 문제 편집 UI에서 "보기 열" 버튼 그룹(자동/1/2/3열)으로 마커 자동 편집
- 렌더러가 마커를 자동 숨기고 `<보기>` 라벨로 치환 → DB에 저장된 마커가 모든 뷰(편집/미리보기/학생/인쇄)에 동일 적용

### 4. API 응답 형식 (일관성 유지)

```typescript
// 성공
{ data: T }
{ data: T, meta: { page, limit, total } }  // 페이지네이션

// 에러
{ error: { code: string, message: string } }
```

### 5. 인증/인가 패턴

**역할 계층 (5단계):** `STUDENT (0) < TEACHER (1) < MANAGER (2) < OWNER (3) < SUPER_ADMIN (4)`

```typescript
// 권한 확인 함수 (src/lib/api/auth.ts)
const user = await requireAuth();         // 로그인 필수 (401)
const user = await requireTeacher();      // TEACHER 이상 (403)
const user = await requireManager();      // MANAGER 이상 (403)
const user = await requireOwner();        // OWNER 이상 (403)
const user = await requireSuperAdmin();   // SUPER_ADMIN 전용 (403)
const user = await requireAuthViewAs();   // 로그인 + ?_as=studentId View-As 지원
if (isResponse(user)) return user;        // 에러 응답이면 즉시 반환

// 역할 비교
hasRole(user, 'TEACHER');  // ROLE_LEVEL[user.role] >= ROLE_LEVEL['TEACHER']
```

**역할별 권한:**
- **STUDENT**: 자기 학습 데이터만 조회/수정
- **TEACHER**: 자기 반(Classroom) 학생 관리, 컨텐츠 CRUD
- **MANAGER**: 테넌트 내 전체 교사/학생 관리, 진단결과 조회 (팀장)
- **OWNER**: 지점(Tenant) 전체 관리, 이용권 배정, 리포트
- **SUPER_ADMIN**: 플랫폼 전체 (모든 테넌트, 사용자, 지점 관리)

### 6. AI 사용 규칙

**Gemini (문제 생성, PDF 추출, 빈칸 생성):**
- 호출 전 **내용 사전 검증**: 최소 20자, 한글 5자 이상, 의미 있는 단어 3개 이상
- 모델: `gemini-2.5-flash` (이미지/도형 분석 및 성능에 최적)
- 구조화 출력: `responseMimeType: 'application/json'` + `responseSchema`
- 환경변수: `GEMINI_API_KEY`

**Claude (레벨테스트 보고서 생성):**
- 모델: Claude Sonnet 4.6 (`@anthropic-ai/sdk`)
- 레벨테스트 결과 → 학습 보고서 AI 생성
- 환경변수: `ANTHROPIC_API_KEY`

**⚠️ AI 출력 텍스트 — 한글 라벨 강제 + KaTeX 렌더링 (하네스 규칙)**

기출분석/AI 총평/블로그 글 등 **AI가 생성한 모든 사용자 노출 텍스트**는 다음 두 규칙을 반드시 따라야 한다.

1. **영문 enum 노출 절대 금지** — 다음 토큰은 한글 라벨로만 표시:
   - `CALCULATION` → 계산력, `UNDERSTANDING` → 이해력
   - `PROBLEM_SOLVING` → 문제해결력, `REASONING` → 추론력
   - `NUMBER` → 수와 연산, `ALGEBRA` → 문자와 식
   - `FUNCTION` → 함수, `GEOMETRY` → 기하, `STATISTICS` → 확률과 통계
   - **3중 방어**:
     ① AI 입력 데이터에서 영문 enum을 한글로 사전 변환 (예: `commentary-agent.ts::toKoreanAbility/toKoreanType`)
     ② 프롬프트에 영문 enum 금지 룰 명시 (`commentary-agent.ts` H6, V6 검증 + `article-generator.ts` "영문 enum 사용 금지" 섹션)
     ③ AI 응답 파싱 시 `stripEnglishEnums()` 적용 (commentary-agent parseResponse, article-generator title/content/tags/metaDescription)
   - 새 AI 에이전트 추가 시: 위 3중 방어를 반드시 동일 패턴으로 적용

2. **`$...$` 패턴은 반드시 KaTeX로 렌더링** — raw `$` 가 사용자 화면에 노출되면 안 됨:
   - 사용자에게 표시되는 모든 AI 생성 텍스트는 `renderInlineMath()` 를 거쳐야 한다 (`src/lib/exam-analysis/rendering.tsx`)
   - 단순 `{q.ai_comment}` 같은 직접 출력 금지 → `{renderInlineMath(q.ai_comment, keyPrefix)}` 사용
   - `renderInlineMath` 는 내부적으로 `normalizeKoreanLabels` 도 자동 적용 → 한글 라벨 강제까지 동시 처리됨
   - 적용 지점 (점검 시 반드시 확인): `AnalysisCommentTab` (ai_comment, difficulty_reason), `CommentarySection` (overall_comment, nearby_comparison, score_strategies, strength/improvement areas, notable_questions, teaching_recommendations), `[id]/print/page.tsx` (q.ai_comment)
   - 새 AI 응답 텍스트 렌더링 추가 시: `renderInlineMath` 거치는지 반드시 확인하고, 그렇지 않으면 raw `$` 노출 발생

**3D 업적 뱃지 디자인 생성 (이미지 AI 공통 규칙):**
- **마스터 프롬프트**: `A high quality 3D mobile game achievement badge icon representing [주제]. Exclude all English letters. The icon must feature the bold Korean text '[한글 업적명]' built into the 3D design beautifully. Vibrant colors, premium, glossy, isolated on simple background, cartoonish, high quality render.`
- **필수 지침**: 영문 텍스트 오염을 막기 위해 `Exclude all English letters.` 옵션을 무조건 포함해야 함.
- **UI 연동 지침**: 하얗게 빛이 날아가는 것을 방지하기 위해 CSS `mix-blend` 모드를 절대 사용하지 말 것! 대신 부모 레이어에서 `overflow-hidden` 및 `rounded-full`(또는 `rounded-2xl`)로 감싸 물리적으로 둥글게 원형 크롭(Crop)하여 렌더링할 것 (`object-cover` + `scale-[1.15]` 활용).

### 7. 토스트 알림 — alert() 사용 금지

**모든 사용자 알림은 글로벌 토스트 시스템을 사용:**
```typescript
import { toast } from '@/components/ui/Toast';

toast.success('저장되었습니다');
toast.error('저장에 실패했습니다');
toast.warning('제목을 입력하세요');
toast.info('AI가 분석 중입니다');
```
- `alert()`, `window.alert()` 사용 금지 — 모든 곳에서 `toast.*()` 사용
- Zustand 기반 글로벌 상태, ToastContainer가 양쪽 레이아웃에 포함됨

### 8. 인쇄(Print) — A4 미리보기와 실제 인쇄 완전 일치

**원칙: 화면의 인쇄 미리보기(Print Preview)와 실제 A4 인쇄 결과가 정확히 일치해야 한다.**
- 인쇄 관련 컴포넌트는 반드시 A4 비율(210mm × 297mm) 기준으로 레이아웃 설계
- 화면 미리보기에서 보이는 페이지 나눔, 여백, 폰트 크기, 요소 배치가 실제 `@media print` 출력과 동일해야 함
- `@media print` CSS와 미리보기 CSS를 별도로 관리하지 말 것 → 공통 스타일을 공유하여 불일치 방지
- 미리보기에서 A4 크기를 `px` 단위로 시뮬레이션할 때는 고정 비율(예: `794px × 1123px` @96dpi) 사용
- 페이지 넘김(`page-break-before`, `break-before` 등)이 미리보기와 인쇄에서 동일하게 동작하는지 확인
- 새 인쇄 기능 구현 시 반드시 브라우저 인쇄 미리보기(`Ctrl+P`)로 검증 후 커밋

**인쇄 템플릿 시스템 (`/tests/[id]/print`):**
- 9개 템플릿: `default`, `exam`, `minimal`, `csat`, `classic`, `notebook`, `formal`, `bubble`, `large`
- 8개 테마 색상: 파랑(`#135bec`), 노랑(`#F59E0B`), 주황(`#F97316`), 핑크(`#EC4899`), 남색(`#3B52C2`), 녹색(`#10B981`), 청록(`#14B8A6`), 회색(`#6B7280`)
- 옵션: 1/2단 레이아웃, 간격 조절, 날짜/단원/난이도/구분선/정답 표시 토글
- localStorage 프리셋 저장 (`mathlab_print_preset`)
- 헤더 변형: `PrintableHeader`의 `variant` prop으로 8종 헤더 디스패치
- 인쇄 전용 KaTeX 크기: `.printable-math-content .katex { font-size: 1.05em }`, `.printable-math-large .katex { font-size: 1.25em }`

### 9. 페이지 레이아웃 — 3가지 패턴 + 래퍼 규칙

**모든 페이지는 3가지 레이아웃 패턴 중 하나를 따라야 한다:**

| 패턴 | 용도 | 래퍼 | 예시 |
|------|------|------|------|
| **패널형** | 목록+상세 관리 | `flex-1 flex min-h-0` + 좌측 `w-72` 사이드바 | 학생, 개념, 문제, 시험, 숙제, 설정 |
| **중앙정렬형** | 대시보드, 단순 목록, 양식 | `<PageContainer maxWidth="xl">` | 과정, 진단, 이용권, 퀴즈, 프로필 |
| **대시보드형** | 메인 대시보드 | `max-w-[1400px] mx-auto px-4 sm:px-6 py-6 md:py-8` | overview, OwnerDashboard, SuperAdmin |

**중앙정렬형 페이지 래퍼 규칙:**
- 반드시 `<PageContainer>` 컴포넌트 사용 — 직접 `px-6 py-8 max-w-[1200px] mx-auto` 등 작성 금지
- `maxWidth` 옵션: `sm`(640), `md`(800), `lg`(1024, 기본), `xl`(1200), `full`
- 제목은 `<PageHeader>` 컴포넌트 사용 (패널형은 좌측 사이드바 헤더)

**UI 표준:**
- 모서리 둥글기: `rounded-sm` 표준 — `rounded-lg` 사용 금지 (Card, Badge 등 컴포넌트 내부 제외)
- 버튼: 반드시 `<Button>` 컴포넌트 사용 — 커스텀 button 스타일 직접 작성 금지
- 빈 상태: 공용 컴포넌트 없음 — `<p className="text-xs text-slate-400 py-4 text-center">…없습니다</p>` 인라인 패턴 (`LoadingEmptyState` 는 레포에서 제거됨)
- 로딩: `<Skeleton>` 컴포넌트 사용 — `animate-pulse` 직접 사용 지양
- 스크롤바: 글로벌 thin 스크롤바 적용 (5px, 반투명) — 숨기려면 `.no-scrollbar` 클래스 사용
- 페이지네이션: `<Pagination>` 컴포넌트 사용, 사이드바 등 좁은 영역은 `compact` prop 사용

### 10. 공유 유틸 — 중복 코드 방지

**학습 활동 관련 공통 함수 (`@/lib/utils/activity`):**
```typescript
import { WEEKDAYS, ACTIVITY_COLORS, activityLevel } from '@/lib/utils/activity';
import { accuracyTextColor, accuracyBadgeColor, accuracyBarColor } from '@/lib/utils/activity';
import { formatGrade, formatGradeShort, getInitial } from '@/lib/utils/activity';
```
- 새 페이지에서 요일, 활동레벨, 정답률 색상, 학년 포맷 등이 필요할 때 이 유틸을 사용할 것
- 페이지 로컬에 동일 로직을 별도 정의하지 말 것

### 11. Prisma `Json?` 필드 — 타입 캐스팅 절대 금지, 진입부 정규화 필수

**원칙: Prisma `Json?` 필드는 런타임에 어떤 JSON 값(객체/배열/문자열/null)이든 들어올 수 있다. 저장 포맷이 시간에 따라 진화하면 동일 필드에 여러 형태가 혼재하므로, 구체 타입으로 캐스팅하면 컴파일러를 속여 런타임 `TypeError`를 만든다.**

**❌ 금지 — 컴파일러를 속이는 거짓 캐스팅:**
```ts
// 타입 선언에 거짓말
interface Input { examScope: string[] | null }   // ❌ DB에는 객체도 들어 있다

// 호출부에서 강제 캐스팅
examScope: examPaper.examScope as string[] | null   // ❌ 거짓을 통과시킴

// 배열 메서드 직접 호출
examPaper.examScope?.join(', ')                     // ❌ 객체면 즉시 TypeError
metadata.items.map(...)                             // ❌ items가 정말 배열인가?
```

**✅ 권장 — 함수 진입부에서 한 번 정규화 후, 정규화된 값만 사용:**
```ts
// 타입 선언은 정직하게 unknown
interface Input { examScope: unknown }

// 함수 시작 지점에서 정규화
const examScopeTopics: string[] = (() => {
  const raw = examPaper.examScope;
  if (Array.isArray(raw)) return raw as string[];                          // 레거시 string[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { topics?: unknown }).topics)) {
    return (raw as { topics: string[] }).topics;                           // 신형 { topics: [...] }
  }
  return [];
})();
const scopeLabel = examScopeTopics.length ? examScopeTopics.join(', ') : '미지정';
```

**검증 순서 — `.join`/`.map`/`.length`/`.includes` 등 배열 메서드 호출 전 반드시:**
1. `Array.isArray(raw)` — 진짜 배열인지 확인
2. `raw && typeof raw === 'object'` — 객체 여부 + null 체크 동시에
3. Optional chaining(`raw?.field`)만으로는 부족하다 — 타입까지 확인할 것

**해당 필드 목록 (현재 프로젝트의 주요 `Json?` 필드):**
- `ExamPaper.examScope` — 신형 `{ topics, examYear, examSemester, examCategory }` 객체 vs 레거시 `string[]`
- `Question.diagramSpec` — `DiagramSpec` 객체 vs `DiagramParam[]` 배열 (런타임 다형성, `resolveDiagramSpec()` 사용)
- `Question.choices` — `string[]` 또는 null
- `Test.questionIds`, `QuizSession.questionIds`, `*HomeworkPlan.questionIds` — `string[]` (중간테이블 전환기, 헬퍼 `getTestQuestionIds()` 등 사용)
- 기타 모든 스키마의 `Json?` 필드

**위반 시 실제 사례 (2026-05-12 핫픽스):**
- [article-generator.ts](src/lib/exam-analysis/article-generator.ts)이 `examScope: string[] | null`로 거짓 타입 선언
- [generate-article/route.ts](src/app/api/exam-analysis/[id]/generate-article/route.ts)이 `as string[] | null`로 거짓 캐스팅
- `examScope?.join(', ')` 호출 → 신형 객체 시험지에서 `TypeError: examScope?.join is not a function` → API 500 → "기출 분석 글 작성" modal이 "준비 중..."에서 무한 잔류
- 동일 프로젝트의 [analyze/route.ts:84-100](src/app/api/exam-analysis/[id]/analyze/route.ts:84), [nearby-count/route.ts:45,82](src/app/api/exam-analysis/nearby-count/route.ts:45), [ExamPaperList.tsx:82-87](src/components/exam-analysis/ExamPaperList.tsx:82)은 이미 안전 정규화 패턴 적용됨 — **새 코드는 이 패턴을 반드시 따를 것**

**스키마 진화 시 체크리스트:**
- `Json?` 필드의 저장 포맷을 바꿀 때 (예: `string[]` → `{ topics, ...meta }`)
  - **모든 소비 지점**(읽는 곳)을 grep으로 찾아 정규화 패턴 적용 여부 확인
  - 기존 데이터 마이그레이션 없이 dual-format 운용하면 반드시 정규화 헬퍼 통과
  - 검색 명령: `grep -rn "필드명" src/ --include="*.ts" --include="*.tsx"`

### 12. AI 출력 · 스트리밍 · UI 표시 · 게이팅 — 자주 빠지는 함정 모음

실제로 발생해 디버깅이 까다로웠던 사례 모음(2026-05-12 시작, 이후 세션에서 계속 추가). 같은 함정에 다시 빠지지 않도록 패턴화. **새 항목은 번호를 이어서 추가할 것** (제목에 개수를 박지 말 것 — 드리프트 원인).

#### 12-1. AI 모델 max_tokens 한도는 한글 본문 기준으로 산정

**증상**: Claude 응답이 `content` 중간에서 잘림 → `JSON.parse` 회복 불가 → 클라이언트 "준비 중..." 무한 잔류
**원인**: `max_tokens=8192`로는 한글 본문(2,500~3,200자) + JSON 오버헤드 + HTML 마크업이 못 들어감
**규칙**:
- Claude/Gemini 호출 시 한글 출력 한도 = **글자 수 × 약 5배 토큰 여유**로 산정
- 본문 작성형(블로그·보고서): 최소 **16,384 토큰** (`generateExamArticle` 패턴)
- `JSON.parse` 실패 시 **정규식 partial fallback** 필수 (각 필드를 독립 추출하여 부분 복구)
- `response.stop_reason === 'max_tokens'`이면 `console.warn`로 노출
- 사례: [article-generator.ts:extractJson + extractFieldsByRegex](src/lib/exam-analysis/article-generator.ts)

#### 12-2. 병렬 함수 호출 안의 fetch/파일I/O는 module-level Promise로 캐싱

**증상**: 한 요청에서 폰트 10번 동시 다운로드 (Regular 5번 + Bold 5번 = 165MB 네트워크 낭비)
**원인**: `Promise.all([svgToPng × 5])` → 각 `svgToPng`가 `ensureFonts()` 호출 → 5번이 동시에 파일 부재 판정 → 5번 다운로드
**규칙**:
```ts
// ❌ 매 호출마다 체크 + 다운로드 (race)
async function ensureX() {
  if (!exists(path)) await download(path);
  return path;
}

// ✅ module-level Promise 캐싱 (첫 호출만 다운로드, 후속은 같은 Promise await)
let readyPromise: Promise<string> | null = null;
async function ensureX() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => { /* 실제 다운로드 */ })();
  return readyPromise;
}
// 실패 시 readyPromise = null로 되돌려 재시도 허용
```
- Vercel Serverless 인스턴스는 격리됨 → cross-request stale 우려 없음
- 사례: [chart-image-generator.ts:ensureFonts](src/lib/exam-analysis/chart-image-generator.ts)

#### 12-3. AI 반환 값 키 매칭은 항상 정규화 후 비교

**증상**: 능력 영역 레이더 차트가 0%로 빈 다각형
**원인**: AI가 `ability_domain`을 `'CALCULATION'` / `'Problem-Solving'` / `'Calculation'` 등 변형으로 반환. raw 값으로 매칭 시 `'calculation'` 키와 불일치
**규칙**:
```ts
// ❌ raw 값 그대로 매칭
if (domain in counts) counts[domain]++;

// ✅ 대소문자 + 하이픈/언더스코어 정규화 + question_type fallback
const raw = q.ability_domain || TYPE_TO_DOMAIN[q.question_type] || 'calculation';
const domain = String(raw).toLowerCase().replace(/-/g, '_');
if (domain in counts) counts[domain]++;
```
- AnalyzedQuestion의 `ability_domain` / `question_type` / `question_format` 등 enum성 필드 모두 적용
- 사례: [chart-image-generator.ts:generateAbilityRadarSvg](src/lib/exam-analysis/chart-image-generator.ts)

#### 12-4. 클라이언트와 서버가 같은 데이터를 처리할 땐 정규화 패턴 통일

**증상**: 분석 화면(클라이언트)은 능력 영역 차트를 정상 표시하는데, 블로그 글(서버 차트 생성)은 0%로 빈 차트
**원인**: 분석 화면 `TypeRadarChart.tsx`은 이미 `toLowerCase()` 정규화 적용. 서버 `chart-image-generator.ts`는 raw 매칭. 같은 questions 배열인데 결과가 다름
**규칙**:
- 같은 입력 데이터에 대해 클라이언트·서버가 다른 결과를 만들면 사용자가 어디를 신뢰해야 할지 혼란
- 정규화·집계 로직은 **공용 유틸로 추출 권장**: `src/lib/exam-analysis/question-stats.ts` 같은 위치
- 추출 전이라도 패턴을 인라인으로 복제해 양쪽 결과를 일치시킬 것
- 사례: [DiscriminationSection.tsx의 변별력 공식](src/components/exam-analysis/DiscriminationSection.tsx) ↔ [article-generator.ts의 calcDiscriminationLabel](src/lib/exam-analysis/article-generator.ts) — 동일 공식 복제

#### 12-5. 사용자 노출 텍스트에 검증 불가 수치 노출 금지

**증상**: 블로그 글에 "변별력 지수 38점" / "갭 +4.4" 같은 수치를 직접 노출하면 학부모 독자는 그 수치의 기준점을 몰라 혼란
**원인**: 그래프/표로 보이는 수치는 시각적 맥락이 있지만, 본문 텍스트로만 노출되는 추상 수치는 기준점 부재
**규칙**:
| 데이터 종류 | 처리 |
|------------|------|
| 차트/표로 같이 보이는 수치 | 정확 수치 OK (난이도 분포, 단원 배점 등) |
| 본문 빈출 + 합산으로 자체 검증되는 수치 | 정확 수치 OK (서술형 21점 / 21% 등) |
| 추상 지수 / 갭 / 분포 점수 (시각 자료 없음) | **정성 라벨로 변환** ("높은 편 / 적정 / 다소 낮은 편 / 낮음") |

```ts
// ✅ 정성 라벨 매핑 패턴
const overallLabel = avg >= 70 ? '높음' : avg >= 50 ? '적정' : avg >= 35 ? '다소 낮음' : '낮음';
```
- AI 프롬프트에 "수치 노출 금지" 명시 + 금지/허용 예시 함께 제공
- 사례: [article-generator.ts:calcDiscriminationLabel](src/lib/exam-analysis/article-generator.ts) + 프롬프트 "## 추가 분석 인사이트" 섹션

#### 12-6. 스트리밍 응답은 최종 결과와 시각적 점프 최소화

**증상**: 글 작성 중에는 `{"title":"...","content":"<h2>...` raw JSON이 보이다가 완료 시점에 갑자기 깔끔한 HTML로 점프
**원인**: 클라이언트가 stream 텍스트를 raw 그대로 표시
**규칙 (4단계)**:
1. **JSON wrapper 실시간 스트립**: 정규식으로 `"content":"..."` 값만 실시간 추출, title/tags/메타는 표시 제외
2. **HTML 실시간 렌더링**: `dangerouslySetInnerHTML`로 즉시 렌더링하되 미완성 태그 `safeTrim` (마지막 `<` 이후가 `>`로 안 닫혔으면 절단)
3. **참조 자원 사전 송신**: 차트 PNG 같은 자원은 본 스트림 시작 전에 별도 이벤트(`chart-urls`)로 URL을 미리 전송 → 클라이언트가 토큰을 실시간 `<img>`로 치환
4. **자원 도착 전 placeholder**: 회색 박스("차트 생성 중…")로 자리 유지 → URL 도착 시 자연스럽게 실제 이미지로 전환
- 사례: [ArticleEditorModal.tsx:extractHtmlFromStream + replaceChartTokens](src/components/exam-analysis/ArticleEditorModal.tsx) + [generate-article/route.ts:chart-urls 이벤트](src/app/api/exam-analysis/[id]/generate-article/route.ts)

#### 12-7. 반올림 표시는 미세 차이를 가린다

**증상**: 시험 난이도 Level 2.5와 Level 2.9가 모두 박스 3 강조로 동일하게 보임 → 사용자가 두 시험을 같은 난이도로 오해
**원인**: `Math.round(weightedAvg)`만 시각화에 사용
**규칙**:
- 정수 카테고리(박스/뱃지/등급)는 round 결과로 강조해 카테고리적 인식 제공
- **동시에 정확한 소수점 위치를 가리키는 마커**(▼/●/슬라이더) 추가 → 미세 차이도 시각화
- 정확한 원본 값은 `title` 속성에 hover 노출 (예: `title="정확한 가중평균: 2.92"`)
- 사례: [AnalysisDetail.tsx 난이도 카드의 ▼ 마커](src/app/(teacher)/exam-analysis/AnalysisDetail.tsx)

#### 12-8. 카카오 로컬 API — 키 종류 + KA 헤더 정책 함정 (2026-06-01)

**증상**: `geocode-schools.ts` 실행 시 모든 요청 401 또는 `AccessDeniedError: KA Header is required`
**원인**: 카카오 디벨로퍼스 키는 4종류이며, 각 키별로 요구사항이 다름
**키별 동작 (반드시 REST API 키 사용!):**
| 키 종류 | KA 헤더 | 도메인 등록 | 서버사이드 |
|---------|---------|------------|-----------|
| **REST API 키** ✅ | 불필요 | 불필요 | OK |
| JavaScript 키 | **필수** | **필수** (도메인 mismatch 시 403) | 사실상 불가 |
| Admin 키 | — | — | 보안 위험 |
| 네이티브 앱 키 | — | — | 모바일 SDK 전용 |

**확인 방법:** 카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 페이지에서 "REST API 키" 라벨이 붙은 것 사용
**테스트:**
```bash
node -e "fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent('서울 강남구'), { headers: { Authorization: 'KakaoAK YOUR_KEY' } }).then(r => r.text()).then(console.log)"
# REST API 키면 정상 응답, JavaScript 키면 'KA Header is required'
```
**사례**: [geocode-schools.ts](scripts/geocode-schools.ts) 호출 시 KA 헤더 없이 작동해야 정상 (붙이면 도메인 등록 강제됨)

#### 12-9. NEIS Open API — 키워드 검색 우회 + 주소 비어있는 학교 처리

**상황**: NEIS API에서 받은 학교 주소가 너무 더러워서 카카오 주소 API가 매칭 실패 (행정실 전화번호/사서함/우편번호 혼입, 도로명+지번 동시 표기 등)
**규칙 (2단계 fallback)**:
1. 1차: 카카오 **주소 검색 API** (`/v2/local/search/address.json`) — 대부분 자동 처리됨
2. 2차: 카카오 **키워드 검색 API** (`/v2/local/search/keyword.json?query=학교명&category_group_code=SC4`) — 학교명만으로 검색, `SC4`는 학교 카테고리
3. 3차: 그래도 안 잡히면 NEIS DB 자체 오류일 가능성 (폐교/신설 미입력) → 수동 확인 후 삭제

**실측 (5,725개교 기준):**
- 1차 주소 API: **99.8% 성공** (12건 실패)
- 2차 키워드 API: 11/12 추가 매칭 (잘못 매칭 1건 주의 — 학교명 동음이의 발생, 정합성 검증 필수)
- 최종 1건은 NEIS 데이터 오류로 DB 삭제

**사례**: [scripts/geocode-failed-by-keyword.mjs](scripts/geocode-failed-by-keyword.mjs) — 키워드 fallback + 매칭 결과 검증 출력

#### 12-10. 🔴 클라이언트 폴백이 서버 가드보다 보수적이면 "조용한 오잠금"이 된다 (2026-07-21)

**증상**: 지점(Tenant)이 **Pro인데** 그 지점 소속 **강사 화면에서만** "AI 시험 총평은 Pro 플랜 전용입니다" 배너 + 주변학교·연도 비교 미표시. 원장 화면은 정상.

**원인 체인** (3단계라 한 곳만 보면 안 잡힘):
1. `GET /api/billing` 이 **OWNER+ 전용**이라 강사는 **403**
2. `SubscriptionProvider` 가 비-2xx를 **조용히** `FREE_FALLBACK`(`commentary/nearby=false`)으로 처리
3. → `commentaryLocked = !features.commentary` → 잠김 배너

**핵심**: 서버 가드 `assertPlanFeature` 는 **tenantId 기준**이라 실제로는 **허용** 상태였다. 즉 *서버는 통과시키는데 UI만 잠긴* 불일치. 권한이 없는 게 아니라 **권한 상태를 못 읽어서** 잠긴 것.

**구조적 전제 (오해 주의)**: 플랜은 `TenantSubscription`(**`tenantId @unique`**) — **지점 단위 단일 구독**이다. `userId` 필드가 없고, 사용자별 플랜/기능 배정 배선은 **어디에도 없다**(유일했던 `/api/entitlements/allocate` 는 410 폐지, 그나마 학생 대상). 사용자별 기능 권한은 **데모 계정 전용**(`demoCtx.perms`)뿐. → "원장이 강사에게 개별 업그레이드"라는 개념 자체가 없으며, **지점이 Pro면 그 지점 강사 전원이 Pro** 여야 정상.

**규칙**:
1. **게이트 상태 조회 API의 권한 ≤ 그 게이트가 보호하는 기능의 권한.** 기능을 쓸 수 있는 사람은 그 기능의 잠금 여부도 읽을 수 있어야 한다. 조회 엔드포인트를 통째로 막지 말고 **민감 필드만 응답에서 가릴 것**(결제 필드는 `canManageBilling` 분기, 실행 경로 `checkout`/`portal` 은 `requireOwner` 유지).
2. **기능을 잠그는 방향의 fail-safe 폴백은 반드시 로그를 남길 것.** 조용한 강등은 추적 불가 — 이 버그가 오래 안 잡힌 이유. (`console.warn('[구독] 상태 조회 실패(403) — 무료 플랜으로 폴백')`)
3. **CTA는 실제 도달 가능한 사용자에게만 렌더.** 강사에게 보이던 [구독 업그레이드]→`/billing` 은 그 페이지가 OWNER 가드라 **막다른 링크**였다.

**진단법**: "특정 역할에서만 기능이 잠긴다" 는 보고 → ① 서버 가드의 판정 기준(tenantId? userId?) 확인 ② **그 상태를 제공하는 조회 API의 권한**과 대조 ③ Network 탭에서 해당 API 상태코드 확인(**403이면 폴백 경로 확정**). 플랜 데이터 자체를 의심하기 전에 **전달 경로**를 먼저 볼 것 — DB는 멀쩡했다.

**사례**: `7669375f` fix(billing) — [api/billing/route.ts](src/app/api/billing/route.ts), [AnalysisDetail.tsx](src/app/(teacher)/exam-analysis/AnalysisDetail.tsx), [SubscriptionProvider.tsx](src/components/providers/SubscriptionProvider.tsx). §12-4(클라이언트·서버 정규화 통일)의 **권한 버전** — 같은 데이터를 양쪽이 다르게 판정하면 사용자는 어디를 믿어야 할지 모른다.

#### 12-11. 🔴 파생값끼리 비교하는 가드는 "검증"이 아니라 항등식이다 + 꼬리 누락은 갭 탐색으로 안 잡힌다 (2026-07-27)

**증상**: 정상 시험지(경명여중1)를 재업로드했더니 **마지막 서술형(10점)이 통째로 사라진** 21문항/90점 분석본이 나왔고, 그 상태로 **AI 총평까지 자동 생성**됨. 4일 전 동일 PDF(바이트 동일)는 22문항/100점으로 정상 분석됨 → 입력이 아니라 **AI 비결정성**.

**원인 체인 (4겹이 전부 뚫림)**:
1. **가드가 항등식**: `readinessCheck`가 `저장된 totalPoints` vs `문항 배점 합계`를 비교하는데, `analyze/route.ts`가 `totalPoints = sumPoints(questions)`로 저장 → **같은 값끼리 비교** → "배점 합계 ≠ 만점" 차단이 **한 번도 발동한 적 없음**. 동일 코드가 `page.tsx` 자동 체인에도 복제돼 있어 총평이 자동 생성됨.
2. **감지하고도 삼킴**: `validateAndPenalize`는 AI 신고 만점(100) vs 합계(90)를 **정확히 감지**해 신뢰도를 `min(0.1×0.3, 0.2)=0.03` 깎았다(0.95→0.92, 화면의 "신뢰도 92%"가 그 흔적). 그런데 **유일한 결과가 그 3% 강등** — 노출도 차단도 로그도 없음.
3. **문항 수 검사는 죽은 코드**: `exam_info.total_questions`를 검증 **전에** `questions.length`로 덮어써서 `questions.length !== exam_info.total_questions`가 영구 false.
4. **`fillNumberGaps`는 중간 구멍만**: 갭 탐색이 `min..max` 사이만 순회 → 마지막 문항이 없으면 max가 줄 뿐 구멍이 안 생김. 게다가 서술형은 번호가 `"서술형2"` 문자열이라 애초에 탐색 대상 제외 — **실제 누락은 대부분 배점 큰 마지막 서술형**.

**규칙**:
1. **검증 기준은 반드시 산출물 바깥에서 온 값이어야 한다.** 산출물에서 파생된 값끼리 비교하면 어떤 오류도 못 잡는다. 여기선 AI가 시험지에서 읽은 만점/문항수가 **유일한 독립 기준** → `exam_info.declared_total_*`로 보존하고 절대 합계로 덮어쓰지 않는다. 미신고는 `null`(판정 불가)로 두고 **100 같은 기본값으로 채우지 말 것** — "AI가 100이라 했다"와 "몰라서 100으로 뒀다"를 섞으면 오탐/미탐이 동시에 생긴다.
2. **불일치를 감지했으면 반드시 가시화하라.** 신뢰도 소수점 강등 같은 "조용한 감점"은 삼키는 것과 같다(§12-10과 동일 병증). 감지 → 재시도 → 잔여분 placeholder 삽입 → readiness 차단 → 배너, 까지 가야 사용자가 안다.
3. **AI 비결정성은 재시도로 복구하라.** 동일 입력에서 결과가 달라지는 게 원인이면 1회 재분석이 가장 직접적인 해법(비용은 실패 시에만 발생). 채택 기준은 `isBetterPass`(완전한 쪽 > 부족분 적은 쪽 > 문항 많은 쪽).
4. **누락 감지 로직을 프롬프트로도 방어**: AI가 `total_questions/total_points`를 **자기 출력에 맞춰 신고하면 기준 자체가 사라진다** → "시험지에서 직접 읽은 값이며 questions 배열과 어긋나도 그대로 신고하라"를 명시(v1.6.0).
5. **동일 판정 로직 복제 금지** — `checkAnalysisReadiness`(`readiness.ts`) 단일 소스로 통합. §12-4의 재발 사례.

**진단법**: "가드가 있는데 안 걸렸다" → 가드가 비교하는 **양쪽 값의 출처**를 먼저 확인. 둘 다 같은 산출물에서 파생됐으면 그 가드는 죽어 있다. 신뢰도/점수 같은 파생 지표가 미세하게 낮으면(예: 정확히 0.03) **이미 감지한 코드가 어딘가 있다는 신호** — 페널티 상수를 역산해 찾을 것.

**사례**: [ai-engine.ts](src/lib/exam-analysis/ai-engine.ts)(`assessCompleteness`/`appendMissingTail`/재시도), [readiness.ts](src/lib/exam-analysis/readiness.ts)(공유 게이트), [types.ts](src/lib/exam-analysis/types.ts)(`AnalysisCompleteness`), [prompt-builder.ts](src/lib/exam-analysis/prompt-builder.ts). 회귀 검증: `npm run verify:completeness` (7 시나리오 — 실패 재현·정상·판정불가·배점초과·구버전 소급차단 금지 포함).

#### 12-12. 🔴 사용자에게 보일 에러는 "금지어 가리기"로 못 막는다 — 화이트리스트로 (2026-08-27)

**증상**: 시험지 분석 실패 토스트에 `시험지 분석 실패: AI 실행기가 종료되었습니다 (code 1) Error: When using --print, --output-format=stream-json requires --verbose` 가 그대로 노출. 다른 경우엔 `AI_API_KEY 환경변수가 설정되지 않았습니다`.

**원인**: UI가 **모델명만** 치환하는 블랙리스트였다 — `detail.errorMessage.replace(/gemini|claude|anthropic/gi, 'AI')`. 규칙 #0(모델명)은 지켰지만 #0-1(인프라·내부 사정)은 전혀 못 막았다. 환경변수명·CLI 플래그·영문 예외·스택·ORM 내부 메시지가 전부 통과. 게다가 `analyze/route.ts` 가 **원문을 DB(`ExamPaper.errorMessage`)에 저장**해 새로고침해도 계속 보였다.

**규칙**:
1. **사용자 노출 에러는 `toUserFacingError()` 를 거친다** (`src/lib/exam-analysis/shared/error-message.ts`). `errorMessage: e.message` / `message: errorMsg` 를 직접 쓰지 말 것. **DB 저장 시점에도 정제**해야 한다(표시 시점만 막으면 레거시 행이 남는다).
2. **화이트리스트로 설계한다** — "우리가 한국어로 던진 문구만 통과, 나머지는 원인 범주별 한국어로 치환". 금지어 목록은 새 실행기·SDK가 붙을 때마다 늘려야 하고 한 번 빠뜨리면 그대로 샌다. 위 유출이 정확히 그 방식이라 발생했다.
3. **원문은 `console.error` 로 남긴다** — 디버깅 정보를 잃지 않으면서 사용자에게만 감춘다. "정제 = 정보 삭제"가 아니다.
4. **원인 범주를 구분해 할 일을 알려준다** — 전부 "실패했습니다"로 뭉개면 사용자가 재시도해야 할지 파일을 다시 올려야 할지 모른다. (연결/한도/시간초과/파일/응답형식)

**회귀 검사**: `npx tsx scripts/parity/check-error-message.ts` — 실제 유출된 메시지 8종이 가려지는지 + 정상 안내 문구 6종이 그대로 통과하는지 양방향 고정.

#### 12-13. 🟡 "무엇을 썼는지" 목록을 손으로 적으면 반드시 산출물과 어긋난다 (2026-08-27)

**증상**: 영어 분석의 진단 metadata(`used_templates`)가 프롬프트에 **넣지도 않은** 템플릿을 썼다고 보고하고, 실제 주입한 것은 빠뜨렸다. 난이도 표 이름도 실제(`_4LEVEL`)와 다른 `_5LEVEL`로 기록.

**원인**: 프롬프트를 조립하는 코드와 "사용 목록"을 만드는 코드가 **따로** 존재했다. 프롬프트가 진화하는 동안 목록은 그대로 남았다.

**규칙**: 산출물과 그 산출물을 설명하는 메타데이터는 **한 곳에서 파생**시킬 것. `getGuidelineBlocks()` 가 `{name, text}` 를 반환하고, 본문은 `.map(b => b.text)`, 목록은 `.map(b => b.name)` — 구조적으로 어긋날 수 없다. §12-4(클라이언트·서버 정규화 통일)의 **메타데이터 버전**.

**부수 효과 주의**: 이런 리팩터는 "출력이 안 바뀌었다"를 증명해야 한다. 바이트 대조 하네스(`scripts/parity/`)로 영어 프롬프트 **변경 0** 을 확인하고 커밋했다.


#### 12-14. 🔴 "새 항목은 켜서 붙인다"는 기본값은 기능 추가를 회귀로 만든다 (2026-08-28)

**증상**: 총평 프리셋용 전용 블록(손편지·히트맵·스토리)을 레지스트리에 추가하는 순간, **기존 모든 분석본 하단에 그 블록이 나타날** 상황이었다.

**원인**: `normalizeTemplate` 이 "저장된 설정에 없는 블록"을 `enabled: true` 로 뒤에 붙였다. 원래 의도는 옳다 — 신규 기본 기능이 조용히 누락되지 않게. 그러나 **"모든 새 블록은 모두에게 필요하다"** 를 전제한 규칙이라, 특정 프리셋에서만 쓸 블록이 생기는 순간 무너진다.

**규칙**:
1. **의도를 필수 필드로 강제하라.** `defaultEnabled: boolean` 을 **필수**로 뒀다. `optIn?: boolean` 같은 선택 필드는 새 블록에서 깜빡 빠뜨리면 다시 "전부 자동 ON"으로 조용히 돌아간다. 필수면 컴파일러가 매번 판단을 요구한다.
2. **회귀 검사는 정규화 결과가 아니라 렌더 결과를 봐야 한다.** 꺼진 블록도 정규화 결과에는 남으므로 거기서 비교하면 누출을 못 잡는다 → `resolveBlocks()` 의 실제 렌더 목록을 스냅샷한다. 검사는 레지스트리를 순회하므로 **새 opt-in 블록이 생기면 자동으로 감시 대상**이 된다(`npm run verify:template-blocks`).
3. **전개 함수가 "기본 목록"만 순회하면 새 블록 지정이 조용히 버려진다.** `presetToConfig` 가 `DEFAULT_TEMPLATE.blocks` 만 돌아 프리셋의 `letterBody: { enabled: true }` 를 버렸고, 그 뒤 정규화가 `defaultEnabled=false` 로 다시 꺼서 **프리셋이 빈 껍데기**가 됐다. 개수만 세는 검사("블록 14개")는 이걸 통과시킨다 — 기본 전부 + 델타로 끌어온 것이 **모두** 들어왔는지를 봐야 한다.

#### 12-15. 🟡 팔레트를 뒤집으면 "겸용 토큰"이 먼저 깨진다 (2026-08-28)

**증상**: 첫 다크 테마(`terminal`)를 넣자 총평의 여러 라벨이 사라졌다. 대비 실측: 결론 h3 **1.06**, 형식분포 "50%" **1.09 / 1.64**, 전략 태그 **2.86**.

**원인**: 테마 색 자체는 정확했다(독립 계산으로 검증). 문제는 **컴포넌트가 "지면은 밝다"를 가정**한 것.
- `--v3-ink` 가 **본문 글자색이자 채움색**으로 겸용된다. 밝은 지면에서는 둘 다 near-black 이라 "ink 로 칠한 면 위 흰 라벨"이 성립했는데, 지면이 어두워지면 ink 가 밝아져 흰 글씨 on 흰 면이 된다.
- `.v3-conclusion h3` 는 **색을 아예 안 정해** 앱 기본 글자색(slate-900)을 상속했다. 밝은 테마에서는 우연히 맞았을 뿐이다.

**규칙**:
1. **문서는 자기 글자색을 스스로 소유해야 한다.** 앱 기본색에 기대는 규칙은 팔레트가 뒤집히는 순간 드러난다. 형제 규칙(`p` 는 `--v3-body`)이 색을 정하는데 `h3` 만 없으면 그게 누락 신호다.
2. **"X 위의 글자" 색은 X 를 칠한 토큰에서 파생시켜라.** `ink` 처럼 역할이 둘인 토큰은 다크에서 반드시 충돌한다. 근본 해결은 채움색·글자색 토큰 분리지만, 기존 테마의 캡처 이미지를 바꾸므로 다크 테마에만 스코프해 보정했다(부채는 주석에 기록).
3. **다크 도입은 대비 실측으로 닫아라.** 눈으로 "잘 보인다"가 아니라 `getComputedStyle` 로 실제 전경/배경을 뽑아 WCAG 비를 계산한다. 조상까지 거슬러 실제 배경을 찾아야 정확하다(투명 요소가 많다).

**함정**: 선택자를 `.v3-stacked-bar-format > div > div` 로 짰다가 안 먹었는데, 컴포넌트를 열어 보니 세그먼트가 **직접 자식**이었다. dev 서버 탓으로 넘기기 전에 DOM 구조를 확인할 것.

#### 12-16. 🟡 중단 기준은 기준선과 함께 정해야 의미가 있다 (2026-08-28)

**증상**: 신규 기능(Wrapped 슬라이드 10장 캡처)의 착수 여부를 "p95 30초 초과면 중단"으로 합의했는데, 실측하니 **40초**였다.

**원인**: 30초는 **현재 기능이 얼마나 걸리는지 모르는 상태에서** 정한 숫자였다. 실측해 보니 이미 서비스 중인 [블로그용 총평지]가 **93.9초**(14블록, 장당 5.2초)였다 — 그 기준을 그대로 적용하면 **기존 기능이 먼저 탈락**한다.

**규칙**: 성능 게이트를 세울 때는 **같은 방법으로 기준선을 먼저 재라.** 기준의 취지("사용자가 못 기다릴 것을 내보내지 말자")로 다시 읽으면 신규(40초)는 기존(94초)의 절반이라 통과다. 절대 숫자가 아니라 **비교 대상**이 기준이다. (부수 발견: 기존 캡처가 장당 5.2초로 느리다 — 별도 과제.)

#### 12-17. 🔴 dev 서버가 CSS 변경을 반영하지 않는다 — 값이 "고정"이면 코드가 아니라 캐시를 의심 (2026-08-28)

**증상**: `globals.css` 의 폰트 크기를 `22vw` → `calc(var(--v3-hero-num)*1.6)` → `24cqw` 로 세 번 바꿨는데 계산값이 **208px 로 고정**이었다. 셀렉터·특이도·단위를 한참 의심했다.

**원인**: Turbopack 이 CSS 변경을 반영하지 않았다. `.next` 삭제 후 재기동하니 값이 즉시 따라왔다.

**규칙**:
- **여러 번 고쳤는데 측정값이 한 번도 안 변하면 코드가 아니라 빌드 캐시를 의심하라.** 값이 *틀린* 것과 값이 *고정된* 것은 다른 신호다.
- CSS 대규모 변경 후에는 `.next` 삭제 + 재기동으로 한 번 확인하고 측정할 것.
- ⚠️ 관련: **dev 서버를 둘 이상 띄우면** 같은 `.next` 를 공유해 `next/font/google` 이 폰트를 못 받아 **모든 인증 페이지가 500** 이 된다(curl 로는 폰트 URL 이 200 이라 네트워크로 오진하기 쉽다). `Get-CimInstance Win32_Process` 로 mathlab node 프로세스 수를 먼저 세라 — 이번에 3개가 동시에 떠 있었다.

## 프로젝트 구조

> **사문화 코드는 레포에 없다** — 기출분석 전용화로 아무 데서도 import 되지 않게 된
> 77파일 10,415줄을 2026-08-30 에 레포 **밖 `F:/mathlab-archive/`** 로 뺐다.
> 전체 목록·검증 방법·복구법: **[docs/DEAD_CODE_ARCHIVE_2026-08.md](docs/DEAD_CODE_ARCHIVE_2026-08.md)**
>
> 되살릴 땐 그 폴더가 없어도 된다 — 살아 있던 시절부터 추적되던 파일이라 히스토리에 영구 보존돼 있다:
> `git checkout 9231e5ab^ -- src/lib/utils/svg-diagrams/` (`^` 필수)
> 이관 커밋: `9231e5ab`(다이어그램 34) `045dbc59`(UI 27) `93e4e6fa`(스키마 7) `75103c80`(lib 9)
>
> `_archive/` 는 `.gitignore` · `tsconfig.json` · `eslint.config.mjs` · `.vercelignore` 4곳에서
> 차단된다 — 로컬에서 다시 꺼내 놔도 커밋·타입체크·린트·배포에 새어 들어가지 않는다.

```
src/
├── app/
│   ├── (auth)/        # 로그인
│   ├── (teacher)/     # 선생님 페이지 (exam-analysis, admin, billing, entitlements)
│   ├── demo/          # 비로그인 체험 (익명화 픽스처)
│   ├── api/           # admin, auth, billing, entitlements, exam-analysis,
│   │                  # inquiries, parax, questions, schools, users, webhooks
│   ├── page.tsx       # 공개 랜딩
│   └── globals.css    # Tailwind 테마 + 디자인 토큰
├── components/
│   ├── exam-analysis/ # 기출 분석 UI (본체)
│   ├── ui/            # Button, Input, Toast, Skeleton, Pagination, Tabs,
│   │                  # PageContainer, PageHeader, ConfirmDialog, MathSpinner,
│   │                  # LogoIcon, NarrowScreenGuard
│   ├── math/          # MathRenderer + shared/
│   ├── providers/     # SessionProvider, SubscriptionProvider
│   ├── layout/        # ExamOnlyTopBar
│   ├── admin-table/   # 관리자 표
│   └── landing/       # 공개 랜딩
├── lib/
│   ├── auth.ts        # NextAuth 설정
│   ├── db.ts          # Prisma 싱글톤 클라이언트
│   ├── exam-analysis/ # 기출 분석 엔진 (agents, blocks, data, english, math, shared)
│   ├── api/           # API 헬퍼 (auth, errors, helpers, tenant-scope, validation)
│   ├── billing/       # 구독 플랜 게이팅 (guard, plans)
│   ├── entitlements/  # 이용 권한 (service)
│   ├── demo/          # 데모 계정·픽스처 (accounts, demo-exams.json, naver-blocks, util)
│   ├── parax/         # parax 연동 (handoff)
│   ├── pdf-extract-engine/  # PDF 추출 (core, ai, hooks, presets)
│   ├── services/      # gemini.ts, question-tagger.ts
│   ├── schemas/       # question.ts (Zod)
│   ├── constants/     # curriculum, schools(GPS), navigation, billing, site 등
│   └── utils/         # box-grid.ts, school-matcher.ts
├── hooks/             # useAuth, useExtractToBank
└── types/             # index.ts(UserRole 등), mathgen.ts, diagram.ts, pdf-extract.ts
```

## 주요 도메인

### 5단계 빈칸 학습

| 단계 | Stage Enum | 설명 | XP |
|------|------------|------|----|
| 개념학습 | `READING` | 내용 읽기 + 메모 | 5 |
| 빈칸 1단계 | `BLANK_EASY` | 핵심 용어 (easy) | 10 |
| 빈칸 2단계 | `BLANK_HARD` | easy + hard | 15 |
| 통문장 암기 | `BLANK_FULL` | 전체 빈칸 (full) | 20 |
| 백지 복원 | `BLANK_PAGE` | 전체 내용 백지에서 복원 | 30 |

- 빈칸 난이도: `BlankDifficulty = 'easy' | 'hard' | 'full'`
- 단일 exercise에 per-blank difficulty 태깅
- 학생 API level 파라미터: 1=easy만, 2=easy+hard, 3=전부

### 교육과정 체계

```
학교급: elementary(초3-6) | middle(중1-3) | high(공통수학1,2/대수/미적분/확통/기하)
학기: 1 | 2 (고등은 0)
영역(part): calc | algebra | func | geo | data
대단원(chapter) → 중단원(section) → 소단원(sectionSub)
```

Grade 코드: `elementary_3`, `middle_1`, `high_algebra` 등

**교육과정 계층 구조 (curriculum.ts 기준):**
- **초등**: 2단계 — chapter = 단원명 (예: "덧셈과 뺄셈"), section = 세부 주제, sectionSub = NULL
- **중등**: 3단계 — chapter = 영역명 (예: "수와 연산", "기하"), section = 중단원 (예: "소인수분해"), sectionSub = 소단원
- **고등**: 3단계 — chapter = 대단원 (예: "다항식", "방정식과 부등식"), section/sectionSub = 중/소단원
- 고등 grade 매핑: `high_1`→공통수학1, `high_2`→공통수학2, `high_algebra`→대수, `high_calculus1`→미적분I, `high_prob`→확률과 통계, `high_calculus2`→미적분II, `high_geo`→기하
- 개념 편집기 드롭다운은 `curriculum.ts`의 **정확한 문자열**과 매칭 → DB chapter/section 값은 반드시 curriculum.ts와 일치해야 함

**⚠️ 문제(Question) 단원 매핑 — 절대 규칙:**
- **chapter/section 값은 반드시 `curriculum.ts`의 정확한 문자열이어야 한다.** 출판사별 변형 단원명 사용 금지.
- PDF 추출, AI 생성, 수동 등록 등 어떤 경로든 문제 저장 전에 curriculum.ts 표준 단원명으로 매핑할 것.
- PDF 추출 프롬프트에 해당 학년의 curriculum.ts 단원 목록을 반드시 주입하여 AI가 표준 단원명만 반환하도록 강제.
- 정규화 스크립트: `npx tsx scripts/normalize-chapters.ts --apply`

**⚠️ questionNum — 절대 규칙 (소스 유형별 분리):**
- **교과서 추출**: 같은 `bookCode + chapter` 내에서 #1부터 유일 순번. section → createdAt 순 정렬.
- **기출 (시험지)**: 같은 `bookCode` 내에서 #1부터 유일 순번. **원본 시험지의 문항 순서를 반드시 유지** (대단원별 재정렬 금지).
- **AI 생성**: 생성 순서대로 순번 부여.
- 새 문제 추가 시: 해당 범위의 `MAX(questionNum) + 1`로 부여.
- 일괄 추출 후: `scripts/normalize-chapters.ts`로 교과서 문제만 재정렬 가능 (기출 제외).

### 연산 생성기

79개 카테고리, 무한 문제 생성. `src/lib/services/arithmetic-generator/`
카테고리 예: `add_1digit`, `mul_2x1digit`, `frac_add_same`, `dec_div` 등

### 사이드바 네비게이션

Additive 구조 — 상위 역할이 하위 역할 메뉴를 포함 (`src/lib/constants/navigation.ts` → `Sidebar.tsx` / `CommandPalette.tsx` 공유):

**TEACHER 기본:**
- **홈**: 대시보드
- **우리 반**: 학생 목록, 반 목록
- **출제·준비**: 개념 조회, 문제 조회, 연산 프린트, 문제 프린트
- **배정·평가**: 시험 출제, 숙제 출제, 퀴즈 배틀
- **성적·분석**: 학습 현황, 기출 분석, 진단 결과
- **기타**: 공지사항, 도움말, 설정, 문의하기

**+ MANAGER 추가 (보라색 구분선):**
- **팀 관리**: 선생님 관리

**+ OWNER 추가:**
- **지점 운영**: 이용권 관리
- 라벨 변경: 학생 목록→학생 관리, 반 목록→반 관리, 개념 조회→개념 등록, 문제 조회→문제 출제
- 성적·분석 + 리포트

**SUPER_ADMIN**: 별도 전용 네비 (플랫폼 관리, 컨텐츠, 시스템)

이용권 없는 메뉴는 자동 숨김 (`licenseFeature` 필터링)

**커맨드 팔레트**: `Ctrl+K`로 전체 메뉴 빠른 검색/이동 (`CommandPalette.tsx`, 네비와 동일 데이터 사용)

### PDF 문제 추출 시스템

수학 문제집 PDF → Gemini Vision으로 구조화 추출 → 문제은행 일괄 저장.
- 클라이언트 사이드 PDF 처리 (`pdfjs-dist`)
- 4단계 위자드: 업로드 → 페이지 선택 → AI 추출 미리보기 → 저장
- 해설 PDF 별도 업로드로 정답/풀이 매칭 지원
- 관련 파일: `src/types/pdf-extract.ts`, `src/lib/utils/pdf-processor.ts`, `src/app/api/questions/pdf-extract/`

**⚠️ SUPER_ADMIN 전용 (Gemini quota 보호) — 3중 방어:**
- API: `/api/questions/pdf-extract`, `/api/questions/pdf-extract-solutions`, `/api/exam-analysis/[id]/extract-to-bank` 모두 `requireSuperAdmin`
- UI: `/questions/pdf-import` 페이지 자체 가드 (role !== SUPER_ADMIN 시 `/overview` 리다이렉트)
- 네비: `navigation.ts`에서 `minRole: 'SUPER_ADMIN'` 필터링

**후처리 정규화 (Gemini 추출 오류 자동 보정) — `src/lib/pdf-extract-engine/ai/post-processor.ts`:**
- `normalizeMathText(text)` — content/choices/explanation/scoringCriteria에 적용
  1. `fixLatexEscaping` — JSON 이스케이프 복원, 리터럴 `\n` → 실제 줄바꿈, `\dfrac` → `\frac`
  2. 수식 밖 `\textrm{X}` / `\text{X}` / `\mathrm{X}` → `X`, `\textbf{X}` → `**X**`, `\textit{X}` → `*X*`
  3. 인접 인라인 수식 글루 분리: `$A$$B$` → `$A$ $B$` (최대 5회 반복)
  4. 블록 수식 `$$...$$` 내 2줄 이상 + `=` 2개 이상 → `\begin{aligned}...\end{aligned}` 자동 래핑
  5. 연속 공백/3+ 줄바꿈 정리 (수식 내부는 보호)
- `normalizeAnswerField(answer)` — 정답 필드 전용
  - LaTeX 커맨드 감지(`\frac`, `\sqrt`, `\times`, `^{`, `_{` 등) + `$` 미포함 시 자동 `$...$` 래핑
  - 콤마 구분된 여러 정답도 각각 래핑
- **추출 프롬프트 규칙 (Gemini에 사전 지시):**
  - 다단계 계산식은 반드시 `\begin{aligned}...\end{aligned}` 사용 (평문 `\n`으로 = 나열 금지)
  - 인라인 수식 연속 시 공백 필수 (`$A$ $B$`, 금지 `$A$$B$`)
  - `answer` 필드에 LaTeX 수식 있으면 반드시 `$...$` 감싸기
  - 해설이 페이지 경계를 넘으면 끝까지 합쳐서 추출
- **해설 추출 페이지 경계 처리:** `pdf-extract-solutions/route.ts`는 3-페이지 슬라이딩 윈도우로 호출. dedupe 우선순위: (1) answer 존재 > (2) explanation 길이 > (3) scoringCriteria 길이

**기존 데이터 정리 스크립트:**
- `scripts/fix-aligned-explanations.ts` — literal `\n` + aligned 변환 + 글루 분리
- `scripts/fix-case-markers.ts` — `(\textrm{i})` / `따라서` / `이상에서` 앞 줄바꿈
- `scripts/fix-textrm-leftover.ts` — 수식 밖 `\textrm`/`\text`/`\mathrm` 제거
- `scripts/fix-answer-latex-wrap.ts` — 정답 필드 `$...$` 래핑
- `scripts/find-noBreak-explanations.ts` — 줄바꿈 없는 긴 해설 탐지 (읽기 전용)

**편집 모드 AI 해설 재생성 버튼 (SUPER_ADMIN 전용):**
- `QuestionViewEditModal.tsx::ExplanationRegenerateButton` — 편집 폼의 해설 라벨 영역
- 기존 해설 있으면 confirm 다이얼로그, editForm만 업데이트 (사용자가 저장 버튼으로 확정)

### ~~기출 시험지 배치 추출 시스템~~ — 제거됨 (2026-08-31)

야간 Cron 일괄 추출은 **코드도 테이블도 없다.** 서비스(`exam-extract-batch.ts`),
API 4종(`/api/admin/extract-queue`, `/extract-schedule`, `/api/cron/extract-batch-tick`),
UI(`/admin/extract-queue`), `vercel.json` 의 cron 설정, 그리고 `ExamExtractSchedule`
테이블까지 전부 사라졌다. `CRON_SECRET` 환경변수도 더 이상 쓰이지 않는다.

- 마지막까지 남아 있던 `ExamExtractSchedule` 모델·테이블 제거: `prisma/manual-migrations/drop-dead-pattern-taxonomy.sql`
- **남아 있는 것**: `ExamPaper.extractApproved` / `extractApprovedBy` / `extractedToBankAt`
  칼럼과 `Question.examPaperId` FK. 수동 추출(`ExtractToBankModal` → `/api/exam-analysis/[id]/extract-to-bank`)이
  아직 이 칼럼들을 쓴다 — 배치만 없어졌지 추출 기능 자체가 없어진 게 아니다.

**교과서 PDF 보유 현황 (G:\, 22개정):**

| 학년 | 보유 출판사 | 추출 상태 |
|------|-----------|----------|
| **중1** | 동아(강옥기), 지학사(장경윤), NE능률(권오남), YBM(류희찬), 교학사(김창동), 미래엔(황선욱), 비상(이진호), 천재(김동재), 천재(김화경) — 9종 | ✅ 동아·지학사 완료 (~917문제), 7종 미추출 |
| **중2** | 동아(강옥기), 지학사(장경윤), NE능률(권오남), YBM(류희찬), 교학사(김창동·미완성), 미래엔(황선욱), 비상(이진호), 천재(김동재), 천재(김화경) — 9종 | ❌ 미추출 |
| **중3** | (폴더 비어있음) | — |
| **공통수학1** | 동아(고호경), 미래엔(황선욱), 비상(김원경), YBM(류희찬), 지학사(장윤경), 천재(전인태), 천재(홍진곤) — 7종 | ❌ 미추출 |
| **공통수학2** | 동아(고호경), 미래엔(황선욱), 비상(김원경), YBM(류희찬), 지학사(장윤경), 천재(전인태), 천재(홍진곤) — 7종 | ❌ 미추출 |
| **대수** | 동아(고호경), 미래엔(황선욱), 비상(김원경), YBM(류희찬), 지학사(장경윤), 천재(전인태) — 6종 | ❌ 미추출 |
| **미적분I** | 동아(고호경), 미래엔(황선욱), 비상(김원경), YBM(류희찬), 지학사(장경윤), 천재(홍진곤) — 6종 | ❌ 미추출 |
| **미적분II** | (폴더 비어있음) | — |
| **확률과통계** | 미래엔(황선욱), 비상(김원경), YBM(류희찬), 지학사(장경윤), 천재(전인태) — 5종 | ❌ 미추출 |
| **기하** | 동아(고호경), 미래엔(황선욱), YBM(류희찬), 지학사(장경윤), 천재(전인태) — 5종 | ❌ 미추출 |

- **총 보유: 8개 과목 × 5~9종 = 약 54종** (중3·미적분II 제외)
- 추출 완료: 중1 2종 (917문제, 해설 없음, 정답은 AI 추출값으로 검증 필요)
- 해설 일괄 생성: Gemini 2.5 Flash auto 모드 (BASIC/MEDIUM → Non-Thinking, HIGH/HIGHEST → Thinking) 예상 비용 ~1,200원/1000문제
- 미리보기: `/mockups/explanation-compare`

### 학습지 위자드

3단계 위자드로 교육과정 기반 문제지 생성 (`src/components/worksheet-wizard/`):
1. **교육과정 선택**: 학년/학기/단원 체크트리 + 문제 설정 (유형/난이도/수량)
2. **문제 편집**: AI 생성 문제 검토/수정/삭제/추가
3. **최종 설정**: 제목, 시간, 배점 설정 후 저장

### SVG 다이어그램 시스템 — 레포에서 제거됨 (2026-08-30)

기출분석 전용화로 **문제 생성·PDF 다이어그램 렌더링 경로가 사라져** 코드 전체가 사문화됐다.
`DiagramParam[]` 26개 타입, `DiagramSpec` 6유형, 교육과정 프리셋 209개, `DiagramRenderer`,
`DiagramEditorPopup` 모두 지금은 **워킹트리에 없다.**

- 되살리기: `git checkout 9231e5ab^ -- src/lib/utils/svg-diagrams/` (히스토리에 영구 보존)
- 편의 사본: `F:/mathlab-archive/src/lib/utils/svg-diagrams/` (원래 상대경로 유지)
- DB `Question.diagramSpec` / `diagramSVG` 컬럼은 **그대로 남아 있다** (데이터 보존)

⚠️ 새 코드에서 `@/lib/utils/svg-diagrams`, `@/lib/diagram`, `@/lib/utils/diagram-resolver` 를
import 하지 말 것 — 지금은 존재하지 않는 경로다.

### 수학 렌더링 컴포넌트 (`src/components/math/`)

| 컴포넌트 | 용도 |
|----------|------|
| `MathRenderer` | 마크다운+LaTeX+GFM 테이블 렌더링. `onMathClick` prop 시 수식 클릭 편집 모드 활성 (원본 content 좌표 보존). EditableMathRenderer 흡수 통합 (2026-04-15) |

`DiagramRenderer` · `DiagramEditorPopup` · `ProblemDisplay` · `MathLivePopup` · `InlineMathText` 는
기출분석 전용화 과정에서 제거됐다 (위 섹션의 복구 방법 참조).
### 문제(Question) 시스템

**DB 모델:** Question — content(마크다운), choices(JSON), answer, explanation, diagramSpec(구조화 JSON), diagramSVG(레거시)

**AI 생성 흐름:**
1. 선생님이 학교급/단원/난이도 선택 → `POST /api/mathgen/generate`
2. Gemini 2.5 Flash가 구조화 출력 (responseMimeType: 'application/json')
3. 문제/보기/정답/풀이/다이어그램 JSON 반환
4. 선생님이 검토/수정 후 DB 저장

**PDF 추출 흐름:**
1. 선생님이 PDF 업로드 → 페이지 선택
2. 선택 페이지를 canvas → PNG base64 → `POST /api/questions/pdf-extract`
3. Gemini Vision이 문제 구조화 추출
4. 미리보기/편집 후 `/api/questions/bulk`로 일괄 저장

**문제 난이도:** BASIC | MEDIUM | HIGH | HIGHEST
**문제 유형:** MULTIPLE_CHOICE | SHORT_ANSWER | ESSAY
**영역 분류:** CALCULATION | UNDERSTANDING | PROBLEM_SOLVING | REASONING

**문제-시험 관계 (중간테이블):**
- `TestQuestion` — Test ↔ Question (sortOrder로 순서 유지)
- `QuizSessionQuestion` — QuizSession ↔ Question
- `HomeworkQuestion` — QuestionHomeworkPlan ↔ Question (dayIndex + sortOrder)
- 기존 `questionIds Json` 필드와 Dual-Write 상태 (전환기)
- 읽기: `src/lib/utils/question-order.ts` 헬퍼 사용 (중간테이블 우선, Json 폴백)
- 마이그레이션: `npx tsx scripts/migrate-question-relations.ts`

**autoTag 시스템:** `src/lib/services/question-tagger.ts`
- bookCode 접두사로 학교급 판별: `E*`=초등, `H*`=고등, 그 외=중등
- 초등 60+ / 중등 46 / 고등 23개 단원→영역 매핑
- 자동 분류 대상: difficulty, domain, grade, tags

### 빈칸 생성 시스템 (`src/lib/utils/blank-generator.ts`)

- `fullContent` (마크다운) + 정답 목록 → `MergedBlankExercise` 생성
- 난이도별 태깅: `easy` (핵심 용어), `hard` (확장), `full` (통문장)
- LaTeX 범위 보호, 불용어 스킵, 한글 조사 보존
- 초성 힌트: `getInitials()` → ㅎㄱ, ㅅㅊ 등

### 서비스 레이어 (`src/lib/services/`)

| 서비스 | 용도 |
|--------|------|
| `arithmetic-generator/` | 79개 카테고리 연산 문제 생성 (초등/중등/고등 분리) |
| `mathgen.ts` | Gemini AI 문제 생성 |
| `gemini.ts` | Gemini API 통합 유틸 (싱글톤 클라이언트, 코드펜스 제거, JSON 파싱) |
| `grading.ts` | 자동 채점, XP 계산, 1차 오답 저장 (2단계 흐름: create→update) |
| `diagnostic.ts` | 레벨테스트 결과 분석 |
| `assignment.ts` | 시험 배정/마감 관리 |
| `homework.ts` | 숙제 계획 로직 (strategies 패턴) |
| `concept-homework.ts` | 개념 기반 숙제 |
| `question-homework.ts` | 문제 기반 숙제 |
| `cheat-detection.ts` | 부정행위 탐지 |
| `badge-checker.ts` | 뱃지 조건 확인 및 자동 수여 (DB 동적 관리) |
| `daily-mission.ts` | 일일 미션 생성 및 진행 추적 |
| `report-ai.ts` | Claude Sonnet 4.6 레벨테스트 보고서 생성 |
| `variant-generator.ts` | 시험 변형 문제 생성 |
| `manual-grading.ts` | 수기 채점 로직 |
| `question-tagger.ts` | 문제 자동 분류/태깅 |
| `hint-generator.ts` | 문제 힌트 생성 |
| `level-test.ts` | 레벨테스트 관리 |
| `license.ts` | 이용권/라이선스 관리 (10개 기능, 좌석/OnOff 2유형) |
| `course-advance.ts` | 학습 과정 진도 관리 |
| `spaced-review.ts` | 간격 반복 복습 (에빙하우스 망각곡선) |

### 멀티테넌트 스코핑 (`src/lib/api/tenant-scope.ts`)

학원 지점(Tenant)별 데이터 격리 패턴:

| 함수 | 역할 |
|------|------|
| `getTenantFilter(user)` | SUPER_ADMIN: `{}` (제한 없음), 나머지: `{ tenantId: user.tenantId }` |
| `getTenantStudentScope(user)` | OWNER: 테넌트 전체 학생, TEACHER: 자기 반 학생만, SUPER_ADMIN: 전체 |
| `canAccessStudent(user, studentId)` | 특정 학생 접근 권한 검증 |
| `getStudentScope(user)` | Prisma where 조건 생성 (학생 목록 조회용) |

**View-As 패턴** (`requireAuthViewAs`):
- 선생님이 `?_as=studentId`로 학생 시점 조회 가능
- 같은 테넌트 학생만 허용, SUPER_ADMIN은 모든 학생 가능

### 이용권(라이선스) 시스템

**2계층 구조:**
- `TenantLicense`: 지점당 기능별 좌석 풀 (maxSeats, usedSeats, expiresAt, isActive)
- `StudentLicense`: 학생 개별 배정 (revokedAt=null이면 활성)
- 만료일: 학생/지점 이용권 중 빠른 것 적용

**10개 기능 (LicenseFeature enum):**
- **좌석 기반 (학생 기능):** CONCEPT, ARITHMETIC, TIME_ATTACK, TEST, REVENGE, DIAGNOSTIC, QUIZ, HOMEWORK
- **On/Off 기반 (선생님 도구):** EXAM_ANALYSIS, WORKSHEET

**API 가드 패턴:**
```typescript
const licenseCheck = await requireLicense(user, 'arithmetic');
if (licenseCheck) return licenseCheck;  // 이용권 없으면 403
```

**관리:** OWNER → `/licenses` (학생 배정), SUPER_ADMIN → `/admin/tenants/[id]` (지점 좌석/On-Off 관리, 2단 분리 UI)
**사이드바 연동:** OWNER 사이드바는 `/api/licenses/tenant-features`로 활성 이용권을 조회하여 네비게이션 항목 자동 필터링
**클라이언트:** `useLicenseStore` (Zustand, Fail-Open — 네트워크 실패 시 허용, 서버 가드가 최종 차단)

### 학습 과정 시스템

**모델:** `LearningCourse` → `LearningCourseConcept` (sortOrder) → `LearningCourseEnrollment` (LOCKED|ACTIVE|COMPLETED)

**자동 진급 플로우** (`course-advance.ts`):
1. 학생이 개념의 BLANK_FULL 완료
2. `checkAndAdvanceCourse()` 호출 → ACTIVE 과정의 모든 개념 완료 확인
3. 과정 COMPLETED 처리 → 다음 LOCKED 과정 자동 ACTIVE 전환

**선생님 관리:** `/courses` (과정 생성, 개념 추가, 학생 배정)
- 반 중심 뷰: `LearningCourse.tenantId`만 있고 `classroomId` 없음 → **지점(Tenant) 단위 공용**
- "이 반의 학습 코스" = 반 학생 중 enrollment된 코스 (간접 연결)
- 재사용 경로: 반 상세에 **"기존 코스 배정"** 모달 — 지점 공용 코스 중 해당 반에 미배정 학생이 있는 것 표시 → 클릭 시 `POST /api/learning-courses/[seq]/enroll`로 반 전원 일괄 enroll (중복은 스킵)

### 기출 분석 시스템

PDF 시험지 업로드 → Gemini AI 분석 → 문항별 난이도/유형/능력/단원 구조화

**프롬프트 버전:** `PROMPT_VERSION` (`src/lib/exam-analysis/constants.ts`)
- 현재: **v1.4.0** (5대 교육과정 영역, **5단계 난이도 2축 모델**, 서술형 통합 규칙). 전체 변경 이력은 `constants.ts:8-18` 주석이 SoT.
- 분석 결과 DB `modelVersion` 필드에 기록 (예: "gemini-3.1-pro-preview / prompt v1.4.0"). 메인 엔진 모델 = `ai-engine.ts:25` `MODEL`, 확장 에이전트 = `gemini-3.5-flash`
- **프롬프트 변경 시 반드시 `PROMPT_VERSION` 버전 업!** UI에 표시되어 사용자가 버전별 차이 인지 가능
- 버전 변경 기준: 영역/난이도 체계, 분류 규칙, ai_comment 규칙, 서술형 처리 규칙 변경
- **별도 버전 상수 3개 (혼동 주의):** ① `PROMPT_VERSION`=`v1.4.0` (시험지 분석 메인) ② `AGENT_PROMPT_VERSIONS.commentary`=`v1.3.0` (AI 총평 V3) ③ `COMMENTARY_V4_PROMPT_VERSION`=`v1.4.0` (V4 총평). 셋은 독립적으로 bump됨.

**난이도 5단계 — 2축 모델 (v1.3.0~v1.4.0):**
- **(A) 결합 폭(breadth)** = 몇 개 개념/대단원을 엮나 + **(B) 사고 깊이(depth)** = 개념 자체가 고난도거나 비자명한 통찰 필요 → **둘 중 높은 쪽**으로 결정. 정의: `MATH_DIFFICULTY_SYSTEM_4LEVEL` (`prompt-config-math.ts:170`).
- 핵심: **개념 1개라도 깊으면 4~5** (단일개념 킬러 포착). "애매하면 한 단계 낮게"는 **(A)폭에만 적용**, (B)깊이 명확 시 하향 금지.
- v1.4.0에서 수학/영어 프레임워크 분리 — 공통 프레임워크의 하향편향이 2축과 충돌해 2~3 쏠림 발생 → 수학은 2축만 사용.
- ⚠️ **AI 판정 난이도는 그대로 사용**(2026-06-02 자가진화 자동보정 비활성 — post-process 없음). 선생님 수동 교정만 해당 시험에 즉시 반영. 상세: 아래 "난이도 자가진화 보정 플라이휠" 섹션의 비활성 공지.
- 집계 표시용 가중평균(레벨별 명시 가중 `DIFFICULTY_LEVEL_WEIGHTS`)은 per-문항 값과 **직교**(`difficulty.ts`). 종합 카드를 올리려면 이 가중표만 조절(per-문항 무해).

**핵심 구조 (`src/components/exam-analysis/`, `src/lib/exam-analysis/`):**
- `AnalysisResultView` — 난이도 도넛차트/배점 토글, 유형 레이더, 단원 출제현황, 문항 테이블
- `AnalysisCommentTab` — 문항별 AI 코멘트 (난이도/유형/능력/배점 라벨) + 피드백 신고
- `StudyStrategyTab` — 학습 전략 10개 섹션 (토픽, 킬러패턴, 타임라인, 서술형 대비, 등급별 전략, 자주 틀리는 유형 등)
- `TypeRadarChart` — 유형(5대)/능력(4대) 레이더 차트 (탭 전환)
- AI 총평 (`CommentarySection`) — Claude Sonnet 기반 종합 분석, DB 영구 저장, 텍스트 하이라이트
- `ArticleEditorModal` — 블로그 글 자동 생성 (AI 기사 + 차트 이미지 + 네이버 서식 복사)
- `ExtractToBankModal` — 분석된 기출 문항 → 문제은행 일괄 저장

**8개 확장 분석 에이전트** (`src/lib/exam-analysis/agents/`):
- orchestrator, commentary, weakness, learning, exam-prep, prediction, topic-strategy, score-level-plan

**주변 학교 시스템:**
- 전국 학교 6,004개 GPS 좌표 100% 보유 (`src/lib/constants/schools.ts`)
- 같은 구 우선 + 3km 인접 복합 로직으로 주변 학교 자동 그룹화
- 지점별 커스텀 오버라이드 (학교 제외/추가)
- 시험지 ↔ School DB 자동 매칭

**Supabase Storage:** 시험지 PDF 업로드는 Supabase Storage 사용 (20MB 제한, 삭제 시 파일 자동 정리)

**5대 교육과정 영역 (question_type):** 수와 연산(number), 문자와 식(algebra), 함수(function), 기하(geometry), 확률과 통계(statistics)
- Gemini raw 타입 → 5대 영역 정규화 (`TYPE_TO_STANDARD` in `constants.ts`)
- 레이더 차트: 5각형, 데이터 있는 항목만 다각형, 범례 전체 표시

**4대 능력 영역 (ability_domain):** 계산력, 이해력, 문제해결력, 추론력
- AI가 직접 반환, `TYPE_TO_DOMAIN`은 fallback용
- 공유 상수: `ABILITY_DOMAIN_LABELS`, `ABILITY_DOMAIN_COLORS` (`constants.ts`)

**5단계 난이도:** "1"(기본), "2"(표준), "3"(응용), "4"(심화), "5"(최고난도)

---

### 기출 분석 V3 리디자인 (2026-05-27, commentary v1.1.0)

**기존 문제**: AI 총평/블로그가 "과학논문 같다" — 텍스트 단락 위주, 강조 요소 `<blockquote>` 하나뿐, 인포그래픽 부재.

**디자인 핸드오프**: `data/handoff-exam-analysis-v3/` (사용자 직접 제작) — NYT Science 톤(검정+빨강 #BF1722+황색 #FFA940+#FFF8E0) + Q&A 인터뷰 구조 + 9개 신규 필드.

**완료 작업 (Phase 1~5 + 12회 후속 fix):**

#### Phase 1~5 핵심 구조
- `CommentaryResult` 타입 확장 (commentary-agent.ts): V3 신규 필드 9개 optional — `blog_kicker`, `blog_headline`, `blog_dek`, `feature_callout`, `grade_cuts`, `topic_performance`, `blog_qa`, `conclusion`, `pull_quote`
- **Two-pass Claude 호출** (commentary-agent.ts): 기존 commentary 호출 + 별도 `generateV3Extension()` 호출로 신규 필드만 생성. max_tokens 16384, JSON 정규화(undefined→null/trailing comma 제거), `stripEnglishEnums` + `stripRawHtml`(raw HTML 제거) 재귀 적용.
- `AGENT_PROMPT_VERSIONS.commentary` v1.0.0 → **v1.1.0** bump (constants.ts) — lazy migration 트리거.
- **V3 컴포넌트 8개** (`src/app/(teacher)/exam-analysis/v3/`): helpers, DataBox, DifficultyStackedBar, FormatBreakdown, KillerMap, FeatureCallout, QASection, V3CommentaryView.
- **네이버 V3 렌더러** (`src/lib/exam-analysis/naver-v3-renderer.ts`): `buildNaverV3Html()` + 9개 블록 렌더러. `<table>` + 인라인 style만, 720px 폭 고정.
- AnalysisDetail에 **[V3 네이버 복사]** 버튼 + CommentarySection에 V3 안내 배너 (legacy → V3 마이그 트리거).
- 폰트 (layout.tsx): Noto Serif KR (400/500/600/700) + **Abril Fatface** (거대 숫자) + Bodoni Moda (fallback).
- 시안 도구: `scripts/generate-v3-preview*.ts` (재시안 보존)

#### 어려웠던 부분 — 네이버 SmartEditor 호환성

**증상 → 원인 → 해결** (시행착오 학습):

1. **Q&A 블록 한 글자씩 세로 분리** ("Q1"이 "Q"+"1" 세로) → nested table 3-level + 좁은 width cell이 한글을 한 글자씩 강제 줄바꿈 → **nested table 제거, 1-level stack 구조** (Q번호+질문+답변을 단일 td)
2. **DATA bars 라벨 세로 분리** ("기본 (Level 1)" → "기 본 ( L e v e l 1 )") → 영문+숫자+괄호 혼합은 word-break:keep-all 미적용 → **`shortenDataLabel()`** 헬퍼로 "기본 (Level 1)" → "기본·Lv1" 압축
3. **bars 막대 비율 작음** (7문항이 7% width) → 절대값을 width%로 직접 사용 → **max 기준 정규화** + 1.15x padding
4. **bars 모두 똑같은 길이** → max row가 100% width라 다른 row와 시각 차이 부족 → 사용자 제안 **이산 카운트 grid 시각화** (max 7문항 → 7칸 grid, 각 row 자기 카운트만큼 채움)
5. **stacked bar 세로 stack** (35%/35%/30%가 위아래 분리) → 네이버 기본 `table-layout:auto`가 빈 cell의 contents 너비(=0)를 우선 → **`table-layout:fixed;width:100%`** 강제
6. **legend swatch 안 보임** (div+background 색상 박스) → 네이버가 div+background 잃음 → **td bgcolor + width/height 명시 + `<td>&nbsp;</td>`**
7. **table 첫 행 흰 글씨** (highlight=true가 노란 배경 + 흰 글씨로 안 보임) → `i === 0`을 헤더로 강제 처리 → **헤더 강제 제거**, 모든 row 데이터 행으로 동일 처리
8. **검정 배경 글씨 안 보임** → AI가 raw HTML(`<span style="color:#6741D9">`)을 임의 삽입 → **`stripRawHtml()` 서버 측 제거 + CSS `*:not(strong) { color: inherit !important; }` 강력 override**

#### AI 응답 비결정성 처리

- **raw HTML 임의 삽입**: V2 article-generator의 보라색 강조 패턴을 학습하여 V3 응답에도 `<span style="color:..."`, `<mark>`, `<font>`, `<strong>` 출력. `stripRawHtml()` 정규식으로 제거하되 markdown `**bold**`로 변환 보존.
- **JSON 파싱 함정**: AI가 종종 `: undefined` 출력 → `JSON.parse` 실패. 정규식 `:\s*undefined` → `: null` 사전 치환 + `,\s*([}\]])` → `$1` trailing comma 제거.
- **라벨 형식 일관성 부족**: AI가 value를 "27점" / "23점 / 7문항" / "85%" 등 다양하게 응답. `extractCount()`는 "X문항"/"X개" 매치 우선, fallback parseInt. `allHaveCount` 조건으로 grid vs 막대 분기.
- **영문 enum 노출 (CALCULATION, NUMBER 등)**: `stripEnglishEnums()` 재귀 적용 (blog_qa.answer[], feature_callout.body[] 등 nested 필드까지).
- **V3 시스템 프롬프트 11개 절대 규칙** (commentary-agent.ts::SYSTEM_PROMPT_V3): raw HTML 금지 / 영문 enum 금지 / `\dfrac` 금지 / 존댓말 / 짧은 라벨(10자 이내) / `"X문항"` 또는 `"X점 / Y문항"` 형식 등

#### Q1 동적 질문 패턴 (비교 데이터 가용성 기반)

`buildV3UserPrompt`가 `base.nearby_comparison` 길이 + 정규식 매치로 가용성 판단:
- 작년✓+주변✓ → "작년이나 인근 학교와 비교해서..."
- 작년✓ only → "작년 시험과 비교해서..."
- 주변✓ only → "인근 학교 시험과 비교해서..."
- 둘 다✗ → "이번 시험은 전반적으로 어떤 구성인가요?" (비교 표현 금지)

#### FIGURE 난이도별 배점 분포 — 사용자 제안 그대로

상단 stacked bar (정수 % + 합 100 보정) + 각 난이도마다 2행 (문항수 grid + 배점 막대) + 난이도별 색상 (V3_DIFF_COLORS = 녹·옅녹·회·황·빨).

#### 3-way 동기화 필수

V3 동일 fix를 **3곳에 모두 적용**:
1. `src/app/(teacher)/exam-analysis/v3/*.tsx` (production V3 UI)
2. `src/lib/exam-analysis/naver-v3-renderer.ts` (네이버 호환 빌더)
3. `scripts/generate-v3-preview-html.ts` (시안 빌더 — 재시안용 보존)

한 곳만 fix하면 다른 곳과 일치하지 않아 디버깅 어려움.

#### Lazy migration 미구현 → 명시 클릭

`AGENT_PROMPT_VERSIONS.commentary` bump으로 자동 stale 감지 + 재호출은 **현재 구현 안 됨**. orchestrator가 promptVersion 비교 로직 미보유. 사용자가 안내 배너의 **[V3로 재분석]** 명시 클릭 → forceRegenerate=true 호출 → V3 데이터 생성.

#### 네이버 호환 패턴 — 절대 금지/필수 (6시간 디버깅으로 얻은 교훈)

**⚠️ 네이버 SmartEditor는 외부 HTML을 자체 schema로 변환하면서 다음을 제거한다 (필터링 X, 변환 시 손실):**
- `<div>` 의 background, width
- `inline-block <span>` 의 background, width (이게 가장 큰 함정 — 브라우저 미리보기에선 잘 보임)
- 외부 CSS 클래스
- `flex`, `grid`, `li`, `h2~h6` 시맨틱

##### 🚫 절대 사용 금지 (Naver Killers)
- ❌ `<span style="display:inline-block;width:Npx;background:..."></span>` — **background/width 모두 사라짐**. 브라우저는 OK, 네이버는 빈 span만 남김.
- ❌ `<div style="background:#color;...">` — div 자체는 살아남지만 background 제거됨
- ❌ flex/grid 레이아웃 (네이버가 block stack으로 변환)
- ❌ nested table 2-level 이상 (한국어가 한 글자씩 세로로 분리됨)
- ❌ `<li>`, `<h2~h6>` 시맨틱 태그 (자체 schema 변환 손실)
- ❌ `<style>` 블록, 외부 CSS

##### ✅ 살아남는 패턴 (Naver-safe)
- ✅ **카드 패턴 (가장 안정적)** — `<td width="N%" style="background:#fff;border-top:3px solid #color;padding:14px;">` 안에 **콘텐츠 풍부** (라벨 + 큰 숫자 + 보조 텍스트). 콘텐츠가 가득 차면 width%가 무시되지 않음.
  - 검증: 형식 분포 카드(객관식/단답형/서술형), 5단계 난이도 카드
- ✅ **HTML4 deprecated `bgcolor` 속성** + **width/height 속성** + **`&nbsp;` 콘텐츠** + `font-size:1px;line-height:1px`
  ```html
  <td width="50%" height="6" bgcolor="#BF1722" style="background:#BF1722;font-size:1px;line-height:1px;">&nbsp;</td>
  ```
  - 막대 1개에는 작동, **grid (다수 작은 cell)는 cell width%가 무시되어 줄바꿈 위험**
- ✅ `<table>` + 인라인 `style`만 사용
- ✅ 폭 **720px 고정**, `cellpadding="0" cellspacing="0"`
- ✅ `word-break:keep-all` (한글) + `white-space:nowrap` (영문+숫자 혼합)
- ✅ `*:not(strong) { color: inherit !important; }` CSS override (AI raw HTML 색상 무력화)

##### 🎯 시각화 결정 트리 — "이 시각화를 어떤 패턴으로 만들 것인가?"

| 데이터 종류 | 추천 패턴 | 이유 |
|---|---|---|
| 카테고리별 비교 (3~5개) | **카드 가로 배치** (각 width 19~33% + 풍부한 콘텐츠) | 검증된 최강 패턴. width% 100% 보장. |
| 단일 막대 (1개 데이터의 진행률) | td bgcolor + width="N%" + &nbsp; | 막대 1개는 width% 작동 |
| 다수 grid (5~7+ 작은 cell) | **PNG 이미지로 생성** (chart-image-generator) | td grid는 cell width% 무시 위험. 이미지가 안전 |
| 표 (라벨+값 정렬) | `<table>` + `<tr>` + `<td>` 표준 | 가장 호환성 좋음 |
| 라벨/값 정렬 (한 줄) | `<td>` 좌우 align + `<td width="120" align="right">` | float:right는 작동 안 함 |

##### 🚨 작동하던 패턴을 임의로 바꾸지 말 것 (이번 세션의 가장 큰 손실)
- `aea5274e` 커밋에서 td bgcolor 패턴을 "더 모던하다"는 이유로 inline-block span으로 전면 전환 → 네이버에서 모든 시각화 사라짐 → 3 commit으로 복원
- **교훈**: 네이버 호환 패턴은 "보기에 구식이어도 작동하는" 패턴을 보존. HTML4 deprecated 속성(`bgcolor`, `width`)이 SmartEditor 호환성에는 정답일 수 있음. 모던하다고 더 나은 게 아님.

##### 검증 필수 — 시각화가 작동한다는 것을 어떻게 확인?
1. dev 서버에 디버그 API (`/api/xdebug/v3-naver/[id]`) 만들어 **720px 컨테이너**로 시각 확인
2. **실제 네이버 글쓰기에 붙여넣기** — 브라우저 미리보기와 결과가 다를 수 있음 (가장 흔한 실수)
3. 브라우저 미리보기는 inline-block span도 잘 보이게 함 → **네이버 실측이 유일한 진실**

#### 향후 남은 작업

| 우선순위 | 작업 | 비고 |
|---|---|---|
| 중 | **차트 4종 PNG V3 톤 재생성** | 현재 보라/분홍 — NYT 흑백+빨강+황색 톤과 불일치 (chart-image-generator.ts 수정) |
| 중 | **Lazy migration 자동화** | useEffect로 stale 감지 시 자동 forceRegenerate. 사용자 동의 후 적용 권장 |
| 낮 | **V3 모드 토글 UI** | commentary-spec.md 옵션. 사용자가 V2/V3 전환 가능 |
| 낮 | **차트 PNG 네이버 CDN 호스팅** | 현재 base64라 사이즈 큼. 외부 URL로 최적화 |
| 낮 | **grade_cuts 자동 추정** | 학생 응답 분포 기반. 현재는 AI 추정만 |
| ~~낮~~ | ~~**V3 인쇄 모드 (/print 페이지)**~~ | **제거됨(2026-06-02)** — exam-analysis `/print` 삭제(오프라인 수요 없음+V2 부채). 재구축 시 V3 PDF로 (세션 #9 참조) |
| 매우 낮 | **사용량 통계** | V3 사용 비율, [V3 네이버 복사] 클릭, 학부모 피드백 |

#### 학습된 함정 — 디버깅 시간 주의

1. **시안 ↔ production ↔ 네이버 빌더 불일치**: 사용자 화면이 어느 코드의 결과인지 확인하지 않고 fix하면 다른 영역만 수정됨
2. **사용자 분석본 vs 시안 데이터**: 시안은 정화중1, 사용자 보고는 다른 학교일 수 있음. AI value 형식(`"27점"` vs `"23점 / 7문항"`) 차이로 동작 달라짐
3. **Vercel 배포 시간차**: 푸시 직후(~2-3분) 결과는 옛 코드 — 사용자가 본 화면이 새 코드 결과라고 단정하지 말 것
4. **AI 응답 형식**: AI가 매번 일관된 형식으로 응답하지 않음. 클라이언트 측 정규화 + 시스템 프롬프트 강제 둘 다 필요
5. **브라우저 미리보기 ≠ 네이버 실측**: dev 서버나 디버그 페이지에서는 inline-block span, div+background가 잘 보이지만 네이버에 붙여넣으면 다 사라짐. 네이버 실측이 유일한 진실
6. **td width="N%" + `&nbsp;` 만 = 작동 안 함**: cell width%는 콘텐츠가 풍부할 때만 보존. nbsp만 있으면 cell이 줄어들고 줄바꿈됨. 막대 1개는 OK, grid (5+ cell)는 위험
7. **헤드라인은 데이터 직설 X**: AI가 "기본 문항 0개, 표준부터 시작하는 응용 중심 시험" 같이 부정어로 시작하고 평이하게 마무리하는 경향. NYT Science 톤 "변별이 시작되는 지점" 같이 시사형/명사 종결로 강제하는 프롬프트 가이드 필요 (commentary v1.2.0)
8. **prompt v1.0.0 vs commentary v1.2.0 혼동**: 분석본 페이지 헤더의 "prompt v1.0.0"은 modelVersion(시험지 분석), commentary는 ExamAnalysisExtension.result에 별도 저장. promptVersion 표시가 다르다고 V3 데이터 없는 게 아님
9. **두 개의 curriculum 데이터 소스 분리 부채**: `src/lib/constants/curriculum.ts` (UI 드롭다운) vs `src/lib/exam-analysis/data/curriculum/middleSchoolCurriculum.ts` + `highSchoolCurriculum.ts` (AI prompt). 단원명이 별개로 운영되어 8건+ 불일치 발견 (중1-1 "문자와 식" vs "문자의 사용과 식", 중1-2 "통계" vs "자료의 정리와 해석", 중2-1 "수와 연산" vs "유리수와 순환소수", 고2 "지수와 로그" vs "지수함수와 로그함수" 등). **새 단원 추가 시 양쪽 동기화 필수**. 향후 single source of truth로 통합 권장. analysis 구조는 grade 기반(고1/고2/고3), constants는 subject 기반(공통수학1/공통수학2/대수/...)이라 통합 시 매핑 로직 필요.
10. **AI confidence_reason 자유 텍스트 함정**: Gemini가 시스템 프롬프트의 메타데이터 추출 지시를 우회하여 자율 추론으로 "계산 결과가 선택지에 없음, 문제 오류 의심" 같은 검산 기반 사유를 confidence_reason에 출력. **enum/화이트리스트로 가드 필수** — prompt-builder.ts:626 confidence_reason 가이드에 허용 사유 명시 + 금지 사유 명시 ("너는 메타데이터만 추출하며 풀이를 수행하지 않는다"). AI에게 "출제 오류 지적 금지"를 ai_comment에만 적용하면 다른 필드로 우회.
11. **사이드바 polling 트리거 부족**: page.tsx의 `hasAnalyzing`이 `items.some(...)`만 보면 분석본 진입 직후 selectedDetail은 ANALYZING이지만 items 갱신 전이라 polling 트리거 안 됨 → 사용자가 사이드바에 "대기"로 보임. **`|| selectedDetail?.status === 'ANALYZING'` 추가 필수**.
12. **stale ANALYZING 상태로 인한 progress UI stuck**: 분석 완료 후에도 fetch 캐시로 detail.status가 ANALYZING 그대로 → progress UI 진행 표시. 이중 방어: ① `cache:'no-store'` 명시 ② 조건 강화 `detail.status === 'ANALYZING' && !latestAnalysis` (분석 결과가 있으면 stale status 무시).
13. **UI 컴포넌트 옵션 value ↔ DB 저장 값 형식 불일치**: TopicCell이 select option value를 짧은 형식(`"수와 연산 > 유리수"`)으로 두는데 AI가 저장하는 topic은 prefix 포함 형식(`"중2 수학 > 수와 연산 > 유리수"`)이라 분류된 단원이 드롭다운에 자동 선택 안 됨. **handleOpen에서 normalize 매칭 필수** (1차: 그대로 / 2차: 마지막 2단계 / 3차: 부분 매칭).
14. **hover tooltip이 마우스에 가림**: InfoTooltip이 `onMouseEnter`로 표시되면 화면 작거나 가장자리에서 마우스 커서가 본문을 가리고, 마우스를 옮기면 닫혀 사용성 나쁨. **클릭 모달 패턴으로 전환** — 화면 중앙 fixed + 백드롭 + X 버튼 + ESC 키.
15. **총평 생성 사전 차단 패턴**: 부정확한 데이터(배점 합계 ≠ 만점, UNKNOWN 단원)로 AI 호출하면 비용 낭비 + 품질 저하. `readinessCheck` useMemo로 검증 후 [총평 생성] 버튼 disabled + 호박색 경고 배너로 미완성 항목 리스트 표시 + 인라인 편집 가이드 (배점 클릭, 단원 ✏️).

#### V3 모듈 3-way 동기화 체크리스트 (네이버 호환 fix 시)

V3 마크업 변경 시 반드시 3곳 모두 동기화:
1. `src/app/(teacher)/exam-analysis/v3/*.tsx` — production V3 UI (브라우저 직접 렌더)
2. `src/lib/exam-analysis/naver-v3-renderer.ts` — 네이버 호환 HTML 빌더 (RichText 클립보드 복사)
3. `scripts/generate-v3-preview-html.ts` — 시안 빌더 (재시안 도구 보존)

한 곳만 fix하면 다른 영역과 결과 다름 → 디버깅 시간 폭증. 검증은 항상 **네이버 실제 붙여넣기**로 (브라우저 미리보기 불충분).

### 수기채점 시스템

**프로세스 (`src/lib/services/manual-grading.ts`):**
1. `createManualAttempt()` — TestAttempt 생성 (entryMethod='manual')
2. `submitManualAnswer()` — 단건 답안 입력 (자동채점 또는 isCorrectOverride로 선생님 판정)
3. `completeManualAttempt()` — 시간 균등 분배 → 점수집계 → XP 지급

**시간 처리:** 선생님이 총 소요시간 입력 → `perQuestionSeconds = totalTimeMinutes * 60 / questionCount`
**레벨테스트 연동:** 완료 시 레벨테스트면 `analyzeLevelTest()` 자동 호출
**상태 관리:** `manualGradingStore` (Zustand — 선택된 시험/학생, 진행 중 답안, 완료 결과)

### 복수전 시스템

**오답 분석 → 재도전:**
- `GET /api/learning/revenge-suggestions` — 오답 3회 이상 유형별 복수전 추천
- `POST /api/learning/revenge-complete` — 정답 1개당 3XP, 60% 이상 정답 시 승리

### 간격 반복 복습 시스템

에빙하우스 망각곡선 기반 자동 복습 스케줄 (`src/lib/services/spaced-review.ts`):
- **간격 5단계**: `REVIEW_INTERVALS = [1, 3, 7, 14, 30]` — 1일(다음 수업일) → 3일 → 7일 → 14일 → 30일 → 완전 습득(`status='completed'`)
- **오답 발생 시(최초)**: 1일 후 복습 스케줄 생성, `status='active'`
- **복습 중 오답**: `status='failed'` 마킹, 이후 스케줄 생성 안 함 → **별도 관리 대상** (재학습/집중 지도)
- **복습 외 상황에서 재오답**: 기존 `active` 스케줄을 1일로 리셋 (failed는 건드리지 않음)
- 모든 조회는 `status='active'` 필터 적용 (failed/completed는 일반 복습에 노출 안 됨)

**ReviewSchedule 주요 필드:** `status`, `failureCount`, `streak`, `interval`, `reviewAt`, `completedAt`

**핵심 함수:**
- `createReviewSchedule()` — 오답 발생 시 호출
- `completeReview(id, isCorrect)` — 복습 완료 처리 (정답: 다음 간격 or completed / 오답: failed)
- `getDailyTestItems(studentId, count=4)` — **매 수업 3~4문항 복습 테스트용**, 최근 오답 우선(`createdAt DESC`)
- `getFailedReviews(studentId, limit)` — 별도 관리 목록
- `getTodayReviews(studentId, limit)` — 오늘 예정 active 항목
- `getReviewStats(studentId)` — pending / completedToday / totalCompleted / failedCount

**API:**
- `GET /api/learning/review-daily-test?count=4` — 매 수업 복습 테스트 (3~4문항)
- `GET /api/learning/review-failed?limit=50` — 탈락 항목 (View-As 지원)

### 도입 문의 시스템 (2026-06-01 추가)

랜딩페이지(`/`)의 "도입 문의" CTA → 신규 학원장 대상 영업 퍼널.

- **모델**: `Inquiry` — `academyName`, `contactName`, `phone`, `email?`, `region?`, `message?`, `status: PENDING|ANSWERED`
- **API**: `POST /api/inquiries` (인증 불필요, Zod 검증) — 학원명/담당자명/연락처 필수
- **UI**: `<InquiryModal />` ([src/components/landing/InquiryModal.tsx](src/components/landing/InquiryModal.tsx)) — 비로그인 히어로 + 하단 CTA에서 호출
- **흐름**: 비로그인 시 헤더 "로그인" + 히어로 "도입 문의" 모달 분리 → 신규 학원장(문의)과 기존 사용자(로그인) 경로 분리

### 사용자 이름 수정 API

- `PATCH /api/users/[id]` — OWNER 이상이 같은 테넌트 사용자의 `name` 필드 수정
- `/exam-analysis/admin` "강사" 탭의 인라인 이름 편집에서 사용
- SUPER_ADMIN은 모든 테넌트 사용자 수정 가능, OWNER는 자기 테넌트 한정

### 게이미피케이션

**XP 보상:**
- 개념학습(READING): 5 XP, 빈칸 쉬움(BLANK_EASY): 10 XP
- 빈칸 어려움(BLANK_HARD): 15 XP, 통문장(BLANK_FULL): 20 XP
- 백지 복원(BLANK_PAGE): 30 XP, 보너스(BONUS): 5 XP

**레벨 임계값:** Lv1=0, Lv2=100, Lv3=250, Lv4=500, Lv5=800, Lv6+=이전+400

**8개 기능 토글** (Admin Feature Flag 시스템):
| 기능 | 설명 |
|------|------|
| `time_attack` | 연산 속도 챌린지 |
| `daily_mission` | 일일 미션 시스템 |
| `badge_system` | 뱃지 시스템 (10종) |
| `quiz_speed_scoring` | 퀴즈 속도 점수 |
| `revenge_challenge` | 복수전 챌린지 |
| `class_competition` | 반 대항전 |
| `daily_question` | 오늘의 문제 |
| `enhanced_levelup` | 강화된 레벨업 애니메이션 |

**뱃지**: DB 기반 동적 관리. 조건 타입: streak, arithmetic, blank, blank_perfect, timeattack, quiz_participate, xp_total, test_perfect, revenge, level, recovery, earlybird, weekend, hidden_* 등

### DB 모델 요약

**핵심:** User(STUDENT|TEACHER|OWNER|SUPER_ADMIN), Subject, Concept, BlankExercise, Question
**시험:** Test, TestAttempt, TestAssignment, AnswerLog(firstSelectedAnswer 포함), LevelTestConfig
**중간테이블:** TestQuestion, QuizSessionQuestion, HomeworkQuestion (문제 순서/FK 관리)
**숙제:** ArithmeticHomeworkPlan, ConceptHomeworkPlan, QuestionHomeworkPlan (각각 Enrollment/Attempt)
**퀴즈:** QuizSession, QuizParticipant, QuizAnswerLog
**게이미피케이션:** Badge, UserBadge, DailyMission, DailyQuestion, DailyQuestionAttempt, TimeAttackRecord
**보고서:** ReportHistory, TeacherComment
**관리:** FeatureFlag, Classroom, Tenant
**이용권:** TenantLicense, StudentLicense, LicenseUsageLog (10개 LicenseFeature enum)
**학습과정:** LearningCourse, LearningCourseConcept, LearningCourseEnrollment
**기출분석:** ExamPaper, ExamAnalysisResult, ExamAnalysisComment, ExamAnalysisTemplate, ExamArticle, School, SchoolGroupOverride
**지원:** Inquiry (문의/회신)
**기타:** StudentProfile(XP/레벨), PointTransaction, DiagnosticResult, ConceptMemo, SpacedReviewItem

## 디자인 토큰

### 글씨체 (Font)

| 용도 | 폰트 | 로드 방식 | CSS 변수 |
|------|------|----------|----------|
| **전체 UI** | Pretendard | CDN (`jsdelivr`) | `--font-display` |
| **개념 본문** | Noto Serif KR | `next/font/google` | `--font-serif-kr` |
| **수식** | KaTeX 기본 폰트 | CDN | — |
| **SVG 다이어그램** | Pretendard | CSS 상속 | — |

- Pretendard: 한글+영문 통합 산세리프. 모든 UI 텍스트에 사용
- Noto Serif KR: 개념 학습 콘텐츠 전용 명조체 (`.font-serif-kr` 클래스)
- 새 페이지/컴포넌트 추가 시 별도 폰트를 도입하지 말 것 → Pretendard 통일
- `font-family` 직접 지정 금지 → `var(--font-display)` 또는 `.font-serif-kr` 사용

### KaTeX 수식 크기

| 대상 | CSS 선택자 | 크기 | 비고 |
|------|-----------|------|------|
| **수식 전체** | `.katex` | `1.15em` | 본문 대비 약간 크게 |
| **분수만** | `.katex .mfrac` | `1.4em` | 분자/분모 가독성 확보 |

- `\dfrac` 사용 금지 → 반드시 `\frac` 사용 (인라인 수식에서 거대 분수 방지)
- MathRenderer에서 `\dfrac` → `\frac` 자동 변환 (방어)
- PDF 추출 후처리(`fixLatexEscaping`)에서도 `\dfrac` → `\frac` 자동 치환

### 색상

```css
--color-primary: #135bec        /* 메인 파란색 */
--color-primary-hover: #0e4bcc
--color-secondary: #F97316      /* 주황 */
--color-stage-reading: #3B82F6  /* 개념학습 */
--color-stage-blank-easy: #10B981  /* 빈칸 쉬움 */
--color-stage-blank-hard: #F97316  /* 빈칸 어려움 */
--color-stage-blank-page: #7C3AED  /* 백지 복원 */
```

## 환경변수

```
DATABASE_URL=postgresql://user:password@localhost:5432/mathlab
DIRECT_URL=postgresql://user:password@localhost:5432/mathlab
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:3000
GEMINI_API_KEY=your-gemini-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
KAKAO_REST_API_KEY=your-kakao-rest-api-key  # ⚠️ REST API 키만 작동 (12-8 참조)
# NEIS_API_KEY는 sync-schools.ts에 내장됨 (공공 API, 키 노출 무방)
```

## 스크립트

```bash
# Next.js / Prisma
npm run dev              # 개발 서버 (Turbopack, 자동 포트 탐색)
npm run build            # npx prisma generate && next build
npx prisma generate      # Prisma 클라이언트 재생성
npx prisma studio        # DB 브라우저
npx prisma migrate dev   # DB 마이그레이션

# DB 백업/복구 (로컬 안전망 — 아래 "DB 백업/복구 시스템" 섹션 참조)
npm run db:backup                          # 전체 백업 → backups/*.json.gz
npm run db:restore                         # 백업 목록 표시
npm run db:restore -- --latest --dry-run   # 최신 백업 복원 미리보기
npm run db:restore -- --latest --yes       # 최신 백업으로 복원 (전체 교체)
npm run db:reset                           # ⚠️ 백업 먼저 뜨고 → prisma migrate reset (안전 가드)

# DB 초기 시드 (DB reset 후 복구 순서)
node scripts/seed-accounts.mjs                 # 1. Tenant + SUPER_ADMIN + OWNER + TEACHER 시드
npx tsx scripts/sync-schools.ts                # 2. NEIS API로 전국 중/고 ~5,725개교 수집 (3-5분)
npx tsx scripts/sync-schools.ts --type elementary  # 2-1. 초등학교까지 (옵션, ~6,000개 추가)
npx tsx scripts/geocode-schools.ts             # 3. 카카오 주소 API로 GPS 백필 (~12분)
node scripts/geocode-failed-by-keyword.mjs     # 4. 주소 매칭 실패분을 키워드 API로 재시도

# 운영 데이터 복구 불가 (사용자 누적): ExamPaper/Analysis/Extension, LearnedPattern, ExamFeedback,
# TenantNearbyGroup, ExamPromptTemplate(코드 fallback 있음)
```

## DB 백업/복구 시스템 (2026-06-01 추가)

**배경:** `prisma migrate reset` 으로 개발 DB가 통째로 증발한 사고(School 5,724개 + 분석 데이터 손실, 수 시간 복구) 재발 방지. Supabase/Prisma 는 Firebase 같은 기본 자동 백업이 없음. 신규 의존성 0개의 로컬 안전망.

**구성 (`scripts/`):**
| 파일 | 역할 |
|------|------|
| `backup-common.mjs` | 공유 유틸 — `Prisma.dmmf` 동적 모델 수집, Date/BigInt 직렬화, 시퀀스 메타 |
| `backup-db.mjs` | 전체 모델 JSON 익스포트 → gzip → `backups/mathlab_YYYYMMDD_HHmmss.json.gz` (최근 14개 유지) |
| `restore-db.mjs` | 백업 → DB 전체 교체 복원 (`--latest`/`--file=`, `--dry-run`/`--yes`) |
| `safe-reset.mjs` | `db:reset` — 백업 먼저 뜨고 → `prisma migrate reset` (백업 실패 시 reset 중단) |
| `setup-backup-schedule.ps1` | Windows 작업 스케줄러 일일 자동 백업 등록 |

**설계 핵심 (수정/확장 시 반드시 유지):**
1. **모델 동적 수집** — `Prisma.dmmf.datamodel.models` 로 22개 모델 자동 순회. 스키마에 모델 추가해도 백업 대상 자동 반영 (하드코딩 목록 금지 → 드리프트 방지).
2. **복원 FK 처리** — 트랜잭션 내 `SET LOCAL session_replication_role = replica` 로 FK 체크/트리거 비활성화. **삭제/삽입 순서가 무관**해져 의존성 정렬 불필요 + 자기참조(`Question.variantOf`) 자동 해결. `LOCAL` 이라 트랜잭션 종료 시 GUC 자동 복원 → pgbouncer 풀 커넥션 오염 없음. **일반 `SET` 쓰면 안 됨.**
3. **복원은 `DIRECT_URL` 전용 클라이언트** — `new PrismaClient({ datasources: { db: { url: DIRECT_URL } } })`. pgbouncer(6543) 우회해야 세션 GUC 적용됨. `$transaction(fn, { timeout: 120000, maxWait: 15000 })` 필수 (대량 insert 가 기본 5s 초과).
4. **시퀀스 resync** — 복원 후 `setval(pg_get_serial_sequence(...), MAX, COUNT>0)` 로 자동증가 카운터 재동기화 (현재 `User.seq` 1개). 자동 수집되므로 새 autoincrement 필드도 자동 처리.
5. **직렬화** — `Date→ISO`(자동), `BigInt→{__bigint}`. 복원 시 DMMF 필드 타입 기반 revive. Json 필드는 그대로 통과.

**일일 자동 백업 (로컬):**
```powershell
.\scripts\setup-backup-schedule.ps1            # 매일 03:00 등록
.\scripts\setup-backup-schedule.ps1 -Time "23:30"
.\scripts\setup-backup-schedule.ps1 -Remove    # 해제
```
⚠️ **한계: PC 가 켜져 있어야 동작** (로컬 전용). 오프사이트가 필요하면 ↓ 업그레이드.

**향후 업그레이드 경로:**
- **GitHub Actions 일일 덤프** (무료, PC 비의존, 오프사이트) — `.github/workflows/` 에 `pg_dump $DATABASE_URL` + artifact 30~90일. CI 환경은 `postgresql-client` 한 줄 설치로 pg_dump 사용 가능 (로컬은 미설치).
- **Supabase Pro** ($25/월) — daily backup 7일 자동. + PITR(분 단위 복구)는 $125/월.

**주의:** 이 시스템은 데이터(행)만 백업/복원. DB 스키마는 `prisma/schema.prisma`(git) 가 source of truth — 복원 전 스키마가 백업 시점과 일치해야 함 (먼저 `prisma migrate`/`db push` 로 스키마 맞추고 데이터 복원).

## 코딩 컨벤션

- 한국어 UI 텍스트, 한국어 주석 권장
- API 에러 메시지: 한국어
- 파일명: kebab-case, 컴포넌트: PascalCase
- 경로 alias: `@/` = `src/`
- 수학 수식: `$...$` (인라인), `$$...$$` (블록)
- **수학 문제/개념의 모든 숫자와 영문 변수는 반드시 KaTeX로 감싸기**: `$25$`, `$a$`, `$a+b$` 등. 보기 번호(①②③④⑤)와 ㄱㄴㄷ은 제외
- **`\dfrac` 사용 금지** → 반드시 `\frac` 사용. `\dfrac`은 인라인 수식에서 거대 분수를 만듦
  - 3중 방어: ① `MathRenderer.tsx`에서 인라인 `$...$` 내 `\dfrac` → `\frac` 자동 변환 ② `post-processor.ts`의 `fixLatexEscaping()`에서 전역 치환 ③ AI 프롬프트(mathgen.ts, math-textbook.ts)에서 `\dfrac` 금지 명시
  - DB 일괄 치환 스크립트: `npx tsx scripts/fix-dfrac.ts --apply`
- **alert() 사용 금지** → `toast.*()` 사용 (위 7번 규칙 참고)
- 빌드 확인: 기능 구현 후 `npm run build`로 타입 에러 없는지 확인
- **커밋 전 항상 원격 최신 확인**: `git fetch origin` → `git status`로 로컬이 origin/main과 동기화되어 있는지 확인 후 커밋. 뒤처진 경우 `git pull --rebase origin main` 먼저 실행
- **문제 순서 조회 시 반드시 헬퍼 함수 사용**: `getTestQuestionIds()`, `getQuizQuestionIds()`, `getHomeworkDayQuestionIds()` (`@/lib/utils/question-order`)
  - `test.questionIds as string[]` 직접 캐스팅 금지 → 중간테이블 우선 조회 헬퍼 사용
  - 새 시험/퀴즈/숙제 생성 시 Json + 중간테이블 Dual-Write 유지
- **`/api/questions/bulk` 호출 시 tenantId 자동 결정:** examPaperId 있으면 해당 시험지 tenantId 우선 → 지점 전용 문제 보장. SUPER_ADMIN이 override 없이 호출하면 `tenantId=null`(공용)
- **`<보기>` 블록 편집 시 `box-grid.ts` 유틸 사용** — 직접 문자열 치환 금지 (마커 포맷 변경 시 한 곳만 수정)

## Skills & Agents

### Skills (검증용, `.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| `verify-implementation` | 모든 verify 스킬을 순차 실행하여 통합 검증 |
| `manage-skills` | 세션 변경사항 분석 및 CLAUDE.md 관리 |
| `verify-api-auth` | API 라우트 인증/인가 패턴 검증 |
| `verify-schema-sync` | Prisma 스키마와 코드 간 동기화 검증 |
| `verify-page-patterns` | Teacher/Student 페이지 UI 패턴 일관성 검증 |
| `verify-nav-sync` | 네비게이션 설정과 실제 페이지/사이드바 간 동기화 검증 |

### Agents (개발 보조, `.claude/agents/`)

| Agent | Model | Purpose |
|-------|-------|---------|
| `code-reviewer` | Sonnet | git diff 기반 코드 리뷰 (인증, 응답 형식, toast, KaTeX 규칙 검증) |
| `build-checker` | Haiku | Prisma generate + Next.js 빌드 검증/에러 수정 |
| `test-writer` | Sonnet | Vitest 단위 테스트 생성 (서비스, API, 유틸) |
| `refactor-advisor` | Haiku | 대형 파일 탐지, 중복 코드 분석, 분리 전략 제안 (읽기 전용) |
| `schema-generator` | Sonnet | Prisma 모델 → API 라우트 + Zod 스키마 + 타입 자동 생성 |
| `api-documenter` | Haiku | 133+ API 라우트 스캔 → 구조화된 API 문서 생성 |

## 프로젝트 규모

| 항목 | 수치 |
|------|------|
| 소스 파일 | 825개 (TS/TSX) |
| 총 코드량 | ~190,000 LoC |
| 학생 페이지 | 23개 |
| 선생님 페이지 | 66개 (+ mockups 12개) |
| API 라우트 | 216개 (116개 도메인 디렉토리) |
| 컴포넌트 | 212개 |
| 서비스 모듈 | 40개 (workbook, ox-quiz 등 신규 도메인 포함) |
| DB 모델 | 89개, Enum 17개 (LicenseFeature에 OX_QUIZ, WORKBOOK 추가) |
| 다이어그램 | DiagramParam 26개 타입 + DiagramSpec 6개 유형 17개 프리셋 + 교육과정 프리셋 209개 |
| 커스텀 훅 | 14개 |
| Zustand 스토어 | 8개 (workbookStore 추가) |
| Zod 스키마 | 5개 |
| E2E 테스트 | 3개 (Playwright) |
| 스크립트 | 177개 (.ts/.js/.py, scripts/) |

> ⚠️ 위 통계표는 기출분석 전용화 트림 *이전* 수치(레거시). 현재는 기출분석 외 코드/모델 대거 삭제됨.

---

## 2026-06-01 세션 — 기출분석 전용화 후속 (공개 랜딩 · 난이도 가중 · env/키 · 모델명)

기출분석 단일 제품 전환 이후 후속. 핵심 변경 + 재발 방지 함정 정리.

### A. 공개 랜딩페이지 (`/`)
- `src/app/page.tsx` → `<LandingPage/>` (이전 `redirect('/exam-analysis')` 대체, 정적 생성).
- `src/components/landing/`:
  - `LandingPage.tsx` — 헤더/히어로/신뢰/가치/작동방식/기능/대시보드/CTA/푸터. auth-aware CTA(`useAuth` → 로그인 vs 기출분석 바로가기).
  - `V3ReportPreview.tsx` — 히어로 우측. **실제 V3 네이버 블로그 리포트 톤**(에디토리얼: 크림 · Noto Serif KR · Bodoni Moda 숫자 · #BF1722 레드 · 다크 KPI 스트립)을 더미데이터로 재현.
  - `FeatureShowcase.tsx` — "기능 보기" 섹션. 실제 분석 화면 6종(난이도 stacked bar · 단원 배점 · 문항 형식 · **KaTeX 해설** · 주변학교 비교 · 블로그 썸네일).
  - `DashboardShowcase.tsx` — "교사용 분석 대시보드" 섹션. **실제 recharts**(유형 레이더 + 난이도 도넛) + 변별력 등급카드 + 시험 시간배분 바.
- **라운드 최소화**(사용자 요청): 카드 16~24px → 6~8px, 칩/배지 full → 4px (V3 샤프 톤). **반응형**: 히어로 2단 분기 `md`→`lg`(태블릿 풀폭 스택), 헤드라인/패딩 fluid.
- ⚠️ **공개 랜딩 스크롤 함정**: 루트 `layout.tsx` body + globals.css `html,body{overflow:hidden}`(LMS 앱 셸 규약 — 내부 스크롤 컨테이너 전제)이 공개 랜딩까지 적용돼 본문이 잘려 스크롤 불가. → 랜딩 루트에 `h-dvh overflow-y-auto` 자체 스크롤 컨테이너 추가(전역 규약 불변). 진단 시 MCP 프로그램 스크롤은 통하지만 실제 휠은 막히므로 `scrollHeight>clientHeight` + 네이티브 스크롤 여부로 확인.

### B. 평균 난이도 = **레벨별 명시 가중치**(importance weight) 가중평균
- **공유 헬퍼** `src/lib/exam-analysis/difficulty.ts` `weightedAverageDifficulty(questions)`:
  `Σ(weight[L] × 배점 × 난이도) / Σ(weight[L] × 배점)`, **`DIFFICULTY_LEVEL_WEIGHTS = {1:1, 2:1, 3:2, 4:5, 5:10}`**. 배점 없으면 영향력 가중만으로 폴백(`usedPoints` 플래그). 1~5 스케일 유지(최대=5).
  - 진화: 문항수 단순평균(2.4) → 배점 선형(2.66) → k=2 제곱평균(2.90) → k=4(3.16) → **레벨별 명시 가중(2026-06-01)**. 거듭제곱평균(지수 k)은 천장(~3.2)에 막혀 "더 올려달라"를 못 맞춤 + "각 난이도별로 가중치를 확실하게 매겨서"라는 요청 → **지수 k를 레벨별 명시 가중표로 교체**(추상적 k보다 레벨별로 보이는 배수가 직관적). 심화(4)=5배·최고(5)=10배 영향 → *차등* 상향(균일 δ 아님): 킬러/심화 있는 시험이 더 높고 쉬운 시험은 그대로(분별력). 실측(분석본 3개): 분포 3/6/7/4/1(능인고, 산술 2.70)→**3.46**, 0/9/8/4/0→3.39, 2/7/9/4/0→3.28.
  - **트레이드오프**: 상위가중이라 하위 난이도 문항 영향 작음(킬러 1문항 재평가 시 종합 ±0.2). 강/약은 `DIFFICULTY_LEVEL_WEIGHTS` **이 표 한 곳만** 수정(4·5 ↑=강, 예 6/12·7/14 / ↓=약, 예 4/8). 측정 도구: `scripts/measure-difficulty-weighting.mjs`(여러 가중표 실측 비교), `scripts/verify-difficulty.ts`(실제 함수 end-to-end 검증).
- **통일**(흩어진 계산 전부 이 헬퍼로): `(teacher)/exam-analysis/helpers.tsx`(`getOverallDifficultyLevel`/`getDifficultyBreakdown` — `questions` 인자 추가) · `AnalysisDetail`(헤더/모달 라벨·설명) · `v4/helpers.computeExamStats` · `api/.../section-image` · `v3/V3CommentaryView`.
- ⚠️ `summary.average_difficulty`(ai-engine: **최빈 난이도** 문자열)와 화면의 *가중평균 소수값*은 **별개**. 표시 평균은 항상 헬퍼로 재계산(저장값 아님) → 분석 재실행 없이 **새로고침만으로 반영**.
- 박스 하이라이트 = `round(가중평균)`(가장 가까운 단계), 숫자/화살표 = 정밀값. 2.7 → box 3 = 의도된 정상.

### C. 난이도 마커(▼) 위치 — px 하드코딩 → 박스 폭 %
> ⚠️ **2026-06-02 연속축 수직선(`DifficultyNumberLine`)으로 대체 — 아래는 역사적 기록.** 이산 5박스+마커 자체를 폐기(연속값 3.9 vs 정수 박스 4 불일치). 마커 위치는 이제 `(v-1)/4×100%`로 축에 자연 정렬되어 px/박스폭 보정이 불필요. 상세: 위 "2026-06-02 세션 #6".
- `AnalysisDetail.tsx` 난이도 바: 마커 `left`를 `(avg-1)*26+12`px(24px 박스 가정) → `…/128*100`% + 컨테이너 `w-full`. 루트 폰트크기/환경으로 박스가 24px가 아닐 때 어긋남 방지(16px root에선 결과 동일).
- 검증법: 빈 페이지(같은 globals)에 `w-6`/`gap-0.5` 박스 5개 주입 → `getBoundingClientRect`로 실측(16px root: 박스 24px, 행 128px, 중심 [12,38,64,90,116]).

### D. 🔒 모델명 비노출 (핵심규칙 #0)
- 사용자 UI에서 모델명 금지 → "AI". `'Claude Sonnet 4.6 호출 시작'` → `'AI 분석 호출 시작'` (AnalysisDetail/CommentarySection 진행 로그·상태). 상세는 **핵심 규칙 #0**.

### E. 출제범위(단원) 매핑 버그 — 공통수학2가 공통수학1 단원으로
- `ExamScopeSelector.getCurriculumKey`: `.find` 절 `grade==='고1' && (k==='공통수학1'||k==='공통수학2')`가 category='공통수학2'여도 키 배열 첫 항 '공통수학1'에 먼저 매칭 → 고1은 항상 공통수학1 단원. **정확 일치(`k===category`) 우선 + 학년 기본값은 category 불명 시에만** 폴백으로 수정. (커리큘럼 데이터 자체는 정상이었음.)

### F. dev 환경 env / API 키 (⚠️ 함정 多)
- **로컬 키 누락**: `.env.local`에 `SUPABASE_*`/`GEMINI_API_KEY` 없음(프로덕션 env에만 존재) → 업로드 URL 발급·분석 실패. `vercel env pull <tmp> --environment production`로 *누락 키만 병합*(기존 `NEXTAUTH_URL=localhost`·`DATABASE_URL` 보존, 시크릿 비출력).
- ⚠️ **`vercel env pull`이 값 끝 개행을 dotenv에 literal `\n`(2글자)로 직렬화** → 받은 `GEMINI_API_KEY`가 41자 → Google 400(무효). 진짜 키는 **앞 39자**. prod 런타임은 실제 env라 정상이므로 *"prod는 되는데 dev만 실패"* 의 진짜 원인.
- **환경별 키 상이**: Anthropic은 로컬에 옛 stale 키(401), prod는 유효(200). `vercel env ls`로 Production/Preview/Development 별 확인.
- **검증법**: `node --env-file=.env.local`로 Supabase `createSignedUploadUrl` / Google `…/v1beta/models?key=` / Anthropic `/v1/models` 직접 호출해 200 확인(브라우저 로그인 불필요, 시크릿 비출력).
- `.env.example`에 누락 키 보강(SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY·ANTHROPIC_API_KEY·DIRECT_URL·CRON_SECRET).
- ⚠️ **dev 서버 둘이 같은 `.next` 공유 금지** — Turbopack 매니페스트가 깨져 `JSON.parse … is not valid JSON` 런타임 에러 + 페이지 백지. → `next dev` 하나만 실행 + 깨진 `.next` 삭제 후 재기동.

### G. 메타 — 분석/측정 우선
- "값이 이상하다" 류 보고는 *추측 말고 실측*: DB 직접 쿼리(`node --env-file=.env.local` + Prisma)로 실제 분포·여러 파라미터(k) 값 산출 후 결정. 마커 좌표도 라이브 DOM `getBoundingClientRect`로 측정해 확정.

---

## 2026-06-01 세션 — 난이도 자가진화 보정 플라이휠

> ⚠️ **2026-06-02 자동보정 전면 비활성화 — 아래 내용은 역사적 기록.** 9개 고교·85교정 교차검증(leave-one-school-out)에서 자동보정이 **per-문항 정확도를 악화**시킴이 증명됨(정확도 53.8%→39.7%, MAE 0.516→0.707; 출처 기반 보정도 0.620으로 악화). 원인: ① AI가 이미 54% 정확 → 일괄 시프트(+반올림)가 *맞은 다수*를 파손, ② 난이도는 학교·학생 **상대적**이라 "전국 단일 보정맵"이라는 단일 진실이 없음. → **자동 적용 차단**(`analyze/route.ts`가 `calibrationSet` 미전달 → ai-engine이 원본 AI값 반환), **수동 교정이 canonical**(PATCH로 이 시험에 즉시 반영), 누적 교정은 **측정 벤치마크**로만 사용(`/admin/evolution`, `recomputeCalibrations`는 측정 전용·examPaper별 dedup). 프롬프트 few-shot 경고 주입도 제거. 종합 카드만 올리려면 `DIFFICULTY_LEVEL_WEIGHTS`(per-문항 무해). 결정 상세: `~/.claude/plans/jazzy-juggling-pearl.md`.

선생님 체감 대비 AI 난이도가 **체계적으로 낮게** 나오는 문제(프롬프트 5차 개정에도 반복)를, 프롬프트 튜닝이 아닌 **ground truth 누적 + 자동 보정 루프**로 해결하려 한 시도(현재 비활성). 분석할수록 정확해지는 자가진화 구조. **전국 절대 기준** → 보정 데이터는 플랫폼 전역(테넌트 무관) 집계.

### 플라이휠 4단계
1. **교정 캡처** — `PATCH /api/exam-analysis/[id]/questions/[questionNumber]` 에 `difficulty` 추가. 최초 교정 시 AI 원본을 `ai_difficulty` 에 보존(학습셋). `AnalysisCommentTab` 난이도 배지 클릭 → 1~5 인라인 셀렉터. 부모(`AnalysisDetail`)는 `diffEdits` 오버레이로 종합 난이도 즉시 재계산.
2. **측정** — `src/lib/exam-analysis/calibration.ts`(순수 함수): `manually_edited && ai_difficulty != difficulty` 쌍 추출 → 전역 편향 mean(Δ), `질문유형:AI난이도` 버킷별 Δ. `GET /api/exam-analysis/calibration/stats`(SUPER_ADMIN) + admin "난이도 보정" 탭.
3. **보정 맵** — `DifficultyCalibration` 모델(과목당 1행 upsert, 적용용 캐시). `POST /api/exam-analysis/calibration/recompute` + `npm run calibration:recompute`. 게이트: 표본 ≥5 + 방향일관 ≥70% + |Δ|≥0.5 인 버킷만 채택(과보정 방지), 전역 편향은 폴백.
4. **자동 적용** — `ai-engine.ts::analyzeExam` 에 `calibrationMap` 인자. AI 난이도에 `applyCalibration()`(버킷 우선, 없으면 전역 편향, ±1.5 캡). `ai_difficulty`=원본 보존. `analyze/route.ts` 가 `loadCalibrationMap(prisma)` 로 주입.

### 설계 결정 (재현 시 유지)
- **프롬프트 few-shot 앵커는 의도적으로 미적용** — 결정적 보정 맵(post-process)과 **이중 보정** 위험(AI가 앵커로 ↑ → 맵이 또 ↑). 맵은 자가조절(재분석마다 `ai_difficulty` 갱신 → AI 개선 시 교정 줄어 맵도 축소). 단일 메커니즘 유지.
- **집계 가중(`DIFFICULTY_LEVEL_WEIGHTS`)과 per-문항 보정은 직교** — 보정(per-문항 정확도)과 레벨별 명시 가중(집계 표시)은 별개 레버. 보정으로 개별 난이도가 정확해지면 종합도 자동 상향(`weightedAverageDifficulty` 가 `q.difficulty` 를 읽으므로). 집계 가중표는 "고난도를 얼마나 강하게 반영할지"의 정책 레버(2026-06-01 거듭제곱 k → 레벨별 명시 가중으로 교체).
- **재분석 시 교정 보존** — `analyze/route.ts` 가 삭제 전 `manually_edited` 난이도를 보관 → 재생성 후 같은 question_number 에 재적용(새 AI값은 `ai_difficulty` 로 갱신 → 학습 쌍이 현 모델 반영).
- **순수 함수 분리** — calibration.ts 는 prisma 미import(스크립트/API 양쪽 재사용). DB 로더만 duck-typed 클라이언트 인자.

### 검증 (실측 완료)
- 24건 상향 교정 시뮬 → recompute → 전역 편향 **+1.00**(너무 낮음 정확 감지) + 버킷 2개 채택. `applyCalibration` 로 `algebra:2→3`, `algebra:3→4`(버킷), `geometry:2→3`(전역 폴백), `algebra:4→5`(캡) 정상.

---

## 2026-06-01 세션 — 통합 메타데이터 보정 엔진 (자가진화 전면 확장)

> ⚠️ **2026-06-02 자동 적용 비활성** — 위 플라이휠 섹션 참조. `MetadataCalibration`/`calibration.ts`/`recompute`는 보존되나 **분석에 미적용**(측정 벤치마크 전용). `applyNumericField`/`applyCategoricalRemap` 코드는 `ai-engine.ts`에 가역성 위해 남아있으나 호출부가 `calibrationSet` 미전달이라 비활성.

난이도 플라이휠을 **전 문항 메타데이터로 일반화**. `DifficultyCalibration` → **`MetadataCalibration`**(과목×필드 1행)으로 교체. `calibration.ts` 가 필드 무관 엔진. 모델/콘솔/recompute 모두 전 필드 처리.

### 두 종류의 보정
- **수치형(numeric)** — `difficulty`, `points`: 버킷별 평균 Δ → 새 AI값에 가산(캡). `NUMERIC_FIELDS` 설정(aiKey/valueKey/bucketOfPair/bucketOfFresh/clamp/roundOut). difficulty=`type:level` 버킷·±1.5캡, points=`question_format` 버킷·±5캡.
- **범주형(categorical)** — `topic`, `question_type`, `ability_domain`: 혼동맵 `{AI값:{정답값:count}}`. 적용 ① **프롬프트 few-shot 경고**(기본·안전, `buildCategoricalWarnings`) — 기존 LearnedPattern 모호 텍스트 대체 ② **초고신뢰 remap**(`applyCategoricalRemap`, 표본≥10+지배≥80%만, 보수적).

### 🚨 배점 편집 버그 동시 해결
`PointsCell`이 `{points}` PATCH 했으나 zod 스키마에 `points` 없어 **조용히 버려지던** 버그. 새로고침 시 소실. → PATCH 스키마에 `points/question_type/ability_domain` 추가 + 각 최초 교정 시 `ai_<field>` 원본 보존(`preserveAndSet` 헬퍼).

### 핵심 파일
- `MetadataCalibration` 모델 (`@@unique([subject, field])`). 마이그레이션은 `prisma db push`(동시 진행 billing의 TenantSubscription과 migration 충돌 회피).
- `calibration.ts` — `NUMERIC_FIELDS`/`CATEGORICAL_FIELDS` 설정 + 제네릭 코어(`extractNumericPairs`/`computeNumericStats`/`buildNumericMap`/`applyNumericField`, `extractConfusionPairs`/`buildConfusionMap`/`buildCategoricalWarnings`/`applyCategoricalRemap`) + `loadCalibrationSet`(전 필드 일괄). 난이도 공개함수(extractPairs/computeStats/applyCalibration)는 back-compat 래퍼(동작 보존).
- `calibration-recompute.ts` — `recomputeCalibrations(db, now)` 공유 헬퍼(route+script 재사용), 전 필드 upsert.
- `ai-engine.ts::analyzeExam(calibrationSet)` — 전 numeric 가산 + categorical remap. `analyze/route.ts` 가 `loadCalibrationSet` 주입 + 재분석 시 전 필드 교정 보존(`PRESERVE_FIELDS`).
- `prompt-builder.ts` — categorical 경고 주입(LearnedPattern 대체).
- `AnalysisResultView.tsx` — 유형·능력 인라인 셀렉터(`EnumCell`, ai 원본 hover). 배점/단원 셀은 이제 영구 저장.
- 관측 콘솔(`/admin/evolution`) — 필드별 섹션(수치=편향/버킷, 범주=혼동 상위쌍).

### 설계 결정 (재현 시 유지)
- **난이도 동작 보존** — 통합 엔진 위에서도 difficulty 결과 동일. 회귀 검증: 24건 시뮬 → **bias 1.00 동일**, `algebra:2→3`/`3→4`. points는 `3pt→5`(bias 2.0), question_type `algebra→function` remap 확인.
- **범주형 기본은 few-shot 경고** — remap은 초고신뢰(≥10·≥80%)만. 과교정·맥락 무시 위험 회피.
- **`preserveAndSet`/`PRESERVE_FIELDS`** — 5개 필드(difficulty/points/topic/question_type/ability_domain) 동일 패턴. 새 보정 필드 추가 시 `NUMERIC_FIELDS`/`CATEGORICAL_FIELDS`만 확장.
- **`db push` 사용** — 동시 billing 작업의 미마이그레이션 모델과 `migrate dev` 충돌 시. migrations는 gitignore라 schema.prisma가 SoT.

---

## 2026-06-01 세션 — 개발 워크플로 함정 (Prisma · dev서버 · Next build · React)

이번 세션에서 **디버깅에 가장 오래 걸린** 실수들. 재발 방지용 규칙으로 박제.

### 1. 🔴 Prisma 스키마 변경 → 반드시 dev 서버 끄고 진행 → 변경 후 재시작
- **generate EPERM (DLL 잠금)**: dev 서버(Turbopack)가 `query_engine-windows.dll.node`를 점유 중이면 `npx prisma generate` 실패 — `EPERM: operation not permitted, rename ...query_engine-windows.dll.node.tmp`. → dev 서버 중지 후 generate.
- **실행 중 dev 서버는 `@prisma/client`를 핫리로드 안 함**: 스키마에 새 모델 추가 + generate 해도, **돌고 있던 dev 서버는 메모리의 옛 클라이언트**를 계속 사용 → `prisma.newModel` 이 undefined → 해당 라우트 **런타임 500**. (다른 모델 쓰는 페이지는 멀쩡해서 원인 찾기 어려움.) → **스키마 변경 후 dev 서버 재시작 필수.**
- **표준 워크플로**: 스키마 변경 → dev 중지 → `prisma generate`/`migrate`/`db push` → dev 재시작.

### 2. 🔴 `migrate dev` 대신 `db push` (동시 미커밋 모델이 있을 때)
- 다른 작업(예: 동시 진행 billing)이 `schema.prisma`에 모델을 추가했으나 마이그레이션 미생성 상태면, `prisma migrate dev`가 드리프트를 감지해 **"public 스키마 reset 필요"** 경고(= 데이터 전체 증발 위험)를 띄운다.
- migrations 폴더는 `.gitignore`(SoT는 `schema.prisma`)이므로, **`prisma db push --accept-data-loss`** 로 동기화하면 테이블만 생성/변경하고 **기존 데이터는 보존**. `migrate reset` 절대 금지.
- (이번 세션 초반 `migrate reset` 으로 개발 DB 증발 → School 5,724개 + 분석본 수 시간 복구. → DB 백업 시스템 구축 계기.)

### 3. 🔴 dev 서버 떠 있을 때 `next build`(production) 금지
- `npx next build` 가 dev 서버와 **같은 `.next`를 덮어써** Turbopack 매니페스트가 깨짐 → `ENOENT ..._buildManifest.js.tmp` / `app-build-manifest.json` 무한 에러, 페이지 백지/무한 깨짐.
- **타입 검증은 `npx tsc --noEmit`** 로 (`.next` 안 건드림 — dev 서버와 무충돌). 프로덕션 빌드가 꼭 필요하면 **dev 중지 → `rm -rf .next` → build**.
- 둘 이상의 dev 서버/빌드가 같은 `.next` 공유도 동일하게 금지.

### 4. 🔴 React `useEffect` 의존성에 `useAuth`의 `user` 객체 넣지 말 것 → 무한 루프
- **증상**: 페이지가 스켈레톤/로딩에서 **무한 잔류**, 같은 API가 **초당 수회 반복 호출**(dev 로그에 `GET ... 200` 수백 줄), 새로고침 버튼 무한 회전.
- **원인**: `useEffect(() => { ...fetch() }, [user, load])` — `useAuth`가 **매 렌더마다 새 `user` 객체 ref**를 반환 → fetch→setState→리렌더→`user` ref 변경→effect 재발화→`load()`→무한 루프. (`load`가 `useCallback([])` 로 안정적이어도 `user` 객체가 불안정하면 루프.)
- **규칙**: effect 의존성엔 **객체 대신 원시값** — `[user?.role]`, `[user?.id]`. 사례: `/admin/evolution` 콘솔 ([page.tsx](src/app/(teacher)/admin/evolution/page.tsx)).
- **진단법**: "무한 스켈레톤" 보고 시 dev 로그에서 동일 API 반복 호출 여부부터 확인 → 반복이면 effect 의존성 루프, 0회면 fetch 실패(아래 5번).

### 5. 로딩/에러 상태 분리 (무한 스켈레톤 방지)
- `loading || !data ? <Skeleton/> : <Content/>` 패턴은 **fetch 실패 시** `loading=false`·`data=null` → **스켈레톤 영구 잔류**(에러 안 보임, 사용자는 원인 모름).
- **규칙**: `error` 상태 별도 + 3분기 — `loading ? Skeleton : !data ? ErrorPanel(메시지+다시시도) : Content`. 실패가 가시화되고 재시도 가능.

### 6. 동시 작업과 공유 파일 커밋 위생
- 다른 기능(billing 등)과 `schema.prisma`/`package.json`/일부 route를 동시 수정 중이면, 커밋 전 **`git diff <파일>` 로 내 diff만인지 확인**. 상대의 미커밋 산출물(`src/lib/billing/` 등)은 스테이징 제외.
- `git show HEAD:<파일> | grep <상대키워드>` 로 상대 변경이 **이미 커밋된 baseline인지** 확인 → baseline 위 내 변경만 들어가면 안전. (이번엔 billing의 `TenantSubscription`·`assertAnalysisQuota`가 기커밋 상태라 내 보정 diff만 깔끔히 분리 커밋 가능했음.)

### 메타 — Chrome MCP로 최종 실측
- "고쳤다"는 추측 금지. UI 버그는 **Chrome MCP로 실제 브라우저에서 검증**: ① 렌더 스크린샷 ② **유휴 중 network 요청 0건**(루프 없음 증명) ③ 새로고침 시 정확히 1요청 ④ console 에러 0. 사례: 자가진화 콘솔 무한루프 픽스 검증.

---

## 2026-06-02 세션 — 난이도 자동보정 폐기(CV 증명) + 문항 교정 UX 전탭화

기출분석 문항 메타데이터 교정 UX를 정비하고, **난이도 자가진화 자동보정을 데이터로 폐기**한 세션. 9개 고교 교사 ground truth로 검증해 결론을 뒤집은 과정과, 교정/피드백 UI를 전탭으로 통일하며 만난 함정을 박제.

### 1. 🔴 자동보정은 per-문항 정확도를 *악화*시킨다 — 추측 말고 CV로 증명
- **가설(틀림)**: "데이터 많이 쌓일수록 정교해진다" → 교사 교정 누적 → 전국 단일 보정맵 → AI 난이도 자동 시프트.
- **검증**: 9개 고교·85교정으로 **leave-one-school-out 교차검증**(`scripts/calibration-lab.mjs` sim 모드). 결과 — 자동보정 켜면 정확도 **53.8%→39.7%**, MAE **0.516→0.707**. 출처(provenance) 기반 보정도 0.620으로 악화.
- **원인**: ① AI가 이미 54% 정확 → 일괄 시프트(+반올림)가 *맞은 다수*를 파손. ② 난이도는 학교·학생 **상대적** → "전국 단일 진실"이라는 게 존재하지 않음.
- **결정**: 자동보정 **전면 비활성**. 수동 교정만 canonical(해당 시험에 즉시 반영), 누적 교정은 **측정 벤치마크 전용**(`/admin/evolution`). 종합 카드만 올리려면 `DIFFICULTY_LEVEL_WEIGHTS`(per-문항 무해).
- **교훈**: "쌓이면 좋아진다"는 직관이 데이터로 반증될 수 있다. 보정/학습 루프는 **반드시 hold-out CV로 per-항목 정확도를 측정**한 뒤 켤 것. 집계 지표(종합카드)만 좋아지는 것에 속지 말 것. 코드(`applyNumericField`/`applyCategoricalRemap`/`MetadataCalibration`)는 가역성 위해 **남기되 호출부가 `calibrationSet` 미전달**로 비활성 — 삭제보다 차단이 안전.

### 2. 🟡 옵션 value ↔ AI 저장 포맷 불일치는 "조용히" 깨진다 (소단원 함정)
- **증상**: 단원 드롭다운에 소단원까지 표시되는데 분류된 단원이 자동 선택 안 됨 + 단원별 출제현황 그룹핑이 어긋남.
- **원인**: AI 저장 포맷 = `과목 > 대단원 > 중단원`(예: `공통수학1 > 다항식 > 다항식의 연산`). 드롭다운 value = `대단원 > 중단원 > 소단원`(**과목 prefix 없음 + 소단원 과다**). 출제현황은 `parts[0:2]`를 그룹·`parts[2]`를 minor로 씀 → AI topic은 그룹=대단원/minor=중단원으로 잡히지만, 소단원까지 고른 교정값은 그룹=중단원으로 **다르게** 묶임.
- **수정**: 드롭다운을 **중단원까지만** 제공 + value에 **과목 prefix** 포함(`unitsToGroups(units, labelPrefix, valuePrefix)`). `getTopicOptionsByGrade`는 그룹 옵션 평탄화로 단일 소스화 ([topic-options.ts](src/components/exam-analysis/utils/topic-options.ts)).
- **교훈**: "유형이 중단원으로 표기되는데 소단원이 의미 있나?" 류 의심은 **AI 실제 저장 포맷을 grep으로 확인**하고 옵션 value와 1:1 대조할 것. 드롭다운이 더 깊은 단계를 제공하는 게 친절한 게 아니라 **포맷 정합을 깨는 버그**다. CLAUDE.md V3 함정 #13의 일반화.

### 3. 동일 인터랙션은 공유 컴포넌트로 추출 → 전탭 동작 통일
- **요구**: 피드백 신고를 AI 코멘트 탭뿐 아니라 문항별 분석 표에서도 *동일하게* + 신고 시 **시험지/문항 전 메타데이터 동봉**.
- **패턴**: `QuestionFeedbackButton`으로 추출(`{ q, examPaperId, analysisId, align }`). `handleSubmit`이 신고 시점 스냅샷(`correction`: difficulty/ai_difficulty/topic/type/ability/points/comment/confidence …)을 POST. 두 탭이 같은 컴포넌트를 import → 동작·메타데이터 자동 일치.
- 난이도 인라인 교정도 동일 — AI 코멘트 탭의 `saveDifficulty`(PATCH + ai_difficulty 보존 + `onDifficultyEdit` 콜백)를 문항별 분석 표의 `DifficultyCell`로 복제. 부모(`AnalysisDetail`)가 `diffEdits` 오버레이로 종합 난이도 즉시 재계산.
- **교훈**: "어느 탭에서든 동일 작동" 요구 = **로컬 state 복붙 금지, 컴포넌트 추출**. 메타데이터 스냅샷은 신고 시점 값으로 굳혀야(렌더 시점 props가 아니라) 검토자가 맥락 보존.

### 4. number input 스피너는 정수 가정 — 소수 배점에 무의미
- 배점 입력 `type="number"`의 ▲▼는 정수 step → 소수 배점(2.5점 등)엔 의미 없고 방해. → `type="text" inputMode="decimal"` + `onChange`에서 `replace(/[^0-9.]/g, '')`로 숫자·점만 허용. 모바일 숫자 키패드 유지.

### 5. 정렬은 문장 나열 말고 명시 그리드 (난이도 모달)
- 난이도 분포를 인라인 문장(`기본 3 · 표준 6 · …`)으로 두면 줄바꿈에 따라 정렬이 흐트러짐 → **5행 그리드**(단계 배지+라벨 좌 / 문항수 우 정렬). "선생님 보정 N건 반영" 섹션을 추가해 `{번호} {AI원본}(취소선)→{교사값}` 칩으로 *어떤 문항에 무엇이 적용됐는지* 가시화.

### 6. 🟡 연속값(소수)을 이산 칸(1·2·3·4·5)에 얹지 말 것 — 연속축 수직선으로
- **증상**: 시험 난이도 카드가 헤더엔 **3.9단계**, 박스는 **4** 강조 + ▼ 마커가 박스와 어긋남. "왜 3.9인데 4가 강조되지?" + "화살표가 안 맞는다"는 혼란.
- **원인**: 가중평균은 **연속값(3.9)**인데 표시는 **이산 박스 5칸**. `round(3.9)=4` 박스를 강조 → 헤더(정밀 3.9)와 박스(정수 4)가 개념·시각 양쪽으로 충돌. 마커를 박스 중심 px(`(avg-1)*26+12`)로 얹으니 박스 강조 위치(70%)와 마커(68%)도 미세하게 어긋남.
- **함정 심화(직전 시도)**: 모달 텍스트를 "3.90 → 3.9단계"(동일 숫자, 무의미)로 뒀다가, "3.90 → 4단계"로 고쳤더니 이번엔 헤더 3.9 vs 본문 4 불일치를 *부각*시킴. 이산/연속 혼용을 유지하는 한 어떤 텍스트로도 모순이 안 풀림.
- **해결**: **연속축 수직선**(`DifficultyNumberLine`). 1~5 그라데이션 트랙 위 위치 = `(v-1)/4×100%`(1=0%·3=50%·5=100%) → 마커가 축과 **자연히 정렬**(px 하드코딩·박스 강조 불필요). 헤더·마커 모두 3.9로 **일관**, "4단계" 주장 소멸.
- **보너스(보정 전→후 시각화)**: 같은 축에 마커 2개 — 보정 후 ▼(현재) + 보정 전 ▲(AI 원본, 차이 ≥0.05일 때만). 보정 전 평균은 `weightedAverageDifficulty`에 `difficulty`를 `ai_difficulty ?? difficulty`로 치환해 **동일 공식 재사용**. 무의미하던 변환 텍스트를 "AI 분석 3.8 → 선생님 교정 후 3.9단계 (N건 반영)"로 대체 → "→" 화살표가 *진짜* 의미를 가짐.
- **교훈**: round 표시는 카테고리 인식엔 좋지만(#12-7), 정밀 헤더값과 **동시 노출**하면 모순으로 읽힌다. 연속 척도는 연속축으로 그려라 — 마커 정렬 문제(px 하드코딩, 박스 폭 % 보정 등 과거 핫픽스)가 근본적으로 사라진다.

### 7. 교정 이벤트 로그 (`MetadataCorrectionLog`) — append-only 수집 레이어
- **배경**: 자동보정은 폐기(CV)됐지만 *수집*은 안전·유효. "어떤 문제를 자꾸 보정하는지" 추적하려면 **이벤트 단위** 데이터가 필요한데, 기존 구조는 문항 JSON에 **최신 상태만**(`ai_<field>` = 최초 AI, `<field>` = 현재) 남아 **빈도·방향·궤적·시계열을 못 봄**.
- **모델** `MetadataCorrectionLog` (append-only, **FK 미설정** — 시험지 삭제돼도 이력 보존): `examPaperId·tenantId·questionNumber·field` + `aiValue(최초 AI)·fromValue(직전)·toValue(교정후)` + 맥락 스냅샷(`topic·questionType·aiDifficulty·grade`) + `userId·createdAt`.
- **수집 훅**: 교정 PATCH(`/api/exam-analysis/[id]/questions/[questionNumber]`)에서 **실제 변경된 필드(from≠to)마다 1행** `createMany` (best-effort try/catch — 로그 실패해도 교정 저장은 성공). `applyField` 헬퍼가 보존(`ai_<field>`)+적용+로그수집을 한 번에.
- **관측 화면**: `/admin/evolution`(SUPER_ADMIN) "교정 수집 로그" 섹션 — ① 자주 보정되는 패턴 TOP(`groupBy [field,aiValue,toValue,topic]`) ② 반복 교정 문항 2회+(`groupBy [examPaperId,questionNumber,field] + having: { id: { _count: { gt: 1 } } }`) ③ 최근 이벤트 타임라인. `/api/admin/evolution` 응답에 `correctionLog` 블록 추가(방어적 try/catch 폴백).
- **설계 결정**: 자동 반영 없음(측정·관측 전용). 집계 가중(`DIFFICULTY_LEVEL_WEIGHTS`)·per-문항 보정과 **직교**. 향후 안전한 고도화(프롬프트 few-shot·지점별 보정)의 *데이터 토대*. 기존 교정분(훅 이전)은 로그에 없음 → 필요 시 문항 JSON에서 백필.
- **검증 패턴**: 브라우저 교정 → PATCH 200 → DB 로그 적재(맥락 포함) → `groupBy/having` 집계 end-to-end 확인 → **테스트 교정·로그 원복**(데모 데이터 오염 방지). Prisma `having` 카운트 필터는 `having: { id: { _count: { gt: N } } }` + `_count: { id: true }` 쌍으로.

### 8. 🔴 dev 서버 포트 충돌 — `localhost`(IPv6 ::1) vs `127.0.0.1`(IPv4) + 다른 프로젝트
- **증상**: 스키마 변경 후 mathlab dev 재기동했는데 브라우저 `localhost:3000`이 **전혀 다른 프로젝트**(옆 폴더 vite 앱) 화면을 띄움. 같은 :3000인데.
- **원인**: 다른 프로젝트가 `[::1]:3000`(IPv6 localhost)에 listen 중 + mathlab은 `0.0.0.0:3000`(IPv4)에 bind. Windows `localhost`는 **IPv6(::1) 우선** 해석 → 브라우저가 옆 프로젝트로 감. `127.0.0.1`이어야 IPv4(mathlab). 두 앱이 주소패밀리가 달라 **동시에 :3000 점유** 가능(EADDRINUSE 안 남 → 더 헷갈림).
- **해결**: 충돌 의심 시 mathlab을 **명시 전용 포트**로 — `PORT=3100 npm run dev`(`scripts/dev.mjs`가 PORT env 우선). 브라우저는 `localhost:3100`(전용 포트는 충돌 없음). 진단: `netstat -ano | grep :3000`로 IPv4(`0.0.0.0`)·IPv6(`[::1]`) 리스너 PID 각각 확인 + `wmic process where "ProcessId=N" get CommandLine`로 어느 프로젝트인지 식별.
- **스키마 변경 워크플로 재확인**(#1과 연계): dev 중지(DLL 잠금 해제 + 새 모델 핫리로드 안 됨) → `prisma generate` + `db push` → dev 재시작. 재시작 시 위 포트 충돌 주의.

### 9. 내보내기(Export `/print`) 제거 (2026-06-02) — 재구축 시 V3 PDF로
- **결정**: 분석본 **"내보내기"** 버튼 + `/exam-analysis/[id]/print` 페이지를 **삭제**. 헤더 버튼([AnalysisDetail.tsx](src/app/(teacher)/exam-analysis/AnalysisDetail.tsx)) 제거 + `Download` import 정리 + `print/page.tsx` 파일 삭제. (참조처는 그 버튼 하나뿐이라 dead link 없음.)
- **이유**: ① **블로그 이미지 복사(네이버 V3)** 가 주력 공유 산출물 — print(raw 표)와 채널·품질 격차 큼. ② print는 **V2 마크업**이라 V3와 동기화 안 됨(반쯤 유지되던 부채). ③ **오프라인(종이/PDF) 수요 현재 없음** — 디지털(블로그·카톡) 공유 중심.
- **재구축 가이드(나중에 오프라인 수요 생기면)**: V2 print를 되살리지 말 것. **"내보내기 = V3 화면을 PDF/이미지로 저장"** 으로 재정의 — 산출물은 V3 하나, 전달 포맷만 둘(클립보드→블로그 / PDF→오프라인)로 중복·부채 방지. (V3 톤은 `naver-v3-renderer.ts` / V3CommentaryView 재사용)
- **잔존 무관**: `/tests/[id]/print`(시험지 인쇄, 9템플릿)는 **별개 기능 — 영향 없음**. 삭제된 건 기출분석(exam-analysis) 전용 print만.

### 메타 — API 과부하(529) 중 작업 진행
- compaction(요약)이 500/529로 실패하는 건 Anthropic API 과부하(status.claude.com fetch 자체가 529)일 수 있음 — **일반 도구 호출은 통과**하므로 작업은 계속 가능. 추측 금지하고 status로 확인.
