import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, Check, Languages, RefreshCw, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DailyPlan } from '../types';
import { VOCABULARY_DIFFICULTY_OPTIONS, type VocabularyDifficulty, type VocabularyWord } from '../lib/vocabulary';
import { todayKey, useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader, ProgressBar, SectionHeader } from '../components/PagePrimitives';
import { learningRoute } from '../lib/interviews';
import styles from './Pages.module.css';

export function PlanPage() {
  const store = useStoreView();
  const navigate = useNavigate();
  const date = todayKey();
  const initialScope = store.settings.lastVocabularyDifficulty
    ?? store.dailyPlans.find((item) => item.date === date)?.vocabularyDifficulty
    ?? 'all';
  const [vocabularyDifficulty, setVocabularyDifficulty] = useState<VocabularyDifficulty | 'all'>(initialScope);
  const current = store.dailyPlans.find((item) => item.date === date && item.vocabularyDifficulty === vocabularyDifficulty);
  const [targetMinutes, setTargetMinutes] = useState(String(current?.targetMinutes ?? store.settings.dailyTargetMinutes ?? 60));
  const [targetAlgorithmProblems, setTargetAlgorithmProblems] = useState(String(current?.targetAlgorithmProblems ?? store.settings.dailyTargetProblems ?? 3));
  const [targetInterviewQuestions, setTargetInterviewQuestions] = useState(String(current?.targetInterviewQuestions ?? store.settings.dailyTargetInterviewQuestions ?? 2));
  const [targetVocabularyWords, setTargetVocabularyWords] = useState(String(current?.targetVocabularyWords ?? store.settings.dailyTargetVocabularyWords ?? 10));
  const [targetError, setTargetError] = useState('');
  const [focusTags, setFocusTags] = useState((current?.focusTags ?? []).join('，'));
  const [ratio, setRatio] = useState(current?.difficultyRatio ?? { easy: 30, medium: 50, hard: 20 });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (store.settings.lastVocabularyDifficulty && store.settings.lastVocabularyDifficulty !== vocabularyDifficulty) {
      setVocabularyDifficulty(store.settings.lastVocabularyDifficulty);
    }
  }, [store.settings.lastVocabularyDifficulty]);

  useEffect(() => {
    setTargetMinutes(String(current?.targetMinutes ?? store.settings.dailyTargetMinutes ?? 60));
    setTargetAlgorithmProblems(String(current?.targetAlgorithmProblems ?? store.settings.dailyTargetProblems ?? 3));
    setTargetInterviewQuestions(String(current?.targetInterviewQuestions ?? store.settings.dailyTargetInterviewQuestions ?? 2));
    setTargetVocabularyWords(String(current?.targetVocabularyWords ?? store.settings.dailyTargetVocabularyWords ?? 10));
    setFocusTags((current?.focusTags ?? []).join('，'));
    setRatio(current?.difficultyRatio ?? { easy: 30, medium: 50, hard: 20 });
  }, [current?.id, store.settings.dailyTargetInterviewQuestions, store.settings.dailyTargetMinutes, store.settings.dailyTargetProblems, store.settings.dailyTargetVocabularyWords, vocabularyDifficulty]);

  const tasks = useMemo(() => (current?.taskProblemIds ?? []).map((id) => store.problems.find((problem) => problem.id === id)).filter(Boolean), [current?.taskProblemIds, store.problems]);
  const vocabularyTasks = useMemo(() => (current?.taskVocabularyWordIds ?? []).map((id) => store.vocabularyWords.find((word) => word.id === id)).filter((word): word is VocabularyWord => word !== undefined), [current?.taskVocabularyWordIds, store.vocabularyWords]);
  const vocabularyPreviewedWordIds = current?.vocabularyPreviewedWordIds ?? [];
  const vocabularyUnfamiliarWordIds = current?.vocabularyUnfamiliarWordIds ?? [];
  const vocabularyExtraWordIds = current?.vocabularyExtraWordIds ?? [];
  const totalRatio = ratio.easy + ratio.medium + ratio.hard;
  const parsedTargets = {
    minutes: Number(targetMinutes),
    algorithm: Number(targetAlgorithmProblems),
    interview: Number(targetInterviewQuestions),
    vocabulary: Number(targetVocabularyWords),
  };
  const targetProblems = parsedTargets.algorithm + parsedTargets.interview;

  const validateTargets = () => {
    const valid = Number.isInteger(parsedTargets.minutes) && parsedTargets.minutes >= 10 && parsedTargets.minutes <= 480
      && Number.isInteger(parsedTargets.algorithm) && parsedTargets.algorithm >= 0 && parsedTargets.algorithm <= 30
      && Number.isInteger(parsedTargets.interview) && parsedTargets.interview >= 0 && parsedTargets.interview <= 30
      && Number.isInteger(parsedTargets.vocabulary) && parsedTargets.vocabulary >= 0 && parsedTargets.vocabulary <= 100;
    setTargetError(valid ? '' : '请输入有效的整数目标：时长 10-480 分钟，题目目标 0-30，新词目标 0-100。');
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
      targetVocabularyWords: parsedTargets.vocabulary,
      vocabularyDifficulty,
      focusTags: focusTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      difficultyRatio: ratio,
      taskProblemIds: current?.taskProblemIds ?? [],
      completedProblemIds: current?.completedProblemIds ?? [],
      taskVocabularyWordIds: current?.taskVocabularyWordIds ?? [],
      completedVocabularyWordIds: current?.completedVocabularyWordIds ?? [],
      vocabularyPreviewedWordIds,
      vocabularyUnfamiliarWordIds,
      vocabularyExtraWordIds,
    };
    await store.savePlan?.(plan);
    await store.updateSettings?.({
      dailyTargetMinutes: parsedTargets.minutes,
      dailyTargetProblems: parsedTargets.algorithm,
      dailyTargetInterviewQuestions: parsedTargets.interview,
      dailyTargetVocabularyWords: parsedTargets.vocabulary,
      lastVocabularyDifficulty: vocabularyDifficulty,
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
    await store.generateDailyPlan?.({ date, targetMinutes: parsedTargets.minutes, targetAlgorithmProblems: parsedTargets.algorithm, targetInterviewQuestions: parsedTargets.interview, targetVocabularyWords: parsedTargets.vocabulary, vocabularyDifficulty, focusTags: focusTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), difficultyRatio: ratio });
    setMessage('今日词汇与题目任务已生成；到期单词复习不会占用新词目标。');
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
            <label className="field"><span>每日新词目标</span><input className="input" type="number" min={0} max={100} value={targetVocabularyWords} onChange={(event) => { setTargetVocabularyWords(event.target.value); setTargetError(''); }} /></label>
            <label className="field"><span>词汇方向</span><select className="select" value={vocabularyDifficulty} onChange={(event) => setVocabularyDifficulty(event.target.value as VocabularyDifficulty | 'all')}><option value="all">全部难度</option>{VOCABULARY_DIFFICULTY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
      <section className={styles.section}>
        <SectionHeader title="今日新词预览" meta={`${vocabularyPreviewedWordIds.length}/${vocabularyTasks.length} 已预览 · ${current?.completedVocabularyWordIds.length ?? 0}/${current?.targetVocabularyWords ?? parsedTargets.vocabulary} 已完成`} action={<button className="button buttonPrimary" type="button" onClick={() => navigate('/vocabulary')}><Languages size={15} />开始刷词</button>} />
        {vocabularyTasks.length > 0 && <p style={{ margin: '8px 0 14px', color: 'var(--muted)' }}>先看英词、音标和中文义项，再进入主动拼写；不熟悉的词会自动加入明日额外复习。</p>}
        {vocabularyTasks.map((word) => {
          const completed = current?.completedVocabularyWordIds.includes(word.id) ?? false;
          const previewed = vocabularyPreviewedWordIds.includes(word.id);
          const unfamiliar = vocabularyUnfamiliarWordIds.includes(word.id);
          const extra = vocabularyExtraWordIds.includes(word.id);
          return <div className={styles.row} key={word.id}>
            <div className={styles.rowMain}>
              <strong>{word.word}<span className={styles.vocabularyPlanMeta}> · {word.phonetic} · {word.level} · {word.meaning}</span></strong>
              <p>{word.example || '遮住中文义项，先回忆这个词的意思和用法。'}</p>
            </div>
            <div className={styles.rowActions}>
              {extra && <span className={styles.badge}>明日额外</span>}
              {completed && <span className={`${styles.badge} ${styles.badgeAccent}`}><Check size={12} />完成</span>}
              {!completed && <button className="button" type="button" onClick={() => void store.markVocabularyPreviewed?.(word.id, date, vocabularyDifficulty)}>{previewed ? '已预览' : '标记已背'}</button>}
              {!completed && <button className={`button${unfamiliar ? ' buttonDanger' : ''}`} type="button" aria-pressed={unfamiliar} onClick={() => void (unfamiliar ? store.unmarkVocabularyUnfamiliar?.(word.id, date, vocabularyDifficulty) : store.markVocabularyUnfamiliar?.(word.id, date, vocabularyDifficulty))}>{unfamiliar ? '取消不熟' : '标记不熟'}</button>}
            </div>
          </div>;
        })}
        {!vocabularyTasks.length && <EmptyState compact title="还没有今日新词" message="设定每日数量和难度后生成今日任务；到期复习会在刷词时优先出现。" action={<button className="button" type="button" onClick={() => navigate('/vocabulary')}>浏览词库</button>} />}
      </section>
    </>
  );
}
