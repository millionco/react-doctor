use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpression, ArrayExpressionElement, BindingPattern, Expression,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::BinaryOperator;
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const OBJECT_MESSAGE: &str = "Interpolating this object runs its default `toString()`, which produces `[object Object]` and hides the real value — read a specific property or wrap it in `JSON.stringify`.";
const ARRAY_MESSAGE: &str = "Interpolating this array runs its default `toString()`, which comma-joins the values into unreadable output — read a specific element or use `.join`/`JSON.stringify`.";
const STRING_COERCION_METHOD_NAMES: [&str; 2] = ["toString", "valueOf"];
const INTENTIONAL_ARRAY_JOIN_FUNCTION_NAMES: [&str; 6] =
    ["rgb", "rgba", "hsl", "hsla", "matrix", "matrix3d"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiteralKind {
    Object,
    Array,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BindingShape {
    Direct,
    StateFirst,
    Other,
}

#[derive(Debug, Clone, Copy)]
struct BindingCandidate<'a> {
    owner_id: NodeId,
    declarator_initializer: Option<&'a Expression<'a>>,
    selection_has_initializer: bool,
    is_const: bool,
    shape: BindingShape,
}

type BindingIndex<'a> = FxHashMap<&'a str, Vec<BindingCandidate<'a>>>;

#[derive(Debug, Default, Clone)]
pub struct NoObjectOrArrayCoercedToStringInTemplateLiteral;

declare_oxc_lint!(
    /// Disallow lossy object and array coercion in strings.
    NoObjectOrArrayCoercedToStringInTemplateLiteral,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow lossy object and array coercion in strings.",
);

impl Rule for NoObjectOrArrayCoercedToStringInTemplateLiteral {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let binding_index = build_binding_index(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::TemplateLiteral(template) => {
                    if matches!(
                        ctx.nodes().parent_kind(node.id()),
                        AstKind::TaggedTemplateExpression(_)
                    ) {
                        continue;
                    }
                    for (expression_index, expression) in template.expressions.iter().enumerate() {
                        let preceding_text = template
                            .quasis
                            .get(expression_index)
                            .and_then(|quasi| quasi.value.cooked.as_ref())
                            .map_or("", |cooked| cooked.as_str());
                        if !is_intentional_array_join_interpolation(preceding_text) {
                            report_if_coerced_literal(
                                expression,
                                expression.span(),
                                &binding_index,
                                node,
                                ctx,
                            );
                        }
                    }
                }
                AstKind::BinaryExpression(binary)
                    if binary.operator == BinaryOperator::Addition =>
                {
                    if is_known_addition_operand(&binary.right, &binding_index, node, ctx) {
                        report_if_coerced_literal(
                            &binary.left,
                            binary.left.span(),
                            &binding_index,
                            node,
                            ctx,
                        );
                    }
                    if is_known_addition_operand(&binary.left, &binding_index, node, ctx) {
                        report_if_coerced_literal(
                            &binary.right,
                            binary.right.span(),
                            &binding_index,
                            node,
                            ctx,
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn report_if_coerced_literal<'a>(
    expression: &'a Expression<'a>,
    span: Span,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some((literal, kind)) = resolve_interpolated_literal(expression, binding_index, node, ctx)
    else {
        return;
    };
    if kind == LiteralKind::Array {
        let Expression::ArrayExpression(array) = literal else {
            return;
        };
        if !is_statically_lossy_array_literal(array, binding_index, node, ctx, &mut Vec::new()) {
            return;
        }
    }
    let message = match kind {
        LiteralKind::Object => OBJECT_MESSAGE,
        LiteralKind::Array => ARRAY_MESSAGE,
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}

fn is_known_addition_operand<'a>(
    expression: &'a Expression<'a>,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    matches!(
        expression,
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::TemplateLiteral(_)
    ) || object_or_array_kind(expression).is_some()
        || resolve_interpolated_literal(expression, binding_index, node, ctx).is_some()
}

fn resolve_interpolated_literal<'a>(
    expression: &'a Expression<'a>,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a Expression<'a>, LiteralKind)> {
    let expression = expression.get_inner_expression();
    if let Some(kind) = object_or_array_kind(expression) {
        return Some((expression, kind));
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let candidate = resolve_binding_candidate(identifier.name.as_str(), binding_index, node, ctx)?;
    if !candidate.is_const {
        return None;
    }
    let initializer = candidate.declarator_initializer?.get_inner_expression();
    if candidate.shape == BindingShape::Direct {
        if let Some(kind) = object_or_array_kind(initializer) {
            return Some((initializer, kind));
        }
        let Expression::CallExpression(hook_call) = initializer else {
            return None;
        };
        if !is_react_hook_call(hook_call, &["useRef"], ctx) {
            return None;
        }
        return first_argument_literal(hook_call);
    }
    if candidate.shape != BindingShape::StateFirst {
        return None;
    }
    let Expression::CallExpression(hook_call) = initializer else {
        return None;
    };
    is_react_hook_call(hook_call, &["useState"], ctx)
        .then(|| first_argument_literal(hook_call))
        .flatten()
}

fn build_binding_index<'a>(ctx: &LintContext<'a>) -> BindingIndex<'a> {
    let mut binding_index = FxHashMap::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let declaration = ctx.nodes().parent_node(node.id());
                let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
                    continue;
                };
                let Some(owner_id) =
                    binding_owner_id(node.id(), !variable_declaration.kind.is_var(), ctx)
                else {
                    continue;
                };
                collect_declarator_bindings(
                    &declarator.id,
                    declarator.init.as_ref(),
                    variable_declaration.kind.is_const(),
                    owner_id,
                    &mut binding_index,
                );
            }
            AstKind::FormalParameter(parameter) => {
                let Some(owner_id) = binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                collect_other_bindings(&parameter.pattern, owner_id, &mut binding_index);
            }
            _ => {}
        }
    }
    binding_index
}

