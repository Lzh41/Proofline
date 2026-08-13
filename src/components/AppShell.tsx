import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpenText,
  Boxes,
  CalendarCheck2,
  ChevronsLeft,
  Code2,
  BrainCircuit,
  LibraryBig,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Waypoints,
  Target,
  MessagesSquare,
  X,
} from 'lucide-react';
import clsx from 'clsx';
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
  { to: '/mistakes', label: '错题', icon: Target },
  { to: '/knowledge', label: '知识库', icon: BookOpenText },
  { to: '/plan', label: '计划', icon: CalendarCheck2 },
  { to: '/analytics', label: '统计', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [themeSaving, setThemeSaving] = useState(false);
  const themeSavePending = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStoreView();
  const resolvedTheme = useResolvedTheme(store.settings.theme ?? 'dark');
  const themeActionLabel = resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题';

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `/problems?q=${encodeURIComponent(trimmed)}` : '/problems');
  };

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
      <div className={clsx(styles.shell, collapsed && styles.collapsed)}>
      <button
        className={styles.mobileTrigger}
        type="button"
        aria-label="打开导航"
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={20} />
      </button>

      {mobileOpen && <button className={styles.backdrop} aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}

      <aside className={clsx(styles.sidebar, mobileOpen && styles.sidebarOpen)}>
        <div className={styles.brandRow}>
          <NavLink className={styles.brand} to="/" aria-label="Proofline 首页">
            <span className={styles.brandMark}><Waypoints size={20} strokeWidth={2.3} /></span>
            <span className={styles.brandLockup}>
              <span className={styles.brandText}>Proofline</span>
              <span className={styles.brandSub}>推理训练工作台</span>
            </span>
          </NavLink>
          <button className={styles.mobileClose} type="button" aria-label="关闭导航" onClick={() => setMobileOpen(false)}>
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
            className={styles.collapseButton}
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开导航' : '收起导航'}
            title={collapsed ? '展开导航' : '收起导航'}
          >
            <ChevronsLeft size={18} className={collapsed ? styles.rotated : undefined} />
          </button>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <form className={styles.search} onSubmit={submitSearch}>
            <Search size={17} aria-hidden="true" />
            <input
              id="global-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索题目、标签或题号"
              aria-label="全局搜索"
            />
            <kbd>Ctrl K</kbd>
          </form>
          <div className={styles.topbarActions}>
            <div className={styles.syncState} title="个人数据仅保存在本机">
              <span className={clsx(styles.statusDot, store.error && styles.statusError)} />
              {store.error ? '本地服务异常' : store.loading ? '正在整理数据' : '本地已保存'}
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
            </button>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </section>
      </div>
    </>
  );
}
