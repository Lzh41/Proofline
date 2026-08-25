/**
 * localCodeMirror.tsx — CodeMirror 6 编辑器（稳定版，不销毁重建）
 */
import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, type LanguageSupport } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';

// ── 语言 ──
function getLang(id: string): LanguageSupport {
  const l = id.trim().toLowerCase();
  if (['c','cpp','cpp17','c++','c++17','java','csharp','c#'].includes(l)) return cpp();
  if (['py','python','python3'].includes(l)) return python();
  if (['ts','typescript','tsx'].includes(l)) return javascript({ typescript: true });
  if (['js','javascript','jsx'].includes(l)) return javascript();
  return javascript();
}

// ── 片段 ──
const SNIPPETS: Record<string, {label:string;detail:string;insertText:string}[]> = {
  cpp: [
    {label:'include',detail:'头文件',insertText:'#include <${1:iostream}>'},
    {label:'main',detail:'main 函数',insertText:'int main() {\n\t$0\n\treturn 0;\n}'},
    {label:'for',detail:'索引循环',insertText:'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}'},
    {label:'class',detail:'类定义',insertText:'class ${1:Name} {\npublic:\n\t$0\n};'},
    {label:'vector',detail:'vector',insertText:'std::vector<${1:int}> ${2:values};'},
    {label:'cout',detail:'输出',insertText:'std::cout << ${1:value} << std::endl;'},
    {label:'if',detail:'条件',insertText:'if (${1:condition}) {\n\t$0\n}'},
    {label:'while',detail:'循环',insertText:'while (${1:condition}) {\n\t$0\n}'},
  ],
  python: [
    {label:'def',detail:'函数',insertText:'def ${1:name}(${2:args}):\n\t$0'},
    {label:'class',detail:'类',insertText:'class ${1:Name}:\n\t$0'},
    {label:'for',detail:'循环',insertText:'for ${1:item} in ${2:items}:\n\t$0'},
    {label:'if',detail:'条件',insertText:'if ${1:condition}:\n\t$0'},
    {label:'print',detail:'输出',insertText:'print(${1:value})'},
  ],
  javascript: [
    {label:'function',detail:'函数',insertText:'function ${1:name}(${2:args}) {\n\t$0\n}'},
    {label:'const',detail:'常量',insertText:'const ${1:name} = ${2:value};'},
    {label:'for',detail:'循环',insertText:'for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}'},
    {label:'console',detail:'输出',insertText:'console.log(${1:value});'},
    {label:'import',detail:'导入',insertText:"import ${1:mod} from '${2:pkg}';"},
  ],
  typescript: [
    {label:'function',detail:'函数',insertText:'function ${1:name}(${2:args}): ${3:void} {\n\t$0\n}'},
    {label:'interface',detail:'接口',insertText:'interface ${1:Name} {\n\t$0\n}'},
    {label:'type',detail:'类型',insertText:'type ${1:Name} = ${2:unknown};'},
    {label:'const',detail:'常量',insertText:'const ${1:name}: ${2:unknown} = ${3:value};'},
  ],
};

function completionSource(langId: string) {
  const lang = langId.trim().toLowerCase();
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const snips = SNIPPETS[lang] ?? SNIPPETS.javascript ?? [];
    const opts: {label:string;detail:string;type:string;apply?:string}[] = snips.map(s=>({label:s.label,detail:s.detail,type:'keyword',apply:s.insertText}));
    const doc = ctx.state.doc.toString();
    const seen = new Set(snips.map(s=>s.label));
    const re = /\b([A-Za-z_]\w*)\b/g;
    let m: RegExpExecArray|null;
    while((m=re.exec(doc))){
      const id=m[1];
      if(id.length>1&&!seen.has(id)){seen.add(id);opts.push({label:id,detail:'当前文件标识符',type:'variable'});}
    }
    return {from:word.from,options:opts,validFor:/^[\w$]*$/};
  };
}

