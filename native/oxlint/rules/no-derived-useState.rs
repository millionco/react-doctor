use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, ChainElement, Declaration, Expression, FormalParameter, Function,
        FunctionBody, FunctionType, MemberExpression, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const NEXTJS_PAGE_DATA_EXPORT_NAMES: [&str; 2] = ["getServerSideProps", "getStaticProps"];
const SESSION_DISMISS_PROP_NAMES: [&str; 4] = ["onClose", "onCancel", "onOpenChange", "onDismiss"];
const SNAPSHOT_STATE_NAME_PREFIXES: [&str; 11] = [
    "initial",
    "previous",
    "prev",
    "preserved",
    "saved",
    "original",
    "cached",
    "snapshot",
    "prior",
    "debounced",
    "deferred",
];

#[derive(Debug, Default, Clone)]
pub struct NoDerivedUseState;

impl RuleMeta for NoDerivedUseState {
    const NAME: &'static str = "no-derived-useState";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Warn when useState copies a prop that can later become stale.",
    };
}

impl Rule for NoDerivedUseState {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let is_nextjs_data_page = derived_is_nextjs_data_fetching_page(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_none_or(|identifier| {
                            identifier.name == "default"
                                || derived_is_uppercase_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(component) = DerivedComponent::from_function(function) {
                        derived_check_component(component, is_nextjs_data_page, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !derived_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(component) = declarator
                        .init
                        .as_ref()
                        .and_then(derived_find_inline_component)
                    else {
                        continue;
                    };
                    derived_check_component(component, is_nextjs_data_page, ctx);
                }
                AstKind::ExportDefaultDeclaration(declaration) => {
                    let Some(expression) = declaration.declaration.as_expression() else {
                        continue;
                    };
                    let Some(component) = derived_find_inline_component(expression) else {
                        continue;
                    };
                    if matches!(component, DerivedComponent::Function { function, .. } if function.r#type == FunctionType::FunctionDeclaration)
                    {
                        continue;
                    }
                    derived_check_component(component, is_nextjs_data_page, ctx);
                }
                _ => {}
            }
        }
    }
}

#[derive(Clone, Copy)]
enum DerivedComponent<'a> {
    Function {
        function: &'a Function<'a>,
        body: &'a FunctionBody<'a>,
    },
    Arrow {
        function: &'a oxc_ast::ast::ArrowFunctionExpression<'a>,
        body: &'a FunctionBody<'a>,
    },
}

impl<'a> DerivedComponent<'a> {
    fn from_function(function: &'a Function<'a>) -> Option<Self> {
        Some(Self::Function {
            function,
            body: function.body.as_deref()?,
        })
    }

    fn node_id(self) -> NodeId {
        match self {
            Self::Function { function, .. } => function.node_id.get(),
            Self::Arrow { function, .. } => function.node_id.get(),
        }
    }

    fn span(self) -> oxc_span::Span {
        match self {
            Self::Function { function, .. } => function.span,
            Self::Arrow { function, .. } => function.span,
        }
    }

    fn body(self) -> &'a FunctionBody<'a> {
        match self {
            Self::Function { body, .. } | Self::Arrow { body, .. } => body,
        }
    }

    fn parameters(self) -> &'a [FormalParameter<'a>] {
        match self {
            Self::Function { function, .. } => &function.params.items,
            Self::Arrow { function, .. } => &function.params.items,
        }
    }
}

fn derived_find_inline_component<'a>(
    expression: &'a Expression<'a>,
) -> Option<DerivedComponent<'a>> {
    match expression.get_inner_expression() {
        Expression::FunctionExpression(function) => DerivedComponent::from_function(function),
        Expression::ArrowFunctionExpression(function) => Some(DerivedComponent::Arrow {
            function,
            body: function.body.as_function_body()?,
        }),
        Expression::CallExpression(call) => call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .find_map(derived_find_inline_component),
        _ => None,
    }
}

struct DerivedStateBinding<'a> {
    state_name: Option<&'a str>,
    state_symbol_id: Option<SymbolId>,
    setter_name: Option<&'a str>,
    setter_symbol_id: Option<SymbolId>,
    call: &'a oxc_ast::ast::CallExpression<'a>,
    prop_root_name: &'a str,
}

