use oxc_ast::ast::{AssignmentOperator, Class, ClassElement, Expression, TSType, TSTypeName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;

use crate::{AstNode, context::LintContext, rule::Rule};

const REACT_COMPONENT_TYPE_NAMES: [&str; 4] =
    ["ComponentClass", "ComponentType", "FC", "FunctionComponent"];
const REACT_HOOK_NAMES: [&str; 16] = [
    "use",
    "useState",
    "useRef",
    "useMemo",
    "useCallback",
    "useReducer",
    "useContext",
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useImperativeHandle",
    "useSyncExternalStore",
    "useDeferredValue",
    "useTransition",
    "useId",
    "useDebugValue",
];
const REACT_MODULE_SOURCES: [&str; 1] = ["react"];

#[derive(Debug, Default, Clone)]
pub struct NoLegacyContextApi;

declare_oxc_lint!(
    /// Disallow the legacy React context API.
    NoLegacyContextApi,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow the legacy React context API.",
);

impl Rule for NoLegacyContextApi {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::Class(class)
                if is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new()) =>
            {
                report_legacy_class_members(class, ctx);
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                let Some(member_name) = member_expression.static_property_name() else {
                    return;
                };
                if !matches!(member_name, "childContextTypes" | "contextTypes") {
                    return;
                }
                let Expression::Identifier(component) =
                    member_expression.object().get_inner_expression()
                else {
                    return;
                };
                let Some(symbol_id) = ctx
                    .scoping()
                    .get_reference(component.reference_id())
                    .symbol_id()
                else {
                    return;
                };
                if !is_proven_react_component_symbol(
                    symbol_id,
                    component.span.start,
                    ctx,
                    &mut Vec::new(),
                ) && (symbol_has_write_before(symbol_id, component.span.start, ctx)
                    || !symbol_has_react_component_type_annotation(symbol_id, ctx))
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(legacy_context_message(member_name))
                        .with_label(member_expression.span()),
                );
            }
            _ => {}
        }
    }
}

fn report_legacy_class_members(class: &Class<'_>, ctx: &LintContext<'_>) {
    for element in &class.body.body {
        let (key, is_static) = match element {
            ClassElement::MethodDefinition(method) => (&method.key, method.r#static),
            ClassElement::PropertyDefinition(property) => (&property.key, property.r#static),
            _ => continue,
        };
        let Some(member_name) = property_key_identifier_name(key) else {
            continue;
        };
        let has_legacy_shape = if member_name == "getChildContext" {
            !is_static
        } else {
            is_static && matches!(member_name, "childContextTypes" | "contextTypes")
        };
        if has_legacy_shape {
            ctx.diagnostic(
                OxcDiagnostic::error(legacy_context_message(member_name)).with_label(key.span()),
            );
        }
    }
}

fn legacy_context_message(member_name: &str) -> &'static str {
    match member_name {
        "childContextTypes" => {
            "childContextTypes uses the old context API that React 19 removes, so your provider stops passing data. Switch to `createContext` with `<MyContext.Provider value={...}>` & read it with `useContext()`, moving every consumer together."
        }
        "getChildContext" => {
            "getChildContext uses the old context API that React 19 removes, so your provider stops passing data. Switch to `createContext` with `<MyContext.Provider value={...}>` & read it with `useContext()`, moving every consumer together."
        }
        _ => {
            "contextTypes uses the old context API that React 19 removes, so your component stops receiving context. Use `static contextType = MyContext` or `useContext()` in a function component, & update the provider too."
        }
    }
}

fn is_proven_react_class<'a>(
    class: &Class<'a>,
    ctx: &LintContext<'a>,
    visited_class_spans: &mut Vec<oxc_span::Span>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_class_spans.contains(&class.span) {
        return false;
    }
    let Some(super_class) = class.heritage_expression() else {
        return false;
    };
    visited_class_spans.push(class.span);
    is_react_component_class_expression(super_class, ctx, visited_class_spans, visited_symbol_ids)
}

fn is_react_component_class_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_class_spans: &mut Vec<oxc_span::Span>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ClassExpression(class)
            if is_proven_react_class(class, ctx, visited_class_spans, visited_symbol_ids)
    ) {
        return true;
    }
    if ["Component", "PureComponent"].iter().any(|component_name| {
        module_api_path_matches(
            expression,
            &[*component_name],
            &REACT_MODULE_SOURCES,
            true,
            ctx,
        )
    }) && !static_member_was_replaced_before(expression, ctx)
    {
        return true;
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
    if visited_symbol_ids.contains(&symbol_id)
        || symbol_has_write_before(symbol_id, identifier.span.start, ctx)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Class(class) => {
            is_proven_react_class(class, ctx, visited_class_spans, visited_symbol_ids)
        }
        AstKind::VariableDeclarator(declarator) => {
            let parent = ctx.nodes().parent_node(declaration.id());
            matches!(
                parent.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator.init.as_ref().is_some_and(|initializer| {
                is_react_component_class_expression(
                    initializer,
                    ctx,
                    visited_class_spans,
                    visited_symbol_ids,
                )
            })
        }
        _ => false,
    }
}

