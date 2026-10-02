/**
 * 영어 총평 산문 검증기 — 순수 함수, 클라이언트 안전.
 *
 * 프롬프트 지시만으로는 막을 수 없는 것을 코드로 막는다(§12-11, §12-12):
 * - 참조 실재성·중복·후보 밖 대표 문항·섹션 개수
 * - **정량 서술 금지**: 숫자·개수·비율은 화면이 context 에서 그린다. 산문의 숫자는 '맞는 숫자 + 틀린 의미'를
 *   걸러낼 방법이 없으므로 허용 집합이 아니라 전면 금지한다. 단 숫자가 들어간 영문법 용어(3인칭·5형식)는 예외.
 * - 근거 없는 출처·변형·채점·성취기준 주장, 없는 듣기·서술형 언급, 등급컷·예측·비교·변별·실력 단정
 * - 원문 인용(영어 문장), 내부 영문 키, HTML·마크다운·달러, 모델·회사 이름, 홍보 문구
 *
 * 반환값은 보완 요청 프롬프트에 그대로 들어가는 한국어 오류 목록이다. 빈 배열 = 통과.
 */
import type { EnglishCommentaryContext, EnglishCommentaryContextQuestion, EnglishCommentaryReport } from './schema';
import type { EnglishQuestionAnalysis } from '../question-evidence';

/** 필드별 글자 수 범위 (공백 정규화 후) */
export const FIELD_LENGTHS = {
  headline: [8, 40],
  dek: [20, 140],
  overview: [60, 450],
  featureTitle: [4, 40],
  featureBody: [50, 360],
  repDemand: [15, 220],
  repReason: [15, 220],
  repPrep: [15, 220],
  actionTitle: [4, 40],
  actionBody: [25, 220],
  actionCheck: [10, 150],
  conclusion: [40, 320],
} as const;

/** 산문 총량 — 구조 중심 보고서는 근거량이 적어 하한을 낮춘다 */
export const TOTAL_LENGTH = { minStructure: 400, min: 800, max: 4200 } as const;

/** 숫자가 들어가도 되는 영문법 용어 — 검사 전에 지운다 */
const GRAMMAR_NUMBER_TERMS = /[0-9０-９]\s*(?:형식|인칭|문형)|3\s*단현/g;
const DIGIT = /[0-9０-９]/;
const CIRCLED = /[①-⑳]/;
// '한 문제씩 풀어 보기' 같은 학습 조언은 통과시키고, 시험 구성의 개수(문항·지문)만 막는다
// '~을 바탕으로 한 문항'의 '한'은 관형형(했다)이지 수사가 아니다 — '(으)로 한'은 제외한다
const KOREAN_COUNT = /(?<![가-힣])(?<!(?:으로|로)\s)(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무)\s*(?:문항|지문)/;
const QUANTITY_WORDS = /%|퍼센트|절반|과반|대부분|대다수|모든\s*문항|(?<![가-힣])전\s*문항|가장\s*많|최다|비중이\s*가장|가장\s*큰\s*비중|배점이\s*가장|최고\s*배점/;

const ALWAYS_FORBIDDEN: Array<[RegExp, string]> = [
  [/등급\s*컷|커트\s*라인|컷\s*라인|예상\s*등급|등급이\s*갈/, '등급컷·등급 예상은 쓸 수 없습니다'],
  [/변별/, "'변별' 표현은 응답 자료 없이 쓸 수 없습니다 — '요구가 높은 문항'처럼 쓰세요"],
  [/킬러/, "'킬러' 표현은 쓰지 않습니다 — 난도는 화면이 '교사 판단·AI 추정'으로 보여 줍니다"],
  // '내용을 예측하며 읽기'는 독해 전략이라 막지 않는다 — 시험 출제 예측만 막는다
  [/적중|출제\s*예상|예상\s*문제|나올\s*(?:가능성|확률)|(?:다음|기말|중간)\s*시험[^.]{0,20}(?:나올|나온다|출제될|예상|예측)/, '다음 시험 예측·적중 표현은 쓸 수 없습니다'],
  [/전국|다른\s*학교|인근\s*학교|주변\s*학교|타\s*학교|작년|지난\s*(?:시험|학기|해)|이전\s*(?:시험|기출)|예년|전년/, '다른 시험·학교·전국 기준과의 비교는 쓸 수 없습니다'],
  // '본원'은 '기본원리' 같은 낱말 안에서도 나오므로 앞뒤가 한글이 아닐 때만 본다
  [/저희\s*학원|(?<![가-힣])본원(?:에서|의|은|이)?(?![가-힣])|보장|완벽\s*(?:대비|정리)|성적\s*향상/, '학원 홍보 문구는 쓸 수 없습니다'],
  [/(?:아이|학생|자녀)(?:들)?(?:이|가|은|는)\s*[^.\n]{0,24}(?:부족합니다|부족하다|약합니다|약하다|어려워합니다|못합니다|틀렸습니다|틀립니다)/, '학생의 실력·오답을 단정할 수 없습니다 — 문항이 요구하는 것으로 쓰세요'],
  [/<\/?[a-z][^>]*>/i, 'HTML 태그는 쓸 수 없습니다'],
  [/\*\*|__|`|^#{1,6}\s/m, '마크다운 기호(**, #, `)는 쓸 수 없습니다'],
  [/\$/, '달러 기호($)는 쓸 수 없습니다'],
  [/claude|gemini|gpt|anthropic|openai|deepseek|sonnet|chatgpt|google/i, 'AI 모델·회사 이름은 쓸 수 없습니다'],
  [/\b[a-z]+_[a-z_]+\b/, '내부 영문 분류 키(예: grammar_error)는 쓸 수 없습니다 — 한글 라벨을 쓰세요'],
  [/\b(?:GRAMMAR|VOCABULARY|READING|LISTENING|WRITING|COMMUNICATION|ACCURACY|UNDERSTANDING|REASONING|EXPRESSION|MIDTERM|FINAL|MOCK|OBJECTIVE|ESSAY)\b/, '영문 분류명은 쓸 수 없습니다 — 한글 라벨을 쓰세요'],
];

