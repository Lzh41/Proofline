use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    ffi::{OsStr, OsString},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use reqwest::Client;
use sha2::{Digest, Sha256};
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const STARTUP_WAIT: Duration = Duration::from_millis(1_500);
const OUTPUT_READ_CHUNK_BYTES: usize = 8 * 1024;
const GITHUB_API_BASE: &str = "https://api.github.com";
// 只用于源码压缩包下载。仓库元数据、文件树和安装脚本内容仍然来自 GitHub API，
// 避免把第三方代理的响应当成 AI 安装分析依据。
const GITHUB_ARCHIVE_MIRROR_PREFIXES: [&str; 1] = ["https://ghproxy.net/"];
const PAPERSPINE_MANIFEST_URLS: [(&str, &str); 3] = [
    (
        "PaperSpine 网站镜像",
        "https://wubing2023.github.io/PaperSpine/v5/downloads/manifest.json",
    ),
    (
        "国内镜像 ghproxy.net",
        "https://ghproxy.net/https://raw.githubusercontent.com/WUBING2023/PaperSpine/main/website/downloads/manifest.json",
    ),
    (
        "GitHub raw",
        "https://raw.githubusercontent.com/WUBING2023/PaperSpine/main/website/downloads/manifest.json",
    ),
];
const GITHUB_ARCHIVE_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(300);
const GITHUB_MAX_RANGE_RESUMES: usize = 3;
const GITHUB_MAX_README_BYTES: usize = 48 * 1024;
const GITHUB_MAX_FILE_BYTES: usize = 16 * 1024;
const GITHUB_MAX_FILES: usize = 500;
const GITHUB_MAX_SETUP_FILES: usize = 12;
const GITHUB_MAX_ARCHIVE_BYTES: usize = 100 * 1024 * 1024;
const GITHUB_MAX_ARCHIVE_ENTRIES: usize = 50_000;
const GITHUB_MAX_EXTRACTED_BYTES: u64 = 512 * 1024 * 1024;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolInstallRequest {
    pub installer_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolStartRequest {
    pub launcher_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolInstallResult {
    pub ok: bool,
    pub output: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolStartResult {
    pub ok: bool,
    pub service_url: Option<String>,
    pub service_pid: Option<u32>,
    pub output: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub running: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalToolProcessState {
    pub pid: u32,
    pub running: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubToolFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubToolInspection {
    pub repository_url: String,
    pub html_url: String,
    pub full_name: String,
    pub owner: String,
    pub repo: String,
    pub name: String,
    pub description: Option<String>,
    pub default_branch: String,
    pub language: Option<String>,
    pub stars: Option<u64>,
    pub files: Vec<String>,
    pub readme: Option<String>,
    pub setup_files: Vec<GithubToolFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubToolPrepareRequest {
    pub repository_url: String,
    pub installer_path: Option<String>,
    #[serde(default)]
    pub installer_args: Vec<String>,
    #[serde(default)]
    pub launcher_path: Option<String>,
    #[serde(default)]
    pub launcher_args: Vec<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubToolPrepareResult {
    pub repository_url: String,
    pub source_path: String,
    pub installer_path: Option<String>,
    pub launcher_path: Option<String>,
    pub working_directory: String,
    #[serde(default)]
    pub installer_args: Vec<String>,
    #[serde(default)]
    pub launcher_args: Vec<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone)]
struct GithubRepository {
    owner: String,
    repo: String,
    repository_url: String,
}

#[derive(Debug)]
struct PaperSpineAssets {
    installer_args: Vec<String>,
    launcher_args: Vec<String>,
}

#[derive(Debug, Clone)]
struct ValidatedToolPath {
    path: PathBuf,
    working_directory: PathBuf,
}

#[derive(Debug, Default)]
struct CollectedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Debug)]
struct StartProcess {
    child: Child,
    stdout: mpsc::Receiver<Vec<u8>>,
    stderr: mpsc::Receiver<Vec<u8>>,
}

#[derive(Debug)]
struct StartObservation {
    status: Option<ExitStatus>,
    output: CollectedOutput,
}

#[tauri::command]
pub async fn install_local_tool(
    installer_path: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
) -> Result<LocalToolInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        install_local_tool_blocking(LocalToolInstallRequest {
            installer_path,
            arguments,
            working_directory,
        })
    })
    .await
    .map_err(|error| format!("本地工具安装任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn start_local_tool(
    launcher_path: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
) -> Result<LocalToolStartResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        start_local_tool_blocking(LocalToolStartRequest {
            launcher_path,
            arguments,
            working_directory,
        })
    })
    .await
    .map_err(|error| format!("本地工具启动任务异常结束：{error}"))?
}

#[tauri::command]
pub fn stop_local_tool(pid: u32) -> Result<LocalToolProcessState, String> {
    validate_pid(pid)?;

    if !process_is_running(pid)? {
        return Ok(LocalToolProcessState {
            pid,
            running: false,
            exit_code: None,
        });
    }

    terminate_process(pid)?;
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if !process_is_running(pid)? {
            return Ok(LocalToolProcessState {
                pid,
                running: false,
                exit_code: None,
            });
        }
        thread::sleep(Duration::from_millis(50));
    }

    Err(format!("无法在限定时间内停止本地工具进程 {pid}"))
}

#[tauri::command]
pub fn get_local_tool_process_state(pid: u32) -> Result<LocalToolProcessState, String> {
    validate_pid(pid)?;
    Ok(LocalToolProcessState {
        pid,
        running: process_is_running(pid)?,
        exit_code: None,
    })
}

/// 读取公开 GitHub 仓库的元数据、文件索引和少量安装相关文件。
/// 这里只读远程内容，不下载、不解压，也不执行仓库中的任何脚本。
#[tauri::command]
pub async fn inspect_github_tool(repository_url: String) -> Result<GithubToolInspection, String> {
    let repository = parse_github_repository(&repository_url)?;
    let client = github_client()?;
    inspect_github_repository(&client, &repository).await
}

/// 在用户确认 AI 候选配置后下载并解压源码。下载本身仍不会运行仓库脚本。
#[tauri::command]
pub async fn prepare_github_tool(
    state: State<'_, crate::AppState>,
    request: GithubToolPrepareRequest,
) -> Result<GithubToolPrepareResult, String> {
    let repository = parse_github_repository(&request.repository_url)?;
    let client = github_client()?;
    let metadata = github_repository_metadata(&client, &repository).await?;
    let branch = metadata
        .get("default_branch")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    let archive = download_github_archive(&client, &repository, branch).await?;
    let paths = state.paths.clone();
    let repository_for_prepare = repository.clone();
    let installer_args = request.installer_args.clone();
    let launcher_args = request.launcher_args.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        prepare_github_archive(&paths, &repository_for_prepare, &archive, &request)
    })
    .await
    .map_err(|error| format!("准备 GitHub 工具任务异常结束：{error}"))??;
    if is_paperspine_repository(&repository) {
        match prepare_paperspine_assets(&client, &result.source_path).await {
            Ok(assets) => {
                result.installer_args = installer_args;
                result.installer_args.extend(assets.installer_args);
                result.launcher_args = launcher_args;
                result.launcher_args.extend(assets.launcher_args);
            }
            Err(error) => {
                let _ = std::fs::remove_dir_all(&result.source_path);
                return Err(format!("PaperSpine 发布套件准备失败：{error}"));
            }
        }
    }
    Ok(result)
}

