use crate::AppState;
use keyring::Entry;
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{ipc::Channel, State};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.xiti.desktop";
const KEYRING_USER: &str = "ai-api-key";
const AI_TIMEOUT_SECS: u64 = 45;
const MAX_PROMPT_BYTES: usize = 96 * 1024;
const MAX_STREAM_BUFFER_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Delta { content: String },
    Done,
    Error { message: String },
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    done: bool,
}

impl SseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<AiStreamEvent>, String> {
        if self.done {
            return Ok(Vec::new());
        }
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > MAX_STREAM_BUFFER_BYTES {
            return Err("AI 流式响应单行过大，已停止读取".to_string());
        }

        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.parse_line(&line, &mut events)?;
            if self.done {
                self.buffer.clear();
                break;
            }
        }
        Ok(events)
    }

    fn finish(&mut self) -> Result<Vec<AiStreamEvent>, String> {
        if self.done || self.buffer.is_empty() {
            return Ok(Vec::new());
        }
        let line = std::mem::take(&mut self.buffer);
        let mut events = Vec::new();
        self.parse_line(&line, &mut events)?;
        Ok(events)
    }

    fn parse_line(&mut self, line: &[u8], events: &mut Vec<AiStreamEvent>) -> Result<(), String> {
        let line =
            std::str::from_utf8(line).map_err(|_| "AI 流式响应包含无效 UTF-8".to_string())?;
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(());
        };
        let data = data.trim_start();
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        if data.is_empty() {
            return Ok(());
        }

        let payload: Value = serde_json::from_str(data)
            .map_err(|error| format!("AI 流式响应不是有效 JSON：{error}"))?;
        if let Some(message) = payload.pointer("/error/message").and_then(Value::as_str) {
            return Err(format!("AI 服务返回错误：{message}"));
        }
        if let Some(content) = extract_stream_content(&payload) {
            if !content.is_empty() {
                events.push(AiStreamEvent::Delta { content });
            }
        }
        Ok(())
    }
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_ai_credential(key: String) -> Result<(), String> {
    let value = key.trim();
    if value.len() < 8 {
        return Err("API 密钥长度无效".to_string());
    }
    credential_entry()?
        .set_password(value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_ai_credential() -> Result<(), String> {
    delete_stored_credential()
}

pub(crate) fn delete_stored_credential() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn has_ai_credential() -> bool {
    credential_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok()
}

fn ai_endpoint(base_url: &str) -> Result<Url, String> {
    let base = Url::parse(base_url.trim()).map_err(|_| "AI 基础地址格式无效".to_string())?;
    let is_loopback_http = base.scheme() == "http"
        && base
            .host_str()
            .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
    if base.scheme() != "https" && !is_loopback_http {
        return Err("AI 接口必须使用 HTTPS；本机回环地址可使用 HTTP".to_string());
    }
    let raw = base.as_str().trim_end_matches('/');
    let endpoint = if raw.ends_with("/chat/completions") {
        raw.to_string()
    } else {
        format!("{raw}/chat/completions")
    };
    Url::parse(&endpoint).map_err(|_| "无法生成 AI 请求地址".to_string())
}

fn coach_instruction(intent: &str) -> Result<(&'static str, &'static str), String> {
    match intent {
        "analyze" => Ok((
            "分析当前代码",
            "先分析当前代码已经完成什么、还缺什么以及最先应修改的位置。必须给出一小段可直接替换或插入的代码，不得只讲抽象思路或给出完整答案。",
        )),
        "algorithm-logic" => Ok((
            "算法逻辑拆解",
            "解释算法为什么这样写，而不是直接给完整代码。必须把题意观察、算法或数据结构选择、状态或变量定义、循环或转移规则、关键不变量、边界处理和复杂度串成因果链；可以给少量关键伪代码或局部代码落点，但不得输出完整答案。",
        )),
        "next-code" => Ok((
            "给下一段提示",
            "只推进当前最关键的一段实现。明确插入或替换位置，给出合法的局部代码和运行后的自检目标；不得重复已正确内容或给出完整答案。",
        )),
        "debug" => Ok((
            "解释运行问题",
            "结合最近运行反馈定位根因，先给最小修复，再给修复后的局部代码和重新运行时应观察的结果；反馈不足时必须说明，不能臆测。",
        )),
        "explain" => Ok((
            "AI 解惑",
            "专门回答用户对题目、当前代码、报错或算法概念不懂的地方。像对话问答一样先确认用户卡点，再结合当前代码、变量变化、例子和必要的小片段讲明白；不要机械套模板，也不要主动展开成完整答案。",
        )),
        "complete" => Ok((
            "给完整代码",
            "给出当前语言下完整、可运行或平台可提交的最终实现。代码中禁止 TODO、占位函数、省略号或未实现分支；随后解释关键逻辑、复杂度和边界。",
        )),
        "interview-follow-up" => Ok((
            "模拟递进追问",
            "扮演真实技术面试官，承接候选人的当前回答，只提出一个最有区分度的递进问题；不要同时给出答案、点评或多个问题。",
        )),
        "interview-critique" => Ok((
            "点评面试回答",
            "先指出回答中准确且有价值的部分，再按影响排序说明技术错误、论证缺口或表达不清的位置，最后给出一段候选人可以直接补充的自然口头表达。",
        )),
        "interview-omissions" => Ok((
            "检查回答遗漏",
            "只检查候选人尚未覆盖的关键考点，逐项说明为什么会影响面试评价以及应补充什么；不要重复已经说清楚的内容，也不要照抄参考答案。",
        )),
        "interview-improve" => Ok((
            "优化完整回答",
            "保留候选人回答中正确的内容，按结论、原理、工程落地和风险边界组织成自然、可信的完整口头回答，并附一份三十秒精简版；不得虚构项目经历。",
        )),
        "interview-examiner" => Ok((
            "生成主题面试题",
            "围绕用户指定的技术主题、岗位、难度和题量，生成不重复、不换皮且有真实区分度的考点与题目；答案必须技术准确，并包含回答要点和递进追问。",
        )),
        _ => Err("未知的 AI 代码教练请求类型".to_string()),
    }
}

fn coach_system_prompt(intent: &str, intent_label: &str, instruction: &str) -> String {
    match intent {
        "interview-examiner" => format!(
            "你是 Proofline 的资深中文技术面试出题官。必须使用简体中文，技术名词、公式和代码标识符可以保留英文。\n本轮请求：{intent_label}。{instruction}\n输出约束：只输出一个合法 JSON 对象，并严格遵守用户提示中给出的字段、枚举值和题目数量。禁止 Markdown 代码围栏、解释性前后缀或 JSON 之外的任何字符；首字符必须是 `{{`，末字符必须是 `}}`。不得编造不存在的技术结论；信息不足时只能在 JSON 字段内容中明确说明合理假设。"
        ),
        "interview-follow-up" => format!(
            "你是 Proofline 中严谨但耐心的中文技术面试官。必须使用简体中文，并基于题目、候选人当前回答和参考要点进行判断。\n本轮请求：{intent_label}。{instruction}\n直接输出一个完整的递进问题，不使用 Markdown 标题、列表或代码块。问题应能检验理解深度，并自然承接候选人已经说过的内容。信息不足时围绕最关键的不确定点追问，不得编造候选人的经历。"
        ),
        "interview-critique" => format!(
            "你是 Proofline 中严谨但耐心的中文技术面试教练。必须使用简体中文，并基于题目、候选人当前回答和参考要点进行判断，帮助候选人形成能在真实面试中说出口的回答。\n本轮请求：{intent_label}。{instruction}\n严格按以下面试反馈标题输出：## 回答得好的地方、## 需要修正、## 可以这样补充。不得套用算法代码教练的“当前判断、现在改这里、代码片段、运行后看什么”格式；除非题目明确要求代码示例，否则不要输出代码块。不得虚构候选人的经历。"
        ),
        "interview-omissions" => format!(
            "你是 Proofline 中严谨但耐心的中文技术面试教练。必须使用简体中文，并基于题目、候选人当前回答和参考要点进行判断。\n本轮请求：{intent_label}。{instruction}\n严格按以下面试反馈标题输出：## 关键遗漏、## 为什么重要、## 建议补充。禁止套用算法代码教练格式；除非题目明确要求代码示例，否则不要输出代码块。不得虚构候选人的经历。"
        ),
        "interview-improve" => format!(
            "你是 Proofline 中严谨但耐心的中文技术面试教练。必须使用简体中文，并基于题目、候选人当前回答和参考要点进行判断。\n本轮请求：{intent_label}。{instruction}\n严格按以下面试表达标题输出：## 完整回答、## 三十秒回答、## 可能追问。回答应适合口头表达，技术结论准确且因果清楚；禁止套用算法代码教练格式，除非题目明确要求代码示例，否则不要输出代码块。不得虚构候选人的经历。"
        ),
        _ => {
            let output_format = if intent == "complete" {
                "严格按以下 Markdown 标题和顺序输出：## 完整代码、## 关键逻辑、## 复杂度、## 边界检查。完整代码必须放在一个代码块中，且不含任何 TODO。"
            } else if intent == "algorithm-logic" {
                "严格按以下 Markdown 标题和顺序输出：## 题意观察、## 为什么选这个算法、## 状态与变量、## 推导过程、## 边界与复杂度、## 写代码时落在哪里。只允许出现伪代码或局部代码落点，不输出完整代码。"
            } else if intent == "explain" {
                "像对话问答一样自然回答：先用一句话复述用户真正卡住的点，再结合当前代码和一个具体例子逐步解释；需要代码时只给最小片段，并说明这一段为什么这样写。"
            } else {
                "严格按以下 Markdown 标题和顺序输出：## 当前判断、## 现在改这里、## 代码片段、## 运行后看什么。一次只解决当前最重要的问题。"
            };
            format!(
                "你是 Proofline 算法代码教练。必须使用简体中文，像结对编程一样帮助用户亲手把代码写完，不能只讲抽象思路。\n本轮请求：{intent_label}。{instruction}\n{output_format}\n必须先检查并承接用户当前代码，保留已正确的部分，指出代码准确的插入或替换位置。用户提示中的“当前语言”优先；只有用户未选择语言时才默认 C++17。\n若信息不足，明确指出缺失信息，不得编造题目约束。"
            )
        }
    }
}

fn coach_system(intent: &str) -> Result<String, String> {
    let (intent_label, instruction) = coach_instruction(intent)?;
    Ok(coach_system_prompt(intent, intent_label, instruction))
}

#[tauri::command]
pub async fn test_ai_connection(base_url: String, model: String) -> Result<bool, String> {
    if model.trim().is_empty() {
        return Err("请先填写模型 ID".to_string());
    }
    let key = credential_entry()?
        .get_password()
        .map_err(|_| "尚未保存 AI API 密钥".to_string())?;
    let response = Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .post(ai_endpoint(&base_url)?)
        .bearer_auth(key)
        .json(&json!({
            "model": model,
            "messages": [{"role": "user", "content": "仅回复 OK"}],
            "max_tokens": 4,
            "temperature": 0
        }))
        .send()
        .await
        .map_err(|error| format!("AI 连接失败：{error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("AI 接口返回 {status}：{}", truncate(&body, 300)));
    }
    Ok(true)
}

#[tauri::command]
pub async fn request_ai_hint(
    state: State<'_, AppState>,
    base_url: String,
    model: String,
    prompt: String,
    intent: Option<String>,
    on_event: Channel<AiStreamEvent>,
) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("请先填写模型 ID".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("AI 提示内容不能为空".to_string());
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err("发送给 AI 的内容超过 96 KB，请缩短题面或历史上下文。".to_string());
    }
    let intent = intent.unwrap_or_else(|| {
        if prompt_level(&prompt) >= 5 {
            "complete".to_string()
        } else {
            "next-code".to_string()
        }
    });
    let system = coach_system(&intent)?;
    let key = credential_entry()?
        .get_password()
        .map_err(|_| "尚未保存 AI API 密钥".to_string())?;
    let mut request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "stream": true
    });
    let token_budget = completion_token_budget(&intent, &prompt);
    if uses_reasoning_model(&model) {
        request_body["max_completion_tokens"] = json!(token_budget);
    } else {
        request_body["temperature"] = json!(0.2);
        request_body["max_tokens"] = json!(token_budget);
    }
    let token = CancellationToken::new();
    let request_id = Uuid::new_v4();
    {
        let mut active = state
            .ai_request
            .lock()
            .map_err(|_| "AI 请求状态不可用".to_string())?;
        if let Some((_, existing)) = active.take() {
            existing.cancel();
        }
        *active = Some((request_id, token.clone()));
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(AI_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let operation = async {
        let mut response = client
            .post(ai_endpoint(&base_url)?)
            .bearer_auth(key)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&request_body)
            .send()
            .await
            .map_err(|error| request_error("AI 请求失败", error))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("AI 接口返回 {status}：{}", truncate(&body, 500)));
        }

        let is_event_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
        if !is_event_stream {
            if response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
            {
                return Err("AI 非流式响应超过 2 MB，已中止。".to_string());
            }
            let raw = response
                .bytes()
                .await
                .map_err(|error| format!("AI 响应读取失败：{error}"))?;
            if raw.len() > MAX_RESPONSE_BYTES {
                return Err("AI 非流式响应超过 2 MB，已中止。".to_string());
            }
            let body: Value = serde_json::from_slice(&raw)
                .map_err(|error| format!("AI 响应不是有效 JSON：{error}"))?;
            let content =
                extract_content(&body).ok_or_else(|| "AI 响应中没有可显示的内容".to_string())?;
            on_event
                .send(AiStreamEvent::Delta {
                    content: content.clone(),
                })
                .map_err(|_| "AI 流式通道已断开".to_string())?;
            return Ok(content);
        }

        let mut decoder = SseDecoder::default();
        let mut content = String::new();
        let mut response_bytes = 0usize;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| request_error("AI 流式读取失败", error))?
        {
            response_bytes = response_bytes.saturating_add(chunk.len());
            if response_bytes > MAX_RESPONSE_BYTES {
                return Err("AI 流式响应超过 2 MB，已中止。".to_string());
            }
            for event in decoder.push(&chunk)? {
                if let AiStreamEvent::Delta { content: delta } = &event {
                    content.push_str(delta);
                }
                on_event
                    .send(event)
                    .map_err(|_| "AI 流式通道已断开".to_string())?;
            }
        }
        for event in decoder.finish()? {
            if let AiStreamEvent::Delta { content: delta } = &event {
                content.push_str(delta);
            }
            on_event
                .send(event)
                .map_err(|_| "AI 流式通道已断开".to_string())?;
        }
        if content.trim().is_empty() {
            return Err("AI 响应中没有可显示的内容".to_string());
        }
        Ok(content)
    };
    let result = tokio::select! {
        _ = token.cancelled() => Err("AI 请求已取消".to_string()),
        result = operation => result,
    };
    if let Ok(mut active) = state.ai_request.lock() {
        if active.as_ref().is_some_and(|(id, _)| *id == request_id) {
            active.take();
        }
    }
    match &result {
        Ok(_) => {
            let _ = on_event.send(AiStreamEvent::Done);
        }
        Err(message) => {
            let _ = on_event.send(AiStreamEvent::Error {
                message: message.clone(),
            });
        }
    }
    result
}

