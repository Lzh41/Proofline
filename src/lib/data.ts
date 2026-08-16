import type { AppDataSnapshot, AppSettings, AppTheme, EditorFontSize } from '../types';

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
  interviewCatalogVersion: 0,
  lastSolveProblemId: undefined,
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
    return { ...problem, kind };
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
    };
  });
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
  settings.theme = normalizeTheme(settings.theme);
  settings.editorFontSize = normalizeEditorFontSize(settings.editorFontSize);
  settings.lastSolveProblemId = typeof settings.lastSolveProblemId === 'string' && settings.lastSolveProblemId.trim()
    ? settings.lastSolveProblemId
    : undefined;
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
    aiGenerations: arrayValue(raw.aiGenerations, 'aiGenerations'),
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}
