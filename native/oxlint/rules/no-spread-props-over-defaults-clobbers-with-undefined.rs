use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, ObjectExpression, ObjectPropertyKind, TSSignature, TSType,
        TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Spreading props after defaults can replace a declared default with explicit undefined before that value reaches a computation. Reapply the default with ?? or strip undefined keys before merging.";

#[derive(Debug, Default, Clone)]
pub struct NoSpreadPropsOverDefaultsClobbersWithUndefined;

declare_oxc_lint!(
    /// Warns when a props spread can replace an earlier default with undefined.
    NoSpreadPropsOverDefaultsClobbersWithUndefined,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when props spread after defaults can clobber them with undefined.",
);

impl Rule for NoSpreadPropsOverDefaultsClobbersWithUndefined {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut visible_defaults_cache = FxHashMap::default();
        let mut repair_cache = spread_clobber_build_repair_cache(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::ObjectExpression(object) = node.kind() else {
                continue;
            };
            if spread_clobber_reports_object(
                node,
                object,
                &mut visible_defaults_cache,
                &mut repair_cache,
                ctx,
            ) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(object.span));
            }
        }
    }
}

fn spread_clobber_reports_object<'a>(
    object_node: &AstNode<'a>,
    object: &ObjectExpression<'a>,
    visible_defaults_cache: &mut FxHashMap<SymbolId, Option<FxHashMap<String, bool>>>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> bool {
    let spreads = object
        .properties
        .iter()
        .filter_map(|property| match property {
            ObjectPropertyKind::SpreadProperty(spread) => Some(spread),
            ObjectPropertyKind::ObjectProperty(_) => None,
        })
        .collect::<Vec<_>>();
    if spreads.len() < 2 {
        return false;
    }
    let Some(owner) = crate::ast_util::get_enclosing_function(object_node, ctx) else {
        return false;
    };
    if component_or_hook_function_name(owner, ctx).is_none() {
        return false;
    }
    for props_index in 1..spreads.len() {
        let props_spread = spreads[props_index];
        let Expression::Identifier(props_identifier) = props_spread.argument.get_inner_expression()
        else {
            continue;
        };
        let Some(parameter_symbol_id) =
            spread_clobber_parameter_root_symbol(props_identifier, ctx, &mut Vec::new())
        else {
            continue;
        };
        let mut defaulted_keys = FxHashSet::default();
        let mut has_unknown_defaulted_keys = false;
        for defaults_spread in &spreads[..props_index] {
            if !spread_clobber_is_defaults_source(&defaults_spread.argument) {
                continue;
            }
            let Some(writes) = spread_clobber_visible_property_writes(
                &defaults_spread.argument,
                visible_defaults_cache,
                ctx,
            ) else {
                has_unknown_defaulted_keys = true;
                continue;
            };
            for (key, is_safe) in writes {
                if is_safe {
                    defaulted_keys.insert(key);
                }
            }
        }
        if defaulted_keys.is_empty() && !has_unknown_defaulted_keys {
            continue;
        }
        let has_write_after_props = object
            .properties
            .iter()
            .any(|property| property.span().start > props_spread.span.start);
        if has_unknown_defaulted_keys && has_write_after_props {
            continue;
        }
        let mut last_write_by_key = FxHashMap::default();
        for property in &object.properties {
            if property.span().start <= props_spread.span.start {
                continue;
            }
            match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    if let Some(key) = property.key.static_name() {
                        last_write_by_key.insert(
                            key.to_string(),
                            spread_clobber_expression_is_non_undefined(
                                &property.value,
                                ctx,
                                &mut Vec::new(),
                            ),
                        );
                    }
                }
                ObjectPropertyKind::SpreadProperty(spread) => {
                    if let Some(writes) = spread_clobber_visible_property_writes(
                        &spread.argument,
                        visible_defaults_cache,
                        ctx,
                    ) {
                        for (key, is_safe) in writes {
                            if defaulted_keys.contains(&key) {
                                last_write_by_key.insert(key, is_safe);
                            }
                        }
                    } else {
                        for key in &defaulted_keys {
                            last_write_by_key.insert(key.clone(), false);
                        }
                    }
                }
            }
        }
        let candidate_keys = (!has_unknown_defaulted_keys).then(|| {
            defaulted_keys
                .iter()
                .filter(|key| last_write_by_key.get(*key) != Some(&true))
                .cloned()
                .collect::<FxHashSet<_>>()
        });
        if candidate_keys.as_ref().is_some_and(FxHashSet::is_empty) {
            continue;
        }
        let parameter_type =
            spread_clobber_function_parameter_type(owner, parameter_symbol_id, ctx);
        if spread_clobber_object_feeds_computation(
            object_node,
            candidate_keys.as_ref(),
            parameter_type,
            repair_cache,
            ctx,
        ) {
            return true;
        }
    }
    false
}

fn spread_clobber_is_defaults_source(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            spread_clobber_defaults_name(identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member| member.static_property_name() == Some("defaultProps")),
    }
}

fn spread_clobber_defaults_name(name: &str) -> bool {
    if name == "defaultProps" || name == "default" || name == "defaults" {
        return true;
    }
    if let Some(suffix) = name.strip_prefix("defaults") {
        return suffix
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_uppercase() || character == '_');
    }
    if let Some(suffix) = name.strip_prefix("default") {
        return suffix
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_uppercase() || character == '_');
    }
    let is_uppercase_name = name.chars().all(|character| {
        character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
    });
    is_uppercase_name && name.contains("DEFAULT")
}

fn spread_clobber_parameter_root_symbol<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> Option<SymbolId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
        return Some(symbol_id);
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return None;
    }
    let Expression::Identifier(source) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    visited.push(symbol_id);
    let root = spread_clobber_parameter_root_symbol(source, ctx, visited);
    visited.pop();
    root
}