// ── 语法高亮 ──
const darkHL = HighlightStyle.define([
  {tag:tags.comment,color:'#A09D96',fontStyle:'italic'},
  {tag:tags.lineComment,color:'#A09D96',fontStyle:'italic'},
  {tag:tags.blockComment,color:'#A09D96',fontStyle:'italic'},
  {tag:tags.keyword,color:'#E59A7F'},
  {tag:tags.controlKeyword,color:'#E59A7F'},
  {tag:tags.operatorKeyword,color:'#E59A7F'},
  {tag:tags.definitionKeyword,color:'#E59A7F'},
  {tag:tags.number,color:'#D6B06C'},
  {tag:tags.string,color:'#A8C99A'},
  {tag:tags.special(tags.string),color:'#A8C99A'},
  {tag:tags.typeName,color:'#86B6C7'},
  {tag:tags.className,color:'#86B6C7'},
  {tag:tags.namespace,color:'#86B6C7'},
  {tag:tags.function(tags.variableName),color:'#D6B06C'},
  {tag:tags.variableName,color:'#FAF9F5'},
  {tag:tags.propertyName,color:'#FAF9F5'},
  {tag:tags.operator,color:'#FAF9F5'},
  {tag:tags.punctuation,color:'#FAF9F5'},
  {tag:tags.bracket,color:'#FAF9F5'},
  {tag:tags.self,color:'#E59A7F'},
  {tag:tags.bool,color:'#D6B06C'},
  {tag:tags.null,color:'#D6B06C'},
  {tag:tags.regexp,color:'#A8C99A'},
  {tag:tags.escape,color:'#E59A7F'},
  {tag:tags.meta,color:'#E59A7F'},
]);
const lightHL = HighlightStyle.define([
  {tag:tags.comment,color:'#716B64',fontStyle:'italic'},
  {tag:tags.lineComment,color:'#716B64',fontStyle:'italic'},
  {tag:tags.blockComment,color:'#716B64',fontStyle:'italic'},
  {tag:tags.keyword,color:'#A9583E'},
  {tag:tags.controlKeyword,color:'#A9583E'},
  {tag:tags.operatorKeyword,color:'#A9583E'},
  {tag:tags.definitionKeyword,color:'#A9583E'},
  {tag:tags.number,color:'#8B5A2B'},
  {tag:tags.string,color:'#386C5A'},
  {tag:tags.special(tags.string),color:'#386C5A'},
  {tag:tags.typeName,color:'#315F7D'},
  {tag:tags.className,color:'#315F7D'},
  {tag:tags.namespace,color:'#315F7D'},
  {tag:tags.function(tags.variableName),color:'#8B5A2B'},
  {tag:tags.variableName,color:'#141413'},
  {tag:tags.propertyName,color:'#141413'},
  {tag:tags.operator,color:'#141413'},
  {tag:tags.punctuation,color:'#141413'},
  {tag:tags.bracket,color:'#141413'},
  {tag:tags.self,color:'#A9583E'},
  {tag:tags.bool,color:'#8B5A2B'},
  {tag:tags.null,color:'#8B5A2B'},
  {tag:tags.regexp,color:'#386C5A'},
  {tag:tags.escape,color:'#A9583E'},
  {tag:tags.meta,color:'#A9583E'},
]);

