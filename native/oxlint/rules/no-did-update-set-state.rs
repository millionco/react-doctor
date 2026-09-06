use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, ClassElement, Expression, JSXAttributeName, JSXAttributeValue,
        MemberExpression, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode, context::LintContext, rule::Rule, utils::function_count_before_lifecycle_component,
};

const MESSAGE: &str = "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.";

#[derive(Debug, Default, Clone)]
pub struct NoDidUpdateSetState;

declare_oxc_lint!(
    /// Disallow unguarded state updates in `componentDidUpdate`.
    NoDidUpdateSetState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unguarded state updates in componentDidUpdate.",
);

impl Rule for NoDidUpdateSetState {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return;
        };
        if !matches!(
            member.object().get_inner_expression(),
            Expression::ThisExpression(_)
        ) || !did_update_is_set_state_member(member)
        {
            return;
        }
        let Some(function_count) =
            function_count_before_lifecycle_component(node, ctx, "componentDidUpdate")
        else {
            return;
        };
        if function_count > 1 && !did_update_disallows_nested_functions(ctx) {
            return;
        }
        let Some(lifecycle_id) = did_update_lifecycle_function_id(node.id(), ctx) else {
            return;
        };
        let analysis = DidUpdateAnalysis::new(lifecycle_id, ctx);
        if analysis.is_guarded(node, call) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.callee.span()));
    }
}

fn did_update_is_set_state_member(member: &MemberExpression<'_>) -> bool {
    match member {
        MemberExpression::StaticMemberExpression(member) => member.property.name == "setState",
        MemberExpression::ComputedMemberExpression(member) => {
            matches!(member.expression.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "setState")
        }
        MemberExpression::PrivateFieldExpression(_) => false,
    }
}

