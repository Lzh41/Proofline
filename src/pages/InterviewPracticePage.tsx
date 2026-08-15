import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  MessageCircleQuestion,
  Send,
  Sparkles,
  Square,
  Target,
  WandSparkles,
} from 'lucide-react';
import { EmptyState } from '../components/PagePrimitives';
import { useStoreView, difficultyLabel } from '../app/storeAdapter';
import type { Attempt, FinishInterviewInput } from '../types';
import type { InterviewCoachIntent } from '../lib/ai';
import styles from './Pages.module.css';

type CoachAction = 'feedback' | 'follow-up' | 'omissions' | 'improve';

const COACH_ACTIONS: Array<{ id: CoachAction; intent: InterviewCoachIntent; label: string; icon: typeof Bot }> = [
  { id: 'feedback', intent: 'interview-critique', label: '点评回答', icon: ClipboardCheck },
  { id: 'follow-up', intent: 'interview-follow-up', label: '模拟追问', icon: MessageCircleQuestion },
  { id: 'omissions', intent: 'interview-omissions', label: '检查遗漏', icon: Target },
  { id: 'improve', intent: 'interview-improve', label: '优化表达', icon: WandSparkles },
];

function elapsedLabel(startedAt?: number): string {
  if (!startedAt) return '尚未开始';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

export function InterviewPracticePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const store = useStoreView();
  const problem = store.problems.find((item) => item.id === id && item.kind === 'interview');
  const existingAttempt = useMemo(() => store.attempts
    .filter((item) => item.problemId === id && item.mode === 'interview' && !item.endedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [id, store.attempts]);
  const latestAnsweredAttempt = useMemo(() => store.attempts
    .filter((item) => item.problemId === id && item.mode === 'interview' && item.interview?.answerText?.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [id, store.attempts]);
  const restoredAnswer = existingAttempt?.interview?.answerText?.trim()
    ? existingAttempt.interview.answerText
    : latestAnsweredAttempt?.interview?.answerText ?? '';
  const [attempt, setAttempt] = useState<Attempt | undefined>(existingAttempt);
  const [answer, setAnswer] = useState(restoredAnswer);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(true);
  const [coachOutput, setCoachOutput] = useState('');
  const [coachOutputs, setCoachOutputs] = useState<Partial<Record<CoachAction, string>>>({});
  const [coachAction, setCoachAction] = useState<CoachAction>('feedback');
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState('');
  const [finished, setFinished] = useState<FinishInterviewInput['masteryResult']>();
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(() => elapsedLabel(existingAttempt?.startedAt));
  const startedRef = useRef(false);
  const streamRef = useRef('');

  useEffect(() => {
    setAttempt(existingAttempt);
    if (existingAttempt) setAnswer(restoredAnswer);
  }, [existingAttempt, restoredAnswer]);

  useEffect(() => {
    if (!problem || existingAttempt || attempt || startedRef.current || !store.startInterviewAttempt) return;
    startedRef.current = true;
    void Promise.resolve(store.startInterviewAttempt(problem.id)).then((created) => {
      if (created) {
        setAttempt(created);
        setAnswer(created.interview?.answerText ?? '');
      }
    }).catch((error) => setMessage(error instanceof Error ? error.message : '无法开始面试练习。'));
  }, [attempt, existingAttempt, problem, store.startInterviewAttempt]);

  useEffect(() => {
    if (!attempt?.id || !store.saveInterviewDraft) return;
    const timer = window.setTimeout(() => {
      void Promise.resolve(store.saveInterviewDraft?.(attempt.id, answer)).catch((error: unknown) => {
        setMessage(error instanceof Error ? `草稿保存失败：${error.message}` : '草稿保存失败。');
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [answer, attempt?.id, store.saveInterviewDraft]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(elapsedLabel(attempt?.startedAt)), 1000);
    return () => window.clearInterval(timer);
  }, [attempt?.startedAt]);

  const hasAi = Boolean(store.settings.hasAiCredential && store.settings.aiModel?.trim() && store.requestAiHint);

  const requestCoach = async (action: CoachAction) => {
    if (!problem || !hasAi || coachBusy) return;
    if (!answer.trim()) {
      setCoachError('先写下你的回答，教练才能给出有依据的反馈。');
      return;
    }
    if (!store.settings.privacyConfirmed) {
      const confirmed = window.confirm('本次会把面试题和你的回答发送到已配置的 AI 服务。是否继续？');
      if (!confirmed) return;
      await store.updateSettings?.({ privacyConfirmed: true });
    }
    const selected = COACH_ACTIONS.find((item) => item.id === action)!;
    setCoachAction(action);
    setCoachBusy(true);
    setCoachError('');
    setCoachOutput('');
    streamRef.current = '';
    try {
      const result = await store.requestAiHint?.({
        problemId: problem.id,
        attemptId: attempt?.id,
        intent: selected.intent,
        answerText: answer,
        onChunk: (chunk) => {
          streamRef.current += chunk;
          setCoachOutput(streamRef.current);
        },
      });
      const completedOutput = (typeof result === 'string' ? result : streamRef.current) || 'AI 没有返回有效内容，请重新尝试。';
      setCoachOutput(completedOutput);
      setCoachOutputs((outputs) => ({ ...outputs, [action]: completedOutput }));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'AI 服务暂时不可用。';
      setCoachError(text.includes('取消') ? '生成已取消，已经收到的内容会保留。' : text);
    } finally {
      setCoachBusy(false);
    }
  };

  const cancelCoach = async () => {
    if (!coachBusy) return;
    try {
      await store.cancelAiRequest?.();
    } catch (error) {
      setCoachError(error instanceof Error ? `取消失败：${error.message}` : '取消失败。');
    }
  };

  const submitAnswer = async () => {
    if (!attempt?.id || !store.saveInterviewDraft || submitting) {
      if (!attempt?.id) setMessage('练习记录尚未就绪，请稍后再试。');
      return;
    }
    setSubmitting(true);
    try {
      await store.saveInterviewDraft(attempt.id, answer);
      setSubmitted(true);
      setReferenceOpen(true);
      setMessage(answer.trim() ? '回答已保存并提交。请对照参考内容，再选择本次掌握度。' : '空白回答已保存，可以先查看参考内容再补写。');
    } catch (error) {
      setMessage(error instanceof Error ? `回答保存失败：${error.message}` : '回答保存失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const finish = async (masteryResult: FinishInterviewInput['masteryResult']) => {
    if (!problem || finished) return;
    let currentAttempt = attempt;
    if (!currentAttempt && store.startInterviewAttempt) {
      currentAttempt = await store.startInterviewAttempt(problem.id) || undefined;
      if (currentAttempt) setAttempt(currentAttempt);
    }
    if (!currentAttempt?.id || !store.finishInterviewAttempt) {
      setMessage('练习记录尚未就绪，请稍后再试。');
      return;
    }
    try {
      await store.finishInterviewAttempt(currentAttempt.id, {
        masteryResult,
        answerText: answer,
          aiFeedback: coachOutputs.feedback,
          omissions: coachOutputs.omissions,
          improvedAnswer: coachOutputs.improve,
      });
      setFinished(masteryResult);
      setMessage(masteryResult === 'mastered' ? '已记录为掌握。' : masteryResult === 'uncertain' ? '已加入巩固队列。' : '已加入重点复习队列。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '掌握度保存失败。');
    }
  };

  if (!problem?.interview) {
    return <EmptyState title="找不到这道面试题" message="题目可能已被移除或尚未导入。" action={<button className="button buttonPrimary" type="button" onClick={() => navigate(`/interviews${location.search}`)}>返回面试题库</button>} />;
  }

  const interview = problem.interview;
  const activeAction = COACH_ACTIONS.find((item) => item.id === coachAction)!;

  return (
    <div className={styles.interviewPracticePage}>
      <header className={styles.interviewPracticeHeader}>
        <button className="iconButton" type="button" aria-label="返回面试题库" title="返回面试题库" onClick={() => navigate(`/interviews${location.search}`)}><ArrowLeft size={16} /></button>
        <div className={styles.interviewPracticeTitle}>
          <div><span>{interview.category}</span><span>{difficultyLabel(problem.difficulty)}</span><span>{problem.tags.slice(0, 3).join(' · ')}</span></div>
          <h1>{problem.title}</h1>
          {problem.content !== problem.title && <p>{problem.content}</p>}
        </div>
        <div className={styles.interviewPracticeTimer}><Clock3 size={14} /><span>{elapsed}</span></div>
      </header>

      <div className={styles.interviewPracticeGrid}>
        <section className={styles.interviewAnswerPane}>
          <div className={styles.interviewPaneHeader}>
            <div><span className={styles.interviewPaneIcon}><Send size={15} /></span><strong>我的回答</strong><small>先按真实面试节奏组织语言</small></div>
            <span className={styles.interviewAutosave}>{attempt ? <><Check size={12} />自动保存</> : '正在建立记录'}</span>
          </div>
          <textarea className={styles.interviewAnswerEditor} aria-label="我的回答" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="从结论开始，再说明原理、方案权衡、落地细节和风险。可以先写提纲，再补成口述答案……" />
          <div className={styles.interviewAnswerActions}>
            <span>{answer.trim().length} 字</span>
            <button className="button buttonPrimary" type="button" disabled={!attempt || submitting} onClick={() => void submitAnswer()}><CheckCircle2 size={15} />{submitting ? '保存中' : '提交回答'}</button>
          </div>
        </section>

        <aside className={styles.interviewCoachPane}>
          <div className={styles.interviewPaneHeader}>
            <div><span className={styles.interviewPaneIcon}><Bot size={15} /></span><strong>面试教练</strong><small>{hasAi ? '结合你的答案实时反馈' : '配置 AI 后解锁个性化点评'}</small></div>
            {coachBusy && <button className="button buttonDanger" type="button" onClick={() => void cancelCoach()}><Square size={12} />停止</button>}
          </div>
          <div className={styles.interviewCoachActions} aria-label="AI 面试教练快捷操作">
            {COACH_ACTIONS.map((action) => {
              const Icon = action.icon;
              return <button className={`${styles.interviewCoachAction} ${coachAction === action.id && coachOutput ? styles.interviewCoachActionActive : ''}`} type="button" key={action.id} disabled={!hasAi || coachBusy} onClick={() => void requestCoach(action.id)}><Icon size={14} /><span>{action.label}</span></button>;
            })}
          </div>
          <div className={styles.interviewCoachOutput} aria-live="polite" aria-busy={coachBusy}>
            {coachOutput ? <article><span><Sparkles size={13} />{activeAction.label}</span><p>{coachOutput}</p></article> : coachBusy ? <div className={styles.interviewCoachEmpty}><span className={styles.interviewThinking} /><strong>正在分析你的回答</strong><p>教练会关注技术准确性、结构和现场表达。</p></div> : <div className={styles.interviewCoachEmpty}><Bot size={24} /><strong>{hasAi ? '选择一种教练动作' : '本地练习仍然完整可用'}</strong><p>{hasAi ? '写下回答后，让教练点评、追问或帮你查漏补缺。' : '提交回答即可查看参考要点、完整答案和追问，不依赖 AI。'}</p></div>}
            {coachError && <div className={styles.interviewCoachError}>{coachError}</div>}
          </div>
        </aside>
      </div>

      {submitted && (
        <section className={styles.interviewReference}>
          <button className={styles.interviewReferenceToggle} type="button" aria-expanded={referenceOpen} onClick={() => setReferenceOpen((value) => !value)}>
            <span><CircleHelp size={15} /><strong>参考要点</strong><small>用来校准答案，不要求逐字背诵</small></span><ChevronDown size={16} className={referenceOpen ? styles.interviewReferenceOpen : undefined} />
          </button>
          {referenceOpen && <div className={styles.interviewReferenceBody}>
            <div><h2>回答骨架</h2><ul>{interview.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
            <div><h2>完整参考答案</h2><p>{interview.referenceAnswer}</p></div>
            <div><h2>面试官追问</h2><ol>{interview.followUps.map((item) => <li key={item}>{item}</li>)}</ol></div>
          </div>}
          <div className={styles.interviewMasteryBar}>
            <span>{message || '对照完成后，记录你这次的真实掌握度。'}</span>
            <div>
              <button className={`${styles.interviewMasteryButton} ${finished === 'mastered' ? styles.interviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('mastered')}><CheckCircle2 size={14} />已掌握</button>
              <button className={`${styles.interviewMasteryButton} ${finished === 'uncertain' ? styles.interviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('uncertain')}><CircleHelp size={14} />还需巩固</button>
              <button className={`${styles.interviewMasteryButton} ${styles.interviewMasteryDanger} ${finished === 'unknown' ? styles.interviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('unknown')}><Target size={14} />完全不会</button>
            </div>
          </div>
        </section>
      )}
      {!submitted && message && <div className={styles.interviewPracticeMessage} role="status">{message}</div>}
    </div>
  );
}
