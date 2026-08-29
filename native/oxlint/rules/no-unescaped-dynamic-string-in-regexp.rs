use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, CallExpression, Expression, FunctionType, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const MESSAGE: &str = "This builds a `RegExp` from a dynamic literal string without escaping it, so regex metacharacters in the value act as operators and over-match or throw. Escape the value with an `escapeRegExp` helper first.";
const INITIALIZER_RESOLUTION_HOPS: usize = 2;
const REGEXP_OBJECT_PROPERTY_NAMES: [&str; 5] =
    ["flags", "global", "source", "sticky", "lastIndex"];

#[derive(Debug, Default, Clone)]
pub struct NoUnescapedDynamicStringInRegexp;

declare_oxc_lint!(
    /// Warns when an unescaped search term or path segment is used as a RegExp pattern.
    NoUnescapedDynamicStringInRegexp,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unescaped dynamic string in RegExp constructor.",
);

impl Rule for NoUnescapedDynamicStringInRegexp {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !regexp_test_context_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let regexp_objects = build_regexp_object_index(ctx);
        for node in ctx.nodes().iter() {
            let (callee, arguments) = match node.kind() {
                AstKind::CallExpression(call) => (&call.callee, call.arguments.as_slice()),
                AstKind::NewExpression(construction) => {
                    (&construction.callee, construction.arguments.as_slice())
                }
                _ => continue,
            };
            if !is_global_regexp_callee(callee, ctx) {
                continue;
            }
            let Some(argument) = arguments.first().and_then(Argument::as_expression) else {
                continue;
            };
            if fully_literal_pattern(argument)
                || guarded_by_trusted_validator(node, argument, ctx)
                || !contains_unescaped_dynamic_literal(node, argument, &regexp_objects, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
        }
    }
}

fn regexp_test_context_file(ctx: &ContextHost<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if filename.contains(".test.") || filename.contains(".spec.") || filename.contains("__tests__")
    {
        return true;
    }
    let filename_with_leading_slash = format!("/{filename}");
    ["test", "tests", "e2e", "cypress", "playwright"]
        .iter()
        .any(|segment| filename_with_leading_slash.contains(&format!("/{segment}/")))
}

struct RegExpObjectIndex {
    symbol_ids: FxHashSet<SymbolId>,
    global_names: FxHashSet<String>,
}

fn build_regexp_object_index(ctx: &LintContext<'_>) -> RegExpObjectIndex {
    let mut symbol_ids = FxHashSet::default();
    let mut global_names = FxHashSet::default();
    for node in ctx.nodes().iter() {
        let member = match node.kind() {
            AstKind::StaticMemberExpression(member) => {
                if !REGEXP_OBJECT_PROPERTY_NAMES.contains(&member.property.name.as_str()) {
                    continue;
                }
                (&member.object, member.property.name.as_str())
            }
            _ => continue,
        };
        let Expression::Identifier(identifier) = member.0.get_inner_expression() else {
            continue;
        };
        if let Some(symbol_id) = identifier_symbol_id(identifier, ctx) {
            symbol_ids.insert(symbol_id);
        } else {
            global_names.insert(identifier.name.to_string());
        }
    }
    RegExpObjectIndex {
        symbol_ids,
        global_names,
    }
}

fn is_global_regexp_callee(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "RegExp" && ctx.is_reference_to_global_variable(identifier)
    )
}

fn fully_literal_pattern(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BigIntLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
    ) || matches!(expression.get_inner_expression(), Expression::TemplateLiteral(template) if template.expressions.is_empty())
}

fn contains_unescaped_dynamic_literal<'a>(
    construction_node: &AstNode<'a>,
    argument: &Expression<'a>,
    regexp_objects: &RegExpObjectIndex,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !argument.span().contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !(search_term_name(identifier.name.as_str())
            || identifier_is_anchored_path_segment(argument, candidate, ctx))
            || identifier_is_inside_exempt_expression(candidate, argument.span(), ctx)
            || identifier_resolves_to_escaped_value(
                identifier,
                INITIALIZER_RESOLUTION_HOPS,
                construction_node,
                regexp_objects,
                &mut FxHashSet::default(),
                ctx,
            )
            || shape_tested_by_dominating_guard(construction_node, identifier, ctx)
            || parameter_receives_only_safe_literals(identifier, ctx)
        {
            return false;
        }
        true
    })
}