fn parse_github_repository(value: &str) -> Result<GithubRepository, String> {
    let parsed = url::Url::parse(value.trim()).map_err(|_| "GitHub 地址格式无效".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") {
        return Err("只允许使用 https://github.com/所有者/仓库 地址".to_string());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("GitHub 地址不能包含登录信息、查询参数或片段".to_string());
    }
    let mut segments = parsed
        .path_segments()
        .ok_or_else(|| "GitHub 地址缺少仓库路径".to_string())?
        .filter(|segment| !segment.is_empty());
    let owner = segments
        .next()
        .ok_or_else(|| "GitHub 地址缺少所有者".to_string())?;
    let repo_raw = segments
        .next()
        .ok_or_else(|| "GitHub 地址缺少仓库名".to_string())?;
    if segments.next().is_some() {
        return Err("请提供仓库首页地址，不要使用 issue、tree 或文件链接".to_string());
    }
    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw);
    if !valid_github_segment(owner) || !valid_github_segment(repo) {
        return Err("GitHub 所有者或仓库名包含无效字符".to_string());
    }
    Ok(GithubRepository {
        owner: owner.to_string(),
        repo: repo.to_string(),
        repository_url: format!("https://github.com/{owner}/{repo}"),
    })
}

fn valid_github_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn github_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Proofline/0.1 GitHub tool assistant")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("无法创建 GitHub 请求客户端：{error}"))
}

fn github_api_url(repository: &GithubRepository, suffix: &[&str]) -> Result<url::Url, String> {
    let mut url = url::Url::parse(GITHUB_API_BASE).map_err(|error| error.to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无法生成 GitHub API 地址".to_string())?;
        segments.extend(["repos", &repository.owner, &repository.repo]);
        segments.extend(suffix.iter().copied());
    }
    Ok(url)
}

fn github_archive_url(repository: &GithubRepository, branch: &str) -> Result<url::Url, String> {
    validate_github_branch(branch)?;
    let mut url =
        url::Url::parse("https://codeload.github.com").map_err(|error| error.to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无法生成 GitHub 下载地址".to_string())?;
        segments.extend([
            &repository.owner,
            &repository.repo,
            "zip",
            "refs",
            "heads",
            branch,
        ]);
    }
    Ok(url)
}

fn github_web_archive_url(repository: &GithubRepository, branch: &str) -> Result<url::Url, String> {
    validate_github_branch(branch)?;
    let mut url = url::Url::parse("https://github.com").map_err(|error| error.to_string())?;
    let archive_name = format!("{branch}.zip");
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无法生成 GitHub 网页下载地址".to_string())?;
        segments.extend([
            repository.owner.as_str(),
            repository.repo.as_str(),
            "archive",
            "refs",
            "heads",
        ]);
        segments.push(&archive_name);
    }
    Ok(url)
}

fn validate_github_branch(branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() || branch.len() > 250 || branch.contains(['\r', '\n']) {
        return Err("GitHub 默认分支名称无效".to_string());
    }
    Ok(())
}

fn github_archive_urls(
    repository: &GithubRepository,
    branch: &str,
) -> Result<Vec<(String, url::Url)>, String> {
    let codeload = github_archive_url(repository, branch)?;
    let web_archive = github_web_archive_url(repository, branch)?;
    let mut urls = Vec::with_capacity(GITHUB_ARCHIVE_MIRROR_PREFIXES.len() + 2);
    for prefix in GITHUB_ARCHIVE_MIRROR_PREFIXES {
        let mirror = url::Url::parse(&format!("{prefix}{web_archive}"))
            .map_err(|error| format!("无法生成 GitHub 国内镜像地址：{error}"))?;
        urls.push(("国内镜像 ghproxy.net".to_string(), mirror));
    }
    urls.push(("GitHub codeload".to_string(), codeload));
    urls.push(("GitHub archive".to_string(), web_archive));
    Ok(urls)
}

async fn download_github_archive(
    client: &Client,
    repository: &GithubRepository,
    branch: &str,
) -> Result<Vec<u8>, String> {
    let urls = github_archive_urls(repository, branch)?;
    let mut failures = Vec::with_capacity(urls.len());
    for (source, url) in urls {
        let result = tokio::time::timeout(
            GITHUB_ARCHIVE_ATTEMPT_TIMEOUT,
            download_github_archive_from_url(client, &url),
        )
        .await;
        match result {
            Ok(Ok(archive)) => return Ok(archive),
            Ok(Err(error)) => failures.push(format!("{source}：{error}")),
            Err(_) => failures.push(format!(
                "{source}：超过 {} 秒仍未完成",
                GITHUB_ARCHIVE_ATTEMPT_TIMEOUT.as_secs()
            )),
        }
    }
    Err(format!(
        "GitHub 源码下载失败，已尝试国内镜像和官方源：{}",
        failures.join("；")
    ))
}

