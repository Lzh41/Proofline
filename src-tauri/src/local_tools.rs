use std::{
    fs::{self, File},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

#[cfg(not(windows))]
use std::env;

/// 单次探测的超时。给短一点：列表里一次要探十几个端口，逐个卡住会拖慢整页。
const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Windows 进程创建标志：不建控制台窗口、独占一个进程组。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// macOS / Linux 上 GUI 进程拿不到登录终端里的 PATH（launchd 只给
/// `/usr/bin:/bin:/usr/sbin:/sbin`），补上 Homebrew 与手动安装位置，
/// 免得 `python serve.py` 这类命令在应用里点起来却找不到解释器。
#[cfg(not(windows))]
const EXTRA_PATH: &str = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReceipt {
    pub pid: u32,
    pub log_path: String,
}

/// 探测 127.0.0.1 上某个端口是否在监听。
///
/// 走本地 TCP 连接而不是 HTTP 请求：本地服务的响应体五花八门，有些还会校验来源，
/// 能不能建立连接才是「它活着」的可靠信号。
#[tauri::command]
pub async fn probe_local_port(port: u16) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        TcpStream::connect_timeout(&address, PROBE_TIMEOUT).is_ok()
    })
    .await
    .unwrap_or(false)
}

fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => ch,
            ' ' => '-',
            _ => '-',
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "tool".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

/// 按平台拼一个「能跑用户那条命令行」的 shell。
///
/// Windows 走 `cmd /S /C`；macOS / Linux 走登录 shell（`-l`），因为只有登录 shell 才会读
/// `/etc/zprofile`、`~/.zprofile`，brew / pyenv / conda 装的解释器才进得了 PATH。
/// 非 Windows 侧还显式建了新进程组（`process_group(0)`），这样 `stop_local_tool`
/// 能按组把 shell 拉起的子进程一起收掉，而不是只杀掉外面的壳。
#[cfg(windows)]
fn build_shell_command(command: &str) -> Command {
    use std::os::windows::process::CommandExt;

    let mut process = Command::new("cmd");
    // /S 加上整行引号：命令本身多半以引号包着一个含空格的解释器路径，
    // 不加这层会被 cmd 的引号规则吃掉。
    process.raw_arg(format!("/S /C \"{command}\""));
    process.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    process
}

#[cfg(not(windows))]
fn build_shell_command(command: &str) -> Command {
    use std::os::unix::process::CommandExt;

    let shell = env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let mut process = Command::new(shell);
    process.arg("-lc").arg(command);

    let path = match env::var("PATH") {
        Ok(existing) if !existing.trim().is_empty() => format!("{EXTRA_PATH}:{existing}"),
        _ => EXTRA_PATH.to_string(),
    };
    process.env("PATH", path);
    process.process_group(0);
    process
}

