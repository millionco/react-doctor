use std::collections::HashMap;

use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, ObjectPropertyKind, PropertyKind,
        VariableDeclarationKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MUTABLE_CONTAINER_CONSTRUCTORS: [&str; 4] = ["Map", "Set", "WeakMap", "WeakSet"];
const ARRAY_MUTATING_METHODS: [&str; 9] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];
const MUTATING_METHODS: [&str; 13] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
    "set",
    "add",
    "delete",
    "clear",
];
const OBJECT_MUTATING_METHODS: [&str; 4] = [
    "assign",
    "defineProperty",
    "defineProperties",
    "setPrototypeOf",
];

#[derive(Debug, Default, Clone)]
pub struct ServerNoMutableModuleState;

struct ServerMutableInitializer {
    container_kind: String,
    writable_property_names: Option<FxHashSet<String>>,
    nested_property_kinds: Option<HashMap<String, String>>,
    allows_property_deletion: bool,
}

declare_oxc_lint!(
    /// Disallows request-shared mutable state in server action modules.
    ServerNoMutableModuleState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Mutable module state on the server.",
);

impl Rule for ServerNoMutableModuleState {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !ctx
            .nodes()
            .program()
            .directives
            .iter()
            .any(|directive| directive.directive == "use server")
        {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclaration(declaration) = node.kind() else {
                continue;
            };
            if !matches!(ctx.nodes().parent_kind(node.id()), AstKind::Program(_)) {
                continue;
            }
            for declarator in &declaration.declarations {
                let variable_name = declarator
                    .id
                    .get_binding_identifier()
                    .map_or("<unnamed>", |identifier| identifier.name.as_str());
                if matches!(
                    declaration.kind,
                    VariableDeclarationKind::Let | VariableDeclarationKind::Var
                ) {
                    ctx.diagnostic(
                        OxcDiagnostic::error(format!(
                            "Module-scoped {} \"{variable_name}\" is shared by every request, so any write to it leaks state between your users.",
                            if declaration.kind == VariableDeclarationKind::Let {
                                "let"
                            } else {
                                "var"
                            }
                        ))
                        .with_label(declarator.span),
                    );
                    continue;
                }
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                let Some(initializer) = server_mutable_initializer(declarator.init.as_ref(), ctx)
                else {
                    continue;
                };
                if server_container_is_mutated(binding.symbol_id(), &initializer, ctx) {
                    ctx.diagnostic(
                        OxcDiagnostic::error(format!(
                            "Module-scoped const \"{variable_name} = {}\" leaks state between your users, since every request shares it.",
                            initializer.container_kind
                        ))
                        .with_label(declarator.span),
                    );
                }
            }
        }
    }
}

fn server_mutable_initializer(
    initializer: Option<&Expression<'_>>,
    ctx: &LintContext<'_>,
) -> Option<ServerMutableInitializer> {
    let mut initializer = initializer?.get_inner_expression();
    let mut has_integrity_wrapper = false;
    let mut allows_property_deletion = true;
    loop {
        let Expression::CallExpression(call) = initializer else {
            break;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            break;
        };
        let Some(method_name @ ("seal" | "preventExtensions")) = member.static_property_name()
        else {
            break;
        };
        if !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Object"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        {
            break;
        }
        initializer = call
            .arguments
            .first()
            .and_then(Argument::as_expression)?
            .get_inner_expression();
        has_integrity_wrapper = true;
        if method_name == "seal" {
            allows_property_deletion = false;
        }
    }
    if has_integrity_wrapper && let Expression::ObjectExpression(object) = initializer {
        let mut writable_property_names = FxHashSet::default();
        let mut nested_property_kinds = HashMap::new();
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.kind != PropertyKind::Init {
                continue;
            }
            let Some(property_name) = property.key.static_name() else {
                continue;
            };
            writable_property_names.insert(property_name.to_string());
            if let Some(kind) = server_mutable_container_kind(&property.value) {
                nested_property_kinds.insert(property_name.to_string(), kind.to_string());
            }
        }
        return Some(ServerMutableInitializer {
            container_kind: "{}".to_string(),
            writable_property_names: Some(writable_property_names),
            nested_property_kinds: Some(nested_property_kinds),
            allows_property_deletion,
        });
    }
    let kind = server_mutable_container_kind(initializer)?;
    Some(ServerMutableInitializer {
        container_kind: match kind {
            "Array" => "[]".to_string(),
            "Object" => "{}".to_string(),
            kind => format!("new {kind}()"),
        },
        writable_property_names: None,
        nested_property_kinds: None,
        allows_property_deletion: true,
    })
}

