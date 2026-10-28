import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CircleSlash,
  CircleX,
  Copy,
  ExternalLink,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState, Metric, PageHeader, SectionHeader } from '../components/PagePrimitives';
import { useStoreView } from '../app/storeAdapter';
import type { LocalTool } from '../types';
import { openLocalTool, openLocalToolUrl, portFromUrl, probeLocalPort, stopLocalService } from '../lib/localTools';
import { isMacOS } from '../lib/os';
import styles from './ToolsPage.module.css';

type ToolStatus = 'checking' | 'online' | 'offline' | 'unknown';

interface ToolDraft {
  name: string;
  category: string;
  url: string;
  port: string;
  description: string;
  launchCommand: string;
  workingDirectory: string;
}

const EMPTY_DRAFT: ToolDraft = {
  name: '',
  category: '',
  url: '',
  port: '',
  description: '',
  launchCommand: '',
  workingDirectory: '',
};

const STATUS_LABEL: Record<ToolStatus, string> = {
  checking: '探测中',
  online: '正在运行',
  offline: '未启动',
  unknown: '无端口',
};

function draftFrom(tool: LocalTool): ToolDraft {
  return {
    name: tool.name,
    category: tool.category,
    url: tool.url,
    port: tool.port ? String(tool.port) : '',
    description: tool.description,
    launchCommand: tool.launchCommand ?? '',
    workingDirectory: tool.workingDirectory ?? '',
  };
}

