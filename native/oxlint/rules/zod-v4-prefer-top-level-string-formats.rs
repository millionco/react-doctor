use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
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
const ZOD_MODULE_SOURCES: [&str; 2] = ["zod", "zod/v4"];

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

#[derive(Clone, Copy, PartialEq, Eq)]
enum ZodImportKind {
    Namespace,
    NamedZ,
    NamedString,
}

fn is_direct_zod_string_factory(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            direct_zod_import_kind(identifier, ctx) == Some(ZodImportKind::NamedString)
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("string")
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if matches!(
                                direct_zod_import_kind(identifier, ctx),
                                Some(ZodImportKind::Namespace | ZodImportKind::NamedZ)
                            )
                    )
            }),
    }
}

fn direct_zod_import_kind(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<ZodImportKind> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if entry.is_type
            || !ZOD_MODULE_SOURCES.contains(&entry.module_request.name())
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
        {
            return None;
        }
        match &entry.import_name {
            ImportImportName::NamespaceObject | ImportImportName::Default(_) => {
                Some(ZodImportKind::Namespace)
            }
            ImportImportName::Name(imported_name) if imported_name.name() == "z" => {
                Some(ZodImportKind::NamedZ)
            }
            ImportImportName::Name(imported_name) if imported_name.name() == "string" => {
                Some(ZodImportKind::NamedString)
            }
            _ => None,
        }
    })
}
