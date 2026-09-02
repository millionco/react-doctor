use std::{
    hash::{Hash as HydrationHash, Hasher as HydrationHasher},
    path::{Path as HydrationPath, PathBuf as HydrationPathBuf},
    sync::{Mutex as HydrationMutex, OnceLock as HydrationOnceLock},
};

use oxc_allocator::Allocator as HydrationAllocator;
use oxc_ast::ast::{
    Argument, BindingPattern, ExportDefaultDeclarationKind, FunctionType, JSXAttributeName,
    JSXElementName, ObjectPropertyKind, PropertyKey, Statement, UnaryOperator,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser as HydrationParser;
use oxc_resolver::{
    ResolveOptions as HydrationResolveOptions, Resolver as HydrationResolver,
    TsconfigDiscovery as HydrationTsconfigDiscovery,
};
use oxc_semantic::{
    NodeId, Semantic as HydrationSemantic, SemanticBuilder as HydrationSemanticBuilder,
};
use oxc_span::{GetSpan, SourceType as HydrationSourceType, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const MOUNT_FLASH_MESSAGE: &str = "`useEffect(setState, [])` runs after the first paint, so users can see the initial state flash. Initialize from a render-safe value or use `useSyncExternalStore` for external values.";
const EXTERNAL_SYNC_FLASH_MESSAGE: &str = "`useEffect` updates a rendered branch from a browser capability after the first paint, so users can see the fallback flash. Preserve a stable first render or switch in a layout effect when the pre-paint replacement is intentional.";
const EXTERNAL_DOM_METHOD_NAMES: [&str; 15] = [
    "blur",
    "canPlayType",
    "focus",
    "getBoundingClientRect",
    "getClientRects",
    "measure",
    "measureInWindow",
    "measureLayout",
    "scroll",
    "scrollBy",
    "scrollIntoView",
    "scrollTo",
    "select",
    "setRangeText",
    "setSelectionRange",
];
const HYDRATION_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;
const HYDRATION_CROSS_FILE_BARREL_FOLLOW_DEPTH: usize = 4;

static HYDRATION_IMPORTED_DOM_SYNC_CACHE: HydrationOnceLock<
    HydrationMutex<FxHashMap<(HydrationPathBuf, String, usize, u64), bool>>,
> = HydrationOnceLock::new();

#[derive(Debug, Default, Clone)]
pub struct RenderingHydrationNoFlicker;

struct HydrationStatePair<'a> {
    state_symbol_id: SymbolId,
    state_binding_span: Span,
    component_function_id: NodeId,
    initializer: Option<&'a Expression<'a>>,
}

declare_oxc_lint!(
    /// Warns when passive state synchronization can flash after the first paint.
    RenderingHydrationNoFlicker,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when passive state synchronization can flash after paint.",
);

impl Rule for RenderingHydrationNoFlicker {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(effect_call, &["useEffect"], ctx) || effect_call.arguments.len() < 2
        {
            return;
        }
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let is_mount_only = dependencies.elements.is_empty();
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(callback_id) = hydration_effect_callback_function_id(callback_expression, ctx)
        else {
            return;
        };
        if hydration_exact_viewport_effect(callback_id, ctx) {
            ctx.diagnostic(OxcDiagnostic::warn(MOUNT_FLASH_MESSAGE).with_label(effect_call.span));
            return;
        }
        let Some(statements) = hydration_callback_statements(callback_id, ctx) else {
            return;
        };
        let [sole_statement] = statements.as_slice() else {
            return;
        };
        let Statement::ExpressionStatement(statement) = sole_statement else {
            return;
        };
        let Expression::CallExpression(setter_call) = &statement.expression else {
            return;
        };
        let Expression::Identifier(setter_identifier) = &setter_call.callee else {
            return;
        };
        if !hydration_is_setter_name(setter_identifier.name.as_str()) {
            return;
        }
        let Some(state_pair) = hydration_state_pair(setter_identifier, ctx) else {
            return;
        };
        if !is_mount_only && !hydration_arguments_read_external_dom(setter_call, ctx) {
            return;
        }
        if hydration_same_state_value(&state_pair, setter_call, ctx)
            || !hydration_state_reaches_render(&state_pair, false, ctx)
            || hydration_arguments_read_react_ref(setter_call, ctx)
            || hydration_arguments_read_locale(setter_call, ctx)
        {
            return;
        }
        let message = if is_mount_only {
            MOUNT_FLASH_MESSAGE
        } else {
            EXTERNAL_SYNC_FLASH_MESSAGE
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(effect_call.span));
    }
}

fn hydration_effect_callback_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    hydration_effect_callback_function_id_inner(expression, ctx, &mut FxHashSet::default())
}

fn hydration_effect_callback_function_id_inner(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return None;
            }
            match ctx.symbol_declaration(symbol_id).kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(_) => resolve_direct_unreassigned_symbol_initializer(
                    symbol_id, ctx,
                )
                .and_then(|initializer| {
                    hydration_effect_callback_function_id_inner(
                        initializer,
                        ctx,
                        visited_symbol_ids,
                    )
                }),
                _ => None,
            }
        }
        _ => None,
    }
}

