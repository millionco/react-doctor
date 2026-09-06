use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DECODE_MESSAGE: &str = "This decodes a URL/route value with `decodeURIComponent`/`decodeURI`, which throws `URIError` on a malformed percent-escape (a lone `%`, `100%off`) and unwinds render or aborts the handler. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const COLOR_MESSAGE: &str = "This parses a runtime color with a library that throws on input it cannot resolve (most often a `var(--x)` CSS variable), crashing render on exactly the theme values you did not test. Wrap it in a try/catch, or route it through a `safe*` helper that returns a fallback.";
const URL_MESSAGE: &str = "This builds a `URL` from a runtime URL/route value (`params`, `searchParams`, a `location` field), which throws `TypeError` on a malformed string and crashes render. Guard it with `URL.canParse`, pass a base-URL second argument, or wrap the call in a try/catch.";
const ROUTE_FIELD_NAMES: [&str; 6] = ["url", "href", "path", "ref", "branch", "query"];
const ROUTE_SOURCE_NAMES: [&str; 3] = ["searchParams", "params", "location"];
const UNTRUSTED_URL_ROOT_NAMES: [&str; 5] =
    ["searchParams", "params", "location", "request", "req"];
const ROUTE_STRING_METHODS: [&str; 6] = [
    "replace",
    "replaceAll",
    "slice",
    "split",
    "substr",
    "substring",
];
const SYNC_ITERATOR_METHODS: [&str; 11] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
];

#[derive(Debug, Default, Clone)]
pub struct NoUnguardedThrowingParseCall;

declare_oxc_lint!(
    /// Warns about unguarded runtime input passed to throwing parse APIs.
    NoUnguardedThrowingParseCall,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unguarded call to a throwing parse API.",
);

impl Rule for NoUnguardedThrowingParseCall {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        if is_test_noise_file(ctx) {
            return false;
        }
        let filename = format!("/{}", ctx.file_path().to_string_lossy().replace('\\', "/"));
        ![
            "/dist/",
            "/build/",
            "/scripts/",
            "/vendor/",
            "/public/",
            "/docs/",
        ]
        .iter()
        .any(|segment| filename.contains(segment))
            && !filename.contains(".min.")
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression) => {
                let Expression::Identifier(callee) = new_expression.callee.get_inner_expression()
                else {
                    return;
                };
                if callee.name != "URL"
                    || !throwing_parse_is_global(callee, ctx)
                    || new_expression.arguments.len() != 1
                {
                    return;
                }
                let Some(argument) = new_expression
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                else {
                    return;
                };
                if throwing_parse_is_compile_time_value(argument, ctx, 0)
                    || throwing_parse_is_always_valid_url(argument, ctx)
                    || !throwing_parse_is_untrusted_url(argument, ctx, 0)
                    || throwing_parse_is_inside_guarding_try(node, ctx)
                    || throwing_parse_has_validity_guard(node, "url", argument, ctx)
                {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(URL_MESSAGE).with_label(new_expression.span));
            }
            AstKind::CallExpression(call) => {
                let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                    return;
                };
                let callee_name = callee.name.as_str();
                let is_decode = matches!(callee_name, "decodeURIComponent" | "decodeURI")
                    && throwing_parse_is_global(callee, ctx);
                let is_color = matches!(callee_name, "readableColor" | "parseToRgb" | "chroma")
                    && throwing_parse_is_supported_color_parser(callee, ctx);
                if !is_decode && !is_color {
                    return;
                }
                let Some(argument) = call.arguments.first().and_then(Argument::as_expression)
                else {
                    return;
                };
                if throwing_parse_is_inside_guarding_try(node, ctx) {
                    return;
                }
                if is_decode {
                    if throwing_parse_traces_to_route_value(argument, ctx, 0) {
                        ctx.diagnostic(OxcDiagnostic::warn(DECODE_MESSAGE).with_label(call.span));
                    }
                    return;
                }
                if throwing_parse_has_enclosing_function(node, ctx)
                    && throwing_parse_can_carry_css_variable(argument, ctx, 0)
                    && !throwing_parse_has_validity_guard(node, "color", argument, ctx)
                {
                    ctx.diagnostic(OxcDiagnostic::warn(COLOR_MESSAGE).with_label(call.span));
                }
            }
            _ => {}
        }
    }
}

