# Proofline 企业面试题工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Proofline 增加包含至少 360 道完整内容、现代岗位检索、离线练习、AI 模拟面试、错题复习、计划与统计联动的企业面试题工作台。

**Architecture:** 在现有 `Problem`、`Attempt`、`Mistake`、`DailyPlan` 上增加题目类型和面试元数据，以最小迁移复用学习闭环；算法页、运行器和算法统计只消费 `kind === 'algorithm'`，面试页和面试统计只消费 `kind === 'interview'`。内置题库是独立、版本化、可校验的数据模块，使用稳定 catalog ID 增量写入 SQLite，用户活动与题目正文分离保存。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Zustand 5、Vitest 4、Playwright、Tauri 2、Rust、rusqlite、CSS Modules、Lucide。

---

## 文件结构

- 创建 `src/data/interviewCatalog.ts`：岗位定义、别名和内置题库内容。
- 创建 `src/lib/interviews.ts`：题库校验、搜索、种子合并、掌握状态与统计纯函数。
- 创建 `src/pages/InterviewsPage.tsx`：岗位检索、筛选、列表、新增与恢复题库。
- 创建 `src/pages/InterviewPracticePage.tsx`：回答草稿、离线参考、AI 追问和结束复盘。
- 创建 `src/test/interviews.test.ts`：题量、覆盖、检索、种子升级和统计测试。
- 创建 `src/test/interviewStore.test.ts`：持久化、练习、复习、计划与备份测试。
- 创建 `e2e/interview-flow.spec.ts`：完整面试学习闭环与响应式验收。
- 创建 `src-tauri/migrations/002_interview_workbench.sql`：结构化表新增字段。
- 修改 `src/types.ts`：题目、尝试、错题、设置、计划和统计类型。
- 修改 `src/lib/data.ts`、`src/lib/importer.ts`、`src/lib/planner.ts`、`src/lib/statistics.ts`、`src/lib/backup.ts`、`src/lib/ai.ts`：兼容、去重、排程、统计、清单和 AI 提示。
- 修改 `src/store/useAppStore.ts`、`src/app/storeAdapter.ts`：初始化种子与面试练习动作。
- 修改 `src/App.tsx`、`src/components/AppShell.tsx`、`src/pages/Pages.module.css`：路由、导航和界面。
- 修改 `src/pages/TodayPage.tsx`、`src/pages/MistakesPage.tsx`、`src/pages/PlanPage.tsx`、`src/pages/AnalyticsPage.tsx`、`src/pages/SettingsPage.tsx`：闭环入口。
- 修改 `src-tauri/src/db.rs`：顺序迁移与新增字段同步。
- 修改 `README.md`、`DELIVERY_REPORT.md`：使用说明与最新交付证据。

### Task 1：类型、兼容规范化与成功结果

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/lib/statistics.ts`
- Test: `src/test/interviews.test.ts`

- [ ] **Step 1：先写失败测试**

```ts
it('把旧快照规范化为算法题和代码尝试', () => {
  const snapshot = normalizeSnapshot({ schemaVersion: 1, problems: [{ ...problem, kind: undefined }], attempts: [{ ...attempt, mode: undefined }] });
  expect(snapshot.schemaVersion).toBe(2);
  expect(snapshot.problems[0].kind).toBe('algorithm');
  expect(snapshot.attempts[0].mode).toBe('code');
});