fn did_update_disallows_nested_functions(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("noDidUpdateSetState"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("mode"))
        .and_then(serde_json::Value::as_str)
        == Some("disallow-in-func")
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StatePath {
    domain: String,
    members: Vec<String>,
    is_previous: bool,
}

struct DidUpdateAnalysis<'a, 'ctx> {
    lifecycle_id: NodeId,
    parameter_symbols: FxHashSet<SymbolId>,
    derived_symbols: FxHashSet<SymbolId>,
    previous_paths: FxHashMap<SymbolId, StatePath>,
    local_initializers: FxHashMap<SymbolId, &'a Expression<'a>>,
    lifecycle_written_fields: FxHashSet<String>,
    callback_ref_fields: FxHashSet<String>,
    ctx: &'ctx LintContext<'a>,
}

impl<'a, 'ctx> DidUpdateAnalysis<'a, 'ctx> {
    fn new(lifecycle_id: NodeId, ctx: &'ctx LintContext<'a>) -> Self {
        let lifecycle = ctx.nodes().get_node(lifecycle_id);
        let lifecycle_span = lifecycle.span();
        let parameters = match lifecycle.kind() {
            AstKind::Function(function) => Some(&function.params.items),
            AstKind::ArrowFunctionExpression(function) => Some(&function.params.items),
            _ => None,
        };
        let mut parameter_symbols = FxHashSet::default();
        let mut previous_paths = FxHashMap::default();
        if let Some(parameters) = parameters {
            for parameter in parameters {
                collect_binding_symbols(&parameter.pattern, &mut parameter_symbols);
            }
            if let Some(parameter) = parameters.first() {
                collect_previous_paths(&parameter.pattern, "props", &[], &mut previous_paths);
            }
            if let Some(parameter) = parameters.get(1) {
                collect_previous_paths(&parameter.pattern, "state", &[], &mut previous_paths);
            }
        }

        let mut local_initializers = FxHashMap::default();
        let mut derived_symbols = FxHashSet::default();
        let mut lifecycle_written_fields = FxHashSet::default();
        for candidate in ctx.nodes().iter() {
            if !lifecycle_span.contains_inclusive(candidate.span())
                || !did_update_node_executes_in_function(candidate, lifecycle_id, ctx)
            {
                continue;
            }
            if let AstKind::VariableDeclarator(declarator) = candidate.kind()
                && let Some(initializer) = &declarator.init
            {
                let mut binding_symbols = FxHashSet::default();
                collect_binding_symbols(&declarator.id, &mut binding_symbols);
                for symbol_id in &binding_symbols {
                    local_initializers.insert(*symbol_id, initializer);
                }
                if expression_has_source(initializer, &parameter_symbols, &derived_symbols, ctx) {
                    derived_symbols.extend(binding_symbols);
                }
            }
            match candidate.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    if let Some(target) = assignment.left.as_simple_assignment_target()
                        && let Some(field) = direct_this_field_from_target(target)
                    {
                        lifecycle_written_fields.insert(field);
                    }
                }
                AstKind::UpdateExpression(update) => {
                    if let Some(field) = direct_this_field_from_target(&update.argument) {
                        lifecycle_written_fields.insert(field);
                    }
                }
                _ => {}
            }
        }
        let callback_ref_fields = collect_callback_ref_fields(lifecycle_id, ctx);
        Self {
            lifecycle_id,
            parameter_symbols,
            derived_symbols,
            previous_paths,
            local_initializers,
            lifecycle_written_fields,
            callback_ref_fields,
            ctx,
        }
    }

    fn is_guarded(
        &self,
        set_state_node: &AstNode<'a>,
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        let mut child_span = set_state_node.span();
        let mut path_truthiness = Vec::new();
        for ancestor in self.ctx.nodes().ancestors(set_state_node.id()).skip(1) {
            if ancestor.id() == self.lifecycle_id {
                break;
            }
            let guard = match ancestor.kind() {
                AstKind::IfStatement(statement)
                    if statement.consequent.span().contains_inclusive(child_span) =>
                {
                    Some((&statement.test, true))
                }
                AstKind::IfStatement(statement)
                    if statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(child_span)
                    }) =>
                {
                    Some((&statement.test, false))
                }
                AstKind::ConditionalExpression(expression)
                    if expression.consequent.span().contains_inclusive(child_span) =>
                {
                    Some((&expression.test, true))
                }
                AstKind::ConditionalExpression(expression)
                    if expression.alternate.span().contains_inclusive(child_span) =>
                {
                    Some((&expression.test, false))
                }
                AstKind::LogicalExpression(expression)
                    if expression.operator == LogicalOperator::And
                        && expression.right.span().contains_inclusive(child_span) =>
                {
                    Some((&expression.left, true))
                }
                _ => None,
            };
            if let Some((test, truthy)) = guard {
                path_truthiness.push((test, truthy));
                if self.guard_expression_is_safe(test, truthy, set_state_call) {
                    return true;
                }
            }
            child_span = ancestor.span();
        }
        self.path_is_historical_transition(&path_truthiness)
    }

    fn guard_expression_is_safe(
        &self,
        expression: &'a Expression<'a>,
        truthy: bool,
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        let expression = expression.get_inner_expression();
        if let Expression::UnaryExpression(unary) = expression
            && unary.operator == UnaryOperator::LogicalNot
        {
            return self.guard_expression_is_safe(&unary.argument, !truthy, set_state_call);
        }
        if let Expression::Identifier(identifier) = expression
            && let Some(symbol_id) = reference_symbol_id(identifier, self.ctx)
            && self.symbol_is_immutable(symbol_id)
            && let Some(initializer) = self.local_initializers.get(&symbol_id)
        {
            return self.guard_expression_is_safe(initializer, truthy, set_state_call);
        }
        if let Expression::LogicalExpression(logical) = expression
            && matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or)
        {
            let left = self.guard_expression_is_safe(&logical.left, truthy, set_state_call);
            let right = self.guard_expression_is_safe(&logical.right, truthy, set_state_call);
            let every = (truthy && logical.operator == LogicalOperator::Or)
                || (!truthy && logical.operator == LogicalOperator::And);
            if if every { left && right } else { left || right } {
                return true;
            }
            if truthy {
                let mut terms = Vec::new();
                collect_conjunctive_terms(expression, &mut terms);
                if self.historical_transition(&terms)
                    || self.truthiness_converges(&terms, set_state_call)
                    || self.undefined_clear_converges(&terms, set_state_call)
                {
                    return true;
                }
            }
            return false;
        }
        self.is_diff_guard(expression, truthy)
            || self.is_previous_current_comparator(expression, truthy)
            || self.exact_guard_converges(expression, truthy, set_state_call)
    }

    fn is_diff_guard(&self, expression: &Expression<'a>, truthy: bool) -> bool {
        let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
            return false;
        };
        if !operator_guards_difference(binary.operator, truthy) {
            return false;
        }
        expression_has_source(
            &binary.left,
            &self.parameter_symbols,
            &self.derived_symbols,
            self.ctx,
        ) && expression_has_source(
            &binary.right,
            &self.parameter_symbols,
            &self.derived_symbols,
            self.ctx,
        ) && (expression_references_symbols(&binary.left, &self.parameter_symbols, self.ctx)
            || expression_references_symbols(&binary.right, &self.parameter_symbols, self.ctx)
            || expression_references_symbols(&binary.left, &self.derived_symbols, self.ctx)
            || expression_references_symbols(&binary.right, &self.derived_symbols, self.ctx))
    }

    fn is_previous_current_comparator(&self, expression: &Expression<'a>, truthy: bool) -> bool {
        if truthy {
            return false;
        }
        let Expression::CallExpression(call) = expression.get_inner_expression() else {
            return false;
        };
        let Some(name) = call.callee_name() else {
            return false;
        };
        if !is_equality_comparator_name(name) {
            return false;
        }
        let paths = call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .filter_map(|argument| self.state_path(argument))
            .collect::<Vec<_>>();
        paths.iter().enumerate().any(|(index, path)| {
            path.domain == "props"
                && paths[index + 1..].iter().any(|candidate| {
                    path.is_previous != candidate.is_previous
                        && path.domain == candidate.domain
                        && path.members == candidate.members
                })
        })
    }

    fn exact_guard_converges(
        &self,
        expression: &'a Expression<'a>,
        truthy: bool,
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        let Expression::BinaryExpression(binary) = expression.get_inner_expression() else {
            return false;
        };
        if !operator_guards_difference(binary.operator, truthy) {
            return false;
        }
        [
            (this_state_field(&binary.left), &binary.right),
            (this_state_field(&binary.right), &binary.left),
        ]
        .into_iter()
        .any(|(field, compared)| {
            let Some(field) = field else { return false };
            let Some(assigned) = set_state_field_value(set_state_call, &field) else {
                return false;
            };
            self.expressions_equivalent(compared, assigned)
                && self.is_stable_convergence_value(compared, set_state_call)
        })
    }

    fn truthiness_converges(
        &self,
        terms: &[&'a Expression<'a>],
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        let tests = terms
            .iter()
            .map(|term| expression_truthiness(term))
            .collect::<Vec<_>>();
        tests
            .iter()
            .enumerate()
            .any(|(index, (state_expression, state_truthy))| {
                let Some(field) = this_state_field(state_expression) else {
                    return false;
                };
                let Some(assigned) = set_state_field_value(set_state_call, &field) else {
                    return false;
                };
                tests
                    .iter()
                    .enumerate()
                    .any(|(candidate_index, (value, value_truthy))| {
                        index != candidate_index
                            && state_truthy != value_truthy
                            && self.expressions_equivalent(value, assigned)
                            && self.is_stable_convergence_value(value, set_state_call)
                    })
            })
    }

    fn undefined_clear_converges(
        &self,
        terms: &[&'a Expression<'a>],
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        set_state_object_fields(set_state_call)
            .into_iter()
            .any(|(field, value)| {
                is_undefined(value)
                    && terms.iter().any(|term| {
                        this_state_field(term.get_inner_expression()).as_deref()
                            == Some(field.as_str())
                    })
            })
    }

    fn historical_transition(&self, terms: &[&'a Expression<'a>]) -> bool {
        let comparisons = terms
            .iter()
            .filter_map(|term| {
                let Expression::BinaryExpression(binary) = term.get_inner_expression() else {
                    return None;
                };
                let is_difference = match binary.operator {
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality => true,
                    BinaryOperator::Equality | BinaryOperator::StrictEquality => false,
                    _ => return None,
                };
                let left_path = self.state_path(&binary.left);
                let right_path = self.state_path(&binary.right);
                if left_path.is_some() == right_path.is_some() {
                    return None;
                }
                Some(if let Some(path) = left_path {
                    (path, &binary.right, is_difference)
                } else {
                    (right_path?, &binary.left, is_difference)
                })
            })
            .collect::<Vec<_>>();
        if comparisons
            .iter()
            .enumerate()
            .any(|(index, (path, compared_value, is_difference))| {
                comparisons[index + 1..].iter().any(
                    |(candidate_path, candidate_value, candidate_is_difference)| {
                        path.is_previous != candidate_path.is_previous
                            && is_difference != candidate_is_difference
                            && path.domain == candidate_path.domain
                            && path.members == candidate_path.members
                            && self.expressions_equivalent(compared_value, candidate_value)
                    },
                )
            })
        {
            return true;
        }
        let truthiness_tests = terms
            .iter()
            .filter_map(|term| {
                let (expression, truthy) = expression_truthiness(term);
                self.state_path(expression).map(|path| (path, truthy))
            })
            .collect::<Vec<_>>();
        truthiness_tests
            .iter()
            .enumerate()
            .any(|(index, (path, truthy))| {
                truthiness_tests[index + 1..]
                    .iter()
                    .any(|(candidate, candidate_truthy)| {
                        path.is_previous != candidate.is_previous
                            && truthy != candidate_truthy
                            && path.domain == candidate.domain
                            && path.members == candidate.members
                    })
            })
    }

    fn path_is_historical_transition(&self, conditions: &[(&'a Expression<'a>, bool)]) -> bool {
        let tests = conditions
            .iter()
            .filter_map(|(condition, branch_truthy)| {
                let (expression, expression_truthy) = expression_truthiness(condition);
                self.state_path(expression)
                    .map(|path| (path, expression_truthy == *branch_truthy))
            })
            .collect::<Vec<_>>();
        tests.iter().enumerate().any(|(index, (path, truthy))| {
            tests[index + 1..]
                .iter()
                .any(|(candidate, candidate_truthy)| {
                    path.is_previous != candidate.is_previous
                        && truthy != candidate_truthy
                        && path.domain == candidate.domain
                        && path.members == candidate.members
                })
        })
    }

    fn state_path(&self, expression: &Expression<'a>) -> Option<StatePath> {
        let mut current = expression.get_inner_expression();
        let mut members = Vec::new();
        while let Some(member) = current.as_member_expression() {
            members.insert(0, member.static_property_name()?.to_string());
            current = member.object().get_inner_expression();
        }
        match current {
            Expression::ThisExpression(_) => {
                let domain = members.first()?.clone();
                if domain != "props" && domain != "state" {
                    return None;
                }
                Some(StatePath {
                    domain,
                    members: members.into_iter().skip(1).collect(),
                    is_previous: false,
                })
            }
            Expression::Identifier(identifier) => {
                let symbol_id = reference_symbol_id(identifier, self.ctx)?;
                let mut path = self.previous_paths.get(&symbol_id)?.clone();
                path.members.extend(members);
                Some(path)
            }
            _ => None,
        }
    }

    fn expressions_equivalent(&self, left: &Expression<'a>, right: &Expression<'a>) -> bool {
        let left = left.get_inner_expression();
        let right = right.get_inner_expression();
        if let (Expression::Identifier(left), Expression::Identifier(right)) = (left, right) {
            let left_symbol = reference_symbol_id(left, self.ctx);
            let right_symbol = reference_symbol_id(right, self.ctx);
            return if left_symbol.is_some() || right_symbol.is_some() {
                left_symbol == right_symbol
            } else {
                left.name == right.name
            };
        }
        normalize_expression_source(self.ctx.source_range(left.span()))
            == normalize_expression_source(self.ctx.source_range(right.span()))
    }

    fn is_stable_convergence_value(
        &self,
        expression: &'a Expression<'a>,
        set_state_call: &'a oxc_ast::ast::CallExpression<'a>,
    ) -> bool {
        let expression = expression.get_inner_expression();
        if is_undefined(expression)
            || matches!(
                expression,
                Expression::BooleanLiteral(_)
                    | Expression::NullLiteral(_)
                    | Expression::NumericLiteral(_)
                    | Expression::StringLiteral(_)
                    | Expression::BigIntLiteral(_)
            )
            || self.expression_reads_post_mount_value(expression)
        {
            return true;
        }
        if let Some(path) = self.state_path(expression) {
            if path.domain != "state" {
                return true;
            }
            let Some(source_field) = path.members.first() else {
                return false;
            };
            return !set_state_object_fields(set_state_call)
                .iter()
                .any(|(field, _)| field == source_field);
        }
        if let Expression::Identifier(identifier) = expression
            && let Some(symbol_id) = reference_symbol_id(identifier, self.ctx)
            && self.symbol_is_immutable(symbol_id)
            && let Some(initializer) = self.local_initializers.get(&symbol_id)
        {
            return self.is_stable_convergence_value(initializer, set_state_call);
        }
        false
    }

    fn expression_reads_post_mount_value(&self, expression: &Expression<'a>) -> bool {
        if let Some(field) = direct_this_field(expression)
            && self.callback_ref_fields.contains(&field)
            && !self.lifecycle_written_fields.contains(&field)
        {
            return true;
        }
        self.ctx.nodes().iter().any(|candidate| {
            if !expression.span().contains_inclusive(candidate.span()) {
                return false;
            }
            match candidate.kind() {
                AstKind::IdentifierReference(identifier) => {
                    matches!(
                        identifier.name.as_str(),
                        "document" | "window" | "localStorage" | "sessionStorage" | "navigator"
                    ) && reference_symbol_id(identifier, self.ctx).is_none()
                        && !identifier_is_member_property(candidate.id(), self.ctx)
                }
                AstKind::StaticMemberExpression(member) => {
                    let name = member.property.name.as_str();
                    matches!(
                        name,
                        "getBoundingClientRect"
                            | "getComputedStyle"
                            | "getElementById"
                            | "querySelector"
                            | "querySelectorAll"
                            | "getElementsByClassName"
                            | "getElementsByTagName"
                            | "matchMedia"
                    ) || (matches!(
                        name,
                        "current"
                            | "textContent"
                            | "innerText"
                            | "scrollWidth"
                            | "clientWidth"
                            | "offsetWidth"
                            | "scrollHeight"
                            | "clientHeight"
                            | "offsetHeight"
                            | "scrollTop"
                            | "scrollLeft"
                            | "offsetTop"
                            | "offsetLeft"
                            | "innerWidth"
                            | "innerHeight"
                    ) && is_ref_like_expression(&member.object))
                        || (name == "className" && is_element_like_expression(&member.object))
                }
                _ => false,
            }
        })
    }

    fn symbol_is_immutable(&self, symbol_id: SymbolId) -> bool {
        !self
            .ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    }
}

