use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, ObjectExpression, ObjectProperty, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, ScopeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolFlags;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This onBeforeCompile patch changes shader source from mutable captured state, but the material has no customProgramCacheKey for those program variants";
const MATERIAL_PROGRAM_OPTION_NAMES: [&str; 2] = ["customProgramCacheKey", "onBeforeCompile"];
const SHADER_PROGRAM_PROPERTY_NAMES: [&str; 3] = ["defines", "fragmentShader", "vertexShader"];
const THREE_PROGRAM_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

struct ProgramVariantCandidate {
    has_constructor_cache_key: bool,
    material_symbol_id: Option<SymbolId>,
    span: Span,
}

#[derive(Debug, Default, Clone)]
pub struct ThreeOnBeforeCompileRequireProgramCacheKey;

impl RuleMeta for ThreeOnBeforeCompileRequireProgramCacheKey {
    const NAME: &'static str = "three-on-before-compile-require-program-cache-key";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require a program cache key for mutable onBeforeCompile variants.",
    };
}

impl Rule for ThreeOnBeforeCompileRequireProgramCacheKey {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_possible_candidate = ctx.nodes().iter().any(|node| match node.kind() {
            AstKind::NewExpression(new_expression) => {
                three_program_api_candidate_name(&new_expression.callee, ctx, &mut Vec::new())
                    .is_some_and(|constructor_name| constructor_name.ends_with("Material"))
            }
            AstKind::AssignmentExpression(assignment) => assignment
                .left
                .as_member_expression()
                .and_then(static_member_expression_property_name)
                .is_some_and(|property_name| {
                    MATERIAL_PROGRAM_OPTION_NAMES.contains(&property_name)
                }),
            _ => false,
        });
        if !has_possible_candidate {
            return;
        }
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut variant_dependent_patch_cache = rustc_hash::FxHashMap::default();
        let mut candidates = Vec::new();
        let mut material_symbols_with_cache_keys = rustc_hash::FxHashSet::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::NewExpression(new_expression) => {
                    if three_program_api_name(&new_expression.callee, &analysis, ctx)
                        .is_none_or(|constructor_name| !constructor_name.ends_with("Material"))
                    {
                        continue;
                    }
                    let Some(options) = new_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                    else {
                        continue;
                    };
                    let Some(options_object) = resolve_program_options_object(
                        options,
                        node,
                        &analysis,
                        ctx,
                        &mut Vec::new(),
                    ) else {
                        continue;
                    };
                    let Some((cache_key_property, on_before_compile_property)) =
                        effective_program_properties(options_object)
                    else {
                        continue;
                    };
                    let material_symbol_id = constructor_material_symbol_id(node, ctx);
                    let has_constructor_cache_key = cache_key_property.is_some_and(|property| {
                        is_usable_program_cache_key(&property.value, ctx, &mut resolution_cache)
                    });
                    if has_constructor_cache_key
                        && let Some(material_symbol_id) = material_symbol_id
                    {
                        material_symbols_with_cache_keys.insert(material_symbol_id);
                    }
                    let Some(on_before_compile_property) = on_before_compile_property else {
                        continue;
                    };
                    let Some(callback_id) = exact_local_function_id_including_generators(
                        &on_before_compile_property.value,
                        ctx,
                        &mut Vec::new(),
                        &mut resolution_cache,
                    ) else {
                        continue;
                    };
                    if *variant_dependent_patch_cache
                        .entry(callback_id)
                        .or_insert_with(|| {
                            callback_has_variant_dependent_patch(callback_id, &node_index, ctx)
                        })
                    {
                        candidates.push(ProgramVariantCandidate {
                            has_constructor_cache_key,
                            material_symbol_id,
                            span: on_before_compile_property.span,
                        });
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    let Some(member_expression) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    let Some(property_name) =
                        static_member_expression_property_name(member_expression)
                    else {
                        continue;
                    };
                    if !MATERIAL_PROGRAM_OPTION_NAMES.contains(&property_name) {
                        continue;
                    }
                    let Some(material_symbol_id) =
                        stable_material_symbol_id(member_expression.object(), &analysis, ctx)
                    else {
                        continue;
                    };
                    if property_name == "customProgramCacheKey" {
                        if is_usable_program_cache_key(
                            &assignment.right,
                            ctx,
                            &mut resolution_cache,
                        ) {
                            material_symbols_with_cache_keys.insert(material_symbol_id);
                        } else {
                            material_symbols_with_cache_keys.remove(&material_symbol_id);
                        }
                        continue;
                    }
                    let Some(callback_id) = exact_local_function_id_including_generators(
                        &assignment.right,
                        ctx,
                        &mut Vec::new(),
                        &mut resolution_cache,
                    ) else {
                        continue;
                    };
                    if *variant_dependent_patch_cache
                        .entry(callback_id)
                        .or_insert_with(|| {
                            callback_has_variant_dependent_patch(callback_id, &node_index, ctx)
                        })
                    {
                        candidates.push(ProgramVariantCandidate {
                            has_constructor_cache_key: false,
                            material_symbol_id: Some(material_symbol_id),
                            span: assignment.span,
                        });
                    }
                }
                _ => {}
            }
        }

        for candidate in candidates {
            if (candidate.material_symbol_id.is_none() && candidate.has_constructor_cache_key)
                || candidate
                    .material_symbol_id
                    .is_some_and(|material_symbol_id| {
                        material_symbols_with_cache_keys.contains(&material_symbol_id)
                    })
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(candidate.span));
        }
    }
}

