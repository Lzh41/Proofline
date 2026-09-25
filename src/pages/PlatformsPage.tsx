import { useMemo, useRef, useState } from 'react';
import { AppWindow, ChevronDown, Download, ExternalLink, LayoutPanelLeft, Link2, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { PlatformBatchImportSummary, PlatformBatchProgress, PlatformSource } from '../types';
import { sourceLabel, useStoreView } from '../app/storeAdapter';
import { PageHeader, SectionHeader } from '../components/PagePrimitives';
import styles from './Pages.module.css';

const PLATFORMS: Array<{ source: PlatformSource; description: string; host: string }> = [
  { source: 'leetcode-cn', description: '中文题库、竞赛与官方判题', host: 'leetcode.cn' },
  { source: 'leetcode', description: '国际站题库、讨论与官方判题', host: 'leetcode.com' },
  { source: 'nowcoder', description: '牛客题库、面试与竞赛训练', host: 'nowcoder.com' },
  { source: 'luogu', description: '洛谷题库，标准输入输出竞赛题', host: 'luogu.com.cn' },
];

type BatchImportRow = {
  id: string;
  source: PlatformSource;
  startId: string;
  endId: string;
};

type BatchRun = {
  row: BatchImportRow;
  result: PlatformBatchImportSummary;
};

function createBatchRow(source: PlatformSource = 'leetcode-cn'): BatchImportRow {
  return { id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, source, startId: '1', endId: '10' };
}

export function PlatformsPage() {
  const store = useStoreView();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [batchRows, setBatchRows] = useState<BatchImportRow[]>(() => [createBatchRow()]);
  const [batchMode, setBatchMode] = useState<'function' | 'stdin'>('function');
  const [batchProgress, setBatchProgress] = useState<PlatformBatchProgress | null>(null);
  const [batchResult, setBatchResult] = useState<PlatformBatchImportSummary | null>(null);
  const [batchRuns, setBatchRuns] = useState<BatchRun[]>([]);
  const [batchStep, setBatchStep] = useState(0);
  const [showFailures, setShowFailures] = useState(false);
  const cancelRequestedRef = useRef(false);

  const failureItems = useMemo(
    () => batchRuns.flatMap(({ row, result }) => result.items
      .filter((item) => item.status === 'failed' || item.status === 'not-found')
      .map((item) => ({ ...item, requestedId: `${sourceLabel(row.source)} · ${item.requestedId}` }))),
    [batchRuns],
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
    if (batchRows.length === 0) {
      setMessage('至少添加一个平台批次后再开始导入。');
      return;
    }
    const normalizedRows: Array<BatchImportRow & { start: number; end: number; limit: number }> = [];
    for (const [index, row] of batchRows.entries()) {
      const start = Number(row.startId);
      const end = Number(row.endId);
      const limit = row.source === 'nowcoder' || row.source === 'luogu' ? 50 : 100;
      const count = Math.abs(end - start) + 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        setMessage(`第 ${index + 1} 个平台批次请输入正整数题号。`);
        return;
      }
      if (count > limit) {
        setMessage(`当前平台单次最多导入 ${limit} 道题，请缩小范围。`);
        return;
      }
      normalizedRows.push({ ...row, start, end, limit });
    }
    if (!store.importPlatformProblems) {
      setMessage('桌面批量导入服务尚未就绪，请重新启动应用。');
      return;
    }
    setBusy('批量导入');
    setBatchResult(null);
    setBatchRuns([]);
    setBatchStep(0);
    setBatchProgress(null);
    setShowFailures(false);
    cancelRequestedRef.current = false;
    setMessage('正在读取公开题库目录，不会使用官网登录信息。');
    try {
      let completedBatches = 0;
      const completedRuns: BatchRun[] = [];
      for (const [index, row] of normalizedRows.entries()) {
        if (cancelRequestedRef.current) break;
        setBatchStep(index);
        const result = await store.importPlatformProblems(
          { source: row.source, startId: row.start, endId: row.end, ...((batchMode === 'stdin' || row.source === 'luogu') ? { algorithmMode: 'stdin' as const } : {}) },
          (progress) => setBatchProgress(progress.event === 'progress'
            ? { ...progress, currentId: `${sourceLabel(row.source)} · ${progress.currentId}` }
            : progress),
        );
        completedBatches += 1;
        completedRuns.push({ row, result });
        setBatchRuns([...completedRuns]);
        setBatchResult(completedRuns.reduce<PlatformBatchImportSummary | null>((summary, current) => {
          if (!summary) return { ...current.result, items: [...current.result.items] };
          return {
            ...summary,
            requestedCount: summary.requestedCount + current.result.requestedCount,
            fetchedCount: summary.fetchedCount + current.result.fetchedCount,
            paidOnlyCount: summary.paidOnlyCount + current.result.paidOnlyCount,
            notFoundCount: summary.notFoundCount + current.result.notFoundCount,
            failedCount: summary.failedCount + current.result.failedCount,
            cancelled: summary.cancelled || current.result.cancelled,
            items: [...summary.items, ...current.result.items],
            addedCount: summary.addedCount + current.result.addedCount,
            updatedCount: summary.updatedCount + current.result.updatedCount,
            skippedCount: summary.skippedCount + current.result.skippedCount,
          };
        }, null));
        if (result.cancelled) {
          cancelRequestedRef.current = true;
          break;
        }
      }
      setMessage(cancelRequestedRef.current ? `连续导入已取消，已完成 ${completedBatches} 个平台批次。` : `连续导入已完成，共处理 ${completedBatches} 个平台批次。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量导入失败，请检查网络后重试。');
    } finally {
      setBusy(null);
    }
  };

  const cancelImport = () => {
    cancelRequestedRef.current = true;
    void store.cancelPlatformProblemImport?.();
    setMessage('正在取消当前批量导入，已完成的题目会保留。');
  };

  return (
    <>
      <PageHeader eyebrow="官方题库" title="在原站刷题，在这里成长。" description="登录、运行、提交和判题始终发生在官方页面；Proofline 只记录你主动绑定的单题与学习过程。" />
      <div className={styles.notice}><ShieldCheck size={18} />四个平台使用相互隔离的登录目录，批量导入支持按队列连续读取；官方页面无法读取本地题库、文件和 AI 密钥。</div>
      <section className={`${styles.section} ${styles.batchImport}`} aria-labelledby="batch-import-title">
        <div className={styles.batchImportHead}>
          <div>
            <span className={styles.kicker}>公开题面同步</span>
            <h2 id="batch-import-title">按题号批量加入个人题库</h2>
            <p>登录只用于官网刷题；这里仅请求公开目录和题面，不读取账号、Cookie 或提交记录。</p>
          </div>
          <Download size={22} aria-hidden="true" />
        </div>
        <div className={styles.batchQueue} aria-label="连续导入平台队列">
          {batchRows.map((row, index) => (
            <div className={styles.batchQueueRow} key={row.id}>
              <div className={styles.batchQueueTitle}><strong>批次 {index + 1}</strong><span>{index === batchStep && busy === '批量导入' ? '正在导入' : '按顺序执行'}</span>{batchRows.length > 1 && <button className="iconButton" type="button" title="移除此批次" aria-label={`移除第 ${index + 1} 个平台批次`} disabled={busy !== null} onClick={() => setBatchRows((rows) => rows.filter((item) => item.id !== row.id))}><Trash2 size={14} /></button>}</div>
              <div className={styles.batchImportForm}>
                <label>
                  <span>{index === 0 ? '平台' : `平台 ${index + 1}`}</span>
                  <select className="select" aria-label={index === 0 ? '平台' : `平台 ${index + 1}`} value={row.source} onChange={(event) => setBatchRows((rows) => rows.map((item) => item.id === row.id ? { ...item, source: event.target.value as PlatformSource } : item))} disabled={busy !== null}>
                    <option value="leetcode-cn">力扣中国</option>
                    <option value="leetcode">LeetCode 国际站</option>
                    <option value="nowcoder">牛客 NC 系列</option>
                    <option value="luogu">洛谷（ACM 标准输入输出）</option>
                  </select>
                </label>
                <label>
                  <span>起始题号</span>
                  <input className="input" type="number" min="1" value={row.startId} onChange={(event) => setBatchRows((rows) => rows.map((item) => item.id === row.id ? { ...item, startId: event.target.value } : item))} disabled={busy !== null} />
                </label>
                <label>
                  <span>结束题号</span>
                  <input className="input" type="number" min="1" value={row.endId} onChange={(event) => setBatchRows((rows) => rows.map((item) => item.id === row.id ? { ...item, endId: event.target.value } : item))} disabled={busy !== null} />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className={`${styles.batchImportForm} ${styles.batchImportFooter}`}>
          <label>
            <span>题型</span>
            <select className="select" value={batchMode} onChange={(event) => setBatchMode(event.target.value as 'function' | 'stdin')} disabled={busy !== null}>
              <option value="function">函数题</option>
              <option value="stdin">完整程序题（PAT / ACM）</option>
            </select>
          </label>
          <div className={styles.batchImportAction}>
            {busy === '批量导入' ? (
              <button className="button buttonGhost" type="button" onClick={cancelImport}><X size={15} />取消导入</button>
            ) : (
              <button className="button buttonPrimary" type="button" onClick={() => void importRange()} disabled={busy !== null}><Download size={15} />开始导入</button>
            )}
            <button className="button" type="button" onClick={() => setBatchRows((rows) => [...rows, createBatchRow(rows.at(-1)?.source ?? 'leetcode-cn')])} disabled={busy !== null}><Plus size={15} />添加平台批次</button>
            <small>每个平台按顺序执行</small>
          </div>
        </div>
        {batchRows.some((row) => row.source === 'nowcoder') && <p className={styles.batchHint}>牛客题号按公开“算法篇”目录中的 NC 编号匹配，其他专题或非连续 UUID 请使用“绑定当前题”。</p>}
        {batchRows.some((row) => row.source === 'luogu') && <p className={styles.batchHint}>洛谷题号按 P 编号读取（例如起始题号 1000 对应 P1000），自动作为完整程序题导入；不存在的 P 编号会记录为未找到。</p>}
        {(batchMode === 'stdin' || batchRows.some((row) => row.source === 'luogu')) && <p className={styles.batchHint}>完整程序题会进入独立题型模块；洛谷和牛客算法篇适合 ACM 风格标准输入输出训练。</p>}
        {batchProgress?.event === 'progress' && (
          <div className={styles.batchProgress} aria-live="polite">
            <div className={styles.batchProgressMeta}><span>正在读取 {batchProgress.currentId} 题</span><strong>{batchProgress.completed}/{batchProgress.total}</strong></div>
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
            {batchRuns.length > 1 && <div className={styles.batchQueueResults}>{batchRuns.map(({ row, result }) => <span key={row.id}>{sourceLabel(row.source)}：新增 {result.addedCount} · 更新 {result.updatedCount} · 已有 {result.skippedCount}</span>)}</div>}
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
