use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, CallExpression, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Reading a property straight off `JSON.parse(...)` combines a throwing parse with an unchecked result: malformed or empty input throws `SyntaxError`, while missing fields silently become `undefined`. Wrap the parse in try/catch and validate its shape before accessing fields.";
const SYNCHRONOUS_CALLBACK_METHODS: [&str; 11] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
];

#[derive(Debug, Default, Clone)]
pub struct NoUnsafeJsonParse;

#[derive(Default)]
struct UnsafeJsonAnalysis {
    parse_calls_by_symbol: FxHashMap<SymbolId, Vec<NodeId>>,
    return_nodes_by_function: FxHashMap<NodeId, Vec<NodeId>>,
    stringify_call_spans: Vec<Span>,
    try_nodes_by_function: FxHashMap<NodeId, Vec<NodeId>>,
    validator_safety_by_function: FxHashMap<NodeId, bool>,
}

declare_oxc_lint!(
    /// Disallow unchecked property reads directly from JSON.parse results.
    NoUnsafeJsonParse,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unchecked property reads directly from JSON.parse results.",
);

impl Rule for NoUnsafeJsonParse {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && !unsafe_json_is_node_script_filename(&ctx.file_path().to_string_lossy())
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut analysis = UnsafeJsonAnalysis::build(ctx);
        for node in ctx.nodes().iter() {
            unsafe_json_inspect_parse(node, ctx, &mut analysis);
        }
    }
}

impl UnsafeJsonAnalysis {
    fn build(ctx: &LintContext<'_>) -> Self {
        let mut analysis = Self::default();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call) => {
                    if unsafe_json_is_global_json_method_call(call, "stringify", ctx) {
                        analysis.stringify_call_spans.push(call.span);
                    }
                    if unsafe_json_is_global_json_method_call(call, "parse", ctx)
                        && let Some(Expression::Identifier(identifier)) =
                            call.arguments.first().and_then(Argument::as_expression)
                        && let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                    {
                        analysis
                            .parse_calls_by_symbol
                            .entry(symbol_id)
                            .or_default()
                            .push(node.id());
                    }
                }
                AstKind::ReturnStatement(_) => {
                    if let Some(function_id) = unsafe_json_nearest_function_id(node.id(), ctx) {
                        analysis
                            .return_nodes_by_function
                            .entry(function_id)
                            .or_default()
                            .push(node.id());
                    }
                }
                AstKind::TryStatement(_) => {
                    if let Some(function_id) = unsafe_json_nearest_function_id(node.id(), ctx) {
                        analysis
                            .try_nodes_by_function
                            .entry(function_id)
                            .or_default()
                            .push(node.id());
                    }
                }
                _ => {}
            }
        }
        analysis
    }
}

fn unsafe_json_inspect_parse<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    analysis: &mut UnsafeJsonAnalysis,
) {
    let AstKind::CallExpression(parse_call) = node.kind() else {
        return;
    };
    if !unsafe_json_is_global_json_method_call(parse_call, "parse", ctx)
        || !unsafe_json_result_is_immediately_read(node, ctx)
    {
        return;
    }
    if let Some(argument) = parse_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    {
        let argument = argument.get_inner_expression();
        if unsafe_json_is_known_serializer_call(argument, ctx)
            || unsafe_json_identifier_has_unmodified_serializer_initializer(argument, node, ctx)
            || unsafe_json_is_statically_valid_non_null_literal(argument)
            || unsafe_json_is_round_trip_deserializer(node, argument, ctx, analysis)
            || unsafe_json_is_dominated_by_prior_parse(node, argument, ctx, analysis)
            || unsafe_json_is_guarded_by_validator(node, argument, ctx, analysis)
        {
            return;
        }
    }
    if unsafe_json_is_inside_guarding_try(node, ctx) {
        return;
    }
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(parse_call.span));
}

