use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, BindingPattern, Expression, FunctionBody, FunctionType,
        JSXAttributeName, JSXAttributeValue, JSXExpression, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DEFERRABLE_HOOK_NAMES: [&str; 3] = ["useSearchParams", "useParams", "usePathname"];

#[derive(Debug, Default, Clone)]
pub struct RerenderDeferReadsHook;

struct HookBinding<'a> {
    symbol_id: SymbolId,
    hook_name: &'a str,
    declarator_span: Span,
}

struct ExactAlias {
    source_symbol_id: SymbolId,
    alias_symbol_id: SymbolId,
    source_node_id: NodeId,
}

declare_oxc_lint!(
    /// Warns when a URL hook value is read only inside event handlers.
    RerenderDeferReadsHook,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a URL hook value is read only inside event handlers.",
);

impl Rule for RerenderDeferReadsHook {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut handler_attributes = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXAttribute(attribute) = node.kind() else {
                    return None;
                };
                if !is_event_handler_attribute_name(&attribute.name) {
                    return None;
                }
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    return None;
                };
                let JSXExpression::Identifier(identifier) = &container.expression else {
                    return None;
                };
                Some((node.span().start, identifier.name.to_string()))
            })
            .collect::<Vec<_>>();
        handler_attributes.sort_unstable_by_key(|(start, _)| *start);

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            is_uppercase_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        inspect_component_body(body, &handler_attributes, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                inspect_component_body(body, &handler_attributes, ctx);
                            }
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                inspect_component_body(body, &handler_attributes, ctx);
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn inspect_component_body<'a>(
    body: &'a FunctionBody<'a>,
    handler_attributes: &[(u32, String)],
    ctx: &LintContext<'a>,
) {
    let bindings = find_hook_bindings(body);
    if bindings.is_empty() {
        return;
    }
    let aliases = collect_exact_aliases(body, ctx);
    let mut aliases_by_source = FxHashMap::<SymbolId, Vec<&ExactAlias>>::default();
    for alias in &aliases {
        aliases_by_source
            .entry(alias.source_symbol_id)
            .or_default()
            .push(alias);
    }
    let handler_names = handler_names_within_span(body.span, handler_attributes);

    for binding in bindings {
        let mut symbol_ids = FxHashSet::default();
        symbol_ids.insert(binding.symbol_id);
        let mut alias_source_node_ids = FxHashSet::default();
        let mut pending_symbol_ids = vec![binding.symbol_id];
        while let Some(source_symbol_id) = pending_symbol_ids.pop() {
            for alias in aliases_by_source
                .get(&source_symbol_id)
                .into_iter()
                .flatten()
            {
                if symbol_ids.insert(alias.alias_symbol_id) {
                    alias_source_node_ids.insert(alias.source_node_id);
                    pending_symbol_ids.push(alias.alias_symbol_id);
                }
            }
        }

        let mut reference_count = 0;
        let all_references_are_in_handlers = symbol_ids.iter().all(|symbol_id| {
            ctx.scoping()
                .get_resolved_references(*symbol_id)
                .filter(|reference| !alias_source_node_ids.contains(&reference.node_id()))
                .all(|reference| {
                    reference_count += 1;
                    reference_is_inside_event_handler(reference.node_id(), &handler_names, ctx)
                })
        });
        if reference_count == 0 || !all_references_are_in_handlers {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{}() redraws your component on every URL change even though it's only read inside event handlers.",
                binding.hook_name
            ))
            .with_label(binding.declarator_span),
        );
    }
}

fn find_hook_bindings<'a>(body: &'a FunctionBody<'a>) -> Vec<HookBinding<'a>> {
    let mut bindings = Vec::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = &declarator.init else {
                continue;
            };
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            if !DEFERRABLE_HOOK_NAMES.contains(&callee.name.as_str()) {
                continue;
            }
            bindings.push(HookBinding {
                symbol_id: identifier.symbol_id(),
                hook_name: callee.name.as_str(),
                declarator_span: declarator.span,
            });
        }
    }
    bindings
}

fn collect_exact_aliases(body: &FunctionBody<'_>, ctx: &LintContext<'_>) -> Vec<ExactAlias> {
    let mut aliases = Vec::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        if !declaration.kind.is_const() {
            continue;
        }
        for declarator in &declaration.declarations {
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let exact_alias = match &declarator.id {
                BindingPattern::BindingIdentifier(alias) => {
                    let Expression::Identifier(source) = initializer.get_inner_expression() else {
                        continue;
                    };
                    Some((alias.symbol_id(), source))
                }
                BindingPattern::ArrayPattern(pattern) if pattern.elements.len() == 1 => {
                    let Some(Some(BindingPattern::BindingIdentifier(alias))) =
                        pattern.elements.first()
                    else {
                        continue;
                    };
                    let Expression::ArrayExpression(array) = initializer.get_inner_expression()
                    else {
                        continue;
                    };
                    let [array_element] = array.elements.as_slice() else {
                        continue;
                    };
                    let Some(Expression::Identifier(source)) =
                        ArrayExpressionElement::as_expression(array_element)
                            .map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    Some((alias.symbol_id(), source))
                }
                _ => None,
            };
            let Some((alias_symbol_id, source)) = exact_alias else {
                continue;
            };
            let Some(source_symbol_id) = ctx
                .scoping()
                .get_reference(source.reference_id())
                .symbol_id()
            else {
                continue;
            };
            aliases.push(ExactAlias {
                source_symbol_id,
                alias_symbol_id,
                source_node_id: source.node_id.get(),
            });
        }
    }
    aliases
}

fn handler_names_within_span(
    body_span: Span,
    handler_attributes: &[(u32, String)],
) -> FxHashSet<&str> {
    let start_index = handler_attributes.partition_point(|(start, _)| *start < body_span.start);
    handler_attributes[start_index..]
        .iter()
        .take_while(|(start, _)| *start <= body_span.end)
        .filter(|(start, _)| body_span.contains_inclusive(Span::new(*start, *start)))
        .map(|(_, name)| name.as_str())
        .collect()
}

fn reference_is_inside_event_handler(
    reference_node_id: NodeId,
    handler_names: &FxHashSet<&str>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function) = ctx.nodes().ancestors(reference_node_id).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    for owner in ctx.nodes().ancestors(function.id()) {
        match owner.kind() {
            AstKind::JSXAttribute(attribute) => {
                if is_event_handler_attribute_name(&attribute.name) {
                    return true;
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                return matches!(
                    &declarator.id,
                    BindingPattern::BindingIdentifier(identifier)
                        if handler_names.contains(identifier.name.as_str())
                );
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
    }
    false
}

fn is_event_handler_attribute_name(name: &JSXAttributeName<'_>) -> bool {
    matches!(name, JSXAttributeName::Identifier(identifier)
        if identifier.name.starts_with("on")
            && identifier.name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase))
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
