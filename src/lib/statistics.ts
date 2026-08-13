import type { Attempt, AttemptResult, Difficulty, LearningStatistics, Mistake, Problem, ProblemKind } from '../types';

export interface InterviewStatistics {
  totalQuestions: number;
  practicedQuestions: number;
  masteredQuestions: number;
  totalAttempts: number;
  totalFocusSeconds: number;
  activeMistakes: number;
  masteredMistakes: number;
  dueReviews: number;
  masteryRate: number;
  byRole: Array<{ role: string; total: number; practiced: number; mastered: number }>;
  byCategory: Array<{ category: string; total: number; practiced: number; mastered: number }>;
  weakRoles: Array<{ role: string; score: number; attempts: number; failures: number }>;
}

export function isSuccessfulAttempt(kind: ProblemKind, result: AttemptResult): boolean {
  return kind === 'interview'
    ? result === 'mastered'
    : result === 'sample-passed' || result === 'accepted';
}

export function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function calculateStatistics(
  problems: Problem[],
  attempts: Attempt[],
  mistakes: Mistake[],
  now = Date.now(),
): LearningStatistics {
  const algorithmProblems = problems.filter((problem) => problem.kind !== 'interview');
  const algorithmIds = new Set(algorithmProblems.map((problem) => problem.id));
  const algorithmAttempts = attempts.filter((attempt) => attempt.mode !== 'interview' && algorithmIds.has(attempt.problemId));
  const algorithmMistakes = mistakes.filter((mistake) => algorithmIds.has(mistake.problemId));
  const solvedIds = new Set(algorithmAttempts.filter((item) => isSuccessfulAttempt('algorithm', item.result)).map((item) => item.problemId));
  const solvedByDifficulty: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, unknown: 0 };
  algorithmProblems.forEach((problem) => {
    if (solvedIds.has(problem.id)) solvedByDifficulty[problem.difficulty] += 1;
  });
  const attemptsByDay: Record<string, number> = {};
  algorithmAttempts.forEach((attempt) => {
    const key = dateKey(attempt.startedAt);
    attemptsByDay[key] = (attemptsByDay[key] ?? 0) + 1;
  });
  const byTag = new Map<string, { attempts: number; failures: number }>();
  algorithmAttempts.forEach((attempt) => {
    const problem = algorithmProblems.find((item) => item.id === attempt.problemId);
    const failed = !isSuccessfulAttempt('algorithm', attempt.result);
    problem?.tags.forEach((tag) => {
      const value = byTag.get(tag) ?? { attempts: 0, failures: 0 };
      value.attempts += 1;
      value.failures += failed ? 1 : 0;
      byTag.set(tag, value);
    });
  });
  const weakTags = [...byTag.entries()]
    .map(([tag, value]) => ({ tag, ...value, score: value.failures / Math.max(1, value.attempts) }))
    .sort((a, b) => b.score - a.score || b.failures - a.failures || a.tag.localeCompare(b.tag));
  return {
    totalProblems: algorithmProblems.length,
    solvedProblems: solvedIds.size,
    totalAttempts: algorithmAttempts.length,
    totalFocusSeconds: algorithmAttempts.reduce((sum, item) => sum + item.durationSeconds, 0),
    activeMistakes: algorithmMistakes.filter((item) => item.status === 'active').length,
    masteredMistakes: algorithmMistakes.filter((item) => item.status === 'mastered').length,
    dueReviews: algorithmMistakes.filter((item) => item.status !== 'mastered' && item.nextReviewAt <= now).length,
    solvedByDifficulty,
    attemptsByDay,
    weakTags,
  };
}

export function calculateInterviewStatistics(
  problems: Problem[],
  attempts: Attempt[],
  mistakes: Mistake[],
  now = Date.now(),
): InterviewStatistics {
  const interviewProblems = problems.filter((problem) => problem.kind === 'interview' && problem.interview);
  const interviewIds = new Set(interviewProblems.map((problem) => problem.id));
  const interviewAttempts = attempts.filter((attempt) => attempt.mode === 'interview' && interviewIds.has(attempt.problemId));
  const interviewMistakes = mistakes.filter((item) => interviewIds.has(item.problemId));
  const practicedIds = new Set(interviewAttempts.map((attempt) => attempt.problemId));
  const masteredIds = new Set(
    interviewAttempts
      .filter((attempt) => isSuccessfulAttempt('interview', attempt.result))
      .map((attempt) => attempt.problemId),
  );

  const aggregate = (keyFor: (problem: Problem) => string[]) => {
    const values = new Map<string, { total: number; practiced: number; mastered: number }>();
    interviewProblems.forEach((problem) => {
      keyFor(problem).forEach((key) => {
        const current = values.get(key) ?? { total: 0, practiced: 0, mastered: 0 };
        current.total += 1;
        current.practiced += practicedIds.has(problem.id) ? 1 : 0;
        current.mastered += masteredIds.has(problem.id) ? 1 : 0;
        values.set(key, current);
      });
    });
    return values;
  };

  const roleTotals = aggregate((problem) => [problem.interview!.primaryRole]);
  const categoryTotals = aggregate((problem) => [problem.interview!.category]);
  const roleAttempts = new Map<string, { attempts: number; failures: number }>();
  const problemById = new Map(interviewProblems.map((problem) => [problem.id, problem]));
  interviewAttempts.forEach((attempt) => {
    const role = problemById.get(attempt.problemId)?.interview?.primaryRole;
    if (!role) return;
    const current = roleAttempts.get(role) ?? { attempts: 0, failures: 0 };
    current.attempts += 1;
    current.failures += isSuccessfulAttempt('interview', attempt.result) ? 0 : 1;
    roleAttempts.set(role, current);
  });

  const byRole = [...roleTotals.entries()]
    .map(([role, value]) => ({ role, ...value }))
    .sort((a, b) => b.total - a.total || a.role.localeCompare(b.role));
  const byCategory = [...categoryTotals.entries()]
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  const weakRoles = [...roleAttempts.entries()]
    .map(([role, value]) => ({
      role,
      ...value,
      score: value.failures / Math.max(1, value.attempts),
    }))
    .sort((a, b) => b.score - a.score || b.failures - a.failures || a.role.localeCompare(b.role));

  return {
    totalQuestions: interviewProblems.length,
    practicedQuestions: practicedIds.size,
    masteredQuestions: masteredIds.size,
    totalAttempts: interviewAttempts.length,
    totalFocusSeconds: interviewAttempts.reduce((sum, attempt) => sum + attempt.durationSeconds, 0),
    activeMistakes: interviewMistakes.filter((item) => item.status === 'active').length,
    masteredMistakes: interviewMistakes.filter((item) => item.status === 'mastered').length,
    dueReviews: interviewMistakes.filter((item) => item.status !== 'mastered' && item.nextReviewAt <= now).length,
    masteryRate: practicedIds.size ? masteredIds.size / practicedIds.size : 0,
    byRole,
    byCategory,
    weakRoles,
  };
}
