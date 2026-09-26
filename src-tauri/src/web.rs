use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    webview::{NewWindowResponse, Webview, WebviewWindow},
    AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl,
};
use url::Url;

use crate::AppState;

// 主窗口使用无边框布局：顶部 36px 原生标题栏 + 48px 应用顶栏，左侧为导航栏。
// WebView 作为 child 覆盖主内容区，避免再打开独立原生窗口。
const MAIN_SIDEBAR_WIDTH: f64 = 236.0;
const COLLAPSED_SIDEBAR_WIDTH: f64 = 0.0;
const MAIN_TITLEBAR_HEIGHT: f64 = 36.0;
const MAIN_TOPBAR_HEIGHT: f64 = 48.0;
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

fn child_label(workspace_id: &str) -> String {
    format!("web-child-{workspace_id}")
}

fn profile_directory(state: &AppState, workspace_id: &str) -> PathBuf {
    state
        .paths
        .platforms
        .join("web-workspaces")
        .join(workspace_id)
}

fn legacy_workspace_window(app: &AppHandle, workspace_id: &str) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(&window_label(workspace_id))
}

fn workspace_child<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
) -> Option<Webview<R>> {
    app.get_webview(&child_label(workspace_id))
}

fn child_bounds<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    sidebar_width: f64,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let width = f64::from(size.width) / scale;
    let height = f64::from(size.height) / scale;
    Ok((
        LogicalPosition::new(sidebar_width, MAIN_TITLEBAR_HEIGHT + MAIN_TOPBAR_HEIGHT),
        LogicalSize::new(
            (width - sidebar_width).max(320.0),
            (height - MAIN_TITLEBAR_HEIGHT - MAIN_TOPBAR_HEIGHT).max(240.0),
        ),
    ))
}

fn hide_other_children<R: tauri::Runtime>(app: &AppHandle<R>, active_label: &str) {
    for webview in app.webviews().into_values() {
        if webview.label().starts_with("web-child-") && webview.label() != active_label {
            let _ = webview.hide();
        }
    }
}

fn activate_child<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Option<WebWorkspaceState>, String> {
    let Some(webview) = workspace_child(app, workspace_id) else {
        return Ok(None);
    };
    let main = app
        .get_window("main")
        .ok_or_else(|| "找不到 Proofline 主窗口".to_string())?;
    let active_label = child_label(workspace_id);
    hide_other_children(app, &active_label);
    let sidebar_collapsed = *app
        .state::<AppState>()
        .web_workspace_sidebar_collapsed
        .lock()
        .map_err(|_| "读取 Web 工作台布局状态失败".to_string())?;
    let (position, size) = child_bounds(
        &main,
        if sidebar_collapsed {
            COLLAPSED_SIDEBAR_WIDTH
        } else {
            MAIN_SIDEBAR_WIDTH
        },
    )?;
    webview
        .set_position(position)
        .and_then(|_| webview.set_size(size))
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    webview.set_focus().map_err(|error| error.to_string())?;
    state_for_child(workspace_id, &webview).map(Some)
}

/// 主窗口尺寸变化时同步所有 child WebView 的内容区域。
pub fn resize_web_workspaces<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let sidebar_collapsed = window
        .app_handle()
        .state::<AppState>()
        .web_workspace_sidebar_collapsed
        .lock()
        .map(|value| *value)
        .unwrap_or(true);
    let Ok((position, size)) = child_bounds(
        window,
        if sidebar_collapsed {
            COLLAPSED_SIDEBAR_WIDTH
        } else {
            MAIN_SIDEBAR_WIDTH
        },
    ) else {
        return;
    };
    for webview in window.app_handle().webviews().into_values() {
        if webview.label().starts_with("web-child-") {
            let _ = webview.set_position(position);
            let _ = webview.set_size(size);
        }
    }
}

