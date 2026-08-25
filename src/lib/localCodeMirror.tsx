/**
 * localCodeMirror.tsx — CodeMirror 6 编辑器（稳定版，不销毁重建）
 */
import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, type LanguageSupport } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
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

// ── 补全源（只显示前缀匹配 + 文档中实际出现 ≥2 次的标识符）──
function completionSource(langId: string) {
  const lang = langId.trim().toLowerCase();
  const langSnips = SNIPPETS[lang] ?? SNIPPETS.javascript ?? [];

  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const prefix = word.text.toLowerCase();
    if (prefix.length < 2 && !ctx.explicit) return null;

    const options: {label:string;detail:string;type:string;boost:number;apply?:string}[] = [];
    const seen = new Set<string>();

    // 1) 代码片段（前缀匹配）
    for (const s of langSnips) {
      if (s.label.toLowerCase().startsWith(prefix) && !seen.has(s.label)) {
        seen.add(s.label);
        options.push({ label: s.label, detail: s.detail, type: 'snippet', boost: 10, apply: s.insertText });
      }
    }

    // 2) 语言关键字（前缀匹配）
    const keywords = LANGUAGE_KEYWORDS[lang] ?? [];
    for (const k of keywords) {
      if (k.toLowerCase().startsWith(prefix) && !seen.has(k)) {
        seen.add(k);
        options.push({ label: k, detail: '关键字', type: 'keyword', boost: 8 });
      }
    }

    // 3) 文档标识符（前缀匹配 + 出现≥2次；单字母输入时不显示文档标识符）
    const doc = ctx.state.doc.toString();
    if (prefix.length >= 2) {
      const scanLen = Math.min(doc.length, 50000);
      const scanText = scanLen < doc.length ? doc.slice(0, scanLen) : doc;
      const idCounts = new Map<string, number>();
      const re = /\b([A-Za-z_]\w*)\b/g;
      let m: RegExpExecArray|null;
      while ((m = re.exec(scanText))) {
        const id = m[1];
        if (id.length > 1 && !keywords.includes(id) && !langSnips.some(s => s.label === id)) {
          idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
        }
      }
      for (const [id, count] of idCounts) {
        if (count >= 2 && id.toLowerCase().startsWith(prefix) && !seen.has(id)) {
          seen.add(id);
          options.push({ label: id, detail: '当前文件', type: 'variable', boost: 3 });
        }
      }
    }

    if (options.length === 0) return null;
    return { from: word.from, options, validFor: /^[\w$]*$/ };
  };
}

