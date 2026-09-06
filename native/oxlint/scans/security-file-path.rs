use lazy_regex::{Lazy, Regex, lazy_regex};

static SERVER_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:api|backend|server|servers|middleware|route|routes|functions|lambdas|workers)(?:/|$)|(?:^|/)[^/]+\.server\.[cm]?[jt]sx?$"
);
static DEV_TOOLING_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:tools?|scripts?)/|(?:^|/)management/commands/|(?:^|/)(?:build|make|gulpfile|gruntfile)\.[cm]?[jt]s$"
);
static DEMO_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:examples?|tutorials?|demos?|samples?|playgrounds?)(?:/|$)");
static VENDORED_VERSION_DIRECTORY_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)[A-Za-z0-9_-]+[.@-]\d+\.\d+\.\d+(?:[-.][A-Za-z0-9_.]+)?/");
static LOCALE_DIRECTORY_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:locales?|i18n|lang|langs|translations?)/");
static PUBLIC_DEBUG_ARTIFACT_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:\.env(?:\.[^/]*)?|(?:debug|crash|trace|stack[-_]?trace|report|dump|phpinfo)(?:[-_.][^/]*)?\.(?:txt|log|json|html?)|[^/]+\.log)$"
);
static DOTENV_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?:^|/)\.env(?:\.|$)");
static REPOSITORY_SECRET_FILE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)[^/]*(?:credential|credentials|service-account|serviceAccount|firebase-admin|google-service-account|gcp-service-account)[^/]*\.(?:json|env|pem|key)$"
);
static REPOSITORY_SECRET_EXAMPLE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)\.env(?:\.[^./]+)*\.(?:example|sample|template|dist|defaults?)$|(?:^|/)[^/]*(?:example|sample|template)[^/]*\.(?:env|json|pem|key)$"
);
static TEST_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:__fixtures__|__mocks__|__tests__|__integration__|fixtures|mocks|test|tests|testdata|test-data|e2e|playwright|cypress|specs?)(?:/|$)|^(?:test|spec)-[^/]+\.[cm]?[jt]sx?$|\.(?:test|spec|e2e|e2e-spec|integration-test|fixture|fixtures|stories|story)\.[cm]?[jt]sx?$|(?:^|/)(?:playwright|cypress|vitest|jest|karma)[^/]*\.conf(?:ig)?\.[cm]?[jt]s$|(?:^|/)(?:test_[^/]+|[^/]+_test|conftest)\.py$|\.env\.[^/]*(?:test|e2e)[^/]*$"
);

pub fn is_server_route_source_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    super::is_production_file_path::is_production_source_path(relative_path)
        && (SERVER_CONTEXT_PATTERN.is_match(normalized.as_ref())
            || lazy_regex::regex_is_match!(
                r"(?:^|/)(?:middleware|route)\.[cm]?[jt]sx?$",
                normalized.as_ref()
            ))
}

pub fn is_trusted_boundary_config_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    super::is_config_or_ci_path::is_config_or_ci_path(relative_path)
        && !relative_path
            .to_ascii_lowercase()
            .contains("/.github/workflows/")
        && !VENDORED_VERSION_DIRECTORY_PATTERN.is_match(normalized.as_ref())
        && !DEMO_CONTEXT_PATTERN.is_match(normalized.as_ref())
}

pub fn is_dev_tooling_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    DEV_TOOLING_PATH_PATTERN.is_match(normalized.as_ref())
}

pub fn is_public_debug_artifact_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    let is_generated_bundle =
        lazy_regex::regex_is_match!(r"(?i)\.(?:iife|umd|global|min)\.js$", normalized.as_ref());
    super::is_browser_artifact_path::is_browser_artifact_path(relative_path, is_generated_bundle)
        && !LOCALE_DIRECTORY_PATTERN.is_match(normalized.as_ref())
        && PUBLIC_DEBUG_ARTIFACT_PATH_PATTERN.is_match(normalized.as_ref())
}

pub fn is_repository_secret_file_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    DOTENV_FILE_PATTERN.is_match(normalized.as_ref())
        || lazy_regex::regex_is_match!(r"(?:^|/)\.npmrc$", normalized.as_ref())
        || REPOSITORY_SECRET_FILE_PATTERN.is_match(normalized.as_ref())
}

pub fn is_repository_secret_example_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    REPOSITORY_SECRET_EXAMPLE_PATTERN.is_match(normalized.as_ref())
}

pub fn is_test_context_path(relative_path: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    TEST_CONTEXT_PATTERN.is_match(normalized.as_ref())
}
