import type { Attempt, Difficulty, InterviewFormat, KnowledgeNote, Problem } from '../types';

export type HintLevel = 1 | 2 | 3 | 4 | 5;
export type AiCoachIntent = 'analyze' | 'algorithm-logic' | 'next-code' | 'debug' | 'explain' | 'complete';
export type InterviewCoachIntent =
  | 'interview-follow-up'
  | 'interview-critique'
  | 'interview-omissions'
  | 'interview-improve';

export interface InterviewPromptInput {
  intent: InterviewCoachIntent;
  problem: Problem;
  answerText: string;
  previousFeedback?: string;
  userQuestion?: string;
}

export interface InterviewExaminerInput {
  topic: string;
  role: string;
  difficulty: Exclude<Difficulty, 'unknown'>;
  count: number;
}

export interface InterviewExaminerQuestion {
  title: string;
  category: string;
  format: InterviewFormat;
  difficulty: Exclude<Difficulty, 'unknown'>;
  tags: string[];
  keyPoints: string[];
  referenceAnswer: string;
  followUps: string[];
}

export interface InterviewExaminerResult {
  topic: string;
  overview: string;
  checkpoints: string[];
  questions: InterviewExaminerQuestion[];
}

export type AiStreamEvent =
  | { event: 'delta'; content: string }
  | { event: 'done' }
  | { event: 'error'; message: string };

export class AiSseDecoder {
  private buffer = '';
  private completed = false;

  push(chunk: string): AiStreamEvent[] {
    if (this.completed) return [];
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    return lines.flatMap((line) => this.parseLine(line));
  }

  finish(): AiStreamEvent[] {
    if (this.completed || !this.buffer) return [];
    const line = this.buffer;
    this.buffer = '';
    return this.parseLine(line);
  }

  private parseLine(line: string): AiStreamEvent[] {
    if (this.completed) return [];
    if (!line.startsWith('data:')) return [];
    const data = line.slice(5).trimStart();
    if (data === '[DONE]') {
      this.completed = true;
      return [{ event: 'done' }];
    }
    if (!data) return [];

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error('AI 流式响应不是有效 JSON');
    }
    const errorMessage = valueAt(payload, ['error', 'message']);
    if (typeof errorMessage === 'string') {
      return [{ event: 'error', message: `AI 服务返回错误：${errorMessage}` }];
    }
    const content = extractAiStreamContent(payload);
    return content ? [{ event: 'delta', content }] : [];
  }
}

const INTENT_RULES: Record<AiCoachIntent, string> = {
  analyze: '分析当前代码已经完成了什么、还缺什么、最先应该改哪里。指出准确位置，并给出一小段可直接替换或插入的代码；不要只讲思路，也不要给完整答案。',
  'algorithm-logic': '给出算法逻辑拆解，解释算法为什么这么写。重点解释为什么选择这个算法或数据结构、为什么这样定义状态或变量、为什么循环/转移/分支要这样写。必须把题意观察、状态定义、转移或更新规则、关键不变量、边界和复杂度串成因果链；不要输出完整代码。',
  'next-code': '只推进当前最关键的一段实现。先说明插入或替换位置，再给合法的局部代码片段和紧接着的自检方法；不要重复已正确内容，不要给完整答案。',
  debug: '结合最近运行反馈定位根因。先给最小修复，再给修复后的局部代码和重新运行时应观察的结果；若反馈不足，明确还需要什么信息，不要臆测。',
  explain: '专门回答用户对题目、当前代码、报错或算法概念不懂的地方。像对话问答一样先确认用户卡点，再结合当前代码、变量变化、例子和必要的小片段讲明白；不要机械套模板，也不要主动展开成完整答案。',
  complete: '给出当前语言下完整、可运行或可直接提交的最终实现。代码中禁止出现 TODO、占位函数和省略号；随后简洁解释关键逻辑、复杂度和边界。',
};

const INTENT_LABELS: Record<AiCoachIntent, string> = {
  analyze: '分析当前代码',
  'algorithm-logic': '算法逻辑拆解',
  'next-code': '给下一段提示',
  debug: '解释运行问题',
  explain: 'AI 解惑',
  complete: '给完整代码',
};

