import type { ProblemExample } from '../types';

const MAX_EXAMPLE_COUNT = 20;
const MAX_FIELD_LENGTH = 20 * 1024;

type ExampleField = keyof ProblemExample;
type ExampleCandidate = Partial<Record<ExampleField, string>>;

const FIELD_LINE = /^(输入|Input|输出|Output|解释|Explanation)(?:\*\*|__)?/i;
const STOP_HEADING = /^(?:提示|约束|限制|数据范围|Constraints?|Notes?|Hints?)\s*(?:[:：].*)?$/i;

export function extractProblemExamples(text: string): ProblemExample[] {
  if (typeof text !== 'string' || !text.trim()) return [];

  const candidates: ExampleCandidate[] = [];
  let current: ExampleCandidate = {};
  let activeField: ExampleField | undefined;
  let sawExampleField = false;

  const finishCurrent = () => {
    if (Object.keys(current).length > 0) candidates.push(current);
    current = {};
    activeField = undefined;
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const structuralLine = normalizeStructuralLine(rawLine);
    if (sawExampleField && STOP_HEADING.test(structuralLine)) break;

    if (isExampleHeading(structuralLine)) {
      finishCurrent();
      continue;
    }

    const fieldMatch = parseFieldLine(rawLine);
    if (fieldMatch) {
      sawExampleField = true;
      const field = fieldName(fieldMatch.label);
      if (field === 'input' && Object.keys(current).length > 0) finishCurrent();
      activeField = field;
      current[field] = fieldMatch.value;
      continue;
    }

    if (activeField) {
      current[activeField] = `${current[activeField] ?? ''}\n${rawLine}`;
    }
  }

  finishCurrent();
  return normalizeProblemExamples(candidates);
}

export function normalizeProblemExamples(
  examples: readonly unknown[] | null | undefined,
): ProblemExample[] {
  if (!Array.isArray(examples)) return [];

  const normalized: ProblemExample[] = [];
  const seen = new Set<string>();

  for (const value of examples) {
    if (!isExampleCandidate(value)) continue;
    const input = normalizeField(value.input);
    const output = normalizeField(value.output);
    if (!input || !output) continue;

    const key = JSON.stringify([input, output]);
    if (seen.has(key)) continue;

    const explanation = normalizeField(value.explanation);
    normalized.push(explanation ? { input, output, explanation } : { input, output });
    seen.add(key);
    if (normalized.length === MAX_EXAMPLE_COUNT) break;
  }

  return normalized;
}

export function mergeProblemExamples(
  existing: readonly unknown[] | null | undefined,
  incoming: readonly unknown[] | null | undefined,
): ProblemExample[] {
  return normalizeProblemExamples([
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]);
}

function normalizeStructuralLine(line: string): string {
  let normalized = cleanLinePrefix(line).trimEnd();
  if (normalized.endsWith('**') || normalized.endsWith('__')) {
    normalized = normalized.slice(0, -2).trimEnd();
  }
  return normalized;
}

function isExampleHeading(line: string): boolean {
  const lowerLine = line.toLowerCase();
  const prefix = ['example', 'sample', '示例', '样例'].find((candidate) => lowerLine.startsWith(candidate));
  if (!prefix) return false;

  let remainder = line.slice(prefix.length).trimStart();
  if (!remainder) return true;
  if (remainder[0] === ':' || remainder[0] === '：') return !remainder.slice(1).trim();

  if (remainder[0] === '#') remainder = remainder.slice(1).trimStart();
  let sequenceLength = 0;
  if (isAsciiDigit(remainder[0])) {
    while (sequenceLength < remainder.length && isAsciiDigit(remainder[sequenceLength])) sequenceLength += 1;
  } else {
    while (sequenceLength < remainder.length && '一二三四五六七八九十'.includes(remainder[sequenceLength])) {
      sequenceLength += 1;
    }
  }
  remainder = remainder.slice(sequenceLength).trimStart();
  if (remainder[0] === ':' || remainder[0] === '：') remainder = remainder.slice(1).trimStart();
  return remainder.length === 0;
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function parseFieldLine(line: string): { label: string; value: string } | undefined {
  const normalized = cleanLinePrefix(line);
  const match = FIELD_LINE.exec(normalized);
  if (!match) return undefined;

  let remainder = normalized.slice(match[0].length).trimStart();
  if (!remainder) return { label: match[1], value: '' };
  if (remainder[0] !== ':' && remainder[0] !== '：') return undefined;

  remainder = remainder.slice(1).trimStart();
  if (remainder.startsWith('**') || remainder.startsWith('__')) {
    remainder = remainder.slice(2).trimStart();
  }
  return { label: match[1], value: remainder };
}

function cleanLinePrefix(line: string): string {
  let normalized = line.trimStart();
  if (!normalized) return normalized;

  if (normalized[0] === '#') {
    let hashCount = 1;
    while (hashCount < normalized.length && normalized[hashCount] === '#') hashCount += 1;
    if (hashCount <= 6 && (hashCount === normalized.length || isHorizontalWhitespace(normalized[hashCount]))) {
      normalized = normalized.slice(hashCount).trimStart();
    }
  } else if ('-+*>'.includes(normalized[0]) && isHorizontalWhitespace(normalized[1])) {
    normalized = normalized.slice(1).trimStart();
  }

  if (normalized.startsWith('**') || normalized.startsWith('__')) {
    normalized = normalized.slice(2).trimStart();
  }
  return normalized;
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t';
}

function fieldName(label: string): ExampleField {
  const normalized = label.toLowerCase();
  if (normalized === '输入' || normalized === 'input') return 'input';
  if (normalized === '输出' || normalized === 'output') return 'output';
  return 'explanation';
}

function isExampleCandidate(value: unknown): value is {
  input?: unknown;
  output?: unknown;
  explanation?: unknown;
} {
  return typeof value === 'object' && value !== null;
}

function normalizeField(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  let byteLength = 0;
  let end = 0;

  for (const character of trimmed) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (byteLength + characterBytes > MAX_FIELD_LENGTH) break;
    byteLength += characterBytes;
    end += character.length;
  }

  return trimmed.slice(0, end).trim();
}
