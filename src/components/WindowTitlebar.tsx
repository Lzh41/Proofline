import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import styles from './WindowTitlebar.module.css';

export function WindowTitlebar() {
  const desktop = isTauri();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;

    const appWindow = getCurrentWindow();
    let active = true;
    let stopListening: (() => void) | undefined;

    const syncMaximizedState = async () => {
      try {
        const next = await appWindow.isMaximized();
        if (active) setMaximized(next);
      } catch {
        // Window state can briefly be unavailable while the app is closing.
      }
    };

    void syncMaximizedState();
    void appWindow.onResized(syncMaximizedState).then((unlisten) => {
      if (active) stopListening = unlisten;
      else unlisten();
    });

    return () => {
      active = false;
      stopListening?.();
    };
  }, [desktop]);

  const minimize = () => {
    if (desktop) void getCurrentWindow().minimize();
  };

  const toggleMaximize = async () => {
    if (!desktop) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setMaximized(await appWindow.isMaximized());
    } catch {
      // Ignore commands dispatched while the native window is closing.
    }
  };

  const close = () => {
    if (desktop) void getCurrentWindow().close();
  };

  return (
    <header
      className={styles.titlebar}
      data-tauri-drag-region
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest(`.${styles.controls}`)) void toggleMaximize();
      }}
    >
      <span className={styles.identity} data-tauri-drag-region>Proofline</span>
      <div className={styles.controls}>
        <button className={styles.control} type="button" title="最小化窗口" aria-label="最小化窗口" onClick={minimize}>
          <Minus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          className={styles.control}
          type="button"
          title={maximized ? '还原窗口' : '最大化窗口'}
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          onClick={() => void toggleMaximize()}
        >
          {maximized
            ? <Copy size={13} strokeWidth={1.7} aria-hidden="true" />
            : <Square size={13} strokeWidth={1.7} aria-hidden="true" />}
        </button>
        <button className={`${styles.control} ${styles.close}`} type="button" title="关闭窗口" aria-label="关闭窗口" onClick={close}>
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
