#[derive(Clone, Copy)]
struct ContentEditablePossibilities {
    can_be_disabled: bool,
    can_be_enabled: bool,
    can_be_inherited: bool,
}

const ENABLED_CONTENT_EDITABLE: ContentEditablePossibilities = ContentEditablePossibilities {
    can_be_disabled: false,
    can_be_enabled: true,
    can_be_inherited: false,
};
const DISABLED_CONTENT_EDITABLE: ContentEditablePossibilities = ContentEditablePossibilities {
    can_be_disabled: true,
    can_be_enabled: false,
    can_be_inherited: false,
};
const INHERITED_CONTENT_EDITABLE: ContentEditablePossibilities = ContentEditablePossibilities {
    can_be_disabled: false,
    can_be_enabled: false,
    can_be_inherited: true,
};
const UNKNOWN_CONTENT_EDITABLE: ContentEditablePossibilities = ContentEditablePossibilities {
    can_be_disabled: true,
    can_be_enabled: true,
    can_be_inherited: true,
};

fn can_content_editable_be_tabbable<'a>(
    node: &crate::AstNode<'a>,
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(possibilities) = get_content_editable_possibilities(opening_element, ctx) else {
        return false;
    };
    possibilities.can_be_enabled && !has_definitely_enabled_content_editable_ancestor(node, ctx)
}

fn has_definitely_enabled_content_editable_ancestor<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let mut did_skip_current_element = false;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        if !did_skip_current_element {
            did_skip_current_element = true;
            continue;
        }
        if !crate::globals::HTML_TAG.contains(
            crate::utils::get_element_type(ctx, &element.opening_element).as_ref(),
        ) {
            return false;
        }
        let Some(possibilities) =
            get_content_editable_possibilities(&element.opening_element, ctx)
        else {
            continue;
        };
        if possibilities.can_be_enabled
            && !possibilities.can_be_disabled
            && !possibilities.can_be_inherited
        {
            return true;
        }
        if !(possibilities.can_be_inherited
            && !possibilities.can_be_disabled
            && !possibilities.can_be_enabled)
        {
            return false;
        }
    }
    false
}

fn get_content_editable_possibilities<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> Option<ContentEditablePossibilities> {
    let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) =
        crate::utils::has_jsx_prop_ignore_case(opening_element, "contenteditable")?
    else {
        return Some(UNKNOWN_CONTENT_EDITABLE);
    };
    let Some(value) = attribute.value.as_ref() else {
        return Some(ENABLED_CONTENT_EDITABLE);
    };
    Some(match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            content_editable_string_value(string_literal.value.as_str())
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .map_or(UNKNOWN_CONTENT_EDITABLE, |expression| {
                resolve_content_editable_expression(expression, ctx, &mut Vec::new())
            }),
        _ => UNKNOWN_CONTENT_EDITABLE,
    })
}

fn resolve_content_editable_expression<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> ContentEditablePossibilities {
    use oxc_ast::ast::Expression;

    match expression.get_inner_expression() {
        Expression::BooleanLiteral(boolean_literal) => {
            if boolean_literal.value {
                ENABLED_CONTENT_EDITABLE
            } else {
                DISABLED_CONTENT_EDITABLE
            }
        }
        Expression::StringLiteral(string_literal) => {
            content_editable_string_value(string_literal.value.as_str())
        }
        Expression::ConditionalExpression(conditional_expression) => merge_content_editable(
            resolve_content_editable_expression(
                &conditional_expression.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
            resolve_content_editable_expression(
                &conditional_expression.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
        ),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return UNKNOWN_CONTENT_EDITABLE;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return UNKNOWN_CONTENT_EDITABLE;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return UNKNOWN_CONTENT_EDITABLE;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return UNKNOWN_CONTENT_EDITABLE;
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return UNKNOWN_CONTENT_EDITABLE;
            }
            let Some(initializer) = declarator.init.as_ref() else {
                return UNKNOWN_CONTENT_EDITABLE;
            };
            visited_symbol_ids.push(symbol_id);
            let possibilities =
                resolve_content_editable_expression(initializer, ctx, visited_symbol_ids);
            visited_symbol_ids.pop();
            possibilities
        }
        Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => INHERITED_CONTENT_EDITABLE,
        _ => UNKNOWN_CONTENT_EDITABLE,
    }
}

fn content_editable_string_value(value: &str) -> ContentEditablePossibilities {
    match value.to_ascii_lowercase().as_str() {
        "" | "plaintext-only" | "true" => ENABLED_CONTENT_EDITABLE,
        "false" => DISABLED_CONTENT_EDITABLE,
        _ => INHERITED_CONTENT_EDITABLE,
    }
}

fn merge_content_editable(
    left: ContentEditablePossibilities,
    right: ContentEditablePossibilities,
) -> ContentEditablePossibilities {
    ContentEditablePossibilities {
        can_be_disabled: left.can_be_disabled || right.can_be_disabled,
        can_be_enabled: left.can_be_enabled || right.can_be_enabled,
        can_be_inherited: left.can_be_inherited || right.can_be_inherited,
    }
}
