use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, CallExpression, ChainElement, Expression,
        FunctionType, MemberExpression, TSSignature, TSTupleElement, TSType, TSTypeName,
        TSTypeOperatorOperator, TSTypeParameter,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SMALL_LITERAL_ARRAY_MAX_ELEMENTS: usize = 8;
const ITERATION_CALLBACK_METHOD_NAMES: &[&str] = &[
    "forEach",
    "map",
    "flatMap",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "reduce",
    "reduceRight",
];
const STRING_RETURNING_METHOD_NAMES: &[&str] = &[
    "toString",
    "toLocaleString",
    "toLowerCase",
    "toUpperCase",
    "toLocaleLowerCase",
    "toLocaleUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "padStart",
    "padEnd",
    "normalize",
    "repeat",
    "replace",
    "replaceAll",
    "substring",
    "substr",
    "charAt",
    "join",
    "toFixed",
    "toExponential",
    "toPrecision",
    "toJSON",
];
const STRING_PROPERTY_NAMES: &[&str] = &[
    "textContent",
    "innerText",
    "innerHTML",
    "outerHTML",
    "nodeValue",
    "nodeName",
    "localName",
    "namespaceURI",
    "baseURI",
    "documentURI",
    "tagName",
    "className",
    "id",
    "lang",
    "dir",
    "title",
    "alt",
    "type",
    "name",
    "placeholder",
    "href",
    "src",
    "value",
    "accessKey",
    "contentEditable",
    "hash",
    "host",
    "hostname",
    "pathname",
    "port",
    "protocol",
    "search",
    "origin",
    "username",
    "password",
    "characterSet",
    "contentType",
    "charset",
    "mimeType",
    "mediaType",
    "cssText",
    "text",
    "body",
    "content",
    "message",
    "stack",
    "fileName",
    "code",
    "label",
    "slug",
    "prefix",
    "__html",
];
const STRING_IDENTIFIER_NAMES: &[&str] = &[
    "text",
    "string",
    "str",
    "content",
    "contents",
    "html",
    "xml",
    "json",
    "css",
    "yaml",
    "markdown",
    "md",
    "source",
    "sourceCode",
    "template",
    "raw",
    "comment",
    "description",
    "desc",
    "summary",
    "snippet",
    "url",
    "uri",
    "path",
    "filename",
    "filepath",
    "fileName",
    "filePath",
    "line",
    "char",
    "character",
    "letter",
    "word",
    "phrase",
    "sentence",
    "paragraph",
    "query",
    "search",
    "pathname",
    "href",
    "hash",
    "haystack",
    "needle",
    "key",
    "suffix",
    "prefix",
    "extension",
    "ext",
    "tableSuffix",
    "tablePrefix",
    "filenameSuffix",
    "filenamePrefix",
    "moduleSuffix",
    "modulePrefix",
    "declaration",
    "expression",
    "statement",
    "literal",
    "alias",
    "title",
];
const STRING_IDENTIFIER_SUFFIXES: &[&str] = &[
    "Text",
    "Path",
    "Url",
    "Uri",
    "Href",
    "Pattern",
    "Suffix",
    "Prefix",
    "String",
    "Source",
    "Locale",
    "Codepoint",
    "Char",
    "Word",
    "Markdown",
    "HTML",
    "Html",
    "Css",
    "Xml",
    "Json",
    "Yaml",
    "Sql",
    "Query",
    "Line",
    "Filename",
    "Filepath",
    "Message",
];

#[derive(Debug, Default, Clone)]
pub struct JsSetMapLookups;

declare_oxc_lint!(
    /// Prefer Set or Map for repeated array membership lookups.
    JsSetMapLookups,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Array lookup inside a loop.",
);

impl Rule for JsSetMapLookups {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return;
        };
        let Some(method_name) = member_expression_identifier_property_name(member) else {
            return;
        };
        if !matches!(method_name, "includes" | "indexOf")
            || !is_inside_lookup_loop(node, ctx)
            || method_name == "includes" && !includes_arguments_preserve_semantics(call, ctx)
            || method_name == "indexOf" && !index_of_is_membership_test(call, node, ctx)
        {
            return;
        }
        let receiver = member.object().get_inner_expression();
        let query = call.arguments.first().and_then(Argument::as_expression);
        let is_known_native_array = is_known_native_array_receiver(receiver, ctx);
        if is_known_userland_membership_receiver(receiver, method_name, ctx)
            || method_name == "includes" && call.arguments.len() == 2 && !is_known_native_array
            || method_name == "indexOf"
                && index_of_replacement_can_change_semantics(query, receiver, node, ctx)
            || is_likely_string_receiver(receiver, ctx)
            || is_fresh_array_receiver(receiver, ctx)
            || is_small_inline_literal_array(receiver, ctx)
            || is_screaming_snake_case_receiver(receiver)
            || is_small_fixed_list_member(receiver)
            || query.is_some_and(is_substring_search_literal)
            || is_indexed_string_array_element(receiver, query)
            || is_string_element_of_split_iteration(receiver, ctx)
            || receiver_is_declared_in_nearest_loop(receiver, node, ctx)
            || is_per_iteration_receiver(receiver, node, ctx)
            || is_lookup_bounded_by_constant_iteration(node, ctx)
            || is_typescript_rest_helper_lookup(call, receiver, ctx)
            || is_split_named_call(receiver)
        {
            return;
        }
        if let Some((initializer, is_default)) = resolved_initializer(receiver, ctx) {
            if is_likely_string_receiver(initializer, ctx)
                || !is_default && is_small_inline_literal_array(initializer, ctx)
            {
                return;
            }
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This scales poorly because `array.{method_name}()` inside a loop scans the whole list every time. Use a Set for constant-time lookups."
            ))
            .with_label(call.span),
        );
    }
}

fn is_iteration_callback_call(call: &CallExpression<'_>) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member_expression_identifier_property_name(member)
        .is_some_and(|name| ITERATION_CALLBACK_METHOD_NAMES.contains(&name))
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|callback| {
                matches!(
                    callback.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
}

fn is_inside_lookup_loop<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::DoWhileStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::WhileStatement(_)
        ) || matches!(ancestor.kind(), AstKind::CallExpression(call) if is_iteration_callback_call(call))
    })
}

fn includes_arguments_preserve_semantics<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match call.arguments.as_slice() {
        [argument] => argument.as_expression().is_some(),
        [query, from_index] if query.as_expression().is_some() => from_index
            .as_expression()
            .is_some_and(|expression| is_zero_from_index(expression, ctx)),
        _ => false,
    }
}

fn is_zero_from_index<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(number) => number.value.is_nan() || number.value.trunc() == 0.0,
        Expression::StringLiteral(string) => {
            string_to_integer_or_infinity_is_zero(string.value.as_str())
        }
        Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(boolean) => !boolean.value,
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => true,
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(number) if number.value.trunc() == 0.0)
        }
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "undefined" | "NaN") =>
        {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
        }
        Expression::StaticMemberExpression(member)
            if member.property.name == "NaN"
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Number" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()) =>
        {
            true
        }
        _ => false,
    }
}

