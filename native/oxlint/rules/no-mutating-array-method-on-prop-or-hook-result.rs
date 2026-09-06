use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, ChainElement, Expression, MemberExpression,
        TSSignature, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
};

const MESSAGE_PREFIX: &str =
    "`sort`, `reverse`, and `splice` mutate the array in place; this one comes from ";
const PLAYBACK_SIBLING_METHOD_NAMES: [&str; 6] =
    ["play", "pause", "cancel", "finish", "resume", "restart"];
const FRESH_ARRAY_PRODUCING_METHODS: [&str; 9] = [
    "filter",
    "map",
    "slice",
    "concat",
    "flat",
    "flatMap",
    "toSorted",
    "toReversed",
    "toSpliced",
];
const ALIAS_RESOLUTION_DEPTH_LIMIT: usize = 3;
const TYPE_RESOLUTION_DEPTH_LIMIT: usize = 4;

#[derive(Debug, Default, Clone)]
pub struct NoMutatingArrayMethodOnPropOrHookResult;

declare_oxc_lint!(
    /// Disallow in-place array mutation on props and shared hook results.
    NoMutatingArrayMethodOnPropOrHookResult,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow in-place array mutation on props and shared hook results.",
);

impl Rule for NoMutatingArrayMethodOnPropOrHookResult {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(callee) = call.callee.as_member_expression() else {
            return;
        };
        let Some(method_name) = callee.static_property_name() else {
            return;
        };
        if !matches!(method_name, "sort" | "reverse" | "splice") {
            return;
        }

        let receiver = callee.object().get_inner_expression();
        if receiver_reaches_through_ref_current(receiver) {
            return;
        }
        let Some(root_identifier) = root_identifier(receiver) else {
            return;
        };
        if is_non_array_receiver_name(root_identifier.name.as_str())
            || scope_shows_playback_sibling_call(root_identifier, ctx)
            || (method_name == "splice"
                && is_registry_cleanup_mutation(node, root_identifier.name.as_str(), ctx))
        {
            return;
        }

        let Some(source) = resolve_shared_array_source(
            root_identifier,
            node,
            method_name,
            receiver.get_member_expr().is_some(),
            0,
            ctx,
        ) else {
            return;
        };
        let origin = match source {
            SharedArraySource::Prop => "a prop, so you mutate the parent's array",
            SharedArraySource::HookResult => "a hook result, so you mutate shared/cached state",
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{MESSAGE_PREFIX}{origin} and corrupts it across renders and components. Copy it first with `[...array]` or use `toSorted`/`toReversed`."
            ))
            .with_label(call.span),
        );
    }
}

#[derive(Clone, Copy)]
enum SharedArraySource {
    Prop,
    HookResult,
}

fn resolve_shared_array_source<'a>(
    identifier: &'a oxc_ast::ast::IdentifierReference<'a>,
    call_node: &AstNode<'a>,
    method_name: &str,
    reaches_through_member: bool,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<SharedArraySource> {
    if depth > ALIAS_RESOLUTION_DEPTH_LIMIT || has_mutation_safe_word(identifier.name.as_str()) {
        return None;
    }
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if binding_declares_non_array_method(symbol_id, method_name, ctx)
        || has_fresh_rebind_before_call(symbol_id, call_node, ctx)
        || (!reaches_through_member && binding_is_rest_copy(symbol_id, ctx))
    {
        return None;
    }

    if let Some(hook_call) = binding_hook_call(symbol_id, ctx) {
        if !is_provable_array_container_hook(hook_call) {
            return None;
        }
        if is_setterless_use_state_binding(symbol_id, hook_call, ctx)
            && (reaches_through_member || method_name == "splice")
        {
            return None;
        }
        if is_mutable_store_hook_call(hook_call)
            || (!reaches_through_member && is_use_memo_returning_only_fresh_arrays(hook_call, ctx))
        {
            return None;
        }
        return Some(SharedArraySource::HookResult);
    }

    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
        let owner = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })?;
        return component_or_hook_function_name(owner, ctx).map(|_| SharedArraySource::Prop);
    }

    let (alias_identifier, alias_is_member) = binding_alias_source(symbol_id, ctx)?;
    resolve_shared_array_source(
        alias_identifier,
        call_node,
        method_name,
        reaches_through_member || alias_is_member,
        depth + 1,
        ctx,
    )
}