fn three_program_api_name<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let api_name = three_program_api_candidate_name(expression, ctx, &mut Vec::new())?;
    (module_api_reference_matches(expression, &api_name, &THREE_PROGRAM_MODULES, analysis, ctx)
        || type_import_module_api_reference_matches(
            expression,
            &api_name,
            &THREE_PROGRAM_MODULES,
            analysis,
            ctx,
        ))
    .then_some(api_name)
}

fn three_program_api_candidate_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return static_member_expression_property_name(member_expression).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_program_api_candidate_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}

fn resolve_program_options_object<'a>(
    expression: &Expression<'a>,
    reference_node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<&'a ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => {
            let arena_node = ctx.nodes().get_node(object.node_id());
            let AstKind::ObjectExpression(arena_object) = arena_node.kind() else {
                return None;
            };
            Some(arena_object)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || symbol_has_write_before(symbol_id, reference_node.span().start, ctx)
                || MATERIAL_PROGRAM_OPTION_NAMES.iter().any(|property_name| {
                    has_possible_static_property_write_before(
                        identifier,
                        property_name,
                        reference_node,
                        analysis,
                        ctx,
                    )
                })
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            resolve_program_options_object(
                program_symbol_initializer(symbol_id, ctx)?,
                reference_node,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn program_symbol_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ),
        AstKind::FormalParameter(parameter) => {
            binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)
        }
        _ => None,
    }
}

fn effective_program_properties<'a>(
    object: &'a ObjectExpression<'a>,
) -> Option<(
    Option<&'a ObjectProperty<'a>>,
    Option<&'a ObjectProperty<'a>>,
)> {
    let mut cache_key_property = None;
    let mut on_before_compile_property = None;
    collect_effective_program_properties(
        object,
        &mut cache_key_property,
        &mut on_before_compile_property,
    )?;
    Some((cache_key_property, on_before_compile_property))
}

fn collect_effective_program_properties<'a>(
    object: &'a ObjectExpression<'a>,
    cache_key_property: &mut Option<&'a ObjectProperty<'a>>,
    on_before_compile_property: &mut Option<&'a ObjectProperty<'a>>,
) -> Option<()> {
    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                let property_name = program_option_property_name(property)?;
                match property_name {
                    "customProgramCacheKey" => *cache_key_property = Some(property),
                    "onBeforeCompile" => *on_before_compile_property = Some(property),
                    _ => {}
                }
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                let Expression::ObjectExpression(spread_object) = &spread.argument else {
                    return None;
                };
                collect_effective_program_properties(
                    spread_object,
                    cache_key_property,
                    on_before_compile_property,
                )?;
            }
        }
    }
    Some(())
}

