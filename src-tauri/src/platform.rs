use crate::{db, AppState};
use dom_query::{Document, NodeData, NodeRef};
use html5ever::{parse_document, tree_builder::TreeBuilderOpts, ParseOpts};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::PathBuf, time::Duration};
use tauri::{
    ipc::Channel,
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;
use tendril::TendrilSink;
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCodeSnippet {
    pub language: String,
    pub language_slug: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicProblemExample {
    pub input: String,
    pub output: String,
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicProblemMetadata {
    pub title: Option<String>,
    pub external_id: Option<String>,
    pub platform_slug: Option<String>,
    pub difficulty: Option<String>,
    pub tags: Vec<String>,
    pub content: Option<String>,
    pub examples: Vec<PublicProblemExample>,
    pub code_snippets: Vec<PublicCodeSnippet>,
    pub sample_test_case: Option<String>,
    pub cache_status: &'static str,
    pub import_method: &'static str,
    pub content_fetched_at: i64,
    pub content_hash: Option<String>,
    pub connector_version: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformBatchFetchItem {
    pub requested_id: String,
    pub status: &'static str,
    pub source_url: Option<String>,
    pub metadata: Option<PublicProblemMetadata>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformBatchFetchResult {
    pub source: PlatformSource,
    pub requested_count: usize,
    pub fetched_count: usize,
    pub paid_only_count: usize,
    pub not_found_count: usize,
    pub failed_count: usize,
    pub cancelled: bool,
    pub items: Vec<PlatformBatchFetchItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum PlatformBatchProgress {
    Started {
        total: usize,
    },
    Progress {
        completed: usize,
        total: usize,
        current_id: String,
        fetched: usize,
        failed: usize,
    },
    Done {
        completed: usize,
        total: usize,
        cancelled: bool,
    },
}

#[derive(Debug, Clone)]
struct LeetcodeCatalogEntry {
    id: String,
    slug: String,
    title: Option<String>,
    difficulty: Option<String>,
    paid_only: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PlatformSource {
    LeetcodeCn,
    Leetcode,
    Nowcoder,
}

impl PlatformSource {
    pub fn slug(self) -> &'static str {
        match self {
            Self::LeetcodeCn => "leetcode-cn",
            Self::Leetcode => "leetcode",
            Self::Nowcoder => "nowcoder",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::LeetcodeCn => "力扣",
            Self::Leetcode => "LeetCode",
            Self::Nowcoder => "牛客",
        }
    }

    fn home_url(self) -> &'static str {
        match self {
            Self::LeetcodeCn => "https://leetcode.cn/problemset/",
            Self::Leetcode => "https://leetcode.com/problemset/",
            Self::Nowcoder => "https://www.nowcoder.com/exam/oj",
        }
    }

    fn allowed_hosts(self) -> &'static [&'static str] {
        match self {
            Self::LeetcodeCn => &["leetcode.cn", "www.leetcode.cn"],
            Self::Leetcode => &["leetcode.com", "www.leetcode.com"],
            Self::Nowcoder => &[
                "nowcoder.com",
                "www.nowcoder.com",
                "ac.nowcoder.com",
                "passport.nowcoder.com",
            ],
        }
    }

    fn graphql_url(self) -> Option<&'static str> {
        match self {
            Self::LeetcodeCn => Some("https://leetcode.cn/graphql/"),
            Self::Leetcode => Some("https://leetcode.com/graphql/"),
            Self::Nowcoder => None,
        }
    }
}

pub fn is_allowed_platform_url(source: PlatformSource, url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            source
                .allowed_hosts()
                .contains(&host.to_ascii_lowercase().as_str())
        })
}

fn validated_initial_url(state: &AppState, source: PlatformSource) -> Url {
    db::platform_last_url(&state.paths.database, source.slug())
        .ok()
        .flatten()
        .and_then(|saved| Url::parse(&saved).ok())
        .filter(|url| is_allowed_platform_url(source, url))
        .unwrap_or_else(|| Url::parse(source.home_url()).expect("平台首页必须是有效网址"))
}

fn profile_directory(state: &AppState, source: PlatformSource) -> PathBuf {
    state.paths.platforms.join(source.slug())
}

fn platform_window(app: &AppHandle, source: PlatformSource) -> Option<WebviewWindow> {
    app.get_webview_window(&format!("platform-{}", source.slug()))
}

#[tauri::command]
pub async fn open_platform(
    app: AppHandle,
    state: State<'_, AppState>,
    source: PlatformSource,
) -> Result<(), String> {
    if let Some(window) = platform_window(&app, source) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let profile = profile_directory(&state, source);
    std::fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    let initial_url = validated_initial_url(&state, source);
    let navigation_app = app.clone();
    let popup_app = app.clone();

    let window = WebviewWindowBuilder::new(
        &app,
        format!("platform-{}", source.slug()),
        WebviewUrl::External(initial_url.clone()),
    )
    .title(format!("Proofline · {}", source.title()))
    .inner_size(1080.0, 820.0)
    .min_inner_size(620.0, 480.0)
    .data_directory(profile.clone())
    .on_navigation(move |url| {
        if is_allowed_platform_url(source, url) {
            true
        } else {
            let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>);
            false
        }
    })
    .on_new_window(move |url, _features| {
        if matches!(url.scheme(), "https" | "http") {
            let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
        }
        NewWindowResponse::Deny
    })
    .on_download(|_webview, event| !matches!(event, DownloadEvent::Requested { .. }))
    .build()
    .map_err(|error| error.to_string())?;

    db::upsert_platform_session(
        &state.paths.database,
        source.slug(),
        initial_url.as_str(),
        &profile,
    )?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn arrange_platform(
    app: AppHandle,
    state: State<'_, AppState>,
    source: PlatformSource,
) -> Result<(), String> {
    if platform_window(&app, source).is_none() {
        open_platform(app.clone(), state, source).await?;
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到 Proofline 主窗口".to_string())?;
    let platform = platform_window(&app, source).ok_or_else(|| "平台窗口创建失败".to_string())?;
    let monitor = main
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "无法读取显示器尺寸".to_string())?;
    let origin = monitor.position();
    let size = monitor.size();
    let gap = 8_u32;

    if size.width >= 1280 {
        let platform_width = ((size.width - gap) as f64 * 0.58).round() as u32;
        let main_width = size.width - gap - platform_width;
        platform
            .set_position(PhysicalPosition::new(origin.x, origin.y))
            .map_err(|error| error.to_string())?;
        platform
            .set_size(PhysicalSize::new(platform_width, size.height))
            .map_err(|error| error.to_string())?;
        main.set_position(PhysicalPosition::new(
            origin.x + platform_width as i32 + gap as i32,
            origin.y,
        ))
        .map_err(|error| error.to_string())?;
        main.set_size(PhysicalSize::new(main_width, size.height))
            .map_err(|error| error.to_string())?;
    } else {
        let platform_height = ((size.height - gap) as f64 * 0.55).round() as u32;
        let main_height = size.height - gap - platform_height;
        platform
            .set_position(PhysicalPosition::new(origin.x, origin.y))
            .map_err(|error| error.to_string())?;
        platform
            .set_size(PhysicalSize::new(size.width, platform_height))
            .map_err(|error| error.to_string())?;
        main.set_position(PhysicalPosition::new(
            origin.x,
            origin.y + platform_height as i32 + gap as i32,
        ))
        .map_err(|error| error.to_string())?;
        main.set_size(PhysicalSize::new(size.width, main_height))
            .map_err(|error| error.to_string())?;
    }

    platform.show().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_platform_current_url(
    app: AppHandle,
    state: State<'_, AppState>,
    source: PlatformSource,
) -> Result<String, String> {
    let window =
        platform_window(&app, source).ok_or_else(|| "请先打开对应的官方平台窗口".to_string())?;
    let url = window.url().map_err(|error| error.to_string())?;
    if !is_allowed_platform_url(source, &url) {
        return Err("当前页面不属于所选官方平台，已拒绝绑定".to_string());
    }
    let value = url.to_string();
    db::upsert_platform_session(
        &state.paths.database,
        source.slug(),
        &value,
        &profile_directory(&state, source),
    )?;
    Ok(value)
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "网址格式无效".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("仅允许在系统浏览器中打开 HTTP 或 HTTPS 网址".to_string());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_platform_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    source: PlatformSource,
) -> Result<(), String> {
    if let Some(window) = platform_window(&app, source) {
        window.close().map_err(|error| error.to_string())?;
    }
    let profile = profile_directory(&state, source);
    if profile.exists() {
        std::fs::remove_dir_all(&profile).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    db::clear_platform_session(&state.paths.database, source.slug())
}

#[tauri::command]
pub async fn fetch_public_problem(
    source: PlatformSource,
    url: String,
) -> Result<PublicProblemMetadata, String> {
    let requested = Url::parse(&url).map_err(|_| "平台题目网址格式无效".to_string())?;
    if !is_allowed_platform_url(source, &requested) {
        return Err("平台题目网址不在安全域名列表中".to_string());
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(Policy::none())
        .user_agent("Proofline/0.1 public-problem-reader")
        .build()
        .map_err(|error| error.to_string())?;
    match source {
        PlatformSource::LeetcodeCn | PlatformSource::Leetcode => {
            fetch_leetcode_problem(&client, source, &requested).await
        }
        PlatformSource::Nowcoder => fetch_nowcoder_problem(&client, &requested).await,
    }
}

#[tauri::command]
pub async fn fetch_public_problem_range(
    state: State<'_, AppState>,
    source: PlatformSource,
    start_id: u32,
    end_id: u32,
    on_event: Channel<PlatformBatchProgress>,
) -> Result<PlatformBatchFetchResult, String> {
    let (start, end) = validate_batch_range(source, start_id, end_id)?;
    let total = (end - start + 1) as usize;
    let token = CancellationToken::new();
    let request_id = Uuid::new_v4();
    {
        let mut active = state
            .platform_import
            .lock()
            .map_err(|_| "批量导入状态不可用".to_string())?;
        if let Some((_, previous)) = active.take() {
            previous.cancel();
        }
        *active = Some((request_id, token.clone()));
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .user_agent("Proofline/0.1 public-problem-batch-reader")
        .build()
        .map_err(|error| error.to_string())?;
    let _ = on_event.send(PlatformBatchProgress::Started { total });
    let result = match source {
        PlatformSource::LeetcodeCn | PlatformSource::Leetcode => {
            fetch_leetcode_problem_range(&client, source, start, end, token.clone(), &on_event)
                .await
        }
        PlatformSource::Nowcoder => {
            fetch_nowcoder_problem_range(&client, start, end, token.clone(), &on_event).await
        }
    };
    if let Ok(mut active) = state.platform_import.lock() {
        if active.as_ref().is_some_and(|(id, _)| *id == request_id) {
            active.take();
        }
    }
    result
}

#[tauri::command]
pub fn cancel_public_problem_range(state: State<'_, AppState>) -> Result<(), String> {
    let mut active = state
        .platform_import
        .lock()
        .map_err(|_| "批量导入状态不可用".to_string())?;
    if let Some((_, token)) = active.take() {
        token.cancel();
    }
    Ok(())
}

fn validate_batch_range(
    source: PlatformSource,
    start_id: u32,
    end_id: u32,
) -> Result<(u32, u32), String> {
    if start_id == 0 || end_id == 0 {
        return Err("题号必须是正整数".to_string());
    }
    let (start, end) = if start_id <= end_id {
        (start_id, end_id)
    } else {
        (end_id, start_id)
    };
    let limit = match source {
        PlatformSource::Nowcoder => 50,
        PlatformSource::LeetcodeCn | PlatformSource::Leetcode => 100,
    };
    let count = end
        .checked_sub(start)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| "题号范围无效".to_string())?;
    if count > limit {
        return Err(format!("单次最多导入 {limit} 道题，请缩小范围"));
    }
    Ok((start, end))
}

async fn fetch_leetcode_problem_range(
    client: &Client,
    source: PlatformSource,
    start: u32,
    end: u32,
    token: CancellationToken,
    on_event: &Channel<PlatformBatchProgress>,
) -> Result<PlatformBatchFetchResult, String> {
    let catalog = fetch_leetcode_catalog(client, source).await?;
    let total = (end - start + 1) as usize;
    let mut items = Vec::with_capacity(total);
    let mut fetched_count = 0;
    let mut paid_only_count = 0;
    let mut not_found_count = 0;
    let mut failed_count = 0;
    let mut cancelled = false;

    for number in start..=end {
        let requested_id = number.to_string();
        if token.is_cancelled() {
            cancelled = true;
            items.push(PlatformBatchFetchItem {
                requested_id,
                status: "cancelled",
                source_url: None,
                metadata: None,
                error: Some("用户取消导入".to_string()),
            });
            continue;
        }
        let Some(entry) = catalog.get(&requested_id) else {
            not_found_count += 1;
            items.push(PlatformBatchFetchItem {
                requested_id,
                status: "not-found",
                source_url: None,
                metadata: None,
                error: Some("公开题库目录中没有找到该题号".to_string()),
            });
            emit_batch_progress(
                on_event,
                items.len(),
                total,
                number,
                fetched_count,
                failed_count,
            );
            continue;
        };
        let base = match source {
            PlatformSource::LeetcodeCn => "https://leetcode.cn",
            PlatformSource::Leetcode => "https://leetcode.com",
            PlatformSource::Nowcoder => unreachable!(),
        };
        let source_url = format!("{base}/problems/{}/", entry.slug);
        if entry.paid_only {
            paid_only_count += 1;
            let mut metadata = public_metadata(
                entry.title.clone(),
                Some(entry.id.clone()),
                Some(entry.slug.clone()),
                entry.difficulty.clone(),
                vec![],
                None,
                vec![],
                vec![],
                None,
            );
            metadata.cache_status = "link-only";
            metadata.import_method = "url";
            items.push(PlatformBatchFetchItem {
                requested_id,
                status: "paid-only",
                source_url: Some(source_url),
                metadata: Some(metadata),
                error: Some("该题需要登录或订阅，已保存公开链接卡".to_string()),
            });
        } else {
            let parsed_url = match Url::parse(&source_url) {
                Ok(url) if is_allowed_platform_url(source, &url) => url,
                _ => {
                    failed_count += 1;
                    items.push(PlatformBatchFetchItem {
                        requested_id,
                        status: "failed",
                        source_url: Some(source_url),
                        metadata: None,
                        error: Some("平台题目链接校验失败".to_string()),
                    });
                    continue;
                }
            };
            match fetch_leetcode_problem(client, source, &parsed_url).await {
                Ok(metadata) => {
                    fetched_count += 1;
                    items.push(PlatformBatchFetchItem {
                        requested_id,
                        status: "fetched",
                        source_url: Some(source_url),
                        metadata: Some(metadata),
                        error: None,
                    });
                }
                Err(error) => {
                    failed_count += 1;
                    items.push(PlatformBatchFetchItem {
                        requested_id,
                        status: "failed",
                        source_url: Some(source_url),
                        metadata: None,
                        error: Some(error),
                    });
                }
            }
        }
        emit_batch_progress(
            on_event,
            items.len(),
            total,
            number,
            fetched_count,
            failed_count,
        );
        if items.len() < total {
            tokio::select! {
                _ = token.cancelled() => { cancelled = true; }
                _ = tokio::time::sleep(Duration::from_millis(180)) => {}
            }
        }
    }
    let _ = on_event.send(PlatformBatchProgress::Done {
        completed: items.len(),
        total,
        cancelled,
    });
    Ok(PlatformBatchFetchResult {
        source,
        requested_count: total,
        fetched_count,
        paid_only_count,
        not_found_count,
        failed_count,
        cancelled,
        items,
    })
}

async fn fetch_nowcoder_problem_range(
    client: &Client,
    start: u32,
    end: u32,
    token: CancellationToken,
    on_event: &Channel<PlatformBatchProgress>,
) -> Result<PlatformBatchFetchResult, String> {
    let total = (end - start + 1) as usize;
    let requested: std::collections::HashSet<String> =
        (start..=end).map(|id| format!("NC{id}")).collect();
    let mut catalog = HashMap::new();
    for page in 1..=10 {
        if token.is_cancelled() {
            break;
        }
        let mut url = Url::parse("https://www.nowcoder.com/exam/oj").expect("validated url");
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("tab", "算法篇")
            .append_pair("topicId", "196");
        let response = client
            .get(url)
            .header(reqwest::header::ACCEPT, "text/html")
            .send()
            .await
            .map_err(|error| format!("牛客题库目录读取失败：{error}"))?;
        let html = bounded_response_text(response).await?;
        catalog.extend(parse_nowcoder_catalog_page(&html));
        if requested.iter().all(|id| catalog.contains_key(id)) {
            break;
        }
    }
    let mut items = Vec::with_capacity(total);
    let mut fetched_count = 0;
    let mut not_found_count = 0;
    let mut failed_count = 0;
    let mut cancelled = false;
    for id in start..=end {
        let requested_id = format!("NC{id}");
        if token.is_cancelled() {
            cancelled = true;
            items.push(PlatformBatchFetchItem {
                requested_id,
                status: "cancelled",
                source_url: None,
                metadata: None,
                error: Some("用户取消导入".to_string()),
            });
            continue;
        }
        let Some(source_url) = catalog.get(&requested_id).cloned() else {
            not_found_count += 1;
            items.push(PlatformBatchFetchItem {
                requested_id: requested_id.clone(),
                status: "not-found",
                source_url: None,
                metadata: None,
                error: Some("牛客算法篇目录中没有找到该 NC 题号".to_string()),
            });
            emit_batch_progress(
                on_event,
                items.len(),
                total,
                id,
                fetched_count,
                failed_count,
            );
            continue;
        };
        let parsed_url = match Url::parse(&source_url) {
            Ok(url) if is_allowed_platform_url(PlatformSource::Nowcoder, &url) => url,
            _ => {
                failed_count += 1;
                items.push(PlatformBatchFetchItem {
                    requested_id,
                    status: "failed",
                    source_url: Some(source_url),
                    metadata: None,
                    error: Some("牛客题目链接校验失败".to_string()),
                });
                continue;
            }
        };
        match fetch_nowcoder_problem(client, &parsed_url).await {
            Ok(metadata) => {
                fetched_count += 1;
                items.push(PlatformBatchFetchItem {
                    requested_id,
                    status: "fetched",
                    source_url: Some(source_url),
                    metadata: Some(metadata),
                    error: None,
                });
            }
            Err(error) => {
                failed_count += 1;
                items.push(PlatformBatchFetchItem {
                    requested_id,
                    status: "failed",
                    source_url: Some(source_url),
                    metadata: None,
                    error: Some(error),
                });
            }
        }
        emit_batch_progress(
            on_event,
            items.len(),
            total,
            id,
            fetched_count,
            failed_count,
        );
        tokio::select! {
            _ = token.cancelled() => { cancelled = true; }
            _ = tokio::time::sleep(Duration::from_millis(220)) => {}
        }
    }
    let _ = on_event.send(PlatformBatchProgress::Done {
        completed: items.len(),
        total,
        cancelled,
    });
    Ok(PlatformBatchFetchResult {
        source: PlatformSource::Nowcoder,
        requested_count: total,
        fetched_count,
        paid_only_count: 0,
        not_found_count,
        failed_count,
        cancelled,
        items,
    })
}

fn emit_batch_progress(
    on_event: &Channel<PlatformBatchProgress>,
    completed: usize,
    total: usize,
    current_id: u32,
    fetched: usize,
    failed: usize,
) {
    let _ = on_event.send(PlatformBatchProgress::Progress {
        completed,
        total,
        current_id: current_id.to_string(),
        fetched,
        failed,
    });
}

async fn fetch_leetcode_catalog(
    client: &Client,
    source: PlatformSource,
) -> Result<HashMap<String, LeetcodeCatalogEntry>, String> {
    let host = match source {
        PlatformSource::LeetcodeCn => "leetcode.cn",
        PlatformSource::Leetcode => "leetcode.com",
        PlatformSource::Nowcoder => return Ok(HashMap::new()),
    };
    let response = client
        .get(format!("https://{host}/api/problems/algorithms/"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("{host} 公开题库目录读取失败：{error}"))?;
    let raw = bounded_response_text_with_limit(response, 4_000_000).await?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|_| "公开题库目录不是有效 JSON".to_string())?;
    Ok(parse_leetcode_catalog(&value))
}

fn parse_leetcode_catalog(value: &Value) -> HashMap<String, LeetcodeCatalogEntry> {
    let mut result = HashMap::new();
    let Some(items) = value.get("stat_status_pairs").and_then(Value::as_array) else {
        return result;
    };
    for item in items {
        let Some(stat) = item.get("stat") else {
            continue;
        };
        let id = stat
            .get("frontend_question_id")
            .and_then(value_to_string)
            .filter(|id| id.parse::<u32>().is_ok());
        let slug = stat
            .get("question__title_slug")
            .and_then(Value::as_str)
            .filter(|slug| !slug.trim().is_empty());
        let (Some(id), Some(slug)) = (id, slug) else {
            continue;
        };
        let difficulty = item
            .get("difficulty")
            .and_then(|value| value.get("level"))
            .and_then(Value::as_i64)
            .and_then(|level| match level {
                1 => Some("easy"),
                2 => Some("medium"),
                3 => Some("hard"),
                _ => None,
            })
            .map(str::to_string);
        result.insert(
            id.clone(),
            LeetcodeCatalogEntry {
                id,
                slug: slug.to_string(),
                title: stat
                    .get("question__title")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                difficulty,
                paid_only: item
                    .get("paid_only")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
        );
    }
    result
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn parse_nowcoder_catalog_page(html: &str) -> HashMap<String, String> {
    let document = parse_document(Document::default(), ParseOpts::default()).one(html);
    let mut result = HashMap::new();
    for anchor in document.select("a").iter() {
        let Some(href) = anchor.attr("href") else {
            continue;
        };
        let text = anchor.text().to_string();
        let Some(number) = parse_nowcoder_nc_number(&text) else {
            continue;
        };
        if !href.contains("/practice/") {
            continue;
        }
        let href = href.replace("&amp;", "&");
        let absolute = if href.starts_with("http") {
            href
        } else {
            format!("https://www.nowcoder.com{href}")
        };
        result.insert(format!("NC{number}"), absolute);
    }
    result
}

fn parse_nowcoder_nc_number(text: &str) -> Option<u32> {
    let upper = text.to_ascii_uppercase();
    let marker = upper.find("NC")? + 2;
    let digits = upper[marker..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

async fn fetch_leetcode_problem(
    client: &Client,
    source: PlatformSource,
    requested: &Url,
) -> Result<PublicProblemMetadata, String> {
    let slug = leetcode_problem_slug(requested)
        .ok_or_else(|| "当前页面不是可绑定的 LeetCode 单题页".to_string())?;
    let query = r#"query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        translatedTitle
        difficulty
        content
        translatedContent
        topicTags { name translatedName slug }
        codeSnippets { lang langSlug code }
        sampleTestCase
      }
    }"#;
    let response = client
        .post(
            source
                .graphql_url()
                .expect("LeetCode 来源必须配置 GraphQL 地址"),
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&json!({
            "operationName": "questionData",
            "query": query,
            "variables": { "titleSlug": slug }
        }))
        .send()
        .await
        .map_err(|error| format!("公开题面读取失败：{error}"))?;
    let raw = bounded_response_text(response).await?;
    let body: Value = serde_json::from_str(&raw)
        .map_err(|_| "LeetCode 公开接口返回了无法识别的数据".to_string())?;
    if let Some(message) = body
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(format!("LeetCode 公开接口拒绝读取：{message}"));
    }
    let question = body
        .pointer("/data/question")
        .filter(|value| value.is_object())
        .ok_or_else(|| "未在当前公开页面找到题目信息".to_string())?;
    Ok(metadata_from_leetcode(question, &slug))
}

async fn fetch_nowcoder_problem(
    client: &Client,
    requested: &Url,
) -> Result<PublicProblemMetadata, String> {
    let response = client
        .get(requested.clone())
        .header(reqwest::header::ACCEPT, "text/html")
        .send()
        .await
        .map_err(|error| format!("公开题面读取失败：{error}"))?;
    let html = bounded_response_text(response).await?;
    metadata_from_nowcoder(&html, requested)
}

fn metadata_from_nowcoder(html: &str, requested: &Url) -> Result<PublicProblemMetadata, String> {
    let problem_id = nowcoder_problem_id(requested)
        .ok_or_else(|| "牛客公开页面不是可识别的单题地址".to_string())?;
    let embedded = embedded_json_values(html);
    let question = matching_problem_object(&embedded, &problem_id);
    if question.is_none() && embedded.iter().any(has_problem_id) {
        return Err("牛客公开页面题号与当前网址不一致".to_string());
    }
    let title = question
        .and_then(|object| string_from_object(object, &["questionTitle", "title", "name"]))
        .or_else(|| extract_meta_content(html, &["og:title", "twitter:title"]))
        .or_else(|| extract_html_title(html));
    let external_id = Some(problem_id.clone());
    let difficulty = question
        .and_then(|object| string_from_object(object, &["difficulty", "level", "difficultyName"]))
        .and_then(|value| normalize_difficulty(&value));
    let tags = question
        .map(|object| {
            tags_from_object(
                object,
                &["topicTags", "tagNames", "tags", "knowledgePoints"],
            )
        })
        .unwrap_or_default();
    let problem_content = question.and_then(|object| {
        string_from_object(
            object,
            &[
                "content_html",
                "contentHtml",
                "questionContent",
                "problemContent",
            ],
        )
    });
    let generic_content =
        question.and_then(|object| string_from_object(object, &["content", "description"]));
    let content_source = problem_content.as_deref().or(generic_content.as_deref());
    let problem_examples = problem_content
        .as_deref()
        .map(extract_problem_examples)
        .unwrap_or_default();
    let page_text = extract_visible_page_text(html);
    let page_examples = normalize_examples(parse_labeled_examples(&page_text));
    let generic_examples = generic_content
        .as_deref()
        .map(extract_problem_examples)
        .unwrap_or_default();
    let content = content_source
        .map(problem_content_to_text)
        .filter(|value| !value.is_empty())
        .or_else(|| extract_meta_content(html, &["description", "og:description"]))
        .or_else(|| (!page_text.is_empty()).then(|| page_text.clone()));
    if question.is_none() && page_examples.is_empty() {
        return Err("牛客公开页面未暴露可识别的单题信息".to_string());
    }
    let examples = if !problem_examples.is_empty() {
        problem_examples
    } else if !page_examples.is_empty() {
        page_examples
    } else {
        generic_examples
    };
    let sample_test_case = examples.first().map(|example| example.input.clone());
    Ok(public_metadata(
        title,
        external_id,
        Some(problem_id),
        difficulty,
        tags,
        content,
        examples,
        vec![],
        sample_test_case,
    ))
}

async fn bounded_response_text(response: reqwest::Response) -> Result<String, String> {
    const MAX_RESPONSE_BYTES: usize = 2_000_000;
    bounded_response_text_with_limit(response, MAX_RESPONSE_BYTES).await
}

async fn bounded_response_text_with_limit(
    response: reqwest::Response,
    max_response_bytes: usize,
) -> Result<String, String> {
    if !response.status().is_success() {
        return Err(format!("公开题面读取失败（{}）", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_response_bytes as u64)
    {
        return Err("公开题面响应过大，已停止读取".to_string());
    }

    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("公开题面文本读取失败：{error}"))?
    {
        append_bounded_response_chunk(&mut bytes, &chunk, max_response_bytes)?;
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn append_bounded_response_chunk(
    buffer: &mut Vec<u8>,
    chunk: &[u8],
    limit: usize,
) -> Result<(), String> {
    if buffer
        .len()
        .checked_add(chunk.len())
        .map_or(true, |length| length > limit)
    {
        return Err("公开题面响应过大，已停止读取".to_string());
    }
    buffer.extend_from_slice(chunk);
    Ok(())
}

fn metadata_from_leetcode(question: &Value, slug: &str) -> PublicProblemMetadata {
    let title = question
        .get("translatedTitle")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| question.get("title").and_then(Value::as_str))
        .map(str::to_string);
    let external_id = question
        .get("questionFrontendId")
        .and_then(Value::as_str)
        .or_else(|| question.get("questionId").and_then(Value::as_str))
        .map(str::to_string);
    let difficulty = question
        .get("difficulty")
        .and_then(Value::as_str)
        .and_then(normalize_difficulty);
    let tags = question
        .get("topicTags")
        .map(tags_from_value)
        .unwrap_or_default();
    let content_html = question
        .get("translatedContent")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| question.get("content").and_then(Value::as_str));
    let examples = content_html
        .map(extract_problem_examples)
        .unwrap_or_default();
    let content = content_html
        .map(html_to_text)
        .filter(|value| !value.is_empty());
    let code_snippets = question
        .get("codeSnippets")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let language = item.get("lang")?.as_str()?.trim();
                    let language_slug = item.get("langSlug")?.as_str()?.trim();
                    let code = item.get("code")?.as_str()?;
                    if language.is_empty() || language_slug.is_empty() || code.trim().is_empty() {
                        return None;
                    }
                    Some(PublicCodeSnippet {
                        language: language.to_string(),
                        language_slug: language_slug.to_string(),
                        code: code.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let sample_test_case = question
        .get("sampleTestCase")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    public_metadata(
        title,
        external_id,
        Some(slug.to_string()),
        difficulty,
        tags,
        content,
        examples,
        code_snippets,
        sample_test_case,
    )
}

#[allow(clippy::too_many_arguments)]
fn public_metadata(
    title: Option<String>,
    external_id: Option<String>,
    platform_slug: Option<String>,
    difficulty: Option<String>,
    tags: Vec<String>,
    content: Option<String>,
    examples: Vec<PublicProblemExample>,
    code_snippets: Vec<PublicCodeSnippet>,
    sample_test_case: Option<String>,
) -> PublicProblemMetadata {
    let content_hash = content
        .as_deref()
        .map(|value| format!("{:x}", Sha256::digest(value.as_bytes())));
    PublicProblemMetadata {
        title,
        external_id,
        platform_slug,
        difficulty,
        tags,
        content,
        examples,
        code_snippets,
        sample_test_case,
        cache_status: "fresh",
        import_method: "connector",
        content_fetched_at: chrono::Utc::now().timestamp_millis(),
        content_hash,
        connector_version: env!("CARGO_PKG_VERSION"),
    }
}

fn leetcode_problem_slug(url: &Url) -> Option<String> {
    let segments: Vec<_> = url
        .path_segments()?
        .filter(|value| !value.is_empty())
        .collect();
    segments
        .windows(2)
        .find(|pair| pair[0] == "problems")
        .map(|pair| pair[1].to_string())
}

fn nowcoder_problem_id(url: &Url) -> Option<String> {
    for key in ["questionId", "question_id", "pid"] {
        if let Some((_, value)) = url.query_pairs().find(|(name, _)| name == key) {
            if !value.is_empty() {
                return Some(value.into_owned());
            }
        }
    }
    let segments: Vec<_> = url
        .path_segments()?
        .filter(|value| !value.is_empty())
        .collect();
    if let Some(index) = segments.iter().position(|segment| *segment == "practice") {
        return segments.get(index + 1).map(|value| (*value).to_string());
    }
    None
}

fn normalize_difficulty(value: &str) -> Option<String> {
    let lower = value.trim().to_ascii_lowercase();
    if lower.contains("easy") || value.contains('简') || value == "1" {
        Some("easy".to_string())
    } else if lower.contains("medium") || value.contains('中') || value == "2" {
        Some("medium".to_string())
    } else if lower.contains("hard") || value.contains('难') || value == "3" {
        Some("hard".to_string())
    } else {
        None
    }
}

fn tags_from_value(value: &Value) -> Vec<String> {
    let mut tags = Vec::new();
    if let Some(items) = value.as_array() {
        for item in items {
            let tag = item
                .as_str()
                .or_else(|| item.get("translatedName").and_then(Value::as_str))
                .filter(|value| !value.trim().is_empty())
                .or_else(|| item.get("name").and_then(Value::as_str));
            if let Some(tag) = tag {
                let tag = tag.trim().to_string();
                if !tag.is_empty() && !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
    }
    tags
}

fn embedded_json_values(html: &str) -> Vec<Value> {
    let lower = html.to_ascii_lowercase();
    let mut values = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<script") {
        let start = cursor + relative_start;
        let Some(tag_end) = lower[start..].find('>').map(|index| start + index + 1) else {
            break;
        };
        let Some(end) = lower[tag_end..]
            .find("</script>")
            .map(|index| tag_end + index)
        else {
            break;
        };
        let body = html[tag_end..end].trim();
        if let Some(value) = parse_embedded_json(body) {
            values.push(value);
        }
        cursor = end + "</script>".len();
    }
    values
}

fn parse_embedded_json(body: &str) -> Option<Value> {
    serde_json::from_str(body).ok().or_else(|| {
        let start = body.find('{')?;
        let end = body.rfind('}')?;
        serde_json::from_str(&body[start..=end]).ok()
    })
}

fn matching_problem_object<'a>(
    values: &'a [Value],
    problem_id: &str,
) -> Option<&'a Map<String, Value>> {
    values
        .iter()
        .find_map(|value| matching_problem_object_in_value(value, problem_id))
}

fn matching_problem_object_in_value<'a>(
    value: &'a Value,
    problem_id: &str,
) -> Option<&'a Map<String, Value>> {
    match value {
        Value::Object(map) => {
            if problem_id_from_object(map).as_deref() == Some(problem_id) {
                return Some(map);
            }
            map.values()
                .find_map(|value| matching_problem_object_in_value(value, problem_id))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|value| matching_problem_object_in_value(value, problem_id)),
        _ => None,
    }
}

fn has_problem_id(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            problem_id_from_object(map).is_some() || map.values().any(has_problem_id)
        }
        Value::Array(items) => items.iter().any(has_problem_id),
        _ => false,
    }
}

fn problem_id_from_object(map: &Map<String, Value>) -> Option<String> {
    string_from_object(
        map,
        &["questionId", "question_id", "problemId", "problem_id"],
    )
    .or_else(|| {
        is_legacy_question_object(map)
            .then(|| string_from_object(map, &["id"]))
            .flatten()
    })
}

fn is_legacy_question_object(map: &Map<String, Value>) -> bool {
    let has_title = string_from_object(map, &["questionTitle", "title"]).is_some();
    let has_problem_content = string_from_object(
        map,
        &[
            "content_html",
            "contentHtml",
            "questionContent",
            "problemContent",
        ],
    )
    .is_some();
    has_title && has_problem_content
}

fn string_from_object(map: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(text) = value.as_str().filter(|text| !text.trim().is_empty()) {
                return Some(text.to_string());
            }
            if let Some(number) = value.as_i64() {
                return Some(number.to_string());
            }
        }
    }
    None
}

fn tags_from_object(map: &Map<String, Value>, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| map.get(*key))
        .map(tags_from_value)
        .find(|tags| !tags.is_empty())
        .unwrap_or_default()
}

