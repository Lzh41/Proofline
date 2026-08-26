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

/**
 * 岗位画像用于驱动 AI 出题范围。它不是招聘承诺，而是帮助出题官覆盖
 * 该岗位常见的知识、工程和场景维度；用户仍可在出题弹窗中编辑需求。
 */
export const INTERVIEW_ROLE_REQUIREMENTS: Record<string, string[]> = {
  'llm-app': ['LLM 应用架构与提示词工程', 'RAG 检索、重排与评估', '工具调用、Agent 编排与安全', '效果、延迟、成本和可观测性', '上线灰度、数据闭环与故障排查'],
  nlp: ['文本表示、Transformer 与预训练', '数据清洗、标注和训练策略', '微调、蒸馏、评测与误差分析', '推理性能和服务化部署', '安全、偏差与业务落地'],
  'rag-agent': ['文档切分、Embedding 与向量检索', '混合召回、重排和上下文构造', 'Agent 规划、工具协议与记忆', '幻觉、引用完整性和离线/在线评估', '权限隔离、成本控制与故障恢复'],
  multimodal: ['视觉语言模型与跨模态对齐', '图像/视频预处理和数据构建', '多模态训练、微调与评测', '推理吞吐、显存和服务化', '安全、可解释性与真实场景落地'],
  'ai-platform': ['训练与推理平台架构', '模型注册、版本、发布和回滚', '资源调度、GPU 利用率与弹性', '监控、数据/模型质量和故障排查', '权限、成本、合规与可复现性'],
  'recommendation-search': ['召回、粗排、精排和重排链路', '特征、样本、标签与离线训练', '点击率/转化率等指标与实验', '实时性、冷启动和反馈偏差', '稳定性、可解释性与业务权衡'],
  backend: ['语言基础、并发和网络协议', '服务拆分、API 设计和数据一致性', '数据库、缓存、消息队列与事务', '性能、容量、可观测性和故障排查', '安全、可靠性与高可用架构'],
  frontend: ['HTML/CSS/JavaScript 与浏览器原理', 'React/Vue 组件、状态和工程化', '性能、可访问性和兼容性', '网络、缓存、安全与错误监控', '测试、发布和复杂交互设计'],
  client: ['Android/iOS 平台与生命周期', '线程、网络、存储和组件通信', '性能、功耗、稳定性与兼容性', '安全、隐私和离线能力', '工程化、测试和版本发布'],
  'data-engineering': ['数据采集、清洗和质量校验', '数仓分层、建模与 SQL 性能', '批流一体、调度和数据血缘', '一致性、容错、回放与成本', '权限、治理和指标口径'],
  'test-development': ['测试设计、分层和自动化框架', '接口、性能、并发和可靠性测试', '质量指标、缺陷定位与根因分析', 'CI/CD、环境治理和测试数据', '安全、兼容性与风险控制'],
  'sre-devops': ['Linux、网络和基础设施自动化', '容器、Kubernetes 与服务编排', 'CI/CD、发布策略和回滚', '监控、告警、容量与事故响应', '可靠性目标、成本和安全合规'],
  security: ['身份认证、授权和密码学基础', 'Web、主机、网络与供应链安全', '威胁建模、漏洞发现和响应', '审计、检测、取证和合规', '安全架构、隐私与业务权衡'],
  embedded: ['C/C++、内存和并发基础', '嵌入式系统、RTOS 与驱动', '外设、通信协议和实时性', '功耗、可靠性、调试和量产', 'IoT 安全、升级和远程运维'],
  fundamentals: ['数据结构、算法和复杂度', '操作系统、网络和计算机组成', '数据库、并发和分布式基础', '工程设计、调试和性能分析', '安全、可靠性和实际场景应用'],
  'ai-research-training': ['预训练、对齐和微调方法', '数据配比、训练稳定性和实验设计', '模型结构、损失函数和优化器', '分布式训练、显存与推理效率', '评测、复现、风险和研究表达'],
  'computer-vision': ['图像处理、检测、分割和识别', 'CNN/Transformer 与视觉表征', '数据增强、标注、训练和评测', '部署、推理性能和边缘设备', '误差分析、鲁棒性和业务落地'],
  'data-science-quant': ['概率统计、机器学习和实验设计', '特征、标签、回测与数据泄漏', '指标、因果分析和不确定性', '模型部署、监控和迭代', '风险、合规、成本与业务沟通'],
  'database-middleware': ['数据库内核、索引和事务', '缓存、消息队列和中间件语义', '复制、分片、一致性和容灾', '性能、容量、监控和故障恢复', '数据安全、兼容性和迁移'],
  'game-graphics': ['游戏架构、引擎和渲染管线', '图形学、光照、材质和动画', '资源、内存、帧率和性能优化', '网络同步、物理和工具链', '跨平台、稳定性与线上运营'],
  'solution-architect': ['业务建模、架构权衡和技术选型', '云原生、集成、数据与安全架构', '可靠性、容量、成本和治理', '迁移、交付、组织协作和风险', '架构表达、决策记录和演进路线'],
};

export function interviewRoleRequirements(roleId: string): string[] {
  return INTERVIEW_ROLE_REQUIREMENTS[roleId] ?? ['岗位核心知识与基础原理', '工程实现、性能和边界条件', '系统设计、稳定性与故障排查', '安全、质量和可观测性', '业务场景、沟通与方案权衡'];
}

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

/**
 * 给 AI 出题官使用的检索选项。与列表筛选不同，检索会对命中结果排序，
 * 并优先保留不同题型和知识分类，避免岗位需求较长时只命中同一类题。
 */
