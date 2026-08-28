use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This resize handler changes the renderer size without updating the aspect of a PerspectiveCamera rendered by it, so the scene can stretch or squash";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireCameraAspectOnResize;

impl RuleMeta for ThreeRequireCameraAspectOnResize {
    const NAME: &'static str = "three-require-camera-aspect-on-resize";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require rendered PerspectiveCamera aspects to follow renderer resizes.",
    };
}

struct ThreeRenderCameraFact {
    camera_key: String,
    renderer_key: String,
}

struct ThreeResizeFact {
    aspect_camera_keys: std::rc::Rc<rustc_hash::FxHashSet<String>>,
    opaque_camera_keys: std::rc::Rc<rustc_hash::FxHashSet<String>>,
    renderer_key: String,
    set_size_node_id: NodeId,
}

impl Rule for ThreeRequireCameraAspectOnResize {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let resize_source_ids = ctx
            .nodes()
            .iter()
            .filter(|node| three_camera_aspect_resize_handler_expression(node, ctx).is_some())
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
                three_camera_aspect_resize_handler_expression(resize_source, ctx)
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
                resize_facts.extend(three_camera_aspect_collect_resize_facts(
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

        let render_facts = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let member_expression = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()?;
                if static_member_expression_property_name(member_expression) != Some("render")
                    || !three_camera_aspect_expression_resolves_to_constructor(
                        member_expression.object(),
                        "WebGLRenderer",
                        &analysis,
                        ctx,
                        &mut Vec::new(),
                    )
                {
                    return None;
                }
                let camera = call_expression.arguments.get(1)?.as_expression()?;
                if !three_camera_aspect_expression_resolves_to_constructor(
                    camera,
                    "PerspectiveCamera",
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                ) {
                    return None;
                }
                Some(ThreeRenderCameraFact {
                    camera_key: resolve_expression_key(camera, ctx, &mut Vec::new())?,
                    renderer_key: resolve_expression_key(
                        member_expression.object(),
                        ctx,
                        &mut Vec::new(),
                    )?,
                })
            })
            .collect::<Vec<_>>();

        for resize_fact in resize_facts {
            let has_missing_camera = render_facts.iter().any(|render_fact| {
                render_fact.renderer_key == resize_fact.renderer_key
                    && !resize_fact
                        .aspect_camera_keys
                        .contains(&render_fact.camera_key)
                    && !resize_fact
                        .opaque_camera_keys
                        .contains(&render_fact.camera_key)
            });
            if has_missing_camera {
                ctx.diagnostic(
                    OxcDiagnostic::error(MESSAGE)
                        .with_label(ctx.nodes().get_node(resize_fact.set_size_node_id).span()),
                );
            }
        }
    }
}

fn three_camera_aspect_resize_handler_expression<'a, 'ctx>(
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
                || !three_camera_aspect_is_global_identifier(
                    member_expression.object(),
                    "window",
                    ctx,
                )
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
                && three_camera_aspect_is_global_identifier(
                    member_expression.object(),
                    "window",
                    ctx,
                ))
            .then_some(&assignment.right)
        }
        AstKind::NewExpression(new_expression) => {
            if !three_camera_aspect_is_global_identifier(
                &new_expression.callee,
                "ResizeObserver",
                ctx,
            ) {
                return None;
            }
            new_expression.arguments.first()?.as_expression()
        }
        _ => None,
    }
}

fn three_camera_aspect_is_global_identifier(
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

fn three_camera_aspect_collect_resize_facts<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Vec<ThreeResizeFact> {
    let mut aspect_camera_keys = rustc_hash::FxHashSet::default();
    let mut opaque_camera_keys = rustc_hash::FxHashSet::default();
    let mut renderer_set_sizes = Vec::<(String, NodeId)>::new();
    let mut renderer_set_size_index_by_key = rustc_hash::FxHashMap::<String, usize>::default();
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, execution_resolution_cache| match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(member_expression) =
                    assignment.left.as_member_expression().or_else(|| {
                        assignment
                            .left
                            .get_expression()?
                            .get_inner_expression()
                            .as_member_expression()
                    })
                else {
                    return;
                };
                if static_member_expression_property_name(member_expression) == Some("aspect")
                    && three_camera_aspect_expression_resolves_to_constructor(
                        member_expression.object(),
                        "PerspectiveCamera",
                        analysis,
                        ctx,
                        &mut Vec::new(),
                    )
                    && let Some(camera_key) =
                        resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
                {
                    aspect_camera_keys.insert(camera_key);
                }
            }
            AstKind::CallExpression(call_expression) => {
                if let Some(member_expression) = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    && static_member_expression_property_name(member_expression) == Some("setSize")
                    && three_camera_aspect_expression_resolves_to_constructor(
                        member_expression.object(),
                        "WebGLRenderer",
                        analysis,
                        ctx,
                        &mut Vec::new(),
                    )
                    && let Some(renderer_key) =
                        resolve_expression_key(member_expression.object(), ctx, &mut Vec::new())
                {
                    if let Some(&set_size_index) = renderer_set_size_index_by_key.get(&renderer_key)
                    {
                        renderer_set_sizes[set_size_index].1 = candidate.id();
                    } else {
                        renderer_set_size_index_by_key
                            .insert(renderer_key.clone(), renderer_set_sizes.len());
                        renderer_set_sizes.push((renderer_key, candidate.id()));
                    }
                    return;
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
                    if three_camera_aspect_expression_resolves_to_constructor(
                        argument,
                        "PerspectiveCamera",
                        analysis,
                        ctx,
                        &mut Vec::new(),
                    ) && let Some(camera_key) =
                        resolve_expression_key(argument, ctx, &mut Vec::new())
                    {
                        opaque_camera_keys.insert(camera_key);
                    }
                }
            }
            _ => {}
        },
    );
    let aspect_camera_keys = std::rc::Rc::new(aspect_camera_keys);
    let opaque_camera_keys = std::rc::Rc::new(opaque_camera_keys);
    renderer_set_sizes
        .into_iter()
        .map(|(renderer_key, set_size_node_id)| ThreeResizeFact {
            aspect_camera_keys: aspect_camera_keys.clone(),
            opaque_camera_keys: opaque_camera_keys.clone(),
            renderer_key,
            set_size_node_id,
        })
        .collect()
}

fn three_camera_aspect_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    constructor_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return module_api_reference_matches(
            &allocation.callee,
            constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &allocation.callee,
            constructor_name,
            &THREE_MODULES,
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
            three_camera_aspect_expression_resolves_to_constructor(
                initializer,
                constructor_name,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
