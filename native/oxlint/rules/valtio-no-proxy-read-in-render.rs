use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayAssignmentTarget, AssignmentTarget, AssignmentTargetMaybeDefault,
        AssignmentTargetProperty, BindingPattern, ChainElement, Expression, MemberExpression,
        ObjectAssignmentTarget, PropertyKey, SimpleAssignmentTarget,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, ScopeId, SymbolId};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Read this Valtio value from the useSnapshot result during render. Keep proxy reads for callbacks so render uses the tracked, consistent snapshot.";
const VALTIO_MODULES: [&str; 2] = ["valtio", "valtio/react"];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const DEPENDENCY_ARRAY_HOOK_NAMES: [&str; 5] = [
    "useCallback",
    "useEffect",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
];

#[derive(Debug, Default, Clone)]
pub struct ValtioNoProxyReadInRender;

#[derive(Clone, Debug, Eq, PartialEq)]
enum ValtioProxyRoot {
    Symbol(SymbolId),
    Global(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ValtioProxyPath {
    root: ValtioProxyRoot,
    properties: Vec<Option<String>>,
}

#[derive(Clone)]
struct ValtioProxyAliasCapture {
    declaration_end: u32,
    path: ValtioProxyPath,
}

#[derive(Clone)]
struct ValtioSnapshotTarget {
    declaration_end: u32,
    owner_id: NodeId,
    path: ValtioProxyPath,
    snapshot_binding_scopes: Vec<ScopeId>,
}

#[derive(Clone)]
struct ValtioProxyWrite {
    position: u32,
    owner_id: NodeId,
    path: ValtioProxyPath,
}

declare_oxc_lint!(
    /// Warns when a Valtio proxy is read during render after it has been snapshotted.
    ValtioNoProxyReadInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when render reads a Valtio proxy instead of its snapshot.",
);

impl Rule for ValtioNoProxyReadInRender {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "valtio:1") {
            return;
        }
        if !ctx
            .module_record()
            .import_entries
            .iter()
            .any(|entry| VALTIO_MODULES.contains(&entry.module_request.name()))
        {
            return;
        }
        let mut snapshot_targets = Vec::new();
        let mut identifier_candidates = Vec::new();
        let mut proxy_writes = Vec::new();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call) => {
                    if let Some(target) = valtio_snapshot_target(node, call, ctx) {
                        snapshot_targets.push(target);
                    }
                }
                AstKind::IdentifierReference(identifier) => {
                    identifier_candidates.push((node, identifier));
                }
                AstKind::AssignmentExpression(assignment) => {
                    let Some(owner_id) =
                        find_render_phase_component_or_hook(node, ctx).map(AstNode::id)
                    else {
                        continue;
                    };
                    valtio_collect_assignment_target_writes(
                        &assignment.left,
                        node.span().start,
                        owner_id,
                        &mut proxy_writes,
                        ctx,
                    );
                }
                AstKind::UpdateExpression(update) => {
                    let Some(owner_id) =
                        find_render_phase_component_or_hook(node, ctx).map(AstNode::id)
                    else {
                        continue;
                    };
                    valtio_collect_simple_assignment_target_write(
                        &update.argument,
                        node.span().start,
                        owner_id,
                        &mut proxy_writes,
                        ctx,
                    );
                }
                _ => {}
            }
        }

        let mut reported_expression_ids = FxHashSet::default();
        for (identifier_node, _identifier) in identifier_candidates {
            let read_expression = valtio_outermost_member_read(identifier_node, ctx);
            if reported_expression_ids.contains(&read_expression.id())
                || valtio_is_mutation_only_position(read_expression, ctx)
                || valtio_is_snapshot_argument(read_expression, ctx)
            {
                continue;
            }
            let mut alias_captures = FxHashMap::default();
            let Some(read_path) = valtio_resolve_proxy_path_from_node(
                read_expression,
                &mut Vec::new(),
                Some(&mut alias_captures),
                ctx,
            ) else {
                continue;
            };
            let read_position = read_expression.span().start;
            let Some(owner_id) =
                find_render_phase_component_or_hook(read_expression, ctx).map(AstNode::id)
            else {
                continue;
            };
            let read_scope = identifier_node.scope_id();
            let matching_target = snapshot_targets.iter().find(|target| {
                target.owner_id == owner_id
                    && target.declaration_end < read_position
                    && target.snapshot_binding_scopes.iter().any(|binding_scope| {
                        ctx.scoping()
                            .scope_ancestors(read_scope)
                            .any(|scope| scope == *binding_scope)
                    })
                    && valtio_path_is_prefix(&target.path, &read_path)
                    && valtio_alias_captures_match_target(&alias_captures, &target.path, &read_path)
                    && !valtio_target_was_replaced(
                        target,
                        read_position,
                        &proxy_writes,
                        &alias_captures,
                    )
            });
            let Some(matching_target) = matching_target else {
                continue;
            };
            if valtio_is_stable_proxy_dependency(read_expression, &read_path, matching_target, ctx)
            {
                continue;
            }
            reported_expression_ids.insert(read_expression.id());
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(read_expression.span()));
        }
    }
}

