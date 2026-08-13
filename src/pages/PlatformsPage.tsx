import { useMemo, useState } from 'react';
import { AppWindow, ChevronDown, Download, ExternalLink, LayoutPanelLeft, Link2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { PlatformBatchImportSummary, PlatformBatchProgress, PlatformSource } from '../types';
import { sourceLabel, useStoreView } from '../app/storeAdapter';
import { PageHeader, SectionHeader } from '../components/PagePrimitives';
import styles from './Pages.module.css';

const PLATFORMS: Array<{ source: PlatformSource; description: string; host: string }> = [
  { source: 'leetcode-cn', description: '中文题库、竞赛与官方判题', host: 'leetcode.cn' },
  { source: 'leetcode', description: '国际站题库、讨论与官方判题', host: 'leetcode.com' },
  { source: 'nowcoder', description: '牛客题库、面试与竞赛训练', host: 'nowcoder.com' },
];

export function PlatformsPage() {
  const store = useStoreView();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [batchSource, setBatchSource] = useState<PlatformSource>('leetcode-cn');
  const [startId, setStartId] = useState('1');
  const [endId, setEndId] = useState('10');
  const [batchProgress, setBatchProgress] = useState<PlatformBatchProgress | null>(null);
  const [batchResult, setBatchResult] = useState<PlatformBatchImportSummary | null>(null);
  const [showFailures, setShowFailures] = useState(false);

  const batchLimit = batchSource === 'nowcoder' ? 50 : 100;
  const failureItems = useMemo(
    () => batchResult?.items.filter((item) => item.status === 'failed' || item.status === 'not-found') ?? [],
    [batchResult],
  );

  const run = async (label: string, task?: () => Promise<unknown> | unknown) => {
    if (!task) {
      setMessage('桌面窗口服务尚未就绪，请重新启动应用后再试。');
      return;
    }
    setBusy(label);
    setMessage('');
    try {
      await task();
      setMessage(`${label}已完成。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label}失败，请检查网络。`);
    } finally {
      setBusy(null);
    }
  };

  const importRange = async () => {
    const start = Number(startId);
    const end = Number(endId);
    const count = Math.abs(end - start) + 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      setMessage('请输入正整数题号。');
      return;
    }
    if (count > batchLimit) {
      setMessage(`当前平台单次最多导入 ${batchLimit} 道题，请缩小范围。`);
      return;
    }
    if (!store.importPlatformProblems) {
      setMessage('桌面批量导入服务尚未就绪，请重新启动应用。');
      return;
    }
    setBusy('批量导入');
    setBatchResult(null);
    setBatchProgress(null);
    setShowFailures(false);
    setMessage('正在读取公开题库目录，不会使用官网登录信息。');
    try {
      const result = await store.importPlatformProblems(
        { source: batchSource, startId: start, endId: end },
        (progress) => setBatchProgress(progress),
      );
      setBatchResult(result);
      setMessage(result.cancelled ? '批量导入已取消，已保存已完成的题目。' : '批量导入已完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量导入失败，请检查网络后重试。');
    } finally {
      setBusy(null);
    }
  };

  const cancelImport = () => {
    void store.cancelPlatformProblemImport?.();
    setMessage('正在取消当前批量导入，已完成的题目会保留。');
  };

  return (
    <>
      <PageHeader eyebrow="官方题库" title="在原站刷题，在这里成长。" description="登录、运行、提交和判题始终发生在官方页面；Proofline 只记录你主动绑定的单题与学习过程。" />
      <div className={styles.notice}><ShieldCheck size={18} />三个平台使用相互隔离的登录目录，官方页面无法读取本地题库、文件和 AI 密钥。</div>
      <section className={`${styles.section} ${styles.batchImport}`} aria-labelledby="batch-import-title">
        <div className={styles.batchImportHead}>
          <div>
            <span className={styles.kicker}>公开题面同步</span>
            <h2 id="batch-import-title">按题号批量加入个人题库</h2>
            <p>登录只用于官网刷题；这里仅请求公开目录和题面，不读取账号、Cookie 或提交记录。</p>
          </div>
          <Download size={22} aria-hidden="true" />
        </div>
        <div className={styles.batchImportForm}>
          <label>
            <span>平台</span>
            <select className="select" value={batchSource} onChange={(event) => setBatchSource(event.target.value as PlatformSource)} disabled={busy !== null}>
              <option value="leetcode-cn">力扣中国</option>
              <option value="leetcode">LeetCode 国际站</option>
              <option value="nowcoder">牛客 NC 系列</option>
            </select>
          </label>
          <label>
            <span>起始题号</span>
            <input className="input" type="number" min="1" value={startId} onChange={(event) => setStartId(event.target.value)} disabled={busy !== null} />
          </label>
          <label>
            <span>结束题号</span>
            <input className="input" type="number" min="1" value={endId} onChange={(event) => setEndId(event.target.value)} disabled={busy !== null} />
          </label>
          <div className={styles.batchImportAction}>
            {busy === '批量导入' ? (
              <button className="button buttonGhost" type="button" onClick={cancelImport}><X size={15} />取消导入</button>
            ) : (
              <button className="button buttonPrimary" type="button" onClick={() => void importRange()} disabled={busy !== null}><Download size={15} />开始导入</button>
            )}
            <small>单次上限 {batchLimit} 道</small>
          </div>
        </div>
        {batchSource === 'nowcoder' && <p className={styles.batchHint}>牛客题号按公开“算法篇”目录中的 NC 编号匹配，其他专题或非连续 UUID 请使用“绑定当前题”。</p>}
        {batchProgress?.event === 'progress' && (
          <div className={styles.batchProgress} aria-live="polite">
            <div className={styles.batchProgressMeta}><span>正在读取第 {batchProgress.currentId} 题</span><strong>{batchProgress.completed}/{batchProgress.total}</strong></div>
            <progress value={batchProgress.completed} max={batchProgress.total} />
          </div>
        )}
        {batchResult && (
          <div className={styles.batchResult} aria-live="polite">
            <div className={styles.batchStats}>
              <span><strong>{batchResult.addedCount}</strong> 新增</span>
              <span><strong>{batchResult.updatedCount}</strong> 更新</span>
              <span><strong>{batchResult.skippedCount}</strong> 已有</span>
              <span><strong>{batchResult.paidOnlyCount}</strong> 链接卡</span>
              <span className={batchResult.failedCount + batchResult.notFoundCount > 0 ? styles.batchStatDanger : ''}><strong>{batchResult.failedCount + batchResult.notFoundCount}</strong> 失败</span>
            </div>
            {failureItems.length > 0 && <button className={styles.failureToggle} type="button" onClick={() => setShowFailures((value) => !value)}>{showFailures ? '收起失败明细' : `查看 ${failureItems.length} 条失败明细`}<ChevronDown size={14} className={showFailures ? styles.chevronOpen : ''} /></button>}
            {showFailures && <div className={styles.failureList}>{failureItems.map((item) => <div key={`${item.requestedId}-${item.status}`}><strong>{item.requestedId}</strong><span>{item.error ?? '未找到公开题面'}</span></div>)}</div>}
          </div>
        )}
      </section>
      {message && <div className={styles.notice}>{message}</div>}

      <div className={styles.platformGrid}>
        {PLATFORMS.map((platform) => (
          <article className={styles.platform} key={platform.source}>
            <div className={styles.platformHead}>
              <AppWindow size={21} />
              <span className={styles.statusLine}><i />独立会话</span>
            </div>
            <h2>{sourceLabel(platform.source)}</h2>
            <p>{platform.description}</p>
            <p className="mono">{platform.host}</p>
            <div className={styles.buttonRow}>
              <button className="button buttonPrimary" type="button" disabled={busy !== null} onClick={() => run(`打开${sourceLabel(platform.source)}`, () => store.openPlatform?.(platform.source))}><ExternalLink size={15} />打开官网</button>
              <button className="iconButton" type="button" title="与教练窗口并排" aria-label={`并排${sourceLabel(platform.source)}`} disabled={busy !== null} onClick={() => run(`并排${sourceLabel(platform.source)}`, () => store.arrangePlatform?.(platform.source))}><LayoutPanelLeft size={16} /></button>
              <button className="iconButton" type="button" title="绑定当前题" aria-label={`绑定${sourceLabel(platform.source)}当前题`} disabled={busy !== null} onClick={() => run('绑定当前题', () => store.bindCurrentProblem?.(platform.source))}><Link2 size={16} /></button>
              <button className="iconButton" type="button" title="清除登录会话" aria-label={`清除${sourceLabel(platform.source)}登录会话`} disabled={busy !== null} onClick={() => {
                if (window.confirm(`确定清除${sourceLabel(platform.source)}的登录状态和站点缓存吗？个人学习记录不会删除。`)) {
                  void run(`清除${sourceLabel(platform.source)}登录会话`, () => store.clearPlatformProfile?.(platform.source));
                }
              }}><Trash2 size={15} /></button>
            </div>
          </article>
        ))}
      </div>

      <section className={styles.section} style={{ marginTop: 38 }}>
        <SectionHeader title="最近绑定" meta={`${store.problems.filter((item) => item.importMethod === 'platform' || item.importMethod === 'connector').length} 道平台题`} />
        {store.problems.filter((item) => item.sourceUrl).slice(0, 6).map((problem) => (
          <div className={styles.row} key={problem.id}>
            <div className={styles.rowMain}>
              <strong>{problem.title}</strong>
              <p>{sourceLabel(problem.source)} · {problem.externalId ?? '未读取题号'} · {problem.cacheStatus === 'link-only' ? '仅保存链接' : '已保存公开题面'}</p>
            </div>
            <span className={styles.badge}>{problem.platformStatus === 'solved' ? '已通过' : '学习中'}</span>
          </div>
        ))}
      </section>
    </>
  );
}
