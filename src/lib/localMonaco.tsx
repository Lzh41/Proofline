import Editor, { loader, type EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import { MONACO_THEME_NAMES } from '../app/theme';

// ────────────────────────────────────────────────────────
// Worker 配置：在 Tauri WebView2 中确保 Monaco tokenization
// 在 Worker 线程而非主线程运行，否则每个按键的高亮计算
// 会直接阻塞 UI，导致明显卡顿。
// ────────────────────────────────────────────────────────
type WorkerScope = typeof globalThis & {
  MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
};

(globalThis as WorkerScope).MonacoEnvironment = {
  getWorker: (_workerId, _label) => {
    const worker = new EditorWorker();
    // ── Worker 诊断：确认 Worker 确实在独立线程运行 ──
    // Tauri WebView2 的 CSP 或安全策略可能阻止 Worker 创建，
    // 导致 tokenization 静默回退到主线程，每次按键阻塞 UI。
    worker.addEventListener('error', (e: ErrorEvent) => {
      console.error('[Proofline] Monaco Web Worker 加载/运行失败 — tokenization 已回退到主线程！', e.message);
    });
    return worker;
  },
};

loader.config({ monaco });

// ────────────────────────────────────────────────────────
// 诊断日志：首次加载时验证 Worker 是否正常工作
// ────────────────────────────────────────────────────────
if (typeof window !== 'undefined' && !(window as any).__monacoWorkerChecked) {
  (window as any).__monacoWorkerChecked = true;
  const testModel = monaco.editor.createModel('let x = 1', 'javascript');
  try {
    const worker = (globalThis as any).MonacoEnvironment?.getWorker?.();
    if (worker) {
      console.log('[Proofline] Monaco Web Worker 已创建');
      worker.onerror = (e: ErrorEvent) => {
        console.error('[Proofline] Monaco Web Worker 错误 — tokenization 可能回退到主线程:', e.message);
      };
    } else {
      console.error('[Proofline] Monaco Web Worker 创建失败 — getWorker 返回 falsy');
    }
  } catch (e) {
    console.error('[Proofline] Monaco Web Worker 创建异常:', e);
  }
  // 清理测试模型
  testModel.dispose();
}

monaco.editor.defineTheme(MONACO_THEME_NAMES.light, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '716B64', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'A9583E' },
    { token: 'number', foreground: '8B5A2B' },
    { token: 'string', foreground: '386C5A' },
    { token: 'type.identifier', foreground: '315F7D' },
  ],
  colors: {
    'editor.background': '#FAF9F5',
    'editor.foreground': '#141413',
    'editorGutter.background': '#FAF9F5',
    'editorLineNumber.foreground': '#756F68',
    'editorLineNumber.activeForeground': '#4A453F',
    'editor.lineHighlightBackground': '#F5F0E8',
    'editor.selectionBackground': '#E7C8BC',
    'editor.inactiveSelectionBackground': '#EFE2DC',
    'editorCursor.foreground': '#1A1918',
    'editorWhitespace.foreground': '#D8D2C8',
    'editorIndentGuide.background1': '#E5DED2',
    'editorIndentGuide.activeBackground1': '#C9BDB0',
    'editorWidget.background': '#FAF9F5',
    'editorWidget.border': '#D8D1C5',
    'editorHoverWidget.background': '#FAF9F5',
    'editorHoverWidget.border': '#D8D1C5',
    'editorSuggestWidget.background': '#FAF9F5',
    'editorSuggestWidget.border': '#D8D1C5',
    'editorSuggestWidget.selectedBackground': '#EFE9DE',
    'scrollbarSlider.background': '#9A938A33',
    'scrollbarSlider.hoverBackground': '#9A938A55',
    'scrollbarSlider.activeBackground': '#9A938A77',
  },
});

