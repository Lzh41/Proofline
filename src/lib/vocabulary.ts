export type VocabularyLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
/** 词库筛选既支持 CEFR 难度，也支持考试方向。 */
export type VocabularyDifficulty =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'cet4'
  | 'cet6'
  | 'toefl'
  | 'ielts'
  | 'postgrad'
  | 'sat';
export type VocabularyPartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'conjunction'
  | 'preposition'
  | 'pronoun'
  | 'other';
export type VocabularyGrade = 'again' | 'hard' | 'good' | 'easy';
export type VocabularyReviewDirection = 'word-to-meaning' | 'meaning-to-word';
export type VocabularyProgressState = 'new' | 'learning' | 'review' | 'mastered';

export interface VocabularyWord {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: VocabularyPartOfSpeech;
  difficulty: VocabularyDifficulty;
  meaning: string;
  definitionEn: string;
  example: string;
  exampleTranslation: string;
  collocations: string[];
  family: string[];
  mnemonic: string;
  source: string;
  level: VocabularyLevel;
  /** 同一词可以属于多个考试方向；旧快照没有该字段时按 CEFR 补齐。 */
  examTags?: Array<Exclude<VocabularyDifficulty, 'beginner' | 'intermediate' | 'advanced'>>;
}

/** The schedule state is stored by word id in the vocabulary repository. */
export interface VocabularyProgress {
  wordId: string;
  dueAt: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  state: VocabularyProgressState;
  streak: number;
  lastReviewedAt?: number;
  lastRating?: VocabularyGrade;
}

export interface VocabularyReview {
  id: string;
  wordId: string;
  reviewedAt: number;
  direction: VocabularyReviewDirection;
  rating: VocabularyGrade;
  response: string;
  correct: boolean;
  durationMs?: number;
}

export interface VocabularyDifficultyOption {
  value: VocabularyDifficulty;
  label: string;
  level?: VocabularyLevel;
}

export const VOCABULARY_DIFFICULTY_OPTIONS: readonly VocabularyDifficultyOption[] = [
  { value: 'beginner', label: '入门（A1-A2）', level: 'A1' },
  { value: 'intermediate', label: '进阶（B1-B2）', level: 'B1' },
  { value: 'advanced', label: '高阶（C1-C2）', level: 'C1' },
  { value: 'cet4', label: '四级', level: 'B1' },
  { value: 'cet6', label: '六级', level: 'B2' },
  { value: 'toefl', label: '托福', level: 'B2' },
  { value: 'ielts', label: '雅思', level: 'B2' },
  { value: 'postgrad', label: '考研', level: 'C1' },
  { value: 'sat', label: 'SAT', level: 'C1' },
];

export const VOCABULARY_RETRY_MINUTES = 10;
export const VOCABULARY_BASE_INTERVALS = [1, 3, 7, 14, 30] as const;
export const VOCABULARY_DEFAULT_EASE = 2.5;

const MIN_EASE = 1.3;
const MAX_EASE = 3;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface VocabularySessionOptions {
  catalog: readonly VocabularyWord[];
  progressByWordId: Readonly<Record<string, VocabularyProgress>>;
  newWordsPerDay: number;
  difficulty?: VocabularyDifficulty | 'all';
  reviewLimit?: number;
  now?: number;
}

export interface VocabularySession {
  reviewWords: VocabularyWord[];
  newWords: VocabularyWord[];
  totalCount: number;
}

export function createInitialVocabularyProgress(wordId: string, now = Date.now()): VocabularyProgress {
  return {
    wordId,
    state: 'new',
    dueAt: now,
    intervalDays: 0,
    easeFactor: VOCABULARY_DEFAULT_EASE,
    repetitions: 0,
    lapses: 0,
    streak: 0,
  };
}

export function isVocabularySpellingCorrect(response: string, expectedWord: string): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z'-]/g, '');
  return normalize(response) === normalize(expectedWord);
}

