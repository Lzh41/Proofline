import { invoke } from '@tauri-apps/api/core';
import type { AppDataSnapshot, Problem } from '../types';
import { createEmptySnapshot, normalizeSnapshot } from './data';

const STORAGE_KEY = 'xiti.app-data.v1';
export const READ_ONLY_REPOSITORY_MESSAGE = 'SQLite 读取失败后，本地回退数据处于只读状态；请刷新并重新连接主存储';

function compactBrowserSnapshot(snapshot: AppDataSnapshot): AppDataSnapshot {
  // 浏览器预览只把 SQLite 的可选缓存写入 localStorage。内置面试目录会在
  // Store 初始化时按稳定 catalogId 从打包目录还原，避免首次启动序列化近千道
  // 完整参考答案，并发页面争用 localStorage 存储锁导致主线程长时间卡住。
  if (isTauriRuntime()) return snapshot;
  const hasBuiltinInterview = snapshot.problems.some((problem) => (
    problem.kind === 'interview' && problem.interview?.contentOrigin === 'builtin' && problem.interview.catalogId
  ));
  if (!hasBuiltinInterview) return snapshot;
  return {
    ...snapshot,
    settings: { ...snapshot.settings, interviewCatalogVersion: snapshot.settings.interviewCatalogVersion, browserCatalogCompact: true },
    problems: snapshot.problems.map((problem) => {
      const interview = problem.interview;
      if (problem.kind !== 'interview' || interview?.contentOrigin !== 'builtin' || !interview.catalogId) return problem;
      return {
        id: problem.id,
        kind: 'interview',
        title: problem.title,
        createdAt: problem.createdAt,
        updatedAt: problem.updatedAt,
        interview: {
          catalogId: interview.catalogId,
          contentOrigin: 'builtin',
          archived: interview.archived,
        } as NonNullable<Problem['interview']>,
      } as Problem;
    }),
  };
}

export interface AppRepository {
  readonly kind: 'tauri-sqlite' | 'browser-local';
  isReadOnly(): boolean;
  load(): Promise<AppDataSnapshot>;
  save(snapshot: AppDataSnapshot): Promise<void>;
}

export class BrowserLocalRepository implements AppRepository {
  readonly kind = 'browser-local' as const;

  isReadOnly(): boolean {
    return false;
  }

  async load(): Promise<AppDataSnapshot> {
    if (typeof localStorage === 'undefined') return createEmptySnapshot();
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return createEmptySnapshot();
    try { return normalizeSnapshot(JSON.parse(text)); }
    catch { return createEmptySnapshot(); }
  }

  async save(snapshot: AppDataSnapshot): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compactBrowserSnapshot(snapshot)));
  }
}

export class TauriSqliteRepository implements AppRepository {
  readonly kind = 'tauri-sqlite' as const;

  isReadOnly(): boolean {
    return false;
  }

  async load(): Promise<AppDataSnapshot> {
    const value = await invoke<unknown>('load_app_data');
    if (value === null || value === undefined) return createEmptySnapshot();
    if (typeof value === 'string') return normalizeSnapshot(JSON.parse(value));
    return normalizeSnapshot(value);
  }

  async save(snapshot: AppDataSnapshot): Promise<void> {
    await invoke('save_app_data', { snapshot });
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export class ResilientRepository implements AppRepository {
  readonly kind = isTauriRuntime() ? 'tauri-sqlite' as const : 'browser-local' as const;
  private readonly local = new BrowserLocalRepository();
  private readonly tauri = new TauriSqliteRepository();
  private fallbackReadOnly = false;

  isReadOnly(): boolean {
    return this.fallbackReadOnly;
  }

  async load(): Promise<AppDataSnapshot> {
    if (!isTauriRuntime()) {
      this.fallbackReadOnly = false;
      return this.local.load();
    }
    let snapshot: AppDataSnapshot;
    try {
      snapshot = await this.tauri.load();
      this.fallbackReadOnly = false;
    } catch (error) {
      const cachedText = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
      if (cachedText) {
        try {
          const cached = JSON.parse(cachedText);
          if (cached && typeof cached === 'object' && Array.isArray(cached.problems) && Array.isArray(cached.attempts)) {
            this.fallbackReadOnly = true;
            return normalizeSnapshot(cached);
          }
        } catch {
          // A corrupted cache must not mask the primary SQLite read error.
        }
      }
      throw error;
    }

    try {
      await this.local.save(snapshot);
    } catch {
      // The SQLite snapshot remains authoritative when the optional browser cache cannot refresh.
    }
    return snapshot;
  }

  async save(snapshot: AppDataSnapshot): Promise<void> {
    if (!isTauriRuntime()) {
      await this.local.save(snapshot);
      return;
    }
    if (this.fallbackReadOnly) {
      throw new Error(READ_ONLY_REPOSITORY_MESSAGE);
    }
    await this.tauri.save(snapshot);
    try {
      await this.local.save(snapshot);
    } catch {
      // SQLite is authoritative; an optional cache failure must not turn a committed save into an error.
    }
  }
}

export const appRepository: AppRepository = new ResilientRepository();
