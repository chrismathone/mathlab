/**
 * 기출 분석 타입 정의
 * Python Pydantic 모델에서 1:1 이식
 */

import type { ExamQuestionFormat, GradingStatus, AgentType } from './shared/constants';
import type { EnglishQuestionAnalysis } from './english/question-evidence';

// ── 문항 분석 결과 (기본 분석) ──
/** 영어 학습 대책 — 시험지에 나온 단어 */
export interface EnglishKeyTerm {
  word: string;
  meaning: string | null;
}

/** 영어 학습 대책 — 시험지에 나온 구문 */
export interface EnglishKeyStructure {
  pattern: string;
  meaning: string | null;
}

export interface AnalyzedQuestion {
  english_analysis?: EnglishQuestionAnalysis | null;
  english_analysis_review?: { reviewed_at: string; reviewed_by: string };
  difficulty_reviewed?: { reviewed_at: string; reviewed_by: string };
  id?: string;
  question_number: number | string;
  question_format: ExamQuestionFormat | null;
  /**
   * "1"~"5" (5단계). 선생님 수정 또는 보정 적용 시 최종 표시값.
   * **null = 판독 실패/미정** — 분포·가중평균 어디에도 계상하지 않는다.
   * (기본값 "1" 로 채우면 못 읽은 문항이 쉬운 문항으로 둔갑한다.)
   */
  difficulty: string | null;
  difficulty_reason: string | null;
  /** AI 원본 난이도 — 선생님 수정/자동 보정 시 원본 보존(보정 학습용). 미수정이면 undefined */
  ai_difficulty?: string | null;
  question_type: string | null;
  /** AI 원본 유형 — 교정 시 보존(혼동맵 학습용) */
  ai_question_type?: string | null;
  ability_domain?: string | null;
  /** AI 원본 능력 — 교정 시 보존(혼동맵 학습용) */
  ai_ability_domain?: string | null;
  points: number | null;
  /** AI 원본 배점 — 교정 시 보존(보정 학습용) */
  ai_points?: number | null;
  topic: string | null;             // "과목 > 대단원 > 소단원"
  /** AI 원본 단원 — 교정 시 보존(혼동맵 학습용) */
  ai_topic?: string | null;
  ai_comment: string | null;       // 2문장, 최대 50자
  /** 영어 전용 — 해당 문항 지문·선지에 실제로 나온 핵심 단어. 없으면 생략 */
  key_vocab?: EnglishKeyTerm[] | null;
  /** 영어 전용 — 해당 문항에 실제로 나온 문법 구문. 없으면 생략 */
  key_structures?: EnglishKeyStructure[] | null;
  confidence: number;              // 0.0-1.0
  confidence_reason: string | null;
  // 수동 수정 추적 (난이도/단원 등 선생님 교정)
  manually_edited?: boolean;
  manually_edited_at?: string | null;
  // 학생 답안지 전용
  is_correct: boolean | null;
  student_answer: string | null;
  earned_points: number | null;
  error_type: string | null;
  created_at?: string;
}

// ── 난이도 분포 (5단계: "1"~"5") ──
export interface DifficultyDistribution {
  '1': number;
  '2': number;
  '3': number;
  '4': number;
  '5': number;
  // 구 4단계 하위 호환
  concept?: number;
  pattern?: number;
  reasoning?: number;
  creative?: number;
  // 3단계 하위 호환
  high?: number;
  medium?: number;
  low?: number;
  [key: string]: number | undefined;
}

// ── 유형 분포 (수학 4영역 또는 영어 6유형 — 엔진이 questions 에서 재계산) ──
export type TypeDistribution = Record<string, number>;

// ── 분석 누락 감지 ──
/**
 * AI가 시험지에서 읽어낸 만점/문항수(ground truth) 대비 실제 산출물 대조 결과.
 *
 * ⚠️ 존재 이유: AI 비결정성으로 정상 시험지에서도 마지막 문항이 통째로 누락될 수 있다
 * (2026-07-25 경명여중1: 동일 PDF 재분석에서 22문항/100점 → 21문항/90점).
 * 누락은 번호 갭이 아니라 "꼬리 잘림"으로 나타나므로 번호 시퀀스만으로는 감지 불가 →
 * AI 신고값을 유일한 독립 기준으로 보존해 대조한다. 절대 산출물 합계로 덮어쓰지 말 것.
 */