fn hydration_direct_function_id<'node, 'ast>(
    expression: &'node Expression<'ast>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn hydration_is_setter_name(name: &str) -> bool {
    name.strip_prefix("set")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn hydration_callback_statements<'context, 'ast>(
    function_id: NodeId,
    ctx: &'context LintContext<'ast>,
) -> Option<Vec<&'context Statement<'ast>>> {
    let statements = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.body.as_ref()?.statements,
        AstKind::ArrowFunctionExpression(function) => &function.body.as_function_body()?.statements,
        _ => return None,
    };
    Some(
        statements
            .iter()
            .filter(|statement| !is_no_op_statement(statement))
            .collect(),
    )
}

fn hydration_nearest_function(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn hydration_state_pair<'a>(
    setter: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<HydrationStatePair<'a>> {
    let setter_symbol_id = ctx
        .scoping()
        .get_reference(setter.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state_binding) =
        pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    if setter_binding.symbol_id() != setter_symbol_id {
        return None;
    }
    let Expression::CallExpression(state_call) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    if !is_react_hook_call(state_call, &["useState"], ctx) {
        return None;
    }
    Some(HydrationStatePair {
        state_symbol_id: state_binding.symbol_id(),
        state_binding_span: state_binding.span,
        component_function_id: hydration_nearest_function(declaration.id(), ctx)?,
        initializer: state_call
            .arguments
            .first()
            .and_then(Argument::as_expression),
    })
}

fn hydration_same_state_value(
    state_pair: &HydrationStatePair<'_>,
    setter_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(next_value) = setter_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let mut initializer = state_pair.initializer.map(Expression::get_inner_expression);
    if let Some(Expression::ArrowFunctionExpression(function)) = initializer {
        initializer = function.get_expression().or_else(|| {
            let [Statement::ReturnStatement(statement)] =
                function.body.as_function_body()?.statements.as_slice()
            else {
                return None;
            };
            statement.argument.as_ref()
        });
    } else if let Some(Expression::FunctionExpression(function)) = initializer {
        initializer = function.body.as_ref().and_then(|body| {
            let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                return None;
            };
            statement.argument.as_ref()
        });
    }
    match (initializer, next_value) {
        (Some(Expression::NullLiteral(_)), Expression::NullLiteral(_)) => true,
        (Some(Expression::BooleanLiteral(left)), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Some(Expression::NumericLiteral(left)), Expression::NumericLiteral(right)) => {
            left.value.to_bits() == right.value.to_bits()
        }
        (Some(Expression::StringLiteral(left)), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        (Some(Expression::Identifier(left)), Expression::Identifier(right)) => ctx
            .scoping()
            .get_reference(left.reference_id())
            .symbol_id()
            .is_some_and(|left_symbol_id| {
                ctx.scoping()
                    .get_reference(right.reference_id())
                    .symbol_id()
                    == Some(left_symbol_id)
            }),
        (None, expression) => hydration_is_undefined(expression, ctx),
        (Some(initializer), expression) => {
            hydration_is_undefined(initializer, ctx) && hydration_is_undefined(expression, ctx)
        }
    }
}

fn hydration_is_undefined(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression,
        Expression::Identifier(identifier)
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
        || matches!(expression, Expression::UnaryExpression(unary) if unary.operator.is_void())
}

fn hydration_expression_reads_symbols(
    span: Span,
    symbols: &FxHashSet<SymbolId>,
    root_function_id: NodeId,
    expression_function_id: Option<NodeId>,
    should_exclude_nonvisible_animation: bool,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return false;
        };
        span.contains_inclusive(identifier.span)
            && hydration_nearest_function(node.id(), ctx)
                == Some(expression_function_id.unwrap_or(root_function_id))
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| symbols.contains(&symbol_id))
            && (!should_exclude_nonvisible_animation
                || !hydration_is_nonvisible_animation_reference(node.id(), ctx))
    })
}

