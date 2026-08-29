use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, CallExpression, Expression,
        MemberExpression, ObjectPropertyKind, PropertyKey, PropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This is O(n²) because spreading the accumulator copies the entire growing collection every step. Mutate and return the accumulator instead (acc[key] = value; return acc).";
const NON_GROWING_ARRAY_METHODS: [&str; 10] = [
    "copyWithin",
    "fill",
    "filter",
    "map",
    "reverse",
    "slice",
    "sort",
    "toReversed",
    "toSorted",
    "with",
];
const NON_GROWING_ARRAY_RECEIVER_METHODS: &[&str] = &[
    "at",
    "concat",
    "copyWithin",
    "entries",
    "every",
    "fill",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flat",
    "flatMap",
    "forEach",
    "includes",
    "indexOf",
    "join",
    "keys",
    "lastIndexOf",
    "map",
    "pop",
    "reduce",
    "reduceRight",
    "reverse",
    "shift",
    "slice",
    "some",
    "sort",
    "toLocaleString",
    "toReversed",
    "toSorted",
    "toSpliced",
    "toString",
    "values",
    "with",
];

#[derive(Debug, Default, Clone)]
pub struct NoSpreadAccumulatorInReduce;

declare_oxc_lint!(
    /// Warns when a reduce callback repeatedly spreads a growing accumulator.
    NoSpreadAccumulatorInReduce,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns about quadratic accumulator spreads in reduce callbacks.",
);

impl Rule for NoSpreadAccumulatorInReduce {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(reduce_call) = node.kind() else {
            return;
        };
        let Some(member) = reduce_call
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return;
        };
        let Some(method_name @ ("reduce" | "reduceRight")) = member.static_property_name() else {
            return;
        };
        if source_has_own_reducer_method(member.object(), method_name, ctx)
            || !reduce_call
                .arguments
                .get(1)
                .and_then(Argument::as_expression)
                .is_some_and(is_fresh_literal_seed)
        {
            return;
        }
        let mut growth_cache = FxHashMap::default();
        if is_statically_bounded_reduce_source(member.object(), ctx, &mut growth_cache) {
            return;
        }
        let Some(callback) = reduce_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let (callback_node_id, accumulator) = match callback {
            Expression::ArrowFunctionExpression(function) if !function.r#async => {
                let Some(parameter) = function.params.items.first() else {
                    return;
                };
                let BindingPattern::BindingIdentifier(accumulator) = &parameter.pattern else {
                    return;
                };
                (function.node_id.get(), accumulator)
            }
            Expression::FunctionExpression(function)
                if !function.r#async && !function.generator =>
            {
                let Some(parameter) = function.params.items.first() else {
                    return;
                };
                let BindingPattern::BindingIdentifier(accumulator) = &parameter.pattern else {
                    return;
                };
                (function.node_id.get(), accumulator)
            }
            _ => return,
        };
        let callback_node = ctx.nodes().get_node(callback_node_id);
        let returned_literals = reducer_returned_literals(callback, callback_node, ctx);
        if let Some(literal) = returned_literals.into_iter().find(|literal| {
            literal_spreads_accumulator(literal, accumulator.symbol_id(), ctx)
                && literal_grows_accumulator(literal, accumulator.symbol_id(), ctx)
        }) {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(literal.span()));
        }
    }
}

fn is_fresh_literal_seed(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
    )
}

fn source_has_own_reducer_method(
    source: &Expression<'_>,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let mut candidate = source.get_inner_expression();
    let mut visited = FxHashSet::default();
    while let Expression::Identifier(identifier) = candidate {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited.insert(symbol_id) {
            return false;
        }
        let Some(initializer) = const_symbol_initializer(symbol_id, ctx) else {
            return false;
        };
        candidate = initializer.get_inner_expression();
    }
    let Expression::ObjectExpression(object) = candidate else {
        return false;
    };
    object.properties.iter().any(|property| {
        matches!(
            property,
            ObjectPropertyKind::ObjectProperty(property)
                if static_property_key_name(&property.key, property.computed).as_deref() == Some(method_name)
        )
    })
}

