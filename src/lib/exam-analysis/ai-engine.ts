/**
 * 기출 분석 AI 엔진
 * Python Math Report 프로젝트에서 1:1 이식
 * MathLab 기존 gemini.ts 서비스와 완전 독립적으로 동작
 */

import { GoogleGenAI } from '@google/genai';
import type { AnalysisCompleteness, AnalyzedQuestion, BasicAnalysisResult, EnglishKeyStructure, EnglishKeyTerm, ExamPaperClassification } from './types';
import { CONFIDENCE_THRESHOLDS } from './constants';
import type { ExamSubjectKey } from './constants';
import {
  defaultQuestionType,
  normalizeAbilityDomain,
  normalizeQuestionType,
  toExamSubjectKey,
} from './shared/subject';
import { applyNumericField, applyCategoricalRemap, NUMERIC_FIELDS, CATEGORICAL_FIELDS, type CalibrationSet } from './calibration';
import { roundPoints, sumPoints } from './shared/points';
import { callCliVision, isCliExamAnalysisEnabled } from './cli-llm';
import { isEnglishStudyJunk } from './english-study-pack';
import { EXAM_ANALYSIS_MODEL } from './shared/exam-model';
import { isEssay } from './shared/question-format';
import { tallyQuestions } from './shared/summary-tally';

// ── 싱글톤 클라이언트 ──

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다');
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/**
 * 시험지 분석 메인 모델.
 *
 * 2026-08-28: `gemini-3.1-pro-preview` → `gemini-3.7-flash`.
 * ⚠️ pro → flash 는 능력 등급이 내려가는 방향이다. 이 작업(문항 추출·배점 판독·
 *    난이도 2축 판정)은 §12-11 이 기록한 "마지막 서술형이 통째로 사라지는" 실패가
 *    실제로 났던 자리다. 그 방어(assessCompleteness → 재시도 → placeholder →
 *    readiness 차단)는 그대로 살아 있으므로 누락은 차단되지만, **모델을 바꾼 뒤에는
 *    `npm run verify:completeness` 와 실제 시험지 재분석으로 문항 수·배점 합계를
 *    반드시 대조할 것.** 분석 결과의 `modelVersion` 에 이 값이 기록된다.
 */
export const MODEL = EXAM_ANALYSIS_MODEL;

// ── 유틸 함수 ──

/**
 * MIME 타입 추론 (base64 데이터 또는 파일 확장자 기반)
 */
export function getMimeType(input: string): string {
  // data URI prefix 확인
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);/);
    if (match) return match[1];
  }

  // 파일 확장자 기반
  const ext = input.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };

  return mimeMap[ext ?? ''] ?? 'image/png';
}

/**
 * base64 앞머리(매직바이트)로 실제 이미지 형식을 판별한다.
 *
 * 업로드는 png/jpg/webp 를 받는데 분석 라우트가 "pdf 아니면 image/jpeg" 로 **한 값을 고정**해
 * PNG·WEBP 를 JPEG 라고 신고하고 있었다. 여러 장이 섞이면 더 어긋난다 (적대적 리뷰 1.10).
 * 파일 URL 확장자는 서명 URL 쿼리스트링 때문에 믿기 어려워 바이트로 본다.
 */
export function detectMimeFromBase64(input: string): string | null {
  const b64 = input.startsWith('data:') ? input.slice(input.indexOf(',') + 1) : input;
  const head = b64.slice(0, 12);
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('UklGR')) return 'image/webp';   // RIFF
  if (head.startsWith('JVBER')) return 'application/pdf';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  return null;
}

/**
 * base64 데이터에서 data URI prefix 제거
 */
function stripDataUriPrefix(base64: string): string {
  const commaIdx = base64.indexOf(',');
  if (commaIdx !== -1 && base64.startsWith('data:')) {
    return base64.slice(commaIdx + 1);
  }
  return base64;
}

/**
 * 코드펜스·앞뒤 설명 문장을 걷어내고 JSON 객체/배열만 남긴다.
 * CLI 가 "시험지를 읽겠습니다.{...}" 처럼 JSON 앞에 한국어를 붙이는 경우가 있다.
 */
export function isolateJsonPayload(text: string): string {
  let cleaned = text.trim();

  const fence = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) {
    cleaned = fence[1].trim();
  } else if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') lines.pop();
    cleaned = lines.join('\n').trim();
  }

  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);
  if (start < 0) return cleaned;

  const closer = cleaned[start] === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(closer);
  if (end > start) return cleaned.slice(start, end + 1);
  return cleaned.slice(start);
}

/**
 * JSON 응답에서 코드 펜스(```json ... ```) 제거 후 파싱
 */
