import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';

export interface ExamPaperData {
  id: string;
  title: string;
  subject: 'MATH' | 'ENGLISH';
  grade: string;
  category: string | null;
  examType: string;
  // 출제범위 메타 — 신형 { topics, examYear, examSemester, examCategory } 객체 / 레거시 string[] / null (Json, 진입부 정규화)
  examScope?: unknown;
  // 학교 공지 실측 지표 — 대부분 null (Json, shared/exam-stats.ts 의 readExamStats 로 정규화)
  examStats?: unknown;
  status: 'PENDING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';
  analysisStep: number;
  /** 실제 파이프라인 로그 (분석 중에만 GET 이 실어 줌) */
  analysisProgress?: Array<{ time: string; msg: string }>;
  schoolName: string | null;
  schoolId: string | null;
  school: { id: string; name: string; district: string } | null;
  errorMessage: string | null;
  extractedToBankAt: string | null;
  createdAt: string;
  teacher: { id: string; name: string };
  student: { id: string; name: string } | null;
  analyses: Array<{
    id: string;
    questions: AnalyzedQuestion[];
    summary: Record<string, unknown> | null;
    modelVersion: string | null;
    totalQuestions: number | null;
    totalPoints: number | null;
    earnedPoints: number | null;
    analyzedAt: string | null;
    extensions: Array<{ id: string; agentType: string; result?: Record<string, unknown>; createdAt: string; errorMessage: string | null; commentaryReady?: boolean }>;
  }>;
}

export type AnalysisTab = 'basic' | 'comments' | 'strategy';
