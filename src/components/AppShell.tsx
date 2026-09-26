import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookOpenText,
  Boxes,
  CalendarCheck2,
  Code2,
  BrainCircuit,
  Download,
  LibraryBig,
  Languages,
  Menu,
  Moon,
  Globe2,
  Settings,
  Sun,
  Waypoints,
  Target,
  MessagesSquare,
  X,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useStoreView } from '../app/storeAdapter';
import { nextTheme } from '../app/theme';
import { useResolvedTheme } from '../app/useResolvedTheme';
import styles from './AppShell.module.css';
import { WindowTitlebar } from './WindowTitlebar';

const NAVIGATION = [
  { to: '/', label: '今日', icon: CalendarCheck2, end: true },
  { to: '/platforms', label: '平台', icon: Boxes },
  { to: '/problems', label: '题库', icon: LibraryBig },
  { to: '/interviews', label: '面试题', icon: MessagesSquare },
  { to: '/solve', label: '做题', icon: Code2 },
  { to: '/review', label: '复习', icon: Target },
  { to: '/vocabulary', label: '词汇', icon: Languages },
  { to: '/knowledge', label: '知识库', icon: BookOpenText },
  { to: '/plan', label: '计划', icon: CalendarCheck2 },
  { to: '/analytics', label: '统计', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/tools', label: '本地工具', icon: Wrench },
] as const;

function downloadPercent(progress: { received: number; total?: number | null } | null | undefined): number | null {
  if (!progress?.total || progress.total <= 0) return null;
  return Math.min(100, Math.max(0, (progress.received / progress.total) * 100));
}

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [activeWebWorkspaceId, setActiveWebWorkspaceId] = useState<string | null>(null);
  const themeSavePending = useRef(false);
  const location = useLocation();
  const store = useStoreView();
  const resolvedTheme = useResolvedTheme(store.settings.theme ?? 'dark');
  const themeActionLabel = resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题';

  useEffect(() => {
    setMobileOpen(false);
    setCollapsed(true);
  }, [location.pathname]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke('set_web_workspace_layout', { collapsed }).catch(() => undefined);
  }, [collapsed]);

  const openWebWorkspaces = (store.webWorkspaces ?? []).filter((workspace) => workspace.status === 'open');

  useEffect(() => {
    if (openWebWorkspaces.length === 0) {
      setActiveWebWorkspaceId(null);
      return;
    }
    if (!activeWebWorkspaceId || !openWebWorkspaces.some((workspace) => workspace.id === activeWebWorkspaceId)) {
      const latest = [...openWebWorkspaces].sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))[0];
      setActiveWebWorkspaceId(latest.id);
    }
  }, [activeWebWorkspaceId, openWebWorkspaces]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (location.pathname !== '/problems') return;
        const problemSearch = document.getElementById('problem-search');
        if (!problemSearch) return;
        event.preventDefault();
        problemSearch.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [location.pathname]);

  const toggleTheme = async () => {
    if (themeSavePending.current || !store.updateSettings || !store.initialized || store.loading) return;
    themeSavePending.current = true;
    setThemeSaving(true);
    try {
      await store.updateSettings({ theme: nextTheme(resolvedTheme) });
    } catch {
      // The store exposes persistence failures through its existing error state.
    } finally {
      themeSavePending.current = false;
      setThemeSaving(false);
    }
  };

  return (
    <>
      <WindowTitlebar />
      <div className={clsx(styles.shell, collapsed && styles.collapsed, !collapsed && styles.navigationOpen)}>
      <button
        className={styles.mobileTrigger}
        type="button"
        aria-label={collapsed ? '展开导航' : '打开导航'}
        title={collapsed ? '展开导航' : '打开导航'}
        onClick={() => {
          if (collapsed) setCollapsed(false);
          setMobileOpen(true);
        }}
      >
        <Menu size={20} />
      </button>

      {mobileOpen && <button className={styles.backdrop} aria-label="关闭导航" onClick={() => { setMobileOpen(false); setCollapsed(true); }} />}

      <aside className={clsx(styles.sidebar, mobileOpen && styles.sidebarOpen)}>
        <div className={styles.brandRow}>
          <NavLink className={styles.brand} to="/" aria-label="Proofline 首页">
            <span className={styles.brandMark}><Waypoints size={20} strokeWidth={2.3} /></span>
            <span className={styles.brandLockup}>
              <span className={styles.brandText}>Proofline</span>
              <span className={styles.brandSub}>推理训练工作台</span>
            </span>
          </NavLink>
          <button className={styles.mobileClose} type="button" aria-label="收起导航" title="收起导航" onClick={() => { setMobileOpen(false); setCollapsed(true); }}>
            <X size={19} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="主导航">
          {NAVIGATION.map((item) => {
            const { to, label, icon: Icon } = item;
            return (
            <NavLink
              key={to}
              to={to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) => clsx(styles.navItem, isActive && styles.navItemActive)}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
            );
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.streak}>
            <BrainCircuit size={17} aria-hidden="true" />
            <span><strong>{store.attempts.length}</strong> 次练习已沉淀</span>
          </div>
          <button
            className={styles.themeToggle}
            type="button"
            aria-label={themeActionLabel}
            title={themeActionLabel}
            aria-busy={themeSaving}
            disabled={themeSaving || !store.initialized || store.loading}
            onClick={() => { void toggleTheme(); }}
          >
            {resolvedTheme === 'dark'
              ? <Sun size={17} strokeWidth={1.9} aria-hidden="true" />
              : <Moon size={17} strokeWidth={1.9} aria-hidden="true" />}
            <span>切换主题</span>
          </button>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          {store.githubToolDownload?.active && (
            <div className={styles.downloadIndicator} role="status" aria-label="GitHub 工具下载进行中">
              <Download size={14} aria-hidden="true" />
              <span>工具下载中</span>
              <strong>{downloadPercent(store.githubToolDownload.progress) === null ? '…' : `${downloadPercent(store.githubToolDownload.progress)?.toFixed(0)}%`}</strong>
            </div>
          )}
          {openWebWorkspaces.length > 0 && (
            <div className={styles.webTabs} role="tablist" aria-label="已打开的 Web 工作台">
              {openWebWorkspaces.map((workspace) => {
                const active = workspace.id === activeWebWorkspaceId;
                return (
                  <div
                    className={clsx(styles.webTab, active && styles.webTabActive)}
                    key={workspace.id}
                    role="presentation"
                  >
                    <button
                      className={styles.webTabLabel}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={`切换到${workspace.name}`}
                      onClick={() => {
                        setActiveWebWorkspaceId(workspace.id);
                        void store.openWebWorkspace?.(workspace);
                      }}
                    >
                      <Globe2 size={14} strokeWidth={1.9} aria-hidden="true" />
                      <span>{workspace.name}</span>
                    </button>
                    <button
                      className={styles.webTabClose}
                      type="button"
                      aria-label={`关闭${workspace.name}`}
                      title={`关闭${workspace.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = openWebWorkspaces.find((item) => item.id !== workspace.id);
                        if (active) setActiveWebWorkspaceId(next?.id ?? null);
                        void store.closeWebWorkspace?.(workspace).then(() => {
                          if (active && next) void store.openWebWorkspace?.(next);
                        });
                      }}
                    >
                      <X size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </header>
        <main className={styles.content}>{children}</main>
      </section>
      </div>
    </>
  );
}