fn program_option_property_name<'a>(property: &'a ObjectProperty<'a>) -> Option<&'a str> {
    if property.computed {
        return match &property.key {
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            oxc_ast::ast::PropertyKey::TemplateLiteral(template)
                if template.expressions.is_empty() =>
            {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                })
            }
            _ => None,
        };
    }
    match &property.key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn constructor_material_symbol_id(
    new_expression_node: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(new_expression_node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != new_expression_node.span())
    {
        return None;
    }
    let binding = declarator.id.get_binding_identifier()?;
    let symbol_id = binding.symbol_id();
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
        .is_some_and(|initializer| initializer.span() == new_expression_node.span())
        .then_some(symbol_id)
}

fn stable_material_symbol_id(
    expression: &Expression<'_>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
    three_program_api_name(
        match initializer.get_inner_expression() {
            Expression::NewExpression(new_expression) => &new_expression.callee,
            _ => return None,
        },
        analysis,
        ctx,
    )
    .is_some_and(|constructor_name| constructor_name.ends_with("Material"))
    .then_some(symbol_id)
}

fn is_usable_program_cache_key<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )
    .is_some()
    {
        return true;
    }
    let candidate = short_borrow_inner_expression(expression);
    if let Expression::Identifier(identifier) = candidate {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
        if identifier.name == "undefined" && symbol_id.is_none() {
            return false;
        }
        if let Some(symbol_id) =
            symbol_id.and_then(|_| resolve_const_identifier_root_symbol(identifier, ctx))
        {
            let flags = ctx.scoping().symbol_flags(symbol_id);
            if !flags.contains(SymbolFlags::ConstVariable) {
                return true;
            }
            let Some(initializer) = program_symbol_initializer(symbol_id, ctx) else {
                return true;
            };
            return is_usable_program_cache_key_candidate(short_borrow_inner_expression(
                initializer,
            ));
        } else {
            return true;
        }
    }
    is_usable_program_cache_key_candidate(candidate)
}

fn short_borrow_inner_expression<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::ParenthesizedExpression(wrapper) => &wrapper.expression,
            Expression::TSAsExpression(wrapper) => &wrapper.expression,
            Expression::TSSatisfiesExpression(wrapper) => &wrapper.expression,
            Expression::TSInstantiationExpression(wrapper) => &wrapper.expression,
            Expression::TSNonNullExpression(wrapper) => &wrapper.expression,
            Expression::TSTypeAssertion(wrapper) => &wrapper.expression,
            _ => return expression,
        };
    }
}

