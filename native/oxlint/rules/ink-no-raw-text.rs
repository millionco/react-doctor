use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "Raw text reaches Ink without a `<Text>` boundary.";

#[derive(Debug, Default, Clone)]
pub struct InkNoRawText;

declare_oxc_lint!(
    /// Disallow raw text outside Ink text components.
    InkNoRawText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow raw text outside Ink text components.",
);

impl Rule for InkNoRawText {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let forwarding_kinds =
            collect_children_forwarding_components(ctx.semantic(), ctx.module_record());
        let mut imported_forwarding_kinds =
            rustc_hash::FxHashMap::<oxc_semantic::SymbolId, ChildrenForwardingKind>::default();

        for node in ctx.nodes().iter() {
            if !is_static_raw_text(node, ctx.semantic()) {
                continue;
            }
            let Some(receiver) = raw_text_receiver(node, ctx.semantic(), ctx.module_record())
            else {
                continue;
            };
            let receiver_kind = jsx_receiver_kind(
                &receiver.opening_element,
                ctx.semantic(),
                ctx.module_record(),
                &forwarding_kinds,
            );
            let is_non_text_receiver = match receiver_kind {
                ChildrenForwardingKind::Text => false,
                ChildrenForwardingKind::NonText => true,
                ChildrenForwardingKind::Unknown => {
                    let Some(symbol_id) =
                        jsx_element_symbol_id(&receiver.opening_element.name, ctx.semantic())
                    else {
                        continue;
                    };
                    *imported_forwarding_kinds
                        .entry(symbol_id)
                        .or_insert_with(|| {
                            resolve_imported_component_forwarding(
                                &receiver.opening_element,
                                ctx.file_path(),
                                ctx.semantic(),
                                ctx.module_record(),
                            )
                        })
                        == ChildrenForwardingKind::NonText
                }
            };
            if is_non_text_receiver {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
            }
        }
    }
}

fn is_static_raw_text(node: &AstNode<'_>, semantic: &Semantic<'_>) -> bool {
    match node.kind() {
        AstKind::JSXText(text) => !text.value.trim().is_empty(),
        AstKind::JSXExpressionContainer(container) => {
            if !matches!(
                semantic.nodes().parent_node(node.id()).kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            ) {
                return false;
            }
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match expression.get_inner_expression() {
                Expression::StringLiteral(_) | Expression::NumericLiteral(_) => true,
                Expression::TemplateLiteral(template) => template.expressions.is_empty(),
                _ => false,
            }
        }
        _ => false,
    }
}

fn raw_text_receiver<'a, 'b>(
    node: &AstNode<'a>,
    semantic: &'b Semantic<'a>,
    module_record: &ModuleRecord,
) -> Option<&'b JSXElement<'a>> {
    for ancestor in semantic.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXFragment(_) => {}
            AstKind::JSXElement(element)
                if is_react_fragment_element(
                    &element.opening_element.name,
                    semantic,
                    module_record,
                ) => {}
            AstKind::JSXElement(element) => return Some(element),
            _ => return None,
        }
    }
    None
}