fn unsafe_json_is_node_script_filename(filename: &str) -> bool {
    let normalized = filename.replace('\\', "/").to_ascii_lowercase();
    if normalized.split('/').any(|segment| {
        matches!(
            segment,
            "script" | "scripts" | "tool" | "tools" | "token" | "tokens"
        )
    }) {
        return true;
    }
    ["release", "build", "generate"].iter().any(|word| {
        normalized.match_indices(word).any(|(index, _)| {
            let before = index
                .checked_sub(1)
                .and_then(|before| normalized.as_bytes().get(before))
                .copied();
            let after = normalized.as_bytes().get(index + word.len()).copied();
            before.is_none_or(|value| matches!(value, b'/' | b'.' | b'-'))
                && after.is_none_or(|value| matches!(value, b'.' | b'-'))
        })
    })
}

fn unsafe_json_is_global_json_method_call<'a>(
    call: &CallExpression<'a>,
    method_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some(method_name) {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    receiver.name == "JSON"
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none()
}

fn unsafe_json_result_is_immediately_read<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::StaticMemberExpression(member) => member.object.span() == root.span(),
        AstKind::ComputedMemberExpression(member) => member.object.span() == root.span(),
        AstKind::PrivateFieldExpression(member) => member.object.span() == root.span(),
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == root.span()) =>
        {
            matches!(
                declarator.id,
                BindingPattern::ObjectPattern(_) | BindingPattern::ArrayPattern(_)
            )
        }
        _ => false,
    }
}

fn unsafe_json_is_statically_valid_non_null_literal(expression: &Expression<'_>) -> bool {
    let text = match expression {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
            })
        }
        _ => None,
    };
    text.and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .is_some_and(|value| !value.is_null())
}

fn unsafe_json_is_known_serializer_call<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    if unsafe_json_is_global_json_method_call(call, "stringify", ctx) {
        return true;
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    unsafe_json_is_serializer_name(callee.name.as_str())
}

fn unsafe_json_is_serializer_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("stringify")
        || name.contains("serializ")
        || (["get", "build", "create"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
            && (name.ends_with("json") || name.ends_with("datasetkey")))
}

fn unsafe_json_identifier_has_unmodified_serializer_initializer<'a>(
    expression: &Expression<'a>,
    parse_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .init
        .as_ref()
        .is_some_and(|initializer| unsafe_json_is_known_serializer_call(initializer, ctx))
        && !unsafe_json_has_binding_write_between(
            symbol_id,
            declaration.span().end,
            parse_node.span().start,
            unsafe_json_deferred_execution_boundary_id(parse_node.id(), ctx),
            ctx,
        )
}

fn unsafe_json_has_binding_write_between(
    symbol_id: SymbolId,
    start: u32,
    end: u32,
    execution_boundary_id: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            reference_node.span().start > start
                && reference_node.span().start < end
                && unsafe_json_deferred_execution_boundary_id(reference.node_id(), ctx)
                    == execution_boundary_id
        })
}

fn unsafe_json_deferred_execution_boundary_id(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        (matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !unsafe_json_function_is_invoked_synchronously(ancestor, ctx))
        .then_some(ancestor.id())
    })
}