// ── UI 主题 ──
const darkTheme = EditorView.theme({
  '&':{backgroundColor:'#1f1e1b',color:'#FAF9F5'},
  '.cm-content':{caretColor:'#E59A7F',fontFamily:"'JetBrains Mono',Consolas,'Courier New',monospace"},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#E59A7F',borderLeftWidth:'2px'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground':{backgroundColor:'#5D3C33 !important'},
  '.cm-activeLine':{backgroundColor:'#252320'},
  '.cm-gutters':{backgroundColor:'#1f1e1b',color:'#96928B',border:'none',borderRight:'1px solid #32302C'},
  '.cm-activeLineGutter':{backgroundColor:'#252320',color:'#D8D3CA'},
  '.cm-foldPlaceholder':{backgroundColor:'#32302C',color:'#D8D3CA',border:'none'},
  '.cm-matchingBracket':{backgroundColor:'#5A554E44',outline:'none'},
  '.cm-tooltip':{backgroundColor:'#252320',border:'1px solid #3C3934',color:'#FAF9F5',borderRadius:'6px',boxShadow:'0 4px 12px rgba(0,0,0,.4)'},
  '.cm-tooltip-autocomplete':{backgroundColor:'#252320',borderRadius:'6px',overflow:'hidden'},
  '.cm-tooltip-autocomplete>ul':{fontFamily:"'JetBrains Mono',Consolas,monospace",fontSize:'13px'},
  '.cm-tooltip-autocomplete>ul>li':{padding:'4px 10px',lineHeight:'1.4'},
  '&.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#332F2B',color:'#FAF9F5'},
  '.cm-completionLabel':{color:'#FAF9F5'},
  '.cm-completionDetail':{color:'#96928B',fontStyle:'italic',marginLeft:'6px'},
  '.cm-completionIcon-keyword':{color:'#E59A7F'},
  '.cm-completionIcon-variable':{color:'#FAF9F5'},
  '.cm-completionIcon-function':{color:'#D6B06C'},
  '.cm-completionIcon-class':{color:'#86B6C7'},
  '.cm-completionIcon-string':{color:'#A8C99A'},
  '.cm-completionIcon-number':{color:'#D6B06C'},
  '.cm-completionIcon-snippet':{color:'#E59A7F'},
  '.cm-scroller':{overflow:'auto'},
},{dark:true});

const lightTheme = EditorView.theme({
  '&':{backgroundColor:'#ffffff',color:'#141413'},
  '.cm-content':{caretColor:'#CC785C',fontFamily:"'JetBrains Mono',Consolas,'Courier New',monospace"},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#CC785C',borderLeftWidth:'2px'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground':{backgroundColor:'#E7C8BC !important'},
  '.cm-activeLine':{backgroundColor:'#F5F0E8'},
  '.cm-gutters':{backgroundColor:'#ffffff',color:'#756F68',border:'none',borderRight:'1px solid #E5DED2'},
  '.cm-activeLineGutter':{backgroundColor:'#F5F0E8',color:'#4A453F'},
  '.cm-foldPlaceholder':{backgroundColor:'#E5DED2',color:'#4A453F',border:'none'},
  '.cm-matchingBracket':{backgroundColor:'#C9BDB044',outline:'none'},
  '.cm-tooltip':{backgroundColor:'#FAF9F5',border:'1px solid #D8D1C5',color:'#141413',borderRadius:'6px',boxShadow:'0 4px 12px rgba(0,0,0,.12)'},
  '.cm-tooltip-autocomplete':{backgroundColor:'#FAF9F5',borderRadius:'6px',overflow:'hidden'},
  '.cm-tooltip-autocomplete>ul':{fontFamily:"'JetBrains Mono',Consolas,monospace",fontSize:'13px'},
  '.cm-tooltip-autocomplete>ul>li':{padding:'4px 10px',lineHeight:'1.4'},
  '&.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#EFE9DE',color:'#141413'},
  '.cm-completionLabel':{color:'#141413'},
  '.cm-completionDetail':{color:'#756F68',fontStyle:'italic',marginLeft:'6px'},
  '.cm-completionIcon-keyword':{color:'#A9583E'},
  '.cm-completionIcon-variable':{color:'#141413'},
  '.cm-completionIcon-function':{color:'#8B5A2B'},
  '.cm-completionIcon-class':{color:'#315F7D'},
  '.cm-completionIcon-string':{color:'#386C5A'},
  '.cm-completionIcon-number':{color:'#8B5A2B'},
  '.cm-completionIcon-snippet':{color:'#A9583E'},
  '.cm-scroller':{overflow:'auto'},
},{dark:false});

// ── API ──
export interface CodeMirrorEditorHandle {
  getValue:()=>string;
  setValue:(v:string)=>void;
  focus:()=>void;
  undo:()=>void;
  redo:()=>void;
  view:EditorView|null;
}

export interface CodeMirrorEditorProps {
  height?:string;
  language?:string;
  defaultValue?:string;
  theme?:string;
  fontSize?:number;
  onChange?:(v:string)=>void;
  onMount?:(h:CodeMirrorEditorHandle)=>void;
}