fn extract_meta_content(html: &str, names: &[&str]) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find("<meta") {
        let start = cursor + relative;
        let Some(end) = lower[start..].find('>').map(|index| start + index + 1) else {
            break;
        };
        let tag = &html[start..end];
        let name = extract_attribute(tag, "name").or_else(|| extract_attribute(tag, "property"));
        if name.as_deref().is_some_and(|name| {
            names
                .iter()
                .any(|candidate| name.eq_ignore_ascii_case(candidate))
        }) {
            if let Some(content) =
                extract_attribute(tag, "content").filter(|value| !value.trim().is_empty())
            {
                return Some(content);
            }
        }
        cursor = end;
    }
    None
}

fn extract_attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}=");
    let start = lower.find(&needle)? + needle.len();
    let quote = tag[start..].chars().next()?;
    if matches!(quote, '\'' | '"') {
        let value_start = start + quote.len_utf8();
        let end = tag[value_start..].find(quote)? + value_start;
        Some(tag[value_start..end].to_string())
    } else {
        let end = tag[start..]
            .find(|character: char| character.is_whitespace() || character == '>')
            .map(|index| start + index)
            .unwrap_or(tag.len());
        Some(tag[start..end].to_string())
    }
}

fn html_to_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for character in html.chars() {
        match character {
            '<' if !in_tag => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let name = tag
                    .trim()
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("");
                if matches!(
                    name.to_ascii_lowercase().as_str(),
                    "p" | "br" | "li" | "pre" | "div" | "h1" | "h2" | "h3"
                ) {
                    text.push('\n');
                }
            }
            _ if in_tag => tag.push(character),
            _ => text.push(character),
        }
    }
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn problem_content_to_text(content: &str) -> String {
    if contains_html_tag(content) {
        html_to_text(content)
    } else {
        normalize_text_lines(content)
    }
}