/**
 * 근거가 필요한 주장 — **문단이 연결한 모든 문항(refs)** 에 같은 근거가 있어야 통과한다.
 * refs 가 없는 제목·덱·개요·결론은 시험 **전 문항** 기준이다(일부 문항의 근거를 시험 전체로 넓히지 않게).
 * 근거가 일부에만 있으면 그 문항만 따로 refs 로 묶어 써야 한다.
 */
type SourceKind = EnglishQuestionAnalysis['source']['kind'];
/** 출처 종류를 직접 말하는 표현 — 말한 종류와 연결 문항의 확인된 출처 종류가 맞아야 한다 */
const SOURCE_KIND_CLAIMS: Array<[RegExp, SourceKind, string]> = [
  [/교과서/, 'textbook', '교과서'],
  [/부교재/, 'workbook', '부교재'],
  [/학교\s*프린트|프린트\s*(?:지문|에서)/, 'handout', '프린트'],
  [/모의고사\s*지문|학력평가\s*지문/, 'mock', '학력평가·모의고사'],
  [/외부\s*지문/, 'external', '외부 지문'],
];
// '출처가 확인되지 않아…' 같은 정직한 유보 문장은 주장이 아니므로 통과시킨다
const GENERIC_SOURCE_CLAIM = /출처(?!\s*(?:가|는|를)?\s*(?:확인되지|미확인|확인\s*전))/;
// 변형 상태를 말하는 표현 — 말한 상태와 기록된 원문 대조 결과가 맞아야 한다.
// '어형 변형'(문법 용어)·'변형한 선택지'(선지 함정 묘사)는 지문 변형 주장이 아니라 제외한다
const TRANSFORMED_CLAIM = /(?<!어형\s?)(?<!형태\s?)변형(?!(?:한|된|해\s*놓은|하여\s*제시한)?\s*(?:선택지|선지|보기))|재구성|바꿔\s*출제|바뀐\s*지문|새\s*지문|원문과\s*다르/;
const UNCHANGED_CLAIM = /그대로\s*(?:출제|활용|사용|가져|나왔|실)|원문과\s*(?:같|동일)|거의\s*그대로/;
const TRANSFORMED_STATES = new Set(['modified', 'reconstructed', 'new']);
const SCORING_CLAIM = /부분\s*점수|감점|채점\s*기준|만점\s*처리|정답\s*인정|오답\s*처리/;
const STANDARDS_CLAIM = /성취\s*기준/;
const RESPONSE_CLAIM = /정답률|오답률|정답\s*비율|많이\s*틀|자주\s*틀|틀린\s*학생|응답\s*(?:기록|집계)/;

/**
 * 구체적인 문법 항목 — 산문에 나오면 연결 문항의 기록(topic·소견·기술·함정·조건·어휘·구문·세부유형)에
 * 같은 항목이 있어야 한다. detect 는 좁게(오탐 방지), ground 는 넓게(한국어 별칭·영어 표기) 둔다.
 * 시제·어순·문장 구조 같은 일반어는 넣지 않는다 — 학습 조언을 과하게 막지 않기 위해.
 */
const GRAMMAR_ITEMS: Array<{ label: string; detect: string[]; ground: string[] }> = [
  { label: '현재완료', detect: ['현재완료'], ground: ['현재완료', '완료시제', 'havep.p', 'hasp.p', 'havepp', 'haspp'] },
  { label: '과거완료', detect: ['과거완료', '대과거'], ground: ['과거완료', '대과거', 'hadp.p', 'hadpp'] },
  { label: '진행형', detect: ['현재진행', '과거진행', '진행형', '진행시제'], ground: ['진행', 'be-ing', 'being'] },
  { label: 'to부정사', detect: ['to부정사', '부정사'], ground: ['부정사', 'infinitive', 'too~to', 'tooto', 'enoughto', 'inorderto', 'to동사원형', 'to+동사원형'] },
  { label: '동명사', detect: ['동명사'], ground: ['동명사', 'gerund', '-ing'] },
  { label: '분사구문', detect: ['분사구문'], ground: ['분사구문', '분사'] },
  { label: '분사', detect: ['현재분사', '과거분사'], ground: ['분사', 'participle'] },
  { label: '관계사', detect: ['관계대명사', '관계부사', '관계사', '관계절'], ground: ['관계대명사', '관계부사', '관계사', '관계절', '선행사'] },
  { label: '가정법', detect: ['가정법'], ground: ['가정법', 'ifiwere', 'iwish', '가정'] },
  { label: '수동태', detect: ['수동태'], ground: ['수동태', '수동', 'bep.p', 'bepp'] },
  { label: '비교 구문', detect: ['비교급', '최상급', '원급비교', '비교구문'], ground: ['비교급', '최상급', '원급', '비교'] },
  { label: '간접의문문', detect: ['간접의문문'], ground: ['간접의문문', '간접의문', '의문사절'] },
  { label: '도치', detect: ['도치'], ground: ['도치'] },
  { label: '강조 구문', detect: ['강조구문'], ground: ['강조구문', '강조', 'itis~that', 'itwas~that'] },
  { label: '사역동사', detect: ['사역동사'], ground: ['사역'] },
  { label: '지각동사', detect: ['지각동사'], ground: ['지각동사', '지각'] },
  { label: '불규칙 동사', detect: ['불규칙동사', '불규칙변화', '불규칙활용'], ground: ['불규칙'] },
  { label: '수일치', detect: ['수일치'], ground: ['수일치', '주어와동사', '주어동사', '단수', '복수'] },
  { label: '5형식', detect: ['5형식', '목적격보어'], ground: ['5형식', '목적격보어', '목적보어'] },
  // 어휘 항목도 같은 규칙 — 어떤 문항에만 기록된 연어·유의어 등을 묶음 전체의 특징으로 넓히지 않는다
  { label: '연어', detect: ['연어'], ground: ['연어', 'collocation'] },
  { label: '유의어·반의어', detect: ['유의어', '반의어', '동의어'], ground: ['유의어', '반의어', '동의어', '유의', '반의'] },
  { label: '영영풀이', detect: ['영영풀이'], ground: ['영영'] },
  { label: '다의어', detect: ['다의어'], ground: ['다의어', '다의'] },
  { label: '어형 변화', detect: ['어형변화'], ground: ['어형'] },
  // 'too ~ to' 같은 기록된 구문을 '상관 구문'으로 새로 이름 붙이지 못하게 — 기록에 '상관'이나 상관접속사 표기가 있어야 한다
  { label: '상관 구문', detect: ['상관접속사', '상관구문', '상관어구', '상관접속'], ground: ['상관', 'notonly', 'bothaand', 'both~and', 'eitheraor', 'either~or', 'neitheranor', 'neither~nor'] },
];
/**
 * 본문·지문과의 겹침·조합 — '비슷한 형태'(선택지끼리 닮음)와 다른 주장이라 근거를 따로 둔다.
 * '본문 + 낱말'만으로는 어느 쪽 근거도 되지 않는다. 기록된 함정 한 건 안에 관계 자체가 적혀 있어야 한다.
 * - 겹침: 본문·지문(의 표현)과 비슷·겹침·같은 표현이라는 비교, 또는 본문 표현을 그대로 썼다는 기록
 * - 조합: 본문·지문의 낱말을 조합·짜깁기·섞었다는 기록 ('그대로 쓴' 기록은 조합 근거가 아니다)
 */
