import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type {
  AppTheme,
  AiGeneration,
  EditorFontSize,
  Attempt,
  DailyPlan,
  KnowledgeNote,
  Mistake,
  PlatformSource,
  PlatformBatchImportRequest,
  PlatformBatchImportSummary,
  PlatformBatchProgress,
  Problem,
  ProblemSampleRunRequest,
  ProblemSampleRunResult,
  RunCodeResult,
  ThoughtEvent,
  FinishInterviewInput,
} from '../types';
import type {
  AiCoachIntent,
  InterviewCoachIntent,
  InterviewExaminerInput,
  InterviewExaminerResult,
} from '../lib/ai';

export interface AppSettingsView {
  aiBaseUrl?: string;
  aiModel?: string;
  hasAiCredential?: boolean;
  defaultLanguage?: string;
  editorFontSize?: EditorFontSize;
  dailyTargetMinutes?: number;
  dailyTargetProblems?: number;
  dailyTargetInterviewQuestions?: number;
  interviewCatalogVersion?: number;
  lastSolveProblemId?: string;
  solveProblemAreaHeight?: number;
  solveProblemTextWidth?: number;
  solveWorkbenchCodeWidth?: number;
  solveTerminalHeight?: number;
  privacyConfirmed?: boolean;
  theme?: AppTheme;
}

export interface AiHintRequestView {
  problemId: string;
  attemptId?: string;
  level?: number;
  intent?: AiCoachIntent | InterviewCoachIntent;
  answerText?: string;
  code?: string;
  language?: string;
  previousGuidance?: string;
  recentRunError?: string;
  userQuestion?: string;
  teachingStep?: string;
  stepDeliverable?: string;
  analysisContext?: string;
  onChunk?: (chunk: string) => void;
}

export interface AppStoreView {
  initialized?: boolean;
  loading?: boolean;
  error?: string | null;
  problems: Problem[];
  attempts: Attempt[];
  mistakes: Mistake[];
  knowledgeNotes: KnowledgeNote[];
  dailyPlans: DailyPlan[];
  thoughtEvents: ThoughtEvent[];
  aiGenerations: AiGeneration[];
  settings: AppSettingsView;
  currentAttemptId?: string | null;
  initialize?: () => Promise<void> | void;
  refresh?: () => Promise<void> | void;
  addProblem?: (problem: Partial<Problem>) => Promise<Problem | void> | Problem | void;
  createProblem?: (problem: Partial<Problem>) => Promise<Problem | void> | Problem | void;
  updateProblem?: (id: string, patch: Partial<Problem>) => Promise<void> | void;
  recoverProblemSamples?: (id: string) => Promise<Problem>;
  refreshProblemMetadata?: (id: string) => Promise<Problem>;
  startAttempt?: (problemId: string, language?: string) => Promise<Attempt | void> | Attempt | void;
  startInterviewAttempt?: (problemId: string) => Promise<Attempt | void> | Attempt | void;
  updateAttempt?: (id: string, patch: Partial<Attempt>) => Promise<void> | void;
  saveInterviewDraft?: (attemptId: string, answerText: string) => Promise<void> | void;
  finishInterviewAttempt?: (attemptId: string, input: FinishInterviewInput) => Promise<void> | void;
  finishAttempt?: (id: string, patch: Partial<Attempt>) => Promise<void> | void;
  addThoughtEvent?: (event: Partial<ThoughtEvent>) => Promise<void> | void;
  completeReview?: (mistakeId: string, success: boolean) => Promise<void> | void;
  addKnowledgeNote?: (note: Partial<KnowledgeNote>) => Promise<void> | void;
  createKnowledgeNote?: (note: Partial<KnowledgeNote>) => Promise<void> | void;
  updateKnowledgeNote?: (id: string, patch: Partial<KnowledgeNote>) => Promise<void> | void;
  savePlan?: (plan: Partial<DailyPlan>) => Promise<void> | void;
  generateDailyPlan?: (options?: Record<string, unknown>) => Promise<void> | void;
  updateSettings?: (patch: Partial<AppSettingsView>) => Promise<void> | void;
  restoreInterviewCatalog?: () => Promise<number | void> | number | void;
  openPlatform?: (source: PlatformSource) => Promise<void> | void;
  arrangePlatform?: (source: PlatformSource) => Promise<void> | void;
  bindCurrentProblem?: (source: PlatformSource) => Promise<Problem | void> | Problem | void;
  importPlatformProblems?: (request: PlatformBatchImportRequest, onProgress?: (progress: PlatformBatchProgress) => void) => Promise<PlatformBatchImportSummary>;
  cancelPlatformProblemImport?: () => Promise<void> | void;
  clearPlatformProfile?: (source: PlatformSource) => Promise<void> | void;
  saveAiCredential?: (key: string) => Promise<void> | void;
  deleteAiCredential?: () => Promise<void> | void;
  testAiConnection?: () => Promise<boolean | void> | boolean | void;
  createBackup?: () => Promise<string | void> | string | void;
  restoreBackup?: () => Promise<void> | void;
  exportData?: () => Promise<void> | void;
  importData?: () => Promise<void> | void;
  openDataDirectory?: () => Promise<void> | void;
  deleteAllUserData?: (includeBackups: boolean) => Promise<void> | void;
  requestAiHint?: (payload: AiHintRequestView) => Promise<string | void> | string | void;
  analyzeRecentPractice?: () => Promise<KnowledgeNote | null>;
  requestInterviewExaminer?: (input: InterviewExaminerInput) => Promise<InterviewExaminerResult>;
  cancelAiRequest?: () => Promise<void> | void;
  runCode?: (request: { language: string; code: string; input?: string; timeoutMs?: number }) => Promise<RunCodeResult>;
  runLocalCode?: (request: { language: string; code: string; input?: string; timeoutMs?: number }) => Promise<RunCodeResult>;
  runProblemSample?: (request: ProblemSampleRunRequest) => Promise<ProblemSampleRunResult>;
}

const EMPTY_ARRAY: never[] = [];
const EMPTY_SETTINGS: AppSettingsView = {};

export function useStoreView(): AppStoreView {
  const raw = useAppStore() as unknown as Partial<AppStoreView>;

  return useMemo(
    () => ({
      ...raw,
      problems: raw.problems ?? EMPTY_ARRAY,
      attempts: raw.attempts ?? EMPTY_ARRAY,
      mistakes: raw.mistakes ?? EMPTY_ARRAY,
      knowledgeNotes: raw.knowledgeNotes ?? EMPTY_ARRAY,
      dailyPlans: raw.dailyPlans ?? EMPTY_ARRAY,
      thoughtEvents: raw.thoughtEvents ?? EMPTY_ARRAY,
      aiGenerations: raw.aiGenerations ?? EMPTY_ARRAY,
      settings: raw.settings ?? EMPTY_SETTINGS,
    }),
    [raw],
  );
}

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDuration(seconds = 0): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${rest} 秒`;
  return `${rest} 秒`;
}

export function sourceLabel(source?: string): string {
  const labels: Record<string, string> = {
    'leetcode-cn': '力扣',
    leetcode: 'LeetCode',
    nowcoder: '牛客',
    manual: '手动录入',
    screenshot: '截图识别',
  };
  return source ? (labels[source] ?? source) : '未知来源';
}

export function difficultyLabel(difficulty?: string): string {
  const labels: Record<string, string> = {
    easy: '简单',
    medium: '中等',
    hard: '困难',
    unknown: '未标注',
  };
  return difficulty ? (labels[difficulty] ?? difficulty) : '未标注';
}