fn binding_hook_call<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::CallExpression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let initializer = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator.init.as_ref(),
        _ => None,
    }?;
    let Expression::CallExpression(call) = initializer.get_inner_expression() else {
        return None;
    };
    callee_name(&call.callee)
        .is_some_and(crate::utils::is_react_hook_name)
        .then_some(call)
}

fn binding_alias_source<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<(&'a oxc_ast::ast::IdentifierReference<'a>, bool)> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    if let Expression::Identifier(identifier) = initializer {
        return Some((identifier, false));
    }
    let member = initializer.get_member_expr()?;
    if receiver_reaches_through_ref_current(initializer) {
        return None;
    }
    root_identifier(member.object()).map(|identifier| (identifier, true))
}

fn root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut cursor = expression.get_inner_expression();
    loop {
        if let Expression::Identifier(identifier) = cursor {
            return Some(identifier);
        }
        cursor = cursor
            .get_member_expr()?
            .object()
            .get_inner_expression();
    }
}

fn receiver_reaches_through_ref_current(expression: &Expression<'_>) -> bool {
    let mut cursor = expression.get_inner_expression();
    while let Some(member) = cursor.get_member_expr() {
        if matches!(member, MemberExpression::StaticMemberExpression(member) if member.property.name == "current")
        {
            return true;
        }
        cursor = member.object().get_inner_expression();
    }
    false
}

fn callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return Some(identifier.name.as_str());
    }
    expression.get_member_expr()?.static_property_name()
}

fn is_provable_array_container_hook(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    matches!(
        callee_name(&call.callee),
        Some("useContext" | "useMemo" | "useReducer" | "useState" | "useSyncExternalStore")
    )
}

fn is_mutable_store_hook_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    matches!(
        callee_name(&call.callee),
        Some(
            "useLocalObservable" | "useLocalStore" | "useSyncedStore" | "useProxy" | "useCreation"
        )
    )
}

fn is_setterless_use_state_binding(
    symbol_id: SymbolId,
    hook_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if callee_name(&hook_call.callee) != Some("useState") {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.elements.iter().flatten().count() + usize::from(pattern.rest.is_some()) == 1
}

fn binding_is_rest_copy(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            pattern_symbol_is_inside_rest(&declarator.id, symbol_id, false)
        }
        AstKind::FormalParameter(parameter) => {
            pattern_symbol_is_inside_rest(&parameter.pattern, symbol_id, false)
        }
        _ => false,
    }
}

fn pattern_symbol_is_inside_rest(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
    is_inside_rest: bool,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            identifier.symbol_id() == symbol_id && is_inside_rest
        }
        BindingPattern::AssignmentPattern(pattern) => {
            pattern_symbol_is_inside_rest(&pattern.left, symbol_id, is_inside_rest)
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern.properties.iter().any(|property| {
                pattern_symbol_is_inside_rest(&property.value, symbol_id, is_inside_rest)
            }) || pattern
                .rest
                .as_ref()
                .is_some_and(|rest| pattern_symbol_is_inside_rest(&rest.argument, symbol_id, true))
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| pattern_symbol_is_inside_rest(element, symbol_id, is_inside_rest))
                || pattern.rest.as_ref().is_some_and(|rest| {
                    pattern_symbol_is_inside_rest(&rest.argument, symbol_id, true)
                })
        }
    }
}

fn has_fresh_rebind_before_call<'a>(
    symbol_id: SymbolId,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(identifier_node.id());
            let AstKind::AssignmentExpression(assignment) = parent.kind() else {
                return false;
            };
            assignment.operator == oxc_syntax::operator::AssignmentOperator::Assign
                && matches!(&assignment.left, AssignmentTarget::AssignmentTargetIdentifier(identifier) if identifier.span == identifier_node.span())
                && is_provably_fresh_or_absent_value(&assignment.right)
                && node_dominates_node(parent, call_node, ctx)
        })
}

fn is_provably_fresh_or_absent_value(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ArrayExpression(_) | Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::ConditionalExpression(conditional) => {
            is_provably_fresh_or_absent_value(&conditional.consequent)
                && is_provably_fresh_or_absent_value(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            is_provably_fresh_or_absent_value(&logical.left)
                && is_provably_fresh_or_absent_value(&logical.right)
        }
        Expression::CallExpression(call) => is_fresh_array_producing_call(call),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => is_fresh_array_producing_call(call),
            ChainElement::TSNonNullExpression(expression) => {
                is_provably_fresh_or_absent_value(&expression.expression)
            }
            _ => false,
        },
        _ => false,
    }
}

fn is_fresh_array_producing_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_member_expr() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    FRESH_ARRAY_PRODUCING_METHODS.contains(&method_name)
        || (method_name == "from"
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array"))
}

