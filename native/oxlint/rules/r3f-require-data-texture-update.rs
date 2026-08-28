use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const DATA_TEXTURE_CONSTRUCTOR_NAMES: [&str; 3] =
    ["DataTexture", "Data3DTexture", "DataArrayTexture"];
const R3F_DATA_TEXTURE_ELEMENT_TYPES: [&str; 3] =
    ["dataTexture", "data3DTexture", "dataArrayTexture"];
const R3F_DATA_TEXTURE_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const THREE_DATA_TEXTURE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const TYPED_ARRAY_MUTATION_METHOD_NAMES: [&str; 5] =
    ["copyWithin", "fill", "reverse", "set", "sort"];
const MESSAGE: &str = "This useFrame callback changes data-texture pixels without setting texture.needsUpdate on every path, so the GPU can keep rendering stale texels";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireDataTextureUpdate;

impl RuleMeta for R3FRequireDataTextureUpdate {
    const NAME: &'static str = "r3f-require-data-texture-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require data-texture uploads after pixel changes.",
    };
}

struct R3fDataTextureMutation {
    node_id: NodeId,
    owner_id: NodeId,
    texture_key: String,
}

struct R3fDataTextureUpdate {
    node_id: NodeId,
    texture_key: String,
}

impl Rule for R3FRequireDataTextureUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !program_references_r3f(ctx) {
            return;
        }
        let managed_ref_symbol_ids = r3f_data_texture_managed_ref_symbol_ids(ctx);
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_DATA_TEXTURE_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_DATA_TEXTURE_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !analyzed_callback_ids.insert(callback_id)
            {
                continue;
            }

            let mut mutations = Vec::new();
            let mut updates = Vec::new();
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    if let Some(receiver) = r3f_data_texture_mutation_receiver(
                        candidate,
                        &managed_ref_symbol_ids,
                        &analysis,
                        ctx,
                    ) && let Some(texture_key) =
                        resolve_expression_key(receiver, ctx, &mut Vec::new())
                        && let Some(owner) = crate::ast_util::get_enclosing_function(candidate, ctx)
                    {
                        mutations.push(R3fDataTextureMutation {
                            node_id: candidate.id(),
                            owner_id: owner.id(),
                            texture_key,
                        });
                    }
                    let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                        return;
                    };
                    let Some(receiver) = r3f_data_texture_update_receiver(assignment) else {
                        return;
                    };
                    if !r3f_expression_resolves_to_data_texture(
                        receiver,
                        &managed_ref_symbol_ids,
                        &analysis,
                        ctx,
                    ) {
                        return;
                    }
                    if let Some(texture_key) =
                        resolve_expression_key(receiver, ctx, &mut Vec::new())
                    {
                        updates.push(R3fDataTextureUpdate {
                            node_id: candidate.id(),
                            texture_key,
                        });
                    }
                },
            );

            for mutation in mutations {
                let matching_update_nodes = updates
                    .iter()
                    .filter(|update| update.texture_key == mutation.texture_key)
                    .map(|update| ctx.nodes().get_node(update.node_id))
                    .collect::<Vec<_>>();
                let mutation_node = ctx.nodes().get_node(mutation.node_id);
                if !do_nodes_cover_every_path_after_node(
                    mutation_node,
                    &matching_update_nodes,
                    ctx.nodes().get_node(mutation.owner_id),
                    ctx,
                ) {
                    ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(mutation_node.span()));
                }
            }
        }
    }
}

