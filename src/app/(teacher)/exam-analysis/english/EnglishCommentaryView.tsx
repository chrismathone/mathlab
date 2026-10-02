import type { EnglishCommentaryDocument, EnglishCommentaryGroup, EnglishCommentaryContextQuestion } from '@/lib/exam-analysis/english/commentary/schema';
import { themeClassName } from '@/lib/exam-analysis/commentary-themes';
import { formatPoints } from '@/lib/exam-analysis/shared/points';
import styles from './EnglishCommentary.module.css';

const numberLabel = (ref: string) => /번$/.test(ref) ? ref : `${ref}번`;
const pts = (value: number | null) => value == null ? '배점 미확인' : `${formatPoints(value)}점`;
const attrs = (id: string, summary: string) => ({ 'data-block-id': `english-${id}`, 'data-block-summary': summary });
const basis = { teacher: '교사 판단 난도', ai: 'AI 추정 난도', unknown: '난도 미확인' };

function Refs({ refs }: { refs: string[] }) {
  return <div className={styles.refs}>근거 문항 {refs.map(ref => <span className={styles.ref} key={ref}>{numberLabel(ref)}</span>)}</div>;
}

function Distribution({ rows, total, denominator }: { rows: EnglishCommentaryGroup[]; total: number; denominator: number | null }) {
  return <>
    <table className={styles.table}>
      <thead><tr><th scope="col">분류</th><th scope="col">문항 수</th><th scope="col">배점</th></tr></thead>
      <tbody>{rows.filter(row => row.count > 0).map(row => <tr key={row.label}>
        <td>{row.label}</td><td>{row.count} / {total}</td><td>{row.pointsComplete ? pts(row.points) : '미확인 포함'}</td>
      </tr>)}</tbody>
    </table>
    <p className={styles.note}>문항 수는 대문항 기준입니다.{denominator != null ? ` 배점 기준: ${formatPoints(denominator)}점.` : ' 전체 배점 기준은 미확인입니다.'}</p>
  </>;
}

function RecordedEvidence({ q }: { q: EnglishCommentaryContextQuestion }) {
  const e = q.evidence;
  const verified = e.source.verification !== 'unverified' && e.source.kind !== 'unknown';
  const transformed = e.transformation !== 'unknown' && e.transformation_evidence;
  if (!e.skills.length && !e.distractors && !verified && !transformed && !e.observation) return null;
  return <dl className={styles.evidence}>
    {e.skills.length > 0 && <><dt>확인할 지식·기술</dt><dd>{e.skills.join(', ')}</dd></>}
    {e.distractors && <><dt>분석에 기록된 주의점</dt><dd>{e.distractors}</dd></>}
    {verified && <><dt>확인된 출처</dt><dd>{q.sourceLabel}{e.source.title ? ` — ${e.source.title}` : ''}{e.source.location ? ` / ${e.source.location}` : ''}<br />{q.verificationLabel}: {e.source.evidence}</dd></>}
    {transformed && <><dt>기록된 원문 대조</dt><dd>{q.transformationLabel}: {e.transformation_evidence}</dd></>}
    {e.observation && <><dt>기록된 응답 집단</dt><dd>{e.observation.group}: 응답 {e.observation.respondents}명 중 오답 {e.observation.incorrect}명<br />출처: {e.observation.source}{e.observation.observed_at ? ` (${e.observation.observed_at})` : ''}</dd></>}
  </dl>;
}

