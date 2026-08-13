import { describe, expect, it } from 'vitest';
import { applyReviewResult, calculateNextReview, REVIEW_INTERVALS } from '../lib/review';
import { mistake } from './fixtures';

describe('复习排程', () => {
  it('按 1/3/7/14/30 天升级并最终掌握', () => {
    let value = mistake();
    const now = 1_000_000;
    const observed: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const next = calculateNextReview(value, true, now);
      observed.push(next.intervalDays);
      value = applyReviewResult(value, true, now);
    }
    expect(observed).toEqual([3, 7, 14, 30, 30]);
    expect(value.status).toBe('mastered');
    expect(REVIEW_INTERVALS).toEqual([1, 3, 7, 14, 30]);
  });

  it('失败后重置为一天', () => {
    const value = mistake({ reviewStage: 3, intervalDays: 14, status: 'reviewing' });
    const next = applyReviewResult(value, false, 5_000);
    expect(next.reviewStage).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.status).toBe('active');
    expect(next.failedReviews).toBe(1);
  });
});