fn static_member_was_replaced_before<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    let Some(property_name) = member_expression.static_property_name() else {
        return false;
    };
    let Some(namespace_symbol_id) =
        resolve_stable_identifier_symbol(member_expression.object(), ctx)
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= expression.span().start {
            return false;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        let Some(assigned_member) = assignment.left.as_member_expression() else {
            return false;
        };
        assigned_member.static_property_name() == Some(property_name)
            && resolve_stable_identifier_symbol(assigned_member.object(), ctx)
                == Some(namespace_symbol_id)
    })
}

fn has_stable_call_target<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                !symbol_has_write_before(symbol_id, identifier.span.start, ctx)
            });
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name().is_some()
        && matches!(
            member_expression.object().get_inner_expression(),
            Expression::Identifier(_)
        )
        && !static_member_was_replaced_before(callee, ctx)
}

fn is_proven_react_component_symbol<'a>(
    symbol_id: SymbolId,
    reference_offset: u32,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id)
        || symbol_has_write_before(symbol_id, reference_offset, ctx)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => {
            function
                .id
                .as_ref()
                .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str()))
                && function_has_react_component_evidence(declaration, ctx)
        }
        AstKind::Class(class) => {
            is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new())
        }
        AstKind::VariableDeclarator(declarator) => {
            let Some(binding) = declarator.id.get_binding_identifier() else {
                return false;
            };
            is_uppercase_name(binding.name.as_str())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    is_proven_react_component_expression(initializer, ctx, visited_symbol_ids)
                })
        }
        _ => false,
    }
}

fn is_proven_react_component_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                is_proven_react_component_symbol(
                    symbol_id,
                    identifier.span.start,
                    ctx,
                    visited_symbol_ids,
                )
            }),
        Expression::ClassExpression(class) => {
            is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new())
        }
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => ctx
            .nodes()
            .iter()
            .find(|candidate| candidate.span() == expression.span())
            .is_some_and(|function_node| function_has_react_component_evidence(function_node, ctx)),
        Expression::CallExpression(call) => {
            if !has_stable_call_target(call, ctx) {
                return false;
            }
            if module_api_path_matches(&call.callee, &[], &["create-react-class"], true, ctx)
                || is_react_api_call(call, "createClass", ctx)
            {
                return true;
            }
            if ["memo", "forwardRef"]
                .iter()
                .any(|api_name| is_react_api_call(call, api_name, ctx))
            {
                return call
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|wrapped_component| {
                        is_proven_react_component_expression(
                            wrapped_component,
                            ctx,
                            visited_symbol_ids,
                        )
                    });
            }
            if !is_react_api_call(call, "useMemo", ctx) {
                return false;
            }
            let Some(factory) = call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                return false;
            };
            let Some(factory_node) = ctx
                .nodes()
                .iter()
                .find(|candidate| candidate.span() == factory.get_inner_expression().span())
            else {
                return false;
            };
            let returned_expressions = function_return_expressions(factory_node, ctx);
            returned_expressions.len() == 1
                && is_proven_react_component_expression(
                    returned_expressions[0],
                    ctx,
                    visited_symbol_ids,
                )
        }
        Expression::TaggedTemplateExpression(tagged_template) => {
            let Some(factory_root) = styled_factory_root(&tagged_template.tag) else {
                return false;
            };
            !static_member_was_replaced_before(&tagged_template.tag, ctx)
                && (module_api_path_matches(factory_root, &[], &["styled-components"], true, ctx)
                    || module_api_path_matches(
                        factory_root,
                        &["styled"],
                        &["styled-components"],
                        false,
                        ctx,
                    ))
        }
        _ => false,
    }
}

fn function_has_react_component_evidence<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    function_contains_react_render_output(function_node, ctx)
        || function_returns_props_children(function_node, ctx)
        || (function_contains_react_hook_call(function_node, ctx)
            && function_returns_only_null(function_node, ctx))
}

fn function_return_expressions<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    if let AstKind::ArrowFunctionExpression(arrow_function) = function_node.kind()
        && let Some(expression) = arrow_function.get_expression()
    {
        return vec![expression];
    }
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            let nearest_function = ctx.nodes().ancestors(candidate.id()).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })?;
            (nearest_function.id() == function_node.id())
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}

fn function_returns_only_null<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let returned_expressions = function_return_expressions(function_node, ctx);
    !returned_expressions.is_empty()
        && returned_expressions.iter().all(|expression| {
            matches!(
                expression.get_inner_expression(),
                Expression::NullLiteral(_)
            )
        })
}