fn derived_check_component<'a>(
    component: DerivedComponent<'a>,
    is_nextjs_data_page: bool,
    ctx: &LintContext<'a>,
) {
    let mut prop_names = FxHashSet::default();
    for parameter in component.parameters() {
        collect_binding_pattern_names(&parameter.pattern, &mut prop_names);
    }
    if prop_names.is_empty() {
        return;
    }
    let has_session_dismiss_prop = SESSION_DISMISS_PROP_NAMES
        .iter()
        .any(|name| prop_names.contains(*name));
    for binding in derived_collect_state_bindings(component, &prop_names, ctx) {
        if derived_is_initial_only_seed_name(binding.prop_root_name)
            || binding
                .state_name
                .is_some_and(derived_is_snapshot_state_name)
            || has_session_dismiss_prop
            || is_nextjs_data_page
            || derived_is_defaulted_destructured_prop(
                component.parameters(),
                binding.prop_root_name,
            )
            || derived_is_user_editable_controlled_fallback(&binding, component, &prop_names, ctx)
            || derived_is_draft_reseed_or_render_adjusted(&binding, component, &prop_names, ctx)
            || derived_is_effect_driven_resync(&binding, component, ctx)
            || derived_is_draft_committed_to_parent(&binding, component, &prop_names, ctx)
        {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see a stale value when prop \"{}\" changes because useState copies it once.",
                binding.prop_root_name
            ))
            .with_label(binding.call.span),
        );
    }
}

fn derived_collect_state_bindings<'a>(
    component: DerivedComponent<'a>,
    prop_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> Vec<DerivedStateBinding<'a>> {
    let mut bindings = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if !component.body().span.contains_inclusive(call.span)
            || derived_nearest_function_id(node.id(), ctx) != Some(component.node_id())
            || !is_react_hook_call(call, &["useState"], ctx)
        {
            continue;
        }
        let Some(seed) = call.arguments.first().and_then(Argument::as_expression) else {
            continue;
        };
        let seed = derived_unwrap_initializer_seed(seed);
        let Some(prop_root_name) = derived_prop_root_name(seed, prop_names) else {
            continue;
        };
        if let Some(member) = derived_seed_member_expression(seed)
            && !member.is_computed()
            && member
                .static_property_name()
                .is_some_and(|name| derived_is_initial_only_seed_name(&name))
        {
            continue;
        }
        let declarator = ctx.nodes().parent_node(node.id());
        let (state_name, state_symbol_id, setter_name, setter_symbol_id) = match declarator.kind() {
            AstKind::VariableDeclarator(declarator) => match &declarator.id {
                BindingPattern::ArrayPattern(pattern) => {
                    let state = pattern
                        .elements
                        .first()
                        .and_then(Option::as_ref)
                        .and_then(BindingPattern::get_binding_identifier);
                    let setter = pattern
                        .elements
                        .get(1)
                        .and_then(Option::as_ref)
                        .and_then(BindingPattern::get_binding_identifier);
                    (
                        state.map(|identifier| identifier.name.as_str()),
                        state.map(|identifier| identifier.symbol_id()),
                        setter.map(|identifier| identifier.name.as_str()),
                        setter.map(|identifier| identifier.symbol_id()),
                    )
                }
                _ => (None, None, None, None),
            },
            _ => (None, None, None, None),
        };
        bindings.push(DerivedStateBinding {
            state_name,
            state_symbol_id,
            setter_name,
            setter_symbol_id,
            call,
            prop_root_name,
        });
    }
    bindings
}

fn derived_unwrap_initializer_seed<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                expression = &unary.argument;
            }
            Expression::TemplateLiteral(template)
                if template.expressions.len() == 1
                    && template
                        .quasis
                        .iter()
                        .all(|quasi| quasi.value.raw.is_empty()) =>
            {
                expression = &template.expressions[0];
            }
            _ => return expression,
        }
    }
}

fn derived_prop_root_name<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
    prop_names: &FxHashSet<String>,
) -> Option<&'borrow str> {
    let root_name = derived_root_identifier_name(expression, false)?;
    prop_names.contains(root_name).then_some(root_name)
}

fn derived_root_identifier_name<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
    follow_call_chains: bool,
) -> Option<&'borrow str> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression if expression.as_member_expression().is_some() => derived_root_identifier_name(
            expression.as_member_expression()?.object(),
            follow_call_chains,
        ),
        Expression::CallExpression(call) if follow_call_chains => {
            let member = call.callee.get_inner_expression().as_member_expression()?;
            derived_root_identifier_name(member.object(), true)
        }
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) if follow_call_chains => {
                let member = call.callee.get_inner_expression().as_member_expression()?;
                derived_root_identifier_name(member.object(), true)
            }
            ChainElement::TSNonNullExpression(non_null) => {
                derived_root_identifier_name(&non_null.expression, follow_call_chains)
            }
            chain_element => derived_root_identifier_name(
                chain_element.as_member_expression()?.object(),
                follow_call_chains,
            ),
        },
        _ => None,
    }
}

