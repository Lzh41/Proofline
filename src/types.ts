import type { VocabularyDifficulty, VocabularyProgress, VocabularyReview, VocabularyScope, VocabularySessionState, VocabularyWord } from './lib/vocabulary';

export type PlatformSource = 'leetcode-cn' | 'leetcode' | 'nowcoder' | 'luogu';
export type PlatformBatchItemStatus = 'fetched' | 'paid-only' | 'not-found' | 'failed' | 'cancelled';
export type ProblemSource = PlatformSource | 'manual' | 'screenshot';
export type ProblemKind = 'algorithm' | 'interview';
/** 算法题的判题入口：函数题由应用生成入口，完整题由代码自行读写标准输入。 */
export type AlgorithmMode = 'function' | 'stdin';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'unknown';
export type ProblemStatus = 'todo' | 'attempted' | 'solved' | 'unknown';
export type AttemptResult = 'sample-passed' | 'sample-failed' | 'accepted' | 'wrong-answer' | 'timeout' | 'aborted' | 'unfinished' | 'mastered' | 'uncertain' | 'unknown';
export type AttemptMode = 'code' | 'interview';
export type MistakeCategory = 'concept' | 'implementation' | 'boundary' | 'complexity' | 'reading' | 'incomplete' | 'unclear' | 'no-example' | 'other';
export type AppTheme = 'light' | 'dark' | 'system';
export type EditorFontSize = 14 | 16 | 18 | 20 | 22;
export type InterviewFormat = 'knowledge' | 'scenario' | 'system-design' | 'project';
export type InterviewContentOrigin = 'builtin' | 'user' | 'import' | 'ai';

/** 通用 Web UI 工作台。站点数据留在独立 WebView2 profile，快照只保存恢复所需元数据。 */
export interface WebWorkspace {
  id: string;
  name: string;
  homeUrl: string;
  allowedHosts: string[];
  profileKey: string;
  description?: string;
  lastUrl?: string;
  lastOpenedAt?: number;
  status?: 'idle' | 'open' | 'stopped' | 'error' | 'unknown';
  createdAt: number;
  updatedAt: number;
}

/** 可由 Proofline 管理的本地工具及其服务启动配置。不会保存密钥或 WebView Cookie。 */
export interface LocalTool {
  id: string;
  name: string;
  description?: string;
  /** 由 GitHub 助手下载的公开仓库地址；不包含凭据。 */
  repositoryUrl?: string;
  /** GitHub 源码在本机的根目录，便于复查来源和后续更新。 */
  sourceRoot?: string;
  installerPath?: string;
  installerArgs?: string[];
  launcherPath?: string;
  launcherArgs?: string[];
  workingDirectory?: string;
  profileRoot?: string;
  workspaceId?: string;
  serviceUrl?: string;
  servicePid?: number;
  status: 'not-installed' | 'installed' | 'running' | 'stopped' | 'error';
  lastError?: string;
  installedAt?: number;
  lastStartedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** GitHub 公开仓库的只读分析结果；不会保存凭据或执行仓库内容。 */
export interface GithubToolFile {
  path: string;
  content: string;
}

export interface GithubToolInspection {
  repositoryUrl: string;
  htmlUrl: string;
  fullName: string;
  owner: string;
  repo: string;
  name: string;
  description?: string;
  defaultBranch: string;
  language?: string;
  stars?: number;
  files: string[];
  readme?: string;
  setupFiles: GithubToolFile[];
}

/** AI 生成的候选配置只允许使用仓库内相对路径，执行前必须由用户确认。 */
export interface GithubToolInstallPlan {
  repositoryUrl: string;
  name: string;
  description: string;
  installerPath?: string;
  installerArgs: string[];
  launcherPath?: string;
  launcherArgs: string[];
  workingDirectory?: string;
  serviceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
  installSteps: string[];
  notes: string[];
  requiresConfirmation: true;
}

export interface GithubToolPrepareResult {
  repositoryUrl: string;
  sourcePath: string;
  installerPath?: string;
  launcherPath?: string;
  workingDirectory: string;
  /** 下载阶段为需要本地发布资产的工具补充的安装参数。 */
  installerArgs?: string[];
  launcherArgs?: string[];
  files: string[];
}

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
  algorithmMode?: AlgorithmMode;
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
  algorithmMode?: AlgorithmMode;
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
  targetVocabularyWords: number;
  taskProblemIds: string[];
  taskVocabularyWordIds: string[];
  reviewMistakeIds: string[];
  completedProblemIds: string[];
  completedVocabularyWordIds: string[];
  /** 今日计划中已经完成预览背诵的词；用于关闭应用后恢复预览进度。 */
  vocabularyPreviewedWordIds?: string[];
  /** 今日计划中标记为“不熟悉”的词，生成次日计划时会作为额外词带入。 */
  vocabularyUnfamiliarWordIds?: string[];
  /** 从前一日不熟悉队列带入的额外词，不占用当日新词目标。 */
  vocabularyExtraWordIds?: string[];
  /** 明日计划中仅因前一日“不熟”新增的词；取消标记时从任务中移除。 */
  vocabularyExtraOnlyWordIds?: string[];
  focusTags: string[];
  difficultyRatio: { easy: number; medium: number; hard: number };
  vocabularyDifficulty: VocabularyDifficulty | 'all';
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

export interface ReviewHistory {
  /** 已复习过的算法题 ID 列表 */
  algorithmReviewedIds: string[];
  /** 已复习过的面试题 ID 列表 */
  interviewReviewedIds: string[];
  lastAlgorithmReviewAt?: number;
  lastInterviewReviewAt?: number;
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
  dailyTargetVocabularyWords: number;
  /** 词汇页最后一次选择的方向/难度，关闭应用后恢复。 */
  lastVocabularyDifficulty?: VocabularyScope;
  vocabularySessions?: Partial<Record<VocabularyScope, VocabularySessionState>>;
  interviewCatalogVersion: number;
  /** 浏览器缓存仅保存内置面试题的稳定 ID，启动时从打包目录还原正文。 */
  browserCatalogCompact?: boolean;
  lastSolveProblemId?: string;
  /** 做题页按题型分别记住最近打开的题目，避免切换题型后回到第一题。 */
  lastSolveProblemByMode?: Partial<Record<'function' | 'stdin', string>>;
  solveProblemAreaHeight?: number;
  solveProblemTextWidth?: number;
  solveWorkbenchCodeWidth?: number;
  solveTerminalHeight?: number;
  privacyConfirmed: boolean;
  theme: AppTheme;
  reviewHistory?: ReviewHistory;
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
  vocabularyWords: VocabularyWord[];
  vocabularyProgress: VocabularyProgress[];
  vocabularyReviews: VocabularyReview[];
  aiGenerations: AiGeneration[];
  webWorkspaces?: WebWorkspace[];
  localTools?: LocalTool[];
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
  targetVocabularyWords?: number;
  now?: number;
  completedProblemIds?: string[];
  vocabularyDifficulty?: VocabularyScope;
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
