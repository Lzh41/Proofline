DROP INDEX IF EXISTS idx_vocabulary_due;
DROP INDEX IF EXISTS idx_vocabulary_reviews_word_time;

ALTER TABLE vocabulary_progress RENAME TO vocabulary_progress_old;
CREATE TABLE vocabulary_progress (
  scope TEXT NOT NULL DEFAULT 'all'
    CHECK (scope IN ('all', 'beginner', 'intermediate', 'advanced', 'cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat')),
  word_id TEXT NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'learning', 'review', 'mastered')),
  repetitions INTEGER NOT NULL DEFAULT 0,
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  lapses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_rating TEXT CHECK (last_rating IS NULL OR last_rating IN ('again', 'hard', 'good', 'easy')),
  due_at INTEGER NOT NULL,
  last_reviewed_at INTEGER,
  PRIMARY KEY(scope, word_id)
);
INSERT INTO vocabulary_progress(
  scope, word_id, status, repetitions, interval_days, ease_factor, lapses,
  streak, last_rating, due_at, last_reviewed_at
)
SELECT 'all', word_id, status, repetitions, interval_days, ease_factor, lapses,
  streak, last_rating, due_at, last_reviewed_at
FROM vocabulary_progress_old;
DROP TABLE vocabulary_progress_old;
CREATE INDEX idx_vocabulary_due ON vocabulary_progress(scope, due_at, status);

ALTER TABLE vocabulary_reviews ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'
  CHECK (scope IN ('all', 'beginner', 'intermediate', 'advanced', 'cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat'));
CREATE INDEX idx_vocabulary_reviews_scope_time
  ON vocabulary_reviews(scope, word_id, reviewed_at DESC);

DROP INDEX IF EXISTS idx_plan_date;
CREATE TABLE daily_plans_new (
  id TEXT PRIMARY KEY,
  plan_date TEXT NOT NULL,
  target_minutes INTEGER NOT NULL DEFAULT 60,
  target_problems INTEGER NOT NULL DEFAULT 3,
  focus_tags_json TEXT NOT NULL DEFAULT '[]',
  difficulty_ratio_json TEXT NOT NULL DEFAULT '{"easy":0.2,"medium":0.6,"hard":0.2}',
  task_problem_ids_json TEXT NOT NULL DEFAULT '[]',
  review_mistake_ids_json TEXT NOT NULL DEFAULT '[]',
  completed_problem_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  target_algorithm_problems INTEGER NOT NULL DEFAULT 3 CHECK (target_algorithm_problems >= 0),
  target_interview_questions INTEGER NOT NULL DEFAULT 0 CHECK (target_interview_questions >= 0),
  target_vocabulary_words INTEGER NOT NULL DEFAULT 10,
  task_vocabulary_word_ids_json TEXT NOT NULL DEFAULT '[]',
  completed_vocabulary_word_ids_json TEXT NOT NULL DEFAULT '[]',
  vocabulary_previewed_word_ids_json TEXT NOT NULL DEFAULT '[]',
  vocabulary_unfamiliar_word_ids_json TEXT NOT NULL DEFAULT '[]',
  vocabulary_extra_word_ids_json TEXT NOT NULL DEFAULT '[]',
  vocabulary_difficulty TEXT NOT NULL DEFAULT 'all'
    CHECK (vocabulary_difficulty IN ('all', 'beginner', 'intermediate', 'advanced', 'cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat')),
  UNIQUE(plan_date, vocabulary_difficulty)
);
INSERT INTO daily_plans_new(
  id, plan_date, target_minutes, target_problems, focus_tags_json, difficulty_ratio_json,
  task_problem_ids_json, review_mistake_ids_json, completed_problem_ids_json, created_at, updated_at,
  target_algorithm_problems, target_interview_questions, target_vocabulary_words,
  task_vocabulary_word_ids_json, completed_vocabulary_word_ids_json,
  vocabulary_difficulty
)
SELECT
  id, plan_date, target_minutes, target_problems, focus_tags_json, difficulty_ratio_json,
  task_problem_ids_json, review_mistake_ids_json, completed_problem_ids_json, created_at, updated_at,
  target_algorithm_problems, target_interview_questions, target_vocabulary_words,
  task_vocabulary_word_ids_json, completed_vocabulary_word_ids_json,
  COALESCE(vocabulary_difficulty, 'all')
FROM daily_plans;
DROP TABLE daily_plans;
ALTER TABLE daily_plans_new RENAME TO daily_plans;
CREATE INDEX idx_plan_date ON daily_plans(plan_date);
