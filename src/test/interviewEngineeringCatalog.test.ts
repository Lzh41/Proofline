import { describe, expect, it } from 'vitest';
import {
  buildEngineeringCatalogId,
  ENGINEERING_INTERVIEW_ANSWER_CORES,
  ENGINEERING_INTERVIEW_CATALOG,
} from '../data/interviews/engineeringCatalog';

const EXPECTED_ROLE_COUNTS: Record<string, number> = {
  backend: 50,
  frontend: 50,
  client: 50,
  'data-engineering': 50,
  'test-development': 50,
  'sre-devops': 50,
  security: 50,
  embedded: 50,
  fundamentals: 60,
};

const ALLOWED_FORMATS = new Set(['knowledge', 'scenario', 'system-design', 'project']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const FORBIDDEN_PLACEHOLDERS = /TODO|待补充|占位|省略号|\.\.\.|…/i;

const normalize = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('zh-CN')
  .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '');

const bigrams = (value: string) => {
  const normalized = normalize(value);
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
};

const diceSimilarity = (left: string, right: string) => {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let shared = 0;
  leftBigrams.forEach((gram) => { if (rightBigrams.has(gram)) shared += 1; });
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

const trigrams = (value: string) => {
  const normalized = normalize(value);
  return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, index) => normalized.slice(index, index + 3)));
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>) => {
  let intersection = 0;
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  smaller.forEach((gram) => {
    if (larger.has(gram)) intersection += 1;
  });
  return intersection / Math.max(1, left.size + right.size - intersection);
};

const hasQuestion = (pattern: RegExp) => ENGINEERING_INTERVIEW_CATALOG.some((item) => pattern.test(item.question));

const SEMANTIC_DUPLICATE_REGRESSIONS: Array<[RegExp, RegExp]> = [
  [/volatile.*线程安全/u, /volatile.*原子操作/u],
  [/中断服务程序.*环形缓冲/u, /单生产者单消费者环形缓冲/u],
  [/Kubernetes.*liveness.*readiness.*startup/u, /Kubernetes.*健康探针/u],
  [/HPA.*频繁扩缩容/u, /HPA.*扩缩容抖动/u],
  [/消费者驱动契约测试/u, /契约测试失败/u],
  [/参数化查询.*SQL 注入/u, /参数化查询的边界/u],
  [/Android ANR/u, /ANR.*定位/u],
  [/Spark.*数据倾斜/u, /数据分区严重倾斜/u],
  [/小文件/u, /大量小文件/u],
  [/exactly-once/u, /Flink exactly-once/u],
  [/数据质量/u, /数据质量告警/u],
  [/数据血缘/u, /数据血缘图/u],
  [/变异测试.*断言/u, /变异测试分数/u],
  [/属性测试/u, /属性测试怎样/u],
  [/SSRF/u, /SSRF.*防御/u],
  [/PKCE/u, /PKCE.*回调/u],
  [/威胁建模/u, /威胁建模会议/u],
  [/I2C.*恢复/u, /I2C.*总线挂死/u],
  [/DMA.*缓存/u, /DMA.*Cache/u],
  [/Bootloader/u, /Bootloader.*恢复/u],
  [/看门狗/u, /看门狗.*误复位/u],
  [/优先级反转/u, /实时任务.*优先级反转/u],
];