/** 영어 전용 단일 보고서. 코드 사실·산문 모두 생성 당시 스냅샷으로 화면과 캡처를 일치시킨다. */
export function EnglishCommentaryView({ document, themeId = 'brand', stale = false }: {
  document: EnglishCommentaryDocument; themeId?: string; stale?: boolean;
}) {
  const { context: ctx, report } = document;
  const byRef = new Map(ctx.questions.map(q => [q.ref, q]));
  const writing = ctx.questions.filter(q => q.format !== 'objective' && (q.evidence.writing_conditions.length || q.evidence.subquestions.some(s => s.conditions.length)));
  const expressions = ctx.questions.flatMap(q => [
    ...q.keyVocab.map(v => ({ ref: q.ref, en: v.word, meaning: v.meaning })),
    ...q.keyStructures.map(v => ({ ref: q.ref, en: v.pattern, meaning: v.meaning })),
  ]).filter(e => e.en.trim() && e.en.trim().split(/\s+/).length <= 20)
    .filter((item, index, all) => all.findIndex(v => v.en === item.en) === index).slice(0, 3);
  const title = [ctx.exam.schoolName, ctx.exam.grade, ctx.exam.title].filter(Boolean).join(' ');
  return <article className={`v3 ${themeClassName(themeId)} ${styles.report}`} aria-label="영어 시험 총평 보고서"
    data-template-signature={`${themeId}|english-1|${stale ? 'previous' : 'current'}`}>
    <header className={styles.hero} {...attrs('header', `${title}. ${report.dek}`)}>
      <div className={styles.identity}><span>{[ctx.exam.schoolName, ctx.exam.grade].filter(Boolean).join(' ') || '영어 시험 분석'}</span><span>{ctx.evidence.scopeLabel}</span>{stale && <strong>이전 분석 근거 기준</strong>}</div>
      <h1>{report.headline}</h1><p className={styles.dek}>{report.dek}</p>
      <div className={styles.scope}>{ctx.exam.title || '영어 시험'}<br />
        범위: {ctx.exam.scopeTopics.length ? ctx.exam.scopeTopics.join(' / ') : '등록된 범위 없음'}
      </div>
    </header>

    <section className={styles.section} {...attrs('overview', `시험 구성: ${ctx.totals.questionCount}문항. ${report.overview}`)}>
      <h2>시험 구성과 읽는 방향</h2>
      <dl className={styles.totals}><div><dt>전체 문항</dt><dd>{ctx.totals.questionCount}문항</dd></div><div><dt>총 배점</dt><dd>{pts(ctx.totals.pointsDenominator)}</dd></div></dl>
      <p>{report.overview}</p>
      <Distribution rows={ctx.formats} total={ctx.totals.questionCount} denominator={ctx.totals.pointsDenominator} />
    </section>

    <section className={styles.section} {...attrs('types', `세부 유형별 문항 구성. ${ctx.subtypes.map(row => `${row.label} ${row.count}문항`).join(', ')}`)}>
      <h2>어떤 판단을 요구했나</h2>
      <Distribution rows={ctx.subtypes} total={ctx.totals.questionCount} denominator={ctx.totals.pointsDenominator} />
      {ctx.passages.linkedQuestions > 0 && <p className={styles.note}>지문 식별 기록이 있는 {ctx.passages.linkedQuestions}문항에서 {ctx.passages.groups}개의 지문 묶음이 확인됩니다. 시험 전체 지문 수를 뜻하지 않습니다.</p>}
    </section>

    <section className={styles.section} {...attrs('features', report.features.map(f => f.title).join(' / '))}>
      <h2>이번 시험의 핵심 특징</h2>
      {report.features.map((feature, i) => <div className={styles.feature} key={i}>
        <h3>{feature.title}</h3><p>{feature.body}</p><Refs refs={feature.refs} />
      </div>)}
    </section>

    {report.representatives.map(item => {
      const q = byRef.get(item.ref);
      if (!q) return null;
      return <section key={q.ref} className={styles.section} {...attrs(`question-${q.order}`, `${numberLabel(q.ref)} ${q.subtypeLabel || q.typeLabel}. ${item.demand}`)}>
        <div className={styles.item}>
          <aside className={styles.itemMeta}>
            <span className={styles.itemNumber}>{numberLabel(q.ref)}</span>
            <p>{q.formatLabel} / {pts(q.points)}</p><p>{q.subtypeLabel || q.typeLabel}</p>
            {q.thinkingLabel && <p>요구 사고: {q.thinkingLabel}</p>}
            <p>{basis[q.difficultyBasis]}{q.difficulty != null ? ` ${q.difficulty}단계` : ''}</p>
          </aside>
          <div><h2>문항의 요구와 준비 방법</h2><p>{item.demand}</p><p>{item.reason}</p>
            <RecordedEvidence q={q} />
            <div className={styles.practice}><strong>연결해서 연습하기</strong><p>{item.prep}</p></div>
          </div>
        </div>
      </section>;
    })}

    {writing.length > 0 && <section className={styles.section} {...attrs('writing', `답을 쓰는 문항의 조건: ${writing.map(q => numberLabel(q.ref)).join(', ')}`)}>
      <h2>답안을 쓰기 전 확인할 조건</h2>
      {writing.map(q => <div className={styles.feature} key={q.ref}>
        <h3>{numberLabel(q.ref)} · {q.formatLabel} · {pts(q.points)}</h3>
        <ul className={styles.conditions}>{q.evidence.writing_conditions.map((condition, i) => <li key={i}>{condition}</li>)}
          {q.evidence.subquestions.flatMap(part => part.conditions.map((condition, i) => <li key={`${part.label}-${i}`}>{part.label}: {condition}</li>))}</ul>
        {q.evidence.scoring_source && q.evidence.scoring_criteria && <p className={styles.note}>기록된 채점 기준: {q.evidence.scoring_criteria}<br />출처: {q.evidence.scoring_source}</p>}
        {q.evidence.scoring_source && q.evidence.subquestions.filter(part => part.scoring_criteria).map(part => <p key={part.label} className={styles.note}>{part.label} 채점 기준: {part.scoring_criteria} (출처: {q.evidence.scoring_source})</p>)}
      </div>)}
    </section>}

    {expressions.length > 0 && <section className={styles.section} {...attrs('expressions', `분석에 기록된 표현: ${expressions.map(item => item.en).join(', ')}`)}>
      <h2>분석에 기록된 표현</h2>
      {expressions.map(item => <div className={styles.feature} key={item.en}>
        <p className={styles.expression} lang="en">{item.en}</p>
        <p className={styles.note}>{numberLabel(item.ref)}{item.meaning ? ` — ${item.meaning}` : ''}</p>
      </div>)}
    </section>}

    {report.actions.length > 0 && <section className={styles.section} {...attrs('actions', report.actions.map(action => action.title).join(' / '))}>
      <h2>우선순위별 학습 행동</h2>
      {report.actions.map((action, i) => <div className={styles.action} key={i}>
        <p className={styles.eyeline}>우선순위 {i + 1}</p><h3>{action.title}</h3><p>{action.body}</p>
        <div className={styles.practice}><strong>스스로 확인할 기준</strong><p>{action.check}</p></div><Refs refs={action.refs} />
      </div>)}
    </section>}

    <section className={styles.section} {...attrs('evidence', `출처 확인 ${ctx.evidence.verifiedSources} / ${ctx.totals.questionCount}문항. 난도는 AI 추정과 교사 판단을 구분합니다.`)}>
      <h2>출처와 난도 판단의 범위</h2>
      <Distribution rows={ctx.sources} total={ctx.totals.questionCount} denominator={ctx.totals.pointsDenominator} />
      <table className={styles.table}><thead><tr><th scope="col">난도 단계</th><th scope="col">문항 수</th></tr></thead>
        <tbody>{ctx.difficulty.counts.map((count, i) => <tr key={i}><td>{i + 1}단계</td><td>{count}문항</td></tr>)}
          {ctx.difficulty.unknown > 0 && <tr><td>미확인</td><td>{ctx.difficulty.unknown}문항</td></tr>}
        </tbody></table>
      <p className={styles.note}>AI 추정 {ctx.difficulty.ai}문항 / 교사 판단 {ctx.difficulty.teacher}문항. 난도는 문항의 요구를 해석한 값입니다.</p>
      {ctx.examStats?.source && <p className={styles.note}>학교 공지 자료: {ctx.examStats.source}
        {ctx.examStats.subjectAverage != null && ` / 과목 평균 ${formatPoints(ctx.examStats.subjectAverage)}점`}
        {ctx.examStats.examinees != null && ` / 응시 ${ctx.examStats.examinees}명`}</p>}
    </section>

    <section className={styles.closing} {...attrs('conclusion', report.conclusion)}><h2>다음 학습을 위한 제안</h2><p>{report.conclusion}</p></section>
    <footer className={styles.footnote} {...attrs('scope', `분석 근거 범위: ${ctx.evidence.scopeLabel}. 생성 당시 문항 기록을 기준으로 작성했습니다.`)}>
      <h2>이 총평의 근거</h2><ul>
        <li>생성 당시 문항 기록을 기준으로 작성했습니다. 지문·선지 원문을 다시 대조한 보고서는 아닙니다.</li>
        <li>상세 근거 {ctx.evidence.detailed}문항, 교사 검토 {ctx.evidence.reviewed}문항, 출처 확인 {ctx.evidence.verifiedSources}문항입니다.</li>
        <li>학습 제안은 문항의 요구에 따른 대비 방법입니다. 특정 학생의 실력을 진단하지 않습니다.</li>
        <li>작성일: {document.generatedAt.slice(0, 10)}{stale ? ' · 이후 분석 근거가 변경되어 갱신이 필요합니다.' : ''}</li>
      </ul>
    </footer>
  </article>;
}
