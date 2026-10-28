import { invoke } from '@tauri-apps/api/core';
import type { LocalTool } from '../types';

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isValidPort(port?: number): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535;
}

/**
 * 端口是否在监听。桌面端交给 Rust 做一次 TCP 连接（不受 CSP 与 CORS 影响）；
 * 浏览器预览没有这条命令，退化成 no-cors 请求——拿不到响应体，但连不上会直接抛错。
 */
export async function probeLocalPort(port?: number, url?: string): Promise<boolean> {
  if (!isValidPort(port)) return false;
  if (isDesktopRuntime()) {
    try {
      return await invoke<boolean>('probe_local_port', { port });
    } catch {
      // 后端缺这条命令时继续走下面的 fetch 探测，不要因此判定为离线。
    }
  }
  if (!url) return false;
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

export async function openLocalToolUrl(url: string): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await invoke('open_external', { url });
      return;
    } catch {
      // 交给下面的 window.open 兜底。
    }
  }
  globalThis.open(url, '_blank', 'noopener,noreferrer');
}

export interface LaunchReceipt {
  pid: number;
  logPath: string;
}

/** 起服务时不带控制台窗口，标准输出落到数据目录的 tool-logs 下。 */
export async function launchLocalService(tool: LocalTool): Promise<LaunchReceipt> {
  if (!tool.launchCommand) throw new Error('这个工具没有配置启动命令');
  if (!isDesktopRuntime()) throw new Error('浏览器预览不能启动本地服务，请在桌面应用里点');
  return invoke<LaunchReceipt>('launch_local_tool', {
    name: tool.name,
    command: tool.launchCommand,
    workingDirectory: tool.workingDirectory ?? null,
  });
}

/** 结束占用该端口的进程，返回真正被杀掉的 pid。 */
export async function stopLocalService(port?: number): Promise<number[]> {
  if (!isValidPort(port)) throw new Error('这条工具没有登记端口，没法定位进程');
  if (!isDesktopRuntime()) throw new Error('浏览器预览不能结束本地进程');
  return invoke<number[]>('stop_local_tool', { port });
}

export interface OpenToolResult {
  /** running：本来就在跑；launched：这次拉起来的；offline：命令发了但端口没起来。 */
  kind: 'running' | 'launched' | 'offline';
  detail?: string;
}

const POLL_INTERVAL_MS = 600;

/**
 * 打开一个本地工具：在跑就直接开，没跑先用启动命令拉起来再开。
 * 等 20 秒是因为 Paper Workbench 这类要加载一堆分析库的服务，实测 8–10 秒才把端口挂上。
 */
export async function openLocalTool(tool: LocalTool, waitMs = 20_000): Promise<OpenToolResult> {
  if (await probeLocalPort(tool.port, tool.url)) {
    await openLocalToolUrl(tool.url);
    return { kind: 'running' };
  }
  if (!tool.launchCommand) {
    await openLocalToolUrl(tool.url);
    return { kind: 'offline', detail: '没配启动命令，浏览器可能打不开这个地址' };
  }

  await launchLocalService(tool);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => { globalThis.setTimeout(resolve, POLL_INTERVAL_MS); });
    if (await probeLocalPort(tool.port, tool.url)) {
      await openLocalToolUrl(tool.url);
      return { kind: 'launched' };
    }
  }
  return { kind: 'offline', detail: '启动命令已执行，但端口一直没响应，检查一下脚本输出' };
}

/** 从地址里读出端口，新增工具时自动带出来，省得手填。 */
export function portFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (Number.isInteger(port) && port > 0) return port;
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return undefined;
  }
}
