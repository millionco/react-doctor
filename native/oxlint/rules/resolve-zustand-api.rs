#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ZustandApiName {
    Combine,
    Create,
    CreateJsonStorage,
    CreateStore,
    CreateWithEqualityFn,
    Devtools,
    Immer,
    Persist,
    Redux,
    Shallow,
    SubscribeWithSelector,
    UseShallow,
    UseStore,
    UseStoreWithEqualityFn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ZustandApiBinding {
    api_name: ZustandApiName,
    module_source: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ZustandStoreFactoryApi {
    Create,
    CreateStore,
    CreateWithEqualityFn,
}

struct ZustandStoreFactoryCall<'node, 'ast> {
    call_expression: &'node oxc_ast::ast::CallExpression<'ast>,
    creator_argument: &'node oxc_ast::ast::Expression<'ast>,
    factory_api_name: ZustandStoreFactoryApi,
}

struct ZustandStoreCreator {
    creator_function_id: oxc_semantic::NodeId,
    factory_api_name: ZustandStoreFactoryApi,
    middleware_names: rustc_hash::FxHashSet<ZustandApiName>,
}

fn resolve_zustand_api_binding(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<ZustandApiBinding> {
    resolve_zustand_api_binding_internal(expression, ctx, &mut Vec::new())
}

fn resolve_zustand_api_binding_internal(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<ZustandApiBinding> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                oxc_ast::AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            return resolve_zustand_api_binding_internal(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return zustand_import_binding(symbol_id, ctx);
    }

    let member = expression.as_member_expression()?;
    let property_name = member.static_property_name()?;
    let oxc_ast::ast::Expression::Identifier(namespace) = member.object().get_inner_expression()
    else {
        return None;
    };
    let module_source = zustand_namespace_import_source(namespace, ctx, &mut Vec::new())?;
    zustand_api_name_for_module(module_source, property_name).map(|api_name| ZustandApiBinding {
        api_name,
        module_source,
    })
}

fn zustand_import_binding(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &crate::context::LintContext<'_>,
) -> Option<ZustandApiBinding> {
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if entry.is_type
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
        {
            return None;
        }
        let module_source = zustand_module_source(entry.module_request.name())?;
        let api_name = match &entry.import_name {
            crate::module_record::ImportImportName::Default(_) if module_source == "zustand" => {
                ZustandApiName::Create
            }
            crate::module_record::ImportImportName::Name(imported_name) => {
                zustand_api_name_for_module(module_source, imported_name.name())?
            }
            _ => return None,
        };
        Some(ZustandApiBinding {
            api_name,
            module_source,
        })
    })
}

fn zustand_namespace_import_source(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'static str> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let oxc_ast::ast::Expression::Identifier(next_identifier) =
            declarator.init.as_ref()?.get_inner_expression()
        else {
            return None;
        };
        return zustand_namespace_import_source(next_identifier, ctx, visited_symbol_ids);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if entry.is_type
            || ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                != Some(symbol_id)
            || !matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
        {
            return None;
        }
        zustand_module_source(entry.module_request.name())
    })
}

fn zustand_module_source(module_source: &str) -> Option<&'static str> {
    match module_source {
        "zustand" => Some("zustand"),
        "zustand/vanilla" => Some("zustand/vanilla"),
        "zustand/react" => Some("zustand/react"),
        "zustand/traditional" => Some("zustand/traditional"),
        "zustand/shallow" => Some("zustand/shallow"),
        "zustand/react/shallow" => Some("zustand/react/shallow"),
        "zustand/middleware" => Some("zustand/middleware"),
        "zustand/middleware/immer" => Some("zustand/middleware/immer"),
        _ => None,
    }
}

fn zustand_api_name_for_module(module_source: &str, api_name: &str) -> Option<ZustandApiName> {
    match (module_source, api_name) {
        ("zustand", "create") => Some(ZustandApiName::Create),
        ("zustand", "createStore") | ("zustand/vanilla", "createStore") => {
            Some(ZustandApiName::CreateStore)
        }
        ("zustand", "useStore") | ("zustand/react", "useStore") => Some(ZustandApiName::UseStore),
        ("zustand/traditional", "createWithEqualityFn") => {
            Some(ZustandApiName::CreateWithEqualityFn)
        }
        ("zustand/traditional", "useStoreWithEqualityFn") => {
            Some(ZustandApiName::UseStoreWithEqualityFn)
        }
        ("zustand/shallow", "shallow") => Some(ZustandApiName::Shallow),
        ("zustand/shallow", "useShallow") | ("zustand/react/shallow", "useShallow") => {
            Some(ZustandApiName::UseShallow)
        }
        ("zustand/middleware", "combine") => Some(ZustandApiName::Combine),
        ("zustand/middleware", "createJSONStorage") => Some(ZustandApiName::CreateJsonStorage),
        ("zustand/middleware", "devtools") => Some(ZustandApiName::Devtools),
        ("zustand/middleware", "persist") => Some(ZustandApiName::Persist),
        ("zustand/middleware", "redux") => Some(ZustandApiName::Redux),
        ("zustand/middleware", "subscribeWithSelector") => {
            Some(ZustandApiName::SubscribeWithSelector)
        }
        ("zustand/middleware/immer", "immer") => Some(ZustandApiName::Immer),
        _ => None,
    }
}