fn derived_seed_member_expression<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
) -> Option<&'borrow MemberExpression<'ast>> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return Some(member);
    }
    let Expression::ChainExpression(chain) = expression else {
        return None;
    };
    match &chain.expression {
        ChainElement::TSNonNullExpression(non_null) => {
            derived_seed_member_expression(&non_null.expression)
        }
        chain_element => chain_element.as_member_expression(),
    }
}

fn derived_is_user_editable_controlled_fallback<'a>(
    binding: &DerivedStateBinding<'a>,
    component: DerivedComponent<'a>,
    prop_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let (Some(state_name), Some(state_symbol_id), Some(setter_symbol_id)) = (
        binding.state_name,
        binding.state_symbol_id,
        binding.setter_symbol_id,
    ) else {
        return false;
    };
    if !derived_is_internal_state_name(state_name) {
        return false;
    }
    let has_controlled_fallback = ctx.nodes().iter().any(|node| {
        component.span().contains_inclusive(node.span())
            && derived_nearest_function_id(node.id(), ctx) == Some(component.node_id())
            && match node.kind() {
                AstKind::ConditionalExpression(conditional) => {
                    let consequent = derived_unwrap_initializer_seed(&conditional.consequent);
                    let alternate = derived_unwrap_initializer_seed(&conditional.alternate);
                    derived_is_state_reference(consequent, state_symbol_id, ctx)
                        && derived_is_prop_argument(alternate, prop_names)
                        || derived_is_prop_argument(consequent, prop_names)
                            && derived_is_state_reference(alternate, state_symbol_id, ctx)
                }
                AstKind::LogicalExpression(logical)
                    if logical.operator == LogicalOperator::Coalesce =>
                {
                    derived_is_prop_argument(
                        derived_unwrap_initializer_seed(&logical.left),
                        prop_names,
                    ) && derived_is_state_reference(
                        derived_unwrap_initializer_seed(&logical.right),
                        state_symbol_id,
                        ctx,
                    )
                }
                _ => false,
            }
    });
    has_controlled_fallback
        && ctx
            .scoping()
            .get_resolved_references(setter_symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let root = transparent_expression_root(reference_node, ctx);
                let parent = ctx.nodes().parent_node(root.id());
                let AstKind::CallExpression(call) = parent.kind() else {
                    return false;
                };
                if call.callee.span() != root.span()
                    || !derived_is_handler_shaped_reseed(parent, component, ctx)
                {
                    return false;
                }
                call.arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        !derived_is_prop_argument(
                            derived_unwrap_initializer_seed(argument),
                            prop_names,
                        )
                    })
            })
}

fn derived_is_draft_reseed_or_render_adjusted<'a>(
    binding: &DerivedStateBinding<'a>,
    component: DerivedComponent<'a>,
    prop_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(setter_name) = binding.setter_name else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        if !component.span().contains_inclusive(call.span) {
            return false;
        }
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        if callee.name != setter_name {
            return false;
        }
        let argument = call.arguments.first().and_then(Argument::as_expression);
        let is_prop_derived =
            argument.is_some_and(|argument| derived_is_prop_argument(argument, prop_names));
        if derived_is_handler_shaped_reseed(node, component, ctx)
            && (is_prop_derived
                || argument.is_some_and(|argument| {
                    derived_is_component_scope_value_argument(node, component, argument, ctx)
                }))
        {
            return true;
        }
        if derived_is_in_render_scope(node, component, ctx)
            && (is_prop_derived
                || binding.state_name.is_some_and(|state_name| {
                    derived_is_guarded_by_state_reference(node, component, state_name, ctx)
                }))
        {
            return true;
        }
        argument.is_some_and(derived_is_function_expression)
            && derived_is_inside_non_handler_hook_callback(node, component, ctx)
    })
}

fn derived_is_effect_driven_resync<'a>(
    binding: &DerivedStateBinding<'a>,
    component: DerivedComponent<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(setter_name) = binding.setter_name else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        matches!(node.kind(), AstKind::CallExpression(call)
            if component.span().contains_inclusive(call.span)
                && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == setter_name)
                && derived_enclosing_effect_callback(node, component, ctx).is_some())
    })
}