fn is_statically_bounded_reduce_source(
    source: &Expression<'_>,
    ctx: &LintContext<'_>,
    growth_cache: &mut FxHashMap<SymbolId, bool>,
) -> bool {
    if is_statically_bounded_collection(
        source,
        CollectionKind::Array,
        ctx,
        growth_cache,
        &mut FxHashSet::default(),
    ) {
        return true;
    }
    let Expression::CallExpression(call) = source.get_inner_expression() else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if !is_global_identifier(member.object(), "Object", ctx)
        || !matches!(
            member.static_property_name(),
            Some("keys" | "entries" | "values")
        )
    {
        return false;
    }
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|object| {
            is_statically_bounded_collection(
                object,
                CollectionKind::Object,
                ctx,
                growth_cache,
                &mut FxHashSet::default(),
            )
        })
}

#[derive(Clone, Copy)]
enum CollectionKind {
    Array,
    Object,
}

fn is_statically_bounded_collection(
    expression: &Expression<'_>,
    kind: CollectionKind,
    ctx: &LintContext<'_>,
    growth_cache: &mut FxHashMap<SymbolId, bool>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ArrayExpression(array) if matches!(kind, CollectionKind::Array) => array
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_))),
        Expression::ObjectExpression(object) if matches!(kind, CollectionKind::Object) => object
            .properties
            .iter()
            .all(|property| !matches!(property, ObjectPropertyKind::SpreadProperty(_))),
        Expression::ObjectExpression(object) if matches!(kind, CollectionKind::Array) => {
            fixed_array_like_object(object)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited.contains(&symbol_id)
                || binding_may_have_grown(symbol_id, ctx, growth_cache, &mut FxHashSet::default())
            {
                return false;
            }
            if binding_is_rest_parameter(symbol_id, ctx) {
                return true;
            }
            let Some(initializer) = const_symbol_initializer(symbol_id, ctx) else {
                return false;
            };
            visited.insert(symbol_id);
            let result =
                is_statically_bounded_collection(initializer, kind, ctx, growth_cache, visited);
            visited.remove(&symbol_id);
            result
        }
        Expression::ConditionalExpression(conditional) => {
            let mut alternate_visited = visited.clone();
            is_statically_bounded_collection(
                &conditional.consequent,
                kind,
                ctx,
                growth_cache,
                visited,
            ) && is_statically_bounded_collection(
                &conditional.alternate,
                kind,
                ctx,
                growth_cache,
                &mut alternate_visited,
            )
        }
        Expression::CallExpression(call) if matches!(kind, CollectionKind::Array) => {
            if is_fixed_length_array_call(call, ctx) {
                return true;
            }
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            if is_global_identifier(member.object(), "Array", ctx)
                && member.static_property_name() == Some("from")
            {
                return call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|source| {
                        is_statically_bounded_collection(source, kind, ctx, growth_cache, visited)
                    });
            }
            member.static_property_name().is_some_and(|method_name| {
                NON_GROWING_ARRAY_METHODS.contains(&method_name)
                    && is_statically_bounded_collection(
                        member.object(),
                        kind,
                        ctx,
                        growth_cache,
                        visited,
                    )
            })
        }
        Expression::NewExpression(construction) if matches!(kind, CollectionKind::Array) => {
            construction.arguments.len() == 1
                && is_global_identifier(&construction.callee, "Array", ctx)
                && matches!(
                    construction
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .map(Expression::get_inner_expression),
                    Some(Expression::NumericLiteral(_))
                )
        }
        _ => false,
    }
}

fn is_fixed_length_array_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    call.arguments.len() == 1
        && is_global_identifier(&call.callee, "Array", ctx)
        && matches!(
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::NumericLiteral(_))
        )
}

fn fixed_array_like_object(object: &oxc_ast::ast::ObjectExpression<'_>) -> bool {
    if object
        .properties
        .iter()
        .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
    {
        return false;
    }
    let mut lengths = object.properties.iter().filter_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.kind == PropertyKind::Init
            && static_property_key_name(&property.key, property.computed).as_deref()
                == Some("length"))
        .then_some(property.value.get_inner_expression())
    });
    matches!(lengths.next(), Some(Expression::NumericLiteral(_))) && lengths.next().is_none()
}

fn const_symbol_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        )
    {
        return None;
    }
    declarator.init.as_ref()
}

fn binding_is_rest_parameter(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::FormalParameterRest(parameter) => parameter
            .rest
            .argument
            .get_binding_identifier()
            .is_some_and(|identifier| identifier.symbol_id() == symbol_id),
        _ => false,
    }
}