// ── 语言关键字（按语言分组，补全时优先匹配）──
const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  cpp: ['alignas','auto','bool','break','case','catch','char','class','const','constexpr','continue','default','delete','do','double','else','enum','explicit','false','float','for','if','include','inline','int','long','namespace','new','nullptr','private','protected','public','return','short','signed','sizeof','static','std','struct','switch','template','this','throw','true','try','typedef','typename','using','virtual','void','while','vector','map','set','string','iostream','endl','cout','cin'],
  python: ['and','as','assert','async','await','break','class','continue','def','del','elif','else','False','finally','for','from','global','if','import','in','is','lambda','None','nonlocal','not','or','pass','raise','return','True','try','while','with','yield','print','range','len','list','dict','set','tuple','int','str','float','bool','input','open','map','filter','zip','enumerate','sorted','sum','min','max','abs'],
  javascript: ['async','await','break','case','catch','class','const','continue','debugger','default','delete','do','else','export','extends','false','finally','for','function','if','import','in','instanceof','let','new','null','return','static','super','switch','this','throw','true','try','typeof','undefined','var','void','while','with','yield','console','log','length','push','pop','map','filter','reduce','forEach','find','includes','indexOf','slice','splice','concat','join','split','parseInt','parseFloat','Math','Array','Object','JSON','Promise','Date','RegExp','Error'],
  typescript: ['abstract','any','as','async','await','boolean','break','case','catch','class','const','continue','declare','default','delete','else','enum','export','extends','false','finally','for','from','function','if','implements','import','in','interface','is','keyof','let','module','namespace','never','new','null','number','object','private','protected','public','readonly','return','static','string','super','switch','this','throw','true','try','type','typeof','unknown','undefined','var','void','while','Record','Partial','Required','Pick','Omit','Exclude','Extract','Partial','Readonly','Promise','Array','Map','Set'],
};

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
  '.cm-content':{caretColor:'#E59A7F',fontFamily:"var(--font-code)"},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#E59A7F',borderLeftWidth:'2px'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground':{backgroundColor:'#6B4A3D !important'},
  '.cm-activeLine':{backgroundColor:'#252320'},
  '.cm-gutters':{backgroundColor:'#1f1e1b',color:'#96928B',border:'none',borderRight:'1px solid #32302C'},
  '.cm-activeLineGutter':{backgroundColor:'#252320',color:'#D8D3CA'},
  '.cm-foldPlaceholder':{backgroundColor:'#32302C',color:'#D8D3CA',border:'none'},
  '.cm-matchingBracket':{backgroundColor:'#5A554E44',outline:'none'},
  // ── 补全面板（匹配应用设计系统）──
  '.cm-tooltip':{backgroundColor:'#252320',border:'1px solid #3C3934',color:'#FAF9F5',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,.5)',overflow:'hidden'},
  '.cm-tooltip-autocomplete':{backgroundColor:'#252320',borderRadius:'8px',maxHeight:'280px'},
  '.cm-tooltip-autocomplete>ul':{fontFamily:"var(--font-code)",fontSize:'13px',lineHeight:'1.5'},
  '.cm-tooltip-autocomplete>ul>li':{padding:'5px 12px',display:'flex',alignItems:'center',gap:'8px'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#332F2B',color:'#FAF9F5'},
  '.cm-completionLabel':{color:'#FAF9F5',flex:'1'},
  '.cm-completionDetail':{color:'#96928B',fontStyle:'normal',fontSize:'12px',marginLeft:'auto',flexShrink:'0'},
  '.cm-completionIcon':{width:'16px',height:'16px',borderRadius:'3px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'600',flexShrink:'0'},
  '.cm-completionIcon-keyword':{color:'#E59A7F',backgroundColor:'#E59A7F22'},
  '.cm-completionIcon-variable':{color:'#86B6C7',backgroundColor:'#86B6C722'},
  '.cm-completionIcon-function':{color:'#D6B06C',backgroundColor:'#D6B06C22'},
  '.cm-completionIcon-class':{color:'#86B6C7',backgroundColor:'#86B6C722'},
  '.cm-completionIcon-string':{color:'#A8C99A',backgroundColor:'#A8C99A22'},
  '.cm-completionIcon-number':{color:'#D6B06C',backgroundColor:'#D6B06C22'},
  '.cm-completionIcon-snippet':{color:'#E59A7F',backgroundColor:'#E59A7F22'},
  '.cm-completionIcon-text':{color:'#FAF9F5',backgroundColor:'#FAF9F511'},
  '.cm-scroller':{overflow:'auto'},
  '.cm-completionInfo':{backgroundColor:'#252320',border:'1px solid #3C3934',borderRadius:'8px',color:'#FAF9F5',padding:'8px 12px',fontFamily:"var(--font-code)",fontSize:'13px'},
  // 隐藏空补全提示（CodeMirror 默认显示 "No suggestions"）
  '.cm-tooltip-autocomplete:has(> ul:empty)':{display:'none'},
  '.cm-tooltip-autocomplete:has(> ul > li:only-child):not(:has(> ul > li[aria-selected]))':{display:'none'},
},{dark:true});