/** Rates active recall and returns the next persisted schedule state. */
export function reviewVocabularyWord(
  progress: VocabularyProgress,
  rating: VocabularyGrade,
  now = Date.now(),
): VocabularyProgress {
  const easeFactor = normalizeEase(progress.easeFactor);
  if (rating === 'again') {
    return {
      ...progress,
      state: 'learning',
      dueAt: now + VOCABULARY_RETRY_MINUTES * MINUTE_MS,
      intervalDays: 0,
      easeFactor: Math.max(MIN_EASE, easeFactor - 0.2),
      repetitions: 0,
      lapses: progress.lapses + 1,
      streak: 0,
      lastReviewedAt: now,
      lastRating: rating,
    };
  }

  const nextStreak = progress.streak + 1;
  let nextEase = easeFactor;
  let intervalDays: number;
  if (rating === 'hard') {
    nextEase = Math.max(MIN_EASE, easeFactor - 0.15);
    intervalDays = progress.streak === 0
      ? 1
      : Math.max(1, Math.ceil(positiveOr(progress.intervalDays, 1) * 1.2));
  } else if (rating === 'good') {
    intervalDays = nextStreak <= VOCABULARY_BASE_INTERVALS.length
      ? VOCABULARY_BASE_INTERVALS[nextStreak - 1]
      : Math.max(1, Math.round(positiveOr(progress.intervalDays, 1) * easeFactor));
  } else {
    nextEase = Math.min(MAX_EASE, easeFactor + 0.15);
    intervalDays = progress.streak === 0
      ? 3
      : Math.max(2, Math.ceil(positiveOr(progress.intervalDays, 1) * easeFactor * 1.3));
  }

  return {
    ...progress,
    state: nextStreak >= VOCABULARY_BASE_INTERVALS.length
      ? 'mastered'
      : nextStreak >= 2 ? 'review' : 'learning',
    dueAt: now + intervalDays * DAY_MS,
    intervalDays,
    easeFactor: nextEase,
    repetitions: progress.repetitions + 1,
    streak: nextStreak,
    lastReviewedAt: now,
    lastRating: rating,
  };
}

export function filterVocabularyWords(
  catalog: readonly VocabularyWord[],
  difficulty: VocabularyDifficulty | 'all' = 'all',
): VocabularyWord[] {
  if (difficulty === 'all') return [...catalog];
  if (isExamDifficulty(difficulty)) {
    return catalog.filter((word) => word.examTags?.includes(difficulty) ?? inferExamTags(word.level).includes(difficulty));
  }
  return catalog.filter((word) => word.difficulty === difficulty);
}

export function selectNewVocabularyWords(
  catalog: readonly VocabularyWord[],
  progressByWordId: Readonly<Record<string, VocabularyProgress>>,
  difficulty: VocabularyDifficulty | 'all' = 'all',
  limit = Number.POSITIVE_INFINITY,
): VocabularyWord[] {
  return shuffleVocabularyWords(filterVocabularyWords(catalog, difficulty))
    .filter((word) => progressByWordId[word.id] === undefined || progressByWordId[word.id].state === 'new')
    .slice(0, toNonNegativeInteger(limit));
}

export interface VocabularyPlanSelection {
  taskWordIds: string[];
  completedWordIds: string[];
}

