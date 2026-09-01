use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, ExportDefaultDeclarationKind, Expression, FormalParameters,
        FunctionType, JSXAttributeName, JSXAttributeValue, JSXElementName, ObjectPropertyKind,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{SourceType, Span, VALID_EXTENSIONS};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const DEPENDENCY_HOOK_NAMES: [&str; 6] = [
    "useEffect",
    "useLayoutEffect",
    "useMemo",
    "useCallback",
    "useInsertionEffect",
    "useImperativeHandle",
];
const COMPONENT_WRAPPER_NAMES: [&str; 4] = ["memo", "forwardRef", "observer", "lazy"];
const MEMOIZING_COMPONENT_WRAPPER_NAMES: [&str; 5] = [
    "memo",
    "observer",
    "observable",
    "withTracking",
    "React.memo",
];
const MAX_COMPARATOR_SYMBOLIC_ATOM_COUNT: usize = 8;
const OBJECT_PROTOTYPE_PROPERTY_NAMES: [&str; 12] = [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];
const CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH: usize = 4;

#[derive(Debug, Default, Clone)]
pub struct RerenderMemoWithDefaultValue;

#[derive(Clone, Copy)]
enum EmptyDefaultKind {
    Array,
    Object,
}

#[derive(Clone, Copy)]
enum IdentitySensitiveUse {
    DependencyArray,
    MemoizedProp,
}

#[derive(Clone, Copy)]
struct DefaultedBinding {
    symbol_id: SymbolId,
    span: Span,
    kind: EmptyDefaultKind,
}

#[derive(Clone)]
struct HookParameterBinding {
    symbol_id: SymbolId,
    default_kind: Option<EmptyDefaultKind>,
    parameter_index: usize,
    property_name: Option<String>,
}

#[derive(Clone)]
struct ImportedHookDefault {
    kind: EmptyDefaultKind,
    parameter_index: usize,
    property_name: Option<String>,
}

#[derive(Clone, Default)]
struct HookTaint {
    list_symbol_ids: FxHashSet<SymbolId>,
    value_symbol_ids: FxHashSet<SymbolId>,
}

#[derive(Clone)]
enum ComparatorFormula {
    Constant(bool),
    Atom(String),
    Not(Box<ComparatorFormula>),
    And(Box<ComparatorFormula>, Box<ComparatorFormula>),
    Or(Box<ComparatorFormula>, Box<ComparatorFormula>),
    Conditional {
        test: Box<ComparatorFormula>,
        consequent: Box<ComparatorFormula>,
        alternate: Box<ComparatorFormula>,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ComparatorPropOwner {
    Previous,
    Next,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ComparatorReferenceOrigin {
    PreviousTarget,
    NextTarget,
    Expression(u32),
}

#[derive(Clone)]
enum ComparatorValue {
    Boolean(bool),
    Formula(ComparatorFormula),
    Number(f64),
    String(String),
    Undefined,
    PreviousProps,
    NextProps,
    PropSymbol {
        owner: ComparatorPropOwner,
        name: String,
    },
    EmptyArray(ComparatorReferenceOrigin),
    EmptyObject(ComparatorReferenceOrigin),
    Unknown,
}

struct ComparatorEvaluationState<'source, 'name, 'ctx> {
    bindings: FxHashMap<SymbolId, ComparatorValue>,
    active_functions: FxHashSet<NodeId>,
    empty_references_are_equal: bool,
    kind: EmptyDefaultKind,
    prop_name: &'name str,
    ctx: &'ctx LintContext<'source>,
}

declare_oxc_lint!(
    /// Warns when an empty prop default defeats dependency or component memoization.
    RerenderMemoWithDefaultValue,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an empty prop default defeats memoization.",
);

impl Rule for RerenderMemoWithDefaultValue {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            rerender_default_is_component_name(identifier.name.as_str())
                        }) =>
                {
                    if function.body.is_none() {
                        continue;
                    }
                    rerender_default_check_function(node.id(), &function.params, ctx);
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    if !rerender_default_is_component_name(binding.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    let Some(function_node) =
                        rerender_default_unwrap_component_function(initializer, ctx)
                    else {
                        continue;
                    };
                    match function_node.kind() {
                        AstKind::ArrowFunctionExpression(function) => {
                            if function.body.as_function_body().is_some() {
                                rerender_default_check_function(
                                    function_node.id(),
                                    &function.params,
                                    ctx,
                                );
                            }
                        }
                        AstKind::Function(function) => {
                            if function.body.is_some() {
                                rerender_default_check_function(
                                    function_node.id(),
                                    &function.params,
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        rerender_default_check_forwarded_custom_hook_defaults(ctx);
    }
}

fn rerender_default_check_function<'a>(
    function_id: NodeId,
    parameters: &'a FormalParameters<'a>,
    ctx: &LintContext<'a>,
) {
    let mut bindings = Vec::new();
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        let pattern = if parameter_index == 0 {
            rerender_default_unwrap_assignment_pattern(&parameter.pattern)
        } else {
            &parameter.pattern
        };
        rerender_default_collect_object_defaults(pattern, &mut bindings);
    }
    if parameters.items.is_empty()
        && let Some(rest) = &parameters.rest
        && let BindingPattern::ArrayPattern(array) = &rest.rest.argument
        && array.elements.len() == 1
        && let Some(pattern) = array.elements.first().and_then(Option::as_ref)
    {
        rerender_default_collect_object_defaults(pattern, &mut bindings);
    }
    let props_symbol = parameters
        .items
        .first()
        .and_then(|parameter| rerender_default_direct_binding_symbol(&parameter.pattern));
    if let Some(props_symbol) = props_symbol {
        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            if !rerender_default_is_top_level_function_declarator(node.id(), function_id, ctx) {
                continue;
            }
            let Some(Expression::Identifier(initializer)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if ctx
                .scoping()
                .get_reference(initializer.reference_id())
                .symbol_id()
                != Some(props_symbol)
            {
                continue;
            }
            rerender_default_collect_object_defaults(&declarator.id, &mut bindings);
        }
    }
    if bindings.is_empty() {
        return;
    }
    let mut uses = FxHashMap::default();
    for node in ctx.nodes().iter() {
        if !rerender_default_is_function_descendant(node.id(), function_id, ctx) {
            continue;
        }
        match node.kind() {
            AstKind::CallExpression(call)
                if rerender_default_is_dependency_hook_call(call, ctx) =>
            {
                for array in call.arguments.iter().filter_map(Argument::as_expression) {
                    let Expression::ArrayExpression(array) = array.get_inner_expression() else {
                        continue;
                    };
                    for expression in array.elements.iter().filter_map(|element| {
                        oxc_ast::ast::ArrayExpressionElement::as_expression(element)
                    }) {
                        if let Some(symbol_id) = rerender_default_identifier_symbol(expression, ctx)
                            && bindings
                                .iter()
                                .any(|binding| binding.symbol_id == symbol_id)
                        {
                            uses.entry(symbol_id)
                                .or_insert(IdentitySensitiveUse::DependencyArray);
                        }
                    }
                }
            }
            AstKind::JSXAttribute(attribute) => {
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    continue;
                };
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                let Some(symbol_id) = rerender_default_identifier_symbol(expression, ctx) else {
                    continue;
                };
                let Some(binding) = bindings
                    .iter()
                    .find(|binding| binding.symbol_id == symbol_id)
                else {
                    continue;
                };
                let AstKind::JSXOpeningElement(opening) = ctx.nodes().parent_node(node.id()).kind()
                else {
                    continue;
                };
                let attribute_name = match &attribute.name {
                    JSXAttributeName::Identifier(identifier) => identifier.name.as_str(),
                    JSXAttributeName::NamespacedName(_) => continue,
                };
                if rerender_default_jsx_consumer_compares_identity(
                    &opening.name,
                    attribute_name,
                    binding.kind,
                    ctx,
                ) {
                    uses.entry(symbol_id)
                        .or_insert(IdentitySensitiveUse::MemoizedProp);
                }
            }
            _ => {}
        }
    }
    for binding in bindings {
        let Some(identity_use) = uses.get(&binding.symbol_id) else {
            continue;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(rerender_default_message(binding.kind, *identity_use))
                .with_label(binding.span),
        );
    }
}

fn rerender_default_unwrap_assignment_pattern<'a>(
    pattern: &'a BindingPattern<'a>,
) -> &'a BindingPattern<'a> {
    match pattern {
        BindingPattern::AssignmentPattern(assignment) => &assignment.left,
        _ => pattern,
    }
}

fn rerender_default_is_top_level_function_declarator(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.nodes().parent_node(node_id);
    if !matches!(declaration.kind(), AstKind::VariableDeclaration(_)) {
        return false;
    }
    let body = ctx.nodes().parent_node(declaration.id());
    matches!(body.kind(), AstKind::FunctionBody(_))
        && ctx
            .nodes()
            .ancestors(body.id())
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .is_some_and(|ancestor| ancestor.id() == function_id)
}

fn rerender_default_collect_object_defaults(
    pattern: &BindingPattern<'_>,
    bindings: &mut Vec<DefaultedBinding>,
) {
    let BindingPattern::ObjectPattern(object) = pattern else {
        return;
    };
    for property in &object.properties {
        let BindingPattern::AssignmentPattern(assignment) = &property.value else {
            continue;
        };
        let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
            continue;
        };
        let kind = match &assignment.right {
            Expression::ArrayExpression(array) if array.elements.is_empty() => {
                EmptyDefaultKind::Array
            }
            Expression::ObjectExpression(object) if object.properties.is_empty() => {
                EmptyDefaultKind::Object
            }
            _ => continue,
        };
        bindings.push(DefaultedBinding {
            symbol_id: identifier.symbol_id(),
            span: assignment.right.span(),
            kind,
        });
    }
}

fn rerender_default_direct_binding_symbol(pattern: &BindingPattern<'_>) -> Option<SymbolId> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => {
            rerender_default_direct_binding_symbol(&assignment.left)
        }
        _ => None,
    }
}

fn rerender_default_identifier_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn rerender_default_is_dependency_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_react_hook_call(call, &DEPENDENCY_HOOK_NAMES, ctx)
}

fn rerender_default_is_function_descendant(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .any(|ancestor| ancestor.id() == function_id)
}

fn rerender_default_is_direct_function_descendant(
    node_id: NodeId,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .is_some_and(|ancestor| ancestor.id() == function_id)
}