describe('工程岗位面试题目录', () => {
  it('至少包含 450 道题，且九个主岗位均不少于 50 道', () => {
    expect(ENGINEERING_INTERVIEW_CATALOG.length).toBeGreaterThanOrEqual(450);

    const actualCounts = Object.fromEntries(
      Object.keys(EXPECTED_ROLE_COUNTS).map((role) => [
        role,
        ENGINEERING_INTERVIEW_CATALOG.filter((item) => item.primaryRole === role).length,
      ]),
    );

    expect(actualCounts).toEqual(EXPECTED_ROLE_COUNTS);
    expect(new Set(ENGINEERING_INTERVIEW_CATALOG.map((item) => item.primaryRole))).toEqual(
      new Set(Object.keys(EXPECTED_ROLE_COUNTS)),
    );
  });

  it('稳定 ID 由岗位和题面决定，不依赖数组位置', () => {
    const question = '插入排序例题用于验证稳定 ID';

    expect(buildEngineeringCatalogId('backend', question, 1)).toBe(buildEngineeringCatalogId('backend', question, 99));
    expect(buildEngineeringCatalogId('backend', question, 1)).not.toBe(buildEngineeringCatalogId('frontend', question, 1));
    expect(buildEngineeringCatalogId('backend', question, 1)).toMatch(/^engineering-backend-[a-z0-9]+$/u);
  });

  it('ID、题目和参考答案分别唯一', () => {
    const size = ENGINEERING_INTERVIEW_CATALOG.length;
    expect(new Set(ENGINEERING_INTERVIEW_CATALOG.map((item) => item.id)).size).toBe(size);
    expect(new Set(ENGINEERING_INTERVIEW_CATALOG.map((item) => normalize(item.question))).size).toBe(size);
    expect(new Set(ENGINEERING_INTERVIEW_CATALOG.map((item) => normalize(item.referenceAnswer))).size).toBe(size);
  });

  it('每道题都具有完整、合法且可检索的元数据', () => {
    for (const item of ENGINEERING_INTERVIEW_CATALOG) {
      expect(item.id.trim(), `${item.id} 的 id`).not.toBe('');
      expect(item.question.trim(), `${item.id} 的 question`).not.toBe('');
      expect(item.primaryRole.trim(), `${item.id} 的 primaryRole`).not.toBe('');
      expect(item.category.trim(), `${item.id} 的 category`).not.toBe('');
      expect(item.roles.length, `${item.id} 的 roles`).toBeGreaterThanOrEqual(1);
      expect(item.roles.every((role) => role.trim().length > 0), `${item.id} 的 roles`).toBe(true);
      expect(item.roles, `${item.id} 的 roles`).toContain(item.primaryRole);
      expect(ALLOWED_FORMATS.has(item.format), `${item.id} 的 format`).toBe(true);
      expect(ALLOWED_DIFFICULTIES.has(item.difficulty), `${item.id} 的 difficulty`).toBe(true);
      expect(item.tags.length, `${item.id} 的 tags`).toBeGreaterThanOrEqual(1);
      expect(item.tags.every((tag) => tag.trim().length > 0), `${item.id} 的 tags`).toBe(true);
    }
  });

  it('每道题都提供至少三个具体要点、长答案和具体追问', () => {
    for (const item of ENGINEERING_INTERVIEW_CATALOG) {
      expect(item.keyPoints.length, `${item.id} 的 keyPoints`).toBeGreaterThanOrEqual(3);
      expect(
        item.keyPoints.every((point) => point.trim().length >= 4),
        `${item.id} 的 keyPoints 必须具体`,
      ).toBe(true);
      expect(item.referenceAnswer.trim().length, `${item.id} 的 referenceAnswer`).toBeGreaterThanOrEqual(80);
      expect(
        item.referenceAnswer.match(/\p{Script=Han}/gu)?.length ?? 0,
        `${item.id} 的独立 answerCore 中文字数`,
      ).toBeGreaterThanOrEqual(80);
      expect(item.followUps.length, `${item.id} 的 followUps`).toBeGreaterThanOrEqual(1);
      expect(
        item.followUps.every((followUp) => followUp.trim().length >= 8),
        `${item.id} 的 followUps 必须具体`,
      ).toBe(true);
    }
  });

  it('目录构建前每个种子的独立 answerCore 均不少于 80 个汉字', () => {
    expect(ENGINEERING_INTERVIEW_ANSWER_CORES.length).toBeGreaterThanOrEqual(450);
    for (const [index, answerCore] of ENGINEERING_INTERVIEW_ANSWER_CORES.entries()) {
      expect(
        answerCore.match(/\p{Script=Han}/gu)?.length ?? 0,
        `第 ${index + 1} 个种子的独立 answerCore 中文字数`,
      ).toBeGreaterThanOrEqual(80);
    }
  });

  it('题面没有高度雷同的改词版本', () => {
    const items = ENGINEERING_INTERVIEW_CATALOG;
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        expect(
          diceSimilarity(items[left].question, items[right].question),
          `${items[left].id} 与 ${items[right].id} 的题面高度雷同`,
        ).toBeLessThan(0.82);
      }
    }
  }, 20_000);

  it('已发现的基础题与补充题语义重复不再同时出现', () => {
    const violations = SEMANTIC_DUPLICATE_REGRESSIONS
      .filter(([basePattern, duplicatePattern]) => hasQuestion(basePattern) && hasQuestion(duplicatePattern))
      .map(([, duplicatePattern]) => duplicatePattern.source);

    expect(violations).toEqual([]);
  });

  it('追问和答案整体相似度没有明显复用', () => {
    const followUps = ENGINEERING_INTERVIEW_CATALOG.flatMap((item) => item.followUps.map((followUp) => [item.id, normalize(followUp)] as const));
    const followUpOwners = new Map<string, string>();
    const duplicateFollowUps: string[] = [];
    for (const [id, followUp] of followUps) {
      const owner = followUpOwners.get(followUp);
      if (owner) duplicateFollowUps.push(`${owner} / ${id}`);
      else followUpOwners.set(followUp, id);
    }
    expect(duplicateFollowUps).toEqual([]);

    const answerTrigrams = ENGINEERING_INTERVIEW_CATALOG.map((item) => trigrams(item.referenceAnswer));
    const answerSimilarityViolations: string[] = [];
    for (let left = 0; left < ENGINEERING_INTERVIEW_CATALOG.length; left += 1) {
      for (let right = left + 1; right < ENGINEERING_INTERVIEW_CATALOG.length; right += 1) {
        const similarity = jaccardSimilarity(answerTrigrams[left], answerTrigrams[right]);
        if (similarity >= 0.52) {
          answerSimilarityViolations.push(`${ENGINEERING_INTERVIEW_CATALOG[left].id} / ${ENGINEERING_INTERVIEW_CATALOG[right].id}: ${similarity.toFixed(3)}`);
        }
      }
    }
    expect(answerSimilarityViolations).toEqual([]);
  }, 20_000);

  it('答案没有共享长前后缀或复用完整长句', () => {
    const sentenceOwners = new Map<string, string>();
    for (const item of ENGINEERING_INTERVIEW_CATALOG) {
      const sentences = item.referenceAnswer
        .split(/[。！？；]/u)
        .map(normalize)
        .filter((sentence) => (sentence.match(/\p{Script=Han}/gu)?.length ?? 0) >= 18);
      for (const sentence of sentences) {
        expect(sentenceOwners.get(sentence), `${item.id} 复用了 ${sentenceOwners.get(sentence)} 的长句`).toBeUndefined();
        sentenceOwners.set(sentence, item.id);
      }
    }

    const items = ENGINEERING_INTERVIEW_CATALOG;
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        expect(commonEdgeLength(items[left].referenceAnswer, items[right].referenceAnswer), `${items[left].id} 与 ${items[right].id} 共享长前缀`).toBeLessThan(20);
        expect(commonEdgeLength(items[left].referenceAnswer, items[right].referenceAnswer, true), `${items[left].id} 与 ${items[right].id} 共享长后缀`).toBeLessThan(20);
      }
    }
  }, 20_000);

  it('任何内容都不包含未完成标记或省略写法', () => {
    for (const item of ENGINEERING_INTERVIEW_CATALOG) {
      expect(
        FORBIDDEN_PLACEHOLDERS.test(JSON.stringify(item)),
        `${item.id} 包含未完成标记`,
      ).toBe(false);
    }
  });
});
