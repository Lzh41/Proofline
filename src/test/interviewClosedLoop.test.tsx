import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todayKey } from '../app/storeAdapter';
import { createEmptySnapshot } from '../lib/data';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { PlanPage } from '../pages/PlanPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TodayPage } from '../pages/TodayPage';
import { useAppStore } from '../store/useAppStore';
import type { Attempt, Problem } from '../types';
import { attempt, problem } from './fixtures';

const interviewProblem: Problem = problem({
  id: 'interview-llm',
  kind: 'interview',
  title: '如何评估大模型应用？',
  interview: {
    contentOrigin: 'builtin',
    primaryRole: 'llm-app',
    roles: ['llm-app'],
    category: '模型评估',
    format: 'scenario',
    keyPoints: ['离线指标', '在线实验', '失败分析'],
    referenceAnswer: '应该结合离线指标、线上任务成功率、人工抽检与失败样本分析，持续追踪不同用户场景下的表现变化。',
    followUps: ['如何控制评估成本？'],
  },
});

const interviewAttempt: Attempt = attempt({
  id: 'attempt-interview',
  problemId: interviewProblem.id,
  mode: 'interview',
  result: 'mastered',
  durationSeconds: 180,
  interview: { answerText: '回答', masteryResult: 'mastered' },
});

beforeEach(() => {
  const state = createEmptySnapshot(Date.now());
  const date = todayKey();
  useAppStore.setState({
    ...state,
    problems: [problem(), interviewProblem],
    attempts: [attempt({ result: 'sample-passed' }), interviewAttempt],
    dailyPlans: [{
      id: 'plan-today',
      date,
      targetMinutes: 60,
      targetProblems: 2,
      targetAlgorithmProblems: 1,
      targetInterviewQuestions: 1,
      taskProblemIds: [interviewProblem.id],
      reviewMistakeIds: [],
      completedProblemIds: [],
      focusTags: [],
      difficultyRatio: { easy: 30, medium: 50, hard: 20 },
      createdAt: 100,
      updatedAt: 100,
    }],
    initialized: true,
    loading: false,
    error: null,
  });
});

afterEach(() => cleanup());

describe('面试学习闭环页面', () => {
  it('今日页区分算法和面试目标，并按题型进入练习页', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/interviews/:id" element={<div>面试练习路由</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('算法完成')).toBeVisible();
    expect(screen.getByText('面试练习')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /进入题目/ }));
    expect(screen.getByText('面试练习路由')).toBeVisible();
  });

  it('计划页分别设置算法题与面试题目标', () => {
    render(<MemoryRouter><PlanPage /></MemoryRouter>);
    expect(screen.getByRole('spinbutton', { name: '算法题目标' })).toHaveValue(1);
    expect(screen.getByRole('spinbutton', { name: '面试题目标' })).toHaveValue(1);
  });

  it('统计页独立显示面试掌握指标', () => {
    render(<MemoryRouter><AnalyticsPage /></MemoryRouter>);
    expect(screen.getByText('面试掌握率')).toBeVisible();
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('薄弱岗位')).toBeVisible();
  });

  it('设置页显示内置题库版本和恢复动作', () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(screen.getByText('内置面试题库')).toBeVisible();
    expect(screen.getByRole('button', { name: '恢复内置面试题库' })).toBeVisible();
  });
});