export function ToolsPage() {
  const store = useStoreView();
  const tools = store.localTools;
  const [statuses, setStatuses] = useState<Record<string, ToolStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LocalTool | null>(null);
  const [draft, setDraft] = useState<ToolDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState('');
  const messageTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((tone: 'ok' | 'warn', text: string) => {
    setMessage({ tone, text });
    globalThis.clearTimeout(messageTimer.current);
    messageTimer.current = globalThis.setTimeout(() => setMessage(null), 6000);
  }, []);

  useEffect(() => () => globalThis.clearTimeout(messageTimer.current), []);

  const refreshStatuses = useCallback(async (list: LocalTool[]) => {
    if (list.length === 0) return;
    setStatuses((current) => {
      const next = { ...current };
      for (const tool of list) next[tool.id] = tool.port ? 'checking' : 'unknown';
      return next;
    });
    const measured = await Promise.all(list.map(async (tool) => {
      if (!tool.port) return [tool.id, 'unknown'] as const;
      const online = await probeLocalPort(tool.port, tool.url);
      return [tool.id, online ? 'online' : 'offline'] as const;
    }));
    setStatuses((current) => {
      const next = { ...current };
      for (const [id, status] of measured) next[id] = status;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!store.initialized) return;
    void refreshStatuses(tools);
    const timer = globalThis.setInterval(() => { void refreshStatuses(tools); }, 20_000);
    return () => globalThis.clearInterval(timer);
  }, [store.initialized, tools, refreshStatuses]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const tool of tools) seen.add(tool.category);
    return ['all', ...[...seen].sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  }, [tools]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false;
      if (!keyword) return true;
      return `${tool.name} ${tool.category} ${tool.description} ${tool.url}`.toLowerCase().includes(keyword);
    });
  }, [tools, category, query]);

  /** 置顶的排最前，组内保持原顺序。 */
  const ordered = useMemo(() => {
    const pinned = visible.filter((tool) => tool.pinned);
    const rest = visible.filter((tool) => !tool.pinned);
    return [...pinned, ...rest];
  }, [visible]);

  const onlineCount = tools.filter((tool) => statuses[tool.id] === 'online').length;
  const offlineCount = tools.filter((tool) => statuses[tool.id] === 'offline').length;

  const openTool = async (tool: LocalTool) => {
    setBusy(`open:${tool.id}`);
    try {
      const result = await openLocalTool(tool);
      if (result.kind === 'launched') {
        notify('ok', `${tool.name} 起来了，已经帮你打开`);
        setStatuses((current) => ({ ...current, [tool.id]: 'online' }));
      } else if (result.kind === 'offline') {
        notify('warn', result.detail ?? `${tool.name} 没能打开`);
        setStatuses((current) => ({ ...current, [tool.id]: tool.port ? 'offline' : 'unknown' }));
      }
    } catch (error) {
      notify('warn', error instanceof Error ? error.message : `${tool.name} 启动失败`);
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async (tool: LocalTool) => {
    try {
      await navigator.clipboard.writeText(tool.url);
      notify('ok', `已复制 ${tool.url}`);
    } catch {
      notify('warn', '复制失败，手动选中地址吧');
    }
  };

  const togglePin = async (tool: LocalTool) => {
    if (!store.updateLocalTool) return;
    setBusy(`pin:${tool.id}`);
    try {
      await store.updateLocalTool(tool.id, { pinned: !tool.pinned });
      notify('ok', tool.pinned ? `${tool.name} 取消置顶` : `${tool.name} 已置顶`);
    } catch (error) {
      notify('warn', error instanceof Error ? error.message : '置顶失败');
    } finally {
      setBusy(null);
    }
  };

  const stopTool = async (tool: LocalTool) => {
    if (!tool.port) { notify('warn', '这条没登记端口，定位不到进程'); return; }
    if (!window.confirm(`结束「${tool.name}」在 ${tool.port} 端口上的进程？\n\n会连同它拉起的子进程一起结束，正在跑的评测或标注会中断。`)) return;
    setBusy(`stop:${tool.id}`);
    try {
      const pids = await stopLocalService(tool.port);
      if (pids.length === 0) {
        notify('warn', `${tool.port} 上没有找到在跑的进程`);
      } else {
        notify('ok', `已结束 ${pids.length} 个进程，${tool.port} 释放了`);
      }
      setStatuses((current) => ({ ...current, [tool.id]: 'offline' }));
      void refreshStatuses([tool]);
    } catch (error) {
      notify('warn', error instanceof Error ? error.message : '结束进程失败');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (tool: LocalTool) => {
    if (!store.deleteLocalTool) return;
    if (!window.confirm(`把「${tool.name}」从列表里删掉？\n\n只删这条登记，工具本身和它的文件不受影响。`)) return;
    setBusy(`delete:${tool.id}`);
    try {
      await store.deleteLocalTool(tool.id);
      setStatuses((current) => {
        const next = { ...current };
        delete next[tool.id];
        return next;
      });
      notify('ok', `${tool.name} 已从列表移除`);
    } catch (error) {
      notify('warn', error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const openEditor = (tool?: LocalTool) => {
    setEditing(tool ?? null);
    setDraft(tool ? draftFrom(tool) : EMPTY_DRAFT);
    setFormError('');
    setDialogOpen(true);
  };

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    const url = draft.url.trim();
    if (!name) { setFormError('先给工具起个名字。'); return; }
    if (!/^https?:\/\/\S+$/i.test(url)) { setFormError('地址要以 http:// 或 https:// 开头。'); return; }
    const typedPort = draft.port.trim();
    const parsedPort = typedPort ? Number(typedPort) : portFromUrl(url);
    if (typedPort && (parsedPort === undefined || !Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65_535)) {
      setFormError('端口是 1 到 65535 之间的整数。');
      return;
    }

    const payload: Partial<LocalTool> = {
      name,
      category: draft.category.trim() || '其他',
      url,
      description: draft.description.trim(),
      port: parsedPort,
      launchCommand: draft.launchCommand.trim() || undefined,
      workingDirectory: draft.workingDirectory.trim() || undefined,
    };

    setBusy('save');
    try {
      let targetId = editing?.id;
      if (editing && store.updateLocalTool) await store.updateLocalTool(editing.id, payload);
      else if (store.createLocalTool) {
        const created = await store.createLocalTool(payload);
        targetId = created.id;
      }
      setDialogOpen(false);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      notify('ok', editing ? '配置已更新' : `${name} 已加进列表`);
      if (targetId && parsedPort) {
        const id = targetId;
        void probeLocalPort(parsedPort, url).then((online) => {
          setStatuses((current) => ({ ...current, [id]: online ? 'online' : 'offline' }));
        });
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="本地工具"
        description="这些工具各自占了本地一个端口，过一阵就记不清哪个端口是干什么的。这里存着它们的功能、地址和启动命令：在跑的直接打开，没在跑的先按启动命令拉起来再打开。"
        actions={(
          <>
            <button
              className="button"
              type="button"
              onClick={() => { void refreshStatuses(tools); }}
              disabled={busy !== null}
            >
              <RefreshCw size={14} />刷新状态
            </button>
            <button className="button buttonPrimary" type="button" onClick={() => openEditor()}>
              <Plus size={15} />添加工具
            </button>
          </>
        )}
      />

      <div className={styles.metrics}>
        <Metric label="已登记" value={tools.length} detail="个本地工具" />
        <Metric label="正在运行" value={onlineCount} detail="端口可连通" tone="accent" />
        <Metric label="未启动" value={offlineCount} detail="点开会自动拉起" tone="info" />
        <Metric label="分类" value={Math.max(0, categories.length - 1)} detail="种用途" />
      </div>

      {message && (
        <div className={message.tone === 'ok' ? styles.message : styles.messageWarn} role="status">
          {message.text}
        </div>
      )}

      <section className={styles.section}>
        <SectionHeader
          title="工具清单"
          meta={`${visible.length} / ${tools.length} 个 · 每 20 秒自动探一次端口`}
        />

        <div className={styles.filters}>
          <div className={styles.chips}>
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? styles.chipActive : styles.chip}
                onClick={() => setCategory(item)}
              >
                {item === 'all' ? '全部' : item}
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜名称、端口或用途"
              aria-label="搜索本地工具"
            />
          </label>
        </div>

        {tools.length === 0 ? (
          <div className={styles.emptyWrap}>
            <EmptyState
              title="还没有登记本地工具"
              message="把常用的本地看板、工作台加进来，以后从这一页点开就行。"
              action={<button className="button buttonAccent" type="button" onClick={() => openEditor()}><Plus size={14} />添加第一个</button>}
            />
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.emptyWrap}>
            <EmptyState title="没有匹配的工具" message="换个关键词，或者把分类切回全部。" compact />
          </div>
        ) : (
          <div className={styles.grid}>
            {ordered.map((tool) => {
              const status = statuses[tool.id] ?? 'checking';
              const toolBusy = busy?.endsWith(`:${tool.id}`) ?? false;
              return (
                <article className={styles.card} key={tool.id} data-status={status} data-pinned={tool.pinned === true}>
                  <header className={styles.cardHead}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    <div className={styles.cardTitle}>
                      <strong>{tool.name}</strong>
                      <span className={styles.statusText}>{STATUS_LABEL[status]}</span>
                    </div>
                    <span className={styles.category}>{tool.category}</span>
                    <button
                      className={tool.pinned ? styles.pinActive : styles.pin}
                      type="button"
                      title={tool.pinned ? '取消置顶' : '置顶'}
                      aria-label={tool.pinned ? `取消置顶${tool.name}` : `置顶${tool.name}`}
                      aria-pressed={tool.pinned === true}
                      disabled={toolBusy}
                      onClick={() => { void togglePin(tool); }}
                    >
                      {tool.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                    </button>
                  </header>

                  <p className={styles.description}>{tool.description || '还没有写说明。'}</p>

                  <div className={styles.addressRow}>
                    <code>{tool.url}</code>
                    {tool.port && <span className={styles.port}>:{tool.port}</span>}
                  </div>

                  {tool.launchCommand && (
                    <div className={styles.launchInfo}>
                      <div className={styles.launchLine}>
                        <TerminalSquare size={13} aria-hidden="true" />
                        <code>{tool.launchCommand}</code>
                      </div>
                      {tool.workingDirectory && (
                        <div className={styles.launchLine}>
                          <FolderOpen size={13} aria-hidden="true" />
                          <code>{tool.workingDirectory}</code>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={styles.cardActions}>
                    <button
                      className="button buttonPrimary"
                      type="button"
                      disabled={toolBusy}
                      onClick={() => { void openTool(tool); }}
                    >
                      <ExternalLink size={14} />{status === 'online' ? '打开' : '启动并打开'}
                    </button>
                    <button className="iconButton" type="button" title="复制地址" aria-label={`复制${tool.name}地址`} onClick={() => { void copyUrl(tool); }}>
                      <Copy size={14} />
                    </button>
                    <button className="iconButton" type="button" title="只打开不启动" aria-label={`直接打开${tool.name}`} onClick={() => { void openLocalToolUrl(tool.url); }}>
                      <ArrowUpRight size={14} />
                    </button>
                    <span className={styles.spacer} />
                    <button
                      className={`iconButton ${styles.stopButton}`}
                      type="button"
                      title={tool.port ? `结束 ${tool.port} 端口上的进程` : '没有登记端口'}
                      aria-label={`结束${tool.name}的进程`}
                      disabled={toolBusy || !tool.port}
                      onClick={() => { void stopTool(tool); }}
                    >
                      <CircleX size={14} />
                    </button>
                    <button className="iconButton" type="button" title="编辑" aria-label={`编辑${tool.name}`} onClick={() => openEditor(tool)}>
                      <Pencil size={14} />
                    </button>
                    <button className="iconButton" type="button" title="删除" aria-label={`删除${tool.name}`} disabled={toolBusy} onClick={() => { void remove(tool); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className={styles.footNote}>
        <CircleSlash size={14} aria-hidden="true" />
        <span>从这一页拉起的服务在后台跑，没有控制台窗口；要停就在卡片右下角的叉号上结束它，它的输出写在数据目录的 tool-logs 里。需要先起容器的 docker 服务不在这一页管——它们做不到点一下就进。</span>
      </div>

      {dialogOpen && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
          <form className={styles.dialog} onSubmit={(event) => { void submitDraft(event); }}>
            <div className={styles.dialogHead}>
              <div>
                <span className={styles.kicker}>{editing ? '编辑工具' : '新增工具'}</span>
                <h2>{editing ? editing.name : '登记一个本地工具'}</h2>
              </div>
              <button className="iconButton" type="button" title="关闭" aria-label="关闭" onClick={() => { setDialogOpen(false); setEditing(null); }}>
                <X size={16} />
              </button>
            </div>

            <div className={styles.fieldGrid}>
              <label>
                <span>名称</span>
                <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如 benchlab 评测看板" />
              </label>
              <label>
                <span>分类</span>
                <input className="input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="评测 / 标注 / 写作 / 集群" />
              </label>
            </div>

            <label>
              <span>地址</span>
              <input className="input mono" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="http://127.0.0.1:8777/dashboard.html" />
            </label>

            <div className={styles.fieldGrid}>
              <label>
                <span>端口（留空从地址里取）</span>
                <input className="input mono" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} placeholder="8777" inputMode="numeric" />
              </label>
              <label>
                <span>工作目录</span>
                <input className="input mono" value={draft.workingDirectory} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} placeholder="G:\benchlab" />
              </label>
            </div>

            <label>
              <span>功能说明</span>
              <textarea className="textarea" rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="它看什么、能做什么、什么时候会用到。" />
            </label>

            <label>
              <span>启动命令（可选）</span>
              <textarea className="textarea mono" rows={2} value={draft.launchCommand} onChange={(event) => setDraft({ ...draft, launchCommand: event.target.value })} placeholder={isMacOS() ? '".venv/bin/python" serve.py --port 8777' : '".venv\\Scripts\\python.exe" serve.py --port 8777'} />
            </label>

            {formError && <div className={styles.formError} role="alert">{formError}</div>}

            <div className={styles.dialogFoot}>
              <button className="button" type="button" onClick={() => { setDialogOpen(false); setEditing(null); }}>取消</button>
              <button className="button buttonPrimary" type="submit" disabled={busy === 'save'}>
                {editing ? <Pencil size={14} /> : <Plus size={14} />}{editing ? '保存' : '加入列表'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
