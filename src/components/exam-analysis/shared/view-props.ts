import type { AnalyzedQuestion } from '@/lib/exam-analysis/types';

export type DifficultyEditHandler = (
  questionNumber: number | string,
  difficulty: string,
  aiDifficulty: string | null,
) => void;

export interface TypeRadarChartProps {
  data: Record<string, number>;
  questions?: AnalyzedQuestion[];
  subject?: string;
}

export interface AnalysisResultViewProps {
  onRefresh?: () => void;
  questions: AnalyzedQuestion[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary: Record<string, any> | null;
  totalPoints: number | null;
  earnedPoints: number | null;
  examType: string;
  examPaperId?: string;
  analysisId?: string;
  onDifficultyEdit?: DifficultyEditHandler;
  grade?: string | null;
  subject?: string;
}

export interface AnalysisCommentTabProps {
  questions: AnalyzedQuestion[];
  examPaperId?: string;
  analysisId?: string;
  onDifficultyEdit?: DifficultyEditHandler;
  subject?: string;
}