#[tauri::command]
pub fn set_web_workspace_layout(app: AppHandle, collapsed: bool) -> Result<(), String> {
    *app.state::<AppState>()
        .web_workspace_sidebar_collapsed
        .lock()
        .map_err(|_| "更新 Web 工作台布局状态失败".to_string())? = collapsed;
    if let Some(window) = app.get_window("main") {
        resize_web_workspaces(&window);
    }
    Ok(())
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

fn state_for_child<R: tauri::Runtime>(
    workspace_id: &str,
    webview: &Webview<R>,
) -> Result<WebWorkspaceState, String> {
    let url = webview.url().map_err(|error| error.to_string())?;
    Ok(WebWorkspaceState {
        workspace_id: workspace_id.to_string(),
        open: true,
        url: Some(url.to_string()),
        title: None,
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

    if let Some(state) = activate_child(&app, &workspace_id)? {
        return Ok(state);
    }

    // 兼容升级前创建的独立窗口：关闭旧窗口后在主窗口内重建 child，保留其 profile 目录。
    if let Some(window) = legacy_workspace_window(&app, &workspace_id) {
        window.close().map_err(|error| error.to_string())?;
    }

    let profile = profile_directory(&state, &workspace_id);
    fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    let navigation_hosts = allowed_hosts.clone();
    let navigation_loopback = loopback_origin.clone();
    let main = app
        .get_window("main")
        .ok_or_else(|| "找不到 Proofline 主窗口".to_string())?;
    let sidebar_collapsed = *app
        .state::<AppState>()
        .web_workspace_sidebar_collapsed
        .lock()
        .map_err(|_| "读取 Web 工作台布局状态失败".to_string())?;
    let (position, size) = child_bounds(
        &main,
        if sidebar_collapsed {
            COLLAPSED_SIDEBAR_WIDTH
        } else {
            MAIN_SIDEBAR_WIDTH
        },
    )?;
    let active_label = child_label(&workspace_id);
    let title = normalized_title(request.title.as_deref(), &workspace_id);
    let title_script = format!(
        "document.title = {};",
        serde_json::to_string(&title).map_err(|error| error.to_string())?
    );
    let webview =
        tauri::webview::WebviewBuilder::new(&active_label, WebviewUrl::External(initial_url))
            .initialization_script(title_script)
            .data_directory(profile)
            .on_navigation(move |url| {
                is_allowed_navigation(url, &navigation_hosts, navigation_loopback.as_ref())
            })
            .on_new_window(|_url, _features| NewWindowResponse::Deny);
    hide_other_children(&app, &active_label);
    let webview = main
        .add_child(webview, position, size)
        .map_err(|error| error.to_string())?;
    webview.show().map_err(|error| error.to_string())?;
    webview.set_focus().map_err(|error| error.to_string())?;
    state_for_child(&workspace_id, &webview)
}

#[tauri::command]
pub fn activate_web_workspace(
    app: AppHandle,
    workspace_id: String,
) -> Result<Option<WebWorkspaceState>, String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    activate_child(&app, &workspace_id)
}

#[tauri::command]
pub fn get_web_workspace_state(
    app: AppHandle,
    workspace_id: String,
) -> Result<Option<WebWorkspaceState>, String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    if let Some(webview) = workspace_child(&app, &workspace_id) {
        return state_for_child(&workspace_id, &webview).map(Some);
    }
    legacy_workspace_window(&app, &workspace_id)
        .map(|window| state_for_window(&workspace_id, &window))
        .transpose()
}

#[tauri::command]
pub fn close_web_workspace(app: AppHandle, workspace_id: String) -> Result<(), String> {
    let workspace_id = validate_workspace_id(&workspace_id)?;
    if let Some(webview) = workspace_child(&app, &workspace_id) {
        webview.close().map_err(|error| error.to_string())?;
    }
    if let Some(window) = legacy_workspace_window(&app, &workspace_id) {
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
    if let Some(webview) = workspace_child(&app, &workspace_id) {
        webview.close().map_err(|error| error.to_string())?;
    }
    if let Some(window) = legacy_workspace_window(&app, &workspace_id) {
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
