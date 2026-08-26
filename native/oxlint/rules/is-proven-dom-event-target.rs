use oxc_ast::{
    AstKind,
    ast::{Expression, TSType, TSTypeName},
};
use oxc_semantic::SymbolId;

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

fn is_proven_dom_event_target<'a>(
    expression: &Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
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
                .filter(|branch| !is_nullish_dom_target_expression(branch, ctx))
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

fn is_nullish_dom_target_expression(
    expression: &Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
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
    ctx: &crate::context::LintContext<'a>,
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

fn symbol_has_dom_event_target_type(
    symbol_id: SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let type_annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator.type_annotation.as_ref(),
        AstKind::FormalParameter(parameter) => parameter.type_annotation.as_ref(),
        _ => None,
    };
    type_annotation.is_some_and(|annotation| {
        is_dom_event_target_type(&annotation.type_annotation, ctx)
    })
}

fn is_dom_event_target_type(
    type_node: &TSType<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> bool {
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
