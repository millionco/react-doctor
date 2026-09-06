use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, IdentifierReference, TemplateLiteral},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DYNAMIC_IMPORT_MESSAGE: &str = "This can stay in the main bundle because the bundler cannot code-split a dynamic import path. Use a plain string path instead.";
const DYNAMIC_TEMPLATE_IMPORT_MESSAGE: &str = "This can stay in the main bundle because the bundler cannot code-split a dynamic import path with `${dynamic_path}`. Use a plain string path instead.";
const DYNAMIC_REQUIRE_MESSAGE: &str = "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead.";
const DYNAMIC_TEMPLATE_REQUIRE_MESSAGE: &str = "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead of one with `${...}`.";

#[derive(Debug, Default, Clone)]
pub struct NoDynamicImportPath;

declare_oxc_lint!(
    /// Require statically analyzable dynamic import and require paths.
    NoDynamicImportPath,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require statically analyzable dynamic import paths.",
);

impl Rule for NoDynamicImportPath {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if is_outside_browser_bundle(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            dynamic_import_check_node(node, ctx);
        }
    }
}

fn dynamic_import_check_node<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) {
    match node.kind() {
        AstKind::ImportExpression(import_expression) => {
            let message = match &import_expression.source {
                expression if expression.is_literal() => return,
                Expression::TemplateLiteral(template) => {
                    if template.expressions.is_empty()
                        || dynamic_import_template_is_analyzable(template)
                    {
                        return;
                    }
                    DYNAMIC_TEMPLATE_IMPORT_MESSAGE
                }
                Expression::Identifier(identifier)
                    if dynamic_import_is_deliberate_static_indirection(identifier, ctx) =>
                {
                    return;
                }
                _ => DYNAMIC_IMPORT_MESSAGE,
            };
            if dynamic_import_has_bundler_ignore_annotation(import_expression.span, ctx) {
                return;
            }
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(import_expression.span));
        }
        AstKind::CallExpression(call_expression) => {
            let Expression::Identifier(callee) = &call_expression.callee else {
                return;
            };
            if callee.name != "require" {
                return;
            }
            let Some(argument) = call_expression.arguments.first() else {
                return;
            };
            let message = match argument {
                argument
                    if argument
                        .as_expression()
                        .is_some_and(|expression| expression.is_literal()) =>
                {
                    return;
                }
                Argument::TemplateLiteral(template) => {
                    if template.expressions.is_empty()
                        || dynamic_import_template_is_analyzable(template)
                    {
                        return;
                    }
                    DYNAMIC_TEMPLATE_REQUIRE_MESSAGE
                }
                Argument::Identifier(identifier)
                    if dynamic_import_is_deliberate_static_indirection(identifier, ctx) =>
                {
                    return;
                }
                _ => DYNAMIC_REQUIRE_MESSAGE,
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call_expression.span));
        }
        _ => {}
    }
}

fn dynamic_import_template_is_analyzable(template: &TemplateLiteral<'_>) -> bool {
    let Some(first_quasi_text) = dynamic_import_template_quasi_text(template, 0) else {
        return false;
    };
    dynamic_import_has_static_directory_prefix(first_quasi_text)
        || first_quasi_text.contains('?')
        || dynamic_import_template_quasi_text(template, template.quasis.len().saturating_sub(1))
            .is_some_and(|last_quasi_text| last_quasi_text.ends_with("package.json"))
}

fn dynamic_import_template_quasi_text<'a>(
    template: &'a TemplateLiteral<'a>,
    index: usize,
) -> Option<&'a str> {
    template.quasis.get(index).map(|quasi| {
        quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
    })
}

fn dynamic_import_has_static_directory_prefix(first_quasi_text: &str) -> bool {
    let prefix_length = dynamic_import_relative_or_alias_prefix_length(first_quasi_text)
        .or_else(|| dynamic_import_package_prefix_length(first_quasi_text));
    prefix_length.is_some_and(|length| first_quasi_text[length..].contains('/'))
}

fn dynamic_import_relative_or_alias_prefix_length(value: &str) -> Option<usize> {
    if value.starts_with("@/") || value.starts_with("~/") {
        return Some(2);
    }
    let mut offset = 0;
    loop {
        let remainder = &value[offset..];
        let segment_length = if remainder.starts_with("../") {
            3
        } else if remainder.starts_with("./") {
            2
        } else {
            break;
        };
        offset += segment_length;
    }
    (offset > 0).then_some(offset)
}

fn dynamic_import_package_prefix_length(value: &str) -> Option<usize> {
    if let Some(scoped_package) = value.strip_prefix('@') {
        let scope_length = dynamic_import_package_segment_length(scoped_package, false)?;
        if scoped_package.as_bytes().get(scope_length) != Some(&b'/') {
            return None;
        }
        let package_start = scope_length + 1;
        let package_length =
            dynamic_import_package_segment_length(scoped_package.get(package_start..)?, false)?;
        if scoped_package
            .as_bytes()
            .get(package_start + package_length)
            != Some(&b'/')
        {
            return None;
        }
        return Some(1 + package_start + package_length + 1);
    }
    let package_length = dynamic_import_package_segment_length(value, true)?;
    (value.as_bytes().get(package_length) == Some(&b'/')).then_some(package_length + 1)
}

fn dynamic_import_package_segment_length(
    value: &str,
    requires_leading_alpha: bool,
) -> Option<usize> {
    let mut characters = value.char_indices();
    let (_, first_character) = characters.next()?;
    if requires_leading_alpha && !first_character.is_ascii_alphabetic()
        || !requires_leading_alpha && !dynamic_import_is_package_character(first_character)
    {
        return None;
    }
    let mut length = first_character.len_utf8();
    for (offset, character) in characters {
        if !dynamic_import_is_package_character(character) {
            return Some(offset);
        }
        length = offset + character.len_utf8();
    }
    Some(length)
}

fn dynamic_import_is_package_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
}

fn dynamic_import_is_deliberate_static_indirection(
    identifier: &IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    matches!(initializer, Expression::StringLiteral(_))
        || matches!(initializer, Expression::TemplateLiteral(template) if template.expressions.is_empty())
        || dynamic_import_is_url_create_object_url_call(initializer)
}

fn dynamic_import_is_url_create_object_url_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    member.property.name == "createObjectURL"
        && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "URL")
}

fn dynamic_import_has_bundler_ignore_annotation(span: Span, ctx: &LintContext<'_>) -> bool {
    let source = ctx.source_range(span);
    source.contains("@vite-ignore") || dynamic_import_has_webpack_ignore_annotation(source)
}

fn dynamic_import_has_webpack_ignore_annotation(source: &str) -> bool {
    let mut remaining = source;
    while let Some(index) = remaining.find("webpackIgnore") {
        let after_name = &remaining[index + "webpackIgnore".len()..];
        let after_whitespace = after_name.trim_start_matches(char::is_whitespace);
        let Some(after_colon) = after_whitespace.strip_prefix(':') else {
            remaining = after_name;
            continue;
        };
        if after_colon
            .trim_start_matches(char::is_whitespace)
            .starts_with("true")
        {
            return true;
        }
        remaining = after_name;
    }
    false
}