const INTERVIEW_INTENT_RULES: Record<InterviewCoachIntent, string> = {
  'interview-follow-up': '模拟面试官追问。只提出一个最有区分度、能承接用户当前回答的递进问题，不要同时给答案或点评。',
  'interview-critique': '点评当前回答。先指出做得准确的部分，再按影响排序指出不严谨或表达不清的位置，最后给一段可直接补充的口头表达。',
  'interview-omissions': '检查回答遗漏。只列出尚未覆盖的关键点，并解释这些点为什么会影响面试评价；已经覆盖的内容不要重复。',
  'interview-improve': '帮助用户组织更好的完整回答。保留用户回答中正确的内容，按“结论、原理、落地、风险”重写成自然口语，并附一份 30 秒精简版。',
};

const INTERVIEW_INTENT_LABELS: Record<InterviewCoachIntent, string> = {
  'interview-follow-up': '模拟追问',
  'interview-critique': '点评当前回答',
  'interview-omissions': '检查遗漏要点',
  'interview-improve': '优化完整回答',
};

export function coachIntentLevel(intent: AiCoachIntent | InterviewCoachIntent): HintLevel {
  if (intent === 'interview-improve') return 4;
  if (intent === 'interview-critique' || intent === 'interview-omissions') return 3;
  if (intent === 'interview-follow-up') return 2;
  if (intent === 'complete') return 5;
  if (intent === 'algorithm-logic') return 3;
  if (intent === 'debug' || intent === 'explain') return 3;
  return 2;
}

export function buildHintPrompt(input: {
  level?: number;
  intent?: AiCoachIntent;
  problem: Problem;
  attempt?: Attempt;
  code?: string;
  language?: string;
  notes?: KnowledgeNote[];
  previousGuidance?: string;
  recentRunError?: string;
  userQuestion?: string;
  teachingStep?: string;
  stepDeliverable?: string;
}): string {
  const intent = input.intent ?? legacyIntent(input.level);
  const language = normalizeHintLanguage(input.language ?? input.attempt?.language);
  const noteContext = input.notes?.slice(0, 5).map((note) => `- ${note.title}: ${note.content.slice(0, 500)}`).join('\n') ?? '无';
  const previousGuidance = recentGuidance(input.previousGuidance);
  const runFeedback = input.recentRunError?.trim().slice(0, 5_000) || '尚无运行反馈。';
  const answerFormat = intent === 'complete'
    ? '输出顺序：## 完整代码 -> ## 关键逻辑 -> ## 复杂度 -> ## 边界检查。完整代码必须放在一个 Markdown 代码块中，禁止 TODO、伪代码、省略号或未实现分支。'
    : intent === 'algorithm-logic'
      ? '输出顺序：## 算法选择 -> ## 为什么这么设计 -> ## 关键步骤拆解 -> ## 边界与复杂度 -> ## 写代码时的落点。重点解释为什么选择这个算法或数据结构，必须落到状态定义、不变量、转移或更新规则、循环条件；不要输出完整代码。'
      : intent === 'explain'
        ? '输出方式：像对话问答一样自然回答。先用一句话复述用户真正卡住的点，再结合当前代码和一个具体例子逐步解释；需要代码时只给最小片段，并说明这一段为什么这样写。'
        : '输出顺序：## 当前判断 -> ## 现在改这里 -> ## 代码片段 -> ## 运行后看什么。代码片段必须能直接并入当前代码，并明确插入或替换位置。';

  return [
    '你是 Proofline 中的算法代码教练。始终使用简体中文，像坐在用户旁边结对编程一样具体，目标是帮助用户亲手把代码写出来。',
    `本轮请求：${INTENT_LABELS[intent]}。强制规则：${INTENT_RULES[intent]}`,
    answerFormat,
    '先逐行阅读当前代码并保留已经正确的部分。禁止泛泛复述整套算法；必须落到变量、函数、循环、分支或返回值，并给出可以实际输入编辑器的代码。',
    intent === 'complete'
      ? `完整代码必须与题目的平台函数签名或标准输入输出约定一致，并使用 ${language}。若题面确实缺失签名，只能明确说明采用的假设，不能伪造约束。`
      : intent === 'algorithm-logic'
        ? '本轮不要输出完整代码，也不要把多个片段拼成变相完整答案。可以给少量伪代码或关键代码骨架，但重点必须是解释每一步为什么这么写，让用户能据此自己补全实现。'
        : intent === 'explain'
          ? '本轮重点是把用户问到的不懂之处讲清楚。不要为了显得完整而重写整题；如果用户想直接看最终答案，引导其使用“给完整代码”。'
          : '本轮不得输出完整解答，也不得用多个片段拼成变相完整答案。一次只解决当前最重要的问题，让用户可以马上继续编码或运行。',
    `题目：${input.problem.title}`,
    `难度：${input.problem.difficulty}`,
    `标签：${input.problem.tags.join('、') || '未知'}`,
    `题面：\n${input.problem.content || '仅有链接，请基于已有信息明确指出不确定性。'}`,
    `当前语言：${language}`,
    `当前代码：\n${(input.code ?? input.attempt?.code ?? '').slice(0, 12_000) || '尚未编写'}`,
    `最近运行反馈：\n${runFeedback}`,
    `用户补充问题：\n${input.userQuestion?.trim().slice(0, 2_000) || '无'}`,
    `最近教练对话：\n${previousGuidance}`,
    `个人知识片段：\n${noteContext}`,
  ].join('\n\n');
}

