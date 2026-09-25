CREATE TABLE IF NOT EXISTS vocabulary_words (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  phonetic TEXT,
  part_of_speech TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'B1',
  difficulty TEXT NOT NULL DEFAULT 'intermediate'
    CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  meaning_zh TEXT NOT NULL,
  definition_en TEXT NOT NULL DEFAULT '',
  example_en TEXT NOT NULL DEFAULT '',
  example_zh TEXT NOT NULL DEFAULT '',
  word_family_json TEXT NOT NULL DEFAULT '[]',
  memory_tip TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_difficulty_word
  ON vocabulary_words(difficulty, word);

CREATE TABLE IF NOT EXISTS vocabulary_progress (
  word_id TEXT PRIMARY KEY REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'learning', 'review', 'mastered')),
  repetitions INTEGER NOT NULL DEFAULT 0,
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  lapses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_rating TEXT CHECK (last_rating IS NULL OR last_rating IN ('again', 'hard', 'good', 'easy')),
  due_at INTEGER NOT NULL,
  last_reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_due
  ON vocabulary_progress(due_at, status);

CREATE TABLE IF NOT EXISTS vocabulary_reviews (
  id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  reviewed_at INTEGER NOT NULL,
  direction TEXT NOT NULL
    CHECK (direction IN ('word-to-meaning', 'meaning-to-word')),
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  response TEXT NOT NULL DEFAULT '',
  correct INTEGER NOT NULL DEFAULT 0 CHECK (correct IN (0, 1)),
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_reviews_word_time
  ON vocabulary_reviews(word_id, reviewed_at DESC);

ALTER TABLE daily_plans ADD COLUMN target_vocabulary_words INTEGER NOT NULL DEFAULT 10;
ALTER TABLE daily_plans ADD COLUMN task_vocabulary_word_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE daily_plans ADD COLUMN completed_vocabulary_word_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE daily_plans ADD COLUMN vocabulary_difficulty TEXT
  CHECK (vocabulary_difficulty IS NULL OR vocabulary_difficulty IN ('beginner', 'intermediate', 'advanced'));