fn spread_clobber_visible_property_writes<'a>(
    expression: &Expression<'a>,
    cache: &mut FxHashMap<SymbolId, Option<FxHashMap<String, bool>>>,
    ctx: &LintContext<'a>,
) -> Option<FxHashMap<String, bool>> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if let Some(cached) = cache.get(&symbol_id) {
        return cached.clone();
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let writes = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            let Expression::ObjectExpression(object) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                cache.insert(symbol_id, None);
                return None;
            };
            let mut writes = FxHashMap::default();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    cache.insert(symbol_id, None);
                    return None;
                };
                let Some(key) = property.key.static_name() else {
                    cache.insert(symbol_id, None);
                    return None;
                };
                writes.insert(
                    key.to_string(),
                    spread_clobber_expression_is_non_undefined(
                        &property.value,
                        ctx,
                        &mut Vec::new(),
                    ),
                );
            }
            Some(writes)
        }
        _ => None,
    };
    cache.insert(symbol_id, writes.clone());
    writes
}

fn spread_clobber_expression_is_non_undefined<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited.contains(&symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if matches!(declaration.kind(), AstKind::Function(_)) {
                return true;
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(initializer) = &declarator.init else {
                return false;
            };
            visited.push(symbol_id);
            let result = spread_clobber_expression_is_non_undefined(initializer, ctx, visited);
            visited.pop();
            result
        }
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::TemplateLiteral(_)
        | Expression::NewExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_) => true,
        Expression::UnaryExpression(unary) => unary.operator != UnaryOperator::Void,
        Expression::BinaryExpression(_) => true,
        Expression::LogicalExpression(logical)
            if matches!(
                logical.operator,
                LogicalOperator::Coalesce | LogicalOperator::Or
            ) =>
        {
            spread_clobber_expression_is_non_undefined(&logical.right, ctx, visited)
        }
        Expression::ConditionalExpression(conditional) => {
            spread_clobber_expression_is_non_undefined(&conditional.consequent, ctx, visited)
                && spread_clobber_expression_is_non_undefined(&conditional.alternate, ctx, visited)
        }
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum SpreadClobberType<'a> {
    Type(&'a TSType<'a>),
    Interface(&'a oxc_ast::ast::TSInterfaceDeclaration<'a>),
    Alias(&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>),
}

#[derive(Clone, Copy)]
struct SpreadClobberRepair {
    start: u32,
    is_safe: bool,
}

#[derive(Default)]
struct SpreadClobberRepairCache {
    repairs_by_symbol:
        FxHashMap<SymbolId, FxHashMap<NodeId, FxHashMap<String, Vec<SpreadClobberRepair>>>>,
    indexed_symbols: FxHashSet<SymbolId>,
    unconditional_by_cfg_pair: FxHashMap<(oxc_cfg::BlockNodeId, oxc_cfg::BlockNodeId), bool>,
}

fn spread_clobber_build_repair_cache(_ctx: &LintContext<'_>) -> SpreadClobberRepairCache {
    SpreadClobberRepairCache::default()
}

fn spread_clobber_function_parameter_type<'a>(
    function_node: &AstNode<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<SpreadClobberType<'a>> {
    let contextual_type = spread_clobber_contextual_parameter_type(function_node, ctx);
    let parameters = match function_node.kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return None,
    };
    for (index, parameter) in parameters.iter().enumerate() {
        let parameter_type = parameter
            .type_annotation
            .as_ref()
            .map(|annotation| SpreadClobberType::Type(&annotation.type_annotation))
            .or_else(|| (index == 0).then_some(contextual_type).flatten());
        if spread_clobber_pattern_contains_symbol(&parameter.pattern, symbol_id) {
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return parameter_type;
            }
            let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                return None;
            };
            for property in &pattern.properties {
                if !spread_clobber_pattern_contains_symbol(&property.value, symbol_id) {
                    continue;
                }
                let property_name = property.key.static_name()?;
                return spread_clobber_property_type(parameter_type?, property_name.as_ref(), ctx);
            }
            if pattern.rest.as_ref().is_some_and(|rest| {
                spread_clobber_pattern_contains_symbol(&rest.argument, symbol_id)
            }) {
                return parameter_type;
            }
        }
    }
    None
}

fn spread_clobber_contextual_parameter_type<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SpreadClobberType<'a>> {
    let root = transparent_expression_root(function_node, ctx);
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().parent_node(root.id()).kind() else {
        return None;
    };
    let annotation = declarator.type_annotation.as_ref()?;
    if !spread_clobber_type_proves_react_component(
        &annotation.type_annotation,
        ctx,
        &mut Vec::new(),
    ) {
        return None;
    }
    let TSType::TSTypeReference(reference) = &annotation.type_annotation else {
        return None;
    };
    reference
        .type_arguments
        .as_ref()?
        .params
        .first()
        .map(SpreadClobberType::Type)
}

fn spread_clobber_type_proves_react_component<'a>(
    type_node: &TSType<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match type_node {
        TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
            spread_clobber_type_proves_react_component(member, ctx, visited_symbol_ids)
        }),
        TSType::TSParenthesizedType(parenthesized) => spread_clobber_type_proves_react_component(
            &parenthesized.type_annotation,
            ctx,
            visited_symbol_ids,
        ),
        TSType::TSTypeReference(reference) => spread_clobber_type_name_proves_react_component(
            &reference.type_name,
            ctx,
            visited_symbol_ids,
        ),
        _ => false,
    }
}