export function parseJsonResponse<T = unknown>(
  text: string,
  onRepair?: (kind: 'truncated' | 'escape') => void,
): T {
  const cleaned = isolateJsonPayload(text);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // ── 1단계: 잘린 JSON 구조 복구 + trailing comma 제거 + undefined → null ──
    let fixed = cleaned;
    const openQuotes = (fixed.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) fixed += '"';
    const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    for (let i = 0; i < openBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces; i++) fixed += '}';
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    fixed = fixed.replace(/:\s*undefined\b/g, ': null');
    try {
      const parsed = JSON.parse(fixed) as T;
      // 괄호를 자동으로 닫아 살려낸 응답이다 = **뒤가 잘렸다**는 뜻.
      // 호출부가 "완결된 결과"로 오해하고 캐시에 굳히지 않도록 알린다 (적대적 리뷰 1.8).
      onRepair?.('truncated');
      return parsed;
    } catch {
      // ── 2단계: invalid escape character 자동 정정 ──
      // Gemini가 ai_comment 등에 LaTeX(\dfrac, \frac, \(, \) 등)를 JSON 이스케이프 없이 출력하면
      // "Bad escaped character in JSON" 발생. JSON 표준 valid escape는
      //   \" \\ \/ \b \f \n \r \t \uXXXX 만 허용.
      // 그 외의 `\X` 는 `\\X` 로 변환하여 LaTeX 백슬래시를 보존.
      // 또한 string literal 내부 raw control character (raw newline 등)도 escape.
      let fixed2 = fixed.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
      // string literal 안의 raw newline/tab/CR → 이스케이프 (대략적 — string 진입 후 닫히기 전까지)
      fixed2 = fixed2.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, inner: string) => {
        const escaped = inner
          .replace(/\r\n/g, '\\n')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\n')
          .replace(/\t/g, '\\t');
        return `"${escaped}"`;
      });
      try {
        const parsed = JSON.parse(fixed2) as T;
        console.warn('[ai-engine] JSON 파싱: invalid escape 자동 정정 후 성공 (LaTeX 백슬래시 추정)');
        return parsed;
      } catch (e3) {
        throw new Error(
          `AI 응답 JSON 파싱 실패: ${e3 instanceof Error ? e3.message : String(e3)}\n원본: ${text.slice(0, 500)}`
        );
      }
    }
  }
}

/**
 * Node.js 환경에서 파일을 base64로 로드
 */
export async function loadFileAsBase64(filePath: string): Promise<string> {
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(filePath);
  return buffer.toString('base64');
}

// ── Gemini Vision 호출 ──

interface GeminiVisionCallOptions {
  images: string[];          // base64 이미지 데이터 (data URI 또는 순수 base64)
  prompt: string;
  jsonMode?: boolean;        // responseMimeType: 'application/json' 사용 여부
  temperature?: number;
  mimeTypeHint?: string;     // 파일 형식 힌트 (image/jpeg, application/pdf 등)
  modelOverride?: string;    // 모델 ID override (기본: 위 MODEL 상수)
  onProgress?: (msg: string) => void;
  /**
   * 응답 JSON 을 자동 복구해서 살렸을 때 호출된다.
   * 'truncated' = 뒤가 잘려 괄호를 닫아 준 경우 → 결과가 불완전하다는 뜻.
   */
  onRepair?: (kind: 'truncated' | 'escape') => void;
}

/**
 * 비전 호출 공개 엔트리 — 문항 분석·분류·채점마크가 같은 프로바이더를 탄다.
 * modelOverride 가 있으면 (모델 비교 목업) 항상 Gemini 경로.
 * 로컬 CLI 모드에서는 Gemini SDK 를 타지 않는다.
 */
export async function callExamVision<T = unknown>(
  opts: GeminiVisionCallOptions,
): Promise<T> {
  return callGeminiVision<T>(opts);
}

async function callGeminiVision<T = unknown>({
  images,
  prompt,
  jsonMode = true,
  temperature = 0.1,
  mimeTypeHint,
  modelOverride,
  onProgress,
  onRepair,
}: GeminiVisionCallOptions): Promise<T> {
  if (isCliExamAnalysisEnabled() && !modelOverride) {
    onProgress?.('AI 분석 호출 (시험지 읽는 중)');
    const responseText = await callCliVision({ images, prompt, mimeTypeHint, onProgress });
    onProgress?.('AI 응답 수신, JSON 정리 중');
    if (jsonMode) return parseJsonResponse<T>(responseText, onRepair);
    return responseText as unknown as T;
  }

  onProgress?.('AI 분석 호출');
  const client = getClient();

  // 이미지 파트 구성
  const imageParts = images.map((img) => {
    // 힌트가 없으면 이미지 스스로 밝히게 한다 (여러 장이 형식이 섞여도 각자 맞는 값)
    const mimeType = mimeTypeHint || detectMimeFromBase64(img) || getMimeType(img);
    const data = stripDataUriPrefix(img);
    return {
      inlineData: {
        mimeType,
        data,
      },
    };
  });

  // 텍스트 파트
  const textPart = { text: prompt };

  const config: Record<string, unknown> = {
    temperature,
  };

  if (jsonMode) {
    config.responseMimeType = 'application/json';
  }

  const response = await client.models.generateContent({
    model: modelOverride || MODEL,
    contents: [
      {
        role: 'user',
        parts: [...imageParts, textPart],
      },
    ],
    config,
  });

  const responseText = response.text;
  if (!responseText) {
    // errorMessage로 DB 저장 후 사용자 화면에 렌더되는 경로 — 모델명 비노출 규칙(#0)
    throw new Error('AI 응답이 비어있습니다');
  }

  if (jsonMode) {
    return parseJsonResponse<T>(responseText, onRepair);
  }

  return responseText as unknown as T;
}

// ── 배점 검증 및 신뢰도 페널티 ──

/**
 * 배점 신뢰도 판정 결과
 * - reliable: 배점 합계가 기준 범위 내 (±15%)
 * - unreliable: 배점 합계가 기준 범위 밖 (>±15%) 또는 null 배점이 과반
 */