fn server_mutable_container_kind(expression: &Expression<'_>) -> Option<&'static str> {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => Some("Array"),
        Expression::ObjectExpression(_) => Some("Object"),
        Expression::NewExpression(construction) => {
            let Expression::Identifier(identifier) = construction.callee.get_inner_expression()
            else {
                return None;
            };
            MUTABLE_CONTAINER_CONSTRUCTORS
                .contains(&identifier.name.as_str())
                .then_some(match identifier.name.as_str() {
                    "Map" => "Map",
                    "Set" => "Set",
                    "WeakMap" => "WeakMap",
                    "WeakSet" => "WeakSet",
                    _ => unreachable!(),
                })
        }
        _ => None,
    }
}

fn server_container_is_mutated(
    container_symbol: SymbolId,
    initializer: &ServerMutableInitializer,
    ctx: &LintContext<'_>,
) -> bool {
    let mut symbols = vec![container_symbol];
    let mut seen = FxHashSet::from_iter([container_symbol]);
    let mut index = 0;
    while index < symbols.len() {
        let symbol_id = symbols[index];
        index += 1;
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            if let AstKind::VariableDeclarator(declarator) = parent.kind()
                && declarator.init.as_ref().is_some_and(|expression| {
                    matches!(expression, Expression::Identifier(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).node_id()
                            == reference.node_id())
                })
                && let Some(alias) = declarator.id.get_binding_identifier()
                && matches!(
                    ctx.nodes().parent_kind(parent.id()),
                    AstKind::VariableDeclaration(_)
                )
                && ctx
                    .scoping()
                    .scope_flags(ctx.scoping().symbol_scope_id(alias.symbol_id()))
                    .is_top()
                && seen.insert(alias.symbol_id())
            {
                symbols.push(alias.symbol_id());
            }
        }
    }
    symbols.into_iter().any(|symbol_id| {
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let runs_per_request =
                    server_runs_after_module_initialization(reference_node, None, ctx);
                runs_per_request
                    && server_is_allowed_direct_mutation(reference_node, initializer, ctx)
                    || server_is_mutated_through_call(
                        reference_node,
                        initializer,
                        true,
                        runs_per_request,
                        ctx,
                    )
            })
    })
}

fn server_is_allowed_direct_mutation<'a>(
    reference_node: &AstNode<'a>,
    initializer: &ServerMutableInitializer,
    ctx: &LintContext<'a>,
) -> bool {
    let chain_tip = server_member_chain_tip(reference_node, ctx);
    if chain_tip.id() == reference_node.id()
        || chain_tip.kind().as_member_expression_kind().is_none()
    {
        return false;
    }
    let parent = ctx.nodes().parent_node(chain_tip.id());
    let is_delete = matches!(parent.kind(), AstKind::UnaryExpression(unary)
        if unary.operator == UnaryOperator::Delete && unary.argument.span() == chain_tip.span());
    let is_direct_mutation = matches!(parent.kind(),
        AstKind::AssignmentExpression(assignment) if assignment.left.span() == chain_tip.span()
    ) || matches!(parent.kind(),
        AstKind::UpdateExpression(update) if update.argument.span() == chain_tip.span()
    ) || is_delete
        || matches!(parent.kind(), AstKind::CallExpression(call)
            if call.callee.span() == chain_tip.span()
                && server_member_property_name(chain_tip).is_some_and(|name| MUTATING_METHODS.contains(&name)));
    if !is_direct_mutation {
        return false;
    }
    let Some(writable_property_names) = &initializer.writable_property_names else {
        return true;
    };
    let Some((root_property_name, root_member_span)) =
        server_root_property_name(reference_node, ctx)
    else {
        return false;
    };
    if !writable_property_names.contains(root_property_name) {
        return false;
    }
    if root_member_span == chain_tip.span() {
        return initializer.allows_property_deletion || !is_delete;
    }
    let Some(nested_kind) = initializer
        .nested_property_kinds
        .as_ref()
        .and_then(|kinds| kinds.get(root_property_name))
    else {
        return false;
    };
    if let AstKind::CallExpression(call) = parent.kind()
        && call.callee.span() == chain_tip.span()
    {
        return server_member_property_name(chain_tip)
            .is_some_and(|name| server_nested_mutating_methods(nested_kind).contains(&name));
    }
    true
}