fn rerender_default_unwrap_component_function<'a, 'ctx>(
    initializer: &'a Expression<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    let mut expression = initializer.get_inner_expression();
    loop {
        match expression {
            Expression::ArrowFunctionExpression(function) => {
                return ctx.nodes().iter().find(|node| node.span() == function.span);
            }
            Expression::FunctionExpression(function) => {
                return ctx.nodes().iter().find(|node| node.span() == function.span);
            }
            Expression::CallExpression(call)
                if rerender_default_is_component_wrapper_call(call, ctx) =>
            {
                expression = call
                    .arguments
                    .first()?
                    .as_expression()?
                    .get_inner_expression();
            }
            _ => return None,
        }
    }
}

fn rerender_default_is_component_wrapper_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    rerender_default_wrapper_name(&call.callee)
        .is_some_and(|name| COMPONENT_WRAPPER_NAMES.contains(&name))
        || is_react_api_call(call, "memo", ctx)
}

fn rerender_default_wrapper_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

fn rerender_default_jsx_consumer_compares_identity(
    name: &JSXElementName<'_>,
    prop_name: &str,
    kind: EmptyDefaultKind,
    ctx: &LintContext<'_>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = name else {
        return true;
    };
    if identifier
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_lowercase)
    {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    if let Some(root_symbol_id) = ctx
        .scoping()
        .get_root_binding(identifier.name.as_str().into())
        && root_symbol_id != symbol_id
    {
        if rerender_default_symbol_is_memoized_component(root_symbol_id, ctx) {
            return true;
        }
        if rerender_default_symbol_is_plain_function_component(root_symbol_id, ctx) {
            return false;
        }
    }
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::Function(_) => false,
        AstKind::VariableDeclarator(declarator) => {
            let Some(initializer) = &declarator.init else {
                return true;
            };
            let Expression::CallExpression(call) = initializer.get_inner_expression() else {
                return !matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                );
            };
            let is_proven_react_memo = is_react_api_call(call, "memo", ctx);
            let wrapper_name = if is_proven_react_memo {
                "memo"
            } else if let Some(wrapper_name) = rerender_default_wrapper_name(&call.callee) {
                wrapper_name
            } else {
                return true;
            };
            if !COMPONENT_WRAPPER_NAMES.contains(&wrapper_name) {
                return true;
            }
            if wrapper_name != "memo" {
                return true;
            }
            if !is_proven_react_memo {
                return true;
            }
            let Some(comparator) = call.arguments.get(1).and_then(Argument::as_expression) else {
                return true;
            };
            !rerender_default_comparator_proves_empty_equal(comparator, prop_name, kind, ctx)
        }
        _ => true,
    }
}

fn rerender_default_symbol_is_memoized_component(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if is_react_api_call(call, "memo", ctx) {
        return true;
    }
    let wrapper_name = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.to_string(),
        Expression::StaticMemberExpression(member) => {
            let Expression::Identifier(object) = member.object.get_inner_expression() else {
                return false;
            };
            format!("{}.{}", object.name, member.property.name)
        }
        _ => return false,
    };
    MEMOIZING_COMPONENT_WRAPPER_NAMES.contains(&wrapper_name.as_str())
}

fn rerender_default_symbol_is_plain_function_component(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::Function(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
        }
        _ => false,
    }
}

fn rerender_default_comparator_proves_empty_equal<'a>(
    comparator: &Expression<'a>,
    prop_name: &str,
    kind: EmptyDefaultKind,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function_node) =
        rerender_default_resolve_exact_function(comparator, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    let Some((parameters, returned_expression, is_async_or_generator)) =
        rerender_default_comparator_function_parts(function_node)
    else {
        return false;
    };
    if is_async_or_generator || parameters.rest.is_some() || parameters.items.len() != 2 {
        return false;
    }
    let Some(previous_symbol_id) = parameters.items[0]
        .pattern
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
    else {
        return false;
    };
    let Some(next_symbol_id) = parameters.items[1]
        .pattern
        .get_binding_identifier()
        .map(|identifier| identifier.symbol_id())
    else {
        return false;
    };
    let mut bindings = FxHashMap::default();
    bindings.insert(previous_symbol_id, ComparatorValue::PreviousProps);
    bindings.insert(next_symbol_id, ComparatorValue::NextProps);
    let evaluate = |empty_references_are_equal| {
        let state = ComparatorEvaluationState {
            bindings: bindings.clone(),
            active_functions: FxHashSet::from_iter([function_node.id()]),
            empty_references_are_equal,
            kind,
            prop_name,
            ctx,
        };
        rerender_default_comparator_evaluate_expression(returned_expression, &state).into_formula()
    };
    let Some(distinct_reference_formula) = evaluate(false) else {
        return false;
    };
    let Some(shared_reference_formula) = evaluate(true) else {
        return false;
    };
    !rerender_default_stable_reference_could_prevent_render(
        &distinct_reference_formula,
        &shared_reference_formula,
    )
}

fn rerender_default_single_return_expression<'a>(
    body: &'a oxc_ast::ast::FunctionBody<'a>,
) -> Option<&'a Expression<'a>> {
    let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
        return None;
    };
    statement.argument.as_ref()
}

impl ComparatorValue {
    fn into_formula(self) -> Option<ComparatorFormula> {
        match self {
            Self::Boolean(value) => Some(ComparatorFormula::Constant(value)),
            Self::Formula(formula) => Some(formula),
            _ => None,
        }
    }
}

fn rerender_default_resolve_exact_function<'a, 'ctx>(
    expression: &Expression<'a>,
    ctx: &'ctx LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'ctx AstNode<'a>> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::FunctionExpression(function) => {
            Some(ctx.nodes().get_node(function.node_id.get()))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_) => Some(declaration),
                AstKind::VariableDeclarator(declarator) => rerender_default_resolve_exact_function(
                    declarator.init.as_ref()?,
                    ctx,
                    visited_symbol_ids,
                ),
                _ => None,
            }
        }
        _ => None,
    }
}

fn rerender_default_comparator_function_parts<'a, 'ctx>(
    function_node: &'ctx AstNode<'a>,
) -> Option<(&'ctx FormalParameters<'a>, &'ctx Expression<'a>, bool)> {
    match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) => Some((
            &function.params,
            function.get_expression().or_else(|| {
                function
                    .body
                    .as_function_body()
                    .and_then(|body| rerender_default_single_return_expression(body))
            })?,
            function.r#async,
        )),
        AstKind::Function(function) => Some((
            &function.params,
            function
                .body
                .as_ref()
                .and_then(|body| rerender_default_single_return_expression(body))?,
            function.r#async || function.generator,
        )),
        _ => None,
    }
}

fn rerender_default_comparator_formula_not(formula: ComparatorFormula) -> ComparatorFormula {
    match formula {
        ComparatorFormula::Constant(value) => ComparatorFormula::Constant(!value),
        ComparatorFormula::Not(operand) => *operand,
        formula => ComparatorFormula::Not(Box::new(formula)),
    }
}

fn rerender_default_comparator_formula_combine(
    operator: LogicalOperator,
    left: ComparatorFormula,
    right: ComparatorFormula,
) -> ComparatorFormula {
    match (operator, &left, &right) {
        (LogicalOperator::And, ComparatorFormula::Constant(false), _)
        | (LogicalOperator::Or, ComparatorFormula::Constant(true), _) => left,
        (LogicalOperator::And, _, ComparatorFormula::Constant(false))
        | (LogicalOperator::Or, _, ComparatorFormula::Constant(true)) => right,
        (LogicalOperator::And, ComparatorFormula::Constant(true), _) => right,
        (LogicalOperator::And, _, ComparatorFormula::Constant(true)) => left,
        (LogicalOperator::Or, ComparatorFormula::Constant(false), _) => right,
        (LogicalOperator::Or, _, ComparatorFormula::Constant(false)) => left,
        (LogicalOperator::And, _, _) => ComparatorFormula::And(Box::new(left), Box::new(right)),
        (LogicalOperator::Or, _, _) => ComparatorFormula::Or(Box::new(left), Box::new(right)),
        _ => ComparatorFormula::Constant(false),
    }
}

fn rerender_default_comparator_formula_equality(
    left: ComparatorFormula,
    right: ComparatorFormula,
) -> ComparatorFormula {
    let both_true = rerender_default_comparator_formula_combine(
        LogicalOperator::And,
        left.clone(),
        right.clone(),
    );
    let both_false = rerender_default_comparator_formula_combine(
        LogicalOperator::And,
        rerender_default_comparator_formula_not(left),
        rerender_default_comparator_formula_not(right),
    );
    rerender_default_comparator_formula_combine(LogicalOperator::Or, both_true, both_false)
}

fn rerender_default_comparator_evaluate_equality(
    left: ComparatorValue,
    right: ComparatorValue,
    empty_references_are_equal: bool,
    is_strict: bool,
) -> ComparatorValue {
    if matches!(left, ComparatorValue::Unknown) || matches!(right, ComparatorValue::Unknown) {
        return ComparatorValue::Unknown;
    }
    let left_formula = left.clone().into_formula();
    let right_formula = right.clone().into_formula();
    if left_formula.is_some() || right_formula.is_some() {
        return match (left_formula, right_formula) {
            (Some(left_formula), Some(right_formula)) => ComparatorValue::Formula(
                rerender_default_comparator_formula_equality(left_formula, right_formula),
            ),
            _ => ComparatorValue::Unknown,
        };
    }
    match (&left, &right) {
        (
            ComparatorValue::PropSymbol {
                owner: left_owner,
                name: left_name,
            },
            ComparatorValue::PropSymbol {
                owner: right_owner,
                name: right_name,
            },
        ) => {
            if left_owner == right_owner && left_name == right_name {
                return ComparatorValue::Boolean(true);
            }
            if left_owner == right_owner || left_name != right_name {
                return ComparatorValue::Unknown;
            }
            return ComparatorValue::Formula(ComparatorFormula::Atom(format!(
                "{}:{left_name}",
                if is_strict { "strict" } else { "loose" }
            )));
        }
        (ComparatorValue::PropSymbol { .. }, _) | (_, ComparatorValue::PropSymbol { .. }) => {
            return ComparatorValue::Unknown;
        }
        _ => {}
    }
    match (left, right) {
        (ComparatorValue::EmptyArray(left), ComparatorValue::EmptyArray(right))
        | (ComparatorValue::EmptyObject(left), ComparatorValue::EmptyObject(right)) => {
            let compares_target_references = matches!(
                (left, right),
                (
                    ComparatorReferenceOrigin::PreviousTarget,
                    ComparatorReferenceOrigin::NextTarget
                ) | (
                    ComparatorReferenceOrigin::NextTarget,
                    ComparatorReferenceOrigin::PreviousTarget
                )
            );
            ComparatorValue::Boolean(
                left == right || compares_target_references && empty_references_are_equal,
            )
        }
        (ComparatorValue::EmptyArray(_), _)
        | (_, ComparatorValue::EmptyArray(_))
        | (ComparatorValue::EmptyObject(_), _)
        | (_, ComparatorValue::EmptyObject(_)) => ComparatorValue::Boolean(false),
        (ComparatorValue::Boolean(left), ComparatorValue::Boolean(right)) => {
            ComparatorValue::Boolean(left == right)
        }
        (ComparatorValue::Number(left), ComparatorValue::Number(right)) => {
            ComparatorValue::Boolean(left == right)
        }
        (ComparatorValue::String(left), ComparatorValue::String(right)) => {
            ComparatorValue::Boolean(left == right)
        }
        (ComparatorValue::Undefined, ComparatorValue::Undefined) => ComparatorValue::Boolean(true),
        (ComparatorValue::PreviousProps, ComparatorValue::PreviousProps)
        | (ComparatorValue::NextProps, ComparatorValue::NextProps) => ComparatorValue::Unknown,
        _ => ComparatorValue::Boolean(false),
    }
}

