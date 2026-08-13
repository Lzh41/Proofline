# Proofline Claude 风格双主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Proofline 全界面改为暖色 Claude 风格，并提供可持久化的深色/浅色即时切换，浅色 Monaco 使用浅底深色代码。

**Architecture:** 以 `global.css` 的语义 CSS Variables 作为唯一主题源，`data-theme` 只切换 Token；React 组件只负责保存主题偏好和选择图标。纯函数负责显式主题切换与 Monaco 主题映射，所有页面复用语义 Token，避免组件内维护两套样式。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、CSS Modules、Zustand、Monaco Editor、Lucide、Tauri 2。

---

## 文件结构

- `src/app/theme.ts`：主题解析、顶栏切换目标和 Monaco 主题映射。
- `src/app/useResolvedTheme.ts`：订阅系统明暗变化并向 React 组件提供响应式主题。
- `src/test/theme.test.ts`：主题纯函数与 DOM 应用契约。
- `src/components/AppShell.tsx`：顶栏即时主题按钮及持久化调用。
- `src/styles/global.css`：深浅主题 Token 和全局控件状态。
- `src/components/AppShell.module.css`：侧栏、顶栏、搜索与主题按钮视觉。
- `src/components/WindowTitlebar.module.css`：透明原生控制条在双主题下的交互状态。
- `src/components/PagePrimitives.module.css`：页面标题、指标、空状态等共享视觉。
- `src/app/ErrorBoundary.module.css`：错误边界双主题视觉。
- `src/pages/Pages.module.css`：全部业务页面与做题工作区的语义颜色。
- `src/pages/SolvePage.tsx`：Monaco 主题使用统一映射。
- `src/lib/localMonaco.tsx`：注册 Proofline 暖白与暖炭黑 Monaco 主题。
- `README.md`、`DELIVERY_REPORT.md`：主题使用方式、最新安装包哈希和截图。

### Task 1: 主题行为契约

**Files:**
- Modify: `src/test/theme.test.ts`
- Modify: `src/app/theme.ts`
- Modify: `src/pages/SolvePage.tsx`

- [ ] **Step 1: 写入失败测试**

在 `src/test/theme.test.ts` 增加：

```ts
import { applyTheme, editorThemeFor, nextTheme, resolveTheme } from '../app/theme';

it('顶栏切换始终落到明确的深色或浅色偏好', () => {
  expect(nextTheme('dark')).toBe('light');
  expect(nextTheme('light')).toBe('dark');
  expect(nextTheme('system', true)).toBe('light');
  expect(nextTheme('system', false)).toBe('dark');
});

it('Monaco 跟随解析后的页面主题', () => {
  expect(editorThemeFor('light')).toBe('proofline-light');
  expect(editorThemeFor('dark')).toBe('proofline-dark');
  expect(editorThemeFor('system', false)).toBe('proofline-light');
  expect(editorThemeFor('system', true)).toBe('proofline-dark');
});
```

- [ ] **Step 2: 验证测试因缺少 API 失败**

Run: `npm test -- src/test/theme.test.ts`

Expected: FAIL，提示 `nextTheme` 或 `editorThemeFor` 未导出。

- [ ] **Step 3: 实现最小纯函数**

在 `src/app/theme.ts` 增加：

```ts
export type MonacoTheme = 'proofline-light' | 'proofline-dark';

export function nextTheme(theme: AppTheme, prefersDark = true): ResolvedTheme {
  return resolveTheme(theme, prefersDark) === 'dark' ? 'light' : 'dark';
}

export function editorThemeFor(theme: AppTheme, prefersDark = true): MonacoTheme {
  return resolveTheme(theme, prefersDark) === 'dark' ? 'proofline-dark' : 'proofline-light';
}
```

增加 `useResolvedTheme` 的系统媒体查询订阅测试并实现响应式 Hook；`SolvePage.tsx` 改为使用 Hook 与 `editorThemeFor`，不再内联三元表达式。

- [ ] **Step 4: 验证主题测试通过**

Run: `npm test -- src/test/theme.test.ts`

Expected: PASS，主题测试全部通过。

### Task 2: 顶栏即时切换

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/AppShell.module.css`

- [ ] **Step 1: 接入解析主题与持久化**

在 `AppShell` 中用系统媒体查询解析当前主题，并调用：

```ts
const resolvedTheme = resolveTheme(
  store.settings.theme ?? 'dark',
  typeof window === 'undefined' || window.matchMedia('(prefers-color-scheme: dark)').matches,
);

const toggleTheme = () => {
  void store.updateSettings?.({ theme: nextTheme(store.settings.theme ?? 'dark', resolvedTheme === 'dark') });
};
```

- [ ] **Step 2: 添加唯一的图标按钮**

在本地保存状态右侧加入 `Sun`/`Moon` Lucide 图标按钮，`aria-label` 与 `title` 使用“切换为浅色主题”或“切换为深色主题”。按钮固定 `38px`，不得挤压搜索栏或造成顶栏换行。

- [ ] **Step 3: 完成悬停、焦点、按下和窄屏状态**

使用 `themeToggle` 样式，圆角 `8px`；宽度小于 `560px` 时保持图标、隐藏非必要同步文字。

- [ ] **Step 4: 构建验证组件类型**

Run: `npm run build`

Expected: TypeScript 与 Vite 均成功退出，未出现未使用导入或 JSX 类型错误。

### Task 3: 全局 Claude Token 与外壳

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/components/AppShell.module.css`
- Modify: `src/components/WindowTitlebar.module.css`

- [ ] **Step 1: 定义深色默认 Token**

在 `:root` 定义设计规格中的深色 Token，并增加 `--control`、`--sidebar`、`--subtle-fill`、`--hover-fill`、`--backdrop`、`--accent-rgb`、`--info-rgb`、`--danger-rgb`、`--warning-rgb` 等语义变量。

