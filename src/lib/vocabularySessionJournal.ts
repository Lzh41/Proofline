import type { AppDataSnapshot } from '../types';
import { normalizeVocabularySessions } from './data';
import { isVocabularyDifficulty, type VocabularyScope, type VocabularySessionState } from './vocabulary';

const JOURNAL_KEY = 'xiti.vocabulary-session-journal.v1';

interface JournalSession {
  session: VocabularySessionState;
  savedAt: number;
}

interface JournalSelection {
  scope: VocabularyScope;
  savedAt: number;
}

interface VocabularySessionJournal {
  version: 1;
  sessions: Partial<Record<VocabularyScope, JournalSession>>;
  selection?: JournalSelection;
}

export interface VocabularySessionJournalRevision {
  scope: VocabularyScope;
  sessionSavedAt?: number;
  selectionSavedAt?: number;
}

function isScope(value: string): value is VocabularyScope {
  return value === 'all' || isVocabularyDifficulty(value);
}

function readJournal(): VocabularySessionJournal | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1) return null;

    const sessions: VocabularySessionJournal['sessions'] = {};
    if (raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
      for (const [scope, candidate] of Object.entries(raw.sessions)) {
        if (!isScope(scope) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const entry = candidate as Record<string, unknown>;
        if (!Number.isFinite(entry.savedAt)) continue;
        const session = normalizeVocabularySessions({ [scope]: entry.session })[scope];
        if (session) sessions[scope] = { session, savedAt: entry.savedAt as number };
      }
    }

    let selection: JournalSelection | undefined;
    if (raw.selection && typeof raw.selection === 'object' && !Array.isArray(raw.selection)) {
      const candidate = raw.selection as Record<string, unknown>;
      if (typeof candidate.scope === 'string' && isScope(candidate.scope) && Number.isFinite(candidate.savedAt)) {
        selection = { scope: candidate.scope, savedAt: candidate.savedAt as number };
      }
    }
    return { version: 1, sessions, ...(selection ? { selection } : {}) };
  } catch {
    return null;
  }
}

function writeJournal(journal: VocabularySessionJournal): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    return true;
  } catch {
    return false;
  }
}

function nextSavedAt(previous?: number): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}

function revisionsFor(journal: VocabularySessionJournal, scope: VocabularyScope): VocabularySessionJournalRevision {
  const selectionSavedAt = journal.selection?.scope === scope ? journal.selection.savedAt : undefined;
  return {
    scope,
    ...(journal.sessions[scope] ? { sessionSavedAt: journal.sessions[scope]!.savedAt } : {}),
    ...(selectionSavedAt !== undefined ? { selectionSavedAt } : {}),
  };
}

export function writeVocabularySessionJournal(scope: VocabularyScope, session: VocabularySessionState): VocabularySessionJournalRevision | null {
  const journal = readJournal() ?? { version: 1, sessions: {} };
  const savedAt = nextSavedAt(journal.sessions[scope]?.savedAt);
  journal.sessions[scope] = { session, savedAt };
  journal.selection = { scope, savedAt: nextSavedAt(journal.selection?.savedAt) };
  return writeJournal(journal) ? revisionsFor(journal, scope) : null;
}

export function rememberVocabularyDifficulty(scope: VocabularyScope): VocabularySessionJournalRevision | null {
  const journal = readJournal() ?? { version: 1, sessions: {} };
  journal.selection = { scope, savedAt: nextSavedAt(journal.selection?.savedAt) };
  return writeJournal(journal) ? revisionsFor(journal, scope) : null;
}

export function getVocabularySessionJournalRevision(scope: VocabularyScope): VocabularySessionJournalRevision | null {
  const journal = readJournal();
  return journal ? revisionsFor(journal, scope) : null;
}

export function clearPersistedVocabularySessionJournal(revision: VocabularySessionJournalRevision): void {
  const journal = readJournal();
  if (!journal) return;
  const entry = journal.sessions[revision.scope];
  if (revision.sessionSavedAt !== undefined && entry?.savedAt === revision.sessionSavedAt) {
    delete journal.sessions[revision.scope];
  }
  if (revision.selectionSavedAt !== undefined
    && journal.selection?.scope === revision.scope
    && journal.selection.savedAt === revision.selectionSavedAt) {
    delete journal.selection;
  }
  if (Object.keys(journal.sessions).length === 0 && !journal.selection) {
    try { localStorage.removeItem(JOURNAL_KEY); } catch { /* The database snapshot remains authoritative. */ }
  } else {
    writeJournal(journal);
  }
}

export function restoreVocabularySessionJournal(snapshot: AppDataSnapshot): AppDataSnapshot {
  const journal = readJournal();
  if (!journal) return snapshot;
  const vocabularySessions = { ...snapshot.settings.vocabularySessions };
  for (const [scope, entry] of Object.entries(journal.sessions)) {
    if (entry) vocabularySessions[scope as VocabularyScope] = entry.session;
  }
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      ...(journal.selection ? { lastVocabularyDifficulty: journal.selection.scope } : {}),
      vocabularySessions,
    },
  };
}
