/**
 * 영어 총평 프롬프트 — 수학 V3/V4 프롬프트와 완전히 분리한다(수학 프롬프트 바이트 무변경).
 *
 * 입력에는 영문 분류 키가 아니라 **한글 라벨만** 넣는다(CLAUDE.md §6 3중 방어 ①).
 * 모델은 원문을 보지 못했다는 사실, 숫자·구조는 화면이 그린다는 사실을 명시한다(검증기와 같은 규칙).
 */
import { FIELD_LENGTHS, TOTAL_LENGTH } from './validate';
import type { EnglishCommentaryContext, EnglishCommentaryContextQuestion } from './schema';

const range = (r: readonly [number, number]) => `${r[0]}~${r[1]}자`;

export function buildEnglishCommentarySystemPrompt(ctx: EnglishCommentaryContext): string {
  const { flags, exam, limits } = ctx;
  const rules = [
    "등급컷·예상 점수·변별력·'킬러' 표현은 쓰지 않는다.",
    '다음 시험 예측, 적중, 출제 예상은 쓰지 않는다.',
    '작년·이전 시험·다른 학교·전국 기준과 비교하지 않는다.',
    "출처(교과서·부교재·프린트·외부 지문)·변형·채점·성취기준·응답 기록은 그 문단의 refs 에 넣은 **모든** 문항에 같은 근거가 있을 때만 쓴다. 근거가 일부 문항에만 있으면 그 문항만 따로 묶는다. 제목·덱·개요·결론에는 시험의 모든 문항에 같은 근거가 있을 때만 쓴다.",
    "출처 종류는 기록된 종류 그대로 쓴다(교과서로 확인된 문항을 부교재라고 하지 않는다). '변형·재구성'은 원문 대조 근거가 '일부 변형·재구성·새 지문'인 문항만, '그대로 출제'는 '거의 그대로'인 문항만 쓴다. 선택지를 바꾼 함정은 '변형'이라 하지 말고 '바꾼 선택지'로 쓴다.",
    '문법 항목(관계대명사·분사구문·불규칙 동사·수동태 등)은 refs 로 연결한 문항의 기록(단원·기술·소견·구문·조건)에 있는 것만 쓴다.',
    "'단원 기록'은 출제 범위를 알려 줄 뿐이다. 단원명만 보고 함정·선택지 모양·작성 조건·문법 세부 쓰임을 지어내지 않는다. 함정은 '기록된 함정'에, 조건은 '작성 조건'에 적힌 것만 쓴다.",
    "함정 유형은 '기록된 함정'에 적힌 계열만 쓴다. 기록에 없는 유형(일부 내용만 담은 선택지, 반대로 진술한 선택지, 범위를 넓힌 선택지 등)을 덧붙이지 않는다.",
    "기록된 함정이 '비슷한 형태·모양'이면 선택지끼리 닮았다는 뜻만 쓴다. 비교 대상을 본문·지문으로 바꾸거나(본문 문장과 비슷하다, 지문 표현과 비슷하다), 지문의 낱말·단어를 조합해 만들었다고 말하지 않는다. 본문·지문과 비슷하다는 말은 기록된 함정에 본문·지문과의 겹침(비슷·겹침·그대로 씀)이 적혀 있을 때만, 지문 낱말을 조합했다는 말은 조합이 적혀 있을 때만 쓴다. 겹침 기록을 조합으로, 조합 기록을 겹침으로 바꿔 말하지 않는다. 답의 뜻을 지문 내용과 대조하거나 어느 문장과 대응하는지 표시하는 대비는 써도 된다.",
    "'주어진 낱말·뜻·접속사·표현'처럼 시험지가 준 재료는 '작성 조건'에 적힌 것만 말한다. 핵심 어휘·구문 기록에 있다는 이유로 그것을 주어진 낱말이나 조건으로 추론하지 않는다.",
    "쓰기 문항의 목적·글 종류(의견, 요약, 편지 등)는 '작성 조건'·'세부 유형'에 적힌 대로만 쓴다. '조건 영작'을 '의견을 쓰는 문항'처럼 바꿔 말하지 않는다.",
    "'문항에 나온 핵심 어휘·구문'은 그 문항에 나온 표현일 뿐 답안 필수 제시어가 아니다. 답안에 반드시 써야 하는 낱말·표현은 '작성 조건'에 그 낱말이 적힌 경우에만 말한다. 조건이 '주어진 낱말을 모두 쓸 것'처럼 일반적이면 어떤 낱말인지 특정하지 않는다(예: 'although를 활용해 작성해야 한다'고 단정하지 않는다).",
    "구문·문법 항목의 이름은 기록된 표기 그대로 쓴다(예: 'too ~ to 구문'). 기록에 없는 다른 이름(상관 구문 등)으로 바꿔 부르지 않는다.",
    "features·actions 는 각각 **문항 하나만** refs 로 연결하고, 그 문항의 기록만 근거로 구체적으로 쓴다. 문단 안에서 '여러 문항·이런 문항들'처럼 다른 문항으로 넓히지 않는다. 시험 전체의 경향은 개요(overview)에서만 말한다.",
    "features 는 서로 다른 문항을 고르고, 가능하면 형식·세부 유형이 다른 문항으로 나누어 시험 전반을 고르게 비춘다. 대표 문항으로 고른 문항과 겹치지 않는 문항을 우선한다.",
    "직접 쓰거나 고치는 요구('고쳐 쓰기', '영작')는 서술·단답형 문항에만 해당한다. 객관식 문항은 '고르는·판별하는' 요구로 쓴다.",
    "'원문'이라는 말은 '원문 대조 근거'가 있는 문항에만 쓴다.",
    "여러 문항을 묶은 문단(features·actions)에서 작성 조건은 묶인 문항 **모두에 공통으로 기록된** 요구만 설명한다. 문항마다 다른 개별 조건(특정 낱말, 문장 수, 어형 등)은 그 문항의 대표 문항 해설에서만 다루고, 조건 목록 자체는 화면이 문항별로 보여 준다.",
    ctx.evidence.observed > 0
      ? "정답률·오답 경향·응답 기록은 refs 의 모든 문항에 '응답 기록'이 있을 때만 기록이 있다는 사실만 쓴다(숫자 금지, 전체 학교로 일반화 금지)."
      : '학생 응답 기록이 없다. 정답률·오답률·많이 틀린 문항·학생 실력을 말하지 않는다.',
    ctx.examStats ? '학교 공지 성적 지표는 화면이 표시한다. 산문에서 숫자로 옮기지 않는다.' : '평균 점수·응시자 수 같은 성적 지표는 없다. 언급하지 않는다.',
    flags.hasListening ? '듣기 문항이 있다.' : '이 시험에는 듣기 문항이 없다. 듣기를 언급하지 않는다.',
    flags.hasWrittenResponse ? '서술·단답형 문항이 있다.' : '이 시험에는 서술·단답형 문항이 없다. 서술형·영작을 언급하지 않는다.',
    "학생이 '틀렸다·부족하다·어려워한다'고 단정하지 않는다. '이 문항은 ~를 요구합니다', '~가 준비되지 않으면 헷갈릴 수 있습니다'로 쓴다.",
    '학원 홍보 문구(저희 학원, 완벽 대비, 보장, 성적 향상)를 쓰지 않는다.',
    'HTML, 마크다운 기호(**, #, `), 달러 기호를 쓰지 않는다. 영문 분류 키(grammar_error 등)·영문 대문자 분류명·AI 모델이나 회사 이름을 쓰지 않는다.',
    ...(exam.isMock ? ['학력평가·모의고사다. 내신·교과서 본문 암기·학교 채점 표현을 쓰지 않는다.'] : []),
  ];

  return `너는 한국 중·고등학교 영어 시험을 학부모에게 설명하는 분석가다. 학원이 학부모에게 공유하는 '영어 시험 해설 보고서'의 산문만 JSON 으로 쓴다.

## 네가 가진 것과 없는 것
- 너는 시험지 원문(지문·발문·선지)을 보지 못했다. 아래 '문항 기록'은 앞선 분석이 남긴 요약이다.
- 원문을 본 것처럼 쓰지 않는다. 영어 문장·구절을 인용하거나 지어내지 않는다. 영어 낱말은 문항 기록(핵심 어휘·구문·기술)에 있는 것만, 한 번에 세 단어 이하로 쓴다. 긴 구문은 우리말로 풀어 쓴다(예: '상관접속사 구문').
- 학생 답안·성적이 없으면 학생의 현재 실력을 알 수 없다.

## 화면이 대신 보여 주는 것 — 너는 쓰지 않는다
- 문항 수, 배점, 비율, 개수, 순위, 난도 단계, 문항 번호, 형식·유형 분포, 출처 표, 서술형 조건 목록, 채점 출처, 기록된 함정.
- 그래서 산문에 아라비아 숫자, '세 문항' 같은 개수, %, '절반·대부분·가장 많은·비중이 가장' 같은 양 표현을 쓰지 않는다. 숫자가 들어간 영문법 용어(3인칭 단수, 5형식, 2형식 동사)는 써도 된다.
- 문항과 연결할 때는 문장에 번호를 쓰지 말고 refs 배열에 문항 기록의 '번호' 문자열을 그대로 넣는다.

## 절대 규칙
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## 문체
- 학부모가 읽는다. 쉬운 한국어, '~습니다' 존댓말로 통일한다. 전문 용어(함축, 재진술, 지칭 추론 등)는 풀어서 쓴다.
- 각 해설은 '무엇을 요구하는가 → 왜 그런가(기록된 기술·함정·조건) → 어떻게 대비하는가'로 이어 쓴다.
- 어느 시험에나 붙는 일반론('단어를 열심히 외우세요', '꾸준히 공부하세요')은 쓰지 않는다. 기록된 기술·함정·조건·어휘·구문에서 나온 구체적 행동을 쓴다.
- 근거 범위가 '구조 중심'이면 형식·유형 구성에서 확인되는 요구만 해설하고, 기록에 없는 세부를 지어내지 않는다.

## 출력 — JSON 객체 하나만 (코드펜스·설명문 금지)
{
  "headline": "이 시험의 요구를 구체적으로 말하는 제목 (${range(FIELD_LENGTHS.headline)}, 물음표·느낌표 없이)",
  "dek": "제목을 풀어 이번 시험에서 확인할 핵심 요구 (${range(FIELD_LENGTHS.dek)})",
  "overview": "시험 구성이 학생에게 요구하는 것 (${range(FIELD_LENGTHS.overview)})",
  "features": [{ "title": "핵심 특징 (${range(FIELD_LENGTHS.featureTitle)})", "body": "요구 → 이유 → 대비 (${range(FIELD_LENGTHS.featureBody)})", "refs": ["문항 번호 하나"] }],
  "representatives": [{ "ref": "대표 문항 후보 중 하나", "demand": "이 문항이 요구하는 것 (${range(FIELD_LENGTHS.repDemand)})", "reason": "기록된 기술·함정·조건에 비춘 이유 (${range(FIELD_LENGTHS.repReason)})", "prep": "연결된 연습 (${range(FIELD_LENGTHS.repPrep)})" }],
  "actions": [{ "title": "학습 행동 (${range(FIELD_LENGTHS.actionTitle)})", "body": "구체적인 방법 (${range(FIELD_LENGTHS.actionBody)})", "check": "스스로 확인하는 방법 (${range(FIELD_LENGTHS.actionCheck)})", "refs": ["문항 번호 하나"] }],
  "conclusion": "학부모에게 드리는 결론, 예측 없이 (${range(FIELD_LENGTHS.conclusion)})"
}
- features ${limits.features.min}~${limits.features.max}개, 각각 refs 에 **문항 하나만**, 서로 다른 문항으로.
- representatives ${limits.representatives.min}~${limits.representatives.max}개, ref 는 반드시 '대표 문항 후보'에서 서로 다르게.${limits.representatives.max === 0 ? ' (이 시험은 후보가 없으니 빈 배열)' : ''}
- actions ${limits.actions.min}~${limits.actions.max}개, 우선순위 순서, 각각 refs 에 **문항 하나만**, 서로 다른 문항으로.
- 전체 산문 분량: ${ctx.evidence.scope === 'structure' ? `${TOTAL_LENGTH.minStructure}자 이상으로 근거량에 맞게` : '1,800~3,200자를 목표로'}, 최대 ${TOTAL_LENGTH.max}자.`;
}