const LocalCodeMirror = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function LocalCodeMirror(
  {height='100%',language='javascript',defaultValue='',theme='dark',fontSize=16,onChange,onMount},ref
){
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView|null>(null);
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const prevDefaultRef = useRef(defaultValue);

  useEffect(()=>{onChangeRef.current=onChange;},[onChange]);
  useEffect(()=>{onMountRef.current=onMount;},[onMount]);

  // ── 创建（仅一次）──
  useEffect(()=>{
    if(!containerRef.current) return;
    const onChangeExt = EditorView.updateListener.of(u=>{if(u.docChanged)onChangeRef.current?.(u.state.doc.toString());});
    const st = EditorState.create({doc:defaultValue, extensions: [...buildExtensions(language,theme,fontSize), onChangeExt]});
    const v = new EditorView({state:st, parent:containerRef.current});
    viewRef.current = v;
    onMountRef.current?.({getValue:()=>v.state.doc.toString(),setValue:(s)=>v.dispatch({changes:{from:0,to:v.state.doc.length,insert:s}}),focus:()=>v.focus(),undo:()=>undo(v),redo:()=>redo(v),view:v});
    return ()=>{v.destroy();viewRef.current=null;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── 切换题目时更新内容（不销毁重建）──
  useEffect(()=>{
    if(prevDefaultRef.current===defaultValue) return;
    prevDefaultRef.current = defaultValue;
    const v = viewRef.current;
    if(!v) return;
    // 用 dispatch 替换全部内容，保留 undo 历史
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:defaultValue}});
    v.focus();
  },[defaultValue]);

  // ── 语言/主题/字号变化时重建 extensions（极少发生）──
  const extKey = `${language}|${theme}|${fontSize}`;
  useEffect(()=>{
    const v = viewRef.current;
    const p = containerRef.current;
    if(!v||!p) return;
    const doc = v.state.doc.toString();
    const pos = v.state.selection.main.head;
    v.destroy();
    const onChangeExt = EditorView.updateListener.of(u=>{if(u.docChanged)onChangeRef.current?.(u.state.doc.toString());});
    const st = EditorState.create({doc, extensions: [...buildExtensions(language,theme,fontSize), onChangeExt], selection:{anchor:Math.min(pos,doc.length)}});
    const nv = new EditorView({state:st, parent:p});
    viewRef.current = nv;
  },[extKey]);

  // ── 暴露 API ──
  useImperativeHandle(ref,()=>({
    getValue:()=>viewRef.current?.state.doc.toString()??'',
    setValue:(s:string)=>{const v=viewRef.current;if(v)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:s}});},
    focus:()=>viewRef.current?.focus(),
    undo:()=>{if(viewRef.current)undo(viewRef.current);},
    redo:()=>{if(viewRef.current)redo(viewRef.current);},
    view:viewRef.current,
  }));

  return <div ref={containerRef} style={{height,width:'100%',overflow:'auto'}}/>;
});

function buildExtensions(language:string,theme:string,fontSize:number):Extension[]{
  return [
    lineNumbers(),highlightActiveLineGutter(),highlightSpecialChars(),
    history(),foldGutter(),drawSelection(),dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),bracketMatching(),closeBrackets(),
    autocompletion({override:[completionSource(language)],activateOnTyping:true,maxRenderedOptions:15}),
    rectangularSelection(),crosshairCursor(),highlightActiveLine(),highlightSelectionMatches(),
    keymap.of([...closeBracketsKeymap,...defaultKeymap,...searchKeymap,...historyKeymap,...foldKeymap,...completionKeymap,indentWithTab]),
    getLang(language),
    theme==='dark'?darkTheme:lightTheme,
    syntaxHighlighting(theme==='dark'?darkHL:lightHL),
    EditorView.lineWrapping,
    EditorView.theme({'.cm-content':{fontSize:`${fontSize}px`,lineHeight:'1.6'},'.cm-gutters':{fontSize:`${fontSize}px`}}),
  ];
}

export default LocalCodeMirror;
