/**
 * 运行平台判断。
 *
 * WebView 里没有可靠的系统 API，而且判错一次的代价很小（只是字体栈和标题栏留白不同），
 * 所以按 UA 认一下就够了。iPad 的「桌面模式」也会报 Macintosh，这里不区分——
 * 这是桌面应用，不可能跑在 iPad 上。
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}

/** 主修饰键的显示名：macOS 是 ⌘，Windows 是 Ctrl。 */
export function primaryModifierLabel(): string {
  return isMacOS() ? '⌘' : 'Ctrl';
}

/** 撤销：mac 是 ⌘Z，Windows 是 Ctrl+Z。 */
export function undoShortcutLabel(): string {
  return isMacOS() ? '⌘Z' : 'Ctrl+Z';
}

/** 重做：mac 的 Monaco 用 ⇧⌘Z，Windows 习惯 Ctrl+Y。 */
export function redoShortcutLabel(): string {
  return isMacOS() ? '⇧⌘Z' : 'Ctrl+Y';
}
