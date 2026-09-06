use oxc_ast::{
    AstKind,
    ast::{
        BinaryExpression, BindingPattern, Expression, FunctionType, JSXAttribute, JSXElementName,
        PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
};

const ROLE_DIALOG_MODAL_MESSAGE: &str = "Keyboard users can tab out of this `role=\"dialog\"` modal because it has no built-in focus trapping, so use the native `<dialog>`, which gives you focus trapping, `Escape` to close, and the backdrop for free.";
const ROLE_DIALOG_NONMODAL_MESSAGE: &str = "Screen reader users get native dialog semantics for free from the HTML `<dialog>` element, so swap this `role=\"dialog\"` element for `<dialog>` and open it with `dialog.show()` (non-modal) or `dialog.showModal()` (modal).";
const ARIA_MODAL_MESSAGE: &str = "Keyboard users can tab out of this modal because `aria-modal=\"true\"` only hints to screen readers without trapping focus or blocking the page, so use the native `<dialog>` with `dialog.showModal()` instead.";

#[derive(Debug, Default, Clone)]
pub struct PreferHtmlDialog;

#[derive(Default)]
struct PreferHtmlDialogFocusTrapSignals {
    trap_ref_names: FxHashSet<String>,
    scoped_handler_names: FxHashSet<String>,
    indexed_signal_spans: Vec<Span>,
    has_unscoped_trap_signal: bool,
}

struct PreferHtmlDialogCandidate {
    node_id: oxc_semantic::NodeId,
    diagnostic_span: Span,
    message: &'static str,
}

declare_oxc_lint!(
    /// Prefer the native dialog element over hand-rolled HTML dialogs.
    PreferHtmlDialog,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Prefer the native dialog element.",
);

impl Rule for PreferHtmlDialog {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut candidates = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                &opening_element.name,
                JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
            ) {
                continue;
            }
            let Some((tag_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
                continue;
            };
            if tag_name == "dialog" || !HTML_TAG.contains(tag_name) {
                continue;
            }

            if let Some(role_attribute) = find_jsx_attribute(opening_element, "role")
                && let Some(role_candidates) =
                    get_static_jsx_attribute_string_values(role_attribute, ctx)
                && !role_candidates.is_empty()
                && role_candidates
                    .iter()
                    .all(|candidate| matches!(candidate.as_str(), "dialog" | "alertdialog"))
            {
                let is_modal = find_jsx_attribute(opening_element, "aria-modal")
                    .is_some_and(prefer_html_dialog_is_aria_modal_true);
                candidates.push(PreferHtmlDialogCandidate {
                    node_id: node.id(),
                    diagnostic_span: role_attribute.span,
                    message: if is_modal {
                        ROLE_DIALOG_MODAL_MESSAGE
                    } else {
                        ROLE_DIALOG_NONMODAL_MESSAGE
                    },
                });
                continue;
            }

            let Some(aria_modal_attribute) = find_jsx_attribute(opening_element, "aria-modal")
            else {
                continue;
            };
            if !prefer_html_dialog_is_aria_modal_true(aria_modal_attribute) {
                continue;
            }
            candidates.push(PreferHtmlDialogCandidate {
                node_id: node.id(),
                diagnostic_span: aria_modal_attribute.span,
                message: ARIA_MODAL_MESSAGE,
            });
        }
        if candidates.is_empty() {
            return;
        }

        let focus_trap_signals = prefer_html_dialog_collect_focus_trap_signals(ctx);
        if focus_trap_signals.has_unscoped_trap_signal {
            return;
        }
        for candidate in candidates {
            let opening_node = ctx.nodes().get_node(candidate.node_id);
            if prefer_html_dialog_is_element_focus_trapped(opening_node, &focus_trap_signals, ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(candidate.message).with_label(candidate.diagnostic_span),
            );
        }
    }
}