fn spread_clobber_type_name_proves_react_component<'a>(
    type_name: &TSTypeName<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    const REACT_COMPONENT_TYPE_NAMES: [&str; 4] =
        ["ComponentClass", "ComponentType", "FC", "FunctionComponent"];
    match type_name {
        TSTypeName::QualifiedName(qualified) => {
            if !REACT_COMPONENT_TYPE_NAMES.contains(&qualified.right.name.as_str()) {
                return false;
            }
            let TSTypeName::IdentifierReference(namespace) = &qualified.left else {
                return false;
            };
            let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(namespace, ctx) else {
                return false;
            };
            spread_clobber_react_import_matches(symbol_id, None, ctx)
        }
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx)
            else {
                return false;
            };
            if spread_clobber_react_import_matches(
                symbol_id,
                Some(&REACT_COMPONENT_TYPE_NAMES),
                ctx,
            ) {
                return true;
            }
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(declaration.kind(), AstKind::TSTypeAliasDeclaration(alias)
            if spread_clobber_type_proves_react_component(
                &alias.type_annotation,
                ctx,
                visited_symbol_ids,
            ))
        }
        TSTypeName::ThisExpression(_) => false,
    }
}

fn spread_clobber_react_import_matches(
    symbol_id: SymbolId,
    expected_named_imports: Option<&[&str]>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        if entry.module_request.name() != "react"
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
        {
            return false;
        }
        match (&entry.import_name, expected_named_imports) {
            (
                crate::module_record::ImportImportName::Default(_)
                | crate::module_record::ImportImportName::NamespaceObject,
                None,
            ) => true,
            (crate::module_record::ImportImportName::Name(imported_name), Some(expected)) => {
                expected.contains(&imported_name.name())
            }
            _ => false,
        }
    })
}

fn spread_clobber_pattern_contains_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            spread_clobber_pattern_contains_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object) => {
            object
                .properties
                .iter()
                .any(|property| spread_clobber_pattern_contains_symbol(&property.value, symbol_id))
                || object.rest.as_ref().is_some_and(|rest| {
                    spread_clobber_pattern_contains_symbol(&rest.argument, symbol_id)
                })
        }
        BindingPattern::ArrayPattern(array) => {
            array
                .elements
                .iter()
                .flatten()
                .any(|element| spread_clobber_pattern_contains_symbol(element, symbol_id))
                || array.rest.as_ref().is_some_and(|rest| {
                    spread_clobber_pattern_contains_symbol(&rest.argument, symbol_id)
                })
        }
    }
}

fn spread_clobber_type_reference_name<'a>(name: &'a TSTypeName<'a>) -> Option<&'a str> {
    match name {
        TSTypeName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        TSTypeName::QualifiedName(_) | TSTypeName::ThisExpression(_) => None,
    }
}

fn spread_clobber_type_for_name<'a>(
    name: &TSTypeName<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, SpreadClobberType<'a>)> {
    let TSTypeName::IdentifierReference(identifier) = name else {
        return None;
    };
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
        return None;
    };
    match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::TSInterfaceDeclaration(declaration) => {
            Some((symbol_id, SpreadClobberType::Interface(declaration)))
        }
        AstKind::TSTypeAliasDeclaration(declaration) => {
            Some((symbol_id, SpreadClobberType::Alias(declaration)))
        }
        _ => None,
    }
}

fn spread_clobber_property_type<'a>(
    resolved: SpreadClobberType<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> Option<SpreadClobberType<'a>> {
    spread_clobber_property_type_inner(resolved, property_name, &mut FxHashSet::default(), ctx)
}

fn spread_clobber_property_type_inner<'a>(
    resolved: SpreadClobberType<'a>,
    property_name: &str,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> Option<SpreadClobberType<'a>> {
    match resolved {
        SpreadClobberType::Alias(alias) => spread_clobber_property_type_inner(
            SpreadClobberType::Type(&alias.type_annotation),
            property_name,
            visited_symbol_ids,
            ctx,
        ),
        SpreadClobberType::Interface(interface) => {
            spread_clobber_property_from_members(&interface.body.body, property_name)
                .map(SpreadClobberType::Type)
                .or_else(|| {
                    interface.extends.iter().find_map(|heritage| {
                        let (symbol_id, nested) =
                            spread_clobber_type_for_name(&heritage.type_name, ctx)?;
                        let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                        if !branch_visited_symbol_ids.insert(symbol_id) {
                            return None;
                        }
                        spread_clobber_property_type_inner(
                            nested,
                            property_name,
                            &mut branch_visited_symbol_ids,
                            ctx,
                        )
                    })
                })
        }
        SpreadClobberType::Type(type_node) => match type_node {
            TSType::TSAnyKeyword(_) => Some(resolved),
            TSType::TSTypeLiteral(literal) => {
                spread_clobber_property_from_members(&literal.members, property_name)
                    .map(SpreadClobberType::Type)
            }
            TSType::TSTypeReference(reference) => {
                let name = spread_clobber_type_reference_name(&reference.type_name)?;
                if matches!(name, "Partial" | "Readonly") {
                    return spread_clobber_property_type_inner(
                        SpreadClobberType::Type(reference.type_arguments.as_ref()?.params.first()?),
                        property_name,
                        visited_symbol_ids,
                        ctx,
                    );
                }
                let (symbol_id, nested) = spread_clobber_type_for_name(&reference.type_name, ctx)?;
                if !visited_symbol_ids.insert(symbol_id) {
                    return None;
                }
                spread_clobber_property_type_inner(nested, property_name, visited_symbol_ids, ctx)
            }
            TSType::TSIntersectionType(intersection) => {
                intersection.types.iter().find_map(|nested| {
                    let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                    spread_clobber_property_type_inner(
                        SpreadClobberType::Type(nested),
                        property_name,
                        &mut branch_visited_symbol_ids,
                        ctx,
                    )
                })
            }
            TSType::TSUnionType(union) => union.types.iter().find_map(|nested| {
                let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                spread_clobber_property_type_inner(
                    SpreadClobberType::Type(nested),
                    property_name,
                    &mut branch_visited_symbol_ids,
                    ctx,
                )
            }),
            _ => None,
        },
    }
}

fn spread_clobber_property_from_members<'a>(
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

fn spread_clobber_type_allows_undefined_for_key<'a>(
    resolved: SpreadClobberType<'a>,
    key: &str,
    ctx: &LintContext<'a>,
) -> bool {
    spread_clobber_type_allows_undefined_for_key_inner(
        resolved,
        key,
        &mut FxHashSet::default(),
        ctx,
    )
}