async fn download_github_archive_from_url(
    client: &Client,
    url: &url::Url,
) -> Result<Vec<u8>, String> {
    let mut archive = Vec::new();
    let mut expected_total = None;
    let mut force_range = false;
    let mut resume_count = 0usize;

    loop {
        let requested_start = force_range.then_some(archive.len() as u64);
        let mut request = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, "application/zip");
        if let Some(start) = requested_start {
            request = request.header(reqwest::header::RANGE, format!("bytes={start}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("请求失败：{error}"))?;
        let status = response.status();
        if let Some(start) = requested_start {
            if status != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!(
                    "续传请求返回 {}，未提供 206 Partial Content",
                    status
                ));
            }
            let range = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "续传响应缺少 Content-Range".to_string())
                .and_then(parse_content_range)?;
            if range.0 != start {
                return Err(format!(
                    "续传响应起点为 {}，与请求的 {} 不一致",
                    range.0, start
                ));
            }
            let total = validate_archive_total(range.2)?;
            if expected_total.is_some_and(|expected| expected != total) {
                return Err("续传 Content-Range 总长度发生变化".to_string());
            }
            expected_total = Some(total);
            let expected_chunk = range
                .1
                .checked_sub(range.0)
                .and_then(|length| length.checked_add(1))
                .ok_or_else(|| "续传 Content-Range 范围无效".to_string())?;
            if response
                .content_length()
                .is_some_and(|length| length != expected_chunk)
            {
                return Err("续传响应长度与 Content-Range 不一致".to_string());
            }
        } else {
            if !status.is_success() {
                return Err(format!("返回 {}", status));
            }
            if status == reqwest::StatusCode::PARTIAL_CONTENT {
                let range = response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| "206 响应缺少 Content-Range".to_string())
                    .and_then(parse_content_range)?;
                if range.0 != 0 {
                    return Err(format!("初始 206 响应起点为 {}，应为 0", range.0));
                }
                expected_total = Some(validate_archive_total(range.2)?);
                let expected_chunk = range
                    .1
                    .checked_sub(range.0)
                    .and_then(|length| length.checked_add(1))
                    .ok_or_else(|| "Content-Range 范围无效".to_string())?;
                if response
                    .content_length()
                    .is_some_and(|length| length != expected_chunk)
                {
                    return Err("响应长度与 Content-Range 不一致".to_string());
                }
            } else if let Some(length) = response.content_length() {
                expected_total = Some(validate_archive_total(length)?);
            }
        }

        let response_length = response.content_length();
        let mut response = response;
        let mut read_error = None;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if archive.len().saturating_add(chunk.len()) > GITHUB_MAX_ARCHIVE_BYTES {
                        return Err("压缩包超过 100 MB".to_string());
                    }
                    archive.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(error) => {
                    read_error = Some(error.to_string());
                    break;
                }
            }
        }

        if let Some(error) = read_error {
            if expected_total == Some(archive.len() as u64) {
                // 完整长度已收到，继续到 ZIP 校验；代理可能仍返回了截断的错误体。
            } else {
                if resume_count >= GITHUB_MAX_RANGE_RESUMES {
                    return Err(format!(
                        "读取失败，已重试 {} 次：{}",
                        GITHUB_MAX_RANGE_RESUMES, error
                    ));
                }
                resume_count += 1;
                force_range = true;
                continue;
            }
        }

        if let Some(length) = response_length {
            if requested_start.is_none() && expected_total.is_none() {
                expected_total = Some(validate_archive_total(length)?);
            }
        }
        if let Some(total) = expected_total {
            let received = archive.len() as u64;
            if received > total {
                return Err("实际下载大小超过 Content-Range 声明".to_string());
            }
            if received < total {
                if resume_count >= GITHUB_MAX_RANGE_RESUMES {
                    return Err(format!(
                        "下载未完成，已重试 {} 次后仍缺少 {} 字节",
                        GITHUB_MAX_RANGE_RESUMES,
                        total - received
                    ));
                }
                resume_count += 1;
                force_range = true;
                continue;
            }
        }
        if archive.len() >= 2 && archive.starts_with(b"PK") {
            if zip::ZipArchive::new(Cursor::new(&archive)).is_ok() {
                break;
            }
        }
        // 某些国内代理会在连接正常关闭时只返回前几 MB，既没有传输错误，
        // 也不会给出完整 Content-Length。ZIP 校验失败时再发起 Range 续传，
        // 由后续 206 的 Content-Range 补足真实总长度。
        if resume_count < GITHUB_MAX_RANGE_RESUMES && !archive.is_empty() {
            resume_count += 1;
            force_range = true;
            expected_total = None;
            continue;
        }
        if archive.len() < 2 || !archive.starts_with(b"PK") {
            return Err("返回内容不是 ZIP 压缩包".to_string());
        }
        let error = zip::ZipArchive::new(Cursor::new(&archive))
            .err()
            .map(|error| error.to_string())
            .unwrap_or_else(|| "ZIP 内容不完整".to_string());
        return Err(format!("ZIP 校验失败：{error}"));
    }
    Ok(archive)
}

fn validate_archive_total(total: u64) -> Result<u64, String> {
    if total == 0 || total > GITHUB_MAX_ARCHIVE_BYTES as u64 {
        return Err("压缩包超过 100 MB 或大小无效".to_string());
    }
    Ok(total)
}

fn is_paperspine_repository(repository: &GithubRepository) -> bool {
    repository.owner.eq_ignore_ascii_case("WUBING2023")
        && repository.repo.eq_ignore_ascii_case("PaperSpine")
}

fn github_release_asset_urls(download_url: &str) -> Result<Vec<(String, url::Url)>, String> {
    let official = url::Url::parse(download_url)
        .map_err(|error| format!("PaperSpine 发布套件地址无效：{error}"))?;
    if official.scheme() != "https"
        || official.host_str() != Some("github.com")
        || !official.path().contains("/releases/download/")
    {
        return Err(
            "PaperSpine manifest 中的发布套件地址不是受支持的 GitHub Release 地址".to_string(),
        );
    }
    let mut urls = Vec::with_capacity(GITHUB_ARCHIVE_MIRROR_PREFIXES.len() + 1);
    for prefix in GITHUB_ARCHIVE_MIRROR_PREFIXES {
        let mirror = url::Url::parse(&format!("{prefix}{official}"))
            .map_err(|error| format!("无法生成 PaperSpine 国内镜像地址：{error}"))?;
        urls.push(("国内镜像 ghproxy.net".to_string(), mirror));
    }
    urls.push(("GitHub Release".to_string(), official));
    Ok(urls)
}