fn hydration_state_reaches_render(
    state_pair: &HydrationStatePair<'_>,
    should_classify_static_spread_objects: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let component = ctx.nodes().get_node(state_pair.component_function_id);
    let component_span = component.span();
    let component_body_id = match component.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.node_id.get()),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.node_id()),
        _ => None,
    };
    let mut derived_symbols = FxHashSet::default();
    let mut visible_static_spread_symbols = FxHashSet::default();
    derived_symbols.insert(state_pair.state_symbol_id);
    loop {
        let previous_len = derived_symbols.len();
        for node in ctx.nodes().iter() {
            if !component_span.contains_inclusive(node.span())
                || hydration_nearest_function(node.id(), ctx)
                    != Some(state_pair.component_function_id)
            {
                continue;
            }
            let (binding_symbol_id, derived_span, expression_function_id, initializer) = match node
                .kind()
            {
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    let variable_declaration = ctx.nodes().parent_node(node.id());
                    if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                        || should_classify_static_spread_objects
                            && ctx.nodes().parent_node(variable_declaration.id()).id()
                                != component_body_id.unwrap_or(state_pair.component_function_id)
                    {
                        continue;
                    }
                    let expression_function_id = match initializer.get_inner_expression() {
                        Expression::ArrowFunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        Expression::FunctionExpression(function) => Some(function.node_id.get()),
                        _ => None,
                    };
                    if should_classify_static_spread_objects && expression_function_id.is_some() {
                        continue;
                    }
                    (
                        binding.symbol_id(),
                        initializer.span(),
                        expression_function_id,
                        Some(initializer),
                    )
                }
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration =>
                {
                    if should_classify_static_spread_objects {
                        continue;
                    }
                    let Some(binding) = function.id.as_ref() else {
                        continue;
                    };
                    (
                        binding.symbol_id(),
                        function.span,
                        Some(function.node_id.get()),
                        None,
                    )
                }
                _ => continue,
            };
            let is_visible_static_spread_object = should_classify_static_spread_objects
                && initializer.is_some_and(|initializer| {
                    match initializer.get_inner_expression() {
                        Expression::ObjectExpression(_) => {
                            hydration_initializer_can_reach_visible_output(
                                initializer,
                                &derived_symbols,
                                ctx,
                            ) && hydration_object_symbol_has_only_static_references(
                                binding_symbol_id,
                                &mut FxHashSet::default(),
                                ctx,
                            )
                        }
                        Expression::Identifier(identifier) => ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some_and(|symbol_id| {
                                visible_static_spread_symbols.contains(&symbol_id)
                            }),
                        _ => false,
                    }
                });
            if ctx
                .scoping()
                .get_resolved_references(binding_symbol_id)
                .any(|reference| reference.is_write())
                || !hydration_expression_reads_symbols(
                    derived_span,
                    &derived_symbols,
                    state_pair.component_function_id,
                    expression_function_id,
                    !should_classify_static_spread_objects,
                    ctx,
                )
                || should_classify_static_spread_objects
                    && matches!(
                        initializer.map(Expression::get_inner_expression),
                        Some(Expression::ObjectExpression(_))
                    )
                    && !is_visible_static_spread_object
            {
                continue;
            }
            derived_symbols.insert(binding_symbol_id);
            if is_visible_static_spread_object {
                visible_static_spread_symbols.insert(binding_symbol_id);
            }
        }
        if derived_symbols.len() == previous_len {
            break;
        }
    }
    ctx.nodes().iter().any(|node| {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return false;
        };
        if identifier.span == state_pair.state_binding_span
            || !component_span.contains_inclusive(identifier.span)
            || !ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| derived_symbols.contains(&symbol_id))
            || !should_classify_static_spread_objects
                && hydration_is_hidden_output_reference(node.id(), ctx)
        {
            return false;
        }
        if should_classify_static_spread_objects {
            hydration_viewport_reference_reaches_component_output(
                node.id(),
                state_pair.component_function_id,
                &visible_static_spread_symbols,
                ctx,
            )
        } else {
            hydration_reference_reaches_component_output(
                node.id(),
                state_pair.component_function_id,
                ctx,
            )
        }
    })
}

fn hydration_viewport_reference_reaches_component_output(
    node_id: NodeId,
    component_function_id: NodeId,
    visible_static_spread_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    if hydration_nearest_function(node_id, ctx) != Some(component_function_id) {
        return false;
    }
    let identifier_span = ctx.nodes().get_node(node_id).span();
    if matches!(ctx.nodes().parent_kind(node_id), AstKind::StaticMemberExpression(member)
        if member.property.span == identifier_span)
        || matches!(ctx.nodes().parent_kind(node_id), AstKind::ObjectProperty(property)
            if !property.computed && property.key.span() == identifier_span)
    {
        return false;
    }
    let symbol_id = match ctx.nodes().get_node(node_id).kind() {
        AstKind::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        _ => None,
    };
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXSpreadAttribute(_) => {
                return symbol_id
                    .is_some_and(|symbol_id| visible_static_spread_symbols.contains(&symbol_id));
            }
            AstKind::JSXAttribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return true;
                };
                return name.name != "id"
                    && !name.name.starts_with("aria-")
                    && !(name.name.starts_with("on")
                        && name
                            .name
                            .as_bytes()
                            .get(2)
                            .is_some_and(u8::is_ascii_uppercase));
            }
            AstKind::ReturnStatement(_) => return true,
            AstKind::FunctionBody(_) => return false,
            _ => {}
        }
    }
    false
}

fn hydration_object_symbol_has_only_static_references(
    symbol_id: SymbolId,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return true;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| {
            let reference_root =
                transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if matches!(parent.kind(), AstKind::JSXSpreadAttribute(spread)
                if spread.argument.span() == reference_root.span())
            {
                return true;
            }
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            let Some(initializer) = declarator.init.as_ref() else {
                return false;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                return false;
            };
            initializer.span() == reference_root.span()
                && matches!(ctx.nodes().parent_kind(parent.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                && hydration_object_symbol_has_only_static_references(
                    binding.symbol_id(),
                    visited_symbol_ids,
                    ctx,
                )
        })
}

fn hydration_initializer_can_reach_visible_output(
    initializer: &Expression<'_>,
    derived_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::ObjectExpression(object) = initializer.get_inner_expression() else {
        return true;
    };
    if object.properties.iter().any(|property| {
        !matches!(property, ObjectPropertyKind::ObjectProperty(property)
            if hydration_property_name(property).is_some())
    }) {
        return false;
    }
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let Some(name) = hydration_property_name(property) else {
            return false;
        };
        !hydration_nonvisible_property_name(name)
            && ctx.nodes().iter().any(|node| {
                let AstKind::IdentifierReference(identifier) = node.kind() else {
                    return false;
                };
                property.value.span().contains_inclusive(identifier.span)
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some_and(|symbol_id| derived_symbols.contains(&symbol_id))
            })
    })
}