fn unsafe_json_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn unsafe_json_is_inside_guarding_try<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !unsafe_json_function_is_invoked_synchronously(ancestor, ctx)
        {
            return false;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.span.contains_inclusive(child_span)
        {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn unsafe_json_function_is_invoked_synchronously<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    let call = match parent.kind() {
        AstKind::CallExpression(call) => call,
        AstKind::NewExpression(call) => return call.callee.span() == root.span(),
        _ => return false,
    };
    if call.callee.span() == root.span() {
        return true;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    if method_name == "from"
        && matches!(
            member.object().get_inner_expression(),
            Expression::Identifier(identifier)
                if identifier.name == "Array"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        )
    {
        return true;
    }
    SYNCHRONOUS_CALLBACK_METHODS.contains(&method_name)
}

fn unsafe_json_is_round_trip_deserializer<'a>(
    parse_node: &AstNode<'a>,
    argument: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &UnsafeJsonAnalysis,
) -> bool {
    let Expression::Identifier(argument_identifier) = argument.get_inner_expression() else {
        return false;
    };
    let Some(argument_symbol_id) = ctx
        .scoping()
        .get_reference(argument_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !matches!(
        ctx.symbol_declaration(argument_symbol_id).kind(),
        AstKind::FormalParameter(_)
    ) {
        return false;
    }
    let Some(function_node) = unsafe_json_enclosing_function(parse_node, ctx) else {
        return false;
    };
    let Some(function_name) = unsafe_json_function_name(function_node, ctx) else {
        return false;
    };
    let Some(prefix) = function_name.get(.."deserialize".len()) else {
        return false;
    };
    let Some(suffix) = function_name.get("deserialize".len()..) else {
        return false;
    };
    if !prefix.eq_ignore_ascii_case("deserialize") {
        return false;
    }
    let serializer_name = format!("serialize{suffix}");
    let Some(serializer_symbol_id) = ctx
        .scoping()
        .find_binding(parse_node.scope_id(), serializer_name.as_str().into())
    else {
        return false;
    };
    let serializer_declaration = ctx.symbol_declaration(serializer_symbol_id);
    let serializer_span = match serializer_declaration.kind() {
        AstKind::Function(function) => function.span,
        AstKind::VariableDeclarator(declarator) => {
            let Some(initializer) = &declarator.init else {
                return false;
            };
            initializer.span()
        }
        _ => return false,
    };
    analysis
        .stringify_call_spans
        .iter()
        .any(|span| serializer_span.contains_inclusive(*span))
}

fn unsafe_json_enclosing_function<'a, 'ctx>(
    node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })
}

fn unsafe_json_function_name<'a, 'ctx>(
    function_node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx str> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.name.as_str());
    }
    let root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(|identifier| identifier.name.as_str())
}

fn unsafe_json_is_dominated_by_prior_parse<'a>(
    parse_node: &AstNode<'a>,
    argument: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &UnsafeJsonAnalysis,
) -> bool {
    let Expression::Identifier(identifier) = argument.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let execution_function_id = unsafe_json_nearest_function_id(parse_node.id(), ctx);
    let mut cursor_span = parse_node.span();
    for ancestor in ctx.nodes().ancestors(parse_node.id()) {
        match ancestor.kind() {
            AstKind::BlockStatement(block) => {
                let Some(statement_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(cursor_span))
                else {
                    cursor_span = ancestor.span();
                    continue;
                };
                for statement in block.body.iter().take(statement_index).rev() {
                    if unsafe_json_statement_writes_symbol(
                        statement,
                        symbol_id,
                        execution_function_id,
                        ctx,
                    ) {
                        return false;
                    }
                    if unsafe_json_statement_unconditionally_parses_symbol(
                        statement,
                        symbol_id,
                        execution_function_id,
                        ctx,
                        analysis,
                    ) {
                        return true;
                    }
                }
            }
            AstKind::Program(program) => {
                let Some(statement_index) = program
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(cursor_span))
                else {
                    return false;
                };
                for statement in program.body.iter().take(statement_index).rev() {
                    if unsafe_json_statement_writes_symbol(
                        statement,
                        symbol_id,
                        execution_function_id,
                        ctx,
                    ) {
                        return false;
                    }
                    if unsafe_json_statement_unconditionally_parses_symbol(
                        statement,
                        symbol_id,
                        execution_function_id,
                        ctx,
                        analysis,
                    ) {
                        return true;
                    }
                }
                return false;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        cursor_span = ancestor.span();
    }
    false
}

fn unsafe_json_statement_writes_symbol<'a>(
    statement: &Statement<'a>,
    symbol_id: SymbolId,
    execution_function_id: Option<NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if !statement.span().contains_inclusive(reference_node.span())
                || unsafe_json_nearest_function_id(reference.node_id(), ctx)
                    != execution_function_id
            {
                return false;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            match parent.kind() {
                AstKind::AssignmentExpression(assignment) => {
                    assignment.left.span() == reference_root.span()
                        && matches!(
                            &assignment.left,
                            oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(_)
                        )
                }
                AstKind::UpdateExpression(update) => {
                    update.argument.span() == reference_root.span()
                        && matches!(
                            &update.argument,
                            oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(_)
                        )
                }
                _ => false,
            }
        })
}

