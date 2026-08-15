import { Channel, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';
import type {
  AiGeneration,
  AppDataSnapshot,
  AppSettings,
  Attempt,
  DailyPlan,
  FinishInterviewInput,
  KnowledgeNote,
  LearningStatistics,
  Mistake,
  PlatformSource,
  PlatformBatchFetchResult,
  PlatformBatchFetchItem,
  PlatformBatchImportRequest,
  PlatformBatchImportSummary,
  PlatformBatchProgress,
  Problem,
  ProblemSampleRunRequest,
  ProblemSampleRunResult,
  RunCodeRequest,
  RunCodeResult,
  ThoughtEvent,
} from '../types';
import { INTERVIEW_CATALOG, INTERVIEW_CATALOG_VERSION } from '../data/interviewCatalog';
import {
  AiSseDecoder,
  buildHintPrompt,
  buildInterviewExaminerPrompt,
  buildInterviewPrompt,
  coachIntentLevel,
  extractAiResponseContent,
  parseInterviewExaminerResponse,
  type AiCoachIntent,
  type AiStreamEvent,
  type InterviewCoachIntent,
  type InterviewExaminerInput,
  type InterviewExaminerResult,
} from '../lib/ai';
import { parseExport, serializeExport } from '../lib/backup';
import { chooseTextFile, downloadTextFile } from '../lib/browserFiles';
import { createEmptySnapshot, normalizeSnapshot } from '../lib/data';
import { createId, uniqueStrings } from '../lib/ids';
import { importSnapshot } from '../lib/importer';
import { mergeInterviewCatalog } from '../lib/interviews';
import { searchKnowledge } from '../lib/knowledge';
import { generatePlan } from '../lib/planner';
import { fetchPublicProblem, inferProblemFromUrl, isSafeAiEndpoint } from '../lib/platform';
import { extractProblemExamples, mergeProblemExamples } from '../lib/problemExamples';
import { appRepository, READ_ONLY_REPOSITORY_MESSAGE } from '../lib/repository';
import { applyReviewResult, initialReviewSchedule } from '../lib/review';
import { runCode } from '../lib/runCode';
import { runProblemSample } from '../lib/problemRunner';
import { calculateStatistics, isSuccessfulAttempt } from '../lib/statistics';
import { readCachedTheme } from '../app/theme';

let browserAiKey = '';
let browserAiController: AbortController | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let initializationPromise: Promise<void> | null = null;

type AiHintRequest = {
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
};

interface AppStore extends AppDataSnapshot {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  currentAttemptId: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  addProblem: (input: Partial<Problem>) => Promise<Problem>;
  createProblem: (input: Partial<Problem>) => Promise<Problem>;
  updateProblem: (id: string, patch: Partial<Problem>) => Promise<void>;
  recoverProblemSamples: (id: string) => Promise<Problem>;
  refreshProblemMetadata: (id: string) => Promise<Problem>;
  startAttempt: (problemId: string, language?: string) => Promise<Attempt>;
  startInterviewAttempt: (problemId: string) => Promise<Attempt>;
  updateAttempt: (id: string, patch: Partial<Attempt>) => Promise<void>;
  saveInterviewDraft: (attemptId: string, answerText: string) => Promise<void>;
  finishInterviewAttempt: (attemptId: string, input: FinishInterviewInput) => Promise<void>;
  finishAttempt: (id: string, patch: Partial<Attempt>) => Promise<void>;
  addThoughtEvent: (input: Partial<ThoughtEvent>) => Promise<ThoughtEvent>;
  addMistake: (input: Partial<Mistake>) => Promise<Mistake>;
  completeReview: (mistakeId: string, success: boolean) => Promise<void>;
  addKnowledgeNote: (input: Partial<KnowledgeNote>) => Promise<KnowledgeNote>;
  createKnowledgeNote: (input: Partial<KnowledgeNote>) => Promise<KnowledgeNote>;
  updateKnowledgeNote: (id: string, patch: Partial<KnowledgeNote>) => Promise<void>;
  savePlan: (input: Partial<DailyPlan>) => Promise<DailyPlan>;
  generateDailyPlan: (options?: Record<string, unknown>) => Promise<DailyPlan>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  restoreInterviewCatalog: () => Promise<number>;
  openPlatform: (source: PlatformSource) => Promise<void>;
  arrangePlatform: (source: PlatformSource) => Promise<void>;
  bindCurrentProblem: (source: PlatformSource) => Promise<Problem>;
  importPlatformProblems: (request: PlatformBatchImportRequest, onProgress?: (progress: PlatformBatchProgress) => void) => Promise<PlatformBatchImportSummary>;
  cancelPlatformProblemImport: () => Promise<void>;
  clearPlatformProfile: (source: PlatformSource) => Promise<void>;
  saveAiCredential: (key: string) => Promise<void>;
  deleteAiCredential: () => Promise<void>;
  testAiConnection: () => Promise<boolean>;
  requestAiHint: (payload: AiHintRequest) => Promise<string>;
  analyzeRecentPractice: () => Promise<KnowledgeNote | null>;
  requestInterviewExaminer: (input: InterviewExaminerInput) => Promise<InterviewExaminerResult>;
  cancelAiRequest: () => Promise<void>;
  createBackup: () => Promise<string>;
  restoreBackup: () => Promise<void>;
  exportData: () => Promise<void>;
  importData: () => Promise<void>;
  openDataDirectory: () => Promise<void>;
  deleteAllUserData: (includeBackups: boolean) => Promise<void>;
  runCode: (request: RunCodeRequest) => Promise<RunCodeResult>;
  runProblemSample: (request: ProblemSampleRunRequest) => Promise<ProblemSampleRunResult>;
  getStatistics: () => LearningStatistics;
  searchKnowledge: (query: string) => ReturnType<typeof searchKnowledge>;
  searchKnowledgeFts: (query: string) => Promise<KnowledgeNote[]>;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function snapshotFrom(state: AppStore): AppDataSnapshot {
  return {
    schemaVersion: 2,
    problems: state.problems,
    attempts: state.attempts,
    thoughtEvents: state.thoughtEvents,
    platformResults: state.platformResults,
    mistakes: state.mistakes,
    knowledgeNotes: state.knowledgeNotes,
    codeTemplates: state.codeTemplates,
    dailyPlans: state.dailyPlans,
    aiGenerations: state.aiGenerations,
    settings: state.settings,
    updatedAt: Date.now(),
  };
}

function enqueuePersistence<T>(task: () => Promise<T>): Promise<T> {
  const queued = persistenceQueue.then(task);
  persistenceQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

async function waitForInitialization(): Promise<void> {
  const pending = initializationPromise;
  if (pending) await pending;
  if (appRepository.isReadOnly()) throw new Error(READ_ONLY_REPOSITORY_MESSAGE);
  const state = useAppStore.getState();
  if (!state.initialized) throw new Error(state.error ?? '个人数据尚未完成初始化');
}

async function saveState(get: () => AppStore, set: (patch: Partial<AppStore>) => void): Promise<void> {
  await waitForInitialization();
  return enqueuePersistence(async () => {
    try {
      const snapshot = snapshotFrom(get());
      await appRepository.save(snapshot);
      set({ updatedAt: snapshot.updatedAt, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: `本地数据保存失败：${message}` });
      throw error;
    }
  });
}

async function persistProblems(
  get: () => AppStore,
  set: (patch: Partial<AppStore>) => void,
  updateProblems: (problems: Problem[], updatedAt: number) => Problem[],
): Promise<void> {
  await waitForInitialization();
  return enqueuePersistence(async () => {
    const state = get();
    const snapshot = snapshotFrom(state);
    const problems = updateProblems(state.problems, snapshot.updatedAt);
    if (problems === state.problems) return;
    snapshot.problems = problems;
    await appRepository.save(snapshot);
    const latestProblems = get().problems;
    set({
      problems: latestProblems === state.problems
        ? problems
        : updateProblems(latestProblems, snapshot.updatedAt),
      updatedAt: snapshot.updatedAt,
      error: null,
    });
  });
}

function nowProblem(input: Partial<Problem>): Problem {
  const now = Date.now();
  return {
    id: input.id ?? createId('problem'),
    kind: input.kind ?? 'algorithm',
    title: input.title?.trim() || '未命名题目',
    source: input.source ?? 'manual',
    sourceUrl: input.sourceUrl,
    externalId: input.externalId,
    platformSlug: input.platformSlug,
    difficulty: input.difficulty ?? 'unknown',
    tags: uniqueStrings(input.tags ?? []),
    content: input.content ?? '',
    constraints: uniqueStrings(input.constraints ?? []),
    examples: input.examples ?? [],
    codeSnippets: input.codeSnippets ?? [],
    sampleTestCase: input.sampleTestCase,
    attachments: input.attachments ?? [],
    platformStatus: input.platformStatus ?? 'todo',
    cacheStatus: input.cacheStatus ?? 'manual',
    importMethod: input.importMethod ?? 'manual',
    contentFetchedAt: input.contentFetchedAt,
    contentHash: input.contentHash,
    connectorVersion: input.connectorVersion,
    interview: input.interview,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function isPlatformSource(source: Problem['source']): source is PlatformSource {
  return source === 'leetcode-cn' || source === 'leetcode' || source === 'nowcoder';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function planTarget(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label}必须是非负整数`);
  return value;
}

function mergeRefreshedProblem(existing: Problem, incoming: Partial<Problem>, updatedAt = Date.now()): Problem {
  const merged = { ...existing };
  const title = nonEmptyString(incoming.title);
  const content = nonEmptyString(incoming.content);
  const externalId = nonEmptyString(incoming.externalId);
  const platformSlug = nonEmptyString(incoming.platformSlug);
  const sampleTestCase = nonEmptyString(incoming.sampleTestCase);
  const contentHash = nonEmptyString(incoming.contentHash);
  const connectorVersion = nonEmptyString(incoming.connectorVersion);
  const tags = Array.isArray(incoming.tags)
    ? uniqueStrings(incoming.tags.filter((value): value is string => typeof value === 'string'))
    : [];

  if (title) merged.title = title.trim();
  if (externalId) merged.externalId = externalId;
  if (platformSlug) merged.platformSlug = platformSlug;
  if (incoming.difficulty === 'easy' || incoming.difficulty === 'medium' || incoming.difficulty === 'hard') {
    merged.difficulty = incoming.difficulty;
  }
  if (tags.length > 0) merged.tags = tags;
  if (content) merged.content = content;
  if (Array.isArray(incoming.examples) && incoming.examples.length > 0) {
    merged.examples = mergeProblemExamples(existing.examples, incoming.examples);
  }
  if (Array.isArray(incoming.codeSnippets) && incoming.codeSnippets.length > 0) {
    merged.codeSnippets = incoming.codeSnippets;
  }
  if (sampleTestCase) merged.sampleTestCase = sampleTestCase;
  if (incoming.cacheStatus === 'fresh' || incoming.cacheStatus === 'stale' || incoming.cacheStatus === 'link-only' || incoming.cacheStatus === 'manual') {
    merged.cacheStatus = incoming.cacheStatus;
  }
  if (incoming.importMethod === 'platform' || incoming.importMethod === 'connector' || incoming.importMethod === 'url' || incoming.importMethod === 'manual' || incoming.importMethod === 'ocr' || incoming.importMethod === 'import') {
    merged.importMethod = incoming.importMethod;
  }
  if (typeof incoming.contentFetchedAt === 'number' && Number.isFinite(incoming.contentFetchedAt)) {
    merged.contentFetchedAt = incoming.contentFetchedAt;
  }
  if (contentHash) merged.contentHash = contentHash;
  if (connectorVersion) merged.connectorVersion = connectorVersion;
  merged.updatedAt = updatedAt;
  return merged;
}

function problemFromBatchItem(source: PlatformSource, item: PlatformBatchFetchItem): Problem | null {
  if (!item.sourceUrl || (item.status !== 'fetched' && item.status !== 'paid-only')) return null;
  const inferred = inferProblemFromUrl(source, item.sourceUrl);
  const metadata = item.metadata ?? {};
  return nowProblem({
    ...inferred,
    ...metadata,
    id: inferred.id,
    kind: 'algorithm',
    source,
    sourceUrl: item.sourceUrl,
    externalId: metadata.externalId ?? item.requestedId,
    platformSlug: metadata.platformSlug ?? inferred.platformSlug,
    cacheStatus: item.status === 'paid-only' ? 'link-only' : 'fresh',
    importMethod: item.status === 'paid-only' ? 'url' : 'connector',
    examples: metadata.examples ?? [],
    attachments: [],
    platformStatus: 'todo',
  });
}

function examplesEqual(left: Problem['examples'], right: Problem['examples']): boolean {
  return left.length === right.length && left.every((example, index) => {
    const other = right[index];
    return example.input === other?.input
      && example.output === other.output
      && example.explanation === other.explanation;
  });
}

function platformTemplateForLanguage(problem: Problem, language: string): string {
  const normalized = language.trim().toLowerCase().replace(/\s+/g, '');
  const aliases = normalized === 'cpp' || normalized === 'c++' || normalized === 'cpp17' || normalized === 'c++17'
    ? new Set(['cpp', 'c++', 'cpp17', 'c++17'])
    : normalized === 'python' || normalized === 'python3'
      ? new Set(['python', 'python3'])
      : normalized === 'javascript' || normalized === 'js'
        ? new Set(['javascript', 'js'])
        : normalized === 'typescript' || normalized === 'ts'
          ? new Set(['typescript', 'ts'])
          : new Set([normalized]);
  return problem.codeSnippets?.find((snippet) => {
    const slug = snippet.languageSlug.trim().toLowerCase().replace(/\s+/g, '');
    const name = snippet.language.trim().toLowerCase().replace(/\s+/g, '');
    return aliases.has(slug) || aliases.has(name);
  })?.code ?? '';
}

function makeMistake(input: Partial<Mistake>): Mistake {
  const now = Date.now();
  const schedule = initialReviewSchedule(now);
  if (!input.problemId) throw new Error('错题必须关联题目');
  return {
    id: input.id ?? createId('mistake'),
    problemId: input.problemId,
    attemptId: input.attemptId,
    category: input.category ?? 'other',
    rootCause: input.rootCause ?? '本次练习未通过，待补充根因',
    correction: input.correction ?? '',
    nextChecklistItem: input.nextChecklistItem ?? '重新独立推导并检查边界条件',
    reviewStage: input.reviewStage ?? schedule.stage,
    intervalDays: input.intervalDays ?? schedule.intervalDays,
    nextReviewAt: input.nextReviewAt ?? schedule.nextReviewAt,
    lastReviewedAt: input.lastReviewedAt,
    successfulReviews: input.successfulReviews ?? 0,
    failedReviews: input.failedReviews ?? 0,
    status: input.status ?? 'active',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

async function browserAiRequest(settings: AppSettings, prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
  if (!browserAiKey) throw new Error('请先保存 AI 密钥');
  if (!settings.aiModel.trim()) throw new Error('请先填写模型 ID');
  if (!isSafeAiEndpoint(settings.aiBaseUrl)) throw new Error('AI 接口地址必须使用 HTTPS；本机服务仅允许 localhost/127.0.0.1。');
  if (new TextEncoder().encode(prompt).byteLength > 120 * 1024) throw new Error('发送给 AI 的内容超过 120 KB，请缩短题面或历史上下文。');
  browserAiController?.abort();
  const controller = new AbortController();
  browserAiController = controller;
  const timer = globalThis.setTimeout(() => controller.abort(new Error('AI 请求超时（60 秒）')), 60_000);
  try {
    const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${browserAiKey}` },
      body: JSON.stringify({ model: settings.aiModel, messages: [{ role: 'user', content: prompt }], stream: true }),
    });
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024) throw new Error('AI 非流式响应超过 2 MB，已中止。');
      const content = extractAiResponseContent(JSON.parse(raw));
      if (!content.trim()) throw new Error('AI 服务没有返回有效内容');
      onChunk?.(content);
      return content;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('AI 服务没有返回可读取的流');
    const textDecoder = new TextDecoder();
    const sseDecoder = new AiSseDecoder();
    let content = '';
    let streamBytes = 0;
    let completed = false;
    const accept = (events: AiStreamEvent[]) => {
      for (const event of events) {
        if (event.event === 'delta') {
          streamBytes += new TextEncoder().encode(event.content).byteLength;
          if (streamBytes > 512 * 1024) throw new Error('AI 流式响应超过 512 KB，已中止。');
          content += event.content;
          onChunk?.(event.content);
        } else if (event.event === 'error') {
          throw new Error(event.message);
        } else {
          completed = true;
        }
      }
    };
    while (!completed) {
      const result = await reader.read();
      if (result.done) break;
      accept(sseDecoder.push(textDecoder.decode(result.value, { stream: true })));
    }
    if (completed) await reader.cancel();
    else {
      accept(sseDecoder.push(textDecoder.decode()));
      accept(sseDecoder.finish());
    }
    if (!content.trim()) throw new Error('AI 服务没有返回有效内容');
    return content;
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('AI 请求已取消');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    if (browserAiController === controller) browserAiController = null;
  }
}

