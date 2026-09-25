import { describe, expect, it } from 'vitest';
import { VOCABULARY_CATALOG, VOCABULARY_CATALOG_FULL } from '../data/vocabularyCatalog';
import { PUBLIC_VOCABULARY_RECORDS, PUBLIC_VOCABULARY_STATS } from '../data/vocabularyPublicCatalog';
import { ECDICT_EXAM_RECORDS, ECDICT_EXAM_SOURCE } from '../data/vocabularyExamRecords';
import {
  buildVocabularySession,
  createInitialVocabularyProgress,
  filterVocabularyProgressByScope,
  filterVocabularyWords,
  isVocabularySpellingCorrect,
  reviewVocabularyWord,
  selectVocabularyPlanWords,
  type VocabularyDifficulty,
  vocabularyProgressKey,
  vocabularyProgressScope,
  VOCABULARY_BASE_INTERVALS,
  VOCABULARY_RETRY_MINUTES,
} from '../lib/vocabulary';

describe('英语词库', () => {
  it('词汇进度作用域兼容旧快照并保持方向隔离', () => {
    const legacy = createInitialVocabularyProgress('achieve', 100);
    const cet6 = { ...legacy, scope: 'cet6' as const };
    expect(vocabularyProgressScope(legacy)).toBe('all');
    expect(vocabularyProgressScope(cet6)).toBe('cet6');
    expect(vocabularyProgressKey('cet6', 'achieve')).toBe('cet6:achieve');
    expect(filterVocabularyProgressByScope([legacy, cet6], 'cet6')).toEqual([cet6]);
    expect(filterVocabularyProgressByScope([legacy, cet6], 'all')).toEqual([legacy]);
  });

  it('包含 100 个内容完整、按 A1-C1 均衡分布且 ID 唯一的词条', () => {
    const ids = VOCABULARY_CATALOG.map((word) => word.id);
    expect(VOCABULARY_CATALOG).toHaveLength(100);
    expect(new Set(ids).size).toBe(ids.length);
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1'] as const) {
      expect(VOCABULARY_CATALOG.filter((word) => word.level === level)).toHaveLength(20);
    }
    expect(VOCABULARY_CATALOG.every((word) => (
      word.meaning && word.example && word.exampleTranslation && word.mnemonic && word.family.length > 0
      && word.collocations.length > 0 && word.source
    ))).toBe(true);
  });

  it('按难度筛选词条', () => {
    expect(filterVocabularyWords(VOCABULARY_CATALOG, 'advanced')).toHaveLength(20);
    expect(filterVocabularyWords(VOCABULARY_CATALOG, 'all')).toHaveLength(VOCABULARY_CATALOG.length);
  });

  it('内置扩充词库提供考试方向标签并可筛选', () => {
    expect(VOCABULARY_CATALOG_FULL.length).toBeGreaterThan(250);
    expect(new Set(VOCABULARY_CATALOG_FULL.map((word) => word.id)).size).toBe(VOCABULARY_CATALOG_FULL.length);
    for (const exam of ['cet4', 'cet6', 'toefl', 'ielts'] as const) {
      const words = filterVocabularyWords(VOCABULARY_CATALOG_FULL, exam);
      expect(words.length).toBeGreaterThan(20);
      expect(words.some((word) => word.examTags?.includes(exam))).toBe(true);
    }
  });

  it('公开词库已接入运行时，中文义项和各方向筛选有真实覆盖', () => {
    expect(PUBLIC_VOCABULARY_RECORDS).toHaveLength(3791);
    expect(PUBLIC_VOCABULARY_STATS.withChineseMeaning).toBe(3791);
    expect(PUBLIC_VOCABULARY_STATS.withEnglishDefinition).toBeGreaterThan(3700);
    expect(VOCABULARY_CATALOG_FULL.length).toBeGreaterThan(3800);
    expect(PUBLIC_VOCABULARY_RECORDS.every((word) => word.meaningZh && word.sources.includes('ecdict'))).toBe(true);
    expect(new Set(VOCABULARY_CATALOG_FULL.map((word) => word.word.toLocaleLowerCase('en-US'))).size).toBe(VOCABULARY_CATALOG_FULL.length);
    for (const exam of ['cet4', 'cet6', 'toefl', 'ielts', 'postgrad'] as const) {
      expect(filterVocabularyWords(VOCABULARY_CATALOG_FULL, exam).length).toBeGreaterThan(500);
    }
  });

  it('考试方向只使用明确来源标签，不从 CEFR 难度推断归属', () => {
    const untaggedAdvanced = { ...VOCABULARY_CATALOG[0], level: 'C1' as const, examTags: undefined };
    expect(filterVocabularyWords([untaggedAdvanced], 'sat')).toEqual([]);
    expect(filterVocabularyWords([untaggedAdvanced], 'cet4')).toEqual([]);

    for (const record of PUBLIC_VOCABULARY_RECORDS) {
      const word = VOCABULARY_CATALOG_FULL.find((item) => item.word === record.word);
      if (!word || record.examTags?.length || record.sources.includes('nawl') || record.sources.includes('ngsl')) continue;
      for (const exam of ['cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat'] as const) {
        expect(filterVocabularyWords([word], exam)).toEqual([]);
      }
    }
  });

  it('按 ECDICT 明确考试标签扩展词库，并为每个收录词提供可辨认的 IPA', () => {
    expect(VOCABULARY_CATALOG_FULL).toHaveLength(11158);
    expect(ECDICT_EXAM_SOURCE.recordCount).toBe(10515);
    expect(ECDICT_EXAM_SOURCE.directionCounts).toMatchObject({
      cet4: 3834,
      cet6: 5385,
      toefl: 6861,
      ielts: 5000,
      postgrad: 4793,
    });
    expect(ECDICT_EXAM_RECORDS.every((record) => (
      record.meaning && /[\u3400-\u9fff]/u.test(record.meaning)
      && record.definitionEn
      && /^\/[^/\r\n]+\/(?:,\s*\/[^/\r\n]+\/)*$/u.test(record.phonetic)
      && record.phonetic.replace(/[\/ ,]/g, '').toLocaleLowerCase('en-US') !== record.word
    ))).toBe(true);

    for (const [exam, count] of Object.entries(ECDICT_EXAM_SOURCE.directionCounts)) {
      expect(filterVocabularyWords(VOCABULARY_CATALOG_FULL, exam as VocabularyDifficulty).length).toBeGreaterThanOrEqual(count);
    }
    expect(Object.fromEntries((['cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat'] as const).map((exam) => [
      exam,
      filterVocabularyWords(VOCABULARY_CATALOG_FULL, exam).length,
    ]))).toEqual({ cet4: 3835, cet6: 5386, toefl: 7240, ielts: 5499, postgrad: 5223, sat: 3780 });
  });

  it('公开词库的音标不为空且不会直接重复单词答案', () => {
    expect(PUBLIC_VOCABULARY_STATS.withPhonetic).toBe(3791);
    expect(PUBLIC_VOCABULARY_RECORDS.every((word) => word.sources.includes('ipaDict'))).toBe(true);
    expect(PUBLIC_VOCABULARY_RECORDS.every((word) => word.phonetic.startsWith('/') && word.phonetic.endsWith('/'))).toBe(true);
    expect(VOCABULARY_CATALOG_FULL.find((word) => word.word === 'widespread')?.phonetic).toBe('/ˌwaɪdˈsprɛd/');
    expect(PUBLIC_VOCABULARY_RECORDS.some((word) => word.word.toLocaleLowerCase('en-US') === word.phonetic.replace(/[\/ ,]/g, '').toLocaleLowerCase('en-US'))).toBe(false);
    expect(VOCABULARY_CATALOG_FULL.every((word) => (
      word.phonetic.trim().length > 0
      && /^\/[^/\r\n]+\/(?:,\s*\/[^/\r\n]+\/)*$/u.test(word.phonetic)
      && word.phonetic.replace(/[\/ ,]/g, '').toLocaleLowerCase('en-US') !== word.word.toLocaleLowerCase('en-US')
    ))).toBe(true);
  });

  it('重新排程时保留已完成和待学词，并在排除预留词后补足每日目标', () => {
    const catalog = VOCABULARY_CATALOG.slice(0, 10);
    const completed = catalog[0];
    const pending = catalog[1];
    const progress = createInitialVocabularyProgress(completed.id, 100);
    progress.state = 'learning';
    const selection = selectVocabularyPlanWords(
      catalog,
      { [completed.id]: progress },
      'all',
      5,
      [completed.id, pending.id],
      [],
    );

    expect(selection.completedWordIds).toEqual([completed.id]);
    expect(selection.taskWordIds).toHaveLength(5);
    expect(selection.taskWordIds).toContain(pending.id);
    expect(new Set(selection.taskWordIds).size).toBe(selection.taskWordIds.length);
  });

  it('重新生成计划时不会把其他难度已完成的词带进当前方向', () => {
    const catalog = VOCABULARY_CATALOG;
    const advanced = catalog.find((word) => word.difficulty === 'advanced')!;
    const selection = selectVocabularyPlanWords(
      catalog,
      { [advanced.id]: { ...createInitialVocabularyProgress(advanced.id), state: 'learning' } },
      'beginner',
      1,
      [advanced.id],
      [advanced.id],
    );

    expect(selection.taskWordIds).not.toContain(advanced.id);
    expect(selection.completedWordIds).not.toContain(advanced.id);
    expect(selection.taskWordIds).toHaveLength(1);
  });
});

