import { invoke } from '@tauri-apps/api/core';
import type {
  ProblemSampleRunRequest,
  ProblemSampleRunResult,
  RunCodeResult,
} from '../types';
import { runCode } from './runCode';

interface NativeCodeRunResult extends RunCodeResult {}

export interface CppParameter {
  name: string;
  type: string;
  mutableReference: boolean;
}

export interface CppFunctionSignature {
  name: string;
  returnType: string;
  owner: 'solution' | 'free';
  parameters: CppParameter[];
}

export interface ScriptFunctionSignature {
  name: string;
  owner: 'solution' | 'free';
  parameters: string[];
  parameterKinds?: ScriptValueKind[];
  returnKind?: ScriptValueKind;
}

type ScriptValueKind = 'normal' | 'listnode' | 'treenode';

interface FunctionCandidate extends CppFunctionSignature {
  position: number;
}

const CPP_LANGUAGES = new Set(['cpp', 'c++', 'cpp17', 'c++17']);
const MAX_CPP_SOURCE_LENGTH = 512_000;

export async function runProblemSample(request: ProblemSampleRunRequest): Promise<ProblemSampleRunResult> {
  const sampleIndex = Math.max(0, Math.trunc(request.sampleIndex ?? 0));
  const example = request.problem.examples[sampleIndex];
  const input = example?.input ?? (sampleIndex === 0 ? request.problem.sampleTestCase ?? '' : '');
  const expectedOutput = example?.output ?? '';
  const language = request.language.trim().toLowerCase();

  if (!example && !input) {
    return failure('这道题还没有可运行的样例，请先补充样例输入和预期输出。', sampleIndex, expectedOutput);
  }
  if (!request.code.trim()) {
    return failure('代码还是空的。请先写出题目要求的解题函数，再运行样例。', sampleIndex, expectedOutput);
  }

  if (CPP_LANGUAGES.has(language)) {
    return runCppProblemSample({ ...request, sampleIndex }, input, expectedOutput);
  }

  if (language === 'javascript' || language === 'typescript') {
    let source = request.code;
    let generatedEntryPoint = false;
    let mode: ProblemSampleRunResult['mode'] = 'stdin';
    const canBuildFunction = (() => {
      try { return buildJavaScriptFunctionHarness(source, input).source; }
      catch { return null; }
    })();
    if (canBuildFunction && (!usesJavaScriptStandardInput(source) || hasJavaScriptFunctionSignature(source))) {
      source = canBuildFunction;
      generatedEntryPoint = true;
      mode = 'function';
    } else if (!canBuildFunction && !usesJavaScriptStandardInput(source)) {
      return failure('没有识别到可测试的 JavaScript/TypeScript 解题函数，也没有明确的标准输入入口。', sampleIndex, expectedOutput, true, 'function');
    }
    const result = await runCode({ language, code: source, input, timeoutMs: request.timeoutMs });
    return finishResult(result, sampleIndex, expectedOutput, generatedEntryPoint, mode);
  }

  if (language === 'python' || language === 'python3') {
    let source = request.code;
    let generatedEntryPoint = false;
    let mode: ProblemSampleRunResult['mode'] = 'stdin';
    const canBuildFunction = (() => {
      try { return buildPythonFunctionHarness(source, input).source; }
      catch { return null; }
    })();
    if (canBuildFunction && (!usesPythonStandardInput(source) || hasPythonFunctionSignature(source))) {
      source = canBuildFunction;
      generatedEntryPoint = true;
      mode = 'function';
    } else if (!canBuildFunction && !usesPythonStandardInput(source)) {
      return failure('没有识别到可测试的 Python 解题函数，也没有明确的标准输入入口。', sampleIndex, expectedOutput, true, 'function');
    }
    const result = await runCode({ language, code: source, input, timeoutMs: request.timeoutMs });
    return finishResult(result, sampleIndex, expectedOutput, generatedEntryPoint, mode);
  }

  const result = await runCode({
    language: request.language,
    code: request.code,
    input,
    timeoutMs: request.timeoutMs,
  });
  return finishResult(result, sampleIndex, expectedOutput, false, 'stdin');
}

export function buildJavaScriptFunctionHarness(code: string, sampleInput: string): {
  source: string;
  signature: ScriptFunctionSignature;
} {
  const signature = parseJavaScriptFunctionSignature(code, sampleInput);
  const values = scriptSampleValues(sampleInput, signature.parameters);
  const parameterKinds = scriptParameterKinds(signature);
  const returnKind = signature.returnKind ?? 'normal';
  const needsAdapter = needsScriptStructureAdapter(parameterKinds, returnKind);
  const call = signature.owner === 'solution'
    ? `new Solution().${signature.name}(...__proofline_args)`
    : `${signature.name}(...__proofline_args)`;
  if (needsAdapter) {
    return {
      signature,
      source: [
        code.trim(),
        buildJavaScriptStructureHelpers(parameterKinds, returnKind),
        `const __proofline_raw_args = ${JSON.stringify(values)};`,
        `const __proofline_arg_kinds = ${JSON.stringify(parameterKinds)};`,
        `const __proofline_return_kind = ${JSON.stringify(returnKind)};`,
        'const __proofline_args = __proofline_raw_args.map((value, index) => __prooflineAdaptInput(value, __proofline_arg_kinds[index]));',
        `const __proofline_result = ${call};`,
        'const __proofline_output = __prooflineAdaptOutput(__proofline_result, __proofline_return_kind);',
        'console.log(JSON.stringify(__proofline_output));',
      ].join('\n\n'),
    };
  }
  return {
    signature,
    source: `${code.trim()}\n\nconst __proofline_args = ${JSON.stringify(values)};\nconst __proofline_result = ${call};\nconsole.log(JSON.stringify(__proofline_result));`,
  };
}

