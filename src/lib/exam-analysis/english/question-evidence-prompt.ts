import { readEnglishQuestionAnalysis, SOURCE_LABELS, SUBTYPE_LABELS, THINKING_LABELS } from './question-evidence';

export function englishEvidencePrompt(examCategory: string | null | undefined): string {
  const mode = examCategory === 'MOCK'
    ? '학력평가·모의고사: 교과서 암기나 학교 채점 방식을 전제하지 않는다. 듣기 전용 문항이 있으면 포함한다. 외부 응시자 통계를 학교 학생의 통계로 대체하지 않는다.'
    : '학교 내신: 교과서·부교재·프린트·모의고사 지문 등 실제 범위와 서술형 조건을 확인한다. 학교별 비중이나 출제 경향은 한 시험으로 일반화하지 않는다.';
  return `## 영어 문항별 근거 기록 (필수)
${mode}
각 questions 항목에 english_analysis 객체를 추가한다. 원문 대조 자료·집단 응답 통계·학교 평가계획은 확인되지 않은 상태다.
개별 학생 답안이 있더라도 그 답안을 집단 오답률로 일반화하지 않는다. 채점 조건은 시험지에 명시된 내용만 옮긴다.
시험지에 적힌 사실과 문항을 보고 판단한 내용을 구분하며 모르는 값은 null 또는 빈 배열이다.
기본 구조:
${JSON.stringify(readEnglishQuestionAnalysis(null), null, 2)}

- source.kind: ${JSON.stringify(SOURCE_LABELS)}. 시험지에 출처가 명시된 경우에만 종류·교재명(title)·단원/회차/쪽(location)·인쇄된 근거(evidence)를 기록하고 verification=printed. 출제범위에 있는 교과서라는 이유만으로 개별 문항 출처를 단정하지 않는다. 그 외 unknown/unverified.
- transformation=unknown, transformation_evidence=null. 원문을 제공받지 않았으므로 변형·동일 여부를 추정하지 않는다.
- passage_id: 같은 시험지 안에서 동일 지문을 공유하는 문항끼리 같은 짧은 식별자를 사용. 불명확하면 null.
- subtype: ${JSON.stringify(SUBTYPE_LABELS)} 중 한 키. question_type(큰 영역)과 구분한다.
- skills: 해당 문항에서 확인할 지식·기술 1~4개. 예: 수일치, 선행사 확인, 연결어와 논리 흐름. 없는 내용을 만들지 않는다.
- thinking: ${JSON.stringify(THINKING_LABELS)} 중 요구 사고 하나.
- distractors: 선지에서 확인되는 혼동 지점. 실제 학생이 틀렸다고 표현하지 않는다.
- writing_conditions: 시험지에 명시된 사용 단어·어형 변경·어순·문장 수·단어 수 조건. 조건 자체가 없으면 빈 배열.
- accepted_answers/scoring_criteria: 시험지에 정답 인정 범위·부분점수·감점이 인쇄된 경우만 옮겨 적고 scoring_source에 해당 페이지·인쇄 문구를 기록. 일반적인 채점 관행을 채워 넣지 않는다.
- achievement_standards=[], standards_source=null: 공식 평가계획과 성취기준 코드가 없으므로 추측하지 않는다.
- next_practice: 문항 기술과 연결한 구체적 연습 한 가지. 특정 학생의 약점·실제 오답을 단정하지 않는다.
- subquestions: (1)(2) 등 소문항의 label, points, conditions, scoring_criteria 보존. 큰 문항은 questions에서 한 번만 세며 부모 배점은 소문항 배점을 포함한다. 부모와 소문항을 중복 합산하지 않는다. 배점이 불명확하면 null.
- observation=null: 실제 응답 인원·오답 인원을 생성하지 않는다.
- 난도는 AI 추정이다. 정답률·변별력·예상 등급컷을 수치로 지어내지 않는다. 문항 형식이나 순번만으로 난도를 정하지 않는다.`;
}
