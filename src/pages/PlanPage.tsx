import { useMemo, useState } from 'react';
import { CalendarCheck2, Check, RefreshCw, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DailyPlan } from '../types';
import { todayKey, useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader, ProgressBar, SectionHeader } from '../components/PagePrimitives';
import { learningRoute } from '../lib/interviews';
import styles from './Pages.module.css';

export function PlanPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const date = todayKey();
  const current = store.dailyPlans.find((item) => item.date === date);
  const [targetMinutes, setTargetMinutes] = useState(String(current?.targetMinutes ?? store.settings.dailyTargetMinutes ?? 60));
  const [targetAlgorithmProblems, setTargetAlgorithmProblems] = useState(String(current?.targetAlgorithmProblems ?? store.settings.dailyTargetProblems ?? 3));
  const [targetInterviewQuestions, setTargetInterviewQuestions] = useState(String(current?.targetInterviewQuestions ?? store.settings.dailyTargetInterviewQuestions ?? 2));
  const [targetError, setTargetError] = useState('');
  const [focusTags, setFocusTags] = useState((current?.focusTags ?? []).join('，'));
  const [ratio, setRatio] = useState(current?.difficultyRatio ?? { easy: 30, medium: 50, hard: 20 });
  const [message, setMessage] = useState('');

  const tasks = useMemo(() => (current?.taskProblemIds ?? []).map((id) => store.problems.find((problem) => problem.id === id)).filter(Boolean), [current?.taskProblemIds, store.problems]);
  const totalRatio = ratio.easy + ratio.medium + ratio.hard;
  const parsedTargets = {
    minutes: Number(targetMinutes),
    algorithm: Number(targetAlgorithmProblems),
    interview: Number(targetInterviewQuestions),
  };
  const targetProblems = parsedTargets.algorithm + parsedTargets.interview;

  const validateTargets = () => {
    const valid = Number.isInteger(parsedTargets.minutes) && parsedTargets.minutes >= 10 && parsedTargets.minutes <= 480
      && Number.isInteger(parsedTargets.algorithm) && parsedTargets.algorithm >= 0 && parsedTargets.algorithm <= 30
      && Number.isInteger(parsedTargets.interview) && parsedTargets.interview >= 0 && parsedTargets.interview <= 30;
    setTargetError(valid ? '' : '请输入有效的整数目标：时长 10-480 分钟，题目目标 0-30。');
    return valid;
  };

  const save = async () => {
    if (totalRatio !== 100) {
      setMessage('难度比例之和需要等于 100%。');
      return;
    }
    if (!validateTargets()) return;
    const plan: Partial<DailyPlan> = {
      id: current?.id,
      date,
      targetMinutes: parsedTargets.minutes,
      targetProblems,
      targetAlgorithmProblems: parsedTargets.algorithm,
      targetInterviewQuestions: parsedTargets.interview,
      focusTags: focusTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      difficultyRatio: ratio,
      taskProblemIds: current?.taskProblemIds ?? [],
      completedProblemIds: current?.completedProblemIds ?? [],
    };
    await store.savePlan?.(plan);
    await store.updateSettings?.({
      dailyTargetMinutes: parsedTargets.minutes,
      dailyTargetProblems: parsedTargets.algorithm,
      dailyTargetInterviewQuestions: parsedTargets.interview,
    });
    setMessage('每日目标已保存。');
  };

  const generate = async () => {
    if (totalRatio !== 100) {
      setMessage('难度比例之和需要等于 100%。');
      return;
    }
    if (!validateTargets()) return;
    await save();
    await store.generateDailyPlan?.({ date, targetMinutes: parsedTargets.minutes, targetAlgorithmProblems: parsedTargets.algorithm, targetInterviewQuestions: parsedTargets.interview, focusTags: focusTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), difficultyRatio: ratio });
    setMessage('已优先安排到期复习，并按薄弱标签补齐新题。');
  };

  return (
    <>
      <PageHeader eyebrow="每日计划" title="让目标具体到下一道题。" description="计划会先放入到期复习题，再按关注专题和难度比例选择个人题库中的新题。" actions={<><button className="button" type="button" onClick={save}><Save size={15} />保存目标</button><button className="button buttonPrimary" type="button" onClick={generate}><RefreshCw size={15} />生成今日任务</button></>} />
      {(message || targetError) && <div className={`${styles.notice} ${totalRatio !== 100 || targetError ? styles.noticeDanger : ''}`}>{totalRatio === 100 && !targetError ? <Check size={17} /> : <CalendarCheck2 size={17} />}{targetError || message}</div>}
      <div className={`${styles.twoColumn} ${styles.balanced}`}>
        <section className={styles.paperPanel}>
          <SectionHeader title="目标设置" meta={date} />
          <div className={styles.formGrid} style={{ marginTop: 20 }}>
            <label className="field"><span>学习时长（分钟）</span><input className="input" type="number" min={10} max={480} value={targetMinutes} onChange={(event) => { setTargetMinutes(event.target.value); setTargetError(''); }} /></label>
            <label className="field"><span>算法题目标</span><input className="input" type="number" min={0} max={30} value={targetAlgorithmProblems} onChange={(event) => { setTargetAlgorithmProblems(event.target.value); setTargetError(''); }} /></label>
            <label className="field"><span>面试题目标</span><input className="input" type="number" min={0} max={30} value={targetInterviewQuestions} onChange={(event) => { setTargetInterviewQuestions(event.target.value); setTargetError(''); }} /></label>
            <label className={`field ${styles.formFull}`}><span>关注专题</span><input className="input" value={focusTags} onChange={(event) => setFocusTags(event.target.value)} placeholder="动态规划，二分查找，图" /></label>
            <div className={styles.formFull}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, fontWeight: 700 }}><span>难度比例</span><span style={{ color: totalRatio === 100 ? 'var(--accent-deep)' : 'var(--danger)' }}>合计 {totalRatio}%</span></div>
              <div className={styles.formGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {(['easy', 'medium', 'hard'] as const).map((key) => <label className="field" key={key}><span>{key === 'easy' ? '简单' : key === 'medium' ? '中等' : '困难'}</span><input className="input" type="number" min={0} max={100} value={ratio[key]} onChange={(event) => setRatio({ ...ratio, [key]: Number(event.target.value) })} /></label>)}
              </div>
            </div>
          </div>
        </section>
        <section className={styles.paperPanel}>
          <SectionHeader title="排程逻辑" meta="复习优先" />
          <div style={{ paddingTop: 20 }}>
            <ProgressBar value={Math.min(100, (store.mistakes.filter((item) => item.nextReviewAt <= Date.now() && item.status !== 'mastered').length / Math.max(1, targetProblems)) * 100)} label="到期复习占比" />
            <div className={styles.timeline} style={{ marginTop: 20 }}>
              <div className={styles.timelineItem}><strong>先清到期错题</strong><span>失败题回到 1 天间隔，不让薄弱点过期。</span></div>
              <div className={styles.timelineItem}><strong>再补薄弱专题</strong><span>从未掌握标签和关注专题交集中选择。</span></div>
              <div className={styles.timelineItem}><strong>最后平衡难度</strong><span>按 {ratio.easy}:{ratio.medium}:{ratio.hard} 调整新题结构。</span></div>
            </div>
          </div>
        </section>
      </div>
      <section className={styles.section} style={{ marginTop: 34 }}>
        <SectionHeader title="今日任务单" meta={`${current?.completedProblemIds.length ?? 0}/${current?.targetProblems ?? targetProblems}`} />
        {tasks.map((problem, index) => problem && <div className={styles.row} key={problem.id}><div className={styles.rowMain}><strong>{String(index + 1).padStart(2, '0')} · {problem.title}</strong><p>{problem.kind === 'interview' ? '面试题' : '算法题'} · {problem.tags.slice(0, 3).join(' / ') || '综合训练'}</p></div><div className={styles.rowActions}>{current?.completedProblemIds.includes(problem.id) ? <span className={`${styles.badge} ${styles.badgeAccent}`}><Check size={12} />完成</span> : <button className="button" type="button" onClick={() => navigate(learningRoute(problem))}>开始</button>}</div></div>)}
        {!tasks.length && <EmptyState title="任务单还未生成" message="保存目标后生成任务；题库数量不足时会保留已有题目并提示补充。" action={<button className="button buttonAccent" type="button" onClick={generate}>生成任务</button>} />}
      </section>
    </>
  );
}