fn rerender_default_comparator_evaluate_expression<'a>(
    expression: &Expression<'a>,
    state: &ComparatorEvaluationState<'a, '_, '_>,
) -> ComparatorValue {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::BooleanLiteral(literal) => ComparatorValue::Boolean(literal.value),
        Expression::NumericLiteral(literal) => ComparatorValue::Number(literal.value),
        Expression::StringLiteral(literal) => ComparatorValue::String(literal.value.to_string()),
        Expression::Identifier(identifier) => {
            let symbol_id = state
                .ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if symbol_id.is_none() && identifier.name == "undefined" {
                ComparatorValue::Undefined
            } else {
                symbol_id
                    .and_then(|symbol_id| state.bindings.get(&symbol_id).cloned())
                    .unwrap_or(ComparatorValue::Unknown)
            }
        }
        Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_) => {
            let member = expression.as_member_expression().unwrap();
            let object = rerender_default_comparator_evaluate_expression(member.object(), state);
            let Some(property_name) = member.static_property_name() else {
                return ComparatorValue::Unknown;
            };
            if matches!(
                object,
                ComparatorValue::EmptyArray(_) | ComparatorValue::EmptyObject(_)
            ) && property_name.parse::<usize>().is_ok()
            {
                return ComparatorValue::Undefined;
            }
            match object {
                ComparatorValue::PreviousProps | ComparatorValue::NextProps => {
                    if property_name == state.prop_name {
                        let origin = if matches!(object, ComparatorValue::PreviousProps) {
                            ComparatorReferenceOrigin::PreviousTarget
                        } else {
                            ComparatorReferenceOrigin::NextTarget
                        };
                        match state.kind {
                            EmptyDefaultKind::Array => ComparatorValue::EmptyArray(origin),
                            EmptyDefaultKind::Object => ComparatorValue::EmptyObject(origin),
                        }
                    } else {
                        ComparatorValue::PropSymbol {
                            owner: if matches!(object, ComparatorValue::PreviousProps) {
                                ComparatorPropOwner::Previous
                            } else {
                                ComparatorPropOwner::Next
                            },
                            name: property_name.to_string(),
                        }
                    }
                }
                ComparatorValue::EmptyArray(_) if property_name == "length" => {
                    ComparatorValue::Number(0.0)
                }
                ComparatorValue::EmptyObject(_)
                    if !OBJECT_PROTOTYPE_PROPERTY_NAMES.contains(&property_name.as_ref()) =>
                {
                    ComparatorValue::Undefined
                }
                _ => ComparatorValue::Unknown,
            }
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            rerender_default_comparator_evaluate_expression(&unary.argument, state)
                .into_formula()
                .map(rerender_default_comparator_formula_not)
                .map(ComparatorValue::Formula)
                .unwrap_or(ComparatorValue::Unknown)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let Some(left) = rerender_default_comparator_evaluate_expression(&logical.left, state)
                .into_formula()
            else {
                return ComparatorValue::Unknown;
            };
            if matches!(
                (&left, logical.operator),
                (ComparatorFormula::Constant(false), LogicalOperator::And)
                    | (ComparatorFormula::Constant(true), LogicalOperator::Or)
            ) {
                return ComparatorValue::Formula(left);
            }
            let Some(right) =
                rerender_default_comparator_evaluate_expression(&logical.right, state)
                    .into_formula()
            else {
                return ComparatorValue::Unknown;
            };
            ComparatorValue::Formula(rerender_default_comparator_formula_combine(
                logical.operator,
                left,
                right,
            ))
        }
        Expression::BinaryExpression(binary) => {
            let left = rerender_default_comparator_evaluate_expression(&binary.left, state);
            let right = rerender_default_comparator_evaluate_expression(&binary.right, state);
            match binary.operator {
                BinaryOperator::Equality
                | BinaryOperator::Inequality
                | BinaryOperator::StrictEquality
                | BinaryOperator::StrictInequality => {
                    let is_negated = matches!(
                        binary.operator,
                        BinaryOperator::Inequality | BinaryOperator::StrictInequality
                    );
                    let equality = rerender_default_comparator_evaluate_equality(
                        left,
                        right,
                        state.empty_references_are_equal,
                        matches!(
                            binary.operator,
                            BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
                        ),
                    );
                    if !is_negated {
                        equality
                    } else {
                        equality
                            .into_formula()
                            .map(rerender_default_comparator_formula_not)
                            .map(ComparatorValue::Formula)
                            .unwrap_or(ComparatorValue::Unknown)
                    }
                }
                BinaryOperator::LessThan
                | BinaryOperator::LessEqualThan
                | BinaryOperator::GreaterThan
                | BinaryOperator::GreaterEqualThan => {
                    let (ComparatorValue::Number(left), ComparatorValue::Number(right)) =
                        (left, right)
                    else {
                        return ComparatorValue::Unknown;
                    };
                    ComparatorValue::Boolean(match binary.operator {
                        BinaryOperator::LessThan => left < right,
                        BinaryOperator::LessEqualThan => left <= right,
                        BinaryOperator::GreaterThan => left > right,
                        BinaryOperator::GreaterEqualThan => left >= right,
                        _ => unreachable!(),
                    })
                }
                _ => ComparatorValue::Unknown,
            }
        }
        Expression::ConditionalExpression(conditional) => {
            let Some(test) =
                rerender_default_comparator_evaluate_expression(&conditional.test, state)
                    .into_formula()
            else {
                return ComparatorValue::Unknown;
            };
            if let ComparatorFormula::Constant(value) = test {
                return rerender_default_comparator_evaluate_expression(
                    if value {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    state,
                );
            }
            let Some(consequent) =
                rerender_default_comparator_evaluate_expression(&conditional.consequent, state)
                    .into_formula()
            else {
                return ComparatorValue::Unknown;
            };
            let Some(alternate) =
                rerender_default_comparator_evaluate_expression(&conditional.alternate, state)
                    .into_formula()
            else {
                return ComparatorValue::Unknown;
            };
            ComparatorValue::Formula(ComparatorFormula::Conditional {
                test: Box::new(test),
                consequent: Box::new(consequent),
                alternate: Box::new(alternate),
            })
        }
        Expression::CallExpression(call) => {
            if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
                let receiver =
                    rerender_default_comparator_evaluate_expression(member.object(), state);
                let method_name = member.static_property_name();
                if matches!(receiver, ComparatorValue::EmptyArray(_))
                    && matches!(method_name.as_deref(), Some("every" | "some"))
                    && call.arguments.first().is_some_and(|argument| {
                        argument.as_expression().is_some_and(|callback| {
                            rerender_default_comparator_is_provably_callable(callback, state.ctx)
                        })
                    })
                {
                    return ComparatorValue::Boolean(method_name.as_deref() == Some("every"));
                }
                if matches!(method_name.as_deref(), Some("keys" | "values"))
                    && call.arguments.len() == 1
                    && matches!(
                        member.object().get_inner_expression(),
                        Expression::Identifier(identifier)
                            if identifier.name == "Object"
                                && state.ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
                    )
                    && call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .is_some_and(|argument| {
                            matches!(
                                rerender_default_comparator_evaluate_expression(argument, state),
                                ComparatorValue::EmptyObject(_)
                            )
                        })
                {
                    return ComparatorValue::EmptyArray(ComparatorReferenceOrigin::Expression(
                        call.span.start,
                    ));
                }
                return ComparatorValue::Unknown;
            }
            rerender_default_comparator_evaluate_local_call(call, state)
        }
        _ => ComparatorValue::Unknown,
    }
}

fn rerender_default_comparator_is_provably_callable<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Boolean" | "Number" | "String")
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            true
        }
        _ => rerender_default_resolve_exact_function(expression, ctx, &mut FxHashSet::default())
            .is_some(),
    }
}

fn rerender_default_comparator_evaluate_local_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    state: &ComparatorEvaluationState<'a, '_, '_>,
) -> ComparatorValue {
    let Some(function_node) =
        rerender_default_resolve_exact_function(&call.callee, state.ctx, &mut FxHashSet::default())
    else {
        return ComparatorValue::Unknown;
    };
    if state.active_functions.contains(&function_node.id()) {
        return ComparatorValue::Unknown;
    }
    let Some((parameters, returned_expression, is_async_or_generator)) =
        rerender_default_comparator_function_parts(function_node)
    else {
        return ComparatorValue::Unknown;
    };
    if is_async_or_generator
        || parameters.rest.is_some()
        || parameters.items.len() != call.arguments.len()
    {
        return ComparatorValue::Unknown;
    }
    let mut bindings = state.bindings.clone();
    for (parameter, argument) in parameters.items.iter().zip(call.arguments.iter()) {
        let Some(identifier) = parameter.pattern.get_binding_identifier() else {
            return ComparatorValue::Unknown;
        };
        let Some(argument) = argument.as_expression() else {
            return ComparatorValue::Unknown;
        };
        bindings.insert(
            identifier.symbol_id(),
            rerender_default_comparator_evaluate_expression(argument, state),
        );
    }
    let mut active_functions = state.active_functions.clone();
    active_functions.insert(function_node.id());
    rerender_default_comparator_evaluate_expression(
        returned_expression,
        &ComparatorEvaluationState {
            bindings,
            active_functions,
            empty_references_are_equal: state.empty_references_are_equal,
            kind: state.kind,
            prop_name: state.prop_name,
            ctx: state.ctx,
        },
    )
}