fn unsafe_json_statement_unconditionally_parses_symbol<'a>(
    statement: &Statement<'a>,
    symbol_id: SymbolId,
    execution_function_id: Option<NodeId>,
    ctx: &LintContext<'a>,
    analysis: &UnsafeJsonAnalysis,
) -> bool {
    analysis
        .parse_calls_by_symbol
        .get(&symbol_id)
        .into_iter()
        .flatten()
        .any(|candidate_id| {
            let candidate = ctx.nodes().get_node(*candidate_id);
            if !statement.span().contains_inclusive(candidate.span())
                || unsafe_json_nearest_function_id(candidate.id(), ctx) != execution_function_id
            {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            if !unsafe_json_is_global_json_method_call(call, "parse", ctx)
                || !unsafe_json_call_first_argument_is_symbol(call, symbol_id, ctx)
            {
                return false;
            }
            !unsafe_json_has_control_flow_barrier_between(candidate, statement.span(), ctx)
        })
}

fn unsafe_json_call_first_argument_is_symbol<'a>(
    call: &CallExpression<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(Expression::Identifier(identifier)) =
        call.arguments.first().and_then(Argument::as_expression)
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        == Some(symbol_id)
}

fn unsafe_json_has_control_flow_barrier_between<'a>(
    node: &AstNode<'a>,
    root_span: Span,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::CatchClause(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
        if ancestor.span() == root_span {
            return false;
        }
    }
    false
}

fn unsafe_json_is_guarded_by_validator<'a>(
    parse_node: &AstNode<'a>,
    argument: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &mut UnsafeJsonAnalysis,
) -> bool {
    let Some(source_symbol_id) = unsafe_json_validator_source_symbol(argument, ctx) else {
        return false;
    };
    let execution_boundary_id = unsafe_json_deferred_execution_boundary_id(parse_node.id(), ctx);
    let mut child_span = parse_node.span();
    for ancestor in ctx.nodes().ancestors(parse_node.id()) {
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child_span)
                    && unsafe_json_expression_guarantees_validity(
                        &statement.test,
                        true,
                        source_symbol_id,
                        ctx,
                        analysis,
                    )
                    && !unsafe_json_has_binding_write_between(
                        source_symbol_id,
                        statement.test.span().end,
                        parse_node.span().start,
                        execution_boundary_id,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::BlockStatement(block) => {
                let Some(statement_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(child_span))
                else {
                    child_span = ancestor.span();
                    continue;
                };
                for previous_statement in block.body.iter().take(statement_index) {
                    let Statement::IfStatement(previous_if) = previous_statement else {
                        continue;
                    };
                    if statement_always_exits(&previous_if.consequent)
                        && unsafe_json_expression_guarantees_validity(
                            &previous_if.test,
                            false,
                            source_symbol_id,
                            ctx,
                            analysis,
                        )
                        && !unsafe_json_has_binding_write_between(
                            source_symbol_id,
                            previous_if.test.span().end,
                            parse_node.span().start,
                            execution_boundary_id,
                            ctx,
                        )
                    {
                        return true;
                    }
                }
            }
            AstKind::Program(program) => {
                let Some(statement_index) = program
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(child_span))
                else {
                    return false;
                };
                for previous_statement in program.body.iter().take(statement_index) {
                    let Statement::IfStatement(previous_if) = previous_statement else {
                        continue;
                    };
                    if statement_always_exits(&previous_if.consequent)
                        && unsafe_json_expression_guarantees_validity(
                            &previous_if.test,
                            false,
                            source_symbol_id,
                            ctx,
                            analysis,
                        )
                        && !unsafe_json_has_binding_write_between(
                            source_symbol_id,
                            previous_if.test.span().end,
                            parse_node.span().start,
                            execution_boundary_id,
                            ctx,
                        )
                    {
                        return true;
                    }
                }
                return false;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn unsafe_json_validator_source_symbol<'a>(
    argument: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = argument.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(symbol_id);
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return Some(symbol_id);
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return Some(symbol_id);
    };
    if member.static_property_name().as_deref() != Some("replace") {
        return Some(symbol_id);
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return Some(symbol_id);
    };
    let Some(Expression::RegExpLiteral(pattern)) =
        call.arguments.first().and_then(Argument::as_expression)
    else {
        return Some(symbol_id);
    };
    let Some(Expression::StringLiteral(replacement)) =
        call.arguments.get(1).and_then(Argument::as_expression)
    else {
        return Some(symbol_id);
    };
    if pattern.regex.pattern.text.as_str() != "\\bnan\\b" || replacement.value != "null" {
        return Some(symbol_id);
    }
    ctx.scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
}

