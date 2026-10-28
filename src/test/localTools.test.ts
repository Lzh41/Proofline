import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, createSeedLocalTools, normalizeLocalTools, normalizeSnapshot } from '../lib/data';
import { portFromUrl } from '../lib/localTools';
import { importSnapshot } from '../lib/importer';

describe('本机工具清单', () => {
  it('首次加载注入内置清单，id 唯一且都带本地地址与端口', () => {
    const tools = createSeedLocalTools();
    expect(tools).toHaveLength(6);
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
      expect(tool.port).toBeGreaterThan(0);
      expect(tool.category).not.toBe('');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.origin).toBe('seed');
    }
  });

  it('空快照自带内置清单', () => {
    expect(createEmptySnapshot().localTools).toHaveLength(6);
  });

  it('旧快照没有 localTools 字段时补上内置清单', () => {
    const raw = { ...createEmptySnapshot() } as Record<string, unknown>;
    delete raw.localTools;
    expect(normalizeSnapshot(raw).localTools).toHaveLength(6);
  });

  it('用户删光后不会自己长回来', () => {
    expect(normalizeSnapshot({ ...createEmptySnapshot(), localTools: [] }).localTools).toEqual([]);
  });

  it('丢掉缺少必需字段的脏条目，超范围端口只丢端口不丢条目', () => {
    const tools = normalizeLocalTools([
      { id: 'a', name: 'ok', category: '评测', description: '', url: 'http://127.0.0.1:1/', port: 1 },
      { id: 'b', name: '   ', category: 'x', description: '', url: 'http://127.0.0.1:2/' },
      { id: 'c', name: '超范围端口', category: 'x', description: '', url: 'http://127.0.0.1:3/', port: 70_000 },
      null,
      'nope',
    ]);
    expect(tools.map((tool) => tool.id)).toEqual(['a', 'c']);
    expect(tools[1].port).toBeUndefined();
    expect(tools[1].origin).toBe('seed');
  });

  it('手工新增的条目保留 manual 来源', () => {
    const [tool] = normalizeLocalTools([
      { id: 'm', name: '我的看板', category: '其他', description: '说明', url: 'http://127.0.0.1:9/', origin: 'manual' },
    ]);
    expect(tool.origin).toBe('manual');
  });

  it('导入备份时按 id 合并工具清单', () => {
    const current = { ...createEmptySnapshot(), localTools: [] };
    const incoming = createEmptySnapshot();
    const result = importSnapshot(current, incoming);
    expect(result.snapshot.localTools).toHaveLength(6);
    expect(result.added.localTools).toBe(6);
  });
});

describe('内置清单按平台过滤', () => {
  function withUserAgent<T>(ua: string, run: () => T): T {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    try {
      return run();
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'userAgent', descriptor);
      else delete (navigator as unknown as Record<string, unknown>).userAgent;
    }
  }

  it('macOS 上不列出钉着 Windows 绝对路径的内置工具', () => {
    // 六个种子全是 G:\... + .venv\Scripts\python.exe，换平台后点了一定失败，不该出现在清单里。
    const onMac = withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15', () => createSeedLocalTools());
    expect(onMac).toEqual([]);
  });

  it('Windows 上仍然给出完整内置清单', () => {
    const onWindows = withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', () => createSeedLocalTools());
    expect(onWindows).toHaveLength(6);
  });
});

describe('从地址里取端口', () => {  it('取显式端口', () => {
    expect(portFromUrl('http://127.0.0.1:8777/dashboard.html')).toBe(8777);
  });

  it('没写端口时按协议补默认值', () => {
    expect(portFromUrl('https://localhost/panel')).toBe(443);
    expect(portFromUrl('http://localhost/panel')).toBe(80);
  });

  it('不是地址时返回 undefined', () => {
    expect(portFromUrl('随便写点什么')).toBeUndefined();
  });
});
