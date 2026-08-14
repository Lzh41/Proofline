import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpToLine,
  BookOpenCheck,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  Lightbulb,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Square,
  TestTube2,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AiCoachIntent } from '../lib/ai';
import { EDITOR_FONT_SIZES } from '../lib/data';
import { normalizeProblemExamples } from '../lib/problemExamples';
import { formatProblemSampleResult, outputsEqual } from '../lib/problemRunner';
import type { AiGeneration, Attempt, EditorFontSize, Problem, ProblemExample, ProblemSampleRunResult } from '../types';
import { difficultyLabel, formatDuration, sourceLabel, useStoreView } from '../app/storeAdapter';
import { EmptyState, PageHeader } from '../components/PagePrimitives';
import { editorThemeFor } from '../app/theme';
import { useResolvedTheme } from '../app/useResolvedTheme';
import styles from './Pages.module.css';

const MonacoEditor = lazy(() => import('../lib/localMonaco'));

type AiStatus = 'idle' | 'streaming' | 'cancelling' | 'done' | 'cancelled' | 'error';
interface AiCoachTurn {
  id: string;
  intent: AiCoachIntent;
  label: string;
  question?: string;
  answer: string;
  error: string;
  status: Exclude<AiStatus, 'idle' | 'streaming' | 'cancelling'>;
}

interface SampleFieldError {
  index: number;
  field: 'input' | 'output';
}

type SampleRunItemStatus = 'pending' | 'running' | 'passed' | 'failed' | 'unknown';

interface SampleRunItem {
  status: SampleRunItemStatus;
  result?: ProblemSampleRunResult;
}

function sampleRunStatus(results: ProblemSampleRunResult[]): boolean | null {
  if (results.some((result) => !result.ok || result.passed === false)) return false;
  return results.every((result) => result.passed === true) ? true : null;
}

function formatAllSampleResults(results: ProblemSampleRunResult[]): string {
  const passed = results.filter((result) => result.passed === true).length;
  const failed = results.filter((result) => !result.ok || result.passed === false).length;
  const undecided = results.length - passed - failed;
  const summary = failed === 0 && undecided === 0
    ? `全部 ${results.length} 条样例通过`
    : `共运行 ${results.length} 条样例：${passed} 条通过，${failed} 条未通过${undecided ? `，${undecided} 条无法判定` : ''}`;
  const details = results.map((result) => formatProblemSampleResult(result)).join('\n\n');
  const entryPointNote = results.some((result) => result.generatedEntryPoint)
    ? '\n\n已自动生成测试入口，你只需要编写题目要求的解题函数。'
    : '';
  return `${summary}\n\n${details}${entryPointNote}`;
}

function sampleRunItemStatus(result: ProblemSampleRunResult): SampleRunItemStatus {
  if (!result.ok || result.passed === false) return 'failed';
  if (result.passed === true) return 'passed';
  return 'unknown';
}

function sampleRunStatusLabel(status: SampleRunItemStatus): string {
  switch (status) {
    case 'running': return '运行中';
    case 'passed': return '通过';
    case 'failed': return '未通过';
    case 'unknown': return '无法判定';
    default: return '等待中';
  }
}

function sampleRunFailure(error: unknown, sampleIndex: number, expectedOutput: string): ProblemSampleRunResult {
  return {
    ok: false,
    output: '',
    error: error instanceof Error ? error.message : '样例运行失败。',
    durationMs: 0,
    timedOut: false,
    sampleIndex,
    expectedOutput,
    actualOutput: '',
    generatedEntryPoint: false,
    mode: 'stdin',
  };
}

function formatSampleProgress(results: ProblemSampleRunResult[], total: number): string {
  return `已运行 ${results.length} / ${total} 条样例\n\n${formatAllSampleResults(results)}`;
}

const COACH_ACTIONS: Array<{
  intent: AiCoachIntent;
  label: string;
  description: string;
  icon: typeof Search;
}> = [
  { intent: 'analyze', label: '分析当前代码', description: '先找最值得改的地方', icon: Search },
  { intent: 'algorithm-logic', label: '算法逻辑拆解', description: '解释每一步为什么这样写', icon: BookOpenCheck },
  { intent: 'next-code', label: '给下一段提示', description: '告诉我接下来具体写什么', icon: Lightbulb },
  { intent: 'debug', label: '解释运行问题', description: '结合刚才的结果定位错误', icon: AlertTriangle },
  { intent: 'complete', label: '给完整代码', description: '输出无 TODO 的最终实现', icon: Code2 },
];

const AI_COACH_INTENTS = new Set<AiCoachIntent>([
  ...COACH_ACTIONS.map((action) => action.intent),
  'explain',
]);

function isAiCoachIntent(value: unknown): value is AiCoachIntent {
  return typeof value === 'string' && AI_COACH_INTENTS.has(value as AiCoachIntent);
}

function coachIntentLabel(intent: AiCoachIntent): string {
  if (intent === 'explain') return 'AI 解惑';
  return COACH_ACTIONS.find((action) => action.intent === intent)?.label ?? '代码提示';
}

function generationIntent(generation: AiGeneration): AiCoachIntent {
  if (isAiCoachIntent(generation.intent)) return generation.intent;
  if (generation.userQuestion?.trim()) return 'explain';
  const matched = [...COACH_ACTIONS, { intent: 'explain' as const, label: 'AI 解惑' }]
    .find((action) => generation.prompt.includes(action.label));
  if (matched) return matched.intent;
  return generation.level === 5 ? 'complete' : 'next-code';
}

function generationToCoachTurn(generation: AiGeneration): AiCoachTurn {
  const intent = generationIntent(generation);
  return {
    id: generation.id,
    intent,
    label: coachIntentLabel(intent),
    question: generation.userQuestion?.trim() || undefined,
    answer: generation.response,
    error: '',
    status: 'done',
  };
}

function normalizeCoachQuestion(question = ''): string {
  return question.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function AiCoachContent({ content, busy, complete }: { content: string; busy: boolean; complete: boolean }) {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);

  const copyCode = async (value: string, index: number) => {
    await writeClipboard(value);
    setCopiedBlock(index);
    window.setTimeout(() => setCopiedBlock((current) => current === index ? null : current), 1800);
  };

  return (
    <div className={styles.aiLessonContent}>
      {blocks.map((block, index) => {
        const codeBlock = block.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
        if (!codeBlock) {
          return (
            <div className={styles.aiProse} key={`${index}-${block.slice(0, 12)}`}>
              {block.split('\n').map((line, lineIndex) => {
                const heading = line.match(/^#{1,3}\s+(.+)$/);
                const bullet = line.match(/^\s*[-*]\s+(.+)$/);
                const numbered = line.match(/^\s*(\d+)[.)、]\s+(.+)$/);
                if (heading) return <h3 key={lineIndex}>{heading[1]}</h3>;
                if (bullet) return <p className={styles.aiBullet} key={lineIndex}><i />{bullet[1]}</p>;
                if (numbered) return <p className={styles.aiNumbered} key={lineIndex}><b>{numbered[1]}</b>{numbered[2]}</p>;
                if (!line.trim()) return <span className={styles.aiProseGap} key={lineIndex} aria-hidden="true" />;
                return <p key={lineIndex}>{line}</p>;
              })}
            </div>
          );
        }
        const codeText = codeBlock[2].trimEnd();
        return (
          <div className={styles.aiCodeBlock} key={`${index}-${codeBlock[1]}`}>
            <div className={styles.aiCodeHeader}>
              <span><Code2 size={13} />{complete ? '完整实现' : (codeBlock[1].trim() || '下一段代码')}</span>
              <button type="button" onClick={() => void copyCode(codeText, index)} aria-label="复制代码">
                {copiedBlock === index ? <><Check size={12} />已复制</> : <><Copy size={12} />复制</>}
              </button>
            </div>
            <pre><code>{codeText}</code></pre>
          </div>
        );
      })}
      {busy && <span className={styles.aiStreamCursor} aria-hidden="true" />}
    </div>
  );
}

