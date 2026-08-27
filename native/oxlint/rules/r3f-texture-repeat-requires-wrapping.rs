use oxc_ast::{
    ast::{ArrayExpressionElement, JSXAttributeItem, JSXAttributeValue, TSModuleReference},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_TEXTURE_NAMES: [&str; 9] = [
    "canvasTexture",
    "compressedTexture",
    "data3DTexture",
    "dataArrayTexture",
    "dataTexture",
    "depthTexture",
    "framebufferTexture",
    "texture",
    "videoTexture",
];
const THREE_MODULE_SOURCES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct R3FTextureRepeatRequiresWrapping;

impl RuleMeta for R3FTextureRepeatRequiresWrapping {
    const NAME: &'static str = "r3f-texture-repeat-requires-wrapping";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require repeat wrapping for repeated React Three Fiber textures.",
    };
}

impl Rule for R3FTextureRepeatRequiresWrapping {
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
            if !matches!(
                &opening_element.name,
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if R3F_TEXTURE_NAMES.contains(&identifier.name.as_str())
            ) || opening_element
                .attributes
                .iter()
                .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            {
                continue;
            }
            let Some(repeat_expression) = jsx_attribute_expression(opening_element, "repeat")
            else {
                continue;
            };
            let oxc_ast::ast::Expression::ArrayExpression(repeat_array) =
                repeat_expression.get_inner_expression()
            else {
                continue;
            };
            let Some(repeat_values) = repeat_array
                .elements
                .iter()
                .map(|element| match element {
                    ArrayExpressionElement::SpreadElement(_)
                    | ArrayExpressionElement::Elision(_) => None,
                    _ => element
                        .as_expression()
                        .and_then(|expression| resolve_static_number(expression, ctx)),
                })
                .collect::<Option<Vec<_>>>()
            else {
                continue;
            };
            for (axis_index, repeat_value) in repeat_values.into_iter().take(2).enumerate() {
                if repeat_value <= 1.0 {
                    continue;
                }
                let wrapping_attribute_name = if axis_index == 0 { "wrapS" } else { "wrapT" };
                if jsx_attribute_expression(opening_element, wrapping_attribute_name)
                    .is_some_and(|expression| is_three_repeating_wrapping(expression, ctx))
                {
                    continue;
                }
                let axis_name = if axis_index == 0 { "x" } else { "y" };
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Texture repeat on the {axis_name} axis is greater than one without matching {wrapping_attribute_name} repeat wrapping, so the texture will not tile on that axis"
                    ))
                    .with_label(repeat_expression.span()),
                );
            }
        }
    }
}

fn jsx_attribute_expression<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, attribute_name, true)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    container.expression.as_expression()
}

fn is_three_repeating_wrapping<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ["MirroredRepeatWrapping", "RepeatWrapping"]
        .iter()
        .any(|wrapping_name| {
            module_api_path_matches(
                expression,
                &[*wrapping_name],
                &THREE_MODULE_SOURCES,
                false,
                ctx,
            ) || commonjs_three_api_matches(expression, wrapping_name, ctx, &mut Vec::new())
        })
}

fn commonjs_three_api_matches<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    expected_api_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression.static_property_name() == Some(expected_api_name)
            && is_commonjs_three_namespace(member_expression.object(), ctx, visited_symbol_ids);
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
    if let AstKind::TSImportEqualsDeclaration(declaration) = declaration.kind() {
        let TSModuleReference::QualifiedName(qualified_name) = &declaration.module_reference else {
            return false;
        };
        let oxc_ast::ast::TSTypeName::IdentifierReference(namespace_identifier) =
            &qualified_name.left
        else {
            return false;
        };
        return qualified_name.right.name == expected_api_name
            && is_commonjs_three_namespace_identifier(
                namespace_identifier,
                ctx,
                visited_symbol_ids,
            );
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            commonjs_three_api_matches(initializer, expected_api_name, ctx, visited_symbol_ids)
        });
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        property_key_matches_name(&property.key, expected_api_name)
            && property
                .value
                .get_binding_identifier()
                .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
    }) && declarator.init.as_ref().is_some_and(|initializer| {
        is_commonjs_three_namespace(initializer, ctx, visited_symbol_ids)
    })
}

fn is_commonjs_three_namespace<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if global_require_module_source(expression, ctx).is_some_and(is_three_module_source) {
        return true;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    is_commonjs_three_namespace_identifier(identifier, ctx, visited_symbol_ids)
}

fn is_commonjs_three_namespace_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
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
    if let AstKind::TSImportEqualsDeclaration(declaration) = declaration.kind() {
        let TSModuleReference::ExternalModuleReference(reference) = &declaration.module_reference
        else {
            return false;
        };
        return is_three_module_source(reference.expression.value.as_str());
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            is_commonjs_three_namespace(initializer, ctx, visited_symbol_ids)
        })
}

fn is_three_module_source(source: &str) -> bool {
    source == "three" || source == "three-stdlib" || source.starts_with("three/")
}