fn string_to_integer_or_infinity_is_zero(value: &str) -> bool {
    let value = value.trim_matches(is_javascript_whitespace);
    if value.is_empty() {
        return true;
    }
    if matches!(value, "Infinity" | "+Infinity" | "-Infinity") {
        return false;
    }
    let lowercase = value.to_ascii_lowercase();
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if let Some(digits) = lowercase.strip_prefix(prefix) {
            return digits.is_empty()
                || !digits.chars().all(|character| character.is_digit(radix))
                || digits.chars().all(|character| character == '0');
        }
    }
    if !is_javascript_decimal_number(value) {
        return true;
    }
    value
        .parse::<f64>()
        .map_or(true, |number| number.is_nan() || number.trunc() == 0.0)
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn is_javascript_decimal_number(value: &str) -> bool {
    let unsigned_value = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .filter(|unsigned| !unsigned.is_empty())
        .unwrap_or(value);
    let mut exponent_parts = unsigned_value.split(['e', 'E']);
    let mantissa = exponent_parts.next().unwrap_or_default();
    let exponent = exponent_parts.next();
    if exponent_parts.next().is_some()
        || exponent.is_some_and(|exponent| {
            let digits = exponent
                .strip_prefix('+')
                .or_else(|| exponent.strip_prefix('-'))
                .filter(|digits| !digits.is_empty())
                .unwrap_or(exponent);
            digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return false;
    }
    let mut decimal_parts = mantissa.split('.');
    let integer_digits = decimal_parts.next().unwrap_or_default();
    let fraction_digits = decimal_parts.next();
    if decimal_parts.next().is_some()
        || !integer_digits.bytes().all(|byte| byte.is_ascii_digit())
        || fraction_digits.is_some_and(|digits| !digits.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    !integer_digits.is_empty() || fraction_digits.is_some_and(|digits| !digits.is_empty())
}

fn index_of_is_membership_test<'a>(
    call: &CallExpression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if call.arguments.len() != 1
        || call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_none()
    {
        return false;
    }
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSNonNullExpression(_) => current = parent,
            AstKind::UnaryExpression(unary) => return unary.operator == UnaryOperator::BitwiseNot,
            AstKind::BinaryExpression(binary) => {
                let other = if binary.left.span() == current.span() {
                    &binary.right
                } else if binary.right.span() == current.span() {
                    &binary.left
                } else {
                    return false;
                };
                return is_negative_one(other)
                    && matches!(
                        binary.operator,
                        BinaryOperator::StrictEquality
                            | BinaryOperator::StrictInequality
                            | BinaryOperator::Equality
                            | BinaryOperator::Inequality
                            | BinaryOperator::GreaterThan
                            | BinaryOperator::GreaterEqualThan
                            | BinaryOperator::LessThan
                            | BinaryOperator::LessEqualThan
                    )
                    || is_zero_literal(other)
                        && matches!(
                            binary.operator,
                            BinaryOperator::GreaterEqualThan | BinaryOperator::LessThan
                        );
            }
            _ => return false,
        }
    }
}

fn is_negative_one(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::UnaryNegation
                && matches!(unary.argument.get_inner_expression(), Expression::NumericLiteral(number) if number.value == 1.0)
    )
}

fn is_zero_literal(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NumericLiteral(number) if number.value == 0.0)
}

fn is_likely_string_receiver<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => true,
        Expression::Identifier(identifier) => {
            let name = identifier.name.as_str();
            is_declared_string(identifier, ctx)
                || STRING_IDENTIFIER_NAMES.contains(&name)
                || STRING_IDENTIFIER_SUFFIXES
                    .iter()
                    .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
        }
        Expression::CallExpression(call) => is_likely_string_call(call, ctx),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => is_likely_string_call(call, ctx),
            ChainElement::TSNonNullExpression(non_null) => {
                is_likely_string_receiver(&non_null.expression, ctx)
            }
            chain_element => chain_element
                .as_member_expression()
                .is_some_and(is_likely_string_member),
        },
        Expression::ConditionalExpression(conditional) => {
            is_likely_string_receiver(&conditional.consequent, ctx)
                && is_likely_string_receiver(&conditional.alternate, ctx)
        }
        Expression::LogicalExpression(logical) => {
            is_likely_string_receiver(&logical.left, ctx)
                && is_likely_string_receiver(&logical.right, ctx)
        }
        expression => {
            expression
                .as_member_expression()
                .is_some_and(is_likely_string_member)
                || matches!(expression, Expression::BinaryExpression(binary) if binary.operator == BinaryOperator::Addition && (is_likely_string_receiver(&binary.left, ctx) || is_likely_string_receiver(&binary.right, ctx)))
        }
    }
}

fn is_likely_string_call<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "String"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
                || matches!(identifier.name.as_str(), name if name.starts_with("normalize") || name.starts_with("format") || name.starts_with("stringify") || name.starts_with("serialize"))
        }
        callee => callee.as_member_expression().is_some_and(|member| {
            member_expression_identifier_property_name(member).is_some_and(|name| {
                STRING_RETURNING_METHOD_NAMES.contains(&name)
                    || matches!(name, "concat" | "slice")
                        && is_likely_string_receiver(member.object(), ctx)
            })
        }),
    }
}

fn is_likely_string_member(member: &MemberExpression<'_>) -> bool {
    member_expression_identifier_property_name(member).is_some_and(|name| {
        STRING_PROPERTY_NAMES.contains(&name)
            || STRING_IDENTIFIER_SUFFIXES
                .iter()
                .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
    }) || matches!(member, MemberExpression::ComputedMemberExpression(_))
        && member_array_name(member).is_some_and(is_string_array_name)
}

fn member_array_name<'a>(member: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member.object().get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    }
}

fn is_string_array_name(name: &str) -> bool {
    matches!(
        name,
        "lines" | "words" | "chars" | "segments" | "parts" | "tokens"
    ) || ["Lines", "Words", "Chars", "Segments", "Parts", "Split"]
        .iter()
        .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
}

fn is_fresh_array_receiver<'a>(expression: &'a Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Some(method_name) = member_expression_identifier_property_name(member) else {
        return false;
    };
    match method_name {
        "split" => is_likely_string_receiver(member.object(), ctx),
        "slice" => true,
        "concat" | "filter" | "flat" | "flatMap" | "map" => {
            is_known_native_array_receiver(member.object(), ctx)
                || is_fresh_array_receiver(member.object(), ctx)
        }
        _ => false,
    }
}

fn is_small_inline_literal_array<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression {
        if let Some(member) = call.callee.as_member_expression() {
            let method_name = member_expression_identifier_property_name(member);
            if method_name == Some("flat") {
                return is_small_inline_literal_array(member.object(), ctx);
            }
            if method_name == Some("freeze")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
            {
                return call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| is_small_inline_literal_array(argument, ctx));
            }
        }
    }
    let Expression::ArrayExpression(array) = expression else {
        return false;
    };
    !array.elements.is_empty()
        && array.elements.len() <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS
        && array
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_)))
}

