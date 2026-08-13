use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::{OsStr, OsString},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MAX_SOURCE_BYTES: usize = 512_000;
const MAX_OUTPUT_BYTES: usize = 128_000;
const COMPILE_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCodeRunRequest {
    code: String,
    input: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCodeRunResult {
    ok: bool,
    output: String,
    error: Option<String>,
    duration_ms: f64,
    timed_out: bool,
}

struct ProcessOutcome {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration: Duration,
    timed_out: bool,
}

#[tauri::command]
pub async fn run_cpp_code(request: NativeCodeRunRequest) -> Result<NativeCodeRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_cpp_code_blocking(request))
        .await
        .map_err(|error| format!("C++17 运行任务异常结束：{error}"))?
}

fn run_cpp_code_blocking(request: NativeCodeRunRequest) -> Result<NativeCodeRunResult, String> {
    if request.code.trim().is_empty() {
        return Err("C++17 代码为空，无法编译。".to_string());
    }
    if request.code.len() > MAX_SOURCE_BYTES {
        return Err("C++17 代码超过 500 KB，已停止编译。".to_string());
    }

    let compiler = find_cpp_compiler()?;
    let directory = tempfile::Builder::new()
        .prefix("proofline-cpp-")
        .tempdir()
        .map_err(|error| format!("无法创建 C++17 临时目录：{error}"))?;
    let source_path = directory.path().join("solution.cpp");
    let executable_path = directory.path().join(if cfg!(windows) {
        "solution.exe"
    } else {
        "solution"
    });
    std::fs::write(&source_path, request.code.as_bytes())
        .map_err(|error| format!("无法写入 C++17 临时代码：{error}"))?;

    let compile_arguments = vec![
        OsString::from("-std=c++17"),
        OsString::from("-O0"),
        OsString::from("-pipe"),
        source_path.as_os_str().to_os_string(),
        OsString::from("-o"),
        executable_path.as_os_str().to_os_string(),
    ];
    let compile = run_process(
        compiler.as_os_str(),
        &compile_arguments,
        None,
        COMPILE_TIMEOUT,
        directory.path(),
    )?;
    if compile.timed_out {
        return Ok(NativeCodeRunResult {
            ok: false,
            output: compile.stdout,
            error: Some("C++17 编译超过 20 秒，已强制终止。".to_string()),
            duration_ms: compile.duration.as_secs_f64() * 1000.0,
            timed_out: true,
        });
    }
    if !compile.success {
        let diagnostics = useful_diagnostics(&compile.stderr, &compile.stdout);
        return Ok(NativeCodeRunResult {
            ok: false,
            output: compile.stdout,
            error: Some(format!("C++17 编译失败：\n{diagnostics}")),
            duration_ms: compile.duration.as_secs_f64() * 1000.0,
            timed_out: false,
        });
    }

    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(3_000).clamp(100, 3_000));
    let execution = run_process(
        executable_path.as_os_str(),
        &[],
        request.input.as_deref(),
        timeout,
        directory.path(),
    )?;
    let duration_ms = execution.duration.as_secs_f64() * 1000.0;
    if execution.timed_out {
        return Ok(NativeCodeRunResult {
            ok: false,
            output: execution.stdout,
            error: Some(format!(
                "C++17 运行超过 {} 毫秒，已强制终止程序及其子进程。",
                timeout.as_millis()
            )),
            duration_ms,
            timed_out: true,
        });
    }
    if !execution.success {
        let detail = useful_diagnostics(&execution.stderr, &execution.stdout);
        let exit = execution
            .exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未知".to_string());
        return Ok(NativeCodeRunResult {
            ok: false,
            output: execution.stdout,
            error: Some(format!("程序异常退出（退出代码 {exit}）：\n{detail}")),
            duration_ms,
            timed_out: false,
        });
    }
    Ok(NativeCodeRunResult {
        ok: true,
        output: execution.stdout,
        error: (!execution.stderr.trim().is_empty()).then_some(execution.stderr),
        duration_ms,
        timed_out: false,
    })
}