export interface AnalysisCompleteness {
  status: 'ok' | 'incomplete' | 'unverifiable';
  declaredQuestions: number | null;  // AI가 신고한 문항 수 (없으면 null)
  declaredPoints: number | null;     // AI가 신고한 만점 (없으면 null)
  emittedQuestions: number;          // 실제 분석된 문항 수 (보정 전)
  pointsSum: number;                 // 실제 배점 합계 (보정 전)
  pointsShortfall: number;           // declaredPoints - pointsSum (양수 = 부족)
  filledQuestions: number;           // 누락 보정으로 삽입한 placeholder 수
  retried: boolean;                  // 누락 감지로 재분석을 시도했는지
  reason: string;                    // 사유 (한국어, 사용자 노출)
}

// ── 분석 요약 ──
export interface AnalysisSummary {
  difficulty_distribution: DifficultyDistribution;
  type_distribution: TypeDistribution;
  average_difficulty: string;
  dominant_type: string;
  /** 누락 감지 결과 — 총평 생성 게이트(readiness)의 판정 근거 */
  completeness?: AnalysisCompleteness | null;
}

// ── 시험지 정보 ──
export interface ExamInfo {
  total_questions: number;
  total_points: number;
  school_name?: string | null;
  /**
   * AI가 시험지에서 직접 읽어낸 문항 수 — 누락 감지의 기준(ground truth).
   * ⚠️ emit된 문항 수로 덮어쓰면 문항 수 불일치 검사가 항등식이 되어 죽는다.
   */
  declared_total_questions?: number | null;
  /**
   * AI가 시험지에서 직접 읽어낸 만점 — 배점 합계 검증의 기준.
   * null = AI가 신고하지 않음(검증 불가). 기본값 100으로 채워 넣지 말 것 —
   * "AI가 100점이라 했다"와 "몰라서 100으로 뒀다"를 구분해야 오탐/미탐을 막는다.
   */
  declared_total_points?: number | null;
  format_distribution: {
    objective: number;
    short_answer: number;
    essay: number;
  };
}

// ── 기본 분석 결과 ──
export interface BasicAnalysisResult {
  exam_info: ExamInfo;
  summary: AnalysisSummary;
  questions: AnalyzedQuestion[];
}

// ── 채점 마크 감지 ──
export interface GradingMark {
  question_number: number;
  mark_type: string;       // circle, slash, x, check, triangle
  mark_symbol: string;
  position: string;
  color: string;
  indicates: 'correct' | 'incorrect' | 'not_graded' | 'uncertain';
  confidence: number;
}

export interface MarkDetectionResult {
  marks: GradingMark[];
  overall_grading_status: GradingStatus;
  color_distinction_possible: boolean;
  detection_notes: string[];
}

// ── 시험지 분류 ──
export interface ExamPaperClassification {
  paper_type: 'blank' | 'answered' | 'mixed';
  paper_type_confidence: number;
  grading_status: GradingStatus;
  grading_confidence: number;
  extracted_metadata: {
    school_name: string | null;
    exam_title: string | null;
    grade: string | null;
    date: string | null;
    subject: string | null;
    suggested_title: string | null;
  };
}

// ── 교차 검증 결과 ──
export interface CrossValidationResult {
  corrections_made: number;
  confidence_boosts: number;
  null_conversions: number;
  details: Array<{
    question_number: number;
    action: 'corrected' | 'boosted' | 'nulled';
    reason: string;
  }>;
}

// ══════════════════════════════════════════
// 확장 분석 에이전트 결과 타입
// ══════════════════════════════════════════

