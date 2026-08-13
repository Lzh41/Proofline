# Proofline Problem Sample Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为平台题和本地题补齐、编辑并持久化可运行样例，同时修复旧题因缓存而无法获得样例的问题。

**Architecture:** 共享 TypeScript 解析器负责本地正文恢复、规范化和去重；Rust 平台连接器负责公开题面抓取并输出结构化样例；Zustand 提供强制刷新命令；做题页提供补齐与编辑入口。数据仍通过现有快照同步到 SQLite `samples` 表，不新增迁移。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2、Rust、Serde、SQLite、CSS Modules。

---

### Task 1: 通用样例解析器

**Files:**
- Create: `src/lib/problemExamples.ts`
- Create: `src/test/problemExamples.test.ts`

- [ ] **Step 1: 写失败测试**：覆盖中文/英文标签、多样例、解释、全角冒号、正文提示截断、空输出拒绝、去重和 20 条上限。
- [ ] **Step 2: 运行红灯**：`npm.cmd test -- src/test/problemExamples.test.ts`，预期因模块不存在失败。
- [ ] **Step 3: 最小实现**：导出 `extractProblemExamples(text)`、`normalizeProblemExamples(examples)`、`mergeProblemExamples(existing, incoming)`；只接受输入输出成对的数据。
- [ ] **Step 4: 运行绿灯**：同一命令预期全部通过。

### Task 2: 力扣与牛客连接器

**Files:**
- Modify: `src-tauri/src/platform.rs`

- [ ] **Step 1: 写失败测试**：扩展牛客嵌入 JSON fixture，使 `questionContent` 包含三组输入/输出，并断言 `examples` 与 `sample_test_case`。
- [ ] **Step 2: 运行红灯**：`powershell.exe -ExecutionPolicy Bypass -File scripts/cargo-msvc.ps1 test platform::tests::extracts_nowcoder_public_metadata_and_exact_problem_id -- --exact`，预期 examples 为空。
- [ ] **Step 3: 最小实现**：把牛客元数据映射提取为纯函数；从 `content_html`、完整 HTML 与纯文本依次提取样例，规范化后传入 `public_metadata`。
- [ ] **Step 4: 兼容正文解析**：让解析器在 `<pre>` 缺失时按“示例/输入/输出/解释”段落切分，并保持力扣现有行为。
- [ ] **Step 5: 运行绿灯**：运行 platform Rust 测试并确认通过。

### Task 3: 强制刷新与旧题恢复

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/app/storeAdapter.ts`
- Modify: `src/types.ts`
- Create or Modify: `src/test/storeSamples.test.ts`

- [ ] **Step 1: 写失败测试**：断言本地正文可补齐、平台强制刷新绕过 7 天缓存、刷新结果与已有样例合并、失败不覆盖旧数据。
- [ ] **Step 2: 运行红灯**：`npm.cmd test -- src/test/storeSamples.test.ts`，预期缺少公开动作。
- [ ] **Step 3: 最小实现**：增加 `recoverProblemSamples(id)` 与 `refreshProblemMetadata(id)`；前者只解析本地正文，后者调用 `fetch_public_problem` 后合并字段并持久化。
- [ ] **Step 4: 启动回填**：初始化快照时仅对 `examples` 为空且正文可解析的题执行本地恢复，随后保存一次。
- [ ] **Step 5: 运行绿灯**：运行目标测试并确认通过。

### Task 4: 做题页样例编辑器

**Files:**
- Modify: `src/pages/SolvePage.tsx`
- Modify: `src/pages/Pages.module.css`
- Modify: `e2e/theme-layout.spec.ts`

- [ ] **Step 1: 写失败 E2E**：空样例题点击“运行样例”出现样例编辑器；保存输入输出后样例可见并可运行。
- [ ] **Step 2: 运行红灯**：`npm.cmd run test:e2e -- --grep "补齐样例"`，预期找不到控件。
- [ ] **Step 3: 实现交互**：题面操作区增加“补齐样例”和“编辑样例”；对话框支持增删、输入、预期输出、解释和保存。
- [ ] **Step 4: 运行前恢复**：空样例时先调用 `recoverProblemSamples`；仍为空则打开编辑器，不进入运行器。
- [ ] **Step 5: 样式与可访问性**：复用现有对话框、按钮和主题变量，限制对话框内部滚动，提供标签、焦点与错误文案。
- [ ] **Step 6: 运行绿灯**：目标 E2E 通过，并检查 `1440x900`、`1280x720`、`390x844`。

### Task 5: 回填、验证与交付

**Files:**
- Modify: `DELIVERY_REPORT.md`
- Regenerate: `artifacts/Proofline_0.1.0_x64-portable.exe`
- Regenerate: `src-tauri/target/release/bundle/nsis/Proofline_0.1.0_x64-setup.exe`

- [ ] **Step 1: 完整测试**：`npm.cmd test`、Rust 测试、前端生产构建和样例 E2E 全部通过。
- [ ] **Step 2: 真实数据回填**：备份后启动最新版，让当前四道旧题从正文恢复样例；只读查询确认 `samples` 表数量大于 0。
- [ ] **Step 3: 重新打包**：运行 `scripts/tauri-msvc.ps1 build`，覆盖 portable EXE，刷新 `G:\1桌面应用\Proofline.lnk`。
- [ ] **Step 4: 最新视觉验证**：完全退出后重新打开最新版，验证深浅主题、样例编辑器和运行结果；只保留本轮时间戳截图。
- [ ] **Step 5: 更新报告**：写入测试结果、回填数量、EXE 路径和 SHA-256。

