import { describe, expect, it } from 'vitest';
import { FUNDAMENTALS_ADDITIONAL_SEEDS } from '../data/interviews/fundamentalsAdditions';

const ALLOWED_FORMATS = new Set(['knowledge', 'scenario', 'system-design', 'project']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const FORBIDDEN_PLACEHOLDERS = /TODO|待补充|占位|省略号|\.\.\.|…/i;

const normalize = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('zh-CN')
  .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '');

const bigrams = (value: string) => {
  const normalized = normalize(value);
  return new Set(Array.from(
    { length: Math.max(0, normalized.length - 1) },
    (_, index) => normalized.slice(index, index + 2),
  ));
};

const diceSimilarity = (left: string, right: string) => {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let shared = 0;
  leftBigrams.forEach((gram) => {
    if (rightBigrams.has(gram)) shared += 1;
  });
  return (2 * shared) / Math.max(1, leftBigrams.size + rightBigrams.size);
};

const commonEdgeLength = (left: string, right: string, fromEnd = false) => {
  const a = Array.from(normalize(left));
  const b = Array.from(normalize(right));
  let length = 0;
  while (length < a.length && length < b.length) {
    const ai = fromEnd ? a.length - 1 - length : length;
    const bi = fromEnd ? b.length - 1 - length : length;
    if (a[ai] !== b[bi]) break;
    length += 1;
  }
  return length;
};

describe('计算机基础新增面试题', () => {
  it('固定提供 25 道独立题目', () => {
    expect(FUNDAMENTALS_ADDITIONAL_SEEDS).toHaveLength(25);
    expect(new Set(FUNDAMENTALS_ADDITIONAL_SEEDS.map((item) => item.id)).size).toBe(25);
    expect(new Set(FUNDAMENTALS_ADDITIONAL_SEEDS.map((item) => normalize(item.question))).size).toBe(25);
    expect(new Set(FUNDAMENTALS_ADDITIONAL_SEEDS.map((item) => normalize(item.referenceAnswer))).size).toBe(25);
  });

  it('每道题都有完整合法的学习内容', () => {
    for (const item of FUNDAMENTALS_ADDITIONAL_SEEDS) {
      expect(item.primaryRole, `${item.id} 的主岗位`).toBe('fundamentals');
      expect(item.roles, `${item.id} 的岗位`).toContain('fundamentals');
      expect(item.category.trim(), `${item.id} 的分类`).not.toBe('');
      expect(ALLOWED_FORMATS.has(item.format), `${item.id} 的题型`).toBe(true);
      expect(ALLOWED_DIFFICULTIES.has(item.difficulty), `${item.id} 的难度`).toBe(true);
      expect(item.tags.length, `${item.id} 的标签`).toBeGreaterThanOrEqual(3);
      expect(item.keyPoints.length, `${item.id} 的要点`).toBeGreaterThanOrEqual(3);
      expect(new Set(item.keyPoints.map(normalize)).size, `${item.id} 的要点重复`).toBe(item.keyPoints.length);
      expect(item.keyPoints.every((point) => normalize(point).length >= 4), `${item.id} 的要点过短`).toBe(true);
      expect(item.referenceAnswer.match(/\p{Script=Han}/gu)?.length ?? 0, `${item.id} 的答案汉字数`).toBeGreaterThanOrEqual(80);
      expect(item.followUps.length, `${item.id} 的追问`).toBeGreaterThanOrEqual(1);
      expect(item.followUps.every((followUp) => normalize(followUp).length >= 8), `${item.id} 的追问过短`).toBe(true);
      expect(FORBIDDEN_PLACEHOLDERS.test(JSON.stringify(item)), `${item.id} 含未完成标记`).toBe(false);
    }
  });

  it('题面之间不重复或高度雷同', () => {
    for (let left = 0; left < FUNDAMENTALS_ADDITIONAL_SEEDS.length; left += 1) {
      for (let right = left + 1; right < FUNDAMENTALS_ADDITIONAL_SEEDS.length; right += 1) {
        const item = FUNDAMENTALS_ADDITIONAL_SEEDS[left];
        const other = FUNDAMENTALS_ADDITIONAL_SEEDS[right];
        expect(normalize(item.question), `${item.id} 与 ${other.id} 题面重复`).not.toBe(normalize(other.question));
        expect(diceSimilarity(item.question, other.question), `${item.id} 与 ${other.id} 题面雷同`).toBeLessThan(0.82);
      }
    }
  });

  it('答案不复用完整长句或长前后缀', () => {
    const sentenceOwners = new Map<string, string>();

    for (const item of FUNDAMENTALS_ADDITIONAL_SEEDS) {
      for (const sentence of item.referenceAnswer.split(/[。！？；]/u).map(normalize)) {
        if ((sentence.match(/\p{Script=Han}/gu)?.length ?? 0) < 18) continue;
        const previous = sentenceOwners.get(sentence);
        expect(previous, `${item.id} 复用了 ${previous} 的长句`).toBeUndefined();
        sentenceOwners.set(sentence, item.id);
      }
    }

    for (let left = 0; left < FUNDAMENTALS_ADDITIONAL_SEEDS.length; left += 1) {
      const item = FUNDAMENTALS_ADDITIONAL_SEEDS[left];
      const comparisons = FUNDAMENTALS_ADDITIONAL_SEEDS.slice(left + 1);
      for (const other of comparisons) {
        expect(commonEdgeLength(item.referenceAnswer, other.referenceAnswer), `${item.id} 与 ${other.id} 共享长前缀`).toBeLessThan(20);
        expect(commonEdgeLength(item.referenceAnswer, other.referenceAnswer, true), `${item.id} 与 ${other.id} 共享长后缀`).toBeLessThan(20);
      }
    }
  });
});
