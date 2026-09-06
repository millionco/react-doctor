use oxc_ast::{ast::Argument, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];

#[derive(Debug, Default, Clone)]
pub struct R3FNoUseFrameDependencyArray;

impl RuleMeta for R3FNoUseFrameDependencyArray {
    const NAME: &'static str = "r3f-no-use-frame-dependency-array";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow dependency arrays passed to useFrame.",
    };
}

impl Rule for R3FNoUseFrameDependencyArray {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["useFrame"],
            &R3F_PUBLIC_MODULES,
            false,
            ctx,
        ) {
            return;
        }
        let Some(scheduling_argument) = call_expression
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if !resolves_to_array_expression(scheduling_argument, ctx, &mut Vec::new()) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(
                "useFrame does not use a React dependency array. Its second argument controls R3F frame scheduling, so this array can change render ordering or be ignored instead of controlling callback updates",
            )
            .with_label(scheduling_argument.span()),
        );
    }
}

fn resolves_to_array_expression<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(expression, oxc_ast::ast::Expression::ArrayExpression(_)) {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    variable_declaration.kind.is_const()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            resolves_to_array_expression(initializer, ctx, visited_symbol_ids)
        })
}