export interface PointsReliability {
  reliable: boolean;
  pointsSum: number;
  expectedTotal: number;
  deviationPct: number;  // 편차 % (양수)
  nullCount: number;     // 배점 null인 문항 수
  reason: string;        // 사유 (한국어)
}

/**
 * 배점 신뢰도 계산
 * ±15% 이내이면 reliable, 아니면 unreliable
 */
export function calcPointsReliability(
  questions: BasicAnalysisResult['questions'],
  expectedTotal: number
): PointsReliability {
  const nullCount = questions.filter((q) => q.points === null || q.points === 0).length;
  const pointsSum = questions.reduce((sum, q) => sum + (q.points ?? 0), 0);
  const total = expectedTotal > 0 ? expectedTotal : 100;
  const deviationPct = total > 0 ? Math.round(Math.abs(pointsSum - total) / total * 100) : 0;

  // null 배점이 전체의 50% 이상
  if (nullCount > questions.length * 0.5) {
    return {
      reliable: false,
      pointsSum,
      expectedTotal: total,
      deviationPct,
      nullCount,
      reason: `${nullCount}개 문항의 배점을 인식하지 못했습니다`,
    };
  }

  // 합계가 ±15% 이상 벗어남
  if (deviationPct > 15) {
    return {
      reliable: false,
      pointsSum,
      expectedTotal: total,
      deviationPct,
      nullCount,
      reason: `배점 합계 ${pointsSum}점 (기준 ${total}점, ${deviationPct}% 차이)`,
    };
  }

  return {
    reliable: true,
    pointsSum,
    expectedTotal: total,
    deviationPct,
    nullCount,
    reason: '',
  };
}

/**
 * 분석 결과의 배점 합계 검증 및 신뢰도 페널티 적용
 */
function validateAndPenalize(result: BasicAnalysisResult): BasicAnalysisResult {
  const { exam_info, questions } = result;

  // 배점이 있는 문항만 합산
  const questionsWithPoints = questions.filter((q) => q.points !== null && q.points > 0);
  const pointsSum = questionsWithPoints.reduce((sum, q) => sum + (q.points ?? 0), 0);

  // 총점과 합산이 다른 경우 신뢰도 페널티 (기준 = AI 신고 만점)
  const declaredPoints = exam_info.declared_total_points ?? null;
  if (declaredPoints !== null && declaredPoints > 0 && pointsSum > 0 && pointsSum !== declaredPoints) {
    const ratio = Math.abs(pointsSum - declaredPoints) / declaredPoints;
    const penalty = Math.min(ratio * 0.3, 0.2); // 최대 20% 페널티

    result.questions = questions.map((q) => ({
      ...q,
      confidence: Math.max(0, Number((q.confidence - penalty).toFixed(3))),
    }));
  }

  // 문항 수 불일치 페널티
  // ⚠️ 반드시 declared_total_questions(AI 신고값)와 비교할 것.
  // exam_info.total_questions 는 emit된 개수라 questions.length 와 항상 같아 검사가 죽는다
  // (2026-07-25 경명여중1 누락이 잡히지 않은 직접 원인).
  const declaredQuestions = exam_info.declared_total_questions ?? null;
  if (declaredQuestions !== null && declaredQuestions > 0 && questions.length !== declaredQuestions) {
    const penalty = 0.1;
    result.questions = result.questions.map((q) => ({
      ...q,
      confidence: Math.max(0, Number((q.confidence - penalty).toFixed(3))),
    }));
  }

  return result;
}

// ── 누락 감지 ──

/**
 * AI 신고값(만점/문항수) 대비 실제 산출물을 대조해 누락 여부를 판정.
 *
 * 판정 불가 조건을 명확히 분리한다:
 *  - AI가 만점/문항수를 신고하지 않음 → 'unverifiable' (오탐 방지: 기준이 없으면 판정하지 않음)
 *  - 배점 미인식(null) 문항 존재 → 합계 부족이 누락 때문인지 판독 실패 때문인지 구분 불가
 *    → 'unverifiable' (별도로 readiness가 "배점 미인식"으로 차단하므로 이중 경고 방지)
 */
export function assessCompleteness(result: BasicAnalysisResult, retried = false): AnalysisCompleteness {
  const { exam_info, questions } = result;
  const declaredQuestions = exam_info.declared_total_questions ?? null;
  const declaredPoints = exam_info.declared_total_points ?? null;
  const emittedQuestions = questions.length;
  const pointsSum = sumPoints(questions.map((q) => q.points));
  const nullPoints = questions.filter((q) => q.points === null || q.points === 0).length;

  const base = {
    declaredQuestions,
    declaredPoints,
    emittedQuestions,
    pointsSum,
    filledQuestions: 0,
    retried,
  };

  if (declaredQuestions === null && declaredPoints === null) {
    return { ...base, status: 'unverifiable', pointsShortfall: 0, reason: 'AI가 만점·문항 수를 판독하지 못해 누락 검증을 하지 못했습니다' };
  }

  const questionShortfall = declaredQuestions !== null && declaredQuestions > emittedQuestions
    ? declaredQuestions - emittedQuestions
    : 0;
  const pointsShortfall = declaredPoints !== null && declaredPoints > 0
    ? roundPoints(declaredPoints - pointsSum)
    : 0;

  // 배점 미인식이 섞여 있으면 점수 부족의 원인을 특정할 수 없다 (문항 수 불일치는 여전히 유효)
  if (questionShortfall === 0 && nullPoints > 0 && pointsShortfall !== 0) {
    return { ...base, status: 'unverifiable', pointsShortfall, reason: `${nullPoints}개 문항의 배점이 미인식이라 누락 여부를 확정할 수 없습니다` };
  }

  if (questionShortfall === 0 && Math.abs(pointsShortfall) < 0.5) {
    return { ...base, status: 'ok', pointsShortfall: 0, reason: '' };
  }

  const parts: string[] = [];
  if (questionShortfall > 0) parts.push(`문항 ${questionShortfall}개 누락 (시험지 ${declaredQuestions}문항 중 ${emittedQuestions}문항만 분석)`);
  if (pointsShortfall > 0) parts.push(`배점 ${roundPoints(pointsShortfall)}점 부족 (만점 ${declaredPoints}점, 분석 합계 ${pointsSum}점)`);
  if (pointsShortfall < 0) parts.push(`배점 ${roundPoints(-pointsShortfall)}점 초과 (만점 ${declaredPoints}점, 분석 합계 ${pointsSum}점)`);

  return { ...base, status: 'incomplete', pointsShortfall, reason: parts.join(' · ') };
}

