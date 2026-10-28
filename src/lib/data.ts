import type { AppDataSnapshot, AppFontScale, AppSettings, AppTheme, EditorFontSize, LocalTool } from '../types';
import { VOCABULARY_CATALOG_FULL } from '../data/vocabularyCatalog';
import SEED_FILE from '../data/localToolSeeds.json';
import { isVocabularyDifficulty, type VocabularyReviewDirection, type VocabularyScope, type VocabularySessionCardState, type VocabularySessionState, type VocabularyWord } from './vocabulary';
import { isMacOS } from './os';

export const EDITOR_FONT_SIZES: EditorFontSize[] = [14, 16, 18, 20, 22];
export const APP_FONT_SCALES: AppFontScale[] = [90, 100, 110, 120, 130];

export const DEFAULT_SETTINGS: AppSettings = {
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: '',
  hasAiCredential: false,
  defaultLanguage: 'cpp',
  editorFontSize: 16,
  appFontScale: 100,
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

/**
 * 内置清单的唯一数据源是 src/data/localToolSeeds.json：应用从这里生成种子，
 * scripts/local-tools.mjs 登记新工具时读的也是同一份文件。
 * 只收点一下就能打开的本地看板/工作台；需要先起容器的服务（docker 一类）不在其中。
 */
const LOCAL_TOOL_SEEDS = SEED_FILE as ReadonlyArray<Omit<LocalTool, 'createdAt' | 'updatedAt' | 'origin'>>;

/**
 * 内置清单里每条都钉着某台机器的绝对路径（`G:\...`、`.venv\Scripts\python.exe`）。
 * 换到 macOS 后这些路径一个都不存在，与其在工具页摆一排点了就报「工作目录不存在」的条目，
 * 不如按平台过滤：Windows 形态的条目只在 Windows 上出现。mac 上工具页就是空的，不用管它。
 */
function seedFitsCurrentPlatform(tool: Omit<LocalTool, 'createdAt' | 'updatedAt' | 'origin'>): boolean {
  if (!isMacOS()) return true;
  const windowsStyle = (value?: string): boolean =>
    Boolean(value && (/^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')));
  return !windowsStyle(tool.workingDirectory) && !windowsStyle(tool.launchCommand);
}

/** 内置清单的实例化：每条都带稳定的 id，用户删掉后不会自己回来。 */
export function createSeedLocalTools(now = Date.now()): LocalTool[] {
  return LOCAL_TOOL_SEEDS.filter(seedFitsCurrentPlatform)
    .map((tool) => ({ ...tool, origin: 'seed' as const, createdAt: now, updatedAt: now }));
}

// description 允许为空（用户可以只登记名字和地址），其余字段缺了就没法用。
const LOCAL_TOOL_REQUIRED_FIELDS = ['id', 'name', 'category', 'url'] as const;

/** 宽容解析：坏条目直接丢掉，不让一条脏数据把整份快照读取拖崩。 */
export function normalizeLocalTools(value: unknown): LocalTool[] {
  if (value === undefined) return createSeedLocalTools();
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    if (LOCAL_TOOL_REQUIRED_FIELDS.some((field) => typeof raw[field] !== 'string' || !(raw[field] as string).trim())) return [];
    const port = Number(raw.port);
    const tool: LocalTool = {
      id: String(raw.id),
      name: String(raw.name),
      category: String(raw.category),
      description: typeof raw.description === 'string' ? raw.description : '',
      url: String(raw.url),
      createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
    };
    if (Number.isInteger(port) && port > 0 && port <= 65_535) tool.port = port;
    if (typeof raw.launchCommand === 'string' && raw.launchCommand.trim()) tool.launchCommand = raw.launchCommand;
    if (typeof raw.workingDirectory === 'string' && raw.workingDirectory.trim()) tool.workingDirectory = raw.workingDirectory;
    if (raw.pinned === true) tool.pinned = true;
    tool.origin = raw.origin === 'manual' ? 'manual' : 'seed';
    return [tool];
  });
}

export function normalizeEditorFontSize(value: unknown): EditorFontSize {
  return EDITOR_FONT_SIZES.includes(value as EditorFontSize) ? value as EditorFontSize : 16;
}

export function normalizeAppFontScale(value: unknown): AppFontScale {
  return APP_FONT_SCALES.includes(value as AppFontScale) ? value as AppFontScale : 100;
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
    localTools: createSeedLocalTools(now),
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
  settings.appFontScale = normalizeAppFontScale(settings.appFontScale);
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
    localTools: normalizeLocalTools(raw.localTools),
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}