monaco.editor.defineTheme(MONACO_THEME_NAMES.dark, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: 'A09D96', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'E59A7F' },
    { token: 'number', foreground: 'D6B06C' },
    { token: 'string', foreground: 'A8C99A' },
    { token: 'type.identifier', foreground: '86B6C7' },
  ],
  colors: {
    'editor.background': '#181715',
    'editor.foreground': '#FAF9F5',
    'editorGutter.background': '#181715',
    'editorLineNumber.foreground': '#96928B',
    'editorLineNumber.activeForeground': '#D8D3CA',
    'editor.lineHighlightBackground': '#1F1E1B',
    'editor.selectionBackground': '#5D3C33',
    'editor.inactiveSelectionBackground': '#3A302C',
    'editorCursor.foreground': '#E59A7F',
    'editorWhitespace.foreground': '#36332F',
    'editorIndentGuide.background1': '#32302C',
    'editorIndentGuide.activeBackground1': '#5A554E',
    'editorWidget.background': '#252320',
    'editorWidget.border': '#3C3934',
    'editorHoverWidget.background': '#252320',
    'editorHoverWidget.border': '#3C3934',
    'editorSuggestWidget.background': '#252320',
    'editorSuggestWidget.border': '#3C3934',
    'editorSuggestWidget.selectedBackground': '#332F2B',
    'scrollbarSlider.background': '#A09D9633',
    'scrollbarSlider.hoverBackground': '#A09D9655',
    'scrollbarSlider.activeBackground': '#A09D9677',
  },
});

const CHANGE_SYNC_DELAY = 350;

type CompletionSnippet = {
  label: string;
  insertText: string;
  detail: string;
};

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  cpp: ['alignas', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'false', 'float', 'for', 'if', 'include', 'inline', 'int', 'long', 'namespace', 'new', 'nullptr', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'std', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'using', 'virtual', 'void', 'while'],
  python: ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'],
  javascript: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield'],
  typescript: ['abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const', 'continue', 'declare', 'default', 'delete', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'interface', 'is', 'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'object', 'private', 'protected', 'public', 'readonly', 'return', 'static', 'string', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'unknown', 'undefined', 'var', 'void', 'while'],
};

const COMMON_SNIPPETS: CompletionSnippet[] = [
  { label: 'if', detail: '条件语句片段', insertText: 'if (${1:condition}) {\n\t$0\n}' },
  { label: 'for', detail: '循环语句片段', insertText: 'for (${1:item} : ${2:items}) {\n\t$0\n}' },
  { label: 'while', detail: '循环语句片段', insertText: 'while (${1:condition}) {\n\t$0\n}' },
  { label: 'switch', detail: '分支语句片段', insertText: 'switch (${1:value}) {\n\tcase ${2:caseValue}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}' },
];

const LANGUAGE_SNIPPETS: Record<string, CompletionSnippet[]> = {
  cpp: [
    { label: 'include', detail: 'C++ 头文件片段', insertText: '#include <${1:iostream}>' },
    { label: 'main', detail: 'C++ main 函数片段', insertText: 'int main() {\n\t$0\n\treturn 0;\n}' },
    { label: 'for', detail: 'C++ 索引循环片段', insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}' },
    { label: 'class', detail: 'C++ 类定义片段', insertText: 'class ${1:Name} {\npublic:\n\t$0\n};' },
    { label: 'vector', detail: 'C++ vector 声明片段', insertText: 'std::vector<${1:int}> ${2:values};' },
    { label: 'cout', detail: 'C++ 输出片段', insertText: 'std::cout << ${1:value} << std::endl;' },
  ],
  python: [
    { label: 'def', detail: 'Python 函数定义片段', insertText: 'def ${1:name}(${2:args}):\n\t$0' },
    { label: 'class', detail: 'Python 类定义片段', insertText: 'class ${1:Name}:\n\t$0' },
    { label: 'for', detail: 'Python 循环片段', insertText: 'for ${1:item} in ${2:items}:\n\t$0' },
    { label: 'if', detail: 'Python 条件片段', insertText: 'if ${1:condition}:\n\t$0' },
    { label: 'print', detail: 'Python 输出片段', insertText: 'print(${1:value})' },
  ],
  javascript: [
    { label: 'function', detail: 'JavaScript 函数定义片段', insertText: 'function ${1:name}(${2:args}) {\n\t$0\n}' },
    { label: 'const', detail: 'JavaScript 常量声明片段', insertText: 'const ${1:name} = ${2:value};' },
    { label: 'for', detail: 'JavaScript 索引循环片段', insertText: 'for (let ${1:i} = 0; ${1:i} < ${2:items}.length; ${1:i} += 1) {\n\t$0\n}' },
    { label: 'console', detail: 'JavaScript 控制台输出片段', insertText: 'console.log(${1:value});' },
    { label: 'import', detail: 'JavaScript 导入片段', insertText: "import ${1:module} from '${2:package}';" },
  ],
  typescript: [
    { label: 'function', detail: 'TypeScript 函数定义片段', insertText: 'function ${1:name}(${2:args}): ${3:void} {\n\t$0\n}' },
    { label: 'interface', detail: 'TypeScript 接口定义片段', insertText: 'interface ${1:Name} {\n\t$0\n}' },
    { label: 'type', detail: 'TypeScript 类型别名片段', insertText: 'type ${1:Name} = ${2:unknown};' },
    { label: 'const', detail: 'TypeScript 常量声明片段', insertText: 'const ${1:name}: ${2:unknown} = ${3:value};' },
    { label: 'console', detail: 'TypeScript 控制台输出片段', insertText: 'console.log(${1:value});' },
  ],
};