fn is_screaming_snake_case_receiver(expression: &Expression<'_>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let name = identifier.name.as_str();
    name.len() > 1
        && name.starts_with(|character: char| character.is_ascii_uppercase())
        && name.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}

fn is_small_fixed_list_member(expression: &Expression<'_>) -> bool {
    expression
        .get_inner_expression()
        .as_member_expression()
        .and_then(member_expression_identifier_property_name)
        == Some("enum")
}

fn is_substring_search_literal(expression: &Expression<'_>) -> bool {
    let text = match expression.get_inner_expression() {
        Expression::StringLiteral(string) => string.value.as_str(),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map_or("", |value| value.as_str()),
        Expression::TemplateLiteral(template) => {
            return template.quasis.iter().any(|quasi| {
                quasi.value.cooked.as_ref().is_some_and(|value| {
                    value.chars().any(|character| {
                        !character.is_alphanumeric() && character != '_' && character != '-'
                    })
                })
            });
        }
        _ => return false,
    };
    text.encode_utf16().count() == 1
        || !text.is_empty()
            && text.chars().any(|character| {
                !character.is_alphanumeric() && character != '_' && character != '-'
            })
}

fn is_indexed_string_array_element(
    receiver: &Expression<'_>,
    query: Option<&Expression<'_>>,
) -> bool {
    let Some(member) = receiver.get_inner_expression().as_member_expression() else {
        return false;
    };
    let MemberExpression::ComputedMemberExpression(computed) = member else {
        return false;
    };
    let index_like = matches!(&computed.expression, Expression::NumericLiteral(_))
        || matches!(&computed.expression, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "i" | "j" | "k" | "idx" | "index" | "cursor" | "position" | "pos" | "lineNumber" | "lineIndex" | "ln" | "row" | "col" | "column"));
    index_like
        && query.is_some_and(|query| {
            matches!(
                query.get_inner_expression(),
                Expression::StringLiteral(_) | Expression::TemplateLiteral(_)
            )
        })
}

fn is_split_named_call(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::CallExpression(call)
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name.starts_with("split"))
    )
}

fn resolved_initializer<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a Expression<'a>, bool)> {
    let (initializer, is_default) = resolved_initializer_direct(expression, ctx)?;
    if matches!(
        initializer.get_inner_expression(),
        Expression::Identifier(_)
    ) && let Some((aliased, aliased_default)) = resolved_initializer_direct(initializer, ctx)
    {
        return Some((aliased, is_default || aliased_default));
    }
    Some((initializer, is_default))
}

fn resolved_initializer_direct<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a Expression<'a>, bool)> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let (initializer, is_default) = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => (
            binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            )?,
            binding_pattern_has_assignment_for_symbol(&declarator.id, symbol_id),
        ),
        AstKind::FormalParameter(parameter) => (
            binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)?,
            true,
        ),
        _ => return None,
    };
    Some((initializer, is_default))
}

fn binding_pattern_has_assignment_for_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::AssignmentPattern(assignment) => {
            binding_pattern_has_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .any(|property| binding_pattern_has_assignment_for_symbol(&property.value, symbol_id)),
        BindingPattern::ArrayPattern(pattern) => pattern
            .elements
            .iter()
            .flatten()
            .any(|element| binding_pattern_has_assignment_for_symbol(element, symbol_id)),
        BindingPattern::BindingIdentifier(_) => false,
    }
}

fn is_known_native_array_receiver<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::ArrayExpression(_)) {
        return true;
    }
    if let Expression::Identifier(identifier) = expression {
        if identifier_type(identifier, ctx).is_some_and(|resolved| {
            resolved_type_is_array(
                resolved,
                identifier.node_id.get(),
                &[],
                &mut FxHashSet::default(),
                ctx,
            )
        }) {
            return true;
        }
    }
    let Some((initializer, _)) = resolved_initializer(expression, ctx) else {
        return false;
    };
    match initializer.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::NewExpression(new_expression) => matches!(
            new_expression.callee.get_inner_expression(),
            Expression::Identifier(identifier)
                if identifier.name == "Array"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        ),
        Expression::CallExpression(call) => call.callee.as_member_expression().is_some_and(|member| {
            matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                && matches!(member_expression_identifier_property_name(member), Some("from" | "of"))
        }),
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum ResolvedLookupType<'a> {
    Type(&'a TSType<'a>),
    Interface(&'a oxc_ast::ast::TSInterfaceDeclaration<'a>),
    Alias(&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>),
}

fn identifier_type<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<ResolvedLookupType<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            let direct_type = declarator
                .id
                .get_binding_identifier()
                .filter(|identifier| identifier.symbol_id() == symbol_id)
                .and_then(|_| declarator.type_annotation.as_ref())
                .map(|annotation| ResolvedLookupType::Type(&annotation.type_annotation));
            let asserted_type = declarator
                .id
                .get_binding_identifier()
                .filter(|identifier| identifier.symbol_id() == symbol_id)
                .and_then(|_| declarator.init.as_ref())
                .and_then(expression_asserted_type)
                .map(ResolvedLookupType::Type);
            let destructured_type = match &declarator.id {
                BindingPattern::ObjectPattern(pattern) => pattern
                    .properties
                    .iter()
                    .find_map(|property| {
                        matches!(&property.value, BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id)
                            .then(|| property_key_identifier_name(&property.key))
                            .flatten()
                    })
                    .and_then(|property_name| {
                        property_type(
                            ResolvedLookupType::Type(
                                &declarator.type_annotation.as_ref()?.type_annotation,
                            ),
                            property_name,
                            ctx,
                        )
                    }),
                _ => None,
            };
            direct_type
                .or(asserted_type)
                .or(destructured_type)
                .or_else(|| for_of_binding_element_type(declaration.id(), symbol_id, ctx))
        }
        AstKind::FormalParameter(parameter) => {
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
            {
                return parameter
                    .type_annotation
                    .as_ref()
                    .map(|annotation| ResolvedLookupType::Type(&annotation.type_annotation));
            }
            let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                return None;
            };
            let property_name = pattern.properties.iter().find_map(|property| {
                matches!(&property.value, BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id)
                    .then(|| property_key_identifier_name(&property.key))
                    .flatten()
            })?;
            property_type(
                ResolvedLookupType::Type(&parameter.type_annotation.as_ref()?.type_annotation),
                property_name.as_ref(),
                ctx,
            )
        }
        _ => None,
    }
}

fn for_of_binding_element_type<'a>(
    declaration_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<ResolvedLookupType<'a>> {
    let declaration = ctx.nodes().parent_node(declaration_id);
    let loop_node = ctx.nodes().parent_node(declaration.id());
    let AstKind::ForOfStatement(statement) = loop_node.kind() else {
        return None;
    };
    let oxc_ast::ast::ForStatementLeft::VariableDeclaration(variable_declaration) = &statement.left
    else {
        return None;
    };
    if !variable_declaration
        .declarations
        .iter()
        .any(|declarator| binding_pattern_has_symbol(&declarator.id, symbol_id))
    {
        return None;
    }
    let Expression::Identifier(collection) = statement.right.get_inner_expression() else {
        return None;
    };
    let collection_type = identifier_type(collection, ctx)?;
    resolved_array_element_type(collection_type, 0, ctx).map(ResolvedLookupType::Type)
}