fn search_term_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    if lowercase.contains("search")
        || lowercase.contains("query")
        || lowercase.contains("highlight")
        || lowercase.contains("filter")
        || lowercase.contains("keyword")
    {
        return true;
    }
    lowercase.match_indices("term").any(|(index, _)| {
        lowercase
            .as_bytes()
            .get(index + 4..index + 6)
            .is_none_or(|following| following != b"in")
    })
}

fn identifier_is_anchored_path_segment(
    argument: &Expression<'_>,
    identifier_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::IdentifierReference(identifier) = identifier_node.kind() else {
        return false;
    };
    if !path_segment_name(identifier.name.as_str()) {
        return false;
    }
    let prefix = compact_source(ctx.source_range(Span::new(
        argument.span().start,
        identifier_node.span().start,
    )));
    let suffix = compact_source(
        ctx.source_range(Span::new(identifier_node.span().end, argument.span().end)),
    );
    let prefix = prefix.trim_start_matches('(');
    let template_form = prefix == "`^${" && suffix.starts_with("}/");
    let binary_form = (prefix == "'^'+" || prefix == "\"^\"+" || prefix == "`^`+")
        && (suffix.starts_with("+'/'")
            || suffix.starts_with("+\"/\"")
            || suffix.starts_with("+`/`"));
    let concat_form =
        (prefix == "'^'.concat(" || prefix == "\"^\".concat(" || prefix == "`^`.concat(")
            && (suffix.starts_with(",'/'")
                || suffix.starts_with(",\"/\"")
                || suffix.starts_with(",`/`"));
    template_form || binary_form || concat_form
}

fn path_segment_name(name: &str) -> bool {
    let mut words = Vec::new();
    let mut current = String::new();
    for character in name.chars() {
        if character == '_' || character.is_whitespace() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current).to_ascii_lowercase());
            }
            continue;
        }
        if character.is_ascii_uppercase() && !current.is_empty() {
            words.push(std::mem::take(&mut current).to_ascii_lowercase());
        }
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current.to_ascii_lowercase());
    }
    if words
        .iter()
        .any(|word| matches!(word.as_str(), "pattern" | "regex" | "regexp"))
    {
        return false;
    }
    words
        .iter()
        .any(|word| matches!(word.as_str(), "path" | "folder" | "directory" | "root"))
        || words.iter().any(|word| word == "top") && words.iter().any(|word| word == "level")
}

fn compact_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn identifier_is_inside_exempt_expression(
    identifier_node: &AstNode<'_>,
    argument_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = identifier_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if !argument_span.contains_inclusive(parent.span()) {
            return false;
        }
        match parent.kind() {
            AstKind::CallExpression(call)
                if call_is_escaping(call, parent, &mut FxHashSet::default(), ctx)
                    || literal_returning_getter(call, ctx) =>
            {
                return true;
            }
            AstKind::StaticMemberExpression(member)
                if member.property.name == "source"
                    && member
                        .object
                        .span()
                        .contains_inclusive(identifier_node.span()) =>
            {
                return true;
            }
            AstKind::TSAsExpression(wrapper)
                if !wrapper
                    .expression
                    .span()
                    .contains_inclusive(identifier_node.span()) =>
            {
                return true;
            }
            AstKind::TSSatisfiesExpression(wrapper)
                if !wrapper
                    .expression
                    .span()
                    .contains_inclusive(identifier_node.span()) =>
            {
                return true;
            }
            AstKind::TSTypeAssertion(wrapper)
                if !wrapper
                    .expression
                    .span()
                    .contains_inclusive(identifier_node.span()) =>
            {
                return true;
            }
            AstKind::TSInstantiationExpression(wrapper)
                if !wrapper
                    .expression
                    .span()
                    .contains_inclusive(identifier_node.span()) =>
            {
                return true;
            }
            _ => {}
        }
        if parent.span() == argument_span {
            return false;
        }
        current = parent;
    }
}

