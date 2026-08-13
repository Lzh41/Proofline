import type { Difficulty, InterviewFormat, Problem } from '../types';
import { normalizeText, uniqueStrings } from './ids';

export const INTERVIEW_CATALOG_VERSION = 2;

export interface InterviewRoleDefinition {
  id: string;
  label: string;
  aliases: string[];
}

export const INTERVIEW_ROLES: InterviewRoleDefinition[] = [
  { id: 'llm-app', label: '大语言模型应用开发', aliases: ['LLM', '大模型', '语言模型'] },
  { id: 'nlp', label: 'NLP 算法工程师', aliases: ['NLP', '自然语言处理'] },
  { id: 'rag-agent', label: 'RAG / Agent 工程师', aliases: ['RAG', 'Agent', '智能体'] },
  { id: 'multimodal', label: '多模态算法工程师', aliases: ['多模态', '视觉语言模型', 'VLM'] },
  { id: 'ai-platform', label: 'AI 平台 / MLOps 工程师', aliases: ['MLOps', '模型平台', '推理平台'] },
  { id: 'recommendation-search', label: '推荐与搜索算法工程师', aliases: ['推荐', '搜索', '排序'] },
  { id: 'backend', label: '后端开发工程师', aliases: ['后端', '服务端'] },
  { id: 'frontend', label: '前端开发工程师', aliases: ['前端', 'Web'] },
  { id: 'client', label: '移动端 / 客户端开发工程师', aliases: ['Android', 'iOS', '客户端'] },
  { id: 'data-engineering', label: '数据工程师', aliases: ['大数据', '数仓', '数据开发'] },
  { id: 'test-development', label: '测试开发工程师', aliases: ['测开', '质量工程'] },
  { id: 'sre-devops', label: '云原生 / DevOps / SRE 工程师', aliases: ['SRE', 'DevOps', '云原生'] },
  { id: 'security', label: '安全工程师', aliases: ['网络安全', '应用安全'] },
  { id: 'embedded', label: '嵌入式 / 物联网工程师', aliases: ['嵌入式', 'IoT', 'RTOS'] },
  { id: 'fundamentals', label: '计算机基础', aliases: ['计算机基础', '八股文', '基础知识'] },
  {
    id: 'ai-research-training',
    label: '大模型算法研究 / 模型训练',
    aliases: ['大模型算法研究', '模型训练', '预训练', '对齐训练'],
  },
  {
    id: 'computer-vision',
    label: '计算机视觉算法工程师',
    aliases: ['计算机视觉', '视觉算法', 'CV'],
  },
  {
    id: 'data-science-quant',
    label: '数据科学 / 量化工程师',
    aliases: ['数据科学', '量化', 'Quant'],
  },
  {
    id: 'database-middleware',
    label: '数据库 / 中间件工程师',
    aliases: ['数据库', '中间件', '存储引擎'],
  },
  {
    id: 'game-graphics',
    label: '游戏 / 图形开发工程师',
    aliases: ['游戏开发', '计算机图形学', '渲染引擎'],
  },
  {
    id: 'solution-architect',
    label: '解决方案架构师',
    aliases: ['解决方案架构', '云架构', '企业架构'],
  },
];

export interface InterviewCatalogItem {
  id: string;
  question: string;
  primaryRole: string;
  roles: string[];
  category: string;
  format: InterviewFormat;
  difficulty: Exclude<Difficulty, 'unknown'>;
  tags: string[];
  keyPoints: string[];
  referenceAnswer: string;
  followUps: string[];
}

export interface InterviewSearchFilter {
  query?: string;
  role?: string;
  category?: string;
  format?: InterviewFormat;
}

const FORBIDDEN_PLACEHOLDERS = ['TODO', 'TBD', '待补充', '占位'];

function countChineseCharacters(value: string): number {
  return value.match(/\p{Script=Han}/gu)?.length ?? 0;
}