fn resolved_array_element_type<'a>(
    resolved: ResolvedLookupType<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<&'a TSType<'a>> {
    if depth > 8 {
        return None;
    }
    match resolved {
        ResolvedLookupType::Alias(alias) => resolved_array_element_type(
            ResolvedLookupType::Type(&alias.type_annotation),
            depth + 1,
            ctx,
        ),
        ResolvedLookupType::Interface(_) => None,
        ResolvedLookupType::Type(TSType::TSArrayType(array)) => Some(&array.element_type),
        ResolvedLookupType::Type(TSType::TSTypeOperatorType(operator)) => {
            resolved_array_element_type(
                ResolvedLookupType::Type(&operator.type_annotation),
                depth + 1,
                ctx,
            )
        }
        ResolvedLookupType::Type(TSType::TSTypeReference(reference)) => {
            let name = type_reference_name(&reference.type_name)?;
            if matches!(name, "Array" | "ReadonlyArray") {
                return reference
                    .type_arguments
                    .as_ref()
                    .and_then(|arguments| arguments.params.first());
            }
            same_file_types(name, ctx)
                .iter()
                .copied()
                .find_map(|resolved| resolved_array_element_type(resolved, depth + 1, ctx))
        }
        ResolvedLookupType::Type(TSType::TSUnionType(union)) => {
            let mut element_type = None;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                ) {
                    continue;
                }
                let member_element =
                    resolved_array_element_type(ResolvedLookupType::Type(member), depth + 1, ctx)?;
                if element_type.is_some() {
                    return None;
                }
                element_type = Some(member_element);
            }
            element_type
        }
        _ => None,
    }
}

fn expression_asserted_type<'a>(expression: &'a Expression<'a>) -> Option<&'a TSType<'a>> {
    match expression {
        Expression::TSAsExpression(assertion) => Some(&assertion.type_annotation),
        Expression::TSTypeAssertion(assertion) => Some(&assertion.type_annotation),
        Expression::TSSatisfiesExpression(assertion) => Some(&assertion.type_annotation),
        _ => None,
    }
}

fn same_file_types<'a>(name: &str, ctx: &LintContext<'a>) -> Vec<ResolvedLookupType<'a>> {
    ctx.nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::TSInterfaceDeclaration(interface)
                if interface.id.name == name && is_program_owned_declaration(node.id(), ctx) =>
            {
                Some(ResolvedLookupType::Interface(interface))
            }
            AstKind::TSTypeAliasDeclaration(alias)
                if alias.id.name == name && is_program_owned_declaration(node.id(), ctx) =>
            {
                Some(ResolvedLookupType::Alias(alias))
            }
            _ => None,
        })
        .collect()
}

fn is_program_owned_declaration<'a>(node_id: NodeId, ctx: &LintContext<'a>) -> bool {
    let parent = ctx.nodes().parent_node(node_id);
    matches!(parent.kind(), AstKind::Program(_))
        || matches!(parent.kind(), AstKind::ExportNamedDeclaration(_))
            && matches!(
                ctx.nodes().parent_node(parent.id()).kind(),
                AstKind::Program(_)
            )
}

fn type_reference_name<'a>(type_name: &'a TSTypeName<'a>) -> Option<&'a str> {
    let TSTypeName::IdentifierReference(identifier) = type_name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn resolved_type_is_array<'a>(
    resolved: ResolvedLookupType<'a>,
    reference_node_id: NodeId,
    type_arguments: &[(String, &'a TSType<'a>)],
    active_type_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    match resolved {
        ResolvedLookupType::Alias(alias) => resolved_type_is_array(
            ResolvedLookupType::Type(&alias.type_annotation),
            reference_node_id,
            type_arguments,
            active_type_names,
            ctx,
        ),
        ResolvedLookupType::Interface(_) => false,
        ResolvedLookupType::Type(type_node) => match type_node {
            TSType::TSArrayType(_) | TSType::TSTupleType(_) => true,
            TSType::TSTypeOperatorType(operator) => resolved_type_is_array(
                ResolvedLookupType::Type(&operator.type_annotation),
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            ),
            TSType::TSUnionType(union) => {
                let mut saw_non_nullish_type = false;
                let are_all_non_nullish_types_arrays = union
                    .types
                    .iter()
                    .filter(|member| {
                        !matches!(
                            member,
                            TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                        )
                    })
                    .all(|member| {
                        saw_non_nullish_type = true;
                        resolved_type_is_array(
                            ResolvedLookupType::Type(member),
                            reference_node_id,
                            type_arguments,
                            active_type_names,
                            ctx,
                        )
                    });
                saw_non_nullish_type && are_all_non_nullish_types_arrays
            }
            TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
                resolved_type_is_array(
                    ResolvedLookupType::Type(member),
                    reference_node_id,
                    type_arguments,
                    active_type_names,
                    ctx,
                )
            }),
            TSType::TSTypeReference(reference) => {
                let Some(name) = type_reference_name(&reference.type_name) else {
                    return false;
                };
                if let Some((_, substituted)) = type_arguments
                    .iter()
                    .rev()
                    .find(|(parameter, _)| parameter == name)
                {
                    let remaining_arguments = type_arguments
                        .iter()
                        .filter(|(parameter, _)| parameter != name)
                        .map(|(parameter, argument)| (parameter.clone(), *argument))
                        .collect::<Vec<_>>();
                    return resolved_type_is_array(
                        ResolvedLookupType::Type(substituted),
                        reference_node_id,
                        &remaining_arguments,
                        active_type_names,
                        ctx,
                    );
                }
                if matches!(name, "Array" | "ReadonlyArray") {
                    return true;
                }
                if let Some(type_parameter) =
                    nearest_enclosing_type_parameter(reference_node_id, name, ctx)
                {
                    let Some(constraint) = &type_parameter.constraint else {
                        return false;
                    };
                    let active_key = format!("type-parameter:{}", type_parameter.span.start);
                    if !active_type_names.insert(active_key.clone()) {
                        return false;
                    }
                    let is_array = resolved_type_is_array(
                        ResolvedLookupType::Type(constraint),
                        reference_node_id,
                        type_arguments,
                        active_type_names,
                        ctx,
                    );
                    active_type_names.remove(&active_key);
                    return is_array;
                }
                let Some(alias) = same_file_type_alias(name, ctx) else {
                    return false;
                };
                if !active_type_names.insert(name.to_string()) {
                    return false;
                }
                let alias_arguments = build_alias_type_arguments(alias, reference, type_arguments);
                let is_array = resolved_type_is_array(
                    ResolvedLookupType::Type(&alias.type_annotation),
                    reference_node_id,
                    &alias_arguments,
                    active_type_names,
                    ctx,
                );
                active_type_names.remove(name);
                is_array
            }
            _ => false,
        },
    }
}

fn is_declared_string<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    identifier_type(identifier, ctx).is_some_and(resolved_type_is_string)
}

