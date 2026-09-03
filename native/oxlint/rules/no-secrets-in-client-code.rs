use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, FunctionBody},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This hardcoded secret is a security vulnerability: it ships to the browser where anyone can read it.";
const SECRET_MIN_LENGTH_CHARS: usize = 24;
const PUBLIC_CLIENT_KEY_PREFIXES: [&str; 9] = [
    "appl_",
    "goog_",
    "amzn_",
    "strp_",
    "pk_live_",
    "pk_test_",
    "sb_publishable_",
    "phc_",
    "pk.eyJ",
];
const SECRET_FALSE_POSITIVE_SUFFIXES: &[&str] = &[
    "alert",
    "modal",
    "label",
    "text",
    "title",
    "name",
    "id",
    "url",
    "path",
    "route",
    "page",
    "param",
    "field",
    "column",
    "header",
    "placeholder",
    "prefix",
    "description",
    "type",
    "icon",
    "class",
    "style",
    "variant",
    "event",
    "action",
    "status",
    "state",
    "mode",
    "flag",
    "option",
    "config",
    "message",
    "error",
    "display",
    "view",
    "component",
    "element",
    "container",
    "wrapper",
    "button",
    "link",
    "input",
    "select",
    "dialog",
    "menu",
    "form",
    "step",
    "index",
    "count",
    "length",
    "role",
    "scope",
    "context",
    "provider",
    "ref",
    "handler",
    "query",
    "schema",
    "constant",
];
const SERVER_DIRECTORY_NAMES: &[&str] = &[
    "backend",
    "functions",
    "lambdas",
    "lambda",
    "middleware",
    "server",
    "servers",
];
const SERVER_SOURCE_ROOT_OWNER_NAMES: &[&str] = &[
    "api",
    "backend",
    "edge",
    "function",
    "functions",
    "lambda",
    "lambdas",
    "server",
    "servers",
    "worker",
    "workers",
];
const TEST_DIRECTORY_NAMES: &[&str] = &[
    "__fixtures__",
    "__mocks__",
    "__tests__",
    "fixtures",
    "mocks",
    "test",
    "tests",
];
const TOOLING_DIRECTORY_NAMES: &[&str] = &[
    "bin", "config", "configs", "script", "scripts", "tooling", "tools",
];
const CLIENT_SOURCE_DIRECTORY_NAMES: &[&str] = &[
    "components",
    "features",
    "hooks",
    "pages",
    "ui",
    "views",
    "widgets",
];

static CREDENTIALED_URL_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?://[^/@\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]+:[^/@\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]+@|[?&#](?i-u:access_?token|api_?key|client_?secret|token|secret|password|passwd|auth)=)"
);
static IDENTIFIER_LIKE_KEY_SEGMENT_PATTERN: Lazy<Regex> = lazy_regex!(r"^[a-z]+(?:[A-Z][a-z]+)*$");
static PLACEHOLDER_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:placeholder|example|sample|dummy|masked|redacted|mask)");
static PLACEHOLDER_BOUNDARY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:^|[_\-\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])(?:(?i-u:your|redacted|masked|placeholder|changeme)|(?i-u:replace)[_\-\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]?(?i-u:me))(?:$|[_\-\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])"
);
static PLACEHOLDER_ANGLE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"<[^>]*(?i-u:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^>]*>"
);
static PLACEHOLDER_BRACKET_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\[[^\]]*(?i-u:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^\]]*\]"
);
static PLACEHOLDER_BRACE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\{[^}]*(?i-u:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^}]*\}"
);
static CONTEXTUAL_PLACEHOLDER_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:^|[_\-\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])(?i-u:example|sample|dummy)(?:$|[_\-\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}])"
);
static TEST_FILE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)[^/]+\.(?:test|spec|stories|story|fixture|fixtures)\.[cm]?[jt]sx?$");
static TOOLING_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?:^|/)[^/]+\.config\.[cm]?[jt]s$");
static TOOLING_RC_FILE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)(?:\.[a-z-]+rc|[a-z-]+\.rc)\.[cm]?[jt]s$");
static SERVER_FILE_SUFFIX_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)[^/]+\.server\.[cm]?[jt]sx?$");
static SERVER_ENTRY_FILE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)(?:middleware|proxy|route)\.[cm]?[jt]sx?$");
static NEXT_PAGES_API_FILE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)pages/api/.+\.[cm]?[jt]sx?$");
static CLIENT_FILE_SUFFIX_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)[^/]+\.(?:client|browser|web)\.[cm]?[jt]sx?$");
static CLIENT_ENTRY_FILE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:^|/)(?:src/)?(?:main|index|[Aa]pp|client)\.[cm]?[jt]sx?$");
static SOURCE_FILE_EXTENSION_PATTERN: Lazy<Regex> = lazy_regex!(r"\.[cm]?[jt]sx?$");
static CLIENT_SOURCE_FILE_EXTENSION_PATTERN: Lazy<Regex> = lazy_regex!(r"\.[cm]?[jt]sx$");

