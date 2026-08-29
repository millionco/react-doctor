use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayAssignmentTarget, AssignmentTarget, AssignmentTargetMaybeDefault,
        AssignmentTargetProperty, BindingPattern, CallExpression, Expression, ForStatementLeft,
        MemberExpression, ObjectAssignmentTarget, ObjectPropertyKind, RegExpFlags,
        SimpleAssignmentTarget, TSType,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`new RegExp()` rebuilds the pattern on every loop pass. Move it to a constant outside the loop.";
const ITERATOR_METHOD_NAMES: [&str; 12] = [
    "map",
    "flatMap",
    "forEach",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "reduce",
    "reduceRight",
];
const GLOBAL_OBJECT_NAMES: [&str; 4] = ["globalThis", "global", "window", "self"];
const GLOBAL_BUILTIN_NAMES: [&str; 4] = ["Object", "Reflect", "String", "RegExp"];

#[derive(Debug, Default, Clone)]
pub struct JsHoistRegexp;

#[derive(Clone, Copy, PartialEq, Eq)]
enum RegExpConstructionKind {
    Stateless,
    StatefulReplaceAll,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RegExpEnvironmentHazard {
    None,
    ReplaceAllIntegrityLost,
    GlobalRegExpReplaced,
}

declare_oxc_lint!(
    /// Warns when a static RegExp is rebuilt on every loop pass.
    JsHoistRegexp,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "RegExp built inside a loop.",
);

impl Rule for JsHoistRegexp {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut environment_hazard = None;
        for node in ctx.nodes().iter() {
            let (callee, arguments) = match node.kind() {
                AstKind::NewExpression(construction) => {
                    (&construction.callee, construction.arguments.as_slice())
                }
                AstKind::CallExpression(construction) => {
                    (&construction.callee, construction.arguments.as_slice())
                }
                _ => continue,
            };
            if !is_inside_repeated_execution(node, ctx) {
                continue;
            }
            let construction_kind = regexp_construction_kind(node, callee, arguments, ctx);
            let Some(construction_kind) = construction_kind else {
                continue;
            };
            let hazard = *environment_hazard.get_or_insert_with(|| scan_regexp_environment(ctx));
            if hazard == RegExpEnvironmentHazard::GlobalRegExpReplaced
                || construction_kind == RegExpConstructionKind::StatefulReplaceAll
                    && hazard == RegExpEnvironmentHazard::ReplaceAllIntegrityLost
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
        }
    }
}

fn regexp_construction_kind<'a>(
    node: &AstNode<'a>,
    callee: &Expression<'a>,
    arguments: &[Argument<'a>],
    ctx: &LintContext<'a>,
) -> Option<RegExpConstructionKind> {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return None;
    };
    if identifier.name != "RegExp" || !ctx.is_reference_to_global_variable(identifier) {
        return None;
    }
    let pattern = arguments.first()?.as_expression()?;
    if !is_static_regexp_pattern(pattern) {
        return None;
    }
    let flags = effective_regexp_flags(pattern, arguments.get(1))?;
    if !has_valid_regexp_flags(&flags) {
        return None;
    }
    if !flags.contains('g') && !flags.contains('y') {
        return Some(RegExpConstructionKind::Stateless);
    }
    (flags.contains('g') && is_safe_stateful_replace_all_search(node, ctx))
        .then_some(RegExpConstructionKind::StatefulReplaceAll)
}

fn is_static_regexp_pattern(expression: &Expression<'_>) -> bool {
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

fn effective_regexp_flags(
    pattern: &Expression<'_>,
    flags_argument: Option<&Argument<'_>>,
) -> Option<String> {
    if let Some(flags_argument) = flags_argument {
        return static_string_value(flags_argument.as_expression()?).map(str::to_string);
    }
    let Expression::RegExpLiteral(literal) = pattern.get_inner_expression() else {
        return Some(String::new());
    };
    Some(regexp_flags_string(literal.regex.flags))
}

fn static_string_value<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
            })
        }
        _ => None,
    }
}

