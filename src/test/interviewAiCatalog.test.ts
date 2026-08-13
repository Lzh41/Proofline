import { describe, expect, it } from 'vitest';
import { AI_INTERVIEW_CATALOG } from '../data/interviews/aiCatalog';

const REQUIRED_ROLES = [
  'llm-app',
  'rag-agent',
  'nlp',
  'multimodal',
  'ai-platform',
  'recommendation-search',
] as const;

const FORMATS = new Set(['knowledge', 'scenario', 'system-design', 'project']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const FORBIDDEN_PLACEHOLDERS = /TODO|待补充|占位(?:内容|题目|答案)|此处省略|\.\.\.|……/i;

const SEMANTIC_TOPIC_REPLACEMENTS = [
  ['ai-recommendation-search-028', '延迟反馈', /延迟反馈|生存分析/u, /Pointwise|Pairwise|Listwise/u],
  ['ai-platform-021', '分块预填充', /Chunked Prefill|分块预填充/u, /Continuous Batching/u],
  ['ai-platform-022', '缓存量化', /KV Cache 量化|缓存量化/u, /PagedAttention/u],
  ['ai-platform-026', '推理解耦', /Prefill-Decode|预填充解码分离/u, /Tensor Parallel|Pipeline Parallel/u],
  ['ai-rag-agent-001', '检索日志隐私', /差分隐私|隐私遥测/u, /切分|Chunking/u],
  ['ai-rag-agent-002', '嵌入迁移', /嵌入迁移|双空间/u, /切分|Chunking/u],
  ['ai-rag-agent-003', '召回熔断', /召回熔断|检索降级/u, /BM25|Hybrid Retrieval/u],
  ['ai-rag-agent-004', '迟交互检索', /ColBERT|迟交互/u, /Cross-encoder|Reranker/u],
  ['ai-rag-agent-005', '假设文档检索', /HyDE|假设文档/u, /Query Rewrite|查询改写/u],
  ['ai-rag-agent-009', '索引对账', /Merkle|索引对账/u, /增量索引|Incremental Index/u],
  ['ai-rag-agent-010', '证据防篡改', /内容寻址|证据签名/u, /Citation|引用生成/u],
  ['ai-rag-agent-020', '图工作流', /动态扇出|图工作流/u, /ReAct/u],
  ['ai-rag-agent-021', '计划缓存', /计划缓存|依赖指纹/u, /Planner|Executor/u],
  ['ai-rag-agent-022', '能力安全', /能力令牌|对象能力/u, /Tool Schema|工具 Schema/u],
  ['ai-rag-agent-023', '委托凭据', /委托令牌|即时凭据/u, /MCP/u],
  ['ai-rag-agent-024', '跨系统补偿', /Saga|补偿事务/u, /支付|幂等键/u],
  ['ai-rag-agent-025', '策略即代码', /OPA|策略即代码/u, /Human-in-the-loop|人工审批/u],
  ['ai-rag-agent-026', '记忆投毒', /记忆投毒|污染隔离/u, /工作记忆|情节记忆|语义记忆/u],
  ['ai-rag-agent-031', '数据血缘', /列级血缘|数据血缘/u, /SQL Agent|Text-to-SQL/u],
  ['ai-rag-agent-035', '委托证明', /委托链|授权证明/u, /多 Agent 系统如何分工|Multi-Agent/u],
] as const;

function countChineseCharacters(value: string): number {
  return value.match(/\p{Script=Han}/gu)?.length ?? 0;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '');
}

function characterShingles(value: string, width = 6): Set<string> {
  const normalized = normalize(value);
  const shingles = new Set<string>();
  for (let index = 0; index <= normalized.length - width; index += 1) {
    shingles.add(normalized.slice(index, index + width));
  }
  return shingles;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function sharedSuffixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[left.length - 1 - count] === right[right.length - 1 - count]) {
    count += 1;
  }
  return count;
}

function duplicateOwners(values: string[]): string[] {
  const owners = new Map<string, string>();
  const duplicates: string[] = [];
  values.forEach((value, index) => {
    const id = AI_INTERVIEW_CATALOG[index].id;
    const owner = owners.get(value);
    if (owner) duplicates.push(`${owner} / ${id}`);
    else owners.set(value, id);
  });
  return duplicates;
}

