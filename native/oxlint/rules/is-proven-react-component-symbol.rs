use oxc_ast::{
    AstKind as ReactComponentAstKind,
    ast::{
        Class as ReactComponentClass, Expression as ReactComponentExpression,
        TSType as ReactComponentType, TSTypeName as ReactComponentTypeName,
    },
};
use oxc_semantic::SymbolId as ReactComponentSymbolId;

use crate::{AstNode as ReactComponentAstNode, context::LintContext as ReactComponentLintContext};

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

fn is_proven_react_class<'a>(
    class: &ReactComponentClass<'a>,
    ctx: &ReactComponentLintContext<'a>,
    visited_class_spans: &mut Vec<oxc_span::Span>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
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
    expression: &ReactComponentExpression<'a>,
    ctx: &ReactComponentLintContext<'a>,
    visited_class_spans: &mut Vec<oxc_span::Span>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        ReactComponentExpression::ClassExpression(class)
            if is_proven_react_class(class, ctx, visited_class_spans, visited_symbol_ids)
    ) {
        return true;
    }
    if let Some(member_expression) = expression.as_member_expression() {
        let Some(component_name) = member_expression.static_property_name() else {
            return false;
        };
        let ReactComponentExpression::Identifier(receiver) =
            member_expression.object().get_inner_expression()
        else {
            return false;
        };
        return matches!(component_name, "Component" | "PureComponent")
            && !static_member_was_replaced_before(expression, ctx)
            && identifier_symbol_id_with_lexical_fallback(receiver, ctx).is_some_and(
                |symbol_id| react_component_class_import_matches(symbol_id, true, ctx),
            );
    }
    let ReactComponentExpression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id)
        || symbol_has_write_before(symbol_id, identifier.span.start, ctx)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    if react_component_class_import_matches(symbol_id, false, ctx) {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        ReactComponentAstKind::Class(class) => {
            is_proven_react_class(class, ctx, visited_class_spans, visited_symbol_ids)
        }
        ReactComponentAstKind::VariableDeclarator(declarator) => {
            let parent = ctx.nodes().parent_node(declaration.id());
            matches!(
                parent.kind(),
                ReactComponentAstKind::VariableDeclaration(variable_declaration)
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

fn react_component_class_import_matches(
    mut symbol_id: ReactComponentSymbolId,
    is_namespace: bool,
    ctx: &ReactComponentLintContext<'_>,
) -> bool {
    let mut visited_symbol_ids = Vec::new();
    while is_namespace {
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let ReactComponentAstKind::VariableDeclarator(declarator) = declaration.kind() else {
            break;
        };
        if !matches!(ctx.nodes().parent_node(declaration.id()).kind(),
            ReactComponentAstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return false;
        }
        let Some(ReactComponentExpression::Identifier(identifier)) = declarator
            .init
            .as_ref()
            .map(|initializer| initializer.get_inner_expression())
        else {
            return false;
        };
        let Some(next_symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx)
        else {
            return false;
        };
        symbol_id = next_symbol_id;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let matching_specifier = match declaration.kind() {
        ReactComponentAstKind::ImportDefaultSpecifier(_)
        | ReactComponentAstKind::ImportNamespaceSpecifier(_) => is_namespace,
        ReactComponentAstKind::ImportSpecifier(specifier) => {
            let imported_name = specifier.imported.name();
            if is_namespace {
                imported_name == "default"
            } else {
                matches!(imported_name.as_str(), "Component" | "PureComponent")
            }
        }
        _ => false,
    };
    matching_specifier
        && matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            ReactComponentAstKind::ImportDeclaration(import)
                if REACT_RUNTIME_MODULE_SOURCES.contains(&import.source.value.as_str())
        )
}

fn static_member_was_replaced_before<'a>(
    expression: &ReactComponentExpression<'a>,
    ctx: &ReactComponentLintContext<'a>,
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
        let ReactComponentAstKind::AssignmentExpression(assignment) = candidate.kind() else {
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
    ctx: &ReactComponentLintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let ReactComponentExpression::Identifier(identifier) = callee {
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
            ReactComponentExpression::Identifier(_)
        )
        && !static_member_was_replaced_before(callee, ctx)
}

fn is_proven_react_component_symbol<'a>(
    symbol_id: ReactComponentSymbolId,
    reference_offset: u32,
    ctx: &ReactComponentLintContext<'a>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
) -> bool {
    if visited_symbol_ids.contains(&symbol_id)
        || symbol_has_write_before(symbol_id, reference_offset, ctx)
    {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        ReactComponentAstKind::Function(function) => {
            function
                .id
                .as_ref()
                .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str()))
                && function_has_react_component_evidence(declaration, ctx)
        }
        ReactComponentAstKind::Class(class) => {
            is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new())
        }
        ReactComponentAstKind::VariableDeclarator(declarator) => {
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
    expression: &'a ReactComponentExpression<'a>,
    ctx: &ReactComponentLintContext<'a>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        ReactComponentExpression::Identifier(identifier) => ctx
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
        ReactComponentExpression::ClassExpression(class) => {
            is_proven_react_class(class, ctx, &mut Vec::new(), &mut Vec::new())
        }
        ReactComponentExpression::ArrowFunctionExpression(_)
        | ReactComponentExpression::FunctionExpression(_) => ctx
            .nodes()
            .iter()
            .find(|candidate| candidate.span() == expression.span())
            .is_some_and(|function_node| function_has_react_component_evidence(function_node, ctx)),
        ReactComponentExpression::CallExpression(call) => {
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
        ReactComponentExpression::TaggedTemplateExpression(tagged_template) => {
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
    function_node: &ReactComponentAstNode<'a>,
    ctx: &ReactComponentLintContext<'a>,
) -> bool {
    function_contains_react_render_output(function_node, ctx)
        || function_returns_props_children(function_node, ctx)
        || (function_contains_react_hook_call(function_node, ctx)
            && function_returns_only_null(function_node, ctx))
}

fn function_return_expressions<'a>(
    function_node: &ReactComponentAstNode<'a>,
    ctx: &ReactComponentLintContext<'a>,
) -> Vec<&'a ReactComponentExpression<'a>> {
    if let ReactComponentAstKind::ArrowFunctionExpression(arrow_function) = function_node.kind()
        && let Some(expression) = arrow_function.get_expression()
    {
        return vec![expression];
    }
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let ReactComponentAstKind::ReturnStatement(return_statement) = candidate.kind() else {
                return None;
            };
            let nearest_function = ctx.nodes().ancestors(candidate.id()).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    ReactComponentAstKind::Function(_)
                        | ReactComponentAstKind::ArrowFunctionExpression(_)
                )
            })?;
            (nearest_function.id() == function_node.id())
                .then(|| return_statement.argument.as_ref())
                .flatten()
        })
        .collect()
}

