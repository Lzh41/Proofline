import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('无法找到应用挂载节点');
}

// ── 移除 StrictMode ──
// StrictMode 在开发模式下会让 useEffect 执行两次（mount → unmount → remount），
// 导致 Monaco Web Worker 被创建两次、onMount 回调被调用两次、completion provider
// 被注册两次。在 Tauri WebView2 环境中这还会引起 Worker 竞争条件。
// 桌面应用不需要 StrictMode 的副作用检测。
createRoot(root).render(<App />);
