use crate::AppPaths;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};
use tauri::State;

const INITIAL_MIGRATION: &str = include_str!("../migrations/001_initial.sql");
const INTERVIEW_WORKBENCH_MIGRATION: &str =
    include_str!("../migrations/002_interview_workbench.sql");
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "initial", INITIAL_MIGRATION),
    (2, "interview_workbench", INTERVIEW_WORKBENCH_MIGRATION),
];

pub fn open_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

pub fn initialize(paths: &AppPaths) -> Result<(), String> {
    paths.ensure()?;
    apply_migrations(&paths.database)
}

pub fn apply_migrations(path: &Path) -> Result<(), String> {
    let mut connection = open_database(path)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               applied_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    for &(version, name, migration) in MIGRATIONS {
        let applied = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?;
        if applied {
            continue;
        }
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(migration)
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, name, applied_at) VALUES(?1, ?2, ?3)",
                params![version, name, now_millis()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn load_snapshot(path: &Path) -> Result<Option<Value>, String> {
    let connection = open_database(path)?;
    let value = connection
        .query_row(
            "SELECT snapshot_json FROM app_state WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    value
        .map(|raw| {
            let snapshot = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
            validate_snapshot_shape(&snapshot)?;
            Ok(snapshot)
        })
        .transpose()
}

pub fn save_snapshot(path: &Path, snapshot: &Value) -> Result<(), String> {
    validate_snapshot_shape(snapshot)?;
    let raw = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    let mut connection = open_database(path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO app_state(id, snapshot_json, updated_at) VALUES(1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
               updated_at = excluded.updated_at",
            params![raw, now_millis()],
        )
        .map_err(|error| error.to_string())?;
    sync_structured_tables(&transaction, snapshot)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn sync_structured_tables(transaction: &Transaction<'_>, snapshot: &Value) -> Result<(), String> {
    transaction
        .execute_batch(
            "DELETE FROM daily_plan_tasks;
             DELETE FROM knowledge_problem_links;
             DELETE FROM knowledge_mistake_links;
             DELETE FROM review_schedules;
             DELETE FROM platform_results;
             DELETE FROM thought_events;
             DELETE FROM ai_generations;
             DELETE FROM mistakes;
             DELETE FROM attempts;
             DELETE FROM samples;
             DELETE FROM problem_tags;
             DELETE FROM knowledge_notes;
             DELETE FROM code_templates;
             DELETE FROM daily_plans;
             DELETE FROM tags;
             DELETE FROM problems;
             DELETE FROM settings;",
        )
        .map_err(|error| error.to_string())?;

    let problems = array_field(snapshot, "problems");
    let problem_ids: HashSet<String> = problems
        .iter()
        .filter_map(|item| string_value(item, "id"))
        .collect();
    for problem in problems {
        let id = required_string(problem, "id")?;
        transaction
            .execute(
                "INSERT INTO problems(id, source, external_id, platform_slug, source_url, platform_status,
                 cache_status, title, difficulty, content, constraints_json, import_method,
                 content_fetched_at, content_hash, connector_version, kind, interview_json,
                 created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    id,
                    value_or(problem, "source", "manual"),
                    optional_string(problem, "externalId"),
                    optional_string(problem, "platformSlug"),
                    optional_string(problem, "sourceUrl"),
                    value_or(problem, "platformStatus", "unknown"),
                    value_or(problem, "cacheStatus", "link-only"),
                    value_or(problem, "title", "未命名题目"),
                    value_or(problem, "difficulty", "unknown"),
                    value_or(problem, "content", ""),
                    json_field(problem, "constraints", Value::Array(vec![])),
                    value_or(problem, "importMethod", "manual"),
                    optional_integer(problem, "contentFetchedAt"),
                    optional_string(problem, "contentHash"),
                    optional_string(problem, "connectorVersion"),
                    value_or(problem, "kind", "algorithm"),
                    json_field(problem, "interview", serde_json::json!({})),
                    integer_value(problem, "createdAt", now_millis()),
                    integer_value(problem, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| format!("同步题目 {id} 失败：{error}"))?;

        for tag in string_array(problem, "tags") {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO tags(id, name) VALUES(?1, ?2)",
                    params![format!("tag:{tag}"), tag],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT OR IGNORE INTO problem_tags(problem_id, tag_id) VALUES(?1, ?2)",
                    params![id, format!("tag:{tag}")],
                )
                .map_err(|error| error.to_string())?;
        }
        for (index, sample) in array_field(problem, "examples").iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO samples(id, problem_id, input, output, explanation, sort_order)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        format!("{id}:sample:{index}"),
                        id,
                        value_or(sample, "input", ""),
                        value_or(sample, "output", ""),
                        optional_string(sample, "explanation"),
                        index as i64,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    let attempts = array_field(snapshot, "attempts");
    let attempt_ids: HashSet<String> = attempts
        .iter()
        .filter_map(|item| string_value(item, "id"))
        .collect();
    for attempt in attempts {
        let id = required_string(attempt, "id")?;
        let problem_id = required_string(attempt, "problemId")?;
        if !problem_ids.contains(&problem_id) {
            continue;
        }
        transaction
            .execute(
                "INSERT INTO attempts(id, problem_id, language, code, started_at, ended_at,
                 duration_seconds, result, hint_level, independent, mastery, notes, mode,
                 interview_json, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    id,
                    problem_id,
                    value_or(attempt, "language", "C++17"),
                    value_or(attempt, "code", ""),
                    integer_value(attempt, "startedAt", now_millis()),
                    optional_integer(attempt, "endedAt"),
                    integer_value(attempt, "durationSeconds", 0),
                    value_or(attempt, "result", "unfinished"),
                    integer_value(attempt, "hintLevel", 0),
                    bool_integer(attempt, "independent"),
                    integer_value(attempt, "mastery", 1),
                    optional_string(attempt, "notes"),
                    value_or(attempt, "mode", "code"),
                    json_field(attempt, "interview", serde_json::json!({})),
                    integer_value(attempt, "createdAt", now_millis()),
                    integer_value(attempt, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| format!("同步练习 {id} 失败：{error}"))?;
    }

    for event in array_field(snapshot, "thoughtEvents") {
        let attempt_id = required_string(event, "attemptId")?;
        if !attempt_ids.contains(&attempt_id) {
            continue;
        }
        transaction
            .execute(
                "INSERT INTO thought_events(id, attempt_id, event_type, content, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                params![
                    required_string(event, "id")?,
                    attempt_id,
                    value_or(event, "type", "note"),
                    value_or(event, "content", ""),
                    integer_value(event, "createdAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for result in array_field(snapshot, "platformResults") {
        let problem_id = required_string(result, "problemId")?;
        if !problem_ids.contains(&problem_id) {
            continue;
        }
        let attempt_id =
            optional_string(result, "attemptId").filter(|value| attempt_ids.contains(value));
        transaction
            .execute(
                "INSERT INTO platform_results(id, problem_id, attempt_id, source, result,
                 is_user_confirmed, recorded_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    required_string(result, "id")?,
                    problem_id,
                    attempt_id,
                    value_or(result, "source", "leetcode-cn"),
                    value_or(result, "result", "unfinished"),
                    bool_integer(result, "manuallyConfirmed"),
                    integer_value(result, "submittedAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    let mistakes = array_field(snapshot, "mistakes");
    let mistake_ids: HashSet<String> = mistakes
        .iter()
        .filter_map(|item| string_value(item, "id"))
        .collect();
    let mistake_problem_ids: HashMap<String, String> = mistakes
        .iter()
        .filter_map(|mistake| {
            Some((
                string_value(mistake, "id")?,
                string_value(mistake, "problemId")?,
            ))
        })
        .collect();
    for mistake in mistakes {
        let problem_id = required_string(mistake, "problemId")?;
        if !problem_ids.contains(&problem_id) {
            continue;
        }
        let attempt_id =
            optional_string(mistake, "attemptId").filter(|value| attempt_ids.contains(value));
        transaction
            .execute(
                "INSERT INTO mistakes(id, problem_id, attempt_id, category, root_cause, correction,
                 next_checklist_item, next_review_at, interval_days, review_stage, last_reviewed_at,
                 successful_reviews, failed_reviews, status, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    required_string(mistake, "id")?,
                    problem_id,
                    attempt_id,
                    value_or(mistake, "category", "other"),
                    value_or(mistake, "rootCause", ""),
                    value_or(mistake, "correction", ""),
                    value_or(mistake, "nextChecklistItem", ""),
                    integer_value(mistake, "nextReviewAt", now_millis()),
                    integer_value(mistake, "intervalDays", 1),
                    integer_value(mistake, "reviewStage", 0),
                    optional_integer(mistake, "lastReviewedAt"),
                    integer_value(mistake, "successfulReviews", 0),
                    integer_value(mistake, "failedReviews", 0),
                    value_or(mistake, "status", "active"),
                    integer_value(mistake, "createdAt", now_millis()),
                    integer_value(mistake, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for note in array_field(snapshot, "knowledgeNotes") {
        let id = required_string(note, "id")?;
        transaction
            .execute(
                "INSERT INTO knowledge_notes(id, title, content, tags_json, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    value_or(note, "title", "未命名笔记"),
                    value_or(note, "content", ""),
                    json_field(note, "tags", Value::Array(vec![])),
                    integer_value(note, "createdAt", now_millis()),
                    integer_value(note, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
        for problem_id in string_array(note, "relatedProblemIds") {
            if problem_ids.contains(&problem_id) {
                transaction
                    .execute(
                        "INSERT INTO knowledge_problem_links(note_id, problem_id) VALUES(?1, ?2)",
                        params![id, problem_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
        for mistake_id in string_array(note, "relatedMistakeIds") {
            if mistake_ids.contains(&mistake_id) {
                transaction
                    .execute(
                        "INSERT INTO knowledge_mistake_links(note_id, mistake_id) VALUES(?1, ?2)",
                        params![id, mistake_id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    for template in array_field(snapshot, "codeTemplates") {
        transaction
            .execute(
                "INSERT INTO code_templates(id, title, language, code, tags_json, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    required_string(template, "id")?,
                    value_or(template, "title", "未命名模板"),
                    value_or(template, "language", "C++17"),
                    value_or(template, "code", ""),
                    json_field(template, "tags", Value::Array(vec![])),
                    integer_value(template, "createdAt", now_millis()),
                    integer_value(template, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    for plan in array_field(snapshot, "dailyPlans") {
        let id = required_string(plan, "id")?;
        let target_problems = integer_value(plan, "targetProblems", 3);
        transaction
            .execute(
                "INSERT INTO daily_plans(id, plan_date, target_minutes, target_problems,
                 target_algorithm_problems, target_interview_questions, focus_tags_json,
                 difficulty_ratio_json, task_problem_ids_json, review_mistake_ids_json,
                 completed_problem_ids_json, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    value_or(plan, "date", "1970-01-01"),
                    integer_value(plan, "targetMinutes", 60),
                    target_problems,
                    integer_value(plan, "targetAlgorithmProblems", target_problems),
                    integer_value(plan, "targetInterviewQuestions", 0),
                    json_field(plan, "focusTags", Value::Array(vec![])),
                    json_field(plan, "difficultyRatio", serde_json::json!({})),
                    json_field(plan, "taskProblemIds", Value::Array(vec![])),
                    json_field(plan, "reviewMistakeIds", Value::Array(vec![])),
                    json_field(plan, "completedProblemIds", Value::Array(vec![])),
                    integer_value(plan, "createdAt", now_millis()),
                    integer_value(plan, "updatedAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
        let completed: HashSet<String> = string_array(plan, "completedProblemIds")
            .into_iter()
            .collect();
        let review_mistake_ids: HashSet<String> =
            string_array(plan, "reviewMistakeIds").into_iter().collect();
        let review_problem_ids: HashSet<String> = review_mistake_ids
            .iter()
            .filter_map(|mistake_id| mistake_problem_ids.get(mistake_id).cloned())
            .collect();
        for (index, problem_id) in string_array(plan, "taskProblemIds").into_iter().enumerate() {
            if problem_ids.contains(&problem_id) {
                let task_type = if review_problem_ids.contains(&problem_id) {
                    "review"
                } else {
                    "new"
                };
                transaction
                    .execute(
                        "INSERT INTO daily_plan_tasks(plan_id, problem_id, task_type, sort_order, completed_at)
                         VALUES(?1, ?2, ?3, ?4, ?5)",
                        params![
                            id,
                            problem_id,
                            task_type,
                            index as i64,
                            completed.contains(&problem_id).then_some(now_millis()),
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    for generation in array_field(snapshot, "aiGenerations") {
        let problem_id = required_string(generation, "problemId")?;
        if !problem_ids.contains(&problem_id) {
            continue;
        }
        transaction
            .execute(
                "INSERT INTO ai_generations(id, problem_id, attempt_id, model, hint_level,
                 request_summary, response_text, created_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    required_string(generation, "id")?,
                    problem_id,
                    optional_string(generation, "attemptId")
                        .filter(|value| attempt_ids.contains(value)),
                    value_or(generation, "model", "unknown"),
                    integer_value(generation, "level", 1),
                    value_or(generation, "prompt", ""),
                    value_or(generation, "response", ""),
                    integer_value(generation, "createdAt", now_millis()),
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    if let Some(settings) = snapshot.get("settings").and_then(Value::as_object) {
        for (key, value) in settings {
            transaction
                .execute(
                    "INSERT INTO settings(setting_key, setting_value_json, updated_at)
                     VALUES(?1, ?2, ?3)",
                    params![key, value.to_string(), now_millis()],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNoteRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub related_problem_ids: Vec<String>,
    pub related_mistake_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub fn search_knowledge(
    state: State<'_, crate::AppState>,
    query: String,
) -> Result<Vec<KnowledgeNoteRecord>, String> {
    let connection = open_database(&state.paths.database)?;
    let fts_query = normalize_fts_query(&query);
    let sql = if fts_query.is_empty() {
        "SELECT id, title, content, tags_json, created_at, updated_at
         FROM knowledge_notes ORDER BY updated_at DESC LIMIT 50"
    } else {
        "SELECT n.id, n.title, n.content, n.tags_json, n.created_at, n.updated_at
         FROM knowledge_fts
         JOIN knowledge_notes n ON n.rowid = knowledge_fts.rowid
         WHERE knowledge_fts MATCH ?1
         ORDER BY bm25(knowledge_fts, 6.0, 2.0, 3.0), n.updated_at DESC LIMIT 50"
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let mapper = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    };
    let basics: Vec<_> = if fts_query.is_empty() {
        statement
            .query_map([], mapper)
            .map_err(|error| error.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?
    } else {
        statement
            .query_map([fts_query], mapper)
            .map_err(|error| error.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?
    };
    drop(statement);

    basics
        .into_iter()
        .map(|(id, title, content, tags_json, created_at, updated_at)| {
            Ok(KnowledgeNoteRecord {
                related_problem_ids: related_ids(
                    &connection,
                    "knowledge_problem_links",
                    "problem_id",
                    &id,
                )?,
                related_mistake_ids: related_ids(
                    &connection,
                    "knowledge_mistake_links",
                    "mistake_id",
                    &id,
                )?,
                id,
                title,
                content,
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                created_at,
                updated_at,
            })
        })
        .collect()
}

fn related_ids(
    connection: &Connection,
    table: &str,
    column: &str,
    note_id: &str,
) -> Result<Vec<String>, String> {
    let sql = format!("SELECT {column} FROM {table} WHERE note_id = ?1 ORDER BY {column}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let result = statement
        .query_map([note_id], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string());
    result
}

fn normalize_fts_query(query: &str) -> String {
    query
        .split(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    ',' | '，' | '.' | '。' | ';' | '；' | ':' | '：' | '/' | '\\'
                )
        })
        .filter(|token| !token.is_empty())
        .take(12)
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn array_field<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn validate_snapshot_shape(snapshot: &Value) -> Result<(), String> {
    const COLLECTION_FIELDS: &[&str] = &[
        "problems",
        "attempts",
        "thoughtEvents",
        "platformResults",
        "mistakes",
        "knowledgeNotes",
        "codeTemplates",
        "dailyPlans",
        "aiGenerations",
    ];

    let object = snapshot
        .as_object()
        .ok_or_else(|| "应用数据快照必须是 JSON 对象".to_string())?;
    for field in COLLECTION_FIELDS {
        if object.get(*field).is_some_and(|value| !value.is_array()) {
            return Err(format!("应用数据快照字段 {field} 必须是数组"));
        }
    }
    if object
        .get("settings")
        .is_some_and(|value| !value.is_object())
    {
        return Err("应用数据快照字段 settings 必须是 JSON 对象".to_string());
    }
    Ok(())
}

fn string_value(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    string_value(value, key).ok_or_else(|| format!("数据字段 {key} 缺失"))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    string_value(value, key).filter(|value| !value.is_empty())
}

fn value_or(value: &Value, key: &str, default: &str) -> String {
    string_value(value, key).unwrap_or_else(|| default.to_string())
}

fn integer_value(value: &Value, key: &str, default: i64) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(default)
}

fn optional_integer(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn bool_integer(value: &Value, key: &str) -> i64 {
    i64::from(value.get(key).and_then(Value::as_bool).unwrap_or(false))
}

fn string_array(value: &Value, key: &str) -> Vec<String> {
    array_field(value, key)
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn json_field(value: &Value, key: &str, default: Value) -> String {
    value.get(key).unwrap_or(&default).to_string()
}

pub fn checkpoint(path: &Path) -> Result<(), String> {
    let connection = open_database(path)?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| error.to_string())
}

pub fn platform_last_url(path: &Path, source: &str) -> Result<Option<String>, String> {
    let connection = open_database(path)?;
    connection
        .query_row(
            "SELECT last_url FROM platform_sessions WHERE source = ?1",
            [source],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

pub fn upsert_platform_session(
    path: &Path,
    source: &str,
    url: &str,
    profile: &Path,
) -> Result<(), String> {
    let connection = open_database(path)?;
    connection
        .execute(
            "INSERT INTO platform_sessions(source, last_url, profile_directory, last_opened_at, status)
             VALUES(?1, ?2, ?3, ?4, 'ready')
             ON CONFLICT(source) DO UPDATE SET last_url = excluded.last_url,
               profile_directory = excluded.profile_directory,
               last_opened_at = excluded.last_opened_at,
               status = 'ready'",
            params![source, url, profile.to_string_lossy(), now_millis()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn clear_platform_session(path: &Path, source: &str) -> Result<(), String> {
    let connection = open_database(path)?;
    connection
        .execute("DELETE FROM platform_sessions WHERE source = ?1", [source])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migration_versions(path: &Path) -> Vec<i64> {
        let connection = open_database(path).unwrap();
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn table_columns(path: &Path, table: &str) -> Vec<String> {
        let connection = open_database(path).unwrap();
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        statement
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn minimal_snapshot(problems: Value) -> Value {
        serde_json::json!({
            "problems": problems,
            "attempts": [],
            "thoughtEvents": [],
            "platformResults": [],
            "mistakes": [],
            "knowledgeNotes": [],
            "codeTemplates": [],
            "dailyPlans": [],
            "aiGenerations": [],
            "settings": {}
        })
    }

    #[test]
    fn v1_database_upgrades_to_interview_schema() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        let connection = open_database(&path).unwrap();
        connection.execute_batch(INITIAL_MIGRATION).unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations(version, name, applied_at)
                 VALUES(1, 'initial', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO problems(id, source, title, created_at, updated_at)
                 VALUES('legacy-problem', 'manual', '旧算法题', 1, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO attempts(id, problem_id, language, started_at, created_at, updated_at)
                 VALUES('legacy-attempt', 'legacy-problem', 'C++17', 1, 1, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO daily_plans(id, plan_date, target_problems, created_at, updated_at)
                 VALUES('legacy-plan', '2026-07-23', 7, 1, 1)",
                [],
            )
            .unwrap();
        drop(connection);

        apply_migrations(&path).unwrap();

        assert_eq!(migration_versions(&path), vec![1, 2]);
        assert!(table_columns(&path, "problems").contains(&"kind".to_string()));
        assert!(table_columns(&path, "problems").contains(&"interview_json".to_string()));
        assert!(table_columns(&path, "attempts").contains(&"mode".to_string()));
        assert!(table_columns(&path, "attempts").contains(&"interview_json".to_string()));
        assert!(
            table_columns(&path, "daily_plans").contains(&"target_algorithm_problems".to_string())
        );
        assert!(
            table_columns(&path, "daily_plans").contains(&"target_interview_questions".to_string())
        );

        let connection = open_database(&path).unwrap();
        let problem_values: (String, String) = connection
            .query_row(
                "SELECT kind, interview_json FROM problems WHERE id = 'legacy-problem'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(problem_values, ("algorithm".into(), "{}".into()));
        let attempt_values: (String, String) = connection
            .query_row(
                "SELECT mode, interview_json FROM attempts WHERE id = 'legacy-attempt'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(attempt_values, ("code".into(), "{}".into()));
        let plan_values: (i64, i64) = connection
            .query_row(
                "SELECT target_algorithm_problems, target_interview_questions
                 FROM daily_plans WHERE id = 'legacy-plan'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(plan_values, (7, 0));
        assert!(connection
            .execute(
                "UPDATE problems SET kind = 'invalid' WHERE id = 'legacy-problem'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE attempts SET mode = 'invalid' WHERE id = 'legacy-attempt'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE daily_plans SET target_algorithm_problems = -1
                 WHERE id = 'legacy-plan'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE daily_plans SET target_interview_questions = -1
                 WHERE id = 'legacy-plan'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE problems SET interview_json = '[]' WHERE id = 'legacy-problem'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE attempts SET interview_json = 'not-json' WHERE id = 'legacy-attempt'",
                [],
            )
            .is_err());
    }

    #[test]
    fn failed_migration_rolls_back_all_statements_and_version_record() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        let connection = open_database(&path).unwrap();
        connection.execute_batch(INITIAL_MIGRATION).unwrap();
        connection
            .execute(
                "INSERT INTO schema_migrations(version, name, applied_at)
                 VALUES(1, 'initial', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "ALTER TABLE daily_plans ADD COLUMN target_algorithm_problems INTEGER NOT NULL DEFAULT 3",
                [],
            )
            .unwrap();
        drop(connection);

        assert!(apply_migrations(&path).is_err());

        assert_eq!(migration_versions(&path), vec![1]);
        assert!(!table_columns(&path, "problems").contains(&"kind".to_string()));
        assert!(!table_columns(&path, "problems").contains(&"interview_json".to_string()));
        assert!(!table_columns(&path, "attempts").contains(&"mode".to_string()));
        assert!(!table_columns(&path, "attempts").contains(&"interview_json".to_string()));
    }

    #[test]
    fn applying_all_migrations_twice_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");

        apply_migrations(&path).unwrap();
        apply_migrations(&path).unwrap();

        assert_eq!(migration_versions(&path), vec![1, 2]);
        assert_eq!(
            table_columns(&path, "problems")
                .iter()
                .filter(|column| column.as_str() == "kind")
                .count(),
            1
        );
    }

    #[test]
    fn load_snapshot_rejects_non_object_root() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let connection = open_database(&path).unwrap();
        connection
            .execute(
                "INSERT INTO app_state(id, snapshot_json, updated_at) VALUES(1, '[]', 1)",
                [],
            )
            .unwrap();
        drop(connection);

        let error = load_snapshot(&path).unwrap_err();
        assert!(error.contains("JSON 对象"), "实际错误：{error}");
    }

    #[test]
    fn load_snapshot_rejects_non_array_collection() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let connection = open_database(&path).unwrap();
        connection
            .execute(
                "INSERT INTO app_state(id, snapshot_json, updated_at)
                 VALUES(1, '{\"problems\":{}}', 1)",
                [],
            )
            .unwrap();
        drop(connection);

        let error = load_snapshot(&path).unwrap_err();
        assert!(
            error.contains("problems") && error.contains("数组"),
            "实际错误：{error}"
        );
    }

    #[test]
    fn save_snapshot_rejects_non_array_collection_without_touching_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let original = minimal_snapshot(serde_json::json!([]));
        save_snapshot(&path, &original).unwrap();

        let invalid = serde_json::json!({"problems": {}});
        let error = save_snapshot(&path, &invalid).unwrap_err();

        assert!(
            error.contains("problems") && error.contains("数组"),
            "实际错误：{error}"
        );
        assert_eq!(load_snapshot(&path).unwrap(), Some(original));
    }

    #[test]
    fn failed_structured_sync_preserves_previous_snapshot_and_tables() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let original = minimal_snapshot(serde_json::json!([{
            "id": "original-problem", "title": "原题", "source": "manual",
            "difficulty": "easy", "tags": [], "content": "原始内容",
            "constraints": [], "examples": [], "createdAt": 1, "updatedAt": 1
        }]));
        save_snapshot(&path, &original).unwrap();
        let replacement = minimal_snapshot(serde_json::json!([{
            "id": "invalid-problem", "title": "坏题", "source": "invalid-source",
            "difficulty": "easy", "tags": [], "content": "不应落库",
            "constraints": [], "examples": [], "createdAt": 2, "updatedAt": 2
        }]));

        assert!(save_snapshot(&path, &replacement).is_err());

        assert_eq!(load_snapshot(&path).unwrap(), Some(original));
        let connection = open_database(&path).unwrap();
        let rows: Vec<(String, String)> = connection
            .prepare("SELECT id, content FROM problems ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows, vec![("original-problem".into(), "原始内容".into())]);
    }

    #[test]
    fn interview_snapshot_round_trips_into_structured_tables() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let problem_interview = serde_json::json!({
            "contentOrigin": "user",
            "primaryRole": "backend",
            "roles": ["backend"],
            "category": "数据库",
            "format": "scenario",
            "keyPoints": ["隔离级别", "锁"],
            "referenceAnswer": "按事务边界分析。",
            "followUps": ["如何定位死锁？"]
        });
        let attempt_interview = serde_json::json!({
            "answerText": "先确认事务范围。",
            "aiFeedback": "补充锁等待分析。",
            "masteryResult": "uncertain"
        });
        let mut snapshot = minimal_snapshot(serde_json::json!([{
            "id": "interview-1",
            "kind": "interview",
            "title": "如何排查数据库死锁？",
            "source": "manual",
            "difficulty": "medium",
            "tags": ["数据库"],
            "content": "说明排查路径。",
            "constraints": [],
            "examples": [],
            "interview": problem_interview,
            "createdAt": 1,
            "updatedAt": 1
        }]));
        snapshot["attempts"] = serde_json::json!([{
            "id": "attempt-1",
            "problemId": "interview-1",
            "mode": "interview",
            "language": "",
            "code": "",
            "startedAt": 2,
            "durationSeconds": 120,
            "result": "uncertain",
            "hintLevel": 0,
            "independent": true,
            "mastery": 3,
            "interview": attempt_interview,
            "createdAt": 2,
            "updatedAt": 3
        }]);
        snapshot["dailyPlans"] = serde_json::json!([{
            "id": "plan-1",
            "date": "2026-07-23",
            "targetMinutes": 60,
            "targetProblems": 5,
            "targetAlgorithmProblems": 3,
            "targetInterviewQuestions": 2,
            "taskProblemIds": ["interview-1"],
            "reviewMistakeIds": [],
            "completedProblemIds": [],
            "focusTags": [],
            "difficultyRatio": {},
            "createdAt": 1,
            "updatedAt": 1
        }]);

        save_snapshot(&path, &snapshot).unwrap();

        assert_eq!(load_snapshot(&path).unwrap(), Some(snapshot));
        let connection = open_database(&path).unwrap();
        let problem_row: (String, String) = connection
            .query_row(
                "SELECT kind, interview_json FROM problems WHERE id = 'interview-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(problem_row.0, "interview");
        assert_eq!(
            serde_json::from_str::<Value>(&problem_row.1).unwrap(),
            problem_interview
        );
        let attempt_row: (String, String) = connection
            .query_row(
                "SELECT mode, interview_json FROM attempts WHERE id = 'attempt-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(attempt_row.0, "interview");
        assert_eq!(
            serde_json::from_str::<Value>(&attempt_row.1).unwrap(),
            attempt_interview
        );
        let plan_row: (i64, i64) = connection
            .query_row(
                "SELECT target_algorithm_problems, target_interview_questions
                 FROM daily_plans WHERE id = 'plan-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(plan_row, (3, 2));
    }

    #[test]
    fn daily_plan_tasks_classify_review_and_new_problems() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let mut snapshot = minimal_snapshot(serde_json::json!([
            {
                "id": "review-problem", "title": "复习题", "source": "manual",
                "difficulty": "medium", "tags": [], "content": "",
                "constraints": [], "examples": [], "createdAt": 1, "updatedAt": 1
            },
            {
                "id": "new-problem", "title": "新题", "source": "manual",
                "difficulty": "easy", "tags": [], "content": "",
                "constraints": [], "examples": [], "createdAt": 1, "updatedAt": 1
            }
        ]));
        snapshot["mistakes"] = serde_json::json!([{
            "id": "mistake-1",
            "problemId": "review-problem",
            "category": "concept",
            "rootCause": "概念遗漏",
            "correction": "重新复述",
            "nextChecklistItem": "覆盖关键点",
            "nextReviewAt": 1,
            "createdAt": 1,
            "updatedAt": 1
        }]);
        snapshot["dailyPlans"] = serde_json::json!([{
            "id": "plan-1",
            "date": "2026-07-23",
            "taskProblemIds": ["review-problem", "new-problem"],
            "reviewMistakeIds": ["mistake-1"],
            "completedProblemIds": [],
            "createdAt": 1,
            "updatedAt": 1
        }]);

        save_snapshot(&path, &snapshot).unwrap();

        let connection = open_database(&path).unwrap();
        let mut statement = connection
            .prepare(
                "SELECT problem_id, task_type FROM daily_plan_tasks
                 WHERE plan_id = 'plan-1' ORDER BY sort_order",
            )
            .unwrap();
        let tasks: Vec<(String, String)> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            tasks,
            vec![
                ("review-problem".into(), "review".into()),
                ("new-problem".into(), "new".into())
            ]
        );
    }

    #[test]
    fn migrations_and_snapshot_round_trip_work() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("xiti.sqlite");
        apply_migrations(&path).unwrap();
        let snapshot = serde_json::json!({
            "problems": [{
                "id": "p1", "title": "两数之和", "source": "manual",
                "difficulty": "easy", "tags": ["哈希表"], "content": "查找目标和",
                "constraints": [], "examples": [], "createdAt": 1, "updatedAt": 1
            }],
            "attempts": [], "thoughtEvents": [], "platformResults": [], "mistakes": [],
            "knowledgeNotes": [{
                "id": "n1", "title": "哈希表查找", "content": "用补数降低复杂度",
                "tags": ["哈希表"], "relatedProblemIds": ["p1"], "relatedMistakeIds": [],
                "createdAt": 1, "updatedAt": 2
            }],
            "codeTemplates": [], "dailyPlans": [], "aiGenerations": [], "settings": {}
        });
        save_snapshot(&path, &snapshot).unwrap();
        assert_eq!(load_snapshot(&path).unwrap(), Some(snapshot));

        let connection = open_database(&path).unwrap();
        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(table_count >= 15);
        let fts_matches: i64 = connection
            .query_row(
                "SELECT count(*) FROM knowledge_fts WHERE knowledge_fts MATCH '哈希表'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_matches, 1);
    }
}