fn binding_owner_id(
    node_id: NodeId,
    is_block_scoped: bool,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        (is_block_scoped && matches!(ancestor.kind(), AstKind::BlockStatement(_))
            || matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
            ))
        .then_some(ancestor.id())
    })
}

fn collect_declarator_bindings<'a>(
    pattern: &'a BindingPattern<'a>,
    initializer: Option<&'a Expression<'a>>,
    is_const: bool,
    owner_id: NodeId,
    binding_index: &mut BindingIndex<'a>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => push_binding_candidate(
            identifier.name.as_str(),
            BindingCandidate {
                owner_id,
                declarator_initializer: initializer,
                selection_has_initializer: initializer.is_some(),
                is_const,
                shape: BindingShape::Direct,
            },
            binding_index,
        ),
        BindingPattern::ArrayPattern(array_pattern) => {
            for (element_index, element) in array_pattern.elements.iter().enumerate() {
                let Some(element) = element else {
                    continue;
                };
                if element_index == 0
                    && let BindingPattern::BindingIdentifier(identifier) = element
                {
                    push_binding_candidate(
                        identifier.name.as_str(),
                        BindingCandidate {
                            owner_id,
                            declarator_initializer: initializer,
                            selection_has_initializer: false,
                            is_const,
                            shape: BindingShape::StateFirst,
                        },
                        binding_index,
                    );
                } else {
                    collect_other_bindings_with_initializer(
                        element,
                        initializer,
                        is_const,
                        owner_id,
                        binding_index,
                    );
                }
            }
            if let Some(rest) = &array_pattern.rest {
                collect_other_bindings_with_initializer(
                    &rest.argument,
                    initializer,
                    is_const,
                    owner_id,
                    binding_index,
                );
            }
        }
        _ => collect_other_bindings_with_initializer(
            pattern,
            initializer,
            is_const,
            owner_id,
            binding_index,
        ),
    }
}

fn collect_other_bindings<'a>(
    pattern: &'a BindingPattern<'a>,
    owner_id: NodeId,
    binding_index: &mut BindingIndex<'a>,
) {
    collect_other_bindings_with_initializer(pattern, None, false, owner_id, binding_index);
}

fn collect_other_bindings_with_initializer<'a>(
    pattern: &'a BindingPattern<'a>,
    declarator_initializer: Option<&'a Expression<'a>>,
    is_const: bool,
    owner_id: NodeId,
    binding_index: &mut BindingIndex<'a>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => push_binding_candidate(
            identifier.name.as_str(),
            BindingCandidate {
                owner_id,
                declarator_initializer,
                selection_has_initializer: false,
                is_const,
                shape: BindingShape::Other,
            },
            binding_index,
        ),
        BindingPattern::AssignmentPattern(assignment) => collect_other_bindings_with_initializer(
            &assignment.left,
            declarator_initializer,
            is_const,
            owner_id,
            binding_index,
        ),
        BindingPattern::ObjectPattern(object_pattern) => {
            for property in &object_pattern.properties {
                collect_other_bindings_with_initializer(
                    &property.value,
                    declarator_initializer,
                    is_const,
                    owner_id,
                    binding_index,
                );
            }
            if let Some(rest) = &object_pattern.rest {
                collect_other_bindings_with_initializer(
                    &rest.argument,
                    declarator_initializer,
                    is_const,
                    owner_id,
                    binding_index,
                );
            }
        }
        BindingPattern::ArrayPattern(array_pattern) => {
            for element in array_pattern.elements.iter().flatten() {
                collect_other_bindings_with_initializer(
                    element,
                    declarator_initializer,
                    is_const,
                    owner_id,
                    binding_index,
                );
            }
            if let Some(rest) = &array_pattern.rest {
                collect_other_bindings_with_initializer(
                    &rest.argument,
                    declarator_initializer,
                    is_const,
                    owner_id,
                    binding_index,
                );
            }
        }
    }
}