fn regexp_flags_string(flags: RegExpFlags) -> String {
    [
        (RegExpFlags::D, 'd'),
        (RegExpFlags::G, 'g'),
        (RegExpFlags::I, 'i'),
        (RegExpFlags::M, 'm'),
        (RegExpFlags::S, 's'),
        (RegExpFlags::U, 'u'),
        (RegExpFlags::V, 'v'),
        (RegExpFlags::Y, 'y'),
    ]
    .into_iter()
    .filter_map(|(flag, character)| flags.contains(flag).then_some(character))
    .collect()
}

fn has_valid_regexp_flags(flags: &str) -> bool {
    let mut seen = FxHashSet::default();
    flags.chars().all(|flag| {
        matches!(flag, 'd' | 'g' | 'i' | 'm' | 's' | 'u' | 'v' | 'y') && seen.insert(flag)
    }) && !(flags.contains('u') && flags.contains('v'))
}

fn is_inside_repeated_execution(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_) => return true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                return is_iterator_callback(ancestor, ctx);
            }
            _ => {}
        }
    }
    false
}

fn is_iterator_callback(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) {
        return false;
    }
    call.callee
        .as_member_expression()
        .and_then(iterator_method_name)
        .is_some_and(|method_name| ITERATOR_METHOD_NAMES.contains(&method_name))
}

fn iterator_method_name<'a>(member: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = member.expression.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn is_safe_stateful_replace_all_search<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let search_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(search_root.id());
    let AstKind::CallExpression(replace_all_call) = parent.kind() else {
        return false;
    };
    if replace_all_call.optional
        || !replace_all_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| argument.span() == search_root.span())
    {
        return false;
    }
    let Expression::StaticMemberExpression(member) = replace_all_call.callee.get_inner_expression()
    else {
        return false;
    };
    member.property.name == "replaceAll"
        && !member.optional
        && is_proven_native_string_receiver(&member.object, ctx, &mut FxHashSet::default())
}

fn is_proven_native_string_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => true,
        Expression::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "String" && ctx.is_reference_to_global_variable(identifier))
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            if symbol_has_string_annotation(symbol_id, ctx)
                || is_glob_sync_string_iteration_binding(symbol_id, ctx)
            {
                return true;
            }
            stable_const_initializer(symbol_id, ctx).is_some_and(|initializer| {
                is_proven_native_string_receiver(initializer, ctx, visited_symbol_ids)
            })
        }
        _ => false,
    }
}

fn symbol_has_string_annotation(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let annotation = match declaration.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
        {
            declarator.type_annotation.as_ref()
        }
        AstKind::FormalParameter(parameter)
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
        {
            parameter.type_annotation.as_ref()
        }
        _ => None,
    };
    annotation
        .is_some_and(|annotation| matches!(&annotation.type_annotation, TSType::TSStringKeyword(_)))
}

fn stable_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    (variable_declaration.kind.is_const()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id))
    .then(|| declarator.init.as_ref())?
}

fn is_glob_sync_string_iteration_binding(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
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
    let variable_declaration_node = ctx.nodes().parent_node(declaration.id());
    if !matches!(variable_declaration_node.kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
    {
        return false;
    }
    let loop_node = ctx.nodes().parent_node(variable_declaration_node.id());
    let AstKind::ForOfStatement(statement) = loop_node.kind() else {
        return false;
    };
    let Expression::CallExpression(call) = statement.right.get_inner_expression() else {
        return false;
    };
    glob_sync_returns_string_paths(call, ctx)
}

fn glob_sync_returns_string_paths(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    if call
        .arguments
        .iter()
        .any(|argument| argument.as_expression().is_none())
        || !is_glob_sync_import_call(call, ctx)
    {
        return false;
    }
    let Some(options) = call.arguments.get(1) else {
        return true;
    };
    let Some(options) = options.as_expression() else {
        return false;
    };
    let Expression::ObjectExpression(options) = options.get_inner_expression() else {
        return false;
    };
    for property in &options.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let Some(property_name) = property.key.static_name() else {
            return false;
        };
        if property_name == "withFileTypes"
            && !matches!(property.value.get_inner_expression(), Expression::BooleanLiteral(value) if !value.value)
        {
            return false;
        }
    }
    true
}

fn is_glob_sync_import_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => direct_glob_sync_import(identifier, ctx),
        Expression::StaticMemberExpression(member) if member.property.name == "globSync" => {
            let Expression::Identifier(namespace) = member.object.get_inner_expression() else {
                return false;
            };
            namespace_glob_import(namespace, ctx)
        }
        _ => false,
    }
}