fn identifier_resolves_to_escaped_value<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    remaining_hops: usize,
    construction_node: &AstNode<'a>,
    regexp_objects: &RegExpObjectIndex,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let symbol_id = identifier_symbol_id(identifier, ctx);
    if symbol_id.is_some_and(|symbol_id| {
        symbol_has_relevant_write_before(symbol_id, construction_node, ctx)
    }) {
        return false;
    }
    let lowercase = identifier.name.to_ascii_lowercase();
    if lowercase.contains("escap") || lowercase.contains("sanitiz") {
        return true;
    }
    if is_screaming_snake_constant(identifier.name.as_str()) {
        return true;
    }
    if symbol_id.map_or_else(
        || {
            regexp_objects
                .global_names
                .contains(identifier.name.as_str())
        },
        |symbol_id| regexp_objects.symbol_ids.contains(&symbol_id),
    ) {
        return true;
    }
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let result = identifier_initializer(identifier, ctx).is_some_and(|initializer| {
        expression_resolves_to_escaped_value(
            initializer,
            remaining_hops,
            construction_node,
            regexp_objects,
            visited_symbols,
            ctx,
        )
    });
    visited_symbols.remove(&symbol_id);
    result
}

fn expression_resolves_to_escaped_value<'a>(
    expression: &Expression<'a>,
    remaining_hops: usize,
    construction_node: &AstNode<'a>,
    regexp_objects: &RegExpObjectIndex,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if fully_literal_pattern(expression) {
        return true;
    }
    match expression {
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .all(|element| element.as_expression().is_some_and(fully_literal_pattern)),
        Expression::CallExpression(call) => {
            let call_node = ctx.nodes().get_node(call.node_id.get());
            call_is_escaping(call, call_node, visited_symbols, ctx)
        }
        Expression::Identifier(identifier) if remaining_hops > 0 => {
            identifier_resolves_to_escaped_value(
                identifier,
                remaining_hops - 1,
                construction_node,
                regexp_objects,
                visited_symbols,
                ctx,
            )
        }
        Expression::ConditionalExpression(conditional) if remaining_hops > 0 => {
            [&conditional.consequent, &conditional.alternate]
                .into_iter()
                .all(|branch| {
                    expression_resolves_to_escaped_value(
                        branch,
                        remaining_hops,
                        construction_node,
                        regexp_objects,
                        visited_symbols,
                        ctx,
                    )
                })
        }
        Expression::BinaryExpression(binary) if remaining_hops > 0 => {
            [&binary.left, &binary.right].into_iter().all(|operand| {
                expression_resolves_to_escaped_value(
                    operand,
                    remaining_hops,
                    construction_node,
                    regexp_objects,
                    visited_symbols,
                    ctx,
                )
            })
        }
        Expression::LogicalExpression(logical) if remaining_hops > 0 => {
            [&logical.left, &logical.right].into_iter().all(|operand| {
                expression_resolves_to_escaped_value(
                    operand,
                    remaining_hops,
                    construction_node,
                    regexp_objects,
                    visited_symbols,
                    ctx,
                )
            })
        }
        Expression::TemplateLiteral(template) if remaining_hops > 0 => {
            template.expressions.iter().all(|expression| {
                expression_resolves_to_escaped_value(
                    expression,
                    remaining_hops,
                    construction_node,
                    regexp_objects,
                    visited_symbols,
                    ctx,
                )
            })
        }
        _ if remaining_hops > 0 => composite_leaves_resolve_escaped(
            expression,
            remaining_hops,
            construction_node,
            regexp_objects,
            visited_symbols,
            ctx,
        ),
        _ => false,
    }
}

fn composite_leaves_resolve_escaped<'a>(
    expression: &Expression<'a>,
    remaining_hops: usize,
    construction_node: &AstNode<'a>,
    regexp_objects: &RegExpObjectIndex,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut resolved_any = false;
    for node in ctx.nodes().iter() {
        if !expression.span().contains_inclusive(node.span()) {
            continue;
        }
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            continue;
        };
        if identifier_is_inside_exempt_expression(node, expression.span(), ctx) {
            resolved_any = true;
            continue;
        }
        if identifier_resolves_to_escaped_value(
            identifier,
            remaining_hops.saturating_sub(1),
            construction_node,
            regexp_objects,
            visited_symbols,
            ctx,
        ) {
            resolved_any = true;
        } else if search_term_name(identifier.name.as_str()) {
            return false;
        }
    }
    resolved_any
}