fn function_returns_only_null<'a>(
    function_node: &ReactComponentAstNode<'a>,
    ctx: &ReactComponentLintContext<'a>,
) -> bool {
    let returned_expressions = function_return_expressions(function_node, ctx);
    !returned_expressions.is_empty()
        && returned_expressions.iter().all(|expression| {
            matches!(
                expression.get_inner_expression(),
                ReactComponentExpression::NullLiteral(_)
            )
        })
}

fn function_contains_react_hook_call<'a>(
    function_node: &ReactComponentAstNode<'a>,
    ctx: &ReactComponentLintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !function_node.span().contains_inclusive(candidate.span()) {
            return false;
        }
        let ReactComponentAstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let nearest_function = ctx.nodes().ancestors(candidate.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                ReactComponentAstKind::Function(_)
                    | ReactComponentAstKind::ArrowFunctionExpression(_)
            )
        });
        nearest_function.is_some_and(|function| function.id() == function_node.id())
            && is_react_hook_call(call, &REACT_HOOK_NAMES, ctx)
    })
}

fn function_returns_props_children<'a>(
    function_node: &ReactComponentAstNode<'a>,
    ctx: &ReactComponentLintContext<'a>,
) -> bool {
    let Some(parameters) = (match function_node.kind() {
        ReactComponentAstKind::Function(function) => Some(&function.params),
        ReactComponentAstKind::ArrowFunctionExpression(arrow_function) => {
            Some(&arrow_function.params)
        }
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
                ReactComponentExpression::Identifier(identifier) => ctx
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
                        let ReactComponentExpression::Identifier(receiver) =
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

fn styled_factory_root<'a>(
    expression: &'a ReactComponentExpression<'a>,
) -> Option<&'a ReactComponentExpression<'a>> {
    match expression.get_inner_expression() {
        identifier @ ReactComponentExpression::Identifier(_) => Some(identifier),
        expression => {
            if let Some(member_expression) = expression.as_member_expression() {
                return styled_factory_root(member_expression.object());
            }
            let ReactComponentExpression::CallExpression(call) = expression else {
                return None;
            };
            styled_factory_root(&call.callee)
        }
    }
}

fn symbol_has_react_component_type_annotation(
    symbol_id: ReactComponentSymbolId,
    ctx: &ReactComponentLintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let ReactComponentAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(type_annotation) = &declarator.type_annotation else {
        return false;
    };
    type_node_proves_react_component(&type_annotation.type_annotation, ctx, &mut Vec::new())
}

fn type_node_proves_react_component<'a>(
    type_node: &ReactComponentType<'a>,
    ctx: &ReactComponentLintContext<'a>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
) -> bool {
    match type_node {
        ReactComponentType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .any(|member| type_node_proves_react_component(member, ctx, visited_symbol_ids)),
        ReactComponentType::TSParenthesizedType(parenthesized) => type_node_proves_react_component(
            &parenthesized.type_annotation,
            ctx,
            visited_symbol_ids,
        ),
        ReactComponentType::TSTypeReference(type_reference) => {
            type_name_proves_react_component(&type_reference.type_name, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn type_name_proves_react_component<'a>(
    type_name: &ReactComponentTypeName<'a>,
    ctx: &ReactComponentLintContext<'a>,
    visited_symbol_ids: &mut Vec<ReactComponentSymbolId>,
) -> bool {
    match type_name {
        ReactComponentTypeName::QualifiedName(qualified_name) => {
            if !REACT_COMPONENT_TYPE_NAMES.contains(&qualified_name.right.name.as_str()) {
                return false;
            }
            let ReactComponentTypeName::IdentifierReference(namespace) = &qualified_name.left
            else {
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
        ReactComponentTypeName::IdentifierReference(identifier) => {
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
                ReactComponentAstKind::TSTypeAliasDeclaration(alias)
                    if type_node_proves_react_component(
                        &alias.type_annotation,
                        ctx,
                        visited_symbol_ids,
                    )
            )
        }
        ReactComponentTypeName::ThisExpression(_) => false,
    }
}

fn react_import_for_symbol<'a>(
    symbol_id: ReactComponentSymbolId,
    ctx: &'a ReactComponentLintContext<'_>,
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
