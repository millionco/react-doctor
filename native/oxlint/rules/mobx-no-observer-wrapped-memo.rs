use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "`observer` cannot wrap an already memoized or observed component. Apply `observer` first, then place `memo` outside only if needed.";
const MOBX_REACT_MODULE: [&str; 1] = ["mobx-react"];
const MOBX_REACT_LITE_MODULE: [&str; 1] = ["mobx-react-lite"];
const OBSERVER_MODULES: [&str; 2] = ["mobx-react", "mobx-react-lite"];
const REACT_MODULES: [&str; 1] = ["react"];

#[derive(Debug, Default, Clone)]
pub struct MobxNoObserverWrappedMemo;

declare_oxc_lint!(
    /// Disallow MobX observer wrapping an already memoized or observed component.
    MobxNoObserverWrappedMemo,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Invalid MobX observer wrapper order.",
);

impl Rule for MobxNoObserverWrappedMemo {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let required_capability = if module_api_reference_matches(
                &call_expression.callee,
                "observer",
                &MOBX_REACT_MODULE,
                &property_write_analysis,
                ctx,
            ) {
                "mobx-react-observer-memo-guard"
            } else if module_api_reference_matches(
                &call_expression.callee,
                "observer",
                &MOBX_REACT_LITE_MODULE,
                &property_write_analysis,
                ctx,
            ) {
                "mobx-react-lite-observer-memo-guard"
            } else {
                continue;
            };
            if !has_capability(ctx, required_capability) {
                continue;
            }
            let Some(component_argument) = call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            if !has_invalid_inner_wrapper(
                component_argument,
                &property_write_analysis,
                ctx,
                &mut FxHashSet::default(),
            ) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn has_invalid_inner_wrapper<'a>(
    expression: &'a Expression<'a>,
    property_write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ) else {
            return false;
        };
        return has_invalid_inner_wrapper(
            initializer,
            property_write_analysis,
            ctx,
            visited_symbol_ids,
        );
    }
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    module_api_reference_matches(
        &call_expression.callee,
        "observer",
        &OBSERVER_MODULES,
        property_write_analysis,
        ctx,
    ) || module_api_reference_matches(
        &call_expression.callee,
        "memo",
        &REACT_MODULES,
        property_write_analysis,
        ctx,
    )
}
