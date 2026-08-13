import { useMemo, useState } from 'react';
import { Check, Play, RotateCcw, Search, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStoreView } from '../app/storeAdapter';
import { EmptyState, Metric, PageHeader } from '../components/PagePrimitives';
import { learningRoute } from '../lib/interviews';
import styles from './Pages.module.css';

const CATEGORY: Record<string, string> = { concept: '概念理解', implementation: '实现错误', boundary: '边界遗漏', complexity: '复杂度', reading: '读题偏差', incomplete: '回答不完整', unclear: '表达不清', 'no-example': '缺少案例', other: '其他' };

export function MistakesPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [message, setMessage] = useState('');
  const now = Date.now();
  const filtered = useMemo(() => store.mistakes.filter((mistake) => {
    const problem = store.problems.find((item) => item.id === mistake.problemId);
    const keyword = query.trim().toLowerCase();
    return (!keyword || problem?.title.toLowerCase().includes(keyword) || mistake.rootCause.toLowerCase().includes(keyword))
      && (category === 'all' || mistake.category === category)
      && (status === 'all' || mistake.status === status);
  }), [category, query, status, store.mistakes, store.problems]);

  const review = async (id: string, success: boolean) => {
    await store.completeReview?.(id, success);
    setMessage(success ? '复习结果已记录，下一次间隔已更新。' : '已重置为 1 天后复习。');
  };

  return (
    <>
      <PageHeader eyebrow="错题本" title="不只记错，更要记住为什么错。" description="错因、修正方法和下次检查项共同决定复习内容；复习失败会回到 1 天间隔。" />
      {message && <div className={styles.notice}><Check size={17} />{message}</div>}
      <div className={styles.metrics}>
        <Metric label="活跃错题" value={store.mistakes.filter((item) => item.status === 'active').length} tone="danger" />
        <Metric label="今日到期" value={store.mistakes.filter((item) => item.status !== 'mastered' && item.nextReviewAt <= now).length} tone="accent" />
        <Metric label="复习中" value={store.mistakes.filter((item) => item.status === 'reviewing').length} />
        <Metric label="已经掌握" value={store.mistakes.filter((item) => item.status === 'mastered').length} tone="info" />
      </div>
      <div className={styles.filters} style={{ gridTemplateColumns: 'minmax(220px, 1fr) 180px 180px' }}>
        <label className="field"><span className="srOnly">搜索错题</span><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目或错因" /></div></label>
        <select className="select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="错因分类"><option value="all">全部错因</option>{Object.entries(CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="掌握状态"><option value="all">全部状态</option><option value="active">活跃</option><option value="reviewing">复习中</option><option value="mastered">已掌握</option></select>
      </div>
      <div className={styles.list}>
        {filtered.map((mistake) => {
          const problem = store.problems.find((item) => item.id === mistake.problemId);
          const due = mistake.nextReviewAt <= now;
          return (
            <div className={styles.row} key={mistake.id}>
              <div className={styles.rowMain}>
                <div className={styles.buttonRow}><span className={`${styles.badge} ${due ? styles.badgeDanger : ''}`}>{due ? '今日到期' : `${mistake.intervalDays} 天间隔`}</span><span className={styles.badge}>{CATEGORY[mistake.category] ?? '其他'}</span></div>
                <strong style={{ marginTop: 9 }}>{problem?.title ?? '关联题目已删除'}</strong>
                <p><b>根因：</b>{mistake.rootCause || '尚未补充'}　<b>下次检查：</b>{mistake.nextChecklistItem || '尚未补充'}</p>
              </div>
              <div className={styles.rowActions}>
                <button className="iconButton" type="button" title="重新练习" aria-label={`重新练习 ${problem?.title ?? '题目'}`} onClick={() => problem && navigate(`${learningRoute(problem)}?review=${mistake.id}`)}><Play size={15} /></button>
                {mistake.status !== 'mastered' && <><button className="iconButton" type="button" title="复习失败" aria-label="复习失败" onClick={() => review(mistake.id, false)}><RotateCcw size={15} /></button><button className="button buttonAccent" type="button" onClick={() => review(mistake.id, true)}><Target size={14} />已掌握</button></>}
              </div>
            </div>
          );
        })}
        {!filtered.length && <EmptyState title={store.mistakes.length ? '没有匹配的错题' : '错题本还是空的'} message={store.mistakes.length ? '调整分类或状态筛选。' : '完成练习复盘后，未掌握的题目会自动进入这里。'} />}
      </div>
    </>
  );
}