function conversationContext(turns: AiCoachTurn[]): string {
  return turns
    .filter((turn) => turn.answer.trim())
    .slice(-5)
    .map((turn) => `【用户请求：${turn.label}${turn.question ? `｜${turn.question}` : ''}】\n${turn.answer.slice(0, 1_600)}`)
    .join('\n\n')
    .slice(-8_000);
}

const DEFAULT_CODE = '';

const LANGUAGE_ALIASES: Record<string, string[]> = {
  cpp: ['cpp', 'cpp17', 'c++', 'c++17'],
  python: ['python', 'python3', 'python 3', 'py'],
  javascript: ['javascript', 'javascript-es6', 'js'],
  typescript: ['typescript', 'ts'],
};

const PLATFORM_SOURCES = new Set<Problem['source']>(['leetcode-cn', 'leetcode', 'nowcoder']);

function editableExamples(examples: readonly ProblemExample[]): ProblemExample[] {
  return examples.length
    ? examples.map((example) => ({ ...example, explanation: example.explanation ?? '' }))
    : [{ input: '', output: '', explanation: '' }];
}

function runnableExamples(problem: Problem): ProblemExample[] {
  return normalizeProblemExamples(problem.examples);
}

export function findProblemCodeSnippet(problem: Problem | undefined, language: string): string | undefined {
  const aliases = LANGUAGE_ALIASES[language] ?? [language.toLowerCase()];
  return problem?.codeSnippets?.find((snippet) => {
    const slug = snippet.languageSlug.trim().toLowerCase();
    const label = snippet.language.trim().toLowerCase();
    return aliases.includes(slug) || aliases.includes(label);
  })?.code;
}

function normalizedEditorCode(value: string): string {
  return value.replace(/\s+/g, '');
}

function isForeignOfficialTemplate(
  problem: Problem | undefined,
  attempt: Attempt | undefined,
  language: string,
  allProblems: readonly Problem[],
): boolean {
  if (!problem || !attempt?.code.trim() || attempt.endedAt || attempt.result !== 'unfinished') return false;
  const currentTemplate = findProblemCodeSnippet(problem, language);
  if (!currentTemplate || normalizedEditorCode(attempt.code) === normalizedEditorCode(currentTemplate)) return false;
  const candidate = normalizedEditorCode(attempt.code);
  return allProblems.some((other) => (
    other.id !== problem.id
    && normalizedEditorCode(findProblemCodeSnippet(other, language) ?? '') === candidate
  ));
}

function initialEditorCode(
  problem: Problem | undefined,
  attempt: Attempt | undefined,
  language: string,
  allProblems: readonly Problem[] = [],
): string {
  if (attempt?.code.trim() && !isForeignOfficialTemplate(problem, attempt, language, allProblems)) return attempt.code;
  return findProblemCodeSnippet(problem, language) ?? DEFAULT_CODE;
}

function isAlgorithmProblem(problem: Problem): boolean {
  return problem.kind === 'algorithm' || !problem.kind;
}

function problemDisplayTitle(problem: Problem): string {
  return problem.externalId ? `${problem.externalId}. ${problem.title}` : problem.title;
}

function problemPickerLabel(problem: Problem, practicedProblemIds: ReadonlySet<string>): string {
  return `${practicedProblemIds.has(problem.id) ? '✓ 已练习' : '○ 未练习'} · ${problemDisplayTitle(problem)}`;
}