fn is_use_memo_returning_only_fresh_arrays(
    hook_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if callee_name(&hook_call.callee) != Some("useMemo") {
        return false;
    }
    let Some(factory) = hook_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    match factory.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return is_provably_fresh_or_absent_value(expression);
            }
            function_returns_only_fresh_arrays(function.node_id.get(), function.body.span(), ctx)
        }
        Expression::FunctionExpression(function) => function.body.as_ref().is_some_and(|body| {
            function_returns_only_fresh_arrays(function.node_id.get(), body.span, ctx)
        }),
        _ => false,
    }
}

fn function_returns_only_fresh_arrays(
    function_node_id: NodeId,
    body_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut saw_fresh_return = false;
    for node in ctx.nodes().iter() {
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if !body_span.contains_inclusive(statement.span)
            || ctx
                .nodes()
                .ancestors(node.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
                .is_none_or(|owner| owner.id() != function_node_id)
        {
            continue;
        }
        if statement
            .argument
            .as_ref()
            .is_some_and(|argument| !is_provably_fresh_or_absent_value(argument))
        {
            return false;
        }
        saw_fresh_return = true;
    }
    saw_fresh_return
}

fn scope_shows_playback_sibling_call(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(identifier_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.object().span() != identifier_node.span()
                || !member
                    .static_property_name()
                    .is_some_and(|name| PLAYBACK_SIBLING_METHOD_NAMES.contains(&name.as_str()))
            {
                return false;
            }
            matches!(ctx.nodes().parent_node(member_node.id()).kind(), AstKind::CallExpression(call) if call.callee.span() == member_node.span())
        })
}

fn is_registry_cleanup_mutation(
    call_node: &AstNode<'_>,
    root_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(cleanup_function) = ctx.nodes().ancestors(call_node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let Some(return_statement) = ctx
        .nodes()
        .ancestors(cleanup_function.id())
        .take_while(|ancestor| {
            !matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
    else {
        return false;
    };
    let Some(effect_callback) = ctx
        .nodes()
        .ancestors(return_statement.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    else {
        return false;
    };
    let effect_call_node = ctx.nodes().parent_node(effect_callback.id());
    let AstKind::CallExpression(effect_call) = effect_call_node.kind() else {
        return false;
    };
    if !effect_call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == effect_callback.span())
    }) || !matches!(
        callee_name(&effect_call.callee),
        Some("useEffect" | "useLayoutEffect" | "useInsertionEffect")
    ) {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        effect_callback.span().contains_inclusive(call.span)
            && !cleanup_function.span().contains_inclusive(call.span)
            && call.callee.as_member_expression().is_some_and(|member| {
                matches!(member.static_property_name(), Some("push" | "add"))
                    && root_identifier(member.object())
                        .is_some_and(|identifier| identifier.name == root_name)
            })
    })
}

fn has_mutation_safe_word(name: &str) -> bool {
    identifier_words(name)
        .iter()
        .any(|word| matches!(word.as_str(), "draft" | "mutable" | "mutation"))
}

fn identifier_words(name: &str) -> Vec<String> {
    let characters = name.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut word = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if !character.is_ascii_alphabetic() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word).to_ascii_lowercase());
            }
            continue;
        }
        let starts_word = !word.is_empty()
            && character.is_ascii_uppercase()
            && (characters[index - 1].is_ascii_lowercase()
                || characters
                    .get(index + 1)
                    .is_some_and(char::is_ascii_lowercase));
        if starts_word {
            words.push(std::mem::take(&mut word).to_ascii_lowercase());
        }
        word.push(character);
    }
    if !word.is_empty() {
        words.push(word.to_ascii_lowercase());
    }
    words
}

fn is_non_array_receiver_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    [
        "anim", "timeline", "tween", "player", "motion", "strateg", "sorter",
    ]
    .iter()
    .any(|fragment| lowercase.contains(fragment))
}

fn binding_declares_non_array_method(
    symbol_id: SymbolId,
    method_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(binding_type) = binding_type(symbol_id, ctx) else {
        return false;
    };
    !resolved_type_can_be_array(binding_type, 0, ctx)
        && resolved_type_declares_callable_member(binding_type, method_name, 0, ctx)
}

#[derive(Clone, Copy)]
enum ResolvedType<'a> {
    Type(&'a TSType<'a>),
    Interface(&'a oxc_ast::ast::TSInterfaceDeclaration<'a>),
    Alias(&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>),
}

