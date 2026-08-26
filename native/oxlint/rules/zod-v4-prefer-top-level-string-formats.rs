use oxc_ast::AstKind;
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
        if is_direct_method_call_on_zod_factory(
            format_call,
            &["string"],
            &STRING_FORMAT_METHODS,
            ctx,
        ) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(format_call.span));
        }
    }
}