#[tauri::command]
pub fn cancel_ai_request(state: State<'_, AppState>) -> Result<(), String> {
    let mut active = state
        .ai_request
        .lock()
        .map_err(|_| "AI 请求状态不可用".to_string())?;
    if let Some((_, token)) = active.take() {
        token.cancel();
    }
    Ok(())
}

fn extract_content(body: &Value) -> Option<String> {
    let content = body.pointer("/choices/0/message/content")?;
    extract_content_value(content)
}

fn extract_stream_content(body: &Value) -> Option<String> {
    body.pointer("/choices/0/delta/content")
        .or_else(|| body.pointer("/choices/0/message/content"))
        .or_else(|| body.pointer("/choices/0/text"))
        .and_then(extract_content_value)
}

fn extract_content_value(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    })
}

fn request_error(context: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        format!(
            "AI 请求超时（{} 秒），请检查接口地址、模型 ID 或网络连接。",
            AI_TIMEOUT_SECS
        )
    } else {
        format!("{context}：{error}")
    }
}

fn completion_token_budget(intent: &str, prompt: &str) -> u32 {
    if intent == "interview-examiner" || prompt.contains("本轮请求：生成主题面试题") {
        3_000
    } else if intent == "complete" || prompt.contains("本轮请求：给完整代码") {
        4_096
    } else {
        1_536
    }
}

