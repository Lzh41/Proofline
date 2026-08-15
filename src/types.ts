export type PlatformSource = 'leetcode-cn' | 'leetcode' | 'nowcoder';
export type PlatformBatchItemStatus = 'fetched' | 'paid-only' | 'not-found' | 'failed' | 'cancelled';
export type ProblemSource = PlatformSource | 'manual' | 'screenshot';
export type ProblemKind = 'algorithm' | 'interview';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'unknown';
export type ProblemStatus = 'todo' | 'attempted' | 'solved' | 'unknown';
export type AttemptResult = 'sample-passed' | 'sample-failed' | 'accepted' | 'wrong-answer' | 'timeout' | 'aborted' | 'unfinished' | 'mastered' | 'uncertain' | 'unknown';
export type AttemptMode = 'code' | 'interview';
export type MistakeCategory = 'concept' | 'implementation' | 'boundary' | 'complexity' | 'reading' | 'incomplete' | 'unclear' | 'no-example' | 'other';
export type AppTheme = 'light' | 'dark' | 'system';
export type EditorFontSize = 14 | 16 | 18 | 20 | 22;
export type InterviewFormat = 'knowledge' | 'scenario' | 'system-design' | 'project';
export type InterviewContentOrigin = 'builtin' | 'user' | 'import' | 'ai';

export interface InterviewProblemData {
  catalogId?: string;
  catalogVersion?: number;
  contentOrigin: InterviewContentOrigin;
  primaryRole: string;
  roles: string[];
  category: string;
  format: InterviewFormat;
  keyPoints: string[];
  referenceAnswer: string;
  followUps: string[];
  archived?: boolean;
}

export interface InterviewAttemptData {
  answerText: string;
  aiFeedback?: string;
  omissions?: string;
  improvedAnswer?: string;
  masteryResult?: 'mastered' | 'uncertain' | 'unknown';
}

