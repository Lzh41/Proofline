import { useEffect, useMemo, useState } from 'react';
import { Bot, Edit3, ExternalLink, FileCog, Globe2, HardDriveDownload, Pause, Play, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { PageHeader, SectionHeader, EmptyState } from '../components/PagePrimitives';
import { useStoreView } from '../app/storeAdapter';
import type { GithubToolInstallPlan, GithubToolInspection, LocalTool, WebWorkspace } from '../types';
import styles from './ToolsPage.module.css';

type ToolDraft = {
  name: string;
  description: string;
  installerPath: string;
  installerArgs: string;
  launcherPath: string;
  launcherArgs: string;
  workingDirectory: string;
};

const EMPTY_DRAFT: ToolDraft = {
  name: '',
  description: '',
  installerPath: '',
  installerArgs: '',
  launcherPath: '',
  launcherArgs: '',
  workingDirectory: '',
};

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function hostForUrl(value: string): string[] {
  try {
    const parsed = new URL(value);
    return parsed.hostname ? [parsed.hostname.toLowerCase()] : [];
  } catch {
    return [];
  }
}

function statusLabel(tool: LocalTool): string {
  if (tool.status === 'running') return '服务运行中';
  if (tool.status === 'installed') return '已安装，等待启动';
  if (tool.status === 'stopped') return '服务已停止';
  if (tool.status === 'error') return '需要处理';
  return '未配置安装';
}

function workspaceForTool(tool: LocalTool, workspaces: WebWorkspace[]): WebWorkspace | undefined {
  return tool.workspaceId ? workspaces.find((item) => item.id === tool.workspaceId) : undefined;
}

export function ToolsPage() {
  const store = useStoreView();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<LocalTool | null>(null);
  const [draft, setDraft] = useState<ToolDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [githubQuestion, setGithubQuestion] = useState('');
  const [githubInspection, setGithubInspection] = useState<GithubToolInspection | null>(null);
  const [githubPlan, setGithubPlan] = useState<GithubToolInstallPlan | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubOutput, setGithubOutput] = useState('');

  useEffect(() => {
    if (!store.initialized) return;
    void Promise.all([
      ...store.webWorkspaces.map((workspace) => store.refreshWebWorkspace?.(workspace)),
      ...store.localTools.filter((tool) => tool.servicePid).map((tool) => store.refreshLocalTool?.(tool)),
    ]);
  }, [store.initialized]);

  const runningCount = useMemo(() => store.localTools.filter((tool) => tool.status === 'running').length, [store.localTools]);

  const choosePath = async (kind: 'installer' | 'launcher') => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: '脚本或程序', extensions: ['ps1', 'cmd', 'bat', 'exe'] }] });
    if (typeof picked !== 'string') return;
    setDraft((current) => ({ ...current, [kind === 'installer' ? 'installerPath' : 'launcherPath']: picked }));
  };

  const addTool = async (input: Partial<LocalTool>) => {
    if (!store.createLocalTool) return;
    setBusy('add');
    setMessage('');
    try {
      await store.createLocalTool(input);
      setDialogOpen(false);
      setDraft(EMPTY_DRAFT);
      setMessage('工具已加入管理列表。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加入工具失败。');
    } finally {
      setBusy(null);
    }
  };

  const openToolEditor = (tool?: LocalTool) => {
    setEditingTool(tool ?? null);
    setDraft(tool ? {
      name: tool.name,
      description: tool.description ?? '',
      installerPath: tool.installerPath ?? '',
      installerArgs: (tool.installerArgs ?? []).join('\n'),
      launcherPath: tool.launcherPath ?? '',
      launcherArgs: (tool.launcherArgs ?? []).join('\n'),
      workingDirectory: tool.workingDirectory ?? '',
    } : EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const submitDraft = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) {
      setMessage('请填写工具名称。');
      return;
    }
    const input: Partial<LocalTool> = {
      name: draft.name,
      description: draft.description,
      installerPath: draft.installerPath,
      installerArgs: lines(draft.installerArgs),
      launcherPath: draft.launcherPath,
      launcherArgs: lines(draft.launcherArgs),
      workingDirectory: draft.workingDirectory,
    };
    if (editingTool && store.updateLocalTool) {
      setBusy('edit');
      void store.updateLocalTool(editingTool.id, input).then(() => {
        setDialogOpen(false);
        setEditingTool(null);
        setMessage('工具配置已更新。');
      }).catch((error) => setMessage(error instanceof Error ? error.message : '更新工具失败。')).finally(() => setBusy(null));
    } else void addTool(input);
  };

  const inspectGithub = async () => {
    if (!store.inspectGithubTool) return;
    setGithubBusy(true); setGithubPlan(null); setGithubOutput(''); setMessage('正在读取 GitHub 公开仓库信息。');
    try {
      const inspection = await store.inspectGithubTool(githubUrl);
      setGithubInspection(inspection);
      setMessage(`已读取 ${inspection.fullName}，可以让 AI 生成安装候选。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取 GitHub 仓库失败。'); }
    finally { setGithubBusy(false); }
  };

  const askGithubAi = async () => {
    if (!githubInspection || !store.requestGithubToolPlan) return;
    setGithubBusy(true); setGithubPlan(null); setGithubOutput(''); setMessage('AI 正在分析仓库中的安装与启动入口。');
    try {
      const plan = await store.requestGithubToolPlan({ inspection: githubInspection, userMessage: githubQuestion, onChunk: (chunk) => setGithubOutput((current) => current + chunk) });
      setGithubPlan(plan); setMessage('AI 已生成候选配置，请检查路径和参数后再确认下载。');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI 分析工具失败。'); }
    finally { setGithubBusy(false); }
  };

  const confirmGithubInstall = async () => {
    if (!githubPlan || !store.prepareGithubTool || !store.createLocalTool) return;
    const installSummary = githubPlan.installerPath
      ? `下载后会按下面的候选路径执行安装脚本：\n${githubPlan.installerPath}${githubPlan.installerArgs.length ? `\n参数：${githubPlan.installerArgs.join(' ')}` : ''}`
      : '没有识别到可执行的安装脚本，下载后只会加入管理列表。';
    if (!window.confirm(`确认下载“${githubPlan.name}”吗？\n\n${installSummary}\n\n请确认仓库来源和脚本内容可信。`)) return;
    setGithubBusy(true); setMessage('正在下载并安全解压仓库源码。');
    let createdTool: LocalTool | undefined;
    try {
      const prepared = await store.prepareGithubTool({ repositoryUrl: githubPlan.repositoryUrl, installerPath: githubPlan.installerPath, installerArgs: githubPlan.installerArgs, launcherPath: githubPlan.launcherPath, launcherArgs: githubPlan.launcherArgs, workingDirectory: githubPlan.workingDirectory });
      const installerArgs = prepared.installerArgs?.length ? prepared.installerArgs : githubPlan.installerArgs;
      const launcherArgs = prepared.launcherArgs?.length ? prepared.launcherArgs : githubPlan.launcherArgs;
      createdTool = await store.createLocalTool({ name: githubPlan.name, description: githubPlan.description, repositoryUrl: prepared.repositoryUrl, sourceRoot: prepared.sourcePath, installerPath: prepared.installerPath, installerArgs, launcherPath: prepared.launcherPath, launcherArgs, workingDirectory: prepared.workingDirectory, serviceUrl: githubPlan.serviceUrl, status: 'not-installed' });
      if (createdTool.installerPath && store.installLocalTool) {
        setMessage(`源码已下载，正在运行 ${githubPlan.name} 安装脚本。`);
        await store.installLocalTool(createdTool);
        setMessage(`${githubPlan.name} 已下载并安装完成，可在下方启动服务。`);
      } else {
        setMessage(`${githubPlan.name} 已下载并加入管理列表；未识别到安装脚本，请检查配置。`);
      }
      setGithubPlan(null);
    } catch (error) {
      if (createdTool) await store.updateLocalTool?.(createdTool.id, { status: 'error', lastError: error instanceof Error ? error.message : String(error) });
      setMessage(error instanceof Error ? error.message : '下载或安装 GitHub 工具失败。');
    }
    finally { setGithubBusy(false); }
  };

  const ensureWorkspace = async (tool: LocalTool, serviceUrl: string): Promise<WebWorkspace | undefined> => {
    if (!store.createWebWorkspace || !store.updateLocalTool) return undefined;
    const existing = workspaceForTool(tool, store.webWorkspaces);
    if (existing) {
      await store.updateWebWorkspace?.(existing.id, { homeUrl: serviceUrl, lastUrl: serviceUrl, status: 'stopped' });
      // 页面立即打开时使用启动器返回的完整地址；更新后的 store 值已在持久化入口清理敏感参数。
      return { ...existing, homeUrl: serviceUrl, lastUrl: serviceUrl };
    }
    const workspace = await store.createWebWorkspace({
      id: `${tool.id}-web`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80),
      name: `${tool.name} Web 工作台`,
      description: tool.description,
      homeUrl: serviceUrl,
      allowedHosts: hostForUrl(serviceUrl),
      profileKey: tool.id,
    });
    await store.updateLocalTool(tool.id, { workspaceId: workspace.id });
    return { ...workspace, homeUrl: serviceUrl, lastUrl: serviceUrl };
  };

  const install = async (tool: LocalTool) => {
    if (!store.installLocalTool) return;
    if (!window.confirm(`即将执行“${tool.name}”的安装脚本：\n${tool.installerPath || '未配置'}\n\n请确认脚本来源可信，并确认继续。`)) return;
    setBusy(`install:${tool.id}`);
    setMessage('正在运行安装脚本，完成前请保持应用开启。');
    try {
      await store.installLocalTool(tool);
      setMessage(`${tool.name} 安装脚本已完成。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${tool.name} 安装失败。`);
      await store.updateLocalTool?.(tool.id, { status: 'error', lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const start = async (tool: LocalTool) => {
    if (!store.startLocalTool) return;
    setBusy(`start:${tool.id}`);
    setMessage(`正在启动 ${tool.name} 本地服务。`);
    try {
      const result = await store.startLocalTool(tool);
      if (result.running !== false && result.serviceUrl) {
        const workspace = await ensureWorkspace(tool, result.serviceUrl);
        if (workspace) await store.openWebWorkspace?.(workspace);
      }
      setMessage(result.running === false
        ? `${tool.name} 启动脚本已结束，服务未保持运行。`
        : result.serviceUrl ? `${tool.name} 已启动并打开 Web 工作台。` : `${tool.name} 已启动；启动脚本未返回 Web 地址。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${tool.name} 启动失败。`);
      await store.updateLocalTool?.(tool.id, { status: 'error', lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const stop = async (tool: LocalTool) => {
    if (!store.stopLocalTool) return;
    setBusy(`stop:${tool.id}`);
    try {
      await store.stopLocalTool(tool);
      setMessage(`${tool.name} 服务已停止。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${tool.name} 停止失败。`);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (tool: LocalTool, workspace?: WebWorkspace) => {
    if (workspace && store.refreshWebWorkspace) {
      await store.refreshWebWorkspace(workspace);
      return;
    }
    if (store.refreshLocalTool) await store.refreshLocalTool(tool);
  };

  const remove = async (tool: LocalTool) => {
    if (!store.deleteLocalTool) return;
    if (!window.confirm(`确定移除“${tool.name}”的管理记录吗？不会自动删除工具安装目录。`)) return;
      const workspace = workspaceForTool(tool, store.webWorkspaces);
    if (workspace) await store.deleteWebWorkspace?.(workspace.id);
    await store.deleteLocalTool(tool.id);
    setMessage(`${tool.name} 已停止管理；安装文件仍保留在原位置。`);
  };

  return (
    <>
      <PageHeader
        eyebrow="本地工具"
        title="安装工具，管理本地服务。"
        description="把论文工作台、实验服务和其他本地 Web UI 放到同一处管理；工具进程与 WebView 会话分开保存。"
        actions={<button className="button buttonPrimary" type="button" onClick={() => setDialogOpen(true)}><Plus size={15} />添加工具</button>}
      />
      <div className={styles.notice}><ShieldCheck size={18} /><span>Proofline 只执行你明确配置的本地安装/启动脚本，不读取脚本中的密钥；Web UI 的 Cookie 和站点缓存留在该工具自己的 WebView 会话目录。</span></div>

      {message && <div className={styles.message} role="status">{message}</div>}

      <section className={styles.overview} aria-label="工具概览">
        <div><span>已登记工具</span><strong>{store.localTools.length}</strong></div>
        <div><span>运行中的服务</span><strong>{runningCount}</strong></div>
        <div><span>Web 工作台</span><strong>{store.webWorkspaces.length}</strong></div>
      </section>

      <section className={styles.section}>
        <SectionHeader title="AI 工具安装助手" meta="输入公开 GitHub 仓库地址，先分析再确认下载" />
        <div className={styles.aiInstaller}>
          <div className={styles.aiInstallerHead}><div className={styles.assistantIcon}><Bot size={20} /></div><div><strong>从 GitHub 生成工具候选</strong><p>AI 分析阶段只读取公开仓库信息，不会运行脚本；你确认下载并安装后，才会执行候选安装脚本。</p></div></div>
          <div className={styles.aiInstallerForm}><input className="input" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/owner/repository" /><button className="button" type="button" disabled={githubBusy || !githubUrl.trim()} onClick={() => void inspectGithub()}>读取仓库</button></div>
          {githubInspection && <div className={styles.aiInspection}><strong>{githubInspection.fullName}</strong><span>{githubInspection.description || '暂无仓库描述'} · {githubInspection.files.length} 个文件索引</span><textarea className="textarea" rows={2} value={githubQuestion} onChange={(event) => setGithubQuestion(event.target.value)} placeholder="补充要求，例如：优先使用 Windows PowerShell 启动本地 Web UI" /><button className="button buttonPrimary" type="button" disabled={githubBusy} onClick={() => void askGithubAi()}><Bot size={14} />让 AI 分析安装方式</button></div>}
          {githubBusy && githubOutput && <pre className={styles.aiOutput}>{githubOutput}</pre>}
          {githubPlan && <div className={styles.aiPlan}><div className={styles.planHead}><strong>候选配置：{githubPlan.name}</strong><span>可信度：{githubPlan.confidence}</span></div><p>{githubPlan.description || '暂无说明'}</p><div className={styles.planGrid}><span>安装脚本</span><code>{githubPlan.installerPath || '未识别'}</code><span>安装参数</span><code>{githubPlan.installerArgs.join(' ') || '无'}</code><span>启动脚本</span><code>{githubPlan.launcherPath || '未识别'}</code><span>启动参数</span><code>{githubPlan.launcherArgs.join(' ') || '无'}</code><span>工作目录</span><code>{githubPlan.workingDirectory || '.'}</code><span>服务地址</span><code>{githubPlan.serviceUrl || '启动后由脚本返回'}</code></div>{githubPlan.notes.length > 0 && <ul>{githubPlan.notes.map((note) => <li key={note}>{note}</li>)}</ul>}<button className="button buttonAccent" type="button" disabled={githubBusy} onClick={() => void confirmGithubInstall()}><HardDriveDownload size={14} />{githubPlan.installerPath ? '确认下载并安装' : '确认下载并加入'}</button></div>}
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader title="已登记工具" meta={`${store.localTools.length} 个工具 · 可独立管理服务`} />
        {store.localTools.length === 0 ? <div className={styles.emptyState}><EmptyState title="还没有本地工具" message="先使用 AI 工具安装助手分析 GitHub 仓库，或添加其他本地 Web UI 的安装与启动脚本。" action={<button className="button buttonAccent" type="button" onClick={() => setDialogOpen(true)}><Plus size={14} />添加工具</button>} /></div> : (
          <div className={styles.toolList}>
            {store.localTools.map((tool) => {
              const workspace = workspaceForTool(tool, store.webWorkspaces);
              const toolBusy = busy?.endsWith(`:${tool.id}`) ?? false;
              return <article className={styles.toolCard} key={tool.id}>
                <div className={styles.toolHead}><div className={styles.toolMark}><FileCog size={18} /></div><div className={styles.toolTitle}><strong>{tool.name}</strong><span className={tool.status === 'running' ? styles.running : ''}><i />{statusLabel(tool)}</span></div><button className="iconButton" type="button" title="编辑工具配置" aria-label={`编辑${tool.name}`} onClick={() => openToolEditor(tool)}><Edit3 size={15} /></button><button className="iconButton" type="button" title="移除管理记录" aria-label={`移除${tool.name}`} onClick={() => void remove(tool)}><Trash2 size={15} /></button></div>
                {tool.description && <p className={styles.toolDescription}>{tool.description}</p>}
                <div className={styles.toolMeta}><span>安装脚本</span><code>{tool.installerPath || '未配置'}</code><span>启动脚本</span><code>{tool.launcherPath || '未配置'}</code></div>
                {tool.serviceUrl && <div className={styles.serviceUrl}><Globe2 size={14} /><code>{tool.serviceUrl}</code></div>}
                {tool.lastError && <div className={styles.errorLine}>{tool.lastError}</div>}
                <div className={styles.toolActions}>
                  <button className="button" type="button" disabled={toolBusy || !tool.installerPath} onClick={() => void install(tool)}><HardDriveDownload size={14} />安装</button>
                  {tool.status === 'running' ? <button className="button buttonGhost" type="button" disabled={toolBusy} onClick={() => void stop(tool)}><Pause size={14} />停止服务</button> : <button className="button buttonPrimary" type="button" disabled={toolBusy || !tool.launcherPath} onClick={() => void start(tool)}><Play size={14} />启动服务</button>}
                  {workspace && <button className="button buttonAccent" type="button" onClick={() => void store.openWebWorkspace?.(workspace)}><ExternalLink size={14} />打开 Web UI</button>}
                  <button className="iconButton" type="button" title="刷新服务状态" aria-label={`刷新${tool.name}状态`} disabled={toolBusy} onClick={() => { setBusy(`refresh:${tool.id}`); void refresh(tool, workspace).catch((error) => setMessage(error instanceof Error ? error.message : '刷新服务状态失败。')).finally(() => setBusy(null)); }}><RefreshCw size={14} /></button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>

      {dialogOpen && <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}>
        <form className={styles.dialog} onSubmit={submitDraft}>
          <div className={styles.dialogHead}><div><span className={styles.kicker}>{editingTool ? '编辑本地工具' : '新增本地工具'}</span><h2>配置安装与启动脚本</h2></div><button className="iconButton" type="button" title="关闭" aria-label="关闭" onClick={() => { setDialogOpen(false); setEditingTool(null); }}><X size={16} /></button></div>
          <label><span>工具名称</span><input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如 PaperSpine5" /></label>
          <label><span>说明</span><textarea className="textarea" rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="这个工具提供什么 Web UI？" /></label>
          <label><span>安装脚本路径</span><div className={styles.pathRow}><input className="input" value={draft.installerPath} onChange={(event) => setDraft({ ...draft, installerPath: event.target.value })} placeholder="C:\\...\\install.ps1" /><button className="button" type="button" onClick={() => void choosePath('installer')}>选择</button></div></label>
          <label><span>安装参数（每行一个）</span><textarea className="textarea mono" rows={2} value={draft.installerArgs} onChange={(event) => setDraft({ ...draft, installerArgs: event.target.value })} placeholder="-Target\ncodex" /></label>
          <label><span>启动脚本或程序路径</span><div className={styles.pathRow}><input className="input" value={draft.launcherPath} onChange={(event) => setDraft({ ...draft, launcherPath: event.target.value })} placeholder="C:\\...\\launch.ps1" /><button className="button" type="button" onClick={() => void choosePath('launcher')}>选择</button></div></label>
          <label><span>启动参数（每行一个）</span><textarea className="textarea mono" rows={3} value={draft.launcherArgs} onChange={(event) => setDraft({ ...draft, launcherArgs: event.target.value })} placeholder="launch\n--no-open" /></label>
          <label><span>工作目录（可选）</span><input className="input" value={draft.workingDirectory} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} placeholder="留空则使用脚本所在目录" /></label>
          <div className={styles.dialogFoot}><button className="button" type="button" onClick={() => { setDialogOpen(false); setEditingTool(null); }}>取消</button><button className="button buttonPrimary" type="submit" disabled={busy === 'add' || busy === 'edit'}>{editingTool ? <Edit3 size={14} /> : <Plus size={14} />}{editingTool ? '保存配置' : '加入管理'}</button></div>
        </form>
      </div>}
    </>
  );
}