fn resolved_type_is_string(resolved: ResolvedLookupType<'_>) -> bool {
    match resolved {
        ResolvedLookupType::Alias(_) | ResolvedLookupType::Interface(_) => false,
        ResolvedLookupType::Type(type_node) => match type_node {
            TSType::TSStringKeyword(_) => true,
            TSType::TSLiteralType(literal) => {
                matches!(&literal.literal, oxc_ast::ast::TSLiteral::StringLiteral(_))
            }
            TSType::TSUnionType(union) => {
                !union.types.is_empty()
                    && union
                        .types
                        .iter()
                        .all(|member| resolved_type_is_string(ResolvedLookupType::Type(member)))
            }
            _ => false,
        },
    }
}

fn is_known_userland_membership_receiver<'a>(
    receiver: &Expression<'a>,
    method_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return false;
    };
    identifier_type(identifier, ctx).is_some_and(|resolved| {
        !resolved_type_is_array(
            resolved,
            identifier.node_id.get(),
            &[],
            &mut FxHashSet::default(),
            ctx,
        ) && resolved_type_declares_member(resolved, method_name, ctx)
    })
}

fn resolved_type_declares_member<'a>(
    resolved: ResolvedLookupType<'a>,
    member_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    match resolved {
        ResolvedLookupType::Alias(alias) => match &alias.type_annotation {
            TSType::TSTypeLiteral(literal) => members_declare_member(&literal.members, member_name),
            _ => false,
        },
        ResolvedLookupType::Interface(interface) => {
            members_declare_member(&interface.body.body, member_name)
        }
        ResolvedLookupType::Type(type_node) => match type_node {
            TSType::TSTypeLiteral(literal) => members_declare_member(&literal.members, member_name),
            TSType::TSTypeReference(reference) => type_reference_name(&reference.type_name)
                .is_some_and(|name| {
                    same_file_types(name, ctx)
                        .iter()
                        .copied()
                        .any(|resolved| match resolved {
                            ResolvedLookupType::Alias(alias) => match &alias.type_annotation {
                                TSType::TSTypeLiteral(literal) => {
                                    members_declare_member(&literal.members, member_name)
                                }
                                _ => false,
                            },
                            ResolvedLookupType::Interface(interface) => {
                                members_declare_member(&interface.body.body, member_name)
                            }
                            ResolvedLookupType::Type(_) => false,
                        })
                }),
            _ => false,
        },
    }
}

fn members_declare_member(members: &[TSSignature<'_>], member_name: &str) -> bool {
    members.iter().any(|member| match member {
        TSSignature::TSMethodSignature(method) => {
            property_key_identifier_name(&method.key) == Some(member_name)
        }
        TSSignature::TSPropertySignature(property) => {
            property_key_identifier_name(&property.key) == Some(member_name)
        }
        _ => false,
    })
}

fn property_type<'a>(
    resolved: ResolvedLookupType<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> Option<ResolvedLookupType<'a>> {
    match resolved {
        ResolvedLookupType::Alias(alias) => match &alias.type_annotation {
            TSType::TSTypeLiteral(literal) => {
                property_type_from_members(&literal.members, property_name)
                    .map(ResolvedLookupType::Type)
            }
            _ => None,
        },
        ResolvedLookupType::Interface(interface) => {
            property_type_from_members(&interface.body.body, property_name)
                .map(ResolvedLookupType::Type)
        }
        ResolvedLookupType::Type(TSType::TSTypeLiteral(literal)) => {
            property_type_from_members(&literal.members, property_name)
                .map(ResolvedLookupType::Type)
        }
        ResolvedLookupType::Type(TSType::TSTypeReference(reference)) => {
            same_file_types(type_reference_name(&reference.type_name)?, ctx)
                .iter()
                .copied()
                .find_map(|resolved| match resolved {
                    ResolvedLookupType::Alias(alias) => match &alias.type_annotation {
                        TSType::TSTypeLiteral(literal) => {
                            property_type_from_members(&literal.members, property_name)
                                .map(ResolvedLookupType::Type)
                        }
                        _ => None,
                    },
                    ResolvedLookupType::Interface(interface) => {
                        property_type_from_members(&interface.body.body, property_name)
                            .map(ResolvedLookupType::Type)
                    }
                    ResolvedLookupType::Type(_) => None,
                })
        }
        _ => None,
    }
}

fn property_type_from_members<'a>(
    members: &'a [TSSignature<'a>],
    property_name: &str,
) -> Option<&'a TSType<'a>> {
    members.iter().find_map(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return None;
        };
        (property_key_identifier_name(&property.key) == Some(property_name)).then(|| {
            property
                .type_annotation
                .as_ref()
                .map(|annotation| &annotation.type_annotation)
        })?
    })
}

fn index_of_replacement_can_change_semantics<'a>(
    query: Option<&Expression<'a>>,
    receiver: &'a Expression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(query) = query else {
        return true;
    };
    if is_known_safe_index_query(query, node, ctx) {
        return false;
    }
    if matches!(query.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    {
        if !is_known_dense_array(receiver, ctx) {
            return true;
        }
    }
    if query_can_be_nan(query, ctx) {
        return true;
    }
    receiver_array_can_contain_numbers(receiver, ctx)
}

fn query_can_be_nan<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if identifier.name == "NaN"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            identifier_type(identifier, ctx).is_some_and(|resolved| {
                resolved_type_can_have_same_value_zero_difference(
                    resolved,
                    identifier.node_id.get(),
                    ctx,
                )
            })
        }
        Expression::StaticMemberExpression(member) => {
            member.property.name == "NaN"
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Number" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        Expression::ComputedMemberExpression(member) => {
            member.static_property_name().as_deref() == Some("NaN")
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Number" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        _ => true,
    }
}

fn receiver_array_can_contain_numbers<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    identifier_type(identifier, ctx).is_some_and(|resolved| {
        resolved_array_can_have_same_value_zero_difference(resolved, identifier.node_id.get(), ctx)
    })
}

fn resolved_type_can_have_same_value_zero_difference<'a>(
    resolved: ResolvedLookupType<'a>,
    reference_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    match resolved {
        ResolvedLookupType::Type(type_node) => type_can_have_same_value_zero_difference(
            type_node,
            reference_node_id,
            &[],
            &mut FxHashSet::default(),
            ctx,
        ),
        ResolvedLookupType::Alias(alias) => type_can_have_same_value_zero_difference(
            &alias.type_annotation,
            reference_node_id,
            &[],
            &mut FxHashSet::default(),
            ctx,
        ),
        ResolvedLookupType::Interface(_) => false,
    }
}

fn resolved_array_can_have_same_value_zero_difference<'a>(
    resolved: ResolvedLookupType<'a>,
    reference_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    match resolved {
        ResolvedLookupType::Type(type_node) => array_type_can_have_same_value_zero_difference(
            type_node,
            reference_node_id,
            &[],
            &mut FxHashSet::default(),
            ctx,
        ),
        ResolvedLookupType::Alias(alias) => array_type_can_have_same_value_zero_difference(
            &alias.type_annotation,
            reference_node_id,
            &[],
            &mut FxHashSet::default(),
            ctx,
        ),
        ResolvedLookupType::Interface(_) => false,
    }
}