export interface FinishInterviewInput {
  masteryResult: 'mastered' | 'uncertain' | 'unknown';
  answerText: string;
  aiFeedback?: string;
  omissions?: string;
  improvedAnswer?: string;
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface PlatformCodeSnippet {
  language: string;
  languageSlug: string;
  code: string;
}

export interface PlatformBatchImportRequest {
  source: PlatformSource;
  startId: number;
  endId: number;
}

export interface PlatformBatchFetchItem {
  requestedId: string;
  status: PlatformBatchItemStatus;
  sourceUrl?: string;
  metadata?: Partial<Problem>;
  error?: string;
}

export interface PlatformBatchFetchResult {
  source: PlatformSource;
  requestedCount: number;
  fetchedCount: number;
  paidOnlyCount: number;
  notFoundCount: number;
  failedCount: number;
  cancelled: boolean;
  items: PlatformBatchFetchItem[];
}

export type PlatformBatchProgress =
  | { event: 'started'; total: number }
  | {
      event: 'progress';
      completed: number;
      total: number;
      currentId: string;
      fetched: number;
      failed: number;
    }
  | { event: 'done'; completed: number; total: number; cancelled: boolean };

export interface PlatformBatchImportSummary extends PlatformBatchFetchResult {
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  path: string;
  size: number;
  createdAt: number;
}

export interface Problem {
  id: string;
  kind: ProblemKind;
  title: string;
  source: ProblemSource;
  sourceUrl?: string;
  externalId?: string;
  platformSlug?: string;
  difficulty: Difficulty;
  tags: string[];
  content: string;
  constraints: string[];
  examples: ProblemExample[];
  codeSnippets?: PlatformCodeSnippet[];
  sampleTestCase?: string;
  attachments: Attachment[];
  platformStatus: ProblemStatus;
  cacheStatus: 'fresh' | 'stale' | 'link-only' | 'manual';
  importMethod: 'platform' | 'connector' | 'url' | 'manual' | 'ocr' | 'import';
  contentFetchedAt?: number;
  contentHash?: string;
  connectorVersion?: string;
  interview?: InterviewProblemData;
  createdAt: number;
  updatedAt: number;
}

export interface Attempt {
  id: string;
  problemId: string;
  mode: AttemptMode;
  language: string;
  code: string;
  startedAt: number;
  endedAt?: number;
  durationSeconds: number;
  result: AttemptResult;
  hintLevel: 0 | 1 | 2 | 3 | 4 | 5;
  independent: boolean;
  mastery: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  interview?: InterviewAttemptData;
  createdAt: number;
  updatedAt: number;
}

export interface ThoughtEvent {
  id: string;
  attemptId: string;
  type: 'note' | 'hint' | 'error' | 'breakthrough';
  content: string;
  createdAt: number;
}

export interface PlatformResult {
  id: string;
  problemId: string;
  attemptId?: string;
  source: PlatformSource;
  result: 'accepted' | 'wrong-answer' | 'timeout' | 'unfinished';
  durationMs?: number;
  memoryKb?: number;
  submittedAt: number;
  manuallyConfirmed: boolean;
}

export interface Mistake {
  id: string;
  problemId: string;
  attemptId?: string;
  category: MistakeCategory;
  rootCause: string;
  correction: string;
  nextChecklistItem: string;
  reviewStage: number;
  intervalDays: number;
  nextReviewAt: number;
  lastReviewedAt?: number;
  successfulReviews: number;
  failedReviews: number;
  status: 'active' | 'reviewing' | 'mastered';
  createdAt: number;
  updatedAt: number;
}

export interface ReviewSchedule {
  mistakeId: string;
  stage: number;
  intervalDays: number;
  nextReviewAt: number;
  status: Mistake['status'];
}

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  relatedProblemIds: string[];
  relatedMistakeIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CodeTemplate {
  id: string;
  title: string;
  language: string;
  code: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DailyPlan {
  id: string;
  date: string;
  targetMinutes: number;
  targetProblems: number;
  targetAlgorithmProblems: number;
  targetInterviewQuestions: number;
  taskProblemIds: string[];
  reviewMistakeIds: string[];
  completedProblemIds: string[];
  focusTags: string[];
  difficultyRatio: { easy: number; medium: number; hard: number };
  createdAt: number;
  updatedAt: number;
}

export interface AiGeneration {
  id: string;
  problemId: string;
  attemptId?: string;
  level: 1 | 2 | 3 | 4 | 5;
  /** 生成来源，用于按题目和功能恢复教练回答。旧数据没有该字段时仍可读取。 */
  intent?: string;
  /** AI 解惑输入的问题，用于同一问题复用已有回答。 */
  userQuestion?: string;
  prompt: string;
  response: string;
  model: string;
  createdAt: number;
}

export interface AppSettings {
  aiBaseUrl: string;
  aiModel: string;
  hasAiCredential: boolean;
  defaultLanguage: string;
  editorFontSize: EditorFontSize;
  dailyTargetMinutes: number;
  dailyTargetProblems: number;
  dailyTargetInterviewQuestions: number;
  interviewCatalogVersion: number;
  /** 浏览器缓存仅保存内置面试题的稳定 ID，启动时从打包目录还原正文。 */
  browserCatalogCompact?: boolean;
  lastSolveProblemId?: string;
  privacyConfirmed: boolean;
  theme: AppTheme;
}

export interface BackupManifest {
  format: 'xiti-backup';
  version: 1;
  createdAt: number;
  appVersion: string;
  entityCounts: Record<string, number>;
  checksum?: string;
  includesCredentials: false;
  includesPlatformCookies: false;
}

export interface AppDataSnapshot {
  schemaVersion: 2;
  problems: Problem[];
  attempts: Attempt[];
  thoughtEvents: ThoughtEvent[];
  platformResults: PlatformResult[];
  mistakes: Mistake[];
  knowledgeNotes: KnowledgeNote[];
  codeTemplates: CodeTemplate[];
  dailyPlans: DailyPlan[];
  aiGenerations: AiGeneration[];
  settings: AppSettings;
  updatedAt: number;
}

export interface ImportResult {
  snapshot: AppDataSnapshot;
  added: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
}

export interface LearningStatistics {
  totalProblems: number;
  solvedProblems: number;
  totalAttempts: number;
  totalFocusSeconds: number;
  activeMistakes: number;
  masteredMistakes: number;
  dueReviews: number;
  solvedByDifficulty: Record<Difficulty, number>;
  attemptsByDay: Record<string, number>;
  weakTags: Array<{ tag: string; score: number; attempts: number; failures: number }>;
}

export interface PlanOptions {
  date?: string;
  targetProblems?: number;
  targetAlgorithmProblems?: number;
  targetInterviewQuestions?: number;
  targetMinutes?: number;
  now?: number;
  completedProblemIds?: string[];
}

export interface RunCodeRequest {
  language: string;
  code: string;
  input?: string;
  timeoutMs?: number;
}

export interface RunCodeResult {
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ProblemSampleRunRequest {
  problem: Problem;
  language: string;
  code: string;
  sampleIndex?: number;
  timeoutMs?: number;
}

export interface ProblemSampleRunResult extends RunCodeResult {
  sampleIndex: number;
  expectedOutput: string;
  actualOutput: string;
  passed?: boolean;
  generatedEntryPoint: boolean;
  mode: 'function' | 'stdin';
}

export type DebugCommand =
  | { type: 'start'; sessionId: string; code: string; language: string; input: string; breakpoints: number[] }
  | { type: 'continue' | 'step-over' | 'step-into' | 'step-out' | 'pause' | 'terminate'; sessionId: string };

export interface DebugSourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface DebugStackFrame {
  id: string;
  name: string;
  location: DebugSourceLocation;
}

export interface DebugScope {
  name: string;
  variables: Array<{ name: string; value: string; type: string }>;
}

export type DebugEvent =
  | { type: 'started'; sessionId: string; entryFile: string }
  | { type: 'paused'; sessionId: string; reason: 'breakpoint' | 'exception' | 'step'; location: DebugSourceLocation; stack: DebugStackFrame[]; scopes: DebugScope[] }
  | { type: 'output'; sessionId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'continued'; sessionId: string }
  | { type: 'completed'; sessionId: string; result: RunCodeResult }
  | { type: 'terminated'; sessionId: string; reason: string }
  | { type: 'error'; sessionId: string; code: string; message: string };