fn binding_may_have_grown(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    cache: &mut FxHashMap<SymbolId, bool>,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Some(result) = cache.get(&symbol_id) {
        return *result;
    }
    if !visited.insert(symbol_id) {
        return false;
    }
    let did_grow = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if let Some(alias_symbol_id) = retaining_alias_symbol(reference_node, symbol_id, ctx)
                && alias_symbol_id != symbol_id
            {
                return binding_may_have_grown(alias_symbol_id, ctx, cache, visited);
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if let AstKind::CallExpression(call) = parent.kind()
                && call.arguments.iter().any(|argument| {
                    argument
                        .as_expression()
                        .is_some_and(|expression| expression.span() == reference_root.span())
                })
            {
                if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
                    if is_global_identifier(member.object(), "Object", ctx)
                        && matches!(
                            member.static_property_name(),
                            Some("assign" | "defineProperties" | "defineProperty")
                        )
                    {
                        return true;
                    }
                    if (is_global_identifier(member.object(), "Array", ctx)
                        && member.static_property_name() == Some("from"))
                        || (is_global_identifier(member.object(), "Object", ctx)
                            && matches!(
                                member.static_property_name(),
                                Some("keys" | "entries" | "values")
                            ))
                    {
                        return false;
                    }
                    if call_resolves_to_empty_local_member_function(call, ctx) {
                        return false;
                    }
                }
                return true;
            }
            if matches!(
                parent.kind(),
                AstKind::ObjectProperty(property) if property.value.span() == reference_root.span()
            ) || matches!(
                parent.kind(),
                AstKind::ArrayExpression(_) | AstKind::SpreadElement(_)
            ) {
                return true;
            }
            let Some(member_object) = ast_member_object(parent) else {
                return false;
            };
            if member_object.span() != reference_root.span() {
                return false;
            }
            let member_name = ast_member_static_name(parent);
            let member_root = transparent_expression_root(parent, ctx);
            let consumer = ctx.nodes().parent_node(member_root.id());
            match consumer.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == member_root.span() =>
                {
                    true
                }
                AstKind::UpdateExpression(update)
                    if update.argument.span() == member_root.span() =>
                {
                    true
                }
                AstKind::UnaryExpression(unary)
                    if unary.operator == UnaryOperator::Delete
                        && unary.argument.span() == member_root.span() =>
                {
                    true
                }
                AstKind::CallExpression(call) if call.callee.span() == member_root.span() => {
                    member_name.as_deref().is_none_or(|method_name| {
                        !NON_GROWING_ARRAY_RECEIVER_METHODS.contains(&method_name)
                    })
                }
                _ => false,
            }
        });
    visited.remove(&symbol_id);
    cache.insert(symbol_id, did_grow);
    did_grow
}

fn call_resolves_to_empty_local_member_function(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = resolved_member_name(member, ctx) else {
        return false;
    };
    let (object, object_symbol_id) = match member.object().get_inner_expression() {
        Expression::ObjectExpression(object) => (object, None),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let Some(initializer) = const_symbol_initializer(symbol_id, ctx) else {
                return false;
            };
            let Expression::ObjectExpression(object) = initializer.get_inner_expression() else {
                return false;
            };
            (object, Some(symbol_id))
        }
        _ => return false,
    };
    if object_symbol_id.is_some_and(|symbol_id| {
        object_member_may_be_reassigned(symbol_id, method_name.as_str(), ctx)
    }) {
        return false;
    }
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if resolved_property_key_name(&property.key, property.computed, ctx).as_deref()
            != Some(method_name.as_str())
        {
            return false;
        }
        match property.value.get_inner_expression() {
            Expression::FunctionExpression(function) => function
                .body
                .as_ref()
                .is_some_and(|body| body.directives.is_empty() && body.statements.is_empty()),
            Expression::ArrowFunctionExpression(function) => function
                .get_function_body()
                .is_some_and(|body| body.directives.is_empty() && body.statements.is_empty()),
            _ => false,
        }
    })
}

fn object_member_may_be_reassigned(
    object_symbol_id: SymbolId,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(object_symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some(member_object) = ast_member_object(member_node) else {
                return false;
            };
            if member_object.span() != reference_root.span()
                || resolved_ast_member_name(member_node, ctx).as_deref() != Some(method_name)
            {
                return false;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            matches!(
                ctx.nodes().parent_node(member_root.id()).kind(),
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == member_root.span()
            )
        })
}