fn did_update_lifecycle_function_id<'a>(node_id: NodeId, ctx: &LintContext<'a>) -> Option<NodeId> {
    let mut function_id = None;
    for ancestor in ctx.nodes().ancestors(node_id).skip(1) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            function_id = Some(ancestor.id());
        }
        let is_lifecycle = match ancestor.kind() {
            AstKind::ObjectProperty(property) => {
                property.key.static_name().as_deref() == Some("componentDidUpdate")
            }
            AstKind::MethodDefinition(method) => {
                method.key.static_name().as_deref() == Some("componentDidUpdate")
            }
            AstKind::PropertyDefinition(property) => {
                property.key.static_name().as_deref() == Some("componentDidUpdate")
            }
            _ => false,
        };
        if is_lifecycle {
            return function_id;
        }
    }
    None
}

fn collect_binding_symbols(pattern: &BindingPattern<'_>, symbols: &mut FxHashSet<SymbolId>) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            symbols.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_binding_symbols(&assignment.left, symbols);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                collect_binding_symbols(&property.value, symbols);
            }
            if let Some(rest) = &object.rest {
                collect_binding_symbols(&rest.argument, symbols);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                collect_binding_symbols(element, symbols);
            }
            if let Some(rest) = &array.rest {
                collect_binding_symbols(&rest.argument, symbols);
            }
        }
    }
}