/** 재분석 결과가 1차보다 나은지 — 완전한 쪽 > 부족분이 적은 쪽 > 문항이 많은 쪽 */
function isBetterPass(next: AnalysisCompleteness, prev: AnalysisCompleteness): boolean {
  const rank = (c: AnalysisCompleteness) => (c.status === 'ok' ? 0 : c.status === 'unverifiable' ? 1 : 2);
  if (rank(next) !== rank(prev)) return rank(next) < rank(prev);
  const gap = (c: AnalysisCompleteness) =>
    Math.abs(c.pointsShortfall) + Math.max(0, (c.declaredQuestions ?? 0) - c.emittedQuestions) * 10;
  if (gap(next) !== gap(prev)) return gap(next) < gap(prev);
  return next.emittedQuestions > prev.emittedQuestions;
}

/** placeholder 가 추가된 뒤 exam_info·summary 를 questions 와 다시 맞춘다. */
function syncSummary(result: BasicAnalysisResult, subject: ExamSubjectKey): BasicAnalysisResult {
  const dist = tallyQuestions(result.questions, subject);
  return {
    ...result,
    exam_info: {
      ...result.exam_info,
      total_questions: result.questions.length,
      format_distribution: dist.format,
    },
    summary: {
      ...result.summary,
      difficulty_distribution: dist.difficulty as unknown as BasicAnalysisResult['summary']['difficulty_distribution'],
      type_distribution: dist.type as unknown as BasicAnalysisResult['summary']['type_distribution'],
      average_difficulty: dist.dominantDifficulty,
      dominant_type: dist.dominantType,
    },
  };
}


/**
 * 문항 번호 갭 자동 보정 (v1.0.5)
 *
 * AI가 일부 문항을 판독하지 못해 question_number 시퀀스에 갭이 생긴 경우,
 * 누락 번호 자리에 placeholder 문항을 삽입한다.
 *
 * 점수 분배 전략:
 *  - 판단 가능한 객관식 문항들의 평균 점수를 기준으로 합리적 범위 계산
 *  - 점수차(총점 - 합계)가 평균 × 갭수의 ±50% 범위 안이면 → 자동 분배 (정밀 추측)
 *  - 그 외엔 points = null (UI에서 "?" 표시) — 사용자가 직접 입력해야 함
 *
 * 모든 placeholder는:
 *  - difficulty / question_type / ability_domain / topic = null
 *  - confidence = 0
 *  - ai_comment = "⚠️ 자동 분석 실패 — 수동 확인 필요"
 *
 * 주의: 서술형 문항은 question_number가 "서술형1" 같은 문자열이라 갭 감지 대상에서 제외.
 */
function makePlaceholder(
  questionNumber: number,
  points: number | null,
  confidenceReason: string,
  comment: string,
  subject: ExamSubjectKey = 'MATH',
): AnalyzedQuestion {
  return {
    question_number: questionNumber,
    question_format: 'objective',
    // 판독하지 못한 문항이다 — 난이도를 아는 척하지 않는다 (미정으로 두어 집계에서 빠진다).
    difficulty: null,
    difficulty_reason: null,
    question_type: defaultQuestionType(subject),
    ability_domain: null,
    points,
    topic: null,
    ai_comment: comment,
    confidence: 0,
    confidence_reason: confidenceReason,
    is_correct: null,
    student_answer: null,
    earned_points: null,
    error_type: null,
  };
}

/**
 * 꼬리 누락 보정 — 마지막 문항(들)이 통째로 빠진 경우 placeholder 를 뒤에 덧붙인다.
 *
 * ⚠️ fillNumberGaps 로는 절대 잡히지 않는다: 갭 탐색이 `min..max` 사이만 순회하므로
 * 마지막 문항이 없으면 max 가 줄어들 뿐 구멍이 생기지 않는다. 서술형은 번호가 "서술형2" 같은
 * 문자열이라 애초에 갭 탐색 대상도 아니다 — 실제 누락은 대부분 배점이 큰 마지막 서술형이다.
 *
 * 누락 개수 판정:
 *  - AI 신고 문항수 > 분석된 문항수 → 그 차이만큼
 *  - 문항수는 모르지만 배점만 부족 → 1개로 간주하고 부족분 전액 배정 (개수는 선생님이 조정)
 */
