import { useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Check, LoaderCircle, Sparkles, WandSparkles, X } from 'lucide-react';
import { useStoreView } from '../app/storeAdapter';
import { INTERVIEW_ROLES } from '../lib/interviews';
import type { InterviewExaminerResult } from '../lib/ai';
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
  const [role, setRole] = useState('llm-algorithm');
  const [difficulty, setDifficulty] = useState<Exclude<Difficulty, 'unknown'>>('medium');
  const [count, setCount] = useState(5);
  const [result, setResult] = useState<InterviewExaminerResult>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const hasAi = Boolean(store.settings.hasAiCredential && store.settings.aiModel?.trim() && store.requestInterviewExaminer);
  const selectedCount = selected.size;
  const selectedQuestions = useMemo(
    () => result?.questions.filter((_, index) => selected.has(index)) ?? [],
    [result, selected],
  );

  const open = () => {
    setError('');
    setMessage('');
    if (typeof dialogRef.current?.showModal === 'function') dialogRef.current.showModal();
    else dialogRef.current?.setAttribute('open', '');
  };

  const close = () => {
    if (typeof dialogRef.current?.close === 'function') dialogRef.current.close();
    else dialogRef.current?.removeAttribute('open');
  };

  const generate = async () => {
    if (busy) return;
    if (!topic.trim()) {
      setError('先填写要准备的技术主题，例如 Transformer、RAG 或分布式事务。');
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
    try {
      const generated = await store.requestInterviewExaminer?.({ topic: topic.trim(), role, difficulty, count });
      if (!generated) throw new Error('AI 没有返回有效的面试题');
      setResult(generated);
      setSelected(new Set(generated.questions.map((_, index) => index)));
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
          <div><span className={styles.interviewEyebrow}><Sparkles size={13} />AI 面试出题官</span><h2>把一个主题拆成完整面试考点</h2></div>
          <button className="iconButton" type="button" aria-label="关闭 AI 面试出题官" onClick={close}><X size={17} /></button>
        </div>
        <div className={styles.interviewExaminerBody}>
          <div className={styles.interviewExaminerForm}>
            <label className={`field ${styles.interviewExaminerTopic}`}><span>技术主题</span><input className="input" aria-label="技术主题" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如 Transformer、RAG、NLP、Redis" /></label>
            <label className="field"><span>岗位方向</span><select className="select" aria-label="出题岗位方向" value={role} onChange={(event) => setRole(event.target.value)}>{INTERVIEW_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="field"><span>难度</span><select className="select" aria-label="出题难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>{Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>题目数</span><select className="select" aria-label="生成题目数量" value={count} onChange={(event) => setCount(Number(event.target.value))}>{[3, 5, 8, 10].map((value) => <option key={value} value={value}>{value} 道</option>)}</select></label>
            <button className="button buttonPrimary" type="button" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle className={styles.spin} size={15} /> : <Sparkles size={15} />}{busy ? '正在梳理考点' : '生成面试考点'}</button>
          </div>

          {!hasAi && <div className={styles.interviewExaminerNotice}><BookOpenCheck size={15} /><span>配置 AI 后即可按主题生成题目；现有面试题库与本地练习不受影响。</span></div>}
          {error && <div className={styles.interviewExaminerError} role="alert">{error}</div>}

          {result ? (
            <div className={styles.interviewExaminerResults}>
              <header>
                <div><span>{result.topic}</span><h3>{result.overview}</h3></div>
                <small>{result.questions.length} 道题 · 已选 {selectedCount} 道</small>
              </header>
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
                <button className="button buttonPrimary" type="button" disabled={!selectedCount || saving} onClick={() => void saveSelected()}>{saving ? '正在加入…' : '加入个人题库'}</button>
              </footer>
            </div>
          ) : !busy && <div className={styles.interviewExaminerEmpty}><WandSparkles size={27} /><strong>输入一个主题，得到完整的考点地图</strong><span>每道题都包含参考答案、回答要点和递进追问，可直接加入个人题库。</span></div>}
        </div>
      </dialog>
    </>
  );
}