fn collect_previous_paths(
    pattern: &BindingPattern<'_>,
    domain: &str,
    members: &[String],
    paths: &mut FxHashMap<SymbolId, StatePath>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            paths.insert(
                identifier.symbol_id(),
                StatePath {
                    domain: domain.to_string(),
                    members: members.to_vec(),
                    is_previous: true,
                },
            );
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_previous_paths(&assignment.left, domain, members, paths);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                let Some(property_name) = property.key.static_name() else {
                    continue;
                };
                let mut property_members = members.to_vec();
                property_members.push(property_name.to_string());
                collect_previous_paths(&property.value, domain, &property_members, paths);
            }
        }
        BindingPattern::ArrayPattern(_) => {}
    }
}

fn expression_has_source(
    expression: &Expression<'_>,
    parameter_symbols: &FxHashSet<SymbolId>,
    derived_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    expression_references_symbols(expression, parameter_symbols, ctx)
        || expression_references_symbols(expression, derived_symbols, ctx)
        || expression_contains_this_state_or_props(expression, ctx)
}

fn expression_references_symbols(
    expression: &Expression<'_>,
    symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    if symbols.is_empty() {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        expression.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::IdentifierReference(identifier)
                if reference_symbol_id(identifier, ctx).is_some_and(|symbol_id| symbols.contains(&symbol_id)))
    })
}

