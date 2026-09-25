import { useMemo, useRef, useState } from 'react';
import { FileImage, FilePlus2, Play, Plus, Search, Square, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AlgorithmMode, Problem } from '../types';
import { difficultyLabel, sourceLabel, useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader } from '../components/PagePrimitives';
import { isOcrCancelled, OCR_MAX_FILE_BYTES, recognizeProblemImage, type OfflineOcrTask } from '../lib/ocr';
import { inferProblemFromUrl } from '../lib/platform';
import styles from './Pages.module.css';

const INITIAL_FORM = { title: '', sourceUrl: '', externalId: '', difficulty: 'unknown', tags: '', content: '', algorithmMode: 'function' as AlgorithmMode };

export function ProblemsPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [source, setSource] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [status, setStatus] = useState('all');
  const [activeMode, setActiveMode] = useState<AlgorithmMode>('function');
  const [form, setForm] = useState(INITIAL_FORM);
  const [message, setMessage] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const ocrTaskRef = useRef<OfflineOcrTask | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = searchParams.get('q') ?? '';

  const allFiltered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return store.problems.filter((problem) => problem.kind === 'algorithm').filter((problem) => {
      const matchesKeyword = !keyword || [problem.title, problem.externalId, ...problem.tags].some((value) => value?.toLowerCase().includes(keyword));
      return matchesKeyword
        && (source === 'all' || problem.source === source)
        && (difficulty === 'all' || problem.difficulty === difficulty)
        && (status === 'all' || problem.platformStatus === status);
    });
  }, [difficulty, query, source, status, store.problems]);

  const functionProblems = useMemo(() => allFiltered.filter((problem) => (problem.algorithmMode ?? 'function') === 'function'), [allFiltered]);
  const stdinProblems = useMemo(() => allFiltered.filter((problem) => problem.algorithmMode === 'stdin'), [allFiltered]);
  const filtered = activeMode === 'stdin' ? stdinProblems : functionProblems;

  const openDialog = (mode: AlgorithmMode = activeMode) => {
    setActiveMode(mode);
    setForm((value) => ({ ...value, algorithmMode: mode }));
    dialogRef.current?.showModal();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const now = Date.now();
    const rawUrl = form.sourceUrl.trim();
    let detectedSource: Problem['source'] = 'manual';
    if (rawUrl) {
      const officialSource = (['leetcode-cn', 'leetcode', 'nowcoder', 'luogu'] as const).find((candidate) => {
        try { inferProblemFromUrl(candidate, rawUrl); return true; } catch { return false; }
      });
      if (officialSource) detectedSource = officialSource;
      else if (!/^https:\/\//i.test(rawUrl)) {
        setMessage('题目链接必须使用 HTTPS，官方平台只能填写对应的精确域名。');
        return;
      }
    }
    const draft: Partial<Problem> = {
      title: form.title.trim(),
      source: detectedSource,
      sourceUrl: rawUrl || undefined,
      externalId: form.externalId.trim() || undefined,
      platformStatus: 'todo',
      cacheStatus: 'manual',
      difficulty: form.difficulty as Problem['difficulty'],
      tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      content: form.content.trim(),
      algorithmMode: form.algorithmMode,
      constraints: [],
      examples: [],
      attachments: [],
      importMethod: rawUrl ? 'url' : 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const create = store.addProblem ?? store.createProblem;
    if (!create) {
      setMessage('题库服务尚未初始化，请重新启动应用。');
      return;
    }
    const saved = await create(draft);
    if (saved?.id && detectedSource !== 'manual') {
      try {
        await store.refreshProblemMetadata?.(saved.id);
        setMessage('题目已保存，并已从官网同步公开题面与样例。');
      } catch {
        setMessage('题目已保存；官网题面暂时未同步成功，可稍后点击“补齐样例”。');
      }
    } else {
      setMessage('题目已保存到本地题库。');
    }
    setForm(INITIAL_FORM);
    dialogRef.current?.close();
  };

  const recognizeImage = async (file?: File) => {
    if (!file) return;
    if (file.size > OCR_MAX_FILE_BYTES) {
      setMessage('单张截图不能超过 20 MB。');
      return;
    }
    setOcrBusy(true);
    setOcrProgress(0);
    setMessage('正在离线识别截图，本次结果需要你确认后才会保存。');
    try {
      const task = recognizeProblemImage(file, setOcrProgress);
      ocrTaskRef.current = task;
      const text = await task.result;
      setForm((value) => ({ ...value, content: text, title: value.title || file.name.replace(/\.[^.]+$/, '') }));
      setMessage('离线识别完成。请校对标题、公式和样例换行，再保存学习卡。');
    } catch (error) {
      if (!isOcrCancelled(error)) {
        setMessage(error instanceof Error ? `截图识别失败：${error.message}` : '截图识别失败，请改用文本粘贴。');
      }
    } finally {
      ocrTaskRef.current = null;
      setOcrBusy(false);
    }
  };

  const cancelOcr = async () => {
    await ocrTaskRef.current?.cancel();
    ocrTaskRef.current = null;
    setOcrBusy(false);
    setMessage('截图识别已取消，没有写入半成品题目。');
  };

  return (
    <>
      <PageHeader eyebrow="算法题训练" title="函数题与完整程序题，分开练。" description="函数题只写解题函数；完整程序题按 PAT / ACM 习惯自行处理标准输入和标准输出。题面、难度与样例仍从官网同步。" actions={<button className="button buttonPrimary" type="button" onClick={() => openDialog(activeMode)}><Plus size={16} />建立学习卡</button>} />
      {message && <div className={styles.notice}>{message}</div>}
      <div className={styles.modeTabs} role="tablist" aria-label="算法题类型">
        <button className={`button ${activeMode === 'function' ? 'buttonPrimary' : ''}`} type="button" role="tab" aria-selected={activeMode === 'function'} onClick={() => setActiveMode('function')}>函数题 <span className={styles.modeCount}>{functionProblems.length}</span></button>
        <button className={`button ${activeMode === 'stdin' ? 'buttonPrimary' : ''}`} type="button" role="tab" aria-selected={activeMode === 'stdin'} onClick={() => setActiveMode('stdin')}>完整程序题 <span className={styles.modeCount}>{stdinProblems.length}</span></button>
      </div>
      <div className={`${styles.filters} ${styles.problemFilters}`}>
        <label className="field"><span className="srOnly">搜索题目</span><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setSearchParams(event.target.value ? { q: event.target.value } : {})} placeholder="标题、标签或题号" /></div></label>
        <label className="field"><span className="srOnly">来源</span><select className="select" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option><option value="leetcode-cn">力扣</option><option value="leetcode">LeetCode</option><option value="nowcoder">牛客</option><option value="luogu">洛谷</option><option value="manual">手动录入</option></select></label>
        <label className="field"><span className="srOnly">难度</span><select className="select" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="all">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="unknown">未标注</option></select></label>
        <label className="field"><span className="srOnly">状态</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="todo">待练习</option><option value="attempted">练习中</option><option value="solved">已通过</option><option value="unknown">未确认</option></select></label>
      </div>

      <section className={styles.problemModule} aria-labelledby={`${activeMode}-module-title`}>
        <div className={styles.problemModuleHead}>
          <div><span className={styles.kicker}>{activeMode === 'stdin' ? 'PAT / ACM 训练模式' : '平台函数题'}</span><h2 id={`${activeMode}-module-title`}>{activeMode === 'stdin' ? '完整程序题' : '函数题'} <small>{filtered.length} 道</small></h2></div>
          <button className="button" type="button" onClick={() => openDialog(activeMode)}><Plus size={14} />新增</button>
        </div>
      <div className={styles.tableWrap}>
        {filtered.length ? (
          <table className={styles.table}>
            <thead><tr><th>题目</th><th>来源</th><th>难度</th><th>状态</th><th>更新</th><th><span className="srOnly">操作</span></th></tr></thead>
            <tbody>{filtered.map((problem) => (
              <tr key={problem.id}>
                <td className={styles.tableTitle}>{problem.externalId ? `${problem.externalId}. ` : ''}{problem.title}<div className={styles.tags}>{problem.tags.slice(0, 4).map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}</div></td>
                <td>{sourceLabel(problem.source)}</td><td>{difficultyLabel(problem.difficulty)}</td>
                <td><span className={`${styles.badge} ${problem.platformStatus === 'solved' ? styles.badgeAccent : ''}`}>{problem.platformStatus === 'solved' ? '已通过' : problem.platformStatus === 'attempted' ? '练习中' : '待练习'}</span></td>
                <td>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(problem.updatedAt))}</td>
                <td><button className="iconButton" type="button" title="开始做题" aria-label={`开始 ${problem.title}`} onClick={() => navigate(`/solve/${problem.id}`)}><Play size={15} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <EmptyState title={activeMode === 'stdin' ? '还没有完整程序题' : '没有匹配的函数题'} message={activeMode === 'stdin' ? '可从官方平台导入题面，或粘贴官网链接建立一张完整程序题。' : '调整筛选条件，或换一个关键词。'} action={<button className="button buttonAccent" type="button" onClick={() => openDialog(activeMode)}><FilePlus2 size={15} />建立学习卡</button>} />}
      </div>
      </section>

      <dialog className={styles.dialog} ref={dialogRef}>
        <div className={styles.dialogHead}><h2>建立学习卡</h2><button className="iconButton" type="button" aria-label="关闭" onClick={() => dialogRef.current?.close()}><X size={17} /></button></div>
        <form className={`${styles.dialogBody} ${styles.formGrid}`} onSubmit={submit}>
          <label className={`field ${styles.formFull}`}><span>题目标题</span><input className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="field"><span>题号</span><input className="input" value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} /></label>
          <label className="field"><span>难度</span><select className="select" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}><option value="unknown">未标注</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label>
          <label className={`field ${styles.formFull}`}><span>题型</span><select className="select" value={form.algorithmMode} onChange={(event) => { const mode = event.target.value as AlgorithmMode; setForm({ ...form, algorithmMode: mode }); setActiveMode(mode); }}><option value="function">函数题：只写解题函数</option><option value="stdin">完整程序题：自行处理标准输入输出</option></select></label>
          <label className={`field ${styles.formFull}`}><span>单题链接</span><input className="input" type="url" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} placeholder="https://..." /></label>
          <label className={`field ${styles.formFull}`}><span>标签</span><input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="数组，双指针，滑动窗口" /></label>
          <label className={`field ${styles.formFull}`}><span>题目内容</span><textarea className="textarea" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
          <div className={`field ${styles.formFull}`}><span>离线截图识别（可选，中英文）</span><div className={styles.buttonRow}><label className="button" style={{ cursor: ocrBusy ? 'not-allowed' : 'pointer' }}><FileImage size={15} />选择截图<input className="srOnly" type="file" accept="image/png,image/jpeg,image/webp" disabled={ocrBusy} onChange={(event) => void recognizeImage(event.target.files?.[0])} /></label>{ocrBusy && <button className="button buttonDanger" type="button" onClick={cancelOcr}><Square size={13} />取消 {ocrProgress}%</button>}</div></div>
          <div className={styles.formActions}><button className="button" type="button" onClick={() => dialogRef.current?.close()}>取消</button><button className="button buttonPrimary" type="submit">保存学习卡</button></div>
        </form>
      </dialog>
    </>
  );
}