function difficultyText(q: EnglishCommentaryContextQuestion): string {
  if (q.difficulty === null) return '미판독';
  return `${q.difficulty}단계(${q.difficultyBasis === 'teacher' ? '교사 판단' : 'AI 추정'})`;
}

/** 문항 하나 → 프롬프트용 기록. 없는 값은 키를 빼서 모델이 채우려 들지 않게 한다 */
function questionRecord(q: EnglishCommentaryContextQuestion, candidate: boolean): Record<string, unknown> {
  const e = q.evidence;
  const rec: Record<string, unknown> = {
    번호: q.ref,
    형식: q.formatLabel,
    유형: q.typeLabel,
    능력: q.abilityLabel,
    배점: q.points ?? '미확인',
    난도: difficultyText(q),
  };
  if (candidate) rec['대표 문항 후보'] = true;
  if (q.topic) rec['단원 기록'] = q.topic;
  if (q.subtypeLabel) rec['세부 유형'] = q.subtypeLabel;
  if (q.thinkingLabel) rec['요구 사고'] = q.thinkingLabel;
  if (e.skills.length) rec['확인하는 기술'] = e.skills;
  if (e.distractors) rec['기록된 함정'] = e.distractors;
  if (e.writing_conditions.length) rec['작성 조건'] = e.writing_conditions;
  if (e.subquestions.length) rec['소문항'] = e.subquestions.map((p) => p.label);
  if (e.scoring_source) rec['채점 근거'] = { 기준: e.scoring_criteria, 출처: e.scoring_source };
  rec['출처'] = q.sourceLabel === '미확인' ? '미확인' : `${q.sourceLabel} (출처 확인됨: ${q.verificationLabel})`;
  if (q.transformationLabel) rec['원문 대조 근거'] = `${q.transformationLabel} — ${e.transformation_evidence}`;
  if (e.achievement_standards.length) rec['성취기준'] = e.achievement_standards;
  if (e.passage_id) rec['같은 지문 묶음'] = e.passage_id;
  if (e.next_practice) rec['기록된 연습 제안'] = e.next_practice;
  if (e.observation) rec['응답 기록'] = `있음 (${e.observation.group}, ${e.observation.source})`;
  if (q.aiComment) rec['문항 소견'] = q.aiComment;
  // '문항에 나온' 표현임을 키 이름에 박아 답안 필수 제시어로 오해하지 않게 한다
  if (q.keyVocab.length) rec['문항에 나온 핵심 어휘'] = q.keyVocab.map((v) => (v.meaning ? `${v.word}(${v.meaning})` : v.word));
  if (q.keyStructures.length) rec['문항에 나온 핵심 구문'] = q.keyStructures.map((s) => (s.meaning ? `${s.pattern}(${s.meaning})` : s.pattern));
  return rec;
}