async fn prepare_paperspine_assets(
    client: &Client,
    source_path: &str,
) -> Result<PaperSpineAssets, String> {
    let mut manifest = None;
    let mut manifest_failures = Vec::with_capacity(PAPERSPINE_MANIFEST_URLS.len());
    for (source, url) in PAPERSPINE_MANIFEST_URLS {
        let response = match tokio::time::timeout(
            GITHUB_ARCHIVE_ATTEMPT_TIMEOUT,
            client.get(url).send(),
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                manifest_failures.push(format!("{source}：请求失败：{error}"));
                continue;
            }
            Err(_) => {
                manifest_failures.push(format!(
                    "{source}：超过 {} 秒仍未完成",
                    GITHUB_ARCHIVE_ATTEMPT_TIMEOUT.as_secs()
                ));
                continue;
            }
        };
        if !response.status().is_success() {
            manifest_failures.push(format!("{source}：返回 {}", response.status()));
            continue;
        }
        if response
            .content_length()
            .is_some_and(|length| length > 256 * 1024)
        {
            manifest_failures.push(format!("{source}：超过 256 KB"));
            continue;
        }
        let bytes = match response.bytes().await {
            Ok(bytes) if bytes.len() <= 256 * 1024 => bytes,
            Ok(_) => {
                manifest_failures.push(format!("{source}：超过 256 KB"));
                continue;
            }
            Err(error) => {
                manifest_failures.push(format!("{source}：读取失败：{error}"));
                continue;
            }
        };
        manifest = Some(bytes);
        break;
    }
    let manifest = manifest.ok_or_else(|| {
        format!(
            "读取 PaperSpine 发布清单失败，已尝试网站镜像、国内镜像和官方源：{}",
            manifest_failures.join("；")
        )
    })?;
    let manifest_value: Value = serde_json::from_slice(&manifest)
        .map_err(|error| format!("PaperSpine 发布清单不是有效 JSON：{error}"))?;
    let artifact = manifest_value
        .get("artifacts")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("kind").and_then(Value::as_str) == Some("suite")
                    && item.get("platform").and_then(Value::as_str) == Some("windows-amd64")
            })
        })
        .ok_or_else(|| "PaperSpine 发布清单中没有 Windows x64 套件".to_string())?;
    let file = artifact
        .get("file")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 160
                && value.ends_with(".zip")
                && !value.contains(['/', '\\', ':', '\0', '\r', '\n'])
        })
        .ok_or_else(|| "PaperSpine 套件文件名无效".to_string())?;
    let expected_bytes = artifact
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| "PaperSpine 套件大小无效".to_string())?;
    validate_archive_total(expected_bytes)?;
    let expected_hash = artifact
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "PaperSpine 套件 SHA-256 无效".to_string())?;
    let build_id = artifact
        .get("build_id")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 120
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
        .ok_or_else(|| "PaperSpine 套件 build_id 无效".to_string())?;
    let download_url = artifact
        .get("download_url")
        .and_then(Value::as_str)
        .ok_or_else(|| "PaperSpine 套件下载地址缺失".to_string())?;
    let urls = github_release_asset_urls(download_url)?;
    let mut failures = Vec::with_capacity(urls.len());
    let mut bundle = None;
    for (source, url) in urls {
        let result = tokio::time::timeout(
            GITHUB_ARCHIVE_ATTEMPT_TIMEOUT,
            download_github_archive_from_url(client, &url),
        )
        .await;
        let candidate = match result {
            Ok(Ok(candidate)) => candidate,
            Ok(Err(error)) => {
                failures.push(format!("{source}：{error}"));
                continue;
            }
            Err(_) => {
                failures.push(format!(
                    "{source}：超过 {} 秒仍未完成",
                    GITHUB_ARCHIVE_ATTEMPT_TIMEOUT.as_secs()
                ));
                continue;
            }
        };
        let actual_hash = format!("{:x}", Sha256::digest(&candidate));
        if candidate.len() as u64 != expected_bytes {
            failures.push(format!(
                "{source}：大小为 {} 字节，清单要求 {} 字节",
                candidate.len(),
                expected_bytes
            ));
            continue;
        }
        if !actual_hash.eq_ignore_ascii_case(expected_hash) {
            failures.push(format!("{source}：SHA-256 校验不一致"));
            continue;
        }
        bundle = Some(candidate);
        break;
    }
    let bundle = bundle.ok_or_else(|| {
        format!(
            "PaperSpine 套件下载失败，已尝试国内镜像和官方源：{}",
            failures.join("；")
        )
    })?;

    let source_root = Path::new(source_path);
    let assets_root = source_root.join(".proofline-assets");
    std::fs::create_dir_all(&assets_root)
        .map_err(|error| format!("无法创建 PaperSpine 本地套件目录：{error}"))?;
    let manifest_path = assets_root.join("manifest.json");
    let bundle_path = assets_root.join(file);
    std::fs::write(&manifest_path, &manifest)
        .map_err(|error| format!("保存 PaperSpine 发布清单失败：{error}"))?;
    std::fs::write(&bundle_path, bundle)
        .map_err(|error| format!("保存 PaperSpine 发布套件失败：{error}"))?;
    let profile_root = dirs::home_dir()
        .ok_or_else(|| "无法确定 PaperSpine 默认用户配置目录".to_string())?
        .join(".paperspine5")
        .join("profiles")
        .join("default");
    let installed_root = profile_root
        .join(".paperspine5-lifecycle")
        .join("installs")
        .join(build_id);
    Ok(PaperSpineAssets {
        installer_args: vec![
            "-ManifestPath".to_string(),
            manifest_path.display().to_string(),
            "-BundlePath".to_string(),
            bundle_path.display().to_string(),
        ],
        launcher_args: vec![
            "-ProjectRoot".to_string(),
            installed_root.display().to_string(),
        ],
    })
}

fn parse_content_range(value: &str) -> Result<(u64, u64, u64), String> {
    let mut parts = value.split_whitespace();
    if parts.next() != Some("bytes") {
        return Err("Content-Range 单位无效".to_string());
    }
    let range = parts
        .next()
        .ok_or_else(|| "Content-Range 格式无效".to_string())?;
    if parts.next().is_some() {
        return Err("Content-Range 格式无效".to_string());
    }
    let (span, total) = range
        .split_once('/')
        .ok_or_else(|| "Content-Range 缺少总长度".to_string())?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "Content-Range 总长度无效".to_string())?;
    let (start, end) = span
        .split_once('-')
        .ok_or_else(|| "Content-Range 范围无效".to_string())?;
    let start = start
        .parse::<u64>()
        .map_err(|_| "Content-Range 起点无效".to_string())?;
    let end = end
        .parse::<u64>()
        .map_err(|_| "Content-Range 终点无效".to_string())?;
    if start > end || end >= total {
        return Err("Content-Range 范围超出总长度".to_string());
    }
    Ok((start, end, total))
}

async fn github_repository_metadata(
    client: &Client,
    repository: &GithubRepository,
) -> Result<Value, String> {
    let url = github_api_url(repository, &[])?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("读取 GitHub 仓库信息失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "GitHub 仓库信息返回 {status}，请检查地址或 API 速率限制"
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("GitHub 仓库信息不是有效 JSON：{error}"))
}

async fn inspect_github_repository(
    client: &Client,
    repository: &GithubRepository,
) -> Result<GithubToolInspection, String> {
    let metadata = github_repository_metadata(client, repository).await?;
    let default_branch = metadata
        .get("default_branch")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main")
        .to_string();
    let tree_url = github_api_url(repository, &["git", "trees", &default_branch])?;
    let tree = client
        .get(tree_url)
        .query(&[("recursive", "1")])
        .send()
        .await
        .map_err(|error| format!("读取 GitHub 文件列表失败：{error}"))?;
    if !tree.status().is_success() {
        return Err(format!("GitHub 文件列表返回 {}", tree.status()));
    }
    let tree_value = tree
        .json::<Value>()
        .await
        .map_err(|error| format!("GitHub 文件列表不是有效 JSON：{error}"))?;
    let files = tree_value
        .get("tree")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if item.get("type").and_then(Value::as_str) != Some("blob") {
                        return None;
                    }
                    item.get("path").and_then(Value::as_str).map(str::to_string)
                })
                .take(GITHUB_MAX_FILES)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let setup_candidates = files
        .iter()
        .filter(|path| is_setup_candidate(path))
        .take(GITHUB_MAX_SETUP_FILES)
        .cloned()
        .collect::<Vec<_>>();
    let mut setup_files = Vec::new();
    let mut readme = None;
    for path in setup_candidates {
        let max_bytes = if is_readme_path(&path) {
            GITHUB_MAX_README_BYTES
        } else {
            GITHUB_MAX_FILE_BYTES
        };
        if let Some(content) =
            github_file_content(client, repository, &path, &default_branch, max_bytes).await?
        {
            if is_readme_path(&path) && readme.is_none() {
                readme = Some(content.clone());
            }
            setup_files.push(GithubToolFile { path, content });
        }
    }
    Ok(GithubToolInspection {
        repository_url: repository.repository_url.clone(),
        html_url: metadata
            .get("html_url")
            .and_then(Value::as_str)
            .unwrap_or(&repository.repository_url)
            .to_string(),
        full_name: metadata
            .get("full_name")
            .and_then(Value::as_str)
            .unwrap_or(&format!("{}/{}", repository.owner, repository.repo))
            .to_string(),
        owner: repository.owner.clone(),
        repo: repository.repo.clone(),
        name: metadata
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(&repository.repo)
            .to_string(),
        description: metadata
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        default_branch,
        language: metadata
            .get("language")
            .and_then(Value::as_str)
            .map(str::to_string),
        stars: metadata.get("stargazers_count").and_then(Value::as_u64),
        files,
        readme,
        setup_files,
    })
}