/// 在后台拉起一个本地服务，立刻返回，不等它退出。
///
/// 关键点是**不给它控制台窗口**：早先用 `start /MIN` 起一扇最小化的黑窗，用户得从任务栏
/// 关掉它才能停服务，很难看。现在 Windows 侧用 CREATE_NO_WINDOW 直接起，
/// macOS / Linux 侧本来就只在后台跑 shell，标准输出写进 `<数据目录>/tool-logs/`，
/// 出问题还能翻日志。停服务改由工具页的结束按钮负责。
#[tauri::command]
pub fn launch_local_tool(
    state: tauri::State<'_, crate::AppState>,
    name: String,
    command: String,
    working_directory: Option<String>,
) -> Result<LaunchReceipt, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("启动命令为空".to_string());
    }

    if let Some(directory) = working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !Path::new(directory).is_dir() {
            return Err(format!("工作目录不存在：{directory}"));
        }
    }

    let log_dir = state.paths.root.join("tool-logs");
    fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建日志目录：{error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("{}-{}.log", sanitize_file_stem(&name), stamp));
    let stdout = File::create(&log_path).map_err(|error| format!("无法写入服务日志：{error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("无法写入服务日志：{error}"))?;

    let mut process = build_shell_command(trimmed);

    if let Some(directory) = working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        process.current_dir(directory);
    }

    process
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    let child = process
        .spawn()
        .map_err(|error| format!("无法执行启动命令：{error}"))?;

    Ok(LaunchReceipt {
        pid: child.id(),
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

/// 找出监听该端口的进程。
///
/// Windows 读 `netstat -ano`；macOS / Linux 用 `lsof -t`。两边的输出格式差别太大，
/// 不共用解析逻辑。
#[cfg(windows)]
fn listening_pids(port: u16) -> Result<Vec<u32>, String> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .map_err(|error| format!("无法读取端口占用：{error}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let wanted = port.to_string();
    let mut pids: Vec<u32> = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !parts[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let local = parts[1];
        let local_port = local.rsplit(':').next().unwrap_or("");
        if local_port != wanted {
            continue;
        }
        if let Ok(pid) = parts[4].parse::<u32>() {
            // 0 和 4 是 Idle/System，误杀会拖垮系统。
            if pid > 4 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
    }
    Ok(pids)
}

#[cfg(unix)]
fn listening_pids(port: u16) -> Result<Vec<u32>, String> {
    // `-t` 只要 pid：macOS 自带 /usr/sbin/lsof，Linux 装了 lsof 也能用。
    // lsof 在没有匹配项时退出码是 1，输出为空——这不算失败。
    let output = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("无法读取端口占用（需要 lsof）：{error}"))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut pids: Vec<u32> = Vec::new();
    for line in text.lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if pid > 1 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
    }
    Ok(pids)
}

/// 结束单个进程（含它拉起的子进程）。
#[cfg(windows)]
fn terminate(pid: u32) -> bool {
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|value| value.success())
        .unwrap_or(false)
}

#[cfg(unix)]
fn signal_group(pid: u32, flag: &str) -> bool {
    Command::new("pkill")
        .args([flag, "-g", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|value| value.success())
        .unwrap_or(false)
}

#[cfg(unix)]
fn signal_pid(pid: u32, flag: &str) -> bool {
    Command::new("/bin/kill")
        .args([flag, &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|value| value.success())
        .unwrap_or(false)
}

/// 先 SIGTERM 让服务自己收尾，再对整组 SIGKILL。
///
/// 直接 SIGKILL 会把 uvicorn / http.server 的 socket 留在 TIME_WAIT，端口立刻重开可能失败；
/// 而只杀外层壳又会把 python/node 子进程留在那儿继续占端口，所以按进程组走。
/// 服务若不是本应用拉起的（用户自己双击脚本那种），进程组未必等于 pid，最后再补一刀直接杀 pid。
#[cfg(unix)]
fn terminate(pid: u32) -> bool {
    let termed = signal_group(pid, "-TERM");
    std::thread::sleep(Duration::from_millis(250));
    let killed = signal_group(pid, "-KILL");
    let direct = signal_pid(pid, "-KILL");
    termed || killed || direct
}

/// 结束占用某个端口的本地服务，连同它拉起的子进程。
///
/// 按端口找进程而不是记 spawn 时的 pid：服务可能是别人（或用户自己双击脚本）启动的，
/// 记 pid 的那条路覆盖不到。只动监听该端口的进程，其余不碰。
#[tauri::command]
pub fn stop_local_tool(port: u16) -> Result<Vec<u32>, String> {
    if port <= 1024 {
        return Err(format!("端口 {port} 属于系统保留范围，不敢动"));
    }
    let pids = listening_pids(port)?;
    if pids.is_empty() {
        return Ok(Vec::new());
    }
    let mut killed = Vec::new();
    for pid in pids {
        if terminate(pid) {
            killed.push(pid);
        }
    }
    Ok(killed)
}
