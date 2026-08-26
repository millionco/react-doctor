use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This `z.string().<format>()` check is deprecated in Zod 4, so it can break during the upgrade.";
const STRING_FORMAT_METHODS: [&str; 21] = [
    "base64",
    "base64url",
    "cidr",
    "cidrv4",
    "cidrv6",
    "cuid",
    "cuid2",
    "date",
    "datetime",
    "duration",
    "email",
    "emoji",
    "ip",
    "ipv4",
    "ipv6",
    "jwt",
    "nanoid",
    "time",
    "ulid",
    "url",
    "uuid",
];

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct Zod_v4PreferTopLevelStringFormats;

pub type ZodV4PreferTopLevelStringFormats = Zod_v4PreferTopLevelStringFormats;

declare_oxc_lint!(
    /// Prefer Zod 4 top-level string format factories.
    Zod_v4PreferTopLevelStringFormats,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer Zod 4 top-level string format factories.",
);

impl Rule for Zod_v4PreferTopLevelStringFormats {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(format_call) = node.kind() else {
            return;
        };
        let Some(format_member) = format_call.callee.as_member_expression() else {
            return;
        };
        if !format_member
            .static_property_name()
            .is_some_and(|method_name| STRING_FORMAT_METHODS.contains(&method_name))
        {
            return;
        }
        let Expression::CallExpression(string_factory_call) =
            format_member.object().get_inner_expression()
        else {
            return;
        };
        if is_direct_zod_string_factory(&string_factory_call.callee, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(format_call.span));
        }
    }
}

fn is_direct_zod_string_factory<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => direct_named_import_matches(
            identifier,
            &["string"],
            &DIRECT_ZOD_MODULE_SOURCES,
            ctx,
        ),
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("string")
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if is_direct_zod_namespace_identifier(identifier, ctx)
                    )
            }),
    }
}