fn rerender_default_collect_comparator_atoms(
    formula: &ComparatorFormula,
    atoms: &mut FxHashSet<String>,
) {
    match formula {
        ComparatorFormula::Constant(_) => {}
        ComparatorFormula::Atom(atom) => {
            atoms.insert(atom.clone());
        }
        ComparatorFormula::Not(operand) => {
            rerender_default_collect_comparator_atoms(operand, atoms);
        }
        ComparatorFormula::And(left, right) | ComparatorFormula::Or(left, right) => {
            rerender_default_collect_comparator_atoms(left, atoms);
            rerender_default_collect_comparator_atoms(right, atoms);
        }
        ComparatorFormula::Conditional {
            test,
            consequent,
            alternate,
        } => {
            rerender_default_collect_comparator_atoms(test, atoms);
            rerender_default_collect_comparator_atoms(consequent, atoms);
            rerender_default_collect_comparator_atoms(alternate, atoms);
        }
    }
}

fn rerender_default_evaluate_comparator_formula(
    formula: &ComparatorFormula,
    atom_values: &FxHashMap<String, bool>,
) -> Option<bool> {
    match formula {
        ComparatorFormula::Constant(value) => Some(*value),
        ComparatorFormula::Atom(atom) => atom_values.get(atom).copied(),
        ComparatorFormula::Not(operand) => Some(!rerender_default_evaluate_comparator_formula(
            operand,
            atom_values,
        )?),
        ComparatorFormula::And(left, right) => Some(
            rerender_default_evaluate_comparator_formula(left, atom_values)?
                && rerender_default_evaluate_comparator_formula(right, atom_values)?,
        ),
        ComparatorFormula::Or(left, right) => Some(
            rerender_default_evaluate_comparator_formula(left, atom_values)?
                || rerender_default_evaluate_comparator_formula(right, atom_values)?,
        ),
        ComparatorFormula::Conditional {
            test,
            consequent,
            alternate,
        } => {
            if rerender_default_evaluate_comparator_formula(test, atom_values)? {
                rerender_default_evaluate_comparator_formula(consequent, atom_values)
            } else {
                rerender_default_evaluate_comparator_formula(alternate, atom_values)
            }
        }
    }
}

fn rerender_default_stable_reference_could_prevent_render(
    distinct_reference_formula: &ComparatorFormula,
    shared_reference_formula: &ComparatorFormula,
) -> bool {
    let mut atom_set = FxHashSet::default();
    rerender_default_collect_comparator_atoms(distinct_reference_formula, &mut atom_set);
    rerender_default_collect_comparator_atoms(shared_reference_formula, &mut atom_set);
    if atom_set.len() > MAX_COMPARATOR_SYMBOLIC_ATOM_COUNT {
        return true;
    }
    let atoms = atom_set.into_iter().collect::<Vec<_>>();
    for assignment in 0..(1_usize << atoms.len()) {
        let atom_values = atoms
            .iter()
            .enumerate()
            .map(|(index, atom)| (atom.clone(), assignment & (1 << index) != 0))
            .collect::<FxHashMap<_, _>>();
        let Some(distinct_result) =
            rerender_default_evaluate_comparator_formula(distinct_reference_formula, &atom_values)
        else {
            return true;
        };
        let Some(shared_result) =
            rerender_default_evaluate_comparator_formula(shared_reference_formula, &atom_values)
        else {
            return true;
        };
        if !distinct_result && shared_result {
            return true;
        }
    }
    false
}

fn rerender_default_message(kind: EmptyDefaultKind, identity_use: IdentitySensitiveUse) -> String {
    let (literal, allocation) = match kind {
        EmptyDefaultKind::Array => ("[]", "array"),
        EmptyDefaultKind::Object => ("{}", "object"),
    };
    match identity_use {
        IdentitySensitiveUse::DependencyArray => format!(
            "This reruns hooks that list it in their dependency array because default prop value {literal} makes a brand new {allocation} every render, so move it to a constant at the top of the file"
        ),
        IdentitySensitiveUse::MemoizedProp => format!(
            "This keeps redrawing children that compare props because default prop value {literal} makes a brand new {allocation} every render, so move it to a constant at the top of the file"
        ),
    }
}

fn rerender_default_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn rerender_default_is_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn rerender_default_check_forwarded_custom_hook_defaults(ctx: &LintContext<'_>) {
    let mut hook_function_ids = FxHashMap::default();
    let mut local_defaults_cache = FxHashMap::<NodeId, Vec<HookParameterBinding>>::default();
    let mut imported_defaults_cache = FxHashMap::default();
    for node in ctx.nodes().iter() {
        let (symbol_id, function_id) = match node.kind() {
            AstKind::Function(function)
                if function.r#type == FunctionType::FunctionDeclaration
                    && function.id.as_ref().is_some_and(|identifier| {
                        rerender_default_is_hook_name(identifier.name.as_str())
                    }) =>
            {
                let identifier = function.id.as_ref().unwrap();
                (identifier.symbol_id(), node.id())
            }
            AstKind::VariableDeclarator(declarator) => {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if !rerender_default_is_hook_name(identifier.name.as_str()) {
                    continue;
                }
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                let function_id = match initializer.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => function.node_id.get(),
                    Expression::FunctionExpression(function) => function.node_id.get(),
                    _ => continue,
                };
                (identifier.symbol_id(), function_id)
            }
            _ => continue,
        };
        if !rerender_default_function_is_hook(function_id, ctx) {
            continue;
        }
        hook_function_ids.insert(symbol_id, function_id);
    }
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            continue;
        };
        let Some(symbol_id) = resolve_const_identifier_root_symbol(callee, ctx) else {
            continue;
        };
        let Some(render_owner) = find_render_phase_component_or_hook(node, ctx) else {
            continue;
        };
        if !is_node_reachable_within_function(node, render_owner, ctx) {
            continue;
        }
        if let Some(function_id) = hook_function_ids.get(&symbol_id).copied() {
            let defaults = local_defaults_cache.entry(function_id).or_insert_with(|| {
                let Some(parameters) = rerender_default_function_parameters(function_id, ctx)
                else {
                    return Vec::new();
                };
                rerender_default_collect_hook_parameters(parameters)
                    .into_iter()
                    .filter(|binding| binding.default_kind.is_some())
                    .filter(|binding| !rerender_default_symbol_is_mutated(binding.symbol_id, ctx))
                    .filter(|binding| {
                        rerender_default_local_taint_reaches_dependency(
                            function_id,
                            &HookTaint {
                                list_symbol_ids: FxHashSet::default(),
                                value_symbol_ids: FxHashSet::from_iter([binding.symbol_id]),
                            },
                            CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
                    .collect()
            });
            for binding in defaults {
                if !rerender_default_call_uses_hook_default(call, binding, ctx) {
                    continue;
                }
                rerender_default_report_forwarded_hook_default(
                    call,
                    binding.default_kind.unwrap(),
                    ctx,
                );
            }
            continue;
        }
        for binding in
            rerender_default_imported_hook_defaults(callee, ctx, &mut imported_defaults_cache)
        {
            if !rerender_default_call_uses_imported_hook_default(call, &binding, ctx) {
                continue;
            }
            rerender_default_report_forwarded_hook_default(call, binding.kind, ctx);
        }
    }
}

fn rerender_default_local_taint_reaches_dependency(
    function_id: NodeId,
    taint: &HookTaint,
    remaining_depth: usize,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_id)
        || taint
            .value_symbol_ids
            .iter()
            .chain(&taint.list_symbol_ids)
            .any(|symbol_id| rerender_default_symbol_is_mutated(*symbol_id, ctx))
    {
        return false;
    }
    let function_node = ctx.nodes().get_node(function_id);
    for candidate in ctx.nodes().iter() {
        if !rerender_default_is_direct_function_descendant(candidate.id(), function_id, ctx)
            || !is_node_reachable_within_function(candidate, function_node, ctx)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if let Some(dependency_index) = rerender_default_dependency_index(call, ctx) {
            if call
                .arguments
                .get(dependency_index)
                .and_then(Argument::as_expression)
                .is_some_and(|dependencies| {
                    rerender_default_dependency_contains_taint(dependencies, taint, ctx)
                })
            {
                return true;
            }
            continue;
        }
        if remaining_depth == 0 {
            continue;
        }
        if let Some(target_function_id) = rerender_default_local_hook_function_id(&call.callee, ctx)
        {
            let Some(parameters) = rerender_default_function_parameters(target_function_id, ctx)
            else {
                continue;
            };
            let forwarded_taint = rerender_default_forward_taint(call, parameters, taint, ctx);
            if (!forwarded_taint.value_symbol_ids.is_empty()
                || !forwarded_taint.list_symbol_ids.is_empty())
                && rerender_default_local_taint_reaches_dependency(
                    target_function_id,
                    &forwarded_taint,
                    remaining_depth - 1,
                    ctx,
                    &mut visited_function_ids.clone(),
                )
            {
                return true;
            }
            continue;
        }
        if rerender_default_imported_call_taint_reaches_from_context(
            call,
            taint,
            remaining_depth - 1,
            ctx,
            &mut FxHashSet::default(),
        ) {
            return true;
        }
    }
    false
}

fn rerender_default_dependency_index<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<usize> {
    for hook_name in DEPENDENCY_HOOK_NAMES {
        if is_react_api_call(call, hook_name, ctx) {
            return rerender_default_hook_dependency_index(hook_name);
        }
    }
    if let Some(dependency_index) =
        rerender_default_react_dependency_index(&call.callee, ctx, &mut FxHashSet::default())
    {
        return Some(dependency_index);
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return None;
    };
    let (module_source, exported_name) = rerender_default_context_import_binding(callee, ctx)?;
    let imported_path = rerender_default_resolve_import_file(ctx.file_path(), module_source)?;
    rerender_default_foreign_export_dependency_index(
        &imported_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_react_dependency_index<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<usize> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            rerender_default_react_symbol_dependency_index(symbol_id, ctx, visited_symbol_ids)
        }
        Expression::ConditionalExpression(conditional) => {
            let consequent = rerender_default_react_dependency_index(
                &conditional.consequent,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            let alternate = rerender_default_react_dependency_index(
                &conditional.alternate,
                ctx,
                &mut visited_symbol_ids.clone(),
            );
            (consequent.is_some() && consequent == alternate).then_some(consequent.unwrap())
        }
        expression => {
            let member = expression.as_member_expression()?;
            let hook_name = member.static_property_name()?;
            let dependency_index = rerender_default_hook_dependency_index(&hook_name)?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            rerender_default_react_namespace_symbol(
                ctx.scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()?,
                ctx,
                visited_symbol_ids,
            )
            .then_some(dependency_index)
        }
    }
}

