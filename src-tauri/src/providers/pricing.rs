use serde::Deserialize;
use std::sync::OnceLock;

const EMBEDDED_PRICING: &str = include_str!("../../pricing.json");

static PRICING: OnceLock<PricingConfig> = OnceLock::new();

#[derive(Deserialize)]
struct PricingConfig {
    claude: ProviderConfig,
    codex: ProviderConfig,
}

#[derive(Deserialize)]
struct ProviderConfig {
    default: String,
    models: Vec<PricingEntry>,
}

#[derive(Deserialize)]
struct PricingEntry {
    #[serde(rename = "match")]
    match_pattern: String,
    input: f64,
    output: f64,
    #[serde(default)]
    cache_read: f64,
    #[serde(default)]
    cache_write: f64,
    #[serde(default)]
    cache_write_1h: f64,
    #[serde(default)]
    cached_input: f64,
}

pub struct ClaudePricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write_5m: f64,
    pub cache_write_1h: f64,
}

pub struct CodexPricing {
    pub input: f64,
    pub output: f64,
    pub cached_input: f64,
}

fn config() -> &'static PricingConfig {
    PRICING.get_or_init(|| {
        if let Some(home) = dirs::home_dir() {
            let user_path = home.join(".claude").join("pricing.json");
            if let Ok(contents) = std::fs::read_to_string(&user_path) {
                if let Ok(cfg) = serde_json::from_str(&contents) {
                    return cfg;
                }
            }
        }

        serde_json::from_str(EMBEDDED_PRICING).expect("embedded pricing.json must be valid")
    })
}

fn find_pricing<'a>(provider: &'a ProviderConfig, model: &str) -> &'a PricingEntry {
    provider
        .models
        .iter()
        .find(|entry| model.contains(&entry.match_pattern))
        .unwrap_or_else(|| {
            provider
                .models
                .iter()
                .find(|entry| entry.match_pattern == provider.default)
                .unwrap_or(&provider.models[0])
        })
}

pub fn get_claude_pricing(model: &str) -> ClaudePricing {
    let entry = find_pricing(&config().claude, model);
    ClaudePricing {
        input: entry.input,
        output: entry.output,
        cache_read: entry.cache_read,
        cache_write_5m: entry.cache_write,
        cache_write_1h: if entry.cache_write_1h > 0.0 {
            entry.cache_write_1h
        } else {
            entry.cache_write
        },
    }
}

pub fn get_codex_pricing(model: &str) -> CodexPricing {
    let entry = find_pricing(&config().codex, model);
    CodexPricing {
        input: entry.input,
        output: entry.output,
        cached_input: entry.cached_input,
    }
}
