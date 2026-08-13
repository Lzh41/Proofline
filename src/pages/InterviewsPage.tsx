import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleHelp,
  Dices,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/PagePrimitives';
import { InterviewExaminerDialog } from '../components/InterviewExaminerDialog';
import { useStoreView, difficultyLabel } from '../app/storeAdapter';
import { INTERVIEW_ROLES, isInterviewProblem } from '../lib/interviews';
import type { Difficulty, InterviewFormat, Problem } from '../types';
import styles from './Pages.module.css';

type MasteryFilter = 'all' | 'unpracticed' | 'mastered' | 'uncertain' | 'unknown';

const FORMAT_LABELS: Record<InterviewFormat, string> = {
  knowledge: '知识问答',
  scenario: '场景分析',
  'system-design': '系统设计',
  project: '项目深挖',
};

const MASTERY_LABELS: Record<MasteryFilter, string> = {
  all: '全部掌握状态',
  unpracticed: '尚未练习',
  mastered: '已掌握',
  uncertain: '还需巩固',
  unknown: '完全不会',
};

function masteryOf(problemId: string, attempts: ReturnType<typeof useStoreView>['attempts']): MasteryFilter {
  const result = attempts
    .filter((attempt) => attempt.problemId === problemId && attempt.mode === 'interview' && attempt.endedAt)
    .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))[0]?.result;
  return result === 'mastered' || result === 'uncertain' || result === 'unknown' ? result : 'unpracticed';
}

