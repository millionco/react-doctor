use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

static GRAPHQL_URL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(^|/)graphql(/|\?|#|$)");
static READ_URL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(^|/)(get|list|search|query|quote)([-_.]|/|\?|#|$)");
static GRAPHQL_MUTATION_PATTERN: Lazy<Regex> = lazy_regex!(r"^\s*mutation\b");
const QUERY_HOOK_NAMES: [&str; 4] = [
    "useQuery",
    "useInfiniteQuery",
    "useSuspenseQuery",
    "useSuspenseInfiniteQuery",
];

#[derive(Debug, Default, Clone)]
pub struct QueryNoUsequeryForMutation;

declare_oxc_lint!(
    /// Disallow mutating fetches inside TanStack Query read hooks.
    QueryNoUsequeryForMutation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow useQuery for mutating fetches.",
);

impl Rule for QueryNoUsequeryForMutation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(query_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &query_call.callee else {
            return;
        };
        if !QUERY_HOOK_NAMES.contains(&callee.name.as_str()) {
            return;
        }
        let Some(Expression::ObjectExpression(options)) = query_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if query_mutation_has_polling(options) {
            return;
        }
        let Some(query_function) = options.properties.iter().find_map(|property| {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            query_mutation_identifier_key_matches(&property.key, "queryFn")
                .then_some(&property.value)
        }) else {
            return;
        };
        let query_function_span = query_function.span();
        let has_mutating_fetch = ctx.nodes().iter().any(|candidate| {
            if !query_function_span.contains_inclusive(candidate.span()) {
                return false;
            }
            let AstKind::CallExpression(fetch_call) = candidate.kind() else {
                return false;
            };
            let Expression::Identifier(fetch) = &fetch_call.callee else {
                return false;
            };
            if fetch.name != "fetch" {
                return false;
            }
            query_mutation_fetch_is_write(fetch_call, ctx)
        });
        if has_mutating_fetch {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "{}() auto-refetches, so this mutating fetch (POST/PUT/DELETE) can fire repeatedly.",
                    callee.name
                ))
                .with_label(query_call.span),
            );
        }
    }
}

fn query_mutation_has_polling(options: &oxc_ast::ast::ObjectExpression<'_>) -> bool {
    options.properties.iter().any(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if !query_mutation_identifier_key_matches(&property.key, "refetchInterval") {
            return false;
        }
        match &property.value {
            Expression::BooleanLiteral(literal) => literal.value,
            Expression::NumericLiteral(literal) => literal.value != 0.0,
            _ => true,
        }
    })
}

fn query_mutation_fetch_is_write<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Expression::ObjectExpression(options)) = call
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    let method = options.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if !query_mutation_identifier_key_matches(&property.key, "method") {
            return None;
        }
        match &property.value {
            Expression::StringLiteral(value) => Some(value.value.to_ascii_uppercase()),
            _ => None,
        }
    });
    let Some(method) =
        method.filter(|method| matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE"))
    else {
        return false;
    };
    let url = call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression);
    if method == "POST"
        && query_mutation_url_matches(url, &GRAPHQL_URL_PATTERN, ctx, &mut Vec::new())
        && !query_mutation_body_contains_graphql_mutation(options, ctx)
    {
        return false;
    }
    !(method == "POST" && query_mutation_url_matches(url, &READ_URL_PATTERN, ctx, &mut Vec::new()))
}

fn query_mutation_url_matches<'a>(
    expression: Option<&Expression<'a>>,
    pattern: &Regex,
    ctx: &LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    let Some(expression) = expression else {
        return false;
    };
    match expression {
        Expression::StringLiteral(value) => pattern.is_match(value.value.as_str()),
        Expression::TemplateLiteral(template) => template
            .quasis
            .iter()
            .any(|quasi| pattern.is_match(quasi.value.raw.as_str())),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited.contains(&symbol_id) {
                return false;
            }
            visited.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            query_mutation_url_matches(declarator.init.as_ref(), pattern, ctx, visited)
        }
        _ => false,
    }
}

fn query_mutation_body_contains_graphql_mutation(
    options: &oxc_ast::ast::ObjectExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(body) = options.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        query_mutation_identifier_key_matches(&property.key, "body").then_some(&property.value)
    }) else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        body.span().contains_inclusive(node.span())
            && match node.kind() {
                AstKind::StringLiteral(value) => {
                    GRAPHQL_MUTATION_PATTERN.is_match(value.value.as_str())
                }
                AstKind::TemplateLiteral(template) => template
                    .quasis
                    .iter()
                    .any(|quasi| GRAPHQL_MUTATION_PATTERN.is_match(quasi.value.raw.as_str())),
                _ => false,
            }
    })
}

fn query_mutation_identifier_key_matches(
    key: &oxc_ast::ast::PropertyKey<'_>,
    expected_name: &str,
) -> bool {
    match key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => identifier.name == expected_name,
        oxc_ast::ast::PropertyKey::Identifier(identifier) => identifier.name == expected_name,
        _ => false,
    }
}