fn extract_visible_page_text(html: &str) -> String {
    let options = ParseOpts {
        tree_builder: TreeBuilderOpts {
            scripting_enabled: true,
            ..Default::default()
        },
        ..Default::default()
    };
    let document = parse_document(Document::default(), options).one(html);
    let mut text = String::with_capacity(html.len());
    append_visible_node_text(document.root(), &mut text);
    normalize_text_lines(&text)
}

fn append_visible_node_text(node: NodeRef<'_>, output: &mut String) {
    const NON_VISIBLE_TAGS: &[&str] = &["head", "script", "style", "noscript", "template"];

    let mut stack = vec![node];
    while let Some(node) = stack.pop() {
        if NON_VISIBLE_TAGS.iter().any(|name| node.has_name(name)) {
            continue;
        }
        let is_text = node.query_or(false, |node| {
            if let NodeData::Text { contents } = &node.data {
                if !contents.trim().is_empty() {
                    output.push_str(contents);
                    output.push('\n');
                }
                true
            } else {
                false
            }
        });
        if is_text {
            continue;
        }
        let children = node.children_it(false).collect::<Vec<_>>();
        stack.extend(children.into_iter().rev());
    }
}

fn normalize_text_lines(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn contains_html_tag(content: &str) -> bool {
    const HTML_TAGS: &[&str] = &[
        "html", "head", "body", "title", "meta", "script", "section", "article", "div", "p", "br",
        "pre", "strong", "b", "span", "h1", "h2", "h3", "li", "ul", "ol",
    ];

    let bytes = content.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(offset) = bytes[cursor..].iter().position(|byte| *byte == b'<') else {
            return false;
        };
        cursor += offset + 1;
        if bytes.get(cursor) == Some(&b'/') {
            cursor += 1;
        }
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let name_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_alphanumeric) {
            cursor += 1;
        }
        if name_start == cursor {
            continue;
        }
        let name = &content[name_start..cursor];
        let has_tag_boundary = bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace() || matches!(*byte, b'/' | b'>'));
        if has_tag_boundary
            && HTML_TAGS
                .iter()
                .any(|candidate| name.eq_ignore_ascii_case(candidate))
        {
            return bytes[cursor..].contains(&b'>');
        }
    }
    false
}