const PASSAGE_EXPR = '(?:문장|표현|낱말|단어|어구|어휘)';
const PASSAGE_SIMILAR = new RegExp(
  `(?:본문|지문)(?:(?:의\\s*|\\s+)${PASSAGE_EXPR}(?:들)?)?(?:과|와)\\s*(?:형태|모양|${PASSAGE_EXPR})?(?:이|가|만|도|은|는|상)?\\s*(?:비슷|유사|닮|겹|같은\\s*${PASSAGE_EXPR})`
  + `|(?:본문|지문)(?:의|에\\s*(?:나온|있는|쓰인))?\\s*${PASSAGE_EXPR}(?:들)?(?:을|를)\\s*(?:비슷|유사)하게`,
);
const PASSAGE_COPIED = new RegExp(`(?:본문|지문)(?:의|에\\s*(?:나온|있는|쓰인))?\\s*(?:${PASSAGE_EXPR}(?:들)?)?(?:을|를|과|와|이|가)?\\s*(?:그대로|겹)`);
const PASSAGE_COMPOSED = new RegExp(
  `(?:본문|지문)(?:\\s*속)?(?:의|에(?:\\s*(?:나온|있는|쓰인|등장한))?)?\\s*${PASSAGE_EXPR}(?:들)?(?:을|를|의)?\\s*(?:단순히\\s*)?(?:조합|짜깁기|짜집기|모아|이어\\s*붙|섞|엮)`,
);
const PASSAGE_OVERLAP_GROUND = new RegExp(`${PASSAGE_SIMILAR.source}|${PASSAGE_COPIED.source}`);
const PASSAGE_COMPOSITION_GROUND = new RegExp(`${PASSAGE_COMPOSED.source}|(?:본문|지문)[^|]{0,15}?(?:조합|짜깁기|짜집기|섞|엮|이어\\s*붙)`);
/**
 * 함정(선택지) 유형 — 산문이 말한 함정 유형은 연결 문항의 '기록된 함정'에 같은 계열이 있어야 한다.
 * refs 가 있으면 연결한 문항 모두(every)에 그 계열이 있어야 한다. 특징·행동·대표 문항은 문항 하나다.
 * 전역 문단(제목·덱·개요·결론)은 시험의 어느 한 문항 기록에 그 계열이 있으면 된다(기록끼리 이어 붙여 판정하지 않는다).
 * 기록에 없는 유형(예: '일부 내용만 담은 선택지')을 덧붙이는 것을 막는다.
 * '비슷한 형태'는 선택지끼리 닮았다는 기록이다. 비교 대상을 본문·지문으로 바꾸거나 지문 단어를 조합했다는 말은 그 근거가 기록돼 있을 때만 허용한다.
 */
const TRAP_TYPES: Array<{ label: string; detect: RegExp; ground: RegExp; aside?: string }> = [
  { label: '일부 내용만 담은 선택지', detect: /일부\s*(?:내용|정보|사실)만|부분적(?:으로)?\s*(?:맞|일치)/, ground: /일부|부분/ },
  { label: '반대로 진술한 선택지', detect: /정반대|반대(?:로|되는|\s*의미|\s*내용)/, ground: /반대/ },
  { label: '범위를 넓히거나 좁힌 선택지', detect: /범위를?\s*(?:넓|좁|확대|축소)|지나치게\s*(?:넓|좁|일반화)|과도하게\s*일반화/, ground: /범위|넓|좁|일반화/ },
  { label: '본문 표현을 그대로 쓴 선택지', detect: /(?:본문|지문)(?:의|에)?\s*(?:쓰인\s*)?(?:표현|낱말|단어|어구)[을를]?\s*그대로/, ground: /그대로/ },
  { label: '언급되지 않은 정보', detect: /언급되지\s*않은|(?:대화|본문|지문)에\s*(?:없는|나오지\s*않은)\s*(?:정보|내용)|들리지\s*않은/, ground: /없는|언급되지|나오지|들리지/ },
  { label: '세부 정보를 바꾼 선택지', detect: /세부\s*(?:정보|내용|사실)[을를이가]?\s*(?:바꾼|바꾸어|바뀐|변형)/, ground: /세부|바꾸|바꾼|바뀐/ },
  { label: '형태가 비슷한 선택지', detect: /(?:형태|모양|겉모양|겉모습|외형)(?:이|가)?\s*(?:비슷|유사|닮)|(?:비슷|유사)한\s*(?:형태|모양)/, ground: /형태|모양|비슷/ },
  { label: '의미가 비슷한 선택지', detect: /(?:의미|뜻)(?:이|가)?\s*(?:비슷|유사)|(?:비슷|유사)한\s*(?:의미|뜻)/, ground: /의미|뜻|비슷/ },
  {
    label: '본문·지문과 비슷한 선택지',
    // 비교 대상이 본문·지문일 때만. '본문을 읽고 형태가 비슷한 선택지'처럼 본문이 비교 대상이 아닌 문장은 빠진다.
    detect: PASSAGE_SIMILAR,
    ground: PASSAGE_OVERLAP_GROUND,
    aside: "'비슷한 형태'만으로는 비교 대상을 본문·지문과 비슷하다고 바꿀 수 없습니다",
  },
  {
    label: '지문 단어를 조합한 선택지',
    detect: PASSAGE_COMPOSED,
    ground: PASSAGE_COMPOSITION_GROUND,
    aside: "'비슷한 형태'만으로는 지문 단어를 조합했다고 말할 수 없습니다",
  },
];

