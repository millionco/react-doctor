use oxc_span::Span;

struct ModuleJsxTreeIndex {
    prefix_maximum_ends: Vec<u32>,
    spans: Vec<Span>,
}

impl ModuleJsxTreeIndex {
    fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    fn contains_or_is_inside(&self, span: Span) -> bool {
        self.contains(span) || self.is_inside(span)
    }

    fn contains(&self, span: Span) -> bool {
        let descendant_index = self
            .spans
            .partition_point(|candidate| candidate.start < span.start);
        self.spans
            .get(descendant_index)
            .is_some_and(|candidate| candidate.start < span.end)
    }

    fn is_inside(&self, span: Span) -> bool {
        let ancestor_count = self
            .spans
            .partition_point(|candidate| candidate.start <= span.start);
        ancestor_count > 0 && self.prefix_maximum_ends[ancestor_count - 1] >= span.end
    }
}

fn module_jsx_tree_index(
    module_source: &str,
    ctx: &crate::context::LintContext<'_>,
) -> ModuleJsxTreeIndex {
    let mut spans = ctx
        .nodes()
        .iter()
        .filter_map(|node| {
            let oxc_ast::AstKind::JSXElement(element) = node.kind() else {
                return None;
            };
            resolve_imported_jsx_component_name(&element.opening_element, module_source, ctx)
                .map(|_| element.span)
        })
        .collect::<Vec<_>>();
    spans.sort_unstable_by_key(|span| span.start);
    let mut maximum_end = 0;
    let prefix_maximum_ends = spans
        .iter()
        .map(|span| {
            maximum_end = maximum_end.max(span.end);
            maximum_end
        })
        .collect();
    ModuleJsxTreeIndex {
        prefix_maximum_ends,
        spans,
    }
}

fn owning_jsx_element_span(
    opening_element_node: &crate::AstNode<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<Span> {
    ctx.nodes()
        .ancestors(opening_element_node.id())
        .find_map(|ancestor| {
            let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
                return None;
            };
            Some(element.span)
        })
}
