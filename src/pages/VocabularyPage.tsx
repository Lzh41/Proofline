import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, RotateCcw, Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { todayKey, useStoreView } from '../app/storeAdapter';
import { EmptyState, ProgressBar, SectionHeader } from '../components/PagePrimitives';
import { rememberVocabularyDifficulty, writeVocabularySessionJournal } from '../lib/vocabularySessionJournal';
import {
  difficultyLabel,
  filterVocabularyWords,
  isVocabularySpellingCorrect,
  selectDueVocabularyWords,
  selectNewVocabularyWords,
  VOCABULARY_DIFFICULTY_OPTIONS,
  type VocabularyDifficulty,
  type VocabularyGrade,
  type VocabularyReviewDirection,
  type VocabularyScope,
  type VocabularySessionState,
  type VocabularyWord,
} from '../lib/vocabulary';
import styles from './Pages.module.css';

type PageMode = 'practice' | 'library';
type WordStatusFilter = 'all' | 'new' | 'learning' | 'mastered';
type SessionCard = { word: VocabularyWord; direction: VocabularyReviewDirection; retry?: boolean };

const GRADES: Array<{ value: VocabularyGrade; label: string; detail: string; points: number }> = [
  { value: 'again', label: '忘了', detail: '10 分钟后再见', points: 0 },
  { value: 'hard', label: '很难', detail: '1 天后', points: 2 },
  { value: 'good', label: '记得', detail: '按间隔复习', points: 4 },
  { value: 'easy', label: '轻松', detail: '延长间隔', points: 5 },
];

