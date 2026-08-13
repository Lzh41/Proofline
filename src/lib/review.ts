import type { Mistake, ReviewSchedule } from '../types';

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 86_400_000;

export function initialReviewSchedule(now = Date.now()): Omit<ReviewSchedule, 'mistakeId'> {
  return { stage: 0, intervalDays: 1, nextReviewAt: now + DAY_MS, status: 'active' };
}

export function calculateNextReview(mistake: Mistake, success: boolean, now = Date.now()): ReviewSchedule {
  if (!success) {
    return {
      mistakeId: mistake.id,
      stage: 0,
      intervalDays: REVIEW_INTERVALS[0],
      nextReviewAt: now + REVIEW_INTERVALS[0] * DAY_MS,
      status: 'active',
    };
  }
  const stage = Math.min(mistake.reviewStage + 1, REVIEW_INTERVALS.length - 1);
  const intervalDays = REVIEW_INTERVALS[stage];
  return {
    mistakeId: mistake.id,
    stage,
    intervalDays,
    nextReviewAt: now + intervalDays * DAY_MS,
    status: stage === REVIEW_INTERVALS.length - 1 ? 'mastered' : 'reviewing',
  };
}

export function applyReviewResult(mistake: Mistake, success: boolean, now = Date.now()): Mistake {
  const schedule = calculateNextReview(mistake, success, now);
  return {
    ...mistake,
    reviewStage: schedule.stage,
    intervalDays: schedule.intervalDays,
    nextReviewAt: schedule.nextReviewAt,
    status: schedule.status,
    lastReviewedAt: now,
    successfulReviews: mistake.successfulReviews + (success ? 1 : 0),
    failedReviews: mistake.failedReviews + (success ? 0 : 1),
    updatedAt: now,
  };
}