fn extract_problem_examples(html: &str) -> Vec<PublicProblemExample> {
    let lower = html.to_ascii_lowercase();
    let mut examples = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<pre") {
        let start = cursor + relative_start;
        let Some(content_start) = lower[start..].find('>').map(|index| start + index + 1) else {
            break;
        };
        let Some(end) = lower[content_start..]
            .find("</pre>")
            .map(|index| content_start + index)
        else {
            break;
        };
        examples.extend(parse_labeled_examples(&problem_content_to_text(
            &html[content_start..end],
        )));
        cursor = end + "</pre>".len();
    }
    examples.extend(parse_labeled_examples(&problem_content_to_text(html)));
    normalize_examples(examples)
}

fn normalize_examples(examples: Vec<PublicProblemExample>) -> Vec<PublicProblemExample> {
    const MAX_EXAMPLES: usize = 20;

    let mut normalized: Vec<PublicProblemExample> = Vec::new();
    for example in examples {
        let input = bounded_example_field(&example.input);
        let output = bounded_example_field(&example.output);
        if input.is_empty()
            || output.is_empty()
            || normalized
                .iter()
                .any(|item| item.input == input && item.output == output)
        {
            continue;
        }
        normalized.push(PublicProblemExample {
            input,
            output,
            explanation: example
                .explanation
                .as_deref()
                .map(bounded_example_field)
                .filter(|value| !value.is_empty()),
        });
        if normalized.len() == MAX_EXAMPLES {
            break;
        }
    }
    normalized
}

