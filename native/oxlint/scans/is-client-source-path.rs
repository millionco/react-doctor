use lazy_regex::{Lazy, Regex, lazy_regex};

static SERVER_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:api|backend|server|servers|middleware|route|routes|functions|lambdas|workers)(?:/|$)|(?:^|/)[^/]+\.server\.[cm]?[jt]sx?$"
);
static BUILD_CONFIG_FILE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:vite|next|nuxt|astro|remix|webpack|rollup|rspack|rsbuild|esbuild|tsup|metro|expo|babel|tailwind|postcss|svelte|farm|parcel|snowpack)[^/]*\.config\.[cm]?[jt]sx?$"
);

pub fn is_client_source_path(relative_path: &str) -> bool {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return false;
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    !SERVER_CONTEXT_PATTERN.is_match(&normalized_path)
        && !BUILD_CONFIG_FILE_PATTERN.is_match(&normalized_path)
}