export function buildInterviewPrompt(input: InterviewPromptInput): string {
  const detail = input.problem.interview;
  if (input.problem.kind !== 'interview' || !detail) {
    throw new Error('面试提示只能用于包含面试元数据的题目');
  }

  const answerText = input.answerText.trim() || '用户尚未作答。';
  return [
    '你是 Proofline 中严谨但耐心的中文技术面试教练。你的目标是帮助用户形成能在真实面试中清晰说出口的回答。',
    `本轮任务：${INTERVIEW_INTENT_LABELS[input.intent]}。${INTERVIEW_INTENT_RULES[input.intent]}`,
    '不要直接复述参考答案，不要虚构用户经历，不要用空泛鼓励替代技术判断。所有反馈必须能对应到用户回答或参考要点。',
    `岗位方向：${detail.roles.join('、')}`,
    `知识分类：${detail.category}`,
    `题型：${detail.format}`,
    `难度：${input.problem.difficulty}`,
    `题目：${input.problem.title}`,
    `题目补充：${input.problem.content || '无'}`,
    `用户当前回答：\n${answerText.slice(0, 12_000)}`,
    `参考要点（用于检查覆盖度，不得原样照抄）：\n${detail.keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}`,
    `内置追问方向：\n${detail.followUps.map((question, index) => `${index + 1}. ${question}`).join('\n')}`,
    `上一轮反馈：\n${input.previousFeedback?.trim().slice(0, 5_000) || '无'}`,
    `用户补充问题：\n${input.userQuestion?.trim().slice(0, 2_000) || '无'}`,
  ].join('\n\n');
}

export function buildInterviewExaminerPrompt(input: InterviewExaminerInput): string {
  const topic = input.topic.trim();
  const role = input.role.trim();
  if (!topic) throw new Error('请先填写技术主题');
  if (!role) throw new Error('请选择岗位方向');
  const count = Math.min(10, Math.max(1, Math.round(input.count)));

  return [
    '你是 Proofline 的资深技术面试出题官。请基于真实企业面试深度，系统拆解用户指定主题，不要生成重复、换皮或只有定义背诵价值的问题。',
    `技术主题：${topic}`,
    `目标岗位：${role}`,
    `整体难度：${input.difficulty}`,
    `题目数量：${count}`,
    '考点必须覆盖概念原理、关键公式或机制、工程实现、性能与边界、故障排查或方案权衡；根据主题选择真正相关的维度，不要生搬硬套。',
    '每道题都要给出可用于复习的完整参考答案、至少 3 个回答要点，以及 1 至 3 个能够区分候选人深度的递进追问。答案必须技术准确、直接回答问题，并解释关键因果。',
    '只输出一个合法 JSON 对象，不要输出 Markdown 代码围栏、解释文字或额外前后缀。必须严格使用以下结构：',
    JSON.stringify({
      topic,
      overview: '这个主题在目标岗位中的考察范围与能力目标',
      checkpoints: ['核心考点一', '核心考点二'],
      questions: [{
        title: '完整面试问题',
        category: '知识分类',
        format: 'knowledge | scenario | system-design | project',
        difficulty: 'easy | medium | hard',
        tags: ['标签'],
        keyPoints: ['回答要点一', '回答要点二', '回答要点三'],
        referenceAnswer: '完整、准确、可直接用于复习的参考答案',
        followUps: ['递进追问及考察方向'],
      }],
    }, null, 2),
    `questions 数组必须恰好包含 ${count} 道互不重复的问题。所有自然语言字段使用简体中文，技术名词、公式和代码标识符可保留英文。`,
  ].join('\n\n');
}

