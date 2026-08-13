import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import { MONACO_THEME_NAMES } from '../app/theme';

type WorkerScope = typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};

(globalThis as WorkerScope).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });

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
    'editorCursor.foreground': '#CC785C',
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

export default Editor;
