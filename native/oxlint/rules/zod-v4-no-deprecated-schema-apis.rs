use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const OBJECT_METHODS: [&str; 6] = [
    "deepPartial",
    "merge",
    "nonstrict",
    "passthrough",
    "strict",
    "strip",
];
const FUNCTION_CHAIN_METHODS: [&str; 2] = ["args", "returns"];
const DEPRECATED_TOP_LEVEL_FACTORIES: [&str; 6] = [
    "nativeEnum",
    "ostring",
    "onumber",
    "oboolean",
    "oarray",
    "promise",
];
const FACTORIES_WITH_DROPPED_CREATE: [&str; 24] = [
    "any",
    "array",
    "bigint",
    "boolean",
    "date",
    "enum",
    "function",
    "literal",
    "map",
    "nativeEnum",
    "never",
    "null",
    "number",
    "object",
    "optional",
    "promise",
    "record",
    "set",
    "string",
    "tuple",
    "undefined",
    "union",
    "unknown",
    "void",
];
const ENUM_PROPERTY_ALIASES: [&str; 2] = ["Enum", "Values"];
const MESSAGE: &str =
    "This Zod 3 schema API changed in Zod 4, so this schema can fail after the upgrade.";

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct Zod_v4NoDeprecatedSchemaApis;

pub type ZodV4NoDeprecatedSchemaApis = Zod_v4NoDeprecatedSchemaApis;

declare_oxc_lint!(
    /// Warns about Zod 3 schema APIs changed in Zod 4.
    Zod_v4NoDeprecatedSchemaApis,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about Zod 3 schema APIs changed in Zod 4.",
);

impl Rule for Zod_v4NoDeprecatedSchemaApis {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let diagnostic_span = match node.kind() {
            AstKind::CallExpression(call_expression) => {
                if !is_deprecated_schema_call(call_expression, ctx) {
                    return;
                }
                call_expression.span
            }
            AstKind::StaticMemberExpression(member_expression) => {
                if is_call_callee(node, ctx)
                    || !is_deprecated_schema_member(
                        member_expression.property.name.as_str(),
                        &member_expression.object,
                        ctx,
                    )
                {
                    return;
                }
                member_expression.span
            }
            AstKind::ComputedMemberExpression(member_expression) => {
                if is_call_callee(node, ctx)
                    || !member_expression.static_property_name().is_some_and(|property_name| {
                        is_deprecated_schema_member(
                            property_name.as_ref(),
                            &member_expression.object,
                            ctx,
                        )
                    })
                {
                    return;
                }
                member_expression.span
            }
            _ => return,
        };
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
    }
}

fn is_deprecated_schema_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    direct_zod_factory_call_name(call_expression, &DEPRECATED_TOP_LEVEL_FACTORIES, ctx).is_some()
        || is_call_to_dropped_create_factory(call_expression, ctx)
        || call_expression.arguments.len() == 1
            && direct_zod_factory_call_name(call_expression, &["record"], ctx).is_some()
        || is_literal_symbol_call(call_expression, ctx)
        || is_direct_method_call_on_zod_factory(
            call_expression,
            &["function"],
            &FUNCTION_CHAIN_METHODS,
            ctx,
        )
        || is_direct_method_call_on_zod_factory(
            call_expression,
            &["object"],
            &OBJECT_METHODS,
            ctx,
        )
        || is_direct_method_call_on_zod_factory(
            call_expression,
            &["number"],
            &["safe"],
            ctx,
        )
        || is_refine_second_argument_function(call_expression, ctx)
}

fn is_call_to_dropped_create_factory<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(create_member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    create_member.static_property_name() == Some("create")
        && is_direct_zod_factory_reference(
            create_member.object(),
            &FACTORIES_WITH_DROPPED_CREATE,
            ctx,
        )
}

fn is_direct_zod_factory_reference<'a>(
    expression: &Expression<'a>,
    factory_names: &[&str],
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => direct_named_import_matches(
            identifier,
            factory_names,
            &DIRECT_ZOD_MODULE_SOURCES,
            ctx,
        ),
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression
                    .static_property_name()
                    .is_some_and(|factory_name| factory_names.contains(&factory_name))
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if is_direct_zod_namespace_identifier(identifier, ctx)
                    )
            }),
    }
}

fn is_literal_symbol_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    call_expression.arguments.first().is_some_and(|argument| {
        direct_zod_factory_call_name(call_expression, &["literal"], ctx).is_some()
            && argument
                .as_expression()
                .is_some_and(is_symbol_literal_argument)
    })
}

fn is_symbol_literal_argument(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(symbol_call) => matches!(
            symbol_call.callee.get_inner_expression(),
            Expression::Identifier(identifier) if identifier.name == "Symbol"
        ),
        expression => expression.as_member_expression().is_some_and(|member_expression| {
            matches!(
                member_expression.object().get_inner_expression(),
                Expression::Identifier(identifier) if identifier.name == "Symbol"
            )
        }),
    }
}

fn is_refine_second_argument_function<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(refine_member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if refine_member.static_property_name() != Some("refine") {
        return false;
    }
    if !matches!(
        refine_member.object().get_inner_expression(),
        Expression::CallExpression(factory_call)
            if direct_zod_factory_call_name(
                factory_call,
                &FACTORIES_WITH_DROPPED_CREATE,
                ctx,
            ).is_some()
    ) {
        return false;
    }
    matches!(
        call_expression.arguments.get(1),
        Some(Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_))
    )
}

fn is_deprecated_schema_member<'a>(
    property_name: &str,
    object: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if ENUM_PROPERTY_ALIASES.contains(&property_name) {
        return matches!(
            object.get_inner_expression(),
            Expression::CallExpression(factory_call)
                if direct_zod_factory_call_name(factory_call, &["enum"], ctx).is_some()
        );
    }
    property_name == "create"
        && object
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|factory_member| {
                factory_member
                    .static_property_name()
                    .is_some_and(|factory_name| {
                        FACTORIES_WITH_DROPPED_CREATE.contains(&factory_name)
                    })
                    && matches!(
                        factory_member.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if is_direct_zod_namespace_identifier(identifier, ctx)
                    )
            })
}

fn is_call_callee<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    matches!(
        ctx.nodes().parent_node(expression_root.id()).kind(),
        AstKind::CallExpression(call_expression)
            if call_expression.callee.get_inner_expression().span() == node.span()
    )
}