fn throwing_parse_is_global<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn throwing_parse_identifier_symbol<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn throwing_parse_initializer_before<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = throwing_parse_identifier_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    declarator.init.as_ref()
}

fn throwing_parse_is_parameter<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = throwing_parse_identifier_symbol(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(declaration.kind(), AstKind::FormalParameter(_))
        || ctx
            .nodes()
            .ancestors(declaration.id())
            .take_while(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .any(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
}

fn throwing_parse_is_unwritten_parameter<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    throwing_parse_identifier_symbol(identifier, ctx).is_some_and(|symbol_id| {
        throwing_parse_is_parameter(identifier, ctx)
            && !symbol_has_write_before(symbol_id, identifier.span.start, ctx)
    })
}

fn throwing_parse_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut current = expression.get_inner_expression();
    loop {
        match current {
            Expression::Identifier(identifier) => return Some(identifier),
            expression if expression.as_member_expression().is_some() => {
                current = expression
                    .as_member_expression()?
                    .object()
                    .get_inner_expression()
            }
            Expression::CallExpression(call) => current = call.callee.get_inner_expression(),
            _ => return None,
        }
    }
}

fn throwing_parse_is_compile_time_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5 {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::TemplateLiteral(template) => {
            template.expressions.is_empty()
                || template.quasis.first().is_some_and(|quasi| {
                    throwing_parse_has_absolute_origin_prefix(quasi.value.raw.as_str())
                })
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = throwing_parse_identifier_symbol(identifier, ctx) else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    matches!(
                        initializer.get_inner_expression(),
                        Expression::StringLiteral(_)
                            | Expression::NumericLiteral(_)
                            | Expression::BooleanLiteral(_)
                            | Expression::NullLiteral(_)
                            | Expression::BigIntLiteral(_)
                            | Expression::RegExpLiteral(_)
                    )
                })
        }
        _ => false,
    }
}

fn throwing_parse_has_absolute_origin_prefix(value: &str) -> bool {
    let Some(scheme_end) = value.find("://") else {
        return false;
    };
    let scheme = &value[..scheme_end];
    let Some(host_end) = value[scheme_end + 3..].find('/') else {
        return false;
    };
    let host = &value[scheme_end + 3..scheme_end + 3 + host_end];
    scheme
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && scheme
            .chars()
            .skip(1)
            .all(|character| character.is_ascii_alphanumeric() || "+.-".contains(character))
        && !host.is_empty()
        && !host.chars().any(char::is_whitespace)
}

fn throwing_parse_is_location_object<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "location" && throwing_parse_is_global(identifier, ctx)
        }
        Expression::StaticMemberExpression(member) => {
            if member.property.name != "location" {
                return false;
            }
            matches!(member.object.get_inner_expression(), Expression::Identifier(owner)
                if matches!(owner.name.as_str(), "window" | "document" | "globalThis") && throwing_parse_is_global(owner, ctx))
        }
        _ => false,
    }
}

fn throwing_parse_is_location_member<'a>(
    expression: &Expression<'a>,
    property_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::StaticMemberExpression(member) = expression.get_inner_expression() else {
        return false;
    };
    property_names.contains(&member.property.name.as_str())
        && throwing_parse_is_location_object(&member.object, ctx)
}

