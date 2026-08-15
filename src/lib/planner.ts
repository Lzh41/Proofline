import type { Attempt, DailyPlan, Mistake, PlanOptions, Problem } from '../types';
import { createId } from './ids';
import { dateKey, calculateStatistics, isSuccessfulAttempt } from './statistics';

const DIFFICULTY_WEIGHT = { easy: 1, medium: 2, hard: 3, unknown: 1 } as const;

function normalizedTarget(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : fallback;
}

export function generatePlan(
  problems: Problem[],
  attempts: Attempt[],
  mistakes: Mistake[],
  options: PlanOptions = {},
): DailyPlan {
  const now = options.now ?? Date.now();
  const usesSplitTargets = options.targetAlgorithmProblems !== undefined || options.targetInterviewQuestions !== undefined;
  const targetAlgorithmProblems = usesSplitTargets
    ? normalizedTarget(options.targetAlgorithmProblems, 0)
    : normalizedTarget(options.targetProblems, 3);
  const targetInterviewQuestions = usesSplitTargets
    ? normalizedTarget(options.targetInterviewQuestions, 0)
    : 0;
  const targetProblems = targetAlgorithmProblems + targetInterviewQuestions;
  const problemsById = new Map(problems.map((problem) => [problem.id, problem]));
  const due = mistakes
    .filter((item) => item.status !== 'mastered' && item.nextReviewAt <= now)
    .sort((a, b) => {
      const aInterview = problemsById.get(a.problemId)?.kind === 'interview' ? 0 : 1;
      const bInterview = problemsById.get(b.problemId)?.kind === 'interview' ? 0 : 1;
      return aInterview - bInterview || a.nextReviewAt - b.nextReviewAt;
    });
  const taskProblemIds: string[] = [];
  const reviewMistakeIds: string[] = [];
  const selectedByKind = { algorithm: 0, interview: 0 };
  due.forEach((item) => {
    const problem = problemsById.get(item.problemId);
    if (!problem || taskProblemIds.includes(item.problemId)) return;
    const kind = problem.kind === 'interview' ? 'interview' : 'algorithm';
    const target = kind === 'interview' ? targetInterviewQuestions : targetAlgorithmProblems;
    if (selectedByKind[kind] >= target) return;
    taskProblemIds.push(item.problemId);
    reviewMistakeIds.push(item.id);
    selectedByKind[kind] += 1;
  });

  const stats = calculateStatistics(problems, attempts, mistakes, now);
  const weakTagWeight = new Map(stats.weakTags.map((item) => [item.tag, item.score + item.failures * 0.1]));
  const solved = new Set(attempts.filter((item) => {
    const problem = problemsById.get(item.problemId);
    return problem ? isSuccessfulAttempt(problem.kind, item.result) : false;
  }).map((item) => item.problemId));
  const attemptedAt = new Map<string, number>();
  attempts.forEach((item) => attemptedAt.set(item.problemId, Math.max(attemptedAt.get(item.problemId) ?? 0, item.startedAt)));
  const candidates = problems
    .filter((item) => !taskProblemIds.includes(item.id))
    .map((problem) => ({
      problem,
      score: (solved.has(problem.id) ? -2 : 2)
        + problem.tags.reduce((sum, tag) => sum + (weakTagWeight.get(tag) ?? 0), 0)
        + DIFFICULTY_WEIGHT[problem.difficulty] * 0.05
        - (attemptedAt.get(problem.id) ?? 0) / 1e15,
    }))
    .sort((a, b) => b.score - a.score || a.problem.createdAt - b.problem.createdAt);
  (['algorithm', 'interview'] as const).forEach((kind) => {
    const target = kind === 'interview' ? targetInterviewQuestions : targetAlgorithmProblems;
    for (const item of candidates) {
      if (selectedByKind[kind] >= target) break;
      if (item.problem.kind !== kind || taskProblemIds.includes(item.problem.id)) continue;
      taskProblemIds.push(item.problem.id);
      selectedByKind[kind] += 1;
    }
  });
  const timestamp = Date.now();
  return {
    id: createId('plan'),
    date: options.date ?? dateKey(now),
    targetMinutes: Math.max(5, Math.floor(options.targetMinutes ?? 60)),
    targetProblems,
    targetAlgorithmProblems,
    targetInterviewQuestions,
    taskProblemIds,
    reviewMistakeIds,
    completedProblemIds: options.completedProblemIds ?? [],
    focusTags: stats.weakTags.slice(0, 3).map((item) => item.tag),
    difficultyRatio: { easy: 30, medium: 50, hard: 20 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
