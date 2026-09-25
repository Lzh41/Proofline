CREATE TABLE problems_with_platform_sources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('leetcode-cn', 'leetcode', 'nowcoder', 'luogu', 'manual', 'screenshot')),
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
  updated_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'algorithm' CHECK (kind IN ('algorithm', 'interview')),
  interview_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(interview_json) AND json_type(interview_json) = 'object')
);

INSERT INTO problems_with_platform_sources(
  id, source, external_id, platform_slug, source_url, platform_status,
  cache_status, title, difficulty, content, constraints_json, import_method,
  content_fetched_at, content_hash, connector_version, created_at, updated_at,
  kind, interview_json
)
SELECT id, source, external_id, platform_slug, source_url, platform_status,
  cache_status, title, difficulty, content, constraints_json, import_method,
  content_fetched_at, content_hash, connector_version, created_at, updated_at,
  kind, interview_json
FROM problems;

DROP TABLE problems;
ALTER TABLE problems_with_platform_sources RENAME TO problems;
CREATE UNIQUE INDEX IF NOT EXISTS idx_problem_platform
  ON problems(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_problem_updated ON problems(updated_at DESC);

CREATE TABLE platform_sessions_with_sources (
  source TEXT PRIMARY KEY CHECK (source IN ('leetcode-cn', 'leetcode', 'nowcoder', 'luogu')),
  last_url TEXT,
  profile_directory TEXT NOT NULL,
  last_opened_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ready'
);

INSERT INTO platform_sessions_with_sources(source, last_url, profile_directory, last_opened_at, status)
SELECT source, last_url, profile_directory, last_opened_at, status
FROM platform_sessions;

DROP TABLE platform_sessions;
ALTER TABLE platform_sessions_with_sources RENAME TO platform_sessions;
