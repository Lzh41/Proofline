PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('leetcode-cn', 'leetcode', 'nowcoder', 'manual', 'screenshot')),
  external_id TEXT,
  platform_slug TEXT,
  source_url TEXT,
  platform_status TEXT NOT NULL DEFAULT 'unknown',
  cache_status TEXT NOT NULL DEFAULT 'link-only',
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'unknown',
  content TEXT NOT NULL DEFAULT '',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  import_method TEXT NOT NULL DEFAULT 'manual',
  content_fetched_at INTEGER,
  content_hash TEXT,
  connector_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_problem_platform
  ON problems(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_problem_updated ON problems(updated_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);

CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  explanation TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  problem_id TEXT REFERENCES problems(id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'draft',
  hint_level INTEGER NOT NULL DEFAULT 0 CHECK (hint_level BETWEEN 0 AND 5),
  independent INTEGER NOT NULL DEFAULT 0,
  mastery INTEGER NOT NULL DEFAULT 1 CHECK (mastery BETWEEN 1 AND 5),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempt_problem_time ON attempts(problem_id, started_at DESC);

CREATE TABLE IF NOT EXISTS thought_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thought_attempt_time ON thought_events(attempt_id, created_at);

CREATE TABLE IF NOT EXISTS platform_results (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'wrong-answer', 'timeout', 'unfinished')),
  is_user_confirmed INTEGER NOT NULL DEFAULT 1,
  recorded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  correction TEXT NOT NULL,
  next_checklist_item TEXT NOT NULL,
  next_review_at INTEGER NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  review_stage INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  successful_reviews INTEGER NOT NULL DEFAULT 0,
  failed_reviews INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mistake_review ON mistakes(status, next_review_at);

CREATE TABLE IF NOT EXISTS review_schedules (
  id TEXT PRIMARY KEY,
  mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  reviewed_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  previous_interval_days INTEGER NOT NULL,
  next_interval_days INTEGER NOT NULL,
  next_review_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_problem_links (
  note_id TEXT NOT NULL REFERENCES knowledge_notes(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, problem_id)
);

CREATE TABLE IF NOT EXISTS knowledge_mistake_links (
  note_id TEXT NOT NULL REFERENCES knowledge_notes(id) ON DELETE CASCADE,
  mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, mistake_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title,
  content,
  tags
);

CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge_notes BEGIN
  INSERT INTO knowledge_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge_notes BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge_notes BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
  INSERT INTO knowledge_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags_json);
END;

CREATE TABLE IF NOT EXISTS code_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_plans (
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
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_date ON daily_plans(plan_date);

CREATE TABLE IF NOT EXISTS daily_plan_tasks (
  plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('review', 'new')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (plan_id, problem_id)
);

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  problem_id TEXT REFERENCES problems(id) ON DELETE SET NULL,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  hint_level INTEGER NOT NULL CHECK (hint_level BETWEEN 1 AND 5),
  request_summary TEXT NOT NULL,
  response_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  source TEXT PRIMARY KEY CHECK (source IN ('leetcode-cn', 'leetcode', 'nowcoder')),
  last_url TEXT,
  profile_directory TEXT NOT NULL,
  last_opened_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ready'
);