export function parseInterviewExaminerResponse(response: string): InterviewExaminerResult {
  const source = response.trim();
  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('AI 返回的出题结果不是有效 JSON');

  let value: unknown;
  try {
    value = JSON.parse(unfenced.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error('AI 返回的出题结果无法解析，请重新生成');
  }
  if (!value || typeof value !== 'object') throw new Error('AI 返回的出题结果缺少对象结构');
  const record = value as Record<string, unknown>;
  const questions = Array.isArray(record.questions)
    ? record.questions.map(parseExaminerQuestion)
    : [];
  if (!questions.length) throw new Error('AI 返回的出题结果中没有可用题目');

  return {
    topic: requiredText(record.topic, '技术主题'),
    overview: requiredText(record.overview, '考点概览'),
    checkpoints: stringList(record.checkpoints, '核心考点'),
    questions,
  };
}

function parseExaminerQuestion(value: unknown, index: number): InterviewExaminerQuestion {
  if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 道题结构无效`);
  const record = value as Record<string, unknown>;
  const format = record.format;
  const difficulty = record.difficulty;
  if (!['knowledge', 'scenario', 'system-design', 'project'].includes(String(format))) {
    throw new Error(`第 ${index + 1} 道题的题型无效`);
  }
  if (!['easy', 'medium', 'hard'].includes(String(difficulty))) {
    throw new Error(`第 ${index + 1} 道题的难度无效`);
  }
  return {
    title: requiredText(record.title, `第 ${index + 1} 道题题目`),
    category: requiredText(record.category, `第 ${index + 1} 道题分类`),
    format: format as InterviewFormat,
    difficulty: difficulty as Exclude<Difficulty, 'unknown'>,
    tags: stringList(record.tags, `第 ${index + 1} 道题标签`),
    keyPoints: stringList(record.keyPoints, `第 ${index + 1} 道题回答要点`),
    referenceAnswer: requiredText(record.referenceAnswer, `第 ${index + 1} 道题参考答案`),
    followUps: stringList(record.followUps, `第 ${index + 1} 道题追问`),
  };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}不能为空`);
  return value.trim();
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field}必须是数组`);
  const items = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new Error(`${field}不能为空`);
  return items;
}

function legacyIntent(level?: number): AiCoachIntent {
  const normalized = Math.min(5, Math.max(1, Math.floor(level ?? 2)));
  return normalized >= 5 ? 'complete' : 'next-code';
}

function recentGuidance(guidance?: string): string {
  const value = guidance?.trim();
  if (!value) return '无，这是本题的第一次教练请求。';
  const maxChars = 8_000;
  if (value.length <= maxChars) return value;
  return `[较早对话已省略，仅保留最近 ${maxChars} 字]\n${value.slice(-maxChars)}`;
}

function normalizeHintLanguage(language?: string): string {
  const value = language?.trim();
  if (!value) return 'C++17';
  switch (value.toLowerCase()) {
    case 'cpp':
    case 'c++':
    case 'c++17':
    case 'cc':
      return 'C++17';
    case 'js':
    case 'javascript':
      return 'JavaScript';
    case 'ts':
    case 'typescript':
      return 'TypeScript';
    case 'py':
    case 'python':
    case 'python3':
    case 'python 3':
      return 'Python 3';
    default:
      return value;
  }
}

export function extractAiResponseContent(payload: unknown): string {
  return contentText(valueAt(payload, ['choices', 0, 'message', 'content']));
}

function extractAiStreamContent(payload: unknown): string {
  return contentText(
    valueAt(payload, ['choices', 0, 'delta', 'content'])
      ?? valueAt(payload, ['choices', 0, 'message', 'content'])
      ?? valueAt(payload, ['choices', 0, 'text']),
  );
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => valueAt(part, ['text']))
    .filter((part): part is string => typeof part === 'string')
    .join('');
}

function valueAt(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
