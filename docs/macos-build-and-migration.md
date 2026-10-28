# 在 macOS 上构建和迁移 Proofline

这份文档对应 0.1.19 的 macOS 适配。Windows 侧的行为没有改，所有平台判断都走 `cfg` 或 UA 检测，两边共用同一套代码。

## 现在支持到什么程度

前端是普通 Web 应用，Tauri 在 macOS 上用系统的 WKWebView 跑，不需要改。Rust 后端里原来只有三处写死了 Windows，现在都拆成平台分支：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| `Cargo.toml` 的 `keyring` | 固定 `windows-native`，macOS 上编译不过 | 按平台选 `windows-native` / `apple-native` / `sync-secret-service` |
| `local_tools.rs` 端口探测 | `netstat -ano -p TCP` | Windows 走 netstat，macOS / Linux 走 `lsof -t` |
| `local_tools.rs` 结束进程 | `taskkill /T /F` | Windows 走 taskkill，unix 走进程组 `pkill -TERM/-KILL` |
| `local_tools.rs` 起服务 | `cmd /S /C`（非 Windows 分支也仍然叫 `cmd`，是个真 bug） | unix 用登录 shell `-lc`，并补 `/opt/homebrew/bin`、`/usr/local/bin` 到 PATH |
| `runner.rs` 超时清理 | 非 Windows 分支只 `child.kill()` | unix spawn 时建独立进程组，超时按组 SIGKILL |
| 窗口 | `decorations: false` 自绘标题栏 | macOS 走 `titleBarStyle: Overlay` + 原生红绿灯，Windows 保持原样 |

窗口、图标、打包目标这些放在 `src-tauri/tauri.macos.conf.json`，Tauri 构建 macOS 时会自动合并它，不影响 Windows 配置。

## 第一次在 Mac 上跑

```bash
# 1. 编译器（做题页的 C++17 运行靠 clang++，Xcode 命令行工具自带）
xcode-select --install

# 2. Node 22 或 24（项目 engines 要求）
brew install node

# 3. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin      # Apple Silicon
# rustup target add x86_64-apple-darwin     # Intel 机器或打通用包时加

# 4. 依赖与开发
cd <仓库目录>
npm install
npm run tauri:dev
```

打包：

```bash
npm run tauri:build:mac            # Apple Silicon，出 .app + .dmg
npm run tauri:build:mac-universal  # 通用包（Intel + Apple Silicon，需要两个 target 都装）
```

产物在 `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Proofline.app` 和 `bundle/dmg/Proofline_0.1.19_aarch64.dmg`。

## 学习记录怎么搬过来

Windows 侧数据位置：`%LOCALAPPDATA%\Xiti\xiti.sqlite`，同目录下还有 `attachments\`、`platforms\`。备份包默认写到 `文档\Proofline\备份\`。

两条路，推荐第一条：

1. **走应用自己的导出导入**：Windows 上设置页「导出数据」生成 zip，Mac 上装好后「导入数据」。跨平台安全，附件和平台快照一起带过去。
2. **直接搬数据库文件**：应用完全退出后，把整个 `%LOCALAPPDATA%\Xiti` 目录复制到 `~/Library/Application Support/Xiti/`。代码里保留了「旧目录名 `Xiti` 继续原地使用」的兼容逻辑，所以这条路也能识别到旧数据。目标是新布局的话放 `~/Library/Application Support/Proofline/`，此时库文件名应改为 `proofline.sqlite`。

注意第二个办法要求复制时 Windows 上的 Proofline 已经退出，sqlite 还在写的话会拷到半截的 WAL。

## 第一次打开被系统拦住

本地构建的包没有签名，Gatekeeper 会提示「无法验证开发者」。两个办法：

```bash
# 单次放行
xattr -dr com.apple.quarantine /Applications/Proofline.app
```

或者右键点图标 → 打开。要彻底不弹得用 Apple Developer 证书签名并公证，填 `bundle.macOS.signingIdentity` 后 Tauri 会自动签。

## 和 Windows 不一样的地方

- 标题栏左侧是系统红绿灯，右侧那三个自绘按钮在 macOS 上不渲染（否则同一扇窗有两套关闭入口）。标题栏高度仍是 36px，布局不位移。
- 快捷键按 mac 习惯显示：搜索框提示 `⌘ K`，撤销/重做提示 `⌘Z` / `⇧⌘Z`。按键判定本来就同时接受 `ctrlKey` 和 `metaKey`，功能没变。
- 字体走系统栈：英文 `-apple-system`，中文 PingFang SC，等宽 SF Mono。原来的 `Segoe UI` / `微软雅黑` 在 mac 上不存在，不换会掉到衬线字体。
- 密钥（AI API Key）存进 Keychain，第一次保存会弹一次钥匙串授权；Windows 是凭据管理器。
- 工具页在 macOS 上是空的。那 6 条内置种子全钉着 `G:\...` 和 `.venv\Scripts\python.exe`，换系统后点了一定失败，所以在 mac 上直接不注入；不打算在新机器上用工具页的话就当它不存在。
- 结束本地服务：mac 上先 `SIGTERM` 等 250ms，再对进程组 `SIGKILL`。好处是 uvicorn / http.server 的端口能立刻重开。

## 需要你手动处理的部分

1. **签名和公证**：需要 Apple Developer 账号，我这边没法代做。
2. **本地代理类服务**（如果之前配了 `127.0.0.1:...` 的转发）需要在新机器上重新起。

## 拿到机器后照着跑一遍

```bash
npm run build      # tsc + vite，验证前端
npm test           # 303 个用例
cd src-tauri && cargo check
```

手工验证清单：

- 窗口能拖、有红绿灯、双击标题栏能缩放
- `⌘ K` 打开全局搜索，输入框里 `⌘ C` / `⌘ V` 正常
- 做题页跑一段 C++ 样例（第一次编译会慢几秒），故意写个死循环确认 3 秒后被掐掉
- 设置页导出一次备份再导入
- 设置页「打开数据目录」能弹出 Finder

## 已知未验证的点

这台机器是 Windows，下面这些只能在 Mac 上实机确认：

- Monaco 编辑器和 pyodide worker 在 WKWebView 里的表现（功能上没问题，属于实机验证项）
- 中文输入法在 Monaco 里的组合输入（mac 的 WKWebView 对 composition 事件的处理和 Chromium 略有差别）
- Retina 屏下 1px 边框和 Monaco 的字体渲染是否需要微调
- 打包体积：主 chunk 现在 8.3 MB（词汇数据是静态导入的），mac 上如果首屏慢可以考虑把词汇目录改成动态 import
