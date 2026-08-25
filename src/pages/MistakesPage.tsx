import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Copy,
  Dices,
  Redo2,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Target,
  TestTube2,
  Trophy,
  Undo2,
  BookOpenCheck,
} from 'lucide-react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useStoreView } from '../app/storeAdapter';
import { EmptyState, Metric, PageHeader } from '../components/PagePrimitives';
import { findProblemCodeSnippet } from './SolvePage';
import { formatProblemSampleResult } from '../lib/problemRunner';
import { EDITOR_FONT_SIZES } from '../lib/data';
import type { Problem, ProblemExample, ProblemSampleRunResult, EditorFontSize } from '../types';
import type { InterviewCoachIntent } from '../lib/ai';
import styles from './Pages.module.css';

const MonacoEditor = lazy(() => import('../lib/localMonaco'));

const LANGUAGES = [
  { value: 'cpp', label: 'C++17' },
  { value: 'python', label: 'Python 3' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
] as const;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/* ================================================================
   算法题复习 — 完全复用做题页面样式
   ================================================================ */
function AlgorithmReview({ problem, onDone }: { problem: Problem; onDone: () => void }) {
  const store = useStoreView();
  const defaultLang = store.settings.defaultLanguage ?? 'cpp';
  const [language, setLanguage] = useState(defaultLang);
  const codeRef = useRef(findProblemCodeSnippet(problem, defaultLang) ?? '');
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [editorHistory, setEditorHistory] = useState({ canUndo: false, canRedo: false });
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [runningCode, setRunningCode] = useState(false);
  const [sampleItems, setSampleItems] = useState<Array<{ status: 'pending' | 'running' | 'passed' | 'failed' | 'unknown'; result?: ProblemSampleRunResult }>>([]);
  const [runResult, setRunResult] = useState('还没有运行样例。');
  const [runPassed, setRunPassed] = useState<boolean | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // 拖拽
  const [splitLeft, setSplitLeft] = useState(42);
  const resizeRef = useRef<{ startX: number; startRatio: number; containerWidth: number } | null>(null);
  const terminalResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (running) timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [running]);

  const switchLanguage = useCallback((nextLang: string) => {
    setLanguage(nextLang);
    const snippet = findProblemCodeSnippet(problem, nextLang) ?? '';
    codeRef.current = snippet;
    editorRef.current?.setValue(snippet);
  }, [problem]);

  const handleCodeChange = useCallback((value: string | undefined) => { codeRef.current = value ?? ''; }, []);

  const handleEditorMount = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    // ── 撤销/重做状态同步（debounce 版）──
    // 旧版每次 onDidChangeModelContent 都检查 canUndo/canRedo → 可能 setState → 重渲染整个页面。
    // 改为 debounce 200ms，避免快速打字时频繁触发 React 重渲染。
    let last = { canUndo: false, canRedo: false };
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (debounceTimer !== undefined) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        const m = editor.getModel();
        if (!m || m.isDisposed()) return;
        const u = Boolean(m?.canUndo()), r = Boolean(m?.canRedo());
        if (u === last.canUndo && r === last.canRedo) return;
        last = { canUndo: u, canRedo: r };
        setEditorHistory({ canUndo: u, canRedo: r });
      }, 200);
    };
    editor.onDidChangeModelContent(sync);
    sync();
  }, []);

  const undoCode = () => editorRef.current?.trigger('keyboard', 'undo', null);
  const redoCode = () => editorRef.current?.trigger('keyboard', 'redo', null);

  // 拖拽：记录容器宽度，用像素差计算百分比
  const beginSplitDrag = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    resizeRef.current = { startX: e.clientX, startRatio: splitLeft, containerWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const deltaPercent = (delta / resizeRef.current.containerWidth) * 100;
      setSplitLeft(Math.min(Math.max(20, resizeRef.current.startRatio + deltaPercent), 75));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [splitLeft]);

  // 终端高度拖拽
  const beginTerminalDrag = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    // 如果终端未打开，先打开终端再开始拖拽，否则 height:auto 会覆盖 CSS 变量导致拖拽无效
    if (!terminalOpen) setTerminalOpen(true);
    const startY = e.clientY;
    const startHeight = terminalHeight ?? 180;
    terminalResizeRef.current = { startY, startHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      if (!terminalResizeRef.current) return;
      const delta = terminalResizeRef.current.startY - ev.clientY;
      setTerminalHeight(Math.min(Math.max(96, terminalResizeRef.current.startHeight + delta), 420));
    };
    const onUp = () => {
      terminalResizeRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [terminalHeight, terminalOpen]);

  const runSamples = async () => {
    if (runningCode || !store.runProblemSample) return;
    setRunningCode(true);
    setRunPassed(null);
    setTerminalOpen(true);
    setRunResult('正在准备样例…');
    const runnable = problem.examples.length > 0 ? problem.examples : [];
    if (!runnable.length) { setRunResult('这道题没有样例。'); setRunningCode(false); return; }
    setSampleItems(runnable.map(() => ({ status: 'pending' as const })));
    setRunResult(`已准备 ${runnable.length} 条样例，等待运行…`);
    await new Promise<void>((r) => window.setTimeout(r, 0));
    const all: ProblemSampleRunResult[] = [];
    let pass = true;
    for (let i = 0; i < runnable.length; i++) {
      setSampleItems((items) => items.map((it, idx) => idx === i ? { ...it, status: 'running' } : it));
      setRunResult(`正在运行样例 ${i + 1} / ${runnable.length}…`);
      let result: ProblemSampleRunResult;
      try { result = await store.runProblemSample({ problem, language, code: codeRef.current, sampleIndex: i, timeoutMs: 5000 }); }
      catch (err) { result = { ok: false, output: '', error: err instanceof Error ? err.message : '运行失败', durationMs: 0, timedOut: false, sampleIndex: i, expectedOutput: runnable[i]?.output ?? '', actualOutput: '', generatedEntryPoint: false, mode: 'stdin' }; }
      all.push(result);
      if (!result.ok || result.passed === false) pass = false;
      setSampleItems((items) => items.map((it, idx) => idx === i ? { status: (!result.ok || result.passed === false) ? 'failed' : result.passed === true ? 'passed' : 'unknown', result } : it));
      const pc = all.filter((r) => r.ok && r.passed === true).length;
      const fc = all.filter((r) => !r.ok || r.passed === false).length;
      setRunResult(`已运行 ${all.length} / ${runnable.length} 条样例：${pc} 条通过，${fc} 条未通过`);
    }
    setRunPassed(pass);
    setRunningCode(false);
  };

  const finish = () => { void store.recordReview?.(problem.id, 'algorithm'); onDone(); };
  const editorTheme = (store.settings.theme ?? 'dark') === 'dark' ? 'vs-dark' : 'vs';
  const editorFontSize = store.settings.editorFontSize ?? 16;

  return (
    <div className={styles.reviewPractice}>
      <header className={styles.reviewPracticeHeader}>
        <button className="button" type="button" onClick={onDone}><ArrowLeft size={15} />返回</button>
        <div className={styles.reviewPracticeTitle}>
          <h2>{problem.externalId ? `${problem.externalId}. ` : ''}{problem.title}</h2>
          <div className={styles.tags}>{problem.tags.slice(0, 5).map((t) => <span className={styles.tag} key={t}>{t}</span>)}</div>
        </div>
        <div className={styles.reviewTimer}><Clock3 size={14} /><span>{formatDuration(seconds)}</span></div>
      </header>

      {/* 三列：题干 | 拖拽手柄 | 代码区 */}
      <div className={styles.reviewPracticeGrid} style={{ gridTemplateColumns: `${splitLeft}% 8px 1fr` }}>
        {/* 左：题干 — 复用 solveProblem 样式 */}
        <section className={styles.solveProblem} style={{ borderRadius: 6 }}>
          <div className={styles.solveProblemHeader}>
            <div className={styles.solveProblemIdentity}>
              <span className={styles.solveSectionLabel}><BookOpenCheck size={14} />题干</span>
              <h1 style={{ fontSize: 15 }}>{problem.externalId ? `${problem.externalId}. ` : ''}{problem.title}</h1>
              <div className={styles.tags}>{problem.tags.slice(0, 5).map((t) => <span className={styles.tag} key={t}>{t}</span>)}</div>
            </div>
          </div>
          <div className={styles.solveProblemBody}>
            <div className={styles.problemText}>{problem.content || '当前学习卡只保存了题目链接。'}</div>
            {problem.examples.length > 0 && (
              <div className={styles.solveExamples}>
                {problem.examples.map((ex: ProblemExample, i: number) => (
                  <div className={styles.solveExample} key={`${ex.input}-${i}`}>
                    <strong>样例 {i + 1}</strong>
                    <pre className="mono">输入：{ex.input}{'\n'}输出：{ex.output}</pre>
                    {ex.explanation && <p>{ex.explanation}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 拖拽手柄 — 复用 workbenchResizeHandle 样式 */}
        <div className={styles.workbenchResizeHandle} onPointerDown={beginSplitDrag} role="separator" aria-orientation="vertical" aria-label="调整宽度" tabIndex={0} />

        {/* 右：代码编辑器 + 终端 — 完全复用做题页面结构 */}
        <section className={styles.codeWorkbench}>
          <div className={styles.solveToolbar}>
            <div className={styles.codeWorkbenchTitle}>
              <Code2 size={16} />
              <div><strong>代码编辑器</strong><span>只写解题函数，样例入口由应用生成</span></div>
            </div>
            <div className={styles.buttonRow}>
              <div className={styles.timer}><Clock3 size={15} />{formatDuration(seconds)}</div>
              <select className="select" value={language} onChange={(e) => switchLanguage(e.target.value)} aria-label="编程语言">
                <option value="cpp">C++17</option>
                <option value="python">Python 3</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
              <select className={`${styles.editorFontSizeSelect} select`} aria-label="代码字号" value={String(editorFontSize)} onChange={(e) => void store.updateSettings?.({ editorFontSize: Number(e.target.value) as EditorFontSize })}>
                {EDITOR_FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
              </select>
              {!running
                ? <button className="iconButton" title="开始计时" type="button" onClick={() => setRunning(true)}><Target size={14} /></button>
                : <button className="iconButton" title="暂停计时" type="button" onClick={() => setRunning(false)}><Square size={12} /></button>}
              <button className="button buttonAccent" type="button" disabled={runningCode} onClick={() => void runSamples()}><TestTube2 size={14} />{runningCode ? '运行中' : '运行全部样例'}</button>
              <button className="iconButton" type="button" title="撤销 (Ctrl+Z)" disabled={!editorHistory.canUndo} onClick={undoCode}><Undo2 size={15} /></button>
              <button className="iconButton" type="button" title="还原 (Ctrl+Y)" disabled={!editorHistory.canRedo} onClick={redoCode}><Redo2 size={15} /></button>
            </div>
          </div>

          <div className={styles.solveEditor} key={`${problem.id}:${language}`}>
            <Suspense fallback={<div className={styles.notice} style={{ margin: 16 }}>正在加载本地编辑器…</div>}>
              <MonacoEditor height="100%" language={language === 'cpp' ? 'cpp' : language} defaultValue={codeRef.current} theme={editorTheme} options={{
                fontSize: editorFontSize, fontFamily: 'JetBrains Mono, Consolas, monospace', tabSize: 4, insertSpaces: true, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 0, bottom: 0 },
                wordWrap: 'off', codeLens: false, folding: false, stickyScroll: { enabled: true },
                // ── 补全/建议 ──
                quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: 'off', suggestSelection: 'first', tabCompletion: 'on',
                // ── 输入/编辑 ──
                autoClosingBrackets: 'languageDefined' as const, autoClosingQuotes: 'languageDefined' as const, autoClosingDelete: 'never' as const, autoClosingOvertype: 'never' as const, autoIndent: 'advanced', formatOnPaste: false, formatOnType: false,
                // ── Tokenization 限制 ──
                maxTokenizationLineLength: 4096, largeFileOptimizations: true,
                // ── 光标/滚动 ──
                smoothScrolling: false, cursorSmoothCaretAnimation: 'off', cursorBlinking: 'solid',
                // ── 装饰/高亮 ──
                renderLineHighlight: 'none', occurrencesHighlight: 'off', selectionHighlight: false, colorDecorators: false, renderValidationDecorations: 'off', renderWhitespace: 'none',
                bracketPairColorization: { enabled: false }, matchBrackets: 'never',
                guides: { bracketPairs: false, bracketPairsHorizontal: false, highlightActiveBracketPair: false, indentation: false, highlightActiveIndentation: false },
                // ── Hover/Inlay ──
                hover: { enabled: false }, links: false, parameterHints: { enabled: false },
                // ── 布局/Chrome ──
                minimap: { enabled: false }, scrollbar: { verticalSliderSize: 8, horizontalSliderSize: 8, useShadows: false }, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, fixedOverflowWidgets: false,
                unicodeHighlight: { nonBasicASCII: false, invisibleCharacters: false, ambiguousCharacters: false, includeComments: false, includeStrings: false },
              }} onChange={handleCodeChange} onMount={handleEditorMount} />
            </Suspense>
          </div>

          {/* 终端 — 复用 inlineTerminal 样式 */}
          <section className={`${styles.inlineTerminal} ${terminalOpen ? styles.inlineTerminalOpen : ''}`} style={terminalHeight ? { '--terminal-height': `${terminalHeight}px` } as React.CSSProperties : undefined}>
            <div
              className={styles.terminalResizeHandle}
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整终端高度"
              tabIndex={terminalOpen ? 0 : -1}
              onPointerDown={beginTerminalDrag}
              onDoubleClick={() => setTerminalHeight(null)}
            />
            <header className={styles.inlineTerminalHeader}>
              <div className={styles.inlineTerminalTitle}><TestTube2 size={14} /><strong>运行终端</strong><small>样例输出</small></div>
              <button className="iconButton" type="button" title={terminalOpen ? '隐藏终端' : '显示终端'} onClick={() => setTerminalOpen((v) => !v)}>{terminalOpen ? <RefreshCw size={14} /> : <TestTube2 size={14} />}</button>
            </header>
            {terminalOpen && <div className={styles.inlineTerminalBody}>
              <div className={`${styles.runResultPanel} ${runPassed === true ? styles.runResultPassed : ''} ${runPassed === false ? styles.runResultFailed : ''}`}>
                {runPassed === true ? <CheckCircle2 size={16} /> : runPassed === false ? <Square size={16} /> : <TestTube2 size={16} />}
                <div>
                  <pre>{runResult}</pre>
                  {sampleItems.length > 0 && (
                    <div className={styles.sampleRunList}>
                      {sampleItems.map((item, i) => (
                        <div className={`${styles.sampleRunItem} ${item.status === 'passed' ? styles.sampleRunPassed : item.status === 'failed' ? styles.sampleRunFailed : item.status === 'running' ? styles.sampleRunRunning : ''}`} key={i}>
                          <span className={styles.sampleRunMarker}>
                            {item.status === 'passed' ? <CheckCircle2 size={12} /> : item.status === 'failed' ? <Square size={12} /> : item.status === 'running' ? <RefreshCw size={12} className={styles.spin} /> : <span>{i + 1}</span>}
                          </span>
                          <span className={styles.sampleRunLabel}>样例 {i + 1}</span>
                          <strong>{item.status === 'running' ? '运行中' : item.status === 'passed' ? '通过' : item.status === 'failed' ? '未通过' : item.status === 'unknown' ? '无法判定' : '等待中'}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>}
          </section>
        </section>
      </div>

      {runPassed === true && (
        <div className={styles.reviewFinishBar}>
          <span><CheckCircle2 size={15} />全部样例通过！</span>
          <button className="button buttonPrimary" type="button" onClick={finish}><CheckCircle2 size={15} />完成复习</button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   面试题复习
   ================================================================ */
function InterviewReview({ problem, onDone }: { problem: Problem; onDone: () => void }) {
  const store = useStoreView();
  const interview = problem.interview!;
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachOutput, setCoachOutput] = useState('');
  const [coachError, setCoachError] = useState('');
  const [finished, setFinished] = useState<'mastered' | 'uncertain' | 'unknown'>();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const streamRef = useRef('');

  useEffect(() => {
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timerRef.current);
  }, []);

  const hasAi = Boolean(store.settings.hasAiCredential && store.settings.aiModel?.trim() && store.requestAiHint);

  const submit = async () => {
    if (!answer.trim()) return;
    setSubmitted(true);
    // 自动触发 AI 点评
    if (hasAi) {
      setCoachBusy(true);
      setCoachError('');
      setCoachOutput('');
      streamRef.current = '';
      try {
        if (!store.settings.privacyConfirmed) {
          await store.updateSettings?.({ privacyConfirmed: true });
        }
        const result = await store.requestAiHint?.({
          problemId: problem.id,
          intent: 'interview-critique' as InterviewCoachIntent,
          answerText: answer,
          onChunk: (chunk: string) => { streamRef.current += chunk; setCoachOutput(streamRef.current); },
        });
        setCoachOutput((typeof result === 'string' ? result : streamRef.current) || 'AI 没有返回有效内容。');
      } catch (err) {
        setCoachError(err instanceof Error ? err.message : 'AI 服务暂时不可用。');
      } finally {
        setCoachBusy(false);
      }
    }
  };

  const finish = async (result: 'mastered' | 'uncertain' | 'unknown') => {
    setFinished(result);
    void store.recordReview?.(problem.id, 'interview');
    setTimeout(onDone, 600);
  };

  return (
    <div className={styles.reviewPractice}>
      <header className={styles.reviewPracticeHeader}>
        <button className="button" type="button" onClick={onDone}><ArrowLeft size={15} />返回</button>
        <div className={styles.reviewPracticeTitle}>
          <h2>{problem.title}</h2>
          <div className={styles.tags}>{problem.tags.slice(0, 5).map((t) => <span className={styles.tag} key={t}>{t}</span>)}</div>
        </div>
        <div className={styles.reviewTimer}><Clock3 size={14} /><span>{formatDuration(elapsed)}</span></div>
      </header>

      <div className={styles.reviewPracticeGrid}>
        {/* 左：题目和参考 */}
        <section className={styles.reviewProblemPane}>
          <div className={styles.reviewPaneHeader}><BookOpenCheck size={15} /><strong>题目</strong></div>
          <div className={styles.reviewProblemContent}>{problem.content}</div>
          {submitted && (
            <div className={styles.reviewReference}>
              <h3>参考要点</h3>
              <ul>{interview.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul>
              <h3>完整参考答案</h3>
              <p>{interview.referenceAnswer}</p>
              <h3>面试官追问</h3>
              <ol>{interview.followUps.map((q) => <li key={q}>{q}</li>)}</ol>
            </div>
          )}
        </section>

        {/* 右：回答和 AI 评分 */}
        <section className={styles.reviewEditorPane}>
          <div className={styles.reviewEditorToolbar}>
            <div className={styles.reviewToolbarLeft}><Send size={15} /><strong>我的回答</strong></div>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{answer.trim().length} 字</span>
          </div>
          <textarea
            className={styles.reviewAnswerEditor}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="从结论开始，再说明原理、方案权衡、落地细节和风险。"
            aria-label="我的回答"
          />
          {!submitted && (
            <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="button buttonPrimary" type="button" disabled={!answer.trim()} onClick={() => void submit()}><CheckCircle2 size={15} />提交回答</button>
            </div>
          )}

          {/* AI 点评结果 */}
          {submitted && (
            <div className={styles.reviewCoachOutput}>
              {coachBusy ? (
                <div className={styles.reviewCoachLoading}><Sparkles size={15} /><strong>AI 正在分析你的回答…</strong></div>
              ) : coachOutput ? (
                <div><div className={styles.reviewPaneHeader}><Sparkles size={15} /><strong>AI 点评</strong></div><p>{coachOutput}</p></div>
              ) : coachError ? (
                <div className={styles.reviewCoachError}>{coachError}</div>
              ) : !hasAi ? (
                <div className={styles.reviewCoachHint}>配置 AI 后可自动对照参考答案点评回答。</div>
              ) : null}

              {/* 掌握度选择 */}
              <div className={styles.reviewMasteryBar}>
                <span>对照参考内容后，记录掌握度：</span>
                <div>
                  <button className={`${styles.reviewMasteryBtn} ${finished === 'mastered' ? styles.reviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('mastered')}><CheckCircle2 size={14} />已掌握</button>
                  <button className={`${styles.reviewMasteryBtn} ${finished === 'uncertain' ? styles.reviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('uncertain')}><Target size={14} />还需巩固</button>
                  <button className={`${styles.reviewMasteryBtn} ${styles.reviewMasteryDanger} ${finished === 'unknown' ? styles.reviewMasterySelected : ''}`} type="button" disabled={Boolean(finished)} onClick={() => void finish('unknown')}><Square size={14} />完全不会</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ================================================================
   主页面
   ================================================================ */
export function MistakesPage() {
  const store = useStoreView();
  const [message, setMessage] = useState('');
  const [reviewProblem, setReviewProblem] = useState<Problem | null>(null);
  const [reviewKind, setReviewKind] = useState<'algorithm' | 'interview'>('algorithm');

  const practicedAlgorithmProblems = useMemo(() => {
    const ids = new Set(store.attempts.filter((a) => a.endedAt).map((a) => a.problemId));
    return store.problems.filter((p) => p.kind === 'algorithm' && ids.has(p.id));
  }, [store.problems, store.attempts]);

  const practicedInterviewProblems = useMemo(() => {
    const ids = new Set(store.attempts.filter((a) => a.endedAt).map((a) => a.problemId));
    return store.problems.filter((p) => p.kind === 'interview' && ids.has(p.id));
  }, [store.problems, store.attempts]);

  const reviewHistory = store.settings.reviewHistory;
  const algorithmReviewed = reviewHistory?.algorithmReviewedIds?.length ?? 0;
  const interviewReviewed = reviewHistory?.interviewReviewedIds?.length ?? 0;

  const startAlgorithmReview = useCallback(() => {
    if (!store.pickRandomReviewProblem) { setMessage('复习功能尚未就绪。'); return; }
    const problem = store.pickRandomReviewProblem('algorithm');
    if (!problem) { setMessage('还没有练习过的算法题，先去题库做几道吧。'); return; }
    setReviewKind('algorithm');
    setReviewProblem(problem);
  }, [store.pickRandomReviewProblem]);

  const startInterviewReview = useCallback(() => {
    if (!store.pickRandomReviewProblem) { setMessage('复习功能尚未就绪。'); return; }
    const problem = store.pickRandomReviewProblem('interview');
    if (!problem) { setMessage('还没有练习过的面试题，先去面试题库练习几道吧。'); return; }
    setReviewKind('interview');
    setReviewProblem(problem);
  }, [store.pickRandomReviewProblem]);

  const finishReview = useCallback(() => {
    setReviewProblem(null);
    setMessage('复习完成，已记录。');
  }, []);

  // 正在复习中 → 显示练习界面
  if (reviewProblem) {
    return reviewKind === 'algorithm'
      ? <AlgorithmReview problem={reviewProblem} onDone={finishReview} />
      : <InterviewReview problem={reviewProblem} onDone={finishReview} />;
  }

  // 选题界面
  const totalPracticed = practicedAlgorithmProblems.length + practicedInterviewProblems.length;

  return (
    <>
      <PageHeader
        eyebrow="复习"
        title="温故而知新，随机巩固已练过的题目。"
        description="从你练习过的题目中随机抽取一道重新做一遍。算法题靠自己通过样例，面试题由 AI 对照参考答案打分。系统会保证不反复抽同一道，并尽可能把所有题目都复习一遍。"
      />
      {message && <div className={styles.notice}><Check size={17} />{message}</div>}

      <div className={styles.metrics}>
        <Metric label="已练算法题" value={practicedAlgorithmProblems.length} tone="accent" />
        <Metric label="已练面试题" value={practicedInterviewProblems.length} tone="info" />
        <Metric label="算法已复习" value={algorithmReviewed} />
        <Metric label="面试已复习" value={interviewReviewed} />
      </div>

      {totalPracticed === 0 ? (
        <EmptyState
          title="还没有练习记录"
          message="先去「题库」做几道算法题，或去「面试题」练习几道面试题，再回来用复习功能巩固。"
        />
      ) : (
        <div className={styles.reviewGrid}>
          <div className={styles.reviewCard}>
            <div className={styles.reviewCardHeader}>
              <span className={styles.reviewCardIcon}><Dices size={22} /></span>
              <div><h2>算法题复习</h2><p>随机抽取一道已练过的算法题，靠自己通过所有样例</p></div>
            </div>
            <div className={styles.reviewCardBody}>
              <div className={styles.reviewStats}>
                <span>已练习 <strong>{practicedAlgorithmProblems.length}</strong> 道</span>
                <span>已复习 <strong>{algorithmReviewed}</strong> 道</span>
                {practicedAlgorithmProblems.length > 0 && <span>覆盖进度 <strong>{Math.round((algorithmReviewed / practicedAlgorithmProblems.length) * 100)}%</strong></span>}
              </div>
              <p className={styles.reviewHint}><Target size={14} />复习模式下不会显示 AI 教练提示，完全独立完成</p>
              <button className="button buttonPrimary" type="button" disabled={practicedAlgorithmProblems.length === 0} onClick={startAlgorithmReview}>
                <Dices size={15} />随机复习一道算法题
              </button>
            </div>
          </div>

          <div className={styles.reviewCard}>
            <div className={styles.reviewCardHeader}>
              <span className={styles.reviewCardIcon}><BookOpenCheck size={22} /></span>
              <div><h2>面试题复习</h2><p>随机抽取一道已练过的面试题，AI 对照参考答案打分</p></div>
            </div>
            <div className={styles.reviewCardBody}>
              <div className={styles.reviewStats}>
                <span>已练习 <strong>{practicedInterviewProblems.length}</strong> 道</span>
                <span>已复习 <strong>{interviewReviewed}</strong> 道</span>
                {practicedInterviewProblems.length > 0 && <span>覆盖进度 <strong>{Math.round((interviewReviewed / practicedInterviewProblems.length) * 100)}%</strong></span>}
              </div>
              <p className={styles.reviewHint}><Trophy size={14} />AI 会根据参考答案为你的回答打分，帮助查漏补缺</p>
              <button className="button buttonPrimary" type="button" disabled={practicedInterviewProblems.length === 0} onClick={startInterviewReview}>
                <Dices size={15} />随机复习一道面试题
              </button>
            </div>
          </div>
        </div>
      )}

      {algorithmReviewed + interviewReviewed > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}><RefreshCw size={15} />复习队列说明</h3>
          <p className={styles.sectionDesc}>
            系统会优先抽取你还没复习过的题目。当所有做过的题目都复习了一遍后，队列会自动重置，重新开始新一轮复习。
          </p>
        </div>
      )}
    </>
  );
}
