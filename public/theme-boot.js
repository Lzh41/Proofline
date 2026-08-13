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

  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? '#181715' : '#faf9f5');
}());