export function VocabularyPage() {
  const store = useStoreView();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayKey();
  const [mode, setMode] = useState<PageMode>('practice');
  const initialScope = (store.settings.lastVocabularyDifficulty
    ?? store.dailyPlans.find((item) => item.date === today)?.vocabularyDifficulty
    ?? 'all') as VocabularyScope;
  const [difficulty, setDifficulty] = useState<VocabularyScope>(initialScope);
  const plan = store.dailyPlans.find((item) => item.date === today && item.vocabularyDifficulty === difficulty);
  const [statusFilter, setStatusFilter] = useState<WordStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedWordId, setExpandedWordId] = useState<string | null>(null);
  const [queue, setQueue] = useState<SessionCard[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [phase, setPhase] = useState<'preview' | 'practice'>('practice');
  const [revealed, setRevealed] = useState(false);
  const [answerDraft, setAnswerDraft] = useState('');
  const [cardStartedAt, setCardStartedAt] = useState(Date.now());
  const [sessionPoints, setSessionPoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const wrongSpellingContinueRef = useRef<HTMLButtonElement | null>(null);
  const [loadedSessionScope, setLoadedSessionScope] = useState<VocabularyScope | null>(null);
  const latestSessionRef = useRef<{
    scope: VocabularyScope;
    session: VocabularySessionState;
    ready: boolean;
  } | null>(null);

  const progressByWordId = useMemo(
    () => Object.fromEntries(store.vocabularyProgress.filter((item) => (item.scope ?? 'all') === difficulty).map((item) => [item.wordId, item])),
    [difficulty, store.vocabularyProgress],
  );
  const progressById = useMemo(() => new Map(store.vocabularyProgress.filter((item) => (item.scope ?? 'all') === difficulty).map((item) => [item.wordId, item])), [difficulty, store.vocabularyProgress]);
  const dueWords = useMemo(
    () => selectDueVocabularyWords(store.vocabularyWords, progressByWordId, difficulty),
    [difficulty, progressByWordId, store.vocabularyWords],
  );
  const dueCount = store.vocabularyProgress.filter((item) => (item.scope ?? 'all') === difficulty && item.state !== 'new' && item.dueAt <= Date.now()).length;
  const reviewsToday = store.vocabularyReviews.filter((item) => (item.scope ?? 'all') === difficulty && todayKey(new Date(item.reviewedAt)) === today).length;
  const targetWords = plan?.targetVocabularyWords ?? store.settings.dailyTargetVocabularyWords ?? 10;
  const completedNewWords = plan?.completedVocabularyWordIds.length ?? 0;
  const nextCard = queue[queueIndex];
  const sessionScopeLoaded = loadedSessionScope === difficulty;
  const activeWord = sessionScopeLoaded && phase === 'practice' ? nextCard?.word : undefined;
  const activeProgress = activeWord ? progressById.get(activeWord.id) : undefined;
  const activeIsNew = !activeProgress || activeProgress.state === 'new';
  const spellingMatches = !activeWord || nextCard?.direction !== 'meaning-to-word'
    || isVocabularySpellingCorrect(answerDraft, activeWord.word);
  const wordFromUrl = searchParams.get('word');

  useEffect(() => {
    if (!wordFromUrl) return;
    const word = store.vocabularyWords.find((item) => item.id === wordFromUrl);
    if (!word) return;
    setMode('practice');
    setQueue([{ word, direction: 'meaning-to-word' }]);
    setQueueIndex(0);
    setPhase('practice');
    setRevealed(false);
    setAnswerDraft('');
    setCardStartedAt(Date.now());
    setSessionPoints(0);
    setSearchParams({}, { replace: true });
  }, [setSearchParams, store.vocabularyWords, wordFromUrl]);

  useEffect(() => {
    if (store.settings.lastVocabularyDifficulty) setDifficulty(store.settings.lastVocabularyDifficulty);
  }, [store.settings.lastVocabularyDifficulty]);

  useEffect(() => {
    if (!store.initialized) return;
    const saved = store.settings.vocabularySessions?.[difficulty];
    const wordsById = new Map(store.vocabularyWords.map((word) => [word.id, word]));
    const restoredQueue = (saved?.cards ?? [])
      .map((card): SessionCard | null => {
        const word = wordsById.get(card.wordId);
        return word ? { word, direction: card.direction, retry: card.retry } : null;
      })
      .filter((card): card is SessionCard => card !== null);
    setQueue(restoredQueue);
    setQueueIndex(Math.min(saved?.index ?? 0, restoredQueue.length));
    setPhase(saved?.phase ?? 'practice');
    setRevealed(saved?.revealed ?? false);
    setAnswerDraft(saved?.answerDraft ?? '');
    setSessionPoints(saved?.sessionPoints ?? 0);
    setCardStartedAt(Date.now());
    setLoadedSessionScope(difficulty);
  }, [difficulty, store.initialized, store.vocabularyWords]);

  useEffect(() => {
    if (!store.initialized || loadedSessionScope !== difficulty) return;
    writeVocabularySessionJournal(difficulty, {
      cards: queue.map((card) => ({ wordId: card.word.id, direction: card.direction, retry: card.retry })),
      index: queueIndex,
      phase,
      revealed,
      answerDraft,
      sessionPoints,
    });
  }, [answerDraft, difficulty, loadedSessionScope, phase, queue, queueIndex, revealed, sessionPoints, store.initialized]);

  useEffect(() => {
    if (!store.initialized || loadedSessionScope !== difficulty || !store.saveVocabularySession) return;
    const session: VocabularySessionState = {
      cards: queue.map((card) => ({ wordId: card.word.id, direction: card.direction, retry: card.retry })),
      index: queueIndex,
      phase,
      revealed,
      answerDraft,
      sessionPoints,
    };
    latestSessionRef.current = { scope: difficulty, session, ready: true };
    const timeout = window.setTimeout(() => {
      void Promise.resolve(store.saveVocabularySession?.(difficulty, session)).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [answerDraft, difficulty, loadedSessionScope, phase, queue, queueIndex, revealed, sessionPoints, store.initialized, store.saveVocabularySession]);

  latestSessionRef.current = {
    scope: difficulty,
    session: {
      cards: queue.map((card) => ({ wordId: card.word.id, direction: card.direction, retry: card.retry })),
      index: queueIndex,
      phase,
      revealed,
      answerDraft,
      sessionPoints,
    },
    ready: store.initialized === true && loadedSessionScope === difficulty,
  };

  useEffect(() => {
    const flushLatestSession = () => {
      const latest = latestSessionRef.current;
      if (!latest?.ready || !store.saveVocabularySession) return;
      writeVocabularySessionJournal(latest.scope, latest.session);
      void Promise.resolve(store.saveVocabularySession(latest.scope, latest.session)).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    };
    window.addEventListener('pagehide', flushLatestSession);
    window.addEventListener('beforeunload', flushLatestSession);
    return () => {
      window.removeEventListener('pagehide', flushLatestSession);
      window.removeEventListener('beforeunload', flushLatestSession);
      flushLatestSession();
    };
  }, [store.saveVocabularySession]);

  const filteredWords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return filterVocabularyWords(store.vocabularyWords, difficulty).filter((word) => {
      const progress = progressById.get(word.id);
      const status = progress?.state ?? 'new';
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'new' && status === 'new')
        || (statusFilter === 'learning' && status !== 'new' && status !== 'mastered')
        || (statusFilter === 'mastered' && status === 'mastered');
      const searchMatches = !needle || [
        word.word,
        word.meaning,
        word.definitionEn,
        word.example,
        word.exampleTranslation,
        ...word.collocations,
        ...word.family,
      ].join(' ').toLocaleLowerCase().includes(needle);
      return statusMatches && searchMatches;
    });
  }, [difficulty, progressById, query, statusFilter, store.vocabularyWords]);

  const startSession = async () => {
    setBusy(true);
    setMessage('');
    try {
      const generated = await store.generateDailyPlan?.({ targetVocabularyWords: targetWords, vocabularyDifficulty: difficulty });
      const activePlan = generated && 'taskVocabularyWordIds' in generated
        ? generated
        : store.dailyPlans.find((item) => item.date === today && item.vocabularyDifficulty === difficulty);
      const completed = new Set(activePlan?.completedVocabularyWordIds ?? []);
      const nextProgress = Object.fromEntries(store.vocabularyProgress.filter((item) => (item.scope ?? 'all') === difficulty).map((item) => [item.wordId, item]));
      const due = selectDueVocabularyWords(store.vocabularyWords, nextProgress, difficulty);
      const plannedNew = (activePlan?.taskVocabularyWordIds ?? [])
        .filter((wordId) => !completed.has(wordId))
        .map((wordId) => store.vocabularyWords.find((word) => word.id === wordId))
        .filter((word): word is VocabularyWord => word !== undefined);
      const fallbackNew = plannedNew.length ? plannedNew : selectNewVocabularyWords(
        store.vocabularyWords,
        nextProgress,
        difficulty,
        Math.max(0, targetWords - (activePlan?.completedVocabularyWordIds.length ?? 0)),
      );
      const reviewCards = due.map((word): SessionCard => ({ word, direction: 'word-to-meaning' }));
      const newCards = fallbackNew
        .filter((word) => !due.some((item) => item.id === word.id))
        .map((word): SessionCard => ({ word, direction: 'meaning-to-word' }));
      const nextQueue = [...reviewCards, ...newCards];
      if (!nextQueue.length) {
        setQueue([]);
        setQueueIndex(0);
        setPhase('practice');
        setMessage(difficulty === 'all' ? '没有到期单词，也没有尚未学习的新词。' : `${difficultyLabel(difficulty)}词目已全部排入或学完，换个难度再试试。`);
      } else {
        setQueue(nextQueue);
        setQueueIndex(0);
        setPhase('preview');
        setRevealed(false);
        setAnswerDraft('');
        setCardStartedAt(Date.now());
        setSessionPoints(0);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitGrade = async (grade: VocabularyGrade) => {
    if (!activeWord || !store.recordVocabularyReview) return;
    setBusy(true);
    const correct = grade !== 'again' && spellingMatches;
    try {
      await store.recordVocabularyReview({
        wordId: activeWord.id,
        scope: difficulty,
        direction: nextCard.direction,
        rating: grade,
        response: answerDraft,
        correct,
        durationMs: Math.max(0, Date.now() - cardStartedAt),
      });
      setSessionPoints((points) => points + (correct ? GRADES.find((item) => item.value === grade)?.points ?? 0 : 0));
      setQueueIndex((index) => index + 1);
      setRevealed(false);
      setAnswerDraft('');
      setCardStartedAt(Date.now());
      if (!spellingMatches) setMessage('拼写还没对上标准答案；本次按“忘了”处理，10 分钟后再试。');
      else setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submitSpellingAnswer = async () => {
    if (!activeWord || nextCard.direction !== 'meaning-to-word' || !store.recordVocabularyReview || busy) return;
    const correct = isVocabularySpellingCorrect(answerDraft, activeWord.word);
    setBusy(true);
    try {
      await store.recordVocabularyReview({
        wordId: activeWord.id,
        scope: difficulty,
        direction: nextCard.direction,
        rating: correct ? 'good' : 'again',
        response: answerDraft,
        correct,
        durationMs: Math.max(0, Date.now() - cardStartedAt),
      });
      if (correct) {
        setSessionPoints((points) => points + (GRADES.find((item) => item.value === 'good')?.points ?? 0));
        setQueueIndex((index) => index + 1);
        setRevealed(false);
        setAnswerDraft('');
        setCardStartedAt(Date.now());
        setMessage('回答正确，继续下一词。');
        return;
      }

      if (!nextCard.retry) {
        setQueue((items) => [...items, { word: activeWord, direction: nextCard.direction, retry: true }]);
      }
      setRevealed(true);
      setMessage(nextCard.retry ? '这次仍未拼对，先看答案；继续后会按队列进行。' : '这次未拼对，标准答案已显示，并已安排到本轮末尾再做。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const continueAfterSpellingMistake = () => {
    setQueueIndex((index) => index + 1);
    setRevealed(false);
    setAnswerDraft('');
    setCardStartedAt(Date.now());
    setMessage('继续下一词。');
  };

  const wrongSpellingFeedbackVisible = revealed
    && nextCard?.direction === 'meaning-to-word'
    && !spellingMatches;

  useEffect(() => {
    if (wrongSpellingFeedbackVisible && !busy) wrongSpellingContinueRef.current?.focus();
  }, [busy, wrongSpellingFeedbackVisible]);

  const practiceWord = (word: VocabularyWord) => {
    setQueue([{ word, direction: 'meaning-to-word' }]);
    setQueueIndex(0);
    setPhase('practice');
    setRevealed(false);
    setAnswerDraft('');
    setCardStartedAt(Date.now());
    setSessionPoints(0);
    setMode('practice');
  };

  const completedSession = queue.length > 0 && queueIndex >= queue.length;
  const previewingSession = sessionScopeLoaded && phase === 'preview' && queue.length > 0;
  const beginPractice = () => {
    setPhase('practice');
    setQueueIndex(0);
    setRevealed(false);
    setAnswerDraft('');
    setCardStartedAt(Date.now());
    setMessage('');
  };

  const difficultyOptions = ['all', ...VOCABULARY_DIFFICULTY_OPTIONS.map((option) => option.value)] as const;
  const changeDifficulty = (next: VocabularyScope) => {
    setDifficulty(next);
    rememberVocabularyDifficulty(next);
    void store.updateSettings?.({ lastVocabularyDifficulty: next });
  };

  return (
    <div className={styles.vocabularyPage}>
      {message && <div className={styles.notice}><CircleHelp size={16} />{message}</div>}

      <div className={styles.vocabularyToolbar}>
        <div className={styles.modeTabs} role="tablist" aria-label="词汇视图">
          <button className={`button ${mode === 'practice' ? 'buttonPrimary' : ''}`} type="button" role="tab" aria-selected={mode === 'practice'} onClick={() => setMode('practice')}><RotateCcw size={15} />刷词</button>
          <button className={`button ${mode === 'library' ? 'buttonPrimary' : ''}`} type="button" role="tab" aria-selected={mode === 'library'} onClick={() => setMode('library')}><BookOpen size={15} />词库</button>
        </div>
        <div className={styles.vocabularyDifficulty} role="group" aria-label="按难度筛选">
          {difficultyOptions.map((option) => (
            <button className={difficulty === option ? styles.vocabularyDifficultyActive : ''} type="button" key={option} aria-pressed={difficulty === option} onClick={() => changeDifficulty(option)}>
              {option === 'all' ? '全部' : difficultyLabel(option)}
            </button>
          ))}
        </div>
      </div>

      {mode === 'practice' && (
        <div className={styles.vocabularyPracticeLayout}>
          <section className={styles.paperPanel}>
            <SectionHeader title={!sessionScopeLoaded ? '正在恢复学习进度' : previewingSession ? '本轮背诵准备' : activeWord ? `本轮 ${queueIndex + 1} / ${queue.length}` : completedSession ? '本轮完成' : '今日安排'} meta={!sessionScopeLoaded ? '' : previewingSession ? `${queue.length} 个单词` : activeWord ? activeIsNew ? '新词' : '到期复习' : `${dueWords.length} 个到期`} />
            {!sessionScopeLoaded ? (
              <div className={styles.vocabularySessionRestore} role="status">正在恢复当前考试方向的词单与进度…</div>
            ) : previewingSession ? (
              <div className={styles.vocabularyRoundPreview}>
                <div className={styles.vocabularyRoundPreviewIntro}>
                  <h2>先把本轮单词看一遍</h2>
                  <p>英文、音标和释义都在这里。准备好后再开始回忆。</p>
                </div>
                <ol className={styles.vocabularyRoundPreviewList} aria-label="本轮全部单词">
                  {queue.map((card, index) => {
                    const progress = progressById.get(card.word.id);
                    const tag = card.retry
                      ? '错词重做'
                      : card.direction === 'word-to-meaning'
                        ? '到期复习'
                        : progress && progress.state !== 'new'
                          ? '计划新词'
                          : '今日新词';
                    return (
                      <li className={styles.vocabularyRoundPreviewItem} key={`${card.word.id}-${index}`}>
                        <span className={styles.vocabularyRoundPreviewIndex}>{index + 1}</span>
                        <span className={styles.vocabularyRoundPreviewWord}>
                          <strong>{card.word.word}</strong>
                          <small>{card.word.phonetic} · {card.word.partOfSpeech}</small>
                        </span>
                        <span className={styles.vocabularyRoundPreviewMeaning}>{card.word.meaning}</span>
                        <span className={`${styles.vocabularyRoundPreviewTag} ${card.direction === 'word-to-meaning' ? styles.vocabularyRoundPreviewReview : ''}`}>{tag}</span>
                      </li>
                    );
                  })}
                </ol>
                <div className={styles.vocabularyRoundPreviewFooter}>
                  <span>共 {queue.length} 个词，包含到期复习与今日新词</span>
                  <button className="button buttonPrimary" type="button" disabled={busy} onClick={beginPractice}><ArrowRight size={15} />开始刷词</button>
                </div>
              </div>
            ) : activeWord ? (
              <div className={styles.vocabularySession}>
                <div className={styles.vocabularySessionCard}>
                  <div className={styles.vocabularySessionRail}>
                    <span>{nextCard.direction === 'meaning-to-word' ? '释义 → 拼写' : '单词 → 释义'}</span>
                    <span>{activeWord.level} · {difficultyLabel(activeWord.difficulty)}{nextCard.retry ? ' · 重做' : ''}</span>
                  </div>
                  <div className={styles.vocabularyPrompt}>
                    <span>{nextCard.direction === 'meaning-to-word' ? '试着回忆这个英文单词' : '先想出中文释义，再揭晓'}</span>
                    <strong>{nextCard.direction === 'meaning-to-word' ? activeWord.meaning : activeWord.word}</strong>
                    <small>{activeWord.partOfSpeech} · {activeWord.phonetic || '音标待补充'}</small>
                  </div>
                  {!revealed && nextCard.direction === 'meaning-to-word' && (
                    <div className={styles.vocabularySpellingEntry}>
                      <label className={styles.vocabularyAnswerField}>
                        <span>拼写回忆</span>
                        <input className="input" autoFocus autoComplete="off" autoCapitalize="none" value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitSpellingAnswer(); } }} placeholder="输入英文单词后按 Enter" disabled={busy} />
                      </label>
                      <button className="button buttonAccent" type="button" disabled={busy} onClick={() => { void submitSpellingAnswer(); }}><Check size={15} />检查答案</button>
                    </div>
                  )}
                  {!revealed && nextCard.direction === 'word-to-meaning' && (
                    <button className="button buttonAccent" type="button" onClick={() => setRevealed(true)}><Check size={15} />显示答案</button>
                  )}
                  {revealed && (
                    <div className={styles.vocabularyAnswer}>
                      <div className={styles.vocabularyAnswerSummary}>
                        <div className={styles.vocabularyAnswerHead}><strong>{activeWord.word}</strong><span>{activeWord.phonetic || '暂无音标'}</span><span>{activeWord.meaning}</span></div>
                        {nextCard.direction === 'meaning-to-word' && <p className={spellingMatches ? styles.vocabularyCorrect : styles.vocabularyMismatch} role="status">{spellingMatches ? '拼写正确' : <>你输入的是“{answerDraft || '未填写'}”，正确答案是“{activeWord.word}”。</>}</p>}
                      </div>
                      {activeWord.definitionEn && <p>{activeWord.definitionEn}</p>}
                      {activeWord.example && <blockquote><strong>{activeWord.example}</strong>{activeWord.exampleTranslation && <span>{activeWord.exampleTranslation}</span>}</blockquote>}
                      {(activeWord.collocations.length > 0 || activeWord.family.length > 0) && <div className={styles.vocabularyAnswerColumns}>
                        {activeWord.collocations.length > 0 && <div><small>常见搭配</small><p>{activeWord.collocations.join(' · ')}</p></div>}
                        {activeWord.family.length > 0 && <div><small>词族联想</small><p>{activeWord.family.join(' / ')}</p></div>}
                      </div>}
                      {activeWord.mnemonic && <p className={styles.vocabularyMnemonic}><Sparkles size={14} />{activeWord.mnemonic}</p>}
                      {nextCard.direction === 'meaning-to-word' && !spellingMatches ? (
                        <button ref={wrongSpellingContinueRef} className="button buttonPrimary" type="button" aria-keyshortcuts="Enter" disabled={busy} onClick={continueAfterSpellingMistake} onKeyDown={(event) => {
                          if (event.key !== 'Enter' || busy) return;
                          event.preventDefault();
                          continueAfterSpellingMistake();
                        }}><ArrowRight size={15} />继续，稍后再做</button>
                      ) : nextCard.direction === 'word-to-meaning' ? (
                        <div className={styles.vocabularyGradeRow}>
                          {GRADES.map((grade) => <button className={grade.value === 'again' ? styles.vocabularyGradeAgain : ''} key={grade.value} type="button" disabled={busy} onClick={() => { void submitGrade(grade.value); }}><strong>{grade.label}</strong><small>{grade.detail}</small></button>)}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : completedSession ? (
              <div className={styles.vocabularyComplete}>
                <span className={styles.vocabularyCompleteMark}><Check size={26} /></span>
                <h2>本轮记忆已写入</h2>
                <p>今日已复习 {reviewsToday + queue.length} 次 · 本轮获得 {sessionPoints} 分</p>
                <ProgressBar value={targetWords ? (completedNewWords / targetWords) * 100 : 100} label={`新词目标 ${completedNewWords}/${targetWords}`} />
                <div className={styles.vocabularyCompleteActions}>
                  <button className="button buttonPrimary" type="button" disabled={busy} onClick={() => { void startSession(); }}><RotateCcw size={15} />再开始一轮</button>
                  <button className="button" type="button" onClick={() => setMode('library')}><BookOpen size={15} />回到词库</button>
                </div>
              </div>
            ) : (
              <div className={styles.vocabularyStartPanel}>
                <div className={styles.vocabularyTargetLine}><div><small>今日新词</small><strong>{completedNewWords}<span> / {targetWords}</span></strong></div><div><small>到期复习</small><strong>{dueCount}<span> 个</span></strong></div></div>
                <ProgressBar value={targetWords ? (completedNewWords / targetWords) * 100 : 100} label="新词完成进度" />
                <p>难度：{difficultyLabel(difficulty)} · 本轮先复习到期词，再加入计划中的新词。</p>
                <button className="button buttonPrimary" type="button" disabled={busy} onClick={() => { void startSession(); }}><Sparkles size={16} />开始这一轮<ArrowRight size={15} /></button>
              </div>
            )}
          </section>

          <aside className={styles.vocabularyAside}>
            <section className={styles.section}>
              <SectionHeader title="记忆记录" meta={`${reviewsToday} 次`} />
              <div className={styles.vocabularyAsideMetric}><span>连续答对</span><strong>{activeProgress?.streak ?? 0}</strong><small>再次忘记会重新缩短间隔</small></div>
              <div className={styles.vocabularyAsideMetric}><span>下次复习</span><strong>{activeProgress?.lastReviewedAt ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(activeProgress.dueAt)) : '首次学习'}</strong><small>{activeProgress?.intervalDays ? `当前间隔 ${activeProgress.intervalDays} 天` : '答后按评分安排'}</small></div>
            </section>
            <div className={styles.vocabularyNote}><RotateCcw size={16} /><span>新词看释义回忆拼写，到期复习看单词回忆含义。</span></div>
          </aside>
        </div>
      )}

      {mode === 'library' && (
        <section className={styles.paperPanel}>
          <SectionHeader title="词库" meta={`${filteredWords.length} / ${store.vocabularyWords.length} 个词条`} />
          <div className={styles.vocabularyLibraryTools}>
            <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词、释义或例句" aria-label="搜索词库" />
            <label className="field"><span>掌握状态</span><select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as WordStatusFilter)}><option value="all">全部状态</option><option value="new">尚未学习</option><option value="learning">学习中</option><option value="mastered">已掌握</option></select></label>
          </div>
          <div className={styles.vocabularyWordList}>
            {filteredWords.map((word) => {
              const progress = progressById.get(word.id);
              const status = progress?.state ?? 'new';
              const expanded = expandedWordId === word.id;
              return (
                <article className={styles.vocabularyWordRow} key={word.id}>
                  <button className={styles.vocabularyWordButton} type="button" aria-expanded={expanded} onClick={() => setExpandedWordId(expanded ? null : word.id)}>
                    <span className={styles.vocabularyWordIdentity}><strong>{word.word}</strong><small>{word.phonetic || '音标待补充'} · {word.partOfSpeech}</small></span>
                    <span className={styles.vocabularyWordMeaning}>{word.meaning}</span>
                    <span className={styles.vocabularyWordLevel}>{word.level}</span>
                    <span className={`${styles.vocabularyStatus} ${status === 'mastered' ? styles.vocabularyStatusMastered : status === 'new' ? styles.vocabularyStatusNew : styles.vocabularyStatusLearning}`}>{status === 'mastered' ? '已掌握' : status === 'new' ? '新词' : '复习中'}</span>
                    <ChevronDown className={expanded ? styles.vocabularyChevronOpen : ''} size={16} />
                  </button>
                  {expanded && <div className={styles.vocabularyWordDetail}><p>{word.definitionEn}</p>{word.example && <blockquote>{word.example}{word.exampleTranslation && <span>{word.exampleTranslation}</span>}</blockquote>}{word.collocations.length > 0 && <div><small>搭配</small>{word.collocations.join(' · ')}</div>}{word.family.length > 0 && <div><small>词族</small>{word.family.join(' / ')}</div>}<footer><small>{progress?.lastReviewedAt ? `上次复习 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(progress.lastReviewedAt))}` : `来源：${word.source}`}</small><button className="button" type="button" onClick={() => practiceWord(word)}>练这个词</button></footer></div>}
                </article>
              );
            })}
            {!filteredWords.length && <EmptyState compact title="没有匹配的词条" message="换一个关键词、难度或掌握状态。" />}
          </div>
        </section>
      )}
    </div>
  );
}