export function parseJavaScriptFunctionSignature(code: string, sampleInput = ''): ScriptFunctionSignature {
  const clean = stripCppComments(code);
  const jsDocHints = extractJavaScriptTypeHints(code);
  const candidates: ScriptFunctionSignature[] = [];
  const solutionBody = findClassBody(clean, 'Solution');
  if (solutionBody) {
    const methodPattern = /(?:^|[;}\n])\s*(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?::\s*([^\{]+))?\{/gm;
    let match: RegExpExecArray | null;
    while ((match = methodPattern.exec(solutionBody.body))) {
      if (SCRIPT_RESERVED_NAMES.has(match[1])) continue;
      const descriptors = parseScriptParameterDescriptors(match[2], 'typescript', jsDocHints.parameters);
      candidates.push({
        name: match[1],
        owner: 'solution',
        parameters: descriptors.map((parameter) => parameter.name),
        parameterKinds: descriptors.map((parameter) => parameter.kind),
        returnKind: scriptKindFromType(match[3]) ?? jsDocHints.returnKind,
      });
    }
  }
  if (candidates.length === 0) {
    const patterns = [
      /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?::\s*([^\{\n]+))?/gm,
      /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?function\s*\(([^()]*)\)\s*(?::\s*([^\{\n]+))?/gm,
      /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^()]*)\)\s*(?::\s*([^=]+))?=>/gm,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(clean))) {
        if (SCRIPT_RESERVED_NAMES.has(match[1])) continue;
        const descriptors = parseScriptParameterDescriptors(match[2], 'typescript', jsDocHints.parameters);
        candidates.push({
          name: match[1],
          owner: 'free',
          parameters: descriptors.map((parameter) => parameter.name),
          parameterKinds: descriptors.map((parameter) => parameter.kind),
          returnKind: scriptKindFromType(match[3]) ?? jsDocHints.returnKind,
        });
      }
    }
  }
  return chooseScriptCandidate(candidates, sampleInput, 'JavaScript/TypeScript');
}

export function buildPythonFunctionHarness(code: string, sampleInput: string): {
  source: string;
  signature: ScriptFunctionSignature;
} {
  const signature = parsePythonFunctionSignature(code, sampleInput);
  const values = scriptSampleValues(sampleInput, signature.parameters);
  const parameterKinds = scriptParameterKinds(signature);
  const returnKind = signature.returnKind ?? 'normal';
  const needsAdapter = needsScriptStructureAdapter(parameterKinds, returnKind);
  const encodedArguments = JSON.stringify(JSON.stringify(values));
  const target = signature.owner === 'solution'
    ? `Solution().${signature.name}(*__proofline_args)`
    : `${signature.name}(*__proofline_args)`;
  if (needsAdapter) {
    return {
      signature,
      source: [
        'from typing import *',
        buildPythonStructureHelpers(parameterKinds, returnKind),
        code.trim(),
        'import json as __proofline_json',
        `__proofline_raw_args = __proofline_json.loads(${encodedArguments})`,
        `__proofline_arg_kinds = ${JSON.stringify(parameterKinds)}`,
        `__proofline_return_kind = ${JSON.stringify(returnKind)}`,
        '__proofline_args = [__proofline_adapt_input(value, __proofline_arg_kinds[index]) for index, value in enumerate(__proofline_raw_args)]',
        `__proofline_result = ${target}`,
        '__proofline_output = __proofline_adapt_output(__proofline_result, __proofline_return_kind)',
        "print(__proofline_json.dumps(__proofline_output, ensure_ascii=False, separators=(',', ':')))",
      ].join('\n\n'),
    };
  }
  return {
    signature,
    source: `from typing import *\n${code.trim()}\n\nimport json as __proofline_json\n__proofline_args = __proofline_json.loads(${encodedArguments})\n__proofline_result = ${target}\nprint(__proofline_json.dumps(__proofline_result, ensure_ascii=False, separators=(',', ':')))`,
  };
}

export function parsePythonFunctionSignature(code: string, sampleInput = ''): ScriptFunctionSignature {
  const candidates: ScriptFunctionSignature[] = [];
  const classMatch = /^class\s+Solution\b[^:]*:/m.exec(code);
  if (classMatch) {
    const afterClass = code.slice(classMatch.index + classMatch[0].length);
    const nextTopLevel = /^\S.*$/m.exec(afterClass);
    const body = nextTopLevel ? afterClass.slice(0, nextTopLevel.index) : afterClass;
    const methodPattern = /^[ \t]+def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:->\s*([^:]+))?:/gm;
    let match: RegExpExecArray | null;
    while ((match = methodPattern.exec(body))) {
      if (match[1].startsWith('__')) continue;
      const descriptors = parseScriptParameterDescriptors(match[2], 'python')
        .filter((parameter) => parameter.name !== 'self' && parameter.name !== 'cls');
      candidates.push({
        name: match[1],
        owner: 'solution',
        parameters: descriptors.map((parameter) => parameter.name),
        parameterKinds: descriptors.map((parameter) => parameter.kind),
        returnKind: scriptKindFromType(match[3]),
      });
    }
  }
  if (candidates.length === 0) {
    const functionPattern = /^def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:->\s*([^:]+))?:/gm;
    let match: RegExpExecArray | null;
    while ((match = functionPattern.exec(code))) {
      if (match[1].startsWith('__')) continue;
      const descriptors = parseScriptParameterDescriptors(match[2], 'python');
      candidates.push({
        name: match[1],
        owner: 'free',
        parameters: descriptors.map((parameter) => parameter.name),
        parameterKinds: descriptors.map((parameter) => parameter.kind),
        returnKind: scriptKindFromType(match[3]),
      });
    }
  }
  return chooseScriptCandidate(candidates, sampleInput, 'Python');
}

interface ScriptParameterDescriptor {
  name: string;
  kind: ScriptValueKind;
}