fn server_is_mutated_through_call(
    reference_node: &AstNode<'_>,
    initializer: &ServerMutableInitializer,
    may_follow_callee: bool,
    call_runs_per_request: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(reference_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    let Some(argument_index) = call.arguments.iter().position(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == reference_node.span())
    }) else {
        return false;
    };
    if let Some(member) = call.callee.as_member_expression() {
        let Some(method_name) = member.static_property_name() else {
            return false;
        };
        if !call_runs_per_request
            || argument_index != 0
            || !OBJECT_MUTATING_METHODS.contains(&method_name)
            || !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Object"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        {
            return false;
        }
        return initializer
            .writable_property_names
            .as_ref()
            .is_none_or(|properties| {
                server_known_property_object_mutation(call, method_name, properties)
            });
    }
    if !may_follow_callee {
        return false;
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some((function_node_id, parameters)) = server_local_function(declaration) else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(parameter)) = parameters
        .items
        .get(argument_index)
        .map(|parameter| &parameter.pattern)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(parameter.symbol_id())
        .any(|reference| {
            let parameter_reference = ctx.nodes().get_node(reference.node_id());
            let parameter_runs_per_request = call_runs_per_request
                || server_runs_after_module_initialization(
                    parameter_reference,
                    Some(function_node_id),
                    ctx,
                );
            parameter_runs_per_request
                && server_is_allowed_direct_mutation(parameter_reference, initializer, ctx)
                || server_is_mutated_through_call(
                    parameter_reference,
                    initializer,
                    false,
                    parameter_runs_per_request,
                    ctx,
                )
        })
}

fn server_local_function<'a, 'b>(
    declaration: &'b AstNode<'a>,
) -> Option<(NodeId, &'b oxc_ast::ast::FormalParameters<'a>)> {
    match declaration.kind() {
        AstKind::Function(function) => Some((declaration.id(), &function.params)),
        AstKind::VariableDeclarator(declarator) => match declarator.init.as_ref()? {
            Expression::ArrowFunctionExpression(function) => {
                Some((function.node_id.get(), &function.params))
            }
            Expression::FunctionExpression(function) => {
                Some((function.node_id.get(), &function.params))
            }
            _ => None,
        },
        _ => None,
    }
}

fn server_runs_after_module_initialization(
    node: &AstNode<'_>,
    boundary: Option<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if boundary == Some(ancestor.id()) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && !is_immediately_invoked_function(ancestor, ctx)
        {
            return true;
        }
    }
    false
}

fn server_member_chain_tip<'a, 'b>(
    reference_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut current = reference_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if server_is_transparent_wrapper(parent)
            || parent
                .kind()
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span() == current.span())
        {
            current = parent;
            continue;
        }
        return current;
    }
}

fn server_is_transparent_wrapper(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_)
    )
}

fn server_root_property_name<'a, 'b>(
    reference_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b str, Span)> {
    let mut current = reference_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if !server_is_transparent_wrapper(parent) {
            break;
        }
        current = parent;
    }
    let parent = ctx.nodes().parent_node(current.id());
    if parent
        .kind()
        .as_member_expression_kind()
        .is_none_or(|member| member.object().span() != current.span())
    {
        return None;
    }
    Some((server_member_property_name(parent)?, parent.span()))
}

fn server_member_property_name<'a>(node: &'a AstNode<'_>) -> Option<&'a str> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        AstKind::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn server_nested_mutating_methods(kind: &str) -> &'static [&'static str] {
    match kind {
        "Array" => &ARRAY_MUTATING_METHODS,
        "Map" => &["set", "delete", "clear"],
        "WeakMap" => &["set", "delete"],
        "Set" => &["add", "delete", "clear"],
        "WeakSet" => &["add", "delete"],
        _ => &[],
    }
}

fn server_known_property_object_mutation(
    call: &oxc_ast::ast::CallExpression<'_>,
    method_name: &str,
    writable_property_names: &FxHashSet<String>,
) -> bool {
    if method_name == "setPrototypeOf" {
        return false;
    }
    if method_name == "defineProperty" {
        return matches!(call.arguments.get(1).and_then(Argument::as_expression),
            Some(Expression::StringLiteral(literal))
                if writable_property_names.contains(literal.value.as_str()));
    }
    let Some(property_object) = call.arguments.get(1).and_then(Argument::as_expression) else {
        return !writable_property_names.is_empty();
    };
    let Expression::ObjectExpression(property_object) = property_object else {
        return !writable_property_names.is_empty();
    };
    property_object
        .properties
        .iter()
        .any(|property| match property {
            ObjectPropertyKind::SpreadProperty(_) => !writable_property_names.is_empty(),
            ObjectPropertyKind::ObjectProperty(property) => property
                .key
                .static_name()
                .as_deref()
                .is_some_and(|name| writable_property_names.contains(name)),
        })
}
