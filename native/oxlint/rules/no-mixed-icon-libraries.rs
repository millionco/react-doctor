use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXElementName, JSXMemberExpression, JSXMemberExpressionObject,
        ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE_SUFFIX: &str =
    "Keep one icon family so the interface has consistent visual weight and proportions.";
const ICON_LIBRARY_PACKAGES: [&str; 13] = [
    "lucide-react",
    "lucide-react-native",
    "react-feather",
    "phosphor-react",
    "iconoir-react",
    "react-bootstrap-icons",
    "@heroicons/react",
    "@tabler/icons-react",
    "@phosphor-icons/react",
    "@radix-ui/react-icons",
    "@mui/icons-material",
    "@ant-design/icons",
    "@primer/octicons-react",
];

#[derive(Clone)]
enum IconFamilyResolution {
    Absent,
    Known(Vec<String>),
    Unknown,
}

#[derive(Debug, Default, Clone)]
pub struct NoMixedIconLibraries;

declare_oxc_lint!(
    /// Disallow rendering icons from multiple visual families in one file.
    NoMixedIconLibraries,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow mixed icon families in one file.",
);

impl Rule for NoMixedIconLibraries {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let icon_families_by_symbol = mixed_icon_imported_families(ctx);
        if icon_families_by_symbol.is_empty() {
            return;
        }
        let mut rendered_families = Vec::<String>::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let resolution = mixed_icon_resolve_jsx_name(
                &opening_element.name,
                &icon_families_by_symbol,
                ctx,
                &mut FxHashSet::default(),
            );
            let IconFamilyResolution::Known(families) = resolution else {
                continue;
            };
            for family in families {
                if !rendered_families.contains(&family) {
                    rendered_families.push(family);
                }
            }
        }
        if rendered_families.len() < 2 {
            return;
        }
        let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
            AstKind::Program(program) => Some(program),
            _ => None,
        }) else {
            return;
        };
        let diagnostic_start = program
            .directives
            .first()
            .map(|directive| directive.span.start)
            .into_iter()
            .chain(program.body.first().map(|statement| statement.span().start))
            .min()
            .unwrap_or(program.span.start);
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This file combines {}. {MESSAGE_SUFFIX}",
                rendered_families.join(", ")
            ))
            .with_label(Span::new(diagnostic_start, ctx.source_text().len() as u32)),
        );
    }
}

