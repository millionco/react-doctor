use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_MODULES: [&str; 1] = ["three"];
const MESSAGE: &str = "Registering the whole Three.js namespace keeps every export in R3F's catalogue and undermines tree-shaking. Pass only the constructors used by JSX";

#[derive(Debug, Default, Clone)]
pub struct R3FNoExtendThreeNamespace;

impl RuleMeta for R3FNoExtendThreeNamespace {
    const NAME: &'static str = "r3f-no-extend-three-namespace";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow registering the whole Three.js namespace with R3F.",
    };
}

impl Rule for R3FNoExtendThreeNamespace {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["extend"],
            &R3F_PUBLIC_MODULES,
            false,
            ctx,
        ) {
            return;
        }
        let Some(argument) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let candidate = argument.get_inner_expression();
        if let oxc_ast::ast::Expression::Identifier(identifier) = candidate
            && let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            && symbol_has_write_before(symbol_id, call_expression.span.start, ctx)
        {
            return;
        }
        if !module_api_path_matches(candidate, &[], &THREE_MODULES, false, ctx)
            && !contains_three_namespace_spread(
                candidate,
                ctx,
                &mut rustc_hash::FxHashSet::default(),
            )
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(argument.span()));
    }
}

fn contains_three_namespace_spread<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbol_ids.insert(symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let AstKind::VariableDeclaration(variable_declaration) =
            ctx.nodes().parent_node(declaration.id()).kind()
        else {
            return false;
        };
        return variable_declaration.kind.is_const()
            && declarator.init.as_ref().is_some_and(|initializer| {
                contains_three_namespace_spread(initializer, ctx, visited_symbol_ids)
            });
    }
    let oxc_ast::ast::Expression::ObjectExpression(object_expression) = expression else {
        return false;
    };
    object_expression.properties.iter().any(|property| {
        matches!(
            property,
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread_property)
                if module_api_path_matches(
                    &spread_property.argument,
                    &[],
                    &THREE_MODULES,
                    false,
                    ctx,
                )
        )
    })
}