#[derive(Debug, Default, Clone)]
pub struct NoSecretsInClientCode;

declare_oxc_lint!(
    /// Disallow hardcoded secrets in browser-delivered code.
    NoSecretsInClientCode,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow hardcoded secrets in browser-delivered code.",
);

impl Rule for NoSecretsInClientCode {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let Some(variable_identifier) = declarator.id.get_binding_identifier() else {
            return;
        };
        let Some(Expression::StringLiteral(literal)) = &declarator.init else {
            return;
        };
        let variable_name = variable_identifier.name.as_str();
        let literal_value = literal.value.as_str();
        let has_placeholder_context = PLACEHOLDER_CONTEXT_PATTERN.is_match(variable_name)
            || enclosing_component_or_hook_name(node, ctx)
                .is_some_and(|name| PLACEHOLDER_CONTEXT_PATTERN.is_match(name));
        let is_unambiguous_placeholder = is_placeholder_secret_value(literal_value, false);

        if is_public_client_key(literal_value) {
            return;
        }
        if is_known_secret_value(literal_value) {
            if !is_unambiguous_placeholder {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(declarator.span));
            }
            return;
        }
        if classify_secret_file_exposure(ctx) != SecretFileExposure::Client
            || is_inside_server_only_scope(node, ctx)
            || is_false_positive_suffix(variable_name)
            || is_public_url_value(literal_value)
            || is_placeholder_secret_value(literal_value, has_placeholder_context)
            || literal_value
                .to_lowercase()
                .contains(&variable_name.to_lowercase())
            || is_structured_parser_sentinel_value(variable_name, literal_value)
            || is_identifier_like_key_name_value(literal_value)
            || literal_value.encode_utf16().count() <= SECRET_MIN_LENGTH_CHARS
            || !is_secret_variable_name(variable_name)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Hardcoding \"{variable_name}\" in client code is a security vulnerability: the secret ships to the browser where anyone can read it."
            ))
            .with_label(declarator.span),
        );
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum SecretFileExposure {
    Client,
    Other,
}

fn classify_secret_file_exposure(ctx: &LintContext<'_>) -> SecretFileExposure {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if filename.is_empty() {
        return SecretFileExposure::Other;
    }
    let react_doctor_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object);
    let root_directory = react_doctor_settings
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .filter(|root| !root.is_empty())
        .map(|root| root.replace('\\', "/"));
    let relative_filename = root_directory
        .as_deref()
        .map(|root| root.trim_end_matches('/'))
        .and_then(|root| filename.strip_prefix(&format!("{root}/")))
        .unwrap_or(filename.as_str());
    let framework = react_doctor_settings
        .and_then(|settings| settings.get("framework"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let path_segments = relative_filename.split('/').collect::<Vec<_>>();
    let source_index = path_segments.iter().rposition(|segment| *segment == "src");
    let classifiable_segments = source_index
        .map(|index| &path_segments[index + 1..])
        .unwrap_or(path_segments.as_slice());
    let source_root_owner = source_index
        .filter(|index| *index > 0)
        .and_then(|index| path_segments.get(index - 1).copied());

    if TEST_FILE_PATTERN.is_match(relative_filename)
        || contains_any_segment(classifiable_segments, TEST_DIRECTORY_NAMES)
        || TOOLING_FILE_PATTERN.is_match(relative_filename)
        || TOOLING_RC_FILE_PATTERN.is_match(relative_filename)
        || source_root_owner.is_some_and(|owner| TOOLING_DIRECTORY_NAMES.contains(&owner))
        || contains_any_segment(classifiable_segments, TOOLING_DIRECTORY_NAMES)
        || SERVER_FILE_SUFFIX_PATTERN.is_match(relative_filename)
        || program_has_directive(ctx, "use server")
    {
        return SecretFileExposure::Other;
    }
    if program_has_directive(ctx, "use client")
        || CLIENT_FILE_SUFFIX_PATTERN.is_match(relative_filename)
    {
        return SecretFileExposure::Client;
    }
    if framework == "nextjs"
        && (SERVER_ENTRY_FILE_PATTERN.is_match(relative_filename)
            || NEXT_PAGES_API_FILE_PATTERN.is_match(relative_filename))
    {
        return SecretFileExposure::Other;
    }
    if source_root_owner.is_some_and(|owner| SERVER_SOURCE_ROOT_OWNER_NAMES.contains(&owner))
        || contains_any_segment(classifiable_segments, SERVER_DIRECTORY_NAMES)
    {
        return SecretFileExposure::Other;
    }
    if CLIENT_ENTRY_FILE_PATTERN.is_match(relative_filename) {
        return SecretFileExposure::Client;
    }
    let is_client_app_framework = matches!(framework, "cra" | "expo" | "gatsby" | "vite");
    if SOURCE_FILE_EXTENSION_PATTERN.is_match(relative_filename)
        && is_client_app_framework
        && classifiable_segments.contains(&"app")
    {
        return SecretFileExposure::Client;
    }
    if SOURCE_FILE_EXTENSION_PATTERN.is_match(relative_filename)
        && path_segments.contains(&"src")
        && (classifiable_segments.first() != Some(&"app") || is_client_app_framework)
        && (CLIENT_SOURCE_FILE_EXTENSION_PATTERN.is_match(relative_filename)
            || contains_any_segment(classifiable_segments, CLIENT_SOURCE_DIRECTORY_NAMES))
    {
        return SecretFileExposure::Client;
    }
    SecretFileExposure::Other
}

fn contains_any_segment(segments: &[&str], candidates: &[&str]) -> bool {
    segments.iter().any(|segment| candidates.contains(segment))
}

fn program_has_directive(ctx: &LintContext<'_>, expected: &str) -> bool {
    ctx.nodes()
        .program()
        .directives
        .iter()
        .any(|directive| directive.directive == expected)
}

fn enclosing_component_or_hook_name<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    let function_node = crate::ast_util::get_enclosing_function(node, ctx)?;
    component_or_hook_function_name(function_node, ctx)
}