fn hydration_property_name<'a>(property: &'a oxc_ast::ast::ObjectProperty<'a>) -> Option<&'a str> {
    if property.computed || property.method {
        return None;
    }
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn hydration_nonvisible_property_name(name: &str) -> bool {
    name == "id"
        || name == "motionAppear"
        || name.starts_with("aria-")
        || (name.starts_with("on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase))
}

fn hydration_is_hidden_output_reference(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return false;
                };
                if name.name == "id"
                    || name.name.starts_with("aria-")
                    || (name.name.starts_with("on")
                        && name
                            .name
                            .as_bytes()
                            .get(2)
                            .is_some_and(u8::is_ascii_uppercase))
                {
                    return true;
                }
                if matches!(name.name.as_str(), "entering" | "exiting") {
                    return ctx.nodes().ancestors(ancestor.id()).any(|opening| {
                        matches!(opening.kind(), AstKind::JSXOpeningElement(opening)
                            if matches!(&opening.name, JSXElementName::MemberExpression(member)
                                if hydration_jsx_member_has_animated_root(member)))
                    });
                }
                return false;
            }
            _ => {}
        }
    }
    false
}

fn hydration_jsx_member_has_animated_root(member: &oxc_ast::ast::JSXMemberExpression<'_>) -> bool {
    match &member.object {
        oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) => {
            identifier.name == "Animated"
        }
        oxc_ast::ast::JSXMemberExpressionObject::MemberExpression(parent) => {
            hydration_jsx_member_has_animated_root(parent)
        }
        oxc_ast::ast::JSXMemberExpressionObject::ThisExpression(_) => false,
    }
}

fn hydration_is_nonvisible_animation_reference(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::ObjectProperty(property)
            if hydration_property_name(property) == Some("motionAppear"))
    })
}

fn hydration_reference_reaches_component_output(
    node_id: NodeId,
    component_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_id = node_id;
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::ReturnStatement(_) => {
                return hydration_nearest_function(ancestor.id(), ctx)
                    == Some(component_function_id);
            }
            AstKind::IfStatement(statement)
                if statement.test.span() == ctx.nodes().get_node(child_id).span()
                    && hydration_nearest_function(ancestor.id(), ctx)
                        == Some(component_function_id) =>
            {
                return ctx.nodes().iter().any(|candidate| {
                    matches!(candidate.kind(), AstKind::ReturnStatement(_))
                        && (statement
                            .consequent
                            .span()
                            .contains_inclusive(candidate.span())
                            || statement.alternate.as_ref().is_some_and(|alternate| {
                                alternate.span().contains_inclusive(candidate.span())
                            }))
                        && hydration_nearest_function(candidate.id(), ctx)
                            == Some(component_function_id)
                });
            }
            _ => {}
        }
        child_id = ancestor.id();
    }
    false
}

fn hydration_arguments_read_locale(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    call.arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(|argument| {
            ctx.nodes().iter().any(|node| {
                if !argument.span().contains_inclusive(node.span()) {
                    return false;
                }
                match node.kind() {
                    AstKind::CallExpression(call) => {
                        matches!(call.callee.get_inner_expression(),
                            Expression::StaticMemberExpression(member)
                                if matches!(member.property.name.as_str(),
                                    "toLocaleString"
                                        | "toLocaleDateString"
                                        | "toLocaleTimeString"
                                        | "getTimezoneOffset"))
                    }
                    AstKind::StaticMemberExpression(member) => {
                        matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                            if (identifier.name == "Intl"
                                || identifier.name == "navigator"
                                    && matches!(member.property.name.as_str(), "language" | "languages")))
                    }
                    AstKind::ComputedMemberExpression(member) => {
                        matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Intl")
                    }
                    _ => false,
                }
            })
        })
}

fn hydration_arguments_read_react_ref(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    call.arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(|argument| {
            ctx.nodes().iter().any(|node| {
                if !argument.span().contains_inclusive(node.span()) {
                    return false;
                }
                match node.kind() {
                    AstKind::IdentifierReference(identifier) => {
                        hydration_identifier_has_react_ref_current_origin(
                            identifier,
                            ctx,
                            &mut Vec::new(),
                        )
                    }
                    AstKind::StaticMemberExpression(member)
                        if member.property.name == "current" =>
                    {
                        hydration_react_ref_member_receiver(&member.object, ctx)
                    }
                    AstKind::ComputedMemberExpression(member)
                        if member.static_property_name().as_deref() == Some("current") =>
                    {
                        hydration_react_ref_member_receiver(&member.object, ctx)
                    }
                    _ => false,
                }
            })
        })
}

fn hydration_identifier_has_react_ref_current_origin(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).is_some_and(|initializer| {
        hydration_expression_has_react_ref_current_origin(initializer, ctx, visited_symbol_ids)
    })
}

fn hydration_expression_has_react_ref_current_origin(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression()
        && member.static_property_name() == Some("current")
    {
        return hydration_react_ref_member_receiver(member.object(), ctx);
    }
    matches!(expression, Expression::Identifier(identifier)
        if hydration_identifier_has_react_ref_current_origin(identifier, ctx, visited_symbol_ids))
}

fn hydration_react_ref_member_receiver(receiver: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return false;
    };
    hydration_identifier_is_react_ref_binding(identifier, ctx, &mut Vec::new())
}