fn resolve_zustand_store_factory_call<'node, 'ast>(
    call_expression: &'node oxc_ast::ast::CallExpression<'ast>,
    ctx: &crate::context::LintContext<'ast>,
) -> Option<ZustandStoreFactoryCall<'node, 'ast>> {
    let factory_api_name = resolve_zustand_api_binding(&call_expression.callee, ctx)
        .and_then(|binding| zustand_store_factory_api(binding.api_name))
        .or_else(|| resolve_curried_zustand_store_factory(&call_expression.callee, ctx))?;
    let creator_argument = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)?;
    Some(ZustandStoreFactoryCall {
        call_expression,
        creator_argument,
        factory_api_name,
    })
}

fn resolve_curried_zustand_store_factory(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<ZustandStoreFactoryApi> {
    resolve_curried_zustand_store_factory_internal(expression, ctx, &mut Vec::new())
}

fn resolve_curried_zustand_store_factory_internal(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &crate::context::LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<ZustandStoreFactoryApi> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            oxc_ast::AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        return resolve_curried_zustand_store_factory_internal(
            declarator.init.as_ref()?,
            ctx,
            visited_symbol_ids,
        );
    }
    let oxc_ast::ast::Expression::CallExpression(call) = expression else {
        return None;
    };
    if !call.arguments.is_empty() {
        return None;
    }
    resolve_zustand_api_binding(&call.callee, ctx)
        .and_then(|binding| zustand_store_factory_api(binding.api_name))
}

fn zustand_store_factory_api(api_name: ZustandApiName) -> Option<ZustandStoreFactoryApi> {
    match api_name {
        ZustandApiName::Create => Some(ZustandStoreFactoryApi::Create),
        ZustandApiName::CreateStore => Some(ZustandStoreFactoryApi::CreateStore),
        ZustandApiName::CreateWithEqualityFn => Some(ZustandStoreFactoryApi::CreateWithEqualityFn),
        _ => None,
    }
}

fn resolve_zustand_store_creator<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<ZustandStoreCreator> {
    let factory_call = resolve_zustand_store_factory_call(call_expression, ctx)?;
    let mut middleware_names = rustc_hash::FxHashSet::default();
    let creator_function_id = resolve_zustand_state_creator(
        factory_call.creator_argument,
        ctx,
        &mut middleware_names,
        &mut rustc_hash::FxHashSet::default(),
        resolution_cache,
    )?;
    Some(ZustandStoreCreator {
        creator_function_id,
        factory_api_name: factory_call.factory_api_name,
        middleware_names,
    })
}

fn resolve_zustand_state_creator<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    middleware_names: &mut rustc_hash::FxHashSet<ZustandApiName>,
    visited_expression_ids: &mut rustc_hash::FxHashSet<oxc_semantic::NodeId>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<oxc_semantic::NodeId> {
    let expression = expression.get_inner_expression();
    if !visited_expression_ids.insert(expression.node_id()) {
        return None;
    }
    if let Some(function_id) = exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    ) {
        return Some(function_id);
    }
    let oxc_ast::ast::Expression::CallExpression(call) = expression else {
        return None;
    };
    let middleware = resolve_zustand_api_binding(&call.callee, ctx)?;
    let creator_argument_index = match middleware.api_name {
        ZustandApiName::Combine => 1,
        ZustandApiName::Devtools
        | ZustandApiName::Immer
        | ZustandApiName::Persist
        | ZustandApiName::SubscribeWithSelector => 0,
        _ => return None,
    };
    let creator_argument = call
        .arguments
        .get(creator_argument_index)
        .and_then(oxc_ast::ast::Argument::as_expression)?;
    middleware_names.insert(middleware.api_name);
    resolve_zustand_state_creator(
        creator_argument,
        ctx,
        middleware_names,
        visited_expression_ids,
        resolution_cache,
    )
}
