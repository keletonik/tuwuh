//! Provider calls, made from Rust so the key never reaches the webview.
//!
//! Two wire formats cover every provider offered: Anthropic's Messages API, and
//! the OpenAI-compatible `/chat/completions` shape that OpenAI, xAI, OpenRouter
//! and a local Ollama all speak. Errors are surfaced verbatim rather than
//! smoothed into a generic failure, because a 401 and a 429 need different
//! reactions from the user.

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::settings::{get_settings, read_provider_key, Provider};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
    pub provider: String,
    pub model: String,
}

fn base_url_for(p: Provider, configured: Option<&str>) -> String {
    if let Some(u) = configured.filter(|u| !u.trim().is_empty()) {
        return u.trim_end_matches('/').to_owned();
    }
    match p {
        Provider::Anthropic => "https://api.anthropic.com".into(),
        Provider::Openai => "https://api.openai.com/v1".into(),
        Provider::Xai => "https://api.x.ai/v1".into(),
        Provider::Openrouter => "https://openrouter.ai/api/v1".into(),
        Provider::Ollama => "http://localhost:11434/v1".into(),
    }
}

#[derive(Deserialize)]
struct AnthropicBlock {
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct AnthropicReply {
    #[serde(default)]
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    #[serde(default)]
    message: Option<OpenAiMessage>,
}

#[derive(Deserialize)]
struct OpenAiReply {
    #[serde(default)]
    choices: Vec<OpenAiChoice>,
}

/// Trim the transport detail off a provider error but keep the status and the
/// body, which is where the actionable part lives ("invalid x-api-key",
/// "rate limit exceeded", "model not found").
fn provider_error(status: u16, body: &str) -> AppError {
    let body = body.trim();
    let short: String = body.chars().take(400).collect();
    AppError::Provider(match status {
        401 | 403 => format!("{status}: the stored key was rejected. {short}"),
        404 => format!("{status}: no such model or endpoint. {short}"),
        429 => format!("{status}: rate limited. {short}"),
        _ => format!("{status}: {short}"),
    })
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<Message>,
    system: Option<String>,
    provider: Option<Provider>,
    model: Option<String>,
) -> AppResult<ChatReply> {
    if messages.is_empty() {
        return Err(AppError::Provider("no messages to send".into()));
    }

    let settings = get_settings()?;
    let p = provider.unwrap_or(settings.ai.provider);
    let chosen_model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| {
            if provider.is_some_and(|given| given != settings.ai.provider) {
                // Switching provider without naming a model must not carry the
                // previous provider's model id across; it would 404.
                p.default_model().to_owned()
            } else {
                settings.ai.model.clone()
            }
        });

    let key = if p.needs_key() {
        Some(read_provider_key(p)?)
    } else {
        None
    };

    let base = base_url_for(p, settings.ai.base_url.as_deref());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(settings.ai.timeout_ms.clamp(1_000, 300_000)))
        .build()
        .map_err(|e| AppError::Provider(format!("http client: {e}")))?;

    let (status, body) = if matches!(p, Provider::Anthropic) {
        let mut payload = serde_json::json!({
            "model": chosen_model,
            "max_tokens": settings.ai.max_tokens,
            "messages": messages,
        });
        if let Some(s) = system.as_ref().filter(|s| !s.trim().is_empty()) {
            payload["system"] = serde_json::Value::String(s.clone());
        }
        let res = client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", key.unwrap_or_default())
            .header("anthropic-version", "2023-06-01")
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Provider(format!("request failed: {e}")))?;
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        (status, body)
    } else {
        // The OpenAI shape carries the system prompt as the first message
        // rather than as its own field.
        let mut all = Vec::with_capacity(messages.len() + 1);
        if let Some(s) = system.as_ref().filter(|s| !s.trim().is_empty()) {
            all.push(Message {
                role: "system".into(),
                content: s.clone(),
            });
        }
        all.extend(messages);

        let payload = serde_json::json!({
            "model": chosen_model,
            "max_tokens": settings.ai.max_tokens,
            "messages": all,
        });
        let mut req = client.post(format!("{base}/chat/completions")).json(&payload);
        if let Some(k) = key {
            req = req.bearer_auth(k);
        }
        let res = req
            .send()
            .await
            .map_err(|e| AppError::Provider(format!("request failed: {e}")))?;
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        (status, body)
    };

    if !(200..300).contains(&status) {
        return Err(provider_error(status, &body));
    }

    let text = if matches!(p, Provider::Anthropic) {
        serde_json::from_str::<AnthropicReply>(&body)
            .map_err(|e| AppError::Provider(format!("unreadable reply: {e}")))?
            .content
            .into_iter()
            .map(|b| b.text)
            .collect::<Vec<_>>()
            .join("")
    } else {
        serde_json::from_str::<OpenAiReply>(&body)
            .map_err(|e| AppError::Provider(format!("unreadable reply: {e}")))?
            .choices
            .into_iter()
            .filter_map(|c| c.message.map(|m| m.content))
            .collect::<Vec<_>>()
            .join("")
    };

    if text.trim().is_empty() {
        // Never present an empty bubble as if the model had answered.
        return Err(AppError::Provider(
            "the provider returned no text".into(),
        ));
    }

    Ok(ChatReply {
        text,
        provider: p.as_str().to_owned(),
        model: chosen_model,
    })
}

/// Which providers are usable right now. The settings screen uses this to show
/// what is configured without ever reading a key back.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: &'static str,
    pub needs_key: bool,
    pub has_key: bool,
    pub default_model: &'static str,
}

#[tauri::command]
pub fn provider_status() -> Vec<ProviderStatus> {
    [
        Provider::Anthropic,
        Provider::Openai,
        Provider::Xai,
        Provider::Openrouter,
        Provider::Ollama,
    ]
    .into_iter()
    .map(|p| ProviderStatus {
        provider: p.as_str(),
        needs_key: p.needs_key(),
        has_key: !p.needs_key() || read_provider_key(p).is_ok(),
        default_model: p.default_model(),
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_urls_default_per_provider_and_honour_an_override() {
        assert_eq!(base_url_for(Provider::Openai, None), "https://api.openai.com/v1");
        assert_eq!(base_url_for(Provider::Ollama, None), "http://localhost:11434/v1");
        assert_eq!(
            base_url_for(Provider::Openai, Some("http://localhost:1234/v1/")),
            "http://localhost:1234/v1"
        );
        // A blank override must not produce an empty base URL.
        assert_eq!(base_url_for(Provider::Xai, Some("   ")), "https://api.x.ai/v1");
    }

    #[test]
    fn provider_errors_stay_actionable() {
        let e = provider_error(401, "invalid x-api-key").to_string();
        assert!(e.contains("401") && e.contains("key was rejected"), "{e}");
        let e = provider_error(429, "slow down").to_string();
        assert!(e.contains("rate limited"), "{e}");
    }

    #[test]
    fn anthropic_replies_concatenate_text_blocks() {
        let r: AnthropicReply =
            serde_json::from_str(r#"{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}"#)
                .unwrap();
        let joined: String = r.content.into_iter().map(|b| b.text).collect();
        assert_eq!(joined, "ab");
    }

    #[test]
    fn openai_replies_read_the_first_choice() {
        let r: OpenAiReply =
            serde_json::from_str(r#"{"choices":[{"message":{"role":"assistant","content":"hi"}}]}"#)
                .unwrap();
        assert_eq!(r.choices[0].message.as_ref().unwrap().content, "hi");
    }
}