fn hydration_identifier_is_react_ref_binding(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    match declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    {
        Some(Expression::CallExpression(call)) => is_react_api_call(call, "useRef", ctx),
        Some(Expression::Identifier(alias)) => {
            hydration_identifier_is_react_ref_binding(alias, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn hydration_arguments_read_external_dom(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    call.arguments
        .iter()
        .filter_map(Argument::as_expression)
        .any(|argument| {
            ctx.nodes().iter().any(|node| {
                let AstKind::CallExpression(candidate) = node.kind() else {
                    return false;
                };
                argument.span().contains_inclusive(candidate.span)
                    && !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                        ancestor.span() != argument.span()
                            && argument.span().contains_inclusive(ancestor.span())
                            && matches!(
                                ancestor.kind(),
                                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                            )
                    })
                    && hydration_is_proven_external_dom_call(candidate, ctx)
            })
        })
}

fn hydration_is_proven_external_dom_call<'ast>(
    call: &oxc_ast::ast::CallExpression<'ast>,
    ctx: &LintContext<'ast>,
) -> bool {
    if let Some(member) = call.callee.as_member_expression()
        && member
            .static_property_name()
            .is_some_and(|method_name| EXTERNAL_DOM_METHOD_NAMES.contains(&method_name))
        && is_proven_dom_event_target(member.object(), ctx, &mut Vec::new())
    {
        return true;
    }
    hydration_imported_external_dom_call(call, ctx)
}

fn hydration_imported_external_dom_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(import_entry) = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) else {
        return false;
    };
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return false,
    };
    if !ctx.file_path().is_absolute() {
        return false;
    }
    let Some(file_path) = hydration_resolve_first_party_module_path(
        ctx.file_path(),
        import_entry.module_request.name(),
    ) else {
        return false;
    };
    hydration_foreign_export_has_external_dom(
        &file_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    )
    .unwrap_or(false)
}

fn hydration_resolve_first_party_module_path(
    from_file_path: &HydrationPath,
    module_source: &str,
) -> Option<HydrationPathBuf> {
    if HydrationPath::new(module_source).is_absolute() {
        return None;
    }
    let resolver = HydrationResolver::new(HydrationResolveOptions {
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
        tsconfig: Some(HydrationTsconfigDiscovery::Auto),
        ..HydrationResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    if resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules")
        || resolved_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
            })
    {
        return None;
    }
    Some(resolved_path)
}

fn hydration_foreign_export_has_external_dom(
    file_path: &HydrationPath,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<HydrationPathBuf>,
) -> Option<bool> {
    if depth >= HYDRATION_CROSS_FILE_BARREL_FOLLOW_DEPTH {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).ok()?;
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let metadata = std::fs::metadata(file_path).ok()?;
    if !metadata.is_file() || metadata.len() > HYDRATION_CROSS_FILE_PARSE_MAX_BYTES {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let mut source_hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut source_hasher);
    let cache_key = (
        file_path.to_path_buf(),
        exported_name.to_string(),
        depth,
        source_hasher.finish(),
    );
    let cache = HYDRATION_IMPORTED_DOM_SYNC_CACHE.get_or_init(Default::default);
    if let Some(result) = cache
        .lock()
        .ok()
        .and_then(|results| results.get(&cache_key).copied())
    {
        return Some(result);
    }
    let source_type = HydrationSourceType::from_path(file_path).ok()?;
    let allocator = HydrationAllocator::default();
    let parser_return = HydrationParser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = HydrationSemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_id) =
        hydration_foreign_exported_function_id(exported_name, &semantic, &module_record)
    {
        let result = hydration_foreign_function_has_external_dom(function_id, &semantic);
        if let Ok(mut results) = cache.lock() {
            results.insert(cache_key, result);
        }
        return Some(result);
    }
    if hydration_foreign_has_local_export(exported_name, &module_record) {
        if let Ok(mut results) = cache.lock() {
            results.insert(cache_key, false);
        }
        return Some(false);
    }
    if let Some((module_source, imported_name)) =
        hydration_foreign_reexport_target(exported_name, &module_record)
        && let Some(reexport_path) =
            hydration_resolve_first_party_module_path(file_path, module_source)
    {
        return hydration_foreign_export_has_external_dom(
            &reexport_path,
            imported_name,
            depth + 1,
            &mut visited_paths.clone(),
        );
    }
    let mut resolved_export_all = None;
    for statement in &program.body {
        let Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(reexport_path) =
            hydration_resolve_first_party_module_path(file_path, declaration.source.value.as_str())
        else {
            continue;
        };
        let Some(candidate) = hydration_foreign_export_has_external_dom(
            &reexport_path,
            exported_name,
            depth + 1,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if resolved_export_all.is_some() {
            return None;
        }
        resolved_export_all = Some(candidate);
    }
    resolved_export_all
}

fn hydration_foreign_has_local_export(exported_name: &str, module_record: &ModuleRecord) -> bool {
    module_record.local_export_entries.iter().any(|entry| {
        matches!(&entry.export_name,
            ExportExportName::Name(name) if name.name() == exported_name)
            || matches!(&entry.export_name,
                ExportExportName::Default(_) if exported_name == "default")
    })
}

fn hydration_foreign_exported_function_id(
    exported_name: &str,
    semantic: &HydrationSemantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        let matches = match &entry.export_name {
            ExportExportName::Name(name) => name.name() == exported_name,
            ExportExportName::Default(_) => exported_name == "default",
            ExportExportName::Null => false,
        };
        matches.then(|| entry.local_name.name()).flatten()
    }) {
        let symbol_id = semantic.scoping().get_root_binding(local_name.into())?;
        return hydration_foreign_function_id_for_symbol(
            symbol_id,
            local_name,
            semantic,
            &mut Vec::new(),
        );
    }
    if exported_name != "default" {
        return None;
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                function.body.as_ref().map(|_| function.node_id.get())
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                Some(function.node_id.get())
            }
            declaration => {
                let Expression::Identifier(identifier) =
                    declaration.as_expression()?.get_inner_expression()
                else {
                    return None;
                };
                let symbol_id = semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                hydration_foreign_function_id_for_symbol(
                    symbol_id,
                    identifier.name.as_str(),
                    semantic,
                    &mut Vec::new(),
                )
            }
        }
    })
}