fn ast_member_object<'a>(node: &AstNode<'a>) -> Option<&'a Expression<'a>> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some(&member.object),
        AstKind::ComputedMemberExpression(member) => Some(&member.object),
        AstKind::PrivateFieldExpression(member) => Some(&member.object),
        _ => None,
    }
}

fn ast_member_static_name(node: &AstNode<'_>) -> Option<String> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        AstKind::ComputedMemberExpression(member) => {
            member.static_property_name().map(|name| name.to_string())
        }
        _ => None,
    }
}

fn resolved_ast_member_name(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        AstKind::ComputedMemberExpression(member) => member
            .static_property_name()
            .map(|name| name.to_string())
            .or_else(|| {
                resolve_static_string_expression(&member.expression, ctx, &mut FxHashSet::default())
            }),
        _ => None,
    }
}

fn resolved_member_name(member: &MemberExpression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    if let Some(name) = member.static_property_name() {
        return Some(name.to_string());
    }
    let MemberExpression::ComputedMemberExpression(computed) = member else {
        return None;
    };
    resolve_static_string_expression(&computed.expression, ctx, &mut FxHashSet::default())
}

fn resolved_property_key_name(
    key: &PropertyKey<'_>,
    computed: bool,
    ctx: &LintContext<'_>,
) -> Option<String> {
    static_property_key_name(key, computed).or_else(|| {
        let PropertyKey::Identifier(identifier) = key else {
            return None;
        };
        resolve_static_string_identifier(identifier, ctx, &mut FxHashSet::default())
    })
}

fn resolve_static_string_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        Expression::Identifier(identifier) => {
            resolve_static_string_identifier(identifier, ctx, visited)
        }
        _ => None,
    }
}

fn resolve_static_string_identifier(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited.insert(symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    resolve_static_string_expression(const_symbol_initializer(symbol_id, ctx)?, ctx, visited)
}

fn retaining_alias_symbol<'a>(
    reference_node: &AstNode<'a>,
    source_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut current = transparent_expression_root(reference_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::ConditionalExpression(conditional)
                if conditional.consequent.span() == current.span()
                    || conditional.alternate.span() == current.span() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::LogicalExpression(logical)
                if logical.left.span() == current.span()
                    || logical.right.span() == current.span() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == current.span()) =>
            {
                let binding = declarator.id.get_binding_identifier()?;
                return (binding.symbol_id() != source_symbol_id).then_some(binding.symbol_id());
            }
            _ => return None,
        }
    }
}

fn reducer_returned_literals<'a>(
    callback: &'a Expression<'a>,
    callback_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    if let Expression::ArrowFunctionExpression(arrow) = callback
        && let Some(expression) = arrow.get_expression()
    {
        let mut literals = Vec::new();
        record_returned_literals(
            expression,
            callback_accumulator_symbol(callback),
            ctx,
            &mut literals,
        );
        return literals;
    }
    let accumulator_symbol_id = callback_accumulator_symbol(callback);
    let callback_span = callback.span();
    let mut literals = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if !callback_span.contains_inclusive(candidate.span())
            || !return_belongs_to_callback(candidate, callback_node.id(), ctx)
            || !is_node_reachable_within_function(candidate, callback_node, ctx)
            || return_preceded_by_unconditional_exit(candidate, callback_node, ctx)
        {
            continue;
        }
        if let Some(argument) = &return_statement.argument {
            record_returned_literals(argument, accumulator_symbol_id, ctx, &mut literals);
        }
    }
    literals
}

fn callback_accumulator_symbol(callback: &Expression<'_>) -> Option<SymbolId> {
    let parameters = match callback {
        Expression::ArrowFunctionExpression(function) => &function.params,
        Expression::FunctionExpression(function) => &function.params,
        _ => return None,
    };
    parameters
        .items
        .first()?
        .pattern
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
}