fn expression_contains_this_state_or_props(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        expression.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::StaticMemberExpression(member)
                if matches!(member.object.get_inner_expression(), Expression::ThisExpression(_))
                    && matches!(member.property.name.as_str(), "state" | "props"))
    })
}

fn reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn identifier_is_member_property(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    matches!(ctx.nodes().parent_kind(node_id), AstKind::StaticMemberExpression(member) if member.property.span == ctx.nodes().get_node(node_id).span())
}

fn is_ref_like_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => has_ref_like_name(identifier.name.as_str()),
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|name| {
                has_ref_like_name(name.as_ref())
                    || (name == "current" && is_ref_like_expression(member.object()))
            })
        }),
    }
}

fn is_element_like_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "element" | "node")
                || has_ref_like_name(identifier.name.as_str())
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member
                .static_property_name()
                .is_some_and(|name| has_ref_like_name(name.as_ref()))
        }),
    }
}

fn has_ref_like_name(name: &str) -> bool {
    name == "ref"
        || name.ends_with("Ref")
        || name.ends_with("ref")
        || name.ends_with("Node")
        || name.ends_with("node")
        || name.ends_with("Element")
        || name.ends_with("element")
}

fn operator_guards_difference(operator: BinaryOperator, truthy: bool) -> bool {
    match operator {
        BinaryOperator::Inequality | BinaryOperator::StrictInequality => truthy,
        BinaryOperator::Equality | BinaryOperator::StrictEquality => !truthy,
        _ => false,
    }
}

fn collect_conjunctive_terms<'a>(
    expression: &'a Expression<'a>,
    terms: &mut Vec<&'a Expression<'a>>,
) {
    if let Expression::LogicalExpression(logical) = expression.get_inner_expression()
        && logical.operator == LogicalOperator::And
    {
        collect_conjunctive_terms(&logical.left, terms);
        collect_conjunctive_terms(&logical.right, terms);
    } else {
        terms.push(expression.get_inner_expression());
    }
}