fn identifier_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn symbol_has_relevant_write_before<'a>(
    symbol_id: SymbolId,
    construction_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let construction_owner =
        crate::ast_util::get_enclosing_function(construction_node, ctx).map(AstNode::id);
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if !reference.is_write() {
                return false;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            reference_node.span().start < construction_node.span().start
                && crate::ast_util::get_enclosing_function(reference_node, ctx).map(AstNode::id)
                    == construction_owner
        })
}

fn is_screaming_snake_constant(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_uppercase())
        && characters.all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
}

fn call_is_escaping<'a>(
    call: &CallExpression<'a>,
    call_node: &AstNode<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        if escape_helper_name(identifier.name.as_str()) {
            return true;
        }
        if let Some(import) = resolve_identifier_import(identifier, ctx)
            && matches!(&import.import_name, ImportImportName::Name(imported) if escape_helper_name(imported.name()))
        {
            return true;
        }
        if let Some(symbol_id) = identifier_symbol_id(identifier, ctx) {
            return local_helper_escapes(symbol_id, call_node, visited_symbols, ctx);
        }
    }
    if let Some(member) = callee.as_member_expression() {
        let property_name = static_member_expression_property_name(member);
        if property_name == Some("escape")
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "RegExp" && ctx.is_reference_to_global_variable(identifier))
        {
            return true;
        }
        if matches!(property_name, Some("replace" | "replaceAll")) && call_is_mdn_escape(call) {
            return true;
        }
        if property_name == Some("join")
            && literal_collection_expression(member.object(), &mut FxHashSet::default(), ctx)
        {
            return true;
        }
        if property_name == Some("map") && map_call_escapes(call, ctx) {
            return true;
        }
    }
    false
}

fn literal_collection_expression<'a>(
    expression: &Expression<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array
            .elements
            .iter()
            .all(|element| element.as_expression().is_some_and(fully_literal_pattern)),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = identifier_symbol_id(identifier, ctx) else {
                return false;
            };
            if !visited_symbols.insert(symbol_id) {
                return false;
            }
            let result = identifier_initializer(identifier, ctx).is_some_and(|initializer| {
                literal_collection_expression(initializer, visited_symbols, ctx)
            });
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::CallExpression(call) => call
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                static_member_expression_property_name(member) == Some("filter")
                    && literal_collection_expression(member.object(), visited_symbols, ctx)
            }),
        _ => false,
    }
}

fn escape_helper_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    lowercase
        .find("escape")
        .is_some_and(|index| lowercase[index + 6..].contains("reg"))
        || lowercase
            .find("safe")
            .is_some_and(|index| lowercase[index + 4..].contains("reg"))
}

fn call_is_mdn_escape(call: &CallExpression<'_>) -> bool {
    let Some(Expression::RegExpLiteral(pattern)) =
        call.arguments.first().and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some(Expression::StringLiteral(replacement)) =
        call.arguments.get(1).and_then(Argument::as_expression)
    else {
        return false;
    };
    let pattern = pattern.regex.pattern.text.as_str();
    replacement.value == "\\$&"
        && pattern.contains('\\')
        && [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|"]
            .iter()
            .all(|character| pattern.contains(character))
}

fn map_call_escapes(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(mapper) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    match mapper.get_inner_expression() {
        Expression::Identifier(identifier) => escape_helper_name(identifier.name.as_str()),
        expression if expression.as_member_expression().is_some() => {
            let member = expression.as_member_expression().expect("checked member");
            static_member_expression_property_name(member) == Some("escape")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "RegExp" && ctx.is_reference_to_global_variable(identifier))
        }
        Expression::ArrowFunctionExpression(function) => {
            let function_node = ctx.nodes().get_node(function.node_id.get());
            first_parameter_symbol_id(function_node).is_some_and(|parameter_symbol_id| {
                helper_returns_are_escaped(
                    function_node,
                    parameter_symbol_id,
                    function_node,
                    &mut FxHashSet::default(),
                    ctx,
                )
            })
        }
        Expression::FunctionExpression(function) => {
            let function_node = ctx.nodes().get_node(function.node_id.get());
            first_parameter_symbol_id(function_node).is_some_and(|parameter_symbol_id| {
                helper_returns_are_escaped(
                    function_node,
                    parameter_symbol_id,
                    function_node,
                    &mut FxHashSet::default(),
                    ctx,
                )
            })
        }
        _ => false,
    }
}