fn type_can_have_same_value_zero_difference<'a>(
    type_node: &'a TSType<'a>,
    reference_node_id: NodeId,
    type_arguments: &[(String, &'a TSType<'a>)],
    active_type_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    match type_node {
        TSType::TSNumberKeyword(_) | TSType::TSAnyKeyword(_) | TSType::TSUnknownKeyword(_) => true,
        TSType::TSStringKeyword(_)
        | TSType::TSBooleanKeyword(_)
        | TSType::TSBigIntKeyword(_)
        | TSType::TSSymbolKeyword(_)
        | TSType::TSNullKeyword(_)
        | TSType::TSUndefinedKeyword(_)
        | TSType::TSObjectKeyword(_)
        | TSType::TSLiteralType(_)
        | TSType::TSFunctionType(_) => false,
        TSType::TSTypeLiteral(literal) => literal.members.is_empty(),
        TSType::TSTypeOperatorType(operator) => {
            operator.operator != TSTypeOperatorOperator::Keyof
                && type_can_have_same_value_zero_difference(
                    &operator.type_annotation,
                    reference_node_id,
                    type_arguments,
                    active_type_names,
                    ctx,
                )
        }
        TSType::TSUnionType(union) => union.types.iter().any(|member| {
            type_can_have_same_value_zero_difference(
                member,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            )
        }),
        TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
            type_can_have_same_value_zero_difference(
                member,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            )
        }),
        TSType::TSTypeReference(reference) => {
            let Some(name) = type_reference_name(&reference.type_name) else {
                return false;
            };
            if let Some((_, substituted)) = type_arguments
                .iter()
                .rev()
                .find(|(parameter, _)| parameter == name)
            {
                let remaining_arguments = type_arguments
                    .iter()
                    .filter(|(parameter, _)| parameter != name)
                    .map(|(parameter, argument)| (parameter.clone(), *argument))
                    .collect::<Vec<_>>();
                return type_can_have_same_value_zero_difference(
                    substituted,
                    reference_node_id,
                    &remaining_arguments,
                    active_type_names,
                    ctx,
                );
            }
            if let Some(type_parameter) =
                nearest_enclosing_type_parameter(reference_node_id, name, ctx)
            {
                let Some(constraint) = &type_parameter.constraint else {
                    return true;
                };
                let active_key = format!("type-parameter:{}", type_parameter.span.start);
                if !active_type_names.insert(active_key.clone()) {
                    return true;
                }
                let can_differ = type_can_have_same_value_zero_difference(
                    constraint,
                    reference_node_id,
                    type_arguments,
                    active_type_names,
                    ctx,
                );
                active_type_names.remove(&active_key);
                return can_differ;
            }
            let Some(alias) = same_file_type_alias(name, ctx) else {
                return matches!(name, "NonNullable" | "PropertyKey")
                    || name.to_ascii_lowercase().contains("number")
                    || name.to_ascii_lowercase().contains("numeric");
            };
            if !active_type_names.insert(name.to_string()) {
                return true;
            }
            let alias_arguments = build_alias_type_arguments(alias, reference, type_arguments);
            let can_differ = type_can_have_same_value_zero_difference(
                &alias.type_annotation,
                reference_node_id,
                &alias_arguments,
                active_type_names,
                ctx,
            );
            active_type_names.remove(name);
            can_differ
        }
        _ => true,
    }
}

fn array_type_can_have_same_value_zero_difference<'a>(
    type_node: &'a TSType<'a>,
    reference_node_id: NodeId,
    type_arguments: &[(String, &'a TSType<'a>)],
    active_type_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    match type_node {
        TSType::TSArrayType(array) => type_can_have_same_value_zero_difference(
            &array.element_type,
            reference_node_id,
            type_arguments,
            active_type_names,
            ctx,
        ),
        TSType::TSTupleType(tuple) => tuple.element_types.iter().any(|element| {
            tuple_element_can_have_same_value_zero_difference(
                element,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            )
        }),
        TSType::TSTypeOperatorType(operator) => array_type_can_have_same_value_zero_difference(
            &operator.type_annotation,
            reference_node_id,
            type_arguments,
            active_type_names,
            ctx,
        ),
        TSType::TSUnionType(union) => union.types.iter().any(|member| {
            array_type_can_have_same_value_zero_difference(
                member,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            )
        }),
        TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
            array_type_can_have_same_value_zero_difference(
                member,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            )
        }),
        TSType::TSTypeReference(reference) => {
            let Some(name) = type_reference_name(&reference.type_name) else {
                return false;
            };
            if let Some((_, substituted)) = type_arguments
                .iter()
                .rev()
                .find(|(parameter, _)| parameter == name)
            {
                let remaining_arguments = type_arguments
                    .iter()
                    .filter(|(parameter, _)| parameter != name)
                    .map(|(parameter, argument)| (parameter.clone(), *argument))
                    .collect::<Vec<_>>();
                return array_type_can_have_same_value_zero_difference(
                    substituted,
                    reference_node_id,
                    &remaining_arguments,
                    active_type_names,
                    ctx,
                );
            }
            if matches!(name, "Array" | "ReadonlyArray") {
                return reference
                    .type_arguments
                    .as_ref()
                    .and_then(|arguments| arguments.params.first())
                    .is_some_and(|element| {
                        type_can_have_same_value_zero_difference(
                            element,
                            reference_node_id,
                            type_arguments,
                            active_type_names,
                            ctx,
                        )
                    });
            }
            let Some(alias) = same_file_type_alias(name, ctx) else {
                return false;
            };
            if !active_type_names.insert(name.to_string()) {
                return false;
            }
            let alias_arguments = build_alias_type_arguments(alias, reference, type_arguments);
            let can_differ = array_type_can_have_same_value_zero_difference(
                &alias.type_annotation,
                reference_node_id,
                &alias_arguments,
                active_type_names,
                ctx,
            );
            active_type_names.remove(name);
            can_differ
        }
        _ => false,
    }
}

fn same_file_type_alias<'a>(
    name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>> {
    ctx.nodes().iter().find_map(|node| match node.kind() {
        AstKind::TSTypeAliasDeclaration(alias)
            if alias.id.name == name && is_program_owned_declaration(node.id(), ctx) =>
        {
            Some(alias)
        }
        _ => None,
    })
}

fn build_alias_type_arguments<'a>(
    alias: &'a oxc_ast::ast::TSTypeAliasDeclaration<'a>,
    reference: &'a oxc_ast::ast::TSTypeReference<'a>,
    inherited: &[(String, &'a TSType<'a>)],
) -> Vec<(String, &'a TSType<'a>)> {
    let mut arguments = inherited.to_vec();
    let Some(parameters) = &alias.type_parameters else {
        return arguments;
    };
    for (index, parameter) in parameters.params.iter().enumerate() {
        let argument = reference
            .type_arguments
            .as_ref()
            .and_then(|reference_arguments| reference_arguments.params.get(index))
            .or(parameter.default.as_ref());
        if let Some(argument) = argument {
            arguments.push((parameter.name.name.to_string(), argument));
        }
    }
    arguments
}

