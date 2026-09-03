use std::{
    cell::{Cell, RefCell},
    path::{Path, PathBuf},
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, ArrowFunctionBody, BindingPattern, CallExpression,
        ExportDefaultDeclarationKind, Expression, JSXAttributeValue, JSXElementName,
        ObjectPropertyKind, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::operator::{AssignmentOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::LintContext,
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const MESSAGE: &str = "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.";
const MAX_RESOLUTION_DEPTH: usize = 8;
const MAX_CROSS_FILE_RESOLUTIONS: usize = 3;
const MAX_CROSS_FILE_REEXPORT_DEPTH: usize = 4;
const MAX_CROSS_FILE_BYTES: u64 = 2_000_000;
const MAX_TSCONFIG_DIRECTORY_WALK: usize = 30;
const MAX_TSCONFIG_EXTENDS_DEPTH: usize = 8;
const OPAQUE_FEATURE_TEXT: char = '\0';

#[derive(Debug, Default, Clone)]
pub struct WindowOpenWithoutNoopener;

declare_oxc_lint!(
    /// Require opener protection for discarded dynamic window handles.
    WindowOpenWithoutNoopener,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require noopener for discarded dynamic window handles.",
);

impl Rule for WindowOpenWithoutNoopener {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut analysis = WindowOpenAnalysis::new(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !analysis.is_window_open_call(node, call)
                || !analysis.is_discarded_handle(node, &mut FxHashSet::default())
            {
                continue;
            }
            analysis.current_open = Some(node.id());
            let destination_argument = call.arguments.first();
            let destination = destination_argument.and_then(Argument::as_expression);
            let is_direct_external_literal = destination.is_some_and(|expression| {
                let Expression::StringLiteral(literal) = expression else {
                    return false;
                };
                !literal
                    .value
                    .trim_matches(is_ecmascript_whitespace)
                    .is_empty()
                    && !WindowOpenAnalysis::is_trusted_foreign_static_text(literal.value.as_str())
            });
            let is_trusted_destination = match destination_argument {
                None => true,
                Some(argument) => argument.as_expression().is_some_and(|expression| {
                    analysis.is_trusted_or_nullish(Some(expression), 0, &mut FxHashSet::default())
                }),
            };
            if !is_direct_external_literal && is_trusted_destination {
                continue;
            }
            if call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .and_then(|expression| match expression {
                    Expression::StringLiteral(literal) => Some(literal.value.as_str()),
                    _ => None,
                })
                .is_some_and(|target| matches!(target, "_self" | "_top" | "_parent"))
            {
                continue;
            }
            if let Some(features_argument) = call.arguments.get(2) {
                let Some(features) = features_argument.as_expression() else {
                    continue;
                };
                if !analysis.is_raw_nullish(features) {
                    let mut visited_symbols = FxHashSet::default();
                    let Some(features_text) =
                        analysis.resolve_static_string(features, 0, &mut visited_symbols)
                    else {
                        continue;
                    };
                    if WindowOpenAnalysis::features_may_protect_opener(&features_text) {
                        continue;
                    }
                }
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

struct WindowOpenAnalysis<'a, 'ctx> {
    ctx: &'ctx LintContext<'a>,
    nodes_by_span: FxHashMap<(u32, u32), NodeId>,
    current_open: Option<NodeId>,
    property_write_analysis: PossibleStaticPropertyWriteAnalysis,
    cross_file_remaining: Cell<usize>,
    cross_file_seen: RefCell<FxHashSet<(String, String)>>,
    cross_file_memo: RefCell<FxHashMap<(String, String, bool), Option<bool>>>,
    local_serialization_reference: Cell<Option<NodeId>>,
}

impl<'a, 'ctx> WindowOpenAnalysis<'a, 'ctx> {
    fn new(ctx: &'ctx LintContext<'a>) -> Self {
        let mut nodes_by_span = FxHashMap::default();
        for node in ctx.nodes().iter() {
            nodes_by_span.insert((node.span().start, node.span().end), node.id());
        }
        Self {
            ctx,
            nodes_by_span,
            current_open: None,
            property_write_analysis: build_possible_static_property_write_analysis(ctx),
            cross_file_remaining: Cell::new(MAX_CROSS_FILE_RESOLUTIONS),
            cross_file_seen: RefCell::new(FxHashSet::default()),
            cross_file_memo: RefCell::new(FxHashMap::default()),
            local_serialization_reference: Cell::new(None),
        }
    }

    fn expression_node(&self, expression: &Expression<'a>) -> Option<&AstNode<'a>> {
        self.node_for_span(expression.span())
    }

    fn node_for_span(&self, span: Span) -> Option<&AstNode<'a>> {
        self.nodes_by_span
            .get(&(span.start, span.end))
            .map(|node_id| self.ctx.nodes().get_node(*node_id))
    }

    fn is_window_open_call(&self, _node: &AstNode<'a>, call: &CallExpression<'a>) -> bool {
        self.is_global_open_reference(&call.callee, 0, &mut FxHashSet::default())
    }

    fn is_global_open_reference(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        if is_proven_global_namespace_reference(expression, "open", self.ctx) {
            return true;
        }
        if let Some(member) = expression.get_inner_expression().as_member_expression()
            && member.static_property_name() == Some("open")
            && ["frames", "globalThis", "parent", "self", "top", "window"]
                .iter()
                .any(|name| is_proven_global_namespace_reference(member.object(), name, self.ctx))
        {
            return true;
        }
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self
            .ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        self.const_initializer(symbol_id)
            .is_some_and(|initializer| {
                self.is_global_open_reference(initializer, depth + 1, visited_symbols)
            })
    }

    fn is_discarded_handle(
        &self,
        node: &AstNode<'a>,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        let root = self.transparent_node_root(node);
        let parent = self.ctx.nodes().parent_node(root.id());
        match parent.kind() {
            AstKind::ExpressionStatement(_) => true,
            AstKind::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
            AstKind::AwaitExpression(_) => self.is_discarded_handle(parent, visited_functions),
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == root.span()) =>
            {
                self.is_returned_handle_discarded(parent, visited_functions)
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == root.span() => {
                self.is_discarded_handle(parent, visited_functions)
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == root.span()
                    || expression.alternate.span() == root.span() =>
            {
                self.is_discarded_handle(parent, visited_functions)
            }
            AstKind::SequenceExpression(sequence) => {
                sequence
                    .expressions
                    .last()
                    .is_none_or(|expression| expression.span() != root.span())
                    || self.is_discarded_handle(parent, visited_functions)
            }
            AstKind::ArrowFunctionExpression(arrow)
                if !matches!(&arrow.body, ArrowFunctionBody::FunctionBody(_))
                    && arrow.body.span() == root.span() =>
            {
                self.is_arrow_return_discarded(parent, visited_functions)
            }
            _ => false,
        }
    }

    fn is_returned_handle_discarded(
        &self,
        return_node: &AstNode<'a>,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        let Some(function) = self.enclosing_function(return_node) else {
            return false;
        };
        self.is_arrow_return_discarded(function, visited_functions)
    }

    fn is_arrow_return_discarded(
        &self,
        function_node: &AstNode<'a>,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        if !visited_functions.insert(function_node.id()) {
            return false;
        }
        let parent = self.ctx.nodes().parent_node(function_node.id());
        match parent.kind() {
            AstKind::JSXExpressionContainer(_) => {
                let attribute_node = self.ctx.nodes().parent_node(parent.id());
                let opening_node = self.ctx.nodes().parent_node(attribute_node.id());
                matches!(attribute_node.kind(), AstKind::JSXAttribute(attribute)
                    if Self::jsx_attribute_name(attribute).is_some_and(Self::is_event_handler_name))
                    && matches!(opening_node.kind(), AstKind::JSXOpeningElement(opening)
                        if matches!(&opening.name, JSXElementName::Identifier(identifier)
                            if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_lowercase)))
            }
            AstKind::ExpressionStatement(_) => true,
            AstKind::CallExpression(call) => {
                if call.callee.span() == function_node.span() {
                    return self.is_discarded_handle(parent, visited_functions);
                }
                call.arguments
                    .iter()
                    .any(|argument| argument.span() == function_node.span())
                    && self.call_discards_callback_return(parent, call)
            }
            AstKind::ObjectProperty(property)
                if property.value.span() == function_node.span()
                    && !property.computed
                    && property
                        .key
                        .static_name()
                        .is_some_and(|name| Self::is_event_handler_name(name.as_ref())) =>
            {
                self.is_intrinsic_create_element_props_object(parent)
            }
            _ => self
                .direct_local_function_calls(function_node)
                .is_some_and(|calls| {
                    calls.is_empty()
                        || calls.iter().all(|call_id| {
                            self.is_discarded_handle(
                                self.ctx.nodes().get_node(*call_id),
                                visited_functions,
                            )
                        })
                }),
        }
    }

    fn call_discards_callback_return(
        &self,
        call_node: &AstNode<'a>,
        call: &CallExpression<'a>,
    ) -> bool {
        match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                matches!(
                    identifier.name.as_str(),
                    "queueMicrotask"
                        | "requestAnimationFrame"
                        | "setInterval"
                        | "setTimeout"
                        | "addEventListener"
                ) && is_proven_global_namespace_reference(
                    &call.callee,
                    identifier.name.as_str(),
                    self.ctx,
                )
            }
            expression => {
                let Some(member) = expression.as_member_expression() else {
                    return false;
                };
                match member.static_property_name() {
                    Some("addEventListener") => {
                        is_proven_global_namespace_reference(member.object(), "window", self.ctx)
                    }
                    Some("forEach") => self.is_proven_array_receiver(member.object(), call_node),
                    _ => false,
                }
            }
        }
    }

    fn is_proven_array_receiver(&self, receiver: &Expression<'a>, reference: &AstNode<'a>) -> bool {
        match receiver.get_inner_expression() {
            Expression::ArrayExpression(_) => true,
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_has_write_before(symbol_id, reference) {
                    return false;
                }
                if has_possible_static_property_write_before(
                    identifier,
                    "forEach",
                    reference,
                    &self.property_write_analysis,
                    self.ctx,
                ) {
                    return false;
                }
                if self.binding_has_builtin_array_annotation(symbol_id) {
                    return true;
                }
                self.const_initializer(symbol_id).is_some_and(|initializer| {
                    matches!(initializer.get_inner_expression(), Expression::ArrayExpression(_))
                        || matches!(initializer.get_inner_expression(), Expression::NewExpression(new_expression)
                            if is_proven_global_namespace_reference(&new_expression.callee, "Array", self.ctx)
                                && !self.global_namespace_was_mutated_before("Array", reference))
                        || matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
                            if call.callee.get_inner_expression().as_member_expression().is_some_and(|member|
                                matches!(member.static_property_name(), Some("from" | "of"))
                                    && is_proven_global_namespace_reference(member.object(), "Array", self.ctx)
                                    && !self.global_namespace_was_mutated_before("Array", reference)
                                    && !self.global_property_was_mutated_before(
                                        "Array",
                                        member.static_property_name().unwrap_or_default(),
                                        reference,
                                    )))
                })
            }
            _ => false,
        }
    }

    fn binding_has_builtin_array_annotation(&self, symbol_id: SymbolId) -> bool {
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        declarator
            .type_annotation
            .as_ref()
            .is_some_and(|annotation| {
                matches!(
                    &annotation.type_annotation,
                    TSType::TSArrayType(_) | TSType::TSTupleType(_)
                ) || matches!(&annotation.type_annotation, TSType::TSTypeReference(reference)
                    if matches!(&reference.type_name, TSTypeName::IdentifierReference(identifier)
                        if matches!(identifier.name.as_str(), "Array" | "ReadonlyArray")))
            })
    }

    fn is_intrinsic_create_element_props_object(&self, property_node: &AstNode<'a>) -> bool {
        let object_node = self.ctx.nodes().parent_node(property_node.id());
        let call_node = self.ctx.nodes().parent_node(object_node.id());
        let AstKind::ObjectExpression(_) = object_node.kind() else {
            return false;
        };
        let AstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        if call
            .arguments
            .get(1)
            .is_none_or(|argument| argument.span() != object_node.span())
            || !matches!(
                call.arguments.first().and_then(Argument::as_expression),
                Some(Expression::StringLiteral(_))
            )
        {
            return false;
        }
        let callee = call.callee.get_inner_expression();
        self.is_react_api_call(call, "createElement")
            || callee.as_member_expression().is_some_and(|member| {
                member.static_property_name() == Some("createElement")
                    && is_proven_global_namespace_reference(member.object(), "React", self.ctx)
            })
    }

    fn transparent_node_root(&self, mut node: &'ctx AstNode<'a>) -> &'ctx AstNode<'a> {
        loop {
            let parent = self.ctx.nodes().parent_node(node.id());
            let is_transparent = matches!(
                parent.kind(),
                AstKind::ParenthesizedExpression(_)
                    | AstKind::TSAsExpression(_)
                    | AstKind::TSSatisfiesExpression(_)
                    | AstKind::TSNonNullExpression(_)
                    | AstKind::ChainExpression(_)
            );
            if !is_transparent || !parent.span().contains_inclusive(node.span()) {
                return node;
            }
            node = parent;
        }
    }

    fn enclosing_function(&self, node: &AstNode<'a>) -> Option<&AstNode<'a>> {
        self.ctx.nodes().ancestors(node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    }

    fn direct_local_function_calls(&self, function_node: &AstNode<'a>) -> Option<Vec<NodeId>> {
        let Some(symbol_id) = self.local_function_symbol(function_node) else {
            return None;
        };
        let aliases = self.const_alias_symbols(symbol_id);
        let mut calls = Vec::new();
        for alias in aliases {
            for reference in self.ctx.scoping().get_resolved_references(alias) {
                let reference_node = self.ctx.nodes().get_node(reference.node_id());
                let root = self.transparent_node_root(reference_node);
                let parent = self.ctx.nodes().parent_node(root.id());
                if matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|init| init.span() == root.span()))
                {
                    continue;
                }
                if !matches!(parent.kind(), AstKind::CallExpression(call)
                    if call.callee.span() == root.span())
                {
                    return Some(Vec::new());
                }
                calls.push(parent.id());
            }
        }
        (!calls.is_empty()).then_some(calls)
    }

    fn direct_named_local_function_calls(
        &self,
        function_node: &AstNode<'a>,
    ) -> Option<Vec<NodeId>> {
        let symbol_id = self.local_function_symbol(function_node)?;
        let mut calls = Vec::new();
        for reference in self.ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = self.ctx.nodes().get_node(reference.node_id());
            let root = self.transparent_node_root(reference_node);
            let parent = self.ctx.nodes().parent_node(root.id());
            let AstKind::CallExpression(call) = parent.kind() else {
                return None;
            };
            if call.callee.span() != root.span() {
                return None;
            }
            calls.push(parent.id());
        }
        (!calls.is_empty()).then_some(calls)
    }

    fn local_function_symbol(&self, function_node: &AstNode<'a>) -> Option<SymbolId> {
        match function_node.kind() {
            AstKind::Function(function) => {
                if self.is_exported_node(function_node) {
                    None
                } else {
                    function
                        .id
                        .as_ref()
                        .map(|identifier| identifier.symbol_id())
                }
            }
            AstKind::ArrowFunctionExpression(_) => {
                let mut parent = self.ctx.nodes().parent_node(function_node.id());
                if let AstKind::CallExpression(call) = parent.kind()
                    && call
                        .arguments
                        .first()
                        .is_some_and(|argument| argument.span() == function_node.span())
                    && Self::terminal_callee_name(&call.callee) == Some("useCallback")
                {
                    parent = self.ctx.nodes().parent_node(parent.id());
                }
                let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                    return None;
                };
                if !matches!(self.ctx.nodes().parent_node(parent.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                    || self.is_exported_node(self.ctx.nodes().parent_node(parent.id()))
                {
                    return None;
                }
                declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id())
            }
            _ => None,
        }
    }

    fn is_exported_node(&self, node: &AstNode<'a>) -> bool {
        matches!(
            self.ctx.nodes().parent_node(node.id()).kind(),
            AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
        )
    }

    fn const_alias_symbols(&self, root_symbol_id: SymbolId) -> Vec<SymbolId> {
        let mut symbols = vec![root_symbol_id];
        let mut seen = FxHashSet::from_iter([root_symbol_id]);
        let mut index = 0;
        while index < symbols.len() {
            let source_symbol = symbols[index];
            index += 1;
            for reference in self.ctx.scoping().get_resolved_references(source_symbol) {
                let reference_node = self.ctx.nodes().get_node(reference.node_id());
                let root = self.transparent_node_root(reference_node);
                let parent = self.ctx.nodes().parent_node(root.id());
                let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                    continue;
                };
                if !matches!(self.ctx.nodes().parent_node(parent.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                    || declarator
                        .init
                        .as_ref()
                        .is_none_or(|init| init.span() != root.span())
                {
                    continue;
                }
                if let Some(alias) = declarator.id.get_binding_identifier()
                    && seen.insert(alias.symbol_id())
                {
                    symbols.push(alias.symbol_id());
                }
            }
        }
        symbols
    }

    fn is_trusted_or_nullish(
        &self,
        expression: Option<&Expression<'a>>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        self.is_nullish(expression)
            || expression.is_some_and(|expression| {
                self.is_trusted_destination(expression, depth, visited_symbols)
            })
    }

    fn is_trusted_destination(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        let expression = expression.get_inner_expression();
        if self.is_trusted_static_destination(expression) {
            return true;
        }
        match expression {
            Expression::ConditionalExpression(conditional) => {
                self.is_trusted_or_nullish(
                    Some(&conditional.consequent),
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_or_nullish(
                    Some(&conditional.alternate),
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                if logical.operator == LogicalOperator::And {
                    return self.is_nullish(Some(&logical.left))
                        || self.is_trusted_or_nullish(
                            Some(&logical.right),
                            depth + 1,
                            visited_symbols,
                        );
                }
                if self.is_statically_truthy_trusted(&logical.left, depth + 1, visited_symbols) {
                    return true;
                }
                self.is_trusted_or_nullish(
                    Some(&logical.left),
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_or_nullish(
                    Some(&logical.right),
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::BinaryExpression(binary)
                if binary.operator == oxc_syntax::operator::BinaryOperator::Addition =>
            {
                self.is_trusted_concat_prefix(&binary.left, depth + 1, visited_symbols)
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return self.is_router_co_navigated(identifier);
                };
                if let Some(verdict) = self.cross_file_verdict(symbol_id, false) {
                    return verdict;
                }
                if !visited_symbols.insert(symbol_id) {
                    return false;
                }
                if let Some(initializer) = self.const_initializer(symbol_id) {
                    if self.symbol_has_write_before_current_open(symbol_id) {
                        return false;
                    }
                    if matches!(
                        initializer.get_inner_expression(),
                        Expression::NewExpression(_)
                    ) && self
                        .coercion_reference_for(expression)
                        .is_some_and(|reference| {
                            self.global_property_was_mutated_before("URL", "prototype", reference)
                                || self.url_receiver_was_mutated_before(expression, reference)
                        })
                    {
                        return false;
                    }
                    return self.is_trusted_or_nullish(
                        Some(initializer),
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_let_assigned_only_trusted(symbol_id, depth + 1, visited_symbols)
                    || self.is_trusted_destructured_iteration(symbol_id, depth + 1, visited_symbols)
                    || self.is_trusted_local_component_prop(symbol_id, depth + 1, visited_symbols)
                    || self.is_trusted_use_state_binding(symbol_id, depth + 1, visited_symbols)
                    || self.is_trusted_local_parameter(identifier, depth + 1, visited_symbols)
                    || self.is_router_co_navigated(identifier)
            }
            Expression::TemplateLiteral(template) => {
                let first_text = template
                    .quasis
                    .first()
                    .map_or("", |quasi| quasi.value.raw.as_str())
                    .trim_start_matches(is_ecmascript_whitespace);
                if !first_text.is_empty() || template.expressions.is_empty() {
                    return false;
                }
                let Some(first_expression) = template.expressions.first() else {
                    return false;
                };
                let trusted_first_expression =
                    self.terminal_const_alias_initializer(first_expression);
                let suffix = template
                    .quasis
                    .get(1)
                    .map_or("", |quasi| quasi.value.raw.as_str());
                let previous_reference = self.local_serialization_reference.replace(
                    self.expression_node(expression)
                        .and_then(|node| self.execution_reference_for_node(node))
                        .map(AstNode::id),
                );
                let verdict =
                    Self::is_safe_interpolated_suffix(suffix, template.expressions.len() > 1)
                        && (!suffix.starts_with('/')
                            || self.is_proven_safe_slash_base(
                                trusted_first_expression,
                                depth + 1,
                                &mut visited_symbols.clone(),
                            ))
                        && self.is_trusted_interpolated_base(
                            trusted_first_expression,
                            depth + 1,
                            visited_symbols,
                        );
                self.local_serialization_reference.set(previous_reference);
                verdict
            }
            Expression::CallExpression(call) => self.is_trusted_call(call, depth, visited_symbols),
            Expression::NewExpression(new_expression) => {
                if !is_proven_global_namespace_reference(&new_expression.callee, "URL", self.ctx)
                    || self
                        .node_for_span(new_expression.span)
                        .is_none_or(|reference| {
                            self.global_namespace_was_mutated_before("URL", reference)
                        })
                {
                    return false;
                }
                let first = new_expression
                    .arguments
                    .first()
                    .and_then(Argument::as_expression);
                first.is_some_and(|first| {
                    self.is_trusted_destination(first, depth + 1, &mut visited_symbols.clone())
                }) && match new_expression.arguments.get(1) {
                    None => true,
                    Some(argument) => argument.as_expression().is_some_and(|base| {
                        self.is_trusted_destination(base, depth + 1, visited_symbols)
                    }),
                }
            }
            expression if expression.as_member_expression().is_some() => {
                self.is_trusted_member(expression, depth, visited_symbols)
            }
            _ => self.is_same_origin_location_read(expression),
        }
    }

    fn is_trusted_static_destination(&self, expression: &Expression<'a>) -> bool {
        match expression {
            Expression::StringLiteral(_) => true,
            Expression::TemplateLiteral(template) => {
                if template.expressions.is_empty() {
                    return true;
                }
                let first_text = template
                    .quasis
                    .first()
                    .map_or("", |quasi| quasi.value.raw.as_str())
                    .trim_start_matches(is_ecmascript_whitespace);
                if first_text.is_empty() {
                    return false;
                }
                let lower = first_text.to_ascii_lowercase();
                ["mailto:", "tel:", "sms:", "file:"]
                    .iter()
                    .any(|scheme| lower.starts_with(scheme))
                    || Self::complete_origin_prefix(first_text)
                    || Self::starts_unambiguous_same_origin_path(first_text)
            }
            _ => false,
        }
    }

    fn is_trusted_foreign_static_text(text: &str) -> bool {
        let text = text.trim_start_matches(is_ecmascript_whitespace);
        if text.is_empty() {
            return false;
        }
        let lower = text.to_ascii_lowercase();
        ["mailto:", "tel:", "sms:", "file:"]
            .iter()
            .any(|scheme| lower.starts_with(scheme))
            || Self::starts_same_origin_path(text)
    }

    fn starts_same_origin_path(text: &str) -> bool {
        if let Some(rest) = text.strip_prefix('/') {
            return !rest.starts_with('/') && !rest.starts_with('\\');
        }
        if ["./", "../", "?", "#"]
            .iter()
            .any(|prefix| text.starts_with(prefix))
        {
            return true;
        }
        let mut saw_segment = false;
        for character in text.chars() {
            if character == '/' || character == '?' || character == '#' {
                return saw_segment;
            }
            if character == ':'
                || !(character.is_ascii_alphanumeric() || "_.~%-".contains(character))
            {
                return false;
            }
            saw_segment = true;
        }
        false
    }

    fn starts_unambiguous_same_origin_path(text: &str) -> bool {
        text != "/" && Self::starts_same_origin_path(text)
    }

    fn complete_origin_prefix(text: &str) -> bool {
        let lower = text.to_ascii_lowercase();
        let Some(rest) = lower
            .strip_prefix("http://")
            .or_else(|| lower.strip_prefix("https://"))
        else {
            return false;
        };
        rest.find(['/', '?', '#']).is_some_and(|index| index > 0)
    }

    fn is_trusted_concat_prefix(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        let mut leftmost = expression.get_inner_expression();
        while let Expression::BinaryExpression(binary) = leftmost {
            if binary.operator != oxc_syntax::operator::BinaryOperator::Addition {
                break;
            }
            leftmost = binary.left.get_inner_expression();
        }
        match leftmost {
            Expression::StringLiteral(literal) => {
                Self::static_text_pins_concat(literal.value.as_str())
            }
            Expression::TemplateLiteral(template) => {
                self.is_trusted_static_destination(leftmost)
                    || template.expressions.is_empty()
                        && template.quasis.first().is_some_and(|quasi| {
                            Self::static_text_pins_concat(quasi.value.raw.as_str())
                        })
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id)
                    || self.symbol_has_write_before_current_open(symbol_id)
                {
                    return false;
                }
                self.const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_trusted_concat_prefix(initializer, depth + 1, visited_symbols)
                    })
            }
            _ => false,
        }
    }

    fn static_text_pins_concat(text: &str) -> bool {
        let text = text.trim_start_matches(is_ecmascript_whitespace);
        if text.is_empty() {
            return false;
        }
        let lower = text.to_ascii_lowercase();
        ["mailto:", "tel:", "sms:", "file:"]
            .iter()
            .any(|scheme| lower.starts_with(scheme))
            || Self::complete_origin_prefix(text)
            || Self::starts_unambiguous_same_origin_path(text)
    }

    fn is_trusted_call(
        &self,
        call: &CallExpression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
            if member.static_property_name() == Some("createObjectURL")
                && is_proven_global_namespace_reference(member.object(), "URL", self.ctx)
                && self.node_for_span(call.span).is_some_and(|reference| {
                    !self.global_namespace_was_mutated_before("URL", reference)
                        && !self.global_property_was_mutated_before(
                            "URL",
                            "createObjectURL",
                            reference,
                        )
                })
            {
                return true;
            }
            if member.static_property_name() == Some("getURL")
                && member
                    .object()
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|runtime| {
                        runtime.static_property_name() == Some("runtime")
                            && is_proven_global_namespace_reference(
                                runtime.object(),
                                "chrome",
                                self.ctx,
                            )
                            && self.node_for_span(call.span).is_some_and(|reference| {
                                !self.global_namespace_was_mutated_before("chrome", reference)
                                    && !self.global_property_was_mutated_before(
                                        "chrome", "runtime", reference,
                                    )
                            })
                    })
            {
                return true;
            }
            if matches!(
                member.static_property_name(),
                Some("toString" | "toJSON" | "trim" | "trimEnd" | "trimStart")
            ) {
                if matches!(member.static_property_name(), Some("toString" | "toJSON"))
                    && self.is_global_url_instance_expression(member.object())
                    && self
                        .node_for_span(call.span)
                        .and_then(|node| self.execution_reference_for_node(node))
                        .is_some_and(|reference| {
                            self.global_property_was_mutated_before("URL", "prototype", reference)
                                || self.url_receiver_was_mutated_before(member.object(), reference)
                        })
                {
                    return false;
                }
                return self.is_trusted_destination(member.object(), depth + 1, visited_symbols);
            }
        }
        if let Expression::Identifier(identifier) = call.callee.get_inner_expression()
            && let Some(function_node) = self.resolve_local_function(identifier)
        {
            let Some(returns) = self.function_return_expressions(function_node) else {
                return false;
            };
            let previous_reference = self
                .local_serialization_reference
                .replace(self.node_for_span(call.span).map(AstNode::id));
            let verdict = !returns.is_empty()
                && returns.into_iter().all(|returned| {
                    self.is_trusted_local_return(
                        returned,
                        function_node,
                        call,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    )
                });
            self.local_serialization_reference.set(previous_reference);
            return verdict;
        }
        if let Expression::Identifier(identifier) = call.callee.get_inner_expression()
            && Self::is_cross_file_url_helper_name(identifier.name.as_str())
            && let Some(symbol_id) = self.reference_symbol(identifier)
            && let Some(verdict) = self.cross_file_verdict(symbol_id, true)
        {
            return verdict;
        }
        false
    }

    fn is_trusted_local_return(
        &self,
        returned: &Expression<'a>,
        function_node: &AstNode<'a>,
        call: &CallExpression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if let Expression::Identifier(identifier) = returned.get_inner_expression()
            && let Some(argument) = self.parameter_argument(identifier, function_node, call)
        {
            return self.is_trusted_or_nullish(Some(argument), depth + 1, visited_symbols);
        }
        if let Expression::BinaryExpression(binary) = returned.get_inner_expression()
            && binary.operator == oxc_syntax::operator::BinaryOperator::Addition
        {
            let mut operands = Vec::new();
            Self::flatten_concat_operands(returned, &mut operands);
            if let Some(Expression::Identifier(first_identifier)) = operands
                .first()
                .map(|operand| operand.get_inner_expression())
                && let Some(argument) =
                    self.parameter_argument(first_identifier, function_node, call)
            {
                let mut suffix = String::new();
                let mut following_expression = false;
                for operand in operands.iter().skip(1) {
                    let Some(text) = Self::static_string_text(operand) else {
                        following_expression = true;
                        break;
                    };
                    suffix.push_str(text);
                }
                if Self::is_safe_interpolated_suffix(&suffix, following_expression)
                    && (!suffix.starts_with('/')
                        || self.is_proven_safe_slash_base(
                            argument,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        ))
                {
                    return self.is_trusted_destination(argument, depth + 1, visited_symbols);
                }
            }
        }
        if let Expression::TemplateLiteral(template) = returned.get_inner_expression()
            && template
                .quasis
                .first()
                .is_none_or(|quasi| quasi.value.raw.is_empty())
            && let Some(Expression::Identifier(first_identifier)) = template
                .expressions
                .first()
                .map(Expression::get_inner_expression)
            && let Some(argument) = self.parameter_argument(first_identifier, function_node, call)
        {
            let suffix = template
                .quasis
                .get(1)
                .map_or("", |quasi| quasi.value.raw.as_str());
            if Self::is_safe_interpolated_suffix(&suffix, template.expressions.len() > 1)
                && (!suffix.starts_with('/')
                    || self.is_proven_safe_slash_base(
                        argument,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    ))
            {
                return self.is_trusted_destination(argument, depth + 1, visited_symbols);
            }
        }
        self.is_trusted_or_nullish(Some(returned), depth, visited_symbols)
    }

    fn flatten_concat_operands<'expression>(
        expression: &'expression Expression<'a>,
        operands: &mut Vec<&'expression Expression<'a>>,
    ) {
        if let Expression::BinaryExpression(binary) = expression.get_inner_expression()
            && binary.operator == oxc_syntax::operator::BinaryOperator::Addition
        {
            Self::flatten_concat_operands(&binary.left, operands);
            Self::flatten_concat_operands(&binary.right, operands);
        } else {
            operands.push(expression.get_inner_expression());
        }
    }

    fn static_string_text<'value>(expression: &'value Expression<'_>) -> Option<&'value str> {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
                .quasis
                .first()
                .map(|quasi| quasi.value.raw.as_str()),
            _ => None,
        }
    }

    fn parameter_argument<'call>(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
        function_node: &AstNode<'a>,
        call: &'call CallExpression<'a>,
    ) -> Option<&'call Expression<'a>> {
        let symbol_id = self.reference_symbol(identifier)?;
        let parameter_index = match function_node.kind() {
            AstKind::Function(function) => function.params.items.iter().position(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifiers()
                    .iter()
                    .any(|binding| binding.symbol_id() == symbol_id)
            }),
            AstKind::ArrowFunctionExpression(arrow) => {
                arrow.params.items.iter().position(|parameter| {
                    parameter
                        .pattern
                        .get_binding_identifiers()
                        .iter()
                        .any(|binding| binding.symbol_id() == symbol_id)
                })
            }
            _ => None,
        }?;
        call.arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
    }

    fn is_trusted_member(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(member) = expression.as_member_expression() else {
            return false;
        };
        if self.is_same_origin_location_read(expression) {
            return true;
        }
        let Some(property_name) = member.static_property_name() else {
            return self.is_trusted_array_index(member, depth + 1, visited_symbols);
        };
        if property_name == "href"
            && !member.is_computed()
            && matches!(
                member.object().get_inner_expression(),
                Expression::Identifier(_)
            )
            && self.is_trusted_url_instance(member.object(), expression, depth + 1, visited_symbols)
        {
            return true;
        }
        if property_name == "href"
            && !member.is_computed()
            && self.is_trusted_anchor_parameter(member.object(), depth + 1, visited_symbols)
        {
            return true;
        }
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(receiver) else {
            return false;
        };
        if self.symbol_has_write_before_current_open(symbol_id)
            || self.current_open.is_some_and(|open_id| {
                has_possible_static_property_write_before(
                    receiver,
                    property_name,
                    self.ctx.nodes().get_node(open_id),
                    &self.property_write_analysis,
                    self.ctx,
                )
            })
        {
            return false;
        }
        let Some(Expression::ObjectExpression(object)) = self
            .const_initializer(symbol_id)
            .map(Expression::get_inner_expression)
        else {
            return self.is_trusted_iteration_member(
                receiver,
                property_name,
                depth,
                visited_symbols,
            );
        };
        self.object_supplies_trusted_property(object, property_name, depth, visited_symbols)
    }

    fn is_trusted_array_index(
        &self,
        member: &oxc_ast::ast::MemberExpression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let oxc_ast::ast::MemberExpression::ComputedMemberExpression(computed) = member else {
            return false;
        };
        let Expression::NumericLiteral(index_literal) = computed.expression.get_inner_expression()
        else {
            return false;
        };
        if index_literal.value < 0.0 || index_literal.value.fract() != 0.0 {
            return false;
        }
        let element_index = index_literal.value as usize;
        let receiver = &computed.object;
        let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if self.symbol_has_write_before_current_open(symbol_id) {
            return false;
        }
        if self.current_open.is_some_and(|open_id| {
            self.array_symbol_was_mutated_before(
                symbol_id,
                self.ctx.nodes().get_node(open_id),
                None,
            )
        }) {
            return false;
        }
        let Some(initializer) = self.const_initializer(symbol_id) else {
            return false;
        };
        match initializer.get_inner_expression() {
            Expression::ArrayExpression(array) => {
                self.array_element_is_trusted(array, element_index, depth, visited_symbols)
            }
            Expression::CallExpression(call) => {
                let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(function_node) = self.resolve_local_function(callee) else {
                    return false;
                };
                let Some(returned) = self.function_return_expressions(function_node) else {
                    return false;
                };
                !returned.is_empty()
                    && returned.iter().all(|returned_expression| {
                        let Expression::ArrayExpression(array) =
                            returned_expression.get_inner_expression()
                        else {
                            return false;
                        };
                        self.array_element_is_trusted(
                            array,
                            element_index,
                            depth,
                            &mut visited_symbols.clone(),
                        )
                    })
            }
            _ => false,
        }
    }

    fn array_element_is_trusted(
        &self,
        array: &oxc_ast::ast::ArrayExpression<'a>,
        element_index: usize,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(element) = array.elements.get(element_index) else {
            return false;
        };
        match element {
            ArrayExpressionElement::Elision(_) | ArrayExpressionElement::SpreadElement(_) => false,
            element => {
                self.is_trusted_destination(element.to_expression(), depth + 1, visited_symbols)
            }
        }
    }

    fn is_trusted_iteration_member(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
        property_name: &str,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if self.symbol_has_write_before_current_open(symbol_id) {
            return false;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let Some(function_node) = self.enclosing_function(declaration) else {
            return false;
        };
        if self
            .function_parameter_for_symbol(function_node, symbol_id)
            .is_none()
        {
            return false;
        }
        let parent = self.ctx.nodes().parent_node(function_node.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if !matches!(
            Self::terminal_callee_name(&call.callee),
            Some("map" | "forEach")
        ) {
            return false;
        }
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        let array_expression = match member.object().get_inner_expression() {
            Expression::ArrayExpression(array) => Some(array),
            Expression::Identifier(array_identifier) => {
                let Some(array_symbol) = self.reference_symbol(array_identifier) else {
                    return false;
                };
                if self.current_open.is_some_and(|open_id| {
                    self.array_symbol_was_mutated_before(
                        array_symbol,
                        self.ctx.nodes().get_node(open_id),
                        Some(property_name),
                    )
                }) {
                    return false;
                }
                self.const_initializer(array_symbol)
                    .and_then(|initializer| match initializer.get_inner_expression() {
                        Expression::ArrayExpression(array) => Some(array),
                        _ => None,
                    })
            }
            _ => None,
        };
        let Some(array) = array_expression else {
            return false;
        };
        !array.elements.is_empty()
            && array.elements.iter().all(|element| {
                let Expression::ObjectExpression(object) =
                    element.to_expression().get_inner_expression()
                else {
                    return false;
                };
                self.object_supplies_trusted_property(
                    object,
                    property_name,
                    depth,
                    &mut visited_symbols.clone(),
                )
            })
    }

    fn is_trusted_destructured_iteration(
        &self,
        symbol_id: SymbolId,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let Some(function_node) = self.enclosing_function(declaration) else {
            return false;
        };
        let Some((_, parameter_pattern)) =
            self.function_parameter_for_symbol(function_node, symbol_id)
        else {
            return false;
        };
        let Some(property_name) = binding_property_name_for_symbol(parameter_pattern, symbol_id)
        else {
            return false;
        };
        let parent = self.ctx.nodes().parent_node(function_node.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if !matches!(
            Self::terminal_callee_name(&call.callee),
            Some("map" | "forEach")
        ) {
            return false;
        }
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        let array = match member.object().get_inner_expression() {
            Expression::ArrayExpression(array) => Some(array),
            Expression::Identifier(identifier) => {
                let Some(array_symbol) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_has_write_before_current_open(array_symbol)
                    || self.current_open.is_some_and(|open_id| {
                        self.array_symbol_was_mutated_before(
                            array_symbol,
                            self.ctx.nodes().get_node(open_id),
                            Some(property_name.as_str()),
                        )
                    })
                    || self.current_open.is_some_and(|open_id| {
                        has_possible_static_property_write_before(
                            identifier,
                            property_name.as_str(),
                            self.ctx.nodes().get_node(open_id),
                            &self.property_write_analysis,
                            self.ctx,
                        )
                    })
                {
                    return false;
                }
                match self
                    .const_initializer(array_symbol)
                    .map(Expression::get_inner_expression)
                {
                    Some(Expression::ArrayExpression(array)) => Some(array),
                    _ => None,
                }
            }
            _ => None,
        };
        let Some(array) = array else {
            return false;
        };
        self.array_every_object_property_trusted(
            array,
            property_name.as_str(),
            depth,
            visited_symbols,
        )
    }

    fn array_every_object_property_trusted(
        &self,
        array: &oxc_ast::ast::ArrayExpression<'a>,
        property_name: &str,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        !array.elements.is_empty()
            && array.elements.iter().all(|element| match element {
                ArrayExpressionElement::Elision(_) | ArrayExpressionElement::SpreadElement(_) => {
                    false
                }
                element => {
                    let Expression::ObjectExpression(object) =
                        element.to_expression().get_inner_expression()
                    else {
                        return false;
                    };
                    self.object_supplies_trusted_property(
                        object,
                        property_name,
                        depth,
                        &mut visited_symbols.clone(),
                    )
                }
            })
    }

    fn object_supplies_trusted_property(
        &self,
        object: &oxc_ast::ast::ObjectExpression<'a>,
        property_name: &str,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let mut trusted_value = None;
        for property in &object.properties {
            match property {
                ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some(property_name) =>
                {
                    trusted_value = Some(self.is_trusted_destination(
                        &property.value,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    ));
                }
                ObjectPropertyKind::SpreadProperty(_) => trusted_value = Some(false),
                ObjectPropertyKind::ObjectProperty(property)
                    if property.computed && property.key.static_name().is_none() =>
                {
                    trusted_value = Some(false);
                }
                _ => {}
            }
        }
        trusted_value == Some(true)
    }

    fn is_trusted_local_component_prop(
        &self,
        symbol_id: SymbolId,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let Some(component_function) = self.enclosing_function(declaration) else {
            return false;
        };
        let Some((_, parameter_pattern)) =
            self.function_parameter_for_symbol(component_function, symbol_id)
        else {
            return false;
        };
        let Some(property_name) = binding_property_name_for_symbol(parameter_pattern, symbol_id)
        else {
            return false;
        };
        let Some(component_symbol) = self.local_function_symbol(component_function) else {
            return false;
        };
        let component_name = self.ctx.scoping().symbol_name(component_symbol);
        if !component_name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_uppercase)
            || self.is_exported_node(component_function)
        {
            return false;
        }
        for reference in self.ctx.scoping().get_resolved_references(component_symbol) {
            let reference_node = self.ctx.nodes().get_node(reference.node_id());
            let is_jsx_name = self
                .ctx
                .nodes()
                .ancestors(reference_node.id())
                .any(|ancestor| match ancestor.kind() {
                    AstKind::JSXOpeningElement(opening) => {
                        opening.name.span() == reference_node.span()
                    }
                    AstKind::JSXClosingElement(closing) => {
                        closing.name.span() == reference_node.span()
                    }
                    _ => false,
                });
            if !is_jsx_name {
                return false;
            }
        }
        let mut usage_count = 0usize;
        for node in self.ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                continue;
            };
            let JSXElementName::Identifier(element_name) = &opening.name else {
                continue;
            };
            if element_name.name != component_name {
                continue;
            }
            usage_count += 1;
            if opening.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                return false;
            }
            let Some(attribute) =
                get_authoritative_jsx_attribute(opening, property_name.as_str(), true)
            else {
                continue;
            };
            let Some(value) = &attribute.value else {
                return false;
            };
            match value {
                JSXAttributeValue::StringLiteral(_) => {}
                JSXAttributeValue::ExpressionContainer(container) => {
                    let Some(expression) = container.expression.as_expression() else {
                        return false;
                    };
                    if !self.is_trusted_or_nullish(
                        Some(expression),
                        depth + 1,
                        &mut visited_symbols.clone(),
                    ) {
                        return false;
                    }
                }
                _ => return false,
            }
        }
        usage_count > 0
    }

    fn is_trusted_use_state_binding(
        &self,
        state_symbol_id: SymbolId,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let declaration = self.ctx.symbol_declaration(state_symbol_id);
        let Some(declarator_node) = self
            .ctx
            .nodes()
            .ancestors(declaration.id())
            .find(|ancestor| matches!(ancestor.kind(), AstKind::VariableDeclarator(_)))
        else {
            return false;
        };
        let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
            return false;
        };
        if !matches!(
            self.ctx.nodes().parent_node(declarator_node.id()).kind(),
            AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
        ) {
            return false;
        }
        let BindingPattern::ArrayPattern(array_pattern) = &declarator.id else {
            return false;
        };
        let Some(initializer) = declarator.init.as_ref() else {
            return false;
        };
        let Expression::CallExpression(state_call) = initializer.get_inner_expression() else {
            return false;
        };
        if Self::terminal_callee_name(&state_call.callee) != Some("useState") {
            return false;
        }
        let state_matches = array_pattern
            .elements
            .first()
            .and_then(Option::as_ref)
            .is_some_and(|pattern| binding_pattern_has_symbol(pattern, state_symbol_id));
        if !state_matches {
            return false;
        }
        if let Some(initial_state) = state_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            && !self.is_trusted_or_nullish(
                Some(initial_state),
                depth + 1,
                &mut visited_symbols.clone(),
            )
        {
            return false;
        }
        let Some(setter_pattern) = array_pattern.elements.get(1).and_then(Option::as_ref) else {
            return false;
        };
        let Some(setter) = setter_pattern.get_binding_identifier() else {
            return false;
        };
        let setter_symbol = setter.symbol_id();
        for reference in self.ctx.scoping().get_resolved_references(setter_symbol) {
            let reference_node = self.ctx.nodes().get_node(reference.node_id());
            let root = self.transparent_node_root(reference_node);
            let parent = self.ctx.nodes().parent_node(root.id());
            let AstKind::CallExpression(call) = parent.kind() else {
                return false;
            };
            if call.callee.span() != root.span() {
                return false;
            }
            let Some(value) = call.arguments.first().and_then(Argument::as_expression) else {
                return false;
            };
            if !self.is_trusted_or_nullish(Some(value), depth + 1, &mut visited_symbols.clone()) {
                return false;
            }
        }
        true
    }

    fn is_react_api_call(&self, call: &CallExpression<'a>, api_name: &str) -> bool {
        match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => self.reference_symbol(identifier).is_some_and(
                |symbol_id| {
                    self.ctx.module_record().import_entries.iter().any(|entry| {
                        entry.module_request.name() == "react"
                            && self
                                .ctx
                                .scoping()
                                .get_root_binding(entry.local_name.name().into())
                                == Some(symbol_id)
                            && matches!(&entry.import_name, ImportImportName::Name(name) if name.name() == api_name)
                    })
                },
            ),
            expression => expression.as_member_expression().is_some_and(|member| {
                member.static_property_name() == Some(api_name)
                    && self.identifier_is_react_namespace(
                        member.object(),
                        &mut FxHashSet::default(),
                    )
            }),
        }
    }

    fn identifier_is_react_namespace(
        &self,
        expression: &Expression<'a>,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        if self.ctx.module_record().import_entries.iter().any(|entry| {
            entry.module_request.name() == "react"
                && self
                    .ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
                && matches!(
                    &entry.import_name,
                    ImportImportName::Default(_) | ImportImportName::NamespaceObject
                )
        }) {
            return true;
        }
        self.const_initializer(symbol_id)
            .is_some_and(|initializer| {
                self.identifier_is_react_namespace(initializer, visited_symbols)
            })
    }

    fn function_parameter_for_symbol(
        &self,
        function_node: &AstNode<'a>,
        symbol_id: SymbolId,
    ) -> Option<(usize, &BindingPattern<'a>)> {
        let parameters = match function_node.kind() {
            AstKind::Function(function) => &function.params.items,
            AstKind::ArrowFunctionExpression(arrow) => &arrow.params.items,
            _ => return None,
        };
        parameters
            .iter()
            .enumerate()
            .find_map(|(index, parameter)| {
                binding_pattern_has_symbol(&parameter.pattern, symbol_id)
                    .then_some((index, &parameter.pattern))
            })
    }

    fn is_trusted_url_instance(
        &self,
        receiver: &Expression<'a>,
        serialization_expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let serialization_reference = self
            .expression_node(serialization_expression)
            .and_then(|node| self.execution_reference_for_node(node));
        if serialization_reference.is_some_and(|reference| {
            self.global_property_was_mutated_before("URL", "prototype", reference)
                || self.url_receiver_was_mutated_before(receiver, reference)
        }) {
            return false;
        }
        match receiver.get_inner_expression() {
            Expression::NewExpression(_) => {
                self.is_trusted_destination(receiver, depth + 1, visited_symbols)
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_has_write_before_current_open(symbol_id) {
                    return false;
                }
                self.const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        matches!(
                            initializer.get_inner_expression(),
                            Expression::NewExpression(_)
                        ) && self.is_trusted_destination(initializer, depth + 1, visited_symbols)
                    })
            }
            _ => false,
        }
    }

    fn is_global_url_instance_expression(&self, expression: &Expression<'a>) -> bool {
        match expression.get_inner_expression() {
            Expression::NewExpression(new_expression) => {
                is_proven_global_namespace_reference(&new_expression.callee, "URL", self.ctx)
            }
            Expression::Identifier(identifier) => self
                .reference_symbol(identifier)
                .and_then(|symbol_id| self.const_initializer(symbol_id))
                .is_some_and(|initializer| self.is_global_url_instance_expression(initializer)),
            _ => false,
        }
    }

    fn is_trusted_anchor_parameter(
        &self,
        receiver: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let Some(function_node) = self.enclosing_function(declaration) else {
            return false;
        };
        let Some((parameter_index, _)) =
            self.function_parameter_for_symbol(function_node, symbol_id)
        else {
            return false;
        };
        if self.current_open.is_some_and(|open_id| {
            has_possible_static_property_write_before(
                identifier,
                "href",
                self.ctx.nodes().get_node(open_id),
                &self.property_write_analysis,
                self.ctx,
            )
        }) {
            return false;
        }
        let Some(calls) = self.direct_named_local_function_calls(function_node) else {
            return false;
        };
        !calls.is_empty()
            && calls.iter().all(|call_id| {
                let AstKind::CallExpression(call) = self.ctx.nodes().get_node(*call_id).kind()
                else {
                    return false;
                };
                let Some(argument) = call
                    .arguments
                    .get(parameter_index)
                    .and_then(Argument::as_expression)
                else {
                    return false;
                };
                let Some(member) = argument.get_inner_expression().as_member_expression() else {
                    return false;
                };
                if member.static_property_name() != Some("currentTarget") {
                    return false;
                }
                let Expression::Identifier(event_identifier) =
                    member.object().get_inner_expression()
                else {
                    return false;
                };
                let Some(event_symbol) = self.reference_symbol(event_identifier) else {
                    return false;
                };
                let event_declaration = self.ctx.symbol_declaration(event_symbol);
                let Some(handler_function) = self.enclosing_function(event_declaration) else {
                    return false;
                };
                self.function_parameter_for_symbol(handler_function, event_symbol)
                    .is_some()
                    && self.handler_only_serves_trusted_anchors(
                        handler_function,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    )
            })
    }

    fn handler_only_serves_trusted_anchors(
        &self,
        handler_function: &AstNode<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let parent = self.ctx.nodes().parent_node(handler_function.id());
        if matches!(parent.kind(), AstKind::JSXExpressionContainer(_)) {
            return self
                .jsx_event_handler_opening_element(parent)
                .is_some_and(|opening| {
                    self.jsx_anchor_has_trusted_href(opening, depth, visited_symbols)
                });
        }
        let Some(handler_symbol) = self.local_function_symbol(handler_function) else {
            return false;
        };
        let mut usage_count = 0usize;
        for reference in self.ctx.scoping().get_resolved_references(handler_symbol) {
            let reference_node = self.ctx.nodes().get_node(reference.node_id());
            let root = self.transparent_node_root(reference_node);
            let parent = self.ctx.nodes().parent_node(root.id());
            let Some(opening) = self.jsx_event_handler_opening_element(parent) else {
                return false;
            };
            usage_count += 1;
            if !self.jsx_anchor_has_trusted_href(opening, depth, &mut visited_symbols.clone()) {
                return false;
            }
        }
        usage_count > 0
    }

    fn jsx_event_handler_opening_element(
        &self,
        expression_container: &AstNode<'a>,
    ) -> Option<&oxc_ast::ast::JSXOpeningElement<'a>> {
        let AstKind::JSXExpressionContainer(_) = expression_container.kind() else {
            return None;
        };
        let attribute_node = self.ctx.nodes().parent_node(expression_container.id());
        let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
            return None;
        };
        if !Self::jsx_attribute_name(attribute).is_some_and(Self::is_event_handler_name) {
            return None;
        }
        let opening_node = self.ctx.nodes().parent_node(attribute_node.id());
        let AstKind::JSXOpeningElement(opening) = opening_node.kind() else {
            return None;
        };
        Some(opening)
    }

    fn jsx_anchor_has_trusted_href(
        &self,
        opening: &oxc_ast::ast::JSXOpeningElement<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if !matches!(&opening.name, JSXElementName::Identifier(identifier) if identifier.name == "a")
        {
            return false;
        }
        let Some(attribute) = get_authoritative_jsx_attribute(opening, "href", true) else {
            return false;
        };
        let Some(value) = &attribute.value else {
            return false;
        };
        match value {
            JSXAttributeValue::StringLiteral(_) => true,
            JSXAttributeValue::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .is_some_and(|expression| {
                    self.is_trusted_destination(expression, depth + 1, &mut visited_symbols.clone())
                }),
            _ => false,
        }
    }

    fn is_same_origin_location_read(&self, expression: &Expression<'a>) -> bool {
        let Some(member) = expression.as_member_expression() else {
            return false;
        };
        if member.is_computed() {
            return false;
        }
        let Some(property_name) = member.static_property_name() else {
            return false;
        };
        if property_name == "origin"
            && is_proven_global_namespace_reference(member.object(), "window", self.ctx)
        {
            return true;
        }
        if !matches!(property_name, "origin" | "href") {
            return false;
        }
        self.is_location_receiver(member.object(), &mut FxHashSet::default())
    }

    fn is_location_receiver(
        &self,
        expression: &Expression<'a>,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        if is_proven_global_namespace_reference(expression, "location", self.ctx) {
            return true;
        }
        let Expression::CallExpression(call) = expression.get_inner_expression() else {
            return false;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        let Some(function_node) = self.resolve_local_function(identifier) else {
            return false;
        };
        if !visited_functions.insert(function_node.id()) {
            return false;
        }
        let Some(returns) = self.function_return_expressions(function_node) else {
            return false;
        };
        !returns.is_empty()
            && returns
                .iter()
                .all(|returned| self.is_location_receiver(returned, &mut visited_functions.clone()))
    }

    fn global_namespace_was_mutated_before(
        &self,
        namespace_name: &str,
        reference: &AstNode<'a>,
    ) -> bool {
        let has_mutation = self.ctx.nodes().iter().any(|candidate| {
            if !can_node_execute_before(
                candidate,
                reference,
                &self.property_write_analysis,
                self.ctx,
            ) {
                return false;
            }
            let direct_mutation = match candidate.kind() {
                AstKind::AssignmentExpression(assignment) => match &assignment.left {
                    oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                        identifier.name == namespace_name
                            && self
                                .ctx
                                .scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id()
                                .is_none()
                    }
                    target => target.as_member_expression().is_some_and(|member| {
                        self.member_chain_starts_at_global(member, namespace_name)
                    }),
                },
                AstKind::UpdateExpression(update) => update
                    .argument
                    .as_member_expression()
                    .is_some_and(|member| {
                        self.member_chain_starts_at_global(member, namespace_name)
                    }),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    unary.argument.as_member_expression().is_some_and(|member| {
                        self.member_chain_starts_at_global(member, namespace_name)
                    })
                }
                _ => false,
            };
            if direct_mutation {
                return true;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            if self.global_object_mutation_method_name(call).is_none() {
                return false;
            }
            let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
                return false;
            };
            is_proven_global_namespace_reference(target, namespace_name, self.ctx)
                || target
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|member| {
                        self.member_chain_starts_at_global(member, namespace_name)
                    })
        });
        has_mutation
    }

    fn element_has_router_contract(
        &self,
        destination_symbol: SymbolId,
        current_open: &AstNode<'a>,
    ) -> bool {
        let Some(opening_node) = self
            .ctx
            .nodes()
            .ancestors(current_open.id())
            .find(|ancestor| matches!(ancestor.kind(), AstKind::JSXOpeningElement(_)))
        else {
            return false;
        };
        let mut matching_opens = Vec::new();
        let mut matching_router_calls = Vec::new();
        for candidate in self.ctx.nodes().iter() {
            if !opening_node.span().contains_inclusive(candidate.span()) {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let argument_symbol = call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| match argument.get_inner_expression() {
                    Expression::Identifier(identifier) => self.reference_symbol(identifier),
                    _ => None,
                });
            if argument_symbol != Some(destination_symbol) {
                continue;
            }
            if self.is_window_open_call(candidate, call) {
                matching_opens.push(candidate);
                continue;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if matches!(member.static_property_name(), Some("push" | "replace"))
                && self.is_next_router_receiver(member.object())
                && self.enclosing_function(candidate).is_some_and(|function| {
                    is_node_reachable_within_function(candidate, function, self.ctx)
                })
            {
                matching_router_calls.push(candidate);
            }
        }
        matching_opens.iter().any(|open| {
            matching_router_calls
                .iter()
                .any(|router| self.calls_execute_in_opposite_branches(open, router))
        })
    }

    fn global_property_was_mutated_before(
        &self,
        namespace_name: &str,
        property_name: &str,
        reference: &AstNode<'a>,
    ) -> bool {
        self.ctx.nodes().iter().any(|candidate| {
            if !can_node_execute_before(
                candidate,
                reference,
                &self.property_write_analysis,
                self.ctx,
            ) {
                return false;
            }
            let member = match candidate.kind() {
                AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression(),
                AstKind::UpdateExpression(update) => update.argument.as_member_expression(),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    unary.argument.as_member_expression()
                }
                _ => None,
            };
            if member.is_some_and(|member| {
                self.member_chain_starts_at_global(member, namespace_name)
                    && self.member_chain_contains_property(member, property_name)
            }) {
                return true;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let Some(method_name) = self.global_object_mutation_method_name(call) else {
                return false;
            };
            let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
                return false;
            };
            if is_proven_global_namespace_reference(target, namespace_name, self.ctx)
                && self.mutation_call_may_write_property(call, method_name, Some(property_name))
            {
                return true;
            }
            let target_matches = target
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|target_member| {
                    self.member_chain_starts_at_global(target_member, namespace_name)
                        && self.member_chain_contains_property(target_member, property_name)
                });
            target_matches && self.mutation_call_may_write_property(call, method_name, None)
        })
    }

    fn global_object_mutation_method_name<'call>(
        &self,
        call: &'call CallExpression<'a>,
    ) -> Option<&'call str> {
        const OBJECT_METHODS: [&str; 4] = [
            "assign",
            "defineProperties",
            "defineProperty",
            "setPrototypeOf",
        ];
        const REFLECT_METHODS: [&str; 3] = ["defineProperty", "set", "setPrototypeOf"];
        let callee = call.callee.get_inner_expression();
        let method_name = Self::terminal_callee_name(callee)?;
        if !OBJECT_METHODS.contains(&method_name) && !REFLECT_METHODS.contains(&method_name) {
            return None;
        }
        if let Some(member) = callee.as_member_expression() {
            let is_object_method = OBJECT_METHODS.contains(&method_name)
                && is_proven_global_namespace_reference(member.object(), "Object", self.ctx);
            let is_reflect_method = REFLECT_METHODS.contains(&method_name)
                && is_proven_global_namespace_reference(member.object(), "Reflect", self.ctx);
            return (is_object_method || is_reflect_method).then_some(method_name);
        }
        let Expression::Identifier(identifier) = callee else {
            return None;
        };
        let is_object_alias = OBJECT_METHODS.contains(&method_name)
            && self.identifier_resolves_to_global_method(
                identifier,
                "Object",
                method_name,
                &mut FxHashSet::default(),
            );
        let is_reflect_alias = REFLECT_METHODS.contains(&method_name)
            && self.identifier_resolves_to_global_method(
                identifier,
                "Reflect",
                method_name,
                &mut FxHashSet::default(),
            );
        (is_object_alias || is_reflect_alias).then_some(method_name)
    }

    fn identifier_resolves_to_global_method(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
        namespace_name: &str,
        method_name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            self.ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref()
            == Some(method_name)
            && is_proven_global_namespace_reference(initializer, namespace_name, self.ctx)
        {
            return true;
        }
        match initializer.get_inner_expression() {
            Expression::Identifier(alias) => self.identifier_resolves_to_global_method(
                alias,
                namespace_name,
                method_name,
                visited_symbols,
            ),
            expression => expression.as_member_expression().is_some_and(|member| {
                member.static_property_name() == Some(method_name)
                    && is_proven_global_namespace_reference(
                        member.object(),
                        namespace_name,
                        self.ctx,
                    )
            }),
        }
    }

    fn mutation_call_may_write_property(
        &self,
        call: &CallExpression<'a>,
        method_name: &str,
        property_name: Option<&str>,
    ) -> bool {
        match method_name {
            "defineProperty" | "set" => {
                let Some(property_name) = property_name else {
                    return true;
                };
                call.arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .and_then(Self::static_mutation_property_name)
                    .is_none_or(|written_name| written_name == property_name)
            }
            "assign" => {
                let Some(property_name) = property_name else {
                    return true;
                };
                call.arguments.iter().skip(1).any(|argument| {
                    let Some(Expression::ObjectExpression(object)) = argument
                        .as_expression()
                        .map(Expression::get_inner_expression)
                    else {
                        return true;
                    };
                    object.properties.iter().any(|property| match property {
                        ObjectPropertyKind::ObjectProperty(property) => property
                            .key
                            .static_name()
                            .is_none_or(|name| name.as_ref() == property_name),
                        ObjectPropertyKind::SpreadProperty(_) => true,
                    })
                })
            }
            "defineProperties" => {
                let Some(property_name) = property_name else {
                    return true;
                };
                let Some(argument) = call.arguments.get(1).and_then(Argument::as_expression) else {
                    return true;
                };
                let Expression::ObjectExpression(object) = argument.get_inner_expression() else {
                    return true;
                };
                object.properties.iter().any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => property
                        .key
                        .static_name()
                        .is_none_or(|name| name.as_ref() == property_name),
                    ObjectPropertyKind::SpreadProperty(_) => true,
                })
            }
            "setPrototypeOf" => true,
            _ => false,
        }
    }

    fn member_chain_starts_at_global(
        &self,
        member: &oxc_ast::ast::MemberExpression<'a>,
        namespace_name: &str,
    ) -> bool {
        if member.static_property_name() == Some(namespace_name)
            && ["global", "globalThis", "self", "window"]
                .iter()
                .any(|receiver_name| {
                    is_proven_global_namespace_reference(member.object(), receiver_name, self.ctx)
                })
        {
            return true;
        }
        let object = member.object().get_inner_expression();
        self.expression_chain_starts_at_global(object, namespace_name, &mut FxHashSet::default())
    }

    fn expression_chain_starts_at_global(
        &self,
        expression: &Expression<'a>,
        namespace_name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if is_proven_global_namespace_reference(expression, namespace_name, self.ctx) {
            return true;
        }
        if let Some(member) = expression.get_inner_expression().as_member_expression() {
            return self.expression_chain_starts_at_global(
                member.object(),
                namespace_name,
                visited_symbols,
            );
        }
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let Some(initializer) = &declarator.init else {
            return false;
        };
        self.expression_chain_starts_at_global(initializer, namespace_name, visited_symbols)
    }

    fn member_chain_contains_property(
        &self,
        member: &oxc_ast::ast::MemberExpression<'a>,
        property_name: &str,
    ) -> bool {
        member.static_property_name() == Some(property_name)
            || self.expression_chain_contains_property(
                member.object(),
                property_name,
                &mut FxHashSet::default(),
            )
            || member
                .object()
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|inner| self.member_chain_contains_property(inner, property_name))
    }

    fn expression_chain_contains_property(
        &self,
        expression: &Expression<'a>,
        property_name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if let Some(member) = expression.get_inner_expression().as_member_expression() {
            return member.static_property_name() == Some(property_name)
                || self.expression_chain_contains_property(
                    member.object(),
                    property_name,
                    visited_symbols,
                );
        }
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref()
            == Some(property_name)
        {
            return true;
        }
        declarator.init.as_ref().is_some_and(|initializer| {
            self.expression_chain_contains_property(initializer, property_name, visited_symbols)
        })
    }

    fn url_receiver_was_mutated_before(
        &self,
        receiver: &Expression<'a>,
        reference: &AstNode<'a>,
    ) -> bool {
        let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
            return false;
        };
        [
            "href", "host", "hostname", "password", "port", "protocol", "toJSON", "toString",
            "username",
        ]
        .iter()
        .any(|property_name| {
            has_possible_static_property_write_before(
                identifier,
                property_name,
                reference,
                &self.property_write_analysis,
                self.ctx,
            )
        }) || self.object_mutation_call_targets_receiver(identifier, reference)
    }

    fn object_mutation_call_targets_receiver(
        &self,
        receiver: &oxc_ast::ast::IdentifierReference<'a>,
        reference: &AstNode<'a>,
    ) -> bool {
        let Some(receiver_symbol) = resolve_const_identifier_root_symbol(receiver, self.ctx) else {
            return false;
        };
        self.ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            let Some(method_name) = self.global_object_mutation_method_name(call) else {
                return false;
            };
            let Some(Expression::Identifier(target)) = call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression)
            else {
                return false;
            };
            resolve_const_identifier_root_symbol(target, self.ctx) == Some(receiver_symbol)
                && can_node_execute_before(
                    candidate,
                    reference,
                    &self.property_write_analysis,
                    self.ctx,
                )
                && [
                    "href", "host", "hostname", "password", "port", "protocol", "toJSON",
                    "toString", "username",
                ]
                .iter()
                .any(|property_name| {
                    self.mutation_call_may_write_property(call, method_name, Some(property_name))
                })
        })
    }

    fn coercion_reference_for(&self, expression: &Expression<'a>) -> Option<&AstNode<'a>> {
        if let Some(reference_id) = self.local_serialization_reference.get() {
            return Some(self.ctx.nodes().get_node(reference_id));
        }
        let open_node = self
            .current_open
            .map(|open_id| self.ctx.nodes().get_node(open_id));
        let expression_node = open_node.or_else(|| self.expression_node(expression))?;
        self.execution_reference_for_node(expression_node)
    }

    fn execution_reference_for_node<'node>(
        &'node self,
        expression_node: &'node AstNode<'a>,
    ) -> Option<&'node AstNode<'a>> {
        if let Some(reference_id) = self.local_serialization_reference.get() {
            return Some(self.ctx.nodes().get_node(reference_id));
        }
        let Some(function_node) = self.enclosing_function(expression_node) else {
            return Some(expression_node);
        };
        self.direct_local_function_calls(function_node)
            .unwrap_or_default()
            .into_iter()
            .max_by_key(|call_id| self.ctx.nodes().get_node(*call_id).span().start)
            .map(|call_id| self.ctx.nodes().get_node(call_id))
            .or(Some(expression_node))
    }

    fn array_symbol_was_mutated_before(
        &self,
        symbol_id: SymbolId,
        reference: &AstNode<'a>,
        nested_property_name: Option<&str>,
    ) -> bool {
        const MUTATING_METHODS: [&str; 9] = [
            "copyWithin",
            "fill",
            "pop",
            "push",
            "reverse",
            "shift",
            "sort",
            "splice",
            "unshift",
        ];
        self.const_alias_symbols(symbol_id)
            .into_iter()
            .any(|alias| {
                self.ctx.scoping().get_resolved_references(alias).any(|symbol_reference| {
                let identifier_node = self.ctx.nodes().get_node(symbol_reference.node_id());
                let identifier_root = self.transparent_node_root(identifier_node);
                let immediate_parent = self.ctx.nodes().parent_node(identifier_root.id());
                let Some(immediate_object_span) =
                    Self::ast_member_object_span(immediate_parent.kind())
                else {
                    return false;
                };
                if immediate_object_span != identifier_root.span() {
                    return false;
                }
                let member_root = self.transparent_node_root(immediate_parent);
                let member_parent = self.ctx.nodes().parent_node(member_root.id());
                if let AstKind::CallExpression(call) = member_parent.kind()
                    && call.callee.span() == member_root.span()
                    && MUTATING_METHODS.iter().any(|method_name| {
                        Self::ast_member_has_static_property(
                            immediate_parent.kind(),
                            method_name,
                        )
                    })
                {
                    return can_node_execute_before(
                        member_parent,
                        reference,
                        &self.property_write_analysis,
                        self.ctx,
                    );
                }
                let mut chain_node = immediate_parent;
                let mut chain_contains_property = nested_property_name.is_none();
                loop {
                    if let Some(property_name) = nested_property_name
                        && Self::ast_member_has_static_property(chain_node.kind(), property_name)
                    {
                        chain_contains_property = true;
                    }
                    let chain_root = self.transparent_node_root(chain_node);
                    let parent = self.ctx.nodes().parent_node(chain_root.id());
                    if Self::ast_member_object_span(parent.kind()) == Some(chain_root.span())
                    {
                        chain_node = parent;
                        continue;
                    }
                    let is_write = matches!(parent.kind(), AstKind::AssignmentExpression(assignment)
                        if assignment.left.span() == chain_root.span())
                        || matches!(parent.kind(), AstKind::UpdateExpression(update)
                            if update.argument.span() == chain_root.span())
                        || matches!(parent.kind(), AstKind::UnaryExpression(unary)
                            if unary.operator == UnaryOperator::Delete
                                && unary.argument.span() == chain_root.span());
                    return chain_contains_property
                        && is_write
                        && can_node_execute_before(
                            parent,
                            reference,
                            &self.property_write_analysis,
                            self.ctx,
                        );
                }
            })
            })
    }

    fn ast_member_object_span(kind: AstKind<'a>) -> Option<Span> {
        match kind {
            AstKind::StaticMemberExpression(member) => Some(member.object.span()),
            AstKind::ComputedMemberExpression(member) => Some(member.object.span()),
            AstKind::PrivateFieldExpression(member) => Some(member.object.span()),
            _ => None,
        }
    }

    fn ast_member_has_static_property(kind: AstKind<'a>, property_name: &str) -> bool {
        match kind {
            AstKind::StaticMemberExpression(member) => member.property.name == property_name,
            AstKind::ComputedMemberExpression(member) => {
                member.static_property_name().as_deref() == Some(property_name)
            }
            AstKind::PrivateFieldExpression(_) => false,
            _ => false,
        }
    }

    fn resolve_local_function(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ) -> Option<&AstNode<'a>> {
        let symbol_id = self.reference_symbol(identifier)?;
        if self.symbol_has_write_before_current_open(symbol_id) {
            return None;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(_) if !self.is_exported_node(declaration) => Some(declaration),
            AstKind::VariableDeclarator(declarator) if matches!(self.ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) =>
            {
                let initializer = declarator.init.as_ref()?.get_inner_expression();
                match initializer {
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                        self.expression_node(initializer)
                    }
                    Expression::CallExpression(call)
                        if Self::terminal_callee_name(&call.callee) == Some("useCallback") =>
                    {
                        call.arguments
                            .first()
                            .and_then(Argument::as_expression)
                            .and_then(|expression| self.expression_node(expression))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn function_return_expressions(
        &self,
        function_node: &AstNode<'a>,
    ) -> Option<Vec<&Expression<'a>>> {
        if let AstKind::ArrowFunctionExpression(arrow) = function_node.kind()
            && !matches!(&arrow.body, ArrowFunctionBody::FunctionBody(_))
        {
            return Some(vec![arrow.body.to_expression()]);
        }
        let mut returned_expressions = Vec::new();
        for node in self.ctx.nodes().iter() {
            let AstKind::ReturnStatement(statement) = node.kind() else {
                continue;
            };
            if !self
                .enclosing_function(node)
                .is_some_and(|enclosing| enclosing.id() == function_node.id())
            {
                continue;
            }
            let Some(argument) = statement.argument.as_ref() else {
                return None;
            };
            returned_expressions.push(argument);
        }
        Some(returned_expressions)
    }

    fn is_trusted_local_parameter(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if self.symbol_has_write_before_current_open(symbol_id) {
            return false;
        }
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let Some(function_node) = self.enclosing_function(declaration) else {
            return false;
        };
        let parameter_index = match function_node.kind() {
            AstKind::Function(function) => function.params.items.iter().position(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifiers()
                    .iter()
                    .any(|binding| binding.symbol_id() == symbol_id)
            }),
            AstKind::ArrowFunctionExpression(arrow) => {
                arrow.params.items.iter().position(|parameter| {
                    parameter
                        .pattern
                        .get_binding_identifiers()
                        .iter()
                        .any(|binding| binding.symbol_id() == symbol_id)
                })
            }
            _ => None,
        };
        let Some(parameter_index) = parameter_index else {
            return false;
        };
        let Some(calls) = self.direct_named_local_function_calls(function_node) else {
            return false;
        };
        !calls.is_empty()
            && calls.iter().all(|call_id| {
                let AstKind::CallExpression(call) = self.ctx.nodes().get_node(*call_id).kind()
                else {
                    return false;
                };
                call.arguments
                    .get(parameter_index)
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        self.is_trusted_or_nullish(
                            Some(argument),
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    })
            })
    }

    fn is_let_assigned_only_trusted(
        &self,
        symbol_id: SymbolId,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if matches!(self.ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        {
            return false;
        }
        if declarator.init.as_ref().is_some_and(|initializer| {
            !self.is_trusted_destination(initializer, depth + 1, &mut visited_symbols.clone())
        }) {
            return false;
        }
        let mut saw_assignment = false;
        for reference in self.ctx.scoping().get_resolved_references(symbol_id) {
            if reference.is_read() {
                continue;
            }
            let reference_node = self.ctx.nodes().get_node(reference.node_id());
            let root = self.transparent_node_root(reference_node);
            let parent = self.ctx.nodes().parent_node(root.id());
            let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                return false;
            };
            if assignment.operator != AssignmentOperator::Assign
                || assignment.left.span() != root.span()
            {
                return false;
            }
            saw_assignment = true;
            if !self.is_trusted_destination(
                &assignment.right,
                depth + 1,
                &mut visited_symbols.clone(),
            ) {
                return false;
            }
        }
        saw_assignment
    }

    fn is_router_co_navigated(&self, identifier: &oxc_ast::ast::IdentifierReference<'a>) -> bool {
        let Some(open_id) = self.current_open else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        let open_node = self.ctx.nodes().get_node(open_id);
        let Some(function) = self.enclosing_function(open_node) else {
            return false;
        };
        let has_same_function_contract = self.ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            if self
                .enclosing_function(candidate)
                .is_none_or(|owner| owner.id() != function.id())
                || !is_node_reachable_within_function(candidate, function, self.ctx)
                || !self.calls_execute_in_opposite_branches(open_node, candidate)
            {
                return false;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            if !matches!(member.static_property_name(), Some("push" | "replace"))
                || !self.is_next_router_receiver(member.object())
            {
                return false;
            }
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|argument| match argument.get_inner_expression() {
                    Expression::Identifier(argument_identifier) => {
                        self.reference_symbol(argument_identifier)
                    }
                    _ => None,
                })
                == Some(symbol_id)
        });
        has_same_function_contract || self.element_has_router_contract(symbol_id, open_node)
    }

    fn is_next_router_receiver(&self, receiver: &Expression<'a>) -> bool {
        let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        self.ctx.module_record().import_entries.iter().any(|entry| {
            self.ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
                && entry.module_request.name() == "next/router"
                && matches!(entry.import_name, ImportImportName::Default(_))
        }) || self
            .const_initializer(symbol_id)
            .is_some_and(|initializer| {
                let Expression::CallExpression(call) = initializer.get_inner_expression() else {
                    return false;
                };
                let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(callee_symbol) = self.reference_symbol(callee) else {
                    return false;
                };
                self.ctx.module_record().import_entries.iter().any(|entry| {
                    self.ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(callee_symbol)
                        && matches!(entry.module_request.name(), "next/router" | "next/navigation")
                        && matches!(&entry.import_name, ImportImportName::Name(name) if name.name() == "useRouter")
                })
            })
    }

    fn calls_execute_in_opposite_branches(&self, left: &AstNode<'a>, right: &AstNode<'a>) -> bool {
        self.ctx
            .nodes()
            .ancestors(left.id())
            .any(|ancestor| match ancestor.kind() {
                AstKind::IfStatement(statement) => {
                    let left_is_consequent =
                        statement.consequent.span().contains_inclusive(left.span());
                    let left_is_alternate = statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(left.span()));
                    (left_is_consequent
                        && statement.alternate.as_ref().is_some_and(|alternate| {
                            alternate.span().contains_inclusive(right.span())
                        }))
                        || (left_is_alternate
                            && statement.consequent.span().contains_inclusive(right.span()))
                }
                AstKind::ConditionalExpression(conditional) => {
                    (conditional
                        .consequent
                        .span()
                        .contains_inclusive(left.span())
                        && conditional
                            .alternate
                            .span()
                            .contains_inclusive(right.span()))
                        || (conditional.alternate.span().contains_inclusive(left.span())
                            && conditional
                                .consequent
                                .span()
                                .contains_inclusive(right.span()))
                }
                _ => false,
            })
    }

    fn is_proven_safe_slash_base(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                let without_line_whitespace: String = literal
                    .value
                    .chars()
                    .filter(|character| !matches!(character, '\t' | '\n' | '\r'))
                    .collect();
                let normalized = without_line_whitespace
                    .trim_matches(|character| character <= ' ')
                    .replace('\\', "/");
                let normalized_lowercase = normalized.to_ascii_lowercase();
                let is_incomplete_scheme =
                    ["http:", "https:", "ftp:", "ws:", "wss:"]
                        .iter()
                        .any(|prefix| {
                            normalized_lowercase
                                .strip_prefix(prefix)
                                .is_some_and(|suffix| {
                                    suffix.chars().all(|character| character == '/')
                                })
                        });
                !normalized.is_empty()
                    && normalized.chars().any(|character| character != '/')
                    && !is_incomplete_scheme
            }
            Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::UnaryExpression(_) => {
                self.static_primitive_truthiness(expression).is_some()
            }
            Expression::ConditionalExpression(conditional) => {
                if let Some(test_truthiness) = self.static_primitive_truthiness(&conditional.test) {
                    return self.is_proven_safe_slash_base(
                        if test_truthiness {
                            &conditional.consequent
                        } else {
                            &conditional.alternate
                        },
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_proven_safe_slash_base(
                    &conditional.consequent,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_proven_safe_slash_base(
                    &conditional.alternate,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                let left_truthiness = self.static_primitive_truthiness(&logical.left);
                match logical.operator {
                    LogicalOperator::And => {
                        left_truthiness == Some(false)
                            || self.is_proven_safe_slash_base(
                                &logical.right,
                                depth + 1,
                                visited_symbols,
                            )
                    }
                    LogicalOperator::Coalesce if self.is_nullish(Some(&logical.left)) => {
                        self.is_proven_safe_slash_base(&logical.right, depth + 1, visited_symbols)
                    }
                    LogicalOperator::Coalesce if left_truthiness.is_some() => {
                        self.is_proven_safe_slash_base(&logical.left, depth + 1, visited_symbols)
                    }
                    LogicalOperator::Or if left_truthiness.is_some() => self
                        .is_proven_safe_slash_base(
                            if left_truthiness == Some(true) {
                                &logical.left
                            } else {
                                &logical.right
                            },
                            depth + 1,
                            visited_symbols,
                        ),
                    _ => {
                        self.is_proven_safe_slash_base(
                            &logical.left,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        ) && self.is_proven_safe_slash_base(
                            &logical.right,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    }
                }
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id) {
                    return false;
                }
                self.const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_proven_safe_slash_base(initializer, depth + 1, visited_symbols)
                    })
            }
            Expression::CallExpression(call) => {
                let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(function_node) = self.resolve_local_function(callee) else {
                    return false;
                };
                let Some(returns) = self.function_return_expressions(function_node) else {
                    return false;
                };
                !returns.is_empty()
                    && returns.iter().all(|returned| {
                        self.is_proven_safe_slash_base(
                            returned,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    })
            }
            expression => self.is_same_origin_location_read(expression),
        }
    }

    fn static_primitive_truthiness(&self, expression: &Expression<'a>) -> Option<bool> {
        if self.is_nullish(Some(expression)) {
            return Some(false);
        }
        match expression.get_inner_expression() {
            Expression::BooleanLiteral(literal) => Some(literal.value),
            Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
            Expression::NumericLiteral(literal) => {
                Some(literal.value != 0.0 && !literal.value.is_nan())
            }
            Expression::BigIntLiteral(literal) => Some(!literal.is_zero()),
            _ => None,
        }
    }

    fn terminal_const_alias_initializer<'expression>(
        &'expression self,
        expression: &'expression Expression<'a>,
    ) -> &'expression Expression<'a> {
        let mut current = expression;
        let mut visited_symbols = FxHashSet::default();
        loop {
            let Expression::Identifier(identifier) = current.get_inner_expression() else {
                return current;
            };
            let Some(symbol_id) = self.reference_symbol(identifier) else {
                return current;
            };
            if !visited_symbols.insert(symbol_id) {
                return current;
            }
            let Some(initializer) = self.const_initializer(symbol_id) else {
                return current;
            };
            current = initializer;
        }
    }

    fn is_trusted_interpolated_base(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let expression = expression.get_inner_expression();
        if !matches!(expression, Expression::StringLiteral(_))
            && self.static_primitive_truthiness(expression).is_some()
        {
            return true;
        }
        match expression {
            Expression::ConditionalExpression(conditional) => {
                if let Some(test_truthiness) = self.static_primitive_truthiness(&conditional.test) {
                    return self.is_trusted_interpolated_base(
                        if test_truthiness {
                            &conditional.consequent
                        } else {
                            &conditional.alternate
                        },
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_trusted_interpolated_base(
                    &conditional.consequent,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_interpolated_base(
                    &conditional.alternate,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                let left_truthiness = self.static_primitive_truthiness(&logical.left);
                if logical.operator == LogicalOperator::And && left_truthiness == Some(false) {
                    return true;
                }
                if logical.operator == LogicalOperator::Coalesce
                    && self.is_nullish(Some(&logical.left))
                {
                    return self.is_trusted_interpolated_base(
                        &logical.right,
                        depth + 1,
                        visited_symbols,
                    );
                }
                if let Some(left_truthiness) = left_truthiness {
                    let branch = if logical.operator == LogicalOperator::Or && !left_truthiness {
                        &logical.right
                    } else {
                        &logical.left
                    };
                    return self.is_trusted_interpolated_base(branch, depth + 1, visited_symbols);
                }
                self.is_trusted_interpolated_base(
                    &logical.left,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_interpolated_base(
                    &logical.right,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            _ => self.is_trusted_destination(expression, depth + 1, visited_symbols),
        }
    }

    fn is_statically_truthy_trusted(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => !literal.value.is_empty(),
            Expression::TemplateLiteral(template) => {
                template
                    .quasis
                    .iter()
                    .any(|quasi| !quasi.value.raw.is_empty())
                    && self.is_trusted_static_destination(expression.get_inner_expression())
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id) {
                    return false;
                }
                self.const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_statically_truthy_trusted(initializer, depth + 1, visited_symbols)
                    })
            }
            _ => false,
        }
    }

    fn is_nullish(&self, expression: Option<&Expression<'a>>) -> bool {
        let Some(expression) = expression else {
            return true;
        };
        match expression.get_inner_expression() {
            Expression::NullLiteral(_) => true,
            Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
            Expression::Identifier(identifier) if identifier.name == "undefined" => {
                self.reference_symbol(identifier).is_none()
            }
            _ => false,
        }
    }

    fn is_raw_nullish(&self, expression: &Expression<'a>) -> bool {
        match expression {
            Expression::NullLiteral(_) => true,
            Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
            Expression::Identifier(identifier) if identifier.name == "undefined" => {
                self.reference_symbol(identifier).is_none()
            }
            _ => false,
        }
    }

    fn resolve_static_string(
        &self,
        expression: &Expression<'a>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> Option<String> {
        if depth > MAX_RESOLUTION_DEPTH {
            return None;
        }
        match expression {
            Expression::StringLiteral(literal) => Some(literal.value.to_string()),
            Expression::TemplateLiteral(template) => {
                let mut text = String::new();
                for (index, quasi) in template.quasis.iter().enumerate() {
                    text.push_str(quasi.value.raw.as_str());
                    if let Some(interpolation) = template.expressions.get(index) {
                        text.push_str(
                            self.resolve_static_string(
                                interpolation,
                                depth + 1,
                                &mut visited_symbols.clone(),
                            )
                            .as_deref()
                            .unwrap_or("\0"),
                        );
                    }
                }
                Some(text)
            }
            Expression::Identifier(identifier) => {
                let symbol_id = self.reference_symbol(identifier)?;
                if !visited_symbols.insert(symbol_id) {
                    return None;
                }
                self.const_initializer(symbol_id).and_then(|initializer| {
                    self.resolve_static_string(initializer, depth + 1, visited_symbols)
                })
            }
            _ => None,
        }
    }

    fn features_may_protect_opener(features: &str) -> bool {
        features
            .split(|character: char| is_ecmascript_whitespace(character) || character == ',')
            .any(|entry| {
                let lowercase_entry = entry.to_ascii_lowercase();
                let mut parts = lowercase_entry.split('=');
                let name = parts.next().unwrap_or_default();
                let value = parts.next();
                let opaque_name = !name.is_empty()
                    && name
                        .chars()
                        .all(|character| character == OPAQUE_FEATURE_TEXT);
                let value_may_enable = value.is_none_or(|value| {
                    matches!(value, "1" | "true" | "yes")
                        || (!value.is_empty()
                            && value
                                .chars()
                                .all(|character| character == OPAQUE_FEATURE_TEXT))
                });
                (matches!(name, "noopener" | "noreferrer") || opaque_name) && value_may_enable
            })
    }

    fn const_initializer(&self, symbol_id: SymbolId) -> Option<&Expression<'a>> {
        let declaration = self.ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        if !matches!(self.ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
        {
            return None;
        }
        declarator.init.as_ref()
    }

    fn reference_symbol(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ) -> Option<SymbolId> {
        self.ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    }

    fn symbol_has_write_before_current_open(&self, symbol_id: SymbolId) -> bool {
        let Some(open_id) = self.current_open else {
            return true;
        };
        self.symbol_has_write_before(symbol_id, self.ctx.nodes().get_node(open_id))
    }

    fn symbol_has_write_before(&self, symbol_id: SymbolId, reference: &AstNode<'a>) -> bool {
        self.ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|symbol_reference| {
                !symbol_reference.is_read()
                    && can_node_execute_before(
                        self.ctx.nodes().get_node(symbol_reference.node_id()),
                        reference,
                        &self.property_write_analysis,
                        self.ctx,
                    )
            })
    }

    fn cross_file_verdict(&self, symbol_id: SymbolId, expect_function: bool) -> Option<bool> {
        if !self.ctx.file_path().is_absolute() {
            return None;
        }
        let import_entry = self
            .ctx
            .module_record()
            .import_entries
            .iter()
            .find(|entry| {
                !entry.is_type
                    && self
                        .ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
            })?;
        let exported_name = match &import_entry.import_name {
            ImportImportName::Name(name) => name.name(),
            ImportImportName::Default(_) => "default",
            ImportImportName::NamespaceObject => return None,
        };
        let module_source = import_entry.module_request.name();
        let memo_key = (
            module_source.to_string(),
            exported_name.to_string(),
            expect_function,
        );
        if let Some(verdict) = self.cross_file_memo.borrow().get(&memo_key) {
            return *verdict;
        }
        let budget_key = (module_source.to_string(), exported_name.to_string());
        if !self.cross_file_seen.borrow().contains(&budget_key) {
            let remaining = self.cross_file_remaining.get();
            if remaining == 0 {
                return None;
            }
            self.cross_file_seen.borrow_mut().insert(budget_key);
            self.cross_file_remaining.set(remaining - 1);
        }
        let verdict = resolve_window_open_cross_file_export(
            self.ctx.file_path(),
            module_source,
            exported_name,
            expect_function,
            0,
            &mut FxHashSet::default(),
        );
        self.cross_file_memo.borrow_mut().insert(memo_key, verdict);
        verdict
    }

    fn is_cross_file_url_helper_name(name: &str) -> bool {
        ["get", "create", "build"].iter().any(|prefix| {
            name.strip_prefix(prefix).is_some_and(|remainder| {
                ["Url", "URL"].iter().any(|suffix| {
                    remainder.strip_suffix(suffix).is_some_and(|middle| {
                        middle
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric())
                    })
                })
            })
        })
    }

    fn string_literal_value<'value>(expression: &'value Expression<'_>) -> Option<&'value str> {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        }
    }

    fn static_mutation_property_name<'value>(
        expression: &'value Expression<'_>,
    ) -> Option<&'value str> {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
                .quasis
                .first()
                .and_then(|quasi| quasi.value.cooked.as_ref())
                .map(|value| value.as_str()),
            _ => None,
        }
    }

    fn terminal_callee_name<'value>(expression: &'value Expression<'_>) -> Option<&'value str> {
        match expression.get_inner_expression() {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            expression => expression
                .as_member_expression()
                .and_then(|member| member.static_property_name()),
        }
    }

    fn jsx_attribute_name<'value>(
        attribute: &'value oxc_ast::ast::JSXAttribute<'_>,
    ) -> Option<&'value str> {
        match &attribute.name {
            oxc_ast::ast::JSXAttributeName::Identifier(identifier) => {
                Some(identifier.name.as_str())
            }
            _ => None,
        }
    }

    fn is_event_handler_name(name: &str) -> bool {
        name.strip_prefix("on")
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase)
    }

    fn is_safe_interpolated_suffix(suffix: &str, has_following_expression: bool) -> bool {
        if suffix.is_empty() {
            return !has_following_expression;
        }
        if suffix.starts_with('?') || suffix.starts_with('#') {
            return true;
        }
        suffix.starts_with('/') && !suffix.starts_with("//") && !suffix.starts_with("/\\")
    }
}