fn prefer_html_dialog_collect_focus_trap_signals<'a>(
    ctx: &LintContext<'a>,
) -> PreferHtmlDialogFocusTrapSignals {
    let mut signals = PreferHtmlDialogFocusTrapSignals::default();
    let mut matched_declarator_spans = Vec::new();
    for node in ctx.nodes().iter() {
        if matched_declarator_spans
            .iter()
            .any(|span: &Span| span.contains_inclusive(node.span()))
        {
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            continue;
        };
        let Some(Expression::CallExpression(call_expression)) = declarator.init.as_ref() else {
            continue;
        };
        let Some(callee_name) = prefer_html_dialog_flatten_callee_name(&call_expression.callee)
        else {
            continue;
        };
        if !prefer_html_dialog_is_focus_trap_name(&callee_name) {
            continue;
        }
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        signals.trap_ref_names.insert(identifier.name.to_string());
        for argument in &call_expression.arguments {
            let Some(argument_expression) = argument.as_expression() else {
                continue;
            };
            match argument_expression {
                Expression::Identifier(argument_identifier) => {
                    signals
                        .trap_ref_names
                        .insert(argument_identifier.name.to_string());
                }
                expression => {
                    let Some(member_expression) = expression.as_member_expression() else {
                        continue;
                    };
                    let Expression::Identifier(object_identifier) = member_expression.object()
                    else {
                        continue;
                    };
                    signals
                        .trap_ref_names
                        .insert(object_identifier.name.to_string());
                }
            }
        }
        matched_declarator_spans.push(declarator.span);
    }

    let mut tab_comparison_spans = Vec::new();
    for node in ctx.nodes().iter() {
        if prefer_html_dialog_has_ancestor_kind(node, ctx, |kind| {
            matches!(kind, AstKind::ImportDeclaration(_))
        }) || matched_declarator_spans
            .iter()
            .any(|span| span.contains_inclusive(node.span()))
            || tab_comparison_spans
                .iter()
                .any(|span: &Span| span.contains_inclusive(node.span()))
        {
            continue;
        }
        if let AstKind::BinaryExpression(binary_expression) = node.kind()
            && prefer_html_dialog_is_tab_key_comparison(binary_expression)
        {
            prefer_html_dialog_classify_trap_signal(node, &mut signals, ctx);
            tab_comparison_spans.push(binary_expression.span);
            continue;
        }
        let Some(identifier_name) = prefer_html_dialog_identifier_name(node) else {
            continue;
        };
        if prefer_html_dialog_is_focus_trap_name(identifier_name) {
            prefer_html_dialog_classify_trap_signal(node, &mut signals, ctx);
        }
    }
    if signals.has_unscoped_trap_signal {
        return signals;
    }
    for node in ctx.nodes().iter() {
        if let AstKind::BinaryExpression(binary_expression) = node.kind()
            && prefer_html_dialog_is_tab_key_comparison(binary_expression)
        {
            signals.indexed_signal_spans.push(binary_expression.span);
            continue;
        }
        if prefer_html_dialog_identifier_name(node).is_some_and(|identifier_name| {
            prefer_html_dialog_is_focus_trap_name(identifier_name)
                || signals.trap_ref_names.contains(identifier_name)
                || signals.scoped_handler_names.contains(identifier_name)
        }) {
            signals.indexed_signal_spans.push(node.span());
        }
    }
    signals
}

fn prefer_html_dialog_classify_trap_signal<'a>(
    signal: &AstNode<'a>,
    signals: &mut PreferHtmlDialogFocusTrapSignals,
    ctx: &LintContext<'a>,
) {
    let mut saw_anonymous_function = false;
    for current in ctx.nodes().ancestors(signal.id()) {
        if matches!(current.kind(), AstKind::ImportDeclaration(_)) {
            return;
        }
        if matches!(
            current.kind(),
            AstKind::JSXAttribute(_)
                | AstKind::JSXOpeningElement(_)
                | AstKind::JSXClosingElement(_)
        ) {
            return;
        }
        if matches!(
            current.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            let function_name = prefer_html_dialog_enclosing_function_name(current, ctx);
            if let Some(function_name) = function_name
                && !prefer_html_dialog_is_component_or_hook_name(function_name)
            {
                signals
                    .scoped_handler_names
                    .insert(function_name.to_string());
                return;
            }
            if saw_anonymous_function || function_name.is_some() {
                break;
            }
            saw_anonymous_function = true;
        }
    }
    signals.has_unscoped_trap_signal = true;
}