fn spread_clobber_type_allows_undefined_for_key_inner<'a>(
    resolved: SpreadClobberType<'a>,
    key: &str,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    match resolved {
        SpreadClobberType::Alias(alias) => spread_clobber_type_allows_undefined_for_key_inner(
            SpreadClobberType::Type(&alias.type_annotation),
            key,
            visited_symbol_ids,
            ctx,
        ),
        SpreadClobberType::Interface(interface) => {
            if let Some(property) = spread_clobber_property_signature(&interface.body.body, key) {
                return property.optional
                    || property.type_annotation.as_ref().is_some_and(|annotation| {
                        spread_clobber_type_includes_undefined(&annotation.type_annotation)
                    });
            }
            interface.extends.iter().any(|heritage| {
                let Some((symbol_id, nested)) =
                    spread_clobber_type_for_name(&heritage.type_name, ctx)
                else {
                    return false;
                };
                let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                branch_visited_symbol_ids.insert(symbol_id)
                    && spread_clobber_type_allows_undefined_for_key_inner(
                        nested,
                        key,
                        &mut branch_visited_symbol_ids,
                        ctx,
                    )
            })
        }
        SpreadClobberType::Type(type_node) => match type_node {
            TSType::TSAnyKeyword(_) => true,
            TSType::TSTypeLiteral(literal) => {
                spread_clobber_property_signature(&literal.members, key).is_some_and(|property| {
                    property.optional
                        || property.type_annotation.as_ref().is_some_and(|annotation| {
                            spread_clobber_type_includes_undefined(&annotation.type_annotation)
                        })
                })
            }
            TSType::TSTypeReference(reference) => {
                let Some(name) = spread_clobber_type_reference_name(&reference.type_name) else {
                    return false;
                };
                if name == "Partial" {
                    return reference.type_arguments.as_ref().is_some_and(|arguments| {
                        arguments.params.first().is_some_and(|argument| {
                            spread_clobber_property_type(
                                SpreadClobberType::Type(argument),
                                key,
                                ctx,
                            )
                            .is_some()
                        })
                    });
                }
                if name == "Readonly" {
                    return reference.type_arguments.as_ref().is_some_and(|arguments| {
                        arguments.params.first().is_some_and(|argument| {
                            spread_clobber_type_allows_undefined_for_key_inner(
                                SpreadClobberType::Type(argument),
                                key,
                                visited_symbol_ids,
                                ctx,
                            )
                        })
                    });
                }
                let Some((symbol_id, nested)) =
                    spread_clobber_type_for_name(&reference.type_name, ctx)
                else {
                    return false;
                };
                if !visited_symbol_ids.insert(symbol_id) {
                    return false;
                }
                spread_clobber_type_allows_undefined_for_key_inner(
                    nested,
                    key,
                    visited_symbol_ids,
                    ctx,
                )
            }
            TSType::TSUnionType(union) => union.types.iter().any(|nested| {
                let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                spread_clobber_type_allows_undefined_for_key_inner(
                    SpreadClobberType::Type(nested),
                    key,
                    &mut branch_visited_symbol_ids,
                    ctx,
                )
            }),
            TSType::TSIntersectionType(intersection) => {
                let mut relevant_count = 0;
                for nested in &intersection.types {
                    if spread_clobber_property_type(SpreadClobberType::Type(nested), key, ctx)
                        .is_none()
                    {
                        continue;
                    }
                    relevant_count += 1;
                    let mut branch_visited_symbol_ids = visited_symbol_ids.clone();
                    if !spread_clobber_type_allows_undefined_for_key_inner(
                        SpreadClobberType::Type(nested),
                        key,
                        &mut branch_visited_symbol_ids,
                        ctx,
                    ) {
                        return false;
                    }
                }
                relevant_count > 0
            }
            _ => false,
        },
    }
}

fn spread_clobber_property_signature<'a>(
    members: &'a [TSSignature<'a>],
    key: &str,
) -> Option<&'a oxc_ast::ast::TSPropertySignature<'a>> {
    members.iter().find_map(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return None;
        };
        (!property.computed && property.key.static_name().as_deref() == Some(key))
            .then_some(property.as_ref())
    })
}

fn spread_clobber_type_includes_undefined(type_node: &TSType<'_>) -> bool {
    match type_node {
        TSType::TSUndefinedKeyword(_) => true,
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .any(spread_clobber_type_includes_undefined),
        TSType::TSParenthesizedType(parenthesized) => {
            spread_clobber_type_includes_undefined(&parenthesized.type_annotation)
        }
        _ => false,
    }
}

