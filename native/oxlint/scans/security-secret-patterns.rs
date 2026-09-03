use lazy_regex::{Lazy, Regex, lazy_regex};

static PUBLIC_ENV_SECRET_NAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u:\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|SERVICE_ROLE|AWS_ACCESS_KEY|AWS_SECRET)[A-Z0-9_]*\b)"
);
static TRUSTED_PUBLIC_SECRET_NAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:SENTRY_DSN|PUBLIC_KEY|(?:^|_)PUBLIC_TOKEN$|PUBLISHABLE|ANON_KEY|POSTHOG_(?:PROJECT_)?TOKEN|POSTHOG_KEY|TLDRAW_LICENSE_KEY|CLERK_PUBLISHABLE_KEY|ALGOLIA_SEARCH_KEY|GC_API_KEY|GOOGLE_MAPS_API_KEY|MAPBOX_TOKEN|MIXPANEL_TOKEN|FACEBOOK_CLIENT_TOKEN|(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_(?:DISABLE|ENABLE|ALLOW|REQUIRE)_)|(?:TOKEN|SECRET|PASSWORD|PRIVATE)_(?:KIND|TYPE|URL|URI|ENDPOINT|HEADER|NAME)$"
);
static SECRET_VALUE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"(?-u:\b)(?:AKIA|ASIA)[0-9A-Z]{16}(?-u:\b)",
        r#"(?-u:\b)AWS_SECRET_ACCESS_KEY\s*[:=]\s*[\"']?[A-Za-z0-9/+=]{35,}[\"']?"#,
        r"(?-u:\b)github_pat_[A-Za-z0-9_]{30,}(?-u:\b)",
        r"(?-u:\b)gh[pousr]_[A-Za-z0-9]{30,}(?-u:\b)",
        r"(?-u:\b)glpat-[A-Za-z0-9_-]{20,}(?-u:\b)",
        r"(?-u:\b)xox[baprs]-[A-Za-z0-9-]{20,}(?-u:\b)",
        r"(?-u:\b)sk_(?:live|test)_[A-Za-z0-9]{16,}(?-u:\b)",
        r"(?-u:\b)rk_(?:live|test)_[A-Za-z0-9]{16,}(?-u:\b)",
        r"(?-u:\b)sk-[A-Za-z0-9_-]{32,}(?-u:\b)",
        r"(?-u:\b)sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}(?-u:\b)",
        r"(?-u:\b)lin_(?:api|oauth)_[A-Za-z0-9]{20,}(?-u:\b)",
        r"(?-u:\b)vercel_[A-Za-z0-9]{20,}(?-u:\b)",
        r"(?-u:\b)sntrys_[A-Za-z0-9_-]{20,}(?-u:\b)",
        r"(?i-u:\bkey-[a-f0-9]{32}\b)",
        r"(?-u:\b)npm_[A-Za-z0-9]{30,}(?-u:\b)",
        r"(?-u:\b)SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?-u:\b)",
        r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+",
        r"https://discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]+",
        r"(?-u:\b)sb_secret_[A-Za-z0-9_]{20,}(?-u:\b)",
        r"(?i-u:\bservice_role\b)",
        r#"\"private_key\"\s*:\s*\"-----BEGIN PRIVATE KEY-----"#,
        r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    ]
    .into_iter()
    .map(|pattern| Regex::new(pattern).expect("valid secret pattern"))
    .collect()
});
static JWT_LITERAL_VALUE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?-u:\b)eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?-u:\b)");
static CONNECTION_STRING_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)(?:postgres|mysql|mongodb(?:\+srv)?|redis)://([^:\x09\x0A\x0B\x0C\x0D\x20\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}/@]+):([^@\x09\x0A\x0B\x0C\x0D\x20\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}/]+)@([^\x09\x0A\x0B\x0C\x0D\x20\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}:/@]*\.[^\x09\x0A\x0B\x0C\x0D\x20\u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}/@]*)"
);