async fn github_file_content(
    client: &Client,
    repository: &GithubRepository,
    path: &str,
    branch: &str,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    let mut url = github_api_url(repository, &["contents"])?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无法生成 GitHub 文件地址".to_string())?;
        for segment in path.split('/') {
            if segment.is_empty() || segment == "." || segment == ".." {
                return Err("GitHub 文件路径无效".to_string());
            }
            segments.push(segment);
        }
    }
    let response = client
        .get(url)
        .query(&[("ref", branch)])
        .send()
        .await
        .map_err(|error| format!("读取 GitHub 文件失败：{error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("GitHub 文件 {} 返回 {}", path, response.status()));
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("GitHub 文件 {} 不是有效 JSON：{error}", path))?;
    let Some(encoded) = value.get("content").and_then(Value::as_str) else {
        return Ok(None);
    };
    let compact = encoded.lines().collect::<String>();
    let decoded = base64_decode(&compact)?;
    if decoded.len() > max_bytes {
        return Ok(Some(
            String::from_utf8_lossy(&decoded[..max_bytes]).into_owned() + "\n[文件内容已截断]",
        ));
    }
    Ok(Some(String::from_utf8_lossy(&decoded).into_owned()))
}

fn base64_decode(value: &str) -> Result<Vec<u8>, String> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace() && *byte != b'=')
    {
        let Some(index) = alphabet.iter().position(|item| *item == byte) else {
            return Err("GitHub 文件内容不是有效 Base64".to_string());
        };
        buffer = (buffer << 6) | index as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(output)
}

fn is_readme_path(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| name.to_ascii_lowercase().starts_with("readme"))
}

fn is_setup_candidate(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    is_readme_path(path)
        || matches!(
            name,
            "package.json"
                | "pyproject.toml"
                | "requirements.txt"
                | "requirements-dev.txt"
                | "environment.yml"
                | "environment.yaml"
                | "setup.py"
                | "cargo.toml"
                | "go.mod"
                | "makefile"
                | "docker-compose.yml"
                | "docker-compose.yaml"
        )
        || [".ps1", ".cmd", ".bat", ".exe", ".sh"]
            .iter()
            .any(|extension| name.ends_with(extension))
            && (name.contains("install")
                || name.contains("launch")
                || name.contains("start")
                || name.contains("run"))
}

fn prepare_github_archive(
    paths: &crate::AppPaths,
    repository: &GithubRepository,
    archive: &[u8],
    request: &GithubToolPrepareRequest,
) -> Result<GithubToolPrepareResult, String> {
    let parent = paths.platforms.join("github-tools");
    std::fs::create_dir_all(&parent)
        .map_err(|error| format!("无法创建 GitHub 工具目录：{error}"))?;
    let target = parent.join(format!(
        "{}-{}",
        safe_path_segment(&repository.owner),
        safe_path_segment(&repository.repo)
    ));
    if target.exists() {
        return Err(format!(
            "工具源码目录已存在：{}，请先在工具目录中处理旧版本",
            target.display()
        ));
    }
    let temporary =
        tempfile::tempdir_in(&parent).map_err(|error| format!("无法创建临时解压目录：{error}"))?;
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|error| format!("GitHub 压缩包无效：{error}"))?;
    if zip.len() > GITHUB_MAX_ARCHIVE_ENTRIES {
        return Err("GitHub 压缩包包含过多文件，已停止解压".to_string());
    }
    let mut extracted_bytes = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| format!("读取 GitHub 压缩包失败：{error}"))?;
        let Some(relative) = entry.enclosed_name().map(Path::to_path_buf) else {
            return Err("GitHub 压缩包包含不安全路径".to_string());
        };
        if relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::Prefix(_)
                    | std::path::Component::RootDir
                    | std::path::Component::ParentDir
            )
        }) {
            return Err("GitHub 压缩包包含不安全路径".to_string());
        }
        let destination = temporary.path().join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > GITHUB_MAX_EXTRACTED_BYTES {
            return Err("GitHub 工具解压后超过 512 MB，已停止解压".to_string());
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = std::fs::File::create(&destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
    }
    let entries = std::fs::read_dir(temporary.path())
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if entries.len() == 1 && entries[0].path().is_dir() {
        std::fs::rename(entries[0].path(), &target)
            .map_err(|error| format!("移动工具源码失败：{error}"))?;
    } else {
        std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        for entry in entries {
            std::fs::rename(entry.path(), target.join(entry.file_name()))
                .map_err(|error| format!("整理工具源码失败：{error}"))?;
        }
    }
    let result = (|| {
        let root = target.canonicalize().map_err(|error| error.to_string())?;
        let installer_path = resolve_relative_file(&root, request.installer_path.as_deref())?;
        let launcher_path = resolve_relative_file(&root, request.launcher_path.as_deref())?;
        let working_directory =
            resolve_relative_directory(&root, request.working_directory.as_deref())?
                .unwrap_or_else(|| root.clone());
        let files = list_relative_files(&root, 500);
        Ok(GithubToolPrepareResult {
            repository_url: repository.repository_url.clone(),
            source_path: root.display().to_string(),
            installer_path: installer_path.map(|path| path.display().to_string()),
            launcher_path: launcher_path.map(|path| path.display().to_string()),
            working_directory: working_directory.display().to_string(),
            installer_args: request.installer_args.clone(),
            launcher_args: request.launcher_args.clone(),
            files,
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&target);
    }
    result
}

fn safe_path_segment(value: &str) -> String {
    value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(80)
        .collect()
}

fn resolve_relative_file(root: &Path, value: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != ".")
    else {
        return Ok(None);
    };
    let relative = safe_relative_path(value)?;
    let candidate = root.join(relative);
    if !candidate.starts_with(root) {
        return Err("工具路径必须位于仓库目录内".to_string());
    }
    if !candidate.is_file() {
        return Err(format!("候选脚本不存在：{}", candidate.display()));
    }
    Ok(Some(candidate))
}

fn resolve_relative_directory(root: &Path, value: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != ".")
    else {
        return Ok(None);
    };
    let relative = safe_relative_path(value)?;
    let candidate = root.join(relative);
    if !candidate.starts_with(root) {
        return Err("工作目录必须位于仓库目录内".to_string());
    }
    if !candidate.is_dir() {
        return Err(format!("工作目录不存在：{}", candidate.display()));
    }
    Ok(Some(candidate))
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute() || value.contains(['\0', '\r', '\n']) {
        return Err("工具路径必须是仓库内相对路径".to_string());
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::Prefix(_)
                | std::path::Component::RootDir
        )
    }) {
        return Err("工具路径不能跳出仓库目录".to_string());
    }
    Ok(path.to_path_buf())
}