fn unsafe_json_expression_guarantees_validity<'a>(
    expression: &Expression<'a>,
    branch_runs_when_truthy: bool,
    source_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    analysis: &mut UnsafeJsonAnalysis,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            unsafe_json_expression_guarantees_validity(
                &unary.argument,
                !branch_runs_when_truthy,
                source_symbol_id,
                ctx,
                analysis,
            )
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let left = unsafe_json_expression_guarantees_validity(
                &logical.left,
                branch_runs_when_truthy,
                source_symbol_id,
                ctx,
                analysis,
            );
            let right = unsafe_json_expression_guarantees_validity(
                &logical.right,
                branch_runs_when_truthy,
                source_symbol_id,
                ctx,
                analysis,
            );
            match (logical.operator, branch_runs_when_truthy) {
                (LogicalOperator::And, true) | (LogicalOperator::Or, false) => left || right,
                (LogicalOperator::Or, true) | (LogicalOperator::And, false) => left && right,
                _ => false,
            }
        }
        expression => {
            unsafe_json_validator_call_polarity(expression, source_symbol_id, ctx, analysis)
                == Some(branch_runs_when_truthy)
        }
    }
}

fn unsafe_json_validator_call_polarity<'a>(
    expression: &Expression<'a>,
    source_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    analysis: &mut UnsafeJsonAnalysis,
) -> Option<bool> {
    if let Expression::UnaryExpression(unary) = expression.get_inner_expression()
        && unary.operator == UnaryOperator::LogicalNot
    {
        return unsafe_json_validator_call_polarity(
            &unary.argument,
            source_symbol_id,
            ctx,
            analysis,
        )
        .map(|polarity| !polarity);
    }
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return None;
    };
    if !unsafe_json_is_validator_name(callee.name.as_str())
        || !unsafe_json_call_first_argument_is_symbol(call, source_symbol_id, ctx)
    {
        return None;
    }
    let validator_id = unsafe_json_local_function_id(callee, ctx)?;
    unsafe_json_validator_safely_parses_first_parameter(validator_id, ctx, analysis).then_some(true)
}

fn unsafe_json_local_function_id<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn unsafe_json_is_validator_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let valid = name.find("valid");
    let json = name.find("json");
    matches!((valid, json), (Some(valid), Some(json)) if valid < json || json < valid)
}

