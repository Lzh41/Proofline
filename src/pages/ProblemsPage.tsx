import { useMemo, useRef, useState } from 'react';
import { FileImage, FilePlus2, Play, Plus, Search, Square, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Problem } from '../types';
import { difficultyLabel, sourceLabel, useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader } from '../components/PagePrimitives';
import { isOcrCancelled, OCR_MAX_FILE_BYTES, recognizeProblemImage, type OfflineOcrTask } from '../lib/ocr';
import styles from './Pages.module.css';

const INITIAL_FORM = { title: '', sourceUrl: '', externalId: '', difficulty: 'unknown', tags: '', content: '' };

export function ProblemsPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [source, setSource] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [status, setStatus] = useState('all');
  const [form, setForm] = useState(INITIAL_FORM);
  const [message, setMessage] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const ocrTaskRef = useRef<OfflineOcrTask | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = searchParams.get('q') ?? '';

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return store.problems.filter((problem) => problem.kind === 'algorithm').filter((problem) => {
      const matchesKeyword = !keyword || [problem.title, problem.externalId, ...problem.tags].some((value) => value?.toLowerCase().includes(keyword));
      return matchesKeyword
        && (source === 'all' || problem.source === source)
        && (difficulty === 'all' || problem.difficulty === difficulty)
        && (status === 'all' || problem.platformStatus === status);
    });
  }, [difficulty, query, source, status, store.problems]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const now = Date.now();
    const draft: Partial<Problem> = {
      title: form.title.trim(),
      source: form.sourceUrl.includes('leetcode.cn') ? 'leetcode-cn' : form.sourceUrl.includes('leetcode.com') ? 'leetcode' : form.sourceUrl.includes('nowcoder.com') ? 'nowcoder' : 'manual',
      sourceUrl: form.sourceUrl.trim() || undefined,
      externalId: form.externalId.trim() || undefined,
      platformStatus: 'todo',
      cacheStatus: 'manual',
      difficulty: form.difficulty as Problem['difficulty'],
      tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      content: form.content.trim(),
      constraints: [],
      examples: [],
      attachments: [],
      importMethod: form.sourceUrl ? 'url' : 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const create = store.addProblem ?? store.createProblem;
    if (!create) {
      setMessage('题库服务尚未初始化，请重新启动应用。');
      return;
    }
    await create(draft);
    setForm(INITIAL_FORM);
    dialogRef.current?.close();
    setMessage('题目已保存到本地题库。');
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
      <PageHeader eyebrow="个人题库" title="每道题，都留下一条可复用的路。" description="这里保存的是你建立的学习卡，而不是平台题库镜像。按标题、题号、标签和状态快速回到需要练习的地方。" actions={<button className="button buttonPrimary" type="button" onClick={() => dialogRef.current?.showModal()}><Plus size={16} />建立学习卡</button>} />
      {message && <div className={styles.notice}>{message}</div>}
      <div className={styles.filters}>
        <label className="field"><span className="srOnly">搜索题目</span><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setSearchParams(event.target.value ? { q: event.target.value } : {})} placeholder="标题、标签或题号" /></div></label>
        <label className="field"><span className="srOnly">来源</span><select className="select" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option><option value="leetcode-cn">力扣</option><option value="leetcode">LeetCode</option><option value="nowcoder">牛客</option><option value="manual">手动录入</option></select></label>
        <label className="field"><span className="srOnly">难度</span><select className="select" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="all">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="unknown">未标注</option></select></label>
        <label className="field"><span className="srOnly">状态</span><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="todo">待练习</option><option value="attempted">练习中</option><option value="solved">已通过</option><option value="unknown">未确认</option></select></label>
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
        ) : <EmptyState title={store.problems.some((problem) => problem.kind === 'algorithm') ? '没有匹配的题目' : '题库还是空的'} message={store.problems.some((problem) => problem.kind === 'algorithm') ? '调整筛选条件，或换一个关键词。' : '这里仅收纳算法题；企业面试题请到“面试题”页面练习。'} action={<button className="button buttonAccent" type="button" onClick={() => dialogRef.current?.showModal()}><FilePlus2 size={15} />建立学习卡</button>} />}
      </div>

      <dialog className={styles.dialog} ref={dialogRef}>
        <div className={styles.dialogHead}><h2>建立学习卡</h2><button className="iconButton" type="button" aria-label="关闭" onClick={() => dialogRef.current?.close()}><X size={17} /></button></div>
        <form className={`${styles.dialogBody} ${styles.formGrid}`} onSubmit={submit}>
          <label className={`field ${styles.formFull}`}><span>题目标题</span><input className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="field"><span>题号</span><input className="input" value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} /></label>
          <label className="field"><span>难度</span><select className="select" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}><option value="unknown">未标注</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label>
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