fn r3f_data_texture_managed_ref_symbol_ids(
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<SymbolId> {
    let mut managed_ref_symbol_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if !is_r3f_host_intrinsic(opening_element, ctx)
            || resolve_jsx_element_type(opening_element, ctx).is_none_or(|(element_type, _)| {
                !R3F_DATA_TEXTURE_ELEMENT_TYPES.contains(&element_type)
            })
        {
            continue;
        }
        let Some(Expression::Identifier(identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(jsx_attribute_expression)
        else {
            continue;
        };
        if let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) {
            managed_ref_symbol_ids.insert(symbol_id);
        }
    }
    managed_ref_symbol_ids
}

fn r3f_data_texture_mutation_receiver<'a>(
    node: &crate::AstNode<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => {
            let target = assignment.left.as_member_expression().or_else(|| {
                assignment
                    .left
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?;
            r3f_data_texture_assignment_receiver(target, managed_ref_symbol_ids, analysis, ctx)
        }
        AstKind::UpdateExpression(update) => {
            let target = update.argument.as_member_expression().or_else(|| {
                update
                    .argument
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?;
            r3f_data_texture_assignment_receiver(target, managed_ref_symbol_ids, analysis, ctx)
        }
        AstKind::CallExpression(call) => {
            let callee = call.callee.get_inner_expression().as_member_expression()?;
            if !static_member_expression_property_name(callee)
                .is_some_and(|method_name| TYPED_ARRAY_MUTATION_METHOD_NAMES.contains(&method_name))
            {
                return None;
            }
            r3f_data_texture_from_data_expression(
                callee.object(),
                managed_ref_symbol_ids,
                analysis,
                ctx,
                &mut Vec::new(),
            )
        }
        _ => None,
    }
}

fn r3f_data_texture_assignment_receiver<'a>(
    target: &'a MemberExpression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if static_member_expression_property_name(target) == Some("image")
        && r3f_expression_resolves_to_data_texture(
            target.object(),
            managed_ref_symbol_ids,
            analysis,
            ctx,
        )
    {
        return Some(target.object());
    }
    if let Some(receiver) =
        r3f_data_texture_from_member_expression(target, managed_ref_symbol_ids, analysis, ctx)
    {
        return Some(receiver);
    }
    matches!(target, MemberExpression::ComputedMemberExpression(_))
        .then(|| {
            r3f_data_texture_from_data_expression(
                target.object(),
                managed_ref_symbol_ids,
                analysis,
                ctx,
                &mut Vec::new(),
            )
        })
        .flatten()
}

fn r3f_data_texture_from_data_expression<'a>(
    expression: &'a Expression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<&'a Expression<'a>> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && let Some(receiver) = r3f_data_texture_from_member_expression(
            member_expression,
            managed_ref_symbol_ids,
            analysis,
            ctx,
        )
    {
        return Some(receiver);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    r3f_data_texture_from_data_expression(
        declarator.init.as_ref()?,
        managed_ref_symbol_ids,
        analysis,
        ctx,
        visited_symbol_ids,
    )
}

fn r3f_data_texture_from_member_expression<'a>(
    member_expression: &'a MemberExpression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if static_member_expression_property_name(member_expression) != Some("data") {
        return None;
    }
    let image_member = member_expression
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if static_member_expression_property_name(image_member) != Some("image")
        || !r3f_expression_resolves_to_data_texture(
            image_member.object(),
            managed_ref_symbol_ids,
            analysis,
            ctx,
        )
    {
        return None;
    }
    Some(image_member.object())
}

fn r3f_expression_resolves_to_data_texture<'a>(
    expression: &Expression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    r3f_data_texture_react_ref_symbol(expression, ctx)
        .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
        || r3f_data_texture_resolves_to_constructor(expression, analysis, ctx, &mut Vec::new())
}

fn r3f_data_texture_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return DATA_TEXTURE_CONSTRUCTOR_NAMES
            .iter()
            .any(|constructor_name| {
                module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_DATA_TEXTURE_MODULES,
                    analysis,
                    ctx,
                ) || type_import_module_api_reference_matches(
                    &new_expression.callee,
                    constructor_name,
                    &THREE_DATA_TEXTURE_MODULES,
                    analysis,
                    ctx,
                )
            });
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
            r3f_data_texture_resolves_to_constructor(initializer, analysis, ctx, visited_symbol_ids)
        })
}

fn r3f_data_texture_react_ref_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let current_member = expression.get_inner_expression().as_member_expression()?;
    if static_member_expression_property_name(current_member) != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = current_member.object().get_inner_expression() else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return None;
    };
    (is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx))
    .then_some(symbol_id)
}

fn r3f_data_texture_update_receiver<'a>(
    assignment: &'a oxc_ast::ast::AssignmentExpression<'a>,
) -> Option<&'a Expression<'a>> {
    if assignment.operator != AssignmentOperator::Assign
        || !matches!(
            assignment.right.get_inner_expression(),
            Expression::BooleanLiteral(literal) if literal.value
        )
    {
        return None;
    }
    let target = assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    (static_member_expression_property_name(target) == Some("needsUpdate")).then(|| target.object())
}