fn unsafe_json_validator_safely_parses_first_parameter(
    validator_id: NodeId,
    ctx: &LintContext<'_>,
    analysis: &mut UnsafeJsonAnalysis,
) -> bool {
    if let Some(result) = analysis.validator_safety_by_function.get(&validator_id) {
        return *result;
    }
    let Some(parameter_symbol_id) = unsafe_json_first_parameter_symbol(validator_id, ctx) else {
        analysis
            .validator_safety_by_function
            .insert(validator_id, false);
        return false;
    };
    let try_node_ids = analysis
        .try_nodes_by_function
        .get(&validator_id)
        .cloned()
        .unwrap_or_default();
    let return_node_ids = analysis
        .return_nodes_by_function
        .get(&validator_id)
        .cloned()
        .unwrap_or_default();
    let result = try_node_ids.into_iter().any(|candidate_id| {
        let candidate = ctx.nodes().get_node(candidate_id);
        let AstKind::TryStatement(statement) = candidate.kind() else {
            return false;
        };
        if statement.handler.is_none() {
            return false;
        }
        let success_returns = return_node_ids
            .iter()
            .map(|return_node_id| ctx.nodes().get_node(*return_node_id))
            .filter(|return_node| {
                statement.block.span.contains_inclusive(return_node.span())
            })
            .collect::<Vec<_>>();
        let mut has_validated_success_return = false;
        let every_success_return_is_validated = success_returns.iter().all(|return_node| {
            let AstKind::ReturnStatement(return_statement) = return_node.kind() else {
                return false;
            };
            let Some(returned_value) = &return_statement.argument else {
                return false;
            };
            if matches!(returned_value.get_inner_expression(), Expression::BooleanLiteral(literal) if !literal.value)
            {
                return true;
            }
            if unsafe_json_root_unconditionally_parses_parameter(
                returned_value.span(),
                parameter_symbol_id,
                validator_id,
                ctx,
                analysis,
            ) {
                has_validated_success_return = true;
                return true;
            }
            let Some(statement_index) = statement
                .block
                .body
                .iter()
                .position(|top_level| top_level.span().contains_inclusive(return_node.span()))
            else {
                return false;
            };
            let is_dominated = statement.block.body.iter().take(statement_index).any(
                |top_level| {
                    unsafe_json_root_unconditionally_parses_parameter(
                        top_level.span(),
                        parameter_symbol_id,
                        validator_id,
                        ctx,
                        analysis,
                    )
                },
            );
            has_validated_success_return |= is_dominated;
            is_dominated
        });
        let handler = statement.handler.as_ref().unwrap();
        let catch_returns = return_node_ids
            .iter()
            .map(|return_node_id| ctx.nodes().get_node(*return_node_id))
            .filter(|return_node| {
                handler.body.span.contains_inclusive(return_node.span())
            })
            .collect::<Vec<_>>();
        has_validated_success_return
            && every_success_return_is_validated
            && !catch_returns.is_empty()
            && catch_returns.iter().all(|return_node| {
                matches!(
                    return_node.kind(),
                    AstKind::ReturnStatement(return_statement)
                        if matches!(return_statement.argument.as_ref().map(Expression::get_inner_expression), Some(Expression::BooleanLiteral(literal)) if !literal.value)
                )
            })
    });
    analysis
        .validator_safety_by_function
        .insert(validator_id, result);
    result
}

fn unsafe_json_first_parameter_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()?
            .pattern
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()?
            .pattern
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id()),
        _ => None,
    }
}

fn unsafe_json_root_unconditionally_parses_parameter(
    root_span: Span,
    parameter_symbol_id: SymbolId,
    validator_id: NodeId,
    ctx: &LintContext<'_>,
    analysis: &UnsafeJsonAnalysis,
) -> bool {
    analysis
        .parse_calls_by_symbol
        .get(&parameter_symbol_id)
        .into_iter()
        .flatten()
        .any(|candidate_id| {
            let candidate = ctx.nodes().get_node(*candidate_id);
            if !root_span.contains_inclusive(candidate.span())
                || unsafe_json_nearest_function_id(candidate.id(), ctx) != Some(validator_id)
            {
                return false;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return false;
            };
            unsafe_json_is_global_json_method_call(call, "parse", ctx)
                && unsafe_json_call_first_argument_is_symbol(call, parameter_symbol_id, ctx)
                && !unsafe_json_has_validator_control_flow_barrier_between(
                    candidate, root_span, ctx,
                )
        })
}

fn unsafe_json_has_validator_control_flow_barrier_between<'a>(
    node: &AstNode<'a>,
    root_span: Span,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::ConditionalExpression(_)
                | AstKind::IfStatement(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchStatement(_)
                | AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
        if ancestor.span() == root_span {
            return false;
        }
    }
    false
}
