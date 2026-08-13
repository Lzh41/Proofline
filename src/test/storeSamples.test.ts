import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { INTERVIEW_CATALOG } from '../data/interviewCatalog';
import { catalogItemToProblem, INTERVIEW_CATALOG_VERSION } from '../lib/interviews';
import type { AppDataSnapshot, Problem } from '../types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  invoke: tauri.invoke,
}));

import { useAppStore } from '../store/useAppStore';

const STORAGE_KEY = 'xiti.app-data.v1';

function makeProblem(patch: Partial<Problem> = {}): Problem {
  return {
    id: patch.id ?? 'problem-1',
    kind: patch.kind ?? 'algorithm',
    title: patch.title ?? '旧标题',
    source: patch.source ?? 'manual',
    sourceUrl: patch.sourceUrl,
    externalId: patch.externalId,
    platformSlug: patch.platformSlug,
    difficulty: patch.difficulty ?? 'medium',
    tags: patch.tags ?? ['已有标签'],
    content: patch.content ?? '',
    constraints: patch.constraints ?? ['已有约束'],
    examples: patch.examples ?? [],
    codeSnippets: patch.codeSnippets ?? [{ language: 'TypeScript', languageSlug: 'typescript', code: 'function solve() {}' }],
    sampleTestCase: patch.sampleTestCase ?? '1',
    attachments: patch.attachments ?? [],
    platformStatus: patch.platformStatus ?? 'attempted',
    cacheStatus: patch.cacheStatus ?? 'manual',
    importMethod: patch.importMethod ?? 'manual',
    contentFetchedAt: patch.contentFetchedAt,
    contentHash: patch.contentHash,
    connectorVersion: patch.connectorVersion,
    createdAt: patch.createdAt ?? 100,
    updatedAt: patch.updatedAt ?? 100,
  };
}

function setStoreProblems(problems: Problem[]): void {
  useAppStore.setState({
    ...createEmptySnapshot(100),
    problems,
    initialized: true,
    loading: false,
    error: null,
    currentAttemptId: null,
  });
}

function enableTauriRuntime(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: { transformCallback: () => 1 },
  });
}