fn tuple_element_can_have_same_value_zero_difference<'a>(
    element: &'a TSTupleElement<'a>,
    reference_node_id: NodeId,
    type_arguments: &[(String, &'a TSType<'a>)],
    active_type_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    match element {
        TSTupleElement::TSOptionalType(optional) => type_can_have_same_value_zero_difference(
            &optional.type_annotation,
            reference_node_id,
            type_arguments,
            active_type_names,
            ctx,
        ),
        TSTupleElement::TSRestType(rest) => array_type_can_have_same_value_zero_difference(
            &rest.type_annotation,
            reference_node_id,
            type_arguments,
            active_type_names,
            ctx,
        ),
        element if element.is_ts_type() => match element.to_ts_type() {
            TSType::TSNamedTupleMember(member) => {
                tuple_element_can_have_same_value_zero_difference(
                    &member.element_type,
                    reference_node_id,
                    type_arguments,
                    active_type_names,
                    ctx,
                )
            }
            type_node => type_can_have_same_value_zero_difference(
                type_node,
                reference_node_id,
                type_arguments,
                active_type_names,
                ctx,
            ),
        },
        _ => false,
    }
}

fn nearest_enclosing_type_parameter<'a>(
    reference_node_id: NodeId,
    name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'a TSTypeParameter<'a>> {
    for ancestor in ctx.nodes().ancestors(reference_node_id).skip(1) {
        let type_parameters = match ancestor.kind() {
            AstKind::Function(function) => function.type_parameters.as_ref(),
            AstKind::ArrowFunctionExpression(function) => function.type_parameters.as_ref(),
            AstKind::Class(class) => class.type_parameters.as_ref(),
            _ => None,
        };
        if let Some(type_parameter) = type_parameters.and_then(|parameters| {
            parameters
                .params
                .iter()
                .find(|parameter| parameter.name.name == name)
        }) {
            return Some(type_parameter);
        }
    }
    None
}

fn is_known_safe_index_query<'a>(
    expression: &Expression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::NumericLiteral(number) => number.value.is_finite(),
        Expression::Identifier(identifier) => {
            is_native_iteration_index(identifier, node, ctx)
                || relational_loop_guard_proves_finite(identifier, node, ctx)
        }
        _ => false,
    }
}

fn is_native_iteration_index<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        let parameters = match ancestor.kind() {
            AstKind::Function(function) => &function.params,
            AstKind::ArrowFunctionExpression(function) => &function.params,
            _ => continue,
        };
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if !is_iteration_callback_call(call) {
            return false;
        }
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        let index = if matches!(
            member_expression_identifier_property_name(member),
            Some("reduce" | "reduceRight")
        ) {
            2
        } else {
            1
        };
        return parameters
            .items
            .get(index)
            .is_some_and(|parameter| binding_pattern_has_symbol(&parameter.pattern, symbol_id));
    }
    false
}

fn relational_loop_guard_proves_finite<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let mut descendant = node;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let (test, body) = match ancestor.kind() {
            AstKind::ForStatement(statement) => (statement.test.as_ref(), &statement.body),
            AstKind::WhileStatement(statement) => (Some(&statement.test), &statement.body),
            _ => {
                descendant = ancestor;
                continue;
            }
        };
        if body.span() == descendant.span()
            && test.is_some_and(|test| expression_has_relational_read(test, symbol_id, ctx))
        {
            return !ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    reference.is_write()
                        && reference_node.span().start < identifier.span.start
                        && body.span().contains_inclusive(reference_node.span())
                        && !ctx
                            .nodes()
                            .ancestors(reference_node.id())
                            .take_while(|candidate| candidate.id() != ancestor.id())
                            .any(|candidate| {
                                matches!(
                                    candidate.kind(),
                                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                                )
                            })
                });
        }
        descendant = ancestor;
    }
    false
}

fn expression_has_relational_read<'a>(
    expression: &Expression<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            expression_has_relational_read(&logical.left, symbol_id, ctx)
                || expression_has_relational_read(&logical.right, symbol_id, ctx)
        }
        Expression::BinaryExpression(binary)
            if matches!(binary.operator, BinaryOperator::LessThan | BinaryOperator::LessEqualThan | BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan) =>
        {
            [&binary.left, &binary.right].iter().any(|operand| matches!(operand.get_inner_expression(), Expression::Identifier(identifier) if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id)))
        }
        _ => false,
    }
}

fn is_known_dense_array<'a>(expression: &'a Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = resolved_initializer(expression, ctx)
        .map_or(expression, |(initializer, _)| initializer)
        .get_inner_expression();
    match expression {
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| element.as_expression().is_some()),
        Expression::CallExpression(call) => call.callee.as_member_expression().is_some_and(|member| {
            matches!(member_expression_identifier_property_name(member), Some("from" | "of"))
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "Array"
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }),
        _ => false,
    }
}

fn collect_receiver_dependency_names(expression: &Expression<'_>, names: &mut FxHashSet<String>) {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            names.insert(identifier.name.to_string());
        }
        Expression::CallExpression(call) => collect_receiver_dependency_names(&call.callee, names),
        expression => {
            if let Some(member) = expression.as_member_expression() {
                collect_receiver_dependency_names(member.object(), names);
                if let MemberExpression::ComputedMemberExpression(computed) = member {
                    collect_receiver_dependency_names(&computed.expression, names);
                }
            }
        }
    }
}

fn enclosing_iteration_names<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> FxHashSet<String> {
    let mut names = FxHashSet::default();
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::ForStatement(statement) => {
                if let Some(oxc_ast::ast::ForStatementInit::VariableDeclaration(declaration)) =
                    &statement.init
                {
                    for declarator in &declaration.declarations {
                        collect_binding_pattern_names(&declarator.id, &mut names);
                    }
                }
            }
            AstKind::ForOfStatement(statement) => {
                collect_for_statement_left_names(&statement.left, &mut names, ctx);
            }
            AstKind::ForInStatement(statement) => {
                collect_for_statement_left_names(&statement.left, &mut names, ctx);
            }
            AstKind::CallExpression(call) if is_iteration_callback_call(call) => {
                if let Some(callback) = call.arguments.first().and_then(Argument::as_expression) {
                    let parameters = match callback.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => &function.params,
                        Expression::FunctionExpression(function) => &function.params,
                        _ => continue,
                    };
                    for parameter in &parameters.items {
                        collect_binding_pattern_names(&parameter.pattern, &mut names);
                    }
                }
            }
            _ => {}
        }
    }
    names
}

fn collect_for_statement_left_names<'a>(
    left: &oxc_ast::ast::ForStatementLeft<'a>,
    names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) {
    match left {
        oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                collect_binding_pattern_names(&declarator.id, names);
            }
        }
        oxc_ast::ast::ForStatementLeft::AssignmentTargetIdentifier(identifier) => {
            names.insert(identifier.name.to_string());
        }
        oxc_ast::ast::ForStatementLeft::ArrayAssignmentTarget(target) => {
            collect_assignment_pattern_reference_names(target.span(), names, ctx);
        }
        oxc_ast::ast::ForStatementLeft::ObjectAssignmentTarget(target) => {
            collect_assignment_pattern_reference_names(target.span(), names, ctx);
        }
        _ => {}
    }
}