fn is_ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000a}'
            | '\u{000b}'
            | '\u{000c}'
            | '\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'
            | '\u{2001}'
            | '\u{2002}'
            | '\u{2003}'
            | '\u{2004}'
            | '\u{2005}'
            | '\u{2006}'
            | '\u{2007}'
            | '\u{2008}'
            | '\u{2009}'
            | '\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

fn resolve_window_open_module_path(from_file: &Path, module_source: &str) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute()
        || (!module_source.starts_with('.')
            && !window_open_tsconfig_allows_bare_import(from_file, module_source))
    {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
            .into_iter()
            .map(String::from)
            .collect(),
        main_fields: vec!["module".into(), "main".into(), "browser".into()],
        condition_names: vec![
            "import".into(),
            "default".into(),
            "module".into(),
            "browser".into(),
            "require".into(),
        ],
        extension_alias: vec![
            (
                ".js".into(),
                vec![".js".into(), ".ts".into(), ".tsx".into(), ".jsx".into()],
            ),
            (".jsx".into(), vec![".jsx".into(), ".tsx".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let path = resolver
        .resolve_file(from_file, module_source)
        .ok()?
        .path()
        .to_path_buf();
    if path
        .components()
        .any(|component| component.as_os_str() == "node_modules")
        || path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
            })
    {
        return None;
    }
    Some(path)
}

struct WindowOpenResolvedTsconfig {
    has_explicit_base_url: bool,
    path_patterns: Vec<String>,
}

fn window_open_tsconfig_allows_bare_import(from_file: &Path, module_source: &str) -> bool {
    let Some(mut directory) = from_file.parent() else {
        return false;
    };
    for _ in 0..MAX_TSCONFIG_DIRECTORY_WALK {
        for filename in ["tsconfig.json", "jsconfig.json"] {
            if let Some(config) = window_open_read_resolved_tsconfig(&directory.join(filename), 0) {
                return config.has_explicit_base_url
                    || config.path_patterns.iter().any(|pattern| {
                        window_open_tsconfig_pattern_matches(module_source, pattern)
                    });
            }
        }
        let Some(parent) = directory.parent() else {
            break;
        };
        if parent == directory {
            break;
        }
        directory = parent;
    }
    false
}

fn window_open_read_resolved_tsconfig(
    config_path: &Path,
    extends_depth: usize,
) -> Option<WindowOpenResolvedTsconfig> {
    let source = std::fs::read_to_string(config_path).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(
        &window_open_strip_json_comments_and_trailing_commas(&source),
    )
    .ok()?;
    let compiler_options = parsed
        .get("compilerOptions")
        .and_then(serde_json::Value::as_object);
    let has_explicit_base_url = compiler_options
        .and_then(|options| options.get("baseUrl"))
        .and_then(serde_json::Value::as_str)
        .is_some();
    if let Some(paths) = compiler_options.and_then(|options| options.get("paths"))
        && (paths.is_object() || paths.is_array())
    {
        let path_patterns = match paths {
            serde_json::Value::Object(entries) => entries
                .iter()
                .filter(|(_, targets)| {
                    targets
                        .as_array()
                        .is_some_and(|targets| targets.iter().any(serde_json::Value::is_string))
                })
                .map(|(pattern, _)| pattern.clone())
                .collect(),
            serde_json::Value::Array(entries) => entries
                .iter()
                .enumerate()
                .filter(|(_, targets)| {
                    targets
                        .as_array()
                        .is_some_and(|targets| targets.iter().any(serde_json::Value::is_string))
                })
                .map(|(index, _)| index.to_string())
                .collect(),
            _ => Vec::new(),
        };
        return Some(WindowOpenResolvedTsconfig {
            has_explicit_base_url,
            path_patterns,
        });
    }
    if extends_depth < MAX_TSCONFIG_EXTENDS_DEPTH
        && let Some(extends_value) = parsed.get("extends").and_then(serde_json::Value::as_str)
    {
        let mut extends_path =
            if extends_value.starts_with("./") || extends_value.starts_with("../") {
                config_path.parent()?.join(extends_value)
            } else {
                config_path
                    .parent()?
                    .join("node_modules")
                    .join(extends_value)
            };
        if !extends_value.ends_with(".json") {
            extends_path = PathBuf::from(format!("{}.json", extends_path.display()));
        }
        if let Some(inherited) =
            window_open_read_resolved_tsconfig(&extends_path, extends_depth + 1)
        {
            return Some(inherited);
        }
    }
    has_explicit_base_url.then_some(WindowOpenResolvedTsconfig {
        has_explicit_base_url: true,
        path_patterns: Vec::new(),
    })
}

fn window_open_tsconfig_pattern_matches(module_source: &str, pattern: &str) -> bool {
    let Some(star_index) = pattern.find('*') else {
        return module_source == pattern;
    };
    let prefix = &pattern[..star_index];
    let suffix = &pattern[star_index + 1..];
    module_source.len() >= prefix.len() + suffix.len()
        && module_source.starts_with(prefix)
        && module_source.ends_with(suffix)
}

fn window_open_strip_json_comments_and_trailing_commas(source: &str) -> String {
    let characters: Vec<char> = source.chars().collect();
    let mut without_comments = String::with_capacity(source.len());
    let mut index = 0;
    let mut in_string = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    while index < characters.len() {
        let character = characters[index];
        let next_character = characters.get(index + 1).copied();
        if in_line_comment {
            if character == '\n' {
                in_line_comment = false;
                without_comments.push(character);
            }
            index += 1;
            continue;
        }
        if in_block_comment {
            if character == '*' && next_character == Some('/') {
                in_block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        if in_string {
            without_comments.push(character);
            if character == '\\' {
                if let Some(escaped) = next_character {
                    without_comments.push(escaped);
                    index += 2;
                    continue;
                }
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
            without_comments.push(character);
            index += 1;
            continue;
        }
        if character == '/' && next_character == Some('/') {
            in_line_comment = true;
            index += 2;
            continue;
        }
        if character == '/' && next_character == Some('*') {
            in_block_comment = true;
            index += 2;
            continue;
        }
        without_comments.push(character);
        index += 1;
    }

    let characters: Vec<char> = without_comments.chars().collect();
    let mut without_trailing_commas = String::with_capacity(without_comments.len());
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == ',' {
            let mut next_index = index + 1;
            while characters
                .get(next_index)
                .is_some_and(|character| is_ecmascript_whitespace(*character))
            {
                next_index += 1;
            }
            if matches!(characters.get(next_index), Some('}' | ']')) {
                index += 1;
                continue;
            }
        }
        without_trailing_commas.push(character);
        index += 1;
    }
    without_trailing_commas
}

fn resolve_window_open_cross_file_export(
    from_file: &Path,
    module_source: &str,
    exported_name: &str,
    expect_function: bool,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<bool> {
    let file_path = resolve_window_open_module_path(from_file, module_source)?;
    evaluate_window_open_export_in_file(
        &file_path,
        exported_name,
        expect_function,
        depth,
        visited_paths,
    )
}

fn evaluate_window_open_export_in_file(
    file_path: &Path,
    exported_name: &str,
    expect_function: bool,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<bool> {
    if depth >= MAX_CROSS_FILE_REEXPORT_DEPTH {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).ok()?;
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let metadata = std::fs::metadata(file_path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_CROSS_FILE_BYTES {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = SourceType::from_path(file_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(symbol_id) = foreign_export_symbol(exported_name, &semantic, &module_record) {
        let analysis = ForeignWindowOpenAnalysis {
            semantic: &semantic,
            allow_url_construction: Cell::new(false),
        };
        return if expect_function {
            analysis.function_symbol_is_trusted(symbol_id)
        } else {
            analysis.initializer_symbol_is_trusted(symbol_id)
        };
    }
    if exported_name == "default" {
        let analysis = ForeignWindowOpenAnalysis {
            semantic: &semantic,
            allow_url_construction: Cell::new(false),
        };
        if let Some(verdict) = semantic.nodes().iter().find_map(|node| {
            let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
                return None;
            };
            match &declaration.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    let returns = analysis.function_returns(function.node_id.get());
                    Some(
                        expect_function
                            && returns.as_ref().is_some_and(|returns| {
                                !returns.is_empty()
                                    && returns.iter().all(|returned| {
                                        analysis.is_trusted_destination(
                                            returned,
                                            true,
                                            0,
                                            &mut FxHashSet::default(),
                                        )
                                    })
                            }),
                    )
                }
                ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                    let returns = analysis.function_returns(function.node_id.get());
                    Some(
                        expect_function
                            && returns.as_ref().is_some_and(|returns| {
                                !returns.is_empty()
                                    && returns.iter().all(|returned| {
                                        analysis.is_trusted_destination(
                                            returned,
                                            true,
                                            0,
                                            &mut FxHashSet::default(),
                                        )
                                    })
                            }),
                    )
                }
                declaration => declaration.as_expression().map(|expression| {
                    !expect_function
                        && analysis.is_trusted_destination(
                            expression,
                            false,
                            0,
                            &mut FxHashSet::default(),
                        )
                }),
            }
        }) {
            return Some(verdict);
        }
    }
    if let Some((next_source, imported_name)) =
        foreign_reexport_target(exported_name, &module_record)
    {
        return resolve_window_open_cross_file_export(
            file_path,
            next_source,
            imported_name,
            expect_function,
            depth + 1,
            &mut visited_paths.clone(),
        );
    }
    let mut resolved_export_all = None;
    for statement in &program.body {
        let oxc_ast::ast::Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(verdict) = resolve_window_open_cross_file_export(
            file_path,
            declaration.source.value.as_str(),
            exported_name,
            expect_function,
            depth + 1,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if resolved_export_all.is_some() {
            return None;
        }
        resolved_export_all = Some(verdict);
    }
    resolved_export_all
}

fn foreign_export_symbol(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<SymbolId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let is_match = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            is_match.then(|| entry.local_name.name()).flatten()
        })?;
    semantic.scoping().get_root_binding(local_name.into())
}

fn foreign_reexport_target<'record>(
    exported_name: &str,
    module_record: &'record ModuleRecord,
) -> Option<(&'record str, &'record str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let entry_exported_name = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if entry_exported_name != exported_name {
                return None;
            }
            let source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((source, imported_name))
        })
}