fn valtio_snapshot_target<'a>(
    call_node: &AstNode<'a>,
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<ValtioSnapshotTarget> {
    if !valtio_is_use_snapshot_callee(&call.callee, ctx) {
        return None;
    }
    let proxy_argument = call.arguments.first()?.as_expression()?;
    let path =
        valtio_resolve_proxy_path_from_expression(proxy_argument, &mut Vec::new(), None, ctx)?;
    if path.properties.iter().any(Option::is_none) {
        return None;
    }
    let call_root = transparent_expression_root(call_node, ctx);
    let declarator_node = ctx.nodes().parent_node(call_root.id());
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != call_root.span())
        || !matches!(
            ctx.nodes().parent_node(declarator_node.id()).kind(),
            AstKind::VariableDeclaration(_)
        )
    {
        return None;
    }
    let owner_id = find_render_phase_component_or_hook(call_node, ctx)?.id();
    let mut snapshot_binding_scopes = Vec::new();
    valtio_collect_binding_scopes(&declarator.id, &mut snapshot_binding_scopes, ctx);
    (!snapshot_binding_scopes.is_empty()).then_some(ValtioSnapshotTarget {
        declaration_end: declarator.span.end,
        owner_id,
        path,
        snapshot_binding_scopes,
    })
}

fn valtio_collect_binding_scopes(
    pattern: &BindingPattern<'_>,
    scopes: &mut Vec<ScopeId>,
    ctx: &LintContext<'_>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            scopes.push(ctx.scoping().symbol_scope_id(identifier.symbol_id()));
        }
        BindingPattern::AssignmentPattern(assignment) => {
            valtio_collect_binding_scopes(&assignment.left, scopes, ctx);
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                valtio_collect_binding_scopes(element, scopes, ctx);
            }
            if let Some(rest) = &array.rest {
                valtio_collect_binding_scopes(&rest.argument, scopes, ctx);
            }
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                valtio_collect_binding_scopes(&property.value, scopes, ctx);
            }
            if let Some(rest) = &object.rest {
                valtio_collect_binding_scopes(&rest.argument, scopes, ctx);
            }
        }
    }
}

fn valtio_is_use_snapshot_callee<'a>(callee: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let callee = callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        let Some(symbol_id) = valtio_resolve_const_alias_symbol(identifier, ctx) else {
            return false;
        };
        return valtio_import_entry_for_symbol(symbol_id, ctx).is_some_and(|entry| {
            matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "useSnapshot"
            )
        });
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    if valtio_member_property_name(member).as_deref() != Some("useSnapshot") {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = valtio_resolve_const_alias_symbol(receiver, ctx) else {
        return false;
    };
    valtio_import_entry_for_symbol(symbol_id, ctx).is_some_and(|entry| {
        matches!(
            entry.import_name,
            crate::module_record::ImportImportName::NamespaceObject
        )
    })
}