fn local_helper_escapes<'a>(
    symbol_id: SymbolId,
    call_node: &AstNode<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = match declaration.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            Some(declaration)
        }
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().and_then(|initializer| {
                match initializer.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => {
                        Some(ctx.nodes().get_node(function.node_id.get()))
                    }
                    Expression::FunctionExpression(function) => {
                        Some(ctx.nodes().get_node(function.node_id.get()))
                    }
                    _ => None,
                }
            })
        }
        _ => None,
    };
    let Some(function_node) = function_node else {
        visited_symbols.remove(&symbol_id);
        return false;
    };
    let parameter_symbol_id = first_parameter_symbol_id(function_node);
    let result = parameter_symbol_id.is_some_and(|parameter_symbol_id| {
        helper_returns_are_escaped(
            function_node,
            parameter_symbol_id,
            call_node,
            visited_symbols,
            ctx,
        )
    });
    visited_symbols.remove(&symbol_id);
    result
}

fn first_parameter_symbol_id(function_node: &AstNode<'_>) -> Option<SymbolId> {
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    }?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(identifier.symbol_id())
}

fn helper_returns_are_escaped<'a>(
    function_node: &AstNode<'a>,
    parameter_symbol_id: SymbolId,
    call_node: &AstNode<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return returned_expression_is_escaped(
            expression,
            parameter_symbol_id,
            call_node,
            visited_symbols,
            ctx,
        );
    }
    let returns = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            if !function_node.span().contains_inclusive(candidate.span())
                || crate::ast_util::get_enclosing_function(candidate, ctx).map(AstNode::id)
                    != Some(function_node.id())
            {
                return None;
            }
            statement.argument.as_ref()
        })
        .collect::<Vec<_>>();
    !returns.is_empty()
        && returns.iter().all(|expression| {
            returned_expression_is_escaped(
                expression,
                parameter_symbol_id,
                call_node,
                visited_symbols,
                ctx,
            )
        })
}

fn returned_expression_is_escaped<'a>(
    expression: &Expression<'a>,
    parameter_symbol_id: SymbolId,
    call_node: &AstNode<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    if fully_literal_pattern(expression) {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if identifier_symbol_id(identifier, ctx) == Some(parameter_symbol_id) {
                return false;
            }
            identifier_initializer(identifier, ctx).is_some_and(|initializer| {
                returned_expression_is_escaped(
                    initializer,
                    parameter_symbol_id,
                    call_node,
                    visited_symbols,
                    ctx,
                )
            })
        }
        Expression::CallExpression(call) => {
            let nested_node = ctx.nodes().get_node(call.node_id.get());
            call_is_escaping(call, nested_node, visited_symbols, ctx)
        }
        Expression::BinaryExpression(binary) => {
            [&binary.left, &binary.right].into_iter().all(|operand| {
                returned_expression_is_escaped(
                    operand,
                    parameter_symbol_id,
                    call_node,
                    visited_symbols,
                    ctx,
                )
            })
        }
        Expression::LogicalExpression(logical) => {
            [&logical.left, &logical.right].into_iter().all(|operand| {
                returned_expression_is_escaped(
                    operand,
                    parameter_symbol_id,
                    call_node,
                    visited_symbols,
                    ctx,
                )
            })
        }
        Expression::ConditionalExpression(conditional) => {
            [&conditional.consequent, &conditional.alternate]
                .into_iter()
                .all(|branch| {
                    returned_expression_is_escaped(
                        branch,
                        parameter_symbol_id,
                        call_node,
                        visited_symbols,
                        ctx,
                    )
                })
        }
        Expression::TemplateLiteral(template) => template.expressions.iter().all(|expression| {
            returned_expression_is_escaped(
                expression,
                parameter_symbol_id,
                call_node,
                visited_symbols,
                ctx,
            )
        }),
        _ => false,
    }
}

