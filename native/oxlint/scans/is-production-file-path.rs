use lazy_regex::{Lazy, Regex, lazy_regex};

static SOURCE_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.[cm]?[jt]sx?$");
static SCRIPT_SOURCE_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.(?:[cm]?[jt]sx?|py|php)$");
static DATABASE_SOURCE_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.(?:[cm]?[jt]sx?|py)$");
static DECLARATION_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.d\.[cm]?[jt]s$");
static TEST_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:__fixtures__|__mocks__|__tests__|__integration__|fixtures|mocks|test|tests|testdata|test-data|e2e|playwright|cypress|specs?)(?:/|$)|^(?:test|spec)-[^/]+\.[cm]?[jt]sx?$|\.(?:test|spec|e2e|e2e-spec|integration-test|fixture|fixtures|stories|story)\.[cm]?[jt]sx?$|(?:^|/)(?:playwright|cypress|vitest|jest|karma)[^/]*\.conf(?:ig)?\.[cm]?[jt]s$|(?:^|/)(?:test_[^/]+|[^/]+_test|conftest)\.py$|\.env\.[^/]*(?:test|e2e)[^/]*$"
);
static BUILD_SCRIPT_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(?:^|/)scripts(?:/|$)");
static DOCUMENTATION_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:README|CHANGELOG|CONTRIBUTING|PUBLISHING|DOCS)\.mdx?$|\.mdx?$");
static GENERATED_SOURCE_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:generated|__generated__|dist|build|coverage|out|storybook-static|vendor|vendors|third[-_]?party|libraries)(?:/|$)|(?:^|/)\.next/|(?:^|/)\.yarn/|(?:^|/)public/(?:chunks?|assets?|build|dist|static)/|(?:generated|\.gen)\.[cm]?[jt]sx?$|@\d+\.\d+\.\d+(?:[-.][A-Za-z0-9_.]+)?\.[cm]?js$|[.-]min\.[cm]?js$|\.asm\.js$|(?:^|/)[A-Za-z0-9_-]+[.@-]\d+\.\d+\.\d+(?:[-.][A-Za-z0-9_.]+)?/"
);

pub fn is_production_source_path(relative_path: &str) -> bool {
    !DECLARATION_FILE_PATTERN.is_match(relative_path)
        && is_production_file_path(relative_path, &SOURCE_FILE_PATTERN)
}

pub fn is_production_script_source_path(relative_path: &str) -> bool {
    is_production_file_path(relative_path, &SCRIPT_SOURCE_FILE_PATTERN)
}

pub fn is_production_database_source_path(relative_path: &str) -> bool {
    is_production_file_path(relative_path, &DATABASE_SOURCE_FILE_PATTERN)
}

fn is_production_file_path(relative_path: &str, source_file_pattern: &Regex) -> bool {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    source_file_pattern.is_match(&normalized_path)
        && !TEST_CONTEXT_PATTERN.is_match(&normalized_path)
        && !BUILD_SCRIPT_CONTEXT_PATTERN.is_match(&normalized_path)
        && !DOCUMENTATION_CONTEXT_PATTERN.is_match(&normalized_path)
        && !GENERATED_SOURCE_CONTEXT_PATTERN.is_match(&normalized_path)
}

#[cfg(test)]
mod tests {
    use super::is_production_source_path;

    #[test]
    fn uses_javascript_non_unicode_case_folding_for_paths() {
        assert!(!is_production_source_path("ScRiPtS/app.ts"));
        assert!(is_production_source_path("ſcripts/app.ts"));
    }
}