function decodeSnapshot(value: unknown): AppDataSnapshot {
  if (typeof value === 'string') return parseExport(value);
  if (value && typeof value === 'object' && 'snapshot' in value) return parseExport(JSON.stringify(value));
  return normalizeSnapshot(value);
}

export const useAppStore = create<AppStore>((set, get) => {
  const empty = createEmptySnapshot();
  const cachedTheme = readCachedTheme();
  if (cachedTheme) empty.settings.theme = cachedTheme;
  return {
    ...empty,
    initialized: false,
    loading: false,
    error: null,
    currentAttemptId: null,

    initialize: () => {
      if (get().initialized) return Promise.resolve();
      if (initializationPromise) return initializationPromise;
      if (get().loading) return Promise.resolve();
      set({ loading: true, error: null });
      const operation = enqueuePersistence(async () => {
        try {
          const snapshot = await appRepository.load();
          const readOnly = appRepository.isReadOnly();
          let recoveredSamples = false;
          let catalogUpdated = false;
          const recoveredAt = Date.now();
          if (!readOnly) {
            snapshot.problems = snapshot.problems.map((problem) => {
              if (problem.kind === 'interview') return problem;
              if (problem.examples.length > 0) return problem;
              const examples = extractProblemExamples(problem.content);
              if (examples.length === 0) return problem;
              recoveredSamples = true;
              return { ...problem, examples, updatedAt: recoveredAt };
            });
            const interviewCount = snapshot.problems.filter((problem) => problem.kind === 'interview' && problem.interview?.contentOrigin === 'builtin').length;
            if (snapshot.settings.browserCatalogCompact) {
              // 浏览器缓存里的内置题只保留 catalogId；用原快照时间还原，避免每次刷新
              // 都改写 1083 道题的 updatedAt，也避免重新写入完整目录缓存。
              snapshot.problems = mergeInterviewCatalog(snapshot.problems, INTERVIEW_CATALOG, snapshot.updatedAt, INTERVIEW_CATALOG_VERSION);
              snapshot.settings = { ...snapshot.settings, interviewCatalogVersion: INTERVIEW_CATALOG_VERSION };
            } else if (
              snapshot.settings.interviewCatalogVersion <= INTERVIEW_CATALOG_VERSION
              && (snapshot.settings.interviewCatalogVersion < INTERVIEW_CATALOG_VERSION || interviewCount < INTERVIEW_CATALOG.length)
            ) {
              snapshot.problems = mergeInterviewCatalog(snapshot.problems, INTERVIEW_CATALOG, recoveredAt, INTERVIEW_CATALOG_VERSION);
              snapshot.settings = { ...snapshot.settings, interviewCatalogVersion: INTERVIEW_CATALOG_VERSION };
              catalogUpdated = true;
            }
          }
          if (isTauriRuntime()) {
            const hasAiCredential = await invoke<boolean>('has_ai_credential').catch(() => false);
            snapshot.settings = { ...snapshot.settings, hasAiCredential };
          } else {
            // 浏览器预览只把密钥放在当前会话内存，不把 localStorage 的旧标记当成真实凭据。
            snapshot.settings = { ...snapshot.settings, hasAiCredential: false };
          }
          if (recoveredSamples || catalogUpdated) {
            snapshot.updatedAt = Date.now();
            await appRepository.save(snapshot);
          }
          set({
            ...snapshot,
            initialized: true,
            loading: false,
            error: readOnly ? READ_ONLY_REPOSITORY_MESSAGE : null,
            currentAttemptId: snapshot.attempts.find((item) => !item.endedAt)?.id ?? null,
          });
        } catch (error) {
          set({ initialized: false, loading: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
      const tracked = operation.finally(() => {
        if (initializationPromise === tracked) initializationPromise = null;
      });
      initializationPromise = tracked;
      return tracked;
    },
    refresh: async () => {
      set({ initialized: false });
      await get().initialize();
    },
    addProblem: async (input) => {
      await waitForInitialization();
      const problem = nowProblem(input);
      const incoming = createEmptySnapshot();
      incoming.problems = [problem];
      const imported = importSnapshot(snapshotFrom(get()), incoming);
      set({ problems: imported.snapshot.problems });
      await saveState(get, set);
      return get().problems.find((item) => item.id === problem.id || (problem.sourceUrl && item.sourceUrl === problem.sourceUrl)) ?? problem;
    },
    createProblem: async (input) => get().addProblem(input),
    updateProblem: async (id, patch) => {
      await waitForInitialization();
      if (patch.examples !== undefined) {
        try {
          await persistProblems(get, set, (problems, updatedAt) => problems.map((item) => item.id === id
            ? { ...item, ...patch, id, updatedAt }
            : item));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          set({ error: `本地数据保存失败：${message}` });
          throw error;
        }
        return;
      }
      set({ problems: get().problems.map((item) => item.id === id ? { ...item, ...patch, id, updatedAt: Date.now() } : item) });
      await saveState(get, set);
    },
    recoverProblemSamples: async (id) => {
      await waitForInitialization();
      const problem = get().problems.find((item) => item.id === id);
      if (!problem) throw new Error('题目不存在');
      const examples = mergeProblemExamples(problem.examples, extractProblemExamples(problem.content));
      if (examplesEqual(problem.examples, examples)) return problem;
      try {
        await persistProblems(get, set, (problems, updatedAt) => problems.map((item) => {
          if (item.id !== id) return item;
          const recoveredExamples = mergeProblemExamples(item.examples, extractProblemExamples(item.content));
          return examplesEqual(item.examples, recoveredExamples)
            ? item
            : { ...item, examples: recoveredExamples, updatedAt };
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ error: `本地数据保存失败：${message}` });
        throw error;
      }
      return get().problems.find((item) => item.id === id) ?? problem;
    },
    refreshProblemMetadata: async (id) => {
      await waitForInitialization();
      const problem = get().problems.find((item) => item.id === id);
      if (!problem) throw new Error('题目不存在');
      if (!isPlatformSource(problem.source) || !problem.sourceUrl) {
        return get().recoverProblemSamples(id);
      }

      const publicData = isTauriRuntime()
        ? await invoke<Partial<Problem>>('fetch_public_problem', { source: problem.source, url: problem.sourceUrl })
        : await fetchPublicProblem(problem.source, problem.sourceUrl);
      const latestProblem = get().problems.find((item) => item.id === id);
      if (!latestProblem) throw new Error('题目不存在');
      if (latestProblem.source !== problem.source || latestProblem.sourceUrl !== problem.sourceUrl) return latestProblem;
      try {
        await persistProblems(get, set, (problems, updatedAt) => {
          const current = problems.find((item) => item.id === id);
          if (!current || current.source !== problem.source || current.sourceUrl !== problem.sourceUrl) return problems;
          return problems.map((item) => item.id === id
            ? mergeRefreshedProblem(item, publicData, updatedAt)
            : item);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ error: `本地数据保存失败：${message}` });
        throw error;
      }
      return get().problems.find((item) => item.id === id) ?? problem;
    },
    startAttempt: async (problemId, language) => {
      await waitForInitialization();
      const problem = get().problems.find((item) => item.id === problemId);
      if (!get().problems.some((item) => item.id === problemId)) throw new Error('题目不存在');
      const now = Date.now();
      const attemptLanguage = language ?? get().settings.defaultLanguage;
      const previousInterviewAnswer = problem?.kind === 'interview'
        ? get().attempts
          .filter((item) => item.problemId === problemId && item.mode === 'interview' && item.interview?.answerText?.trim())
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.interview?.answerText ?? ''
        : '';
      const attempt: Attempt = { id: createId('attempt'), problemId, mode: problem?.kind === 'interview' ? 'interview' : 'code', language: attemptLanguage, code: problem?.kind === 'interview' ? '' : problem ? platformTemplateForLanguage(problem, attemptLanguage) : '', startedAt: now, durationSeconds: 0, result: 'unfinished', hintLevel: 0, independent: true, mastery: 1, interview: problem?.kind === 'interview' ? { answerText: previousInterviewAnswer } : undefined, createdAt: now, updatedAt: now };
      set({ attempts: [attempt, ...get().attempts], currentAttemptId: attempt.id, problems: get().problems.map((item) => item.id === problemId ? { ...item, platformStatus: 'attempted', updatedAt: now } : item) });
      await saveState(get, set);
      return attempt;
    },
    startInterviewAttempt: async (problemId) => {
      const problem = get().problems.find((item) => item.id === problemId);
      if (!problem || problem.kind !== 'interview') throw new Error('面试题不存在');
      return get().startAttempt(problemId, 'interview');
    },
    updateAttempt: async (id, patch) => {
      await waitForInitialization();
      set({ attempts: get().attempts.map((item) => item.id === id ? { ...item, ...patch, id, updatedAt: Date.now() } : item) });
      await saveState(get, set);
    },
    saveInterviewDraft: async (attemptId, answerText) => {
      const attempt = get().attempts.find((item) => item.id === attemptId);
      if (!attempt || attempt.mode !== 'interview') throw new Error('面试练习记录不存在');
      await get().updateAttempt(attemptId, {
        interview: { ...attempt.interview, answerText },
      });
    },
    finishInterviewAttempt: async (attemptId, input) => {
      const attempt = get().attempts.find((item) => item.id === attemptId);
      const problem = attempt ? get().problems.find((item) => item.id === attempt.problemId) : undefined;
      if (!attempt || attempt.mode !== 'interview' || problem?.kind !== 'interview') throw new Error('面试练习记录不存在');
      await get().finishAttempt(attemptId, {
        result: input.masteryResult,
        mastery: input.masteryResult === 'mastered' ? 5 : input.masteryResult === 'uncertain' ? 3 : 1,
        independent: true,
        notes: input.omissions,
        interview: {
          answerText: input.answerText,
          aiFeedback: input.aiFeedback,
          omissions: input.omissions,
          improvedAnswer: input.improvedAnswer,
          masteryResult: input.masteryResult,
        },
      });
    },
    finishAttempt: async (id, patch) => {
      await waitForInitialization();
      const existing = get().attempts.find((item) => item.id === id);
      if (!existing) throw new Error('练习记录不存在');
      const now = Date.now();
      const completed = { ...existing, ...patch, id, endedAt: patch.endedAt ?? now, updatedAt: now };
      const problem = get().problems.find((item) => item.id === existing.problemId);
      const passed = isSuccessfulAttempt(problem?.kind ?? 'algorithm', completed.result);
      let mistakes = get().mistakes;
      if (!passed && completed.result !== 'aborted' && !mistakes.some((item) => item.problemId === existing.problemId && item.status !== 'mastered')) {
        mistakes = [makeMistake({
          problemId: existing.problemId,
          attemptId: id,
          category: problem?.kind === 'interview' ? 'incomplete' : 'other',
          rootCause: completed.interview?.omissions || undefined,
          correction: completed.interview?.improvedAnswer || '',
          nextChecklistItem: problem?.kind === 'interview' ? '先覆盖参考要点，再用项目实例完整口述' : undefined,
        }), ...mistakes];
      }
      const plans = get().dailyPlans.map((plan) => plan.taskProblemIds.includes(existing.problemId) && passed
        ? { ...plan, completedProblemIds: uniqueStrings([...plan.completedProblemIds, existing.problemId]), updatedAt: now }
        : plan);
      set({
        attempts: get().attempts.map((item) => item.id === id ? completed : item),
        mistakes,
        dailyPlans: plans,
        currentAttemptId: get().currentAttemptId === id ? null : get().currentAttemptId,
        problems: get().problems.map((item) => item.id === existing.problemId ? { ...item, platformStatus: passed ? 'solved' : 'attempted', updatedAt: now } : item),
      });
      await saveState(get, set);
    },
    addThoughtEvent: async (input) => {
      await waitForInitialization();
      if (!input.attemptId) throw new Error('思路记录必须关联练习');
      const event: ThoughtEvent = { id: input.id ?? createId('thought'), attemptId: input.attemptId, type: input.type ?? 'note', content: input.content?.trim() ?? '', createdAt: input.createdAt ?? Date.now() };
      set({ thoughtEvents: [...get().thoughtEvents, event] });
      await saveState(get, set);
      return event;
    },
    addMistake: async (input) => {
      await waitForInitialization();
      const mistake = makeMistake(input);
      set({ mistakes: [mistake, ...get().mistakes] });
      await saveState(get, set);
      return mistake;
    },
    completeReview: async (mistakeId, success) => {
      await waitForInitialization();
      set({ mistakes: get().mistakes.map((item) => item.id === mistakeId ? applyReviewResult(item, success) : item) });
      await saveState(get, set);
    },
    addKnowledgeNote: async (input) => {
      await waitForInitialization();
      const now = Date.now();
      const note: KnowledgeNote = { id: input.id ?? createId('note'), title: input.title?.trim() || '未命名笔记', content: input.content ?? '', tags: uniqueStrings(input.tags ?? []), relatedProblemIds: uniqueStrings(input.relatedProblemIds ?? []), relatedMistakeIds: uniqueStrings(input.relatedMistakeIds ?? []), createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now };
      set({ knowledgeNotes: [note, ...get().knowledgeNotes] });
      await saveState(get, set);
      return note;
    },
    createKnowledgeNote: async (input) => get().addKnowledgeNote(input),
    updateKnowledgeNote: async (id, patch) => {
      await waitForInitialization();
      set({ knowledgeNotes: get().knowledgeNotes.map((item) => item.id === id ? { ...item, ...patch, id, updatedAt: Date.now() } : item) });
      await saveState(get, set);
    },
    savePlan: async (input) => {
      await waitForInitialization();
      const now = Date.now();
      const usesSplitTargets = input.targetAlgorithmProblems !== undefined || input.targetInterviewQuestions !== undefined;
      const usesLegacyTarget = !usesSplitTargets && input.targetProblems !== undefined;
      const targetAlgorithmProblems = planTarget(
        usesLegacyTarget ? input.targetProblems! : input.targetAlgorithmProblems ?? get().settings.dailyTargetProblems,
        '算法题目标',
      );
      const targetInterviewQuestions = planTarget(
        usesLegacyTarget ? 0 : input.targetInterviewQuestions ?? get().settings.dailyTargetInterviewQuestions,
        '面试题目标',
      );
      const targetProblems = targetAlgorithmProblems + targetInterviewQuestions;
      const plan: DailyPlan = { id: input.id ?? createId('plan'), date: input.date ?? new Date().toISOString().slice(0, 10), targetMinutes: input.targetMinutes ?? get().settings.dailyTargetMinutes, targetProblems, targetAlgorithmProblems, targetInterviewQuestions, taskProblemIds: uniqueStrings(input.taskProblemIds ?? []), reviewMistakeIds: uniqueStrings(input.reviewMistakeIds ?? []), completedProblemIds: uniqueStrings(input.completedProblemIds ?? []), focusTags: uniqueStrings(input.focusTags ?? []), difficultyRatio: input.difficultyRatio ?? { easy: 30, medium: 50, hard: 20 }, createdAt: input.createdAt ?? now, updatedAt: now };
      const index = get().dailyPlans.findIndex((item) => item.id === plan.id || item.date === plan.date);
      const dailyPlans = [...get().dailyPlans];
      if (index >= 0) dailyPlans[index] = { ...dailyPlans[index], ...plan, id: dailyPlans[index].id, createdAt: dailyPlans[index].createdAt };
      else dailyPlans.unshift(plan);
      set({ dailyPlans });
      await saveState(get, set);
      return index >= 0 ? dailyPlans[index] : plan;
    },
    generateDailyPlan: async (options = {}) => {
      await waitForInitialization();
      const hasLegacyTarget = typeof options.targetProblems === 'number'
        && typeof options.targetAlgorithmProblems !== 'number'
        && typeof options.targetInterviewQuestions !== 'number';
      const generated = generatePlan(get().problems, get().attempts, get().mistakes, {
        date: typeof options.date === 'string' ? options.date : undefined,
        ...(hasLegacyTarget
          ? { targetProblems: options.targetProblems as number }
          : {
              targetAlgorithmProblems: typeof options.targetAlgorithmProblems === 'number' ? options.targetAlgorithmProblems : get().settings.dailyTargetProblems,
              targetInterviewQuestions: typeof options.targetInterviewQuestions === 'number' ? options.targetInterviewQuestions : get().settings.dailyTargetInterviewQuestions,
            }),
        targetMinutes: typeof options.targetMinutes === 'number' ? options.targetMinutes : get().settings.dailyTargetMinutes,
        completedProblemIds: get().dailyPlans.find((plan) => plan.date === (typeof options.date === 'string' ? options.date : new Date().toISOString().slice(0, 10)))?.completedProblemIds ?? [],
      });
      return get().savePlan(generated);
    },
    updateSettings: async (patch) => {
      if (!initializationPromise && !get().initialized && !get().error) return;
      await waitForInitialization();
      if (!get().initialized || get().loading) return;
      set({ settings: { ...get().settings, ...patch } });
      await saveState(get, set);
    },
    restoreInterviewCatalog: async () => {
      await waitForInitialization();
      const now = Date.now();
      const problems = mergeInterviewCatalog(get().problems, INTERVIEW_CATALOG, now, INTERVIEW_CATALOG_VERSION);
      set({
        problems,
        settings: { ...get().settings, interviewCatalogVersion: INTERVIEW_CATALOG_VERSION },
      });
      await saveState(get, set);
      return problems.filter((problem) => problem.kind === 'interview' && problem.interview?.contentOrigin === 'builtin').length;
    },
    openPlatform: async (source) => {
      if (isTauriRuntime()) await invoke('open_platform', { source });
      else window.open(source === 'leetcode-cn' ? 'https://leetcode.cn/problemset/' : source === 'leetcode' ? 'https://leetcode.com/problemset/' : 'https://www.nowcoder.com/exam/oj', '_blank', 'noopener,noreferrer');
    },
    arrangePlatform: async (source) => {
      if (isTauriRuntime()) await invoke('arrange_platform', { source });
      else await get().openPlatform(source);
    },
    bindCurrentProblem: async (source) => {
      await waitForInitialization();
      if (!isTauriRuntime()) throw new Error('浏览器预览无法读取另一标签页地址，请粘贴单题链接建立学习卡');
      const url = await invoke<string>('get_platform_current_url', { source });
      const cached = get().problems.find((item) => item.source === source && item.sourceUrl === url);
      if (cached?.cacheStatus === 'fresh' && cached.contentFetchedAt && Date.now() - cached.contentFetchedAt < 7 * 24 * 60 * 60 * 1000) {
        return cached;
      }
      let problem = inferProblemFromUrl(source, url);
      try {
        const publicData = isTauriRuntime()
          ? await invoke<Partial<Problem>>('fetch_public_problem', { source, url })
          : await fetchPublicProblem(source, url);
        problem = { ...problem, ...publicData };
      }
      catch { /* 连接器失败时保留安全的链接型学习卡 */ }
      return get().addProblem(problem);
    },
    importPlatformProblems: async (request, onProgress) => {
      await waitForInitialization();
      if (!isTauriRuntime()) throw new Error('批量导入需要桌面应用运行时');
      if (!Number.isInteger(request.startId) || !Number.isInteger(request.endId) || request.startId < 1 || request.endId < 1) {
        throw new Error('题号必须是正整数');
      }
      const onEvent = new Channel<PlatformBatchProgress>();
      onEvent.onmessage = (event) => onProgress?.(event);
      const result = await invoke<PlatformBatchFetchResult>('fetch_public_problem_range', {
        source: request.source,
        startId: request.startId,
        endId: request.endId,
        onEvent,
      });
      const incoming = createEmptySnapshot();
      incoming.problems = result.items
        .map((item) => problemFromBatchItem(request.source, item))
        .filter((item): item is Problem => Boolean(item));
      let counts = { added: 0, updated: 0, skipped: 0 };
      await persistProblems(get, set, (problems, updatedAt) => {
        const current = snapshotFrom(get());
        current.problems = problems;
        current.updatedAt = updatedAt;
        const imported = importSnapshot(current, incoming);
        counts = {
          added: imported.added.problems ?? 0,
          updated: imported.updated.problems ?? 0,
          skipped: imported.skipped.problems ?? 0,
        };
        return imported.snapshot.problems;
      });
      return {
        ...result,
        addedCount: counts.added,
        updatedCount: counts.updated,
        skippedCount: counts.skipped,
      };
    },
    cancelPlatformProblemImport: async () => {
      if (isTauriRuntime()) await invoke('cancel_public_problem_range');
    },
    clearPlatformProfile: async (source) => {
      if (!isTauriRuntime()) throw new Error('浏览器预览没有平台登录会话');
      await invoke('clear_platform_profile', { source });
    },
    saveAiCredential: async (key) => {
      await waitForInitialization();
      if (!key.trim()) throw new Error('密钥不能为空');
      if (isTauriRuntime()) await invoke('save_ai_credential', { key: key.trim() });
      else browserAiKey = key.trim();
      await get().updateSettings({ hasAiCredential: true });
    },
    deleteAiCredential: async () => {
      await waitForInitialization();
      if (isTauriRuntime()) await invoke('delete_ai_credential');
      browserAiKey = '';
      await get().updateSettings({ hasAiCredential: false });
    },
    testAiConnection: async () => {
      if (!get().settings.hasAiCredential) throw new Error('请先保存 AI 密钥');
      if (!get().settings.aiModel.trim()) throw new Error('请先填写模型 ID');
      if (isTauriRuntime()) return invoke<boolean>('test_ai_connection', { baseUrl: get().settings.aiBaseUrl, model: get().settings.aiModel });
      await browserAiRequest(get().settings, '仅回复“连接成功”。');
      return true;
    },
    requestAiHint: async (payload) => {
      await waitForInitialization();
      if (!get().settings.hasAiCredential) throw new Error('请先在设置中保存 AI 密钥');
      if (!get().settings.aiModel.trim()) throw new Error('请先在设置中填写模型 ID');
      if (!get().settings.privacyConfirmed) throw new Error('发送题面前需要确认隐私提示');
      const problem = get().problems.find((item) => item.id === payload.problemId);
      if (!problem) throw new Error('题目不存在');
      const attempt = get().attempts.find((item) => item.id === payload.attemptId);
      const level = payload.intent
        ? coachIntentLevel(payload.intent)
        : Math.min(5, Math.max(1, Number(payload.level ?? 1))) as 1 | 2 | 3 | 4 | 5;
      const notes = searchKnowledge(get().knowledgeNotes, problem.tags.join(' ')).slice(0, 5).map((item) => item.note);
      const interviewIntent = payload.intent?.startsWith('interview-')
        ? payload.intent as InterviewCoachIntent
        : undefined;
      const prompt = problem.kind === 'interview' && interviewIntent
        ? buildInterviewPrompt({
            intent: interviewIntent,
            problem,
            answerText: payload.answerText ?? attempt?.interview?.answerText ?? '',
            previousFeedback: payload.previousGuidance,
            userQuestion: payload.userQuestion,
          })
        : buildHintPrompt({
            level,
            intent: payload.intent as AiCoachIntent | undefined,
            problem,
            attempt,
            code: payload.code,
            language: payload.language,
            notes,
            previousGuidance: payload.previousGuidance,
            recentRunError: payload.recentRunError,
            userQuestion: payload.userQuestion,
            teachingStep: payload.teachingStep,
            stepDeliverable: payload.stepDeliverable,
            analysisContext: payload.analysisContext,
          });
      const onChunk = payload.onChunk;
      let response: string;
      if (isTauriRuntime()) {
        const onEvent = new Channel<AiStreamEvent>();
        onEvent.onmessage = (event) => {
          if (event.event === 'delta') onChunk?.(event.content);
        };
        response = await invoke<string>('request_ai_hint', {
          baseUrl: get().settings.aiBaseUrl,
          model: get().settings.aiModel,
          prompt,
          intent: payload.intent,
          onEvent,
        });
      } else {
        response = await browserAiRequest(get().settings, prompt, onChunk);
      }
      await waitForInitialization();
      const generation: AiGeneration = {
        id: createId('ai'),
        problemId: problem.id,
        attemptId: attempt?.id,
        level,
        intent: payload.intent,
        userQuestion: payload.userQuestion?.trim() || undefined,
        prompt,
        response,
        model: get().settings.aiModel,
        createdAt: Date.now(),
      };
      const intentLabels: Record<AiCoachIntent | InterviewCoachIntent, string> = {
        analyze: '分析当前代码',
        'algorithm-logic': '算法逻辑拆解',
        'next-code': '获取下一段提示',
        debug: '解释运行问题',
        explain: 'AI 解惑',
        complete: '获取完整代码',
        'interview-follow-up': '进行模拟追问',
        'interview-critique': '点评面试回答',
        'interview-omissions': '检查回答遗漏',
        'interview-improve': '优化完整回答',
      };
      const thought = attempt ? { id: createId('thought'), attemptId: attempt.id, type: 'hint' as const, content: payload.intent ? intentLabels[payload.intent] : `使用 ${level} 级提示`, createdAt: Date.now() } : undefined;
      const replacePreviousCoachAnswer = Boolean(
        !payload.userQuestion?.trim()
        && ['analyze', 'algorithm-logic', 'next-code', 'debug', 'complete'].includes(payload.intent ?? ''),
      );
      const retainedGenerations = replacePreviousCoachAnswer
        ? get().aiGenerations.filter((item) => !(item.problemId === problem.id && item.intent === payload.intent))
        : get().aiGenerations;
      set({
        aiGenerations: [generation, ...retainedGenerations],
        thoughtEvents: thought ? [...get().thoughtEvents, thought] : get().thoughtEvents,
        attempts: attempt ? get().attempts.map((item) => item.id === attempt.id ? { ...item, hintLevel: Math.max(item.hintLevel, level) as Attempt['hintLevel'], independent: false, updatedAt: Date.now() } : item) : get().attempts,
      });
      await saveState(get, set);
      return response;
    },
    analyzeRecentPractice: async () => {
      await waitForInitialization();
      const state = get();
      const analyzedProblemIds = new Set(
        state.knowledgeNotes
          .filter((note) => note.tags.includes('AI练习分析'))
          .flatMap((note) => note.relatedProblemIds),
      );
      const pendingAttempts = state.attempts
        .filter((attempt) => attempt.mode === 'code' && attempt.endedAt && attempt.result !== 'unfinished' && attempt.result !== 'aborted' && !analyzedProblemIds.has(attempt.problemId))
        .sort((left, right) => (right.endedAt ?? right.updatedAt) - (left.endedAt ?? left.updatedAt));
      const pending = pendingAttempts
        .map((attempt) => ({ attempt, problem: state.problems.find((item) => item.id === attempt.problemId) }))
        .filter((item): item is { attempt: Attempt; problem: Problem } => Boolean(item.problem))
        .filter((item, index, items) => items.findIndex((candidate) => candidate.problem.id === item.problem.id) === index)
        .reverse();
      if (!pending.length) return null;

      const context = pending.map(({ attempt, problem }, index) => [
        `练习 ${index + 1}`,
        `题目：${problem.externalId ? `${problem.externalId}. ` : ''}${problem.title}`,
        `标签：${problem.tags.join('、') || '无'}`,
        `结果：${attempt.result}`,
        `用时：${attempt.durationSeconds} 秒`,
        `代码：\n${attempt.code.slice(0, 6_000) || '未记录代码'}`,
        `练习笔记：${attempt.notes?.slice(0, 1_000) || '无'}`,
      ].join('\n')).join('\n\n');
      const primary = pending[0];
      const response = await get().requestAiHint({
        problemId: primary.problem.id,
        attemptId: primary.attempt.id,
        intent: 'explain',
        userQuestion: '请把下面这些最近新增的练习整理成一篇可复习的知识笔记。按共同考点、每题关键思路、错误模式、可迁移模板、下一轮复习清单组织内容；不要泛泛鼓励，要指出代码和结果能证明的具体问题。所有题目都要覆盖。',
        analysisContext: context,
      });
      const tags = uniqueStrings(['AI练习分析', ...Array.from(new Set(pending.flatMap(({ problem }) => problem.tags))).slice(0, 8)]);
      return get().addKnowledgeNote({
        title: `练习复盘 · ${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date())}`,
        content: response,
        tags,
        relatedProblemIds: pending.map(({ problem }) => problem.id),
        relatedMistakeIds: state.mistakes.filter((mistake) => pending.some(({ problem }) => problem.id === mistake.problemId)).map((mistake) => mistake.id),
      });
    },
    requestInterviewExaminer: async (input) => {
      await waitForInitialization();
      if (!get().settings.hasAiCredential) throw new Error('请先在设置中保存 AI 密钥');
      if (!get().settings.aiModel.trim()) throw new Error('请先在设置中填写模型 ID');
      if (!get().settings.privacyConfirmed) throw new Error('发送技术主题前需要确认隐私提示');
      const prompt = buildInterviewExaminerPrompt(input);
      let response: string;
      if (isTauriRuntime()) {
        const onEvent = new Channel<AiStreamEvent>();
        onEvent.onmessage = () => undefined;
        response = await invoke<string>('request_ai_hint', {
          baseUrl: get().settings.aiBaseUrl,
          model: get().settings.aiModel,
          prompt,
          intent: 'interview-examiner',
          onEvent,
        });
      } else {
        response = await browserAiRequest(get().settings, prompt);
      }
      return parseInterviewExaminerResponse(response);
    },
    cancelAiRequest: async () => {
      if (isTauriRuntime()) await invoke('cancel_ai_request');
      browserAiController?.abort(new Error('AI 请求已取消'));
      browserAiController = null;
    },
    createBackup: async () => {
      const snapshot = snapshotFrom(get());
      if (isTauriRuntime()) return invoke<string>('create_backup', { snapshot });
      const name = `Proofline备份_${new Date().toISOString().replace(/[:.]/g, '-')}.xiti-backup.json`;
      downloadTextFile(name, serializeExport(snapshot));
      return name;
    },
    restoreBackup: async () => {
      await waitForInitialization();
      let value: unknown;
      if (isTauriRuntime()) {
        const path = await open({ multiple: false, filters: [{ name: 'Proofline 备份', extensions: ['zip'] }] });
        if (!path) return;
        value = await invoke<unknown>('restore_backup', { path });
      } else value = parseExport(await chooseTextFile());
      if (!value) return;
      await waitForInitialization();
      const snapshot = decodeSnapshot(value);
      snapshot.settings.hasAiCredential = get().settings.hasAiCredential;
      set({ ...snapshot });
      await saveState(get, set);
    },
    exportData: async () => {
      const snapshot = snapshotFrom(get());
      if (isTauriRuntime()) await invoke('export_data', { snapshot });
      else downloadTextFile(`Proofline数据_${new Date().toISOString().slice(0, 10)}.json`, serializeExport(snapshot));
    },
    importData: async () => {
      await waitForInitialization();
      let value: unknown;
      if (isTauriRuntime()) {
        const path = await open({ multiple: false, filters: [{ name: 'Proofline JSON', extensions: ['json'] }] });
        if (!path) return;
        value = await invoke<unknown>('import_data', { path });
      } else value = parseExport(await chooseTextFile());
      if (!value) return;
      await waitForInitialization();
      const incoming = decodeSnapshot(value);
      const result = importSnapshot(snapshotFrom(get()), incoming);
      set({ ...result.snapshot });
      await saveState(get, set);
    },
    openDataDirectory: async () => {
      if (!isTauriRuntime()) throw new Error('浏览器预览没有应用数据目录');
      await invoke('open_data_directory');
    },
    deleteAllUserData: async (includeBackups) => {
      await waitForInitialization();
      if (isTauriRuntime()) {
        await invoke('delete_all_user_data', { includeBackups });
      } else {
        localStorage.removeItem('xiti.app-data.v1');
        browserAiKey = '';
      }
      const emptySnapshot = createEmptySnapshot();
      set({ ...emptySnapshot, initialized: true, loading: false, error: null, currentAttemptId: null });
    },
    runCode,
    runProblemSample,
    getStatistics: () => calculateStatistics(get().problems, get().attempts, get().mistakes),
    searchKnowledge: (query) => searchKnowledge(get().knowledgeNotes, query),
    searchKnowledgeFts: async (query) => {
      if (isTauriRuntime()) {
        try { return await invoke<KnowledgeNote[]>('search_knowledge', { query }); }
        catch { /* 旧数据库或 FTS 不可用时回退到本地索引 */ }
      }
      return searchKnowledge(get().knowledgeNotes, query).map((item) => item.note);
    },
  };
});
