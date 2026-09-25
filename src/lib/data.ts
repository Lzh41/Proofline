import type { AppDataSnapshot, AppSettings, AppTheme, EditorFontSize } from '../types';
import { VOCABULARY_CATALOG_FULL } from '../data/vocabularyCatalog';
import { isVocabularyDifficulty, type VocabularyReviewDirection, type VocabularyScope, type VocabularySessionCardState, type VocabularySessionState, type VocabularyWord } from './vocabulary';

export const EDITOR_FONT_SIZES: EditorFontSize[] = [14, 16, 18, 20, 22];

export const DEFAULT_SETTINGS: AppSettings = {
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: '',
  hasAiCredential: false,
  defaultLanguage: 'cpp',
  editorFontSize: 16,
  dailyTargetMinutes: 60,
  dailyTargetProblems: 3,
  dailyTargetInterviewQuestions: 2,
  dailyTargetVocabularyWords: 10,
  lastVocabularyDifficulty: undefined,
  vocabularySessions: {},
  interviewCatalogVersion: 0,
  lastSolveProblemId: undefined,
  lastSolveProblemByMode: undefined,
  privacyConfirmed: false,
  theme: 'dark',
};

export function normalizeTheme(value: unknown): AppTheme {
  return value === 'light' || value === 'system' || value === 'dark' ? value : 'dark';
}

export function normalizeEditorFontSize(value: unknown): EditorFontSize {
  return EDITOR_FONT_SIZES.includes(value as EditorFontSize) ? value as EditorFontSize : 16;
}