fn rerender_default_react_symbol_dependency_index<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<usize> {
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    if let Some(import_entry) = rerender_default_react_import_for_symbol(symbol_id, ctx) {
        let ImportImportName::Name(name) = &import_entry.import_name else {
            return None;
        };
        return rerender_default_hook_dependency_index(name.name());
    }
    let initializer = rerender_default_unreassigned_const_initializer(symbol_id, ctx)?;
    rerender_default_react_dependency_index(initializer, ctx, visited_symbol_ids)
}

fn rerender_default_react_namespace_symbol<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    if let Some(import_entry) = rerender_default_react_import_for_symbol(symbol_id, ctx) {
        return matches!(
            &import_entry.import_name,
            ImportImportName::NamespaceObject | ImportImportName::Default(_)
        ) || matches!(
            &import_entry.import_name,
            ImportImportName::Name(name) if name.name() == "default"
        );
    }
    let Some(Expression::Identifier(identifier)) =
        rerender_default_unreassigned_const_initializer(symbol_id, ctx)
            .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(next_symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    rerender_default_react_namespace_symbol(next_symbol_id, ctx, visited_symbol_ids)
}

fn rerender_default_react_import_for_symbol<'ctx>(
    symbol_id: SymbolId,
    ctx: &'ctx LintContext<'_>,
) -> Option<&'ctx crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn rerender_default_dependency_contains_taint(
    expression: &Expression<'_>,
    taint: &HookTaint,
    ctx: &LintContext<'_>,
) -> bool {
    rerender_default_dependency_contains_taint_inner(
        expression,
        taint,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_dependency_contains_taint_inner(
    expression: &Expression<'_>,
    taint: &HookTaint,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if rerender_default_expression_has_taint(expression, &taint.list_symbol_ids, ctx) {
        return true;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbol_ids.insert(symbol_id)
            || rerender_default_symbol_is_mutated(symbol_id, ctx)
        {
            return false;
        }
        return rerender_default_unreassigned_const_initializer(symbol_id, ctx).is_some_and(
            |initializer| {
                rerender_default_dependency_contains_taint_inner(
                    initializer,
                    taint,
                    ctx,
                    visited_symbol_ids,
                )
            },
        );
    }
    let Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return false;
    };
    array.elements.iter().any(|element| match element {
        oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
            rerender_default_expression_has_taint(&spread.argument, &taint.list_symbol_ids, ctx)
        }
        element => element.as_expression().is_some_and(|expression| {
            rerender_default_expression_has_taint(expression, &taint.value_symbol_ids, ctx)
        }),
    })
}

fn rerender_default_expression_has_taint(
    expression: &Expression<'_>,
    tainted_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    rerender_default_expression_has_taint_inner(
        expression,
        tainted_symbol_ids,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_expression_has_taint_inner(
    expression: &Expression<'_>,
    tainted_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
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
    if !visited_symbol_ids.insert(symbol_id) || rerender_default_symbol_is_mutated(symbol_id, ctx) {
        return false;
    }
    if tainted_symbol_ids.contains(&symbol_id) {
        return true;
    }
    rerender_default_unreassigned_const_initializer(symbol_id, ctx).is_some_and(|initializer| {
        rerender_default_expression_has_taint_inner(
            initializer,
            tainted_symbol_ids,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn rerender_default_forward_taint<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    parameters: &FormalParameters<'_>,
    caller_taint: &HookTaint,
    ctx: &LintContext<'a>,
) -> HookTaint {
    let mut forwarded = HookTaint::default();
    for parameter in rerender_default_collect_hook_parameters(parameters) {
        if rerender_default_symbol_is_mutated(parameter.symbol_id, ctx) {
            continue;
        }
        let Some(argument) = rerender_default_argument_for_parameter(call, &parameter, ctx) else {
            continue;
        };
        if rerender_default_expression_has_taint(argument, &caller_taint.value_symbol_ids, ctx) {
            forwarded.value_symbol_ids.insert(parameter.symbol_id);
        }
        if rerender_default_expression_has_taint(argument, &caller_taint.list_symbol_ids, ctx)
            || rerender_default_dependency_contains_taint(argument, caller_taint, ctx)
        {
            forwarded.list_symbol_ids.insert(parameter.symbol_id);
        }
    }
    forwarded
}

fn rerender_default_argument_for_parameter<'a, 'ctx>(
    call: &'ctx oxc_ast::ast::CallExpression<'a>,
    parameter: &HookParameterBinding,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx Expression<'a>> {
    if call
        .arguments
        .iter()
        .take(parameter.parameter_index + 1)
        .any(|argument| matches!(argument, Argument::SpreadElement(_)))
    {
        return None;
    }
    let argument = call
        .arguments
        .get(parameter.parameter_index)?
        .as_expression()?;
    let Some(property_name) = parameter.property_name.as_deref() else {
        return Some(argument);
    };
    let object =
        rerender_default_resolve_const_object_expression(argument, ctx, &mut FxHashSet::default())?;
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => return None,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name) =>
            {
                return Some(&property.value);
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    None
}

fn rerender_default_local_hook_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let function_id =
        rerender_default_function_for_symbol(symbol_id, ctx, &mut FxHashSet::default())?;
    rerender_default_function_is_hook(function_id, ctx).then_some(function_id)
}

fn rerender_default_function_for_symbol(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => {
                    let next_symbol_id = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    rerender_default_function_for_symbol(next_symbol_id, ctx, visited_symbol_ids)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn rerender_default_function_is_hook(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    match function_node.kind() {
        AstKind::Function(function) => {
            if let Some(identifier) = &function.id {
                return rerender_default_is_hook_name(identifier.name.as_str());
            }
            let declaration = ctx.nodes().parent_node(function_id);
            matches!(declaration.kind(), AstKind::VariableDeclarator(declarator) if declarator.id.get_binding_identifier().is_some_and(|identifier| rerender_default_is_hook_name(identifier.name.as_str())))
        }
        AstKind::ArrowFunctionExpression(_) => {
            let declaration = ctx.nodes().parent_node(function_id);
            matches!(declaration.kind(), AstKind::VariableDeclarator(declarator) if declarator.id.get_binding_identifier().is_some_and(|identifier| rerender_default_is_hook_name(identifier.name.as_str())))
        }
        _ => false,
    }
}

fn rerender_default_function_parameters<'a, 'ctx>(
    function_id: NodeId,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx FormalParameters<'a>> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(&function.params),
        AstKind::ArrowFunctionExpression(function) => Some(&function.params),
        _ => None,
    }
}

fn rerender_default_report_forwarded_hook_default(
    call: &oxc_ast::ast::CallExpression<'_>,
    kind: EmptyDefaultKind,
    ctx: &LintContext<'_>,
) {
    let kind = match kind {
        EmptyDefaultKind::Array => "array",
        EmptyDefaultKind::Object => "object",
    };
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This custom Hook default creates a new {kind} every render and forwards it to a Hook dependency."
        ))
        .with_label(call.span),
    );
}

fn rerender_default_unreassigned_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
    ) {
        return None;
    }
    declarator.init.as_ref()
}

fn rerender_default_collect_hook_parameters(
    parameters: &FormalParameters<'_>,
) -> Vec<HookParameterBinding> {
    let mut bindings = Vec::new();
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        match &parameter.pattern {
            BindingPattern::BindingIdentifier(identifier) => {
                bindings.push(HookParameterBinding {
                    symbol_id: identifier.symbol_id(),
                    default_kind: None,
                    parameter_index,
                    property_name: None,
                });
            }
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                    continue;
                };
                bindings.push(HookParameterBinding {
                    symbol_id: identifier.symbol_id(),
                    default_kind: rerender_default_fresh_literal_kind(
                        assignment.right.get_inner_expression(),
                    ),
                    parameter_index,
                    property_name: None,
                });
            }
            BindingPattern::ObjectPattern(object) => {
                for property in &object.properties {
                    let Some(property_name) = property.key.static_name() else {
                        continue;
                    };
                    let (identifier, default_kind) = match &property.value {
                        BindingPattern::BindingIdentifier(identifier) => (identifier, None),
                        BindingPattern::AssignmentPattern(assignment) => {
                            let BindingPattern::BindingIdentifier(identifier) = &assignment.left
                            else {
                                continue;
                            };
                            (
                                identifier,
                                rerender_default_fresh_literal_kind(
                                    assignment.right.get_inner_expression(),
                                ),
                            )
                        }
                        _ => continue,
                    };
                    bindings.push(HookParameterBinding {
                        symbol_id: identifier.symbol_id(),
                        default_kind,
                        parameter_index,
                        property_name: Some(property_name.into_owned()),
                    });
                }
            }
            _ => {}
        }
    }
    bindings
}

fn rerender_default_fresh_literal_kind(expression: &Expression<'_>) -> Option<EmptyDefaultKind> {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => Some(EmptyDefaultKind::Array),
        Expression::ObjectExpression(_) => Some(EmptyDefaultKind::Object),
        _ => None,
    }
}

fn rerender_default_call_uses_hook_default<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    binding: &HookParameterBinding,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(argument) = call.arguments.get(binding.parameter_index) else {
        return !call
            .arguments
            .iter()
            .take(binding.parameter_index + 1)
            .any(|argument| matches!(argument, Argument::SpreadElement(_)));
    };
    let Some(property_name) = binding.property_name.as_deref() else {
        return false;
    };
    let Some(argument) = argument.as_expression() else {
        return false;
    };
    let Some(object) =
        rerender_default_resolve_const_object_expression(argument, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => return false,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name) =>
            {
                return false;
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    true
}

fn rerender_default_call_uses_imported_hook_default<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    binding: &ImportedHookDefault,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(argument) = call.arguments.get(binding.parameter_index) else {
        return !call
            .arguments
            .iter()
            .take(binding.parameter_index + 1)
            .any(|argument| matches!(argument, Argument::SpreadElement(_)));
    };
    let Some(property_name) = binding.property_name.as_deref() else {
        return false;
    };
    let Some(argument) = argument.as_expression() else {
        return false;
    };
    let Some(object) =
        rerender_default_resolve_const_object_expression(argument, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => return false,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name) =>
            {
                return false;
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    true
}