fn derived_is_draft_committed_to_parent<'a>(
    binding: &DerivedStateBinding<'a>,
    component: DerivedComponent<'a>,
    prop_names: &FxHashSet<String>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(state_name) = binding.state_name else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        if !component.span().contains_inclusive(call.span)
            || !matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if prop_names.contains(identifier.name.as_str()))
            || derived_is_in_render_scope(node, component, ctx)
        {
            return false;
        }
        call.arguments
            .iter()
            .filter_map(Argument::as_expression)
            .any(|argument| derived_root_identifier_name(argument, true) == Some(state_name))
    })
}

fn derived_is_component_scope_value_argument(
    setter_call: &AstNode<'_>,
    component: DerivedComponent<'_>,
    argument: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if matches!(
        argument.get_inner_expression(),
        Expression::ChainExpression(_)
    ) {
        return false;
    }
    let Some(root_name) = derived_root_identifier_name(argument, false) else {
        return false;
    };
    for ancestor in ctx.nodes().ancestors(setter_call.id()) {
        if ancestor.id() == component.node_id() {
            return true;
        }
        if let Some(parameters) = derived_function_parameters(ancestor)
            && parameters.iter().any(|parameter| {
                let mut names = FxHashSet::default();
                collect_binding_pattern_names(&parameter.pattern, &mut names);
                names.contains(root_name)
            })
        {
            return false;
        }
    }
    false
}

fn derived_is_guarded_by_state_reference(
    setter_call: &AstNode<'_>,
    component: DerivedComponent<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(setter_call.id()) {
        if ancestor.id() == component.node_id() {
            return false;
        }
        let test_span = match ancestor.kind() {
            AstKind::IfStatement(statement) => Some(statement.test.span()),
            AstKind::ConditionalExpression(expression) => Some(expression.test.span()),
            _ => None,
        };
        if test_span.is_some_and(|span| {
            ctx.nodes().iter().any(|node| {
                span.contains_inclusive(node.span())
                    && matches!(node.kind(), AstKind::IdentifierReference(identifier) if identifier.name == state_name)
            })
        }) {
            return true;
        }
    }
    false
}

fn derived_is_handler_shaped_reseed(
    setter_call: &AstNode<'_>,
    component: DerivedComponent<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut has_nested_function = false;
    for ancestor in ctx.nodes().ancestors(setter_call.id()) {
        if ancestor.id() == component.node_id() {
            return has_nested_function;
        }
        if derived_function_parameters(ancestor).is_some() {
            has_nested_function = true;
            if derived_is_non_handler_hook_callback(ancestor, ctx) {
                return false;
            }
        }
    }
    false
}

fn derived_is_inside_non_handler_hook_callback(
    node: &AstNode<'_>,
    component: DerivedComponent<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == component.node_id() {
            return false;
        }
        if derived_function_parameters(ancestor).is_some()
            && derived_is_non_handler_hook_callback(ancestor, ctx)
        {
            return true;
        }
    }
    false
}

fn derived_enclosing_effect_callback<'a, 'b>(
    node: &'b AstNode<'a>,
    component: DerivedComponent<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == component.node_id() {
            return None;
        }
        if derived_function_parameters(ancestor).is_none() {
            continue;
        }
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        let Some(callee_name) = derived_callee_name(call) else {
            continue;
        };
        if derived_is_effect_hook_name(callee_name)
            && call
                .arguments
                .iter()
                .any(|argument| argument.span() == ancestor.span())
        {
            return Some(ancestor);
        }
    }
    None
}

fn derived_is_non_handler_hook_callback(
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call
        .arguments
        .iter()
        .any(|argument| argument.span() == function_node.span())
    {
        return false;
    }
    derived_callee_name(call)
        .is_some_and(|name| crate::utils::is_react_hook_name(name) && name != "useCallback")
}

fn derived_is_in_render_scope(
    node: &AstNode<'_>,
    component: DerivedComponent<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == component.node_id() {
            return true;
        }
        if derived_function_parameters(ancestor).is_some() {
            return false;
        }
    }
    false
}

fn derived_is_state_reference(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id))
}

fn derived_is_prop_argument(expression: &Expression<'_>, prop_names: &FxHashSet<String>) -> bool {
    derived_root_identifier_name(expression, false).is_some_and(|name| prop_names.contains(name))
}

