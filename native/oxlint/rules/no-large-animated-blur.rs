use std::borrow::Cow;

use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeName, JSXAttributeValue, ObjectExpression, ObjectProperty,
        ObjectPropertyKind, PropertyKey, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MOTION_ANIMATE_PROPS: [&str; 8] = [
    "animate",
    "initial",
    "exit",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
];
const DOM_EVENT_TARGET_FACTORY_METHOD_NAMES: [&str; 8] = [
    "cloneNode",
    "closest",
    "createElement",
    "createElementNS",
    "elementFromPoint",
    "getElementById",
    "getRootNode",
    "querySelector",
];
const DOM_EVENT_TARGET_MEMBER_NAMES: [&str; 9] = [
    "activeElement",
    "body",
    "documentElement",
    "firstElementChild",
    "lastElementChild",
    "ownerDocument",
    "parentElement",
    "parentNode",
    "shadowRoot",
];
const DOM_EVENT_TARGET_CONSTRUCTOR_NAMES: [&str; 4] =
    ["DocumentFragment", "EventTarget", "Image", "Option"];
static BLUR_VALUE_PATTERN: Lazy<Regex> = lazy_regex!(r"blur\((\d+(?:\.\d+)?)px\)");

#[derive(Debug, Default, Clone)]
pub struct NoLargeAnimatedBlur;

declare_oxc_lint!(
    /// Disallow large animated CSS blurs.
    NoLargeAnimatedBlur,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow large animated CSS blurs.",
);

impl Rule for NoLargeAnimatedBlur {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => check_motion_attribute(attribute, ctx),
            AstKind::CallExpression(call_expression) => {
                check_web_animation_call(call_expression, ctx);
            }
            _ => {}
        }
    }
}

fn check_motion_attribute<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) {
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return;
    };
    if !MOTION_ANIMATE_PROPS.contains(&attribute_name.name.as_str()) {
        return;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return;
    };
    let Some(Expression::ObjectExpression(animation)) = container.expression.as_expression()
    else {
        return;
    };
    for property in object_properties(animation) {
        let Some(property_name) = property_key_identifier_name(&property.key) else {
            continue;
        };
        if !matches!(property_name, "filter" | "backdropFilter" | "WebkitBackdropFilter") {
            continue;
        }
        let Expression::StringLiteral(value) = &property.value else {
            continue;
        };
        let Some(blur_radius) = get_blur_radius(value.value.as_str()) else {
            continue;
        };
        if blur_radius > 10.0 {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Large animated blurs can use significant GPU memory on phones because blur({blur_radius}px) gets heavier as the blur and element grow. Use a smaller blur or a smaller element."
                ))
                .with_label(property.span),
            );
        }
    }
}

fn check_web_animation_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return;
    };
    if member_expression.static_property_name() != Some("animate")
        || !is_proven_dom_event_target(member_expression.object(), ctx, &mut Vec::new())
    {
        return;
    }
    let Some(keyframes) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return;
    };
    match keyframes.get_inner_expression() {
        Expression::ObjectExpression(keyframe) => check_web_animation_keyframe(keyframe, ctx),
        Expression::ArrayExpression(keyframes) => {
            for keyframe in keyframes.elements.iter().filter_map(|element| element.as_expression()) {
                if let Expression::ObjectExpression(keyframe) = keyframe.get_inner_expression() {
                    check_web_animation_keyframe(keyframe, ctx);
                }
            }
        }
        _ => {}
    }
}

fn check_web_animation_keyframe<'a>(
    keyframe: &ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) {
    for property in object_properties(keyframe) {
        let property_name = if property.computed {
            match &property.key {
                PropertyKey::StringLiteral(property_name) => {
                    Some(Cow::Borrowed(property_name.value.as_str()))
                }
                _ => None,
            }
        } else {
            property.key.static_name()
        };
        let Some(property_name) = property_name else {
            continue;
        };
        if !matches!(
            property_name.as_ref(),
            "filter"
                | "backdropFilter"
                | "backdrop-filter"
                | "WebkitBackdropFilter"
                | "-webkit-backdrop-filter"
        ) {
            continue;
        }
        let Expression::StringLiteral(value) = &property.value else {
            continue;
        };
        let Some(blur_radius) = get_blur_radius(value.value.as_str()) else {
            continue;
        };
        if blur_radius > 10.0 {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This Web Animation uses blur({blur_radius}px), which can consume significant GPU memory. Use a smaller blur or animate opacity and transform instead."
                ))
                .with_label(property.span),
            );
        }
    }
}

fn object_properties<'a>(
    object: &'a ObjectExpression<'a>,
) -> impl Iterator<Item = &'a ObjectProperty<'a>> {
    object.properties.iter().filter_map(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => Some(property.as_ref()),
        ObjectPropertyKind::SpreadProperty(_) => None,
    })
}