fn prefer_html_dialog_is_element_focus_trapped<'a>(
    opening_node: &AstNode<'a>,
    signals: &PreferHtmlDialogFocusTrapSignals,
    ctx: &LintContext<'a>,
) -> bool {
    let mut is_own_element = true;
    for current in ctx.nodes().ancestors(opening_node.id()) {
        let AstKind::JSXElement(element) = current.kind() else {
            continue;
        };
        let scope_span = if is_own_element {
            current.span()
        } else {
            element.opening_element.span
        };
        if prefer_html_dialog_contains_trap_signal(scope_span, signals) {
            return true;
        }
        is_own_element = false;
    }
    false
}

fn prefer_html_dialog_contains_trap_signal(
    scope_span: Span,
    signals: &PreferHtmlDialogFocusTrapSignals,
) -> bool {
    signals
        .indexed_signal_spans
        .iter()
        .any(|signal_span| scope_span.contains_inclusive(*signal_span))
}

fn prefer_html_dialog_is_aria_modal_true(attribute: &JSXAttribute<'_>) -> bool {
    let Some(value) = &attribute.value else {
        return true;
    };
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            string_literal.value == "true"
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => matches!(
            container.expression.as_expression(),
            Some(Expression::BooleanLiteral(boolean_literal)) if boolean_literal.value
        ),
        _ => false,
    }
}

fn prefer_html_dialog_is_tab_key_comparison(expression: &BinaryExpression<'_>) -> bool {
    matches!(
        expression.operator,
        BinaryOperator::Equality
            | BinaryOperator::StrictEquality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictInequality
    ) && (prefer_html_dialog_is_tab_key_literal(&expression.left)
        || prefer_html_dialog_is_tab_key_literal(&expression.right))
}

fn prefer_html_dialog_is_tab_key_literal(expression: &Expression<'_>) -> bool {
    matches!(expression, Expression::StringLiteral(string_literal) if string_literal.value == "Tab")
}

fn prefer_html_dialog_flatten_callee_name(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member_expression) => Some(format!(
            "{}.{}",
            prefer_html_dialog_flatten_callee_name(&member_expression.object)?,
            member_expression.property.name
        )),
        _ => None,
    }
}

fn prefer_html_dialog_identifier_name<'a>(node: &AstNode<'a>) -> Option<&'a str> {
    match node.kind() {
        AstKind::IdentifierName(identifier) => Some(identifier.name.as_str()),
        AstKind::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        AstKind::BindingIdentifier(identifier) => Some(identifier.name.as_str()),
        AstKind::LabelIdentifier(identifier) => Some(identifier.name.as_str()),
        AstKind::JSXIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn prefer_html_dialog_enclosing_function_name<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.name.as_str());
    }
    match ctx.nodes().parent_node(function_node.id()).kind() {
        AstKind::VariableDeclarator(declarator) => {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        AstKind::ObjectProperty(property) => match &property.key {
            PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
            PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn prefer_html_dialog_is_focus_trap_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    [
        "focustrap",
        "focus-trap",
        "focus_trap",
        "trapfocus",
        "trap-focus",
        "trap_focus",
        "a11ytrap",
        "a11y-trap",
        "a11y_trap",
    ]
    .iter()
    .any(|pattern| lowercase_name.contains(pattern))
}

fn prefer_html_dialog_is_component_or_hook_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        || name
            .strip_prefix("use")
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
}

fn prefer_html_dialog_has_ancestor_kind<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    predicate: impl Fn(AstKind<'a>) -> bool,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| predicate(ancestor.kind()))
}
