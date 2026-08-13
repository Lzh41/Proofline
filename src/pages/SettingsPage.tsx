import { useState } from 'react';
import { Bot, Check, DatabaseBackup, FolderOpen, HardDrive, KeyRound, LibraryBig, RefreshCw, Shield, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../components/PagePrimitives';
import { useStoreView } from '../app/storeAdapter';
import type { AppTheme } from '../types';
import styles from './Pages.module.css';

export function SettingsPage() {
  const store = useStoreView();
  const [baseUrl, setBaseUrl] = useState(store.settings.aiBaseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(store.settings.aiModel ?? '');
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState(store.settings.defaultLanguage ?? 'cpp');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteBackups, setDeleteBackups] = useState(false);
  const interviewQuestionCount = store.problems.filter((problem) => problem.kind === 'interview').length;

  const run = async (success: string, action?: () => Promise<unknown> | unknown) => {
    if (!action) {
      setMessage('桌面服务尚未初始化，请重新启动应用。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const saveAi = async () => {
    await store.updateSettings?.({ aiBaseUrl: baseUrl.trim(), aiModel: model.trim() });
    if (apiKey.trim()) {
      await store.saveAiCredential?.(apiKey.trim());
      setApiKey('');
    }
    setMessage('AI 配置已保存，密钥不会写入普通配置文件。');
  };

  return (
    <>
      <PageHeader eyebrow="设置" title="掌控你的数据和工具。" description="个人记录默认仅保存在本机；平台登录、AI 密钥和学习备份相互隔离。" />
      {message && <div className={styles.notice}><Check size={17} />{message}</div>}
      <div className={styles.settingsList}>
        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><Bot size={20} color="var(--info)" /><h2>AI 拆题服务</h2><p>支持兼容 OpenAI 的流式接口。未配置时不影响本地学习功能。</p></div>
          <div className={styles.settingControls}>
            <label className="field"><span>接口地址</span><input className="input" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label className="field"><span>模型 ID</span><input className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如：gpt-5-mini" /></label>
            <label className="field"><span>API 密钥</span><input className="input" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={store.settings.hasAiCredential ? '已安全保存，留空表示不更改' : '写入 Windows 凭据库'} /></label>
            <div className={styles.buttonRow}>
              <button className="button buttonPrimary" type="button" disabled={busy || !model.trim()} onClick={saveAi}><KeyRound size={15} />保存配置</button>
              <button className="button" type="button" disabled={busy || !model.trim()} onClick={() => run('连接测试成功。', store.testAiConnection)}>测试连接</button>
              {store.settings.hasAiCredential && <button className="button buttonDanger" type="button" disabled={busy} onClick={() => run('AI 密钥已删除。', store.deleteAiCredential)}><Trash2 size={14} />删除密钥</button>}
            </div>
          </div>
        </section>

        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><DatabaseBackup size={20} color="var(--accent-deep)" /><h2>备份与迁移</h2><p>完整备份不包含平台 Cookie 和 AI 密钥，可安全迁移个人学习记录。</p></div>
          <div className={styles.settingControls}>
            <div className={styles.buttonRow}>
              <button className="button buttonPrimary" type="button" disabled={busy} onClick={() => run('备份已创建到“文档\\Proofline\\备份”。', store.createBackup)}><DatabaseBackup size={15} />立即备份</button>
              <button className="button" type="button" disabled={busy} onClick={() => run('备份恢复完成，请检查题目和计划。', store.restoreBackup)}><Upload size={15} />恢复备份</button>
            </div>
            <div className={styles.buttonRow}>
              <button className="button" type="button" disabled={busy} onClick={() => run('JSON 数据已导出。', store.exportData)}>导出 JSON</button>
              <button className="button" type="button" disabled={busy} onClick={() => run('JSON 数据已导入并完成去重。', store.importData)}>导入 JSON</button>
              <button className="iconButton" type="button" title="打开数据目录" aria-label="打开数据目录" disabled={busy} onClick={() => run('已打开数据目录。', store.openDataDirectory)}><FolderOpen size={16} /></button>
            </div>
          </div>
        </section>

        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><LibraryBig size={20} color="var(--info)" /><h2>内置面试题库</h2><p>内置题目会随应用升级；恢复时保留个人练习、掌握度与归档状态。</p></div>
          <div className={styles.settingControls}>
            <div className={styles.notice} style={{ margin: 0 }}>
              当前已载入 {interviewQuestionCount} 道面试题，目录版本 {store.settings.interviewCatalogVersion ?? 0}。
            </div>
            <div className={styles.buttonRow}>
              <button className="button" type="button" disabled={busy} onClick={() => run('内置面试题库已恢复并完成去重。', store.restoreInterviewCatalog)}><RefreshCw size={15} />恢复内置面试题库</button>
            </div>
          </div>
        </section>

        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><HardDrive size={20} /><h2>练习偏好</h2><p>默认语言只影响新尝试；已经保存的代码语言不会被覆盖。</p></div>
          <div className={styles.settingControls}>
            <label className="field"><span>默认语言</span><select className="select" value={language} onChange={(event) => { const value = event.target.value; setLanguage(value); void store.updateSettings?.({ defaultLanguage: value }); }}><option value="cpp">C++17</option><option value="python">Python 3</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option></select></label>
            <label className="field"><span>界面主题</span><select className="select" value={store.settings.theme ?? 'dark'} onChange={(event) => { void store.updateSettings?.({ theme: event.target.value as AppTheme }); }}><option value="dark">深色</option><option value="system">跟随系统</option><option value="light">浅色</option></select></label>
            <div className={styles.toggle}><div><strong style={{ fontSize: 13 }}>发送前隐私确认</strong><p className={styles.noteContent} style={{ margin: '3px 0 0' }}>关闭后，下次 AI 请求会重新显示题面与代码发送确认。</p></div><input type="checkbox" checked={Boolean(store.settings.privacyConfirmed)} onChange={(event) => store.updateSettings?.({ privacyConfirmed: event.target.checked })} aria-label="发送前隐私确认" /></div>
          </div>
        </section>

        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><Shield size={20} color="var(--danger)" /><h2>平台隔离</h2><p>清除平台资料会删除该站登录状态；个人题目与复盘不会受影响。</p></div>
          <div className={styles.settingControls}><div className={styles.notice} style={{ margin: 0 }}>三个官方窗口没有本地 IPC、文件、数据库或凭据权限。外部链接会交给系统浏览器处理。</div></div>
        </section>

        <section className={styles.settingRow}>
          <div className={styles.settingIntro}><Trash2 size={20} color="var(--danger)" /><h2>删除本机数据</h2><p>删除后无法撤销。平台登录、AI 密钥、题目、错题、知识库和计划都会清除。</p></div>
          <div className={styles.settingControls}>
            <label className={styles.toggle}><div><strong style={{ fontSize: 13 }}>同时删除文档备份</strong><p className={styles.noteContent} style={{ margin: '3px 0 0' }}>关闭时保留“文档\Proofline\备份”中的恢复文件。</p></div><input type="checkbox" checked={deleteBackups} onChange={(event) => setDeleteBackups(event.target.checked)} aria-label="同时删除文档备份" /></label>
            <div className={styles.buttonRow}><button className="button buttonDanger" type="button" disabled={busy} onClick={() => {
              const scope = deleteBackups ? '全部本机数据和所有备份' : '全部本机数据（保留文档备份）';
              if (window.confirm(`确定删除${scope}吗？此操作无法撤销。`)) {
                void run('本机数据已删除。', () => store.deleteAllUserData?.(deleteBackups));
              }
            }}><Trash2 size={15} />删除全部本机数据</button></div>
          </div>
        </section>
      </div>
    </>
  );
}