function normalizeLayoutDimension(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function createEmptySnapshot(now = Date.now()): AppDataSnapshot {
  return {
    schemaVersion: 2,
    problems: [],
    attempts: [],
    thoughtEvents: [],
    platformResults: [],
    mistakes: [],
    knowledgeNotes: [],
    codeTemplates: [],
    dailyPlans: [],
    vocabularyWords: [...VOCABULARY_CATALOG_FULL],
    vocabularyProgress: [],
    vocabularyReviews: [],
    aiGenerations: [],
    settings: { ...DEFAULT_SETTINGS },
    updatedAt: now,
  };
}

type SnapshotSchemaVersion = 1 | 2;

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function arrayValue<T>(value: unknown, path: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} 必须是数组`);
  return value.map((item, index) => objectValue(item, `${path}[${index}]`) as T);
}

function normalizeProblems(value: unknown, schemaVersion: SnapshotSchemaVersion): AppDataSnapshot['problems'] {
  return arrayValue<AppDataSnapshot['problems'][number]>(value, 'problems').map((problem, index) => {
    const kind = problem.kind ?? (schemaVersion === 1 ? 'algorithm' : undefined);
    if (kind !== 'algorithm' && kind !== 'interview') {
      throw new TypeError(`problems[${index}].kind 未知：${String(kind)}`);
    }
    const algorithmMode = problem.algorithmMode ?? 'function';
    if (algorithmMode !== 'function' && algorithmMode !== 'stdin') {
      throw new TypeError(`problems[${index}].algorithmMode 未知：${String(algorithmMode)}`);
    }
    return { ...problem, kind, algorithmMode };
  });
}

function normalizeAttempts(value: unknown, schemaVersion: SnapshotSchemaVersion): AppDataSnapshot['attempts'] {
  return arrayValue<AppDataSnapshot['attempts'][number]>(value, 'attempts').map((attempt, index) => {
    const mode = attempt.mode ?? (schemaVersion === 1 ? 'code' : undefined);
    if (mode !== 'code' && mode !== 'interview') {
      throw new TypeError(`attempts[${index}].mode 未知：${String(mode)}`);
    }
    return { ...attempt, mode };
  });
}

function normalizePlans(value: unknown): AppDataSnapshot['dailyPlans'] {
  return arrayValue<AppDataSnapshot['dailyPlans'][number]>(value, 'dailyPlans').map((plan) => {
    const targetAlgorithmProblems = Number.isFinite(plan.targetAlgorithmProblems)
      ? Math.max(0, Math.floor(plan.targetAlgorithmProblems))
      : Math.max(0, Math.floor(plan.targetProblems ?? 3));
    const targetInterviewQuestions = Number.isFinite(plan.targetInterviewQuestions)
      ? Math.max(0, Math.floor(plan.targetInterviewQuestions))
      : 0;
    return {
      ...plan,
      targetProblems: targetAlgorithmProblems + targetInterviewQuestions,
      targetAlgorithmProblems,
      targetInterviewQuestions,
      targetVocabularyWords: Number.isFinite(plan.targetVocabularyWords)
        ? Math.max(0, Math.min(100, Math.floor(plan.targetVocabularyWords)))
        : 10,
      taskVocabularyWordIds: Array.isArray(plan.taskVocabularyWordIds) ? plan.taskVocabularyWordIds : [],
      completedVocabularyWordIds: Array.isArray(plan.completedVocabularyWordIds) ? plan.completedVocabularyWordIds : [],
      vocabularyPreviewedWordIds: Array.isArray(plan.vocabularyPreviewedWordIds) ? plan.vocabularyPreviewedWordIds : [],
      vocabularyUnfamiliarWordIds: Array.isArray(plan.vocabularyUnfamiliarWordIds) ? plan.vocabularyUnfamiliarWordIds : [],
      vocabularyExtraWordIds: Array.isArray(plan.vocabularyExtraWordIds) ? plan.vocabularyExtraWordIds : [],
      vocabularyExtraOnlyWordIds: Array.isArray(plan.vocabularyExtraOnlyWordIds) ? plan.vocabularyExtraOnlyWordIds : [],
      vocabularyDifficulty: isVocabularyDifficulty(plan.vocabularyDifficulty) ? plan.vocabularyDifficulty : 'all',
    };
  });
}

function normalizeVocabularyWords(value: unknown): VocabularyWord[] {
  const catalog = new Map(VOCABULARY_CATALOG_FULL.map((word) => [word.id, word]));
  arrayValue<VocabularyWord>(value, 'vocabularyWords').forEach((word) => {
    if (!catalog.has(word.id)) catalog.set(word.id, word);
  });
  return [...catalog.values()];
}

function normalizeVocabularyProgress(value: unknown): AppDataSnapshot['vocabularyProgress'] {
  return arrayValue<AppDataSnapshot['vocabularyProgress'][number]>(value, 'vocabularyProgress').map((item) => ({
    ...item,
    scope: isVocabularyDifficulty(item.scope) || item.scope === 'all' ? item.scope : 'all',
  }));
}

function normalizeVocabularyReviews(value: unknown): AppDataSnapshot['vocabularyReviews'] {
  return arrayValue<AppDataSnapshot['vocabularyReviews'][number]>(value, 'vocabularyReviews').map((item) => ({
    ...item,
    scope: isVocabularyDifficulty(item.scope) || item.scope === 'all' ? item.scope : 'all',
  }));
}

export function normalizeVocabularySessions(value: unknown): Partial<Record<VocabularyScope, VocabularySessionState>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sessions: Partial<Record<VocabularyScope, VocabularySessionState>> = {};
  for (const [scope, raw] of Object.entries(value)) {
    if (!(isVocabularyDifficulty(scope) || scope === 'all') || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const session = raw as Record<string, unknown>;
    const cards: VocabularySessionCardState[] = Array.isArray(session.cards)
      ? session.cards.flatMap((card) => {
        if (!card || typeof card !== 'object') return [];
        const rawCard = card as Record<string, unknown>;
        const direction = rawCard.direction;
        if (typeof rawCard.wordId !== 'string'
          || (direction !== 'word-to-meaning' && direction !== 'meaning-to-word')) return [];
        return [{
          wordId: rawCard.wordId,
          direction: direction as VocabularyReviewDirection,
          ...(rawCard.retry === true ? { retry: true } : {}),
        }];
      }).slice(0, 10_000)
      : [];
    sessions[scope as VocabularyScope] = {
      cards,
      index: Number.isFinite(session.index) ? Math.max(0, Math.min(cards.length, Math.floor(session.index as number))) : 0,
      phase: session.phase === 'preview' ? 'preview' : 'practice',
      revealed: session.revealed === true,
      answerDraft: typeof session.answerDraft === 'string' ? session.answerDraft.slice(0, 256) : '',
      sessionPoints: Number.isFinite(session.sessionPoints) ? Math.max(0, Math.floor(session.sessionPoints as number)) : 0,
    };
  }
  return sessions;
}

export function normalizeSnapshot(value: unknown): AppDataSnapshot {
  const rawObject = objectValue(value, '数据快照');
  const rawSchemaVersion = rawObject.schemaVersion ?? 1;
  if (rawSchemaVersion !== 1 && rawSchemaVersion !== 2) {
    throw new Error(`不支持的数据快照 schema：${String(rawSchemaVersion)}`);
  }
  const schemaVersion = rawSchemaVersion as SnapshotSchemaVersion;
  const raw = rawObject as Partial<AppDataSnapshot>;
  const rawSettings = raw.settings === undefined ? {} : objectValue(raw.settings, 'settings');
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings } as AppSettings;
  settings.dailyTargetVocabularyWords = Number.isFinite(settings.dailyTargetVocabularyWords)
    ? Math.max(0, Math.min(100, Math.floor(settings.dailyTargetVocabularyWords)))
    : DEFAULT_SETTINGS.dailyTargetVocabularyWords;
  settings.lastVocabularyDifficulty = isVocabularyDifficulty(settings.lastVocabularyDifficulty) || settings.lastVocabularyDifficulty === 'all'
    ? settings.lastVocabularyDifficulty
    : undefined;
  settings.vocabularySessions = normalizeVocabularySessions(settings.vocabularySessions);
  settings.theme = normalizeTheme(settings.theme);
  settings.editorFontSize = normalizeEditorFontSize(settings.editorFontSize);
  settings.lastSolveProblemId = typeof settings.lastSolveProblemId === 'string' && settings.lastSolveProblemId.trim()
    ? settings.lastSolveProblemId
    : undefined;
  const rawLastSolveProblemByMode = settings.lastSolveProblemByMode;
  if (rawLastSolveProblemByMode && typeof rawLastSolveProblemByMode === 'object' && !Array.isArray(rawLastSolveProblemByMode)) {
    const byMode = rawLastSolveProblemByMode as Partial<Record<'function' | 'stdin', unknown>>;
    settings.lastSolveProblemByMode = {
      ...(typeof byMode.function === 'string' && byMode.function.trim() ? { function: byMode.function } : {}),
      ...(typeof byMode.stdin === 'string' && byMode.stdin.trim() ? { stdin: byMode.stdin } : {}),
    };
  } else {
    settings.lastSolveProblemByMode = undefined;
  }
  settings.solveProblemAreaHeight = normalizeLayoutDimension(settings.solveProblemAreaHeight, 150, 720);
  settings.solveProblemTextWidth = normalizeLayoutDimension(settings.solveProblemTextWidth, 220, 1600);
  settings.solveWorkbenchCodeWidth = normalizeLayoutDimension(settings.solveWorkbenchCodeWidth, 300, 1800);
  settings.solveTerminalHeight = normalizeLayoutDimension(settings.solveTerminalHeight, 96, 420);
  return {
    schemaVersion: 2,
    problems: normalizeProblems(raw.problems, schemaVersion),
    attempts: normalizeAttempts(raw.attempts, schemaVersion),
    thoughtEvents: arrayValue(raw.thoughtEvents, 'thoughtEvents'),
    platformResults: arrayValue(raw.platformResults, 'platformResults'),
    mistakes: arrayValue(raw.mistakes, 'mistakes'),
    knowledgeNotes: arrayValue(raw.knowledgeNotes, 'knowledgeNotes'),
    codeTemplates: arrayValue(raw.codeTemplates, 'codeTemplates'),
    dailyPlans: normalizePlans(raw.dailyPlans),
    vocabularyWords: normalizeVocabularyWords(raw.vocabularyWords),
    vocabularyProgress: normalizeVocabularyProgress(raw.vocabularyProgress),
    vocabularyReviews: normalizeVocabularyReviews(raw.vocabularyReviews),
    aiGenerations: arrayValue(raw.aiGenerations, 'aiGenerations'),
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}