fn valtio_resolve_const_alias_symbol<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited_symbol_ids = FxHashSet::default();
    loop {
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(Expression::Identifier(next_identifier)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}

fn valtio_import_entry_for_symbol<'a>(
    symbol_id: SymbolId,
    ctx: &'a LintContext<'_>,
) -> Option<&'a crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        VALTIO_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn valtio_member_property_name(member: &MemberExpression<'_>) -> Option<String> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        MemberExpression::ComputedMemberExpression(member) => {
            valtio_computed_member_property_name(member)
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn valtio_computed_member_property_name(
    member: &oxc_ast::ast::ComputedMemberExpression<'_>,
) -> Option<String> {
    match &member.expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().map(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string()
            })
        }
        _ => None,
    }
}

fn valtio_resolve_proxy_path_from_node<'a>(
    node: &AstNode<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    alias_captures: Option<&mut FxHashMap<SymbolId, ValtioProxyAliasCapture>>,
    ctx: &LintContext<'a>,
) -> Option<ValtioProxyPath> {
    match node.kind() {
        AstKind::IdentifierReference(identifier) => valtio_resolve_proxy_path_from_identifier(
            identifier,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::StaticMemberExpression(member) => valtio_resolve_proxy_member_parts(
            &member.object,
            Some(member.property.name.as_str()),
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::ComputedMemberExpression(member) => valtio_resolve_proxy_member_parts(
            &member.object,
            valtio_computed_member_property_name(member).as_deref(),
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::PrivateFieldExpression(member) => valtio_resolve_proxy_member_parts(
            &member.object,
            None,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::ParenthesizedExpression(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::TSAsExpression(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::TSSatisfiesExpression(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::TSTypeAssertion(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::TSInstantiationExpression(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::TSNonNullExpression(wrapper) => valtio_resolve_proxy_path_from_expression(
            &wrapper.expression,
            visited_symbol_ids,
            alias_captures,
            ctx,
        ),
        AstKind::ChainExpression(chain) => match &chain.expression {
            ChainElement::TSNonNullExpression(wrapper) => {
                valtio_resolve_proxy_path_from_expression(
                    &wrapper.expression,
                    visited_symbol_ids,
                    alias_captures,
                    ctx,
                )
            }
            chain_element => valtio_resolve_proxy_member_path(
                chain_element.as_member_expression()?,
                visited_symbol_ids,
                alias_captures,
                ctx,
            ),
        },
        _ => None,
    }
}

fn valtio_resolve_proxy_path_from_expression<'a>(
    expression: &Expression<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    alias_captures: Option<&mut FxHashMap<SymbolId, ValtioProxyAliasCapture>>,
    ctx: &LintContext<'a>,
) -> Option<ValtioProxyPath> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return valtio_resolve_proxy_path_from_identifier(
            identifier,
            visited_symbol_ids,
            alias_captures,
            ctx,
        );
    }
    valtio_resolve_proxy_member_path(
        expression.as_member_expression()?,
        visited_symbol_ids,
        alias_captures,
        ctx,
    )
}

fn valtio_resolve_proxy_member_path<'a>(
    member: &MemberExpression<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    alias_captures: Option<&mut FxHashMap<SymbolId, ValtioProxyAliasCapture>>,
    ctx: &LintContext<'a>,
) -> Option<ValtioProxyPath> {
    valtio_resolve_proxy_member_parts(
        member.object(),
        valtio_member_property_name(member).as_deref(),
        visited_symbol_ids,
        alias_captures,
        ctx,
    )
}

fn valtio_resolve_proxy_member_parts<'a>(
    object: &Expression<'a>,
    property_name: Option<&str>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    alias_captures: Option<&mut FxHashMap<SymbolId, ValtioProxyAliasCapture>>,
    ctx: &LintContext<'a>,
) -> Option<ValtioProxyPath> {
    let mut path =
        valtio_resolve_proxy_path_from_expression(object, visited_symbol_ids, alias_captures, ctx)?;
    path.properties.push(property_name.map(str::to_string));
    Some(path)
}

fn valtio_resolve_proxy_path_from_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
    mut alias_captures: Option<&mut FxHashMap<SymbolId, ValtioProxyAliasCapture>>,
    ctx: &LintContext<'a>,
) -> Option<ValtioProxyPath> {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return Some(ValtioProxyPath {
            root: ValtioProxyRoot::Global(identifier.name.to_string()),
            properties: Vec::new(),
        });
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(ValtioProxyPath {
            root: ValtioProxyRoot::Symbol(symbol_id),
            properties: Vec::new(),
        });
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return Some(ValtioProxyPath {
            root: ValtioProxyRoot::Symbol(symbol_id),
            properties: Vec::new(),
        });
    }
    let direct_alias = declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id);
    let pattern_path = (!direct_alias)
        .then(|| valtio_pattern_path_to_symbol(&declarator.id, symbol_id))
        .flatten();
    let Some(initializer) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return Some(ValtioProxyPath {
            root: ValtioProxyRoot::Symbol(symbol_id),
            properties: Vec::new(),
        });
    };
    let can_resolve_direct_alias = direct_alias
        && (matches!(initializer, Expression::Identifier(_))
            || initializer.as_member_expression().is_some());
    if !can_resolve_direct_alias && pattern_path.is_none() {
        return Some(ValtioProxyPath {
            root: ValtioProxyRoot::Symbol(symbol_id),
            properties: Vec::new(),
        });
    }
    visited_symbol_ids.push(symbol_id);
    let mut path = valtio_resolve_proxy_path_from_expression(
        initializer,
        visited_symbol_ids,
        alias_captures.as_deref_mut(),
        ctx,
    )?;
    visited_symbol_ids.pop();
    path.properties
        .extend(pattern_path.unwrap_or_default().into_iter().map(Some));
    if let Some(alias_captures) = alias_captures {
        alias_captures.insert(
            symbol_id,
            ValtioProxyAliasCapture {
                declaration_end: declarator.span.end,
                path: path.clone(),
            },
        );
    }
    Some(path)
}