fn hydration_foreign_function_id_for_symbol(
    symbol_id: SymbolId,
    symbol_name: &str,
    semantic: &HydrationSemantic<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = semantic.symbol_declaration(symbol_id);
    let result = match declaration.kind() {
        AstKind::Function(function) if function.body.is_some() => Some(function.node_id.get()),
        AstKind::Function(_) => semantic.nodes().iter().find_map(|node| {
            let AstKind::Function(function) = node.kind() else {
                return None;
            };
            (function.body.is_some()
                && function
                    .id
                    .as_ref()
                    .is_some_and(|identifier| identifier.name == symbol_name))
            .then_some(function.node_id.get())
        }),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .and_then(|alias_symbol_id| {
                        hydration_foreign_function_id_for_symbol(
                            alias_symbol_id,
                            identifier.name.as_str(),
                            semantic,
                            visited_symbol_ids,
                        )
                    }),
                _ => None,
            }
        }
        _ => None,
    };
    visited_symbol_ids.pop();
    result
}

fn hydration_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
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

fn hydration_foreign_function_has_external_dom(
    function_id: NodeId,
    semantic: &HydrationSemantic<'_>,
) -> bool {
    let function_span = semantic.nodes().get_node(function_id).span();
    semantic.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        function_span.contains_inclusive(call.span)
            && hydration_foreign_nearest_function(node.id(), semantic) == Some(function_id)
            && hydration_foreign_is_external_dom_call(call, semantic)
    })
}

fn hydration_foreign_nearest_function(
    node_id: NodeId,
    semantic: &HydrationSemantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn hydration_foreign_is_external_dom_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    semantic: &HydrationSemantic<'_>,
) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member
        .static_property_name()
        .is_some_and(|method_name| EXTERNAL_DOM_METHOD_NAMES.contains(&method_name))
        && hydration_foreign_is_proven_dom_target(member.object(), semantic, &mut Vec::new())
}

fn hydration_foreign_is_proven_dom_target(
    expression: &Expression<'_>,
    semantic: &HydrationSemantic<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if symbol_id.is_none() && matches!(identifier.name.as_str(), "document" | "window") {
                return true;
            }
            let Some(symbol_id) = symbol_id else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            if hydration_foreign_symbol_has_dom_target_type(symbol_id, semantic) {
                return true;
            }
            let Some(initializer) = hydration_foreign_unreassigned_initializer(symbol_id, semantic)
            else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            hydration_foreign_is_proven_dom_target(initializer, semantic, visited_symbol_ids)
        }
        Expression::NewExpression(new_expression) => hydration_foreign_global_dom_constructor(
            &new_expression.callee,
            semantic,
            &mut Vec::new(),
        ),
        Expression::CallExpression(call_expression) => {
            let Some(member) = call_expression.callee.as_member_expression() else {
                return false;
            };
            member.static_property_name().is_some_and(|method_name| {
                matches!(
                    method_name,
                    "cloneNode"
                        | "closest"
                        | "createElement"
                        | "createElementNS"
                        | "elementFromPoint"
                        | "getElementById"
                        | "getRootNode"
                        | "querySelector"
                ) && hydration_foreign_is_proven_dom_target(
                    member.object(),
                    semantic,
                    visited_symbol_ids,
                )
            })
        }
        Expression::ConditionalExpression(conditional) => {
            let branches = [&conditional.consequent, &conditional.alternate];
            let non_nullish_branches = branches
                .into_iter()
                .filter(|branch| !hydration_foreign_is_nullish(branch, semantic))
                .collect::<Vec<_>>();
            !non_nullish_branches.is_empty()
                && non_nullish_branches.into_iter().all(|branch| {
                    hydration_foreign_is_proven_dom_target(
                        branch,
                        semantic,
                        &mut visited_symbol_ids.clone(),
                    )
                })
        }
        _ => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = member.static_property_name() else {
                return false;
            };
            let object = member.object().get_inner_expression();
            property_name == "document"
                && matches!(object, Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "window" | "globalThis")
                        && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                || matches!(
                    property_name,
                    "activeElement"
                        | "body"
                        | "documentElement"
                        | "firstElementChild"
                        | "lastElementChild"
                        | "ownerDocument"
                        | "parentElement"
                        | "parentNode"
                        | "shadowRoot"
                ) && hydration_foreign_is_proven_dom_target(
                    member.object(),
                    semantic,
                    visited_symbol_ids,
                )
        }
    }
}