function parseScriptParameterDescriptors(
  raw: string,
  language: 'python' | 'typescript',
  externalKinds = new Map<string, ScriptValueKind>(),
): ScriptParameterDescriptor[] {
  if (!raw.trim()) return [];
  return splitTopLevel(raw, ',').map((part) => {
    let parameter = splitTopLevel(part, '=')[0].trim().replace(/^\.\.\./, '');
    const match = language === 'typescript'
      ? /^([A-Za-z_]\w*)\??\s*(?::\s*(.+))?$/.exec(parameter)
      : /^([A-Za-z_]\w*)\s*(?::\s*(.+))?$/.exec(parameter);
    if (!match) throw new Error(`无法识别函数参数：${part.trim()}`);
    const name = match[1];
    return {
      name,
      kind: scriptKindFromType(match[2]) ?? externalKinds.get(name) ?? 'normal',
    };
  });
}

function chooseScriptCandidate(
  candidates: ScriptFunctionSignature[],
  sampleInput: string,
  languageLabel: string,
): ScriptFunctionSignature {
  if (candidates.length === 0) {
    throw new Error(`没有识别到可测试的 ${languageLabel} 解题函数。请保留平台给出的函数或 Solution 方法，不需要自己写测试入口。`);
  }
  const named = parseNamedSampleValues(sampleInput);
  const positionalCount = named.size === 0 ? countPositionalSampleValues(sampleInput) : undefined;
  const compatible = candidates.filter((candidate) => named.size > 0
    ? candidate.parameters.every((parameter) => named.has(parameter))
    : positionalCount === undefined || candidate.parameters.length === positionalCount);
  if (compatible.length === 1) return compatible[0];
  if (compatible.length === 0 && candidates.length === 1) return candidates[0];
  throw new Error(`${languageLabel} 代码中存在多个可能的解题函数，无法确定要测试哪一个。请仅保留当前题目的平台函数签名。`);
}

function scriptSampleValues(input: string, parameters: string[]): unknown[] {
  const placeholders = parameters.map((name) => ({ name, type: '' as string, mutableReference: false }));
  return resolveSampleValues(input, placeholders).map((raw, index) => {
    try { return JSON.parse(raw); }
    catch { throw new Error(`参数 ${parameters[index]} 的样例不是可识别的 JSON 值：${raw}`); }
  });
}

function scriptParameterKinds(signature: ScriptFunctionSignature): ScriptValueKind[] {
  return signature.parameters.map((_, index) => signature.parameterKinds?.[index] ?? 'normal');
}

function needsScriptStructureAdapter(parameterKinds: ScriptValueKind[], returnKind: ScriptValueKind): boolean {
  return returnKind !== 'normal' || parameterKinds.some((kind) => kind !== 'normal');
}

function scriptKindFromType(typeText?: string): ScriptValueKind | undefined {
  if (!typeText) return undefined;
  if (/\bListNode\b/.test(typeText)) return 'listnode';
  if (/\bTreeNode\b/.test(typeText)) return 'treenode';
  return undefined;
}

function extractJavaScriptTypeHints(code: string): {
  parameters: Map<string, ScriptValueKind>;
  returnKind?: ScriptValueKind;
} {
  const parameters = new Map<string, ScriptValueKind>();
  let returnKind: ScriptValueKind | undefined;
  const jsDocPattern = /\/\*\*([\s\S]*?)\*\//g;
  let block: RegExpExecArray | null;
  while ((block = jsDocPattern.exec(code))) {
    const text = block[1];
    const paramPattern = /@param\s+(?:\{([^}]+)\}\s*)?([A-Za-z_]\w*|\[[^\]]+\])/g;
    let param: RegExpExecArray | null;
    while ((param = paramPattern.exec(text))) {
      const kind = scriptKindFromType(param[1]);
      if (!kind) continue;
      const name = param[2].replace(/^\[/, '').replace(/\]$/, '').split('=')[0].trim();
      if (name) parameters.set(name, kind);
    }
    const returns = /@returns?\s+(?:\{([^}]+)\})?/m.exec(text);
    returnKind = scriptKindFromType(returns?.[1]) ?? returnKind;
  }
  return { parameters, returnKind };
}

function buildPythonStructureHelpers(parameterKinds: ScriptValueKind[], returnKind: ScriptValueKind): string {
  const needsList = returnKind === 'listnode' || parameterKinds.includes('listnode');
  const needsTree = returnKind === 'treenode' || parameterKinds.includes('treenode');
  return [
    needsList ? PYTHON_LIST_NODE_HELPERS : '',
    needsTree ? PYTHON_TREE_NODE_HELPERS : '',
    PYTHON_SCRIPT_ADAPTER_HELPERS,
  ].filter(Boolean).join('\n\n');
}

function buildJavaScriptStructureHelpers(parameterKinds: ScriptValueKind[], returnKind: ScriptValueKind): string {
  const needsList = returnKind === 'listnode' || parameterKinds.includes('listnode');
  const needsTree = returnKind === 'treenode' || parameterKinds.includes('treenode');
  return [
    needsList ? JAVASCRIPT_LIST_NODE_HELPERS : '',
    needsTree ? JAVASCRIPT_TREE_NODE_HELPERS : '',
    JAVASCRIPT_SCRIPT_ADAPTER_HELPERS,
  ].filter(Boolean).join('\n\n');
}