const lightTheme = EditorView.theme({
  '&':{backgroundColor:'#ffffff',color:'#141413'},
  '.cm-content':{caretColor:'#CC785C',fontFamily:"var(--font-code)"},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#CC785C',borderLeftWidth:'2px'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground':{backgroundColor:'#E7C8BC !important'},
  '.cm-activeLine':{backgroundColor:'#F5F0E8'},
  '.cm-gutters':{backgroundColor:'#ffffff',color:'#756F68',border:'none',borderRight:'1px solid #E5DED2'},
  '.cm-activeLineGutter':{backgroundColor:'#F5F0E8',color:'#4A453F'},
  '.cm-foldPlaceholder':{backgroundColor:'#E5DED2',color:'#4A453F',border:'none'},
  '.cm-matchingBracket':{backgroundColor:'#C9BDB044',outline:'none'},
  // ── 补全面板（匹配应用设计系统）──
  '.cm-tooltip':{backgroundColor:'#FAF9F5',border:'1px solid #D8D1C5',color:'#141413',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,.1)',overflow:'hidden'},
  '.cm-tooltip-autocomplete':{backgroundColor:'#FAF9F5',borderRadius:'8px',maxHeight:'280px'},
  '.cm-tooltip-autocomplete>ul':{fontFamily:"var(--font-code)",fontSize:'13px',lineHeight:'1.5'},
  '.cm-tooltip-autocomplete>ul>li':{padding:'5px 12px',display:'flex',alignItems:'center',gap:'8px'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#EFE9DE',color:'#141413'},
  '.cm-completionLabel':{color:'#141413',flex:'1'},
  '.cm-completionDetail':{color:'#756F68',fontStyle:'normal',fontSize:'12px',marginLeft:'auto',flexShrink:'0'},
  '.cm-completionIcon':{width:'16px',height:'16px',borderRadius:'3px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'600',flexShrink:'0'},
  '.cm-completionIcon-keyword':{color:'#A9583E',backgroundColor:'#A9583E15'},
  '.cm-completionIcon-variable':{color:'#315F7D',backgroundColor:'#315F7D15'},
  '.cm-completionIcon-function':{color:'#8B5A2B',backgroundColor:'#8B5A2B15'},
  '.cm-completionIcon-class':{color:'#315F7D',backgroundColor:'#315F7D15'},
  '.cm-completionIcon-string':{color:'#386C5A',backgroundColor:'#386C5A15'},
  '.cm-completionIcon-number':{color:'#8B5A2B',backgroundColor:'#8B5A2B15'},
  '.cm-completionIcon-snippet':{color:'#A9583E',backgroundColor:'#A9583E15'},
  '.cm-completionIcon-text':{color:'#141413',backgroundColor:'#14141308'},
  '.cm-scroller':{overflow:'auto'},
  '.cm-completionInfo':{backgroundColor:'#FAF9F5',border:'1px solid #D8D1C5',borderRadius:'8px',color:'#141413',padding:'8px 12px',fontFamily:"var(--font-code)",fontSize:'13px'},
  // 隐藏空补全提示
  '.cm-tooltip-autocomplete:has(> ul:empty)':{display:'none'},
  '.cm-tooltip-autocomplete:has(> ul > li:only-child):not(:has(> ul > li[aria-selected]))':{display:'none'},
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

  // ── 编辑器内容只在创建时设置，之后由用户输入和 setValue 管理 ──
  // React key 保证切换题目时组件重新挂载，无需额外 effect

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
    autocompletion({override:[completionSource(language)],activateOnTyping:false,maxRenderedOptions:15}),
    rectangularSelection(),crosshairCursor(),highlightActiveLine(),highlightSelectionMatches(),
    // Prec.highest 确保 Tab/Enter 覆盖 completionKeymap 的默认行为
    Prec.high(keymap.of([
      {key:'Tab', run:(view)=>{if(acceptCompletion(view))return true;return false;}, shift:indentWithTab.shift},
      {key:'Enter', run:()=>false},
    ])),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    getLang(language),
    theme==='dark'?darkTheme:lightTheme,
    syntaxHighlighting(theme==='dark'?darkHL:lightHL),
    EditorView.lineWrapping,
    EditorView.theme({'.cm-content':{fontSize:`${fontSize}px`,lineHeight:'1.6',fontFamily:'var(--font-code)'},'.cm-gutters':{fontSize:`${fontSize}px`}}),
  ];
}

export default LocalCodeMirror;