fn hydration_foreign_unreassigned_initializer<'a>(
    symbol_id: SymbolId,
    semantic: &HydrationSemantic<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let AstKind::VariableDeclaration(variable) =
        semantic.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if !variable.kind.is_const()
        && semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn hydration_foreign_is_nullish(
    expression: &Expression<'_>,
    semantic: &HydrationSemantic<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    ) || matches!(expression.get_inner_expression(),
            Expression::Identifier(identifier)
                if identifier.name == "undefined"
                    && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn hydration_foreign_global_dom_constructor(
    expression: &Expression<'_>,
    semantic: &HydrationSemantic<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        if matches!(
            identifier.name.as_str(),
            "DocumentFragment" | "EventTarget" | "Image" | "Option"
        ) && semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
        {
            return true;
        }
        let Some(symbol_id) = semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if visited_symbol_ids.contains(&symbol_id) {
            return false;
        }
        let declaration = semantic.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(semantic.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        visited_symbol_ids.push(symbol_id);
        return hydration_foreign_global_dom_constructor(initializer, semantic, visited_symbol_ids);
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    member.static_property_name().is_some_and(|property_name| {
        matches!(
            property_name,
            "DocumentFragment" | "EventTarget" | "Image" | "Option"
        ) && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "window" | "globalThis")
                && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    })
}

fn hydration_foreign_symbol_has_dom_target_type(
    symbol_id: SymbolId,
    semantic: &HydrationSemantic<'_>,
) -> bool {
    let declaration = semantic.symbol_declaration(symbol_id);
    let type_annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator.type_annotation.as_ref(),
        AstKind::FormalParameter(parameter) => parameter.type_annotation.as_ref(),
        _ => None,
    };
    type_annotation.is_some_and(|annotation| {
        hydration_foreign_is_dom_target_type(&annotation.type_annotation, semantic)
    })
}

fn hydration_foreign_is_dom_target_type(
    type_node: &TSType<'_>,
    semantic: &HydrationSemantic<'_>,
) -> bool {
    match type_node {
        TSType::TSTypeReference(reference) => matches!(
            &reference.type_name,
            TSTypeName::IdentifierReference(identifier)
                if hydration_foreign_is_dom_target_type_name(identifier.name.as_str())
                    && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        ),
        TSType::TSUnionType(union) => {
            let mut saw_target = false;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)
                ) {
                    continue;
                }
                if !hydration_foreign_is_dom_target_type(member, semantic) {
                    return false;
                }
                saw_target = true;
            }
            saw_target
        }
        _ => false,
    }
}

fn hydration_foreign_is_dom_target_type_name(name: &str) -> bool {
    matches!(
        name,
        "AbortSignal"
            | "Document"
            | "DocumentFragment"
            | "Element"
            | "EventTarget"
            | "HTMLElement"
            | "HTMLAnchorElement"
            | "HTMLButtonElement"
            | "HTMLCanvasElement"
            | "HTMLDivElement"
            | "HTMLFormElement"
            | "HTMLIFrameElement"
            | "HTMLImageElement"
            | "HTMLInputElement"
            | "HTMLLabelElement"
            | "HTMLLIElement"
            | "HTMLMediaElement"
            | "HTMLParagraphElement"
            | "HTMLSelectElement"
            | "HTMLSpanElement"
            | "HTMLTableElement"
            | "HTMLTextAreaElement"
            | "HTMLUListElement"
            | "HTMLVideoElement"
            | "MediaQueryList"
            | "Node"
            | "ShadowRoot"
            | "SVGElement"
            | "SVGSVGElement"
            | "Window"
            | "XMLDocument"
    ) || ((name.starts_with("HTML") || name.starts_with("SVG"))
        && name.ends_with("Element")
        && name[if name.starts_with("HTML") { 4 } else { 3 }..name.len() - 7]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric()))
}

fn hydration_exact_viewport_effect<'context, 'ast>(
    callback_id: NodeId,
    ctx: &'context LintContext<'ast>,
) -> bool {
    if matches!(ctx.nodes().get_node(callback_id).kind(),
        AstKind::Function(function) if function.r#async)
        || matches!(ctx.nodes().get_node(callback_id).kind(),
            AstKind::ArrowFunctionExpression(function) if function.r#async)
    {
        return false;
    }
    let Some(statements) = hydration_callback_statements(callback_id, ctx) else {
        return false;
    };
    let [handler_statement, subscribe, immediate, cleanup] = statements.as_slice() else {
        return false;
    };
    let Statement::VariableDeclaration(handler_declaration) = handler_statement else {
        return false;
    };
    if !handler_declaration.kind.is_const() || handler_declaration.declarations.len() != 1 {
        return false;
    }
    let handler = &handler_declaration.declarations[0];
    let Some(handler_binding) = handler.id.get_binding_identifier() else {
        return false;
    };
    let Some(handler_function_id) = handler.init.as_ref().and_then(hydration_direct_function_id)
    else {
        return false;
    };
    let Some(handler_setter) = hydration_function_window_width_setter(handler_function_id, ctx)
    else {
        return false;
    };
    let Some(immediate_setter) = hydration_direct_window_width_setter(immediate, ctx) else {
        return false;
    };
    let Some(subscribed_symbol) =
        hydration_resize_listener_symbol(subscribe, "addEventListener", ctx)
    else {
        return false;
    };
    let Some(cleanup_symbol) = hydration_cleanup_resize_symbol(cleanup, ctx) else {
        return false;
    };
    let Some(handler_setter_symbol) = hydration_callee_symbol(handler_setter, ctx) else {
        return false;
    };
    handler_binding.symbol_id() == subscribed_symbol
        && subscribed_symbol == cleanup_symbol
        && hydration_callee_symbol(immediate_setter, ctx) == Some(handler_setter_symbol)
        && hydration_state_pair_from_symbol(handler_setter_symbol, ctx).is_some_and(|pair| {
            matches!(pair.initializer.map(Expression::get_inner_expression),
                Some(Expression::NumericLiteral(value)) if value.value == 0.0)
                && hydration_state_reaches_render(&pair, true, ctx)
        })
}

fn hydration_statement_expression<'node, 'ast>(
    statement: &'node Statement<'ast>,
) -> Option<&'node Expression<'ast>> {
    let mut expression = match statement {
        Statement::ExpressionStatement(statement) => {
            Some(statement.expression.get_inner_expression())
        }
        Statement::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .map(Expression::get_inner_expression),
        _ => None,
    }?;
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                expression = &unary.argument;
            }
            Expression::SequenceExpression(sequence)
                if sequence.expressions.len() > 1
                    && sequence.expressions[..sequence.expressions.len() - 1]
                        .iter()
                        .all(|expression| expression.get_inner_expression().is_literal()) =>
            {
                expression = sequence.expressions.last()?;
            }
            _ => return Some(expression),
        }
    }
}

