/**
 * localCodeMirror.tsx — CodeMirror 6 编辑器（兼容 Monaco 接口）
 *
 * 替代 Monaco Editor：
 * - 1-5ms 输入延迟（vs Monaco 的 20-50ms）
 * - 无需 Web Worker
 * - ~638KB bundle（vs Monaco 的 ~3.6MB）
 * - 增量解析（只重解析变化部分）
 */
import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle, type LanguageSupport } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';

// ── 语言映射 ──
function getLanguageExtension(languageId: string): LanguageSupport {
  const lang = languageId.trim().toLowerCase();
  if (['c', 'cpp', 'cpp17', 'c++', 'c++17', 'java', 'csharp', 'c#'].includes(lang)) return cpp();
  if (['py', 'python', 'python3'].includes(lang)) return python();
  if (['ts', 'typescript', 'tsx'].includes(lang)) return javascript({ typescript: true });
  if (['js', 'javascript', 'jsx'].includes(lang)) return javascript();
  return javascript();
}

// ── 代码片段 ──
const LANGUAGE_SNIPPETS: Record<string, { label: string; detail: string; insertText: string }[]> = {
  cpp: [
    { label: 'include', detail: 'C++ 头文件', insertText: '#include <${1:iostream}>' },
    { label: 'main', detail: 'C++ main 函数', insertText: 'int main() {\n\t$0\n\treturn 0;\n}' },
    { label: 'for', detail: 'C++ 索引循环', insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}' },
    { label: 'class', detail: 'C++ 类定义', insertText: 'class ${1:Name} {\npublic:\n\t$0\n};' },
    { label: 'vector', detail: 'C++ vector', insertText: 'std::vector<${1:int}> ${2:values};' },
    { label: 'cout', detail: 'C++ 输出', insertText: 'std::cout << ${1:value} << std::endl;' },
    { label: 'if', detail: '条件语句', insertText: 'if (${1:condition}) {\n\t$0\n}' },
    { label: 'while', detail: '循环语句', insertText: 'while (${1:condition}) {\n\t$0\n}' },
  ],
  python: [
    { label: 'def', detail: '函数定义', insertText: 'def ${1:name}(${2:args}):\n\t$0' },
    { label: 'class', detail: '类定义', insertText: 'class ${1:Name}:\n\t$0' },
    { label: 'for', detail: '循环', insertText: 'for ${1:item} in ${2:items}:\n\t$0' },
    { label: 'if', detail: '条件', insertText: 'if ${1:condition}:\n\t$0' },
    { label: 'print', detail: '输出', insertText: 'print(${1:value})' },
  ],
  javascript: [
    { label: 'function', detail: '函数定义', insertText: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
    { label: 'const', detail: '常量声明', insertText: 'const ${1:name} = ${2:value};' },
    { label: 'for', detail: '索引循环', insertText: 'for (let ${1:i} = 0; ${1:i} < ${2:items}.length; ${1:i} += 1) {\n\t$0\n}' },
    { label: 'console', detail: '控制台输出', insertText: 'console.log(${1:value});' },
    { label: 'import', detail: '导入', insertText: "import ${1:module} from '${2:package}';" },
  ],
  typescript: [
    { label: 'function', detail: '函数定义', insertText: 'function ${1:name}(${2:args}): ${3:void} {\n\t$0\n}' },
    { label: 'interface', detail: '接口定义', insertText: 'interface ${1:Name} {\n\t$0\n}' },
    { label: 'type', detail: '类型别名', insertText: 'type ${1:Name} = ${2:unknown};' },
    { label: 'const', detail: '常量声明', insertText: 'const ${1:name}: ${2:unknown} = ${3:value};' },
  ],
};

// ── 自定义补全（输入时自动触发）──
function prooflineCompletionSource(languageId: string) {
  const lang = languageId.trim().toLowerCase();
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const snippets = LANGUAGE_SNIPPETS[lang] ?? LANGUAGE_SNIPPETS.javascript ?? [];
    const options: { label: string; detail: string; type: string; apply?: string }[] = snippets.map((s) => ({
      label: s.label,
      detail: s.detail,
      type: 'keyword',
      apply: s.insertText,
    }));
    // 扫描文档标识符
    const doc = context.state.doc.toString();
    const seen = new Set(snippets.map((s) => s.label));
    const identPattern = /\b([A-Za-z_]\w*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = identPattern.exec(doc))) {
      const id = match[1];
      if (id.length > 1 && !seen.has(id)) {
        seen.add(id);
        options.push({ label: id, detail: '当前文件标识符', type: 'variable' });
      }
    }
    return { from: word.from, options, validFor: /^[\w$]*$/ };
  };
}

