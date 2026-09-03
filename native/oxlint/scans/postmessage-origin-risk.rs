use std::path::Path;

use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_allocator::Allocator;
use oxc_ast::{AstKind, ast::Argument};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType, Span};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str =
    "A message event handler reads cross-window messages without an obvious origin check.";

static MESSAGE_DATA_READ_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?-u:\b)(?:event|e|evt|msg|message)\.data(?-u:\b)");
static MESSAGE_DATA_BINDING_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?s)(?-u:\b)(?:const|let|var)\s+[^;=]*=\s*$");
static SOURCE_CHECK_PATTERN: Lazy<Regex> = lazy_regex!(r"\.source\s*[!=]==?");
static SAME_APPLICATION_CHANNEL_TARGET_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)port\d?(?-u:\b)|worker|channel|broadcast|socket|(?-u:\bws\b)|(?-u:\bsse\b)|eventsource|^_?self\.|^source\."
);
static RECEIVER_ROOT_PATTERN: Lazy<Regex> = lazy_regex!(r"^[A-Za-z0-9_$]+");
static WORKER_FILE_PATH_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)worker");

pub fn scan(absolute_path: &str, relative_path: &str, source: &str) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !super::is_production_file_path::is_production_source_path(relative_path)
        || WORKER_FILE_PATH_PATTERN.is_match(normalized_path.as_ref())
        || (!source.contains("onmessage")
            && !(source.contains("addEventListener")
                && (source.contains("message") || source.contains('\\'))))
    {
        return Vec::new();
    }
    let normalized_absolute_path = absolute_path.to_ascii_lowercase();
    let Ok(source_type) = SourceType::from_path(Path::new(&normalized_absolute_path)) else {
        return Vec::new();
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return Vec::new();
    }
    let semantic_return =
        SemanticBuilder::new_linter().build(allocator.alloc(parser_return.program));
    let mut handlers = Vec::new();
    for node in semantic_return.semantic.nodes().iter() {
        let Some((target_span, handler_span)) = (match node.kind() {
            AstKind::CallExpression(call) => {
                let callee_span = call.callee.span();
                let callee_text = source_text(source, callee_span);
                let is_message_event = matches!(
                    call.arguments.first(),
                    Some(Argument::StringLiteral(event)) if event.value == "message"
                );
                (callee_text.ends_with("addEventListener") && is_message_event)
                    .then_some((callee_span, call.span))
            }
            AstKind::AssignmentExpression(assignment) => {
                let left_span = assignment.left.span();
                source_text(source, left_span)
                    .ends_with(".onmessage")
                    .then_some((left_span, assignment.span))
            }
            _ => None,
        }) else {
            continue;
        };
        handlers.push((target_span, handler_span));
    }
    handlers.sort_unstable_by_key(|(_, handler_span)| handler_span.start);

    let mut findings = Vec::new();
    for (target_span, handler_span) in handlers {
        let target = source_text(source, target_span);
        let normalized_target =
            super::normalize_js_regex_content::normalize_js_regex_content(target);
        if SAME_APPLICATION_CHANNEL_TARGET_PATTERN.is_match(normalized_target.as_ref())
            || is_same_application_channel_instance(target, source)
            || is_same_application_channel_typed_receiver(target, source)
        {
            continue;
        }
        let node_text = source_text(source, handler_span);
        let Some(data) = MESSAGE_DATA_READ_PATTERN.find(node_text) else {
            continue;
        };
        if let Some(origin_index) = first_origin_check_index(node_text) {
            if MESSAGE_DATA_BINDING_PATTERN.is_match(&node_text[..data.start()])
                || origin_index < data.start()
            {
                continue;
            }
        }
        let (line, column) = get_location_at_index(source, source, handler_span.start as usize);
        findings.push(ScanFinding::inherited(MESSAGE, line, column));
    }
    findings
}

fn source_text(source: &str, span: Span) -> &str {
    source
        .get(span.start as usize..span.end as usize)
        .unwrap_or_default()
}

fn first_origin_check_index(source: &str) -> Option<usize> {
    let origin_index = source
        .to_ascii_lowercase()
        .match_indices("origin")
        .find_map(|(index, _)| {
            (!source[index + "origin".len()..]
                .to_ascii_lowercase()
                .starts_with("al"))
            .then_some(index)
        });
    let lowercase_source = source.to_ascii_lowercase();
    let normalized_source =
        super::normalize_js_regex_content::normalize_js_regex_content(&lowercase_source);
    match (
        origin_index,
        SOURCE_CHECK_PATTERN.find(normalized_source.as_ref()),
    ) {
        (Some(origin), Some(source_check)) => Some(origin.min(source_check.start())),
        (Some(origin), None) => Some(origin),
        (None, Some(source_check)) => Some(source_check.start()),
        (None, None) => None,
    }
}

fn is_same_application_channel_instance(target: &str, source: &str) -> bool {
    let Some(root) = RECEIVER_ROOT_PATTERN
        .find(target)
        .map(|found| found.as_str())
    else {
        return false;
    };
    let pattern = Regex::new(&format!(
        r"(?:^|[^A-Za-z0-9_$.]){}\s*=\s*new\s+(?:EventSource|WebSocket|Worker|SharedWorker|BroadcastChannel|MessageChannel)(?-u:\b)",
        lazy_regex::regex::escape(root)
    ))
    .expect("valid channel assignment pattern");
    pattern.is_match(source)
}

fn is_same_application_channel_typed_receiver(target: &str, source: &str) -> bool {
    let Some(root) = RECEIVER_ROOT_PATTERN
        .find(target)
        .map(|found| found.as_str())
    else {
        return false;
    };
    let pattern = Regex::new(&format!(
        r"(?m)(?:^|[(,{{;]\s*){}\s*[?!]?\s*:\s*(?:Worker|SharedWorker|MessagePort|BroadcastChannel|WebSocket|EventSource)(?-u:\b)",
        lazy_regex::regex::escape(root)
    ))
    .expect("valid typed channel pattern");
    pattern.is_match(source)
}