fn expression_truthiness<'a>(expression: &'a Expression<'a>) -> (&'a Expression<'a>, bool) {
    let mut expression = expression.get_inner_expression();
    let mut truthy = true;
    while let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
    {
        truthy = !truthy;
        expression = unary.argument.get_inner_expression();
    }
    (expression, truthy)
}

fn this_state_field(expression: &Expression<'_>) -> Option<String> {
    let member = expression.get_inner_expression().as_member_expression()?;
    let field = member.static_property_name()?;
    let state = member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    if state.static_property_name().as_deref() == Some("state")
        && matches!(
            state.object().get_inner_expression(),
            Expression::ThisExpression(_)
        )
    {
        Some(field.to_string())
    } else {
        None
    }
}

fn direct_this_field(expression: &Expression<'_>) -> Option<String> {
    let member = expression.get_inner_expression().as_member_expression()?;
    did_update_static_this_field_identity(member)
}

fn direct_this_field_from_target(
    target: &oxc_ast::ast::SimpleAssignmentTarget<'_>,
) -> Option<String> {
    let member = target.as_member_expression()?;
    did_update_static_this_field_identity(member)
}

fn set_state_object_fields<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Vec<(String, &'a Expression<'a>)> {
    let Some(Expression::ObjectExpression(object)) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return Vec::new();
    };
    object
        .properties
        .iter()
        .filter_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            Some((property.key.static_name()?, &property.value))
        })
        .map(|(name, value)| (name.to_string(), value))
        .collect()
}

fn set_state_field_value<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    field: &str,
) -> Option<&'a Expression<'a>> {
    set_state_object_fields(call)
        .into_iter()
        .find_map(|(candidate, value)| (candidate == field).then_some(value))
}

fn is_undefined(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined")
}

fn normalize_expression_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn is_equality_comparator_name(name: &str) -> bool {
    let name = name.rsplit('.').next().unwrap_or(name);
    ["deepEqual", "equal", "equals", "isEqual", "isSame"]
        .iter()
        .any(|prefix| {
            name == *prefix
                || name.strip_prefix(prefix).is_some_and(|suffix| {
                    suffix.starts_with(|character: char| {
                        character.is_ascii_uppercase() || character == '_'
                    })
                })
        })
}

fn collect_callback_ref_fields<'a>(
    lifecycle_id: NodeId,
    ctx: &LintContext<'a>,
) -> FxHashSet<String> {
    let Some(class_node) = ctx
        .nodes()
        .ancestors(lifecycle_id)
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
    else {
        return FxHashSet::default();
    };
    let mut fields = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::JSXAttribute(attribute) = candidate.kind() else {
            continue;
        };
        if !class_node.span().contains_inclusive(candidate.span())
            || did_update_nearest_class_id(candidate, ctx) != Some(class_node.id())
            || !matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "ref")
        {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            continue;
        };
        let Some(expression) = container.expression.as_expression() else {
            continue;
        };
        did_update_collect_callback_ref_expression(
            expression,
            class_node.id(),
            &mut fields,
            ctx,
            &mut FxHashSet::default(),
        );
    }
    fields
}

fn did_update_collect_callback_ref_expression<'a>(
    expression: &Expression<'a>,
    class_node_id: NodeId,
    field_names: &mut FxHashSet<String>,
    ctx: &LintContext<'a>,
    visited_handler_names: &mut FxHashSet<String>,
) {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            if let Some(function_id) = did_update_expression_function_id(expression, ctx) {
                field_names.extend(did_update_callback_assigned_fields(
                    function_id,
                    class_node_id,
                    ctx,
                    visited_handler_names,
                ));
            }
        }
        Expression::ConditionalExpression(conditional) => {
            did_update_collect_callback_ref_expression(
                &conditional.consequent,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
            did_update_collect_callback_ref_expression(
                &conditional.alternate,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
        }
        Expression::LogicalExpression(logical) => {
            if logical.operator != LogicalOperator::And {
                did_update_collect_callback_ref_expression(
                    &logical.left,
                    class_node_id,
                    field_names,
                    ctx,
                    visited_handler_names,
                );
            }
            did_update_collect_callback_ref_expression(
                &logical.right,
                class_node_id,
                field_names,
                ctx,
                visited_handler_names,
            );
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return;
            };
            let Some(handler_name) = did_update_static_this_field_identity(member) else {
                return;
            };
            let Some(function_id) =
                did_update_class_member_function_id(class_node_id, &handler_name, ctx)
            else {
                return;
            };
            field_names.extend(did_update_callback_assigned_fields(
                function_id,
                class_node_id,
                ctx,
                visited_handler_names,
            ));
        }
    }
}

