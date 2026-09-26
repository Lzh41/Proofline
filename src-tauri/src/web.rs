use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    webview::{NewWindowResponse, WebviewWindow},
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

use crate::AppState;

const DEFAULT_WIDTH: f64 = 1080.0;
const DEFAULT_HEIGHT: f64 = 820.0;
const MIN_WIDTH: f64 = 620.0;
const MIN_HEIGHT: f64 = 480.0;
const MAX_TITLE_LENGTH: usize = 120;
const MAX_WORKSPACE_ID_LENGTH: usize = 96;
const MAX_ALLOWED_HOSTS: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWebWorkspaceRequest {
    pub workspace_id: String,
    pub title: Option<String>,
    pub url: String,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebWorkspaceState {
    pub workspace_id: String,
    pub open: bool,
    pub url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LoopbackOrigin {
    host: String,
    port: u16,
}

fn validate_workspace_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("网页工作区 ID 不能为空".to_string());
    }
    if value.len() > MAX_WORKSPACE_ID_LENGTH {
        return Err("网页工作区 ID 过长".to_string());
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("网页工作区 ID 只能包含字母、数字、短横线和下划线".to_string());
    }
    Ok(value.to_string())
}

fn window_label(workspace_id: &str) -> String {
    format!("web-{workspace_id}")
}

fn profile_directory(state: &AppState, workspace_id: &str) -> PathBuf {
    state
        .paths
        .platforms
        .join("web-workspaces")
        .join(workspace_id)
}

fn workspace_window(app: &AppHandle, workspace_id: &str) -> Option<WebviewWindow> {
    app.get_webview_window(&window_label(workspace_id))
}

fn normalized_host(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('.');
    if value.is_empty() || value.len() > 253 || value.contains(['/', '\\', '@', ':', '*']) {
        return Err("允许主机名格式无效".to_string());
    }
    let candidate = format!("https://{value}/");
    let parsed = Url::parse(&candidate).map_err(|_| "允许主机名格式无效".to_string())?;
    if parsed.username() != ""
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.port().is_some()
    {
        return Err("允许主机名格式无效".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "允许主机名不能为空".to_string())?
        .to_ascii_lowercase();
    if host != value.to_ascii_lowercase() {
        return Err("允许主机名格式无效".to_string());
    }
    Ok(host)
}

fn normalize_allowed_hosts(values: &[String]) -> Result<Vec<String>, String> {
    if values.len() > MAX_ALLOWED_HOSTS {
        return Err(format!("允许主机名最多 {MAX_ALLOWED_HOSTS} 个"));
    }
    let mut hosts = Vec::with_capacity(values.len());
    for value in values {
        let host = normalized_host(value)?;
        if !hosts.iter().any(|item| item == &host) {
            hosts.push(host);
        }
    }
    Ok(hosts)
}

fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn reject_url_credentials(url: &Url) -> Result<(), String> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err("网页地址不能包含用户名或密码".to_string());
    }
    if url.host_str().is_none() {
        return Err("网页地址必须包含主机名".to_string());
    }
    Ok(())
}

fn validate_initial_url(
    value: &str,
    allowed_hosts: &[String],
) -> Result<(Url, Option<LoopbackOrigin>), String> {
    let url = Url::parse(value.trim()).map_err(|_| "网页地址格式无效".to_string())?;
    reject_url_credentials(&url)?;
    let scheme = url.scheme().to_ascii_lowercase();
    match scheme.as_str() {
        "https" => {
            let host = url
                .host_str()
                .ok_or_else(|| "HTTPS 网页地址必须包含主机名".to_string())?
                .to_ascii_lowercase();
            if !allowed_hosts.iter().any(|item| item == &host) {
                return Err("HTTPS 网页地址不在允许主机名列表中".to_string());
            }
            Ok((url, None))
        }
        "http" => {
            if !is_loopback_host(&url) {
                return Err("HTTP 网页只允许 localhost 或回环 IP".to_string());
            }
            let host = url
                .host_str()
                .ok_or_else(|| "回环 HTTP 地址必须包含主机名".to_string())?
                .to_ascii_lowercase();
            let port = url
                .port_or_known_default()
                .ok_or_else(|| "回环 HTTP 地址端口无效".to_string())?;
            Ok((url, Some(LoopbackOrigin { host, port })))
        }
        _ => Err("网页地址只允许 HTTPS，或回环地址上的 HTTP".to_string()),
    }
}

