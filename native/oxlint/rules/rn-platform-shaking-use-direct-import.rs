use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Expo cannot tree-shake platform branches reached through the React Native namespace, so both platform paths stay in the bundle.";
const REACT_NATIVE_MODULE_SOURCE: &str = "react-native";

#[derive(Debug, Default, Clone)]
pub struct RnPlatformShakingUseDirectImport;

declare_oxc_lint!(
    /// Prefer direct Platform imports from React Native.
    RnPlatformShakingUseDirectImport,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer direct Platform imports from React Native.",
);

impl Rule for RnPlatformShakingUseDirectImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::StaticMemberExpression(member_expression) = node.kind() else {
            return;
        };
        let Some(identifier) = member_expression.object.get_identifier_reference() else {
            return;
        };
        if member_expression.property.name != "Platform"
            || !is_namespace_import_from_module(identifier, REACT_NATIVE_MODULE_SOURCE, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span));
    }
}

fn is_namespace_import_from_module<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    module_source: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == module_source
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}