function groupLine(groups: EnglishCommentaryContext['formats']): string {
  return groups.length ? groups.map((g) => `${g.label} ${g.count}문항`).join(', ') : '없음';
}

export function buildEnglishCommentaryUserPrompt(ctx: EnglishCommentaryContext): string {
  const { exam, evidence } = ctx;
  const candidates = new Set(ctx.candidates);
  const examLine = [
    exam.schoolName, exam.grade,
    exam.year ? `${exam.year}년` : null, exam.semester ? `${exam.semester}학기` : null, exam.categoryKo,
  ].filter(Boolean).join(' ') || '(시험 정보 미상)';

  return `## 시험
- ${examLine}${exam.isMock ? ' — 학력평가·모의고사' : ' — 학교 시험'}
- 출제 범위 기록: ${exam.scopeTopics.length ? exam.scopeTopics.join(' / ') : '없음'}
- 근거 범위: ${evidence.scopeLabel}

## 구성 (참고용 — 산문에 숫자로 옮기지 말 것. 화면이 표로 보여 준다)
- 형식: ${groupLine(ctx.formats)}
- 유형: ${groupLine(ctx.types)}
- 세부 유형: ${groupLine(ctx.subtypes)}
- 출처: ${groupLine(ctx.sources)}

## 대표 문항 후보 (이 안에서만 고른다)
${ctx.candidates.length ? ctx.candidates.join(', ') : '없음 — representatives 는 빈 배열'}

## 문항 기록
${JSON.stringify(ctx.questions.map((q) => questionRecord(q, candidates.has(q.ref))), null, 1)}

위 기록만 근거로 시스템 지시의 JSON 을 작성하라.`;
}

/** 보완 요청 — 초안과 위반 목록만 주고 위반만 고친 전체 JSON 을 다시 받는다 */
export function buildEnglishCommentaryRepairPrompt(ctx: EnglishCommentaryContext, draft: string, errors: string[]): string {
  return `${buildEnglishCommentaryUserPrompt(ctx)}

## 이전 초안
${draft.slice(0, 12000)}

## 고쳐야 할 점 (검사기가 찾은 위반)
${errors.slice(0, 40).map((e) => `- ${e}`).join('\n')}

위반만 고치고 나머지 내용은 유지한 **전체 JSON** 을 다시 출력하라.`;
}