// ── 취약점 분석 (WeaknessAgent) ──
export interface SeverityInfo {
  count: number;
  percentage: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface TopicWeakness {
  topic: string;
  wrong_count: number;
  total_count: number;
  severity_score: number;
  recommendation: string;
}

export interface MistakePattern {
  pattern_type: 'calculation_error' | 'concept_gap' | 'careless' | 'time_pressure';
  frequency: number;
  description: string;
  example_questions: (number | string)[];
}

export interface CognitiveLevel {
  achieved: number;
  target: number;
  gap_reason?: string;
}

export interface WeaknessProfile {
  difficulty_weakness: Record<string, SeverityInfo>;
  type_weakness: Record<string, SeverityInfo>;
  topic_weaknesses: TopicWeakness[];
  mistake_patterns: MistakePattern[];
  cognitive_levels: {
    knowledge: CognitiveLevel;
    comprehension: CognitiveLevel;
    application: CognitiveLevel;
    analysis: CognitiveLevel;
  };
}

// ── 학습 계획 (LearningAgent) ──
export interface LearningTopic {
  topic: string;
  duration_hours: number;
  resources: string[];
  checkpoint: string;
}

export interface LearningPhase {
  phase_number: number;
  title: string;
  duration: string;
  topics: LearningTopic[];
}

export interface DailySchedule {
  day: string;
  topics: string[];
  duration_minutes: number;
  activities: string[];
}

export interface ScoreImprovement {
  current_estimated_score: number;
  target_score: number;
  improvement_points: number;
  achievement_confidence: number;
}

export interface LearningPlan {
  duration: string;
  weekly_hours: number;
  phases: LearningPhase[];
  daily_schedule: DailySchedule[];
  expected_improvement: ScoreImprovement;
}

// ── 성적 예측 (PredictionAgent) ──
export interface DifficultyHandling {
  success_rate: number;
  trend: 'improving' | 'stable' | 'declining';
}

export interface TrajectoryPoint {
  timeframe: string;
  predicted_score: number;
  confidence_interval: [number, number];
  required_effort: string;
}

export interface GoalAchievement {
  goal: string;
  current_probability: number;
  with_current_plan: number;
  with_optimized_plan: number;
}

export interface RiskFactor {
  factor: string;
  impact_on_goal: 'critical' | 'high' | 'medium' | 'low';
  mitigation: string;
}

export interface PerformancePrediction {
  current_assessment: {
    score_estimate: number;
    rank_estimate_percentile: number;
    difficulty_handling: Record<string, DifficultyHandling>;
  };
  trajectory: TrajectoryPoint[];
  goal_achievement: GoalAchievement;
  risk_factors: RiskFactor[];
}

// ── 에이전트 공통 ──
export interface AgentContext {
  basicResult: BasicAnalysisResult;
  subject: string;
  grade: string;
  weaknessProfile?: WeaknessProfile;
  learningPlan?: LearningPlan;
}

export interface AgentResult {
  agentType: AgentType;
  result: unknown;
}

// ── 프롬프트 빌더 ──
export interface ExamContext {
  /** 'MATH' | 'ENGLISH' — 한글 라벨을 넣지 말 것 */
  subject: string;
  grade_level: string | null;
  unit: string | null;
  category: string | null;
  exam_scope: string[] | null;
  paper_type: string;
  has_essay: boolean;
  /** 시험 연도 (예: 2024) — 참고용 */
  exam_year?: number | null;
  /** 시험 학기 (1 | 2) — 단원 범위 유추에 사용 */
  exam_semester?: number | null;
  /** 시험 종류 (MIDTERM | FINAL | MOCK | OTHER) — 단원 범위 유추에 사용 */
  exam_category?: 'MIDTERM' | 'FINAL' | 'MOCK' | 'OTHER' | null;
}

export interface BuildPromptRequest {
  exam_context: ExamContext;
  include_error_patterns: boolean;
  include_examples: boolean;
  max_examples_per_pattern: number;
}

export interface BuildPromptResponse {
  base_prompt: string;
  analysis_guidelines: string;
  error_patterns_prompt: string | null;
  examples_prompt: string | null;
  combined_prompt: string;
  used_templates: string[];
  matched_problem_types: string[];
}
