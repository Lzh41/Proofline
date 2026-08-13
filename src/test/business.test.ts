import { describe, expect, it } from 'vitest';
import { buildHintPrompt, coachIntentLevel } from '../lib/ai';
import { createBackupManifest, parseExport, serializeExport } from '../lib/backup';
import { isAllowedPlatformUrl } from '../lib/platform';
import { calculateStatistics } from '../lib/statistics';
import { attempt, mistake, problem, snapshot } from './fixtures';

describe('业务安全与统计', () => {
  it('平台地址必须是精确 HTTPS 域名', () => {
    expect(isAllowedPlatformUrl('leetcode-cn', 'https://leetcode.cn/problems/two-sum/')).toBe(true);
    expect(isAllowedPlatformUrl('leetcode-cn', 'http://leetcode.cn/problems/two-sum/')).toBe(false);
    expect(isAllowedPlatformUrl('leetcode-cn', 'https://leetcode.cn.evil.example/problems/two-sum/')).toBe(false);
  });

  it('连续代码教练会结合当前代码和运行反馈给出局部实现', () => {
    for (const intent of ['analyze', 'next-code', 'debug'] as const) {
      const prompt = buildHintPrompt({
        intent,
        problem: problem(),
        attempt: attempt({ code: 'class Solution {\n  // 已写代码\n};' }),
        recentRunError: '样例 1 未通过：期望 [0,1]，实际 []',
      });

      expect(prompt).toContain('帮助用户亲手把代码写出来');
      expect(prompt).toContain('## 当前判断');
      expect(prompt).toContain('## 现在改这里');
      expect(prompt).toContain('## 代码片段');
      expect(prompt).toContain('## 运行后看什么');
      expect(prompt).toContain('本轮不得输出完整解答');
      expect(prompt).toContain('// 已写代码');
      expect(prompt).toContain('样例 1 未通过');
      expect(prompt).toContain('当前语言：C++17');
    }
  });

  it('AI 解惑不会套用边界检查功能', () => {
    const prompt = buildHintPrompt({
      intent: 'explain' as never,
      problem: problem(),
      attempt: attempt({ code: 'class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { return {}; } };' }),
      userQuestion: '为什么这里要用哈希表，map 里应该存什么？',
    });

    expect(coachIntentLevel('explain' as never)).toBe(3);
    expect(prompt).toContain('本轮请求：AI 解惑');
    expect(prompt).toContain('像对话问答一样');
    expect(prompt).toContain('为什么这里要用哈希表');
    expect(prompt).not.toContain('检查边界');
    expect(prompt).not.toContain('## 代码片段');
  });

  it('算法逻辑拆解会解释为什么这样设计而不是直接给完整代码', () => {
    const prompt = buildHintPrompt({
      intent: 'algorithm-logic' as never,
      problem: problem({
        title: '最长递增子序列',
        content: '给你一个整数数组 nums，返回最长严格递增子序列的长度。',
        tags: ['动态规划', '二分'],
      }),
      attempt: attempt({ code: 'function lengthOfLIS(nums: number[]): number {\n  return 0;\n}' }),
      recentRunError: '样例 1 未通过：期望 4，实际 0',
    });

    expect(coachIntentLevel('algorithm-logic' as never)).toBe(3);
    expect(prompt).toContain('本轮请求：算法逻辑拆解');
    expect(prompt).toContain('为什么选择这个算法或数据结构');
    expect(prompt).toContain('## 算法选择');
    expect(prompt).toContain('## 为什么这么设计');
    expect(prompt).toContain('## 关键步骤拆解');
    expect(prompt).toContain('## 边界与复杂度');
    expect(prompt).toContain('## 写代码时的落点');
    expect(prompt).toContain('不要输出完整代码');
    expect(prompt).toContain('状态定义');
    expect(prompt).toContain('转移或更新规则');
    expect(prompt).toContain('样例 1 未通过');
  });

  it('只有完整代码意图强制给出无 TODO 的最终实现', () => {
    const prompt = buildHintPrompt({
      intent: 'complete',
      problem: problem(),
      language: 'python3',
    });

    expect(prompt).toContain('当前语言：Python 3');
    expect(prompt).toContain('本轮请求：给完整代码');
    expect(prompt).toContain('禁止 TODO');
    expect(prompt).toContain('## 完整代码');
    expect(prompt).toContain('## 关键逻辑');
    expect(prompt).toContain('## 复杂度');
    expect(prompt).toContain('## 边界检查');
  });

  it('后续提示承接最近教练对话并截断过早内容', () => {
    const previousGuidance = `应被截断的开头${'前'.repeat(8_100)}最近一步：已经写好哈希表声明`;
    const prompt = buildHintPrompt({ intent: 'next-code', problem: problem(), previousGuidance });

    expect(prompt).toContain('最近教练对话：');
    expect(prompt).toContain('较早对话已省略');
    expect(prompt).not.toContain('应被截断的开头');
    expect(prompt).toContain('最近一步：已经写好哈希表声明');
  });

  it('统计真实尝试、耗时、错题与薄弱标签', () => {
    const value = calculateStatistics([problem()], [attempt()], [mistake()], 100);
    expect(value.totalAttempts).toBe(1);
    expect(value.totalFocusSeconds).toBe(30);
    expect(value.dueReviews).toBe(1);
    expect(value.weakTags[0].failures).toBe(1);
  });

  it('备份清单明确排除凭据和 Cookie 且可以恢复', () => {
    const value = snapshot();
    value.problems = [problem()];
    value.settings.hasAiCredential = true;
    const manifest = createBackupManifest(value, '1.0.0', 100);
    expect(manifest.entityCounts.problems).toBe(1);
    expect(manifest.entityCounts.algorithmProblems).toBe(1);
    expect(manifest.entityCounts.interviewQuestions).toBe(0);
    expect(manifest.entityCounts.interviewAttempts).toBe(0);
    expect(manifest.includesCredentials).toBe(false);
    expect(manifest.includesPlatformCookies).toBe(false);
    const restored = parseExport(serializeExport(value));
    expect(restored.problems[0].title).toBe('两数之和');
    expect(restored.settings.hasAiCredential).toBe(false);
  });
});
