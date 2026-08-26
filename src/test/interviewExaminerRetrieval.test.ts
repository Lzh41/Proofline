import { describe, expect, it } from 'vitest';
import {
  buildInterviewExaminerPrompt,
  filterInterviewQuestionAdditions,
  parseInterviewExaminerResponse,
} from '../lib/ai';
import { retrieveInterviewCatalog, type InterviewCatalogItem } from '../lib/interviews';

const catalog: InterviewCatalogItem[] = [
  ['q-knowledge', '为什么要对向量检索结果做重排？', '检索原理', 'knowledge'],
  ['q-scenario', '线上召回延迟突然升高，你如何定位并降级？', '故障排查', 'scenario'],
  ['q-system', '请设计一个支持权限隔离的 RAG 检索服务。', '系统设计', 'system-design'],
  ['q-project', '讲一个你落地 Embedding 评估并推动上线的项目。', '项目落地', 'project'],
  ['q-rerank', '如何选择 Reranker 并验证它带来的收益？', '效果评估', 'knowledge'],
  ['q-cache', '缓存失效后如何避免检索服务雪崩？', '稳定性', 'scenario'],
].map(([id, question, category, format]) => ({
  id,
  question,
  primaryRole: 'rag-agent',
  roles: ['rag-agent', 'llm-app'],
  category,
  format: format as InterviewCatalogItem['format'],
  difficulty: 'medium',
  tags: ['RAG', '检索'],
  keyPoints: ['召回质量与延迟的权衡', '权限和数据边界', '通过指标与失败样本验证'],
  referenceAnswer: '需要结合离线指标、在线延迟、权限边界和失败样本分析，先定义验收标准，再通过灰度或回放验证方案是否真的改善了业务结果。',
  followUps: ['如果流量翻倍，你会先调整哪一层？'],
}));

describe('AI 面试出题题库检索', () => {
  it('按岗位需求命中并优先覆盖不同题型与知识分类', () => {
    const result = retrieveInterviewCatalog(catalog, {
      role: 'rag-agent',
      query: 'RAG 检索 延迟 权限 上线项目',
      limit: 4,
      minPerFormat: 1,
    });

    expect(result).toHaveLength(4);
    expect(new Set(result.map((item) => item.format))).toEqual(new Set(['knowledge', 'scenario', 'system-design', 'project']));
    expect(new Set(result.map((item) => item.category)).size).toBeGreaterThanOrEqual(3);
  });

  it('prompt 明确先审计题库、补齐岗位需求缺口并禁止复用', () => {
    const prompt = buildInterviewExaminerPrompt({
      topic: '高级 RAG 工程师',
      role: 'rag-agent',
      roleLabel: '高级 RAG 工程师',
      requirements: '负责文档切分、混合召回、权限隔离、线上稳定性和效果评估',
      difficulty: 'hard',
      count: 12,
      catalogContext: catalog.slice(0, 4).map((item) => ({
        id: item.id,
        title: item.question,
        category: item.category,
        format: item.format,
        difficulty: item.difficulty,
        roles: item.roles,
        tags: item.tags,
        keyPoints: item.keyPoints,
      })),
    });

    expect(prompt).toContain('先做题库覆盖审计');
    expect(prompt).toContain('高级 RAG 工程师');
    expect(prompt).toContain('权限隔离');
    expect(prompt).toContain('q-system');
    expect(prompt).toContain('questions 数组必须恰好包含 12 道');
    expect(prompt).toContain('不得复制检索题');
  });

  it('解析覆盖缺口和生成题来源元数据，同时兼容无可选字段响应', () => {
    const parsed = parseInterviewExaminerResponse(JSON.stringify({
      topic: '高级 RAG 工程师',
      overview: '覆盖检索、工程和稳定性。',
      checkpoints: ['混合召回', '权限隔离'],
      coverage: ['检索原理'],
      gaps: ['线上故障恢复'],
      questions: [{
        title: '如何为 RAG 设计故障恢复？',
        category: '稳定性',
        format: 'scenario',
        difficulty: 'hard',
        tags: ['RAG'],
        keyPoints: ['识别故障边界', '设计降级路径', '验证恢复效果'],
        referenceAnswer: '应先划分检索、重排和生成各层的故障边界，再为超时、空结果和依赖不可用设计可观测的降级路径，并通过故障演练、回放和灰度验证恢复效果。',
        followUps: ['如何避免降级掩盖真实质量问题？'],
        origin: 'generated',
        gap: '线上故障恢复',
      }],
    }));

    expect(parsed).toMatchObject({ coverage: ['检索原理'], gaps: ['线上故障恢复'] });
    expect(parsed.questions[0]).toMatchObject({ origin: 'generated', gap: '线上故障恢复' });
  });

  it('追加轮次会过滤同名题和重复回答要点，并保留不同知识点', () => {
    const base = {
      category: '检索评测',
      format: 'knowledge' as const,
      difficulty: 'medium' as const,
      tags: ['RAG'],
      referenceAnswer: '参考答案',
      followUps: ['追问'],
    };
    const existing = [{
      ...base,
      title: '如何评估召回质量？',
      keyPoints: ['召回率与 nDCG 指标'],
    }];
    const additions = filterInterviewQuestionAdditions([
      { ...base, title: '召回质量评估怎么做？', keyPoints: ['召回率与 nDCG 指标'] },
      { ...base, title: '如何评估召回质量？', keyPoints: ['离线样本切分'] },
      { ...base, title: '线上评测如何校准？', keyPoints: ['人工抽检与业务成功率'] },
      { ...base, title: '线上评测如何校准？', keyPoints: ['人工抽检与业务成功率'] },
    ], existing);

    expect(additions.map((question) => question.title)).toEqual(['线上评测如何校准？']);
  });
});