/**
 * '주어진/제시된 X' — 시험지가 준 재료(낱말·뜻·접속사·표현·조건)는 '작성 조건'에 적힌 것만 말한다.
 * 핵심 어휘·구문 기록에 있다는 이유로 그것을 '주어진 낱말'로 추론하지 않게 한다.
 */
const GIVEN_MATERIAL = /(?:주어진|제시된)\s*(낱말|단어|어휘|제시어|뜻|의미|접속사|연결어|표현|구문|조건|형식|어형)/g;
const GIVEN_GROUND: Record<string, RegExp> = {
  낱말: /낱말|단어|어휘|제시어/, 단어: /낱말|단어|어휘|제시어/, 어휘: /낱말|단어|어휘|제시어/, 제시어: /낱말|단어|어휘|제시어/,
  뜻: /뜻|의미/, 의미: /뜻|의미/,
  접속사: /접속사|연결어/, 연결어: /접속사|연결어/,
  표현: /표현|구문/, 구문: /표현|구문/,
  조건: /./, 형식: /./, 어형: /어형|형태|바꾸/,
};
/** 영어 낱말을 '주어진 것'으로 말하는 표현 — 그 낱말이 작성 조건에 적혀 있어야 한다 */
const GIVEN_ENGLISH = [
  /(?:주어진|제시된)\s*(?:낱말|단어|어휘|접속사|연결어|표현)?\s*(?:인\s*)?([A-Za-z][A-Za-z'’-]*)/g,
  /([A-Za-z][A-Za-z'’-]*)\s*(?:을|를|이|가|와|과|도)?\s*(?:포함한\s*)?(?:주어진|제시된)\s*(?:낱말|단어|어휘|접속사|연결어|표현)/g,
];

/** 비교용 정규화 — 소문자, 공백·가운뎃점 제거 (영어 표기 'have p.p.' → 'havep.p.') */
function compact(s: string): string {
  return s.toLowerCase().replace(/[\s·]+/g, '');
}
/**
 * 문법 항목 탐지 정규식 — 글자 사이 공백을 허용하고, 앞이 한글이면 매치하지 않는다
 * ('하도 치밀하게'의 '도치' 같은 경계 오탐 방지).
 */
const detectCache = new Map<string, RegExp>();
function detectTerm(alias: string): RegExp {
  let re = detectCache.get(alias);
  if (!re) {
    const body = [...alias].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    re = new RegExp(`(?<![가-힣])${body}`, 'i');
    detectCache.set(alias, re);
  }
  return re;
}
const STATS_CLAIM = /평균\s*점수|과목\s*평균|표준\s*편차|응시자|성취도\s*분포/;
const LISTENING_CLAIM = /듣기|리스닝|음성/;
const WRITTEN_CLAIM = /서술형|서답형|영작|주관식|단답형|쓰기\s*문항/;
const MOCK_FRAMING = /내신|본문\s*암기|교과서\s*본문|학교\s*채점/;
/** 직접 쓰거나 고치는 요구 — 서술·단답형만의 요구라 객관식이 섞인 묶음·객관식 대표 문항에는 쓸 수 없다 */
const DIRECT_WRITING_CLAIM = /고쳐\s*쓰|바르게\s*고치|직접\s*(?:고치|고쳐|수정|쓰|써|작성|영작|서술)|(?:오류|틀린\s*(?:곳|부분)|잘못된\s*(?:곳|부분|표현))[을를]?\s*(?:찾아\s*)?(?:바른\s*형태로\s*)?(?:고치|고쳐|수정)|영작하|영작을\s*하/;
/**
 * 영어 낱말을 **답안에 반드시 쓰는 요소**처럼 말하는 표현(낱말 뒤 같은 절 안의 '활용·사용·넣·포함·조합·쓰').
 * 핵심 어휘는 '문항에 나온 낱말'일 뿐이라, 답안 필수 여부는 작성 조건에 그 낱말이 적혀 있어야 말할 수 있다.
 * '쓰임'(용법)은 사용 동사가 아니다.
 */
const REQUIRED_WORD_USE = /^[^.。]{0,25}?(?:활용|사용|넣|포함|조합|써|쓰(?!임))/;
/**
 * 단일 문항 문단에서 여러 문항으로 넓히는 표현 — 시험 요구를 말하는 문단(특징, 대표 문항의 요구·이유)에서만 막는다.
 * '연습 문항'·'이전 문항'·'비슷한 문항을 더 풀어 보기' 같은 학습 조언은 대상이 아니다(행동·prep 은 검사하지 않는다).
 */
const PLURAL_GENERALIZATION = /문항들|여러\s*문항|(?:이런|이러한|이와\s*같은|이\s*유형의|같은\s*유형의|해당\s*유형의)\s*문항/;
/**
 * 쓰기 문항의 **구체적 쓰기 목적·글 종류**(의견, 요약, 편지 등) — 기록(조건·세부유형·기술·소견·단원·연습 제안)에
 * 같은 말이 있어야 한다. '조건 영작'을 '의견을 작성하는 문항'처럼 바꿔 말하는 것을 막는다.
 */
const WRITING_PURPOSES: Array<{ label: string; detect: RegExp; ground: RegExp }> = [
  { label: '의견 쓰기', detect: /의견|자신의\s*생각|주장을?\s*(?:쓰|작성|펼|밝)/, ground: /의견|생각|주장/ },
  { label: '요약하기', detect: /요약/, ground: /요약/ },
  { label: '이유 쓰기', detect: /이유를\s*(?:쓰|작성|서술|밝)/, ground: /이유/ },
  { label: '편지·이메일', detect: /편지|이메일|메일/, ground: /편지|이메일|메일/ },
  { label: '일기', detect: /일기/, ground: /일기/ },
  { label: '광고·안내문', detect: /광고|안내문/, ground: /광고|안내/ },
  { label: '감상문', detect: /감상문|감상을\s*(?:쓰|작성)/, ground: /감상/ },
  { label: '소개글', detect: /소개(?:글|하는\s*글|문)/, ground: /소개/ },
  { label: '대화문 완성', detect: /대화(?:문)?을\s*(?:완성|작성|이어)/, ground: /대화/ },
];
/** '원문' — 원문 대조 근거가 있는 문항에만 (확인하지 못했다는 유보 문장은 제외) */
const ORIGINAL_CLAIM = /원문(?!\s*(?:을|를|과|은|이)?\s*(?:보지|확인하지|대조하지|확인할\s*수\s*없))/;

/** 산문에 섞여도 되는 영어 낱말 — 문법 용어의 일부 (to부정사, -ing, that절, S+V+O 등) */
const GRAMMAR_WORDS = new Set([
  'to', 'ing', 'ed', 'that', 'which', 'who', 'whom', 'whose', 'what', 'when', 'where', 'why', 'how', 'if', 'whether',
  'it', 'there', 'as', 'so', 'than', 'be', 'do', 'does', 'did', 'have', 'has', 'had', 'not', 'only', 'enough', 'too',
  'used', 'would', 'should', 'could', 'might', 'must', 'will', 'can', 'may', 'the', 'a', 'an', 'of', 'for', 'with',
  'by', 'in', 'on', 'at', 'pp', 'ai',
]);
const LATIN_RUN = /[A-Za-z][A-Za-z'’-]*(?:[\s+/]+[A-Za-z][A-Za-z'’-]*)*/g;
const MAX_LATIN_RUN_WORDS = 3;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 한 문항 기록에 실제로 있는 영어 낱말 (어휘·구문·기술·함정·조건·AI 소견) */
export function questionEnglishWords(q: EnglishCommentaryContextQuestion): Set<string> {
  const words = new Set<string>();
  const add = (t: string | null | undefined) => {
    if (!t) return;
    for (const w of t.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []) words.add(w.toLowerCase());
  };
  q.keyVocab.forEach((v) => add(v.word));
  q.keyStructures.forEach((s) => add(s.pattern));
  q.evidence.skills.forEach(add);
  q.evidence.writing_conditions.forEach(add);
  add(q.evidence.distractors);
  add(q.aiComment);
  return words;
}

/** 시험 전체 기록의 영어 낱말 — 전역 문단(제목·덱·개요·결론) 판정용 */
export function recordedEnglishWords(ctx: EnglishCommentaryContext): Set<string> {
  const words = new Set<string>();
  for (const q of ctx.questions) for (const w of questionEnglishWords(q)) words.add(w);
  return words;
}

interface ProseField {
  path: string;
  text: string;
  /** 이 문단이 연결한 문항 — 없으면 시험 전체 기준으로 근거를 판단 */
  refs: string[] | null;
  range: readonly [number, number];
}

function proseFields(r: EnglishCommentaryReport): ProseField[] {
  const out: ProseField[] = [
    { path: 'headline', text: r.headline, refs: null, range: FIELD_LENGTHS.headline },
    { path: 'dek', text: r.dek, refs: null, range: FIELD_LENGTHS.dek },
    { path: 'overview', text: r.overview, refs: null, range: FIELD_LENGTHS.overview },
  ];
  r.features.forEach((f, i) => {
    out.push({ path: `features[${i}].title`, text: f.title, refs: f.refs, range: FIELD_LENGTHS.featureTitle });
    out.push({ path: `features[${i}].body`, text: f.body, refs: f.refs, range: FIELD_LENGTHS.featureBody });
  });
  r.representatives.forEach((p, i) => {
    out.push({ path: `representatives[${i}].demand`, text: p.demand, refs: [p.ref], range: FIELD_LENGTHS.repDemand });
    out.push({ path: `representatives[${i}].reason`, text: p.reason, refs: [p.ref], range: FIELD_LENGTHS.repReason });
    out.push({ path: `representatives[${i}].prep`, text: p.prep, refs: [p.ref], range: FIELD_LENGTHS.repPrep });
  });
  r.actions.forEach((a, i) => {
    out.push({ path: `actions[${i}].title`, text: a.title, refs: a.refs, range: FIELD_LENGTHS.actionTitle });
    out.push({ path: `actions[${i}].body`, text: a.body, refs: a.refs, range: FIELD_LENGTHS.actionBody });
    out.push({ path: `actions[${i}].check`, text: a.check, refs: a.refs, range: FIELD_LENGTHS.actionCheck });
  });
  out.push({ path: 'conclusion', text: r.conclusion, refs: null, range: FIELD_LENGTHS.conclusion });
  return out;
}

function snippet(text: string, m: RegExpMatchArray | null): string {
  if (!m || m.index === undefined) return '';
  return text.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6).trim();
}

/**
 * 산문 검증. **빈 배열이면 통과.**
 * report 는 Zod 모양 검사를 통과한 값이어야 한다(generate 가 보장).
 */
export function validateEnglishCommentaryReport(ctx: EnglishCommentaryContext, report: EnglishCommentaryReport): string[] {
  const errors: string[] = [];
  const byRef = new Map<string, EnglishCommentaryContextQuestion>(ctx.questions.map((q) => [q.ref, q]));
  const candidates = new Set(ctx.candidates);
  const { limits } = ctx;

  // ── 섹션 개수 ──
  const count = (label: string, n: number, range: { min: number; max: number }) => {
    if (n < range.min || n > range.max) errors.push(`${label}: ${range.min}~${range.max}개여야 합니다 (현재 ${n}개)`);
  };
  count('features', report.features.length, limits.features);
  count('representatives', report.representatives.length, limits.representatives);
  count('actions', report.actions.length, limits.actions);

  // ── 참조 ──
  const checkRefs = (path: string, refs: string[], required: boolean) => {
    if (required && refs.length === 0) errors.push(`${path}.refs: 근거 문항 번호를 하나 이상 넣으세요`);
    if (new Set(refs).size !== refs.length) errors.push(`${path}.refs: 같은 문항 번호가 중복됩니다`);
    for (const r of refs) if (!byRef.has(r)) errors.push(`${path}.refs: 시험에 없는 문항 번호입니다 ("${r}") — 문항 기록의 번호를 그대로 쓰세요`);
  };
  report.features.forEach((f, i) => checkRefs(`features[${i}]`, f.refs, true));
  report.actions.forEach((a, i) => checkRefs(`actions[${i}]`, a.refs, true));
  // v1 계약: 특징·행동은 **문항 하나**만 근거로 쓴다(묶음의 범주·어휘·함정 확대를 구조적으로 차단).
  // 시험 전체의 묶음 패턴은 코드 분포표와 전역 개요가 담당한다. 저장 스키마(refs 배열)는 그대로 둔다.
  const singleRef = (label: string, items: Array<{ refs: string[] }>) => {
    items.forEach((it, i) => {
      if (it.refs.length !== 1) errors.push(`${label}[${i}].refs: 문항 하나만 연결하세요 (현재 ${it.refs.length}개) — 시험 전체 경향은 개요에 씁니다`);
    });
    const used = items.map((it) => it.refs[0]).filter((r): r is string => !!r);
    if (new Set(used).size !== used.length) errors.push(`${label}: 서로 다른 문항을 하나씩 연결하세요 — 같은 문항을 두 번 쓰지 않습니다`);
  };
  singleRef('features', report.features);
  singleRef('actions', report.actions);
  const repRefs = report.representatives.map((p) => p.ref);
  if (new Set(repRefs).size !== repRefs.length) errors.push('representatives: 같은 문항을 두 번 고를 수 없습니다');
  report.representatives.forEach((p, i) => {
    if (!byRef.has(p.ref)) errors.push(`representatives[${i}].ref: 시험에 없는 문항 번호입니다 ("${p.ref}")`);
    else if (!candidates.has(p.ref)) errors.push(`representatives[${i}].ref: 대표 문항 후보가 아닙니다 ("${p.ref}") — 후보 목록에서만 고르세요`);
  });

  // ── 근거 판정용 — 연결한 문항 **모두**에 근거가 있어야 한다(every) ──
  const scopeQuestions = (refs: string[] | null): EnglishCommentaryContextQuestion[] =>
    refs ? refs.map((r) => byRef.get(r)).filter((q): q is EnglishCommentaryContextQuestion => !!q) : ctx.questions;
  const allHave = (qs: EnglishCommentaryContextQuestion[], pred: (q: EnglishCommentaryContextQuestion) => boolean) =>
    qs.length > 0 && qs.every(pred);
  // 구체 항목(영어 낱말·문법/어휘 항목·함정 계열·주어진 낱말)은 refs 문단이면 **각 문항 기록마다** 있어야 한다.
  // 전역 문단(제목·덱·개요·결론)은 시험 전체 범위를 소개하므로 시험 전체 기록 기준이다.
  const recorded = recordedEnglishWords(ctx);
  const wordsByRef = new Map(ctx.questions.map((q) => [q.ref, questionEnglishWords(q)]));
  const corpusOf = (q: EnglishCommentaryContextQuestion): string => compact([
    q.topic, q.aiComment, q.subtypeLabel, q.evidence.distractors, q.evidence.next_practice,
    ...q.evidence.skills, ...q.evidence.writing_conditions,
    ...q.keyVocab.flatMap((v) => [v.word, v.meaning]),
    ...q.keyStructures.flatMap((st) => [st.pattern, st.meaning]),
  ].filter((t): t is string => !!t).join('|'));
  const corpusByRef = new Map(ctx.questions.map((q) => [q.ref, corpusOf(q)]));
  const globalCorpus = compact([...ctx.questions.map((q) => corpusByRef.get(q.ref) ?? ''), ...ctx.exam.scopeTopics].join('|'));

  let total = 0;
  for (const f of proseFields(report)) {
    const text = norm(f.text);
    total += text.length;
    const [min, max] = f.range;
    if (text.length < min || text.length > max) errors.push(`${f.path}: ${min}~${max}자로 쓰세요 (현재 ${text.length}자)`);

    const numeric = text.replace(GRAMMAR_NUMBER_TERMS, '');
    if (DIGIT.test(numeric)) {
      errors.push(`${f.path}: 숫자는 쓰지 마세요 — 문항 번호는 refs 로, 개수·배점·비율은 화면 표가 보여 줍니다 ("${snippet(numeric, numeric.match(DIGIT))}")`);
    }
    if (CIRCLED.test(text)) errors.push(`${f.path}: 선지 번호(①②…)는 쓰지 마세요 — 선지 원문은 기록에 없습니다`);
    const kc = text.match(KOREAN_COUNT);
    if (kc) errors.push(`${f.path}: 개수 표현은 쓰지 마세요 ("${snippet(text, kc)}")`);
    const qw = text.match(QUANTITY_WORDS);
    if (qw) errors.push(`${f.path}: 비율·양 표현은 쓰지 마세요 ("${qw[0]}")`);

    for (const [re, msg] of ALWAYS_FORBIDDEN) if (re.test(text)) errors.push(`${f.path}: ${msg}`);

    const scope = scopeQuestions(f.refs);
    const where = f.refs ? '연결한 문항 모두' : '시험의 모든 문항';
    const regroup = f.refs ? ' — 근거가 있는 문항만 따로 묶으세요' : ' — 근거가 있는 문항을 refs 로 연결한 문단에서만 쓰세요';

    const kinds = SOURCE_KIND_CLAIMS.filter(([re]) => re.test(text));
    if (kinds.length || GENERIC_SOURCE_CLAIM.test(text)) {
      if (!allHave(scope, (q) => q.sourceLabel !== '미확인')) {
        errors.push(`${f.path}: 출처는 ${where}에 확인된 출처가 있을 때만 쓸 수 있습니다${regroup}`);
      } else if (kinds.length) {
        const said = new Set(kinds.map(([, k]) => k));
        const mismatch = scope.some((q) => !said.has(q.evidence.source.kind));
        const unsupported = kinds.some(([, k]) => !scope.some((q) => q.evidence.source.kind === k));
        if (mismatch || unsupported) {
          errors.push(`${f.path}: 말한 출처 종류(${kinds.map(([, , l]) => l).join('·')})가 연결 문항의 확인된 출처 종류와 맞지 않습니다`);
        }
      }
    }
    if (TRANSFORMED_CLAIM.test(text)
      && !allHave(scope, (q) => !!q.evidence.transformation_evidence && TRANSFORMED_STATES.has(q.evidence.transformation))) {
      errors.push(`${f.path}: 변형·재구성은 ${where}에 원문 대조 근거(일부 변형·재구성·새 지문)가 있을 때만 쓸 수 있습니다${regroup}`);
    }
    if (UNCHANGED_CLAIM.test(text)
      && !allHave(scope, (q) => !!q.evidence.transformation_evidence && q.evidence.transformation === 'unchanged')) {
      errors.push(`${f.path}: '그대로 출제'는 ${where}에 원문 대조 근거(거의 그대로)가 있을 때만 쓸 수 있습니다${regroup}`);
    }
    if (SCORING_CLAIM.test(text) && !allHave(scope, (q) => !!q.evidence.scoring_source)) {
      errors.push(`${f.path}: 부분 점수·감점·채점 기준은 ${where}에 채점 근거가 있을 때만 쓸 수 있습니다${regroup}`);
    }
    if (STANDARDS_CLAIM.test(text) && !allHave(scope, (q) => q.evidence.achievement_standards.length > 0)) {
      errors.push(`${f.path}: 성취기준은 ${where}에 근거가 있을 때만 쓸 수 있습니다${regroup}`);
    }
    if (RESPONSE_CLAIM.test(text) && !allHave(scope, (q) => !!q.evidence.observation)) {
      errors.push(`${f.path}: 정답률·오답·응답 기록은 ${where}에 응답 기록이 있을 때만 쓸 수 있습니다${regroup}`);
    }
    if (ORIGINAL_CLAIM.test(text) && !allHave(scope, (q) => !!q.evidence.transformation_evidence)) {
      errors.push(`${f.path}: '원문'은 ${where}에 원문 대조 근거가 있을 때만 쓸 수 있습니다${regroup}`);
    }
    // 직접 쓰기·고치기 요구 — 시험의 요구를 말하는 문단(특징, 대표 문항의 요구·이유)은 연결 문항 모두가 서술·단답형이어야 한다.
    // 대표 문항의 prep·학습 행동은 연습 제안이라 '고쳐 쓰는 연습'을 권할 수 있다
    if ((f.path.startsWith('features') || /^representatives\[\d+\]\.(?:demand|reason)$/.test(f.path))
      && DIRECT_WRITING_CLAIM.test(text) && !allHave(scope, (q) => q.format !== 'objective')) {
      errors.push(`${f.path}: 직접 쓰거나 고치는 요구는 연결한 문항 모두가 서술·단답형일 때만 쓸 수 있습니다 — 객관식은 '고르는' 요구로 쓰세요`);
    }
    if ((f.path.startsWith('features') || /^representatives\[\d+\]\.(?:demand|reason)$/.test(f.path)) && PLURAL_GENERALIZATION.test(text)) {
      errors.push(`${f.path}: 연결한 문항 하나에 대해서만 쓰세요 — '여러 문항·이런 문항들' 같은 일반화는 개요에서만 합니다`);
    }
    // 쓰기 목적·글 종류 — 시험 요구 문단에서 쓰기 문항에 대해 말할 때만, 연결된 쓰기 문항 모두의 기록에 같은 말이 있어야 한다
    if (f.path.startsWith('features') || /^representatives\[\d+\]\.(?:demand|reason)$/.test(f.path)) {
      const written = scope.filter((q) => q.format !== 'objective');
      if (written.length) {
        const recordOf = (q: EnglishCommentaryContextQuestion) => [
          ...q.evidence.writing_conditions, ...q.evidence.subquestions.flatMap((p) => p.conditions),
          q.subtypeLabel, q.topic, q.aiComment, q.evidence.next_practice, ...q.evidence.skills,
        ].filter(Boolean).join(' | ');
        for (const purpose of WRITING_PURPOSES) {
          if (purpose.detect.test(text) && !written.every((q) => purpose.ground.test(recordOf(q)))) {
            errors.push(`${f.path}: '${purpose.label}'은(는) 연결한 쓰기 문항의 기록(조건·세부 유형)에 없는 쓰기 목적입니다 — 기록된 조건대로 쓰세요`);
          }
        }
      }
    }
    // 답안 필수 낱말 — 시험 요구 문단(특징, 대표 문항의 요구·이유)에서 쓰기 문항의 답안 요소로 영어 낱말을 지정하면
    // 그 낱말이 연결된 쓰기 문항 모두의 작성 조건에 있어야 한다. prep·행동의 연습 제안은 제외한다.
    if (f.path.startsWith('features') || /^representatives\[\d+\]\.(?:demand|reason)$/.test(f.path)) {
      const writtenRefs = scope.filter((q) => q.format !== 'objective');
      if (writtenRefs.length) {
        for (const m of text.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
          const word = m[0].toLowerCase();
          if (word.length <= 1 || GRAMMAR_WORDS.has(word)) continue;
          if (!REQUIRED_WORD_USE.test(text.slice((m.index ?? 0) + m[0].length))) continue;
          if (!writtenRefs.every((q) => [...q.evidence.writing_conditions, ...q.evidence.subquestions.flatMap((p) => p.conditions)].join(' | ').toLowerCase().includes(word))) {
            errors.push(`${f.path}: '${m[0]}'을(를) 답안에 써야 하는 요소로 말할 근거가 작성 조건에 없습니다 — 핵심 어휘는 문항에 나온 낱말일 뿐입니다`);
          }
        }
      }
    }
    // 함정 유형 — refs 문단은 각 문항의 기록된 함정에, 전역 문단은 시험 전체 기록에 같은 계열이 있어야 한다
    for (const trap of TRAP_TYPES) {
      if (!trap.detect.test(text)) continue;
      // 근거는 기록 한 건 안에서 찾는다 — 전역 문단도 문항 기록을 이어 붙이지 않는다(서로 다른 문항의 '본문'과 '비슷'이 합쳐지지 않게)
      const hasTrap = (q: EnglishCommentaryContextQuestion) => trap.ground.test(q.evidence.distractors ?? '');
      const ok = f.refs ? allHave(scope, hasTrap) : ctx.questions.some(hasTrap);
      if (!ok) {
        const where = f.refs ? '연결한 문항 모두' : '시험';
        const tail = trap.aside
          ? `${trap.aside} — 그 근거가 기록된 함정에 있을 때만 쓰세요`
          : '그 함정이 기록된 문항만 따로 묶으세요';
        errors.push(`${f.path}: '${trap.label}'은(는) ${where}의 기록된 함정이 아닙니다 — ${tail}`);
      }
    }
    // 주어진 재료 — 문단은 연결한 모든 문항에, 전역 문단은 적어도 한 문항에 같은 작성 조건이 있어야 한다
    const conditionsOf = (q: EnglishCommentaryContextQuestion) =>
      [...q.evidence.writing_conditions, ...q.evidence.subquestions.flatMap((p) => p.conditions)].join(' | ');
    for (const m of text.matchAll(GIVEN_MATERIAL)) {
      const ground = GIVEN_GROUND[m[1]];
      const ok = f.refs ? allHave(scope, (q) => ground.test(conditionsOf(q))) : scope.some((q) => ground.test(conditionsOf(q)));
      if (!ok) errors.push(`${f.path}: '${m[0]}'은(는) ${f.refs ? '연결한 문항 모두' : '시험의 어느 문항'}의 작성 조건에 없습니다 — 핵심 어휘·구문을 주어진 재료로 추론하지 마세요`);
    }
    for (const re of GIVEN_ENGLISH) {
      for (const m of text.matchAll(re)) {
        const word = m[1].toLowerCase();
        const has = (q: EnglishCommentaryContextQuestion) => conditionsOf(q).toLowerCase().includes(word);
        if (!(f.refs ? allHave(scope, has) : scope.some(has))) {
          errors.push(`${f.path}: '${m[1]}'을(를) 주어진 낱말로 말할 근거가 작성 조건에 없습니다`);
        }
      }
    }
    for (const item of GRAMMAR_ITEMS) {
      if (!item.detect.some((d) => detectTerm(d).test(text))) continue;
      const grounded = (c: string) => item.ground.some((g) => c.includes(compact(g)));
      const ok = f.refs ? allHave(scope, (q) => grounded(corpusByRef.get(q.ref) ?? '')) : grounded(globalCorpus);
      if (!ok) {
        errors.push(`${f.path}: '${item.label}'은(는) ${f.refs ? '연결한 문항 모두의 기록에 있는 항목이 아닙니다 — 그 항목이 기록된 문항만 따로 묶으세요' : '시험 기록에 없는 항목입니다 — 기록된 기술·구문만 쓰세요'}`);
      }
    }
    if (STATS_CLAIM.test(text) && !ctx.examStats) errors.push(`${f.path}: 학교 공지 성적 지표가 없어 평균·응시자 등을 쓸 수 없습니다`);
    if (LISTENING_CLAIM.test(text) && !ctx.flags.hasListening) errors.push(`${f.path}: 이 시험에는 듣기 문항이 없습니다`);
    if (WRITTEN_CLAIM.test(text) && !ctx.flags.hasWrittenResponse) errors.push(`${f.path}: 이 시험에는 서술·단답형 문항이 없습니다`);
    if (ctx.exam.isMock && MOCK_FRAMING.test(text)) errors.push(`${f.path}: 학력평가·모의고사에는 내신·교과서 본문 암기 표현을 쓰지 않습니다`);

    for (const m of text.match(LATIN_RUN) ?? []) {
      const words = m.split(/[\s+/]+/).filter(Boolean);
      if (words.length > MAX_LATIN_RUN_WORDS) {
        errors.push(`${f.path}: 영어 문장·구절을 인용하지 마세요 ("${m.slice(0, 40)}") — 기록된 표현은 화면이 따로 보여 줍니다`);
        continue;
      }
      const unknown = words.filter((w) => {
        const lw = w.toLowerCase().replace(/^[-'’]+|[-'’]+$/g, '');
        if (lw.length <= 1 || GRAMMAR_WORDS.has(lw)) return false;
        return f.refs ? !allHave(scope, (q) => wordsByRef.get(q.ref)?.has(lw) ?? false) : !recorded.has(lw);
      });
      if (unknown.length) {
        errors.push(`${f.path}: ${f.refs ? '연결한 문항 모두의' : '문항'} 기록에 있는 영어 표현이 아닙니다 ("${unknown.join(' ')}") — 그 표현이 기록된 문항만 따로 묶고, 원문을 본 것처럼 쓰지 마세요`);
      }
    }
  }

  const minTotal = ctx.evidence.scope === 'structure' ? TOTAL_LENGTH.minStructure : TOTAL_LENGTH.min;
  if (total < minTotal) errors.push(`전체 분량이 너무 짧습니다 (${total}자, 최소 ${minTotal}자)`);
  if (total > TOTAL_LENGTH.max) errors.push(`전체 분량이 너무 깁니다 (${total}자, 최대 ${TOTAL_LENGTH.max}자)`);

  return [...new Set(errors)];
}