pub fn first_suspicious_public_env_secret_name(source: &str) -> Option<usize> {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(source);
    PUBLIC_ENV_SECRET_NAME_PATTERN
        .find_iter(normalized.as_ref())
        .find(|found| !TRUSTED_PUBLIC_SECRET_NAME_PATTERN.is_match(found.as_str()))
        .map(|found| found.start())
}

pub fn first_secret_value(source: &str, include_service_role: bool) -> Option<usize> {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(source);
    for (index, pattern) in SECRET_VALUE_PATTERNS.iter().enumerate() {
        if !include_service_role && index == 19 {
            continue;
        }
        if let Some(found) = pattern.find(normalized.as_ref()) {
            return Some(found.start());
        }
    }
    first_connection_string_secret(normalized.as_ref())
}

pub fn first_package_metadata_secret(source: &str) -> Option<usize> {
    first_secret_value(source, false).or_else(|| {
        let normalized = super::normalize_js_regex_content::normalize_js_regex_content(source);
        JWT_LITERAL_VALUE_PATTERN
            .find(normalized.as_ref())
            .map(|found| found.start())
    })
}

fn first_connection_string_secret(source: &str) -> Option<usize> {
    const PLACEHOLDER_VALUES: &[&str] = &[
        "pass",
        "password",
        "mypass",
        "mypassword",
        "mysecretpassword",
        "myusername",
        "postgres",
        "mysql",
        "redis",
        "root",
        "admin",
        "minioadmin",
        "secret",
        "example",
        "changeme",
        "change_me",
        "test",
        "guest",
        "placeholder",
        "default",
        "user",
        "username",
    ];
    CONNECTION_STRING_PATTERN
        .find_iter(source)
        .find_map(|found| {
            let captures = CONNECTION_STRING_PATTERN.captures(found.as_str())?;
            let password = captures.get(2)?.as_str();
            let host = captures.get(3)?.as_str().to_ascii_lowercase();
            let lowercase_password = password.to_ascii_lowercase();
            let is_placeholder = PLACEHOLDER_VALUES.contains(&lowercase_password.as_str())
                || is_my_password_placeholder(&lowercase_password)
                || is_wrapped_without(password, "${", "}", '}')
                || password.strip_prefix('$').is_some_and(|value| {
                    !value.is_empty()
                        && value
                            .chars()
                            .all(|character| character == '_' || character.is_ascii_alphabetic())
                })
                || is_wrapped_without(password, "<", ">", '>')
                || is_wrapped_without(password, "{{", "}}", '}')
                || password.len() >= 2
                    && password.starts_with('%')
                    && password.ends_with('%')
                    && !password[1..password.len() - 1].is_empty()
                    && password[1..password.len() - 1].chars().all(|character| {
                        character == '.' || character == '_' || character.is_ascii_alphanumeric()
                    })
                || password.len() >= 3
                    && lowercase_password.chars().all(|character| character == 'x')
                || password.len() >= 2 && password.chars().all(|character| character == '*');
            let is_local_host = ["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"]
                .iter()
                .any(|candidate| {
                    host.strip_prefix(candidate).is_some_and(|suffix| {
                        suffix.is_empty()
                            || suffix.starts_with(':')
                            || suffix.starts_with('/')
                            || suffix
                                .chars()
                                .next()
                                .is_some_and(is_javascript_regex_whitespace)
                    })
                });
            (!is_placeholder && !is_local_host).then_some(found.start())
        })
}

fn is_javascript_regex_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}' | '\u{000B}' | '\u{000C}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    ) || character == '\n'
        || character == '\r'
}

fn is_my_password_placeholder(password: &str) -> bool {
    let Some(after_prefix) = password.strip_prefix("my") else {
        return false;
    };
    ["pass", "password"].iter().any(|suffix| {
        after_prefix.strip_suffix(suffix).is_some_and(|middle| {
            middle
                .chars()
                .all(|character| character.is_ascii_lowercase())
        })
    })
}

fn is_wrapped_without(value: &str, prefix: &str, suffix: &str, forbidden: char) -> bool {
    value
        .strip_prefix(prefix)
        .and_then(|inner| inner.strip_suffix(suffix))
        .is_some_and(|inner| !inner.contains(forbidden))
}