fn spread_clobber_object_feeds_computation<'a>(
    object_node: &AstNode<'a>,
    candidate_keys: Option<&FxHashSet<String>>,
    parameter_type: Option<SpreadClobberType<'a>>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> bool {
    let transparent_root = transparent_expression_root(object_node, ctx);
    if spread_clobber_expression_feeds_jsx(transparent_root, ctx)
        && candidate_keys.is_some_and(|keys| {
            parameter_type.is_some_and(|parameter_type| {
                keys.iter().any(|key| {
                    spread_clobber_type_allows_undefined_for_key(parameter_type, key, ctx)
                })
            })
        })
    {
        return true;
    }
    let parenthesized_root = parenthesized_expression_root(object_node, ctx);
    let parent = ctx.nodes().parent_node(parenthesized_root.id());
    match parent.kind() {
        AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_) => {
            let Some((object, key, _)) = spread_clobber_member_parts(parent) else {
                return false;
            };
            object.span() == parenthesized_root.span()
                && candidate_keys.is_none_or(|keys| keys.contains(key.as_str()))
                && ((candidate_keys.is_some()
                    && parameter_type.is_some_and(|parameter_type| {
                        spread_clobber_type_allows_undefined_for_key(
                            parameter_type,
                            key.as_str(),
                            ctx,
                        )
                    }))
                    || spread_clobber_expression_uses_optional_member(parent, ctx))
                && spread_clobber_reference_feeds_computation(parent, ctx)
        }
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|init| init.span() == parenthesized_root.span()) =>
        {
            match &declarator.id {
                BindingPattern::BindingIdentifier(identifier) => {
                    spread_clobber_object_symbol_feeds(
                        identifier.symbol_id(),
                        candidate_keys,
                        parameter_type,
                        &mut Vec::new(),
                        repair_cache,
                        ctx,
                    )
                }
                BindingPattern::ObjectPattern(pattern) => {
                    pattern.properties.iter().any(|property| {
                        let Some(key) = property.key.static_name() else {
                            return false;
                        };
                        if candidate_keys.is_some_and(|keys| !keys.contains::<str>(key.as_ref()))
                            || matches!(&property.value, BindingPattern::AssignmentPattern(_))
                        {
                            return false;
                        }
                        property
                            .value
                            .get_binding_identifier()
                            .is_some_and(|identifier| {
                                spread_clobber_scalar_symbol_feeds(
                                    identifier.symbol_id(),
                                    candidate_keys.is_none()
                                        || parameter_type.is_none_or(|parameter_type| {
                                            !spread_clobber_type_allows_undefined_for_key(
                                                parameter_type,
                                                key.as_ref(),
                                                ctx,
                                            )
                                        }),
                                    &mut Vec::new(),
                                    repair_cache,
                                    ctx,
                                )
                            })
                    })
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn spread_clobber_object_symbol_feeds<'a>(
    symbol_id: SymbolId,
    candidate_keys: Option<&FxHashSet<String>>,
    parameter_type: Option<SpreadClobberType<'a>>,
    visited: &mut Vec<SymbolId>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> bool {
    if visited.contains(&symbol_id) {
        return false;
    }
    visited.push(symbol_id);
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if reference.is_write() {
            continue;
        }
        let identifier = ctx.nodes().get_node(reference.node_id());
        let parenthesized_root = parenthesized_expression_root(identifier, ctx);
        let parent = ctx.nodes().parent_node(parenthesized_root.id());
        if matches!(
            parent.kind(),
            AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)
        ) && spread_clobber_member_node_reports(
            parent,
            candidate_keys,
            parameter_type,
            repair_cache,
            ctx,
        ) {
            visited.pop();
            return true;
        }
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            continue;
        };
        if declarator
            .init
            .as_ref()
            .is_none_or(|init| init.span() != parenthesized_root.span())
        {
            continue;
        }
        match &declarator.id {
            BindingPattern::BindingIdentifier(alias) => {
                if spread_clobber_object_symbol_feeds(
                    alias.symbol_id(),
                    candidate_keys,
                    parameter_type,
                    visited,
                    repair_cache,
                    ctx,
                ) {
                    visited.pop();
                    return true;
                }
            }
            BindingPattern::ObjectPattern(pattern) => {
                for property in &pattern.properties {
                    let Some(key) = property.key.static_name() else {
                        continue;
                    };
                    if candidate_keys.is_some_and(|keys| !keys.contains::<str>(key.as_ref()))
                        || matches!(&property.value, BindingPattern::AssignmentPattern(_))
                    {
                        continue;
                    }
                    if property
                        .value
                        .get_binding_identifier()
                        .is_some_and(|binding| {
                            spread_clobber_scalar_symbol_feeds(
                                binding.symbol_id(),
                                candidate_keys.is_none()
                                    || parameter_type.is_none_or(|parameter_type| {
                                        !spread_clobber_type_allows_undefined_for_key(
                                            parameter_type,
                                            key.as_ref(),
                                            ctx,
                                        )
                                    }),
                                &mut Vec::new(),
                                repair_cache,
                                ctx,
                            )
                        })
                    {
                        visited.pop();
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    visited.pop();
    false
}

fn spread_clobber_member_node_reports<'a>(
    member_node: &AstNode<'a>,
    candidate_keys: Option<&FxHashSet<String>>,
    parameter_type: Option<SpreadClobberType<'a>>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((_, key, _)) = spread_clobber_member_parts(member_node) else {
        return false;
    };
    if candidate_keys.is_some_and(|keys| !keys.contains(key.as_str())) {
        return false;
    }
    let type_allows_undefined = candidate_keys.is_some()
        && parameter_type.is_some_and(|parameter_type| {
            spread_clobber_type_allows_undefined_for_key(parameter_type, key.as_ref(), ctx)
        });
    if !type_allows_undefined && !spread_clobber_expression_uses_optional_member(member_node, ctx) {
        return false;
    }
    let Some(object_symbol_id) = spread_clobber_member_object_symbol(member_node, ctx) else {
        return false;
    };
    let prior_write = spread_clobber_prior_member_write(
        member_node,
        object_symbol_id,
        key.as_ref(),
        repair_cache,
        ctx,
    );
    if prior_write.is_some_and(|(_, is_safe)| is_safe)
        || spread_clobber_member_is_guarded(
            member_node,
            object_symbol_id,
            key.as_ref(),
            prior_write,
            ctx,
        )
    {
        return false;
    }
    if spread_clobber_reference_feeds_computation(member_node, ctx) {
        return true;
    }
    let root = transparent_expression_root(member_node, ctx);
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().parent_node(root.id()).kind() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|init| init.span() != root.span())
    {
        return false;
    }
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|identifier| {
            spread_clobber_scalar_symbol_feeds(
                identifier.symbol_id(),
                false,
                &mut Vec::new(),
                repair_cache,
                ctx,
            )
        })
}

fn spread_clobber_scalar_symbol_feeds(
    symbol_id: SymbolId,
    requires_optional_access: bool,
    visited: &mut Vec<SymbolId>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'_>,
) -> bool {
    spread_clobber_scalar_symbol_feeds_between(
        symbol_id,
        requires_optional_access,
        visited,
        0,
        u32::MAX,
        repair_cache,
        ctx,
    )
}

fn spread_clobber_scalar_symbol_feeds_between(
    symbol_id: SymbolId,
    requires_optional_access: bool,
    visited: &mut Vec<SymbolId>,
    lower_bound: u32,
    upper_bound: u32,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'_>,
) -> bool {
    if visited.contains(&symbol_id) {
        return false;
    }
    visited.push(symbol_id);
    let next_write_start = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .filter_map(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            (node.span().start > lower_bound
                && node.span().start < upper_bound
                && spread_clobber_node_is_unconditional_from_function_entry(
                    node,
                    repair_cache,
                    ctx,
                ))
            .then_some(node.span().start)
        })
        .min()
        .unwrap_or(upper_bound);
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let node = ctx.nodes().get_node(reference.node_id());
        if reference.is_write()
            || node.span().start <= lower_bound
            || node.span().start >= next_write_start
        {
            continue;
        }
        if (!requires_optional_access || spread_clobber_expression_uses_optional_member(node, ctx))
            && spread_clobber_reference_feeds_computation(node, ctx)
        {
            visited.pop();
            return true;
        }
        let root = transparent_expression_root(node, ctx);
        let parent = ctx.nodes().parent_node(root.id());
        match parent.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|init| init.span() == root.span()) =>
            {
                if declarator.id.get_binding_identifier().is_some_and(|alias| {
                    spread_clobber_scalar_symbol_feeds_between(
                        alias.symbol_id(),
                        requires_optional_access,
                        visited,
                        declarator.span.start,
                        u32::MAX,
                        repair_cache,
                        ctx,
                    )
                }) {
                    visited.pop();
                    return true;
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign
                    && assignment.right.span() == root.span() =>
            {
                let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(alias) =
                    &assignment.left
                else {
                    continue;
                };
                let Some(alias_symbol_id) = ctx
                    .scoping()
                    .get_reference(alias.reference_id())
                    .symbol_id()
                else {
                    continue;
                };
                if spread_clobber_scalar_symbol_feeds_between(
                    alias_symbol_id,
                    requires_optional_access,
                    visited,
                    assignment.span.start,
                    u32::MAX,
                    repair_cache,
                    ctx,
                ) {
                    visited.pop();
                    return true;
                }
            }
            _ => {}
        }
    }
    visited.pop();
    false
}

