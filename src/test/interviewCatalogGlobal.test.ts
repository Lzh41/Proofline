import { describe, expect, it } from 'vitest';
import {
  INTERVIEW_CATALOG,
  INTERVIEW_CATALOG_VERSION,
  MINIMUM_ROLE_COVERAGE,
} from '../data/interviewCatalog';
import { AI_INTERVIEW_CATALOG } from '../data/interviews/aiCatalog';
import { ENGINEERING_INTERVIEW_CATALOG } from '../data/interviews/engineeringCatalog';
import { SPECIALIZED_INTERVIEW_CATALOG } from '../data/interviews/specializedCatalog';
import {
  INTERVIEW_CATALOG_VERSION as LIBRARY_CATALOG_VERSION,
  INTERVIEW_ROLES,
} from '../lib/interviews';

const REQUIRED_ROLES = [
  'llm-app',
  'nlp',
  'rag-agent',
  'multimodal',
  'ai-platform',
  'recommendation-search',
  'backend',
  'frontend',
  'client',
  'data-engineering',
  'test-development',
  'sre-devops',
  'security',
  'embedded',
  'fundamentals',
  'ai-research-training',
  'computer-vision',
  'data-science-quant',
  'database-middleware',
  'game-graphics',
  'solution-architect',
] as const;

const normalize = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('zh-CN')
  .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '');

const countChineseCharacters = (value: string) => value.match(/\p{Script=Han}/gu)?.length ?? 0;

const AI_CATALOG_IDS = new Set(AI_INTERVIEW_CATALOG.map((item) => item.id));
const ENGINEERING_CATALOG_IDS = new Set(ENGINEERING_INTERVIEW_CATALOG.map((item) => item.id));
const SPECIALIZED_CATALOG_IDS = new Set(SPECIALIZED_INTERVIEW_CATALOG.map((item) => item.id));

const catalogGroup = (id: string) => {
  if (AI_CATALOG_IDS.has(id)) return 'ai';
  if (ENGINEERING_CATALOG_IDS.has(id)) return 'engineering';
  if (SPECIALIZED_CATALOG_IDS.has(id)) return 'specialized';
  return 'unknown';
};

const trigrams = (value: string) => {
  const normalized = normalize(value);
  return new Set(Array.from(
    { length: Math.max(0, normalized.length - 2) },
    (_, index) => normalized.slice(index, index + 3),
  ));
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>) => {
  let intersection = 0;
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  smaller.forEach((gram) => {
    if (larger.has(gram)) intersection += 1;
  });
  return intersection / Math.max(1, left.size + right.size - intersection);
};

const commonNormalizedEdgeLength = (left: string, right: string, fromEnd = false) => {
  let length = 0;
  while (length < left.length && length < right.length) {
    const leftIndex = fromEnd ? left.length - 1 - length : length;
    const rightIndex = fromEnd ? right.length - 1 - length : length;
    if (left[leftIndex] !== right[rightIndex]) break;
    length += 1;
  }
  return length;
};

describe('企业面试题全局目录', () => {
  it('目录版本为 2，并覆盖 21 个方向且每个方向至少 50 道', () => {
    expect(INTERVIEW_CATALOG_VERSION).toBe(2);
    expect(LIBRARY_CATALOG_VERSION).toBe(2);
    expect(INTERVIEW_CATALOG.length).toBeGreaterThanOrEqual(REQUIRED_ROLES.length * 50);
    expect(new Set(Object.keys(MINIMUM_ROLE_COVERAGE))).toEqual(new Set(REQUIRED_ROLES));
    expect(new Set(INTERVIEW_ROLES.map((role) => role.id))).toEqual(new Set(REQUIRED_ROLES));

    for (const role of REQUIRED_ROLES) {
      expect(MINIMUM_ROLE_COVERAGE[role], `${role} 的最低题量契约`).toBe(50);
      expect(
        INTERVIEW_CATALOG.filter((item) => item.primaryRole === role).length,
        `${role} 题量不足`,
      ).toBeGreaterThanOrEqual(50);
    }
  });

  it('全局 ID、归一化题面和归一化答案均唯一', () => {
    const ids = INTERVIEW_CATALOG.map((item) => item.id);
    const questions = INTERVIEW_CATALOG.map((item) => normalize(item.question));
    const answers = INTERVIEW_CATALOG.map((item) => normalize(item.referenceAnswer));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(questions).size).toBe(questions.length);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('每道题均包含完整岗位元数据、至少三个独立要点、长答案和追问', () => {
    const knownRoles = new Set(REQUIRED_ROLES);
    for (const item of INTERVIEW_CATALOG) {
      expect(knownRoles.has(item.primaryRole as (typeof REQUIRED_ROLES)[number]), `${item.id} 岗位未知`).toBe(true);
      expect(item.roles, `${item.id} 未声明主岗位`).toContain(item.primaryRole);
      expect(item.category.trim(), `${item.id} 缺少分类`).not.toBe('');
      expect(item.tags.length, `${item.id} 缺少标签`).toBeGreaterThan(0);

      const normalizedPoints = item.keyPoints.map(normalize);
      expect(item.keyPoints.length, `${item.id} 要点不足`).toBeGreaterThanOrEqual(3);
      expect(new Set(normalizedPoints).size, `${item.id} 要点重复`).toBe(item.keyPoints.length);
      expect(normalizedPoints.every((point) => point.length >= 4), `${item.id} 要点过短`).toBe(true);
      expect(countChineseCharacters(item.referenceAnswer), `${item.id} 答案中文汉字不足`).toBeGreaterThanOrEqual(80);
      expect(item.followUps.length, `${item.id} 缺少追问`).toBeGreaterThanOrEqual(1);
      expect(item.followUps.every((followUp) => normalize(followUp).length >= 8), `${item.id} 追问过短`).toBe(true);
    }
  });

  it('跨题库答案不复用长前后缀，也不存在高度相似的三元组结构', () => {
    const answers = INTERVIEW_CATALOG.map((item) => normalize(item.referenceAnswer));
    const answerTrigrams = INTERVIEW_CATALOG.map((item) => trigrams(item.referenceAnswer));
    const violations: string[] = [];

    for (let left = 0; left < INTERVIEW_CATALOG.length; left += 1) {
      for (let right = left + 1; right < INTERVIEW_CATALOG.length; right += 1) {
        if (catalogGroup(INTERVIEW_CATALOG[left].id) === catalogGroup(INTERVIEW_CATALOG[right].id)) continue;

        const pair = `${INTERVIEW_CATALOG[left].id} / ${INTERVIEW_CATALOG[right].id}`;
        if (commonNormalizedEdgeLength(answers[left], answers[right]) >= 24) {
          violations.push(`${pair} 共享长前缀`);
        }
        if (commonNormalizedEdgeLength(answers[left], answers[right], true) >= 24) {
          violations.push(`${pair} 共享长后缀`);
        }
        if (jaccardSimilarity(answerTrigrams[left], answerTrigrams[right]) >= 0.58) {
          violations.push(`${pair} 答案高度雷同`);
        }
      }
    }

    expect(violations).toEqual([]);
  }, 15_000);
});
