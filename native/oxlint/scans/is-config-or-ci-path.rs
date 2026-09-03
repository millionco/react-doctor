use lazy_regex::{Lazy, Regex, lazy_regex};

static CONFIG_OR_CI_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:package\.json|Dockerfile|docker-compose\.ya?ml|\.github/workflows/[^/]+\.ya?ml|vercel\.json|next\.config\.[cm]?[jt]s|netlify\.toml)$"
);

pub fn is_config_or_ci_path(relative_path: &str) -> bool {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    CONFIG_OR_CI_PATH_PATTERN.is_match(&normalized_path)
}