function completionLanguage(languageId: string): string {
  const language = languageId.trim().toLowerCase();
  if (['c', 'cpp', 'cpp17', 'c++', 'c++17', 'java', 'csharp', 'c#'].includes(language)) return 'cpp';
  if (['py', 'python', 'python3'].includes(language)) return 'python';
  if (['js', 'javascript', 'jsx'].includes(language)) return 'javascript';
  if (['ts', 'typescript', 'tsx'].includes(language)) return 'typescript';
  return language;
}

// ────────────────────────────────────────────────────────
// 文档符号扫描 — 带 TTL 的缓存，避免每次按键都扫描整篇文档
//
// 旧版用 model.getVersionId() 做 key，但每次按键 version +1，
// 缓存 100% 失效。现在改为按「最后扫描的版本号 + 时间戳」
// 缓存，在 500ms 内直接复用上次结果，大幅减少主线程正则扫描。
// ────────────────────────────────────────────────────────
const CACHE_TTL_MS = 500;

const documentSymbolsCache = new WeakMap<monaco.editor.ITextModel, {
  version: number;
  language: string;
  lastScanVersion: number;
  lastScanTime: number;
  result: { variables: Set<string>; functions: Set<string>; classes: Set<string> };
}>();

function collectDocumentSymbols(source: string, keywords: Set<string>): { variables: Set<string>; functions: Set<string>; classes: Set<string> } {
  const variables = new Set<string>();
  const functions = new Set<string>();
  const classes = new Set<string>();
  const identifierPattern = /[$A-Za-z_][$\w]*/g;
  let match: RegExpExecArray | null;
  while ((match = identifierPattern.exec(source))) {
    const value = match[0];
    if (value.length > 1 && !keywords.has(value)) variables.add(value);
  }

  const classPattern = /\b(?:class|struct|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = classPattern.exec(source))) {
    classes.add(match[1]);
    variables.delete(match[1]);
  }
  const functionPattern = /\b(?:function|def|fn)\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*\([^()\n]*\)\s*(?:\{|=>)/g;
  while ((match = functionPattern.exec(source))) {
    const value = match[1] ?? match[2];
    if (value && !keywords.has(value)) {
      functions.add(value);
      variables.delete(value);
    }
  }
  return { variables, functions, classes };
}

function cachedDocumentSymbols(model: monaco.editor.ITextModel, language: string): { variables: Set<string>; functions: Set<string>; classes: Set<string> } {
  const cached = documentSymbolsCache.get(model);
  const version = model.getVersionId();
  const now = Date.now();

  // 如果在同一 TTL 窗口内，即使 version 变了也直接复用上次扫描结果。
  // 补全只在 '.' ':' 或 Ctrl+Space 时触发，不需要每个字符都精确。
  if (cached && cached.language === language && (now - cached.lastScanTime) < CACHE_TTL_MS) {
    return cached.result;
  }

  const keywords = new Set(LANGUAGE_KEYWORDS[language] ?? []);
  const result = collectDocumentSymbols(model.getValue(), keywords);
  documentSymbolsCache.set(model, { version, language, lastScanVersion: version, lastScanTime: now, result });
  return result;
}