fn is_inside_server_only_scope(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let body = match ancestor.kind() {
            AstKind::Function(function) => function.body.as_deref(),
            AstKind::ArrowFunctionExpression(function) => function.body.as_function_body(),
            _ => None,
        };
        if body.is_some_and(|body| function_body_has_directive(body, "use server")) {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && is_tanstack_server_fn_handler(ancestor, ctx)
        {
            return true;
        }
    }
    false
}

fn function_body_has_directive(body: &FunctionBody<'_>, expected: &str) -> bool {
    body.directives
        .iter()
        .any(|directive| directive.directive == expected)
}

fn is_tanstack_server_fn_handler<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(handler_call) = parent.kind() else {
        return false;
    };
    if !handler_call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) {
        return false;
    }
    let Some(handler_member) = handler_call.callee.as_member_expression() else {
        return false;
    };
    if member_expression_identifier_property_name(handler_member) != Some("handler") {
        return false;
    }
    let Expression::CallExpression(previous_call) = handler_member.object() else {
        return false;
    };
    is_tanstack_server_fn_chain(previous_call)
}

fn is_tanstack_server_fn_chain(mut current_call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    loop {
        let callee_name = match &current_call.callee {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(member_expression_identifier_property_name),
        };
        if callee_name == Some("createServerFn") {
            return true;
        }
        let Some(member) = current_call.callee.as_member_expression() else {
            return false;
        };
        let Expression::CallExpression(previous_call) = member.object() else {
            return false;
        };
        current_call = previous_call;
    }
}

fn is_public_client_key(value: &str) -> bool {
    PUBLIC_CLIENT_KEY_PREFIXES
        .iter()
        .any(|prefix| value.starts_with(prefix))
        || value.starts_with("public-token-live-")
        || value.starts_with("public-token-test-")
}

fn is_known_secret_value(value: &str) -> bool {
    value.starts_with("sk_live_")
        || value.starts_with("sk_test_")
        || (value.starts_with("AKIA")
            && value.len() == 20
            && value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit()))
        || matches_exact_alphanumeric_suffix(value, "ghp_", 36)
        || matches_exact_alphanumeric_suffix(value, "gho_", 36)
        || value.starts_with("github_pat_")
        || value.starts_with("glpat-")
        || ["xoxb-", "xoxp-", "xoxo-", "xoxr-", "xoxa-", "xoxs-"]
            .iter()
            .any(|prefix| value.starts_with(prefix))
        || (value.strip_prefix("sk-").is_some_and(|suffix| {
            suffix.len() >= 32 && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
        }))
}

fn matches_exact_alphanumeric_suffix(value: &str, prefix: &str, suffix_length: usize) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() == suffix_length && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn is_public_url_value(value: &str) -> bool {
    (value.starts_with("http://") || value.starts_with("https://"))
        && !CREDENTIALED_URL_PATTERN.is_match(value)
}

