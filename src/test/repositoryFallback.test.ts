import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { ResilientRepository } from '../lib/repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('SQLite 读取失败回退', () => {
  beforeEach(() => {
    localStorage.clear();
    Reflect.set(window, '__TAURI_INTERNALS__', {});
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('全新空数据库返回空快照且不会把旧缓存当作主数据', async () => {
    const stale = createEmptySnapshot(100);
    stale.settings.theme = 'light';
    localStorage.setItem('xiti.app-data.v1', JSON.stringify(stale));
    vi.mocked(invoke).mockResolvedValueOnce(null);
    const repository = new ResilientRepository();

    const loaded = await repository.load();

    expect(loaded).toMatchObject({
      schemaVersion: 2,
      problems: [],
      attempts: [],
      mistakes: [],
      settings: { theme: 'dark' },
    });
    expect(loaded.updatedAt).not.toBe(100);
    expect(repository.isReadOnly()).toBe(false);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('load_app_data');
    expect(JSON.parse(localStorage.getItem('xiti.app-data.v1') ?? '{}').updatedAt).toBe(loaded.updatedAt);
  });

  it('没有有效本地快照时保留读取错误，禁止把空库当成初始化成功', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SQLite 暂时不可用'));

    await expect(new ResilientRepository().load()).rejects.toThrow('SQLite 暂时不可用');
  });

  it('SQLite 读取成功后即使缓存刷新失败也始终使用最新主快照', async () => {
    const stale = createEmptySnapshot(100);
    const current = createEmptySnapshot(200);
    current.settings.theme = 'light';
    localStorage.setItem('xiti.app-data.v1', JSON.stringify(stale));
    vi.mocked(invoke).mockResolvedValueOnce(current);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('本地缓存空间不足');
    });

    const loaded = await new ResilientRepository().load();

    expect(loaded.settings.theme).toBe('light');
    expect(loaded.updatedAt).toBe(200);
  });

  it('SQLite 保存失败时不覆盖本地缓存', async () => {
    const cached = createEmptySnapshot(100);
    const incoming = createEmptySnapshot(200);
    localStorage.setItem('xiti.app-data.v1', JSON.stringify(cached));
    const cachedText = localStorage.getItem('xiti.app-data.v1');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SQLite 保存失败'));

    await expect(new ResilientRepository().save(incoming)).rejects.toThrow('SQLite 保存失败');

    expect(localStorage.getItem('xiti.app-data.v1')).toBe(cachedText);
  });

  it('回退到本地旧缓存后保持只读直到 SQLite 再次读取成功', async () => {
    const cached = createEmptySnapshot(100);
    const current = createEmptySnapshot(200);
    const incoming = createEmptySnapshot(300);
    localStorage.setItem('xiti.app-data.v1', JSON.stringify(cached));
    const cachedText = localStorage.getItem('xiti.app-data.v1');
    const repository = new ResilientRepository();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('SQLite 暂时不可用'));

    await expect(repository.load()).resolves.toMatchObject({ updatedAt: 100 });
    expect(repository.isReadOnly()).toBe(true);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await expect(repository.save(incoming)).rejects.toThrow('只读');

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('xiti.app-data.v1')).toBe(cachedText);

    vi.mocked(invoke).mockResolvedValueOnce(current).mockResolvedValueOnce(undefined);
    await expect(repository.load()).resolves.toMatchObject({ updatedAt: 200 });
    expect(repository.isReadOnly()).toBe(false);
    await expect(repository.save(incoming)).resolves.toBeUndefined();

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'load_app_data',
      'load_app_data',
      'save_app_data',
    ]);
    expect(JSON.parse(localStorage.getItem('xiti.app-data.v1') ?? '{}').updatedAt).toBe(300);
  });

  it('SQLite 保存成功后本地缓存刷新失败不影响主存储成功', async () => {
    const incoming = createEmptySnapshot(200);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('本地缓存空间不足');
    });

    await expect(new ResilientRepository().save(incoming)).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith('save_app_data', { snapshot: incoming });
  });
});