export function selectVocabularyPlanWords(
  catalog: readonly VocabularyWord[],
  progressByWordId: Readonly<Record<string, VocabularyProgress>>,
  difficulty: VocabularyDifficulty | 'all',
  target: number,
  previousTaskWordIds: readonly string[] = [],
  previousCompletedWordIds: readonly string[] = [],
): VocabularyPlanSelection {
  const catalogById = new Map(catalog.map((word) => [word.id, word]));
  const completed = new Set(previousCompletedWordIds.filter((id) => catalogById.has(id)));

  for (const id of previousTaskWordIds) {
    const progress = progressByWordId[id];
    if (progress && progress.state !== 'new' && catalogById.has(id)) completed.add(id);
  }

  const pending = previousTaskWordIds.filter((id) => {
    const word = catalogById.get(id);
    const progress = progressByWordId[id];
    return word !== undefined
      && !completed.has(id)
      && (!progress || progress.state === 'new')
      && filterVocabularyWords([word], difficulty).length > 0;
  });
  const reserved = new Set([...completed, ...pending]);
  const remaining = Math.max(0, toNonNegativeInteger(target) - completed.size - pending.length);
  const availableCatalog = catalog.filter((word) => !reserved.has(word.id));
  const selected = selectNewVocabularyWords(availableCatalog, progressByWordId, difficulty, remaining);

  return {
    taskWordIds: [...completed, ...pending, ...selected.map((word) => word.id)],
    completedWordIds: [...completed],
  };
}

export function selectDueVocabularyWords(
  catalog: readonly VocabularyWord[],
  progressByWordId: Readonly<Record<string, VocabularyProgress>>,
  difficulty: VocabularyDifficulty | 'all' = 'all',
  now = Date.now(),
  limit = Number.POSITIVE_INFINITY,
): VocabularyWord[] {
  const eligibleWords = filterVocabularyWords(catalog, difficulty);
  const eligibleIds = new Set(eligibleWords.map((word) => word.id));
  return Object.values(progressByWordId)
    .filter((progress) => eligibleIds.has(progress.wordId) && progress.state !== 'new' && progress.dueAt <= now)
    .sort((left, right) => left.dueAt - right.dueAt)
    .slice(0, toNonNegativeInteger(limit))
    .map((progress) => eligibleWords.find((word) => word.id === progress.wordId))
    .filter((word): word is VocabularyWord => word !== undefined);
}

/** Due reviews come first; new words are capped by the daily plan. */
export function buildVocabularySession(options: VocabularySessionOptions): VocabularySession {
  const {
    catalog,
    progressByWordId,
    newWordsPerDay,
    difficulty = 'all',
    reviewLimit = Number.POSITIVE_INFINITY,
    now = Date.now(),
  } = options;
  const reviewWords = selectDueVocabularyWords(catalog, progressByWordId, difficulty, now, reviewLimit);
  const newWords = selectNewVocabularyWords(catalog, progressByWordId, difficulty, newWordsPerDay);
  return { reviewWords, newWords, totalCount: reviewWords.length + newWords.length };
}

export function difficultyLabel(difficulty: VocabularyDifficulty | 'all'): string {
  if (difficulty === 'all') return '全部难度';
  return VOCABULARY_DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.label ?? '全部难度';
}

const EXAM_DIFFICULTIES = ['cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat'] as const;

export function isVocabularyDifficulty(value: unknown): value is VocabularyDifficulty {
  return value === 'beginner'
    || value === 'intermediate'
    || value === 'advanced'
    || (typeof value === 'string' && (EXAM_DIFFICULTIES as readonly string[]).includes(value));
}

function isExamDifficulty(value: VocabularyDifficulty): value is typeof EXAM_DIFFICULTIES[number] {
  return (EXAM_DIFFICULTIES as readonly string[]).includes(value);
}

/** 用于新词抽取的 Fisher-Yates 洗牌；到期复习仍由 dueAt 排序保证优先级。 */
function shuffleVocabularyWords(words: VocabularyWord[]): VocabularyWord[] {
  const shuffled = [...words];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function inferExamTags(level: VocabularyLevel): typeof EXAM_DIFFICULTIES[number][] {
  if (level === 'A1' || level === 'A2') return ['cet4', 'ielts'];
  if (level === 'B1') return ['cet4', 'cet6', 'ielts'];
  if (level === 'B2') return ['cet6', 'toefl', 'ielts', 'postgrad'];
  return ['cet6', 'toefl', 'ielts', 'postgrad', 'sat'];
}

function normalizeEase(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_EASE, Math.max(MIN_EASE, value)) : VOCABULARY_DEFAULT_EASE;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toNonNegativeInteger(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