fn valtio_pattern_path_to_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> Option<Vec<String>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            (identifier.symbol_id() == symbol_id).then(Vec::new)
        }
        BindingPattern::AssignmentPattern(assignment) => {
            valtio_pattern_path_to_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ArrayPattern(array) => {
            for (index, element) in array.elements.iter().enumerate() {
                let Some(element) = element else {
                    continue;
                };
                if let Some(mut path) = valtio_pattern_path_to_symbol(element, symbol_id) {
                    path.insert(0, index.to_string());
                    return Some(path);
                }
            }
            None
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                let Some(mut path) = valtio_pattern_path_to_symbol(&property.value, symbol_id)
                else {
                    continue;
                };
                if property.computed {
                    return None;
                }
                let property_name = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => identifier.name.as_str(),
                    PropertyKey::StringLiteral(literal) => literal.value.as_str(),
                    _ => return None,
                };
                path.insert(0, property_name.to_string());
                return Some(path);
            }
            None
        }
    }
}

fn valtio_outermost_member_read<'a, 'b>(
    identifier_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    let mut current = transparent_expression_root(identifier_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let object_span = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span(),
            AstKind::PrivateFieldExpression(member) => member.object.span(),
            _ => return current,
        };
        if object_span != current.span() {
            return current;
        }
        current = transparent_expression_root(parent, ctx);
    }
}

fn valtio_is_snapshot_argument<'a>(expression: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(expression, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|argument| argument.span() == expression_root.span())
        && valtio_is_use_snapshot_callee(&call.callee, ctx)
}

fn valtio_is_stable_proxy_dependency<'a>(
    expression: &AstNode<'a>,
    read_path: &ValtioProxyPath,
    target: &ValtioSnapshotTarget,
    ctx: &LintContext<'a>,
) -> bool {
    if read_path.properties.len() != target.path.properties.len()
        || !valtio_path_is_prefix(&target.path, read_path)
    {
        return false;
    }
    let expression_root = transparent_expression_root(expression, ctx);
    let dependency_array_node = ctx.nodes().parent_node(expression_root.id());
    let AstKind::ArrayExpression(dependency_array) = dependency_array_node.kind() else {
        return false;
    };
    let hook_call_node = ctx.nodes().parent_node(dependency_array_node.id());
    let AstKind::CallExpression(hook_call) = hook_call_node.kind() else {
        return false;
    };
    hook_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .is_some_and(|argument| argument.span() == dependency_array.span)
        && DEPENDENCY_ARRAY_HOOK_NAMES
            .iter()
            .any(|hook_name| valtio_is_exact_react_api_call(hook_call, hook_name, ctx))
}