fn find_cpp_compiler() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(explicit) = env::var_os("PROOFLINE_CXX").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(explicit));
    }
    candidates.extend([PathBuf::from("g++"), PathBuf::from("clang++")]);

    for candidate in candidates {
        let mut command = Command::new(&candidate);
        command
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_window(&mut command);
        if command.status().is_ok_and(|status| status.success()) {
            return Ok(candidate);
        }
    }
    Err("未找到可用的 C++17 编译器。请安装 MinGW-w64/LLVM，并把 g++ 或 clang++ 加入 PATH；也可以设置 PROOFLINE_CXX。".to_string())
}

fn run_process(
    program: &OsStr,
    arguments: &[OsString],
    input: Option<&str>,
    timeout: Duration,
    working_directory: &Path,
) -> Result<ProcessOutcome, String> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .current_dir(working_directory)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", program.to_string_lossy()))?;

    if let (Some(value), Some(mut stdin)) = (input, child.stdin.take()) {
        let bytes = value.as_bytes().to_vec();
        thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    let stdout_reader = child.stdout.take().map(spawn_output_reader);
    let stderr_reader = child.stderr.take().map(spawn_output_reader);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= timeout => {
                timed_out = true;
                terminate_process_tree(&mut child);
                break child.wait().ok();
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                terminate_process_tree(&mut child);
                return Err(format!("读取程序状态失败：{error}"));
            }
        }
    };
    let stdout = stdout_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    Ok(ProcessOutcome {
        success: status.is_some_and(|value| value.success()) && !timed_out,
        exit_code: status.and_then(|value| value.code()),
        stdout,
        stderr,
        duration: started.elapsed(),
        timed_out,
    })
}

fn spawn_output_reader<R: Read + Send + 'static>(mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut kept = Vec::with_capacity(8_192);
        let mut buffer = [0_u8; 8_192];
        let mut truncated = false;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let remaining = MAX_OUTPUT_BYTES.saturating_sub(kept.len());
                    kept.extend_from_slice(&buffer[..count.min(remaining)]);
                    if count > remaining {
                        truncated = true;
                    }
                }
            }
        }
        let mut text = String::from_utf8_lossy(&kept).into_owned();
        if truncated {
            text.push_str("\n[输出超过 128 KB，后续内容已省略]");
        }
        text
    })
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_window(&mut command);
        let _ = command.status();
    }
    let _ = child.kill();
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

fn useful_diagnostics(stderr: &str, stdout: &str) -> String {
    let detail = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    if detail.trim().is_empty() {
        "程序没有返回诊断信息。".to_string()
    } else {
        detail.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static CPP_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn cpp_runner_compiles_and_executes_when_compiler_is_available() {
        let _guard = CPP_TEST_LOCK.lock().unwrap();
        if find_cpp_compiler().is_err() {
            return;
        }
        let result = run_cpp_code_blocking(NativeCodeRunRequest {
            code: "#include <iostream>\nint main(){ std::cout << 42; }".to_string(),
            input: None,
            timeout_ms: Some(3_000),
        })
        .unwrap();
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(result.output.trim(), "42");
    }

    #[test]
    fn cpp_runner_terminates_an_infinite_loop() {
        let _guard = CPP_TEST_LOCK.lock().unwrap();
        if find_cpp_compiler().is_err() {
            return;
        }
        let result = run_cpp_code_blocking(NativeCodeRunRequest {
            code: "int main(){ volatile int x = 0; while(true){ ++x; } }".to_string(),
            input: None,
            timeout_ms: Some(100),
        })
        .unwrap();
        assert!(!result.ok);
        assert!(result.timed_out);
        assert!(result.error.unwrap().contains("强制终止"));
    }

    #[test]
    fn oversized_source_is_rejected_before_compilation() {
        let error = run_cpp_code_blocking(NativeCodeRunRequest {
            code: "x".repeat(MAX_SOURCE_BYTES + 1),
            input: None,
            timeout_ms: None,
        })
        .unwrap_err();
        assert!(error.contains("500 KB"));
    }
}