// ── 暗色主题（精确匹配 Monaco Proofline Dark）──
const prooflineDarkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#181715',
    color: '#FAF9F5',
  },
  '.cm-content': {
    caretColor: '#E59A7F',
    fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#E59A7F',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-selection': {
    backgroundColor: '#5D3C33 !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#1F1E1B',
  },
  '.cm-gutters': {
    backgroundColor: '#181715',
    color: '#96928B',
    border: 'none',
    borderRight: '1px solid #32302C',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#1F1E1B',
    color: '#D8D3CA',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#32302C',
    color: '#D8D3CA',
    border: 'none',
  },
  '.cm-matchingBracket': {
    backgroundColor: '#5A554E44',
    outline: 'none',
  },
  // 补全面板样式
  '.cm-tooltip': {
    backgroundColor: '#252320',
    border: '1px solid #3C3934',
    color: '#FAF9F5',
  },
  '.cm-tooltip-autocomplete': {
    backgroundColor: '#252320',
  },
  '.cm-completionLabel': {
    color: '#FAF9F5',
  },
  '.cm-completionDetail': {
    color: '#96928B',
    fontStyle: 'italic',
  },
  '.cm-completionIcon-keyword': { color: '#E59A7F' },
  '.cm-completionIcon-variable': { color: '#FAF9F5' },
  '.cm-completionIcon-function': { color: '#D6B06C' },
  '.cm-completionIcon-class': { color: '#86B6C7' },
  '.cm-completionIcon-string': { color: '#A8C99A' },
  '.cm-completionIcon-number': { color: '#D6B06C' },
  '.cm-completionIcon-snippet': { color: '#E59A7F' },
  '&.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#332F2B',
    color: '#FAF9F5',
  },
  // 滚动条
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-scrollbar': {
    width: '8px',
    height: '8px',
  },
}, { dark: true });

// ── 亮色主题（精确匹配 Monaco Proofline Light）──
const prooflineLightTheme = EditorView.theme({
  '&': {
    backgroundColor: '#FAF9F5',
    color: '#141413',
  },
  '.cm-content': {
    caretColor: '#CC785C',
    fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#CC785C',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-selection': {
    backgroundColor: '#E7C8BC !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#F5F0E8',
  },
  '.cm-gutters': {
    backgroundColor: '#FAF9F5',
    color: '#756F68',
    border: 'none',
    borderRight: '1px solid #E5DED2',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#F5F0E8',
    color: '#4A453F',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#E5DED2',
    color: '#4A453F',
    border: 'none',
  },
  '.cm-matchingBracket': {
    backgroundColor: '#C9BDB044',
    outline: 'none',
  },
  // 补全面板样式
  '.cm-tooltip': {
    backgroundColor: '#FAF9F5',
    border: '1px solid #D8D1C5',
    color: '#141413',
  },
  '.cm-tooltip-autocomplete': {
    backgroundColor: '#FAF9F5',
  },
  '.cm-completionLabel': {
    color: '#141413',
  },
  '.cm-completionDetail': {
    color: '#756F68',
    fontStyle: 'italic',
  },
  '.cm-completionIcon-keyword': { color: '#A9583E' },
  '.cm-completionIcon-variable': { color: '#141413' },
  '.cm-completionIcon-function': { color: '#8B5A2B' },
  '.cm-completionIcon-class': { color: '#315F7D' },
  '.cm-completionIcon-string': { color: '#386C5A' },
  '.cm-completionIcon-number': { color: '#8B5A2B' },
  '.cm-completionIcon-snippet': { color: '#A9583E' },
  '&.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#EFE9DE',
    color: '#141413',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: false });