fn binding_type<'a>(symbol_id: SymbolId, ctx: &LintContext<'a>) -> Option<ResolvedType<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .type_annotation
            .as_ref()
            .map(|annotation| ResolvedType::Type(&annotation.type_annotation)),
        AstKind::FormalParameter(parameter) => {
            let parameter_type = &parameter.type_annotation.as_ref()?.type_annotation;
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return Some(ResolvedType::Type(parameter_type));
            }
            let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                return None;
            };
            let property_name = pattern.properties.iter().find_map(|property| {
                pattern_contains_symbol(&property.value, symbol_id)
                    .then(|| property.key.static_name())
                    .flatten()
            })?;
            property_type_from_resolved_type(
                ResolvedType::Type(parameter_type),
                property_name.as_ref(),
                0,
                ctx,
            )
        }
        _ => None,
    }
}

fn pattern_contains_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(pattern) => {
            pattern_contains_symbol(&pattern.left, symbol_id)
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern
                .properties
                .iter()
                .any(|property| pattern_contains_symbol(&property.value, symbol_id))
                || pattern
                    .rest
                    .as_ref()
                    .is_some_and(|rest| pattern_contains_symbol(&rest.argument, symbol_id))
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| pattern_contains_symbol(element, symbol_id))
                || pattern
                    .rest
                    .as_ref()
                    .is_some_and(|rest| pattern_contains_symbol(&rest.argument, symbol_id))
        }
    }
}

fn same_file_type_declarations<'a>(name: &str, ctx: &LintContext<'a>) -> Vec<ResolvedType<'a>> {
    ctx.nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::TSInterfaceDeclaration(declaration) if declaration.id.name == name => {
                Some(ResolvedType::Interface(declaration))
            }
            AstKind::TSTypeAliasDeclaration(declaration) if declaration.id.name == name => {
                Some(ResolvedType::Alias(declaration))
            }
            _ => None,
        })
        .collect()
}

fn type_reference_name<'a>(type_name: &'a TSTypeName<'a>) -> Option<&'a str> {
    let TSTypeName::IdentifierReference(identifier) = type_name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn resolved_type_can_be_array(
    resolved: ResolvedType<'_>,
    depth: usize,
    ctx: &LintContext<'_>,
) -> bool {
    if depth > TYPE_RESOLUTION_DEPTH_LIMIT {
        return true;
    }
    match resolved {
        ResolvedType::Alias(alias) => {
            resolved_type_can_be_array(ResolvedType::Type(&alias.type_annotation), depth + 1, ctx)
        }
        ResolvedType::Interface(interface) => interface.extends.iter().any(|heritage| {
            let Some(name) = type_reference_name(&heritage.type_name) else {
                return true;
            };
            matches!(name, "Array" | "ReadonlyArray") || {
                let declarations = same_file_type_declarations(name, ctx);
                declarations.is_empty()
                    || declarations
                        .iter()
                        .copied()
                        .any(|declaration| resolved_type_can_be_array(declaration, depth + 1, ctx))
            }
        }),
        ResolvedType::Type(type_node) => match type_node {
            TSType::TSArrayType(_) | TSType::TSTupleType(_) => true,
            TSType::TSUnionType(union) => union.types.iter().any(|member| {
                resolved_type_can_be_array(ResolvedType::Type(member), depth + 1, ctx)
            }),
            TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
                resolved_type_can_be_array(ResolvedType::Type(member), depth + 1, ctx)
            }),
            TSType::TSTypeReference(reference) => {
                let Some(name) = type_reference_name(&reference.type_name) else {
                    return true;
                };
                if matches!(name, "Array" | "ReadonlyArray") {
                    return true;
                }
                let declarations = same_file_type_declarations(name, ctx);
                declarations.is_empty()
                    || declarations
                        .iter()
                        .copied()
                        .any(|declaration| resolved_type_can_be_array(declaration, depth + 1, ctx))
            }
            _ => false,
        },
    }
}