fn hydration_function_single_expression<'context, 'ast>(
    function_id: NodeId,
    ctx: &'context LintContext<'ast>,
) -> Option<&'context Expression<'ast>> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) => function.get_expression(),
        AstKind::Function(function) => {
            let [Statement::ReturnStatement(statement)] =
                function.body.as_ref()?.statements.as_slice()
            else {
                return None;
            };
            statement
                .argument
                .as_ref()
                .map(Expression::get_inner_expression)
        }
        _ => None,
    }
}

fn hydration_function_window_width_setter<'context, 'ast>(
    function_id: NodeId,
    ctx: &'context LintContext<'ast>,
) -> Option<&'context oxc_ast::ast::CallExpression<'ast>> {
    if let Some(expression) = hydration_function_single_expression(function_id, ctx) {
        return hydration_window_width_setter(expression, ctx);
    }
    let statements = hydration_callback_statements(function_id, ctx)?;
    let [statement] = statements.as_slice() else {
        return None;
    };
    hydration_direct_window_width_setter(statement, ctx)
}

fn hydration_direct_window_width_setter<'node, 'ast>(
    statement: &'node Statement<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<&'node oxc_ast::ast::CallExpression<'ast>> {
    hydration_window_width_setter(hydration_statement_expression(statement)?, ctx)
}

fn hydration_window_width_setter<'node, 'ast>(
    expression: &'node Expression<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<&'node oxc_ast::ast::CallExpression<'ast>> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    if call.arguments.len() != 1 {
        return None;
    }
    let Expression::Identifier(setter) = call.callee.get_inner_expression() else {
        return None;
    };
    if !hydration_is_setter_name(setter.name.as_str()) {
        return None;
    }
    let argument = call.arguments.first()?.as_expression()?;
    let member = argument.get_inner_expression().as_member_expression()?;
    let Expression::Identifier(window) = member.object().get_inner_expression() else {
        return None;
    };
    (member.static_property_name() == Some("innerWidth")
        && window.name == "window"
        && ctx.is_reference_to_global_variable(window))
    .then_some(call)
}

fn hydration_resize_listener_symbol<'node, 'ast>(
    statement: &'node Statement<'ast>,
    method: &str,
    ctx: &LintContext<'ast>,
) -> Option<SymbolId> {
    hydration_resize_listener_expression(hydration_statement_expression(statement)?, method, ctx)
}

fn hydration_resize_listener_expression<'node, 'ast>(
    expression: &'node Expression<'ast>,
    method: &str,
    ctx: &LintContext<'ast>,
) -> Option<SymbolId> {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    if call.arguments.len() != 2 {
        return None;
    }
    let member = call.callee.as_member_expression()?;
    let Expression::Identifier(window) = member.object().get_inner_expression() else {
        return None;
    };
    if member.static_property_name() != Some(method)
        || window.name != "window"
        || !ctx.is_reference_to_global_variable(window)
        || !matches!(call.arguments.first().and_then(Argument::as_expression), Some(Expression::StringLiteral(event)) if event.value == "resize")
    {
        return None;
    }
    let Expression::Identifier(handler) = call
        .arguments
        .get(1)?
        .as_expression()?
        .get_inner_expression()
    else {
        return None;
    };
    ctx.scoping()
        .get_reference(handler.reference_id())
        .symbol_id()
}

fn hydration_cleanup_resize_symbol<'node, 'ast>(
    statement: &'node Statement<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<SymbolId> {
    let Statement::ReturnStatement(statement) = statement else {
        return None;
    };
    let function_id = hydration_direct_function_id(statement.argument.as_ref()?)?;
    if let Some(expression) = hydration_function_single_expression(function_id, ctx) {
        return hydration_resize_listener_expression(expression, "removeEventListener", ctx);
    }
    let statements = hydration_callback_statements(function_id, ctx)?;
    let [statement] = statements.as_slice() else {
        return None;
    };
    hydration_resize_listener_symbol(statement, "removeEventListener", ctx)
}

fn hydration_callee_symbol(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn hydration_state_pair_from_symbol<'a>(
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<HydrationStatePair<'a>> {
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state) =
        pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    if setter.symbol_id() != setter_symbol_id || !is_react_hook_call(call, &["useState"], ctx) {
        return None;
    }
    Some(HydrationStatePair {
        state_symbol_id: state.symbol_id(),
        state_binding_span: state.span,
        component_function_id: hydration_nearest_function(declaration.id(), ctx)?,
        initializer: call.arguments.first().and_then(Argument::as_expression),
    })
}