export function validateInterviewCatalog(items: InterviewCatalogItem[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const prefix = `第 ${index + 1} 题`;
    if (!item.id.trim()) errors.push(`${prefix}缺少 ID`);
    else if (ids.has(item.id)) errors.push(`${prefix}存在重复 ID：${item.id}`);
    ids.add(item.id);
    if (!item.question.trim()) errors.push(`${prefix}缺少题面`);
    if (!item.primaryRole.trim() || item.roles.length === 0) errors.push(`${prefix}缺少岗位`);
    if (!item.category.trim()) errors.push(`${prefix}缺少知识分类`);
    if (item.tags.length === 0) errors.push(`${prefix}缺少标签`);
    if (item.keyPoints.length < 3 || item.keyPoints.some((point) => !point.trim())) errors.push(`${prefix}参考要点不足`);
    if (countChineseCharacters(item.referenceAnswer) < 80) errors.push(`${prefix}参考答案不足 80 个中文汉字`);
    if (item.followUps.length === 0 || item.followUps.some((question) => !question.trim())) errors.push(`${prefix}缺少追问`);
    const serialized = `${item.question}\n${item.referenceAnswer}\n${item.followUps.join('\n')}`;
    const placeholder = FORBIDDEN_PLACEHOLDERS.find((value) => serialized.includes(value));
    if (placeholder) errors.push(`${prefix}包含占位内容：${placeholder}`);
  });
  return errors;
}

function roleSearchTerms(roleId: string): string[] {
  const definition = INTERVIEW_ROLES.find((role) => role.id === roleId);
  return definition ? [definition.id, definition.label, ...definition.aliases] : [roleId];
}

function normalizedSearchText(item: InterviewCatalogItem): string {
  const roles = item.roles.flatMap(roleSearchTerms);
  return normalizeText([
    item.question,
    item.category,
    ...roles,
    ...item.tags,
    ...item.keyPoints,
    item.referenceAnswer,
    ...item.followUps,
  ].join(' '));
}

export function searchInterviewCatalog(
  items: InterviewCatalogItem[],
  filter: InterviewSearchFilter,
): InterviewCatalogItem[] {
  const query = normalizeText(filter.query ?? '');
  return items.filter((item) => {
    if (filter.role && !item.roles.includes(filter.role) && item.primaryRole !== filter.role) return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.format && item.format !== filter.format) return false;
    return !query || normalizedSearchText(item).includes(query);
  });
}

export function catalogItemToProblem(
  item: InterviewCatalogItem,
  now = Date.now(),
  catalogVersion = INTERVIEW_CATALOG_VERSION,
): Problem {
  return {
    id: `interview-${item.id}`,
    kind: 'interview',
    title: item.question,
    source: 'manual',
    externalId: `interview:${item.id}`,
    difficulty: item.difficulty,
    tags: uniqueStrings(item.tags),
    content: item.question,
    constraints: [],
    examples: [],
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'manual',
    importMethod: 'import',
    interview: {
      catalogId: item.id,
      catalogVersion,
      contentOrigin: 'builtin',
      primaryRole: item.primaryRole,
      roles: uniqueStrings([item.primaryRole, ...item.roles]),
      category: item.category,
      format: item.format,
      keyPoints: item.keyPoints.map((point) => point.trim()),
      referenceAnswer: item.referenceAnswer.trim(),
      followUps: item.followUps.map((question) => question.trim()),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeInterviewCatalog(
  problems: Problem[],
  items: InterviewCatalogItem[],
  now = Date.now(),
  catalogVersion = INTERVIEW_CATALOG_VERSION,
): Problem[] {
  const byCatalogId = new Map<string, Problem>();
  problems.forEach((problem) => {
    const catalogId = problem.kind === 'interview' ? problem.interview?.catalogId : undefined;
    if (catalogId) byCatalogId.set(catalogId, problem);
  });
  const catalogIds = new Set(items.map((item) => item.id));
  const mergedCatalog = items.map((item) => {
    const incoming = catalogItemToProblem(item, now, catalogVersion);
    const existing = byCatalogId.get(item.id);
    if (!existing) return incoming;
    return {
      ...incoming,
      id: existing.id,
      platformStatus: existing.platformStatus,
      attachments: existing.attachments,
      createdAt: existing.createdAt,
      updatedAt: now,
      interview: {
        ...incoming.interview!,
        archived: existing.interview?.archived,
      },
    };
  });
  const personalAndAlgorithms = problems.filter((problem) => {
    const catalogId = problem.kind === 'interview' ? problem.interview?.catalogId : undefined;
    return !catalogId || !catalogIds.has(catalogId);
  });
  return [...personalAndAlgorithms, ...mergedCatalog];
}

export function isInterviewProblem(problem: Problem): boolean {
  return problem.kind === 'interview' && Boolean(problem.interview);
}

export function learningRoute(problem: Problem): string {
  return problem.kind === 'interview' ? `/interviews/${problem.id}` : `/solve/${problem.id}`;
}