fn bounded_example_field(value: &str) -> String {
    const MAX_FIELD_BYTES: usize = 20 * 1024;

    let value = value.trim();
    if value.len() <= MAX_FIELD_BYTES {
        return value.to_string();
    }
    let mut end = MAX_FIELD_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].trim_end().to_string()
}

fn parse_labeled_examples(text: &str) -> Vec<PublicProblemExample> {
    #[derive(Clone, Copy)]
    enum Field {
        Input,
        Output,
        Explanation,
    }

    fn finish(
        examples: &mut Vec<PublicProblemExample>,
        input: &mut String,
        output: &mut String,
        explanation: &mut String,
    ) {
        if let Some(example) = example_from_parts(input, output, explanation) {
            examples.push(example);
        }
        input.clear();
        output.clear();
        explanation.clear();
    }

    let mut examples = Vec::new();
    let mut input = String::new();
    let mut output = String::new();
    let mut explanation = String::new();
    let mut field = None;

    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if field.is_some() && is_example_stop_label(line) {
            finish(&mut examples, &mut input, &mut output, &mut explanation);
            break;
        }
        if is_example_section_label(line) {
            finish(&mut examples, &mut input, &mut output, &mut explanation);
            field = None;
            continue;
        }
        if let Some(value) = strip_example_label(line, &["输入", "Input"]) {
            finish(&mut examples, &mut input, &mut output, &mut explanation);
            field = Some(Field::Input);
            append_example_line(&mut input, value);
            continue;
        }
        if let Some(value) = strip_example_label(line, &["输出", "Output"]) {
            field = Some(Field::Output);
            append_example_line(&mut output, value);
            continue;
        }
        if let Some(value) = strip_example_label(line, &["解释", "说明", "Explanation"]) {
            field = Some(Field::Explanation);
            append_example_line(&mut explanation, value);
            continue;
        }
        match field {
            Some(Field::Input) => append_example_line(&mut input, line),
            Some(Field::Output) => append_example_line(&mut output, line),
            Some(Field::Explanation) => append_example_line(&mut explanation, line),
            None => {}
        }
    }
    finish(&mut examples, &mut input, &mut output, &mut explanation);
    examples
}