fn get_blur_radius(value: &str) -> Option<f64> {
    BLUR_VALUE_PATTERN
        .captures(value)
        .and_then(|captures| captures.get(1))
        .and_then(|radius| radius.as_str().parse().ok())
}

fn is_proven_dom_event_target<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if symbol_id.is_none() && matches!(identifier.name.as_str(), "document" | "window") {
                return true;
            }
            let Some(symbol_id) = symbol_id else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            if symbol_has_dom_event_target_type(symbol_id, ctx) {
                return true;
            }
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            is_proven_dom_event_target(initializer, ctx, visited_symbol_ids)
        }
        Expression::NewExpression(new_expression) => {
            is_global_dom_event_target_constructor(&new_expression.callee, ctx, &mut Vec::new())
        }
        Expression::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            member_expression.static_property_name().is_some_and(|method_name| {
                DOM_EVENT_TARGET_FACTORY_METHOD_NAMES.contains(&method_name)
                    && is_proven_dom_event_target(
                        member_expression.object(),
                        ctx,
                        visited_symbol_ids,
                    )
            })
        }
        Expression::ConditionalExpression(conditional) => {
            let branches = [&conditional.consequent, &conditional.alternate];
            let non_nullish_branches = branches
                .into_iter()
                .filter(|branch| !is_nullish_expression(branch, ctx))
                .collect::<Vec<_>>();
            !non_nullish_branches.is_empty()
                && non_nullish_branches.into_iter().all(|branch| {
                    is_proven_dom_event_target(branch, ctx, &mut visited_symbol_ids.clone())
                })
        }
        _ => {
            let Some(member_expression) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = member_expression.static_property_name() else {
                return false;
            };
            let object = member_expression.object().get_inner_expression();
            property_name == "document"
                && matches!(object, Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "window" | "globalThis")
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                || DOM_EVENT_TARGET_MEMBER_NAMES.contains(&property_name)
                    && is_proven_dom_event_target(
                        member_expression.object(),
                        ctx,
                        visited_symbol_ids,
                    )
        }
    }
}

fn is_nullish_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NullLiteral(_))
        || matches!(
            expression.get_inner_expression(),
            Expression::Identifier(identifier)
                if identifier.name == "undefined"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        )
}

fn is_global_dom_event_target_constructor<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if DOM_EVENT_TARGET_CONSTRUCTOR_NAMES.contains(&identifier.name.as_str())
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
        {
            return true;
        }
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
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(declaration) = parent.kind() else {
            return false;
        };
        if !declaration.kind.is_const() {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        visited_symbol_ids.push(symbol_id);
        return is_global_dom_event_target_constructor(initializer, ctx, visited_symbol_ids);
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    let Some(property_name) = member_expression.static_property_name() else {
        return false;
    };
    if !DOM_EVENT_TARGET_CONSTRUCTOR_NAMES.contains(&property_name) {
        return false;
    }
    matches!(member_expression.object().get_inner_expression(), Expression::Identifier(identifier)
        if matches!(identifier.name.as_str(), "window" | "globalThis")
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn symbol_has_dom_event_target_type(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let type_annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator.type_annotation.as_ref(),
        AstKind::FormalParameter(parameter) => parameter.type_annotation.as_ref(),
        _ => None,
    };
    type_annotation.is_some_and(|annotation| is_dom_event_target_type(&annotation.type_annotation, ctx))
}

fn is_dom_event_target_type(type_node: &TSType<'_>, ctx: &LintContext<'_>) -> bool {
    match type_node {
        TSType::TSTypeReference(type_reference) => matches!(
            &type_reference.type_name,
            TSTypeName::IdentifierReference(identifier)
                if is_dom_event_target_type_name(identifier.name.as_str())
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        ),
        TSType::TSUnionType(union) => {
            let mut has_target_type = false;
            for member in &union.types {
                if matches!(member, TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)) {
                    continue;
                }
                if !is_dom_event_target_type(member, ctx) {
                    return false;
                }
                has_target_type = true;
            }
            has_target_type
        }
        _ => false,
    }
}

fn is_dom_event_target_type_name(name: &str) -> bool {
    matches!(
        name,
        "AbortSignal"
            | "Document"
            | "DocumentFragment"
            | "Element"
            | "EventTarget"
            | "HTMLElement"
            | "MediaQueryList"
            | "Node"
            | "ShadowRoot"
            | "SVGElement"
            | "Window"
            | "XMLDocument"
    ) || ((name.starts_with("HTML") || name.starts_with("SVG"))
        && name.ends_with("Element")
        && name[if name.starts_with("HTML") { 4 } else { 3 }..name.len() - 7]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric()))
}