export function appendMissingTail(
  result: BasicAnalysisResult,
  completeness: AnalysisCompleteness,
  subject: ExamSubjectKey = 'MATH',
): { result: BasicAnalysisResult; filled: number } {
  if (completeness.status !== 'incomplete') return { result, filled: 0 };

  const { declaredQuestions, emittedQuestions, pointsShortfall } = completeness;
  const questionShortfall = declaredQuestions !== null && declaredQuestions > emittedQuestions
    ? declaredQuestions - emittedQuestions
    : 0;

  // 배점만 부족하면 최소 1개 누락으로 간주. 배점 초과(음수)는 판독 오류라 보정 대상 아님.
  const count = questionShortfall > 0 ? questionShortfall : pointsShortfall > 0 ? 1 : 0;
  if (count === 0) return { result, filled: 0 };

  const perQuestion = pointsShortfall > 0 ? roundPoints(pointsShortfall / count) : null;

  // 번호는 기존 최대 숫자 번호 다음부터 (서술형 문자열 번호는 무시)
  let maxNum = 0;
  for (const q of result.questions) {
    const n = typeof q.question_number === 'string' ? parseInt(q.question_number, 10) : q.question_number;
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }

  const placeholders = Array.from({ length: count }, (_, i) => makePlaceholder(
    maxNum + i + 1,
    perQuestion,
    '자동 분석 누락 — 시험지 확인 필요',
    perQuestion !== null
      ? `⚠️ 마지막 문항이 자동 분석에서 누락되었습니다. 시험지를 확인하고 문항 정보를 직접 입력해 주세요. (배점은 부족분 ${roundPoints(pointsShortfall)}점 기준 자동 배정)`
      : '⚠️ 마지막 문항이 자동 분석에서 누락되었습니다. 시험지를 확인하고 배점과 문항 정보를 직접 입력해 주세요.',
    subject,
  ));

  // 누락된 건 "꼬리"이므로 정렬하지 않고 맨 뒤에 붙인다 (서술형 뒤가 실제 위치)
  return {
    result: {
      ...result,
      exam_info: { ...result.exam_info, total_questions: result.questions.length + count },
      questions: [...result.questions, ...placeholders],
    },
    filled: count,
  };
}

function fillNumberGaps(result: BasicAnalysisResult, subject: ExamSubjectKey = 'MATH'): BasicAnalysisResult {
  const { exam_info, questions } = result;

  // 객관식/단답형(숫자 번호) 문항만 갭 감지 대상
  const numericQuestions = questions.filter((q) => {
    if (isEssay(q)) return false;
    const n = typeof q.question_number === 'string'
      ? parseInt(q.question_number, 10)
      : q.question_number;
    return !isNaN(n);
  });

  if (numericQuestions.length < 2) return result;

  // 번호 시퀀스 정렬
  const nums = numericQuestions
    .map((q) => Number(q.question_number))
    .sort((a, b) => a - b);

  const min = nums[0];
  const max = nums[nums.length - 1];

  // 갭 찾기
  const existing = new Set(nums);
  const missing: number[] = [];
  for (let n = min; n <= max; n++) {
    if (!existing.has(n)) missing.push(n);
  }

  if (missing.length === 0) return result;

  // 판단 가능한 객관식 평균 (points가 있는 것만)
  const objWithPoints = numericQuestions.filter((q) => q.points !== null && q.points > 0);
  const objAvg = objWithPoints.length > 0
    ? objWithPoints.reduce((s, q) => s + (q.points ?? 0), 0) / objWithPoints.length
    : 0;

  // 현재 합계와 점수차
  const currentSum = questions.reduce((s, q) => s + (q.points ?? 0), 0);
  const totalPoints = exam_info.total_points || 100;
  const diff = totalPoints - currentSum;

  // 정밀 추측 가능 조건: 평균 × 갭수의 ±50% 범위 안
  let perGap: number | null = null;
  let reason = '판독 실패 — 점수 수동 입력 필요';

  if (objAvg > 0 && missing.length > 0 && diff > 0) {
    const expected = objAvg * missing.length;
    const tolerance = expected * 0.5;
    const lower = expected - tolerance;
    const upper = expected + tolerance;

    if (diff >= lower && diff <= upper) {
      perGap = Math.round(diff / missing.length);
      reason = `갭 자동 보정 (객관식 평균 ${objAvg.toFixed(1)}점 기준)`;
    }
  }

  // placeholder 생성
  const placeholders: AnalyzedQuestion[] = missing.map((n) => makePlaceholder(
    n,
    perGap,
    reason,
    perGap !== null
      ? '⚠️ 이 문항은 자동 분석에 실패했습니다. 시험지를 확인하고 정보를 직접 입력해 주세요. (점수는 객관식 평균을 기준으로 자동 추정)'
      : '⚠️ 이 문항은 자동 분석에 실패했습니다. 시험지를 확인하고 점수와 정보를 직접 입력해 주세요.',
    subject,
  ));

  // 번호 순으로 정렬 (서술형은 뒤에)
  const merged = [...questions, ...placeholders];
  const sorted = merged.sort((a, b) => {
    const aIsEssay = isEssay(a);
    const bIsEssay = isEssay(b);
    if (aIsEssay && !bIsEssay) return 1;
    if (!aIsEssay && bIsEssay) return -1;

    const aNum = typeof a.question_number === 'string'
      ? parseInt(a.question_number, 10) || 0
      : a.question_number;
    const bNum = typeof b.question_number === 'string'
      ? parseInt(b.question_number, 10) || 0
      : b.question_number;
    return aNum - bNum;
  });

  return {
    ...result,
    exam_info: {
      ...exam_info,
      total_questions: sorted.length,
    },
    questions: sorted,
  };
}