fn spread_clobber_node_is_unconditional_from_function_entry<'a>(
    node: &AstNode<'a>,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> bool {
    let owner = crate::ast_util::get_enclosing_function(node, ctx)
        .or_else(|| ctx.nodes().iter().next())
        .expect("program node");
    let entry_block = ctx.nodes().cfg_id(owner.id());
    let target_block = ctx.nodes().cfg_id(node.id());
    if let Some(is_unconditional) = repair_cache
        .unconditional_by_cfg_pair
        .get(&(entry_block, target_block))
    {
        return *is_unconditional;
    }
    let reachable_blocks = spread_clobber_cfg_reachable_blocks(entry_block, None, ctx);
    let is_unconditional = !reachable_blocks.contains(&target_block)
        || !spread_clobber_cfg_reachable_blocks(entry_block, Some(target_block), ctx)
            .into_iter()
            .any(|block_id| {
                ctx.cfg()
                    .basic_block(block_id)
                    .instructions()
                    .iter()
                    .any(|instruction| {
                        matches!(
                            instruction.kind,
                            oxc_cfg::InstructionKind::ImplicitReturn
                                | oxc_cfg::InstructionKind::Return(_)
                        )
                    })
            });
    repair_cache
        .unconditional_by_cfg_pair
        .insert((entry_block, target_block), is_unconditional);
    is_unconditional
}

fn spread_clobber_cfg_reachable_blocks(
    entry_block: oxc_cfg::BlockNodeId,
    excluded_block: Option<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_cfg::BlockNodeId> {
    let mut visited = FxHashSet::default();
    let mut pending = Vec::new();
    if Some(entry_block) != excluded_block {
        pending.push(entry_block);
    }
    while let Some(block_id) = pending.pop() {
        if !visited.insert(block_id) {
            continue;
        }
        for edge in ctx
            .cfg()
            .graph()
            .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
        {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if Some(target) != excluded_block {
                pending.push(target);
            }
        }
    }
    visited
}

fn spread_clobber_member_parts<'a, 'b>(
    node: &'b AstNode<'a>,
) -> Option<(&'b Expression<'a>, String, bool)> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some((
            &member.object,
            member.property.name.to_string(),
            member.optional,
        )),
        AstKind::ComputedMemberExpression(member) => Some((
            &member.object,
            member.static_property_name()?.to_string(),
            member.optional,
        )),
        _ => None,
    }
}

fn spread_clobber_member_object_symbol<'a>(
    member_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let (object, _, _) = spread_clobber_member_parts(member_node)?;
    let Expression::Identifier(identifier) = object.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn spread_clobber_expression_uses_optional_member<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current_id = node.id();
    loop {
        let current = ctx.nodes().get_node(current_id);
        if spread_clobber_member_parts(current).is_some_and(|(_, _, optional)| optional) {
            return true;
        }
        let parent = ctx.nodes().parent_node(current_id);
        match parent.kind() {
            AstKind::StaticMemberExpression(member) if member.object.span() == current.span() => {}
            AstKind::ComputedMemberExpression(member) if member.object.span() == current.span() => {
            }
            AstKind::ChainExpression(_) | AstKind::TSNonNullExpression(_) => {}
            _ => return false,
        }
        current_id = parent.id();
    }
}