fn rerender_default_imported_hook_defaults<'a>(
    callee: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    cache: &mut FxHashMap<(PathBuf, String), Vec<ImportedHookDefault>>,
) -> Vec<ImportedHookDefault> {
    let Some((module_source, exported_name)) = rerender_default_context_import_binding(callee, ctx)
    else {
        return Vec::new();
    };
    if !rerender_default_is_hook_name(callee.name.as_str())
        && !rerender_default_is_hook_name(exported_name)
    {
        return Vec::new();
    }
    let Some(imported_path) = rerender_default_resolve_import_file(ctx.file_path(), module_source)
    else {
        return Vec::new();
    };
    let Some((resolved_path, resolved_name)) = rerender_default_resolve_export_location(
        &imported_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    ) else {
        return Vec::new();
    };
    let cache_key = (resolved_path.clone(), resolved_name.clone());
    if let Some(cached) = cache.get(&cache_key) {
        return cached.clone();
    }
    let defaults = rerender_default_imported_hook_defaults_in_file(&resolved_path, &resolved_name);
    cache.insert(cache_key, defaults.clone());
    defaults
}

fn rerender_default_context_import_binding<'a, 'ctx>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<(&'ctx str, &'ctx str)> {
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let import_entry = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })?;
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return None,
    };
    Some((import_entry.module_request.name(), exported_name))
}

fn rerender_default_resolve_import_file(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
        extensions: VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
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
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn rerender_default_imported_hook_defaults_in_file(
    file_path: &Path,
    exported_name: &str,
) -> Vec<ImportedHookDefault> {
    let Ok(metadata) = std::fs::metadata(file_path) else {
        return Vec::new();
    };
    if !metadata.is_file() {
        return Vec::new();
    }
    let Ok(source_text) = std::fs::read_to_string(file_path) else {
        return Vec::new();
    };
    let Ok(source_type) = SourceType::from_path(file_path) else {
        return Vec::new();
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return Vec::new();
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return Vec::new();
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    let Some((function_id, parameters)) =
        rerender_default_find_imported_hook_function(&semantic, &module_record, exported_name)
    else {
        return Vec::new();
    };
    rerender_default_collect_hook_parameters(parameters)
        .into_iter()
        .filter_map(|binding| binding.default_kind.map(|kind| (binding, kind)))
        .filter(|binding| {
            !rerender_default_foreign_symbol_is_mutated(binding.0.symbol_id, &semantic)
                && rerender_default_foreign_taint_reaches_dependency(
                    function_id,
                    &HookTaint {
                        list_symbol_ids: FxHashSet::default(),
                        value_symbol_ids: FxHashSet::from_iter([binding.0.symbol_id]),
                    },
                    CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH,
                    file_path,
                    &semantic,
                    &module_record,
                    &mut FxHashSet::default(),
                )
        })
        .map(|(binding, kind)| ImportedHookDefault {
            kind,
            parameter_index: binding.parameter_index,
            property_name: binding.property_name,
        })
        .collect()
}

fn rerender_default_find_imported_hook_function<'a, 'semantic>(
    semantic: &'semantic Semantic<'a>,
    module_record: &ModuleRecord,
    exported_name: &str,
) -> Option<(NodeId, &'semantic FormalParameters<'a>)> {
    if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        rerender_default_export_name_matches(&entry.export_name, exported_name)
            .then(|| entry.local_name.name())
            .flatten()
    }) && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
        && let Some(function_id) = rerender_default_foreign_function_for_symbol(
            symbol_id,
            semantic,
            &mut FxHashSet::default(),
        )
        && rerender_default_foreign_function_is_hook(function_id, exported_name, semantic)
    {
        return rerender_default_foreign_function_parameters(function_id, semantic)
            .map(|parameters| (function_id, parameters));
    }
    if exported_name != "default" {
        return None;
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        let function_id = match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => function.node_id.get(),
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                function.node_id.get()
            }
            _ => return None,
        };
        if !rerender_default_foreign_function_is_hook(function_id, exported_name, semantic) {
            return None;
        }
        rerender_default_foreign_function_parameters(function_id, semantic)
            .map(|parameters| (function_id, parameters))
    })
}

fn rerender_default_resolve_export_location(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<(PathBuf, String)> {
    if depth >= CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH {
        return None;
    }
    let canonical_path = std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.into());
    if !visited_paths.insert(canonical_path.clone()) {
        return None;
    }
    let metadata = std::fs::metadata(&canonical_path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let source_text = std::fs::read_to_string(&canonical_path).ok()?;
    let source_type = SourceType::from_path(&canonical_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(&canonical_path, &parser_return.module_record, &semantic);
    if let Some(local_export) = module_record
        .local_export_entries
        .iter()
        .find(|entry| rerender_default_export_name_matches(&entry.export_name, exported_name))
    {
        if let Some(local_name) = local_export.local_name.name()
            && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
            && let Some(import_entry) =
                rerender_default_foreign_import_for_symbol(symbol_id, &semantic, &module_record)
        {
            if REACT_RUNTIME_MODULE_SOURCES.contains(&import_entry.module_request.name()) {
                return Some((canonical_path, exported_name.to_string()));
            }
            let imported_name = match &import_entry.import_name {
                ImportImportName::Name(name) => name.name(),
                ImportImportName::Default(_) => "default",
                ImportImportName::NamespaceObject => return None,
            };
            let imported_path = rerender_default_resolve_import_file(
                &canonical_path,
                import_entry.module_request.name(),
            )?;
            return rerender_default_resolve_export_location(
                &imported_path,
                imported_name,
                depth + 1,
                visited_paths,
            );
        }
        return Some((canonical_path, exported_name.to_string()));
    }
    if let Some((module_source, imported_name)) =
        rerender_default_foreign_reexport_target(exported_name, &module_record)
    {
        let reexported_path = rerender_default_resolve_import_file(&canonical_path, module_source)?;
        return rerender_default_resolve_export_location(
            &reexported_path,
            imported_name,
            depth + 1,
            visited_paths,
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
        let Some(reexported_path) = rerender_default_resolve_import_file(
            &canonical_path,
            declaration.source.value.as_str(),
        ) else {
            continue;
        };
        let Some(location) = rerender_default_resolve_export_location(
            &reexported_path,
            exported_name,
            depth + 1,
            &mut visited_paths.clone(),
        ) else {
            continue;
        };
        if resolved_export_all.is_some() {
            return None;
        }
        resolved_export_all = Some(location);
    }
    resolved_export_all
}

fn rerender_default_export_name_matches(
    export_name: &ExportExportName,
    expected_name: &str,
) -> bool {
    match export_name {
        ExportExportName::Name(name) => name.name() == expected_name,
        ExportExportName::Default(_) => expected_name == "default",
        ExportExportName::Null => false,
    }
}

fn rerender_default_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            if !rerender_default_export_name_matches(&entry.export_name, exported_name) {
                return None;
            }
            let module_source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((module_source, imported_name))
        })
}

fn rerender_default_imported_call_taint_reaches_from_context<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    caller_taint: &HookTaint,
    remaining_depth: usize,
    ctx: &LintContext<'a>,
    visited_paths: &mut FxHashSet<(PathBuf, String)>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some((module_source, exported_name)) = rerender_default_context_import_binding(callee, ctx)
    else {
        return false;
    };
    if !rerender_default_is_hook_name(callee.name.as_str())
        && !rerender_default_is_hook_name(exported_name)
    {
        return false;
    }
    let Some(imported_path) = rerender_default_resolve_import_file(ctx.file_path(), module_source)
    else {
        return false;
    };
    let Some((resolved_path, resolved_name)) = rerender_default_resolve_export_location(
        &imported_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    ) else {
        return false;
    };
    if !visited_paths.insert((resolved_path.clone(), resolved_name.clone())) {
        return false;
    }
    let Ok(source_text) = std::fs::read_to_string(&resolved_path) else {
        return false;
    };
    let Ok(source_type) = SourceType::from_path(&resolved_path) else {
        return false;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return false;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return false;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(&resolved_path, &parser_return.module_record, &semantic);
    let Some((function_id, parameters)) =
        rerender_default_find_imported_hook_function(&semantic, &module_record, &resolved_name)
    else {
        return false;
    };
    let forwarded_taint =
        rerender_default_foreign_forward_taint_from_context(call, parameters, caller_taint, ctx);
    (!forwarded_taint.value_symbol_ids.is_empty() || !forwarded_taint.list_symbol_ids.is_empty())
        && rerender_default_foreign_taint_reaches_dependency(
            function_id,
            &forwarded_taint,
            remaining_depth,
            &resolved_path,
            &semantic,
            &module_record,
            &mut FxHashSet::default(),
        )
}

fn rerender_default_foreign_forward_taint_from_context<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    parameters: &FormalParameters<'_>,
    caller_taint: &HookTaint,
    ctx: &LintContext<'a>,
) -> HookTaint {
    let mut forwarded = HookTaint::default();
    for parameter in rerender_default_collect_hook_parameters(parameters) {
        let Some(argument) = rerender_default_argument_for_parameter(call, &parameter, ctx) else {
            continue;
        };
        if rerender_default_expression_has_taint(argument, &caller_taint.value_symbol_ids, ctx) {
            forwarded.value_symbol_ids.insert(parameter.symbol_id);
        }
        if rerender_default_expression_has_taint(argument, &caller_taint.list_symbol_ids, ctx)
            || rerender_default_dependency_contains_taint(argument, caller_taint, ctx)
        {
            forwarded.list_symbol_ids.insert(parameter.symbol_id);
        }
    }
    forwarded
}

fn rerender_default_foreign_taint_reaches_dependency(
    function_id: NodeId,
    taint: &HookTaint,
    remaining_depth: usize,
    file_path: &Path,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_id)
        || taint
            .value_symbol_ids
            .iter()
            .chain(&taint.list_symbol_ids)
            .any(|symbol_id| rerender_default_foreign_symbol_is_mutated(*symbol_id, semantic))
    {
        return false;
    }
    for candidate in semantic.nodes().iter() {
        if rerender_default_imported_nearest_function_id(candidate.id(), semantic)
            != Some(function_id)
            || !rerender_default_foreign_node_is_reachable(candidate.id(), function_id, semantic)
        {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if let Some(dependency_index) =
            rerender_default_foreign_dependency_index(call, file_path, semantic, module_record)
        {
            if call
                .arguments
                .get(dependency_index)
                .and_then(Argument::as_expression)
                .is_some_and(|dependencies| {
                    rerender_default_foreign_dependency_contains_taint(
                        dependencies,
                        taint,
                        semantic,
                    )
                })
            {
                return true;
            }
            continue;
        }
        if remaining_depth == 0 {
            continue;
        }
        if let Some(target_function_id) =
            rerender_default_foreign_local_hook_function_id(&call.callee, semantic)
        {
            let Some(parameters) =
                rerender_default_foreign_function_parameters(target_function_id, semantic)
            else {
                continue;
            };
            let forwarded_taint = rerender_default_foreign_forward_taint_from_semantic(
                call, parameters, taint, semantic,
            );
            if (!forwarded_taint.value_symbol_ids.is_empty()
                || !forwarded_taint.list_symbol_ids.is_empty())
                && rerender_default_foreign_taint_reaches_dependency(
                    target_function_id,
                    &forwarded_taint,
                    remaining_depth - 1,
                    file_path,
                    semantic,
                    module_record,
                    &mut visited_function_ids.clone(),
                )
            {
                return true;
            }
            continue;
        }
        if rerender_default_imported_call_taint_reaches_from_semantic(
            call,
            taint,
            remaining_depth - 1,
            file_path,
            semantic,
            module_record,
            &mut FxHashSet::default(),
        ) {
            return true;
        }
    }
    false
}