fn return_belongs_to_callback(
    return_node: &AstNode<'_>,
    callback_node_id: oxc_syntax::node::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(return_node.id()) {
        if ancestor.id() == callback_node_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn return_preceded_by_unconditional_exit(
    return_node: &AstNode<'_>,
    callback_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current_span = return_node.span();
    for ancestor in ctx.nodes().ancestors(return_node.id()) {
        if ancestor.id() == callback_node.id() {
            break;
        }
        if let AstKind::BlockStatement(block) = ancestor.kind()
            && let Some(index) = block
                .body
                .iter()
                .position(|statement| statement.span().contains_inclusive(current_span))
            && block.body[..index]
                .iter()
                .any(|statement| statement_always_exits(statement))
        {
            return true;
        }
        current_span = ancestor.span();
    }
    false
}

fn record_returned_literals<'a>(
    expression: &'a Expression<'a>,
    accumulator_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'a>,
    literals: &mut Vec<&'a Expression<'a>>,
) {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ConditionalExpression(conditional) => {
            record_returned_literals(
                &conditional.consequent,
                accumulator_symbol_id,
                ctx,
                literals,
            );
            record_returned_literals(&conditional.alternate, accumulator_symbol_id, ctx, literals);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last) = sequence.expressions.last() {
                record_returned_literals(last, accumulator_symbol_id, ctx, literals);
            }
        }
        Expression::LogicalExpression(logical) => {
            let left = logical.left.get_inner_expression();
            let left_is_accumulator = expression_is_symbol(left, accumulator_symbol_id, ctx);
            let left_is_always_truthy = matches!(
                left,
                Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
            );
            if left_is_accumulator || left_is_always_truthy {
                let selected = if logical.operator == LogicalOperator::And {
                    &logical.right
                } else {
                    &logical.left
                };
                record_returned_literals(selected, accumulator_symbol_id, ctx, literals);
            } else {
                record_returned_literals(&logical.left, accumulator_symbol_id, ctx, literals);
                record_returned_literals(&logical.right, accumulator_symbol_id, ctx, literals);
            }
        }
        Expression::ObjectExpression(_) | Expression::ArrayExpression(_) => {
            literals.push(expression)
        }
        _ => {}
    }
}

fn literal_spreads_accumulator(
    literal: &Expression<'_>,
    accumulator_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match literal {
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| {
            matches!(
                element,
                ArrayExpressionElement::SpreadElement(spread)
                    if expression_is_symbol(&spread.argument, Some(accumulator_symbol_id), ctx)
            )
        }),
        Expression::ObjectExpression(object) => object.properties.iter().any(|property| {
            matches!(
                property,
                ObjectPropertyKind::SpreadProperty(spread)
                    if expression_is_symbol(&spread.argument, Some(accumulator_symbol_id), ctx)
            )
        }),
        _ => false,
    }
}

fn literal_grows_accumulator(
    literal: &Expression<'_>,
    accumulator_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match literal {
        Expression::ArrayExpression(array) => {
            let accumulator_spread_count = array
                .elements
                .iter()
                .filter(|element| {
                    matches!(
                        element,
                        ArrayExpressionElement::SpreadElement(spread)
                            if expression_is_symbol(&spread.argument, Some(accumulator_symbol_id), ctx)
                    )
                })
                .count();
            array.elements.iter().any(|element| match element {
                ArrayExpressionElement::Elision(_) => false,
                ArrayExpressionElement::SpreadElement(spread) => {
                    if matches!(spread.argument.get_inner_expression(), Expression::ArrayExpression(array) if array.elements.is_empty())
                    {
                        false
                    } else {
                        !expression_is_symbol(
                            &spread.argument,
                            Some(accumulator_symbol_id),
                            ctx,
                        ) || accumulator_spread_count > 1
                    }
                }
                _ => true,
            })
        }
        Expression::ObjectExpression(object) => {
            object.properties.iter().any(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    property.computed && static_property_key_name(&property.key, true).is_none()
                }
                ObjectPropertyKind::SpreadProperty(spread) => {
                    !expression_is_symbol(&spread.argument, Some(accumulator_symbol_id), ctx)
                        && !is_fixed_shape_object_literal(&spread.argument)
                }
            })
        }
        _ => false,
    }
}

fn is_fixed_shape_object_literal(expression: &Expression<'_>) -> bool {
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return false;
    };
    object.properties.iter().all(|property| {
        matches!(
            property,
            ObjectPropertyKind::ObjectProperty(property)
                if static_property_key_name(&property.key, property.computed).is_some()
        )
    })
}

fn expression_is_symbol(
    expression: &Expression<'_>,
    symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    symbol_id.is_some_and(|symbol_id| {
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(symbol_id)
    })
}

fn is_global_identifier(
    expression: &Expression<'_>,
    expected_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == expected_name
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn static_property_key_name(key: &PropertyKey<'_>, computed: bool) -> Option<String> {
    if !computed {
        return key.static_name().map(|name| name.to_string());
    }
    match key {
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        PropertyKey::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            )
        }
        _ => None,
    }
}
