use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, BindingPattern, Expression, JSXAttributeName, JSXAttributeValue,
        MemberExpression, SimpleAssignmentTarget,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const ALWAYS_FRESH_DIRECT_CALLEES: [&str; 12] = [
    "nanoid", "uuid", "uuidv4", "uuidV4", "v4", "cuid", "cuid2", "createId", "ulid", "objectid",
    "ObjectId", "shortid",
];

#[derive(Debug, Default, Clone)]
pub struct NoRandomKey;

declare_oxc_lint!(
    /// Disallow values that change every render as React keys.
    NoRandomKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow changing values as React keys.",
);

impl Rule for NoRandomKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        if !matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name == "key"
        ) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref()
        else {
            return;
        };
        let Some(expression) = container.expression.as_expression() else {
            return;
        };
        let fresh_description = no_random_key_fresh_call_in_subtree(expression, ctx)
            .or_else(|| no_random_key_fresh_update_expression(expression, ctx));
        let Some(fresh_description) = fresh_description else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::error(format!(
                "A changing key makes React rebuild each item, which can reset typed input, focus, and scroll position. Use a stable id from the item instead of `key={{{fresh_description}}}`."
            ))
            .with_label(container.span),
        );
    }
}

fn no_random_key_fresh_call_in_subtree(
    root: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let root_span = root.span();
    ctx.nodes()
        .iter()
        .filter(|candidate| root_span.contains_inclusive(candidate.span()))
        .filter(|candidate| !no_random_key_is_inside_nested_function(candidate, root_span, ctx))
        .find_map(|candidate| no_random_key_always_fresh_description(candidate, ctx))
}

fn no_random_key_is_inside_nested_function(
    candidate: &AstNode<'_>,
    root_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if !root_span.contains_inclusive(ancestor.span()) {
            break;
        }
        if ancestor.span() != root_span
            && matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        {
            return true;
        }
    }
    false
}

fn no_random_key_always_fresh_description(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match node.kind() {
        AstKind::NewExpression(expression)
            if matches!(
                expression.callee.get_inner_expression(),
                Expression::Identifier(identifier) if identifier.name == "Date"
            ) =>
        {
            Some("new Date()".to_string())
        }
        AstKind::CallExpression(call) => {
            let callee = call.callee.get_inner_expression();
            match callee {
                Expression::Identifier(identifier)
                    if ALWAYS_FRESH_DIRECT_CALLEES.contains(&identifier.name.as_str())
                        && !no_random_key_has_same_file_initialized_binding(identifier, ctx) =>
                {
                    Some(format!("{}()", identifier.name))
                }
                Expression::StaticMemberExpression(member) => {
                    let Expression::Identifier(receiver) = member.object.get_inner_expression()
                    else {
                        return None;
                    };
                    no_random_key_member_factory_is_fresh(
                        receiver.name.as_str(),
                        member.property.name.as_str(),
                    )
                    .then(|| format!("{}.{}()", receiver.name, member.property.name))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn no_random_key_member_factory_is_fresh(receiver: &str, property: &str) -> bool {
    match receiver {
        "Math" => property == "random",
        "Date" | "performance" => property == "now",
        "crypto" => matches!(property, "randomUUID" | "getRandomValues" | "randomBytes"),
        _ => false,
    }
}

fn no_random_key_has_same_file_initialized_binding(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if no_random_key_symbol_is_import(symbol_id, ctx) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
            {
                declarator.init.is_some()
            } else {
                no_random_key_pattern_has_default_for_symbol(&declarator.id, symbol_id)
            }
        }
        AstKind::FormalParameter(parameter) => {
            no_random_key_pattern_has_default_for_symbol(&parameter.pattern, symbol_id)
        }
        AstKind::Function(_) | AstKind::Class(_) => true,
        _ => false,
    }
}

fn no_random_key_symbol_is_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn no_random_key_pattern_has_default_for_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(_) => false,
        BindingPattern::AssignmentPattern(assignment) => {
            no_random_key_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern.properties.iter().any(|property| {
                no_random_key_pattern_has_default_for_symbol(&property.value, symbol_id)
            }) || pattern.rest.as_ref().is_some_and(|rest| {
                no_random_key_pattern_has_default_for_symbol(&rest.argument, symbol_id)
            })
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| no_random_key_pattern_has_default_for_symbol(element, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    no_random_key_pattern_has_default_for_symbol(&rest.argument, symbol_id)
                })
        }
    }
}

fn no_random_key_pattern_contains_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            no_random_key_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern
                .properties
                .iter()
                .any(|property| no_random_key_pattern_contains_symbol(&property.value, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    no_random_key_pattern_contains_symbol(&rest.argument, symbol_id)
                })
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| no_random_key_pattern_contains_symbol(element, symbol_id))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    no_random_key_pattern_contains_symbol(&rest.argument, symbol_id)
                })
        }
    }
}

fn no_random_key_fresh_update_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::UpdateExpression(update) => {
            if let SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) = &update.argument
                && !no_random_key_identifier_is_module_scoped(identifier, ctx)
            {
                return None;
            }
            let label = no_random_key_update_argument_label(&update.argument);
            let operator = update.operator.as_str();
            Some(if update.prefix {
                format!("{operator}{label}")
            } else {
                format!("{label}{operator}")
            })
        }
        Expression::AssignmentExpression(assignment)
            if matches!(assignment.operator.as_str(), "+=" | "-=") =>
        {
            if let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
                && !no_random_key_identifier_is_module_scoped(identifier, ctx)
            {
                return None;
            }
            Some(format!("{} side-effect", assignment.operator.as_str()))
        }
        _ => None,
    }
}

fn no_random_key_update_argument_label<'a>(argument: &'a SimpleAssignmentTarget<'a>) -> &'a str {
    match argument {
        SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => identifier.name.as_str(),
        argument => match argument.as_member_expression() {
            Some(MemberExpression::StaticMemberExpression(member)) => member.property.name.as_str(),
            _ => "counter",
        },
    }
}

fn no_random_key_identifier_is_module_scoped(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    !ctx.nodes().ancestors(declaration.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}