/**
 * 분석 결과 기본 구조 검증
 */
function toEnglishKeyTerms(raw: unknown): EnglishKeyTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: EnglishKeyTerm[] = [];
  for (const row of raw.slice(0, 6)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const word = String(r.word ?? r.text ?? r.pattern ?? '').trim();
    if (!word || word.length > 80 || isEnglishStudyJunk(word)) continue;
    const meaning = typeof r.meaning === 'string' ? r.meaning.trim().slice(0, 40) || null : null;
    out.push({ word, meaning });
  }
  return out;
}

function toEnglishKeyStructures(raw: unknown): EnglishKeyStructure[] {
  if (!Array.isArray(raw)) return [];
  const out: EnglishKeyStructure[] = [];
  for (const row of raw.slice(0, 6)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const pattern = String(r.pattern ?? r.text ?? r.word ?? '').trim();
    if (!pattern || pattern.length > 80 || isEnglishStudyJunk(pattern)) continue;
    const meaning = typeof r.meaning === 'string' ? r.meaning.trim().slice(0, 40) || null : null;
    out.push({ pattern, meaning });
  }
  return out;
}

function parseEnglishKeyFields(q: AnalyzedQuestion): {
  key_vocab?: EnglishKeyTerm[];
  key_structures?: EnglishKeyStructure[];
} {
  const rec = q as unknown as Record<string, unknown>;
  const vocab = toEnglishKeyTerms(rec.key_vocab);
  const structures = toEnglishKeyStructures(rec.key_structures);
  const out: { key_vocab?: EnglishKeyTerm[]; key_structures?: EnglishKeyStructure[] } = {};
  if (vocab.length) out.key_vocab = vocab;
  if (structures.length) out.key_structures = structures;
  return out;
}

function validateBasicResult(result: unknown): result is BasicAnalysisResult {
  if (!result || typeof result !== 'object') return false;

  const r = result as Record<string, unknown>;

  if (!r.exam_info || typeof r.exam_info !== 'object') return false;
  if (!r.summary || typeof r.summary !== 'object') return false;
  if (!Array.isArray(r.questions)) return false;

  const examInfo = r.exam_info as Record<string, unknown>;
  if (typeof examInfo.total_questions !== 'number') return false;

  return true;
}

// ── 공개 API ──

/**
 * 시험지 이미지 분석 (기본 분석)
 *
 * @param images - base64 인코딩된 시험지 이미지 배열
 * @param combinedPrompt - 프롬프트 빌더에서 생성한 통합 프롬프트
 * @returns 구조화된 분석 결과
 */