fn collect_assignment_pattern_reference_names<'a>(
    span: oxc_span::Span,
    names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
) {
    for candidate in ctx.nodes().iter() {
        if span.contains_inclusive(candidate.span())
            && let AstKind::IdentifierReference(identifier) = candidate.kind()
        {
            names.insert(identifier.name.to_string());
        }
    }
}

fn is_per_iteration_receiver<'a>(
    receiver: &Expression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut dependencies = FxHashSet::default();
    collect_receiver_dependency_names(receiver, &mut dependencies);
    let iteration_names = enclosing_iteration_names(node, ctx);
    dependencies
        .iter()
        .any(|name| iteration_names.contains(name))
}

fn nearest_loop_node_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        (matches!(ancestor.kind(), AstKind::DoWhileStatement(_) | AstKind::ForInStatement(_) | AstKind::ForOfStatement(_) | AstKind::ForStatement(_) | AstKind::WhileStatement(_))
            || matches!(ancestor.kind(), AstKind::CallExpression(call) if is_iteration_callback_call(call)))
            .then_some(ancestor.id())
    })
}

fn receiver_is_declared_in_nearest_loop<'a>(
    receiver: &Expression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(loop_id) = nearest_loop_node_id(node, ctx) else {
        return false;
    };
    let mut symbols = FxHashSet::default();
    collect_receiver_dependency_symbols(receiver, ctx, &mut symbols);
    symbols.iter().any(|symbol_id| {
        symbol_has_declaration_initializer(*symbol_id, ctx)
            && ctx
                .nodes()
                .ancestors(ctx.symbol_declaration(*symbol_id).id())
                .any(|ancestor| ancestor.id() == loop_id)
    })
}

fn symbol_has_declaration_initializer<'a>(symbol_id: SymbolId, ctx: &LintContext<'a>) -> bool {
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::VariableDeclarator(declarator) => {
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| {
                    identifier.symbol_id() == symbol_id && declarator.init.is_some()
                })
                || binding_pattern_has_assignment_for_symbol(&declarator.id, symbol_id)
        }
        AstKind::FormalParameter(parameter) => {
            binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None).is_some()
        }
        _ => false,
    }
}

fn collect_receiver_dependency_symbols<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    symbols: &mut FxHashSet<SymbolId>,
) {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            {
                symbols.insert(symbol_id);
            }
        }
        Expression::CallExpression(call) => {
            collect_receiver_dependency_symbols(&call.callee, ctx, symbols);
        }
        expression => {
            if let Some(member) = expression.as_member_expression() {
                collect_receiver_dependency_symbols(member.object(), ctx, symbols);
                if let MemberExpression::ComputedMemberExpression(computed) = member {
                    collect_receiver_dependency_symbols(&computed.expression, ctx, symbols);
                }
            }
        }
    }
}

fn is_lookup_bounded_by_constant_iteration<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut saw_loop = false;
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::CallExpression(call) if is_iteration_callback_call(call) => {
                let Some(member) = call.callee.as_member_expression() else {
                    return false;
                };
                if !is_bounded_constant_collection(member.object(), ctx) {
                    return false;
                }
                saw_loop = true;
            }
            AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::WhileStatement(_) => {
                return false;
            }
            AstKind::ForInStatement(statement) => {
                if !is_bounded_constant_collection(&statement.right, ctx) {
                    return false;
                }
                saw_loop = true;
            }
            AstKind::ForOfStatement(statement) => {
                if !is_bounded_constant_collection(&statement.right, ctx) {
                    return false;
                }
                saw_loop = true;
            }
            _ => {}
        }
    }
    saw_loop
}

fn is_bounded_constant_collection<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_screaming_snake_case_receiver(expression)
        || is_small_inline_literal_array(expression, ctx)
        || resolved_initializer(expression, ctx).is_some_and(|(initializer, is_default)| {
            !is_default && is_small_inline_literal_array(initializer, ctx)
        })
}

fn is_string_element_of_split_iteration<'a>(
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    for ancestor in ctx.nodes().ancestors(declaration.id()) {
        if let AstKind::ForOfStatement(statement) = ancestor.kind() {
            return expression_resolves_to_split(&statement.right, ctx);
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
    }
    if !matches!(declaration.kind(), AstKind::FormalParameter(_)) {
        return false;
    }
    let Some(function_node) = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return false,
    };
    if parameters
        .items
        .first()
        .is_none_or(|parameter| !binding_pattern_has_symbol(&parameter.pattern, symbol_id))
    {
        return false;
    }
    let callback_parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(callback_call) = callback_parent.kind() else {
        return false;
    };
    callback_call
        .callee
        .as_member_expression()
        .is_some_and(|member| expression_resolves_to_split(member.object(), ctx))
}

fn expression_resolves_to_split<'a>(expression: &'a Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let expression = resolved_initializer(expression, ctx)
        .map_or(expression, |(initializer, _)| initializer)
        .get_inner_expression();
    matches!(expression, Expression::CallExpression(call) if call.callee.as_member_expression().and_then(member_expression_identifier_property_name) == Some("split"))
}

fn is_typescript_rest_helper_lookup<'a>(
    call: &CallExpression<'a>,
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(receiver_identifier) = receiver.get_inner_expression() else {
        return false;
    };
    let mut enclosing_function = None;
    for ancestor in ctx.nodes().ancestors(call.node_id.get()).skip(1) {
        match ancestor.kind() {
            AstKind::Function(function) => {
                if function.r#type == FunctionType::FunctionExpression {
                    enclosing_function = Some(function);
                }
                break;
            }
            AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    let Some(function) = enclosing_function else {
        return false;
    };
    if function
        .params
        .items
        .get(1)
        .and_then(|parameter| match &parameter.pattern {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier),
            _ => None,
        })
        .is_none_or(|identifier| identifier.name != receiver_identifier.name)
    {
        return false;
    }
    let mut helper_symbol = None;
    for ancestor in ctx.nodes().ancestors(function.node_id.get()).skip(1) {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|identifier| identifier.name == "__rest") =>
            {
                helper_symbol = declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id());
                break;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    helper_symbol.is_some_and(|symbol_id| {
        let mut saw_reference = false;
        let all_small = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .all(|reference| {
                saw_reference = true;
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let parent = ctx.nodes().parent_node(reference_node.id());
                let AstKind::CallExpression(helper_call) = parent.kind() else {
                    return false;
                };
                if helper_call.callee.span() != reference_node.span() {
                    return false;
                }
                helper_call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        let Expression::ArrayExpression(array) = argument.get_inner_expression()
                        else {
                            return false;
                        };
                        array.elements.len() <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS
                            && array.elements.iter().all(|element| {
                                !matches!(element, ArrayExpressionElement::SpreadElement(_))
                            })
                    })
            });
        saw_reference && all_small
    })
}