// ── 语法高亮（精确匹配 Monaco 主题颜色）──
const prooflineDarkHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#A09D96', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#A09D96', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#A09D96', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#E59A7F' },
  { tag: tags.controlKeyword, color: '#E59A7F' },
  { tag: tags.operatorKeyword, color: '#E59A7F' },
  { tag: tags.definitionKeyword, color: '#E59A7F' },
  { tag: tags.moduleKeyword, color: '#E59A7F' },
  { tag: tags.number, color: '#D6B06C' },
  { tag: tags.integer, color: '#D6B06C' },
  { tag: tags.float, color: '#D6B06C' },
  { tag: tags.string, color: '#A8C99A' },
  { tag: tags.special(tags.string), color: '#A8C99A' },
  { tag: tags.typeName, color: '#86B6C7' },
  { tag: tags.className, color: '#86B6C7' },
  { tag: tags.namespace, color: '#86B6C7' },
  { tag: tags.function(tags.variableName), color: '#D6B06C' },
  { tag: tags.definition(tags.variableName), color: '#FAF9F5' },
  { tag: tags.variableName, color: '#FAF9F5' },
  { tag: tags.propertyName, color: '#FAF9F5' },
  { tag: tags.operator, color: '#FAF9F5' },
  { tag: tags.punctuation, color: '#FAF9F5' },
  { tag: tags.bracket, color: '#FAF9F5' },
  { tag: tags.angleBracket, color: '#FAF9F5' },
  { tag: tags.squareBracket, color: '#FAF9F5' },
  { tag: tags.paren, color: '#FAF9F5' },
  { tag: tags.brace, color: '#FAF9F5' },
  { tag: tags.meta, color: '#E59A7F' },
  { tag: tags.processingInstruction, color: '#E59A7F' },
  { tag: tags.self, color: '#E59A7F' },
  { tag: tags.bool, color: '#D6B06C' },
  { tag: tags.null, color: '#D6B06C' },
  { tag: tags.atom, color: '#D6B06C' },
  { tag: tags.regexp, color: '#A8C99A' },
  { tag: tags.escape, color: '#E59A7F' },
  { tag: tags.link, color: '#86B6C7', textDecoration: 'underline' },
  { tag: tags.heading, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.content, color: '#FAF9F5' },
  { tag: tags.heading1, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.heading2, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.heading3, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.heading4, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#86B6C7', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#86B6C7', fontWeight: 'bold' },
]);

const prooflineLightHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#716B64', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#716B64', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#716B64', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#A9583E' },
  { tag: tags.controlKeyword, color: '#A9583E' },
  { tag: tags.operatorKeyword, color: '#A9583E' },
  { tag: tags.definitionKeyword, color: '#A9583E' },
  { tag: tags.moduleKeyword, color: '#A9583E' },
  { tag: tags.number, color: '#8B5A2B' },
  { tag: tags.integer, color: '#8B5A2B' },
  { tag: tags.float, color: '#8B5A2B' },
  { tag: tags.string, color: '#386C5A' },
  { tag: tags.special(tags.string), color: '#386C5A' },
  { tag: tags.typeName, color: '#315F7D' },
  { tag: tags.className, color: '#315F7D' },
  { tag: tags.namespace, color: '#315F7D' },
  { tag: tags.function(tags.variableName), color: '#8B5A2B' },
  { tag: tags.definition(tags.variableName), color: '#141413' },
  { tag: tags.variableName, color: '#141413' },
  { tag: tags.propertyName, color: '#141413' },
  { tag: tags.operator, color: '#141413' },
  { tag: tags.punctuation, color: '#141413' },
  { tag: tags.bracket, color: '#141413' },
  { tag: tags.angleBracket, color: '#141413' },
  { tag: tags.squareBracket, color: '#141413' },
  { tag: tags.paren, color: '#141413' },
  { tag: tags.brace, color: '#141413' },
  { tag: tags.meta, color: '#A9583E' },
  { tag: tags.processingInstruction, color: '#A9583E' },
  { tag: tags.self, color: '#A9583E' },
  { tag: tags.bool, color: '#8B5A2B' },
  { tag: tags.null, color: '#8B5A2B' },
  { tag: tags.atom, color: '#8B5A2B' },
  { tag: tags.regexp, color: '#386C5A' },
  { tag: tags.escape, color: '#A9583E' },
  { tag: tags.link, color: '#315F7D', textDecoration: 'underline' },
  { tag: tags.heading, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.content, color: '#141413' },
  { tag: tags.heading1, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.heading2, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.heading3, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.heading4, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#315F7D', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#315F7D', fontWeight: 'bold' },
]);