function usesJavaScriptStandardInput(code: string): boolean {
  const clean = stripCppComments(code).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
  return /(?:^|\n)\s*(?:const\s+readline|let\s+readline|var\s+readline|process\.stdin\b|require\s*\(\s*['"]readline['"]|readFileSync\s*\()/.test(clean);
}

function usesPythonStandardInput(code: string): boolean {
  const clean = code.replace(/#.*$/gm, '').replace(/('{3}|"{3})[\s\S]*?\1/g, '');
  return /(?:^|\n)\s*(?:input\s*\(|sys\.stdin\b|stdin\.read\s*\()/.test(clean);
}

function hasJavaScriptFunctionSignature(code: string): boolean {
  return /(?:class\s+Solution\b|(?:function|const|let|var)\s+[A-Za-z_$][\w$]*\s*(?:=\s*)?(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*\([^)]*\)))/.test(stripCppComments(code));
}

function hasPythonFunctionSignature(code: string): boolean {
  return /(?:^|\n)\s*(?:class\s+Solution\b|def\s+[A-Za-z_]\w*\s*\()/.test(code.replace(/#.*$/gm, ''));
}

const SCRIPT_RESERVED_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor']);

async function runCppProblemSample(
  request: ProblemSampleRunRequest & { sampleIndex: number },
  input: string,
  expectedOutput: string,
): Promise<ProblemSampleRunResult> {
  if (!isTauriRuntime()) {
    return failure('C++17 本地编译只在 Proofline 桌面版中可用。请启动桌面应用后再运行样例。', request.sampleIndex, expectedOutput);
  }

  let source = request.code;
  let generatedEntryPoint = false;
  let mode: ProblemSampleRunResult['mode'] = 'stdin';
  let standardInput = input;

  if (!hasCppMain(request.code)) {
    try {
      const wrapped = buildCppFunctionHarness(request.code, input);
      source = wrapped.source;
      generatedEntryPoint = true;
      mode = 'function';
      standardInput = '';
    } catch (error) {
      return failure(errorMessage(error), request.sampleIndex, expectedOutput, true, 'function');
    }
  }

  if (source.length > MAX_CPP_SOURCE_LENGTH) {
    return failure('生成后的 C++17 代码超过 500 KB，已停止编译。', request.sampleIndex, expectedOutput, generatedEntryPoint, mode);
  }

  try {
    const result = await invoke<NativeCodeRunResult>('run_cpp_code', {
      request: {
        code: source,
        input: standardInput,
        timeoutMs: request.timeoutMs ?? 3_000,
      },
    });
    return finishResult(result, request.sampleIndex, expectedOutput, generatedEntryPoint, mode);
  } catch (error) {
    return failure(`C++17 运行服务调用失败：${errorMessage(error)}`, request.sampleIndex, expectedOutput, generatedEntryPoint, mode);
  }
}

export function hasCppMain(code: string): boolean {
  return /\b(?:int|signed)\s+main\s*\(/.test(stripCppComments(code));
}

export function parseCppFunctionSignature(code: string, sampleInput = ''): CppFunctionSignature {
  const clean = stripCppComments(code);
  const solutionBody = findClassBody(clean, 'Solution');
  let candidates: FunctionCandidate[] = [];
  if (solutionBody) candidates = extractFunctionCandidates(solutionBody.body, 'solution', solutionBody.offset);
  if (candidates.length === 0) candidates = extractFunctionCandidates(clean, 'free', 0)
    .filter((candidate) => candidate.name !== 'main');
  if (candidates.length === 0) {
    throw new Error('没有识别到可测试的解题函数。请保留平台给出的函数签名，例如 `class Solution { public: int solve(...); }`，不需要自己写 main。');
  }

  const namedValues = parseNamedSampleValues(sampleInput);
  const positionalCount = namedValues.size === 0 ? countPositionalSampleValues(sampleInput) : undefined;
  let compatible = candidates.filter((candidate) => {
    if (namedValues.size > 0) return candidate.parameters.every((parameter) => namedValues.has(parameter.name));
    return positionalCount === undefined || positionalCount === candidate.parameters.length;
  });
  if (compatible.length === 0 && candidates.length === 1) compatible = candidates;
  if (compatible.length !== 1) {
    const signatures = candidates.map(formatSignature).join('、');
    throw new Error(`代码中存在多个可能的解题函数，无法确定要测试哪一个：${signatures}。请仅保留当前题目的平台函数签名。`);
  }
  return compatible[0];
}

export function buildCppFunctionHarness(code: string, sampleInput: string): {
  source: string;
  signature: CppFunctionSignature;
} {
  const signature = parseCppFunctionSignature(code, sampleInput);
  const values = resolveSampleValues(sampleInput, signature.parameters);
  const declarations = signature.parameters.map((parameter, index) => {
    const variableType = valueType(parameter.type);
    const literal = toCppLiteral(values[index], variableType);
    return `  ${variableType} proofline_arg_${index} = ${literal};`;
  });
  const argumentsList = signature.parameters.map((_, index) => `proofline_arg_${index}`).join(', ');
  const target = signature.owner === 'solution'
    ? `proofline_solution.${signature.name}(${argumentsList})`
    : `${signature.name}(${argumentsList})`;
  const callLines: string[] = [];
  if (signature.owner === 'solution') callLines.push('  Solution proofline_solution;');
  if (canonicalType(signature.returnType) === 'void') {
    const printableIndex = signature.parameters.findIndex((parameter) => parameter.mutableReference);
    if (printableIndex < 0) {
      throw new Error('这个函数没有返回值，也没有可观察的引用参数，应用无法判断样例结果。请在官方平台运行该题。');
    }
    callLines.push(`  ${target};`, `  proofline_print(proofline_arg_${printableIndex});`);
  } else {
    callLines.push(`  auto proofline_result = ${target};`, '  proofline_print(proofline_result);');
  }

  const typeText = [signature.returnType, ...signature.parameters.map((parameter) => parameter.type)].join(' ');
  const listSupport = /\bListNode\s*\*/.test(typeText) || /\bListNode\b/.test(code);
  const treeSupport = /\bTreeNode\s*\*/.test(typeText) || /\bTreeNode\b/.test(code);
  const clean = stripCppComments(code);
  const definitions = [
    listSupport && !/\b(?:struct|class)\s+ListNode\b/.test(clean) ? LIST_NODE_DEFINITION : '',
    treeSupport && !/\b(?:struct|class)\s+TreeNode\b/.test(clean) ? TREE_NODE_DEFINITION : '',
  ].filter(Boolean).join('\n');

  const source = [
    '#include <bits/stdc++.h>',
    'using namespace std;',
    definitions,
    code.trim(),
    CPP_PRINT_HELPERS,
    listSupport ? LIST_NODE_HELPERS : '',
    treeSupport ? TREE_NODE_HELPERS : '',
    'int main() {',
    '  ios::sync_with_stdio(false);',
    '  cin.tie(nullptr);',
    ...declarations,
    ...callLines,
    "  cout << '\\n';",
    '  return 0;',
    '}',
  ].filter(Boolean).join('\n\n');
  return { source, signature };
}

function extractFunctionCandidates(scope: string, owner: CppFunctionSignature['owner'], offset: number): FunctionCandidate[] {
  const visible = scope.replace(/\b(?:public|private|protected)\s*:/g, '\n');
  const pattern = /(?:^|[;}\n])\s*(?:(?:virtual|static|inline|constexpr|friend)\s+)*([A-Za-z_][\w:\s<>,*&]*?)\s+([A-Za-z_]\w*)\s*\(([^()]*?)\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?\{/gm;
  const candidates: FunctionCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible))) {
    const returnType = match[1].trim().replace(/\s+/g, ' ');
    const name = match[2];
    if (['if', 'for', 'while', 'switch', 'catch', 'main'].includes(name)) continue;
    if (/\b(?:if|for|while|switch|return|new|delete)$/.test(returnType)) continue;
    let parameters: CppParameter[];
    try {
      parameters = parseCppParameters(match[3]);
    } catch {
      continue;
    }
    candidates.push({ name, returnType, owner, parameters, position: offset + match.index });
  }
  return candidates.sort((left, right) => left.position - right.position);
}

function parseCppParameters(raw: string): CppParameter[] {
  if (!raw.trim() || raw.trim() === 'void') return [];
  return splitTopLevel(raw, ',').map((parameter) => {
    const withoutDefault = splitTopLevel(parameter, '=')[0].trim();
    const match = withoutDefault.match(/^(.*(?:\s|\*|&))([A-Za-z_]\w*)\s*$/);
    if (!match) throw new Error(`无法识别参数：${withoutDefault}`);
    const type = match[1].trim();
    if (!type || /\(\s*\*/.test(type) || /\[\s*\]$/.test(withoutDefault)) throw new Error(`暂不支持参数：${withoutDefault}`);
    return {
      name: match[2],
      type,
      mutableReference: type.includes('&') && !/\bconst\b/.test(type),
    };
  });
}

function findClassBody(code: string, className: string): { body: string; offset: number } | undefined {
  const match = new RegExp(`\\bclass\\s+${className}\\b[^\\{]*\\{`).exec(code);
  if (!match) return undefined;
  const open = code.indexOf('{', match.index);
  const close = findMatchingBrace(code, open);
  if (close < 0) return undefined;
  return { body: code.slice(open + 1, close), offset: open + 1 };
}

function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  return -1;
}

function resolveSampleValues(input: string, parameters: CppParameter[]): string[] {
  if (parameters.length === 0) return [];
  const named = parseNamedSampleValues(input);
  if (named.size > 0) {
    const missing = parameters.filter((parameter) => !named.has(parameter.name));
    if (missing.length > 0) {
      throw new Error(`样例输入缺少参数：${missing.map((parameter) => parameter.name).join('、')}。请检查样例是否完整。`);
    }
    return parameters.map((parameter) => named.get(parameter.name) ?? '');
  }
  if (parameters.length === 1) return [stripInputPrefix(input).trim()];
  const values = splitTopLevelValues(stripInputPrefix(input));
  if (values.length !== parameters.length) {
    throw new Error(`函数需要 ${parameters.length} 个参数，但样例只识别到 ${values.length} 个。建议使用“参数名 = 值”的样例格式。`);
  }
  return values;
}

function parseNamedSampleValues(input: string): Map<string, string> {
  const text = stripInputPrefix(input);
  const markers: Array<{ name: string; nameStart: number; valueStart: number }> = [];
  let square = 0;
  let round = 0;
  let curly = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '[') square += 1;
    else if (character === ']') square -= 1;
    else if (character === '(') round += 1;
    else if (character === ')') round -= 1;
    else if (character === '{') curly += 1;
    else if (character === '}') curly -= 1;
    if (square !== 0 || round !== 0 || curly !== 0 || !/[A-Za-z_]/.test(character)) continue;
    if (index > 0 && /[A-Za-z0-9_]/.test(text[index - 1])) continue;
    const nameMatch = text.slice(index).match(/^([A-Za-z_]\w*)\s*=/);
    if (!nameMatch) continue;
    const equalOffset = nameMatch[0].lastIndexOf('=');
    markers.push({ name: nameMatch[1], nameStart: index, valueStart: index + equalOffset + 1 });
    index += nameMatch[0].length - 1;
  }
  const values = new Map<string, string>();
  markers.forEach((marker, index) => {
    const end = markers[index + 1]?.nameStart ?? text.length;
    const value = text.slice(marker.valueStart, end).replace(/^[\s,;]+|[\s,;]+$/g, '');
    if (value) values.set(marker.name, value);
  });
  return values;
}

function countPositionalSampleValues(input: string): number | undefined {
  const text = stripInputPrefix(input).trim();
  if (!text) return 0;
  return splitTopLevelValues(text).length;
}

function splitTopLevelValues(text: string): string[] {
  const byLine = splitTopLevelWithSeparators(text, new Set(['\n', '\r']));
  if (byLine.length > 1) return byLine;
  return splitTopLevelWithSeparators(text, new Set([',']));
}

function splitTopLevel(text: string, separator: string): string[] {
  return splitTopLevelWithSeparators(text, new Set([separator]));
}

function splitTopLevelWithSeparators(text: string, separators: Set<string>): string[] {
  const values: string[] = [];
  let start = 0;
  let angle = 0;
  let square = 0;
  let round = 0;
  let curly = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '<') angle += 1;
    else if (character === '>' && angle > 0) angle -= 1;
    else if (character === '[') square += 1;
    else if (character === ']') square -= 1;
    else if (character === '(') round += 1;
    else if (character === ')') round -= 1;
    else if (character === '{') curly += 1;
    else if (character === '}') curly -= 1;
    if (angle === 0 && square === 0 && round === 0 && curly === 0 && separators.has(character)) {
      const value = text.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function valueType(type: string): string {
  return canonicalType(type).replace(/&+$/, '');
}

function canonicalType(type: string): string {
  return type
    .replace(/\bconst\b/g, '')
    .replace(/\bvolatile\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([<>,*&])\s*/g, '$1')
    .trim();
}

function toCppLiteral(raw: string, type: string): string {
  const normalized = canonicalType(type);
  const vectorInner = vectorInnerType(normalized);
  if (vectorInner) {
    const value = parseJson(raw, `参数类型 ${normalized} 需要数组样例，例如 [1, 2, 3]`);
    if (!Array.isArray(value)) throw new Error(`无法把“${raw}”解析为 ${normalized}。`);
    return `${normalized}{${value.map((item) => toCppLiteral(JSON.stringify(item), vectorInner)).join(', ')}}`;
  }
  if (normalized === 'ListNode*') {
    const value = parseJson(raw, '链表参数需要数组样例，例如 [1, 2, 3]');
    if (value === null) return 'nullptr';
    if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) throw new Error('链表参数只支持整数数组样例。');
    return `proofline_make_list(vector<long long>{${value.join(', ')}})`;
  }
  if (normalized === 'TreeNode*') {
    const value = parseJson(raw, '二叉树参数需要层序数组样例，例如 [1, 2, 3, null]');
    if (value === null) return 'nullptr';
    if (!Array.isArray(value) || value.some((item) => item !== null && !Number.isInteger(item))) throw new Error('二叉树参数只支持整数和 null 组成的层序数组。');
    return `proofline_make_tree(vector<optional<long long>>{${value.map((item) => item === null ? 'nullopt' : item).join(', ')}})`;
  }
  if (/^(?:bool)$/.test(normalized)) {
    if (!/^(?:true|false)$/i.test(raw.trim())) throw new Error(`布尔参数无法解析：${raw}`);
    return raw.trim().toLowerCase();
  }
  if (/^(?:char)$/.test(normalized)) {
    const value = parseQuotedString(raw);
    if ([...value].length !== 1) throw new Error(`字符参数必须恰好包含一个字符：${raw}`);
    return cppCharLiteral(value);
  }
  if (/^(?:(?:std::)?string)$/.test(normalized)) return JSON.stringify(parseQuotedString(raw));
  if (/^(?:short|int|long|longlong|long long|unsigned|unsignedint|unsigned int|unsignedlong|unsigned long|unsignedlonglong|unsigned long long|size_t)$/.test(normalized)) {
    if (!/^[+-]?\d+$/.test(raw.trim())) throw new Error(`整数参数无法解析：${raw}`);
    return raw.trim();
  }
  if (/^(?:float|double|longdouble|long double)$/.test(normalized)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) throw new Error(`浮点参数无法解析：${raw}`);
    return raw.trim();
  }
  throw new Error(`暂不支持自动构造参数类型 ${normalized}。应用没有猜测类型，请在官方平台运行或改用标准输入 main。`);
}

function vectorInnerType(type: string): string | undefined {
  const prefix = type.startsWith('std::vector<') ? 'std::vector<' : type.startsWith('vector<') ? 'vector<' : '';
  if (!prefix || !type.endsWith('>')) return undefined;
  return type.slice(prefix.length, -1);
}

function parseJson(raw: string, hint: string): unknown {
  try { return JSON.parse(raw.trim()); }
  catch { throw new Error(`${hint}，当前内容为：${raw}`); }
}

function parseQuotedString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  const value = parseJson(trimmed, '字符串参数需要使用引号，例如 "abc"');
  if (typeof value !== 'string') throw new Error(`字符串参数无法解析：${raw}`);
  return value;
}

function cppCharLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return `'${escaped}'`;
}

function stripInputPrefix(input: string): string {
  return input.trim().replace(/^(?:输入|Input)\s*[:：]\s*/i, '');
}

function stripCppComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n\r]*/g, '');
}