fn list_relative_files(root: &Path, limit: usize) -> Vec<String> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
                if files.len() >= limit {
                    return files;
                }
            }
        }
    }
    files
}

fn install_local_tool_blocking(
    request: LocalToolInstallRequest,
) -> Result<LocalToolInstallResult, String> {
    let validated = validate_tool_path(
        &request.installer_path,
        request.working_directory.as_deref(),
    )?;
    let mut command = build_tool_command(&validated.path, &request.arguments)?;
    command
        .current_dir(&validated.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);

    let output = command
        .output()
        .map_err(|error| format!("无法启动安装脚本：{error}"))?;
    let stdout = bounded_text(&output.stdout);
    let stderr = bounded_text(&output.stderr);
    let combined = combine_output(&stdout, &stderr);
    let exit_code = output.status.code();
    let ok = output.status.success();

    if !ok {
        return Err(format!(
            "本地工具安装脚本执行失败（退出代码 {}）：\n{}",
            exit_code
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未知".to_string()),
            if combined.trim().is_empty() {
                "脚本没有返回诊断信息。"
            } else {
                combined.as_str()
            }
        ));
    }

    Ok(LocalToolInstallResult {
        ok,
        output: combined,
        stdout,
        stderr,
        exit_code,
    })
}

fn start_local_tool_blocking(
    request: LocalToolStartRequest,
) -> Result<LocalToolStartResult, String> {
    let validated =
        validate_tool_path(&request.launcher_path, request.working_directory.as_deref())?;
    let mut command = build_tool_command(&validated.path, &request.arguments)?;
    command
        .current_dir(&validated.working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);

    let process = command
        .spawn()
        .map_err(|error| format!("无法启动本地工具：{error}"))?;
    let process = start_process_with_readers(process)?;
    let child_pid = process.child.id();
    let observation = observe_start_process(process, STARTUP_WAIT)?;
    let stdout = bounded_bytes_text(&observation.output.stdout);
    let stderr = bounded_bytes_text(&observation.output.stderr);
    let output = combine_output(&stdout, &stderr);
    let receipt = parse_last_receipt(&output);
    let service_url = receipt
        .as_ref()
        .and_then(|value| receipt_string(value, &["address", "serviceUrl", "service_url", "url"]))
        .and_then(|value| validate_service_url(&value));
    // 脚本回执中的 PID 属于不可信输出，只接受启动脚本进程树中的子进程，
    // 避免停止操作被指向机器上的其他进程，同时支持脚本后台拉起 Web 服务。
    let receipt_pid = receipt
        .as_ref()
        .and_then(|value| receipt_pid(value, &["process_id", "processId", "pid"]));
    let service_pid = receipt_pid
        .filter(|pid| *pid == child_pid || is_descendant_process(*pid, child_pid))
        .or(Some(child_pid));
    let running = if observation.status.is_none() {
        true
    } else {
        service_pid != Some(child_pid)
            && service_pid
                .and_then(|pid| process_is_running(pid).ok())
                .unwrap_or(false)
    };
    let ok = observation
        .status
        .as_ref()
        .map_or(true, ExitStatus::success);

    if !ok {
        return Err(format!(
            "本地工具启动脚本执行失败（退出代码 {}）：\n{}",
            observation
                .status
                .and_then(|status| status.code())
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未知".to_string()),
            if output.trim().is_empty() {
                "脚本没有返回诊断信息。"
            } else {
                output.as_str()
            }
        ));
    }

    Ok(LocalToolStartResult {
        ok,
        service_url,
        service_pid,
        output,
        stdout,
        stderr,
        exit_code: observation.status.and_then(|status| status.code()),
        running,
    })
}

fn validate_tool_path(
    path: &str,
    working_directory: Option<&str>,
) -> Result<ValidatedToolPath, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("本地工具脚本路径不能为空".to_string());
    }

    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("本地工具脚本不存在或无法读取：{error}"))?;
    if !metadata.is_file() {
        return Err("本地工具脚本路径必须指向文件".to_string());
    }
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "本地工具脚本必须使用 .ps1、.cmd、.bat 或 .exe 扩展名".to_string())?;
    if !matches!(extension.as_str(), "ps1" | "cmd" | "bat" | "exe") {
        return Err("本地工具脚本只允许 .ps1、.cmd、.bat 或 .exe 文件".to_string());
    }

    let directory = match working_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            let directory = PathBuf::from(value);
            let metadata = std::fs::metadata(&directory)
                .map_err(|error| format!("工作目录不存在或无法读取：{error}"))?;
            if !metadata.is_dir() {
                return Err("工作目录必须指向文件夹".to_string());
            }
            directory
        }
        None => path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };

    Ok(ValidatedToolPath {
        path,
        working_directory: directory,
    })
}

fn build_tool_command(path: &Path, arguments: &[String]) -> Result<Command, String> {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "本地工具脚本扩展名无效".to_string())?;

    let mut command = match extension.as_str() {
        "ps1" => {
            let shell = powershell_executable();
            let mut command = Command::new(shell);
            command.args([
                OsString::from("-NoLogo"),
                OsString::from("-NoProfile"),
                OsString::from("-NonInteractive"),
                OsString::from("-ExecutionPolicy"),
                OsString::from("Bypass"),
                OsString::from("-File"),
            ]);
            command.arg(path);
            command
        }
        "cmd" | "bat" => {
            #[cfg(windows)]
            {
                let mut command = Command::new("cmd.exe");
                // 参数通过 Command::arg 分段传递，避免把路径和用户参数拼成一条命令字符串。
                command.arg("/d").arg("/c").arg(path);
                command
            }
            #[cfg(not(windows))]
            {
                let mut command = Command::new(path);
                command
            }
        }
        "exe" => Command::new(path),
        _ => return Err("本地工具脚本扩展名无效".to_string()),
    };
    command.args(arguments);
    Ok(command)
}

fn powershell_executable() -> &'static str {
    #[cfg(windows)]
    {
        "powershell.exe"
    }
    #[cfg(not(windows))]
    {
        "pwsh"
    }
}

fn start_process_with_readers(mut child: Child) -> Result<StartProcess, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取本地工具标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取本地工具标准错误输出".to_string())?;
    Ok(StartProcess {
        child,
        stdout: spawn_output_reader(stdout),
        stderr: spawn_output_reader(stderr),
    })
}

fn spawn_output_reader<R: Read + Send + 'static>(mut reader: R) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = [0_u8; OUTPUT_READ_CHUNK_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if sender.send(buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    receiver
}