fn is_placeholder_secret_value(value: &str, allow_contextual_examples: bool) -> bool {
    let trimmed = value.trim_matches(is_javascript_whitespace);
    if trimmed.is_empty() {
        return false;
    }
    let is_mask = trimmed.encode_utf16().count() >= 8
        && trimmed
            .chars()
            .all(|character| is_javascript_whitespace(character) || "._-*•xX".contains(character));
    let has_repeated_placeholder = trimmed.contains("...")
        || trimmed.contains('…')
        || trimmed
            .chars()
            .collect::<Vec<_>>()
            .windows(3)
            .any(|window| {
                window
                    .iter()
                    .all(|character| matches!(character, '*' | '•'))
            });
    if is_mask
        || has_repeated_placeholder
        || PLACEHOLDER_BOUNDARY_PATTERN.is_match(trimmed)
        || PLACEHOLDER_ANGLE_PATTERN.is_match(trimmed)
        || PLACEHOLDER_BRACKET_PATTERN.is_match(trimmed)
        || PLACEHOLDER_BRACE_PATTERN.is_match(trimmed)
    {
        return true;
    }
    allow_contextual_examples && CONTEXTUAL_PLACEHOLDER_PATTERN.is_match(trimmed)
}

fn is_identifier_like_key_name_value(value: &str) -> bool {
    let trimmed = value.trim_matches(|character: char| {
        character == '_' || character == '$' || is_javascript_whitespace(character)
    });
    let segments = trimmed
        .split(['_', '-', ':', '.', '/', '$'])
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    segments.len() >= 2
        && segments
            .iter()
            .all(|segment| IDENTIFIER_LIKE_KEY_SEGMENT_PATTERN.is_match(segment))
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn is_false_positive_suffix(variable_name: &str) -> bool {
    identifier_words(variable_name)
        .last()
        .is_some_and(|word| SECRET_FALSE_POSITIVE_SUFFIXES.contains(&word.as_str()))
}

fn is_structured_parser_sentinel_value(variable_name: &str, value: &str) -> bool {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return false;
    }
    let words = identifier_words(&variable_name.replace(['_', '$'], " "));
    let Some(boundary_word) = words.last() else {
        return false;
    };
    if !matches!(boundary_word.as_str(), "start" | "end") {
        return false;
    }
    let lowercase_value = value.to_ascii_lowercase();
    if !lowercase_value.starts_with(boundary_word) && !lowercase_value.ends_with(boundary_word) {
        return false;
    }
    words[..words.len() - 1]
        .iter()
        .any(|word| !is_secret_variable_name(word) && lowercase_value.contains(word.as_str()))
}

fn is_secret_variable_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    if [
        "apikey",
        "api_key",
        "secret",
        "token",
        "password",
        "credential",
    ]
    .iter()
    .any(|needle| lowercase.contains(needle))
    {
        return true;
    }
    let mut search_offset = 0;
    while let Some(relative_offset) = lowercase[search_offset..].find("auth") {
        let offset = search_offset + relative_offset + "auth".len();
        let suffix = &lowercase[offset..];
        let has_authorization_suffix = suffix.as_bytes().get(2) == Some(&b'i')
            && matches!(suffix.as_bytes().get(3), Some(b'z' | b's'));
        if !suffix.starts_with("or") || has_authorization_suffix {
            return true;
        }
        search_offset = offset;
    }
    false
}

fn identifier_words(name: &str) -> Vec<String> {
    let characters = name.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if characters[index].is_ascii_digit() {
            let start = index;
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
            words.push(characters[start..index].iter().collect::<String>());
            continue;
        }
        if characters[index].is_ascii_lowercase() {
            let start = index;
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
            words.push(characters[start..index].iter().collect::<String>());
            continue;
        }
        if characters[index].is_ascii_uppercase() {
            let start = index;
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                index += 1;
            }
            if index < characters.len() && characters[index].is_ascii_lowercase() {
                let acronym_end = index.saturating_sub(1);
                if acronym_end > start {
                    words.push(
                        characters[start..acronym_end]
                            .iter()
                            .collect::<String>()
                            .to_ascii_lowercase(),
                    );
                }
                let word_start = acronym_end;
                while index < characters.len() && characters[index].is_ascii_lowercase() {
                    index += 1;
                }
                words.push(
                    characters[word_start..index]
                        .iter()
                        .collect::<String>()
                        .to_ascii_lowercase(),
                );
            } else {
                words.push(
                    characters[start..index]
                        .iter()
                        .collect::<String>()
                        .to_ascii_lowercase(),
                );
            }
            continue;
        }
        index += 1;
    }
    words
}