fn example_from_parts(
    input: &str,
    output: &str,
    explanation: &str,
) -> Option<PublicProblemExample> {
    if input.trim().is_empty() || output.trim().is_empty() {
        return None;
    }
    Some(PublicProblemExample {
        input: input.trim().to_string(),
        output: output.trim().to_string(),
        explanation: (!explanation.trim().is_empty()).then(|| explanation.trim().to_string()),
    })
}

fn is_example_section_label(line: &str) -> bool {
    ["示例", "样例", "example", "sample"].iter().any(|label| {
        let lower = line.to_ascii_lowercase();
        let Some(rest) = lower.strip_prefix(label) else {
            return false;
        };
        rest.trim().chars().all(|character| {
            character.is_ascii_digit()
                || matches!(
                    character,
                    ':' | '：'
                        | '#'
                        | '一'
                        | '二'
                        | '三'
                        | '四'
                        | '五'
                        | '六'
                        | '七'
                        | '八'
                        | '九'
                        | '十'
                )
        })
    })
}

fn is_example_stop_label(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("constraints") || line.starts_with("提示") || line.starts_with("约束")
}

fn strip_example_label<'a>(line: &'a str, labels: &[&str]) -> Option<&'a str> {
    for label in labels {
        let rest = if label.is_ascii() {
            let prefix = line.get(..label.len())?;
            if !prefix.eq_ignore_ascii_case(label) {
                continue;
            }
            &line[label.len()..]
        } else if let Some(rest) = line.strip_prefix(label) {
            rest
        } else {
            continue;
        };
        let rest = rest.trim_start();
        if rest.is_empty() {
            return Some(rest);
        }
        if let Some(value) = rest.strip_prefix(':').or_else(|| rest.strip_prefix('：')) {
            return Some(value.trim());
        }
    }
    None
}

