import { useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Check, LoaderCircle, RefreshCcw, Sparkles, WandSparkles, X } from 'lucide-react';
import { useStoreView } from '../app/storeAdapter';
import { INTERVIEW_ROLES, INTERVIEW_ROLE_REQUIREMENTS, interviewRoleRequirements, retrieveInterviewCatalog } from '../lib/interviews';
import { INTERVIEW_CATALOG } from '../data/interviewCatalog';
import { filterInterviewQuestionAdditions, type InterviewExaminerResult } from '../lib/ai';
import type { Difficulty } from '../types';
import styles from '../pages/Pages.module.css';

const DIFFICULTY_LABELS: Record<Exclude<Difficulty, 'unknown'>, string> = {
  easy: '基础',
  medium: '进阶',
  hard: '高级',
};

export function InterviewExaminerDialog() {
  const store = useStoreView();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [topic, setTopic] = useState('');
  const [role, setRole] = useState('llm-app');
  const [jobTitle, setJobTitle] = useState('');
  const [requirements, setRequirements] = useState(() => interviewRoleRequirements('llm-app').join('\n'));
  const [difficulty, setDifficulty] = useState<Exclude<Difficulty, 'unknown'>>('medium');
  const [count, setCount] = useState(20);
  const [result, setResult] = useState<InterviewExaminerResult>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');

  const hasAi = Boolean(store.settings.hasAiCredential && store.settings.aiModel?.trim() && store.requestInterviewExaminer);
  const selectedCount = selected.size;
  const selectedQuestions = useMemo(
    () => result?.questions.filter((_, index) => selected.has(index)) ?? [],
    [result, selected],
  );
  const activeRole = useMemo(() => INTERVIEW_ROLES.find((item) => item.id === role), [role]);
  const requirementList = useMemo(
    () => requirements.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean),
    [requirements],
  );
  const catalogMatches = useMemo(() => {
    const query = [topic, jobTitle, requirements].filter(Boolean).join(' ');
    return retrieveInterviewCatalog(INTERVIEW_CATALOG, { role, roles: [role], query, limit: 24, minPerFormat: 2 });
  }, [jobTitle, requirements, role, topic]);
  const catalogContext = useMemo(() => catalogMatches.map((item) => ({
    id: item.id,
    title: item.question,
    category: item.category,
    format: item.format,
    difficulty: item.difficulty,
    roles: [...new Set([item.primaryRole, ...item.roles])],
    tags: item.tags.slice(0, 8),
    keyPoints: item.keyPoints.slice(0, 6),
  })), [catalogMatches]);

  const open = () => {
    setError('');
    setMessage('');
    setProgress('');
    if (typeof dialogRef.current?.showModal === 'function') dialogRef.current.showModal();
    else dialogRef.current?.setAttribute('open', '');
  };

  const close = () => {
    if (typeof dialogRef.current?.close === 'function') dialogRef.current.close();
    else dialogRef.current?.removeAttribute('open');
  };

  const generate = async (append = false) => {
    if (busy) return;
    if (!topic.trim() && !jobTitle.trim() && !requirements.trim()) {
      setError('先填写目标职位或技术主题，例如 RAG 工程师、Transformer 或分布式事务。');
      return;
    }
    if (!hasAi) {
      setError('请先在设置中填写模型 ID 并保存 AI 密钥。');
      return;
    }
    if (!store.settings.privacyConfirmed) {
      const confirmed = window.confirm('本次会把技术主题和岗位方向发送到已配置的 AI 服务。是否继续？');
      if (!confirmed) return;
      await store.updateSettings?.({ privacyConfirmed: true });
    }
    setBusy(true);
    setError('');
    setMessage('');
    setProgress(append ? '正在排除上一轮题目并补齐新的能力域…' : `正在检索本地题库，已找到 ${catalogMatches.length} 道相关题…`);
    try {
      const generated = await store.requestInterviewExaminer?.({
        topic: topic.trim() || jobTitle.trim(),
        role,
        difficulty,
        count,
        roleLabel: jobTitle.trim() || activeRole?.label || role,
        requirements: [jobTitle.trim() || topic.trim(), ...requirementList].filter(Boolean).join('；'),
        catalogContext,
        excludedQuestions: append ? (result?.questions ?? []) : [],
      });
      if (!generated) throw new Error('AI 没有返回有效的面试题');
      if (append && result) {
        const additions = filterInterviewQuestionAdditions(generated.questions, result.questions);
        const offset = result.questions.length;
        setResult({
          ...result,
          overview: generated.overview || result.overview,
          checkpoints: [...new Set([...result.checkpoints, ...generated.checkpoints])],
          coverage: [...new Set([...(result.coverage ?? []), ...(generated.coverage ?? [])])],
          gaps: generated.gaps ?? result.gaps,
          questions: [...result.questions, ...additions],
          matchedQuestions: generated.matchedQuestions ?? result.matchedQuestions,
        });
        setSelected((current) => new Set([...current, ...additions.map((_, index) => offset + index)]));
        setProgress(`已补充 ${additions.length} 道新题，当前共 ${result.questions.length + additions.length} 道；已排除上一轮题目。`);
      } else {
        setResult(generated);
        setSelected(new Set(generated.questions.map((_, index) => index)));
        setProgress(`已检索 ${generated.matchedQuestions?.length ?? catalogMatches.length} 道题，并生成 ${generated.questions.length} 道覆盖题。`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 出题失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const toggleQuestion = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const saveSelected = async () => {
    if (!store.addProblem || saving || !selectedQuestions.length) return;
    setSaving(true);
    setError('');
    setMessage('');
    const existingTitles = new Set(store.problems.map((problem) => problem.title.trim().toLocaleLowerCase('zh-CN')));
    let saved = 0;
    let skipped = 0;
    try {
      for (const question of selectedQuestions) {
        const normalizedTitle = question.title.trim().toLocaleLowerCase('zh-CN');
        if (existingTitles.has(normalizedTitle)) {
          skipped += 1;
          continue;
        }
        await store.addProblem({
          kind: 'interview',
          title: question.title,
          source: 'manual',
          difficulty: question.difficulty,
          tags: question.tags,
          content: question.title,
          constraints: [],
          examples: [],
          attachments: [],
          platformStatus: 'todo',
          cacheStatus: 'manual',
          importMethod: 'import',
          interview: {
            contentOrigin: 'ai',
            primaryRole: role,
            roles: [role],
            category: question.category,
            format: question.format,
            keyPoints: question.keyPoints,
            referenceAnswer: question.referenceAnswer,
            followUps: question.followUps,
          },
        });
        existingTitles.add(normalizedTitle);
        saved += 1;
      }
      setMessage(`已保存 ${saved} 道题${skipped ? `，跳过 ${skipped} 道同名题` : ''}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存 AI 面试题失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className="button" type="button" onClick={open}><WandSparkles size={15} />AI 面试出题官</button>
      <dialog className={`${styles.dialog} ${styles.interviewExaminerDialog}`} ref={dialogRef}>
        <div className={styles.dialogHead}>
          <div><span className={styles.interviewEyebrow}><Sparkles size={13} />AI 面试出题官</span><h2>按岗位需求补齐面试考点</h2></div>
          <button className="iconButton" type="button" aria-label="关闭 AI 面试出题官" onClick={close}><X size={17} /></button>
        </div>
        <div className={styles.interviewExaminerBody}>
          <div className={styles.interviewExaminerForm}>
            <label className={`field ${styles.interviewExaminerTopic}`}><span>目标职位 / 技术主题</span><input className="input" aria-label="技术主题" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如 RAG 工程师、Transformer、分布式事务" /></label>
            <label className="field"><span>岗位方向</span><select className="select" aria-label="出题岗位方向" value={role} onChange={(event) => { const next = event.target.value; setRole(next); setRequirements((INTERVIEW_ROLE_REQUIREMENTS[next] ?? interviewRoleRequirements(next)).join('\n')); }}>{INTERVIEW_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="field"><span>职位名称（可选）</span><input className="input" aria-label="职位名称" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="例如 高级 RAG 工程师" /></label>
            <label className="field"><span>难度</span><select className="select" aria-label="出题难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>{Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>题目数</span><select className="select" aria-label="生成题目数量" value={count} onChange={(event) => setCount(Number(event.target.value))}>{[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value} 道</option>)}</select></label>
            <label className={`field ${styles.interviewExaminerRequirements}`}><span>岗位需求（可编辑，每行一项）</span><textarea className="textarea" aria-label="岗位需求" rows={4} value={requirements} onChange={(event) => setRequirements(event.target.value)} /></label>
            <button className="button buttonPrimary" type="button" aria-label="生成面试考点" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <Sparkles size={15} />}{busy ? '正在检索并出题' : '检索题库并生成'}</button>
          </div>

          <div className={styles.interviewExaminerScope} aria-live="polite">
            <span><BookOpenCheck size={14} />岗位覆盖 {requirementList.length} 个维度</span>
            <span>本地题库命中 {catalogMatches.length} 道</span>
            {progress && <span>{progress}</span>}
          </div>

          {!hasAi && <div className={styles.interviewExaminerNotice}><BookOpenCheck size={15} /><span>配置 AI 后即可按主题生成题目；现有面试题库与本地练习不受影响。</span></div>}
          {error && <div className={styles.interviewExaminerError} role="alert">{error}</div>}

          {result ? (
            <div className={styles.interviewExaminerResults}>
              <header>
                <div><span>{result.topic}</span><h3>{result.overview}</h3></div>
                <small>{result.questions.length} 道题 · 已选 {selectedCount} 道 · 题库命中 {result.matchedQuestions?.length ?? catalogMatches.length} 道</small>
              </header>
              <div className={styles.interviewExaminerCoverage}>
                <strong>岗位需求覆盖</strong>
                {(result.coverage?.length ? result.coverage : requirementList).map((item) => <span key={item}>{item}</span>)}
                {result.gaps?.map((item) => <span className={styles.interviewExaminerGap} key={`gap-${item}`}>待补：{item}</span>)}
              </div>
              <div className={styles.interviewCheckpointRail} aria-label="核心考点">{result.checkpoints.map((item) => <span key={item}>{item}</span>)}</div>
              <div className={styles.interviewExaminerQuestions}>
                {result.questions.map((question, index) => (
                  <label className={`${styles.interviewExaminerQuestion} ${selected.has(index) ? styles.interviewExaminerQuestionSelected : ''}`} key={`${question.title}-${index}`}>
                    <input type="checkbox" checked={selected.has(index)} onChange={() => toggleQuestion(index)} />
                    <span className={styles.interviewExaminerCheck}><Check size={12} /></span>
                    <span className={styles.interviewExaminerQuestionCopy}>
                      <span><b>{question.category}</b><i>{DIFFICULTY_LABELS[question.difficulty]}</i></span>
                      <strong>{question.title}</strong>
                      <small>{question.keyPoints.slice(0, 3).join(' · ')}</small>
                    </span>
                  </label>
                ))}
              </div>
              <footer className={styles.interviewExaminerFooter}>
                <span role="status">{message || '勾选真正需要复习的题目，再加入个人面试题库。'}</span>
                <div className={styles.interviewExaminerFooterActions}>
                  <button className="button" type="button" disabled={busy || saving} onClick={() => void generate(true)}><RefreshCcw size={14} />{busy ? '补题中…' : '继续补充一轮'}</button>
                  <button className="button buttonPrimary" type="button" disabled={!selectedCount || saving || busy} onClick={() => void saveSelected()}>{saving ? '正在加入…' : '加入个人题库'}</button>
                </div>
              </footer>
            </div>
          ) : !busy && <div className={styles.interviewExaminerEmpty}><WandSparkles size={27} /><strong>输入职位需求，先检索题库再补齐缺口</strong><span>每道新题都包含参考答案、回答要点和递进追问，可直接加入个人题库。</span></div>}
        </div>
      </dialog>
    </>
  );
}