fn rerender_default_imported_call_taint_reaches_from_semantic<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    caller_taint: &HookTaint,
    remaining_depth: usize,
    caller_file_path: &Path,
    caller_semantic: &Semantic<'a>,
    caller_module_record: &ModuleRecord,
    visited_paths: &mut FxHashSet<(PathBuf, String)>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some((module_source, exported_name)) =
        rerender_default_foreign_import_binding(callee, caller_semantic, caller_module_record)
    else {
        return false;
    };
    if !rerender_default_is_hook_name(callee.name.as_str())
        && !rerender_default_is_hook_name(exported_name)
    {
        return false;
    }
    let Some(imported_path) = rerender_default_resolve_import_file(caller_file_path, module_source)
    else {
        return false;
    };
    let Some((resolved_path, resolved_name)) = rerender_default_resolve_export_location(
        &imported_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    ) else {
        return false;
    };
    if !visited_paths.insert((resolved_path.clone(), resolved_name.clone())) {
        return false;
    }
    let Ok(source_text) = std::fs::read_to_string(&resolved_path) else {
        return false;
    };
    let Ok(source_type) = SourceType::from_path(&resolved_path) else {
        return false;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return false;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return false;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(&resolved_path, &parser_return.module_record, &semantic);
    let Some((function_id, parameters)) =
        rerender_default_find_imported_hook_function(&semantic, &module_record, &resolved_name)
    else {
        return false;
    };
    let forwarded_taint = rerender_default_foreign_forward_taint_from_semantic(
        call,
        parameters,
        caller_taint,
        caller_semantic,
    );
    (!forwarded_taint.value_symbol_ids.is_empty() || !forwarded_taint.list_symbol_ids.is_empty())
        && rerender_default_foreign_taint_reaches_dependency(
            function_id,
            &forwarded_taint,
            remaining_depth,
            &resolved_path,
            &semantic,
            &module_record,
            &mut FxHashSet::default(),
        )
}

fn rerender_default_foreign_forward_taint_from_semantic<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    parameters: &FormalParameters<'_>,
    caller_taint: &HookTaint,
    caller_semantic: &Semantic<'a>,
) -> HookTaint {
    let mut forwarded = HookTaint::default();
    for parameter in rerender_default_collect_hook_parameters(parameters) {
        let Some(argument) =
            rerender_default_foreign_argument_for_parameter(call, &parameter, caller_semantic)
        else {
            continue;
        };
        if rerender_default_foreign_expression_has_taint(
            argument,
            &caller_taint.value_symbol_ids,
            caller_semantic,
        ) {
            forwarded.value_symbol_ids.insert(parameter.symbol_id);
        }
        if rerender_default_foreign_expression_has_taint(
            argument,
            &caller_taint.list_symbol_ids,
            caller_semantic,
        ) || rerender_default_foreign_dependency_contains_taint(
            argument,
            caller_taint,
            caller_semantic,
        ) {
            forwarded.list_symbol_ids.insert(parameter.symbol_id);
        }
    }
    forwarded
}

fn rerender_default_foreign_argument_for_parameter<'a, 'semantic>(
    call: &'semantic oxc_ast::ast::CallExpression<'a>,
    parameter: &HookParameterBinding,
    semantic: &'semantic Semantic<'a>,
) -> Option<&'semantic Expression<'a>> {
    if call
        .arguments
        .iter()
        .take(parameter.parameter_index + 1)
        .any(|argument| matches!(argument, Argument::SpreadElement(_)))
    {
        return None;
    }
    let argument = call
        .arguments
        .get(parameter.parameter_index)?
        .as_expression()?;
    let Some(property_name) = parameter.property_name.as_deref() else {
        return Some(argument);
    };
    let object = rerender_default_foreign_resolve_const_object_expression(
        argument,
        semantic,
        &mut FxHashSet::default(),
    )?;
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => return None,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name) =>
            {
                return Some(&property.value);
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    None
}

fn rerender_default_foreign_dependency_contains_taint(
    expression: &Expression<'_>,
    taint: &HookTaint,
    semantic: &Semantic<'_>,
) -> bool {
    rerender_default_foreign_dependency_contains_taint_inner(
        expression,
        taint,
        semantic,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_foreign_dependency_contains_taint_inner(
    expression: &Expression<'_>,
    taint: &HookTaint,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if rerender_default_foreign_expression_has_taint(expression, &taint.list_symbol_ids, semantic) {
        return true;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        let Some(symbol_id) = semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !visited_symbol_ids.insert(symbol_id)
            || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
        {
            return false;
        }
        return rerender_default_imported_const_initializer(symbol_id, semantic).is_some_and(
            |initializer| {
                rerender_default_foreign_dependency_contains_taint_inner(
                    initializer,
                    taint,
                    semantic,
                    visited_symbol_ids,
                )
            },
        );
    }
    let Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return false;
    };
    array.elements.iter().any(|element| match element {
        oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
            rerender_default_foreign_expression_has_taint(
                &spread.argument,
                &taint.list_symbol_ids,
                semantic,
            )
        }
        element => element.as_expression().is_some_and(|expression| {
            rerender_default_foreign_expression_has_taint(
                expression,
                &taint.value_symbol_ids,
                semantic,
            )
        }),
    })
}

fn rerender_default_foreign_expression_has_taint(
    expression: &Expression<'_>,
    tainted_symbol_ids: &FxHashSet<SymbolId>,
    semantic: &Semantic<'_>,
) -> bool {
    rerender_default_foreign_expression_has_taint_inner(
        expression,
        tainted_symbol_ids,
        semantic,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_foreign_expression_has_taint_inner(
    expression: &Expression<'_>,
    tainted_symbol_ids: &FxHashSet<SymbolId>,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id)
        || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
    {
        return false;
    }
    if tainted_symbol_ids.contains(&symbol_id) {
        return true;
    }
    rerender_default_imported_const_initializer(symbol_id, semantic).is_some_and(|initializer| {
        rerender_default_foreign_expression_has_taint_inner(
            initializer,
            tainted_symbol_ids,
            semantic,
            visited_symbol_ids,
        )
    })
}

fn rerender_default_foreign_resolve_const_object_expression<'a, 'semantic>(
    expression: &'semantic Expression<'a>,
    semantic: &'semantic Semantic<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'semantic oxc_ast::ast::ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
            {
                return None;
            }
            rerender_default_foreign_resolve_const_object_expression(
                rerender_default_imported_const_initializer(symbol_id, semantic)?,
                semantic,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn rerender_default_foreign_dependency_index(
    call: &oxc_ast::ast::CallExpression<'_>,
    file_path: &Path,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<usize> {
    if let Some(index) = rerender_default_foreign_react_dependency_index(
        &call.callee,
        semantic,
        module_record,
        &mut FxHashSet::default(),
    ) {
        return Some(index);
    }
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return None;
    };
    let (module_source, exported_name) =
        rerender_default_foreign_import_binding(callee, semantic, module_record)?;
    let imported_path = rerender_default_resolve_import_file(file_path, module_source)?;
    rerender_default_foreign_export_dependency_index(
        &imported_path,
        exported_name,
        0,
        &mut FxHashSet::default(),
    )
}

fn rerender_default_foreign_export_dependency_index(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<usize> {
    if depth >= CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH {
        return None;
    }
    let (resolved_path, resolved_name) =
        rerender_default_resolve_export_location(file_path, exported_name, depth, visited_paths)?;
    let source_text = std::fs::read_to_string(&resolved_path).ok()?;
    let source_type = SourceType::from_path(&resolved_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(&resolved_path, &parser_return.module_record, &semantic);
    if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
        rerender_default_export_name_matches(&entry.export_name, &resolved_name)
            .then(|| entry.local_name.name())
            .flatten()
    }) && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
    {
        return rerender_default_foreign_symbol_dependency_index(
            symbol_id,
            &semantic,
            &module_record,
            &mut FxHashSet::default(),
        );
    }
    if resolved_name != "default" {
        return None;
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        rerender_default_foreign_react_dependency_index(
            declaration.declaration.as_expression()?,
            &semantic,
            &module_record,
            &mut FxHashSet::default(),
        )
    })
}

fn rerender_default_foreign_react_dependency_index(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<usize> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            rerender_default_foreign_symbol_dependency_index(
                symbol_id,
                semantic,
                module_record,
                visited_symbol_ids,
            )
        }
        expression => {
            let member = expression.as_member_expression()?;
            let hook_name = member.static_property_name()?;
            let dependency_index = rerender_default_hook_dependency_index(hook_name.as_ref())?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            let symbol_id = semantic
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id();
            if symbol_id.is_none() && receiver.name == "React" {
                return Some(dependency_index);
            }
            let symbol_id = symbol_id?;
            rerender_default_foreign_import_for_symbol(symbol_id, semantic, module_record)
                .filter(|entry| {
                    REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                        && matches!(
                            entry.import_name,
                            ImportImportName::NamespaceObject | ImportImportName::Default(_)
                        )
                })
                .map(|_| dependency_index)
        }
    }
}