export interface InterviewCatalogRetrievalFilter extends InterviewSearchFilter {
  roles?: string[];
  limit?: number;
  minPerFormat?: number;
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

/** 按岗位与 JD 做轻量语义检索，优先保证岗位命中，再用需求关键词补充排序。 */
export function searchInterviewCatalogForRequirements(
  items: InterviewCatalogItem[],
  input: { role?: string; requirements: string; limit?: number },
): InterviewCatalogItem[] {
  return retrieveInterviewCatalog(items, {
    role: input.role,
    query: input.requirements,
    limit: input.limit,
    minPerFormat: (input.limit ?? 24) >= 8 ? 2 : 1,
  });
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

function retrievalTokens(value: string): string[] {
  const segments = value.toLocaleLowerCase().match(/[a-z][a-z0-9+#._-]{1,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const tokens: string[] = [];
  for (const segment of segments) {
    if (!tokens.includes(segment)) tokens.push(segment);
    // 长岗位描述通常没有空格，用二字词补足“检索、召回、排序”等局部命中。
    if (/^\p{Script=Han}+$/u.test(segment) && segment.length <= 16) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const token = segment.slice(index, index + 2);
        if (!tokens.includes(token)) tokens.push(token);
      }
    }
    if (tokens.length >= 64) break;
  }
  return tokens.slice(0, 64);
}

function roleTerms(role: string | undefined, roles: string[] = []): string[] {
  return uniqueStrings(
    [role, ...roles]
      .filter((value): value is string => Boolean(value?.trim()))
      .flatMap((value) => [value, ...roleSearchTerms(value)]),
  ).map((value) => normalizeText(value));
}

/**
 * 检索并多样化采样本地面试题库，供 AI 生成岗位题集时作为 grounded context。
 * 返回值保持目录题目原结构，调用方可直接转换成 prompt 或 Problem。
 */
export function retrieveInterviewCatalog(
  items: InterviewCatalogItem[],
  filter: InterviewCatalogRetrievalFilter,
): InterviewCatalogItem[] {
  const limit = Math.min(96, Math.max(1, Math.round(filter.limit ?? 32)));
  const queryTokens = retrievalTokens(filter.query ?? '');
  const requestedRoles = roleTerms(filter.role, filter.roles);
  const ranked = items
    .map((item, index) => {
      const question = normalizeText(item.question);
      const category = normalizeText(item.category);
      const tags = item.tags.map((tag) => normalizeText(tag));
      const searchable = normalizedSearchText(item);
      const itemRoles = item.roles.flatMap((role) => roleSearchTerms(role)).map((role) => normalizeText(role));
      let score = 0;
      let matchedTokens = 0;
      for (const token of queryTokens) {
        if (question.includes(token)) score += 12;
        else if (category.includes(token) || tags.some((tag) => tag.includes(token))) score += 9;
        else if (searchable.includes(token)) score += 3;
        else continue;
        matchedTokens += 1;
      }
      if (requestedRoles.length > 0) {
        const roleHit = requestedRoles.some((role) => itemRoles.some((itemRole) => itemRole.includes(role) || role.includes(itemRole)));
        if (roleHit) score += 24;
      }
      if (filter.category && item.category === filter.category) score += 16;
      if (filter.format && item.format === filter.format) score += 16;
      return { item, index, score, matchedTokens };
    })
    .filter(({ score, matchedTokens }) => queryTokens.length === 0 || score > 0 || matchedTokens > 0)
    .sort((left, right) => right.score - left.score || right.matchedTokens - left.matchedTokens || left.index - right.index);

  if (!ranked.length) return [];

  const selected: InterviewCatalogItem[] = [];
  const selectedIds = new Set<string>();
  const minPerFormat = Math.min(4, Math.max(0, Math.round(filter.minPerFormat ?? (limit >= 8 ? 2 : 1))));
  const formatOrder: InterviewFormat[] = ['knowledge', 'scenario', 'system-design', 'project'];

  // 先按题型轮询，保证理论、场景、系统设计和项目题都有机会进入上下文。
  for (let round = 0; round < minPerFormat && selected.length < limit; round += 1) {
    for (const format of formatOrder) {
      const candidate = ranked.find(({ item }) => item.format === format && !selectedIds.has(item.id));
      if (!candidate) continue;
      selected.push(candidate.item);
      selectedIds.add(candidate.item.id);
      if (selected.length >= limit) break;
    }
  }

  // 再补充未覆盖的知识分类，最后才按相关性填满剩余名额。
  const categories = new Set(selected.map((item) => item.category));
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.item.id)) continue;
    if (categories.has(candidate.item.category)) continue;
    selected.push(candidate.item);
    selectedIds.add(candidate.item.id);
    categories.add(candidate.item.category);
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.item.id)) continue;
    selected.push(candidate.item);
    selectedIds.add(candidate.item.id);
  }
  return selected;
}

/** 将用户保存的面试题转换为同一检索结构，供出题官合并检索内置与个人题库。 */
export function problemToInterviewCatalogItem(problem: Problem): InterviewCatalogItem | null {
  if (problem.kind !== 'interview' || !problem.interview) return null;
  const detail = problem.interview;
  return {
    id: detail.catalogId ? `catalog:${detail.catalogId}` : `problem:${problem.id}`,
    question: problem.title,
    primaryRole: detail.primaryRole,
    roles: uniqueStrings([detail.primaryRole, ...detail.roles]),
    category: detail.category,
    format: detail.format,
    difficulty: problem.difficulty === 'unknown' ? 'medium' : problem.difficulty,
    tags: uniqueStrings(problem.tags),
    keyPoints: detail.keyPoints,
    referenceAnswer: detail.referenceAnswer,
    followUps: detail.followUps,
  };
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