fn is_usable_program_cache_key_candidate(candidate: &Expression<'_>) -> bool {
    !matches!(
        candidate,
        Expression::ArrayExpression(_)
            | Expression::ClassExpression(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::ObjectExpression(_)
            | Expression::TemplateLiteral(_)
            | Expression::UnaryExpression(_)
    )
}

fn callback_has_variant_dependent_patch(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let callback = ctx.nodes().get_node(callback_id);
    let (parameters, body_span) = match callback.kind() {
        AstKind::Function(function) => {
            let Some(body) = function.body.as_ref() else {
                return false;
            };
            (&function.params, body.span)
        }
        AstKind::ArrowFunctionExpression(function) => (&function.params, function.body.span()),
        _ => return false,
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let BindingPattern::BindingIdentifier(shader_parameter) = &first_parameter.pattern else {
        return false;
    };
    let shader_parameter_symbol_id = shader_parameter.symbol_id();
    let callback_scope_id = ctx.scoping().symbol_scope_id(shader_parameter_symbol_id);
    let callback_nodes = node_index
        .node_ids(callback_id)
        .iter()
        .map(|&candidate_id| ctx.nodes().get_node(candidate_id))
        .filter(|candidate| body_span.contains_inclusive(candidate.span()))
        .collect::<Vec<_>>();
    let shader_write_spans = callback_nodes
        .iter()
        .filter_map(|candidate| {
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return None;
            };
            let member_expression = assignment.left.as_member_expression()?;
            shader_program_property_name(member_expression, shader_parameter_symbol_id, ctx)?;
            Some(candidate.span())
        })
        .collect::<Vec<_>>();

    for candidate in callback_nodes.iter().copied() {
        match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    continue;
                };
                if shader_program_property_name(member_expression, shader_parameter_symbol_id, ctx)
                    .is_some()
                    && expression_depends_on_mutable_capture(
                        &assignment.right,
                        callback_scope_id,
                        &callback_nodes,
                        ctx,
                        &mut rustc_hash::FxHashSet::default(),
                    )
                {
                    return true;
                }
            }
            AstKind::IfStatement(statement) => {
                if expression_depends_on_mutable_capture(
                    &statement.test,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && (span_has_shader_write(statement.consequent.span(), &shader_write_spans)
                    || statement.alternate.as_ref().is_some_and(|alternate| {
                        span_has_shader_write(alternate.span(), &shader_write_spans)
                    }))
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                if expression_depends_on_mutable_capture(
                    &expression.test,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && (span_has_shader_write(expression.consequent.span(), &shader_write_spans)
                    || span_has_shader_write(expression.alternate.span(), &shader_write_spans))
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) => {
                if expression_depends_on_mutable_capture(
                    &expression.left,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && span_has_shader_write(expression.right.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            AstKind::SwitchStatement(statement) => {
                let has_mutable_selector = expression_depends_on_mutable_capture(
                    &statement.discriminant,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) || statement.cases.iter().any(|switch_case| {
                    switch_case.test.as_ref().is_some_and(|test| {
                        expression_depends_on_mutable_capture(
                            test,
                            callback_scope_id,
                            &callback_nodes,
                            ctx,
                            &mut rustc_hash::FxHashSet::default(),
                        )
                    })
                });
                if has_mutable_selector
                    && statement.cases.iter().any(|switch_case| {
                        switch_case.consequent.iter().any(|consequent| {
                            span_has_shader_write(consequent.span(), &shader_write_spans)
                        })
                    })
                {
                    return true;
                }
            }
            AstKind::WhileStatement(statement) => {
                if expression_depends_on_mutable_capture(
                    &statement.test,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && span_has_shader_write(statement.body.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            AstKind::DoWhileStatement(statement) => {
                if expression_depends_on_mutable_capture(
                    &statement.test,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && span_has_shader_write(statement.body.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            AstKind::ForStatement(statement) => {
                if statement.test.as_ref().is_some_and(|test| {
                    expression_depends_on_mutable_capture(
                        test,
                        callback_scope_id,
                        &callback_nodes,
                        ctx,
                        &mut rustc_hash::FxHashSet::default(),
                    )
                }) && span_has_shader_write(statement.body.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            AstKind::ForInStatement(statement) => {
                if expression_depends_on_mutable_capture(
                    &statement.right,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && span_has_shader_write(statement.body.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            AstKind::ForOfStatement(statement) => {
                if expression_depends_on_mutable_capture(
                    &statement.right,
                    callback_scope_id,
                    &callback_nodes,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                ) && span_has_shader_write(statement.body.span(), &shader_write_spans)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn shader_program_property_name<'a>(
    member_expression: &'a oxc_ast::ast::MemberExpression<'a>,
    shader_parameter_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let root_identifier = member_root_identifier(member_expression.object())?;
    if ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id()
        != Some(shader_parameter_symbol_id)
    {
        return None;
    }
    let mut candidate = member_expression;
    let property_name = loop {
        let property_name = static_member_expression_property_name(candidate);
        let object = candidate.object();
        if matches!(object, Expression::Identifier(_)) {
            break property_name;
        }
        candidate = object.as_member_expression()?;
    };
    property_name.filter(|property_name| SHADER_PROGRAM_PROPERTY_NAMES.contains(property_name))
}

fn member_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    let mut candidate = expression;
    while let Some(member) = candidate.as_member_expression() {
        candidate = member.object();
    }
    match candidate {
        Expression::Identifier(identifier) => Some(identifier),
        _ => None,
    }
}

fn expression_depends_on_mutable_capture<'a>(
    expression: &Expression<'a>,
    callback_scope_id: ScopeId,
    callback_nodes: &[&crate::AstNode<'a>],
    ctx: &LintContext<'a>,
    visited_local_symbol_ids: &mut rustc_hash::FxHashSet<SymbolId>,
) -> bool {
    let expression_node_id = expression.node_id();
    for candidate in callback_nodes.iter().copied().filter(|candidate| {
        expression.span().contains_inclusive(candidate.span())
            && node_belongs_to_expression(candidate, expression_node_id, ctx)
    }) {
        if matches!(candidate.kind(), AstKind::ThisExpression(_)) {
            return true;
        }
        if let Some(member_expression) = candidate.kind().as_member_expression_kind()
            && let Some(root_identifier) = member_root_identifier(member_expression.object())
            && let Some(symbol_id) = ctx
                .scoping()
                .get_reference(root_identifier.reference_id())
                .symbol_id()
            && !scope_is_within(
                ctx.scoping().symbol_scope_id(symbol_id),
                callback_scope_id,
                ctx,
            )
        {
            let flags = ctx.scoping().symbol_flags(symbol_id);
            if !flags.intersects(SymbolFlags::Import | SymbolFlags::Function | SymbolFlags::Class) {
                return true;
            }
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        let is_local = scope_is_within(
            ctx.scoping().symbol_scope_id(symbol_id),
            callback_scope_id,
            ctx,
        );
        if !is_local {
            let flags = ctx.scoping().symbol_flags(symbol_id);
            let is_let_var_or_parameter = flags.contains(SymbolFlags::FunctionScopedVariable)
                || (flags.contains(SymbolFlags::BlockScopedVariable)
                    && !flags.contains(SymbolFlags::ConstVariable));
            let has_mutable_const_initializer = flags.contains(SymbolFlags::ConstVariable)
                && resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).is_some_and(
                    |initializer| {
                        matches!(
                            initializer.get_inner_expression(),
                            Expression::ArrayExpression(_)
                                | Expression::ObjectExpression(_)
                                | Expression::NewExpression(_)
                        )
                    },
                );
            if is_let_var_or_parameter || has_mutable_const_initializer {
                return true;
            }
            continue;
        }
        if !visited_local_symbol_ids.insert(symbol_id) {
            continue;
        }
        let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
        else {
            continue;
        };
        if matches!(
            initializer.get_inner_expression(),
            Expression::ArrowFunctionExpression(_)
                | Expression::FunctionExpression(_)
                | Expression::ArrayExpression(_)
                | Expression::ObjectExpression(_)
                | Expression::NewExpression(_)
        ) {
            continue;
        }
        if expression_depends_on_mutable_capture(
            initializer,
            callback_scope_id,
            callback_nodes,
            ctx,
            visited_local_symbol_ids,
        ) {
            return true;
        }
    }
    false
}

fn scope_is_within(
    candidate_scope_id: ScopeId,
    ancestor_scope_id: ScopeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .scope_ancestors(candidate_scope_id)
        .any(|scope_id| scope_id == ancestor_scope_id)
}

fn node_belongs_to_expression(
    node: &crate::AstNode<'_>,
    expression_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if node.id() == expression_id {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == expression_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn span_has_shader_write(span: Span, shader_write_spans: &[Span]) -> bool {
    shader_write_spans
        .iter()
        .any(|shader_write_span| span.contains_inclusive(*shader_write_span))
}