fn is_allowed_navigation(
    url: &Url,
    allowed_hosts: &[String],
    loopback_origin: Option<&LoopbackOrigin>,
) -> bool {
    if reject_url_credentials(url).is_err() {
        return false;
    }
    match url.scheme().to_ascii_lowercase().as_str() {
        "https" => url.host_str().is_some_and(|host| {
            allowed_hosts
                .iter()
                .any(|item| item == &host.to_ascii_lowercase())
        }),
        "http" => {
            let Some(origin) = loopback_origin else {
                return false;
            };
            let Some(host) = url.host_str() else {
                return false;
            };
            url.port_or_known_default() == Some(origin.port)
                && host.eq_ignore_ascii_case(&origin.host)
                && is_loopback_host(url)
        }
        _ => false,
    }
}

fn normalized_title(value: Option<&str>, workspace_id: &str) -> String {
    let title = value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(workspace_id);
    title.chars().take(MAX_TITLE_LENGTH).collect()
}

fn state_for_window(
    workspace_id: &str,
    window: &WebviewWindow,
) -> Result<WebWorkspaceState, String> {
    let url = window.url().map_err(|error| error.to_string())?;
    let title = window.title().ok().filter(|value| !value.trim().is_empty());
    Ok(WebWorkspaceState {
        workspace_id: workspace_id.to_string(),
        open: true,
        url: Some(url.to_string()),
        title,
    })
}

#[tauri::command]
pub async fn open_web_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OpenWebWorkspaceRequest,
) -> Result<WebWorkspaceState, String> {
    let workspace_id = validate_workspace_id(&request.workspace_id)?;
    let allowed_hosts = normalize_allowed_hosts(&request.allowed_hosts)?;
    let (initial_url, loopback_origin) = validate_initial_url(&request.url, &allowed_hosts)?;

    if let Some(window) = workspace_window(&app, &workspace_id) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return state_for_window(&workspace_id, &window);
    }

    let profile = profile_directory(&state, &workspace_id);
    fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    let navigation_hosts = allowed_hosts.clone();
    let navigation_loopback = loopback_origin.clone();
    let title = normalized_title(request.title.as_deref(), &workspace_id);
    let window = WebviewWindowBuilder::new(
        &app,
        window_label(&workspace_id),
        WebviewUrl::External(initial_url),
    )
    .title(format!("Proofline · {title}"))
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .data_directory(profile)
    .on_navigation(move |url| {
        is_allowed_navigation(url, &navigation_hosts, navigation_loopback.as_ref())
    })
    .on_new_window(|_url, _features| NewWindowResponse::Deny)
    .build()
    .map_err(|error| error.to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    state_for_window(&workspace_id, &window)
}

#[tauri::command]
pub fn get_web_workspace_state(
    app: AppHandle,
    workspace_id: String,
) -> Result<Option<WebWorkspaceState>, String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    workspace_window(&app, &workspace_id)
        .map(|window| state_for_window(&workspace_id, &window))
        .transpose()
}

#[tauri::command]
pub fn close_web_workspace(app: AppHandle, workspace_id: String) -> Result<(), String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    if let Some(window) = workspace_window(&app, &workspace_id) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_web_workspace_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    if let Some(window) = workspace_window(&app, &workspace_id) {
        window.close().map_err(|error| error.to_string())?;
    }
    let profile = profile_directory(&state, &workspace_id);
    if profile.exists() {
        fs::remove_dir_all(&profile).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_https_against_exact_host_allowlist() {
        let hosts = normalize_allowed_hosts(&["Example.COM".to_string()]).unwrap();
        assert!(validate_initial_url("https://example.com/app", &hosts).is_ok());
        assert!(validate_initial_url("https://www.example.com/app", &hosts).is_err());
    }

    #[test]
    fn only_allows_loopback_http() {
        let hosts = Vec::new();
        let (_, origin) = validate_initial_url("http://127.0.0.1:4312/#session=x", &hosts).unwrap();
        assert!(origin.is_some());
        assert!(validate_initial_url("http://192.168.1.5:4312", &hosts).is_err());
        assert!(validate_initial_url("http://127.0.0.1:4313", &hosts).is_ok());
    }

    #[test]
    fn rejects_unsafe_workspace_ids_and_urls() {
        assert!(validate_workspace_id("../profile").is_err());
        assert!(validate_workspace_id("workspace_1").is_ok());
        assert!(validate_initial_url("file:///tmp/index.html", &[]).is_err());
        assert!(
            validate_initial_url("https://example.com@evil.com", &["example.com".to_string()])
                .is_err()
        );
    }

    #[test]
    fn loopback_navigation_stays_on_the_same_origin() {
        let hosts = Vec::new();
        let (initial, origin) =
            validate_initial_url("http://localhost:4312/start", &hosts).unwrap();
        assert!(is_allowed_navigation(&initial, &hosts, origin.as_ref()));
        assert!(is_allowed_navigation(
            &Url::parse("http://localhost:4312/next").unwrap(),
            &hosts,
            origin.as_ref(),
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("http://localhost:4313/other").unwrap(),
            &hosts,
            origin.as_ref(),
        ));
    }
}
