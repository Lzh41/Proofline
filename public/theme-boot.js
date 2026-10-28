(function restoreThemeBeforePaint() {
  var theme = 'dark';
  try {
    var snapshot = JSON.parse(localStorage.getItem('xiti.app-data.v1') || 'null');
    var cachedTheme = snapshot && snapshot.settings && snapshot.settings.theme;
    if (cachedTheme === 'light' || cachedTheme === 'dark' || cachedTheme === 'system') {
      theme = cachedTheme;
    }
  } catch (_) {
    // Keep the default dark theme when the local cache is unavailable.
  }

  var resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  var root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = theme;
  root.style.colorScheme = resolved;

  // 平台标记必须在首帧前落到 <html> 上：字体栈和标题栏左侧红绿灯留白都靠它切换，
  // 等到 React 挂载后再设会先闪一下 Windows 字体（Segoe UI 在 macOS 上不存在，会掉到衬线字体）。
  var isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  root.dataset.os = isMac ? 'macos' : 'windows';

  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? '#181715' : '#faf9f5');
}());