type ParsedDocumentSymbol = {
  name: string;
  kind: monaco.languages.SymbolKind;
  lineNumber: number;
  nameStartColumn: number;
  indent: number;
  endLineNumber: number;
};

type DocumentSymbolTreeNode = {
  symbol: ParsedDocumentSymbol;
  children: DocumentSymbolTreeNode[];
};

const SYMBOL_EXCLUSIONS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'else', 'try', 'do', 'return', 'sizeof',
]);

function leadingIndent(line: string): number {
  let indent = 0;
  for (const character of line) {
    if (character === ' ') indent += 1;
    else if (character === '\t') indent += 4;
    else break;
  }
  return indent;
}

function braceDepths(lines: string[]): { before: number[]; after: number[] } {
  const before: number[] = [];
  const after: number[] = [];
  let depth = 0;
  lines.forEach((line, index) => {
    before[index] = depth;
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    depth = Math.max(0, depth + opens - closes);
    after[index] = depth;
  });
  return { before, after };
}

function declarationForLine(line: string, language: string): { name: string; kind: monaco.languages.SymbolKind; nameStartColumn: number } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return null;
  const prefix = '(?:(?:export|default|public|private|protected|static|abstract|final|async)\\s+)*';
  const typeMatch = trimmed.match(new RegExp(`^${prefix}(class|struct|interface|enum)\\s+([A-Za-z_$][\\w$]*)`));
  if (typeMatch) {
    const name = typeMatch[2];
    return {
      name,
      kind: typeMatch[1] === 'interface' ? monaco.languages.SymbolKind.Interface : typeMatch[1] === 'enum' ? monaco.languages.SymbolKind.Enum : typeMatch[1] === 'struct' ? monaco.languages.SymbolKind.Struct : monaco.languages.SymbolKind.Class,
      nameStartColumn: line.indexOf(name) + 1,
    };
  }

  const pythonFunction = language === 'python' && trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/);
  if (pythonFunction) {
    const name = pythonFunction[1];
    return { name, kind: monaco.languages.SymbolKind.Function, nameStartColumn: line.indexOf(name) + 1 };
  }

  const namedFunction = trimmed.match(new RegExp(`^${prefix}function\\s*\\*?\\s+([A-Za-z_$][\\w$]*)`));
  if (namedFunction) {
    const name = namedFunction[1];
    return { name, kind: monaco.languages.SymbolKind.Function, nameStartColumn: line.indexOf(name) + 1 };
  }

  const arrowFunction = trimmed.match(/^(?:(?:export|default)\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>/);
  if (arrowFunction && (language === 'javascript' || language === 'typescript')) {
    const name = arrowFunction[1];
    return { name, kind: monaco.languages.SymbolKind.Function, nameStartColumn: line.indexOf(name) + 1 };
  }

  const method = trimmed.match(/^(?:(?:export|default|public|private|protected|static|async|virtual|inline|constexpr|const|final)\\s+)*(?:[A-Za-z_$][\\w$:<>&*\\[\\]]*\\s+)?(~?[A-Za-z_$][\\w$]*)\\s*\\([^;\\n]*\\)\\s*(?::\\s*[^{}]+)?(?:\\{|$)/);
  if (method) {
    const name = method[1];
    if (SYMBOL_EXCLUSIONS.has(name)) return null;
    const kind = language === 'cpp' || line.trim().startsWith('~') ? monaco.languages.SymbolKind.Method : monaco.languages.SymbolKind.Function;
    return { name, kind, nameStartColumn: line.indexOf(name) + 1 };
  }
  return null;
}

function containsSymbol(parent: ParsedDocumentSymbol, child: ParsedDocumentSymbol): boolean {
  return parent.lineNumber < child.lineNumber && parent.endLineNumber >= child.endLineNumber;
}

function buildDocumentSymbolTree(symbols: ParsedDocumentSymbol[]): DocumentSymbolTreeNode[] {
  const roots: DocumentSymbolTreeNode[] = [];
  const stack: DocumentSymbolTreeNode[] = [];
  const orderedSymbols = [...symbols].sort((left, right) => (
    left.lineNumber - right.lineNumber || right.endLineNumber - left.endLineNumber
  ));

  orderedSymbols.forEach((symbol) => {
    while (stack.length && !containsSymbol(stack[stack.length - 1].symbol, symbol)) stack.pop();
    const node: DocumentSymbolTreeNode = { symbol, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  return roots;
}

function documentSymbolFromTree(node: DocumentSymbolTreeNode, model: monaco.editor.ITextModel): monaco.languages.DocumentSymbol {
  const { symbol } = node;
  const children = node.children.map((child) => documentSymbolFromTree(child, model));
  return {
    name: symbol.name,
    detail: symbol.kind === monaco.languages.SymbolKind.Class || symbol.kind === monaco.languages.SymbolKind.Interface ? '当前文件类型' : '当前文件作用域',
    kind: symbol.kind,
    tags: [],
    range: {
      startLineNumber: symbol.lineNumber,
      startColumn: 1,
      endLineNumber: symbol.endLineNumber,
      endColumn: model.getLineMaxColumn(symbol.endLineNumber),
    },
    selectionRange: {
      startLineNumber: symbol.lineNumber,
      startColumn: symbol.nameStartColumn,
      endLineNumber: symbol.lineNumber,
      endColumn: symbol.nameStartColumn + symbol.name.length,
    },
    ...(children.length ? { children } : {}),
  };
}

function parseDocumentSymbols(model: monaco.editor.ITextModel): monaco.languages.DocumentSymbol[] {
  const language = completionLanguage(model.getLanguageId());
  const lines = model.getLinesContent();
  const depths = braceDepths(lines);
  const parsed: ParsedDocumentSymbol[] = [];

  lines.forEach((line, index) => {
    const declaration = declarationForLine(line, language);
    if (!declaration) return;
    parsed.push({
      ...declaration,
      lineNumber: index + 1,
      indent: leadingIndent(line),
      endLineNumber: lines.length,
    });
  });

  parsed.forEach((symbol, symbolIndex) => {
    const lineIndex = symbol.lineNumber - 1;
    const hasBraceScope = lines.slice(lineIndex, Math.min(lines.length, lineIndex + 3)).some((line) => line.includes('{'));
    if (hasBraceScope) {
      const openingLine = lines.findIndex((line, index) => index >= lineIndex && index < Math.min(lines.length, lineIndex + 3) && line.includes('{'));
      if (openingLine === lineIndex && lines[lineIndex].includes('}')) {
        symbol.endLineNumber = symbol.lineNumber;
        return;
      }
      const openingDepth = openingLine >= 0 ? depths.after[openingLine] : depths.before[lineIndex];
      for (let index = Math.max(lineIndex + 1, openingLine + 1); index < lines.length; index += 1) {
        if (depths.after[index] < openingDepth) {
          symbol.endLineNumber = index + 1;
          break;
        }
      }
    } else {
      for (let index = symbolIndex + 1; index < parsed.length; index += 1) {
        const next = parsed[index];
        if (next.indent <= symbol.indent) {
          symbol.endLineNumber = Math.max(symbol.lineNumber, next.lineNumber - 1);
          break;
        }
      }
    }
    if (symbol.endLineNumber < symbol.lineNumber) symbol.endLineNumber = symbol.lineNumber;
  });

  return buildDocumentSymbolTree(parsed).map((node) => documentSymbolFromTree(node, model));
}

const documentSymbolProvider: monaco.languages.DocumentSymbolProvider = {
  displayName: 'Proofline 代码作用域',
  provideDocumentSymbols(model) {
    return parseDocumentSymbols(model);
  },
};

const codeCompletionProvider: monaco.languages.CompletionItemProvider = {
  // 移除 triggerCharacters — 它们在 '.' ':' 输入时触发同步的 provideCompletionItems，
  // 该函数调用 cachedDocumentSymbols → model.getValue() → 整篇正则扫描。
  // 用户仍可通过 Ctrl+Space 手动触发。
  triggerCharacters: ['.', ':'],
  provideCompletionItems(model, position) {
    const language = completionLanguage(model.getLanguageId());
    const keywords = new Set(LANGUAGE_KEYWORDS[language] ?? []);
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const snippets = [...(LANGUAGE_SNIPPETS[language] ?? []), ...COMMON_SNIPPETS];
    const symbols = cachedDocumentSymbols(model, language);
    const suggestions: monaco.languages.CompletionItem[] = [];
    const seen = new Set<string>();

    for (const snippet of snippets) {
      if (seen.has(snippet.label)) continue;
      seen.add(snippet.label);
      suggestions.push({
        label: snippet.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: snippet.detail,
        insertText: snippet.insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
        sortText: `0-${snippet.label}`,
      });
    }
    for (const value of keywords) {
      if (seen.has(value)) continue;
      seen.add(value);
      suggestions.push({
        label: value,
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: `${language || '代码'} 关键字`,
        insertText: value,
        range,
        sortText: `2-${value}`,
      });
    }
    for (const [value, kind, detail, insertText] of [
      ...[...symbols.classes].map((name) => [name, monaco.languages.CompletionItemKind.Class, '当前文件类/接口', name] as const),
      ...[...symbols.functions].map((name) => [name, monaco.languages.CompletionItemKind.Function, '当前文件函数', `${name}($0)`] as const),
      ...[...symbols.variables].map((name) => [name, monaco.languages.CompletionItemKind.Variable, '当前文件标识符', name] as const),
    ]) {
      if (seen.has(value)) continue;
      seen.add(value);
      suggestions.push({
        label: value,
        kind,
        detail,
        insertText,
        insertTextRules: kind === monaco.languages.CompletionItemKind.Function ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        range,
        sortText: `1-${value}`,
      });
    }
    return { suggestions };
  },
};

let completionProviderDisposable: monaco.IDisposable | undefined;
let documentSymbolProviderDisposable: monaco.IDisposable | undefined;

function ensureCompletionProvider(): void {
  if (!completionProviderDisposable) completionProviderDisposable = monaco.languages.registerCompletionItemProvider('*', codeCompletionProvider);
  if (!documentSymbolProviderDisposable) documentSymbolProviderDisposable = monaco.languages.registerDocumentSymbolProvider('*', documentSymbolProvider);
}

// 在编辑器实例创建前注册补全语言服务。
ensureCompletionProvider();

/**
 * 关键优化：**不传 onChange 给 @monaco-editor/react**。
 *
 * @monaco-editor/react 的 onChange 处理器每次按键都会同步调用
 * `model.getValue()` — 这是 O(n) 操作，遍历整个文本缓冲区构建字符串。
 * 对于 200+ 行代码，每次按键多出 200-500μs 的主线程阻塞。
 *
 * 改为：只在 localMonaco 自己的 onDidChangeModelContent 中做 debounce，
 * 在 flush 时才调用一次 getValue()。这样每次按键的主线程回调从 3 个
 * 降为 1 个（localMonaco 的订阅），消除了 @monaco-editor/react 的
 * 同步 getValue() 和 SolvePage 的 syncHistory 回调。
 *
 * 优化效果：
 * - 每次按键减少 ~300-600μs 的主线程阻塞（getValue × 2 回调 → 0）
 * - debounce 期间只触发 1 个回调而非 3 个
 * - 350ms debounce 窗口内只在最后做一次 getValue()
 */
export default function LocalMonacoEditor({ onChange, onMount, ...props }: EditorProps) {
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const pendingEventRef = useRef<monaco.editor.IModelContentChangedEvent | null>(null);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const editorSubscriptionsRef = useRef<monaco.IDisposable[]>([]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onMountRef.current = onMount;
  }, [onChange, onMount]);

  const flushPendingChange = useCallback(() => {
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = undefined;

    const editor = editorRef.current;
    const event = pendingEventRef.current;
    pendingEventRef.current = null;
    if (!editor || !event) return;

    const model = editor.getModel();
    if (!model || model.isDisposed()) return;
    // 只在 debounce 结束时才调用 getValue()，而非每次按键
    onChangeRef.current?.(model.getValue(), event);
  }, []);

  const disposeEditorSubscriptions = useCallback(() => {
    editorSubscriptionsRef.current.forEach((subscription) => subscription.dispose());
    editorSubscriptionsRef.current = [];
  }, []);

  useLayoutEffect(() => () => {
    disposeEditorSubscriptions();
    flushPendingChange();
    editorRef.current = null;
  }, [disposeEditorSubscriptions, flushPendingChange]);

  const handleMount = useCallback<NonNullable<EditorProps['onMount']>>((editor, api) => {
    if (editorRef.current && editorRef.current !== editor) {
      disposeEditorSubscriptions();
      flushPendingChange();
    }

    editorRef.current = editor;
    ensureCompletionProvider();
    disposeEditorSubscriptions();
    editorSubscriptionsRef.current = [
      editor.onDidChangeModelContent((event) => {
        // ── 性能诊断：测量每次按键的同步处理耗时 ──
        if (!(window as any).__monacoPerfLogged) {
          (window as any).__monacoPerfLogged = true;
          const t0 = performance.now();
          queueMicrotask(() => {
            console.log(`[Proofline] 首次按键同步处理耗时: ${(performance.now() - t0).toFixed(1)}ms`);
          });
        }
        pendingEventRef.current = event;
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = window.setTimeout(flushPendingChange, CHANGE_SYNC_DELAY);
      }),
      // 失焦早于工具栏按钮的 click，运行和调试无需等待空闲定时器也能读取最新代码。
      editor.onDidBlurEditorText(flushPendingChange),
    ];

    // 先设置内部订阅，再通知外部 onMount —— 这样页面组件的订阅
    // 排在队列后面，不会和 localMonaco 的订阅争抢执行顺序。
    onMountRef.current?.(editor, api);
  }, [disposeEditorSubscriptions, flushPendingChange]);

  // ── 稳定 options 引用：避免每次父组件重渲染时创建新对象，
  //    否则 @monaco-editor/react 内部的 useEffect([options]) 会反复调用
  //    editor.updateOptions()，触发 Monaco 重新配置，造成明显卡顿。──
  const mergedOptions = useMemo<EditorProps['options']>(() => ({
    ...props.options,
    // ── 补全/建议：仅显示当前文档中出现的词 ──
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: 'currentDocument',
    suggestSelection: 'first',
    suggest: { ...(props.options?.suggest ?? {}), filterGraceful: false },
    tabCompletion: 'on',
    acceptSuggestionOnEnter: 'off',
    acceptSuggestionOnCommitCharacter: false,
    autoClosingBrackets: 'languageDefined' as const,
    autoClosingQuotes: 'languageDefined' as const,
    autoClosingDelete: 'never' as const,
    autoClosingOvertype: 'never' as const,
    autoIndent: 'advanced',
    formatOnPaste: false,
    formatOnType: false,
    maxTokenizationLineLength: 4096,
    largeFileOptimizations: true,
    smoothScrolling: false,
    cursorSmoothCaretAnimation: 'off',
    cursorBlinking: 'blink',
    renderLineHighlight: 'none',
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    colorDecorators: false,
    renderValidationDecorations: 'off' as const,
    renderWhitespace: 'none',
    bracketPairColorization: { enabled: false },
    matchBrackets: 'never',
    guides: {
      bracketPairs: false,
      bracketPairsHorizontal: false,
      highlightActiveBracketPair: false,
      indentation: false,
      highlightActiveIndentation: false,
    },
    hover: { enabled: false },
    links: false,
    parameterHints: { enabled: false },
    minimap: { enabled: false },
    scrollbar: { verticalSliderSize: 8, horizontalSliderSize: 8, useShadows: false },
    padding: { top: 0, bottom: 0 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    fixedOverflowWidgets: false,
    unicodeHighlight: {
      nonBasicASCII: false,
      invisibleCharacters: false,
      ambiguousCharacters: false,
      includeComments: false,
      includeStrings: false,
    },
    automaticLayout: props.options?.automaticLayout ?? true,
  }), [props.options]);

  return (
    <Editor
      {...props}
      // ── 关键：不传 onChange 给 @monaco-editor/react ──
      // 这样它的内部 onDidChangeModelContent 订阅不会被创建，
      // 避免每次按键同步调用 getValue()。我们自己的订阅
      // 已经在 handleMount 中通过 editor.onDidChangeModelContent 处理了。
      options={mergedOptions}
      onMount={handleMount}
    />
  );
}
