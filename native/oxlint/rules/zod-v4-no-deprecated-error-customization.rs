use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const ZOD_FACTORIES_WITH_ERROR_PARAMS: [&str; 21] = [
    "any",
    "array",
    "bigint",
    "boolean",
    "date",
    "enum",
    "literal",
    "map",
    "nativeEnum",
    "never",
    "null",
    "number",
    "object",
    "record",
    "set",
    "string",
    "tuple",
    "undefined",
    "union",
    "unknown",
    "void",
];
const DROPPED_ERROR_OPTION_PROPERTIES: [&str; 3] =
    ["errorMap", "invalid_type_error", "required_error"];
const FACTORIES_WITH_LEGACY_FIRST_ARG_MESSAGE: [&str; 5] =
    ["bigint", "boolean", "date", "number", "string"];
const PARSE_METHODS: [&str; 4] = ["parse", "safeParse", "parseAsync", "safeParseAsync"];
const MESSAGE: &str = "This Zod 3 error-customization form is not compatible with Zod 4, so custom messages can stop applying during the upgrade.";

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct Zod_v4NoDeprecatedErrorCustomization;

pub type ZodV4NoDeprecatedErrorCustomization = Zod_v4NoDeprecatedErrorCustomization;

declare_oxc_lint!(
    /// Warns about Zod 3 error customization removed in Zod 4.
    Zod_v4NoDeprecatedErrorCustomization,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns about Zod 3 error customization removed in Zod 4.",
);

impl Rule for Zod_v4NoDeprecatedErrorCustomization {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !factory_uses_deprecated_error_parameter(call_expression, ctx)
            && !parse_call_uses_error_map(call_expression, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn factory_uses_deprecated_error_parameter<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(factory_name) = direct_zod_factory_call_name(
        call_expression,
        &ZOD_FACTORIES_WITH_ERROR_PARAMS,
        ctx,
    ) else {
        return false;
    };
    FACTORIES_WITH_LEGACY_FIRST_ARG_MESSAGE.contains(&factory_name)
        && first_argument_is_message_string(call_expression)
        || call_expression.arguments.iter().any(|argument| {
            argument.as_expression().is_some_and(|expression| {
                object_expression_has_any_property(expression, &DROPPED_ERROR_OPTION_PROPERTIES)
            })
        })
}

fn first_argument_is_message_string(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|argument| {
            matches!(argument.get_inner_expression(), Expression::StringLiteral(_))
        })
}

fn parse_call_uses_error_map<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(method_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !method_expression
        .static_property_name()
        .is_some_and(|method_name| PARSE_METHODS.contains(&method_name))
    {
        return false;
    }
    let Expression::CallExpression(factory_call) =
        method_expression.object().get_inner_expression()
    else {
        return false;
    };
    if direct_zod_factory_call_name(factory_call, &ZOD_FACTORIES_WITH_ERROR_PARAMS, ctx).is_none()
    {
        return false;
    }
    call_expression
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .is_some_and(|argument| object_expression_has_any_property(argument, &["errorMap"]))
}

fn object_expression_has_any_property(
    expression: &Expression<'_>,
    property_names: &[&str],
) -> bool {
    let Expression::ObjectExpression(object_expression) = expression.get_inner_expression() else {
        return false;
    };
    object_expression.properties.iter().any(|property| {
        matches!(
            property,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().is_some_and(|property_name| {
                    property_names.contains(&property_name.as_ref())
                })
        )
    })
}