function finishResult(
  result: RunCodeResult,
  sampleIndex: number,
  expectedOutput: string,
  generatedEntryPoint: boolean,
  mode: ProblemSampleRunResult['mode'],
): ProblemSampleRunResult {
  const actualOutput = result.output.trim();
  const passed = result.ok && expectedOutput.trim() ? outputsEqual(actualOutput, expectedOutput) : undefined;
  return { ...result, sampleIndex, expectedOutput, actualOutput, passed, generatedEntryPoint, mode };
}

function failure(
  error: string,
  sampleIndex: number,
  expectedOutput: string,
  generatedEntryPoint = false,
  mode: ProblemSampleRunResult['mode'] = 'stdin',
): ProblemSampleRunResult {
  return {
    ok: false,
    output: '',
    error,
    durationMs: 0,
    timedOut: false,
    sampleIndex,
    expectedOutput,
    actualOutput: '',
    generatedEntryPoint,
    mode,
  };
}

export function outputsEqual(actual: string, expected: string): boolean {
  return canonicalOutput(actual) === canonicalOutput(expected);
}

export function formatProblemSampleResult(result: ProblemSampleRunResult): string {
  const elapsed = `${Math.max(0, result.durationMs).toFixed(result.durationMs < 10 ? 1 : 0)} ms`;
  if (!result.ok) {
    const partial = result.actualOutput ? `\n已产生输出：${result.actualOutput}` : '';
    return `${result.error || '样例运行失败。'}${partial}`;
  }
  if (result.passed === true) {
    return `样例 ${result.sampleIndex + 1} 通过\n实际输出：${result.actualOutput || '（无输出）'}\n耗时：${elapsed}`;
  }
  if (result.passed === false) {
    return `样例 ${result.sampleIndex + 1} 未通过\n实际输出：${result.actualOutput || '（无输出）'}\n预期输出：${result.expectedOutput}\n耗时：${elapsed}`;
  }
  return `执行完成，但题库没有预期输出，无法自动判定\n实际输出：${result.actualOutput || '（无输出）'}\n耗时：${elapsed}`;
}