fn spread_clobber_expression_feeds_jsx<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    if matches!(parent.kind(), AstKind::JSXSpreadAttribute(spread) if spread.argument.span() == root.span())
    {
        return true;
    }
    if !matches!(parent.kind(), AstKind::JSXExpressionContainer(container)
        if container.expression.as_expression().is_some_and(|expression| expression.span() == root.span()))
    {
        return false;
    }
    matches!(
        ctx.nodes().parent_node(parent.id()).kind(),
        AstKind::JSXAttribute(_)
    )
}

fn spread_clobber_reference_feeds_computation<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::StaticMemberExpression(member) if member.object.span() == current.span() => {
                current = parent;
            }
            AstKind::ComputedMemberExpression(member) if member.object.span() == current.span() => {
                current = parent;
            }
            AstKind::ChainExpression(_) | AstKind::TSNonNullExpression(_) => current = parent,
            _ => break,
        }
    }
    let parent = ctx.nodes().parent_node(current.id());
    if let AstKind::LogicalExpression(logical) = parent.kind()
        && logical.left.span() == current.span()
        && matches!(
            logical.operator,
            LogicalOperator::Coalesce | LogicalOperator::Or
        )
        && spread_clobber_expression_is_non_undefined(&logical.right, ctx, &mut Vec::new())
    {
        return false;
    }
    if spread_clobber_expression_feeds_jsx(current, ctx) {
        return true;
    }
    match parent.kind() {
        AstKind::BinaryExpression(binary) => !spread_clobber_binary_is_nullish_check(binary, ctx),
        AstKind::TemplateLiteral(_) => true,
        AstKind::AssignmentExpression(assignment) => {
            assignment.right.span() == current.span()
                && assignment.operator != AssignmentOperator::Assign
        }
        AstKind::UnaryExpression(unary) => matches!(
            unary.operator,
            UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation | UnaryOperator::BitwiseNot
        ),
        AstKind::CallExpression(call) => {
            let callee_name = call.callee_name();
            !callee_name.is_some_and(|name| {
                name.eq_ignore_ascii_case("undefined") || name.eq_ignore_ascii_case("isundefined")
            })
        }
        AstKind::NewExpression(_) | AstKind::UpdateExpression(_) => true,
        _ => false,
    }
}

fn spread_clobber_binary_is_nullish_check<'a>(
    binary: &oxc_ast::ast::BinaryExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) {
        return false;
    }
    let operands = [&binary.left, &binary.right];
    if operands.iter().any(|operand| {
        matches!(operand.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    }) {
        return true;
    }
    matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::Inequality
    ) && operands
        .iter()
        .any(|operand| matches!(operand.get_inner_expression(), Expression::NullLiteral(_)))
}

fn spread_clobber_prior_member_write<'a>(
    member_node: &AstNode<'a>,
    object_symbol_id: SymbolId,
    key: &str,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'a>,
) -> Option<(u32, bool)> {
    spread_clobber_index_symbol_repairs(object_symbol_id, repair_cache, ctx);
    let block_id = spread_clobber_containing_block_id(member_node, ctx)?;
    let mut last_write = None;
    for repair in repair_cache
        .repairs_by_symbol
        .get(&object_symbol_id)
        .and_then(|repairs_by_block| repairs_by_block.get(&block_id))
        .and_then(|repairs_by_key| repairs_by_key.get(key))
        .into_iter()
        .flatten()
    {
        if repair.start >= member_node.span().start {
            continue;
        }
        if last_write.is_none_or(|(start, _)| repair.start > start) {
            last_write = Some((repair.start, repair.is_safe));
        }
    }
    last_write
}

fn spread_clobber_index_symbol_repairs(
    symbol_id: SymbolId,
    repair_cache: &mut SpreadClobberRepairCache,
    ctx: &LintContext<'_>,
) {
    if !repair_cache.indexed_symbols.insert(symbol_id) {
        return;
    }
    let mut repairs = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let identifier = ctx.nodes().get_node(reference.node_id());
        let member = ctx.nodes().parent_node(identifier.id());
        if !matches!(
            member.kind(),
            AstKind::StaticMemberExpression(_) | AstKind::ComputedMemberExpression(_)
        ) {
            continue;
        }
        let Some((object, member_key, _)) = spread_clobber_member_parts(member) else {
            continue;
        };
        if object.span() != identifier.span() {
            continue;
        }
        let assignment_node = ctx.nodes().parent_node(member.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.left.span() != member.span()
            || !matches!(
                assignment.operator,
                AssignmentOperator::Assign
                    | AssignmentOperator::LogicalNullish
                    | AssignmentOperator::LogicalOr
            )
            || !matches!(
                ctx.nodes().parent_node(assignment_node.id()).kind(),
                AstKind::ExpressionStatement(_)
            )
        {
            continue;
        }
        let is_safe =
            spread_clobber_expression_is_non_undefined(&assignment.right, ctx, &mut Vec::new());
        if is_safe
            && !spread_clobber_node_is_unconditional_from_function_entry(
                assignment_node,
                repair_cache,
                ctx,
            )
        {
            continue;
        }
        let Some(block_id) = spread_clobber_containing_block_id(assignment_node, ctx) else {
            continue;
        };
        repairs.push((
            block_id,
            member_key,
            SpreadClobberRepair {
                start: assignment_node.span().start,
                is_safe,
            },
        ));
    }
    for (block_id, member_key, repair) in repairs {
        repair_cache
            .repairs_by_symbol
            .entry(symbol_id)
            .or_default()
            .entry(block_id)
            .or_default()
            .entry(member_key)
            .or_default()
            .push(repair);
    }
    if let Some(repairs_by_block) = repair_cache.repairs_by_symbol.get_mut(&symbol_id) {
        for repairs_by_key in repairs_by_block.values_mut() {
            for repairs in repairs_by_key.values_mut() {
                repairs.sort_unstable_by_key(|repair| repair.start);
            }
        }
    }
}

fn spread_clobber_containing_block_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::BlockStatement(_) | AstKind::FunctionBody(_)
        )
        .then_some(ancestor.id())
    })
}

