import { describe, expect, it } from 'vitest';
import { importSnapshot } from '../lib/importer';
import { problem, snapshot } from './fixtures';

describe('数据导入', () => {
  it('按平台链接去重并保留个人内容', () => {
    const current = snapshot();
    current.problems = [problem({ content: '我的题面笔记', tags: ['个人标签'], attachments: [{ id: 'a', name: 'a.png', mimeType: 'image/png', path: 'a.png', size: 1, createdAt: 1 }] })];
    const incoming = snapshot();
    incoming.problems = [problem({ id: 'remote-id', sourceUrl: 'https://leetcode.cn/problems/two-sum/?env=x#top', content: '平台题面', tags: ['数组'] })];
    const result = importSnapshot(current, incoming);
    expect(result.snapshot.problems).toHaveLength(1);
    expect(result.snapshot.problems[0].content).toBe('我的题面笔记');
    expect(result.snapshot.problems[0].attachments).toHaveLength(1);
    expect(result.updated.problems).toBe(1);
  });

  it('同名算法题和面试题不会互相合并', () => {
    const current = snapshot();
    current.problems = [problem({
      kind: 'algorithm',
      source: 'manual',
      sourceUrl: undefined,
      externalId: undefined,
      title: '解释并发与并行的区别',
    })];
    const incoming = snapshot();
    incoming.problems = [problem({
      id: 'interview-concurrency',
      kind: 'interview',
      source: 'manual',
      sourceUrl: undefined,
      externalId: undefined,
      title: '解释并发与并行的区别',
      interview: {
        contentOrigin: 'user',
        primaryRole: 'backend',
        roles: ['backend'],
        category: '并发基础',
        format: 'knowledge',
        keyPoints: ['任务交错', '同时执行', '资源调度'],
        referenceAnswer: '并发描述多个任务在同一时间段内推进，并行描述多个任务在同一时刻执行。工程上还要结合线程、核心数、调度开销和共享资源竞争分析，不能只用是否多线程判断。',
        followUps: ['单核系统能否实现并发？'],
      },
    })];

    const result = importSnapshot(current, incoming);

    expect(result.snapshot.problems).toHaveLength(2);
    expect(new Set(result.snapshot.problems.map((item) => item.kind))).toEqual(new Set(['algorithm', 'interview']));
  });

  it('同一平台题号即使链接形式不同也只保留一道', () => {
    const current = snapshot();
    current.problems = [problem({
      id: 'existing',
      sourceUrl: 'https://leetcode.cn/problems/two-sum/?envType=study-plan',
      externalId: '1',
    })];
    const incoming = snapshot();
    incoming.problems = [problem({
      id: 'incoming',
      sourceUrl: 'https://leetcode.cn/problems/two-sum/',
      externalId: '1',
    })];

    const result = importSnapshot(current, incoming);

    expect(result.snapshot.problems).toHaveLength(1);
    expect(result.snapshot.problems[0].id).toBe('existing');
  });

  it('批量同步会把链接卡升级为完整题面并保留个人状态', () => {
    const current = snapshot();
    current.problems = [problem({
      id: 'existing',
      content: '',
      examples: [],
      cacheStatus: 'link-only',
      importMethod: 'platform',
      platformStatus: 'attempted',
      attachments: [{ id: 'note', name: 'note.txt', mimeType: 'text/plain', path: 'note.txt', size: 1, createdAt: 1 }],
    })];
    const incoming = snapshot();
    incoming.problems = [problem({
      id: 'remote',
      content: '完整公开题面',
      examples: [{ input: '1 2', output: '3' }],
      cacheStatus: 'fresh',
      importMethod: 'connector',
      platformStatus: 'todo',
      contentFetchedAt: 500,
    })];

    const result = importSnapshot(current, incoming);
    const merged = result.snapshot.problems[0];

    expect(merged).toMatchObject({
      id: 'existing',
      content: '完整公开题面',
      cacheStatus: 'fresh',
      importMethod: 'connector',
      platformStatus: 'attempted',
      contentFetchedAt: 500,
    });
    expect(merged.examples).toEqual([{ input: '1 2', output: '3' }]);
    expect(merged.attachments).toHaveLength(1);
  });

  it('新鲜平台模板会修复同题历史残留的错误函数签名', () => {
    const current = snapshot();
    current.problems = [problem({
      id: 'existing',
      externalId: '4',
      platformSlug: 'median-of-two-sorted-arrays',
      sourceUrl: 'https://leetcode.cn/problems/median-of-two-sorted-arrays/',
      cacheStatus: 'fresh',
      codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: 'def findMedianSortedArrays(nums1, nums2):\n    ' }],
    })];
    const incoming = snapshot();
    incoming.problems = [problem({
      id: 'remote',
      externalId: '4',
      platformSlug: 'median-of-two-sorted-arrays',
      sourceUrl: 'https://leetcode.cn/problems/median-of-two-sorted-arrays/',
      cacheStatus: 'fresh',
      codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: 'def findMedianSortedArrays(nums1, nums2):\n    # 官方最新模板' }],
    })];

    const result = importSnapshot(current, incoming);

    expect(result.snapshot.problems[0].codeSnippets?.[0]?.code).toContain('官方最新模板');
  });
});