fn derived_function_parameters<'a, 'b>(node: &'b AstNode<'a>) -> Option<&'b [FormalParameter<'a>]> {
    match node.kind() {
        AstKind::Function(function) => Some(&function.params.items),
        AstKind::ArrowFunctionExpression(function) => Some(&function.params.items),
        _ => None,
    }
}

fn derived_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        derived_function_parameters(ancestor)
            .is_some()
            .then_some(ancestor.id())
    })
}

fn derived_callee_name<'a, 'b>(call: &'b oxc_ast::ast::CallExpression<'a>) -> Option<&'b str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => derived_member_identifier_property_name(expression.as_member_expression()?),
    }
}

fn derived_member_identifier_property_name<'a, 'b>(
    member: &'b oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'b str> {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = member.expression.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn derived_is_effect_hook_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("use") else {
        return false;
    };
    suffix == "Effect"
        || suffix.strip_suffix("Effect").is_some_and(|middle| {
            middle
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
        })
}

fn derived_is_function_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

fn derived_is_nextjs_data_fetching_page(ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .program()
        .body
        .iter()
        .any(|statement| match statement {
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    function.id.as_ref().is_some_and(|identifier| {
                        NEXTJS_PAGE_DATA_EXPORT_NAMES.contains(&identifier.name.as_str())
                    })
                }
                Declaration::VariableDeclaration(declaration) => {
                    declaration.declarations.iter().any(|declarator| {
                        matches!(&declarator.id, BindingPattern::BindingIdentifier(identifier)
                            if NEXTJS_PAGE_DATA_EXPORT_NAMES.contains(&identifier.name.as_str()))
                    })
                }
                _ => false,
            },
            _ => false,
        })
}

fn derived_is_defaulted_destructured_prop(
    parameters: &[FormalParameter<'_>],
    prop_name: &str,
) -> bool {
    parameters
        .iter()
        .any(|parameter| derived_pattern_has_default_name(&parameter.pattern, prop_name))
}

fn derived_pattern_has_default_name(pattern: &BindingPattern<'_>, prop_name: &str) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(_) => false,
        BindingPattern::AssignmentPattern(assignment) => {
            matches!(&assignment.left, BindingPattern::BindingIdentifier(identifier) if identifier.name == prop_name)
                || derived_pattern_has_default_name(&assignment.left, prop_name)
        }
        BindingPattern::ObjectPattern(object) => {
            object
                .properties
                .iter()
                .any(|property| derived_pattern_has_default_name(&property.value, prop_name))
                || object
                    .rest
                    .as_ref()
                    .is_some_and(|rest| derived_pattern_has_default_name(&rest.argument, prop_name))
        }
        BindingPattern::ArrayPattern(array) => {
            array
                .elements
                .iter()
                .flatten()
                .any(|element| derived_pattern_has_default_name(element, prop_name))
                || array
                    .rest
                    .as_ref()
                    .is_some_and(|rest| derived_pattern_has_default_name(&rest.argument, prop_name))
        }
    }
}

fn derived_is_initial_only_seed_name(name: &str) -> bool {
    matches!(
        name,
        "initialValue"
            | "defaultValue"
            | "seedValue"
            | "initial"
            | "autoFocus"
            | "autoPlay"
            | "startOpen"
    ) || [
        "initial", "default", "seed", "starting", "baseline", "preset",
    ]
    .iter()
    .any(|prefix| derived_has_uppercase_suffix(name, prefix))
        || derived_has_uppercase_suffix(name, "initially")
        || name.match_indices("Initial").any(|(index, fragment)| {
            name.as_bytes()
                .get(index + fragment.len())
                .is_none_or(u8::is_ascii_uppercase)
        })
}

fn derived_is_snapshot_state_name(name: &str) -> bool {
    SNAPSHOT_STATE_NAME_PREFIXES
        .iter()
        .any(|prefix| derived_has_boundary_suffix(name, prefix))
}

fn derived_is_internal_state_name(name: &str) -> bool {
    ["internal", "uncontrolled"]
        .iter()
        .any(|prefix| derived_has_boundary_suffix(name, prefix))
}

fn derived_has_uppercase_suffix(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix)
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn derived_has_boundary_suffix(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.is_empty()
            || suffix
                .as_bytes()
                .first()
                .is_some_and(|byte| byte.is_ascii_uppercase() || *byte == b'_')
    })
}

fn derived_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
