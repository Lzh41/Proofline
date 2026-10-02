import type { AppFontScale } from '../types';

export function applyAppFontScale(scale: AppFontScale, root: HTMLElement = document.documentElement): void {
  root.dataset.appFontScale = String(scale);
  root.style.setProperty('--app-font-scale', String(scale / 100));
}
