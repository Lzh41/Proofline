import { invoke } from '@tauri-apps/api/core';
import type { AppDataSnapshot, Problem } from '../types';
import { VOCABULARY_CATALOG_FULL } from '../data/vocabularyCatalog';
import { createEmptySnapshot, normalizeSnapshot } from './data';

const STORAGE_KEY = 'xiti.app-data.v1';
const BUILTIN_VOCABULARY_IDS = new Set(VOCABULARY_CATALOG_FULL.map((word) => word.id));
export const READ_ONLY_REPOSITORY_MESSAGE = 'SQLite 读取失败后，本地回退数据处于只读状态；请刷新并重新连接主存储';

// ────────────────────────────────────────────────────────
// 性能关键：持久化前剥离打包内置的词库词条。
//
// 内置词库有 11,000+ 词条，全量 JSON 约 3.5MB。旧逻辑每次保存
// （刷词输入防抖、做题草稿、计时落盘等）都把整份词库序列化两遍
// （Tauri invoke 参数 + localStorage 镜像），主线程单次阻塞可达
// 数十毫秒，是做题页和刷词页输入卡顿的主因。
//
// 数据安全性：加载时 normalizeVocabularyWords 会用 VOCABULARY_CATALOG_FULL
// 重建完整词表，且快照中与内置词条同 id 的数据本来就会被忽略 ——
// 剥离后加载结果完全一致，无数据丢失。
// ────────────────────────────────────────────────────────
function stripBuiltinVocabulary(snapshot: AppDataSnapshot): AppDataSnapshot {
  const kept = snapshot.vocabularyWords.filter((word) => !BUILTIN_VOCABULARY_IDS.has(word.id));
  if (kept.length === snapshot.vocabularyWords.length) return snapshot;
  return { ...snapshot, vocabularyWords: kept };
}

function compactBrowserSnapshot(snapshot: AppDataSnapshot): AppDataSnapshot {
  // 内置词条在 Tauri 与浏览器两种运行时都剥离（见 stripBuiltinVocabulary 注释）。
  snapshot = stripBuiltinVocabulary(snapshot);
  // 纯浏览器缓存额外省略内置面试正文；加载时从稳定 catalogId 恢复，
  // 避免词库扩充后占满 localStorage。
  if (isTauriRuntime()) return snapshot;
  const hasBuiltinInterview = snapshot.problems.some((problem) => (
    problem.kind === 'interview' && problem.interview?.contentOrigin === 'builtin' && problem.interview.catalogId
  ));
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      interviewCatalogVersion: snapshot.settings.interviewCatalogVersion,
      browserCatalogCompact: hasBuiltinInterview || snapshot.settings.browserCatalogCompact === true,
    },
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
    // Tauri invoke 参数在主线程做 JSON 序列化，剥离内置词条避免每次保存
    // 序列化 3.5MB 词库（Rust 端按不透明 JSON 存储剥离对加载完全透明）。
    await invoke('save_app_data', { snapshot: stripBuiltinVocabulary(snapshot) });
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