fn literal_returning_getter<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(initializer) = identifier_initializer(identifier, ctx) else {
        return false;
    };
    let function_node = match initializer.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            ctx.nodes().get_node(function.node_id.get())
        }
        Expression::FunctionExpression(function) => ctx.nodes().get_node(function.node_id.get()),
        _ => return false,
    };
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && function.get_expression().is_some()
    {
        return function.get_expression().is_some_and(fully_literal_pattern);
    }
    let mut saw_return = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if !function_node.span().contains_inclusive(candidate.span()) {
            continue;
        }
        let Some(argument) = &statement.argument else {
            continue;
        };
        saw_return = true;
        if !fully_literal_pattern(argument) {
            return false;
        }
    }
    saw_return
}

fn guarded_by_trusted_validator<'a>(
    construction_node: &AstNode<'a>,
    argument: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child = construction_node;
    for ancestor in ctx.nodes().ancestors(construction_node.id()) {
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && statement.consequent.span().contains_inclusive(child.span())
            && trusted_validator_polarity(&statement.test, argument, ctx) == Some(true)
            && !trusted_validator_argument_written_between(
                argument,
                statement.test.span().end,
                construction_node.span().start,
                ctx,
            )
        {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::BlockStatement(_) | AstKind::Program(_)
        ) {
            for candidate in ctx.nodes().iter() {
                let AstKind::IfStatement(statement) = candidate.kind() else {
                    continue;
                };
                if ctx.nodes().parent_node(candidate.id()).id() == ancestor.id()
                    && candidate.span().end <= construction_node.span().start
                    && directly_exits(&statement.consequent)
                    && trusted_validator_polarity(&statement.test, argument, ctx) == Some(false)
                    && !trusted_validator_argument_written_between(
                        argument,
                        statement.test.span().end,
                        construction_node.span().start,
                        ctx,
                    )
                {
                    return true;
                }
            }
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        child = ancestor;
    }
    false
}

fn normalized_validation_expression<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    let inner = expression.get_inner_expression();
    if let Expression::LogicalExpression(logical) = inner
        && matches!(
            logical.operator,
            LogicalOperator::Coalesce | LogicalOperator::Or
        )
        && get_static_string_expression(&logical.right) == Some("")
    {
        return logical.left.get_inner_expression();
    }
    inner
}

fn trusted_validator_argument_written_between(
    argument: &Expression<'_>,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = normalized_validation_expression(argument) else {
        return false;
    };
    identifier_written_between(identifier, start, end, ctx)
}

fn trusted_validator_polarity<'a>(
    test: &Expression<'a>,
    constructed_argument: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    match test.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            trusted_validator_polarity(&unary.argument, constructed_argument, ctx)
                .map(|value| !value)
        }
        Expression::Identifier(identifier) => {
            identifier_initializer(identifier, ctx).and_then(|initializer| {
                trusted_validator_polarity(initializer, constructed_argument, ctx)
            })
        }
        Expression::CallExpression(call) => {
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return None;
            };
            let import = resolve_identifier_import(identifier, ctx)?;
            if import.module_request.name() != "lib/utils/regexp"
                || !matches!(&import.import_name, ImportImportName::Name(imported) if imported.name() == "isValidRegexp")
            {
                return None;
            }
            let validated_argument = call.arguments.first().and_then(Argument::as_expression)?;
            (normalized_validation_source(validated_argument, ctx)
                == normalized_validation_source(constructed_argument, ctx))
            .then_some(true)
        }
        _ => None,
    }
}

fn normalized_validation_source(expression: &Expression<'_>, ctx: &LintContext<'_>) -> String {
    let source = compact_source(ctx.source_range(expression.span()));
    source
        .strip_suffix("??\"\"")
        .or_else(|| source.strip_suffix("||\"\""))
        .or_else(|| source.strip_suffix("??''"))
        .or_else(|| source.strip_suffix("||''"))
        .unwrap_or(&source)
        .trim_matches('(')
        .trim_matches(')')
        .to_string()
}