fn throwing_parse_is_valid_url_source<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if throwing_parse_is_location_object(expression, ctx) {
        return true;
    }
    if let Expression::CallExpression(call) = expression {
        if let Expression::Identifier(callee) = call.callee.get_inner_expression()
            && callee.name == "String"
            && call.arguments.len() == 1
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| throwing_parse_is_location_object(argument, ctx))
        {
            return true;
        }
        let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
            return false;
        };
        let name = member.property.name.as_str();
        if name == "toString" && call.arguments.is_empty() {
            return throwing_parse_is_location_object(&member.object, ctx);
        }
        return name == "url"
            && call.arguments.is_empty()
            && matches!(member.object.get_inner_expression(), Expression::Identifier(receiver) if matches!(receiver.name.as_str(), "page" | "request" | "req"));
    }
    let Expression::StaticMemberExpression(member) = expression else {
        return false;
    };
    match member.property.name.as_str() {
        "href" | "origin" => throwing_parse_is_location_object(&member.object, ctx),
        "URL" => {
            matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "document")
        }
        "url" => {
            matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "request" | "req"))
                || matches!(
                    member.object.get_inner_expression(),
                    Expression::ImportMeta(_)
                )
        }
        "nextUrl" => {
            matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "request" | "req"))
        }
        _ => false,
    }
}

fn throwing_parse_is_always_valid_url<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    loop {
        if throwing_parse_is_valid_url_source(current, ctx) {
            return true;
        }
        match current {
            expression if expression.as_member_expression().is_some() => {
                current = expression
                    .as_member_expression()
                    .unwrap()
                    .object()
                    .get_inner_expression()
            }
            Expression::CallExpression(call) => current = call.callee.get_inner_expression(),
            _ => return false,
        }
    }
}

fn throwing_parse_is_search_params_serialization<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5 {
        return false;
    }
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return false;
    };
    match member.property.name.as_str() {
        "replace" | "replaceAll" => {
            throwing_parse_is_search_params_serialization(&member.object, ctx, depth + 1)
        }
        "toString" => throwing_parse_is_search_params_construction(&member.object, ctx, depth + 1),
        _ => false,
    }
}

fn throwing_parse_is_search_params_construction<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5 {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "URLSearchParams")
        }
        Expression::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "createSearchParams")
        }
        Expression::Identifier(identifier) => throwing_parse_initializer_before(identifier, ctx)
            .is_some_and(|initializer| {
                throwing_parse_is_search_params_construction(initializer, ctx, depth + 1)
            }),
        _ => false,
    }
}

fn throwing_parse_is_builtin_encoder<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if matches!(identifier.name.as_str(), "encodeURIComponent" | "encodeURI") && throwing_parse_is_global(identifier, ctx))
}

fn throwing_parse_is_static_index<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::ComputedMemberExpression(member) = expression.get_inner_expression() else {
        return None;
    };
    match member.expression.get_inner_expression() {
        Expression::NumericLiteral(literal)
            if literal.value >= 0.0 && literal.value.fract() == 0.0 =>
        {
            Some(&member.object)
        }
        Expression::StringLiteral(literal)
            if !literal.value.is_empty()
                && literal
                    .value
                    .as_str()
                    .chars()
                    .all(|character| character.is_ascii_digit()) =>
        {
            Some(&member.object)
        }
        _ => None,
    }
}

fn throwing_parse_route_string_receiver<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let method = member.static_property_name()?;
    if !ROUTE_STRING_METHODS.contains(&method) {
        return None;
    }
    if method == "split"
        && !matches!(call.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression), Some(Expression::StringLiteral(literal)) if literal.value == "/")
    {
        return None;
    }
    Some(member.object())
}