fn uses_reasoning_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.contains("gpt-5")
        || normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
        || normalized.contains("/o1")
        || normalized.contains("/o3")
        || normalized.contains("/o4")
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn prompt_level(prompt: &str) -> u8 {
    for level in (1..=5).rev() {
        let level_text = level.to_string();
        let patterns = [
            format!("提示级别：{level_text}"),
            format!("提示级别: {level_text}"),
            format!("提示等级：{level_text}"),
            format!("提示等级: {level_text}"),
            format!("hintLevel={level_text}"),
        ];
        if patterns.iter().any(|pattern| prompt.contains(pattern)) {
            return level;
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_require_https_except_loopback() {
        assert!(ai_endpoint("https://api.openai.com/v1").is_ok());
        assert!(ai_endpoint("http://127.0.0.1:1234/v1").is_ok());
        assert!(ai_endpoint("http://example.com/v1").is_err());
    }

    #[test]
    fn coach_intents_accept_algorithm_logic() {
        assert!(
            coach_instruction("algorithm-logic").is_ok(),
            "desktop AI should accept algorithm-logic"
        );
        assert!(
            coach_system("algorithm-logic").is_ok(),
            "desktop AI should build a system prompt for algorithm-logic"
        );
    }

    #[test]
    fn coach_intents_keep_partial_help_separate_from_complete_code() {
        for intent in ["analyze", "next-code", "debug", "explain"] {
            let (_, instruction) = coach_instruction(intent).unwrap();
            assert!(instruction.contains("代码"));
            assert!(!instruction.contains("禁止 TODO"));
        }
        let (label, instruction) = coach_instruction("complete").unwrap();
        assert_eq!(label, "给完整代码");
        assert!(instruction.contains("完整"));
        assert!(instruction.contains("禁止 TODO"));
        assert!(coach_instruction("unknown").is_err());
    }

    #[test]
    fn coach_intents_accept_interview_workflows() {
        for intent in [
            "interview-follow-up",
            "interview-critique",
            "interview-omissions",
            "interview-improve",
            "interview-examiner",
        ] {
            assert!(
                coach_instruction(intent).is_ok(),
                "desktop AI should accept {intent}"
            );
        }
    }

    #[test]
    fn coach_system_keeps_algorithm_and_interview_profiles_separate() {
        let algorithm = coach_system("next-code").unwrap();
        assert!(algorithm.contains("算法代码教练"));
        assert!(algorithm.contains("代码片段"));
        assert!(algorithm.contains("C++17"));

        let interview = coach_system("interview-critique").unwrap();
        assert!(interview.contains("技术面试教练"));
        assert!(interview.contains("真实面试"));
        assert!(interview.contains("不得套用算法代码教练"));
        assert!(!interview.contains("## 代码片段"));
        assert!(!interview.contains("C++17"));
    }

    #[test]
    fn reasoning_models_use_new_completion_parameters() {
        assert!(uses_reasoning_model("gpt-5-mini"));
        assert!(uses_reasoning_model("openai/o3-mini"));
        assert!(!uses_reasoning_model("gpt-4o-mini"));
        assert_eq!(completion_token_budget("explain", ""), 1_536);
        assert_eq!(completion_token_budget("complete", ""), 4_096);
        assert_eq!(completion_token_budget("interview-examiner", ""), 3_000);
    }

    #[test]
    fn examiner_system_requires_bare_json_only() {
        let examiner = coach_system("interview-examiner").unwrap();
        assert!(examiner.contains("技术面试出题官"));
        assert!(examiner.contains("只输出一个合法 JSON 对象"));
        assert!(examiner.contains("禁止 Markdown 代码围栏"));
        assert!(examiner.contains("首字符必须是 `{`，末字符必须是 `}`"));
        assert!(!examiner.contains("## 代码片段"));
        assert!(!examiner.contains("C++17"));
    }

    #[test]
    fn sse_decoder_handles_split_utf8_and_done_marker() {
        let payload =
            "data: {\"choices\":[{\"delta\":{\"content\":\"关键观察\"}}]}\n\ndata: [DONE]\n\n";
        let bytes = payload.as_bytes();
        let split = payload.find('观').unwrap() + 1;
        let mut decoder = SseDecoder::default();

        assert!(decoder.push(&bytes[..split]).unwrap().is_empty());
        assert_eq!(
            decoder.push(&bytes[split..]).unwrap(),
            vec![AiStreamEvent::Delta {
                content: "关键观察".to_string()
            }]
        );
        assert!(decoder.done);
    }

    #[test]
    fn sse_decoder_accepts_array_content_and_reports_api_errors() {
        let mut decoder = SseDecoder::default();
        let events = decoder
            .push("data: {\"choices\":[{\"delta\":{\"content\":[{\"text\":\"第一段\"},{\"text\":\"第二段\"}]}}]}\n".as_bytes())
            .unwrap();
        assert_eq!(
            events,
            vec![AiStreamEvent::Delta {
                content: "第一段第二段".to_string()
            }]
        );

        let error = decoder
            .push(b"data: {\"error\":{\"message\":\"model unavailable\"}}\n")
            .unwrap_err();
        assert!(error.contains("model unavailable"));
    }
}