fn function_contains_react_hook_call<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !function_node.span().contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let nearest_function = ctx.nodes().ancestors(candidate.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        });
        nearest_function.is_some_and(|function| function.id() == function_node.id())
            && is_react_hook_call(call, &REACT_HOOK_NAMES, ctx)
    })
}

fn function_returns_props_children<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(parameters) = (match function_node.kind() {
        AstKind::Function(function) => Some(&function.params),
        AstKind::ArrowFunctionExpression(arrow_function) => Some(&arrow_function.params),
        _ => None,
    }) else {
        return false;
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let mut props_symbol_id = None;
    let mut children_symbol_ids = Vec::new();
    match &first_parameter.pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => {
            props_symbol_id = Some(identifier.symbol_id());
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                if property.computed || !property_key_matches_name(&property.key, "children") {
                    continue;
                }
                if let Some(identifier) = property.value.get_binding_identifier() {
                    children_symbol_ids.push(identifier.symbol_id());
                }
            }
        }
        _ => {}
    }
    function_return_expressions(function_node, ctx)
        .into_iter()
        .any(
            |returned_expression| match returned_expression.get_inner_expression() {
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| {
                        children_symbol_ids.contains(&symbol_id)
                            && !symbol_has_write_before(symbol_id, identifier.span.start, ctx)
                    }),
                expression => expression
                    .as_member_expression()
                    .is_some_and(|member_expression| {
                        if member_expression.static_property_name() != Some("children") {
                            return false;
                        }
                        let Expression::Identifier(receiver) =
                            member_expression.object().get_inner_expression()
                        else {
                            return false;
                        };
                        ctx.scoping()
                            .get_reference(receiver.reference_id())
                            .symbol_id()
                            .is_some_and(|symbol_id| {
                                props_symbol_id == Some(symbol_id)
                                    && !symbol_has_write_before(symbol_id, receiver.span.start, ctx)
                            })
                    }),
            },
        )
}

fn styled_factory_root<'a>(expression: &'a Expression<'a>) -> Option<&'a Expression<'a>> {
    match expression.get_inner_expression() {
        identifier @ Expression::Identifier(_) => Some(identifier),
        expression => {
            if let Some(member_expression) = expression.as_member_expression() {
                return styled_factory_root(member_expression.object());
            }
            let Expression::CallExpression(call) = expression else {
                return None;
            };
            styled_factory_root(&call.callee)
        }
    }
}

fn symbol_has_write_before(
    symbol_id: SymbolId,
    reference_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| ctx.nodes().get_node(reference.node_id()).span().start < reference_offset)
}

fn symbol_has_react_component_type_annotation(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(type_annotation) = &declarator.type_annotation else {
        return false;
    };
    type_node_proves_react_component(&type_annotation.type_annotation, ctx, &mut Vec::new())
}

fn type_node_proves_react_component<'a>(
    type_node: &TSType<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match type_node {
        TSType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .any(|member| type_node_proves_react_component(member, ctx, visited_symbol_ids)),
        TSType::TSParenthesizedType(parenthesized) => type_node_proves_react_component(
            &parenthesized.type_annotation,
            ctx,
            visited_symbol_ids,
        ),
        TSType::TSTypeReference(type_reference) => {
            type_name_proves_react_component(&type_reference.type_name, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn type_name_proves_react_component<'a>(
    type_name: &TSTypeName<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match type_name {
        TSTypeName::QualifiedName(qualified_name) => {
            if !REACT_COMPONENT_TYPE_NAMES.contains(&qualified_name.right.name.as_str()) {
                return false;
            }
            let TSTypeName::IdentifierReference(namespace) = &qualified_name.left else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(namespace.reference_id())
                .symbol_id()
            else {
                return false;
            };
            react_import_for_symbol(symbol_id, ctx).is_some_and(|entry| {
                matches!(
                    entry.import_name,
                    crate::module_record::ImportImportName::Default(_)
                        | crate::module_record::ImportImportName::NamespaceObject
                )
            })
        }
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if react_import_for_symbol(symbol_id, ctx).is_some_and(|entry| {
                matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if REACT_COMPONENT_TYPE_NAMES.contains(&imported_name.name())
                )
            }) {
                return true;
            }
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(
                declaration.kind(),
                AstKind::TSTypeAliasDeclaration(alias)
                    if type_node_proves_react_component(
                        &alias.type_annotation,
                        ctx,
                        visited_symbol_ids,
                    )
            )
        }
        TSTypeName::ThisExpression(_) => false,
    }
}

fn react_import_for_symbol<'a>(
    symbol_id: SymbolId,
    ctx: &'a LintContext<'_>,
) -> Option<&'a crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn is_uppercase_name(name: &str) -> bool {
    name.chars()
        .next()
        .is_some_and(|character| character.is_uppercase())
}