fn direct_glob_sync_import(
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
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "glob"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(name) if name.name() == "globSync")
    })
}

fn namespace_glob_import(
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
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "glob"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
    })
}

fn scan_regexp_environment(ctx: &LintContext<'_>) -> RegExpEnvironmentHazard {
    let mut strongest = RegExpEnvironmentHazard::None;
    for node in ctx.nodes().iter() {
        if let AstKind::IdentifierReference(identifier) = node.kind()
            && identifier.name == "RegExp"
        {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            if reference.symbol_id().is_none() && reference.is_write() {
                return RegExpEnvironmentHazard::GlobalRegExpReplaced;
            }
        }
        let hazard = match node.kind() {
            AstKind::AssignmentExpression(assignment) => {
                assignment_target_hazard(&assignment.left, ctx)
            }
            AstKind::UpdateExpression(update) => {
                simple_assignment_target_hazard(&update.argument, ctx)
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                expression_assignment_hazard(&unary.argument, ctx)
            }
            AstKind::ForInStatement(statement) => for_statement_left_hazard(&statement.left, ctx),
            AstKind::ForOfStatement(statement) => for_statement_left_hazard(&statement.left, ctx),
            AstKind::CallExpression(call) => call_regexp_hazard(call, ctx),
            _ => RegExpEnvironmentHazard::None,
        };
        strongest = stronger_hazard(strongest, hazard);
        if strongest == RegExpEnvironmentHazard::GlobalRegExpReplaced {
            return strongest;
        }
    }
    strongest
}

fn stronger_hazard(
    first: RegExpEnvironmentHazard,
    second: RegExpEnvironmentHazard,
) -> RegExpEnvironmentHazard {
    if first == RegExpEnvironmentHazard::GlobalRegExpReplaced
        || second == RegExpEnvironmentHazard::GlobalRegExpReplaced
    {
        RegExpEnvironmentHazard::GlobalRegExpReplaced
    } else if first == RegExpEnvironmentHazard::ReplaceAllIntegrityLost
        || second == RegExpEnvironmentHazard::ReplaceAllIntegrityLost
    {
        RegExpEnvironmentHazard::ReplaceAllIntegrityLost
    } else {
        RegExpEnvironmentHazard::None
    }
}

fn assignment_target_hazard(
    target: &AssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    if let Some(target) = target.as_simple_assignment_target() {
        return simple_assignment_target_hazard(target, ctx);
    }
    match target {
        AssignmentTarget::ArrayAssignmentTarget(target) => {
            array_assignment_target_hazard(target, ctx)
        }
        AssignmentTarget::ObjectAssignmentTarget(target) => {
            object_assignment_target_hazard(target, ctx)
        }
        _ => RegExpEnvironmentHazard::None,
    }
}

fn for_statement_left_hazard(
    target: &ForStatementLeft<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    if let Some(target) = target.as_simple_assignment_target() {
        return simple_assignment_target_hazard(target, ctx);
    }
    match target {
        ForStatementLeft::ArrayAssignmentTarget(target) => {
            array_assignment_target_hazard(target, ctx)
        }
        ForStatementLeft::ObjectAssignmentTarget(target) => {
            object_assignment_target_hazard(target, ctx)
        }
        _ => RegExpEnvironmentHazard::None,
    }
}

fn array_assignment_target_hazard(
    target: &ArrayAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    let mut strongest = RegExpEnvironmentHazard::None;
    for element in target.elements.iter().flatten() {
        strongest = stronger_hazard(
            strongest,
            assignment_target_maybe_default_hazard(element, ctx),
        );
    }
    if let Some(rest) = &target.rest {
        strongest = stronger_hazard(strongest, assignment_target_hazard(&rest.target, ctx));
    }
    strongest
}

fn object_assignment_target_hazard(
    target: &ObjectAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    let mut strongest = RegExpEnvironmentHazard::None;
    for property in &target.properties {
        if let AssignmentTargetProperty::AssignmentTargetPropertyProperty(property) = property {
            strongest = stronger_hazard(
                strongest,
                assignment_target_maybe_default_hazard(&property.binding, ctx),
            );
        }
    }
    if let Some(rest) = &target.rest {
        strongest = stronger_hazard(strongest, assignment_target_hazard(&rest.target, ctx));
    }
    strongest
}