describe('题目样例恢复与元数据刷新', () => {
  beforeEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    tauri.invoke.mockReset();
    setStoreProblems([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('从本地正文补齐样例，合并时保留已有样例优先并持久化', async () => {
    const problem = makeProblem({
      content: `
示例 1：
输入：1
输出：2
解释：正文解释
示例 2：
输入：3
输出：4
      `,
      examples: [{ input: '1', output: '2', explanation: '已有解释' }],
    });
    setStoreProblems([problem]);

    const recovered = await useAppStore.getState().recoverProblemSamples(problem.id);

    expect(recovered.examples).toEqual([
      { input: '1', output: '2', explanation: '已有解释' },
      { input: '3', output: '4' },
    ]);
    expect(useAppStore.getState().problems[0]).toEqual(recovered);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').problems[0].examples).toEqual(recovered.examples);
  });

  it('样例保存期间的并发修改不会丢失且最终持久化最新状态', async () => {
    enableTauriRuntime();
    const problem = makeProblem({ content: '输入：1\n输出：2', examples: [] });
    setStoreProblems([problem]);
    const committed: AppDataSnapshot[] = [];
    let saveCalls = 0;
    let releaseFirstSave!: () => void;
    tauri.invoke.mockImplementation(async (command: string, args?: { snapshot?: AppDataSnapshot }) => {
      if (command !== 'save_app_data' || !args?.snapshot) throw new Error(`未预期的命令：${command}`);
      const snapshot = structuredClone(args.snapshot);
      saveCalls += 1;
      if (saveCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = () => {
            committed.push(snapshot);
            resolve();
          };
        });
        return undefined;
      }
      committed.push(snapshot);
      return undefined;
    });

    const recoverPromise = useAppStore.getState().recoverProblemSamples(problem.id);
    await vi.waitFor(() => expect(saveCalls).toBe(1));
    const updatePromise = useAppStore.getState().updateProblem(problem.id, { title: '并发更新后的标题' });

    expect(saveCalls).toBe(1);
    releaseFirstSave();
    await Promise.all([recoverPromise, updatePromise]);

    expect(useAppStore.getState().problems[0]).toMatchObject({
      title: '并发更新后的标题',
      examples: [{ input: '1', output: '2' }],
    });
    expect(committed.at(-1)?.problems[0]).toMatchObject({
      title: '并发更新后的标题',
      examples: [{ input: '1', output: '2' }],
    });
  });

  it('样例保存失败时保留原状态并设置全局保存错误', async () => {
    enableTauriRuntime();
    const problem = makeProblem({ content: '输入：1\n输出：2', examples: [] });
    setStoreProblems([problem]);
    tauri.invoke.mockRejectedValueOnce(new Error('SQLite 保存失败'));

    await expect(useAppStore.getState().recoverProblemSamples(problem.id)).rejects.toThrow('SQLite 保存失败');

    expect(useAppStore.getState().problems).toEqual([problem]);
    expect(useAppStore.getState().error).toBe('本地数据保存失败：SQLite 保存失败');
  });

  it('编辑样例保存失败时不发布未持久化的题目状态', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      examples: [{ input: '旧输入', output: '旧输出' }],
      updatedAt: 100,
    });
    setStoreProblems([problem]);
    tauri.invoke.mockRejectedValueOnce(new Error('SQLite 保存失败'));

    await expect(useAppStore.getState().updateProblem(problem.id, {
      examples: [{ input: '新输入', output: '新输出' }],
    })).rejects.toThrow('SQLite 保存失败');

    expect(useAppStore.getState().problems).toEqual([problem]);
    expect(useAppStore.getState().updatedAt).toBe(100);
    expect(useAppStore.getState().error).toBe('本地数据保存失败：SQLite 保存失败');
  });

  it('初始化只批量回填空样例的可解析旧题并且只保存一次', async () => {
    const snapshot = createEmptySnapshot(100);
    snapshot.problems = [
      makeProblem({ id: 'recover-1', content: '输入：1\n输出：2', examples: [] }),
      makeProblem({ id: 'recover-2', content: 'Input: 3\nOutput: 4', examples: [] }),
      makeProblem({ id: 'keep-existing', content: '输入：5\n输出：6', examples: [{ input: '旧', output: '样例' }] }),
      makeProblem({ id: 'unparseable', content: '这里没有结构化样例', examples: [] }),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useAppStore.setState({ initialized: false, loading: false });

    await useAppStore.getState().initialize();

    const originalProblemIds = new Set(snapshot.problems.map((problem) => problem.id));
    expect(useAppStore.getState().problems
      .filter((problem) => originalProblemIds.has(problem.id))
      .map((problem) => problem.examples)).toEqual([
      [{ input: '1', output: '2' }],
      [{ input: '3', output: '4' }],
      [{ input: '旧', output: '样例' }],
      [],
    ]);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('初始化回填与并发更新共用保存队列且不会覆盖最新题目状态', async () => {
    enableTauriRuntime();
    const problem = makeProblem({ content: '输入：1\n输出：2', examples: [] });
    const snapshot = createEmptySnapshot(100);
    snapshot.problems = [problem];
    setStoreProblems([problem]);
    useAppStore.setState({ initialized: false, loading: false });
    const committed: AppDataSnapshot[] = [];
    let saveCalls = 0;
    let releaseFirstSave!: () => void;
    tauri.invoke.mockImplementation(async (command: string, args?: { snapshot?: AppDataSnapshot }) => {
      if (command === 'load_app_data') return snapshot;
      if (command === 'has_ai_credential') return false;
      if (command !== 'save_app_data' || !args?.snapshot) throw new Error(`未预期的命令：${command}`);
      const savedSnapshot = structuredClone(args.snapshot);
      saveCalls += 1;
      if (saveCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = () => {
            committed.push(savedSnapshot);
            resolve();
          };
        });
        return undefined;
      }
      committed.push(savedSnapshot);
      return undefined;
    });

    const initializePromise = useAppStore.getState().initialize();
    await vi.waitFor(() => expect(saveCalls).toBe(1));
    const updatePromise = useAppStore.getState().updateProblem(problem.id, { title: '并发更新后的标题' });
    await Promise.resolve();
    await Promise.resolve();
    const saveCallsWhileInitializationBlocked = saveCalls;
    releaseFirstSave();
    await Promise.all([initializePromise, updatePromise]);

    expect(saveCallsWhileInitializationBlocked).toBe(1);
    expect(useAppStore.getState().problems[0]).toMatchObject({
      title: '并发更新后的标题',
      examples: [{ input: '1', output: '2' }],
    });
    expect(committed.at(-1)?.problems[0]).toMatchObject({
      title: '并发更新后的标题',
      examples: [{ input: '1', output: '2' }],
    });
  });

  it('本地数据加载完成前新增和更新题目会等待初始化且不会覆盖已有题库', async () => {
    enableTauriRuntime();
    const existing = makeProblem({
      id: 'existing-problem',
      title: '数据库中的原题',
      examples: [{ input: '1', output: '2' }],
    });
    const loaded = createEmptySnapshot(100);
    loaded.problems = [existing];
    setStoreProblems([existing]);
    useAppStore.setState({ initialized: false, loading: false });
    let releaseLoad!: () => void;
    let loadStarted = false;
    const committed: AppDataSnapshot[] = [];
    tauri.invoke.mockImplementation(async (command: string, args?: { snapshot?: AppDataSnapshot }) => {
      if (command === 'load_app_data') {
        loadStarted = true;
        await new Promise<void>((resolve) => { releaseLoad = resolve; });
        return loaded;
      }
      if (command === 'has_ai_credential') return false;
      if (command === 'save_app_data' && args?.snapshot) {
        committed.push(structuredClone(args.snapshot));
        return undefined;
      }
      throw new Error(`未预期的命令：${command}`);
    });

    const initializePromise = useAppStore.getState().initialize();
    await vi.waitFor(() => expect(loadStarted).toBe(true));
    const addPromise = useAppStore.getState().addProblem(makeProblem({ id: 'new-problem', title: '加载期间新增' }));
    const updatePromise = useAppStore.getState().updateProblem(existing.id, { title: '加载完成后更新' });
    await Promise.resolve();
    await Promise.resolve();
    const savesBeforeLoadCompleted = committed.length;
    releaseLoad();
    await Promise.all([initializePromise, addPromise, updatePromise]);

    expect(savesBeforeLoadCompleted).toBe(0);
    expect(useAppStore.getState().problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: existing.id, title: '加载完成后更新' }),
      expect.objectContaining({ id: 'new-problem', title: '加载期间新增' }),
    ]));
    expect(committed.at(-1)?.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: existing.id, title: '加载完成后更新' }),
      expect.objectContaining({ id: 'new-problem', title: '加载期间新增' }),
    ]));
  });

  it('初始化没有可回填变化时不额外保存', async () => {
    const snapshot = createEmptySnapshot(100);
    snapshot.settings.interviewCatalogVersion = INTERVIEW_CATALOG_VERSION;
    snapshot.problems = [
      makeProblem({ id: 'keep-existing', content: '输入：1\n输出：2', examples: [{ input: '旧', output: '样例' }] }),
      makeProblem({ id: 'unparseable', content: '没有输入输出字段', examples: [] }),
      ...INTERVIEW_CATALOG.map((item) => catalogItemToProblem(item, 100)),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useAppStore.setState({ initialized: false, loading: false });

    await useAppStore.getState().initialize();

    expect(setItem).not.toHaveBeenCalled();
    expect(useAppStore.getState().updatedAt).toBe(100);
    setItem.mockRestore();
  });

  it('初始化回填保存失败时不暴露或缓存未持久化的样例', async () => {
    enableTauriRuntime();
    const snapshot = createEmptySnapshot(100);
    snapshot.problems = [makeProblem({ content: '输入：1\n输出：2', examples: [] })];
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'load_app_data') return snapshot;
      if (command === 'has_ai_credential') return false;
      if (command === 'save_app_data') throw new Error('SQLite 保存失败');
      throw new Error(`未预期的命令：${command}`);
    });
    useAppStore.setState({ initialized: false, loading: false });

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().initialized).toBe(false);
    expect(useAppStore.getState().problems).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').problems[0].examples).toEqual([]);
  });

  it('平台刷新绕过新鲜缓存，用白名单合并远端字段和请求期间的最新题目', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      source: 'leetcode-cn',
      sourceUrl: 'https://leetcode.cn/problems/two-sum/',
      cacheStatus: 'fresh',
      contentFetchedAt: Date.now(),
      examples: [{ input: '[2,7]', output: '[0,1]', explanation: '已有解释' }],
    });
    setStoreProblems([problem]);
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'fetch_public_problem') {
        useAppStore.setState({
          problems: useAppStore.getState().problems.map((item) => item.id === problem.id
            ? { ...item, platformStatus: 'solved', examples: [...item.examples, { input: '[9,9]', output: '[0,1]' }] }
            : item),
        });
        return {
          id: 'remote-id',
          source: 'manual',
          sourceUrl: 'https://example.com/hijacked',
          title: '   ',
          externalId: '1',
          platformSlug: 'two-sum',
          difficulty: 'hard',
          tags: [],
          content: null,
          constraints: [],
          examples: [
            { input: '[2,7]', output: '[0,1]', explanation: '远端解释' },
            { input: '[3,3]', output: '[0,1]' },
          ],
          codeSnippets: [],
          sampleTestCase: null,
          attachments: [{ id: 'remote', name: 'x', mimeType: 'text/plain', path: 'x', size: 1, createdAt: 1 }],
          platformStatus: 'todo',
          cacheStatus: 'fresh',
          importMethod: 'connector',
          contentFetchedAt: 200,
          contentHash: 'hash-2',
          connectorVersion: 'desktop-2',
          createdAt: 1,
          updatedAt: 1,
        };
      }
      if (command === 'save_app_data') return undefined;
      throw new Error(`未预期的命令：${command}`);
    });

    const refreshed = await useAppStore.getState().refreshProblemMetadata(problem.id);

    expect(tauri.invoke).toHaveBeenCalledWith('fetch_public_problem', {
      source: 'leetcode-cn',
      url: problem.sourceUrl,
    });
    expect(refreshed).toMatchObject({
      id: problem.id,
      source: problem.source,
      sourceUrl: problem.sourceUrl,
      title: problem.title,
      externalId: '1',
      platformSlug: 'two-sum',
      difficulty: 'hard',
      tags: problem.tags,
      content: problem.content,
      constraints: problem.constraints,
      codeSnippets: problem.codeSnippets,
      sampleTestCase: problem.sampleTestCase,
      attachments: problem.attachments,
      platformStatus: 'solved',
      cacheStatus: 'fresh',
      importMethod: 'connector',
      contentFetchedAt: 200,
      contentHash: 'hash-2',
      connectorVersion: 'desktop-2',
      createdAt: problem.createdAt,
    });
    expect(refreshed.examples).toEqual([
      { input: '[2,7]', output: '[0,1]', explanation: '已有解释' },
      { input: '[9,9]', output: '[0,1]' },
      { input: '[3,3]', output: '[0,1]' },
    ]);
  });

  it('平台刷新失败时不修改内存状态或持久化数据', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      source: 'leetcode',
      sourceUrl: 'https://leetcode.com/problems/two-sum/',
      cacheStatus: 'fresh',
      contentFetchedAt: Date.now(),
      examples: [{ input: '[2,7]', output: '[0,1]' }],
    });
    setStoreProblems([problem]);
    const before = structuredClone(useAppStore.getState().problems);
    tauri.invoke.mockRejectedValueOnce(new Error('连接失败'));

    await expect(useAppStore.getState().refreshProblemMetadata(problem.id)).rejects.toThrow('连接失败');

    expect(useAppStore.getState().problems).toEqual(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
  });

  it('平台请求返回前来源链接变化时丢弃旧响应', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      source: 'leetcode',
      sourceUrl: 'https://leetcode.com/problems/two-sum/',
      title: '当前题目',
      examples: [{ input: '[2,7]', output: '[0,1]' }],
    });
    setStoreProblems([problem]);
    let releaseFetch!: () => void;
    let fetchStarted = false;
    const savedSnapshots: AppDataSnapshot[] = [];
    tauri.invoke.mockImplementation(async (command: string, args?: { snapshot?: AppDataSnapshot }) => {
      if (command === 'fetch_public_problem') {
        fetchStarted = true;
        await new Promise<void>((resolve) => { releaseFetch = resolve; });
        return {
          title: '旧链接返回的标题',
          examples: [{ input: '[9,9]', output: '[0,1]' }],
          contentFetchedAt: 200,
        };
      }
      if (command === 'save_app_data' && args?.snapshot) {
        savedSnapshots.push(structuredClone(args.snapshot));
        return undefined;
      }
      throw new Error(`未预期的命令：${command}`);
    });

    const refreshPromise = useAppStore.getState().refreshProblemMetadata(problem.id);
    await vi.waitFor(() => expect(fetchStarted).toBe(true));
    const newUrl = 'https://leetcode.com/problems/add-two-numbers/';
    await useAppStore.getState().updateProblem(problem.id, { sourceUrl: newUrl });
    releaseFetch();
    await refreshPromise;

    expect(useAppStore.getState().problems[0]).toMatchObject({
      sourceUrl: newUrl,
      title: '当前题目',
      examples: [{ input: '[2,7]', output: '[0,1]' }],
    });
    expect(savedSnapshots).toHaveLength(1);
    expect(savedSnapshots[0].problems[0]).toMatchObject({ sourceUrl: newUrl, title: '当前题目' });
  });

  it('平台抓取成功但 SQLite 保存失败时不修改内存或本地缓存', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      source: 'leetcode-cn',
      sourceUrl: 'https://leetcode.cn/problems/two-sum/',
      examples: [{ input: '[2,7]', output: '[0,1]' }],
    });
    setStoreProblems([problem]);
    const persisted = createEmptySnapshot(50);
    persisted.problems = [problem];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    const persistedBefore = localStorage.getItem(STORAGE_KEY);
    const problemsBefore = structuredClone(useAppStore.getState().problems);
    const updatedAtBefore = useAppStore.getState().updatedAt;
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'fetch_public_problem') return { title: '新标题', difficulty: 'hard' };
      if (command === 'save_app_data') throw new Error('SQLite 保存失败');
      throw new Error(`未预期的命令：${command}`);
    });

    await expect(useAppStore.getState().refreshProblemMetadata(problem.id)).rejects.toThrow('SQLite 保存失败');

    expect(useAppStore.getState().problems).toEqual(problemsBefore);
    expect(useAppStore.getState().updatedAt).toBe(updatedAtBefore);
    expect(useAppStore.getState().error).toBe('本地数据保存失败：SQLite 保存失败');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(persistedBefore);
  });

  it('远端 unknown 难度不覆盖已有明确难度', async () => {
    enableTauriRuntime();
    const problem = makeProblem({
      source: 'leetcode',
      sourceUrl: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'medium',
    });
    setStoreProblems([problem]);
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'fetch_public_problem') return { difficulty: 'unknown', contentFetchedAt: 200 };
      if (command === 'save_app_data') return undefined;
      throw new Error(`未预期的命令：${command}`);
    });

    const refreshed = await useAppStore.getState().refreshProblemMetadata(problem.id);

    expect(refreshed.difficulty).toBe('medium');
  });

  it.each([
    ['非平台题', makeProblem({ source: 'manual', sourceUrl: 'https://example.com/problem' })],
    ['没有来源链接的平台题', makeProblem({ source: 'nowcoder', sourceUrl: undefined })],
  ])('%s刷新时只执行本地恢复', async (_name, problem) => {
    problem.content = '样例：\n输入：local\n输出：restored';
    setStoreProblems([problem]);

    const refreshed = await useAppStore.getState().refreshProblemMetadata(problem.id);

    expect(refreshed.examples).toEqual([{ input: 'local', output: 'restored' }]);
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').problems[0].examples).toEqual(refreshed.examples);
  });

  it('批量导入只保存一次并保留已有题目状态', async () => {
    enableTauriRuntime();
    const existing = makeProblem({
      id: 'existing',
      source: 'leetcode-cn',
      externalId: '1',
      sourceUrl: 'https://leetcode.cn/problems/two-sum/?envType=study-plan',
      cacheStatus: 'link-only',
      importMethod: 'platform',
      content: '',
      examples: [],
      platformStatus: 'attempted',
    });
    setStoreProblems([existing]);
    let saveCalls = 0;
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'fetch_public_problem_range') {
        return {
          source: 'leetcode-cn',
          requestedCount: 2,
          fetchedCount: 1,
          paidOnlyCount: 1,
          notFoundCount: 0,
          failedCount: 0,
          cancelled: false,
          items: [
            {
              requestedId: '1',
              status: 'fetched',
              sourceUrl: 'https://leetcode.cn/problems/two-sum/',
              metadata: {
                title: '两数之和',
                externalId: '1',
                platformSlug: 'two-sum',
                difficulty: 'easy',
                tags: ['数组'],
                content: '完整题面',
                examples: [{ input: '2 7', output: '9' }],
                cacheStatus: 'fresh',
                importMethod: 'connector',
                contentFetchedAt: 200,
              },
            },
            {
              requestedId: '2',
              status: 'paid-only',
              sourceUrl: 'https://leetcode.cn/problems/add-two-numbers/',
              metadata: { title: '两数相加', externalId: '2', platformSlug: 'add-two-numbers', difficulty: 'medium' },
            },
          ],
        };
      }
      if (command === 'save_app_data') { saveCalls += 1; return undefined; }
      throw new Error(`未预期的命令：${command}`);
    });

    const summary = await useAppStore.getState().importPlatformProblems({ source: 'leetcode-cn', startId: 1, endId: 2 });
    const problems = useAppStore.getState().problems;

    expect(saveCalls).toBe(1);
    expect(summary.addedCount).toBe(1);
    expect(summary.updatedCount).toBe(1);
    expect(problems).toHaveLength(2);
    expect(problems.find((item) => item.externalId === '1')).toMatchObject({ content: '完整题面', cacheStatus: 'fresh', platformStatus: 'attempted' });
    expect(problems.find((item) => item.externalId === '2')).toMatchObject({ title: '两数相加', cacheStatus: 'link-only' });
  });

  it('批量导入保存失败时不发布未持久化题目', async () => {
    enableTauriRuntime();
    setStoreProblems([]);
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === 'fetch_public_problem_range') return {
        source: 'leetcode', requestedCount: 1, fetchedCount: 1, paidOnlyCount: 0, notFoundCount: 0, failedCount: 0, cancelled: false,
        items: [{ requestedId: '1', status: 'fetched', sourceUrl: 'https://leetcode.com/problems/two-sum/', metadata: { title: 'Two Sum', externalId: '1' } }],
      };
      if (command === 'save_app_data') throw new Error('SQLite 保存失败');
      throw new Error(`未预期的命令：${command}`);
    });

    await expect(useAppStore.getState().importPlatformProblems({ source: 'leetcode', startId: 1, endId: 1 })).rejects.toThrow('SQLite 保存失败');

    expect(useAppStore.getState().problems).toEqual([]);
  });
});
