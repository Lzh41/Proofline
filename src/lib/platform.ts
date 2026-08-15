import type { PlatformSource, Problem } from '../types';
import { createId } from './ids';

const PLATFORM_HOSTS: Record<PlatformSource, readonly string[]> = {
  'leetcode-cn': ['leetcode.cn', 'www.leetcode.cn'],
  leetcode: ['leetcode.com', 'www.leetcode.com'],
  nowcoder: ['nowcoder.com', 'www.nowcoder.com', 'ac.nowcoder.com'],
};

export function isAllowedPlatformUrl(source: PlatformSource, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PLATFORM_HOSTS[source].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch { return false; }
}

export function isSafeAiEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) && Boolean(url.hostname);
  } catch { return false; }
}

export function inferProblemFromUrl(source: PlatformSource, value: string, now = Date.now()): Problem {
  if (!isAllowedPlatformUrl(source, value)) throw new Error('当前页面不属于所选平台的安全域名');
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  let slug = segments.at(-1) ?? '';
  if (source !== 'nowcoder') {
    const index = segments.findIndex((item) => item === 'problems');
    slug = index >= 0 ? (segments[index + 1] ?? slug) : slug;
  }
  const title = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim() || `${source} 当前题目`;
  return {
    id: createId('problem'),
    kind: 'algorithm',
    title,
    source,
    sourceUrl: value,
    externalId: source === 'nowcoder' ? slug : undefined,
    platformSlug: slug || undefined,
    difficulty: 'unknown',
    tags: [],
    content: '',
    constraints: [],
    examples: [],
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'link-only',
    importMethod: 'platform',
    createdAt: now,
    updatedAt: now,
  };
}

export async function fetchPublicProblem(source: PlatformSource, value: string, signal?: AbortSignal): Promise<Partial<Problem>> {
  if (!isAllowedPlatformUrl(source, value)) throw new Error('平台链接校验失败');
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(value, { credentials: 'omit', signal: controller.signal, headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`公开题面读取失败（${response.status}）`);
    const html = await response.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s*[-|_].*$/, '').trim();
    return title ? { title, cacheStatus: 'fresh', importMethod: 'connector', contentFetchedAt: Date.now(), connectorVersion: 'browser-1' } : {};
  } finally { globalThis.clearTimeout(timeout); }
}