export function SolvePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useStoreView();
  const algorithmProblems = useMemo(() => store.problems.filter(isAlgorithmProblem), [store.problems]);
  const practicedProblemIds = useMemo(
    () => new Set(store.attempts
      .filter((item) => item.mode === 'code' && (item.result === 'sample-passed' || item.result === 'accepted'))
      .map((item) => item.problemId)),
    [store.attempts],
  );
  const problem = useMemo(
    () => {
      if (id) return algorithmProblems.find((item) => item.id === id);
      return algorithmProblems.find((item) => item.id === store.settings.lastSolveProblemId) ?? algorithmProblems[0];
    },
    [algorithmProblems, id, store.settings.lastSolveProblemId],
  );
  const currentProblemIndex = useMemo(
    () => problem ? algorithmProblems.findIndex((item) => item.id === problem.id) : -1,
    [algorithmProblems, problem],
  );
  const previousProblem = currentProblemIndex > 0 ? algorithmProblems[currentProblemIndex - 1] : undefined;
  const nextProblem = currentProblemIndex >= 0 && currentProblemIndex < algorithmProblems.length - 1 ? algorithmProblems[currentProblemIndex + 1] : undefined;
  const attempt = useMemo(() => store.attempts.filter((item) => item.problemId === problem?.id).sort((a, b) => b.startedAt - a.startedAt)[0], [problem?.id, store.attempts]);
  const [code, setCode] = useState(() => initialEditorCode(problem, attempt, attempt?.language ?? store.settings.defaultLanguage ?? 'cpp', algorithmProblems));
  const [language, setLanguage] = useState(attempt?.language ?? store.settings.defaultLanguage ?? 'cpp');
  const [seconds, setSeconds] = useState(attempt?.durationSeconds ?? 0);
  const [running, setRunning] = useState(false);
  const [coachTurns, setCoachTurns] = useState<AiCoachTurn[]>([]);
  const [activeIntent, setActiveIntent] = useState<AiCoachIntent>('next-code');
  const [coachQuestion, setCoachQuestion] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [aiError, setAiError] = useState('');
  const [busyCoach, setBusyCoach] = useState(false);
  const [message, setMessage] = useState('');
  const [runResult, setRunResult] = useState('还没有运行样例。点击上方“运行全部样例”，应用会自动补齐测试入口。');
  const [runPassed, setRunPassed] = useState<boolean | null>(null);
  const [runningCode, setRunningCode] = useState(false);
  const [sampleRunItems, setSampleRunItems] = useState<SampleRunItem[]>([]);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleDrafts, setSampleDrafts] = useState<ProblemExample[]>(() => editableExamples(problem?.examples ?? []));
  const [sampleEditorMessage, setSampleEditorMessage] = useState('');
  const [sampleFieldError, setSampleFieldError] = useState<SampleFieldError | null>(null);
  const [allowEmptySamples, setAllowEmptySamples] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const loadedProblemIdRef = useRef<string | undefined>(undefined);
  const runningCodeRef = useRef(false);
  const draftAttemptIdRef = useRef<string | undefined>(attempt?.id);
  const draftCreatePromiseRef = useRef<Promise<Attempt | void> | null>(null);
  const requestGenerationRef = useRef(0);
  const currentProblemIdRef = useRef(problem?.id);
  // 记录当前编辑器代码属于哪道题，防止切换题目时把上一题的代码误存进新题的草稿
  const codeProblemIdRef = useRef<string | undefined>(problem?.id);
  const problemReaderDialogRef = useRef<HTMLDialogElement | null>(null);
  const sampleDialogRef = useRef<HTMLDialogElement | null>(null);
  const sampleResultDialogRef = useRef<HTMLDialogElement | null>(null);
  const aiContentRef = useRef('');
  const aiPanelRef = useRef<HTMLDivElement | null>(null);
  const solvePageRef = useRef<HTMLDivElement | null>(null);
  const resolvedTheme = useResolvedTheme(store.settings.theme ?? 'dark');
  const editorTheme = editorThemeFor(resolvedTheme);
  const editorFontSize = store.settings.editorFontSize ?? 16;
  const aiConfigured = Boolean(store.requestAiHint && store.settings.hasAiCredential && store.settings.aiModel?.trim());
  const visibleCoachTurns = useMemo(() => {
    const matching = coachTurns.filter((turn) => turn.intent === activeIntent);
    if (activeIntent === 'explain') return matching;
    return matching.length ? [matching[matching.length - 1]] : [];
  }, [activeIntent, coachTurns]);
  const cachedCoachIntents = useMemo(
    () => new Set(coachTurns.filter((turn) => turn.intent !== 'explain' && turn.answer.trim()).map((turn) => turn.intent)),
    [coachTurns],
  );
  currentProblemIdRef.current = problem?.id;
  draftAttemptIdRef.current = attempt?.problemId === problem?.id ? attempt?.id : undefined;

  const isCurrentProblemRequest = (generation: number, problemId: string) => (
    requestGenerationRef.current === generation && currentProblemIdRef.current === problemId
  );

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!problem?.id || !store.updateAttempt) return;
    const templateCode = findProblemCodeSnippet(problem, language) ?? DEFAULT_CODE;
    const capturedCodeProblemId = codeProblemIdRef.current;
    const capturedProblemId = problem.id;
    // 切换题目瞬间 code 可能还是上一题的代码：只有代码确实属于当前题目时才允许自动建草稿，
    // 否则会把上一题的签名误存进新题的 attempt（历史错位数据的来源）。
    const codeBelongsToProblem = capturedCodeProblemId === problem.id;
    const shouldCreateDraft = !attempt?.id && code.trim() && code !== templateCode && codeBelongsToProblem;
    if (!attempt?.id && !shouldCreateDraft) return;

    const persistDraft = async () => {
      // effect cleanup 发生在题目切换的 render 之后，此时 draftAttemptIdRef 可能已经指向新题。
      // 只允许仍属于当前题目的闭包落盘，杜绝上一题代码写入新题记录。
      if (!codeBelongsToProblem
        || capturedCodeProblemId !== capturedProblemId
        || currentProblemIdRef.current !== capturedProblemId
        || codeProblemIdRef.current !== capturedCodeProblemId) return;
      let targetAttemptId = draftAttemptIdRef.current;
      if (!targetAttemptId) {
        if (!store.startAttempt) return;
        if (!draftCreatePromiseRef.current) draftCreatePromiseRef.current = Promise.resolve(store.startAttempt(problem.id, language));
        const started = await draftCreatePromiseRef.current;
        draftCreatePromiseRef.current = null;
        if (!started?.id || currentProblemIdRef.current !== capturedProblemId || codeProblemIdRef.current !== capturedCodeProblemId) return;
        targetAttemptId = started.id;
        draftAttemptIdRef.current = started.id;
      }
      if (currentProblemIdRef.current !== capturedProblemId || codeProblemIdRef.current !== capturedCodeProblemId) return;
      await store.updateAttempt?.(targetAttemptId, { code, language, durationSeconds: seconds });
    };

    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistDraft();
    }, 500);
    return () => {
      window.clearTimeout(saveTimer.current);
      void persistDraft();
    };
  }, [attempt?.id, code, language, problem, seconds, store.startAttempt, store.updateAttempt]);

  useEffect(() => {
    if (!problem?.id) return;
    // 练习记录保存、补齐样例等动作都会更新 store。恢复编辑器只能发生在题目真正切换时，
    // 否则一次运行就可能把用户刚输入的代码重新替换成平台模板。
    if (loadedProblemIdRef.current === problem.id) return;

    loadedProblemIdRef.current = problem.id;
    const nextLanguage = attempt?.language ?? store.settings.defaultLanguage ?? 'cpp';
    setLanguage(nextLanguage);
    codeProblemIdRef.current = problem?.id;
    setCode(initialEditorCode(problem, attempt, nextLanguage, algorithmProblems));
    setSeconds(attempt?.durationSeconds ?? 0);
    const restoredTurns = store.aiGenerations
      .filter((generation) => generation.problemId === problem?.id && generation.response.trim())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(generationToCoachTurn);
    setCoachTurns(restoredTurns);
    setActiveIntent(restoredTurns[restoredTurns.length - 1]?.intent ?? 'next-code');
    setStreamingAnswer('');
    setAiStatus('idle');
    setAiError('');
    setSampleDrafts(editableExamples(problem?.examples ?? []));
    setSampleEditorMessage('');
    setSampleFieldError(null);
    setAllowEmptySamples(false);
    problemReaderDialogRef.current?.close();
    sampleDialogRef.current?.close();
    aiContentRef.current = '';
  }, [algorithmProblems, attempt?.id, problem?.id, store.settings.defaultLanguage]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    draftAttemptIdRef.current = attempt?.id;
    draftCreatePromiseRef.current = null;
    setRunResult('还没有运行样例。点击上方“运行全部样例”，应用会自动补齐测试入口。');
    setRunPassed(null);
    setSampleRunItems([]);
    runningCodeRef.current = false;
    setRunningCode(false);
    setSampleBusy(false);
  }, [problem?.id]);

  useEffect(() => {
    if (!problem?.id || store.settings.lastSolveProblemId === problem.id) return;
    void store.updateSettings?.({ lastSolveProblemId: problem.id });
  }, [problem?.id, store.settings.lastSolveProblemId, store.updateSettings]);

  useEffect(() => {
    if (busyCoach && aiPanelRef.current) {
      aiPanelRef.current.scrollTop = aiPanelRef.current.scrollHeight;
    }
  }, [streamingAnswer, busyCoach]);

  useLayoutEffect(() => {
    const content = solvePageRef.current?.closest('main');
    if (!content) return;
    content.classList.add(styles.solveContent);
    return () => content.classList.remove(styles.solveContent);
  }, [problem?.id]);

  const scrollCoachTurnToStart = (turn: HTMLElement | null) => {
    const panel = aiPanelRef.current;
    if (!turn || !panel) return;
    const targetTop = Math.max(
      0,
      panel.scrollTop + turn.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8,
    );
    if (typeof panel.scrollTo === 'function') panel.scrollTo({ top: targetTop, behavior: 'smooth' });
    else panel.scrollTop = targetTop;
  };

  const begin = async () => {
    if (!problem) return;
    if (!attempt || attempt.endedAt) {
      const started = await store.startAttempt?.(problem.id, language);
      if (started?.id && code.trim()) await store.updateAttempt?.(started.id, { code, language });
    }
    setRunning(true);
    setMessage('计时已开始，代码和笔记会自动保存。');
  };

  const requestCoach = async (intent: AiCoachIntent, question = '') => {
    if (!problem) return;
    const normalizedQuestion = normalizeCoachQuestion(question);
    const cachedTurn = [...coachTurns].reverse().find((turn) => (
      turn.intent === intent
      && turn.answer.trim()
      && (intent !== 'explain' || normalizeCoachQuestion(turn.question) === normalizedQuestion)
    ));
    setActiveIntent(intent);
    if (cachedTurn) {
      setStreamingAnswer('');
      setAiStatus('done');
      setAiError('');
      setMessage('已显示这道题保存的 AI 回答。');
      window.requestAnimationFrame(() => {
        if (aiPanelRef.current) aiPanelRef.current.scrollTop = aiPanelRef.current.scrollHeight;
      });
      return;
    }
    const requestAiHint = store.requestAiHint;
    if (!requestAiHint || !aiConfigured) {
      const missing = !store.settings.hasAiCredential
        ? '请先在设置中保存 AI 密钥。'
        : !store.settings.aiModel?.trim()
          ? '请先在设置中填写模型 ID。'
          : 'AI 服务入口尚未初始化，请稍后重试。';
      setAiStatus('error');
      setAiError(missing);
      setMessage(missing);
      return;
    }
    if (!store.settings.privacyConfirmed) {
      const confirmed = window.confirm('本次会把当前题面、代码、运行反馈和相关学习记录发送到你配置的 AI 服务。是否继续？');
      if (!confirmed) return;
      await store.updateSettings?.({ privacyConfirmed: true });
    }
    const actionLabel = coachIntentLabel(intent);
    setBusyCoach(true);
    setAiStatus('streaming');
    setAiError('');
    setStreamingAnswer('');
    aiContentRef.current = '';
    try {
      const result = await requestAiHint({
        problemId: problem.id,
        attemptId: attempt?.id,
        intent,
        code,
        language,
        previousGuidance: conversationContext(coachTurns),
        recentRunError: runResult,
        userQuestion: question.trim() || undefined,
        onChunk: (chunk: string) => {
          aiContentRef.current += chunk;
          setStreamingAnswer(aiContentRef.current);
        },
      });
      const completed = (typeof result === 'string' ? result : aiContentRef.current) || '教练没有返回有效内容，请重新发送。';
      aiContentRef.current = completed;
      setStreamingAnswer('');
      setAiStatus('done');
      setCoachTurns((turns) => [...turns, {
        id: `${Date.now()}-${intent}`,
        intent,
        label: actionLabel,
        question: question.trim() || undefined,
        answer: completed,
        error: '',
        status: 'done',
      }]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI 服务暂时不可用。';
      const cancelled = errorMessage.includes('取消');
      const answer = aiContentRef.current;
      setStreamingAnswer('');
      setAiStatus(cancelled ? 'cancelled' : 'error');
      setAiError(cancelled ? (answer ? '生成已取消，已保留收到的内容。' : '生成已取消。') : errorMessage);
      if (answer) {
        setCoachTurns((turns) => [...turns, {
          id: `${Date.now()}-${intent}`,
          intent,
          label: actionLabel,
          question: question.trim() || undefined,
          answer,
          error: cancelled ? '生成已取消' : errorMessage,
          status: cancelled ? 'cancelled' : 'error',
        }]);
      }
    } finally {
      setBusyCoach(false);
    }
  };

  const cancelCoach = async () => {
    if (!busyCoach || !store.cancelAiRequest) return;
    setAiStatus('cancelling');
    try {
      await store.cancelAiRequest();
    } catch (error) {
      setAiStatus('streaming');
      setAiError(error instanceof Error ? `取消失败：${error.message}` : '取消失败，请稍后重试。');
    }
  };

  const sendQuestion = () => {
    const question = coachQuestion.trim();
    if (!question) return;
    setCoachQuestion('');
    void requestCoach('explain', question);
  };

  const ensureActiveAttempt = async (draft?: { code: string; language: string; durationSeconds: number }): Promise<Attempt | undefined> => {
    if (!problem) return undefined;
    const nextDraft = draft ?? { code, language, durationSeconds: seconds };
    if (attempt?.id && !attempt.endedAt && attempt.result === 'unfinished') {
      await store.updateAttempt?.(attempt.id, nextDraft);
      draftAttemptIdRef.current = attempt.id;
      return { ...attempt, ...nextDraft };
    }

    // 编辑器自动保存和“运行样例”可能同时发现还没有练习记录；共用同一个创建请求，
    // 避免重复记录、重复 SQLite 写入，以及状态更新时的模板覆盖竞态。
    const pendingStart = draftCreatePromiseRef.current
      ?? (store.startAttempt
        ? (draftCreatePromiseRef.current = Promise.resolve(store.startAttempt(problem.id, nextDraft.language)))
        : null);
    if (!pendingStart) return undefined;
    const started = await pendingStart;
    if (draftCreatePromiseRef.current === pendingStart) draftCreatePromiseRef.current = null;
    if (!started?.id) return undefined;
    await store.updateAttempt?.(started.id, nextDraft);
    draftAttemptIdRef.current = started.id;
    return { ...started, ...nextDraft };
  };

  const openSampleResultDialog = () => {
    const dialog = sampleResultDialogRef.current;
    if (!dialog || dialog.open) return;
    // WebView2 支持 showModal，但浏览器预览、旧版运行时或测试环境可能只支持 open 属性。
    // 统一走兼容回退，避免样例已在后台运行而用户看不到任何进度。
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
  };

  const openProblemReader = () => {
    const dialog = problemReaderDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  };

  const openSampleEditor = (examples = problem?.examples ?? [], editorMessage = '') => {
    setSampleDrafts(editableExamples(examples));
    setSampleEditorMessage(editorMessage);
    setSampleFieldError(null);
    setAllowEmptySamples(false);
    const dialog = sampleDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    window.requestAnimationFrame(() => dialog?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
  };

  const updateSampleDraft = (index: number, field: keyof ProblemExample, value: string) => {
    if (sampleBusy) return;
    setSampleDrafts((drafts) => drafts.map((draft, draftIndex) => draftIndex === index
      ? { ...draft, [field]: value }
      : draft));
    setSampleEditorMessage('');
    setSampleFieldError(null);
    setAllowEmptySamples(false);
  };

  const addSampleDraft = () => {
    if (sampleBusy || sampleDrafts.length >= 20) return;
    const nextIndex = sampleDrafts.length + 1;
    setSampleDrafts((drafts) => [...drafts, { input: '', output: '', explanation: '' }]);
    setAllowEmptySamples(false);
    setSampleFieldError(null);
    window.requestAnimationFrame(() => {
      sampleDialogRef.current?.querySelector<HTMLTextAreaElement>(`[aria-label="样例 ${nextIndex} 输入"]`)?.focus();
    });
  };

  const removeSampleDraft = (index: number) => {
    if (sampleBusy) return;
    const nextDrafts = sampleDrafts.filter((_, draftIndex) => draftIndex !== index);
    setSampleDrafts(editableExamples(nextDrafts));
    setAllowEmptySamples(nextDrafts.length === 0);
    setSampleEditorMessage('');
    setSampleFieldError(null);
  };

  const saveSamples = async () => {
    if (sampleBusy || !problem || !store.updateProblem) return;
    for (let index = 0; index < sampleDrafts.length; index += 1) {
      const draft = sampleDrafts[index];
      const hasInput = Boolean(draft.input.trim());
      const hasOutput = Boolean(draft.output.trim());
      const hasAnyContent = hasInput || hasOutput || Boolean(draft.explanation?.trim());
      if (!hasAnyContent || (hasInput && hasOutput)) continue;

      const field: SampleFieldError['field'] = hasInput ? 'output' : 'input';
      const fieldLabel = field === 'input' ? '输入' : '预期输出';
      setSampleFieldError({ index, field });
      setSampleEditorMessage(`样例 ${index + 1} 缺少${fieldLabel}，请补充后再保存。`);
      window.requestAnimationFrame(() => {
        sampleDialogRef.current?.querySelector<HTMLTextAreaElement>(`[aria-label="样例 ${index + 1} ${fieldLabel}"]`)?.focus();
      });
      return;
    }

    const examples = normalizeProblemExamples(sampleDrafts);
    if (!examples.length && !allowEmptySamples) {
      setSampleFieldError({ index: 0, field: 'input' });
      setSampleEditorMessage('请至少填写一条包含输入和预期输出的完整样例。');
      sampleDialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      return;
    }

    setSampleBusy(true);
    setSampleEditorMessage('正在保存样例…');
    try {
      await store.updateProblem(problem.id, { examples });
      setMessage(`样例已保存，共 ${examples.length} 条。`);
      setAllowEmptySamples(false);
      sampleDialogRef.current?.close();
    } catch (error) {
      setSampleEditorMessage(error instanceof Error ? `保存样例失败：${error.message}` : '保存样例失败，请稍后重试。');
    } finally {
      setSampleBusy(false);
    }
  };

  const replenishSamples = async () => {
    if (!problem || runningCode) return;
    const requestGeneration = requestGenerationRef.current;
    const problemId = problem.id;
    const useRemoteRefresh = PLATFORM_SOURCES.has(problem.source) && Boolean(problem.sourceUrl);
    const recover = useRemoteRefresh ? store.refreshProblemMetadata : store.recoverProblemSamples;
    if (!recover) {
      setMessage('补齐样例失败：样例恢复服务尚未初始化。');
      return;
    }

    setSampleBusy(true);
    setMessage(useRemoteRefresh ? '正在刷新题目并补齐样例…' : '正在从题面补齐样例…');
    try {
      const recoveredProblem = await recover(problemId);
      if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
      setMessage(recoveredProblem.examples.length
        ? `样例已补齐，共 ${recoveredProblem.examples.length} 条。`
        : '题面中没有找到可补齐的完整样例。');
    } catch (error) {
      if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
      setMessage(error instanceof Error ? `补齐样例失败：${error.message}` : '补齐样例失败，请稍后重试。');
    } finally {
      if (isCurrentProblemRequest(requestGeneration, problemId)) setSampleBusy(false);
    }
  };

  const runSample = async () => {
    if (!problem || runningCodeRef.current || sampleBusy) return;
    runningCodeRef.current = true;
    const requestGeneration = requestGenerationRef.current;
    const problemId = problem.id;
    const codeToRun = code;
    const languageToRun = language;
    const durationAtStart = seconds;
    let activeAttempt: Attempt | undefined;
    // 运行使用不可变代码快照；取消尚未触发的自动保存定时器，随后由 ensureActiveAttempt
    // 一次性写入同一份快照，避免运行期间的旧闭包再次创建练习记录。
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    setRunningCode(true);
    setRunPassed(null);
    setRunResult('正在准备样例和自动测试入口…');
    // 立即打开结果面板，让编译或解释器启动期间也能看到“准备中/等待中”状态。
    // 结果列表随后随每个样例完成而更新，不依赖 requestAnimationFrame（桌面 WebView
    // 在窗口失焦时可能会节流 RAF，导致后台运行但结果面板始终不出现）。
    openSampleResultDialog();
    try {
      let runnableProblem = { ...problem, examples: runnableExamples(problem) };
      if (!runnableProblem.examples.length) {
        setRunResult('正在从题面恢复可运行样例…');
        try {
          if (!store.recoverProblemSamples) throw new Error('样例恢复服务尚未初始化');
          const recoveredProblem = await store.recoverProblemSamples(runnableProblem.id);
          if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
          runnableProblem = { ...recoveredProblem, examples: runnableExamples(recoveredProblem) };
        } catch (error) {
          if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
          const detail = error instanceof Error ? error.message : '未知错误';
          setRunResult('尚未运行：自动恢复样例失败，请手动补充后重试。');
          openSampleEditor([], `自动恢复样例失败：${detail}。请手动填写样例。`);
          return;
        }

        if (!runnableProblem.examples.length) {
          setMessage('未找到完整样例，已打开样例编辑器。');
          setRunResult('尚未运行：请先补充输入和预期输出。');
          openSampleEditor(runnableProblem.examples, '没有找到可运行的完整样例，请先补充输入和预期输出。');
          return;
        }
      }

      setSampleRunItems(runnableProblem.examples.map(() => ({ status: 'pending' })));
      setRunResult(`已准备 ${runnableProblem.examples.length} 条样例，等待运行…`);
      // 让状态列表先完成一次渲染，避免点击按钮后被本地持久化或编译任务挡住反馈。
      // 使用定时器而不是 requestAnimationFrame，兼容 WebView2 窗口失焦时的 RAF 节流。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      if (store.runProblemSample) {
        if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
        const runProblemSample = store.runProblemSample;
        const activeAttemptPromise = ensureActiveAttempt({ code: codeToRun, language: languageToRun, durationSeconds: durationAtStart }).catch(() => undefined);
        const resultsByIndex: Array<ProblemSampleRunResult | undefined> = [];
        const runOneSample = async (sampleIndex: number): Promise<ProblemSampleRunResult> => {
          setSampleRunItems((items) => items.map((item, index) => index === sampleIndex ? { ...item, status: 'running' } : item));
          setRunResult(`正在运行样例 ${sampleIndex + 1} / ${runnableProblem.examples.length}…`);
          let result: ProblemSampleRunResult;
          try {
            result = await runProblemSample({ problem: runnableProblem, language: languageToRun, code: codeToRun, sampleIndex, timeoutMs: 3000 });
          } catch (error) {
            result = sampleRunFailure(error, sampleIndex, runnableProblem.examples[sampleIndex]?.output ?? '');
          }
          resultsByIndex[sampleIndex] = result;
          if (!isCurrentProblemRequest(requestGeneration, problemId)) return result;
          setSampleRunItems((items) => items.map((item, index) => index === sampleIndex ? { status: sampleRunItemStatus(result), result } : item));
          setRunResult(formatSampleProgress(resultsByIndex.filter((item): item is ProblemSampleRunResult => Boolean(item)), runnableProblem.examples.length));
          return result;
        };
        const canRunInParallel = /^(?:cpp|cpp17|c\+\+|c\+\+17|javascript|typescript)$/i.test(languageToRun.trim());
        if (canRunInParallel) {
          await Promise.all(runnableProblem.examples.map((_, sampleIndex) => runOneSample(sampleIndex)));
        } else {
          for (let sampleIndex = 0; sampleIndex < runnableProblem.examples.length; sampleIndex += 1) await runOneSample(sampleIndex);
        }
        if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
        const results = resultsByIndex.filter((item): item is ProblemSampleRunResult => Boolean(item));
        activeAttempt = await activeAttemptPromise;
        const passed = sampleRunStatus(results);
        setRunPassed(passed);
        setRunResult(formatAllSampleResults(results));
        if (passed === true && activeAttempt?.id) {
          setRunning(false);
          try {
            await store.finishAttempt?.(activeAttempt.id, { endedAt: Date.now(), durationSeconds: durationAtStart, code: codeToRun, language: languageToRun, result: 'sample-passed' });
            setMessage('全部样例通过，练习已自动完成。');
          } catch (error) {
            setMessage(error instanceof Error ? `样例已通过，但保存练习记录失败：${error.message}` : '样例已通过，但保存练习记录失败。');
          }
        }
        return;
      }

      const runner = store.runCode ?? store.runLocalCode;
      if (!runner) throw new Error('本地运行服务尚未初始化。');
      if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
      const activeAttemptPromise = ensureActiveAttempt({ code: codeToRun, language: languageToRun, durationSeconds: durationAtStart }).catch(() => undefined);
      const resultsByIndex: Array<ProblemSampleRunResult | undefined> = [];
      const runOneSample = async (sampleIndex: number): Promise<ProblemSampleRunResult> => {
        const example = runnableProblem.examples[sampleIndex];
        setSampleRunItems((items) => items.map((item, index) => index === sampleIndex ? { ...item, status: 'running' } : item));
        setRunResult(`正在运行样例 ${sampleIndex + 1} / ${runnableProblem.examples.length}…`);
        let result;
        try {
          result = await runner({ language: languageToRun, code: codeToRun, input: example.input, timeoutMs: 3000 });
        } catch (error) {
          result = sampleRunFailure(error, sampleIndex, example.output);
        }
        const actualOutput = result.output.trim();
        const completed: ProblemSampleRunResult = {
          ...result,
          sampleIndex,
          expectedOutput: example.output,
          actualOutput,
          passed: result.ok && example.output.trim() ? outputsEqual(actualOutput, example.output) : undefined,
          generatedEntryPoint: false,
          mode: 'stdin',
        };
        resultsByIndex[sampleIndex] = completed;
        if (!isCurrentProblemRequest(requestGeneration, problemId)) return completed;
        setSampleRunItems((items) => items.map((item, index) => index === sampleIndex ? { status: sampleRunItemStatus(completed), result: completed } : item));
        setRunResult(formatSampleProgress(resultsByIndex.filter((item): item is ProblemSampleRunResult => Boolean(item)), runnableProblem.examples.length));
        return completed;
      };
      const canRunInParallel = /^(?:javascript|typescript)$/i.test(languageToRun.trim());
      if (canRunInParallel) {
        await Promise.all(runnableProblem.examples.map((_, sampleIndex) => runOneSample(sampleIndex)));
      } else {
        for (let sampleIndex = 0; sampleIndex < runnableProblem.examples.length; sampleIndex += 1) await runOneSample(sampleIndex);
      }
      if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
      const results = resultsByIndex.filter((item): item is ProblemSampleRunResult => Boolean(item));
      activeAttempt = await activeAttemptPromise;
      const passed = sampleRunStatus(results);
      setRunPassed(passed);
      setRunResult(formatAllSampleResults(results));
      if (passed === true && activeAttempt?.id) {
        setRunning(false);
        try {
          await store.finishAttempt?.(activeAttempt.id, { endedAt: Date.now(), durationSeconds: durationAtStart, code: codeToRun, language: languageToRun, result: 'sample-passed' });
          setMessage('全部样例通过，练习已自动完成。');
        } catch (error) {
          setMessage(error instanceof Error ? `样例已通过，但保存练习记录失败：${error.message}` : '样例已通过，但保存练习记录失败。');
        }
      }
    } catch (error) {
      if (!isCurrentProblemRequest(requestGeneration, problemId)) return;
      setRunPassed(false);
      setRunResult(error instanceof Error ? `样例运行失败\n${error.message}` : '样例运行失败。');
    } finally {
      runningCodeRef.current = false;
      if (isCurrentProblemRequest(requestGeneration, problemId)) setRunningCode(false);
    }
  };

  if (!problem) {
    return (
      <>
        <PageHeader eyebrow="做题工作台" title="先选择一道题。" description="从个人题库或官方平台绑定题目后，计时、代码和思路才会建立关联。" />
        <EmptyState title="没有可练习的题目" message="去题库建立学习卡，或从官方平台绑定当前题。" action={<button className="button buttonPrimary" type="button" onClick={() => navigate('/problems')}>前往题库</button>} />
      </>
    );
  }

  const aiStatusLabel = aiStatus === 'streaming'
    ? '正在阅读代码并组织提示'
    : aiStatus === 'cancelling'
      ? '正在取消'
      : aiStatus === 'done'
        ? '已结合最新代码完成'
        : aiStatus === 'cancelled'
          ? '生成已取消'
          : aiStatus === 'error'
            ? '生成失败'
            : aiConfigured ? '等待你的问题' : '未配置 AI';

  return (
    <div ref={solvePageRef} className={styles.solvePage}>
      <div className={styles.solveWorkspace}>
        <section className={styles.solveProblem}>
          <div className={styles.solveProblemHeader}>
            <div className={styles.solveProblemIdentity}>
              <div className={styles.solveProblemMeta}>
                <span className={styles.solveSectionLabel}><BookOpenCheck size={14} />{sourceLabel(problem.source)} · {difficultyLabel(problem.difficulty)}</span>
                <div className={styles.tags}>{problem.tags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>)}</div>
              </div>
              <h1 title={problem.title}>{problemDisplayTitle(problem)}</h1>
              <div className={styles.solveProblemNavigator}>
                <button className="button" type="button" aria-label="上一题" disabled={!previousProblem} onClick={() => previousProblem && navigate(`/solve/${previousProblem.id}`)}>
                  <ChevronLeft size={14} /><span>上一题</span>
                </button>
                <select className="select" aria-label="选择题库题目" value={problem.id} onChange={(event) => navigate(`/solve/${event.target.value}`)}>
                  {algorithmProblems.map((item) => <option key={item.id} value={item.id}>{problemPickerLabel(item, practicedProblemIds)}</option>)}
                </select>
                <button className="button" type="button" aria-label="下一题" disabled={!nextProblem} onClick={() => nextProblem && navigate(`/solve/${nextProblem.id}`)}>
                  <span>下一题</span><ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className={styles.solveProblemActions}>
              {message && (
                <span className={styles.solveInlineNotice} title={message} aria-live="polite">
                  <CheckCircle2 size={14} /><span>{message}</span>
                </span>
              )}
              {problem.sourceUrl && (
                <button className="button" type="button" onClick={() => window.open(problem.sourceUrl, '_blank')}>
                  <ExternalLink size={14} />官方题面
                </button>
              )}
              <button className="button" type="button" disabled={sampleBusy || runningCode} onClick={() => void replenishSamples()}>
                <RefreshCw size={14} className={sampleBusy ? styles.spin : undefined} />{sampleBusy ? '补齐中' : '补齐样例'}
              </button>
              <button className="button" type="button" disabled={sampleBusy || runningCode} onClick={() => openSampleEditor()}>
                <Pencil size={14} />编辑样例
              </button>
              <button className="button" type="button" aria-haspopup="dialog" onClick={openProblemReader}>
                <BookOpenCheck size={14} />显示全文
              </button>
            </div>
          </div>
          <div className={styles.solveProblemBody} key={problem.id}>
            <div className={styles.problemText}>{problem.content || '当前学习卡只保存了题目链接。可打开官方题面阅读，并在下方直接编写解题函数。'}</div>
            <div className={styles.solveExamples}>
              {problem.examples.length ? problem.examples.map((example, index) => (
                <div className={styles.solveExample} key={`${example.input}-${index}`}>
                  <strong>样例 {index + 1}</strong>
                  <pre className="mono">输入：{example.input}{'\n'}输出：{example.output}</pre>
                  {example.explanation && <p>{example.explanation}</p>}
                </div>
              )) : (
                <div className={`${styles.solveExample} ${styles.solveExampleEmpty}`}>
                  <strong>暂无公开样例</strong>
                  <p>补充输入和预期输出后即可在本地运行。</p>
                  <button className="button" type="button" disabled={sampleBusy || runningCode} onClick={() => openSampleEditor()}><Pencil size={13} />编辑样例</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className={styles.solveWorkbench}>
          <section className={styles.codeWorkbench}>
            <div className={styles.solveToolbar}>
              <div className={styles.codeWorkbenchTitle}>
                <Code2 size={16} />
                <div><strong>代码编辑器</strong><span>只写解题函数，样例入口由应用生成</span></div>
              </div>
              <div className={styles.buttonRow}>
                <div className={styles.timer}><Clock3 size={15} />{formatDuration(seconds)}</div>
                <select className="select" value={language} onChange={(event) => {
                  const nextLanguage = event.target.value;
                  const currentSnippet = findProblemCodeSnippet(problem, language);
                  const editorIsPristine = !code.trim() || code === DEFAULT_CODE || code === currentSnippet;
                  setLanguage(nextLanguage);
                  if (editorIsPristine) {
                    codeProblemIdRef.current = problem?.id;
                    setCode(findProblemCodeSnippet(problem, nextLanguage) ?? DEFAULT_CODE);
                  }
                }} aria-label="编程语言">
                  <option value="cpp">C++17</option>
                  <option value="python">Python 3</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                </select>
                <select
                  className={`${styles.editorFontSizeSelect} select`}
                  aria-label="代码字号"
                  value={String(editorFontSize)}
                  onChange={(event) => void store.updateSettings?.({ editorFontSize: Number(event.target.value) as EditorFontSize })}
                >
                  {EDITOR_FONT_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}
                </select>
                {!running
                  ? <button className="iconButton" title="开始计时" aria-label="开始计时" type="button" onClick={begin}><Play size={14} /></button>
                  : <button className="iconButton" title="暂停计时" aria-label="暂停计时" type="button" onClick={() => setRunning(false)}><Pause size={14} /></button>}
                <button className="button buttonAccent" type="button" disabled={runningCode} onClick={runSample}><TestTube2 size={14} />{runningCode ? '运行中' : '运行全部样例'}</button>
                <button className="iconButton" type="button" title="保存草稿" aria-label="保存草稿" disabled={!attempt?.id} onClick={() => attempt?.id && store.updateAttempt?.(attempt.id, { code, language, durationSeconds: seconds })}><Save size={15} /></button>
              </div>
            </div>

            <div className={styles.solveEditor}>
              <Suspense fallback={<div className={styles.notice} style={{ margin: 16 }}>正在加载本地编辑器…</div>}>
                <MonacoEditor height="100%" language={language === 'cpp' ? 'cpp' : language} value={code} onChange={(value) => {
                  codeProblemIdRef.current = problem?.id;
                  setCode(value ?? '');
                }} theme={editorTheme} options={{ minimap: { enabled: false }, fontSize: editorFontSize, fontFamily: 'JetBrains Mono, Consolas, monospace', scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, wordWrap: 'on' }} />
              </Suspense>
            </div>

          </section>

          <aside className={styles.aiCoachPane}>
            <div className={styles.aiCoachHeader}>
              <div className={styles.aiCoachIdentity}>
                <span><Bot size={17} /></span>
                <div><strong>AI 代码教练</strong><small>始终读取题面、当前代码与运行反馈</small></div>
              </div>
              <div className={styles.aiStatusGroup}>
                <i data-status={aiStatus} />
                <span>{aiStatusLabel}</span>
                {busyCoach && <button className="button buttonDanger" type="button" onClick={cancelCoach} disabled={aiStatus === 'cancelling'}><Square size={12} />停止</button>}
              </div>
            </div>

            <div className={styles.coachIntents} aria-label="AI 代码教练快捷操作">
              {COACH_ACTIONS.map((action) => {
                const hasCachedAnswer = cachedCoachIntents.has(action.intent);
                const needsRunResult = action.intent === 'debug' && runPassed === null && !hasCachedAnswer;
                const needsAiConfiguration = !aiConfigured && !hasCachedAnswer;
                const Icon = hasCachedAnswer ? CheckCircle2 : action.icon;
                return (
                  <button
                    className={`${styles.coachIntentButton} ${hasCachedAnswer ? styles.coachIntentCached : ''} ${activeIntent === action.intent ? styles.coachIntentActive : ''}`}
                    type="button"
                    key={action.intent}
                    data-cached={hasCachedAnswer}
                    disabled={busyCoach || needsAiConfiguration || needsRunResult}
                    onClick={() => void requestCoach(action.intent)}
                    title={hasCachedAnswer ? '已有回答，点击直接查看' : needsAiConfiguration ? '请先在设置中保存 AI 密钥并填写模型 ID' : needsRunResult ? '请先运行一次样例' : action.description}
                  >
                    <Icon size={14} />
                    <span><strong>{action.label}</strong><small>{hasCachedAnswer ? '已有回答，点击查看' : action.description}</small></span>
                  </button>
                );
              })}
            </div>

            <div ref={aiPanelRef} className={styles.aiConversation} aria-label="AI 回答记录" aria-live="polite" aria-busy={busyCoach}>
              {!visibleCoachTurns.length && !streamingAnswer && !busyCoach && (
                <div className={styles.aiCoachEmpty}>
                  <Sparkles size={25} />
                  <strong>把编辑器当作共同工作区</strong>
                  <span>教练不会只复述算法思路。你可以在下方直接问某行代码、变量变化、报错原因或为什么要这样设计算法。</span>
                </div>
              )}
              {visibleCoachTurns.map((turn) => (
                <article className={styles.aiCoachTurn} key={turn.id}>
                  <header>
                    <span>{turn.label}</span>
                    {turn.question && <small title={turn.question}>{turn.question}</small>}
                  </header>
                  <AiCoachContent content={turn.answer} busy={false} complete={turn.intent === 'complete'} />
                  {turn.error && <div className={styles.aiStreamMessage}>{turn.error}</div>}
                  <footer className={styles.aiCoachTurnFooter}>
                    <button
                      className={styles.aiCoachTurnJump}
                      type="button"
                      aria-label={`回到“${turn.label}”回答开头`}
                      onClick={(event) => scrollCoachTurnToStart(event.currentTarget.closest('article'))}
                    >
                      <ArrowUpToLine size={14} />回到本条开头
                    </button>
                  </footer>
                </article>
              ))}
              {busyCoach && (
                <article className={`${styles.aiCoachTurn} ${styles.aiCoachTurnStreaming}`}>
                  <header><span>{coachIntentLabel(activeIntent)}</span><small>正在结合编辑器中的最新内容</small></header>
                  {streamingAnswer
                    ? <AiCoachContent content={streamingAnswer} busy complete={activeIntent === 'complete'} />
                    : <div className={styles.aiStreamWaiting}>正在读取题面、代码和最近运行反馈…</div>}
                </article>
              )}
              {aiError && !busyCoach && <div className={styles.aiStreamMessage}>{aiError}</div>}
            </div>

            <div className={styles.aiCoachComposer}>
              <textarea
                value={coachQuestion}
                onChange={(event) => setCoachQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendQuestion();
                  }
                }}
                placeholder="把不懂的代码、报错或概念直接问我，Enter 发送"
                aria-label="向 AI 代码教练提问"
              />
              <button className="iconButton" type="button" title="发送问题" aria-label="发送问题" disabled={busyCoach || !coachQuestion.trim()} onClick={sendQuestion}><Play size={14} /></button>
            </div>
          </aside>
        </div>
      </div>

      <dialog
        className={`${styles.dialog} ${styles.sampleResultDialog}`}
        ref={sampleResultDialogRef}
        aria-labelledby="sample-result-title"
      >
        <div className={styles.dialogHead}>
          <div>
            <span className={styles.solveSectionLabel}><TestTube2 size={14} />本地样例运行</span>
            <h2 id="sample-result-title">运行结果</h2>
          </div>
          <button className="iconButton" type="button" title="关闭运行结果" aria-label="关闭运行结果" onClick={() => sampleResultDialogRef.current?.close()}><X size={17} /></button>
        </div>
        <div className={styles.sampleResultDialogBody}>
          <div className={`${styles.runResultPanel} ${runPassed === true ? styles.runResultPassed : ''} ${runPassed === false ? styles.runResultFailed : ''}`} aria-live="polite">
            {runPassed === true ? <CheckCircle2 size={17} /> : runPassed === false ? <AlertTriangle size={17} /> : <TestTube2 size={17} />}
            <div>
              <pre>{runResult}</pre>
              {sampleRunItems.length > 0 && (
                <div className={styles.sampleRunList} aria-label="样例运行进度">
                  {sampleRunItems.map((item, index) => {
                    const statusClass = item.status === 'passed'
                      ? styles.sampleRunPassed
                      : item.status === 'failed'
                        ? styles.sampleRunFailed
                        : item.status === 'running'
                          ? styles.sampleRunRunning
                          : '';
                    return (
                      <div className={`${styles.sampleRunItem} ${statusClass}`} key={`sample-run-${index}`}>
                        <span className={styles.sampleRunMarker} aria-hidden="true">
                          {item.status === 'passed' ? <CheckCircle2 size={13} /> : item.status === 'failed' ? <AlertTriangle size={13} /> : item.status === 'running' ? <RefreshCw size={13} className={styles.spin} /> : <span>{index + 1}</span>}
                        </span>
                        <span className={styles.sampleRunLabel}>样例 {index + 1}</span>
                        <strong>{sampleRunStatusLabel(item.status)}</strong>
                        {item.result && <small>{formatProblemSampleResult(item.result).split('\n')[1] ?? ''}</small>}
                      </div>
                    );
                  })}
                </div>
              )}
              {runPassed === false && (
                <div className={styles.buttonRow}>
                  <button className="button" type="button" disabled={busyCoach || !aiConfigured} onClick={() => void requestCoach('debug')} title={!aiConfigured ? '请先在设置中配置 AI 服务' : '让 AI 结合运行结果定位错误'}>
                    <AlertTriangle size={14} />失败复盘
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </dialog>

      <dialog
        className={`${styles.dialog} ${styles.problemReaderDialog}`}
        ref={problemReaderDialogRef}
        aria-labelledby="problem-reader-title"
      >
        <div className={`${styles.dialogHead} ${styles.problemReaderHead}`}>
          <div className={styles.problemReaderTitle}>
            <span className={styles.solveSectionLabel}><BookOpenCheck size={14} />{sourceLabel(problem.source)} · {difficultyLabel(problem.difficulty)}</span>
            <h2 id="problem-reader-title">{problemDisplayTitle(problem)}</h2>
          </div>
          <button className="iconButton" type="button" title="关闭题面" aria-label="关闭题面阅读" onClick={() => problemReaderDialogRef.current?.close()}><X size={17} /></button>
        </div>
        <div className={styles.problemReaderBody}>
          <article className={styles.problemReaderScroll} aria-label="完整题目内容">
            <div className={styles.problemReaderText}>{problem.content || '当前学习卡只保存了题目链接。'}</div>
          </article>
          <aside className={styles.problemReaderExamples} aria-label="题目样例">
            <div className={styles.solveExamples}>
              {problem.examples.length ? problem.examples.map((example, index) => (
                <div className={styles.solveExample} key={`${example.input}-${index}`}>
                  <strong>样例 {index + 1}</strong>
                  <pre className="mono">输入：{example.input}{'\n'}输出：{example.output}</pre>
                  {example.explanation && <p>{example.explanation}</p>}
                </div>
              )) : (
                <div className={`${styles.solveExample} ${styles.solveExampleEmpty}`}>
                  <strong>暂无公开样例</strong>
                  <p>可返回做题页补充输入和预期输出。</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </dialog>

      <dialog
        className={`${styles.dialog} ${styles.sampleDialog}`}
        ref={sampleDialogRef}
        aria-labelledby="sample-editor-title"
        aria-busy={sampleBusy}
        onCancel={(event) => { if (sampleBusy) event.preventDefault(); }}
        onClose={() => setSampleEditorMessage('')}
      >
        <div className={styles.dialogHead}>
          <h2 id="sample-editor-title">编辑样例</h2>
          <button className="iconButton" type="button" aria-label="关闭样例编辑器" disabled={sampleBusy} onClick={() => sampleDialogRef.current?.close()}><X size={17} /></button>
        </div>
        <form className={`${styles.dialogBody} ${styles.sampleDialogBody}`} onSubmit={(event) => { event.preventDefault(); void saveSamples(); }}>
          <div className={styles.sampleEditorTop}>
            <div className={styles.sampleEditorIntro}>
              <span>输入与预期输出为必填项，解释可选。</span>
              <button className="button" type="button" disabled={sampleBusy || sampleDrafts.length >= 20} onClick={addSampleDraft}><Plus size={14} />新增样例</button>
            </div>
            {sampleEditorMessage && <div className={styles.sampleEditorNotice} role="status" aria-live="polite">{sampleEditorMessage}</div>}
          </div>
          <div className={styles.sampleEditorList}>
            {sampleDrafts.map((draft, index) => (
              <section className={styles.sampleEditorItem} key={index} aria-labelledby={`sample-${index + 1}-title`}>
                <div className={styles.sampleEditorItemHead}>
                  <strong id={`sample-${index + 1}-title`}>样例 {index + 1}</strong>
                  <button className="iconButton" type="button" title={`删除样例 ${index + 1}`} aria-label={`删除样例 ${index + 1}`} disabled={sampleBusy} onClick={() => removeSampleDraft(index)}><Trash2 size={14} /></button>
                </div>
                <div className={styles.sampleEditorPair}>
                  <label className={styles.sampleEditorField}>
                    <span>输入</span>
                    <textarea rows={2} value={draft.input} disabled={sampleBusy} aria-invalid={sampleFieldError?.index === index && sampleFieldError.field === 'input' ? 'true' : undefined} aria-label={`样例 ${index + 1} 输入`} onChange={(event) => updateSampleDraft(index, 'input', event.target.value)} />
                  </label>
                  <label className={styles.sampleEditorField}>
                    <span>预期输出</span>
                    <textarea rows={2} value={draft.output} disabled={sampleBusy} aria-invalid={sampleFieldError?.index === index && sampleFieldError.field === 'output' ? 'true' : undefined} aria-label={`样例 ${index + 1} 预期输出`} onChange={(event) => updateSampleDraft(index, 'output', event.target.value)} />
                  </label>
                </div>
                <label className={styles.sampleEditorField}>
                  <span>解释 <small>可选</small></span>
                  <textarea rows={1} value={draft.explanation ?? ''} disabled={sampleBusy} aria-label={`样例 ${index + 1} 解释`} onChange={(event) => updateSampleDraft(index, 'explanation', event.target.value)} />
                </label>
              </section>
            ))}
          </div>
          <div className={styles.sampleEditorActions}>
            <button className="button" type="button" disabled={sampleBusy} onClick={() => sampleDialogRef.current?.close()}>取消</button>
            <button className="button buttonPrimary" type="submit" disabled={sampleBusy}><Save size={14} />{sampleBusy ? '保存中' : '保存样例'}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
