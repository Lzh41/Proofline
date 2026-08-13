import { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, Check, Clock3, Play, RotateCcw, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDuration, todayKey, useStoreView } from '../app/storeAdapter';
import { EmptyState, Metric, PageHeader, ProgressBar, SectionHeader } from '../components/PagePrimitives';
import { learningRoute } from '../lib/interviews';
import styles from './Pages.module.css';

export function TodayPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const today = todayKey();
  const plan = store.dailyPlans.find((item) => item.date === today);
  const dueMistakes = useMemo(
    () => store.mistakes.filter((item) => item.status !== 'mastered' && item.nextReviewAt <= Date.now()),
    [store.mistakes],
  );
  const todayAttempts = useMemo(
    () => store.attempts.filter((item) => todayKey(new Date(item.startedAt)) === today),
    [store.attempts, today],
  );
  const algorithmToday = todayAttempts.filter((item) => item.mode === 'code' && (item.result === 'sample-passed' || item.result === 'accepted')).length;
  const interviewToday = todayAttempts.filter((item) => item.mode === 'interview' && item.result !== 'unfinished').length;
  const secondsToday = todayAttempts.reduce((sum, item) => sum + item.durationSeconds, 0);
  const tasks = (plan?.taskProblemIds ?? []).map((id) => store.problems.find((item) => item.id === id)).filter(Boolean);
  const progress = plan?.targetProblems ? ((plan.completedProblemIds?.length ?? 0) / plan.targetProblems) * 100 : 0;

  const generatePlan = async () => {
    if (!store.generateDailyPlan) {
      navigate('/plan');
      return;
    }
    await store.generateDailyPlan();
    setMessage('今日任务已经根据到期复习和薄弱标签重新安排。');
  };

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
        title="今天，稳稳推进。"
        description="先清理到期复习，再处理计划中的新题。每次尝试都会沉淀成你的解题记忆。"
        actions={
          <>
            <button className="button" type="button" onClick={() => navigate('/plan')}><CalendarClock size={16} />调整计划</button>
            <button className="button buttonPrimary" type="button" onClick={() => navigate(tasks[0] ? learningRoute(tasks[0]) : '/problems')}><Play size={16} />开始学习</button>
          </>
        }
      />

      {message && <div className={styles.notice}><Check size={17} />{message}</div>}

      <div className={styles.metrics}>
        <Metric label="算法完成" value={`${algorithmToday} 题`} detail={`目标 ${plan?.targetAlgorithmProblems ?? store.settings.dailyTargetProblems ?? 3} 题`} tone="accent" />
        <Metric label="面试练习" value={`${interviewToday} 题`} detail={`目标 ${plan?.targetInterviewQuestions ?? store.settings.dailyTargetInterviewQuestions ?? 2} 题`} tone="info" />
        <Metric label="到期复习" value={`${dueMistakes.length} 题`} detail={dueMistakes.length ? '建议优先完成' : '今日复习已清空'} tone={dueMistakes.length ? 'danger' : 'default'} />
        <Metric label="专注时间" value={formatDuration(secondsToday)} detail={`目标 ${plan?.targetMinutes ?? store.settings.dailyTargetMinutes ?? 60} 分钟`} />
      </div>

      <div className={styles.twoColumn}>
        <section className={styles.section}>
          <SectionHeader title="今日任务" meta={plan ? `${plan.completedProblemIds.length}/${plan.targetProblems}` : '尚未排程'} action={<button className="button" type="button" onClick={generatePlan}><RotateCcw size={15} />智能排程</button>} />
          {plan && <div style={{ padding: '18px 0 8px' }}><ProgressBar value={progress} label="计划完成度" /></div>}
          <div className={styles.list}>
            {tasks.length === 0 ? (
              <EmptyState title="今天还没有题目" message="按到期复习、薄弱标签和难度比例生成一份可执行计划。" action={<button className="button buttonAccent" type="button" onClick={generatePlan}>生成今日计划</button>} />
            ) : tasks.map((problem, index) => problem && (
              <div className={styles.row} key={problem.id}>
                <div className={styles.rowMain}>
                  <strong>{String(index + 1).padStart(2, '0')} · {problem.title}</strong>
                  <p>{problem.tags.slice(0, 3).join(' / ') || '待补充知识标签'}</p>
                </div>
                <div className={styles.rowActions}>
                  {plan?.completedProblemIds.includes(problem.id) ? <span className={`${styles.badge} ${styles.badgeAccent}`}><Check size={12} />已完成</span> : <button className="button" type="button" onClick={() => navigate(learningRoute(problem))}>进入题目<ArrowRight size={14} /></button>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside>
          <section className={styles.section}>
            <SectionHeader title="到期复习" meta={`${dueMistakes.length} 项`} />
            {dueMistakes.slice(0, 4).map((mistake) => {
              const problem = store.problems.find((item) => item.id === mistake.problemId);
              return (
                <div className={styles.row} key={mistake.id}>
                  <div className={styles.rowMain}>
                    <strong>{problem?.title ?? '关联题目'}</strong>
                    <p>{mistake.nextChecklistItem || mistake.rootCause}</p>
                  </div>
                  <button className="iconButton" type="button" title="开始复习" aria-label={`复习 ${problem?.title ?? '题目'}`} onClick={() => problem && navigate(`${learningRoute(problem)}?review=${mistake.id}`)}><Target size={16} /></button>
                </div>
              );
            })}
            {dueMistakes.length === 0 && <EmptyState compact title="没有到期复习" message="下一次复习会按 1、3、7、14、30 天间隔出现。" />}
          </section>
          <div className={styles.accentPanel}>
            <Clock3 size={20} color="var(--accent)" />
            <p>最近的练习记录</p>
            <strong>{todayAttempts.length ? formatDuration(todayAttempts[0]?.durationSeconds) : '从第一题开始'}</strong>
            <p>{todayAttempts[0] ? '上一次尝试已经写入思路回放，可随时继续复盘。' : '打开官方平台或从题库选择一道题。'}</p>
            <div className={styles.buttonRow}><button className="button buttonAccent" type="button" onClick={() => navigate('/platforms')}>打开刷题平台</button></div>
          </div>
        </aside>
      </div>
    </>
  );
}