fn spread_clobber_member_is_guarded<'a>(
    member_node: &AstNode<'a>,
    symbol_id: SymbolId,
    key: &str,
    prior_write: Option<(u32, bool)>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(member_node.id()) {
        match ancestor.kind() {
            AstKind::ConditionalExpression(conditional) => {
                let polarity =
                    spread_clobber_guard_polarity(&conditional.test, symbol_id, key, ctx);
                let is_truthy_branch = conditional
                    .consequent
                    .span()
                    .contains_inclusive(member_node.span());
                let is_false_branch = conditional
                    .alternate
                    .span()
                    .contains_inclusive(member_node.span());
                if (is_truthy_branch || is_false_branch)
                    && spread_clobber_polarity_guards(polarity, is_truthy_branch)
                    && prior_write
                        .is_none_or(|(start, safe)| safe || start < conditional.test.span().start)
                {
                    return true;
                }
            }
            AstKind::IfStatement(statement) => {
                let polarity = spread_clobber_guard_polarity(&statement.test, symbol_id, key, ctx);
                let is_truthy_branch = statement
                    .consequent
                    .span()
                    .contains_inclusive(member_node.span());
                let is_false_branch = statement.alternate.as_ref().is_some_and(|alternate| {
                    alternate.span().contains_inclusive(member_node.span())
                });
                if (is_truthy_branch || is_false_branch)
                    && spread_clobber_polarity_guards(polarity, is_truthy_branch)
                    && prior_write
                        .is_none_or(|(start, safe)| safe || start < statement.test.span().start)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    let Some(statement_id) = spread_clobber_containing_statement(member_node, ctx) else {
        return false;
    };
    let statement = ctx.nodes().get_node(statement_id);
    let preceding_statements = match ctx.nodes().parent_node(statement.id()).kind() {
        AstKind::BlockStatement(block) => &block.body,
        AstKind::FunctionBody(body) => &body.statements,
        _ => return false,
    };
    for preceding in preceding_statements {
        if preceding.span().start >= statement.span().start {
            break;
        }
        let oxc_ast::ast::Statement::IfStatement(if_statement) = preceding else {
            continue;
        };
        let polarity = spread_clobber_guard_polarity(&if_statement.test, symbol_id, key, ctx);
        let guard_precedes_write =
            prior_write.is_none_or(|(start, safe)| safe || start < if_statement.test.span().start);
        if !guard_precedes_write {
            continue;
        }
        if if_statement.alternate.is_none()
            && polarity == Some(false)
            && spread_clobber_statement_repairs_member(
                &if_statement.consequent,
                symbol_id,
                key,
                ctx,
            )
        {
            return true;
        }
        if spread_clobber_statement_terminates(&if_statement.consequent)
            && spread_clobber_polarity_guards(polarity, false)
        {
            return true;
        }
    }
    false
}

fn spread_clobber_guard_polarity<'a>(
    test: &Expression<'a>,
    symbol_id: SymbolId,
    key: &str,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    match test.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            spread_clobber_expression_matches_member(&unary.argument, symbol_id, key, ctx)
                .then_some(false)
        }
        expression if spread_clobber_expression_matches_member(expression, symbol_id, key, ctx) => {
            Some(true)
        }
        Expression::BinaryExpression(binary) => {
            let pairs = [(&binary.left, &binary.right), (&binary.right, &binary.left)];
            for (member, nullish) in pairs {
                if !spread_clobber_expression_matches_member(member, symbol_id, key, ctx) {
                    continue;
                }
                let is_undefined = matches!(nullish.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "undefined"
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none());
                let is_null = matches!(nullish.get_inner_expression(), Expression::NullLiteral(_));
                if !is_undefined && !is_null {
                    continue;
                }
                if is_null
                    && matches!(
                        binary.operator,
                        BinaryOperator::StrictEquality | BinaryOperator::StrictInequality
                    )
                {
                    continue;
                }
                return match binary.operator {
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality => Some(true),
                    BinaryOperator::Equality | BinaryOperator::StrictEquality => Some(false),
                    _ => None,
                };
            }
            None
        }
        _ => None,
    }
}

fn spread_clobber_polarity_guards(polarity: Option<bool>, truthy_branch: bool) -> bool {
    polarity == Some(truthy_branch)
}

fn spread_clobber_expression_matches_member<'a>(
    expression: &Expression<'a>,
    symbol_id: SymbolId,
    key: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some(key) {
        return false;
    }
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if resolve_const_identifier_root_symbol(identifier, ctx) == Some(symbol_id))
}

fn spread_clobber_containing_statement<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ctx.nodes().parent_node(ancestor.id()).kind(),
            AstKind::BlockStatement(_) | AstKind::FunctionBody(_)
        )
        .then_some(ancestor.id())
    })
}

fn spread_clobber_statement_repairs_member<'a>(
    statement: &oxc_ast::ast::Statement<'a>,
    symbol_id: SymbolId,
    key: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = match statement {
        oxc_ast::ast::Statement::ExpressionStatement(statement) => Some(&statement.expression),
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.first().and_then(|statement| {
                let oxc_ast::ast::Statement::ExpressionStatement(statement) = statement else {
                    return None;
                };
                Some(&statement.expression)
            })
        }
        _ => None,
    };
    let Some(Expression::AssignmentExpression(assignment)) =
        expression.map(Expression::get_inner_expression)
    else {
        return false;
    };
    assignment.operator == AssignmentOperator::Assign
        && assignment.left.as_member_expression().is_some_and(|member| {
            member.static_property_name().as_deref() == Some(key)
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if resolve_const_identifier_root_symbol(identifier, ctx) == Some(symbol_id))
        })
        && spread_clobber_expression_is_non_undefined(&assignment.right, ctx, &mut Vec::new())
}

fn spread_clobber_statement_terminates(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => block
            .body
            .last()
            .is_some_and(spread_clobber_statement_terminates),
        _ => false,
    }
}
