import { describe, expect, it } from 'vitest';
import { AI_INTERVIEW_CATALOG } from '../data/interviews/aiCatalog';
import { ENGINEERING_INTERVIEW_CATALOG } from '../data/interviews/engineeringCatalog';
import { SPECIALIZED_INTERVIEW_CATALOG } from '../data/interviews/specializedCatalog';

const EXPECTED_ROLE_COUNTS = {
  'ai-research-training': 50,
  'computer-vision': 50,
  'data-science-quant': 50,
  'database-middleware': 50,
  'game-graphics': 50,
  'solution-architect': 50,
} as const;

const FORBIDDEN = /TODO|TBD|待补充|占位|省略号|\.\.\.|…/i;
const hanCount = (value: string) => value.match(/\p{Script=Han}/gu)?.length ?? 0;
const normalizeQuestion = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const trigrams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 2) }, (_, index) => value.slice(index, index + 3)));
const similarity = (left: string, right: string) => {
  const leftSet = trigrams(normalizeQuestion(left));
  const rightSet = trigrams(normalizeQuestion(right));
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return intersection / Math.max(1, new Set([...leftSet, ...rightSet]).size);
};

describe('专项岗位面试题库', () => {
  it('精确包含六个新增主岗位，每个岗位 50 道题', () => {
    expect(SPECIALIZED_INTERVIEW_CATALOG).toHaveLength(300);
    expect(Object.fromEntries(Object.keys(EXPECTED_ROLE_COUNTS).map((role) => [
      role,
      SPECIALIZED_INTERVIEW_CATALOG.filter((item) => item.primaryRole === role).length,
    ]))).toEqual(EXPECTED_ROLE_COUNTS);
  });

  it('每道题都有完整独立内容，答案至少包含 80 个汉字', () => {
    for (const item of SPECIALIZED_INTERVIEW_CATALOG) {
      expect(item.id.trim()).not.toBe('');
      expect(item.question.trim()).not.toBe('');
      expect(item.roles).toContain(item.primaryRole);
      expect(item.category.trim()).not.toBe('');
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.keyPoints.length).toBeGreaterThanOrEqual(3);
      expect(item.keyPoints.every((point) => point.trim().length >= 4)).toBe(true);
      expect(hanCount(item.referenceAnswer), `${item.id} 的参考答案汉字数`).toBeGreaterThanOrEqual(80);
      expect(item.followUps.length).toBeGreaterThanOrEqual(1);
      expect(item.followUps.every((question) => question.trim().length >= 8)).toBe(true);
      expect(JSON.stringify(item)).not.toMatch(FORBIDDEN);
    }
  });

  it('新增题与现有目录在全局范围保持 ID、题面和答案唯一', () => {
    const allItems = [
      ...AI_INTERVIEW_CATALOG,
      ...ENGINEERING_INTERVIEW_CATALOG,
      ...SPECIALIZED_INTERVIEW_CATALOG,
    ];
    expect(new Set(allItems.map((item) => item.id)).size).toBe(allItems.length);
    expect(new Set(allItems.map((item) => item.question)).size).toBe(allItems.length);
    expect(new Set(allItems.map((item) => item.referenceAnswer)).size).toBe(allItems.length);
  });

  it('拒绝归一化后高度相似的题面和共享长前后缀的答案模板', () => {
    for (let left = 0; left < SPECIALIZED_INTERVIEW_CATALOG.length; left += 1) {
      for (let right = left + 1; right < SPECIALIZED_INTERVIEW_CATALOG.length; right += 1) {
        const score = similarity(
          SPECIALIZED_INTERVIEW_CATALOG[left].question,
          SPECIALIZED_INTERVIEW_CATALOG[right].question,
        );
        expect(score, `${SPECIALIZED_INTERVIEW_CATALOG[left].id} 与 ${SPECIALIZED_INTERVIEW_CATALOG[right].id} 题面相似`).toBeLessThan(0.9);
      }
    }

    const answerPrefixes = SPECIALIZED_INTERVIEW_CATALOG.map((item) => Array.from(item.referenceAnswer).slice(0, 24).join(''));
    const answerSuffixes = SPECIALIZED_INTERVIEW_CATALOG.map((item) => Array.from(item.referenceAnswer).slice(-24).join(''));
    expect(new Set(answerPrefixes).size).toBe(answerPrefixes.length);
    expect(new Set(answerSuffixes).size).toBe(answerSuffixes.length);
  });
});
