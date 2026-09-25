import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayKey } from '../app/storeAdapter';
import { createEmptySnapshot } from '../lib/data';
import { VocabularyPage } from '../pages/VocabularyPage';
import { useAppStore } from '../store/useAppStore';
import type { DailyPlan } from '../types';

afterEach(() => {
  cleanup();
  localStorage.removeItem('xiti.vocabulary-session-journal.v1');
  vi.restoreAllMocks();
});

describe('词汇刷词键盘流程', () => {
  it('先展示完整本轮词单，开始刷词后拼错会显示答案并把错词留在队尾重做', async () => {
    const snapshot = createEmptySnapshot();
    const [firstWord, secondWord] = snapshot.vocabularyWords.filter((word, index, words) =>
      index === 0 || word.meaning !== words[0].meaning,
    ).slice(0, 2);
    const plan: DailyPlan = {
      id: 'vocabulary-keyboard-plan',
      date: todayKey(),
      targetMinutes: 60,
      targetProblems: 0,
      targetAlgorithmProblems: 0,
      targetInterviewQuestions: 0,
      targetVocabularyWords: 2,
      taskProblemIds: [],
      taskVocabularyWordIds: [firstWord.id, secondWord.id],
      reviewMistakeIds: [],
      completedProblemIds: [],
      completedVocabularyWordIds: [],
      focusTags: [],
      difficultyRatio: { easy: 30, medium: 50, hard: 20 },
      vocabularyDifficulty: 'all',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    useAppStore.setState({
      ...snapshot,
      dailyPlans: [plan],
      settings: { ...snapshot.settings, lastVocabularyDifficulty: 'all', dailyTargetVocabularyWords: 2 },
      initialized: true,
      loading: false,
      error: null,
    });
    vi.spyOn(useAppStore.getState(), 'generateDailyPlan').mockResolvedValue(plan);
    vi.spyOn(useAppStore.getState(), 'recordVocabularyReview').mockResolvedValue(undefined);
    vi.spyOn(useAppStore.getState(), 'saveVocabularySession').mockResolvedValue(undefined);
    vi.spyOn(useAppStore.getState(), 'updateSettings').mockResolvedValue(undefined);

    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /开始这一轮/ }));

    expect(await screen.findByText(firstWord.word, { exact: true })).toBeVisible();
    expect(screen.getByText(secondWord.word, { exact: true })).toBeVisible();
    expect(within(screen.getByRole('list', { name: '本轮全部单词' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(new RegExp(firstWord.phonetic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
    expect(screen.getByText(new RegExp(secondWord.phonetic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
    expect(screen.getByText(firstWord.meaning, { exact: true })).toBeVisible();
    expect(screen.getByText(secondWord.meaning, { exact: true })).toBeVisible();
    expect(screen.getAllByText(/今日新词|计划新词/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('textbox', { name: '拼写回忆' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /开始刷词/ }));
    const firstInput = await screen.findByRole('textbox', { name: '拼写回忆' });
    fireEvent.change(firstInput, { target: { value: 'wrong-spelling' } });
    fireEvent.keyDown(firstInput, { key: 'Enter', code: 'Enter' });

    const continueButton = await screen.findByRole('button', { name: '继续，稍后再做' });
    await waitFor(() => expect(continueButton).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent(`正确答案是“${firstWord.word}”。`);
    expect(useAppStore.getState().recordVocabularyReview).toHaveBeenCalledWith(expect.objectContaining({
      wordId: firstWord.id,
      correct: false,
      rating: 'again',
    }));

    fireEvent.keyDown(continueButton, { key: 'Enter', code: 'Enter' });
    const secondInput = await screen.findByRole('textbox', { name: '拼写回忆' });
    expect(screen.getByText(secondWord.meaning, { exact: true })).toBeVisible();
    fireEvent.change(secondInput, { target: { value: secondWord.word } });
    fireEvent.keyDown(secondInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(screen.getByText(firstWord.meaning, { exact: true })).toBeVisible());
    expect(screen.getByText(/重做/)).toBeVisible();
  });

  it('重新打开时恢复上次保存的预览词单', async () => {
    const snapshot = createEmptySnapshot();
    const [firstWord, secondWord] = snapshot.vocabularyWords.slice(0, 2);
    const now = Date.now();
    useAppStore.setState({
      ...snapshot,
      vocabularyProgress: [{
        wordId: secondWord.id,
        scope: 'all',
        state: 'review',
        dueAt: now - 1_000,
        intervalDays: 1,
        easeFactor: 2.5,
        repetitions: 1,
        lapses: 0,
        streak: 1,
      }],
      settings: {
        ...snapshot.settings,
        lastVocabularyDifficulty: 'all',
        vocabularySessions: {
          all: {
            phase: 'preview',
            cards: [
              { wordId: firstWord.id, direction: 'meaning-to-word' },
              { wordId: secondWord.id, direction: 'word-to-meaning' },
            ],
            index: 0,
            revealed: false,
            answerDraft: '',
            sessionPoints: 0,
          },
        },
      },
      initialized: true,
      loading: false,
      error: null,
    });
    vi.spyOn(useAppStore.getState(), 'saveVocabularySession').mockResolvedValue(undefined);
    vi.spyOn(useAppStore.getState(), 'updateSettings').mockResolvedValue(undefined);

    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

    expect(await screen.findByText(firstWord.word, { exact: true })).toBeVisible();
    expect(screen.getByText(secondWord.word, { exact: true })).toBeVisible();
    expect(screen.getAllByText(/今日新词|计划新词/)[0]).toBeVisible();
    expect(screen.getByText('到期复习')).toBeVisible();
    expect(screen.getByRole('button', { name: /开始刷词/ })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '拼写回忆' })).not.toBeInTheDocument();
  });

  it('恢复保存的预览时先显示加载状态，不短暂露出开始按钮', async () => {
    const snapshot = createEmptySnapshot();
    const firstWord = snapshot.vocabularyWords[0];
    useAppStore.setState({
      ...snapshot,
      settings: {
        ...snapshot.settings,
        lastVocabularyDifficulty: 'all',
        vocabularySessions: {
          all: {
            phase: 'preview',
            cards: [{ wordId: firstWord.id, direction: 'meaning-to-word' }],
            index: 0,
            revealed: false,
            answerDraft: '',
            sessionPoints: 0,
          },
        },
      },
      initialized: false,
      loading: true,
      error: null,
    });
    vi.spyOn(useAppStore.getState(), 'saveVocabularySession').mockResolvedValue(undefined);
    vi.spyOn(useAppStore.getState(), 'updateSettings').mockResolvedValue(undefined);

    render(<MemoryRouter><VocabularyPage /></MemoryRouter>);

    expect(screen.getByRole('status')).toHaveTextContent('正在恢复当前考试方向的词单与进度');
    expect(screen.queryByRole('button', { name: /开始这一轮/ })).not.toBeInTheDocument();

    await act(async () => {
      useAppStore.setState({ initialized: true, loading: false });
    });

    expect(await screen.findByRole('button', { name: /开始刷词/ })).toBeVisible();
    expect(screen.getByText(firstWord.word, { exact: true })).toBeVisible();
  });
});
