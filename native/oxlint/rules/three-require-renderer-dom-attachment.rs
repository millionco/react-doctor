use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This WebGLRenderer renders frames but its generated domElement is never attached. Pass a mounted canvas to the constructor or append the renderer canvas to a DOM container";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_DOM_ATTACHMENT_METHOD_NAMES: [&str; 5] = [
    "append",
    "appendChild",
    "insertBefore",
    "prepend",
    "replaceChildren",
];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireRendererDomAttachment;

impl RuleMeta for ThreeRequireRendererDomAttachment {
    const NAME: &'static str = "three-require-renderer-dom-attachment";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require generated WebGLRenderer canvases to be attached to the DOM.",
    };
}

struct ThreeRendererDomConstruction {
    binding_symbol_id: SymbolId,
    key: String,
    node_id: NodeId,
}

impl Rule for ThreeRequireRendererDomAttachment {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_candidate = ctx.nodes().iter().any(|node| {
            let AstKind::NewExpression(allocation) = node.kind() else {
                return false;
            };
            three_renderer_dom_candidate_api_name(&allocation.callee, ctx, &mut Vec::new())
                .as_deref()
                == Some("WebGLRenderer")
        });
        if !has_candidate {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut attached_renderer_keys = rustc_hash::FxHashSet::default();
        let mut rendered_renderer_keys = rustc_hash::FxHashSet::default();
        let mut constructions = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::NewExpression(allocation) => {
                    if !three_renderer_dom_constructor_callee_matches(
                        &allocation.callee,
                        &analysis,
                        ctx,
                    ) {
                        continue;
                    }
                    if let Some(parameters_argument) = allocation.arguments.first() {
                        let Some(parameters) = parameters_argument.as_expression() else {
                            continue;
                        };
                        let Expression::ObjectExpression(object) = parameters else {
                            continue;
                        };
                        if object.properties.iter().any(|property| {
                            matches!(
                                property,
                                oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_)
                            )
                        }) || get_static_object_property_value(parameters, "canvas").is_some()
                        {
                            continue;
                        }
                    }
                    let declarator_node = ctx.nodes().parent_node(node.id());
                    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                        continue;
                    };
                    if declarator
                        .init
                        .as_ref()
                        .is_none_or(|initializer| initializer.span() != node.span())
                    {
                        continue;
                    }
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    if !matches!(
                        ctx.nodes().parent_node(declarator_node.id()).kind(),
                        AstKind::VariableDeclaration(variable_declaration)
                            if variable_declaration.kind.is_const()
                    ) {
                        continue;
                    }
                    let binding_symbol_id = binding.symbol_id();
                    constructions.push(ThreeRendererDomConstruction {
                        binding_symbol_id,
                        key: format!("symbol:{}", binding_symbol_id.index()),
                        node_id: node.id(),
                    });
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(callee) = call_expression
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                    else {
                        continue;
                    };
                    let Some(method_name) = static_member_expression_property_name(callee) else {
                        continue;
                    };
                    if method_name == "render"
                        && three_renderer_dom_expression_resolves_to_renderer(
                            callee.object(),
                            &analysis,
                            ctx,
                            &mut Vec::new(),
                        )
                        && let Some(renderer_key) =
                            resolve_expression_key(callee.object(), ctx, &mut Vec::new())
                    {
                        rendered_renderer_keys.insert(renderer_key);
                    }
                    if !THREE_RENDERER_DOM_ATTACHMENT_METHOD_NAMES.contains(&method_name) {
                        continue;
                    }
                    for argument in &call_expression.arguments {
                        let Some(argument_expression) = argument.as_expression() else {
                            continue;
                        };
                        let Some(dom_element) = argument_expression
                            .get_inner_expression()
                            .as_member_expression()
                        else {
                            continue;
                        };
                        if static_member_expression_property_name(dom_element) != Some("domElement")
                        {
                            continue;
                        }
                        let Some(renderer_key) =
                            resolve_expression_key(dom_element.object(), ctx, &mut Vec::new())
                        else {
                            continue;
                        };
                        if constructions
                            .iter()
                            .any(|construction| construction.key == renderer_key)
                        {
                            attached_renderer_keys.insert(renderer_key);
                        }
                    }
                }
                _ => {}
            }
        }

        for construction in constructions {
            if !rendered_renderer_keys.contains(&construction.key)
                || attached_renderer_keys.contains(&construction.key)
                || three_renderer_dom_element_escapes(&construction, ctx)
            {
                continue;
            }
            let construction_node = ctx.nodes().get_node(construction.node_id);
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(construction_node.span()));
        }
    }
}

fn three_renderer_dom_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_member_expression_property_name(member).map(str::to_string);
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
            return three_renderer_dom_candidate_api_name(
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

fn three_renderer_dom_constructor_callee_matches<'a>(
    callee: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    module_api_reference_matches(callee, "WebGLRenderer", &THREE_MODULES, analysis, ctx)
        || type_import_module_api_reference_matches(
            callee,
            "WebGLRenderer",
            &THREE_MODULES,
            analysis,
            ctx,
        )
}

fn three_renderer_dom_expression_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return three_renderer_dom_constructor_callee_matches(&allocation.callee, analysis, ctx);
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
            three_renderer_dom_expression_resolves_to_renderer(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_renderer_dom_element_escapes(
    construction: &ThreeRendererDomConstruction,
    ctx: &LintContext<'_>,
) -> bool {
    for reference in ctx
        .scoping()
        .get_resolved_references(construction.binding_symbol_id)
    {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let reference_root = transparent_expression_root(reference_node, ctx);
        let member_node = ctx.nodes().parent_node(reference_root.id());
        let Some(member) = member_node.kind().as_member_expression_kind() else {
            return true;
        };
        if member.object().span() != reference_root.span() {
            return true;
        }
        if member.static_property_name().as_deref() != Some("domElement") {
            continue;
        }
        let parent = ctx.nodes().parent_node(member_node.id());
        if parent
            .kind()
            .as_member_expression_kind()
            .is_some_and(|parent_member| parent_member.object().span() == member_node.span())
        {
            continue;
        }
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            return true;
        };
        if !call_expression
            .arguments
            .iter()
            .any(|argument| argument.span() == member_node.span())
        {
            return true;
        }
        let Some(callee) = call_expression.callee.as_member_expression() else {
            return true;
        };
        if static_member_expression_property_name(callee).is_none_or(|method_name| {
            !THREE_RENDERER_DOM_ATTACHMENT_METHOD_NAMES.contains(&method_name)
        }) {
            return true;
        }
    }
    false
}