fn mixed_icon_imported_families(ctx: &LintContext<'_>) -> FxHashMap<SymbolId, String> {
    let mut families = FxHashMap::default();
    for entry in &ctx.module_record().import_entries {
        if entry.is_type {
            continue;
        }
        let Some(family) = mixed_icon_library_family(entry.module_request.name()) else {
            continue;
        };
        if family == "react-icons/si" {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
        else {
            continue;
        };
        for alias_symbol_id in mixed_icon_collect_const_alias_symbols(symbol_id, ctx) {
            families.insert(alias_symbol_id, family.to_string());
        }
    }
    families
}

fn mixed_icon_library_family(source: &str) -> Option<&str> {
    if source == "react-icons" {
        return Some(source);
    }
    if let Some(rest) = source.strip_prefix("react-icons/") {
        return rest
            .split('/')
            .next()
            .map(|pack| &source[.."react-icons/".len() + pack.len()]);
    }
    if source == "@fortawesome/react-fontawesome"
        || source
            .strip_prefix("@fortawesome/free-")
            .is_some_and(|rest| {
                rest.split('/')
                    .next()
                    .is_some_and(|package| package.ends_with("-svg-icons"))
            })
    {
        return Some("@fortawesome");
    }
    ICON_LIBRARY_PACKAGES.iter().copied().find(|package| {
        source == *package
            || source
                .strip_prefix(*package)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}

fn mixed_icon_collect_const_alias_symbols(
    source_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let mut symbol_ids = vec![source_symbol_id];
    let mut visited_symbol_ids = FxHashSet::from_iter([source_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        let aliases = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .filter_map(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let declarator_node = ctx.nodes().parent_node(reference_root.id());
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    return None;
                };
                if declarator
                    .init
                    .as_ref()
                    .is_none_or(|initializer| initializer.span() != reference_root.span())
                {
                    return None;
                }
                let binding = declarator.id.get_binding_identifier()?;
                let declaration_node = ctx.nodes().parent_node(declarator_node.id());
                let AstKind::VariableDeclaration(declaration) = declaration_node.kind() else {
                    return None;
                };
                declaration.kind.is_const().then(|| binding.symbol_id())
            })
            .collect::<Vec<_>>();
        for alias_symbol_id in aliases {
            if visited_symbol_ids.insert(alias_symbol_id) {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    symbol_ids
}

fn mixed_icon_resolve_jsx_name<'a>(
    name: &'a JSXElementName<'a>,
    icon_families_by_symbol: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> IconFamilyResolution {
    match name {
        JSXElementName::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map_or(IconFamilyResolution::Absent, |symbol_id| {
                mixed_icon_resolve_symbol(
                    symbol_id,
                    &[],
                    false,
                    icon_families_by_symbol,
                    ctx,
                    visited_symbol_ids,
                )
            }),
        JSXElementName::MemberExpression(member) => {
            let mut properties = Vec::new();
            let Some(root_symbol_id) = mixed_icon_jsx_member_parts(member, &mut properties, ctx)
            else {
                return IconFamilyResolution::Absent;
            };
            mixed_icon_resolve_symbol(
                root_symbol_id,
                &properties,
                false,
                icon_families_by_symbol,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => IconFamilyResolution::Absent,
    }
}

fn mixed_icon_jsx_member_parts<'a>(
    member: &'a JSXMemberExpression<'a>,
    properties: &mut Vec<String>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => {
            properties.push(member.property.name.to_string());
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        JSXMemberExpressionObject::MemberExpression(parent) => {
            let root_symbol_id = mixed_icon_jsx_member_parts(parent, properties, ctx)?;
            properties.push(member.property.name.to_string());
            Some(root_symbol_id)
        }
        _ => None,
    }
}

fn mixed_icon_resolve_symbol<'a>(
    symbol_id: SymbolId,
    property_path: &[String],
    dynamic_tail: bool,
    icon_families_by_symbol: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> IconFamilyResolution {
    if let Some(family) = icon_families_by_symbol.get(&symbol_id) {
        return mixed_icon_known([family.clone()]);
    }
    if !visited_symbol_ids.insert(symbol_id) {
        return IconFamilyResolution::Unknown;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let mut result = if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if let Some(initializer) = &declarator.init {
            if let Some(binding_path) = mixed_icon_binding_path(&declarator.id, symbol_id) {
                let mut combined_path = binding_path;
                combined_path.extend_from_slice(property_path);
                mixed_icon_resolve_expression(
                    initializer,
                    &combined_path,
                    dynamic_tail,
                    icon_families_by_symbol,
                    ctx,
                    visited_symbol_ids,
                )
            } else {
                mixed_icon_resolve_expression(
                    initializer,
                    property_path,
                    dynamic_tail,
                    icon_families_by_symbol,
                    ctx,
                    visited_symbol_ids,
                )
            }
        } else {
            IconFamilyResolution::Absent
        }
    } else {
        IconFamilyResolution::Absent
    };
    let alias_symbol_ids = mixed_icon_collect_const_alias_symbols(symbol_id, ctx)
        .into_iter()
        .collect::<FxHashSet<_>>();
    for candidate in ctx.nodes().iter() {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        let Some(target_expression) = assignment.left.get_expression() else {
            continue;
        };
        let Some((target_symbol_id, target_path)) =
            mixed_icon_expression_access(target_expression, ctx)
        else {
            continue;
        };
        if !alias_symbol_ids.contains(&target_symbol_id) {
            continue;
        }
        let is_unconditional = mixed_icon_is_unconditional_program_expression(candidate, ctx);
        if target_path.is_empty() {
            result = if is_unconditional && assignment.operator == AssignmentOperator::Assign {
                mixed_icon_resolve_expression(
                    &assignment.right,
                    property_path,
                    dynamic_tail,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
            } else {
                IconFamilyResolution::Unknown
            };
            continue;
        }
        if dynamic_tail && property_path.is_empty() {
            if !is_unconditional
                || assignment.operator != AssignmentOperator::Assign
                || target_path.iter().any(Option::is_none)
            {
                result = IconFamilyResolution::Unknown;
                continue;
            }
            result = mixed_icon_combine([
                result,
                mixed_icon_resolve_expression(
                    &assignment.right,
                    &[],
                    false,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
            ]);
            continue;
        }
        let mut matching_prefix_length = 0;
        while matching_prefix_length < target_path.len()
            && matching_prefix_length < property_path.len()
            && target_path[matching_prefix_length].as_deref()
                == Some(property_path[matching_prefix_length].as_str())
        {
            matching_prefix_length += 1;
        }
        if target_path
            .get(matching_prefix_length)
            .is_some_and(Option::is_none)
            && matching_prefix_length < property_path.len()
        {
            result = IconFamilyResolution::Unknown;
            continue;
        }
        if matching_prefix_length < target_path.len() || target_path.len() > property_path.len() {
            continue;
        }
        result = if is_unconditional && assignment.operator == AssignmentOperator::Assign {
            mixed_icon_resolve_expression(
                &assignment.right,
                &property_path[target_path.len()..],
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        } else {
            IconFamilyResolution::Unknown
        };
    }
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(callee_member) = call_expression.callee.as_member_expression() else {
            continue;
        };
        let method_name = mixed_icon_resolved_property_name(callee_member, ctx);
        if method_name.as_deref() == Some("assign")
            && matches!(callee_member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Object"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        {
            let Some(target_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some((target_symbol_id, target_path)) =
                mixed_icon_expression_access(target_expression, ctx)
            else {
                continue;
            };
            if !target_path.is_empty() || !alias_symbol_ids.contains(&target_symbol_id) {
                continue;
            }
            if !mixed_icon_is_unconditional_program_expression(candidate, ctx) {
                result = IconFamilyResolution::Unknown;
                continue;
            }
            for source in call_expression.arguments.iter().skip(1) {
                let Some(source_expression) = source.as_expression() else {
                    result = IconFamilyResolution::Unknown;
                    continue;
                };
                let source_resolution = mixed_icon_resolve_expression(
                    source_expression,
                    property_path,
                    dynamic_tail,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                );
                if !matches!(source_resolution, IconFamilyResolution::Absent) {
                    result = source_resolution;
                }
            }
            continue;
        }
        if method_name.as_deref() != Some("push") || !dynamic_tail || !property_path.is_empty() {
            continue;
        }
        let Some((receiver_symbol_id, receiver_path)) =
            mixed_icon_expression_access(callee_member.object(), ctx)
        else {
            continue;
        };
        if !receiver_path.is_empty() || !alias_symbol_ids.contains(&receiver_symbol_id) {
            continue;
        }
        if !mixed_icon_is_unconditional_program_expression(candidate, ctx) {
            result = IconFamilyResolution::Unknown;
            continue;
        }
        for argument in &call_expression.arguments {
            let Some(argument_expression) = argument.as_expression() else {
                result = IconFamilyResolution::Unknown;
                continue;
            };
            result = mixed_icon_combine([
                result,
                mixed_icon_resolve_expression(
                    argument_expression,
                    &[],
                    false,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
            ]);
        }
    }
    visited_symbol_ids.remove(&symbol_id);
    result
}

fn mixed_icon_expression_access<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, Vec<Option<String>>)> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        return Some((symbol_id, Vec::new()));
    }
    let member = expression.as_member_expression()?;
    let (symbol_id, mut path) = mixed_icon_expression_access(member.object(), ctx)?;
    path.push(mixed_icon_resolved_property_name(member, ctx));
    Some((symbol_id, path))
}

fn mixed_icon_resolved_property_name<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if let Some(property_name) = static_member_expression_property_name(member) {
        return Some(property_name.to_string());
    }
    let oxc_ast::ast::MemberExpression::ComputedMemberExpression(computed) = member else {
        return None;
    };
    mixed_icon_static_property_expression_value(
        &computed.expression,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn mixed_icon_static_property_expression_value<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::NumericLiteral(literal) => Some(literal.value.to_string()),
        Expression::BooleanLiteral(literal) => Some(literal.value.to_string()),
        Expression::NullLiteral(_) => Some("null".to_string()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            Some(template.quasis[0].value.raw.to_string())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) {
                return None;
            }
            mixed_icon_static_property_expression_value(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn mixed_icon_is_unconditional_program_expression(
    node: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    matches!(parent.kind(), AstKind::ExpressionStatement(_))
        && matches!(
            ctx.nodes().parent_node(parent.id()).kind(),
            AstKind::Program(_)
        )
}

fn mixed_icon_binding_path(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
    symbol_id: SymbolId,
) -> Option<Vec<String>> {
    match pattern {
        oxc_ast::ast::BindingPattern::BindingIdentifier(identifier) => {
            (identifier.symbol_id() == symbol_id).then(Vec::new)
        }
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => {
            mixed_icon_binding_path(&assignment.left, symbol_id)
        }
        oxc_ast::ast::BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                let Some(mut path) = mixed_icon_binding_path(&property.value, symbol_id) else {
                    continue;
                };
                let key = property.key.static_name()?.to_string();
                path.insert(0, key);
                return Some(path);
            }
            None
        }
        oxc_ast::ast::BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .enumerate()
            .find_map(|(index, element)| {
                let mut path = mixed_icon_binding_path(element.as_ref()?, symbol_id)?;
                path.insert(0, index.to_string());
                Some(path)
            }),
    }
}

fn mixed_icon_resolve_expression<'a>(
    expression: &'a Expression<'a>,
    property_path: &[String],
    dynamic_tail: bool,
    icon_families_by_symbol: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> IconFamilyResolution {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return IconFamilyResolution::Absent;
        };
        return mixed_icon_resolve_symbol(
            symbol_id,
            property_path,
            dynamic_tail,
            icon_families_by_symbol,
            ctx,
            visited_symbol_ids,
        );
    }
    if let Some(member) = expression.as_member_expression() {
        let mut path = Vec::new();
        let mut is_dynamic = dynamic_tail;
        if let Some(property_name) = mixed_icon_resolved_property_name(member, ctx) {
            path.push(property_name);
        } else {
            is_dynamic = true;
        }
        path.extend_from_slice(property_path);
        return mixed_icon_resolve_expression(
            member.object(),
            &path,
            is_dynamic,
            icon_families_by_symbol,
            ctx,
            visited_symbol_ids,
        );
    }
    if let Expression::ConditionalExpression(conditional) = expression {
        if let Some(test) =
            mixed_icon_static_truthiness(&conditional.test, icon_families_by_symbol, ctx)
        {
            return mixed_icon_resolve_expression(
                if test {
                    &conditional.consequent
                } else {
                    &conditional.alternate
                },
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                visited_symbol_ids,
            );
        }
        return mixed_icon_combine([
            mixed_icon_resolve_expression(
                &conditional.consequent,
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
            mixed_icon_resolve_expression(
                &conditional.alternate,
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
        ]);
    }
    if let Expression::LogicalExpression(logical) = expression {
        if let Some(left_truthiness) =
            mixed_icon_static_truthiness(&logical.left, icon_families_by_symbol, ctx)
            && logical.operator != oxc_syntax::operator::LogicalOperator::Coalesce
        {
            let selected = match logical.operator {
                oxc_syntax::operator::LogicalOperator::And if left_truthiness => &logical.right,
                oxc_syntax::operator::LogicalOperator::And => &logical.left,
                oxc_syntax::operator::LogicalOperator::Or if left_truthiness => &logical.left,
                _ => &logical.right,
            };
            return mixed_icon_resolve_expression(
                selected,
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                visited_symbol_ids,
            );
        }
        return mixed_icon_combine([
            mixed_icon_resolve_expression(
                &logical.left,
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
            mixed_icon_resolve_expression(
                &logical.right,
                property_path,
                dynamic_tail,
                icon_families_by_symbol,
                ctx,
                &mut visited_symbol_ids.clone(),
            ),
        ]);
    }
    if let Expression::AssignmentExpression(assignment) = expression {
        return mixed_icon_resolve_expression(
            &assignment.right,
            property_path,
            dynamic_tail,
            icon_families_by_symbol,
            ctx,
            visited_symbol_ids,
        );
    }
    if let Expression::SequenceExpression(sequence) = expression {
        return sequence
            .expressions
            .last()
            .map_or(IconFamilyResolution::Absent, |last| {
                mixed_icon_resolve_expression(
                    last,
                    property_path,
                    dynamic_tail,
                    icon_families_by_symbol,
                    ctx,
                    visited_symbol_ids,
                )
            });
    }
    if let Expression::ObjectExpression(object) = expression {
        if dynamic_tail && property_path.is_empty() {
            return mixed_icon_combine(object.properties.iter().map(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => mixed_icon_resolve_expression(
                    &property.value,
                    &[],
                    false,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
                ObjectPropertyKind::SpreadProperty(spread) => mixed_icon_resolve_expression(
                    &spread.argument,
                    &[],
                    true,
                    icon_families_by_symbol,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                ),
            }));
        }
        let Some((property_name, remaining_path)) = property_path.split_first() else {
            return IconFamilyResolution::Absent;
        };
        for property in object.properties.iter().rev() {
            match property {
                ObjectPropertyKind::ObjectProperty(property)
                    if property.key.static_name().as_deref() == Some(property_name.as_str()) =>
                {
                    return mixed_icon_resolve_expression(
                        &property.value,
                        remaining_path,
                        dynamic_tail,
                        icon_families_by_symbol,
                        ctx,
                        visited_symbol_ids,
                    );
                }
                ObjectPropertyKind::SpreadProperty(spread) => {
                    let resolution = mixed_icon_resolve_expression(
                        &spread.argument,
                        property_path,
                        dynamic_tail,
                        icon_families_by_symbol,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    );
                    if !matches!(resolution, IconFamilyResolution::Absent) {
                        return resolution;
                    }
                }
                _ => {}
            }
        }
        return IconFamilyResolution::Absent;
    }
    if let Expression::ArrayExpression(array) = expression {
        if dynamic_tail && property_path.is_empty() {
            return mixed_icon_combine(array.elements.iter().filter_map(|element| match element {
                oxc_ast::ast::ArrayExpressionElement::Elision(_) => None,
                oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                    Some(mixed_icon_resolve_expression(
                        &spread.argument,
                        &[],
                        true,
                        icon_families_by_symbol,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ))
                }
                element => element.as_expression().map(|expression| {
                    mixed_icon_resolve_expression(
                        expression,
                        &[],
                        false,
                        icon_families_by_symbol,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    )
                }),
            }));
        }
        let Some((property_name, remaining_path)) = property_path.split_first() else {
            return IconFamilyResolution::Absent;
        };
        let Ok(index) = property_name.parse::<usize>() else {
            return IconFamilyResolution::Absent;
        };
        let Some(element) = array.elements.get(index) else {
            return IconFamilyResolution::Absent;
        };
        return match element {
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => IconFamilyResolution::Absent,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => IconFamilyResolution::Unknown,
            element => element
                .as_expression()
                .map_or(IconFamilyResolution::Absent, |value| {
                    mixed_icon_resolve_expression(
                        value,
                        remaining_path,
                        dynamic_tail,
                        icon_families_by_symbol,
                        ctx,
                        visited_symbol_ids,
                    )
                }),
        };
    }
    IconFamilyResolution::Absent
}

fn mixed_icon_static_truthiness(
    expression: &Expression<'_>,
    icon_families_by_symbol: &FxHashMap<SymbolId, String>,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::NullLiteral(_) => Some(false),
        Expression::NumericLiteral(literal) => {
            Some(literal.value != 0.0 && !literal.value.is_nan())
        }
        Expression::StringLiteral(literal) => Some(!literal.value.is_empty()),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            Some(!template.quasis[0].value.raw.is_empty())
        }
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .and_then(|symbol_id| {
                if icon_families_by_symbol.contains_key(&symbol_id) {
                    return Some(true);
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return None;
                };
                matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable) if variable.kind.is_const()
                )
                .then_some(declarator.init.as_ref())
                .flatten()
                .and_then(|initializer| {
                    mixed_icon_static_truthiness(initializer, icon_families_by_symbol, ctx)
                })
            }),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            mixed_icon_static_truthiness(&unary.argument, icon_families_by_symbol, ctx)
                .map(|truthiness| !truthiness)
        }
        _ => None,
    }
}

fn mixed_icon_known(families: impl IntoIterator<Item = String>) -> IconFamilyResolution {
    let mut unique = Vec::new();
    for family in families {
        if !unique.contains(&family) {
            unique.push(family);
        }
    }
    IconFamilyResolution::Known(unique)
}

fn mixed_icon_combine(
    resolutions: impl IntoIterator<Item = IconFamilyResolution>,
) -> IconFamilyResolution {
    let mut has_known = false;
    let mut families = Vec::new();
    for resolution in resolutions {
        match resolution {
            IconFamilyResolution::Unknown => return IconFamilyResolution::Unknown,
            IconFamilyResolution::Absent => {}
            IconFamilyResolution::Known(resolution_families) => {
                has_known = true;
                for family in resolution_families {
                    if !families.contains(&family) {
                        families.push(family);
                    }
                }
            }
        }
    }
    if has_known {
        IconFamilyResolution::Known(families)
    } else {
        IconFamilyResolution::Absent
    }
}
