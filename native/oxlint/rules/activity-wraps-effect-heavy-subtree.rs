use oxc_ast::{
    ast::{Expression, ImportDeclarationSpecifier, JSXAttributeValue, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ACTIVITY_IMPORTED_NAMES: [&str; 2] = ["Activity", "unstable_Activity"];
const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];

#[derive(Debug, Default, Clone)]
pub struct ActivityWrapsEffectHeavySubtree;

declare_oxc_lint!(
    /// Warn when a toggleable React Activity wraps effectful same-file components.
    ActivityWrapsEffectHeavySubtree,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warn when Activity wraps effect-heavy components.",
);

impl Rule for ActivityWrapsEffectHeavySubtree {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut local_activity_names = FxHashSet::default();
        let mut react_namespace_names = FxHashSet::default();
        let mut component_bodies = FxHashMap::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::ImportDeclaration(import_declaration)
                    if import_declaration.source.value == "react" =>
                {
                    for specifier in import_declaration.specifiers.iter().flatten() {
                        match specifier {
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                                react_namespace_names.insert(specifier.local.name.to_string());
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                                react_namespace_names.insert(specifier.local.name.to_string());
                            }
                            ImportDeclarationSpecifier::ImportSpecifier(specifier)
                                if ACTIVITY_IMPORTED_NAMES
                                    .contains(&specifier.imported.name().as_str()) =>
                            {
                                local_activity_names.insert(specifier.local.name.to_string());
                            }
                            _ => {}
                        }
                    }
                }
                AstKind::Function(function) if function.is_function_declaration() => {
                    if let (Some(identifier), Some(body)) = (&function.id, &function.body) {
                        component_bodies
                            .entry(identifier.name.to_string())
                            .or_insert_with(|| body.span());
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(identifier) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let body_span = match initializer {
                        Expression::ArrowFunctionExpression(function) => function.body.span(),
                        Expression::FunctionExpression(function) => {
                            let Some(body) = &function.body else {
                                continue;
                            };
                            body.span()
                        }
                        _ => continue,
                    };
                    component_bodies
                        .entry(identifier.name.to_string())
                        .or_insert(body_span);
                }
                _ => {}
            }
        }

        let mut effect_counts = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            if !activity_element_matches(
                &element.opening_element.name,
                &local_activity_names,
                &react_namespace_names,
            ) {
                continue;
            }
            let Some(mode_attribute) = find_jsx_attribute(&element.opening_element, "mode") else {
                continue;
            };
            if activity_mode_is_static(mode_attribute) {
                continue;
            }

            let mut child_names = Vec::new();
            let mut seen_child_names = FxHashSet::default();
            for child_node in ctx.nodes().iter() {
                let AstKind::JSXOpeningElement(child) = child_node.kind() else {
                    continue;
                };
                if child.span.start < element.span.start || child.span.end > element.span.end {
                    continue;
                }
                let Some(child_name) = activity_direct_component_name(&child.name) else {
                    continue;
                };
                if local_activity_names.contains(child_name)
                    || !child_name
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase)
                    || !seen_child_names.insert(child_name.to_string())
                {
                    continue;
                }
                child_names.push(child_name.to_string());
            }

            let mut total_effects = 0;
            let mut effectful_children = Vec::new();
            for child_name in child_names {
                let effect_count = *effect_counts.entry(child_name.clone()).or_insert_with(|| {
                    component_bodies.get(&child_name).map_or(0, |body_span| {
                        activity_effect_count_in_span(*body_span, ctx)
                    })
                });
                if effect_count == 0 {
                    continue;
                }
                total_effects += effect_count;
                effectful_children.push(format!("<{child_name}>"));
            }
            if total_effects == 0 {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Every hide and show rebuilds {} from scratch because <Activity> wraps components with {} effect hook{}.",
                    effectful_children.join(", "),
                    total_effects,
                    if total_effects == 1 { "" } else { "s" },
                ))
                .with_label(element.opening_element.span),
            );
        }
    }
}

fn activity_element_matches(
    name: &JSXElementName<'_>,
    local_activity_names: &FxHashSet<String>,
    react_namespace_names: &FxHashSet<String>,
) -> bool {
    match name {
        JSXElementName::IdentifierReference(identifier) => {
            local_activity_names.contains(identifier.name.as_str())
        }
        JSXElementName::MemberExpression(member_expression) => {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            react_namespace_names.contains(identifier.name.as_str())
                && ACTIVITY_IMPORTED_NAMES.contains(&member_expression.property.name.as_str())
        }
        _ => false,
    }
}

fn activity_mode_is_static(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            container.expression.as_expression(),
            Some(
                Expression::BooleanLiteral(_)
                    | Expression::NullLiteral(_)
                    | Expression::NumericLiteral(_)
                    | Expression::BigIntLiteral(_)
                    | Expression::RegExpLiteral(_)
                    | Expression::StringLiteral(_)
            )
        ),
        _ => false,
    }
}

fn activity_direct_component_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn activity_effect_count_in_span(body_span: Span, ctx: &LintContext<'_>) -> usize {
    ctx.nodes()
        .iter()
        .filter(|node| {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                return false;
            };
            node.span().start >= body_span.start
                && node.span().end <= body_span.end
                && is_react_hook_call(call_expression, &EFFECT_HOOK_NAMES, ctx)
        })
        .count()
}