it('算法和面试成功结果互不污染', () => {
  expect(isSuccessfulAttempt('algorithm', 'accepted')).toBe(true);
  expect(isSuccessfulAttempt('algorithm', 'mastered')).toBe(false);
  expect(isSuccessfulAttempt('interview', 'mastered')).toBe(true);
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/interviews.test.ts`

Expected: FAIL，缺少面试类型和 `isSuccessfulAttempt`。

- [ ] **Step 3：实现最小类型和逐项规范化**

```ts
export type ProblemKind = 'algorithm' | 'interview';
export type InterviewFormat = 'knowledge' | 'scenario' | 'system-design' | 'project';
export type AttemptMode = 'code' | 'interview';

export interface InterviewProblemData {
  catalogId?: string;
  catalogVersion?: number;
  contentOrigin: 'builtin' | 'user' | 'import' | 'ai';
  primaryRole: string;
  roles: string[];
  category: string;
  format: InterviewFormat;
  keyPoints: string[];
  referenceAnswer: string;
  followUps: string[];
  archived?: boolean;
}

export function isSuccessfulAttempt(kind: ProblemKind, result: AttemptResult): boolean {
  return kind === 'interview' ? result === 'mastered' : result === 'sample-passed' || result === 'accepted';
}
```

`normalizeSnapshot` 必须逐题补 `kind: 'algorithm'`，逐尝试补 `mode: 'code'`，逐计划补面试目标，并输出 schema 2。

- [ ] **Step 4：运行测试并检查类型**

Run: `npm.cmd test -- src/test/interviews.test.ts && npm.cmd run build`

Expected: 新测试 PASS，TypeScript 构建无错误。

### Task 2：360 道版本化内置题库与搜索

**Files:**
- Create: `src/data/interviewCatalog.ts`
- Create: `src/lib/interviews.ts`
- Test: `src/test/interviews.test.ts`

- [ ] **Step 1：先写题库完整性失败测试**

```ts
it('内置题库数量、字段、ID 和方向覆盖完整', () => {
  expect(INTERVIEW_CATALOG.length).toBeGreaterThanOrEqual(360);
  expect(new Set(INTERVIEW_CATALOG.map((item) => item.id)).size).toBe(INTERVIEW_CATALOG.length);
  for (const item of INTERVIEW_CATALOG) {
    expect(item.question.trim()).not.toBe('');
    expect(item.keyPoints.length).toBeGreaterThanOrEqual(3);
    expect(item.referenceAnswer.length).toBeGreaterThanOrEqual(80);
    expect(item.followUps.length).toBeGreaterThanOrEqual(1);
  }
  expect(countByPrimaryRole(INTERVIEW_CATALOG)).toMatchObject(MINIMUM_ROLE_COVERAGE);
});

it('岗位别名和正文关键词可以命中', () => {
  expect(searchInterviewCatalog(INTERVIEW_CATALOG, { query: '大模型', role: 'llm-app' }).length).toBeGreaterThan(0);
  expect(searchInterviewCatalog(INTERVIEW_CATALOG, { query: '自然语言处理' }).some((item) => item.roles.includes('nlp'))).toBe(true);
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/interviews.test.ts`

Expected: FAIL，catalog 和搜索函数不存在。

- [ ] **Step 3：实现岗位常量和题库生成边界**

```ts
export const INTERVIEW_ROLES = [
  { id: 'llm-app', label: '大语言模型应用开发', aliases: ['LLM', '大模型', '语言模型'] },
  { id: 'nlp', label: 'NLP 算法工程师', aliases: ['NLP', '自然语言处理'] },
  { id: 'rag-agent', label: 'RAG / Agent 工程师', aliases: ['RAG', 'Agent', '智能体'] },
  { id: 'multimodal', label: '多模态算法工程师', aliases: ['多模态', '视觉语言模型', 'VLM'] },
  { id: 'ai-platform', label: 'AI 平台 / MLOps 工程师', aliases: ['MLOps', '模型平台', '推理平台'] },
  { id: 'recommendation-search', label: '推荐与搜索算法工程师', aliases: ['推荐', '搜索', '排序'] },
  { id: 'backend', label: '后端开发工程师', aliases: ['后端', '服务端'] },
  { id: 'frontend', label: '前端开发工程师', aliases: ['前端', 'Web'] },
  { id: 'client', label: '移动端 / 客户端开发工程师', aliases: ['Android', 'iOS', '客户端'] },
  { id: 'data-engineering', label: '数据工程师', aliases: ['大数据', '数仓', '数据开发'] },
  { id: 'test-development', label: '测试开发工程师', aliases: ['测开', '质量工程'] },
  { id: 'sre-devops', label: '云原生 / DevOps / SRE 工程师', aliases: ['SRE', 'DevOps', '云原生'] },
  { id: 'security', label: '安全工程师', aliases: ['网络安全', '应用安全'] },
  { id: 'embedded', label: '嵌入式 / 物联网工程师', aliases: ['嵌入式', 'IoT', 'RTOS'] },
] as const;
```

题库内容按方向拆成聚焦数组后汇总导出。每道题使用真实、独立的题面、至少三个参考要点、不少于 80 个中文字符的完整答案和至少一条追问；禁止使用序号替换、模板占位或同答案批量复制。

- [ ] **Step 4：实现校验、搜索和种子转换**

```ts
export function validateInterviewCatalog(items: InterviewCatalogItem[]): string[];
export function searchInterviewCatalog(items: InterviewCatalogItem[], filter: InterviewSearchFilter): InterviewCatalogItem[];
export function catalogItemToProblem(item: InterviewCatalogItem, now: number): Problem;
export function mergeInterviewCatalog(problems: Problem[], items: InterviewCatalogItem[], now: number): Problem[];
```

- [ ] **Step 5：运行完整性测试**

Run: `npm.cmd test -- src/test/interviews.test.ts`

Expected: PASS，至少 360 道，所有覆盖门槛满足。

### Task 3：导入、备份、种子初始化与 Store 练习动作

**Files:**
- Modify: `src/lib/importer.ts`
- Modify: `src/lib/backup.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/app/storeAdapter.ts`
- Test: `src/test/interviewStore.test.ts`
- Test: `src/test/importer.test.ts`

- [ ] **Step 1：先写失败测试**

```ts
it('同名算法题和面试题不会合并', () => {
  const result = importSnapshot(snapshotWithAlgorithm('并发'), snapshotWithInterview('并发'));
  expect(result.snapshot.problems).toHaveLength(2);
});

it('初始化写入 catalog 且重复初始化幂等', async () => {
  await useAppStore.getState().initialize();
  const once = useAppStore.getState().problems.filter(isInterviewProblem).length;
  await useAppStore.getState().refresh();
  expect(useAppStore.getState().problems.filter(isInterviewProblem)).toHaveLength(once);
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/interviewStore.test.ts src/test/importer.test.ts`

Expected: FAIL，去重 key 不含 kind，store 没有 catalog 合并。

- [ ] **Step 3：实现安全合并和备份计数**

```ts
const key = problem.externalId
  ? `external:${problem.kind}:${problem.source}:${normalizeText(problem.externalId)}`
  : `title:${problem.kind}:${problem.source}:${normalizeText(problem.title)}`;

entityCounts: {
  problems: snapshot.problems.length,
  attempts: snapshot.attempts.length,
  thoughtEvents: snapshot.thoughtEvents.length,
  platformResults: snapshot.platformResults.length,
  mistakes: snapshot.mistakes.length,
  knowledgeNotes: snapshot.knowledgeNotes.length,
  codeTemplates: snapshot.codeTemplates.length,
  dailyPlans: snapshot.dailyPlans.length,
  aiGenerations: snapshot.aiGenerations.length,
  algorithmProblems: snapshot.problems.filter((item) => item.kind === 'algorithm').length,
  interviewQuestions: snapshot.problems.filter((item) => item.kind === 'interview').length,
  interviewAttempts: snapshot.attempts.filter((item) => item.mode === 'interview').length,
}
```

- [ ] **Step 4：实现面试 Store 动作**

```ts
startInterviewAttempt(problemId: string): Promise<Attempt>;
saveInterviewDraft(attemptId: string, answerText: string): Promise<void>;
finishInterviewAttempt(attemptId: string, input: FinishInterviewInput): Promise<void>;
restoreInterviewCatalog(): Promise<number>;
```

“模糊/不会”必须创建或更新 `Mistake`，掌握完成计划；保存失败保持内存草稿并暴露中文错误。

- [ ] **Step 5：运行测试**

Run: `npm.cmd test -- src/test/interviewStore.test.ts src/test/importer.test.ts src/test/business.test.ts`

Expected: PASS，旧业务测试无回归。

### Task 4：计划、复习、统计与 AI 面试提示

**Files:**
- Modify: `src/lib/planner.ts`
- Modify: `src/lib/statistics.ts`
- Modify: `src/lib/ai.ts`
- Modify: `src/store/useAppStore.ts`
- Test: `src/test/planner.test.ts`
- Test: `src/test/interviews.test.ts`
- Test: `src/test/ai-stream.test.ts`

- [ ] **Step 1：先写失败测试**

```ts
it('计划先排面试到期复习再补薄弱岗位新题', () => {
  const plan = generatePlan(problems, attempts, mistakes, { targetProblems: 3, targetInterviewQuestions: 2, now });
  expect(plan.taskProblemIds[0]).toBe(dueInterview.id);
  expect(plan.taskProblemIds.filter((id) => interviewIds.has(id))).toHaveLength(2);
});

it('面试提示词包含回答、要点和意图', () => {
  const prompt = buildInterviewPrompt({ intent: 'interview-critique', problem, answerText: '我的回答' });
  expect(prompt).toContain('我的回答');
  expect(prompt).toContain(problem.interview!.keyPoints[0]);
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/planner.test.ts src/test/interviews.test.ts src/test/ai-stream.test.ts`

Expected: FAIL，面试目标和提示函数不存在。

- [ ] **Step 3：实现排程和统计隔离**

```ts
export function calculateInterviewStatistics(problems: Problem[], attempts: Attempt[], mistakes: Mistake[], now?: number): InterviewStatistics;
export type AiCoachIntent = 'analyze' | 'next-code' | 'debug' | 'edge-cases' | 'complete'
  | 'interview-follow-up' | 'interview-critique' | 'interview-omissions' | 'interview-improve';
export function buildInterviewPrompt(input: InterviewPromptInput): string;
```

算法 `calculateStatistics` 只统计算法题。面试统计按岗位和分类计算薄弱项，计划对两种类型分别补齐目标。

- [ ] **Step 4：运行测试**

Run: `npm.cmd test -- src/test/planner.test.ts src/test/interviews.test.ts src/test/ai-stream.test.ts`

Expected: PASS。

### Task 5：SQLite schema 2 与结构化同步

**Files:**
- Create: `src-tauri/migrations/002_interview_workbench.sql`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1：先写失败的 Rust 迁移测试**

```rust
#[test]
fn v1_database_upgrades_to_interview_schema_and_is_idempotent() {
    apply_migrations(&path).unwrap();
    apply_migrations(&path).unwrap();
    assert!(column_exists(&path, "problems", "kind"));
    assert!(column_exists(&path, "attempts", "mode"));
    assert_eq!(migration_versions(&path), vec![1, 2]);
}
```

- [ ] **Step 2：运行失败测试**

Run: `cargo test db::tests::v1_database_upgrades_to_interview_schema_and_is_idempotent -- --exact`

Expected: FAIL，schema 2 不存在。

- [ ] **Step 3：实现顺序迁移**

```rust
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "initial", include_str!("../migrations/001_initial.sql")),
    (2, "interview_workbench", include_str!("../migrations/002_interview_workbench.sql")),
];
```

每个未应用迁移在事务中执行并写入 `schema_migrations`。`sync_structured_tables` 写入 `kind/interview_json/mode/interview_json`，并根据 `reviewMistakeIds -> problemId` 正确写 `daily_plan_tasks.task_type`。

- [ ] **Step 4：运行 Rust 测试和格式检查**

Run: `cargo test && cargo fmt --check`

Expected: 全部 PASS。

### Task 6：面试题工作台与练习页

**Files:**
- Create: `src/pages/InterviewsPage.tsx`
- Create: `src/pages/InterviewPracticePage.tsx`
- Modify: `src/pages/Pages.module.css`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`
- Test: `src/test/interviewPages.test.tsx`

- [ ] **Step 1：先写失败组件测试**

```tsx
it('按现代岗位过滤并打开题目', async () => {
  render(<InterviewsPage />);
  await user.click(screen.getByRole('button', { name: '大语言模型应用开发' }));
  expect(screen.getByText('RAG 中如何评估检索质量与生成质量？')).toBeVisible();
});

it('无 AI 时仍可提交并查看离线答案', async () => {
  render(<InterviewPracticePage />);
  expect(screen.getByRole('button', { name: '点评回答' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(screen.getByText('参考要点')).toBeVisible();
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/interviewPages.test.tsx`

Expected: FAIL，页面和路由不存在。

- [ ] **Step 3：实现页面和路由**

工作台复用 `PageHeader`、按钮、筛选、表格与空状态；练习页使用固定高度的题面 + 回答/教练左右布局。所有文案使用中文，图标来自 Lucide，页面不加载 Monaco、OCR 或 Pyodide。

- [ ] **Step 4：实现完整状态**

实现岗位横向筛选、关键词、分类、题型、掌握状态、随机一题、新增题目、恢复 catalog、草稿自动保存、提交后解锁、AI 加载/取消/错误和结束复盘对话框。

- [ ] **Step 5：运行组件测试和构建**

Run: `npm.cmd test -- src/test/interviewPages.test.tsx && npm.cmd run build`

Expected: PASS，无 TypeScript/CSS 构建错误。

### Task 7：今日、错题、计划、统计与设置联动

**Files:**
- Modify: `src/pages/TodayPage.tsx`
- Modify: `src/pages/MistakesPage.tsx`
- Modify: `src/pages/PlanPage.tsx`
- Modify: `src/pages/AnalyticsPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/Pages.module.css`
- Test: `src/test/business.test.ts`

- [ ] **Step 1：先写失败测试**

```ts
it('今日入口按题目类型导航', () => {
  expect(learningRoute(interviewProblem)).toBe(`/interviews/${interviewProblem.id}`);
  expect(learningRoute(algorithmProblem)).toBe(`/solve/${algorithmProblem.id}`);
});
```

- [ ] **Step 2：运行失败测试**

Run: `npm.cmd test -- src/test/business.test.ts`

Expected: FAIL，统一学习路由不存在。

- [ ] **Step 3：实现闭环页面**

今日和错题按钮按类型进入正确页面；计划页可设置算法题和面试题目标；统计页增加独立面试统计区域；设置页显示 catalog 版本、题量和恢复动作。所有指标明确标注题目类型。

- [ ] **Step 4：运行测试**

Run: `npm.cmd test -- src/test/business.test.ts src/test/planner.test.ts src/test/interviews.test.ts`

Expected: PASS。

### Task 8：端到端、响应式与可视化验收

**Files:**
- Create: `e2e/interview-flow.spec.ts`
- Modify: `e2e/theme-layout.spec.ts`

- [ ] **Step 1：写 E2E 流程**

覆盖岗位筛选、打开题目、回答草稿、刷新恢复、提交解锁、选择模糊、进入错题、深浅主题和离线 AI 禁用状态。

- [ ] **Step 2：运行 E2E 并修复失败**

Run: `npm.cmd run test:e2e -- --workers=1`

Expected: 全部 PASS。

- [ ] **Step 3：响应式检查**

在 1440×900、1280×720、768×900 和 390×844 检查：无重叠、无横向页面溢出、主页面无可见滚动条、长答案内部可滚动、深浅主题编辑区对比度正确。

- [ ] **Step 4：完整测试**

Run: `npm.cmd test && npm.cmd run build && cargo test && cargo fmt --check`

Expected: 所有命令 exit 0。

### Task 9：正式构建、快捷方式与交付证据

**Files:**
- Modify: `README.md`
- Modify: `DELIVERY_REPORT.md`
- Output: `artifacts/Proofline_0.1.0_x64-portable.exe`
- Output: `src-tauri/target/release/bundle/nsis/Proofline_0.1.0_x64-setup.exe`
- Output: `artifacts/proofline-interviews-<timestamp>.png`
- Output: `G:/1桌面应用/Proofline.lnk`

- [ ] **Step 1：更新使用说明与交付报告**

说明岗位检索、离线答题、AI 面试、掌握度复盘、复习、计划和 catalog 版本；报告列出题量与覆盖、测试结果、已知第三方限制和构建路径。

- [ ] **Step 2：正式构建**

Run: `powershell.exe -ExecutionPolicy Bypass -File scripts\tauri-msvc.ps1 -Mode build`

Expected: release EXE 和 NSIS bundle 构建完成。

- [ ] **Step 3：刷新 portable、快捷方式和哈希**

复制最新 `src-tauri/target/release/xiti.exe` 到 portable 路径，刷新 `G:/1桌面应用/Proofline.lnk`，计算 portable、NSIS 和 ICO 的 SHA-256。

- [ ] **Step 4：最新实例视觉验收**

完全退出旧 Proofline，启动最新 portable，验证面试题题库与练习页，切换深浅主题；生成带当前时间戳的最新截图，并删除本任务旧时间戳截图。若 UI 自动化被用户中断，立即停止并如实报告。

- [ ] **Step 5：最终验证**

Run: `npm.cmd test && npm.cmd run test:e2e -- --workers=1 && cargo test && cargo fmt --check`

Expected: 所有测试通过，数据库完整性检查返回 `ok`，快捷方式指向最新 portable。