struct ForeignWindowOpenAnalysis<'semantic, 'ast> {
    semantic: &'semantic Semantic<'ast>,
    allow_url_construction: Cell<bool>,
}

impl<'semantic, 'ast> ForeignWindowOpenAnalysis<'semantic, 'ast> {
    fn initializer_symbol_is_trusted(&self, symbol_id: SymbolId) -> Option<bool> {
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let initializer = declarator.init.as_ref()?;
        if matches!(
            initializer.get_inner_expression(),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            return None;
        }
        Some(self.is_trusted_destination(initializer, false, 0, &mut FxHashSet::default()))
    }

    fn function_symbol_is_trusted(&self, symbol_id: SymbolId) -> Option<bool> {
        let function_id = self.function_id_for_symbol(symbol_id)?;
        let Some(returns) = self.function_returns(function_id) else {
            return Some(false);
        };
        if returns.is_empty() {
            return Some(false);
        }
        Some(returns.iter().all(|returned| {
            self.is_trusted_destination(returned, true, 0, &mut FxHashSet::default())
        }))
    }

    fn is_trusted_destination(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        let expression = expression.get_inner_expression();
        match expression {
            Expression::StringLiteral(literal) => {
                WindowOpenAnalysis::is_trusted_foreign_static_text(literal.value.as_str())
            }
            Expression::TemplateLiteral(template) => {
                if template.expressions.is_empty() {
                    return template.quasis.first().is_some_and(|quasi| {
                        WindowOpenAnalysis::is_trusted_foreign_static_text(quasi.value.raw.as_str())
                    });
                }
                let prefix = template
                    .quasis
                    .first()
                    .map_or("", |quasi| quasi.value.raw.as_str())
                    .trim_start_matches(is_ecmascript_whitespace);
                if !prefix.is_empty() {
                    return Self::is_trusted_foreign_interpolated_prefix(prefix);
                }
                let Some(base) = template.expressions.first() else {
                    return false;
                };
                let suffix = template
                    .quasis
                    .get(1)
                    .map_or("", |quasi| quasi.value.raw.as_str());
                WindowOpenAnalysis::is_safe_interpolated_suffix(
                    suffix,
                    template.expressions.len() > 1,
                ) && (!suffix.starts_with('/')
                    || self.is_proven_safe_slash_base(
                        base,
                        deferred,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    ))
                    && (!self.is_global_url_instance_expression(base)
                        || (!self.global_was_mutated_before("URL", expression.span(), deferred)
                            && !self.foreign_url_receiver_was_mutated_before(
                                base,
                                expression.span(),
                                deferred,
                            )))
                    && self.with_url_construction_allowed(|| {
                        self.is_trusted_interpolated_base(
                            base,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        )
                    })
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return identifier.name == "undefined";
                };
                if !visited_symbols.insert(symbol_id) {
                    return false;
                }
                if let Some(initializer) = self.symbol_const_initializer(symbol_id) {
                    return !self.symbol_was_mutated_before(symbol_id, expression.span(), deferred)
                        && self.is_trusted_destination(
                            initializer,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        );
                }
                self.is_foreign_let_assigned_only_trusted(
                    symbol_id,
                    expression.span(),
                    deferred,
                    depth + 1,
                    visited_symbols,
                )
            }
            Expression::ConditionalExpression(conditional) => {
                self.is_trusted_or_nullish(
                    &conditional.consequent,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_or_nullish(
                    &conditional.alternate,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                if logical.operator == LogicalOperator::And {
                    return self.is_nullish(&logical.left)
                        || self.is_trusted_or_nullish(
                            &logical.right,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        );
                }
                if self.is_statically_truthy_trusted(
                    &logical.left,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) {
                    return true;
                }
                self.is_trusted_or_nullish(
                    &logical.left,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_or_nullish(
                    &logical.right,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::BinaryExpression(binary)
                if binary.operator == oxc_syntax::operator::BinaryOperator::Addition =>
            {
                let mut leftmost = binary.left.get_inner_expression();
                while let Expression::BinaryExpression(next) = leftmost {
                    if next.operator != oxc_syntax::operator::BinaryOperator::Addition {
                        break;
                    }
                    leftmost = next.left.get_inner_expression();
                }
                self.is_trusted_concat_prefix(leftmost, deferred, depth + 1, visited_symbols)
            }
            Expression::NewExpression(new_expression) => {
                self.allow_url_construction.get()
                    && self.is_global_reference(&new_expression.callee, "URL")
                    && !self.global_was_mutated_before("URL", new_expression.span, deferred)
                    && new_expression
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .is_some_and(|argument| {
                            self.is_trusted_destination(
                                argument,
                                deferred,
                                depth + 1,
                                &mut visited_symbols.clone(),
                            )
                        })
                    && match new_expression.arguments.get(1) {
                        None => true,
                        Some(argument) => argument.as_expression().is_some_and(|base| {
                            self.is_trusted_destination(base, deferred, depth + 1, visited_symbols)
                        }),
                    }
            }
            Expression::CallExpression(call) => {
                if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
                    if member.static_property_name() == Some("createObjectURL")
                        && self.is_global_reference(member.object(), "URL")
                        && !self.global_was_mutated_before("URL", call.span, deferred)
                    {
                        return true;
                    }
                    if member.static_property_name() == Some("getURL")
                        && member
                            .object()
                            .get_inner_expression()
                            .as_member_expression()
                            .is_some_and(|runtime| {
                                runtime.static_property_name() == Some("runtime")
                                    && self.is_global_reference(runtime.object(), "chrome")
                                    && !self
                                        .global_was_mutated_before("chrome", call.span, deferred)
                            })
                    {
                        return true;
                    }
                    if matches!(
                        member.static_property_name(),
                        Some("toString" | "toJSON" | "trim" | "trimEnd" | "trimStart")
                    ) {
                        let is_url_serialization =
                            matches!(member.static_property_name(), Some("toString" | "toJSON"))
                                && self.is_global_url_instance_expression(member.object());
                        if is_url_serialization
                            && (self.global_was_mutated_before("URL", call.span, deferred)
                                || self.foreign_url_receiver_was_mutated_before(
                                    member.object(),
                                    call.span,
                                    deferred,
                                ))
                        {
                            return false;
                        }
                        return if is_url_serialization {
                            self.with_url_construction_allowed(|| {
                                self.is_trusted_destination(
                                    member.object(),
                                    deferred,
                                    depth + 1,
                                    visited_symbols,
                                )
                            })
                        } else {
                            self.is_trusted_destination(
                                member.object(),
                                deferred,
                                depth + 1,
                                visited_symbols,
                            )
                        };
                    }
                }
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_was_mutated_before(symbol_id, call.span, deferred) {
                    return false;
                }
                let Some(function_id) = self.function_id_for_symbol(symbol_id) else {
                    return false;
                };
                let Some(returns) = self.function_returns(function_id) else {
                    return false;
                };
                !returns.is_empty()
                    && returns.iter().all(|returned| {
                        self.is_trusted_local_return(
                            returned,
                            function_id,
                            call,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    })
            }
            expression if expression.as_member_expression().is_some() => {
                let Some(member) = expression.as_member_expression() else {
                    return false;
                };
                if self.is_same_origin_location_read(expression) {
                    return true;
                }
                if member.static_property_name() == Some("href")
                    && !member.is_computed()
                    && matches!(
                        member.object().get_inner_expression(),
                        Expression::Identifier(_)
                    )
                    && self.is_direct_global_url_instance_identifier(member.object())
                    && !self.global_was_mutated_before("URL", expression.span(), deferred)
                    && !self.foreign_url_receiver_was_mutated_before(
                        member.object(),
                        expression.span(),
                        deferred,
                    )
                {
                    return self.with_url_construction_allowed(|| {
                        self.is_trusted_destination(
                            member.object(),
                            deferred,
                            depth + 1,
                            visited_symbols,
                        )
                    });
                }
                if member.is_computed() {
                    return self.is_trusted_const_array_index_read(
                        member,
                        deferred,
                        depth + 1,
                        visited_symbols,
                    );
                }
                member.static_property_name().is_some_and(|property_name| {
                    self.is_trusted_const_config_member(
                        member,
                        property_name,
                        deferred,
                        depth + 1,
                        visited_symbols,
                    )
                })
            }
            Expression::NullLiteral(_) => true,
            Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
            _ => false,
        }
    }

    fn with_url_construction_allowed(&self, operation: impl FnOnce() -> bool) -> bool {
        let previous = self.allow_url_construction.replace(true);
        let verdict = operation();
        self.allow_url_construction.set(previous);
        verdict
    }

    fn is_global_url_instance_expression(&self, expression: &Expression<'ast>) -> bool {
        match expression.get_inner_expression() {
            Expression::NewExpression(new_expression) => {
                self.is_global_reference(&new_expression.callee, "URL")
            }
            Expression::Identifier(identifier) => self
                .reference_symbol(identifier)
                .and_then(|symbol_id| self.symbol_const_initializer(symbol_id))
                .is_some_and(|initializer| self.is_global_url_instance_expression(initializer)),
            _ => false,
        }
    }

    fn is_direct_global_url_instance_identifier(&self, expression: &Expression<'ast>) -> bool {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        self.reference_symbol(identifier)
            .and_then(|symbol_id| self.symbol_const_initializer(symbol_id))
            .is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::NewExpression(new_expression)
                        if self.is_global_reference(&new_expression.callee, "URL")
                )
            })
    }

    fn foreign_url_receiver_was_mutated_before(
        &self,
        receiver: &Expression<'ast>,
        reference_span: Span,
        deferred: bool,
    ) -> bool {
        const ORIGIN_PROPERTIES: [&str; 9] = [
            "href", "host", "hostname", "password", "port", "protocol", "toJSON", "toString",
            "username",
        ];
        let Some(receiver_symbol) =
            self.foreign_const_root_symbol(receiver, &mut FxHashSet::default())
        else {
            return false;
        };
        self.semantic.nodes().iter().any(|node| {
            if !self.foreign_mutation_executes_before(node, reference_span, deferred) {
                return false;
            }
            let member = match node.kind() {
                AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression(),
                AstKind::UpdateExpression(update) => update.argument.as_member_expression(),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    unary.argument.as_member_expression()
                }
                _ => None,
            };
            if member.is_some_and(|member| {
                member
                    .static_property_name()
                    .is_none_or(|name| ORIGIN_PROPERTIES.contains(&name))
                    && self.foreign_const_root_symbol(member.object(), &mut FxHashSet::default())
                        == Some(receiver_symbol)
            }) {
                return true;
            }
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            let Some(method_name) = self.foreign_global_mutation_method_name(call) else {
                return false;
            };
            let target_matches = call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|target| {
                    self.foreign_const_root_symbol(target, &mut FxHashSet::default())
                })
                == Some(receiver_symbol);
            target_matches
                && ORIGIN_PROPERTIES.iter().any(|property_name| {
                    Self::foreign_mutation_call_may_write_property(call, method_name, property_name)
                })
        })
    }

    fn foreign_const_root_symbol(
        &self,
        expression: &Expression<'ast>,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> Option<SymbolId> {
        let expression = expression.get_inner_expression();
        if let Some(member) = expression.as_member_expression() {
            return self.foreign_const_root_symbol(member.object(), visited_symbols);
        }
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        let symbol_id = self.reference_symbol(identifier)?;
        self.foreign_const_root_symbol_id(symbol_id, visited_symbols)
    }

    fn foreign_const_root_symbol_id(
        &self,
        symbol_id: SymbolId,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> Option<SymbolId> {
        if !visited_symbols.insert(symbol_id) {
            return Some(symbol_id);
        }
        let Some(Expression::Identifier(alias)) = self
            .symbol_const_initializer(symbol_id)
            .map(Expression::get_inner_expression)
        else {
            return Some(symbol_id);
        };
        self.reference_symbol(alias)
            .and_then(|alias_symbol| {
                self.foreign_const_root_symbol_id(alias_symbol, visited_symbols)
            })
            .or(Some(symbol_id))
    }

    fn foreign_mutation_call_may_write_property(
        call: &CallExpression<'ast>,
        method_name: &str,
        property_name: &str,
    ) -> bool {
        match method_name {
            "defineProperty" | "set" => call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .and_then(WindowOpenAnalysis::static_mutation_property_name)
                .is_none_or(|name| name == property_name),
            "assign" => call.arguments.iter().skip(1).any(|argument| {
                let Some(Expression::ObjectExpression(object)) = argument
                    .as_expression()
                    .map(Expression::get_inner_expression)
                else {
                    return true;
                };
                object.properties.iter().any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => property
                        .key
                        .static_name()
                        .is_none_or(|name| name.as_ref() == property_name),
                    ObjectPropertyKind::SpreadProperty(_) => true,
                })
            }),
            "defineProperties" => {
                let Some(Expression::ObjectExpression(object)) = call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .map(Expression::get_inner_expression)
                else {
                    return true;
                };
                object.properties.iter().any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => property
                        .key
                        .static_name()
                        .is_none_or(|name| name.as_ref() == property_name),
                    ObjectPropertyKind::SpreadProperty(_) => true,
                })
            }
            "setPrototypeOf" => true,
            _ => false,
        }
    }

    fn is_trusted_const_config_member(
        &self,
        member: &oxc_ast::ast::MemberExpression<'ast>,
        property_name: &str,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(receiver) else {
            return false;
        };
        if self.symbol_was_mutated_before(symbol_id, member.span(), deferred)
            || self.foreign_receiver_was_mutated_before(
                member.object(),
                Some(property_name),
                member.span(),
                deferred,
            )
        {
            return false;
        }
        let Some(Expression::ObjectExpression(object)) = self
            .symbol_const_initializer(symbol_id)
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        self.object_supplies_trusted_property(
            object,
            property_name,
            deferred,
            depth,
            visited_symbols,
        )
    }

    fn is_trusted_const_array_index_read(
        &self,
        member: &oxc_ast::ast::MemberExpression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let oxc_ast::ast::MemberExpression::ComputedMemberExpression(computed) = member else {
            return false;
        };
        let Expression::NumericLiteral(index) = computed.expression.get_inner_expression() else {
            return false;
        };
        if index.value < 0.0 || index.value.fract() != 0.0 {
            return false;
        }
        let Expression::Identifier(receiver) = computed.object.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(receiver) else {
            return false;
        };
        if self.symbol_was_mutated_before(symbol_id, member.span(), deferred)
            || self.foreign_receiver_was_mutated_before(
                &computed.object,
                None,
                member.span(),
                deferred,
            )
        {
            return false;
        }
        let Some(initializer) = self.symbol_const_initializer(symbol_id) else {
            return false;
        };
        let element_is_trusted = |array: &oxc_ast::ast::ArrayExpression<'ast>| {
            array
                .elements
                .get(index.value as usize)
                .and_then(ArrayExpressionElement::as_expression)
                .is_some_and(|element| {
                    self.is_trusted_destination(
                        element,
                        deferred,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    )
                })
        };
        match initializer.get_inner_expression() {
            Expression::ArrayExpression(array) => element_is_trusted(array),
            Expression::CallExpression(call) => {
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(function_symbol) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_was_mutated_before(function_symbol, call.span, deferred) {
                    return false;
                }
                let Some(function_id) = self.function_id_for_symbol(function_symbol) else {
                    return false;
                };
                let Some(returns) = self.function_returns(function_id) else {
                    return false;
                };
                !returns.is_empty()
                    && returns.iter().all(|returned| {
                        let Expression::ArrayExpression(array) = returned.get_inner_expression()
                        else {
                            return false;
                        };
                        element_is_trusted(array)
                    })
            }
            _ => false,
        }
    }

    fn object_supplies_trusted_property(
        &self,
        object: &oxc_ast::ast::ObjectExpression<'ast>,
        property_name: &str,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let mut trusted_value = None;
        for property in &object.properties {
            match property {
                ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some(property_name) =>
                {
                    trusted_value = Some(self.is_trusted_destination(
                        &property.value,
                        deferred,
                        depth + 1,
                        &mut visited_symbols.clone(),
                    ));
                }
                ObjectPropertyKind::SpreadProperty(_) => trusted_value = Some(false),
                ObjectPropertyKind::ObjectProperty(property)
                    if property.computed && property.key.static_name().is_none() =>
                {
                    trusted_value = Some(false);
                }
                _ => {}
            }
        }
        trusted_value == Some(true)
    }

    fn foreign_receiver_was_mutated_before(
        &self,
        receiver: &Expression<'ast>,
        property_name: Option<&str>,
        reference_span: Span,
        deferred: bool,
    ) -> bool {
        const MUTATING_ARRAY_METHODS: [&str; 9] = [
            "copyWithin",
            "fill",
            "pop",
            "push",
            "reverse",
            "shift",
            "sort",
            "splice",
            "unshift",
        ];
        let Some(receiver_symbol) =
            self.foreign_const_root_symbol(receiver, &mut FxHashSet::default())
        else {
            return false;
        };
        self.semantic.nodes().iter().any(|node| {
            if !self.foreign_mutation_executes_before(node, reference_span, deferred) {
                return false;
            }
            let member = match node.kind() {
                AstKind::AssignmentExpression(assignment) => assignment.left.as_member_expression(),
                AstKind::UpdateExpression(update) => update.argument.as_member_expression(),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    unary.argument.as_member_expression()
                }
                _ => None,
            };
            if member.is_some_and(|member| {
                self.foreign_const_root_symbol(member.object(), &mut FxHashSet::default())
                    == Some(receiver_symbol)
                    && property_name.is_none_or(|property_name| {
                        member
                            .static_property_name()
                            .is_none_or(|name| name == property_name)
                    })
            }) {
                return true;
            }
            let AstKind::CallExpression(call) = node.kind() else {
                return false;
            };
            if let Some(callee_member) = call.callee.as_member_expression()
                && callee_member
                    .static_property_name()
                    .is_some_and(|name| MUTATING_ARRAY_METHODS.contains(&name))
                && self.foreign_const_root_symbol(callee_member.object(), &mut FxHashSet::default())
                    == Some(receiver_symbol)
            {
                return true;
            }
            let Some(method_name) = self.foreign_global_mutation_method_name(call) else {
                return false;
            };
            let target_matches = call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .and_then(|target| {
                    self.foreign_const_root_symbol(target, &mut FxHashSet::default())
                })
                == Some(receiver_symbol);
            target_matches
                && property_name.is_some_and(|property_name| {
                    Self::foreign_mutation_call_may_write_property(call, method_name, property_name)
                })
        })
    }

    fn is_trusted_foreign_interpolated_prefix(text: &str) -> bool {
        let text = text.trim_start_matches(is_ecmascript_whitespace);
        if text.is_empty() {
            return false;
        }
        let lower = text.to_ascii_lowercase();
        ["mailto:", "tel:", "sms:", "file:"]
            .iter()
            .any(|scheme| lower.starts_with(scheme))
            || WindowOpenAnalysis::starts_unambiguous_same_origin_path(text)
    }

    fn is_trusted_concat_prefix(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                Self::is_trusted_foreign_interpolated_prefix(literal.value.as_str())
            }
            Expression::TemplateLiteral(template) => {
                if template.expressions.is_empty() {
                    return template.quasis.first().is_some_and(|quasi| {
                        Self::is_trusted_foreign_interpolated_prefix(quasi.value.raw.as_str())
                    });
                }
                self.is_trusted_destination(expression, deferred, depth + 1, visited_symbols)
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id)
                    || self.symbol_was_mutated_before(symbol_id, expression.span(), deferred)
                {
                    return false;
                }
                self.symbol_const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_trusted_concat_prefix(
                            initializer,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        )
                    })
            }
            _ => false,
        }
    }

    fn static_primitive_truthiness(&self, expression: &Expression<'ast>) -> Option<bool> {
        if self.is_nullish(expression) {
            return Some(false);
        }
        match expression.get_inner_expression() {
            Expression::BooleanLiteral(literal) => Some(literal.value),
            Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
            Expression::NumericLiteral(literal) => {
                Some(literal.value != 0.0 && !literal.value.is_nan())
            }
            Expression::BigIntLiteral(literal) => Some(!literal.is_zero()),
            _ => None,
        }
    }

    fn is_proven_safe_slash_base(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                let without_line_whitespace: String = literal
                    .value
                    .chars()
                    .filter(|character| !matches!(character, '\t' | '\n' | '\r'))
                    .collect();
                let normalized = without_line_whitespace
                    .trim_matches(|character| character <= ' ')
                    .replace('\\', "/");
                let normalized_lowercase = normalized.to_ascii_lowercase();
                let is_incomplete_scheme =
                    ["http:", "https:", "ftp:", "ws:", "wss:"]
                        .iter()
                        .any(|prefix| {
                            normalized_lowercase
                                .strip_prefix(prefix)
                                .is_some_and(|suffix| {
                                    suffix.chars().all(|character| character == '/')
                                })
                        });
                !normalized.is_empty()
                    && normalized.chars().any(|character| character != '/')
                    && !is_incomplete_scheme
            }
            Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::UnaryExpression(_) => {
                self.static_primitive_truthiness(expression).is_some()
            }
            Expression::ConditionalExpression(conditional) => {
                if let Some(test_truthiness) = self.static_primitive_truthiness(&conditional.test) {
                    return self.is_proven_safe_slash_base(
                        if test_truthiness {
                            &conditional.consequent
                        } else {
                            &conditional.alternate
                        },
                        deferred,
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_proven_safe_slash_base(
                    &conditional.consequent,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_proven_safe_slash_base(
                    &conditional.alternate,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                let left_truthiness = self.static_primitive_truthiness(&logical.left);
                match logical.operator {
                    LogicalOperator::And => {
                        left_truthiness == Some(false)
                            || self.is_proven_safe_slash_base(
                                &logical.right,
                                deferred,
                                depth + 1,
                                visited_symbols,
                            )
                    }
                    LogicalOperator::Coalesce if self.is_nullish(&logical.left) => self
                        .is_proven_safe_slash_base(
                            &logical.right,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        ),
                    LogicalOperator::Coalesce if left_truthiness.is_some() => self
                        .is_proven_safe_slash_base(
                            &logical.left,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        ),
                    LogicalOperator::Or if left_truthiness.is_some() => self
                        .is_proven_safe_slash_base(
                            if left_truthiness == Some(true) {
                                &logical.left
                            } else {
                                &logical.right
                            },
                            deferred,
                            depth + 1,
                            visited_symbols,
                        ),
                    _ => {
                        self.is_proven_safe_slash_base(
                            &logical.left,
                            deferred,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        ) && self.is_proven_safe_slash_base(
                            &logical.right,
                            deferred,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    }
                }
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id)
                    || self.symbol_was_mutated_before(symbol_id, expression.span(), deferred)
                {
                    return false;
                }
                self.symbol_const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_proven_safe_slash_base(
                            initializer,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        )
                    })
            }
            Expression::CallExpression(call) => {
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    return false;
                };
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if self.symbol_was_mutated_before(symbol_id, call.span, deferred) {
                    return false;
                }
                let Some(function_id) = self.function_id_for_symbol(symbol_id) else {
                    return false;
                };
                let Some(returns) = self.function_returns(function_id) else {
                    return false;
                };
                !returns.is_empty()
                    && returns.iter().all(|returned| {
                        self.is_proven_safe_slash_base(
                            returned,
                            true,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        )
                    })
            }
            expression => self.is_same_origin_location_read(expression),
        }
    }

    fn is_trusted_interpolated_base(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let expression = expression.get_inner_expression();
        if !matches!(expression, Expression::StringLiteral(_))
            && self.static_primitive_truthiness(expression).is_some()
        {
            return true;
        }
        match expression {
            Expression::ConditionalExpression(conditional) => {
                if let Some(test_truthiness) = self.static_primitive_truthiness(&conditional.test) {
                    return self.is_trusted_interpolated_base(
                        if test_truthiness {
                            &conditional.consequent
                        } else {
                            &conditional.alternate
                        },
                        deferred,
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_trusted_interpolated_base(
                    &conditional.consequent,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_interpolated_base(
                    &conditional.alternate,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            Expression::LogicalExpression(logical) => {
                let left_truthiness = self.static_primitive_truthiness(&logical.left);
                if logical.operator == LogicalOperator::And && left_truthiness == Some(false) {
                    return true;
                }
                if logical.operator == LogicalOperator::Coalesce && self.is_nullish(&logical.left) {
                    return self.is_trusted_interpolated_base(
                        &logical.right,
                        deferred,
                        depth + 1,
                        visited_symbols,
                    );
                }
                if let Some(left_truthiness) = left_truthiness {
                    let branch = if logical.operator == LogicalOperator::Or && !left_truthiness {
                        &logical.right
                    } else {
                        &logical.left
                    };
                    return self.is_trusted_interpolated_base(
                        branch,
                        deferred,
                        depth + 1,
                        visited_symbols,
                    );
                }
                self.is_trusted_interpolated_base(
                    &logical.left,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ) && self.is_trusted_interpolated_base(
                    &logical.right,
                    deferred,
                    depth + 1,
                    &mut visited_symbols.clone(),
                )
            }
            _ => self.is_trusted_destination(expression, deferred, depth + 1, visited_symbols),
        }
    }

    fn is_statically_truthy_trusted(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if depth > MAX_RESOLUTION_DEPTH {
            return false;
        }
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => {
                !literal.value.is_empty()
                    && WindowOpenAnalysis::is_trusted_foreign_static_text(literal.value.as_str())
            }
            Expression::TemplateLiteral(template) => {
                template
                    .quasis
                    .iter()
                    .any(|quasi| !quasi.value.raw.is_empty())
                    && self.is_trusted_destination(expression, deferred, depth + 1, visited_symbols)
            }
            Expression::Identifier(identifier) => {
                let Some(symbol_id) = self.reference_symbol(identifier) else {
                    return false;
                };
                if !visited_symbols.insert(symbol_id) {
                    return false;
                }
                self.symbol_const_initializer(symbol_id)
                    .is_some_and(|initializer| {
                        self.is_statically_truthy_trusted(
                            initializer,
                            deferred,
                            depth + 1,
                            visited_symbols,
                        )
                    })
            }
            _ => false,
        }
    }

    fn is_trusted_local_return(
        &self,
        returned: &Expression<'ast>,
        function_id: NodeId,
        call: &CallExpression<'ast>,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if let Expression::Identifier(identifier) = returned.get_inner_expression()
            && let Some(symbol_id) = self.reference_symbol(identifier)
            && let Some(parameter_index) = self.function_parameter_index(function_id, symbol_id)
            && let Some(argument) = call
                .arguments
                .get(parameter_index)
                .and_then(Argument::as_expression)
        {
            return self.is_trusted_destination(argument, true, depth + 1, visited_symbols);
        }
        if let Expression::BinaryExpression(binary) = returned.get_inner_expression()
            && binary.operator == oxc_syntax::operator::BinaryOperator::Addition
        {
            let mut operands = Vec::new();
            WindowOpenAnalysis::flatten_concat_operands(returned, &mut operands);
            if let Some(Expression::Identifier(first_identifier)) = operands
                .first()
                .map(|operand| operand.get_inner_expression())
                && let Some(symbol_id) = self.reference_symbol(first_identifier)
                && let Some(parameter_index) = self.function_parameter_index(function_id, symbol_id)
                && let Some(argument) = call
                    .arguments
                    .get(parameter_index)
                    .and_then(Argument::as_expression)
            {
                let mut suffix = String::new();
                let mut following_expression = false;
                for operand in operands.iter().skip(1) {
                    let Some(text) = WindowOpenAnalysis::static_string_text(operand) else {
                        following_expression = true;
                        break;
                    };
                    suffix.push_str(text);
                }
                if WindowOpenAnalysis::is_safe_interpolated_suffix(&suffix, following_expression)
                    && (!suffix.starts_with('/')
                        || self.is_proven_safe_slash_base(
                            argument,
                            true,
                            depth + 1,
                            &mut visited_symbols.clone(),
                        ))
                {
                    return self.is_trusted_destination(argument, true, depth + 1, visited_symbols);
                }
            }
        }
        if let Expression::TemplateLiteral(template) = returned.get_inner_expression()
            && template
                .quasis
                .first()
                .is_none_or(|quasi| quasi.value.raw.is_empty())
            && let Some(Expression::Identifier(first_identifier)) = template
                .expressions
                .first()
                .map(Expression::get_inner_expression)
            && let Some(symbol_id) = self.reference_symbol(first_identifier)
            && let Some(parameter_index) = self.function_parameter_index(function_id, symbol_id)
            && let Some(argument) = call
                .arguments
                .get(parameter_index)
                .and_then(Argument::as_expression)
        {
            let suffix = template
                .quasis
                .get(1)
                .map_or("", |quasi| quasi.value.raw.as_str());
            if WindowOpenAnalysis::is_safe_interpolated_suffix(
                suffix,
                template.expressions.len() > 1,
            ) && (!suffix.starts_with('/')
                || self.is_proven_safe_slash_base(
                    argument,
                    true,
                    depth + 1,
                    &mut visited_symbols.clone(),
                ))
            {
                return self.is_trusted_destination(argument, true, depth + 1, visited_symbols);
            }
        }
        self.is_trusted_destination(returned, true, depth, visited_symbols)
    }

    fn is_trusted_or_nullish(
        &self,
        expression: &Expression<'ast>,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        self.is_nullish(expression)
            || self.is_trusted_destination(expression, deferred, depth, visited_symbols)
    }

    fn is_nullish(&self, expression: &Expression<'ast>) -> bool {
        match expression.get_inner_expression() {
            Expression::NullLiteral(_) => true,
            Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
            Expression::Identifier(identifier) if identifier.name == "undefined" => {
                self.reference_symbol(identifier).is_none()
            }
            _ => false,
        }
    }

    fn is_same_origin_location_read(&self, expression: &Expression<'ast>) -> bool {
        let Some(member) = expression.as_member_expression() else {
            return false;
        };
        if member.is_computed() {
            return false;
        }
        let Some(property_name) = member.static_property_name() else {
            return false;
        };
        if !matches!(property_name, "origin" | "href") {
            return false;
        }
        self.is_location_receiver(member.object(), &mut FxHashSet::default())
            || (property_name == "origin" && self.is_global_reference(member.object(), "window"))
    }

    fn is_location_receiver(
        &self,
        expression: &Expression<'ast>,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        if self.is_global_reference(expression, "location") {
            return true;
        }
        let Expression::CallExpression(call) = expression.get_inner_expression() else {
            return false;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if self.symbol_was_mutated_before(symbol_id, call.span, true) {
            return false;
        }
        let Some(function_id) = self.function_id_for_symbol(symbol_id) else {
            return false;
        };
        if !visited_functions.insert(function_id) {
            return false;
        }
        let Some(returns) = self.function_returns(function_id) else {
            return false;
        };
        !returns.is_empty()
            && returns
                .iter()
                .all(|returned| self.is_location_receiver(returned, &mut visited_functions.clone()))
    }

    fn is_global_reference(&self, expression: &Expression<'ast>, name: &str) -> bool {
        self.is_global_reference_inner(expression, name, &mut FxHashSet::default())
    }

    fn is_global_reference_inner(
        &self,
        expression: &Expression<'ast>,
        name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return expression.as_member_expression().is_some_and(|member| {
                member.static_property_name() == Some(name)
                    && matches!(member.object().get_inner_expression(), Expression::Identifier(object)
                        if self.reference_symbol(object).is_none()
                            && matches!(object.name.as_str(), "global" | "globalThis" | "window" | "self"))
            });
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return identifier.name == name;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            self.semantic.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref() == Some(name)
            && ["global", "globalThis", "self", "window"]
                .iter()
                .any(|receiver_name| {
                    self.is_global_reference_inner(
                        initializer,
                        receiver_name,
                        &mut visited_symbols.clone(),
                    )
                })
        {
            return true;
        }
        self.is_global_reference_inner(initializer, name, visited_symbols)
    }

    fn global_was_mutated_before(&self, name: &str, reference_span: Span, deferred: bool) -> bool {
        self.semantic.nodes().iter().any(|node| {
            let target_matches = match node.kind() {
                AstKind::AssignmentExpression(assignment) => match &assignment.left {
                    oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                        identifier.name == name
                            && self
                                .semantic
                                .scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id()
                                .is_none()
                    }
                    target => target.as_member_expression().is_some_and(|member| {
                        self.foreign_member_chain_starts_at_global(
                            member,
                            name,
                            &mut FxHashSet::default(),
                        )
                    }),
                },
                AstKind::UpdateExpression(update) => update
                    .argument
                    .as_member_expression()
                    .is_some_and(|member| {
                        self.foreign_member_chain_starts_at_global(
                            member,
                            name,
                            &mut FxHashSet::default(),
                        )
                    }),
                AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                    unary.argument.as_member_expression().is_some_and(|member| {
                        self.foreign_member_chain_starts_at_global(
                            member,
                            name,
                            &mut FxHashSet::default(),
                        )
                    })
                }
                AstKind::CallExpression(call)
                    if self.foreign_global_mutation_method_name(call).is_some() =>
                {
                    call.arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .is_some_and(|target| {
                            self.foreign_expression_targets_global(
                                target,
                                name,
                                &mut FxHashSet::default(),
                            )
                        })
                }
                _ => false,
            };
            if !target_matches {
                return false;
            }
            self.foreign_mutation_executes_before(node, reference_span, deferred)
        })
    }

    fn foreign_expression_targets_global(
        &self,
        expression: &Expression<'ast>,
        name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        if self.is_global_reference(expression, name) {
            return true;
        }
        if let Some(member) = expression.get_inner_expression().as_member_expression() {
            return self.foreign_member_chain_starts_at_global(member, name, visited_symbols);
        }
        let Expression::Identifier(identifier) = expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref()
            == Some("prototype")
            && declarator
                .init
                .as_ref()
                .is_some_and(|initializer| self.is_global_reference(initializer, name))
        {
            return true;
        }
        declarator.init.as_ref().is_some_and(|initializer| {
            self.foreign_expression_targets_global(initializer, name, visited_symbols)
        })
    }

    fn foreign_member_chain_starts_at_global(
        &self,
        member: &oxc_ast::ast::MemberExpression<'ast>,
        name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        self.foreign_expression_targets_global(member.object(), name, visited_symbols)
    }

    fn foreign_global_mutation_method_name<'call>(
        &self,
        call: &'call CallExpression<'ast>,
    ) -> Option<&'call str> {
        const OBJECT_METHODS: [&str; 4] = [
            "assign",
            "defineProperties",
            "defineProperty",
            "setPrototypeOf",
        ];
        const REFLECT_METHODS: [&str; 3] = ["defineProperty", "set", "setPrototypeOf"];
        let callee = call.callee.get_inner_expression();
        let method_name = WindowOpenAnalysis::terminal_callee_name(callee)?;
        if let Some(member) = callee.as_member_expression() {
            let is_object_method = OBJECT_METHODS.contains(&method_name)
                && self.is_global_reference(member.object(), "Object");
            let is_reflect_method = REFLECT_METHODS.contains(&method_name)
                && self.is_global_reference(member.object(), "Reflect");
            return (is_object_method || is_reflect_method).then_some(method_name);
        }
        let Expression::Identifier(identifier) = callee else {
            return None;
        };
        let is_object_method = OBJECT_METHODS.contains(&method_name)
            && self.foreign_identifier_resolves_global_method(
                identifier,
                "Object",
                method_name,
                &mut FxHashSet::default(),
            );
        let is_reflect_method = REFLECT_METHODS.contains(&method_name)
            && self.foreign_identifier_resolves_global_method(
                identifier,
                "Reflect",
                method_name,
                &mut FxHashSet::default(),
            );
        (is_object_method || is_reflect_method).then_some(method_name)
    }

    fn foreign_identifier_resolves_global_method(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'ast>,
        namespace_name: &str,
        method_name: &str,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let Some(symbol_id) = self.reference_symbol(identifier) else {
            return false;
        };
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            self.semantic.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if binding_property_name_for_symbol(&declarator.id, symbol_id).as_deref()
            == Some(method_name)
            && self.is_global_reference(initializer, namespace_name)
        {
            return true;
        }
        match initializer.get_inner_expression() {
            Expression::Identifier(alias) => self.foreign_identifier_resolves_global_method(
                alias,
                namespace_name,
                method_name,
                visited_symbols,
            ),
            expression => expression.as_member_expression().is_some_and(|member| {
                member.static_property_name() == Some(method_name)
                    && self.is_global_reference(member.object(), namespace_name)
            }),
        }
    }

    fn symbol_was_mutated_before(
        &self,
        symbol_id: SymbolId,
        reference_span: Span,
        deferred: bool,
    ) -> bool {
        let reference_function = self
            .node_for_span(reference_span)
            .and_then(|node| self.nearest_function(node.id()));
        self.semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                if reference.is_read() {
                    return false;
                }
                let node = self.semantic.nodes().get_node(reference.node_id());
                let write_function = self.nearest_function(node.id());
                (write_function == reference_function && node.span().start < reference_span.start)
                    || (write_function != reference_function
                        && self.foreign_mutation_executes_before(node, reference_span, deferred))
            })
    }

    fn foreign_mutation_executes_before(
        &self,
        mutation_node: &AstNode<'ast>,
        reference_span: Span,
        deferred: bool,
    ) -> bool {
        let reference_function = self
            .node_for_span(reference_span)
            .and_then(|node| self.nearest_function(node.id()));
        let mutation_function = self.nearest_function(mutation_node.id());
        if mutation_function == reference_function {
            return mutation_node.span().start < reference_span.start;
        }
        match mutation_function {
            None => deferred,
            Some(function_id) => self.function_executes_during_module_init(
                function_id,
                reference_span,
                deferred,
                &mut FxHashSet::default(),
            ),
        }
    }

    fn function_executes_during_module_init(
        &self,
        function_id: NodeId,
        reference_span: Span,
        deferred: bool,
        visited_functions: &mut FxHashSet<NodeId>,
    ) -> bool {
        if !visited_functions.insert(function_id) {
            return false;
        }
        let function_node = self.semantic.nodes().get_node(function_id);
        let symbol_id = match function_node.kind() {
            AstKind::Function(function) => function
                .id
                .as_ref()
                .map(|identifier| identifier.symbol_id()),
            AstKind::ArrowFunctionExpression(_) => {
                let parent = self.semantic.nodes().parent_node(function_id);
                match parent.kind() {
                    AstKind::VariableDeclarator(declarator) => declarator
                        .id
                        .get_binding_identifier()
                        .map(|identifier| identifier.symbol_id()),
                    _ => None,
                }
            }
            _ => None,
        };
        let Some(symbol_id) = symbol_id else {
            return false;
        };
        self.semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let reference_node = self.semantic.nodes().get_node(reference.node_id());
                let parent = self.semantic.nodes().parent_node(reference_node.id());
                if !matches!(parent.kind(), AstKind::CallExpression(call)
                    if call.callee.span() == reference_node.span())
                {
                    return false;
                }
                self.nearest_function(parent.id()).map_or_else(
                    || deferred || parent.span().start < reference_span.start,
                    |owner| {
                        self.function_executes_during_module_init(
                            owner,
                            reference_span,
                            deferred,
                            visited_functions,
                        )
                    },
                )
            })
    }

    fn symbol_initializer(&self, symbol_id: SymbolId) -> Option<&Expression<'ast>> {
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        declarator.init.as_ref()
    }

    fn symbol_const_initializer(&self, symbol_id: SymbolId) -> Option<&Expression<'ast>> {
        let declaration = self.semantic.symbol_declaration(symbol_id);
        if !matches!(
            self.semantic.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return None;
        }
        self.symbol_initializer(symbol_id)
    }

    fn is_foreign_let_assigned_only_trusted(
        &self,
        symbol_id: SymbolId,
        reference_span: Span,
        deferred: bool,
        depth: usize,
        visited_symbols: &mut FxHashSet<SymbolId>,
    ) -> bool {
        let declaration = self.semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
        {
            return false;
        }
        let mut saw_trusted_value = false;
        if let Some(initializer) = &declarator.init {
            saw_trusted_value = true;
            if !self.is_trusted_destination(
                initializer,
                deferred,
                depth + 1,
                &mut visited_symbols.clone(),
            ) {
                return false;
            }
        }
        for reference in self.semantic.scoping().get_resolved_references(symbol_id) {
            if reference.is_read() {
                continue;
            }
            let reference_node = self.semantic.nodes().get_node(reference.node_id());
            if !self.foreign_mutation_executes_before(reference_node, reference_span, deferred) {
                continue;
            }
            let parent = self.semantic.nodes().parent_node(reference_node.id());
            let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                return false;
            };
            if assignment.operator != AssignmentOperator::Assign
                || assignment.left.span() != reference_node.span()
            {
                return false;
            }
            saw_trusted_value = true;
            if !self.is_trusted_destination(
                &assignment.right,
                deferred,
                depth + 1,
                &mut visited_symbols.clone(),
            ) {
                return false;
            }
        }
        saw_trusted_value
    }

    fn function_id_for_symbol(&self, symbol_id: SymbolId) -> Option<NodeId> {
        let declaration = self.semantic.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(function) if function.body.is_some() => Some(function.node_id.get()),
            AstKind::VariableDeclarator(declarator) => {
                if !matches!(
                    self.semantic.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable) if variable.kind.is_const()
                ) {
                    return None;
                }
                match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn function_returns(&self, function_id: NodeId) -> Option<Vec<&Expression<'ast>>> {
        let function_node = self.semantic.nodes().get_node(function_id);
        if let AstKind::ArrowFunctionExpression(arrow) = function_node.kind()
            && !matches!(&arrow.body, ArrowFunctionBody::FunctionBody(_))
        {
            return Some(vec![arrow.body.to_expression()]);
        }
        let mut returned_expressions = Vec::new();
        for node in self.semantic.nodes().iter() {
            let AstKind::ReturnStatement(statement) = node.kind() else {
                continue;
            };
            if self.nearest_function(node.id()) != Some(function_id) {
                continue;
            }
            let Some(argument) = statement.argument.as_ref() else {
                return None;
            };
            returned_expressions.push(argument);
        }
        Some(returned_expressions)
    }

    fn function_parameter_index(&self, function_id: NodeId, symbol_id: SymbolId) -> Option<usize> {
        let function_node = self.semantic.nodes().get_node(function_id);
        let parameters = match function_node.kind() {
            AstKind::Function(function) => &function.params.items,
            AstKind::ArrowFunctionExpression(arrow) => &arrow.params.items,
            _ => return None,
        };
        parameters.iter().position(|parameter| {
            parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
        })
    }

    fn reference_symbol(
        &self,
        identifier: &oxc_ast::ast::IdentifierReference<'ast>,
    ) -> Option<SymbolId> {
        self.semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    }

    fn nearest_function(&self, node_id: NodeId) -> Option<NodeId> {
        self.semantic
            .nodes()
            .ancestors(node_id)
            .find_map(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
                .then_some(ancestor.id())
            })
    }

    fn node_for_span(&self, span: Span) -> Option<&AstNode<'ast>> {
        self.semantic
            .nodes()
            .iter()
            .find(|node| node.span() == span)
    }
}