fn throwing_parse_traces_to_route_value<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5
        || throwing_parse_is_search_params_serialization(expression, ctx, 0)
        || throwing_parse_is_builtin_encoder(expression, ctx)
    {
        return false;
    }
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression
        && let Expression::Identifier(callee) = call.callee.get_inner_expression()
        && matches!(callee.name.as_str(), "encodeURIComponent" | "encodeURI")
    {
        return call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| {
                throwing_parse_traces_to_route_value(argument, ctx, depth + 1)
            });
    }
    if let Expression::CallExpression(call) = expression
        && let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && throwing_parse_is_builtin_encoder(member.object(), ctx)
    {
        let Expression::CallExpression(encoder_call) = member.object().get_inner_expression()
        else {
            return false;
        };
        return encoder_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| {
                throwing_parse_traces_to_route_value(argument, ctx, depth + 1)
            });
    }
    if let Expression::Identifier(identifier) = expression {
        if throwing_parse_identifier_symbol(identifier, ctx)
            .is_some_and(|symbol_id| symbol_has_write_before(symbol_id, identifier.span.start, ctx))
        {
            return false;
        }
        if let Some(initializer) = throwing_parse_initializer_before(identifier, ctx) {
            return throwing_parse_traces_to_route_value(initializer, ctx, depth + 1);
        }
        return throwing_parse_is_unwritten_parameter(identifier, ctx)
            && (ROUTE_FIELD_NAMES.contains(&identifier.name.as_str())
                || matches!(
                    identifier.name.as_str(),
                    "searchParams" | "params" | "location"
                ))
            || throwing_parse_is_global(identifier, ctx)
                && ROUTE_FIELD_NAMES.contains(&identifier.name.as_str());
    }
    if let Some(object) = throwing_parse_is_static_index(expression) {
        return throwing_parse_traces_to_route_value(object, ctx, depth + 1);
    }
    if let Some(receiver) = throwing_parse_route_string_receiver(expression) {
        return throwing_parse_traces_to_route_value(receiver, ctx, depth + 1);
    }
    if throwing_parse_is_location_member(expression, &["href", "hash", "search", "pathname"], ctx) {
        return true;
    }
    let Some(root) = throwing_parse_root_identifier(expression) else {
        return false;
    };
    if ROUTE_SOURCE_NAMES.contains(&root.name.as_str()) {
        if throwing_parse_is_global(root, ctx) || throwing_parse_is_parameter(root, ctx) {
            return true;
        }
        if let Some(initializer) = throwing_parse_initializer_before(root, ctx)
            && matches!(initializer.get_inner_expression(), Expression::CallExpression(call) if matches!(call.callee.get_inner_expression(), Expression::Identifier(callee) if matches!(callee.name.as_str(), "useParams" | "useSearchParams" | "useLocation")))
        {
            return true;
        }
    }
    expression.as_member_expression().is_some_and(|member| {
        ROUTE_FIELD_NAMES.contains(&member.static_property_name().unwrap_or(""))
            && UNTRUSTED_URL_ROOT_NAMES.contains(&root.name.as_str())
            && (throwing_parse_is_unwritten_parameter(root, ctx)
                || throwing_parse_is_global(root, ctx))
    })
}

fn throwing_parse_is_process_env(expression: &Expression<'_>) -> bool {
    throwing_parse_root_identifier(expression)
        .is_some_and(|identifier| identifier.name == "process")
}