fn observe_start_process(
    mut process: StartProcess,
    timeout: Duration,
) -> Result<StartObservation, String> {
    let started = Instant::now();
    let mut output = CollectedOutput::default();
    let mut status = None;

    while started.elapsed() < timeout {
        drain_reader(&process.stdout, &mut output.stdout);
        drain_reader(&process.stderr, &mut output.stderr);
        match process.child.try_wait() {
            Ok(Some(value)) => {
                status = Some(value);
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(format!("读取本地工具进程状态失败：{error}")),
        }
    }

    drain_reader(&process.stdout, &mut output.stdout);
    drain_reader(&process.stderr, &mut output.stderr);
    if status.is_none() {
        status = process
            .child
            .try_wait()
            .map_err(|error| format!("读取本地工具进程状态失败：{error}"))?;
    }

    // 长驻进程的 Child 句柄可以安全丢弃，但必须继续消费 stdout/stderr，
    // 否则持续输出的 Web 服务可能填满管道后被阻塞。
    continue_draining(process.stdout);
    continue_draining(process.stderr);
    drop(process.child);
    Ok(StartObservation { status, output })
}

fn continue_draining(receiver: mpsc::Receiver<Vec<u8>>) {
    thread::spawn(move || while receiver.recv().is_ok() {});
}

fn drain_reader(receiver: &mpsc::Receiver<Vec<u8>>, destination: &mut Vec<u8>) {
    while let Ok(chunk) = receiver.try_recv() {
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(destination.len());
        destination.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
}

fn bounded_text(value: &[u8]) -> String {
    bounded_bytes_text(value)
}

fn bounded_bytes_text(value: &[u8]) -> String {
    let mut text =
        String::from_utf8_lossy(&value[..value.len().min(MAX_OUTPUT_BYTES)]).into_owned();
    if value.len() > MAX_OUTPUT_BYTES {
        text.push_str("\n[输出超过 256 KB，后续内容已省略]");
    }
    text
}

fn combine_output(stdout: &str, stderr: &str) -> String {
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

fn parse_last_receipt(output: &str) -> Option<Value> {
    // 启动脚本可能在 JSON 前后输出日志，且 JSON 本身可能跨多行缩进。
    // 按对象边界扫描而不是按行截取，才能同时处理嵌套对象和字符串中的花括号。
    let bytes = output.as_bytes();
    let mut last: Option<(usize, Value)> = None;

    for start in 0..bytes.len() {
        if bytes[start] != b'{' {
            continue;
        }

        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for end in start..bytes.len() {
            let byte = bytes[end];
            if in_string {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    in_string = false;
                }
                continue;
            }

            match byte {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        if let Ok(value) = serde_json::from_slice::<Value>(&bytes[start..=end]) {
                            if value.is_object() {
                                let end = end + 1;
                                if last.as_ref().map_or(true, |(last_end, _)| end >= *last_end) {
                                    last = Some((end, value));
                                }
                            }
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }

    last.map(|(_, value)| value)
}

fn receipt_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(value) = object.get(*key).and_then(Value::as_str) {
                    return Some(value.to_string());
                }
            }
            object
                .values()
                .find_map(|value| receipt_string(value, keys))
        }
        Value::Array(values) => values.iter().find_map(|value| receipt_string(value, keys)),
        _ => None,
    }
}

fn receipt_pid(value: &Value, keys: &[&str]) -> Option<u32> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(value) = object.get(*key) {
                    if let Some(pid) = value.as_u64().and_then(|pid| u32::try_from(pid).ok()) {
                        if pid > 0 {
                            return Some(pid);
                        }
                    }
                    if let Some(pid) = value
                        .as_str()
                        .and_then(|pid| pid.trim().parse::<u32>().ok())
                    {
                        if pid > 0 {
                            return Some(pid);
                        }
                    }
                }
            }
            object.values().find_map(|value| receipt_pid(value, keys))
        }
        Value::Array(values) => values.iter().find_map(|value| receipt_pid(value, keys)),
        _ => None,
    }
}

fn is_descendant_process(pid: u32, ancestor_pid: u32) -> bool {
    if pid == 0 || ancestor_pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        let script = format!(
            "$current={pid}; while ($current -and $current -ne 0) {{ $process=Get-CimInstance Win32_Process -Filter \"ProcessId=$current\" -ErrorAction SilentlyContinue; if (-not $process) {{ exit 1 }}; $current=[int]$process.ParentProcessId; if ($current -eq {ancestor_pid}) {{ exit 0 }} }}; exit 1"
        );
        let mut command = Command::new("powershell.exe");
        command.args([
            OsString::from("-NoLogo"),
            OsString::from("-NoProfile"),
            OsString::from("-NonInteractive"),
            OsString::from("-Command"),
            OsString::from(script),
        ]);
        hide_window(&mut command);
        return command.status().is_ok_and(|status| status.success());
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, ancestor_pid);
        false
    }
}

fn validate_service_url(value: &str) -> Option<String> {
    let value = value.trim();
    let parsed = url::Url::parse(value).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if !matches!(parsed.scheme(), "http" | "https")
        || !matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1")
    {
        return None;
    }
    Some(parsed.to_string())
}

fn validate_pid(pid: u32) -> Result<(), String> {
    if pid == 0 {
        Err("本地工具进程 PID 无效".to_string())
    } else {
        Ok(())
    }
}

fn process_is_running(pid: u32) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("tasklist.exe");
        command.args([
            OsString::from("/FI"),
            OsString::from(format!("PID eq {pid}")),
            OsString::from("/FO"),
            OsString::from("CSV"),
            OsString::from("/NH"),
        ]);
        hide_window(&mut command);
        let output = command
            .output()
            .map_err(|error| format!("无法查询本地工具进程状态：{error}"))?;
        if !output.status.success() {
            return Err(format!(
                "查询本地工具进程状态失败（退出代码 {}）",
                output
                    .status
                    .code()
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "未知".to_string())
            ));
        }
        return Ok(tasklist_contains_pid(&output.stdout, pid));
    }

    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map_err(|error| format!("无法查询本地工具进程状态：{error}"))?;
        Ok(status.success())
    }
}

#[cfg(windows)]
fn tasklist_contains_pid(output: &[u8], pid: u32) -> bool {
    let text = String::from_utf8_lossy(output);
    text.lines().any(|line| {
        let mut fields = line.split(',').map(|field| field.trim_matches('"').trim());
        let _image = fields.next();
        fields.next().and_then(|value| value.parse::<u32>().ok()) == Some(pid)
    })
}

