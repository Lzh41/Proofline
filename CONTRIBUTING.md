# 贡献指南

感谢你为 Proofline 提交改进。

## 提交前检查

```powershell
npm ci
npm test
npm run build
```

涉及 Rust、SQLite、平台窗口、运行器或备份逻辑时，还需要在 Windows MSVC 环境中执行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 提交规范

- 使用中文描述用户可见行为，代码标识符遵循现有英文命名。
- 新增功能必须覆盖加载、保存、错误、空数据和取消状态。
- 不提交数据库、平台登录目录、AI 密钥、Cookie、构建目录或本地截图缓存。
- 平台连接器只允许处理用户当前选择的公开单题，不要实现批量抓取或绕过验证。
- AI 相关改动必须说明发送到接口的字段和隐私确认边界。

## Pull Request

请在 PR 中说明：问题、方案、测试命令、Windows 验证结果，以及是否影响个人数据迁移或安装包行为。