- [ ] **Step 2: 定义浅色 Token 覆盖**

在 `:root[data-theme='light']` 只覆盖 Token，不复制组件规则。必须包含 `--paper: #faf9f5`、`--surface-elevated: #ffffff`、`--ink: #141413`、`--accent: #cc785c`。

- [ ] **Step 3: 将全局控件改用语义变量**

按钮、输入、选择框、文本框、焦点环、选中文本和滚动条全部改用 Token；移除旧的荧光绿和网格背景。

- [ ] **Step 4: 重绘应用外壳**

侧栏、品牌标识、导航、顶栏搜索和同步状态改为暖色表面；窗口控制条继续透明，悬停背景使用 `--hover-fill`，关闭按钮使用错误色。

- [ ] **Step 5: 构建检查 CSS Modules**

Run: `npm run build`

Expected: PASS，Vite 不报告无效 CSS 或缺失模块类名。

### Task 4: 业务页面双主题

**Files:**
- Modify: `src/components/PagePrimitives.module.css`
- Modify: `src/app/ErrorBoundary.module.css`
- Modify: `src/pages/Pages.module.css`

- [ ] **Step 1: 共享组件使用 Token**

页面标题、指标、空状态、强调面板和错误边界改用 `--surface-*`、`--ink`、`--muted` 与语义色变量；删除旧绿色发光值。

- [ ] **Step 2: 清理通用业务页面硬编码深色**

表格、筛选器、平台行、计划、知识库、统计、设置和对话框的背景与文字全部改用语义变量。浅色主题下不得保留 `#09...`、`#0c...`、`#0f...`、`#11...` 黑色面板。

- [ ] **Step 3: 完整实现交互状态**

逐项检查悬停、焦点、按下、禁用、加载、空数据、错误与溢出；颜色变化不得改变元素尺寸。

- [ ] **Step 4: 扫描残留旧色**

Run: `rg -n "#090b0c|#0c0e0f|#0f1213|#111817|102, 227, 188|54, 189, 146" src --glob "*.css"`

Expected: 无匹配；仅设计无关的测试夹具可例外并在交付报告说明。

### Task 5: 做题页与浅色 Monaco

**Files:**
- Modify: `src/pages/Pages.module.css`
- Modify: `src/pages/SolvePage.tsx`

- [ ] **Step 1: 统一做题页表面**

题面、代码工作台、运行结果、AI 助手、对话卡片和输入区使用语义 Token。浅色主题所有主工作区均为浅色背景，深色主题为暖炭黑。

- [ ] **Step 2: 保持单屏布局契约**

桌面继续使用“题目在上、代码与 AI 左右排布”；只允许内部面板隐藏式滚动。`1280x720` 下题目、工具栏、编辑器和 AI 输入区不得互相覆盖。

- [ ] **Step 3: 验证 Monaco 主题**

浏览器分别切换浅色与深色，检查 `.monaco-editor`：浅色背景和深色代码、深色背景和浅色代码，主题切换后无需刷新。

- [ ] **Step 4: 验证做题功能未回归**

运行两数之和样例，编辑器中只保留题目函数，不写测试入口；预期自动生成入口并显示通过结果。随后触发 AI 助手空状态和按钮禁用状态，确认无重叠。

### Task 6: 全量验证与桌面交付

**Files:**
- Modify: `README.md`
- Modify: `DELIVERY_REPORT.md`
- Update: `artifacts/Proofline_0.1.0_x64-portable.exe`
- Update: `src-tauri/target/release/bundle/nsis/Proofline_0.1.0_x64-setup.exe`
- Update: `G:/1桌面应用/Proofline.lnk`

- [ ] **Step 1: 运行全量单元测试**

Run: `npm test`

Expected: 所有 Vitest 测试通过，失败数为 `0`。

- [ ] **Step 2: 运行前端生产构建**

Run: `npm run build`

Expected: TypeScript 与 Vite 成功，`dist` 生成。

- [ ] **Step 3: 最新页面多尺寸视觉验收**

重新启动开发服务或最新桌面 EXE，分别验证 `1440px`、`768px`、`390px` 和 `1280x720`。截图文件名包含 `20260718-HHmmss`，每次新截图前删除本任务旧截图，只保留本轮最终截图。

- [ ] **Step 4: 构建 NSIS 与便携版**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tauri-msvc.ps1 build`

Expected: `src-tauri/target/release/bundle/nsis/Proofline_0.1.0_x64-setup.exe` 存在且构建退出码为 `0`。将 `src-tauri/target/release/xiti.exe` 复制为最新便携版。

- [ ] **Step 5: 更新快捷方式与哈希**

使用 Windows Shell COM 将 `G:/1桌面应用/Proofline.lnk` 指向最新便携版，并计算安装包与便携版 SHA-256；快捷方式图标指向最新 `src-tauri/icons/icon.ico`。

- [ ] **Step 6: 重启最新 EXE 并写交付报告**

完全退出旧进程，启动最新便携版，刷新真实做题页并截取深色与浅色最终界面。`README.md` 写明顶栏切换与设置页“跟随系统”的用法，`DELIVERY_REPORT.md` 更新测试结果、哈希、路径、验证时间和最新截图。

## 自查

- 规格覆盖：双主题、Claude 风格边界、顶栏切换、浅色 Monaco、全页面、响应式、桌面构建和快捷方式均有对应任务。
- 完整性扫描：每项任务均包含文件、动作、验证命令和预期结果。
- 类型一致性：统一使用 `AppTheme`、`ResolvedTheme`、`nextTheme` 与 `editorThemeFor`；Monaco 只接收 `proofline-light` 或 `proofline-dark`。