fn assignment_target_maybe_default_hazard(
    target: &AssignmentTargetMaybeDefault<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    if let Some(target) = target.as_simple_assignment_target() {
        return simple_assignment_target_hazard(target, ctx);
    }
    match target {
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(target) => {
            assignment_target_hazard(&target.binding, ctx)
        }
        AssignmentTargetMaybeDefault::ArrayAssignmentTarget(target) => {
            array_assignment_target_hazard(target, ctx)
        }
        AssignmentTargetMaybeDefault::ObjectAssignmentTarget(target) => {
            object_assignment_target_hazard(target, ctx)
        }
        _ => RegExpEnvironmentHazard::None,
    }
}

fn simple_assignment_target_hazard(
    target: &SimpleAssignmentTarget<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    if let Some(member) = target.as_member_expression() {
        return member_assignment_hazard(member, ctx);
    }
    let expression = match target {
        SimpleAssignmentTarget::TSAsExpression(target) => &target.expression,
        SimpleAssignmentTarget::TSSatisfiesExpression(target) => &target.expression,
        SimpleAssignmentTarget::TSNonNullExpression(target) => &target.expression,
        SimpleAssignmentTarget::TSTypeAssertion(target) => &target.expression,
        _ => return RegExpEnvironmentHazard::None,
    };
    expression_assignment_hazard(expression, ctx)
}

fn expression_assignment_hazard(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    expression
        .get_inner_expression()
        .as_member_expression()
        .map_or(RegExpEnvironmentHazard::None, |member| {
            member_assignment_hazard(member, ctx)
        })
}

fn member_assignment_hazard(
    member: &MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    member_assignment_parts_hazard(member.object(), member.static_property_name(), ctx)
}

fn member_assignment_parts_hazard(
    object: &Expression<'_>,
    property_name: Option<&str>,
    ctx: &LintContext<'_>,
) -> RegExpEnvironmentHazard {
    let object_path = resolve_global_path(object, ctx, &mut FxHashSet::default());
    match object_path.as_deref() {
        Some("global") if property_name.is_none() || property_name == Some("RegExp") => {
            RegExpEnvironmentHazard::GlobalRegExpReplaced
        }
        Some("RegExp.prototype") => RegExpEnvironmentHazard::ReplaceAllIntegrityLost,
        Some("String.prototype")
            if property_name.is_none() || property_name == Some("replaceAll") =>
        {
            RegExpEnvironmentHazard::ReplaceAllIntegrityLost
        }
        _ => RegExpEnvironmentHazard::None,
    }
}

fn resolve_global_path(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            if GLOBAL_OBJECT_NAMES.contains(&identifier.name.as_str()) {
                return Some("global".to_string());
            }
            return GLOBAL_BUILTIN_NAMES
                .contains(&identifier.name.as_str())
                .then(|| identifier.name.to_string());
        };
        if !visited_symbol_ids.insert(symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| !reference.is_read() || reference.is_write())
        {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let variable_declaration = ctx.nodes().parent_node(declaration.id());
        if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        {
            return None;
        }
        let initializer = declarator.init.as_ref()?;
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return resolve_global_path(initializer, ctx, visited_symbol_ids);
        }
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return None;
        };
        let property_name = pattern.properties.iter().find_map(|property| {
            binding_pattern_contains_symbol(&property.value, symbol_id)
                .then(|| property.key.static_name())
                .flatten()
        })?;
        return extend_global_path(
            resolve_global_path(initializer, ctx, visited_symbol_ids)?,
            Some(property_name.as_ref()),
        );
    }
    let member = expression.as_member_expression()?;
    extend_global_path(
        resolve_global_path(member.object(), ctx, visited_symbol_ids)?,
        member.static_property_name(),
    )
}

