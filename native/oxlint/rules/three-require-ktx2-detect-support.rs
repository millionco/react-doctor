use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "KTX2Loader must detect renderer texture-compression support before load or loadAsync chooses a transcode format";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireKtx2DetectSupport;

impl RuleMeta for ThreeRequireKtx2DetectSupport {
    const NAME: &'static str = "three-require-ktx2-detect-support";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require KTX2Loader support detection before loading textures.",
    };
}

struct Ktx2LoaderCall {
    loader_key: String,
    owner_function_id: Option<NodeId>,
    span: Span,
}

impl Rule for ThreeRequireKtx2DetectSupport {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let relevant_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let method_name = call_expression
                    .callee
                    .as_member_expression()
                    .and_then(static_member_expression_property_name)?;
                matches!(
                    method_name,
                    "detectSupport" | "detectSupportAsync" | "load" | "loadAsync"
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if relevant_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut detection_calls = Vec::new();
        let mut load_calls = Vec::new();

        for call_id in relevant_call_ids {
            let node = ctx.nodes().get_node(call_id);
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(callee) = call_expression.callee.as_member_expression() else {
                continue;
            };
            let Some(method_name) = static_member_expression_property_name(callee) else {
                continue;
            };
            let calls = match method_name {
                "detectSupport" | "detectSupportAsync" => &mut detection_calls,
                "load" | "loadAsync" => &mut load_calls,
                _ => continue,
            };
            if !three_ktx2_loader_expression_resolves_to_constructor(
                callee.object(),
                &analysis,
                ctx,
                &mut Vec::new(),
            ) {
                continue;
            }
            let Some(loader_key) = resolve_expression_key(callee.object(), ctx, &mut Vec::new())
            else {
                continue;
            };
            calls.push(Ktx2LoaderCall {
                loader_key,
                owner_function_id: crate::ast_util::get_enclosing_function(node, ctx)
                    .map(|function| function.id()),
                span: node.span(),
            });
        }

        for load_call in load_calls {
            if detection_calls.iter().any(|detection_call| {
                detection_call.loader_key == load_call.loader_key
                    && detection_call.owner_function_id == load_call.owner_function_id
                    && detection_call.span.start < load_call.span.start
            }) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(load_call.span));
        }
    }
}

fn three_ktx2_loader_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return module_api_reference_matches(
            &new_expression.callee,
            "KTX2Loader",
            &THREE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &new_expression.callee,
            "KTX2Loader",
            &THREE_MODULES,
            analysis,
            ctx,
        );
    }
    let Expression::Identifier(identifier) = expression else {
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
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_ktx2_loader_expression_resolves_to_constructor(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
