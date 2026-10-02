/**
 * 영어 총평 컨텍스트 — 시험지 + 최신 분석에서 **코드가 확정한 사실**만 모은 스냅샷.
 * 클라이언트 안전(순수 함수). 화면은 이 함수로 현재 컨텍스트를 만들어 서명을 비교한다.
 *
 * 원칙
 * - AI 는 여기 있는 사실을 해설할 뿐, 숫자·구조 필드는 화면이 이 객체에서 직접 그린다.
 * - 미확인은 미확인으로 남긴다(배점 null 을 0으로, 출처 미확인을 교과서로 바꾸지 않는다).
 * - 채점 근거(scoring_source)·성취기준 근거(standards_source) 없는 채점·성취기준 기록은 스냅샷에 싣지 않는다.
 * - 수학 헬퍼 중 영어에 의미가 다른 것(가중 평균·킬러 비중·변별력)은 쓰지 않는다.
 */
import { checkAnalysisReadiness, readCompleteness } from '../../readiness';
import { roundPoints, sumPoints } from '../../shared/points';
import { FORMAT_LABELS, resolveQuestionFormat } from '../../shared/question-format';
import { countByLevel, questionLevel } from '../../shared/difficulty';
import { readExamRound } from '../../shared/exam-round';
import { hasAnyExamStats, readExamStats } from '../../shared/exam-stats';
import {
  abilityDomainLabel, normalizeAbilityDomain, normalizeQuestionType, questionTypeLabel,
} from '../../shared/subject';
import {
  buildEnglishEvidenceBreakdown, readEnglishQuestionAnalysis, SOURCE_LABELS, SUBTYPE_LABELS,
  THINKING_LABELS, TRANSFORMATION_LABELS, VERIFICATION_LABELS, type EnglishQuestionAnalysis,
} from '../question-evidence';
import { validateEnglishSubquestionPoints } from '../question-evidence-schema';
import type { AnalyzedQuestion } from '../../types';
import {
  EVIDENCE_SCOPE_LABELS, QUESTION_FORMAT_KEYS,
  type EnglishCommentaryContext, type EnglishCommentaryContextQuestion, type EnglishCommentaryGroup,
} from './schema';

