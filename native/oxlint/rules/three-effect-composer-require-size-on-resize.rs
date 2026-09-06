use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This handler resizes a renderer without resizing its EffectComposer, so postprocessing targets keep stale dimensions";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeEffectComposerRequireSizeOnResize;

impl RuleMeta for ThreeEffectComposerRequireSizeOnResize {
    const NAME: &'static str = "three-effect-composer-require-size-on-resize";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require EffectComposer sizing alongside renderer resizing.",
    };
}

struct ThreeEffectComposerBinding {
    composer_key: String,
    renderer_key: String,
}

struct ThreeEffectComposerResizeFact {
    delegated_composer_keys: std::rc::Rc<rustc_hash::FxHashSet<String>>,
    resized_composer_keys: std::rc::Rc<rustc_hash::FxHashSet<String>>,
    renderer_key: String,
    renderer_resize_node_id: NodeId,
}

impl Rule for ThreeEffectComposerRequireSizeOnResize {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let resize_source_ids = ctx
            .nodes()
            .iter()
            .filter(|node| three_composer_resize_handler_expression(node, ctx).is_some())
            .map(crate::AstNode::id)
            .collect::<Vec<_>>();
        if resize_source_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut resize_facts = Vec::new();
        for resize_source_id in resize_source_ids {
            let resize_source = ctx.nodes().get_node(resize_source_id);
            let Some(handler_expression) =
                three_composer_resize_handler_expression(resize_source, ctx)
            else {
                continue;
            };
            let Some(callback_id) = exact_local_function_id(
                handler_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            if analyzed_callback_ids.insert(callback_id) {
                resize_facts.extend(three_composer_collect_resize_facts(
                    callback_id,
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                ));
            }
        }
        if resize_facts.is_empty() {
            return;
        }

        let mut assignment_aliases = Vec::new();
        let mut composer_bindings = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign =>
                {
                    let target_key = three_composer_assignment_target_key(&assignment.left, ctx);
                    let source_key =
                        resolve_expression_key(&assignment.right, ctx, &mut Vec::new());
                    if let (Some(target_key), Some(source_key)) = (target_key, source_key) {
                        assignment_aliases.push((target_key, source_key));
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(Expression::NewExpression(allocation)) = declarator.init.as_ref()
                    else {
                        continue;
                    };
                    if !three_composer_constructor_matches(
                        &allocation.callee,
                        "EffectComposer",
                        &analysis,
                        ctx,
                    ) {
                        continue;
                    }
                    let Some(renderer) = allocation
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                    else {
                        continue;
                    };
                    let composer_key = format!("symbol:{}", binding.symbol_id().index());
                    let Some(renderer_key) = resolve_expression_key(renderer, ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    composer_bindings.push(ThreeEffectComposerBinding {
                        composer_key,
                        renderer_key,
                    });
                }
                _ => {}
            }
        }

        for resize_fact in resize_facts {
            let has_stale_composer = composer_bindings.iter().any(|binding| {
                binding.renderer_key == resize_fact.renderer_key
                    && !resize_fact.resized_composer_keys.iter().any(|resized_key| {
                        three_composer_keys_are_aliased(
                            &binding.composer_key,
                            resized_key,
                            &assignment_aliases,
                        )
                    })
                    && !resize_fact
                        .delegated_composer_keys
                        .contains(&binding.composer_key)
            });
            if has_stale_composer {
                ctx.diagnostic(
                    OxcDiagnostic::error(MESSAGE).with_label(
                        ctx.nodes()
                            .get_node(resize_fact.renderer_resize_node_id)
                            .span(),
                    ),
                );
            }
        }
    }
}