fn rerender_default_foreign_symbol_dependency_index(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<usize> {
    if !visited_symbol_ids.insert(symbol_id)
        || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
    {
        return None;
    }
    if let Some(dependency_index) =
        rerender_default_foreign_destructured_dependency_index(symbol_id, semantic, module_record)
    {
        return Some(dependency_index);
    }
    if let Some(import_entry) =
        rerender_default_foreign_import_for_symbol(symbol_id, semantic, module_record)
    {
        if !REACT_RUNTIME_MODULE_SOURCES.contains(&import_entry.module_request.name()) {
            return None;
        }
        let ImportImportName::Name(name) = &import_entry.import_name else {
            return None;
        };
        return rerender_default_hook_dependency_index(name.name());
    }
    let initializer = rerender_default_imported_const_initializer(symbol_id, semantic)?;
    match initializer.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            let consequent = rerender_default_foreign_react_dependency_index(
                &conditional.consequent,
                semantic,
                module_record,
                &mut visited_symbol_ids.clone(),
            );
            let alternate = rerender_default_foreign_react_dependency_index(
                &conditional.alternate,
                semantic,
                module_record,
                &mut visited_symbol_ids.clone(),
            );
            (consequent.is_some() && consequent == alternate).then_some(consequent.unwrap())
        }
        _ => rerender_default_foreign_react_dependency_index(
            initializer,
            semantic,
            module_record,
            visited_symbol_ids,
        ),
    }
}

fn rerender_default_foreign_destructured_dependency_index(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<usize> {
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    let hook_name = pattern.properties.iter().find_map(|property| {
        matches!(
            &property.value,
            BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id
        )
        .then(|| property.key.static_name())
        .flatten()
    })?;
    let dependency_index = rerender_default_hook_dependency_index(hook_name.as_ref())?;
    let Expression::Identifier(receiver) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    let receiver_symbol_id = semantic
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()?;
    rerender_default_foreign_import_for_symbol(receiver_symbol_id, semantic, module_record)
        .filter(|entry| {
            REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                && matches!(
                    entry.import_name,
                    ImportImportName::NamespaceObject | ImportImportName::Default(_)
                )
        })
        .map(|_| dependency_index)
}

fn rerender_default_hook_dependency_index(hook_name: &str) -> Option<usize> {
    DEPENDENCY_HOOK_NAMES
        .contains(&hook_name)
        .then_some(if hook_name == "useImperativeHandle" {
            2
        } else {
            1
        })
}

fn rerender_default_foreign_import_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    let symbol_id = rerender_default_foreign_resolve_const_root_symbol(
        identifier,
        semantic,
        &mut FxHashSet::default(),
    )?;
    let import_entry =
        rerender_default_foreign_import_for_symbol(symbol_id, semantic, module_record)?;
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return None,
    };
    Some((import_entry.module_request.name(), exported_name))
}

fn rerender_default_foreign_import_for_symbol<'a>(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    module_record: &'a ModuleRecord,
) -> Option<&'a crate::module_record::ImportEntry> {
    module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn rerender_default_foreign_resolve_const_root_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<SymbolId> {
    let symbol_id = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id)
        || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
    {
        return None;
    }
    let Some(initializer) = rerender_default_imported_const_initializer(symbol_id, semantic) else {
        return Some(symbol_id);
    };
    let Expression::Identifier(next_identifier) = initializer.get_inner_expression() else {
        return Some(symbol_id);
    };
    rerender_default_foreign_resolve_const_root_symbol(
        next_identifier,
        semantic,
        visited_symbol_ids,
    )
}

fn rerender_default_foreign_local_hook_function_id(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = rerender_default_foreign_resolve_const_root_symbol(
        identifier,
        semantic,
        &mut FxHashSet::default(),
    )?;
    let function_id = rerender_default_foreign_function_for_symbol(
        symbol_id,
        semantic,
        &mut FxHashSet::default(),
    )?;
    rerender_default_foreign_function_is_hook(function_id, "", semantic).then_some(function_id)
}

fn rerender_default_foreign_function_for_symbol(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    if !visited_symbol_ids.insert(symbol_id)
        || rerender_default_foreign_symbol_is_mutated(symbol_id, semantic)
    {
        return None;
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => {
                    let next_symbol_id = semantic
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    rerender_default_foreign_function_for_symbol(
                        next_symbol_id,
                        semantic,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn rerender_default_foreign_function_is_hook(
    function_id: NodeId,
    fallback_name: &str,
    semantic: &Semantic<'_>,
) -> bool {
    let function_node = semantic.nodes().get_node(function_id);
    let name = match function_node.kind() {
        AstKind::Function(function) => function.id.as_ref().map_or_else(
            || {
                let declaration = semantic.nodes().parent_node(function_id);
                match declaration.kind() {
                    AstKind::VariableDeclarator(declarator) => declarator
                        .id
                        .get_binding_identifier()
                        .map(|identifier| identifier.name.as_str()),
                    _ => None,
                }
            },
            |identifier| Some(identifier.name.as_str()),
        ),
        AstKind::ArrowFunctionExpression(_) => {
            let declaration = semantic.nodes().parent_node(function_id);
            match declaration.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.as_str()),
                _ => None,
            }
        }
        _ => None,
    }
    .unwrap_or(fallback_name);
    name != "use" && rerender_default_is_hook_name(name)
}

fn rerender_default_foreign_function_parameters<'a, 'semantic>(
    function_id: NodeId,
    semantic: &'semantic Semantic<'a>,
) -> Option<&'semantic FormalParameters<'a>> {
    match semantic.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(&function.params),
        AstKind::ArrowFunctionExpression(function) => Some(&function.params),
        _ => None,
    }
}

fn rerender_default_foreign_symbol_is_mutated(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
) -> bool {
    semantic
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let mut root = semantic.nodes().get_node(reference.node_id());
            loop {
                let parent = semantic.nodes().parent_node(root.id());
                let Some(member) = parent.kind().as_member_expression_kind() else {
                    break;
                };
                if member.object().span() != root.span() {
                    break;
                }
                root = parent;
            }
            let parent = semantic.nodes().parent_node(root.id());
            if matches!(
                parent.kind(),
                AstKind::AssignmentExpression(assignment) if assignment.left.span() == root.span()
            ) || matches!(
                parent.kind(),
                AstKind::UpdateExpression(update) if update.argument.span() == root.span()
            ) || matches!(
                parent.kind(),
                AstKind::UnaryExpression(unary)
                    if unary.operator == UnaryOperator::Delete && unary.argument.span() == root.span()
            ) {
                return true;
            }
            let AstKind::CallExpression(call) = parent.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            call.callee.span() == root.span()
                && member.static_property_name().is_some_and(|method_name| {
                    matches!(
                        method_name.as_ref(),
                        "push"
                            | "pop"
                            | "shift"
                            | "unshift"
                            | "splice"
                            | "sort"
                            | "reverse"
                            | "fill"
                            | "copyWithin"
                            | "add"
                            | "clear"
                            | "delete"
                            | "set"
                    )
                })
        })
}

fn rerender_default_foreign_node_is_reachable(
    node_id: NodeId,
    function_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    if rerender_default_foreign_is_inside_statically_unreachable_branch(node_id, semantic) {
        return false;
    }
    let Some(cfg) = semantic.cfg() else {
        return true;
    };
    let source_block = semantic.nodes().cfg_id(function_id);
    let target_block = semantic.nodes().cfg_id(node_id);
    if source_block == target_block {
        return true;
    }
    let graph = cfg.graph();
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = vec![source_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction | oxc_cfg::EdgeType::Unreachable
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if target == target_block {
                return true;
            }
            pending_blocks.push(target);
        }
    }
    false
}

fn rerender_default_foreign_is_inside_statically_unreachable_branch(
    node_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    let mut child = semantic.nodes().get_node(node_id);
    loop {
        let parent = semantic.nodes().parent_node(child.id());
        let child_span = child.span();
        match parent.kind() {
            AstKind::IfStatement(statement) => {
                if let Expression::BooleanLiteral(test) = &statement.test
                    && ((!test.value && statement.consequent.span() == child_span)
                        || (test.value
                            && statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| alternate.span() == child_span)))
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if let Expression::BooleanLiteral(test) = &expression.test
                    && ((!test.value && expression.consequent.span() == child_span)
                        || (test.value && expression.alternate.span() == child_span))
                {
                    return true;
                }
            }
            AstKind::WhileStatement(statement) => {
                if statement.body.span() == child_span
                    && static_literal_truthiness(&statement.test) == Some(false)
                {
                    return true;
                }
            }
            AstKind::ForStatement(statement) => {
                if statement.body.span() == child_span
                    && statement
                        .test
                        .as_ref()
                        .is_some_and(|test| static_literal_truthiness(test) == Some(false))
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                let left_truthiness = static_literal_truthiness(&expression.left);
                if (expression.operator == LogicalOperator::And && left_truthiness == Some(false))
                    || (expression.operator == LogicalOperator::Or && left_truthiness == Some(true))
                {
                    return true;
                }
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
        child = parent;
    }
}

fn rerender_default_imported_const_initializer<'a, 'semantic>(
    symbol_id: SymbolId,
    semantic: &'semantic Semantic<'a>,
) -> Option<&'semantic Expression<'a>> {
    if semantic
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        semantic.nodes().parent_kind(declaration.id()),
        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
    ) {
        return None;
    }
    declarator.init.as_ref()
}

fn rerender_default_imported_nearest_function_id(
    node_id: NodeId,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn rerender_default_resolve_const_object_expression<'a, 'ctx>(
    expression: &'ctx Expression<'a>,
    ctx: &'ctx LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<&'ctx oxc_ast::ast::ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id)
                || rerender_default_symbol_is_mutated(symbol_id, ctx)
            {
                return None;
            }
            rerender_default_resolve_const_object_expression(
                rerender_default_unreassigned_const_initializer(symbol_id, ctx)?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn rerender_default_symbol_is_mutated(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let mut root = ctx.nodes().get_node(reference.node_id());
            loop {
                let parent = ctx.nodes().parent_node(root.id());
                let Some(member) = parent.kind().as_member_expression_kind() else {
                    break;
                };
                if member.object().span() != root.span() {
                    break;
                }
                root = parent;
            }
            let parent = ctx.nodes().parent_node(root.id());
            if matches!(
                parent.kind(),
                AstKind::AssignmentExpression(assignment) if assignment.left.span() == root.span()
            ) || matches!(
                parent.kind(),
                AstKind::UpdateExpression(update) if update.argument.span() == root.span()
            ) || matches!(
                parent.kind(),
                AstKind::UnaryExpression(unary)
                    if unary.operator == UnaryOperator::Delete && unary.argument.span() == root.span()
            ) {
                return true;
            }
            let AstKind::CallExpression(call) = parent.kind() else {
                return false;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            call.callee.span() == root.span()
                && member.static_property_name().is_some_and(|method_name| {
                    matches!(
                        method_name.as_ref(),
                        "push"
                            | "pop"
                            | "shift"
                            | "unshift"
                            | "splice"
                            | "sort"
                            | "reverse"
                            | "fill"
                            | "copyWithin"
                            | "add"
                            | "clear"
                            | "delete"
                            | "set"
                    )
                })
        })
}