fn did_update_callback_assigned_fields<'a>(
    function_id: NodeId,
    class_node_id: NodeId,
    ctx: &LintContext<'a>,
    visited_handler_names: &mut FxHashSet<String>,
) -> FxHashSet<String> {
    let Some(parameter_symbol_id) = did_update_first_parameter_symbol(function_id, ctx) else {
        return FxHashSet::default();
    };
    let function_span = ctx.nodes().get_node(function_id).span();
    let this_alias_symbol_ids = did_update_this_alias_symbol_ids(function_id, class_node_id, ctx);
    let mut fields = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !function_span.contains_inclusive(candidate.span())
            || !did_update_node_executes_in_function(candidate, function_id, ctx)
        {
            continue;
        }
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(target) = assignment.left.as_member_expression() else {
                    continue;
                };
                let Some(field_name) = did_update_this_or_alias_field_identity(
                    target,
                    class_node_id,
                    &this_alias_symbol_ids,
                    ctx,
                ) else {
                    continue;
                };
                if assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                    && did_update_expression_is_parameter_value(
                        &assignment.right,
                        parameter_symbol_id,
                        ctx,
                    )
                {
                    fields.insert(field_name.to_string());
                } else {
                    fields.remove(&field_name);
                }
                continue;
            }
            AstKind::UpdateExpression(update) => {
                if let Some(member) = update.argument.as_member_expression()
                    && let Some(field_name) = did_update_this_or_alias_field_identity(
                        member,
                        class_node_id,
                        &this_alias_symbol_ids,
                        ctx,
                    )
                {
                    fields.remove(&field_name);
                }
                continue;
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                if let Some(member) = unary.argument.get_inner_expression().as_member_expression()
                    && let Some(field_name) = did_update_this_or_alias_field_identity(
                        member,
                        class_node_id,
                        &this_alias_symbol_ids,
                        ctx,
                    )
                {
                    fields.remove(&field_name);
                }
                continue;
            }
            _ => {}
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        if let Some((receiver_kind, method_name)) =
            did_update_mutation_receiver_and_method(member, function_id, ctx)
        {
            let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            if !did_update_is_this_or_alias(target, class_node_id, &this_alias_symbol_ids, ctx) {
                continue;
            }
            if receiver_kind == "object" && method_name == "assign" {
                for source in call.arguments.iter().skip(1) {
                    let Some(Expression::ObjectExpression(object)) =
                        source.as_expression().map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    for property_kind in &object.properties {
                        let ObjectPropertyKind::ObjectProperty(property) = property_kind else {
                            continue;
                        };
                        let Some(property_name) = property.key.static_name() else {
                            continue;
                        };
                        if property_name.is_empty() {
                            continue;
                        }
                        if did_update_expression_is_parameter_value(
                            &property.value,
                            parameter_symbol_id,
                            ctx,
                        ) {
                            fields.insert(property_name.to_string());
                        } else {
                            fields.remove(property_name.as_ref());
                        }
                    }
                }
                continue;
            }
            if receiver_kind == "reflect" && method_name == "set" {
                let Some(property_name) = call
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                    .and_then(did_update_static_string)
                else {
                    continue;
                };
                if property_name.is_empty() {
                    continue;
                }
                if call
                    .arguments
                    .get(2)
                    .and_then(Argument::as_expression)
                    .is_some_and(|value| {
                        did_update_expression_is_parameter_value(value, parameter_symbol_id, ctx)
                    })
                {
                    fields.insert(property_name.to_string());
                } else {
                    fields.remove(property_name);
                }
                continue;
            }
        }
        let Some(handler_name) = did_update_static_this_field_identity(member) else {
            continue;
        };
        let Some(forwarded_value) = call.arguments.first().and_then(Argument::as_expression) else {
            continue;
        };
        if !did_update_expression_is_parameter_value(forwarded_value, parameter_symbol_id, ctx)
            || visited_handler_names.contains(&handler_name)
        {
            continue;
        }
        if let Some(handler_id) =
            did_update_class_member_function_id(class_node_id, &handler_name, ctx)
        {
            let mut next_visited_handler_names = visited_handler_names.clone();
            next_visited_handler_names.insert(handler_name);
            fields.extend(did_update_callback_assigned_fields(
                handler_id,
                class_node_id,
                ctx,
                &mut next_visited_handler_names,
            ));
        }
    }
    fields
}

fn did_update_expression_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let span = expression.get_inner_expression().span();
    ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == span
            && matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ))
        .then(|| candidate.id())
    })
}

fn did_update_first_parameter_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    let pattern = &parameters.items.first()?.pattern;
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => assignment
            .left
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id()),
        _ => None,
    }
}