async function runAnalysisPass(
  images: string[],
  mimeTypeHint: string,
  combinedPrompt: string,
  modelOverride?: string,
  calibrationSet?: CalibrationSet | null,
  subject: ExamSubjectKey = 'MATH',
  onProgress?: (msg: string) => void,
): Promise<BasicAnalysisResult> {
  try {
    const rawResult = await callGeminiVision<unknown>({
      images,
      prompt: combinedPrompt,
      jsonMode: true,
      temperature: 0.1,
      mimeTypeHint: mimeTypeHint,
      modelOverride,
      onProgress,
    });

    // 구조 검증
    if (!validateBasicResult(rawResult)) {
      throw new Error(
        'AI 분석 결과가 올바른 구조가 아닙니다. exam_info, summary, questions 필드가 필요합니다.'
      );
    }

    // 기본값 보정 + question_type 표준화 + ability_domain 매핑
    const rawQuestions = rawResult.questions.map((q, idx) => {
      const standardType = normalizeQuestionType(subject, q.question_type);
      const abilityDomain = normalizeAbilityDomain(subject, q.ability_domain, standardType);
      const englishKeys = subject === 'ENGLISH' ? parseEnglishKeyFields(q) : {};
      return {
        question_number: q.question_number ?? idx + 1,
        question_format: q.question_format ?? null,
        // ⚠️ null 을 '1'(기본)로 바꾸지 말 것.
        // H10 이 AI 에게 "판독 불가면 difficulty 를 null 로 두라"고 지시해 놓고
        // 그 null 을 기본 난이도로 둔갑시키면, 못 읽은 문항이 쉬운 문항으로 집계된다.
        difficulty: q.difficulty ?? null,
        difficulty_reason: q.difficulty_reason ?? null,
        question_type: standardType,
        ability_domain: abilityDomain,
        points: q.points ?? null,
        topic: q.topic ?? null,
        ai_comment: q.ai_comment ?? null,
        ...englishKeys,
        confidence: typeof q.confidence === 'number' ? q.confidence : CONFIDENCE_THRESHOLDS.MEDIUM,
        confidence_reason: q.confidence_reason ?? null,
        // 스키마 밖 값(예: 문자열 "false")을 그대로 두면 하류가 "답안 있음"으로 오판한다 → boolean 만 통과.
        is_correct: typeof q.is_correct === 'boolean' ? q.is_correct : null,
        student_answer: q.student_answer ?? null,
        earned_points: q.earned_points ?? null,
        error_type: q.error_type ?? null,
      };
    });

    // ── 통합 보정 플라이휠 적용 (⚠️ 현재 비활성) ──
    // 호출부(analyze/route.ts)가 calibrationSet 미전달 → 항상 rawQuestions(원본 AI값) 반환.
    // 자동보정은 교차검증서 per-문항 악화 입증으로 비활성화(2026-06-02). 코드는 가역성 위해 보존.
    // (calibrationSet 전달 시: 수치형 Δ가산 + 범주형 remap, 원본은 ai_<field> 에 보존.)
    const questions = calibrationSet
      ? rawQuestions.map((q) => {
          const m = { ...q } as Record<string, unknown>;
          for (const cfg of NUMERIC_FIELDS) {
            const applied = applyNumericField(m, cfg, calibrationSet.numeric[cfg.field] ?? null);
            if (applied != null) { m[cfg.aiKey] = m[cfg.valueKey]; m[cfg.valueKey] = applied; }
          }
          for (const cfg of CATEGORICAL_FIELDS) {
            const remap = applyCategoricalRemap(String(m[cfg.valueKey] ?? ''), calibrationSet.categorical[cfg.field] ?? null);
            if (remap && remap !== String(m[cfg.valueKey])) { m[cfg.aiKey] = m[cfg.valueKey]; m[cfg.valueKey] = remap; }
          }
          return m as unknown as typeof q;
        })
      : rawQuestions;

    const dist = tallyQuestions(questions, subject);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSchoolName = (rawResult.exam_info as any)?.school_name;

    // AI 신고값 보존 — 누락 감지의 유일한 독립 기준. 산출물 합계로 덮어쓰면 검증이 항등식이 된다.
    // 미신고(0/비수치)는 100 같은 기본값으로 채우지 않고 null 로 둔다 → '판정 불가'와 구분.
    const declaredQuestions = typeof rawResult.exam_info.total_questions === 'number' && rawResult.exam_info.total_questions > 0
      ? rawResult.exam_info.total_questions
      : null;
    const declaredPoints = typeof rawResult.exam_info.total_points === 'number' && rawResult.exam_info.total_points > 0
      ? rawResult.exam_info.total_points
      : null;

    const result: BasicAnalysisResult = {
      exam_info: {
        total_questions: questions.length,
        total_points: declaredPoints ?? 100,
        school_name: typeof rawSchoolName === 'string' ? rawSchoolName : null,
        declared_total_questions: declaredQuestions,
        declared_total_points: declaredPoints,
        format_distribution: dist.format,
      },
      summary: {
        difficulty_distribution: dist.difficulty as unknown as BasicAnalysisResult['summary']['difficulty_distribution'],
        type_distribution: dist.type as unknown as BasicAnalysisResult['summary']['type_distribution'],
        average_difficulty: dist.dominantDifficulty,
        dominant_type: dist.dominantType,
      },
      questions,
    };

    // 배점 검증 및 페널티 적용
    const validated = validateAndPenalize(result);
    // 문항 번호 갭 자동 보정 (v1.0.5) — 중간 구멍만. 꼬리 누락은 analyzeExam 이 처리.
    // placeholder 가 끼어들므로 분포를 반드시 다시 파생시킨다 (안 하면 questions 와 summary 가 어긋난다).
    return syncSummary(fillNumberGaps(validated, subject), subject);
  } catch (error) {
    if (error instanceof Error && error.message.includes('AI 분석 결과')) {
      throw error;
    }
    throw new Error(
      `시험지 분석 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 시험지 분석 (누락 감지 + 1회 재시도 + 잔여 누락 가시화)
 *
 * AI 비결정성 대응 3단계 — 정상 시험지에서 문항이 조용히 사라지는 것을 구조적으로 차단:
 *  1. 1차 분석 후 AI 신고값(만점/문항수)과 대조 → 누락 감지
 *  2. 누락이면 재분석 1회 (동일 입력에서 결과가 달라지므로 대부분 여기서 복구)
 *  3. 그래도 남으면 placeholder 문항으로 삽입 + summary.completeness 에 기록
 *     → readiness 게이트가 총평 생성을 차단하고 화면에 경고를 띄운다
 */
export async function analyzeExam(
  images: string[],
  mimeTypeHint: string,
  combinedPrompt: string,
  modelOverride?: string,
  calibrationSet?: CalibrationSet | null,
  subject: ExamSubjectKey = 'MATH',
  onProgress?: (msg: string) => void,
): Promise<BasicAnalysisResult> {
  if (!images.length) {
    throw new Error('분석할 이미지가 없습니다');
  }

  if (!combinedPrompt.trim()) {
    throw new Error('분석 프롬프트가 비어있습니다');
  }

  const subjectKey = toExamSubjectKey(subject);
  let result = await runAnalysisPass(images, mimeTypeHint, combinedPrompt, modelOverride, calibrationSet, subjectKey, onProgress);
  let completeness = assessCompleteness(result);

  if (completeness.status === 'incomplete') {
    onProgress?.('문항 누락 감지 — 재분석 중');
    console.warn(`[기출분석] 문항 누락 감지 — 재분석 1회 시도: ${completeness.reason}`);
    try {
      const retryResult = await runAnalysisPass(images, mimeTypeHint, combinedPrompt, modelOverride, calibrationSet, subjectKey, onProgress);
      const retryCompleteness = assessCompleteness(retryResult, true);
      if (isBetterPass(retryCompleteness, completeness)) {
        console.warn(`[기출분석] 재분석 채택 (${completeness.emittedQuestions}문항/${completeness.pointsSum}점 → ${retryCompleteness.emittedQuestions}문항/${retryCompleteness.pointsSum}점)`);
        result = retryResult;
        completeness = retryCompleteness;
      } else {
        completeness = { ...completeness, retried: true };
      }
    } catch (e) {
      // 재분석 실패는 치명적이지 않다 — 1차 결과 + 누락 경고로 진행
      console.error('[기출분석] 재분석 실패 — 1차 결과 유지:', e);
      completeness = { ...completeness, retried: true };
    }
  }

  // 재분석 후에도 남은 누락은 placeholder 로 가시화 (조용히 짧은 분석본을 만들지 않는다)
  const { result: filled, filled: filledCount } = appendMissingTail(result, completeness, subjectKey);
  // 꼬리 placeholder 도 분포를 흔든다 → questions 기준으로 다시 파생 (fillNumberGaps 와 동일 이유)
  const synced = syncSummary(filled, subjectKey);

  return {
    ...synced,
    summary: { ...synced.summary, completeness: { ...completeness, filledQuestions: filledCount } },
  };
}

/**
 * 시험지 유형 분류 (빈 시험지 / 학생 답안지 / 혼합)
 *
 * @param images - base64 인코딩된 시험지 이미지 배열 (보통 첫 페이지만)
 * @returns 시험지 분류 결과
 */
export async function classifyExamPaper(
  images: string[]
): Promise<ExamPaperClassification> {
  if (!images.length) {
    throw new Error('분류할 이미지가 없습니다');
  }

  const classificationPrompt = `당신은 시험지를 분류하는 전문가입니다.

주어진 시험지 이미지를 분석하여 다음을 판별하세요:

1. **시험지 유형 (paper_type)**:
   - "blank": 빈 시험지 (학생 답안이 없음)
   - "answered": 학생이 답을 작성한 시험지
   - "mixed": 일부만 답안이 작성됨

2. **채점 상태 (grading_status)**:
   - "not_graded": 채점 표시 없음
   - "partially_graded": 일부 문항만 채점됨
   - "fully_graded": 전체 문항 채점 완료
   - "uncertain": 판별 불가

3. **메타데이터 추출**: 학교명, 시험 제목, 학년, 날짜, 과목 등

**JSON 응답 형식:**
{
  "paper_type": "blank" | "answered" | "mixed",
  "paper_type_confidence": 0.0-1.0,
  "grading_status": "not_graded" | "partially_graded" | "fully_graded" | "uncertain",
  "grading_confidence": 0.0-1.0,
  "extracted_metadata": {
    "school_name": "학교명 또는 null",
    "exam_title": "시험 제목 또는 null",
    "grade": "학년 또는 null",
    "date": "날짜 또는 null",
    "subject": "과목 또는 null",
    "suggested_title": "추천 제목 (학교명 + 학년 + 시험명 조합)"
  }
}`;

  try {
    const rawResult = await callGeminiVision<unknown>({
      images,
      prompt: classificationPrompt,
      jsonMode: true,
      temperature: 0.05,
    });

    // 구조 검증 및 기본값 적용
    const r = rawResult as Record<string, unknown>;
    const metadata = (r.extracted_metadata ?? {}) as Record<string, unknown>;

    const classification: ExamPaperClassification = {
      paper_type: validatePaperType(r.paper_type) ?? 'blank',
      paper_type_confidence: typeof r.paper_type_confidence === 'number'
        ? r.paper_type_confidence
        : CONFIDENCE_THRESHOLDS.MEDIUM,
      grading_status: validateGradingStatus(r.grading_status) ?? 'uncertain',
      grading_confidence: typeof r.grading_confidence === 'number'
        ? r.grading_confidence
        : CONFIDENCE_THRESHOLDS.LOW,
      extracted_metadata: {
        school_name: typeof metadata.school_name === 'string' ? metadata.school_name : null,
        exam_title: typeof metadata.exam_title === 'string' ? metadata.exam_title : null,
        grade: typeof metadata.grade === 'string' ? metadata.grade : null,
        date: typeof metadata.date === 'string' ? metadata.date : null,
        subject: typeof metadata.subject === 'string' ? metadata.subject : null,
        suggested_title: typeof metadata.suggested_title === 'string'
          ? metadata.suggested_title
          : null,
      },
    };

    return classification;
  } catch (error) {
    throw new Error(
      `시험지 분류 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ── 내부 검증 헬퍼 ──

const VALID_PAPER_TYPES = new Set(['blank', 'answered', 'mixed']);
const VALID_GRADING_STATUSES = new Set(['not_graded', 'partially_graded', 'fully_graded', 'uncertain']);

function validatePaperType(value: unknown): 'blank' | 'answered' | 'mixed' | null {
  if (typeof value === 'string' && VALID_PAPER_TYPES.has(value)) {
    return value as 'blank' | 'answered' | 'mixed';
  }
  return null;
}

function validateGradingStatus(
  value: unknown
): 'not_graded' | 'partially_graded' | 'fully_graded' | 'uncertain' | null {
  if (typeof value === 'string' && VALID_GRADING_STATUSES.has(value)) {
    return value as 'not_graded' | 'partially_graded' | 'fully_graded' | 'uncertain';
  }
  return null;
}
