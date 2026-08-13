ALTER TABLE problems ADD COLUMN kind TEXT NOT NULL DEFAULT 'algorithm'
  CHECK (kind IN ('algorithm', 'interview'));
ALTER TABLE problems ADD COLUMN interview_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(interview_json) AND json_type(interview_json) = 'object');

ALTER TABLE attempts ADD COLUMN mode TEXT NOT NULL DEFAULT 'code'
  CHECK (mode IN ('code', 'interview'));
ALTER TABLE attempts ADD COLUMN interview_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(interview_json) AND json_type(interview_json) = 'object');

ALTER TABLE daily_plans ADD COLUMN target_algorithm_problems INTEGER NOT NULL DEFAULT 3
  CHECK (target_algorithm_problems >= 0);
ALTER TABLE daily_plans ADD COLUMN target_interview_questions INTEGER NOT NULL DEFAULT 0
  CHECK (target_interview_questions >= 0);

UPDATE daily_plans
SET target_algorithm_problems = target_problems,
    target_interview_questions = 0;