fn binding_pattern_contains_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            binding_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ArrayPattern(pattern) => {
            pattern
                .elements
                .iter()
                .flatten()
                .any(|element| binding_pattern_contains_symbol(element, symbol_id))
                || pattern
                    .rest
                    .as_ref()
                    .is_some_and(|rest| binding_pattern_contains_symbol(&rest.argument, symbol_id))
        }
        BindingPattern::ObjectPattern(pattern) => {
            pattern
                .properties
                .iter()
                .any(|property| binding_pattern_contains_symbol(&property.value, symbol_id))
                || pattern
                    .rest
                    .as_ref()
                    .is_some_and(|rest| binding_pattern_contains_symbol(&rest.argument, symbol_id))
        }
    }
}

fn extend_global_path(base: String, property_name: Option<&str>) -> Option<String> {
    match base.as_str() {
        "global" => match property_name {
            None => Some(base),
            Some(property_name) if GLOBAL_OBJECT_NAMES.contains(&property_name) => Some(base),
            Some(property_name) if GLOBAL_BUILTIN_NAMES.contains(&property_name) => {
                Some(property_name.to_string())
            }
            _ => None,
        },
        "Object" | "Reflect" => property_name.map(|property| format!("{base}.{property}")),
        "String" | "RegExp" if property_name == Some("prototype") => {
            Some(format!("{base}.prototype"))
        }
        "String.prototype" | "RegExp.prototype" => {
            property_name.map(|property| format!("{base}.{property}"))
        }
        _ => None,
    }
}

fn call_regexp_hazard(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> RegExpEnvironmentHazard {
    let Some(method_path) = resolve_global_path(&call.callee, ctx, &mut FxHashSet::default())
    else {
        return RegExpEnvironmentHazard::None;
    };
    let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
        return RegExpEnvironmentHazard::None;
    };
    let Some(target_path) = resolve_global_path(target, ctx, &mut FxHashSet::default()) else {
        return RegExpEnvironmentHazard::None;
    };
    let is_single_property_mutation = matches!(
        method_path.as_str(),
        "Object.defineProperty"
            | "Reflect.set"
            | "Reflect.defineProperty"
            | "Reflect.deleteProperty"
    );
    let is_property_collection_mutation = matches!(
        method_path.as_str(),
        "Object.defineProperties" | "Object.assign"
    );
    if target_path == "RegExp.prototype" {
        return (is_single_property_mutation
            || is_property_collection_mutation
            || matches!(
                method_path.as_str(),
                "Object.setPrototypeOf" | "Reflect.setPrototypeOf"
            ))
        .then_some(RegExpEnvironmentHazard::ReplaceAllIntegrityLost)
        .unwrap_or(RegExpEnvironmentHazard::None);
    }
    if target_path != "String.prototype" && target_path != "global" {
        return RegExpEnvironmentHazard::None;
    }
    let hazard = if target_path == "global" {
        RegExpEnvironmentHazard::GlobalRegExpReplaced
    } else {
        RegExpEnvironmentHazard::ReplaceAllIntegrityLost
    };
    let guarded_property_name = if target_path == "global" {
        "RegExp"
    } else {
        "replaceAll"
    };
    if is_single_property_mutation {
        return match call.arguments.get(1).and_then(Argument::as_expression) {
            Some(property) if static_string_value(property) == Some(guarded_property_name) => {
                hazard
            }
            Some(property) if static_string_value(property).is_some() => {
                RegExpEnvironmentHazard::None
            }
            _ => hazard,
        };
    }
    if !is_property_collection_mutation {
        return RegExpEnvironmentHazard::None;
    }
    if method_path == "Object.defineProperties" && target_path == "global" {
        return call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
            .is_none_or(|source| {
                object_expression_may_define_property(source, guarded_property_name)
            })
            .then_some(hazard)
            .unwrap_or(RegExpEnvironmentHazard::None);
    }
    let definition_sources = call.arguments.get(1..).unwrap_or_default();
    definition_sources
        .iter()
        .any(|source| {
            source.as_expression().is_none_or(|source| {
                object_expression_may_define_property(source, guarded_property_name)
            })
        })
        .then_some(hazard)
        .unwrap_or(RegExpEnvironmentHazard::None)
}

fn object_expression_may_define_property(
    expression: &Expression<'_>,
    target_property_name: &str,
) -> bool {
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return true;
    };
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return true;
        };
        property
            .key
            .static_name()
            .is_none_or(|name| name == target_property_name)
    })
}