fn resolved_type_declares_callable_member(
    resolved: ResolvedType<'_>,
    member_name: &str,
    depth: usize,
    ctx: &LintContext<'_>,
) -> bool {
    if depth > TYPE_RESOLUTION_DEPTH_LIMIT {
        return false;
    }
    match resolved {
        ResolvedType::Alias(alias) => resolved_type_declares_callable_member(
            ResolvedType::Type(&alias.type_annotation),
            member_name,
            depth + 1,
            ctx,
        ),
        ResolvedType::Interface(interface) => {
            members_declare_callable_member(&interface.body.body, member_name)
                || interface.extends.iter().any(|heritage| {
                    heritage.type_arguments.is_none()
                        && type_reference_name(&heritage.type_name).is_some_and(|name| {
                            same_file_type_declarations(name, ctx).iter().copied().any(
                                |declaration| {
                                    resolved_type_declares_callable_member(
                                        declaration,
                                        member_name,
                                        depth + 1,
                                        ctx,
                                    )
                                },
                            )
                        })
                })
        }
        ResolvedType::Type(type_node) => match type_node {
            TSType::TSArrayType(_) | TSType::TSTupleType(_) => false,
            TSType::TSUnionType(union) => union.types.iter().all(|member| {
                resolved_type_declares_callable_member(
                    ResolvedType::Type(member),
                    member_name,
                    depth + 1,
                    ctx,
                )
            }),
            TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
                resolved_type_declares_callable_member(
                    ResolvedType::Type(member),
                    member_name,
                    depth + 1,
                    ctx,
                )
            }),
            TSType::TSTypeLiteral(literal) => {
                members_declare_callable_member(&literal.members, member_name)
            }
            TSType::TSTypeReference(reference) => type_reference_name(&reference.type_name)
                .filter(|name| !matches!(*name, "Array" | "ReadonlyArray"))
                .is_some_and(|name| {
                    same_file_type_declarations(name, ctx)
                        .iter()
                        .copied()
                        .any(|declaration| {
                            resolved_type_declares_callable_member(
                                declaration,
                                member_name,
                                depth + 1,
                                ctx,
                            )
                        })
                }),
            _ => false,
        },
    }
}

fn members_declare_callable_member(members: &[TSSignature<'_>], member_name: &str) -> bool {
    members.iter().any(|member| match member {
        TSSignature::TSMethodSignature(method) => {
            !method.computed && method.key.static_name().as_deref() == Some(member_name)
        }
        TSSignature::TSPropertySignature(property) => {
            !property.computed
                && property.key.static_name().as_deref() == Some(member_name)
                && matches!(
                    property
                        .type_annotation
                        .as_ref()
                        .map(|annotation| &annotation.type_annotation),
                    Some(TSType::TSFunctionType(_))
                )
        }
        _ => false,
    })
}

fn property_type_from_resolved_type<'a>(
    resolved: ResolvedType<'a>,
    property_name: &str,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<ResolvedType<'a>> {
    if depth > TYPE_RESOLUTION_DEPTH_LIMIT {
        return None;
    }
    match resolved {
        ResolvedType::Alias(alias) => property_type_from_resolved_type(
            ResolvedType::Type(&alias.type_annotation),
            property_name,
            depth + 1,
            ctx,
        ),
        ResolvedType::Interface(interface) => {
            if let Some(property_type) =
                property_type_from_members(&interface.body.body, property_name)
            {
                return Some(ResolvedType::Type(property_type));
            }
            interface.extends.iter().find_map(|heritage| {
                if heritage.type_arguments.is_some() {
                    return None;
                }
                same_file_type_declarations(type_reference_name(&heritage.type_name)?, ctx)
                    .iter()
                    .copied()
                    .find_map(|declaration| {
                        property_type_from_resolved_type(declaration, property_name, depth + 1, ctx)
                    })
            })
        }
        ResolvedType::Type(type_node) => match type_node {
            TSType::TSTypeLiteral(literal) => {
                property_type_from_members(&literal.members, property_name).map(ResolvedType::Type)
            }
            TSType::TSIntersectionType(intersection) => {
                intersection.types.iter().find_map(|member| {
                    property_type_from_resolved_type(
                        ResolvedType::Type(member),
                        property_name,
                        depth + 1,
                        ctx,
                    )
                })
            }
            TSType::TSTypeReference(reference) => {
                same_file_type_declarations(type_reference_name(&reference.type_name)?, ctx)
                    .iter()
                    .copied()
                    .find_map(|declaration| {
                        property_type_from_resolved_type(declaration, property_name, depth + 1, ctx)
                    })
            }
            _ => None,
        },
    }
}

fn property_type_from_members<'a>(
    members: &'a [TSSignature<'a>],
    property_name: &str,
) -> Option<&'a TSType<'a>> {
    members.iter().find_map(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return None;
        };
        (!property.computed && property.key.static_name().as_deref() == Some(property_name)).then(
            || {
                property
                    .type_annotation
                    .as_ref()
                    .map(|annotation| &annotation.type_annotation)
            },
        )?
    })
}
