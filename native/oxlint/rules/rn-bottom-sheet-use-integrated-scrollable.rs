use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const BOTTOM_SHEET_MODULE_SOURCE: &str = "@gorhom/bottom-sheet";
const BOTTOM_SHEET_CONTAINER_NAMES: [&str; 3] = ["BottomSheet", "BottomSheetModal", "default"];
const REACT_NATIVE_MODULE_SOURCE: &str = "react-native";
const REACT_NATIVE_SCROLLABLE_NAMES: [&str; 4] = [
    "FlatList",
    "ScrollView",
    "SectionList",
    "VirtualizedList",
];

#[derive(Debug, Default, Clone)]
pub struct RnBottomSheetUseIntegratedScrollable;

declare_oxc_lint!(
    /// Prefer Gorhom Bottom Sheet scrollables inside a Bottom Sheet.
    RnBottomSheetUseIntegratedScrollable,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer integrated scrollables inside a Bottom Sheet.",
);

impl Rule for RnBottomSheetUseIntegratedScrollable {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut reported_scrollable_spans = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            let Some(container_name) = resolve_imported_jsx_component_name(
                &element.opening_element,
                BOTTOM_SHEET_MODULE_SOURCE,
                ctx,
            ) else {
                continue;
            };
            if !BOTTOM_SHEET_CONTAINER_NAMES.contains(&container_name) {
                continue;
            }
            for descendant in get_static_jsx_descendant_opening_elements(element, true) {
                let Some(scrollable_name) = resolve_imported_jsx_component_name(
                    descendant,
                    REACT_NATIVE_MODULE_SOURCE,
                    ctx,
                ) else {
                    continue;
                };
                if !REACT_NATIVE_SCROLLABLE_NAMES.contains(&scrollable_name)
                    || !reported_scrollable_spans.insert(descendant.span)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "React Native's `{scrollable_name}` does not coordinate gestures with this Bottom Sheet. Use `BottomSheet{scrollable_name}` from @gorhom/bottom-sheet."
                    ))
                    .with_label(descendant.span),
                );
            }
        }
    }
}