fn valtio_is_exact_react_api_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        return ctx.module_record().import_entries.iter().any(|entry| {
            REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == api_name
                )
        });
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    if valtio_member_property_name(member).as_deref() != Some(api_name) {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    if receiver.name == "React"
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none()
    {
        return true;
    }
    let Some(symbol_id) = valtio_resolve_const_alias_symbol(receiver, ctx) else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        REACT_RUNTIME_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && (matches!(
                entry.import_name,
                crate::module_record::ImportImportName::Default(_)
                    | crate::module_record::ImportImportName::NamespaceObject
            ) || matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "default"
            ))
    })
}

fn valtio_path_is_prefix(prefix: &ValtioProxyPath, candidate: &ValtioProxyPath) -> bool {
    prefix.root == candidate.root
        && prefix.properties.len() <= candidate.properties.len()
        && prefix.properties.iter().zip(&candidate.properties).all(
            |(prefix_property, candidate_property)| {
                prefix_property.is_some() && prefix_property == candidate_property
            },
        )
}

fn valtio_alias_captures_match_target(
    captures: &FxHashMap<SymbolId, ValtioProxyAliasCapture>,
    target_path: &ValtioProxyPath,
    read_path: &ValtioProxyPath,
) -> bool {
    captures.is_empty()
        || captures.values().any(|capture| {
            valtio_path_is_prefix(&capture.path, target_path)
                || (valtio_path_is_prefix(target_path, &capture.path)
                    && read_path.properties.len() > capture.path.properties.len())
        })
}

fn valtio_target_was_replaced(
    target: &ValtioSnapshotTarget,
    read_position: u32,
    writes: &[ValtioProxyWrite],
    captures: &FxHashMap<SymbolId, ValtioProxyAliasCapture>,
) -> bool {
    writes.iter().any(|write| {
        write.owner_id == target.owner_id
            && write.position > target.declaration_end
            && write.position < read_position
            && valtio_path_is_prefix(&write.path, &target.path)
            && !captures.values().any(|capture| {
                capture.declaration_end < write.position
                    && valtio_path_is_prefix(&write.path, &capture.path)
            })
    })
}

fn valtio_collect_assignment_target_writes<'a>(
    target: &AssignmentTarget<'a>,
    position: u32,
    owner_id: NodeId,
    writes: &mut Vec<ValtioProxyWrite>,
    ctx: &LintContext<'a>,
) {
    if let Some(simple_target) = target.as_simple_assignment_target() {
        valtio_collect_simple_assignment_target_write(
            simple_target,
            position,
            owner_id,
            writes,
            ctx,
        );
        return;
    }
    match target {
        AssignmentTarget::ArrayAssignmentTarget(array) => {
            valtio_collect_array_assignment_target_writes(array, position, owner_id, writes, ctx);
        }
        AssignmentTarget::ObjectAssignmentTarget(object) => {
            valtio_collect_object_assignment_target_writes(object, position, owner_id, writes, ctx);
        }
        _ => {}
    }
}

fn valtio_collect_array_assignment_target_writes<'a>(
    target: &ArrayAssignmentTarget<'a>,
    position: u32,
    owner_id: NodeId,
    writes: &mut Vec<ValtioProxyWrite>,
    ctx: &LintContext<'a>,
) {
    for element in target.elements.iter().flatten() {
        valtio_collect_assignment_target_maybe_default_writes(
            element, position, owner_id, writes, ctx,
        );
    }
    if let Some(rest) = &target.rest {
        valtio_collect_assignment_target_writes(&rest.target, position, owner_id, writes, ctx);
    }
}