fn did_update_expression_is_parameter_value(
    expression: &Expression<'_>,
    parameter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(parameter_symbol_id)
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::Coalesce => {
            did_update_expression_is_parameter_value(&logical.left, parameter_symbol_id, ctx)
                && is_undefined(&logical.right)
        }
        _ => false,
    }
}

fn did_update_class_member_function_id(
    class_node_id: NodeId,
    member_name: &str,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let AstKind::Class(class) = ctx.nodes().get_node(class_node_id).kind() else {
        return None;
    };
    let function_span = class.body.body.iter().find_map(|element| match element {
        ClassElement::MethodDefinition(method)
            if !method.r#static
                && did_update_property_identity(&method.key).as_deref() == Some(member_name) =>
        {
            Some(method.value.span())
        }
        ClassElement::PropertyDefinition(property)
            if !property.r#static
                && did_update_property_identity(&property.key).as_deref() == Some(member_name) =>
        {
            property.value.as_ref().and_then(|value| {
                matches!(
                    value.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
                .then(|| value.get_inner_expression().span())
            })
        }
        _ => None,
    })?;
    ctx.nodes().iter().find_map(|candidate| {
        (candidate.span() == function_span
            && matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ))
        .then(|| candidate.id())
    })
}

fn did_update_property_identity(property: &PropertyKey<'_>) -> Option<String> {
    match property {
        PropertyKey::PrivateIdentifier(identifier) => Some(format!("#{}", identifier.name)),
        _ => property
            .static_name()
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string()),
    }
}

fn did_update_static_this_field_identity(
    member: &oxc_ast::ast::MemberExpression<'_>,
) -> Option<String> {
    if !matches!(
        member.object().get_inner_expression(),
        Expression::ThisExpression(_)
    ) {
        return None;
    }
    match member {
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(member) => {
            Some(format!("#{}", member.field.name))
        }
        _ => member
            .static_property_name()
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string()),
    }
}

fn did_update_nearest_class_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
        .map(AstNode::id)
}

fn did_update_node_executes_in_function<'a>(
    node: &AstNode<'a>,
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            return true;
        }
        if matches!(ancestor.kind(), AstKind::Class(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !did_update_is_immediately_invoked_function(ancestor, ctx)
        {
            return false;
        }
    }
    false
}

fn did_update_is_immediately_invoked_function(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(AstKind::CallExpression(call)) =
        crate::ast_util::iter_outer_expressions(ctx.nodes(), function_node.id()).next()
    else {
        return false;
    };
    call.callee.span().contains_inclusive(function_node.span())
}

fn did_update_this_alias_symbol_ids(
    function_id: NodeId,
    _class_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let function_span = ctx.nodes().get_node(function_id).span();
    let mut aliases = FxHashSet::default();
    let mut did_add_alias = true;
    while did_add_alias {
        did_add_alias = false;
        for candidate in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            if !function_span.contains_inclusive(candidate.span())
                || !did_update_node_executes_in_function(candidate, function_id, ctx)
            {
                continue;
            }
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let is_alias = match initializer.get_inner_expression() {
                Expression::ThisExpression(_) => true,
                Expression::Identifier(identifier) => ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| aliases.contains(&symbol_id)),
                _ => false,
            };
            if is_alias && aliases.insert(binding.symbol_id()) {
                did_add_alias = true;
            }
        }
    }
    aliases
}

fn did_update_is_this_or_alias(
    expression: &Expression<'_>,
    _class_node_id: NodeId,
    alias_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ThisExpression(_) => true,
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| alias_symbol_ids.contains(&symbol_id)),
        _ => false,
    }
}

fn did_update_this_or_alias_field_identity<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    class_node_id: NodeId,
    alias_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if !did_update_is_this_or_alias(member.object(), class_node_id, alias_symbol_ids, ctx) {
        return None;
    }
    match member {
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(member) => {
            Some(format!("#{}", member.field.name))
        }
        _ => member
            .static_property_name()
            .filter(|name| !name.is_empty())
            .map(|name| name.to_string()),
    }
}

fn did_update_mutation_receiver_and_method<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<(&'static str, String)> {
    let method_name = member.static_property_name()?;
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    let receiver_kind = did_update_global_mutation_receiver_kind(
        receiver,
        function_id,
        ctx,
        &mut FxHashSet::default(),
    )?;
    Some((receiver_kind, method_name.to_string()))
}

fn did_update_global_mutation_receiver_kind(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'static str> {
    match identifier.name.as_str() {
        "Object" => return Some("object"),
        "Reflect" => return Some("reflect"),
        _ => {}
    }
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let symbol_id = reference.symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if !ctx
        .nodes()
        .get_node(function_id)
        .span()
        .contains_inclusive(declaration.span())
    {
        return None;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Expression::Identifier(root) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    did_update_global_mutation_receiver_kind(root, function_id, ctx, visited_symbol_ids)
}

fn did_update_static_string<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}
