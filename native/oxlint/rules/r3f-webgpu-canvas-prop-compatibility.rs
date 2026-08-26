use oxc_ast::{
    ast::{JSXElementName, JSXMemberExpressionObject, TSModuleReference},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const ROOT_MODULE: &str = "@react-three/fiber";
const LEGACY_MODULE: &str = "@react-three/fiber/legacy";
const WEBGPU_MODULE: &str = "@react-three/fiber/webgpu";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CanvasModule {
    Root,
    Legacy,
    WebGpu,
}

#[derive(Debug, Default, Clone)]
pub struct R3FWebgpuCanvasPropCompatibility;

impl RuleMeta for R3FWebgpuCanvasPropCompatibility {
    const NAME: &'static str = "r3f-webgpu-canvas-prop-compatibility";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow incompatible R3F Canvas renderer props.",
    };
}

impl Rule for R3FWebgpuCanvasPropCompatibility {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some(canvas_module) = resolve_canvas_module(&opening_element.name, ctx) else {
                continue;
            };
            let gl_attribute = get_authoritative_jsx_attribute(opening_element, "gl", true);
            let renderer_attribute =
                get_authoritative_jsx_attribute(opening_element, "renderer", true);
            if let (Some(_), Some(renderer_attribute)) = (gl_attribute, renderer_attribute) {
                ctx.diagnostic(
                    OxcDiagnostic::error(
                        "This Canvas receives both gl and renderer, but R3F accepts only one renderer API",
                    )
                    .with_label(renderer_attribute.span()),
                );
            } else if canvas_module == CanvasModule::WebGpu {
                if let Some(gl_attribute) = gl_attribute {
                    ctx.diagnostic(
                        OxcDiagnostic::error(
                            "The WebGPU Canvas rejects the legacy gl prop. Configure its renderer prop instead",
                        )
                        .with_label(gl_attribute.span()),
                    );
                }
            } else if canvas_module == CanvasModule::Legacy {
                if let Some(renderer_attribute) = renderer_attribute {
                    ctx.diagnostic(
                        OxcDiagnostic::error(
                            "The legacy Canvas rejects the WebGPU renderer prop. Configure its gl prop instead",
                        )
                        .with_label(renderer_attribute.span()),
                    );
                }
            }
        }
    }
}

fn resolve_canvas_module<'a>(
    element_name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> Option<CanvasModule> {
    for (module_source, canvas_module) in [
        (ROOT_MODULE, CanvasModule::Root),
        (LEGACY_MODULE, CanvasModule::Legacy),
        (WEBGPU_MODULE, CanvasModule::WebGpu),
    ] {
        if resolve_jsx_import_api_path(
            element_name,
            |candidate_source| candidate_source == module_source,
            ctx,
        )
        .is_some_and(|api_path| matches!(api_path.as_slice(), [api_name] if api_name == "Canvas"))
        {
            return Some(canvas_module);
        }
    }
    match element_name {
        JSXElementName::IdentifierReference(identifier) => {
            resolve_commonjs_canvas_binding(identifier, ctx, &mut Vec::new())
        }
        JSXElementName::MemberExpression(member_expression)
            if member_expression.property.name == "Canvas" =>
        {
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return None;
            };
            resolve_commonjs_namespace_binding(identifier, ctx, &mut Vec::new())
        }
        _ => None,
    }
}

fn resolve_commonjs_canvas_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<CanvasModule> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return None;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    {
        let initializer = declarator.init.as_ref()?.get_inner_expression();
        if let Some(member_expression) = initializer.as_member_expression() {
            return (member_expression.static_property_name() == Some("Canvas"))
                .then(|| resolve_commonjs_namespace_expression(member_expression.object(), ctx))
                .flatten();
        }
        let oxc_ast::ast::Expression::Identifier(next_identifier) = initializer else {
            return None;
        };
        return resolve_commonjs_canvas_binding(next_identifier, ctx, visited_symbol_ids);
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(object_pattern) = &declarator.id else {
        return None;
    };
    object_pattern
        .properties
        .iter()
        .any(|property| {
            property_key_matches_name(&property.key, "Canvas")
                && property
                    .value
                    .get_binding_identifier()
                    .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        })
        .then(|| resolve_commonjs_namespace_expression(declarator.init.as_ref()?, ctx))
        .flatten()
}

fn resolve_commonjs_namespace_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<CanvasModule> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(declaration) = declaration.kind() {
        let TSModuleReference::ExternalModuleReference(reference) = &declaration.module_reference
        else {
            return None;
        };
        return canvas_module(reference.expression.value.as_str());
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(next_identifier) = initializer {
        return resolve_commonjs_namespace_binding(next_identifier, ctx, visited_symbol_ids);
    }
    resolve_commonjs_namespace_expression(initializer, ctx)
}

fn resolve_commonjs_namespace_expression(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<CanvasModule> {
    global_require_module_source(expression, ctx).and_then(canvas_module)
}

fn canvas_module(module_source: &str) -> Option<CanvasModule> {
    match module_source {
        ROOT_MODULE => Some(CanvasModule::Root),
        LEGACY_MODULE => Some(CanvasModule::Legacy),
        WEBGPU_MODULE => Some(CanvasModule::WebGpu),
        _ => None,
    }
}