fn append_example_line(target: &mut String, value: &str) {
    if value.is_empty() {
        return;
    }
    if !target.is_empty() {
        target.push('\n');
    }
    target.push_str(value);
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let content_start = lower[start..].find('>')? + start + 1;
    let end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..end]
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!title.is_empty()).then_some(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_chunk_accumulator_accepts_limit_and_rejects_overflow() {
        let mut buffer = Vec::new();

        append_bounded_response_chunk(&mut buffer, b"abc", 4).unwrap();
        append_bounded_response_chunk(&mut buffer, b"d", 4).unwrap();
        assert_eq!(buffer, b"abcd");

        let error = append_bounded_response_chunk(&mut buffer, b"e", 4).unwrap_err();
        assert!(error.contains("响应过大"));
        assert_eq!(buffer, b"abcd");
    }

    #[test]
    fn validates_and_normalizes_batch_ranges() {
        assert_eq!(
            validate_batch_range(PlatformSource::LeetcodeCn, 10, 1).unwrap(),
            (1, 10)
        );
        assert!(validate_batch_range(PlatformSource::Leetcode, 1, 101).is_err());
        assert!(validate_batch_range(PlatformSource::Nowcoder, 1, 51).is_err());
        assert!(validate_batch_range(PlatformSource::Leetcode, 0, 1).is_err());
    }

    #[test]
    fn parses_numeric_leetcode_catalog_and_paid_status() {
        let catalog = parse_leetcode_catalog(&json!({
            "stat_status_pairs": [
                {
                    "stat": {"frontend_question_id": 1, "question__title_slug": "two-sum", "question__title": "Two Sum"},
                    "difficulty": {"level": 1},
                    "paid_only": false
                },
                {
                    "stat": {"frontend_question_id": "2", "question__title_slug": "paid-problem", "question__title": "Paid"},
                    "difficulty": {"level": 3},
                    "paid_only": true
                },
                {
                    "stat": {"frontend_question_id": "LCP 1", "question__title_slug": "non-numeric"},
                    "difficulty": {"level": 2}
                }
            ]
        }));

        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog["1"].slug, "two-sum");
        assert_eq!(catalog["1"].difficulty.as_deref(), Some("easy"));
        assert!(catalog["2"].paid_only);
        assert_eq!(catalog["2"].difficulty.as_deref(), Some("hard"));
    }

    #[test]
    fn parses_nowcoder_nc_numbers_to_canonical_problem_urls() {
        let html = r#"<main>
          <a class="question" href="/practice/uuid-one?tpId=196&amp;tqId=37176"><span>NC1</span><b>大数加法</b></a>
          <a href="/practice/uuid-fifty?tpId=196&amp;tqId=999"><span> NC50 </span></a>
          <a href="/discuss/123"><span>NC2</span></a>
        </main>"#;
        let catalog = parse_nowcoder_catalog_page(html);

        assert_eq!(catalog.len(), 2);
        assert_eq!(
            catalog["NC1"],
            "https://www.nowcoder.com/practice/uuid-one?tpId=196&tqId=37176"
        );
        assert_eq!(
            catalog["NC50"],
            "https://www.nowcoder.com/practice/uuid-fifty?tpId=196&tqId=999"
        );
        assert!(!catalog.contains_key("NC2"));
    }

    #[test]
    fn only_exact_https_platform_hosts_are_allowed() {
        let source = PlatformSource::LeetcodeCn;
        assert!(is_allowed_platform_url(
            source,
            &Url::parse("https://leetcode.cn/problems/two-sum/").unwrap()
        ));
        assert!(!is_allowed_platform_url(
            source,
            &Url::parse("http://leetcode.cn/problems/two-sum/").unwrap()
        ));
        assert!(!is_allowed_platform_url(
            source,
            &Url::parse("https://leetcode.cn.evil.example/problems/two-sum/").unwrap()
        ));
        assert!(!is_allowed_platform_url(
            source,
            &Url::parse("javascript:alert(1)").unwrap()
        ));
    }

    #[test]
    fn extracts_a_normalized_public_page_title() {
        assert_eq!(
            extract_html_title("<html><TITLE> Two Sum &amp; Notes </TITLE></html>").as_deref(),
            Some("Two Sum & Notes")
        );
    }

    #[test]
    fn maps_public_leetcode_metadata_without_credentials() {
        let question = json!({
            "questionFrontendId": "1",
            "title": "Two Sum",
            "translatedTitle": "两数之和",
            "difficulty": "Easy",
            "content": "<p>Find two numbers.</p>",
            "translatedContent": "<p>找出两个数。</p><pre><strong>输入：</strong> nums = [2,7,11,15], target = 9\n<strong>输出：</strong> [0,1]\n<strong>解释：</strong> 两个数字之和为目标值。</pre>",
            "sampleTestCase": "[2,7,11,15]\n9",
            "codeSnippets": [
                {
                    "lang": "C++",
                    "langSlug": "cpp",
                    "code": "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) {} };"
                }
            ],
            "topicTags": [
                { "name": "Array", "translatedName": "数组" },
                { "name": "Hash Table", "translatedName": "哈希表" }
            ]
        });
        let metadata = metadata_from_leetcode(&question, "two-sum");
        assert_eq!(metadata.title.as_deref(), Some("两数之和"));
        assert_eq!(metadata.external_id.as_deref(), Some("1"));
        assert_eq!(metadata.platform_slug.as_deref(), Some("two-sum"));
        assert_eq!(metadata.difficulty.as_deref(), Some("easy"));
        assert_eq!(metadata.tags, ["数组", "哈希表"]);
        assert_eq!(
            metadata.content.as_deref(),
            Some("找出两个数。\n输入： nums = [2,7,11,15], target = 9\n输出： [0,1]\n解释： 两个数字之和为目标值。")
        );
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "nums = [2,7,11,15], target = 9");
        assert_eq!(metadata.examples[0].output, "[0,1]");
        assert_eq!(
            metadata.examples[0].explanation.as_deref(),
            Some("两个数字之和为目标值。")
        );
        assert_eq!(metadata.sample_test_case.as_deref(), Some("[2,7,11,15]\n9"));
        assert_eq!(metadata.code_snippets.len(), 1);
        assert_eq!(metadata.code_snippets[0].language_slug, "cpp");
        assert!(metadata.code_snippets[0].code.contains("twoSum"));
        assert!(metadata.content_hash.is_some());
    }

    #[test]
    fn extracts_labeled_examples_without_pre_blocks() {
        let content = r#"<section>
          <h3>示例 1</h3>
          <p><strong>输入：</strong> 3 5</p>
          <p><strong>输出：</strong> 8</p>
          <p><strong>说明：</strong> 两数相加。</p>
          <h3>Example 2:</h3>
          <p><b>Input:</b> 10 20</p>
          <p><b>Output:</b> 30</p>
          <p><b>Explanation:</b> Add the values.</p>
          <h3>Constraints:</h3>
          <p>Input: this is not an example</p>
          <p>Output: ignored</p>
        </section>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].input, "3 5");
        assert_eq!(examples[0].output, "8");
        assert_eq!(examples[0].explanation.as_deref(), Some("两数相加。"));
        assert_eq!(examples[1].input, "10 20");
        assert_eq!(examples[1].output, "30");
        assert_eq!(examples[1].explanation.as_deref(), Some("Add the values."));
    }

    #[test]
    fn ignores_stop_labels_before_the_first_example_field() {
        let content = r#"<h2>Constraints:</h2>
          <p>1 &lt;= n &lt;= 100</p>
          <h2>Example 1</h2>
          <p>Input: 2 3</p>
          <p>Output: 5</p>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].input, "2 3");
        assert_eq!(examples[0].output, "5");
    }

    #[test]
    fn falls_back_to_page_labels_when_pre_blocks_are_unrelated() {
        let content = r#"<p>Starter code:</p>
          <pre>int main() { return 0; }</pre>
          <h2>示例 1</h2>
          <p>输入： 7</p>
          <p>输出： 49</p>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].input, "7");
        assert_eq!(examples[0].output, "49");
    }

    #[test]
    fn merges_examples_from_pre_blocks_and_page_labels() {
        let content = r#"<pre>Input: pre-input
Output: pre-output</pre>
          <h2>Example 2</h2>
          <p>Input: page-input</p>
          <p>Output: page-output</p>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].input, "pre-input");
        assert_eq!(examples[0].output, "pre-output");
        assert_eq!(examples[1].input, "page-input");
        assert_eq!(examples[1].output, "page-output");
    }

    #[test]
    fn drops_an_orphan_input_inside_a_pre_block() {
        let content = r#"<pre>Input: orphan
Input: real
Output: accepted</pre>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].input, "real");
        assert_eq!(examples[0].output, "accepted");
    }

    #[test]
    fn extracts_multiple_complete_examples_from_one_pre_without_merging_them() {
        let content = r#"<pre>Input: a
Output: 1
Input: b
Output: 2</pre>"#;

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].input, "a");
        assert_eq!(examples[0].output, "1");
        assert_eq!(examples[1].input, "b");
        assert_eq!(examples[1].output, "2");
    }

    #[test]
    fn extracts_nowcoder_public_metadata_and_exact_problem_id() {
        let html = r#"<html><head>
          <meta property="og:title" content="合并两个有序数组">
          <script type="application/json">{
            "questionData": {
              "questionId": "abc12345",
              "difficultyName": "中等",
              "tagNames": ["数组", "双指针"],
              "questionContent": "<p>合并两个数组。</p>"
            }
          }</script>
        </head></html>"#;
        let values = embedded_json_values(html);
        let question = matching_problem_object(&values, "abc12345").unwrap();
        assert_eq!(
            string_from_object(question, &["questionId"]).as_deref(),
            Some("abc12345")
        );
        assert_eq!(
            tags_from_object(question, &["tagNames"]),
            ["数组", "双指针"]
        );
        assert_eq!(
            extract_meta_content(html, &["og:title"]).as_deref(),
            Some("合并两个有序数组")
        );
        let url = Url::parse("https://www.nowcoder.com/practice/abc12345?tpId=1").unwrap();
        assert_eq!(nowcoder_problem_id(&url).as_deref(), Some("abc12345"));
    }

    #[test]
    fn rejects_nowcoder_pages_without_problem_level_evidence() {
        let html =
            "<html><head><title>牛客活动</title></head><body>欢迎登录后参加活动</body></html>";
        for url in [
            "https://www.nowcoder.com/practice/no-evidence-123",
            "https://www.nowcoder.com/activity?questionId=no-evidence-456",
        ] {
            let url = Url::parse(url).unwrap();
            assert_eq!(
                metadata_from_nowcoder(html, &url).unwrap_err(),
                "牛客公开页面未暴露可识别的单题信息",
                "{url}"
            );
        }
    }

    #[test]
    fn rejects_nowcoder_metadata_when_embedded_id_differs_from_url() {
        let html = r#"<script type="application/json">{
          "questionData": {
            "questionId": "other-id",
            "questionTitle": "错误题目"
          }
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/requested-id").unwrap();

        assert_eq!(
            metadata_from_nowcoder(html, &url).unwrap_err(),
            "牛客公开页面题号与当前网址不一致"
        );
    }

    #[test]
    fn rejects_nowcoder_pages_with_only_generic_content_fields() {
        for (key, url) in [
            (
                "content",
                "https://www.nowcoder.com/activity?questionId=requested-id",
            ),
            (
                "description",
                "https://www.nowcoder.com/login?questionId=requested-id",
            ),
        ] {
            let html = format!(
                r#"<script type="application/json">{{"{key}":"普通活动或登录页内容"}}</script>"#
            );
            let url = Url::parse(url).unwrap();
            assert_eq!(
                metadata_from_nowcoder(&html, &url).unwrap_err(),
                "牛客公开页面未暴露可识别的单题信息",
                "{key}"
            );
        }
    }

    #[test]
    fn rejects_examples_found_only_in_generic_embedded_content() {
        let html = r#"<script type="application/json">{
          "content": "示例 1\n输入：a\n输出：b"
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/activity?questionId=requested-id").unwrap();

        assert_eq!(
            metadata_from_nowcoder(html, &url).unwrap_err(),
            "牛客公开页面未暴露可识别的单题信息"
        );
    }

    #[test]
    fn rejects_examples_found_only_in_non_visible_page_elements() {
        let html = r#"<ScRiPt
          type="application/json">{"content":"<h3>示例 1</h3><p>输入：a</p><p>输出：b</p>"}</sCrIpT>
          <StYlE media="screen">示例 2
          输入：style-input
          输出：style-output</StYlE>
          <NoScRiPt>示例 3
          输入：noscript-input
          输出：noscript-output</NoScRiPt>
          <TeMpLaTe data-kind="sample">示例 4
          输入：template-input
          输出：template-output</TeMpLaTe>"#;
        let url = Url::parse("https://www.nowcoder.com/activity?questionId=requested-id").unwrap();

        assert_eq!(
            metadata_from_nowcoder(html, &url).unwrap_err(),
            "牛客公开页面未暴露可识别的单题信息"
        );
    }

    #[test]
    fn visible_text_extraction_handles_degenerate_html_within_time_limit() {
        let html = format!("{}>", "<".repeat(1_000_000));
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(extract_visible_page_text(&html));
        });

        let text = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("接近 2MB 的退化 HTML 必须在线性时间内完成解析");

        assert!(!text.is_empty());
    }

    #[test]
    fn problem_content_detection_handles_degenerate_html_within_time_limit() {
        let content = format!("{}>", "<".repeat(1_000_000));
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(problem_content_to_text(&content));
        });

        let text = receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("接近 2MB 的退化题面必须在线性时间内完成检测");

        assert!(!text.is_empty());
    }

    #[test]
    fn visible_text_extraction_handles_deep_html_without_recursion() {
        let depth = 5_000;
        let html = format!(
            "{}可见正文{}",
            "<div>".repeat(depth),
            "</div>".repeat(depth)
        );
        let text = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || extract_visible_page_text(&html))
            .unwrap()
            .join()
            .unwrap();

        assert_eq!(text, "可见正文");
    }

    #[test]
    fn treats_self_closing_script_syntax_as_non_visible_html_content() {
        let html = r#"<script/>示例 1
          输入：hidden
          输出：hidden
        </script><main>可见正文</main>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/script-semantics").unwrap();

        assert_eq!(
            metadata_from_nowcoder(html, &url).unwrap_err(),
            "牛客公开页面未暴露可识别的单题信息"
        );
    }

    #[test]
    fn accepts_examples_from_visible_page_content() {
        let html = r#"<main><h3>示例 1</h3><p>输入：a</p><p>输出：b</p></main>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/visible-example").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "a");
        assert_eq!(metadata.examples[0].output, "b");
        assert_eq!(metadata.sample_test_case.as_deref(), Some("a"));
    }

    #[test]
    fn maps_nowcoder_fields_from_the_matching_nested_question_object() {
        let html = r#"<script type="application/json">{
          "name": "暑期活动",
          "content": "活动介绍",
          "state": {
            "questionData": {
              "questionId": "nested-question",
              "questionTitle": "嵌套题目",
              "difficultyName": "中等",
              "tagNames": ["数组"],
              "content_html": "<h3>示例 1</h3><p>输入：nested-input</p><p>输出：nested-output</p>"
            }
          }
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/nested-question").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title.as_deref(), Some("嵌套题目"));
        assert_eq!(metadata.difficulty.as_deref(), Some("medium"));
        assert_eq!(metadata.tags, ["数组"]);
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "nested-input");
        assert_eq!(metadata.examples[0].output, "nested-output");
    }

    #[test]
    fn ignores_generic_ids_when_matching_nowcoder_question_objects() {
        let html = r#"<script type="application/json">{
          "currentUser": {"id": "42", "name": "普通用户"}
        }</script>
        <main><h3>示例 1</h3><p>输入：a</p><p>输出：b</p></main>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/real-question").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title, None);
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "a");
        assert_eq!(metadata.examples[0].output, "b");
    }

    #[test]
    fn generic_id_equal_to_url_does_not_turn_a_user_into_a_question() {
        let html = r#"<script type="application/json">{
          "currentUser": {"id": "real-question", "name": "普通用户"}
        }</script>
        <main><h3>示例 1</h3><p>输入：a</p><p>输出：b</p></main>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/real-question").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title, None);
        assert_eq!(metadata.examples.len(), 1);
    }

    #[test]
    fn accepts_legacy_question_objects_with_a_signed_generic_id() {
        let html = r#"<script type="application/json">{
          "id": "legacy-question",
          "questionTitle": "旧结构题目",
          "content_html": "<h3>示例 1</h3><p>输入：legacy-input</p><p>输出：legacy-output</p>"
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/legacy-question").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title.as_deref(), Some("旧结构题目"));
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "legacy-input");
    }

    #[test]
    fn does_not_join_nowcoder_fields_from_different_json_objects() {
        let html = r#"<script type="application/json">{
          "matching": {
            "questionId": "requested-question",
            "questionTitle": "正确题目"
          },
          "unrelated": {
            "content_html": "<h3>示例 1</h3><p>输入：wrong-input</p><p>输出：wrong-output</p>"
          }
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/requested-question").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title.as_deref(), Some("正确题目"));
        assert!(metadata.content.is_none());
        assert!(metadata.examples.is_empty());
        assert!(metadata.sample_test_case.is_none());
    }

    #[test]
    fn maps_nowcoder_examples_from_embedded_content_html() {
        let html = r#"<html><head><script type="application/json">{
          "questionData": {
            "questionId": "xyz98765",
            "questionTitle": "求和",
            "content_html": "<p>计算两数之和。</p><h3>示例 1</h3><p>输入： 4 6</p><p>输出： 10</p>"
          }
        }</script></head></html>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/xyz98765").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title.as_deref(), Some("求和"));
        assert_eq!(metadata.external_id.as_deref(), Some("xyz98765"));
        assert_eq!(metadata.platform_slug.as_deref(), Some("xyz98765"));
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "4 6");
        assert_eq!(metadata.examples[0].output, "10");
        assert_eq!(metadata.sample_test_case.as_deref(), Some("4 6"));
    }

    #[test]
    fn maps_three_nowcoder_examples_from_embedded_json() {
        let html = r#"<script type="application/json">{
          "questionData": {
            "questionId": "three-examples",
            "questionTitle": "三组样例",
            "content_html": "<h3>示例 1</h3><p>输入： first</p><p>输出： 1</p><h3>示例 2</h3><p>输入： second</p><p>输出： 2</p><h3>Example 3</h3><p>Input: third</p><p>Output: 3</p>"
          }
        }</script>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/three-examples").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.examples.len(), 3);
        assert_eq!(metadata.examples[0].input, "first");
        assert_eq!(metadata.examples[0].output, "1");
        assert_eq!(metadata.examples[1].input, "second");
        assert_eq!(metadata.examples[1].output, "2");
        assert_eq!(metadata.examples[2].input, "third");
        assert_eq!(metadata.examples[2].output, "3");
        assert_eq!(metadata.sample_test_case.as_deref(), Some("first"));
    }

    #[test]
    fn maps_nowcoder_examples_from_plain_text() {
        let text = "样例 1\n输入： alpha beta\n输出： gamma\n说明： plain text\n提示： stop here";
        let url = Url::parse("https://www.nowcoder.com/practice/plain1234").unwrap();

        let metadata = metadata_from_nowcoder(text, &url).unwrap();

        assert_eq!(metadata.content.as_deref(), Some(text));
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "alpha beta");
        assert_eq!(metadata.examples[0].output, "gamma");
        assert_eq!(
            metadata.examples[0].explanation.as_deref(),
            Some("plain text")
        );
        assert_eq!(metadata.sample_test_case.as_deref(), Some("alpha beta"));
    }

    #[test]
    fn maps_nowcoder_examples_from_complete_html_without_embedded_json() {
        let html = r#"<html><head><title>平方数</title></head><body>
          <article><h2>示例 1</h2><p>输入： 8</p><p>输出： 64</p></article>
        </body></html>"#;
        let url = Url::parse("https://www.nowcoder.com/practice/html12345").unwrap();

        let metadata = metadata_from_nowcoder(html, &url).unwrap();

        assert_eq!(metadata.title.as_deref(), Some("平方数"));
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "8");
        assert_eq!(metadata.examples[0].output, "64");
        assert_eq!(metadata.sample_test_case.as_deref(), Some("8"));
    }

    #[test]
    fn preserves_less_than_operators_in_nowcoder_plain_text_examples() {
        let text = "示例 1\n输入： 1 < 2\n输出： true";
        let url = Url::parse("https://www.nowcoder.com/practice/plain5678").unwrap();

        let metadata = metadata_from_nowcoder(text, &url).unwrap();

        assert_eq!(metadata.content.as_deref(), Some(text));
        assert_eq!(metadata.examples.len(), 1);
        assert_eq!(metadata.examples[0].input, "1 < 2");
        assert_eq!(metadata.examples[0].output, "true");
        assert_eq!(metadata.sample_test_case.as_deref(), Some("1 < 2"));
    }

    #[test]
    fn bounds_deduplicates_and_pairs_extracted_examples() {
        let oversized_input = "界".repeat(7_000);
        let oversized_output = "o".repeat(21_000);
        let oversized_explanation = "e".repeat(21_000);
        let oversized_example = format!(
            "示例 1\n输入： {oversized_input}\n输出： {oversized_output}\n说明： {oversized_explanation}\n"
        );
        let mut content = format!(
            "{oversized_example}{oversized_example}Example 2\nInput: orphan-without-output\n"
        );
        for index in 0..25 {
            content.push_str(&format!(
                "Example {}\nInput: input-{index}\nOutput: output-{index}\n",
                index + 3
            ));
        }

        let examples = extract_problem_examples(&content);

        assert_eq!(examples.len(), 20);
        assert!(examples[0].input.len() <= 20 * 1024);
        assert!(examples[0].output.len() <= 20 * 1024);
        assert!(examples[0]
            .explanation
            .as_ref()
            .is_some_and(|value| value.len() <= 20 * 1024));
        assert_eq!(
            examples
                .iter()
                .map(|example| (&example.input, &example.output))
                .collect::<std::collections::HashSet<_>>()
                .len(),
            examples.len()
        );
        assert!(!examples
            .iter()
            .any(|example| example.input == "orphan-without-output"));
    }

    #[test]
    fn parses_case_insensitive_labels_with_values_on_following_lines() {
        let content = "sample 1\ninput\n1 2\nOUTPUT\n3\nexplanation\nsum\nconstraints\ninput\nignored\noutput\nignored";

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].input, "1 2");
        assert_eq!(examples[0].output, "3");
        assert_eq!(examples[0].explanation.as_deref(), Some("sum"));
    }

    #[test]
    fn drops_an_orphan_candidate_when_a_new_input_starts() {
        let content = "Input: orphan\nInput: real\nOutput: accepted";

        let examples = extract_problem_examples(content);

        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].input, "real");
        assert_eq!(examples[0].output, "accepted");
    }
}
