ALTER TABLE vocabulary_words ADD COLUMN exam_tags_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE daily_plans_new (
  id TEXT PRIMARY KEY,
  plan_date TEXT NOT NULL UNIQUE,
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
  vocabulary_difficulty TEXT CHECK (vocabulary_difficulty IS NULL OR vocabulary_difficulty IN (
    'beginner', 'intermediate', 'advanced', 'cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat'
  ))
);

INSERT INTO daily_plans_new(
  id, plan_date, target_minutes, target_problems, focus_tags_json, difficulty_ratio_json,
  task_problem_ids_json, review_mistake_ids_json, completed_problem_ids_json, created_at, updated_at,
  target_algorithm_problems, target_interview_questions, target_vocabulary_words,
  task_vocabulary_word_ids_json, completed_vocabulary_word_ids_json, vocabulary_difficulty
)
SELECT
  id, plan_date, target_minutes, target_problems, focus_tags_json, difficulty_ratio_json,
  task_problem_ids_json, review_mistake_ids_json, completed_problem_ids_json, created_at, updated_at,
  target_algorithm_problems, target_interview_questions, target_vocabulary_words,
  task_vocabulary_word_ids_json, completed_vocabulary_word_ids_json,
  CASE
    WHEN vocabulary_difficulty IN ('beginner', 'intermediate', 'advanced', 'cet4', 'cet6', 'toefl', 'ielts', 'postgrad', 'sat')
    THEN vocabulary_difficulty
    ELSE NULL
  END
FROM daily_plans;

DROP TABLE daily_plans;
ALTER TABLE daily_plans_new RENAME TO daily_plans;
CREATE INDEX IF NOT EXISTS idx_plan_date ON daily_plans(plan_date);