fn shape_tested_by_dominating_guard<'a>(
    construction_node: &AstNode<'a>,
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child = construction_node;
    for ancestor in ctx.nodes().ancestors(construction_node.id()) {
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && statement.consequent.span().contains_inclusive(child.span())
            && safe_shape_guard_polarity(&statement.test, identifier, ctx) == Some(true)
            && !identifier_written_between(
                identifier,
                statement.test.span().end,
                construction_node.span().start,
                ctx,
            )
        {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::BlockStatement(_) | AstKind::Program(_)
        ) {
            for candidate in ctx.nodes().iter() {
                let AstKind::IfStatement(statement) = candidate.kind() else {
                    continue;
                };
                if ctx.nodes().parent_node(candidate.id()).id() == ancestor.id()
                    && candidate.span().end <= construction_node.span().start
                    && directly_exits(&statement.consequent)
                    && safe_shape_guard_polarity(&statement.test, identifier, ctx) == Some(false)
                    && !identifier_written_between(
                        identifier,
                        candidate.span().end,
                        construction_node.span().start,
                        ctx,
                    )
                {
                    return true;
                }
            }
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        child = ancestor;
    }
    false
}

fn safe_shape_guard_polarity(
    expression: &Expression<'_>,
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            safe_shape_guard_polarity(&unary.argument, identifier, ctx).map(|value| !value)
        }
        Expression::CallExpression(call) => {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            if static_member_expression_property_name(member) != Some("test") {
                return None;
            }
            let Expression::RegExpLiteral(regex) = member.object().get_inner_expression() else {
                return None;
            };
            if !safe_character_class_pattern(regex.regex.pattern.text.as_str()) {
                return None;
            }
            let guarded = call.arguments.first().and_then(Argument::as_expression)?;
            let Expression::Identifier(guarded_identifier) = guarded.get_inner_expression() else {
                return None;
            };
            let guarded_symbol = identifier_symbol_id(guarded_identifier, ctx);
            let constructed_symbol = identifier_symbol_id(identifier, ctx);
            if let Some(guarded_symbol) = guarded_symbol {
                (Some(guarded_symbol) == constructed_symbol).then_some(true)
            } else {
                (constructed_symbol.is_none() && guarded_identifier.name == identifier.name)
                    .then_some(true)
            }
        }
        _ => None,
    }
}

fn safe_character_class_pattern(pattern: &str) -> bool {
    if !pattern.starts_with("^[") || !(pattern.ends_with("]*$") || pattern.ends_with("]+$")) {
        return false;
    }
    let class = &pattern[2..pattern.len() - 3];
    if class.starts_with('^') {
        return false;
    }
    let mut remainder = class
        .replace("A-Z", "")
        .replace("a-z", "")
        .replace("0-9", "")
        .replace("\\d", "")
        .replace("\\s", "")
        .replace("\\w", "");
    remainder.retain(|character| {
        !character.is_ascii_alphanumeric()
            && !matches!(character, '_' | ' ' | '#' | ',' | ':' | '/' | '-')
    });
    remainder.is_empty()
}

fn identifier_written_between(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    start: u32,
    end: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let identifier_node = ctx.nodes().get_node(identifier.node_id());
    let owner = crate::ast_util::get_enclosing_function(identifier_node, ctx).map(AstNode::id);
    identifier_symbol_id(identifier, ctx).is_some_and(|symbol_id| {
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                reference.is_write()
                    && reference_node.span().start > start
                    && reference_node.span().end < end
                    && crate::ast_util::get_enclosing_function(reference_node, ctx).map(AstNode::id)
                        == owner
            })
    })
}

fn parameter_receives_only_safe_literals(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(parameter_symbol_id) = identifier_symbol_id(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(parameter_symbol_id);
    let Some(function_node) = crate::ast_util::get_enclosing_function(declaration, ctx) else {
        return false;
    };
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return false,
    };
    let Some(parameter_index) = parameters.iter().position(|parameter| {
        parameter
            .pattern
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == parameter_symbol_id)
    }) else {
        return false;
    };
    let function_symbol_id = match function_node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(function_node.id());
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
    let Some(function_symbol_id) = function_symbol_id else {
        return false;
    };
    if ctx.nodes().ancestors(function_node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
        )
    }) {
        return false;
    }
    let mut saw_call = false;
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if call.callee.span() != reference_node.span() {
            return false;
        }
        let Some(argument) = call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        let Some(value) = get_static_string_expression(argument) else {
            return false;
        };
        if value
            .chars()
            .any(|character| "\\^$.*+?()[]{}|".contains(character))
        {
            return false;
        }
        saw_call = true;
    }
    saw_call
}

fn directly_exits(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => matches!(
            block.body.last(),
            Some(Statement::ReturnStatement(_) | Statement::ThrowStatement(_))
        ),
        _ => false,
    }
}