fn three_composer_resize_handler_expression<'a, 'ctx>(
    node: &'ctx crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'ctx Expression<'a>> {
    match node.kind() {
        AstKind::CallExpression(call_expression) => {
            let member_expression = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()?;
            if static_member_expression_property_name(member_expression) != Some("addEventListener")
                || !three_composer_is_global_identifier(member_expression.object(), "window", ctx)
                || !matches!(
                    call_expression.arguments.first()?.as_expression()?.get_inner_expression(),
                    Expression::StringLiteral(literal) if literal.value == "resize"
                )
            {
                return None;
            }
            call_expression.arguments.get(1)?.as_expression()
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.operator == AssignmentOperator::Assign =>
        {
            let member_expression = assignment.left.as_member_expression().or_else(|| {
                assignment
                    .left
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?;
            (static_member_expression_property_name(member_expression) == Some("onresize")
                && three_composer_is_global_identifier(member_expression.object(), "window", ctx))
            .then_some(&assignment.right)
        }
        AstKind::NewExpression(new_expression) => {
            if !three_composer_is_global_identifier(&new_expression.callee, "ResizeObserver", ctx) {
                return None;
            }
            new_expression.arguments.first()?.as_expression()
        }
        _ => None,
    }
}

fn three_composer_is_global_identifier(
    expression: &Expression<'_>,
    identifier_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == identifier_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn three_composer_collect_resize_facts<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeEffectComposerResizeFact> {
    let mut delegated_composer_keys = rustc_hash::FxHashSet::default();
    let mut resized_composer_keys = rustc_hash::FxHashSet::default();
    let mut renderer_resizes = Vec::<(String, NodeId)>::new();
    let mut renderer_resize_index_by_key =
        rustc_hash::FxHashMap::<String, usize>::default();
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return;
            };
            if let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            {
                let method_name = static_member_expression_property_name(member_expression);
                let target_key =
                    resolve_expression_key(member_expression.object(), ctx, &mut Vec::new());
                if method_name == Some("setSize") {
                    if let Some(target_key) = target_key {
                        if three_composer_expression_resolves_to_renderer(
                            member_expression.object(),
                            analysis,
                            ctx,
                            &mut Vec::new(),
                        ) {
                            if let Some(&resize_index) =
                                renderer_resize_index_by_key.get(&target_key)
                            {
                                renderer_resizes[resize_index].1 = candidate.id();
                            } else {
                                renderer_resize_index_by_key
                                    .insert(target_key.clone(), renderer_resizes.len());
                                renderer_resizes.push((target_key, candidate.id()));
                            }
                        } else {
                            resized_composer_keys.insert(target_key);
                        }
                        return;
                    }
                }
            }
            if !is_imported_or_stable_parameter_call(
                call_expression,
                ctx,
                execution_resolution_cache,
            ) {
                return;
            }
            for argument in &call_expression.arguments {
                let Some(argument) = argument.as_expression() else {
                    continue;
                };
                if three_composer_expression_resolves_to_constructor(
                    argument,
                    "EffectComposer",
                    analysis,
                    ctx,
                    &mut Vec::new(),
                ) && let Some(composer_key) =
                    resolve_expression_key(argument, ctx, &mut Vec::new())
                {
                    delegated_composer_keys.insert(composer_key);
                }
            }
        },
    );
    let delegated_composer_keys = std::rc::Rc::new(delegated_composer_keys);
    let resized_composer_keys = std::rc::Rc::new(resized_composer_keys);
    renderer_resizes
        .into_iter()
        .map(
            |(renderer_key, renderer_resize_node_id)| ThreeEffectComposerResizeFact {
                delegated_composer_keys: delegated_composer_keys.clone(),
                resized_composer_keys: resized_composer_keys.clone(),
                renderer_key,
                renderer_resize_node_id,
            },
        )
        .collect()
}

fn three_composer_expression_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    ["WebGLRenderer", "WebGPURenderer"]
        .iter()
        .any(|constructor_name| {
            three_composer_expression_resolves_to_constructor(
                expression,
                constructor_name,
                analysis,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        })
}

fn three_composer_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return three_composer_constructor_matches(
            &allocation.callee,
            constructor_name,
            analysis,
            ctx,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
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
            three_composer_expression_resolves_to_constructor(
                initializer,
                constructor_name,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_composer_constructor_matches<'a>(
    callee: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(callee, constructor_name, &THREE_MODULES, analysis, ctx)
        || type_import_module_api_reference_matches(
            callee,
            constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        )
}

fn three_composer_assignment_target_key(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = target {
        let key = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map_or_else(
                || format!("global:{}", identifier.name),
                |symbol_id| format!("symbol:{}", symbol_id.index()),
            );
        return Some(key);
    }
    resolve_expression_key(target.get_expression()?, ctx, &mut Vec::new())
}

fn three_composer_keys_are_aliased(
    left_key: &str,
    right_key: &str,
    assignment_aliases: &[(String, String)],
) -> bool {
    let mut pending_keys = vec![left_key];
    let mut visited_keys = rustc_hash::FxHashSet::default();
    while let Some(current_key) = pending_keys.pop() {
        if !visited_keys.insert(current_key) {
            continue;
        }
        if current_key == right_key {
            return true;
        }
        for (alias_target, alias_source) in assignment_aliases {
            if alias_target == current_key {
                pending_keys.push(alias_source);
            }
            if alias_source == current_key {
                pending_keys.push(alias_target);
            }
        }
    }
    false
}
