use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This object enables castShadow or receiveShadow, but the WebGLRenderer used by this owner never enables shadowMap.enabled";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES: [&str; 3] =
    ["AmbientLight", "HemisphereLight", "RectAreaLight"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireShadowsEnabled;

impl RuleMeta for ThreeRequireShadowsEnabled {
    const NAME: &'static str = "three-require-shadows-enabled";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require renderer shadow maps for Three.js shadow users.",
    };
}

impl Rule for ThreeRequireShadowsEnabled {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_shadow_user_candidate = ctx.nodes().iter().any(|node| {
            let AstKind::AssignmentExpression(assignment) = node.kind() else {
                return false;
            };
            assignment.operator == AssignmentOperator::Assign
                && matches!(
                    assignment.right.get_inner_expression(),
                    Expression::BooleanLiteral(literal) if literal.value
                )
                && assignment
                    .left
                    .as_member_expression()
                    .or_else(|| {
                        assignment
                            .left
                            .get_expression()?
                            .get_inner_expression()
                            .as_member_expression()
                    })
                    .and_then(static_member_expression_property_name)
                    .is_some_and(|property_name| {
                        matches!(property_name, "castShadow" | "receiveShadow")
                    })
        });
        if !has_shadow_user_candidate {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut rendered_with = FxHashMap::<Option<NodeId>, FxHashSet<String>>::default();
        let mut shadow_enabled_with = FxHashMap::<Option<NodeId>, FxHashSet<String>>::default();
        let mut shadow_users = Vec::<(Option<NodeId>, Span)>::new();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    let Some(callee) = call_expression.callee.as_member_expression() else {
                        continue;
                    };
                    if static_member_expression_property_name(callee) != Some("render")
                        || three_shadows_constructor_name(callee.object(), &analysis, ctx)
                            .as_deref()
                            != Some("WebGLRenderer")
                    {
                        continue;
                    }
                    let Some(renderer_key) =
                        resolve_expression_key(callee.object(), ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    rendered_with
                        .entry(three_shadows_owner(node, ctx))
                        .or_default()
                        .insert(renderer_key);
                }
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign
                        && matches!(
                            assignment.right.get_inner_expression(),
                            Expression::BooleanLiteral(literal) if literal.value
                        ) =>
                {
                    let Some(target) = assignment.left.as_member_expression().or_else(|| {
                        assignment
                            .left
                            .get_expression()?
                            .get_inner_expression()
                            .as_member_expression()
                    }) else {
                        continue;
                    };
                    let Some(property_name) = static_member_expression_property_name(target) else {
                        continue;
                    };
                    if matches!(property_name, "castShadow" | "receiveShadow") {
                        let Some(constructor_name) =
                            three_shadows_constructor_name(target.object(), &analysis, ctx)
                        else {
                            continue;
                        };
                        if !UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES
                            .contains(&constructor_name.as_str())
                        {
                            shadow_users.push((three_shadows_owner(node, ctx), assignment.span()));
                        }
                        continue;
                    }
                    if property_name != "enabled" {
                        continue;
                    }
                    let Some(shadow_map) = target
                        .object()
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        continue;
                    };
                    if static_member_expression_property_name(shadow_map) != Some("shadowMap")
                        || three_shadows_constructor_name(shadow_map.object(), &analysis, ctx)
                            .as_deref()
                            != Some("WebGLRenderer")
                    {
                        continue;
                    }
                    let Some(renderer_key) =
                        resolve_expression_key(shadow_map.object(), ctx, &mut Vec::new())
                    else {
                        continue;
                    };
                    shadow_enabled_with
                        .entry(three_shadows_owner(node, ctx))
                        .or_default()
                        .insert(renderer_key);
                }
                _ => {}
            }
        }

        for (owner, shadow_user_span) in shadow_users {
            let Some(owner_renderers) = rendered_with.get(&owner) else {
                continue;
            };
            if owner_renderers.iter().all(|renderer_key| {
                shadow_enabled_with
                    .get(&owner)
                    .is_some_and(|enabled_renderers| enabled_renderers.contains(renderer_key))
            }) {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(shadow_user_span));
        }
    }
}

fn three_shadows_owner<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<NodeId> {
    crate::ast_util::get_enclosing_function(node, ctx).map(AstNode::id)
}

fn three_shadows_constructor_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    three_shadows_constructor_name_inner(expression, analysis, ctx, &mut Vec::new())
}

fn three_shadows_constructor_name_inner<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::NewExpression(allocation) => {
            let api_name =
                three_shadows_api_candidate_name(&allocation.callee, ctx, &mut Vec::new())?;
            (module_api_reference_matches(
                &allocation.callee,
                &api_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                &api_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ))
            .then_some(api_name)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
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
            three_shadows_constructor_name_inner(
                declarator.init.as_ref()?,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn three_shadows_api_candidate_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return static_member_expression_property_name(member_expression).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_shadows_api_candidate_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}
