import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, BrainCircuit, Plus, Search, Sparkles, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { KnowledgeNote } from '../types';
import { useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader, SectionHeader } from '../components/PagePrimitives';
import { renderMarkdown } from '../lib/markdown';
import styles from './Pages.module.css';

const EMPTY_FORM = { title: '', tags: '', content: '' };

export function KnowledgePage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const { id: noteId } = useParams();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const notes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return store.knowledgeNotes.filter((note) => !keyword || [note.title, note.content, ...note.tags].some((value) => value.toLowerCase().includes(keyword)));
  }, [query, store.knowledgeNotes]);
  const tags = useMemo(() => Array.from(new Set(store.knowledgeNotes.flatMap((note) => note.tags))).slice(0, 12), [store.knowledgeNotes]);
  const openedNote = useMemo(
    () => (noteId ? store.knowledgeNotes.find((note) => note.id === noteId) : undefined),
    [noteId, store.knowledgeNotes],
  );

  const analyzeRecentPractice = async () => {
    if (!store.analyzeRecentPractice || analyzing) return;
    if (!store.settings.hasAiCredential || !store.settings.aiModel?.trim()) {
      setMessage('请先在设置中保存 AI 密钥并填写模型 ID。');
      return;
    }
    setAnalyzing(true);
    setMessage('正在整理上次分析之后新增的练习题…');
    try {
      const note = await store.analyzeRecentPractice();
      if (!note) {
        setMessage('没有新增的已完成练习，暂时不重复生成笔记。');
        return;
      }
      navigate(`/knowledge/${note.id}`);
      setMessage(`已生成「${note.title}」，覆盖 ${note.relatedProblemIds.length} 道新增练习题。`);
    } catch (error) {
      setMessage(error instanceof Error ? `分析失败：${error.message}` : '分析失败，请稍后重试。');
    } finally {
      setAnalyzing(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const now = Date.now();
    const note: Partial<KnowledgeNote> = { title: form.title.trim(), content: form.content.trim(), tags: form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), relatedProblemIds: [], relatedMistakeIds: [], createdAt: now, updatedAt: now };
    const action = store.addKnowledgeNote ?? store.createKnowledgeNote;
    if (!action) {
      setMessage('知识库服务尚未初始化，请重新启动应用。');
      return;
    }
    await action(note);
    setForm(EMPTY_FORM);
    dialogRef.current?.close();
    setMessage('笔记已保存并进入全文检索。');
  };

  return (
    <>
      {openedNote ? (
        <article className={styles.noteReader}>
          <PageHeader
            eyebrow="知识库 · 阅读"
            title={openedNote.title}
            description={`更新于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(openedNote.updatedAt))}`}
            actions={<button className="button" type="button" onClick={() => navigate('/knowledge')}><ArrowLeft size={15} />返回知识库</button>}
          />
          <div className={styles.noteReaderMeta}>
            <div className={styles.tags}>{openedNote.tags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}</div>
            <span className={styles.badge}>{openedNote.relatedProblemIds.length} 道关联题目</span>
          </div>
          <div className={styles.noteReaderBody} dangerouslySetInnerHTML={{ __html: renderMarkdown(openedNote.content) }} />
        </article>
      ) : <>
      <PageHeader eyebrow="知识库" title="把解题经验写成自己的工具箱。" description="笔记、代码模板、易错清单和关联题目统一检索；内容始终保存在本地。" actions={<div className="buttonRow"><button className="button buttonAccent" type="button" disabled={analyzing || !store.analyzeRecentPractice} onClick={() => void analyzeRecentPractice()}><BrainCircuit size={16} />{analyzing ? '分析中…' : 'AI 分析最近练习'}</button><button className="button buttonPrimary" type="button" onClick={() => dialogRef.current?.showModal()}><Plus size={16} />新建笔记</button></div>} />
      {message && <div className={styles.notice}>{message}</div>}
      <section className={styles.accentPanel} style={{ marginBottom: 30 }}>
        <Sparkles size={20} color="var(--accent)" />
        <strong>让练习变成一篇能回看的笔记</strong>
        <p>AI 只分析已经完成、且还没有进入历史分析的题目。它会把共同考点、每题思路、错误模式和下一轮复习清单整理到一篇本地笔记里，重复点击不会重复统计旧题。</p>
      </section>
      <div className={styles.twoColumn}>
        <section className={styles.section}>
          <div className={styles.filters} style={{ gridTemplateColumns: '1fr' }}><label className="field"><span className="srOnly">搜索知识库</span><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="全文搜索标题、正文或标签" /></div></label></div>
          <SectionHeader title="全部笔记" meta={`${notes.length} 篇`} />
          {notes.map((note) => (
            <button className={styles.row} style={{ width: '100%', borderTop: 0, borderLeft: 0, borderRight: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }} type="button" key={note.id} onClick={() => navigate(`/knowledge/${note.id}`)} aria-label={`打开笔记：${note.title}`}>
              <div className={styles.rowMain}><strong>{note.title}</strong><p>{note.content.slice(0, 88) || '空白笔记'}</p><div className={styles.tags}>{note.tags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}</div></div>
              <span className={styles.badge}>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(note.updatedAt))}</span>
            </button>
          ))}
          {!notes.length && <EmptyState title={store.knowledgeNotes.length ? '没有检索结果' : '还没有笔记'} message={store.knowledgeNotes.length ? '换一个关键词，或点击标签快速检索。' : '把一道题中可迁移的观察、模板和边界检查沉淀下来。'} action={<button className="button buttonAccent" type="button" onClick={() => dialogRef.current?.showModal()}><BookOpenText size={15} />写第一篇</button>} />}
        </section>
        <aside><section className={styles.section}><SectionHeader title="常用标签" meta={`${tags.length} 个`} /><div className={styles.tags} style={{ paddingTop: 18 }}>{tags.map((tag) => <button className={styles.tag} style={{ cursor: 'pointer' }} type="button" key={tag} onClick={() => setQuery(tag)}>{tag}</button>)}</div></section></aside>
      </div>
      </>}

      <dialog className={styles.dialog} ref={dialogRef}>
        <div className={styles.dialogHead}><h2>新建知识笔记</h2><button className="iconButton" type="button" aria-label="关闭" onClick={() => dialogRef.current?.close()}><X size={17} /></button></div>
        <form className={`${styles.dialogBody} ${styles.formGrid}`} onSubmit={create}>
          <label className={`field ${styles.formFull}`}><span>标题</span><input className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className={`field ${styles.formFull}`}><span>标签</span><input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="二分查找，边界，模板" /></label>
          <label className={`field ${styles.formFull}`}><span>正文</span><textarea className="textarea" style={{ minHeight: 220 }} required value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
          <div className={styles.formActions}><button className="button" type="button" onClick={() => dialogRef.current?.close()}>取消</button><button className="button buttonPrimary" type="submit">保存笔记</button></div>
        </form>
      </dialog>
    </>
  );
}
