# Proofline

![Proofline 题库页面](docs/proofline-preview.png)

**Proofline 是一个本地优先的 Windows 算法与企业面试训练工作台。**

它把题目、代码、运行样例、AI 讲解、错题复习、知识笔记和每日计划放在同一条学习闭环里。你可以连接力扣中国、LeetCode 或牛客的官方页面，也可以只使用本地题库和内置的企业面试题库。

> 当前版本：`0.1.0` · Windows x64 · Tauri 2 · React 19 · SQLite

## 下载

前往 [Releases](https://github.com/Lzh41/Proofline/releases) 下载最新版本：

- `Proofline_0.1.0_x64-setup.exe`：按当前 Windows 用户安装，可自定义安装目录。
- `Proofline_0.1.0_x64-portable.exe`：免安装便携版，适合放在 U 盘或同步盘中运行。

当前未提供代码签名证书，Windows SmartScreen 可能显示“未知发布者”。下载后请先核对 Release 页面中的 SHA-256，再继续安装。

## 它解决什么问题

刷题时真正难的是把“看过答案”变成“下次能自己写出来”。Proofline 围绕这个问题设计：

- **题目工作台**：题面置顶，代码编辑区与 AI 教练并排；支持上一题、下一题和题库内选择。
- **自动样例运行**：点击一次运行全部样例，不需要手写 `main`、测试函数或测试入口。
- **算法逻辑拆解**：AI 可以解释算法为什么这样设计、每一步如何落到代码，以及如何检查边界。
- **企业面试题库**：内置 21 个岗位方向、1083 道面试题，覆盖 LLM、NLP、RAG、推荐、后端、前端、测试、数据等方向；支持岗位、关键词、题型、难度和掌握度联合筛选。
- **面试出题官**：输入 `Transformer`、`RAG` 等主题，生成考点地图、面试问题、参考答案和递进追问，可勾选加入个人题库。
- **记忆闭环**：练习草稿自动保存；错题按 `1 / 3 / 7 / 14 / 30` 天复习；知识笔记支持全文检索。
- **每日计划**：先安排到期复习，再按薄弱标签、岗位方向和新题目标补齐。
- **本地优先**：SQLite、备份、运行样例和练习记录在本机完成；AI 不可用时，题库、计时、错题、计划和知识库仍可使用。

## 运行边界

Proofline 不批量抓取或镜像力扣、LeetCode、牛客的完整题库，也不读取 Cookie 或代替用户提交代码。官方平台以独立 WebView2 窗口打开，连接器只处理当前用户选择的单题公开信息；页面受登录、验证码、反爬策略或改版影响时，会保留链接型学习卡，并支持手工录入、剪贴板和截图 OCR 回退。

AI 使用 OpenAI 兼容接口。用户在设置中填写基础地址、模型 ID 和密钥后，密钥由 Rust 写入 Windows 凭据库，前端不能读取明文。发送题面、代码或笔记前会显示隐私确认。

## 快速开始

### 直接安装

1. 从 [Releases](https://github.com/Lzh41/Proofline/releases) 下载 `*-setup.exe`。
2. 运行安装程序并选择安装目录。
3. 启动 Proofline。首次启动会在 `%LOCALAPPDATA%\Xiti` 创建 SQLite 数据库，并自动写入内置面试题库。

### 本地开发

环境要求：Node.js 20+、Rust stable MSVC、Visual Studio 2022 C++ 工具链、Windows SDK 和 WebView2 Runtime。

```powershell
git clone https://github.com/Lzh41/Proofline.git
cd Proofline
npm ci
npm run dev
```

浏览器预览使用 `localStorage`，不能代表 Windows 凭据库、SQLite 和平台窗口的完整行为。构建 Windows 安装包：

```powershell
.\scripts\tauri-msvc.ps1 -Mode build
```

输出目录：`src-tauri\target\release\bundle\nsis\`。

## 数据与隐私

| 数据 | 默认位置 |
| --- | --- |
| SQLite 数据库 | `%LOCALAPPDATA%\Xiti\xiti.sqlite` |
| 附件 | `%LOCALAPPDATA%\Xiti\attachments` |
| 平台登录目录 | `%LOCALAPPDATA%\Xiti\platforms\<平台>` |
| ZIP 备份 | `%USERPROFILE%\Documents\析题\备份` |
| AI 密钥 | Windows 凭据库 `com.xiti.desktop` |

备份包含 SQLite 快照和附件，不包含 AI 密钥、平台登录目录或 Cookie。卸载默认保留个人数据；需要彻底清理时，请先在“设置 → 删除本机数据”中明确选择。

## 技术栈

React 19 · TypeScript · Vite · Tauri 2 · Rust · SQLite · Zustand · CSS Modules · Lucide · Monaco Editor · Tesseract WASM · Pyodide

## 验证记录

- 前端测试：`32` 个测试文件，`201/201` 通过。
- Rust 测试：`63/63` 通过。
- Windows x64 NSIS 安装包和便携版已构建。
- 已在全新安装目录验证：首次启动、导入题目、完全退出、重启后数据持久化。

## 参与贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [贡献指南](CONTRIBUTING.md)，涉及平台连接器、隐私、凭据或本地执行器的改动请同时说明安全边界和测试方式。

## 许可证

当前仓库暂未授予第三方复制、修改或分发代码的许可。你可以通过 Issue 讨论使用授权或合作方式。