function canonicalOutput(value: string): string {
  const trimmed = value.trim().replace(/^(?:输出|Output)\s*[:：]\s*/i, '');
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') return `string:${parsed}`;
    if (typeof parsed === 'number' || typeof parsed === 'boolean' || parsed === null) return `${typeof parsed}:${String(parsed)}`;
    return `json:${stableJson(parsed)}`;
  } catch {
    // 题面经常把字符串写成裸文本，而函数入口会 JSON.stringify 成带引号字符串。
    const unquoted = trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1).replace(/\\([\\"'])/g, '$1')
      : trimmed;
    return `text:${unquoted.replace(/\s+/g, ' ').replace(/\s*([,\[\]{}])\s*/g, '$1')}`;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function formatSignature(signature: CppFunctionSignature): string {
  return `${signature.name}(${signature.parameters.map((parameter) => parameter.name).join(', ')})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const PYTHON_LIST_NODE_HELPERS = [
  'class ListNode:',
  '    def __init__(self, val=0, next=None):',
  '        self.val = val',
  '        self.next = next',
  '',
  'def __proofline_make_list_node(values):',
  '    if values is None:',
  '        return None',
  '    if not isinstance(values, list):',
  '        raise TypeError("ListNode 参数需要数组样例")',
  '    dummy = ListNode(0)',
  '    tail = dummy',
  '    for value in values:',
  '        tail.next = ListNode(value)',
  '        tail = tail.next',
  '    return dummy.next',
  '',
  'def __proofline_list_node_to_array(node):',
  '    values = []',
  '    guard = 0',
  '    while node is not None and guard < 10000:',
  '        values.append(node.val)',
  '        node = node.next',
  '        guard += 1',
  '    return values',
].join('\n');

const PYTHON_TREE_NODE_HELPERS = [
  'class TreeNode:',
  '    def __init__(self, val=0, left=None, right=None):',
  '        self.val = val',
  '        self.left = left',
  '        self.right = right',
  '',
  'def __proofline_make_tree_node(values):',
  '    if values is None:',
  '        return None',
  '    if not isinstance(values, list):',
  '        raise TypeError("TreeNode 参数需要层序数组样例")',
  '    if len(values) == 0 or values[0] is None:',
  '        return None',
  '    root = TreeNode(values[0])',
  '    queue = [root]',
  '    index = 1',
  '    cursor = 0',
  '    while cursor < len(queue) and index < len(values):',
  '        node = queue[cursor]',
  '        cursor += 1',
  '        if index < len(values) and values[index] is not None:',
  '            node.left = TreeNode(values[index])',
  '            queue.append(node.left)',
  '        index += 1',
  '        if index < len(values) and values[index] is not None:',
  '            node.right = TreeNode(values[index])',
  '            queue.append(node.right)',
  '        index += 1',
  '    return root',
  '',
  'def __proofline_tree_node_to_array(root):',
  '    if root is None:',
  '        return []',
  '    values = []',
  '    queue = [root]',
  '    cursor = 0',
  '    while cursor < len(queue) and len(values) < 20000:',
  '        node = queue[cursor]',
  '        cursor += 1',
  '        if node is None:',
  '            values.append(None)',
  '            continue',
  '        values.append(node.val)',
  '        queue.append(node.left)',
  '        queue.append(node.right)',
  '    while values and values[-1] is None:',
  '        values.pop()',
  '    return values',
].join('\n');

const PYTHON_SCRIPT_ADAPTER_HELPERS = [
  'def __proofline_adapt_input(value, kind):',
  '    if kind == "listnode":',
  '        return __proofline_make_list_node(value)',
  '    if kind == "treenode":',
  '        return __proofline_make_tree_node(value)',
  '    return value',
  '',
  'def __proofline_adapt_output(value, kind):',
  '    if kind == "listnode":',
  '        return __proofline_list_node_to_array(value)',
  '    if kind == "treenode":',
  '        return __proofline_tree_node_to_array(value)',
  '    return value',
].join('\n');

const JAVASCRIPT_LIST_NODE_HELPERS = [
  'function ListNode(val, next) {',
  '  this.val = val === undefined ? 0 : val;',
  '  this.next = next === undefined ? null : next;',
  '}',
  '',
  'function __prooflineMakeListNode(values) {',
  '  if (values == null) return null;',
  '  if (!Array.isArray(values)) throw new TypeError("ListNode 参数需要数组样例");',
  '  const dummy = new ListNode(0);',
  '  let tail = dummy;',
  '  for (const value of values) {',
  '    tail.next = new ListNode(value);',
  '    tail = tail.next;',
  '  }',
  '  return dummy.next;',
  '}',
  '',
  'function __prooflineListNodeToArray(node) {',
  '  const values = [];',
  '  let guard = 0;',
  '  while (node && guard++ < 10000) {',
  '    values.push(node.val);',
  '    node = node.next;',
  '  }',
  '  return values;',
  '}',
].join('\n');

const JAVASCRIPT_TREE_NODE_HELPERS = [
  'function TreeNode(val, left, right) {',
  '  this.val = val === undefined ? 0 : val;',
  '  this.left = left === undefined ? null : left;',
  '  this.right = right === undefined ? null : right;',
  '}',
  '',
  'function __prooflineMakeTreeNode(values) {',
  '  if (values == null) return null;',
  '  if (!Array.isArray(values)) throw new TypeError("TreeNode 参数需要层序数组样例");',
  '  if (values.length === 0 || values[0] == null) return null;',
  '  const root = new TreeNode(values[0]);',
  '  const queue = [root];',
  '  let index = 1;',
  '  for (let cursor = 0; cursor < queue.length && index < values.length; cursor += 1) {',
  '    const node = queue[cursor];',
  '    if (index < values.length && values[index] != null) {',
  '      node.left = new TreeNode(values[index]);',
  '      queue.push(node.left);',
  '    }',
  '    index += 1;',
  '    if (index < values.length && values[index] != null) {',
  '      node.right = new TreeNode(values[index]);',
  '      queue.push(node.right);',
  '    }',
  '    index += 1;',
  '  }',
  '  return root;',
  '}',
  '',
  'function __prooflineTreeNodeToArray(root) {',
  '  if (!root) return [];',
  '  const values = [];',
  '  const queue = [root];',
  '  for (let cursor = 0; cursor < queue.length && values.length < 20000; cursor += 1) {',
  '    const node = queue[cursor];',
  '    if (!node) {',
  '      values.push(null);',
  '      continue;',
  '    }',
  '    values.push(node.val);',
  '    queue.push(node.left || null);',
  '    queue.push(node.right || null);',
  '  }',
  '  while (values.length > 0 && values[values.length - 1] === null) values.pop();',
  '  return values;',
  '}',
].join('\n');

const JAVASCRIPT_SCRIPT_ADAPTER_HELPERS = [
  'function __prooflineAdaptInput(value, kind) {',
  '  if (kind === "listnode") return __prooflineMakeListNode(value);',
  '  if (kind === "treenode") return __prooflineMakeTreeNode(value);',
  '  return value;',
  '}',
  '',
  'function __prooflineAdaptOutput(value, kind) {',
  '  if (kind === "listnode") return __prooflineListNodeToArray(value);',
  '  if (kind === "treenode") return __prooflineTreeNodeToArray(value);',
  '  return value;',
  '}',
].join('\n');

const LIST_NODE_DEFINITION = `struct ListNode {
  int val;
  ListNode* next;
  ListNode() : val(0), next(nullptr) {}
  ListNode(int value) : val(value), next(nullptr) {}
  ListNode(int value, ListNode* nextNode) : val(value), next(nextNode) {}
};`;

const TREE_NODE_DEFINITION = `struct TreeNode {
  int val;
  TreeNode* left;
  TreeNode* right;
  TreeNode() : val(0), left(nullptr), right(nullptr) {}
  TreeNode(int value) : val(value), left(nullptr), right(nullptr) {}
  TreeNode(int value, TreeNode* leftNode, TreeNode* rightNode) : val(value), left(leftNode), right(rightNode) {}
};`;

const CPP_PRINT_HELPERS = `template <typename T>
void proofline_print(const T& value) { cout << value; }

void proofline_print(const bool& value) { cout << (value ? "true" : "false"); }

void proofline_print(const string& value) {
  cout << '"';
  for (char character : value) {
    if (character == '\\\\' || character == '"') cout << '\\\\';
    if (character == '\\n') cout << "\\\\n";
    else if (character == '\\r') cout << "\\\\r";
    else if (character == '\\t') cout << "\\\\t";
    else cout << character;
  }
  cout << '"';
}

void proofline_print(const char& value) { proofline_print(string(1, value)); }

template <typename T>
void proofline_print(const vector<T>& values) {
  cout << '[';
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) cout << ',';
    proofline_print(values[index]);
  }
  cout << ']';
}

template <typename A, typename B>
void proofline_print(const pair<A, B>& value) {
  cout << '[';
  proofline_print(value.first);
  cout << ',';
  proofline_print(value.second);
  cout << ']';
}`;

const LIST_NODE_HELPERS = `ListNode* proofline_make_list(const vector<long long>& values) {
  ListNode dummy(0);
  ListNode* tail = &dummy;
  for (long long value : values) {
    tail->next = new ListNode(static_cast<int>(value));
    tail = tail->next;
  }
  return dummy.next;
}

void proofline_print(ListNode* node) {
  cout << '[';
  bool first = true;
  size_t guard = 0;
  while (node && guard++ < 10000) {
    if (!first) cout << ',';
    cout << node->val;
    first = false;
    node = node->next;
  }
  cout << ']';
}`;

const TREE_NODE_HELPERS = `TreeNode* proofline_make_tree(const vector<optional<long long>>& values) {
  if (values.empty() || !values[0].has_value()) return nullptr;
  TreeNode* root = new TreeNode(static_cast<int>(*values[0]));
  queue<TreeNode*> nodes;
  nodes.push(root);
  size_t index = 1;
  while (!nodes.empty() && index < values.size()) {
    TreeNode* node = nodes.front();
    nodes.pop();
    if (index < values.size() && values[index].has_value()) {
      node->left = new TreeNode(static_cast<int>(*values[index]));
      nodes.push(node->left);
    }
    ++index;
    if (index < values.size() && values[index].has_value()) {
      node->right = new TreeNode(static_cast<int>(*values[index]));
      nodes.push(node->right);
    }
    ++index;
  }
  return root;
}

void proofline_print(TreeNode* root) {
  if (!root) { cout << "[]"; return; }
  vector<optional<int>> values;
  queue<TreeNode*> nodes;
  nodes.push(root);
  while (!nodes.empty() && values.size() < 20000) {
    TreeNode* node = nodes.front();
    nodes.pop();
    if (!node) { values.push_back(nullopt); continue; }
    values.push_back(node->val);
    nodes.push(node->left);
    nodes.push(node->right);
  }
  while (!values.empty() && !values.back().has_value()) values.pop_back();
  cout << '[';
  for (size_t index = 0; index < values.size(); ++index) {
    if (index) cout << ',';
    if (values[index].has_value()) cout << *values[index];
    else cout << "null";
  }
  cout << ']';
}`;