fn push_binding_candidate<'a>(
    name: &'a str,
    candidate: BindingCandidate<'a>,
    binding_index: &mut BindingIndex<'a>,
) {
    binding_index.entry(name).or_default().push(candidate);
}

fn resolve_binding_candidate<'a>(
    name: &str,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<BindingCandidate<'a>> {
    let candidates = binding_index.get(name)?;
    ctx.nodes()
        .ancestors(node.id())
        .filter(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::BlockStatement(_)
                    | AstKind::Function(_)
                    | AstKind::ArrowFunctionExpression(_)
                    | AstKind::Program(_)
            )
        })
        .find_map(|owner| {
            let mut best_candidate = None::<BindingCandidate<'a>>;
            for candidate in candidates
                .iter()
                .filter(|candidate| candidate.owner_id == owner.id())
            {
                if best_candidate.is_none()
                    || candidate.selection_has_initializer
                    || best_candidate.is_some_and(|best| !best.selection_has_initializer)
                {
                    best_candidate = Some(*candidate);
                }
            }
            best_candidate
        })
}

fn first_argument_literal<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<(&'a Expression<'a>, LiteralKind)> {
    let expression = call
        .arguments
        .first()
        .and_then(Argument::as_expression)?
        .get_inner_expression();
    object_or_array_kind(expression).map(|kind| (expression, kind))
}

fn object_or_array_kind(expression: &Expression<'_>) -> Option<LiteralKind> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object)
            if !object
                .properties
                .iter()
                .any(property_may_customize_string_coercion) =>
        {
            Some(LiteralKind::Object)
        }
        Expression::ArrayExpression(_) => Some(LiteralKind::Array),
        _ => None,
    }
}

fn property_may_customize_string_coercion(property: &ObjectPropertyKind<'_>) -> bool {
    let ObjectPropertyKind::ObjectProperty(property) = property else {
        return true;
    };
    if property.computed && is_symbol_to_primitive_key(&property.key) {
        return true;
    }
    property
        .key
        .static_name()
        .is_some_and(|name| STRING_COERCION_METHOD_NAMES.contains(&name.as_ref()))
}

fn is_symbol_to_primitive_key(key: &oxc_ast::ast::PropertyKey<'_>) -> bool {
    let Some(member) = key.as_expression().and_then(Expression::get_member_expr) else {
        return false;
    };
    member.static_property_name().as_deref() == Some("toPrimitive")
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Symbol")
}

fn is_statically_lossy_array_literal<'a>(
    array: &'a ArrayExpression<'a>,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    array.elements.iter().any(|element| match element {
        ArrayExpressionElement::Elision(_) => false,
        ArrayExpressionElement::SpreadElement(spread) => {
            let expression = spread.argument.get_inner_expression();
            if let Expression::ArrayExpression(spread_array) = expression {
                return is_statically_lossy_array_literal(
                    spread_array,
                    binding_index,
                    node,
                    ctx,
                    visited_symbols,
                );
            }
            let Some((resolved, LiteralKind::Array)) =
                resolve_interpolated_literal_with_cycle_guard(
                    expression,
                    binding_index,
                    node,
                    ctx,
                    visited_symbols,
                )
            else {
                return false;
            };
            matches!(resolved, Expression::ArrayExpression(spread_array) if is_statically_lossy_array_literal(spread_array, binding_index, node, ctx, visited_symbols))
        }
        element => {
            let Some(expression) = element.as_expression().map(Expression::get_inner_expression)
            else {
                return false;
            };
            if matches!(expression, Expression::ArrayExpression(_))
                || object_or_array_kind(expression) == Some(LiteralKind::Object)
            {
                return true;
            }
            let Some((resolved, kind)) =
                resolve_interpolated_literal_with_cycle_guard(
                    expression,
                    binding_index,
                    node,
                    ctx,
                    visited_symbols,
                )
            else {
                return false;
            };
            kind == LiteralKind::Object || matches!(resolved, Expression::ArrayExpression(_))
        }
    })
}

fn resolve_interpolated_literal_with_cycle_guard<'a>(
    expression: &'a Expression<'a>,
    binding_index: &BindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<(&'a Expression<'a>, LiteralKind)> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return resolve_interpolated_literal(expression, binding_index, node, ctx);
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbols.contains(&symbol_id) {
        return None;
    }
    visited_symbols.push(symbol_id);
    let resolved = resolve_interpolated_literal(expression, binding_index, node, ctx);
    visited_symbols.pop();
    resolved
}

fn is_intentional_array_join_interpolation(preceding_text: &str) -> bool {
    let trimmed = preceding_text.trim_end();
    let Some(prefix) = trimmed.strip_suffix('(') else {
        return false;
    };
    let function_name_reversed = prefix
        .chars()
        .rev()
        .take_while(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .collect::<String>();
    if function_name_reversed.is_empty() {
        return false;
    }
    let function_name = function_name_reversed.chars().rev().collect::<String>();
    function_name
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && INTENTIONAL_ARRAY_JOIN_FUNCTION_NAMES.contains(&function_name.as_str())
}