fn throwing_parse_is_untrusted_url<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5
        || throwing_parse_is_compile_time_value(expression, ctx, depth)
        || throwing_parse_is_always_valid_url(expression, ctx)
        || throwing_parse_is_search_params_serialization(expression, ctx, depth)
    {
        return false;
    }
    let expression = expression.get_inner_expression();
    if throwing_parse_is_location_member(expression, &["hash", "pathname", "search"], ctx) {
        return true;
    }
    match expression {
        Expression::AwaitExpression(await_expression) => {
            throwing_parse_is_untrusted_url(&await_expression.argument, ctx, depth + 1)
        }
        Expression::ConditionalExpression(conditional) => {
            throwing_parse_is_untrusted_url(&conditional.consequent, ctx, depth + 1)
                || throwing_parse_is_untrusted_url(&conditional.alternate, ctx, depth + 1)
        }
        Expression::LogicalExpression(logical) => {
            throwing_parse_is_untrusted_url(&logical.left, ctx, depth + 1)
                || throwing_parse_is_untrusted_url(&logical.right, ctx, depth + 1)
        }
        Expression::TemplateLiteral(template) => {
            if template
                .quasis
                .first()
                .is_some_and(|quasi| quasi.value.raw.is_empty())
                && template
                    .expressions
                    .first()
                    .is_some_and(|origin| throwing_parse_is_always_valid_url(origin, ctx))
                && template
                    .quasis
                    .get(1)
                    .is_some_and(|quasi| quasi.value.raw.starts_with('/'))
            {
                return false;
            }
            template
                .expressions
                .iter()
                .any(|part| throwing_parse_is_untrusted_url(part, ctx, depth + 1))
        }
        Expression::Identifier(identifier) => {
            if let Some(initializer) = throwing_parse_initializer_before(identifier, ctx) {
                return throwing_parse_is_untrusted_url(initializer, ctx, depth + 1);
            }
            throwing_parse_is_parameter(identifier, ctx)
                && matches!(
                    identifier.name.as_str(),
                    "searchParams" | "params" | "location"
                )
        }
        Expression::CallExpression(call) => throwing_parse_root_identifier(&call.callee)
            .is_some_and(|root| UNTRUSTED_URL_ROOT_NAMES.contains(&root.name.as_str())),
        _ => {
            if throwing_parse_is_process_env(expression) {
                return true;
            }
            let Some(root) = throwing_parse_root_identifier(expression) else {
                return false;
            };
            if UNTRUSTED_URL_ROOT_NAMES.contains(&root.name.as_str()) {
                return true;
            }
            false
        }
    }
}

fn throwing_parse_is_supported_color_parser<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = throwing_parse_identifier_symbol(identifier, ctx) else {
        return true;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        matches!(entry.module_request.name(), "chroma-js" | "polished")
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn throwing_parse_theme_token_root<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(initializer) = throwing_parse_initializer_before(identifier, ctx) else {
        return false;
    };
    let Expression::CallExpression(call) = initializer.get_inner_expression() else {
        return false;
    };
    let hook_identifier: Option<&oxc_ast::ast::IdentifierReference<'a>> = match call
        .callee
        .get_inner_expression()
    {
        Expression::Identifier(hook) if matches!(hook.name.as_str(), "useTheme" | "useToken") => {
            Some(hook)
        }
        Expression::StaticMemberExpression(member)
            if matches!(member.property.name.as_str(), "useTheme" | "useToken") =>
        {
            throwing_parse_root_identifier(&member.object)
        }
        _ => None,
    };
    hook_identifier.is_some_and(|hook| {
        throwing_parse_is_global(hook, ctx)
            || throwing_parse_identifier_symbol(hook, ctx).is_some_and(|symbol_id| {
                ctx.module_record().import_entries.iter().any(|entry| {
                    ctx.scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                })
            })
    })
}

fn throwing_parse_subtree_has_computed_style_read<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span()) && matches!(candidate.kind(), AstKind::IdentifierReference(identifier) if matches!(identifier.name.as_str(), "getComputedStyle" | "getPropertyValue"))
    })
}

fn throwing_parse_can_carry_css_variable<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 5 {
        return false;
    }
    let expression = expression.get_inner_expression();
    match expression {
        Expression::StringLiteral(literal) => literal.value.contains("var("),
        Expression::TemplateLiteral(template) => {
            template
                .quasis
                .iter()
                .any(|quasi| quasi.value.raw.contains("var("))
                || template
                    .expressions
                    .iter()
                    .any(|part| throwing_parse_can_carry_css_variable(part, ctx, depth + 1))
        }
        Expression::ConditionalExpression(conditional) => {
            throwing_parse_can_carry_css_variable(&conditional.consequent, ctx, depth + 1)
                || throwing_parse_can_carry_css_variable(&conditional.alternate, ctx, depth + 1)
        }
        Expression::LogicalExpression(logical) => {
            throwing_parse_can_carry_css_variable(&logical.left, ctx, depth + 1)
                || throwing_parse_can_carry_css_variable(&logical.right, ctx, depth + 1)
        }
        Expression::Identifier(identifier) => {
            if throwing_parse_theme_token_root(identifier, ctx) {
                return false;
            }
            throwing_parse_initializer_before(identifier, ctx).map_or_else(
                || throwing_parse_is_parameter(identifier, ctx),
                |initializer| throwing_parse_can_carry_css_variable(initializer, ctx, depth + 1),
            )
        }
        expression if expression.as_member_expression().is_some() => {
            if throwing_parse_subtree_has_computed_style_read(expression, ctx) {
                return true;
            }
            let Some(root) = throwing_parse_root_identifier(expression) else {
                return false;
            };
            if throwing_parse_theme_token_root(root, ctx) {
                return false;
            }
            throwing_parse_initializer_before(root, ctx).map_or_else(
                || throwing_parse_is_parameter(root, ctx),
                |initializer| throwing_parse_can_carry_css_variable(initializer, ctx, depth + 1),
            )
        }
        _ => throwing_parse_subtree_has_computed_style_read(expression, ctx),
    }
}