fn terminate_process(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill.exe");
        command.arg("/PID").arg(pid.to_string()).arg("/T").arg("/F");
        hide_window(&mut command);
        let output = command
            .output()
            .map_err(|error| format!("无法停止本地工具进程：{error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "停止本地工具进程失败（退出代码 {}）：{}",
                output
                    .status
                    .code()
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "未知".to_string()),
                bounded_text(&output.stderr)
            ))
        }
    }

    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
            .map_err(|error| format!("无法停止本地工具进程：{error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "停止本地工具进程失败（退出代码 {:?}）",
                status.code()
            ))
        }
    }
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};

    #[test]
    fn rejects_unsupported_script_extensions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tool.sh");
        fs::write(&path, "echo nope").unwrap();
        let error = validate_tool_path(path.to_str().unwrap(), None).unwrap_err();
        assert!(error.contains(".ps1"));
    }

    #[test]
    fn defaults_working_directory_to_script_parent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tool.exe");
        fs::File::create(&path).unwrap();
        let validated = validate_tool_path(path.to_str().unwrap(), None).unwrap();
        assert_eq!(validated.working_directory, directory.path());
    }

    #[test]
    fn parses_the_last_json_receipt_and_nested_fields() {
        let output = "log\n{\"ignored\":true}\nreceipt: {\"server\": {\"address\": \"http://127.0.0.1:8123/\", \"process_id\": \"42\"}}";
        let receipt = parse_last_receipt(output).unwrap();
        assert_eq!(
            receipt_string(&receipt, &["address"]).as_deref(),
            Some("http://127.0.0.1:8123/")
        );
        assert_eq!(receipt_pid(&receipt, &["process_id"]), Some(42));
    }

    #[test]
    fn parses_last_multiline_indented_json_receipt() {
        let output = r#"启动服务
{"ignored":true}
receipt:
{
  "server": {
    "address": "http://127.0.0.1:8123/",
    "process_id": 42,
    "message": "保留 { 花括号 }"
  }
}
服务已就绪
"#;
        let receipt = parse_last_receipt(output).unwrap();
        assert_eq!(
            receipt_string(&receipt, &["address"]).as_deref(),
            Some("http://127.0.0.1:8123/")
        );
        assert_eq!(receipt_pid(&receipt, &["process_id"]), Some(42));
    }

    #[test]
    fn rejects_missing_or_zero_process_ids() {
        assert!(validate_pid(0).is_err());
        assert!(validate_pid(1).is_ok());
        assert_eq!(receipt_pid(&serde_json::json!({"pid": 0}), &["pid"]), None);
        assert_eq!(
            receipt_pid(&serde_json::json!({"pid": " 17 "}), &["pid"]),
            Some(17)
        );
    }

    #[test]
    fn service_urls_are_limited_to_loopback() {
        assert!(validate_service_url("https://example.com/tool").is_none());
        assert_eq!(
            validate_service_url("http://127.0.0.1:8123/app"),
            Some("http://127.0.0.1:8123/app".to_string())
        );
        assert_eq!(
            validate_service_url("http://localhost:8123/app"),
            Some("http://localhost:8123/app".to_string())
        );
    }

    #[test]
    fn reports_current_process_as_running_and_rejects_zero_pid() {
        let state = get_local_tool_process_state(std::process::id()).unwrap();
        assert_eq!(state.pid, std::process::id());
        assert!(state.running);
        assert!(get_local_tool_process_state(0).is_err());
    }

    #[test]
    fn combines_standard_output_without_losing_error_output() {
        assert_eq!(combine_output("out", "err"), "out\nerr");
        assert_eq!(combine_output("out", ""), "out");
        assert_eq!(combine_output("", "err"), "err");
    }

    #[test]
    fn command_arguments_are_kept_as_separate_values() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tool.exe");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"placeholder").unwrap();
        let command =
            build_tool_command(&path, &["one two".to_string(), "&bad".to_string()]).unwrap();
        assert_eq!(command.get_args().count(), 2);
    }

    #[test]
    fn github_repository_urls_are_strictly_normalized() {
        let repository =
            parse_github_repository("https://github.com/WUBING2023/PaperSpine.git/").unwrap();
        assert_eq!(repository.owner, "WUBING2023");
        assert_eq!(repository.repo, "PaperSpine");
        assert_eq!(
            repository.repository_url,
            "https://github.com/WUBING2023/PaperSpine"
        );
        assert!(parse_github_repository("http://github.com/example/tool").is_err());
        assert!(parse_github_repository("https://github.com/example/tool/issues").is_err());
        assert!(parse_github_repository("https://github.com/example/tool?token=secret").is_err());
    }

    #[test]
    fn github_candidate_filter_only_selects_install_related_files() {
        assert!(is_setup_candidate("scripts/install.ps1"));
        assert!(is_setup_candidate("README.md"));
        assert!(is_setup_candidate("package.json"));
        assert!(!is_setup_candidate("src/main.py"));
    }

    #[test]
    fn github_archive_urls_use_fixed_mirror_then_official_sources() {
        let repository = parse_github_repository("https://github.com/example/tool").unwrap();
        let urls = github_archive_urls(&repository, "main").unwrap();
        assert_eq!(urls.len(), 3);
        assert_eq!(urls[0].0, "国内镜像 ghproxy.net");
        assert!(urls[0]
            .1
            .as_str()
            .starts_with("https://ghproxy.net/https://github.com/example/tool/archive/"));
        assert_eq!(urls[1].0, "GitHub codeload");
        assert_eq!(urls[1].1.host_str(), Some("codeload.github.com"));
        assert_eq!(urls[2].0, "GitHub archive");
        assert_eq!(urls[2].1.host_str(), Some("github.com"));
    }

    #[test]
    fn github_archive_urls_reject_unsafe_branch_names() {
        let repository = parse_github_repository("https://github.com/example/tool").unwrap();
        assert!(github_archive_urls(&repository, "").is_err());
        assert!(github_archive_urls(&repository, "main\n.zip").is_err());
    }

    #[test]
    fn recognizes_only_the_paperspine_repository_for_release_asset_bootstrap() {
        assert!(is_paperspine_repository(
            &parse_github_repository("https://github.com/WUBING2023/PaperSpine").unwrap()
        ));
        assert!(!is_paperspine_repository(
            &parse_github_repository("https://github.com/WUBING2023/other").unwrap()
        ));
    }

    #[test]
    fn release_asset_urls_keep_mirror_before_official_source() {
        let urls = github_release_asset_urls(
            "https://github.com/WUBING2023/PaperSpine/releases/download/v1/tool.zip",
        )
        .unwrap();
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0].0, "国内镜像 ghproxy.net");
        assert!(urls[0]
            .1
            .as_str()
            .starts_with("https://ghproxy.net/https://github.com/"));
        assert_eq!(urls[1].0, "GitHub Release");
        assert_eq!(urls[1].1.host_str(), Some("github.com"));
        assert!(github_release_asset_urls("https://example.com/tool.zip").is_err());
    }

    #[test]
    fn paperspine_manifest_sources_keep_domestic_fallback_before_github_raw() {
        assert_eq!(PAPERSPINE_MANIFEST_URLS.len(), 3);
        assert!(PAPERSPINE_MANIFEST_URLS[0]
            .1
            .starts_with("https://wubing2023.github.io/"));
        assert_eq!(PAPERSPINE_MANIFEST_URLS[1].0, "国内镜像 ghproxy.net");
        assert!(PAPERSPINE_MANIFEST_URLS[1]
            .1
            .starts_with("https://ghproxy.net/https://raw.githubusercontent.com/"));
        assert!(PAPERSPINE_MANIFEST_URLS[2]
            .1
            .starts_with("https://raw.githubusercontent.com/"));
    }

    #[test]
    fn parses_and_validates_content_ranges_for_resume() {
        assert_eq!(
            parse_content_range("bytes 1048576-2097151/4194304").unwrap(),
            (1_048_576, 2_097_151, 4_194_304)
        );
        assert!(parse_content_range("bytes 0-10/*").is_err());
        assert!(parse_content_range("bytes 10-9/20").is_err());
        assert!(parse_content_range("bytes 0-10/10").is_err());
        assert!(parse_content_range("bytes 0-10/20 trailing").is_err());
    }
}