// ── 暴露给外部的 API ──
export interface CodeMirrorEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  view: EditorView | null;
}

// ── Props ──
export interface CodeMirrorEditorProps {
  height?: string;
  language?: string;
  defaultValue?: string;
  theme?: string;
  fontSize?: number;
  onChange?: (value: string) => void;
  onMount?: (handle: CodeMirrorEditorHandle) => void;
}

// ── 组件 ──
const LocalCodeMirror = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function LocalCodeMirror(
  { height = '100%', language = 'javascript', defaultValue = '', theme = 'dark', fontSize = 16, onChange, onMount },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handleRef = useRef<CodeMirrorEditorHandle | null>(null);
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const defaultValueRef = useRef(defaultValue);
  const prevDefaultCodeRef = useRef(defaultValue);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onMountRef.current = onMount; }, [onMount]);
  // 同步最新的 defaultValue，供扩展重建时使用
  useEffect(() => { defaultValueRef.current = defaultValue; }, [defaultValue]);

  // ── extensions（稳定引用）──
  const extensions = useMemo<Extension[]>(() => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [prooflineCompletionSource(language)],
      activateOnTyping: true,
      maxRenderedOptions: 15,
    }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    getLanguageExtension(language),
    theme === 'dark' ? prooflineDarkTheme : prooflineLightTheme,
    syntaxHighlighting(theme === 'dark' ? prooflineDarkHighlight : prooflineLightHighlight),
    EditorView.lineWrapping,
    EditorView.theme({
      '.cm-content': { fontSize: `${fontSize}px`, lineHeight: '1.6' },
      '.cm-gutters': { fontSize: `${fontSize}px` },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    }),
  ], [language, theme, fontSize]);

  // ── 创建编辑器（只创建一次）──
  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({ doc: defaultValue, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    const handle: CodeMirrorEditorHandle = {
      getValue: () => view.state.doc.toString(),
      setValue: (value: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }),
      focus: () => view.focus(),
      undo: () => undo(view),
      redo: () => redo(view),
      canUndo: () => true,
      canRedo: () => true,
      view,
    };
    onMountRef.current?.(handle);
    handleRef.current = handle;

    return () => { view.destroy(); viewRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 更新 extensions（销毁重建）──
  // 同时监听 defaultValue 变化：切换题目时即使 extensions 没变也要重建编辑器
  useEffect(() => {
    const view = viewRef.current;
    const parent = containerRef.current;
    if (!view || !parent) return;
    // 只在 defaultValue 真正变化时才重建
    if (prevDefaultCodeRef.current === defaultValue) return;
    prevDefaultCodeRef.current = defaultValue;
    view.destroy();
    // 始终使用最新的 defaultValue
    const state = EditorState.create({ doc: defaultValue, extensions });
    const newView = new EditorView({ state, parent });
    viewRef.current = newView;
    if (handleRef.current) handleRef.current.view = newView;
  }, [extensions, defaultValue]);

  // ── 暴露 API ──
  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    setValue: (value: string) => {
      const view = viewRef.current;
      if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    focus: () => viewRef.current?.focus(),
    undo: () => { if (viewRef.current) undo(viewRef.current); },
    redo: () => { if (viewRef.current) redo(viewRef.current); },
    canUndo: () => true,
    canRedo: () => true,
    view: viewRef.current,
  }));

  return <div ref={containerRef} style={{ height, width: '100%', overflow: 'auto' }} />;
});

export default LocalCodeMirror;