fn throwing_parse_has_enclosing_function<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}

fn throwing_parse_is_synchronous_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return matches!(parent.kind(), AstKind::NewExpression(new_expression) if new_expression.callee.span() == root.span());
    };
    if call.callee.span() == root.span() {
        return true;
    }
    if !call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == root.span())
    }) {
        return false;
    }
    if matches!(call.callee.get_inner_expression(), Expression::StaticMemberExpression(member)
        if matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array" && throwing_parse_is_global(identifier, ctx))
            && member.property.name == "from")
    {
        return true;
    }
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| {
            SYNC_ITERATOR_METHODS.contains(&member.static_property_name().unwrap_or(""))
        })
}

fn throwing_parse_is_inside_guarding_try<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut child_id = node.id();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !throwing_parse_is_synchronous_callback(ancestor, ctx)
        {
            return false;
        }
        if let AstKind::TryStatement(try_statement) = ancestor.kind()
            && try_statement.block.node_id.get() == child_id
        {
            return true;
        }
        child_id = ancestor.id();
    }
    false
}

fn throwing_parse_expression_path(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member) => {
            let object_path = throwing_parse_expression_path(&member.object)?;
            Some(format!("{object_path}.{}", member.property.name))
        }
        _ => None,
    }
}

fn throwing_parse_matching_validity_check<'a>(
    expression: &Expression<'a>,
    parser_kind: &str,
    parsed_argument: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(first_argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if throwing_parse_expression_path(first_argument)
        != throwing_parse_expression_path(parsed_argument)
    {
        return false;
    }
    if parser_kind == "url" {
        return call.arguments.len() == 1
            && member.static_property_name() == Some("canParse")
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "URL" && throwing_parse_is_global(identifier, ctx));
    }
    member.static_property_name() == Some("valid")
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "chroma" && throwing_parse_is_supported_color_parser(identifier, ctx))
}

fn throwing_parse_validity_polarity<'a>(
    expression: &Expression<'a>,
    parser_kind: &str,
    parsed_argument: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if throwing_parse_matching_validity_check(expression, parser_kind, parsed_argument, ctx) {
        return Some(true);
    }
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
        && throwing_parse_matching_validity_check(
            &unary.argument,
            parser_kind,
            parsed_argument,
            ctx,
        )
    {
        return Some(false);
    }
    let Expression::BinaryExpression(binary) = expression else {
        return None;
    };
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) {
        return None;
    }
    for (checked, compared) in [(&binary.left, &binary.right), (&binary.right, &binary.left)] {
        let Expression::BooleanLiteral(boolean) = compared.get_inner_expression() else {
            continue;
        };
        let checked_polarity =
            throwing_parse_validity_polarity(checked, parser_kind, parsed_argument, ctx)?;
        let is_equality = matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        );
        return Some(if is_equality {
            checked_polarity == boolean.value
        } else {
            checked_polarity != boolean.value
        });
    }
    None
}