describe('AI 岗位面试题库', () => {
  it('六个现代 AI 方向各提供至少 50 道独立题目', () => {
    expect(AI_INTERVIEW_CATALOG.length).toBeGreaterThanOrEqual(REQUIRED_ROLES.length * 50);

    for (const role of REQUIRED_ROLES) {
      expect(
        AI_INTERVIEW_CATALOG.filter((item) => item.primaryRole === role).length,
        `${role} 题量不足`,
      ).toBeGreaterThanOrEqual(50);
    }
  });

  it('每道题的 ID、归一化题面和归一化参考答案均全局唯一', () => {
    const ids = AI_INTERVIEW_CATALOG.map((item) => item.id);
    const questions = AI_INTERVIEW_CATALOG.map((item) => normalize(item.question));
    const answers = AI_INTERVIEW_CATALOG.map((item) => normalize(item.referenceAnswer));

    expect(duplicateOwners(ids)).toEqual([]);
    expect(duplicateOwners(questions)).toEqual([]);
    expect(duplicateOwners(answers)).toEqual([]);
  });

  it('每道题都具有合法、完整且可用于筛选的元数据', () => {
    for (const item of AI_INTERVIEW_CATALOG) {
      expect(item.id.trim()).not.toBe('');
      expect(item.question.trim()).not.toBe('');
      expect(item.category.trim()).not.toBe('');
      expect(FORMATS.has(item.format)).toBe(true);
      expect(DIFFICULTIES.has(item.difficulty)).toBe(true);
      expect(item.roles.length).toBeGreaterThan(0);
      expect(item.roles).toContain(item.primaryRole);
      expect(item.roles.every((role) => role.trim().length > 0)).toBe(true);
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.tags.every((tag) => tag.trim().length > 0)).toBe(true);
    }
  });

  it('每道题都提供至少三个独立要点、80 个中文汉字的答案和至少一条追问', () => {
    for (const item of AI_INTERVIEW_CATALOG) {
      const normalizedPoints = item.keyPoints.map(normalize);
      expect(item.keyPoints.length, item.id).toBeGreaterThanOrEqual(3);
      expect(new Set(normalizedPoints).size, `${item.id} 要点重复`).toBe(item.keyPoints.length);
      expect(normalizedPoints.every((point) => point.length >= 4), `${item.id} 要点过短`).toBe(true);
      expect(countChineseCharacters(item.referenceAnswer), `${item.id} 答案中文汉字不足`).toBeGreaterThanOrEqual(80);
      expect(item.followUps.length, item.id).toBeGreaterThanOrEqual(1);
      expect(item.followUps.every((question) => question.trim().length > 0)).toBe(true);
    }
  });

  it('参考答案不复用统一长前后缀、长句或高度相似内容', () => {
    const sentenceOwners = new Map<string, string>();
    const normalizedAnswers = AI_INTERVIEW_CATALOG.map((item) => normalize(item.referenceAnswer));
    const shingles = AI_INTERVIEW_CATALOG.map((item) => characterShingles(item.referenceAnswer));

    for (const item of AI_INTERVIEW_CATALOG) {
      const sentences = item.referenceAnswer
        .split(/[。！？；]/u)
        .map(normalize)
        .filter((sentence) => countChineseCharacters(sentence) >= 16);
      for (const sentence of sentences) {
        expect(sentenceOwners.get(sentence), `${item.id} 与 ${sentenceOwners.get(sentence)} 复用了长句`).toBeUndefined();
        sentenceOwners.set(sentence, item.id);
      }
    }

    for (let left = 0; left < AI_INTERVIEW_CATALOG.length; left += 1) {
      for (let right = left + 1; right < AI_INTERVIEW_CATALOG.length; right += 1) {
        const pair = `${AI_INTERVIEW_CATALOG[left].id} / ${AI_INTERVIEW_CATALOG[right].id}`;
        expect(sharedPrefixLength(normalizedAnswers[left], normalizedAnswers[right]), `${pair} 共享长前缀`).toBeLessThan(24);
        expect(sharedSuffixLength(normalizedAnswers[left], normalizedAnswers[right]), `${pair} 共享长后缀`).toBeLessThan(24);
        expect(jaccard(shingles[left], shingles[right]), `${pair} 答案过于相似`).toBeLessThan(0.55);
      }
    }
  }, 20_000);

  it('题面不存在仅补充限定词形成的近重复版本', () => {
    const questionShingles = AI_INTERVIEW_CATALOG.map((item) => characterShingles(item.question, 3));
    const violations: string[] = [];

    for (let left = 0; left < AI_INTERVIEW_CATALOG.length; left += 1) {
      for (let right = left + 1; right < AI_INTERVIEW_CATALOG.length; right += 1) {
        const similarity = jaccard(questionShingles[left], questionShingles[right]);
        if (similarity >= 0.72) {
          violations.push(`${AI_INTERVIEW_CATALOG[left].id} / ${AI_INTERVIEW_CATALOG[right].id}: ${similarity.toFixed(3)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('已发现的语义冲突 ID 保持为彼此不同的新知识主题', () => {
    for (const [id, category, requiredTopic, forbiddenTopic] of SEMANTIC_TOPIC_REPLACEMENTS) {
      const item = AI_INTERVIEW_CATALOG.find((candidate) => candidate.id === id);
      expect(item, id).toBeDefined();
      expect(item?.category, id).toBe(category);

      const searchable = [item?.question, ...(item?.tags ?? []), ...(item?.keyPoints ?? [])].join(' ');
      expect(searchable, `${id} 缺少新主题标识`).toMatch(requiredTopic);
      expect(searchable, `${id} 仍保留旧冲突主题`).not.toMatch(forbiddenTopic);
    }
  });

  it('所有内容都不包含 TODO、待补充、占位或省略号', () => {
    for (const item of AI_INTERVIEW_CATALOG) {
      expect(JSON.stringify(item)).not.toMatch(FORBIDDEN_PLACEHOLDERS);
    }
  });
});