describe('主动回忆复习排程', () => {
  const now = Date.UTC(2026, 0, 1);

  it('忘记时安排十分钟后再回忆，并累计遗忘次数', () => {
    const initial = createInitialVocabularyProgress('achieve', now);
    const retried = reviewVocabularyWord(initial, 'again', now);
    expect(retried.dueAt).toBe(now + VOCABULARY_RETRY_MINUTES * 60_000);
    expect(retried.state).toBe('learning');
    expect(retried.lapses).toBe(1);
    expect(retried.repetitions).toBe(0);
  });

  it('拼写回忆忽略大小写和外围空白，但不放过拼错字母', () => {
    expect(isVocabularySpellingCorrect('  ACHIEVE  ', 'achieve')).toBe(true);
    expect(isVocabularySpellingCorrect('achive', 'achieve')).toBe(false);
  });

  it('成功回忆按递增间隔排程，五次后标记掌握', () => {
    let progress = createInitialVocabularyProgress('achieve', now);
    const intervals: number[] = [];
    for (let index = 0; index < VOCABULARY_BASE_INTERVALS.length; index += 1) {
      progress = reviewVocabularyWord(progress, 'good', now);
      intervals.push(progress.intervalDays);
    }
    expect(intervals).toEqual([1, 3, 7, 14, 30]);
    expect(progress.state).toBe('mastered');
    expect(progress.dueAt).toBe(now + 30 * 24 * 60 * 60_000);
  });

  it('困难降低易度系数，轻松提高易度系数', () => {
    const initial = createInitialVocabularyProgress('achieve', now);
    expect(reviewVocabularyWord(initial, 'hard', now).easeFactor).toBeLessThan(initial.easeFactor);
    expect(reviewVocabularyWord(initial, 'easy', now).easeFactor).toBeGreaterThan(initial.easeFactor);
  });

  it('按连续成功次数从新词进入学习、复习和掌握状态', () => {
    const initial = createInitialVocabularyProgress('achieve', now);
    const first = reviewVocabularyWord(initial, 'good', now);
    const second = reviewVocabularyWord(first, 'good', now);
    expect(first.state).toBe('learning');
    expect(second.state).toBe('review');
    let progress = second;
    while (progress.streak < VOCABULARY_BASE_INTERVALS.length) {
      progress = reviewVocabularyWord(progress, 'good', now);
    }
    expect(progress.state).toBe('mastered');
  });

  it('学习计划先加入到期复习，再加入指定难度的新词并限制每日数量', () => {
    const overdue = {
      ...createInitialVocabularyProgress('ambiguous', now - 20 * 60_000),
      state: 'review' as const,
      dueAt: now - 1,
    };
    const session = buildVocabularySession({
      catalog: VOCABULARY_CATALOG,
      progressByWordId: { ambiguous: overdue },
      newWordsPerDay: 2,
      difficulty: 'advanced',
      now,
    });

    expect(session.reviewWords.map((word) => word.id)).toEqual(['ambiguous']);
    expect(session.newWords).toHaveLength(2);
    expect(session.newWords.every((word) => word.difficulty === 'advanced')).toBe(true);
    expect(session.totalCount).toBe(3);
  });

  it('复习难度选项不会把已掌握词永久排除', () => {
    let progress = createInitialVocabularyProgress('achieve', now);
    for (let index = 0; index < VOCABULARY_BASE_INTERVALS.length; index += 1) {
      progress = reviewVocabularyWord(progress, 'good', now);
    }
    const session = buildVocabularySession({
      catalog: VOCABULARY_CATALOG,
      progressByWordId: { achieve: { ...progress, dueAt: now - 1 } },
      newWordsPerDay: 0,
      now,
    });
    expect(session.reviewWords.map((word) => word.id)).toContain('achieve');
  });
});