fn throwing_parse_statement_exits(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_)
        | Statement::ContinueStatement(_)
        | Statement::BreakStatement(_) => true,
        Statement::BlockStatement(block) => block.body.iter().any(|statement| {
            matches!(
                statement,
                Statement::ReturnStatement(_)
                    | Statement::ThrowStatement(_)
                    | Statement::ContinueStatement(_)
                    | Statement::BreakStatement(_)
            )
        }),
        _ => false,
    }
}

fn throwing_parse_root_symbol<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    throwing_parse_root_identifier(expression)
        .and_then(|identifier| throwing_parse_identifier_symbol(identifier, ctx))
}

fn throwing_parse_has_write_between<'a>(
    parsed_argument: &'a Expression<'a>,
    guard_offset: u32,
    parse_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = throwing_parse_root_symbol(parsed_argument, ctx) else {
        return false;
    };
    let parse_function_id = throwing_parse_execution_boundary_id(parse_node, ctx);
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let write_node = ctx.nodes().get_node(reference.node_id());
            write_node.span().start > guard_offset
                && write_node.span().start < parse_node.span().start
                && throwing_parse_execution_boundary_id(write_node, ctx) == parse_function_id
        })
}

fn throwing_parse_execution_boundary_id<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) && !throwing_parse_is_synchronous_callback(ancestor, ctx)
        })
        .map(|ancestor| ancestor.id())
}

fn throwing_parse_has_validity_guard<'a>(
    parse_node: &AstNode<'a>,
    parser_kind: &str,
    parsed_argument: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_id = parse_node.id();
    for ancestor in ctx.nodes().ancestors(parse_node.id()) {
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(ctx.nodes().get_node(child_id).span())
                    && throwing_parse_validity_polarity(
                        &statement.test,
                        parser_kind,
                        parsed_argument,
                        ctx,
                    ) == Some(true)
                    && !throwing_parse_has_write_between(
                        parsed_argument,
                        statement.test.span().start,
                        parse_node,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(conditional) => {
                let child_span = ctx.nodes().get_node(child_id).span();
                let polarity = throwing_parse_validity_polarity(
                    &conditional.test,
                    parser_kind,
                    parsed_argument,
                    ctx,
                );
                if ((conditional.consequent.span().contains_inclusive(child_span)
                    && polarity == Some(true))
                    || (conditional.alternate.span().contains_inclusive(child_span)
                        && polarity == Some(false)))
                    && !throwing_parse_has_write_between(
                        parsed_argument,
                        conditional.test.span().start,
                        parse_node,
                        ctx,
                    )
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(logical)
                if logical.operator == oxc_syntax::operator::LogicalOperator::And
                    && logical
                        .right
                        .span()
                        .contains_inclusive(ctx.nodes().get_node(child_id).span())
                    && throwing_parse_validity_polarity(
                        &logical.left,
                        parser_kind,
                        parsed_argument,
                        ctx,
                    ) == Some(true)
                    && !throwing_parse_has_write_between(
                        parsed_argument,
                        logical.left.span().start,
                        parse_node,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        let statements = match ancestor.kind() {
            AstKind::FunctionBody(body) => Some(body.statements.as_slice()),
            AstKind::BlockStatement(block) => Some(block.body.as_slice()),
            AstKind::Program(program) => Some(program.body.as_slice()),
            _ => None,
        };
        if let Some(statements) = statements {
            let child_span = ctx.nodes().get_node(child_id).span();
            for statement in statements {
                if statement.span() == child_span {
                    break;
                }
                if let Statement::IfStatement(if_statement) = statement
                    && throwing_parse_validity_polarity(
                        &if_statement.test,
                        parser_kind,
                        parsed_argument,
                        ctx,
                    ) == Some(false)
                    && throwing_parse_statement_exits(&if_statement.consequent)
                    && !throwing_parse_has_write_between(
                        parsed_argument,
                        if_statement.test.span().start,
                        parse_node,
                        ctx,
                    )
                {
                    return true;
                }
            }
        }
        child_id = ancestor.id();
    }
    false
}
