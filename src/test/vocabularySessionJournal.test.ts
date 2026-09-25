import { afterEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import {
  clearPersistedVocabularySessionJournal,
  restoreVocabularySessionJournal,
  writeVocabularySessionJournal,
} from '../lib/vocabularySessionJournal';
import type { VocabularySessionState } from '../lib/vocabulary';

afterEach(() => localStorage.clear());

describe('词汇会话同步日志', () => {
  it('SQLite 快照较旧时恢复未确认保存的背诵预览', () => {
    const session: VocabularySessionState = {
      cards: [{ wordId: 'preview-word', direction: 'meaning-to-word' }],
      index: 0,
      phase: 'preview',
      revealed: false,
      answerDraft: '',
      sessionPoints: 0,
    };

    const revision = writeVocabularySessionJournal('toefl', session);
    const restored = restoreVocabularySessionJournal(createEmptySnapshot());

    expect(revision).not.toBeNull();
    expect(restored.settings.lastVocabularyDifficulty).toBe('toefl');
    expect(restored.settings.vocabularySessions?.toefl).toEqual(session);

    clearPersistedVocabularySessionJournal(revision!);
    expect(restoreVocabularySessionJournal(createEmptySnapshot()).settings.vocabularySessions).toEqual({});
  });

  it('旧的异步保存完成时不会删除较新的队列状态', () => {
    const olderRevision = writeVocabularySessionJournal('ielts', {
      cards: [{ wordId: 'practice-word', direction: 'meaning-to-word' }],
      index: 0,
      phase: 'practice',
      revealed: true,
      answerDraft: 'par',
      sessionPoints: 0,
    });
    const newerSession: VocabularySessionState = {
      cards: [{ wordId: 'practice-word', direction: 'meaning-to-word' }],
      index: 1,
      phase: 'practice',
      revealed: false,
      answerDraft: '',
      sessionPoints: 4,
    };
    const newerRevision = writeVocabularySessionJournal('ielts', newerSession);

    clearPersistedVocabularySessionJournal(olderRevision!);
    expect(restoreVocabularySessionJournal(createEmptySnapshot()).settings.vocabularySessions?.ielts).toEqual(newerSession);

    clearPersistedVocabularySessionJournal(newerRevision!);
    expect(restoreVocabularySessionJournal(createEmptySnapshot()).settings.vocabularySessions).toEqual({});
  });
});