function searchableText(problem: Problem): string {
  const interview = problem.interview;
  return [
    problem.title,
    problem.content,
    ...problem.tags,
    interview?.category,
    ...(interview?.roles ?? []),
    ...(interview?.keyPoints ?? []),
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
}

function difficultyTone(difficulty: Difficulty): string {
  if (difficulty === 'hard') return styles.interviewDifficultyHard;
  if (difficulty === 'medium') return styles.interviewDifficultyMedium;
  return styles.interviewDifficultyEasy;
}

function masteryTone(result: MasteryFilter): string {
  if (result === 'mastered') return styles.interviewMastered;
  if (result === 'uncertain') return styles.interviewUncertain;
  if (result === 'unknown') return styles.interviewUnknown;
  return styles.interviewUnpracticed;
}

export function InterviewsPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = searchParams.get('role') || 'all';
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || 'all';
  const format = (searchParams.get('format') || 'all') as 'all' | InterviewFormat;
  const difficulty = (searchParams.get('difficulty') || 'all') as 'all' | Difficulty;
  const mastery = (searchParams.get('mastery') || 'all') as MasteryFilter;
  const [message, setMessage] = useState('');
  const [restoring, setRestoring] = useState(false);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    role: 'llm-app',
    category: '',
    format: 'knowledge' as InterviewFormat,
    difficulty: 'medium' as Exclude<Difficulty, 'unknown'>,
    tags: '',
    keyPoints: '',
    referenceAnswer: '',
    followUps: '',
  });

  const problems = useMemo(
    () => store.problems.filter((problem) => isInterviewProblem(problem) && !problem.interview?.archived),
    [store.problems],
  );
  const roleDefinitions = useMemo(() => {
    const known = new Set(INTERVIEW_ROLES.map((item) => item.id));
    const extra = problems
      .flatMap((problem) => problem.interview?.roles ?? [])
      .filter((id, index, values) => !known.has(id) && values.indexOf(id) === index)
      .map((id) => ({ id, label: id, aliases: [] }));
    return [...INTERVIEW_ROLES, ...extra].filter((definition) =>
      problems.some((problem) => problem.interview?.roles.includes(definition.id)),
    );
  }, [problems]);
  const categories = useMemo(
    () => [...new Set(problems.map((problem) => problem.interview?.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [problems],
  );
  const latestMastery = useMemo(() => new Map(problems.map((problem) => [problem.id, masteryOf(problem.id, store.attempts)])), [problems, store.attempts]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return problems.filter((problem) => {
      const interview = problem.interview!;
      if (role !== 'all' && !interview.roles.includes(role) && interview.primaryRole !== role) return false;
      if (category !== 'all' && interview.category !== category) return false;
      if (format !== 'all' && interview.format !== format) return false;
      if (difficulty !== 'all' && problem.difficulty !== difficulty) return false;
      if (mastery !== 'all' && latestMastery.get(problem.id) !== mastery) return false;
      return !normalizedQuery || searchableText(problem).includes(normalizedQuery);
    });
  }, [category, difficulty, format, latestMastery, mastery, problems, query, role]);

  const updateFilter = (key: string, value: string, defaultValue = 'all') => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === defaultValue) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const practicePath = (problemId: string) => {
    const queryString = searchParams.toString();
    return `/interviews/${problemId}${queryString ? `?${queryString}` : ''}`;
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const randomPractice = () => {
    if (!filtered.length) return;
    const selected = filtered[Math.floor(Math.random() * filtered.length)];
    navigate(practicePath(selected.id));
  };

  const restoreCatalog = async () => {
    if (!store.restoreInterviewCatalog || restoring) return;
    setRestoring(true);
    setMessage('');
    try {
      const count = await store.restoreInterviewCatalog();
      setMessage(`内置面试题库已校准，共 ${typeof count === 'number' ? count : problems.length} 道题。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复内置题库失败，请稍后重试。');
    } finally {
      setRestoring(false);
    }
  };

  const openCreateDialog = () => {
    const dialog = createDialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  const closeCreateDialog = () => {
    const dialog = createDialogRef.current;
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const createPersonalQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    const keyPoints = draft.keyPoints.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const followUps = draft.followUps.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!draft.title.trim() || !draft.category.trim() || keyPoints.length < 3 || !draft.referenceAnswer.trim() || !followUps.length) {
      setMessage('请填写题目、分类、至少 3 个参考要点、完整答案和至少 1 个追问。');
      return;
    }
    if (!store.addProblem || creating) return;
    setCreating(true);
    try {
      await store.addProblem({
        kind: 'interview',
        title: draft.title.trim(),
        source: 'manual',
        difficulty: draft.difficulty,
        tags: draft.tags.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
        content: draft.title.trim(),
        constraints: [],
        examples: [],
        attachments: [],
        platformStatus: 'todo',
        cacheStatus: 'manual',
        importMethod: 'manual',
        interview: {
          contentOrigin: 'user',
          primaryRole: draft.role,
          roles: [draft.role],
          category: draft.category.trim(),
          format: draft.format,
          keyPoints,
          referenceAnswer: draft.referenceAnswer.trim(),
          followUps,
        },
      });
      setMessage('个人面试题已保存。');
      setDraft({ title: '', role: 'llm-app', category: '', format: 'knowledge', difficulty: 'medium', tags: '', keyPoints: '', referenceAnswer: '', followUps: '' });
      closeCreateDialog();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存个人面试题失败。');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.interviewLibraryPage}>
      <header className={styles.interviewHero}>
        <div className={styles.interviewHeroCopy}>
          <span className={styles.interviewEyebrow}><BriefcaseBusiness size={13} />企业面试工作台</span>
          <h1>把零散八股，练成可表达的答案。</h1>
          <p>覆盖 AI 与传统研发岗位，按岗位、场景和掌握状态反复演练。</p>
        </div>
        <div className={styles.interviewHeroActions}>
          <span className={styles.interviewCatalogCount}><strong>{problems.length}</strong><small>道完整面试题</small></span>
          <InterviewExaminerDialog />
          <button className="button" type="button" onClick={openCreateDialog}><Plus size={15} />新增面试题</button>
          <button className="button buttonPrimary" type="button" disabled={!filtered.length} onClick={randomPractice}><Dices size={15} />随机一题</button>
          <button className="iconButton" type="button" aria-label="恢复内置题库" title="恢复内置题库" disabled={restoring || !store.restoreInterviewCatalog} onClick={() => void restoreCatalog()}><RefreshCcw size={16} className={restoring ? styles.spin : undefined} /></button>
        </div>
      </header>

      <section className={styles.interviewLibrary}>
        <div className={styles.interviewRoleRail} aria-label="岗位筛选">
          <button className={`${styles.interviewRoleButton} ${role === 'all' ? styles.interviewRoleActive : ''}`} type="button" aria-pressed={role === 'all'} onClick={() => updateFilter('role', 'all')}><Sparkles size={13} />全部岗位</button>
          {roleDefinitions.map((item) => (
            <button className={`${styles.interviewRoleButton} ${role === item.id ? styles.interviewRoleActive : ''}`} type="button" aria-pressed={role === item.id} key={item.id} onClick={() => updateFilter('role', item.id)}>{item.label}</button>
          ))}
        </div>

        <div className={styles.interviewFilters}>
          <label className={styles.interviewSearch}><Search size={15} /><span className="srOnly">检索面试题</span><input value={query} onChange={(event) => updateFilter('q', event.target.value, '')} placeholder="检索题目、技术栈或知识点" /></label>
          <select className="select" aria-label="知识分类" value={category} onChange={(event) => updateFilter('category', event.target.value)}><option value="all">全部分类</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select>
          <select className="select" aria-label="题型" value={format} onChange={(event) => updateFilter('format', event.target.value)}><option value="all">全部题型</option>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select className="select" aria-label="难度" value={difficulty} onChange={(event) => updateFilter('difficulty', event.target.value)}><option value="all">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select>
          <select className="select" aria-label="掌握状态" value={mastery} onChange={(event) => updateFilter('mastery', event.target.value)}>{Object.entries(MASTERY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <button className="iconButton" type="button" aria-label="清空筛选" title="清空筛选" onClick={clearFilters}><RotateCcw size={15} /></button>
        </div>

        <div className={styles.interviewListHeader}>
          <span>{filtered.length} / {problems.length} 道题</span>
          {message && <span role="status">{message}</span>}
        </div>
        <div className={styles.interviewQuestionList}>
          {filtered.length ? filtered.map((problem) => {
            const interview = problem.interview!;
            const status = latestMastery.get(problem.id) ?? 'unpracticed';
            return (
              <article className={styles.interviewQuestionRow} key={problem.id}>
                <div className={styles.interviewQuestionMain}>
                  <div className={styles.interviewQuestionMeta}>
                    <span className={`${styles.interviewStatus} ${masteryTone(status)}`}>{status === 'unpracticed' ? '未练习' : MASTERY_LABELS[status]}</span>
                    <span>{interview.category}</span><span>{FORMAT_LABELS[interview.format]}</span>
                    <span className={difficultyTone(problem.difficulty)}>{difficultyLabel(problem.difficulty)}</span>
                  </div>
                  <h2>{problem.title}</h2>
                  <div className={styles.interviewQuestionTags}>{problem.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
                <button className={styles.interviewPracticeButton} type="button" aria-label={`练习：${problem.title}`} onClick={() => navigate(practicePath(problem.id))}><span>开始练习</span><ArrowUpRight size={16} /></button>
              </article>
            );
          }) : (
            <EmptyState compact title="没有匹配的面试题" message="调整岗位或筛选条件后再试。" action={<button className="button" type="button" onClick={clearFilters}><CircleHelp size={14} />重置筛选</button>} />
          )}
        </div>
        <footer className={styles.interviewLibraryFoot}><CheckCircle2 size={13} /><span>回答草稿、掌握度和复习记录仅保存在本机。</span></footer>
      </section>

      <dialog className={styles.dialog} ref={createDialogRef}>
        <div className={styles.dialogHead}>
          <div><span className={styles.interviewEyebrow}>个人题库</span><h2>新增企业面试题</h2></div>
          <button className="iconButton" type="button" aria-label="关闭新增面试题" onClick={closeCreateDialog}><X size={17} /></button>
        </div>
        <form className={styles.dialogBody} onSubmit={createPersonalQuestion}>
          <div className={styles.formGrid}>
            <label className={`field ${styles.formFull}`}><span>题目</span><input className="input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="field"><span>岗位方向</span><select className="select" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>{INTERVIEW_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="field"><span>知识分类</span><input className="input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
            <label className="field"><span>题型</span><select className="select" value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as InterviewFormat })}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>难度</span><select className="select" value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value as typeof draft.difficulty })}><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label>
            <label className={`field ${styles.formFull}`}><span>标签</span><input className="input" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="用逗号分隔" /></label>
            <label className={`field ${styles.formFull}`}><span>参考要点</span><textarea className="textarea" rows={4} value={draft.keyPoints} onChange={(event) => setDraft({ ...draft, keyPoints: event.target.value })} placeholder="每行一个要点，至少三行" /></label>
            <label className={`field ${styles.formFull}`}><span>完整参考答案</span><textarea className="textarea" rows={6} value={draft.referenceAnswer} onChange={(event) => setDraft({ ...draft, referenceAnswer: event.target.value })} /></label>
            <label className={`field ${styles.formFull}`}><span>追问</span><textarea className="textarea" rows={3} value={draft.followUps} onChange={(event) => setDraft({ ...draft, followUps: event.target.value })} placeholder="每行一个追问" /></label>
          </div>
          <div className={styles.buttonRow} style={{ justifyContent: 'flex-end', marginTop: 18 }}>
            <button className="button" type="button" disabled={creating} onClick={closeCreateDialog}>取消</button>
            <button className="button buttonPrimary" type="submit" disabled={creating}>{creating ? '保存中…' : '保存面试题'}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