fn valtio_collect_object_assignment_target_writes<'a>(
    target: &ObjectAssignmentTarget<'a>,
    position: u32,
    owner_id: NodeId,
    writes: &mut Vec<ValtioProxyWrite>,
    ctx: &LintContext<'a>,
) {
    for property in &target.properties {
        match property {
            AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(identifier) => {
                if let Some(path) = valtio_resolve_proxy_path_from_identifier(
                    &identifier.binding,
                    &mut Vec::new(),
                    None,
                    ctx,
                ) {
                    writes.push(ValtioProxyWrite {
                        position,
                        owner_id,
                        path,
                    });
                }
            }
            AssignmentTargetProperty::AssignmentTargetPropertyProperty(property) => {
                valtio_collect_assignment_target_maybe_default_writes(
                    &property.binding,
                    position,
                    owner_id,
                    writes,
                    ctx,
                );
            }
        }
    }
    if let Some(rest) = &target.rest {
        valtio_collect_assignment_target_writes(&rest.target, position, owner_id, writes, ctx);
    }
}

fn valtio_collect_assignment_target_maybe_default_writes<'a>(
    target: &AssignmentTargetMaybeDefault<'a>,
    position: u32,
    owner_id: NodeId,
    writes: &mut Vec<ValtioProxyWrite>,
    ctx: &LintContext<'a>,
) {
    if let Some(simple_target) = target.as_simple_assignment_target() {
        valtio_collect_simple_assignment_target_write(
            simple_target,
            position,
            owner_id,
            writes,
            ctx,
        );
        return;
    }
    match target {
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(defaulted) => {
            valtio_collect_assignment_target_writes(
                &defaulted.binding,
                position,
                owner_id,
                writes,
                ctx,
            );
        }
        AssignmentTargetMaybeDefault::ArrayAssignmentTarget(array) => {
            valtio_collect_array_assignment_target_writes(array, position, owner_id, writes, ctx);
        }
        AssignmentTargetMaybeDefault::ObjectAssignmentTarget(object) => {
            valtio_collect_object_assignment_target_writes(object, position, owner_id, writes, ctx);
        }
        _ => {}
    }
}

fn valtio_collect_simple_assignment_target_write<'a>(
    target: &SimpleAssignmentTarget<'a>,
    position: u32,
    owner_id: NodeId,
    writes: &mut Vec<ValtioProxyWrite>,
    ctx: &LintContext<'a>,
) {
    let path = if let SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) = target {
        valtio_resolve_proxy_path_from_identifier(identifier, &mut Vec::new(), None, ctx)
    } else if let Some(member) = target.as_member_expression() {
        valtio_resolve_proxy_member_path(member, &mut Vec::new(), None, ctx)
    } else {
        let expression = match target {
            SimpleAssignmentTarget::TSAsExpression(wrapper) => Some(&wrapper.expression),
            SimpleAssignmentTarget::TSSatisfiesExpression(wrapper) => Some(&wrapper.expression),
            SimpleAssignmentTarget::TSNonNullExpression(wrapper) => Some(&wrapper.expression),
            SimpleAssignmentTarget::TSTypeAssertion(wrapper) => Some(&wrapper.expression),
            _ => None,
        };
        expression.and_then(|expression| {
            valtio_resolve_proxy_path_from_expression(expression, &mut Vec::new(), None, ctx)
        })
    };
    if let Some(path) = path {
        writes.push(ValtioProxyWrite {
            position,
            owner_id,
            path,
        });
    }
}

fn valtio_is_mutation_only_position(expression: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = expression;
    for parent in ctx.nodes().ancestors(expression.id()) {
        match parent.kind() {
            AstKind::ComputedMemberExpression(member)
                if member.expression.span() == current.span() =>
            {
                return false;
            }
            AstKind::AssignmentTargetPropertyProperty(property)
                if property.computed && property.name.span() == current.span() =>
            {
                return false;
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.left.span().contains_inclusive(expression.span()) =>
            {
                return true;
            }
            AstKind::UpdateExpression(update)
                if update.argument.span().contains_inclusive(expression.span()) =>
            {
                return true;
            }
            AstKind::UnaryExpression(unary)
                if unary.operator == UnaryOperator::Delete
                    && unary.argument.span().contains_inclusive(expression.span()) =>
            {
                return true;
            }
            AstKind::ForInStatement(statement)
                if statement.left.span().contains_inclusive(expression.span()) =>
            {
                return true;
            }
            AstKind::ForOfStatement(statement)
                if statement.left.span().contains_inclusive(expression.span()) =>
            {
                return true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
        current = parent;
    }
    false
}