/** 컨텍스트 입력 — ExamPaper 와 최신 ExamAnalysis 의 필요한 열만. Json 열은 unknown 그대로 받는다. */
export interface EnglishCommentaryInput {
  examPaper: {
    id: string;
    title?: string | null;
    schoolName?: string | null;
    grade?: string | null;
    /** ExamPaper.category (자유 문자열) — examScope.examCategory 가 없을 때만 참고 */
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

/** 소형 시험 — 핵심 특징 상한을 3으로 줄인다 */
export const SMALL_EXAM_MAX_QUESTIONS = 12;
/** 대표 문항 후보 최대 수 */
export const MAX_REPRESENTATIVE_CANDIDATES = 8;
export const MAX_ACTIONS = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
function validPoints(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? roundPoints(v) : null;
}

interface NormalizedQuestion {
  /** buildEnglishEvidenceBreakdown 등 공용 헬퍼에 그대로 넘길 수 있는 모양 */
  source: AnalyzedQuestion;
  ctx: EnglishCommentaryContextQuestion;
}

/** 채점·성취기준 근거가 없는 기록은 싣지 않는다 — 출처 없는 채점 주장을 원천 차단 */
function sanitizeEvidence(raw: unknown): EnglishQuestionAnalysis {
  const e = readEnglishQuestionAnalysis(raw);
  if (!e.scoring_source) {
    e.accepted_answers = null;
    e.scoring_criteria = null;
    e.subquestions = e.subquestions.map((p) => ({ ...p, scoring_criteria: null }));
  }
  if (!e.standards_source) e.achievement_standards = [];
  return e;
}

function readList<T>(raw: unknown, pick: (o: Record<string, unknown>) => T | null, max = 12): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const v = pick(item);
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeQuestions(raw: unknown): NormalizedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedQuestion[] = [];
  raw.forEach((item) => {
    if (!isPlainObject(item)) return;
    const num = item.question_number;
    if (typeof num !== 'string' && typeof num !== 'number') return;
    const ref = String(num).trim();
    if (!ref) return;

    const evidence = sanitizeEvidence(item.english_analysis);
    const format = resolveQuestionFormat(item);
    const type = normalizeQuestionType('ENGLISH', item.question_type);
    const ability = normalizeAbilityDomain('ENGLISH', item.ability_domain, type);
    const points = validPoints(item.points);
    const level = questionLevel(item.difficulty);
    const teacherJudged = !!item.difficulty_reviewed || (item.ai_difficulty !== undefined && item.ai_difficulty !== null);
    const rawComment = cleanText(item.ai_comment, 500);
    const review = isPlainObject(item.english_analysis_review) ? item.english_analysis_review : null;
    const hasDetail = !!evidence.subtype
      && (evidence.skills.length > 0 || !!evidence.distractors || evidence.writing_conditions.length > 0);
    const sourceVerified = evidence.source.verification !== 'unverified' && evidence.source.kind !== 'unknown';

    const ctx: EnglishCommentaryContextQuestion = {
      ref,
      order: out.length,
      format,
      formatLabel: FORMAT_LABELS[format],
      type,
      typeLabel: type ? questionTypeLabel(type, 'ENGLISH') : '미분류',
      ability,
      abilityLabel: ability ? abilityDomainLabel(ability, 'ENGLISH') : '미분류',
      topic: cleanText(item.topic, 200),
      points,
      difficulty: level,
      difficultyBasis: level === null ? 'unknown' : teacherJudged ? 'teacher' : 'ai',
      // 자동 분석 실패 문항의 ⚠️ 안내문은 근거가 아니다 (shared/question-evidence.ts 와 같은 규칙)
      aiComment: rawComment && !rawComment.startsWith('⚠️') ? rawComment : null,
      keyVocab: readList(item.key_vocab, (o) => {
        const word = cleanText(o.word, 80);
        return word ? { word, meaning: cleanText(o.meaning, 80) } : null;
      }),
      keyStructures: readList(item.key_structures, (o) => {
        const pattern = cleanText(o.pattern, 120);
        return pattern ? { pattern, meaning: cleanText(o.meaning, 80) } : null;
      }),
      evidence,
      evidenceReviewed: !!review && typeof review.reviewed_at === 'string' && typeof review.reviewed_by === 'string',
      hasDetail,
      subtypeLabel: evidence.subtype ? SUBTYPE_LABELS[evidence.subtype] : null,
      thinkingLabel: evidence.thinking ? THINKING_LABELS[evidence.thinking] : null,
      sourceLabel: sourceVerified ? SOURCE_LABELS[evidence.source.kind] : '미확인',
      verificationLabel: VERIFICATION_LABELS[evidence.source.verification],
      transformationLabel: evidence.transformation_evidence ? TRANSFORMATION_LABELS[evidence.transformation] : null,
    };
    const source = {
      ...(item as unknown as AnalyzedQuestion),
      question_number: ref,
      points,
      english_analysis: evidence,
    };
    out.push({ source, ctx });
  });
  return out;
}

/**
 * 그룹 집계 — `buildEnglishEvidenceBreakdown` 과 **같은 분모 규칙**(§12-4):
 * 신고 만점이 있으면 그것, 없으면 전 문항 배점이 확인될 때만 확인 합계. 미확인 배점이 섞인 그룹은 배점 비율 null.
 */
function groupQuestions(
  questions: EnglishCommentaryContextQuestion[],
  keyOf: (q: EnglishCommentaryContextQuestion) => { key: string | null; label: string },
  denominator: number | null,
  order?: readonly string[],
): EnglishCommentaryGroup[] {
  const buckets = new Map<string, { key: string | null; label: string; count: number; pts: number[]; complete: boolean; questions: string[] }>();
  for (const q of questions) {
    const { key, label } = keyOf(q);
    const id = key ?? `__${label}`;
    const b = buckets.get(id) ?? { key, label, count: 0, pts: [], complete: true, questions: [] };
    b.count += 1;
    if (q.points === null) b.complete = false; else b.pts.push(q.points);
    b.questions.push(q.ref);
    buckets.set(id, b);
  }
  const total = questions.length;
  const groups = [...buckets.values()].map((b) => {
    const points = sumPoints(b.pts);
    return {
      key: b.key,
      label: b.label,
      count: b.count,
      points,
      pointsComplete: b.complete,
      countPercent: total ? roundPoints((b.count / total) * 100) : 0,
      pointsPercent: b.complete && denominator !== null && denominator > 0 ? roundPoints((points / denominator) * 100) : null,
      questions: b.questions,
    };
  });
  if (order) {
    const rank = (k: string | null) => { const i = k === null ? -1 : order.indexOf(k); return i < 0 ? order.length : i; };
    return groups.sort((a, b) => rank(a.key) - rank(b.key));
  }
  return groups.sort((a, b) => b.points - a.points || b.count - a.count);
}

function labelKey<T extends Record<string, string>>(labels: T, label: string): string | null {
  const hit = Object.entries(labels).find(([, v]) => v === label);
  return hit ? hit[0] : null;
}

const EXAM_CATEGORIES = ['MIDTERM', 'FINAL', 'MOCK', 'OTHER'] as const;
type ExamCategory = (typeof EXAM_CATEGORIES)[number];
const CATEGORY_FROM_KO: Record<string, ExamCategory> = { 중간: 'MIDTERM', 기말: 'FINAL', 모의: 'MOCK' };

function readExamCategory(examScope: unknown, category: string | null | undefined, categoryKo: string | null): ExamCategory | null {
  const fromScope = isPlainObject(examScope) && typeof examScope.examCategory === 'string'
    ? examScope.examCategory.trim().toUpperCase() : '';
  if ((EXAM_CATEGORIES as readonly string[]).includes(fromScope)) return fromScope as ExamCategory;
  const fromColumn = typeof category === 'string' ? category.trim().toUpperCase() : '';
  if ((EXAM_CATEGORIES as readonly string[]).includes(fromColumn)) return fromColumn as ExamCategory;
  return categoryKo ? CATEGORY_FROM_KO[categoryKo] ?? null : null;
}

/** examScope 는 레거시 string[] 또는 신형 { topics } — 배열 여부부터 확인한다 (§11) */
function readScopeTopics(examScope: unknown): string[] {
  const raw = Array.isArray(examScope)
    ? examScope
    : isPlainObject(examScope) && Array.isArray(examScope.topics) ? examScope.topics : [];
  return [...new Set(raw.map((t) => cleanText(t, 200)).filter((t): t is string => !!t))].slice(0, 30);
}

/**
 * 대표 문항 후보 — 해설 근거(hasDetail)가 있는 문항만.
 * 우선순위: 배점 큰 순 → 서술·단답 → 난도(교사 판단/AI 추정) 높은 순 → 시험지 순서.
 * 세부유형이 겹치지 않게 먼저 한 바퀴 고른 뒤 남는 자리를 채운다.
 */
function pickCandidates(questions: EnglishCommentaryContextQuestion[]): string[] {
  const ranked = questions
    .filter((q) => q.hasDetail)
    .sort((a, b) =>
      (b.points ?? -1) - (a.points ?? -1)
      || Number(b.format !== 'objective') - Number(a.format !== 'objective')
      || (b.difficulty ?? 0) - (a.difficulty ?? 0)
      || a.order - b.order);
  const picked: EnglishCommentaryContextQuestion[] = [];
  const seen = new Set<string>();
  for (const q of ranked) {
    const sub = q.evidence.subtype ?? '';
    if (seen.has(sub)) continue;
    seen.add(sub);
    picked.push(q);
    if (picked.length >= MAX_REPRESENTATIVE_CANDIDATES) break;
  }
  for (const q of ranked) {
    if (picked.length >= MAX_REPRESENTATIVE_CANDIDATES) break;
    if (!picked.includes(q)) picked.push(q);
  }
  return picked.map((q) => q.ref);
}

/** 대표 문항 상한 — min(4, max(2, ceil(문항수/8))), 실제 후보 수를 넘지 않는다 */
export function representativeCap(questionCount: number, candidates: number): number {
  return Math.min(Math.min(4, Math.max(2, Math.ceil(questionCount / 8))), candidates);
}

export function buildEnglishCommentaryContext(input: EnglishCommentaryInput): EnglishCommentaryContext {
  const { examPaper, analysis } = input;
  const normalized = normalizeQuestions(analysis.questions);
  const questions = normalized.map((n) => n.ctx);
  const completeness = readCompleteness(analysis.summary);

  const knownPoints = sumPoints(questions.map((q) => q.points));
  const unknownPointsCount = questions.filter((q) => q.points === null).length;
  const declaredPoints = completeness?.declaredPoints ?? null;
  const pointsDenominator = declaredPoints !== null && declaredPoints > 0
    ? roundPoints(declaredPoints)
    : unknownPointsCount === 0 && knownPoints > 0 ? knownPoints : null;

  // 출처·세부유형 집계는 근거 패널과 같은 함수 하나로 (§12-4)
  const toGroups = (axis: 'source' | 'subtype'): EnglishCommentaryGroup[] => {
    const labels: Record<string, string> = axis === 'source' ? SOURCE_LABELS : SUBTYPE_LABELS;
    return buildEnglishEvidenceBreakdown(normalized.map((n) => n.source), axis, declaredPoints).groups.map((g) => ({
      key: labelKey(labels, g.label),
      label: g.label,
      count: g.count,
      points: g.points,
      pointsComplete: g.pointsComplete,
      countPercent: g.countPercent,
      pointsPercent: g.pointsPercent,
      questions: g.questions,
    }));
  };

  const { counts, unknown } = countByLevel(questions);
  const passageIds = new Set(questions.map((q) => q.evidence.passage_id).filter((p): p is string => !!p));
  const detailed = questions.filter((q) => q.hasDetail).length;
  const reviewed = questions.filter((q) => q.evidenceReviewed || q.evidence.source.verification === 'teacher_verified').length;
  const scope = reviewed > 0 ? 'teacher' : detailed > 0 ? 'evidence' : 'structure';
  const candidates = pickCandidates(questions);
  const repMax = representativeCap(questions.length, candidates.length);
  const featureMax = questions.length <= SMALL_EXAM_MAX_QUESTIONS ? 3 : 5;

  const round = readExamRound({ title: examPaper.title ?? null, examScope: examPaper.examScope });
  const examCategory = readExamCategory(examPaper.examScope, examPaper.category, round.categoryKo);
  const stats = readExamStats(examPaper.examStats);

  return {
    contextVersion: 1,
    analysisId: analysis.id,
    exam: {
      examPaperId: examPaper.id,
      title: cleanText(examPaper.title, 200),
      schoolName: cleanText(examPaper.schoolName, 100),
      grade: cleanText(examPaper.grade, 30),
      year: round.year,
      semester: round.semester,
      categoryKo: round.categoryKo,
      examCategory,
      isMock: examCategory === 'MOCK',
      scopeTopics: readScopeTopics(examPaper.examScope),
    },
    totals: {
      questionCount: questions.length,
      declaredQuestions: completeness?.declaredQuestions ?? null,
      declaredPoints,
      knownPoints,
      unknownPointsCount,
      pointsDenominator,
      completeness: completeness?.status ?? null,
    },
    formats: groupQuestions(
      questions, (q) => ({ key: q.format, label: q.formatLabel }), pointsDenominator, QUESTION_FORMAT_KEYS,
    ),
    types: groupQuestions(questions, (q) => ({ key: q.type, label: q.typeLabel }), pointsDenominator),
    subtypes: toGroups('subtype'),
    sources: toGroups('source'),
    difficulty: {
      counts,
      unknown,
      teacher: questions.filter((q) => q.difficultyBasis === 'teacher').length,
      ai: questions.filter((q) => q.difficultyBasis === 'ai').length,
    },
    passages: {
      groups: passageIds.size,
      linkedQuestions: questions.filter((q) => !!q.evidence.passage_id).length,
    },
    evidence: {
      scope,
      scopeLabel: EVIDENCE_SCOPE_LABELS[scope],
      detailed,
      reviewed,
      verifiedSources: questions.filter((q) => q.sourceLabel !== '미확인').length,
      transformationEvidenced: questions.filter((q) => !!q.evidence.transformation_evidence).length,
      scoringSourced: questions.filter((q) => !!q.evidence.scoring_source).length,
      observed: questions.filter((q) => !!q.evidence.observation).length,
    },
    flags: {
      hasListening: questions.some((q) => q.type === 'listening' || (q.evidence.subtype ?? '').startsWith('listening_')),
      // 직접 답을 쓰는 문항은 **형식**으로만 판정한다 — 영작 유형을 객관식으로 물은 문항은 서술형이 아니다(표시 뷰와 같은 기준)
      hasWrittenResponse: questions.some((q) => q.format !== 'objective'),
      hasWritingConditions: questions.some((q) => q.format !== 'objective'
        && (q.evidence.writing_conditions.length > 0 || q.evidence.subquestions.some((p) => p.conditions.length > 0))),
    },
    candidates,
    limits: {
      features: { min: Math.min(2, Math.max(1, questions.length)), max: featureMax },
      representatives: { min: scope === 'structure' ? 0 : Math.min(2, repMax), max: repMax },
      actions: { min: scope === 'structure' ? 0 : 1, max: MAX_ACTIONS },
    },
    examStats: hasAnyExamStats(stats) ? stats : null,
    questions,
  };
}

export interface EnglishCommentaryReadiness {
  ready: boolean;
  /** 사용자 노출 한국어 사유 */
  reasons: string[];
}

/**
 * 생성 전 차단 — 서버(생성 경로)와 화면이 같은 함수를 쓴다.
 * 기본 분석 readiness(누락·배점 합계·배점 미인식·단원 미분류) + 문항 번호 중복 + 소문항 배점 초과.
 * 출처 미확인·세부 근거 부족은 차단 사유가 **아니다**(구조 중심 보고서로 생성한다).
 */
export function checkEnglishCommentaryReadiness(input: EnglishCommentaryInput): EnglishCommentaryReadiness {
  const normalized = normalizeQuestions(input.analysis.questions);
  if (!normalized.length) return { ready: false, reasons: ['분석된 문항이 없습니다'] };

  const base = checkAnalysisReadiness({
    questions: normalized.map((n) => ({ points: n.ctx.points, topic: n.ctx.topic })),
    totalPoints: input.analysis.totalPoints ?? null,
    summary: input.analysis.summary,
  });
  const reasons = [...base.reasons];

  const counts = new Map<string, number>();
  for (const n of normalized) counts.set(n.ctx.ref, (counts.get(n.ctx.ref) ?? 0) + 1);
  const dup = [...counts.entries()].filter(([, c]) => c > 1).map(([r]) => r);
  if (dup.length) reasons.push(`문항 번호가 중복됩니다 (${dup.join(', ')})`);

  for (const n of normalized) {
    const issue = validateEnglishSubquestionPoints(n.ctx.evidence.subquestions, n.ctx.points);
    if (issue) reasons.push(`문항 ${n.ctx.ref}: ${issue}`);
  }
  return { ready: reasons.length === 0, reasons };
}
