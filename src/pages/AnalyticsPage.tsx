import { useMemo } from 'react';
import { BarChart3, Lightbulb, TimerReset, TrendingUp } from 'lucide-react';
import { formatDuration, todayKey, useStoreView } from '../app/storeAdapter';
import { EmptyState, Metric, PageHeader, SectionHeader } from '../components/PagePrimitives';
import { INTERVIEW_ROLES } from '../lib/interviews';
import { calculateInterviewStatistics, calculateStatistics } from '../lib/statistics';
import styles from './Pages.module.css';

export function AnalyticsPage() {
  const store = useStoreView();
  const algorithmStatistics = calculateStatistics(store.problems, store.attempts, store.mistakes);
  const interviewStatistics = calculateInterviewStatistics(store.problems, store.attempts, store.mistakes);
  const completed = store.attempts.filter((item) => item.mode === 'code' && item.result !== 'unfinished');
  const passed = completed.filter((item) => item.result === 'sample-passed' || item.result === 'accepted');
  const accuracy = completed.length ? Math.round((passed.length / completed.length) * 100) : 0;
  const avgSeconds = completed.length ? completed.reduce((sum, item) => sum + item.durationSeconds, 0) / completed.length : 0;
  const avgHint = completed.length ? completed.reduce((sum, item) => sum + ('hintLevel' in item && typeof item.hintLevel === 'number' ? item.hintLevel : 0), 0) / completed.length : 0;

  const weekly = useMemo(() => Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    const key = todayKey(date);
    const items = store.attempts.filter((attempt) => todayKey(new Date(attempt.startedAt)) === key);
    return { label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date), value: Math.round(items.reduce((sum, item) => sum + item.durationSeconds, 0) / 60) };
  }), [store.attempts]);
  const maxWeekly = Math.max(1, ...weekly.map((item) => item.value));

  const categoryCounts = useMemo(() => Object.entries(store.mistakes.reduce<Record<string, number>>((result, item) => ({ ...result, [item.category]: (result[item.category] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]), [store.mistakes]);
  const maxCategory = Math.max(1, ...categoryCounts.map((item) => item[1]));
  const categoryLabel: Record<string, string> = { concept: '概念理解', implementation: '实现错误', boundary: '边界遗漏', complexity: '复杂度', reading: '读题偏差', incomplete: '回答不完整', unclear: '表达不清', 'no-example': '缺少案例', other: '其他' };
  const roleLabel = (role: string) => INTERVIEW_ROLES.find((item) => item.id === role)?.label ?? role;
  const maxWeakRole = Math.max(1, ...interviewStatistics.weakRoles.map((item) => item.score));
  const hasPractice = algorithmStatistics.totalAttempts + interviewStatistics.totalAttempts > 0;

  return (
    <>
      <PageHeader eyebrow="学习统计" title="看见进步，也看见惯性。" description="只统计实际练习和复习记录。样例结果与官方判题分开，不会混淆通过率。" />
      <div className={styles.metrics}>
        <Metric label="算法通过率" value={`${accuracy}%`} detail={`${passed.length}/${completed.length} 次已结束尝试`} tone="accent" />
        <Metric label="算法平均用时" value={formatDuration(avgSeconds)} detail={`平均提示 ${avgHint.toFixed(1)} 级`} />
        <Metric label="面试掌握率" value={`${Math.round(interviewStatistics.masteryRate * 100)}%`} detail={`${interviewStatistics.masteredQuestions}/${interviewStatistics.practicedQuestions} 题已掌握`} tone="info" />
        <Metric label="面试练习" value={interviewStatistics.totalAttempts} detail={`${interviewStatistics.dueReviews} 项到期复习`} />
      </div>
      {!hasPractice ? <EmptyState title="还没有可统计的练习" message="完成一轮计时练习和复盘后，这里会生成真实趋势。" /> : (
        <div className={`${styles.twoColumn} ${styles.balanced}`}>
          <section className={styles.paperPanel}>
            <SectionHeader title="近 7 日专注" meta="分钟" action={<TimerReset size={17} color="var(--muted)" />} />
            <div className={styles.chart} style={{ marginTop: 22 }}>{weekly.map((item) => <div className={styles.barRow} key={item.label}><span>{item.label}</span><div className={styles.barTrack}><span style={{ width: `${(item.value / maxWeekly) * 100}%` }} /></div><strong>{item.value}</strong></div>)}</div>
          </section>
          <section className={styles.paperPanel}>
            <SectionHeader title="错因分布" meta="按错题记录" action={<BarChart3 size={17} color="var(--muted)" />} />
            <div className={styles.chart} style={{ marginTop: 22 }}>{categoryCounts.map(([category, count]) => <div className={styles.barRow} key={category}><span>{categoryLabel[category] ?? category}</span><div className={styles.barTrack}><span style={{ width: `${(count / maxCategory) * 100}%` }} /></div><strong>{count}</strong></div>)}</div>
            {!categoryCounts.length && <EmptyState compact title="暂无错因数据" message="练习复盘后会显示主要问题分布。" />}
          </section>
        </div>
      )}
      <section className={styles.section} style={{ marginTop: 34 }}>
        <SectionHeader title="薄弱岗位" meta="按未掌握率排序" />
        <div className={styles.chart} style={{ marginTop: 18 }}>
          {interviewStatistics.weakRoles.slice(0, 8).map((item) => (
            <div className={styles.barRow} key={item.role}>
              <span>{roleLabel(item.role)}</span>
              <div className={styles.barTrack}><span style={{ width: `${Math.max(4, (item.score / maxWeakRole) * 100)}%` }} /></div>
              <strong>{Math.round(item.score * 100)}%</strong>
            </div>
          ))}
          {!interviewStatistics.weakRoles.length && <EmptyState compact title="暂无岗位练习数据" message="完成面试题并选择掌握度后，这里会识别需要加强的岗位方向。" />}
        </div>
      </section>
      <section className={styles.section} style={{ marginTop: 34 }}>
        <SectionHeader title="当前观察" meta="基于本地记录" />
        <div className={`${styles.twoColumn} ${styles.balanced}`} style={{ marginTop: 18 }}>
          <div className={styles.notice} style={{ margin: 0 }}><TrendingUp size={18} /><span>{weekly.slice(-3).reduce((sum, item) => sum + item.value, 0) > weekly.slice(0, 3).reduce((sum, item) => sum + item.value, 0) ? '最近三天的练习时长正在上升，保持当前节奏。' : '最近三天的投入有所回落，可以把目标拆成一题一复盘。'}</span></div>
          <div className={styles.notice} style={{ margin: 0 }}><Lightbulb size={18} /><span>{avgHint > 3 ? '提示依赖偏高，下一题尝试先写出暴力解再请求提示。' : '提示使用克制，继续优先记录自己的关键观察。'}</span></div>
        </div>
      </section>
    </>
  );
}
