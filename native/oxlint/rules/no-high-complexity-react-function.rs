use oxc_ast_visit::VisitJs;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::ScopeFlags;
use oxc_syntax::operator::LogicalOperator;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD: usize = 15;
const REACT_FUNCTION_COGNITIVE_COMPLEXITY_THRESHOLD: usize = 15;

#[derive(Debug, Default, Clone)]
pub struct NoHighComplexityReactFunction;

#[derive(Default)]
struct FunctionComplexityMetrics {
    cognitive: usize,
    cyclomatic: usize,
    max_nesting_depth: usize,
}

declare_oxc_lint!(
    /// Reports React components and hooks with excessive control-flow complexity.
    NoHighComplexityReactFunction,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Reports React functions with excessive control-flow complexity.",
);

impl Rule for NoHighComplexityReactFunction {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            if !matches!(
                node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            let display_name = component_or_hook_function_name(node, ctx)
                .or_else(|| is_anonymous_default_export(node, ctx).then_some("default export"));
            let Some(display_name) = display_name else {
                continue;
            };
            if !crate::utils::is_react_hook_name(display_name)
                && !function_contains_react_render_output(node, ctx)
            {
                continue;
            }
            let complexity = calculate_function_complexity(node, ctx);
            if complexity.cyclomatic <= REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD
                && complexity.cognitive <= REACT_FUNCTION_COGNITIVE_COMPLEXITY_THRESHOLD
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{display_name}` has cyclomatic complexity {}, cognitive complexity {}, and maximum nesting depth {}, so its React logic is hard to understand and change. Extract independent branches into components or hooks.",
                    complexity.cyclomatic,
                    complexity.cognitive,
                    complexity.max_nesting_depth,
                ))
                .with_label(node.span()),
            );
        }
    }
}

fn is_anonymous_default_export<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    matches!(
        parent.kind(),
        AstKind::ExportDefaultDeclaration(declaration)
            if declaration.declaration.span() == expression_root.span()
    )
}

fn calculate_function_complexity<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> FunctionComplexityMetrics {
    let mut metrics = measure_cognitive_complexity(function_node);
    metrics.cyclomatic = 1;
    let analysis_span = function_analysis_span(function_node);
    for candidate in ctx.nodes().iter().filter(|candidate| {
        analysis_span.contains_inclusive(candidate.span())
            && belongs_to_function(candidate, function_node, ctx)
    }) {
        if is_cyclomatic_decision_point(candidate) {
            metrics.cyclomatic += 1;
        }
    }
    metrics.cognitive += count_logical_operator_runs(function_node, ctx);
    metrics
}

fn measure_cognitive_complexity(function_node: &AstNode<'_>) -> FunctionComplexityMetrics {
    let mut visitor = CognitiveComplexityVisitor::default();
    match function_node.kind() {
        AstKind::Function(function) => {
            if let Some(body) = &function.body {
                visitor.visit_function_body(body);
            }
        }
        AstKind::ArrowFunctionExpression(function) => {
            visitor.visit_arrow_function_body(&function.body);
        }
        _ => {}
    }
    FunctionComplexityMetrics {
        cognitive: visitor.cognitive,
        max_nesting_depth: visitor.max_nesting_depth,
        ..FunctionComplexityMetrics::default()
    }
}

#[derive(Default)]
struct CognitiveComplexityVisitor {
    cognitive: usize,
    nesting_depth: usize,
    max_nesting_depth: usize,
}

impl CognitiveComplexityVisitor {
    fn record_nested_control_flow(&mut self) {
        self.cognitive += 1 + self.nesting_depth;
        self.max_nesting_depth = self.max_nesting_depth.max(self.nesting_depth + 1);
    }

    fn visit_if_statement_chain<'a>(
        &mut self,
        statement: &oxc_ast::ast::IfStatement<'a>,
        is_else_if: bool,
    ) {
        if is_else_if {
            self.cognitive += 1;
            self.max_nesting_depth = self.max_nesting_depth.max(self.nesting_depth + 1);
        } else {
            self.record_nested_control_flow();
        }
        self.visit_expression(&statement.test);
        self.nesting_depth += 1;
        self.visit_statement(&statement.consequent);
        self.nesting_depth -= 1;
        let Some(alternate) = &statement.alternate else {
            return;
        };
        if let oxc_ast::ast::Statement::IfStatement(else_if_statement) = alternate {
            self.visit_if_statement_chain(else_if_statement, true);
            return;
        }
        self.cognitive += 1;
        self.nesting_depth += 1;
        self.visit_statement(alternate);
        self.nesting_depth -= 1;
    }
}

impl<'a> VisitJs<'a> for CognitiveComplexityVisitor {
    fn visit_function(&mut self, _function: &oxc_ast::ast::Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(
        &mut self,
        _function: &oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {
    }

    fn visit_if_statement(&mut self, statement: &oxc_ast::ast::IfStatement<'a>) {
        self.visit_if_statement_chain(statement, false);
    }

    fn visit_conditional_expression(
        &mut self,
        expression: &oxc_ast::ast::ConditionalExpression<'a>,
    ) {
        self.record_nested_control_flow();
        self.visit_expression(&expression.test);
        self.nesting_depth += 1;
        self.visit_expression(&expression.consequent);
        self.visit_expression(&expression.alternate);
        self.nesting_depth -= 1;
    }

    fn visit_for_statement(&mut self, statement: &oxc_ast::ast::ForStatement<'a>) {
        self.record_nested_control_flow();
        if let Some(initializer) = &statement.init {
            self.visit_for_statement_init(initializer);
        }
        if let Some(test) = &statement.test {
            self.visit_expression(test);
        }
        if let Some(update) = &statement.update {
            self.visit_expression(update);
        }
        self.nesting_depth += 1;
        self.visit_statement(&statement.body);
        self.nesting_depth -= 1;
    }

    fn visit_for_in_statement(&mut self, statement: &oxc_ast::ast::ForInStatement<'a>) {
        self.record_nested_control_flow();
        self.visit_for_statement_left(&statement.left);
        self.visit_expression(&statement.right);
        self.nesting_depth += 1;
        self.visit_statement(&statement.body);
        self.nesting_depth -= 1;
    }

    fn visit_for_of_statement(&mut self, statement: &oxc_ast::ast::ForOfStatement<'a>) {
        self.record_nested_control_flow();
        self.visit_for_statement_left(&statement.left);
        self.visit_expression(&statement.right);
        self.nesting_depth += 1;
        self.visit_statement(&statement.body);
        self.nesting_depth -= 1;
    }

    fn visit_while_statement(&mut self, statement: &oxc_ast::ast::WhileStatement<'a>) {
        self.record_nested_control_flow();
        self.visit_expression(&statement.test);
        self.nesting_depth += 1;
        self.visit_statement(&statement.body);
        self.nesting_depth -= 1;
    }

    fn visit_do_while_statement(&mut self, statement: &oxc_ast::ast::DoWhileStatement<'a>) {
        self.record_nested_control_flow();
        self.nesting_depth += 1;
        self.visit_statement(&statement.body);
        self.nesting_depth -= 1;
        self.visit_expression(&statement.test);
    }

    fn visit_switch_statement(&mut self, statement: &oxc_ast::ast::SwitchStatement<'a>) {
        self.record_nested_control_flow();
        self.visit_expression(&statement.discriminant);
        for switch_case in &statement.cases {
            if let Some(test) = &switch_case.test {
                self.visit_expression(test);
            }
            self.nesting_depth += 1;
            self.visit_statements(&switch_case.consequent);
            self.nesting_depth -= 1;
        }
    }

    fn visit_catch_clause(&mut self, catch_clause: &oxc_ast::ast::CatchClause<'a>) {
        self.record_nested_control_flow();
        if let Some(parameter) = &catch_clause.param {
            self.visit_catch_parameter(parameter);
        }
        self.nesting_depth += 1;
        self.visit_block_statement(&catch_clause.body);
        self.nesting_depth -= 1;
    }

    fn visit_break_statement(&mut self, statement: &oxc_ast::ast::BreakStatement<'a>) {
        if statement.label.is_some() {
            self.cognitive += 1;
        }
    }

    fn visit_continue_statement(&mut self, statement: &oxc_ast::ast::ContinueStatement<'a>) {
        if statement.label.is_some() {
            self.cognitive += 1;
        }
    }
}

fn count_logical_operator_runs<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> usize {
    let analysis_span = function_analysis_span(function_node);
    ctx.nodes()
        .iter()
        .filter(|candidate| {
            analysis_span.contains_inclusive(candidate.span())
                && belongs_to_function(candidate, function_node, ctx)
                && matches!(candidate.kind(), AstKind::LogicalExpression(_))
                && !matches!(
                    ctx.nodes()
                        .parent_node(parenthesized_expression_root(candidate, ctx).id())
                        .kind(),
                    AstKind::LogicalExpression(_)
                )
        })
        .map(|candidate| {
            let AstKind::LogicalExpression(expression) = candidate.kind() else {
                return 0;
            };
            let mut previous_operator = None;
            count_logical_expression_runs(expression, &mut previous_operator)
        })
        .sum()
}

fn function_analysis_span(function_node: &AstNode<'_>) -> oxc_span::Span {
    match function_node.kind() {
        AstKind::Function(function) => function
            .body
            .as_ref()
            .map_or(function_node.span(), |body| body.span),
        AstKind::ArrowFunctionExpression(function) => function.body.span(),
        _ => function_node.span(),
    }
}

fn count_logical_expression_runs(
    expression: &oxc_ast::ast::LogicalExpression<'_>,
    previous_operator: &mut Option<LogicalOperator>,
) -> usize {
    let mut logical_run_count = 0;
    if let oxc_ast::ast::Expression::LogicalExpression(left_expression) =
        strip_parenthesized_expression(&expression.left)
    {
        logical_run_count += count_logical_expression_runs(left_expression, previous_operator);
    }
    if *previous_operator != Some(expression.operator) {
        logical_run_count += 1;
    }
    *previous_operator = Some(expression.operator);
    if let oxc_ast::ast::Expression::LogicalExpression(right_expression) =
        strip_parenthesized_expression(&expression.right)
    {
        logical_run_count += count_logical_expression_runs(right_expression, previous_operator);
    }
    logical_run_count
}

fn parenthesized_expression_root<'a, 'b>(
    mut node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(parent.kind(), AstKind::ParenthesizedExpression(_)) {
            return node;
        }
        node = parent;
    }
}

fn belongs_to_function<'a>(
    node: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    crate::ast_util::get_enclosing_function(node, ctx)
        .is_some_and(|enclosing_function| enclosing_function.id() == function_node.id())
}

fn is_cyclomatic_decision_point(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::IfStatement(_)
        | AstKind::ForStatement(_)
        | AstKind::ForInStatement(_)
        | AstKind::ForOfStatement(_)
        | AstKind::WhileStatement(_)
        | AstKind::DoWhileStatement(_)
        | AstKind::CatchClause(_)
        | AstKind::ConditionalExpression(_)
        | AstKind::LogicalExpression(_) => true,
        AstKind::SwitchCase(switch_case) => switch_case.test.is_some(),
        AstKind::AssignmentExpression(assignment) => assignment.operator.is_logical(),
        _ => false,
    }
}
