#[derive(Clone, Copy, PartialEq, Eq)]
enum LoaderCacheProvenanceKind {
    Cached,
    ShallowClone,
    ShallowMaterialClone,
}

struct LoaderCacheProvenance {
    is_material_value: bool,
    kind: LoaderCacheProvenanceKind,
    terminal_property_name: Option<String>,
}

const DREI_CACHED_LOADER_HOOK_NAMES: [&str; 6] = [
    "useCubeTexture",
    "useFBX",
    "useFont",
    "useGLTF",
    "useKTX2",
    "useTexture",
];
const SHALLOW_MATERIAL_CLONE_SHARED_TEXTURE_PROPERTY_NAMES: [&str; 23] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "gradientMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
    "lightMap",
    "map",
    "matcap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "specularMap",
    "thicknessMap",
    "transmissionMap",
];
const SKELETON_UTILS_MODULE_SOURCES: [&str; 5] = [
    "three-stdlib",
    "three/addons/utils/SkeletonUtils",
    "three/addons/utils/SkeletonUtils.js",
    "three/examples/jsm/utils/SkeletonUtils",
    "three/examples/jsm/utils/SkeletonUtils.js",
];

fn resolve_loader_cache_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    loader_cache_provenance(expression, ctx, &mut Vec::new())
        .is_some_and(|provenance| provenance.kind == LoaderCacheProvenanceKind::Cached)
}

fn loader_cache_provenance<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<LoaderCacheProvenance> {
    let expression = expression.get_inner_expression();
    if let oxc_ast::ast::Expression::CallExpression(call_expression) = expression {
        if let Some(member_expression) = call_expression.callee.as_member_expression()
            && member_expression.static_property_name() == Some("clone")
            && let Some(cloned_provenance) = loader_cache_provenance(
                member_expression.object(),
                ctx,
                &mut visited_symbol_ids.clone(),
            )
        {
            return Some(LoaderCacheProvenance {
                is_material_value: false,
                kind: if cloned_provenance.is_material_value
                    || cloned_provenance.kind == LoaderCacheProvenanceKind::ShallowMaterialClone
                {
                    LoaderCacheProvenanceKind::ShallowMaterialClone
                } else {
                    LoaderCacheProvenanceKind::ShallowClone
                },
                terminal_property_name: None,
            });
        }
        if module_api_path_matches(
            &call_expression.callee,
            &["clone"],
            &SKELETON_UTILS_MODULE_SOURCES,
            false,
            ctx,
        ) && call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|argument| {
                loader_cache_provenance(
                    argument,
                    ctx,
                    &mut visited_symbol_ids.clone(),
                )
                .is_some()
            })
        {
            return Some(LoaderCacheProvenance {
                is_material_value: false,
                kind: LoaderCacheProvenanceKind::ShallowClone,
                terminal_property_name: None,
            });
        }
        return is_cached_loader_call(call_expression, ctx).then(|| LoaderCacheProvenance {
            is_material_value: false,
            kind: LoaderCacheProvenanceKind::Cached,
            terminal_property_name: None,
        });
    }
    if let Some(member_expression) = expression.as_member_expression() {
        let property_name = loader_cache_member_property_name(member_expression)?;
        let receiver_provenance = loader_cache_provenance(
            member_expression.object(),
            ctx,
            visited_symbol_ids,
        )?;
        return extend_loader_cache_provenance(receiver_provenance, property_name);
    }
    let oxc_ast::ast::Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    if let Some(callback_source) = loader_cache_callback_source(symbol_id, ctx) {
        return loader_cache_provenance(callback_source, ctx, visited_symbol_ids);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        oxc_ast::AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) {
        return None;
    }
    let initializer_provenance = loader_cache_provenance(
        declarator.init.as_ref()?,
        ctx,
        visited_symbol_ids,
    )?;
    let Some(property_name) = binding_property_name_for_symbol(&declarator.id, symbol_id) else {
        return Some(initializer_provenance);
    };
    extend_loader_cache_provenance(initializer_provenance, property_name)
}

fn extend_loader_cache_provenance(
    provenance: LoaderCacheProvenance,
    property_name: String,
) -> Option<LoaderCacheProvenance> {
    match provenance.kind {
        LoaderCacheProvenanceKind::Cached => Some(LoaderCacheProvenance {
            is_material_value: property_name == "material"
                || provenance.terminal_property_name.as_deref() == Some("materials"),
            kind: LoaderCacheProvenanceKind::Cached,
            terminal_property_name: Some(property_name),
        }),
        LoaderCacheProvenanceKind::ShallowMaterialClone
            if SHALLOW_MATERIAL_CLONE_SHARED_TEXTURE_PROPERTY_NAMES
                .contains(&property_name.as_str()) =>
        {
            Some(LoaderCacheProvenance {
                is_material_value: false,
                kind: LoaderCacheProvenanceKind::Cached,
                terminal_property_name: Some(property_name),
            })
        }
        LoaderCacheProvenanceKind::ShallowClone
            if matches!(property_name.as_str(), "geometry" | "material") =>
        {
            Some(LoaderCacheProvenance {
                is_material_value: property_name == "material",
                kind: LoaderCacheProvenanceKind::Cached,
                terminal_property_name: Some(property_name),
            })
        }
        LoaderCacheProvenanceKind::ShallowClone
            if property_name == "children"
                || javascript_number_property_name_is_integer(&property_name) =>
        {
            Some(LoaderCacheProvenance {
                is_material_value: false,
                kind: LoaderCacheProvenanceKind::ShallowClone,
                terminal_property_name: Some(property_name),
            })
        }
        _ => None,
    }
}

fn javascript_number_property_name_is_integer(property_name: &str) -> bool {
    let property_name = property_name.trim();
    if property_name.is_empty() {
        return true;
    }
    let radix_number = [
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
        ("0x", 16),
        ("0X", 16),
    ]
    .iter()
    .find_map(|(prefix, radix)| {
        property_name
            .strip_prefix(prefix)
            .map(|digits| u128::from_str_radix(digits, *radix).is_ok())
    });
    if let Some(is_integer) = radix_number {
        return is_integer;
    }
    property_name
        .parse::<f64>()
        .is_ok_and(|number| number.is_finite() && number.fract() == 0.0)
}

fn is_cached_loader_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    module_api_path_matches(
        &call_expression.callee,
        &["useLoader"],
        &[
            "@react-three/fiber",
            "@react-three/fiber/legacy",
            "@react-three/fiber/native",
            "@react-three/fiber/webgpu",
            "react-three-fiber",
        ],
        false,
        ctx,
    ) || DREI_CACHED_LOADER_HOOK_NAMES.iter().any(|hook_name| {
        module_api_path_matches(
            &call_expression.callee,
            &[hook_name],
            &["@react-three/drei", "@react-three/drei/native"],
            false,
            ctx,
        )
    })
}

fn loader_cache_member_property_name(
    member_expression: &oxc_ast::ast::MemberExpression<'_>,
) -> Option<String> {
    if let Some(property_name) = member_expression.static_property_name() {
        return Some(property_name.to_string());
    }
    let oxc_ast::ast::MemberExpression::ComputedMemberExpression(member_expression) =
        member_expression
    else {
        return None;
    };
    let oxc_ast::ast::Expression::NumericLiteral(number) =
        member_expression.expression.get_inner_expression()
    else {
        return None;
    };
    (number.value.is_finite() && number.value.fract() == 0.0)
        .then(|| format_javascript_number(number.value))
}

fn loader_cache_callback_source<'a, 'b>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b oxc_ast::ast::Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let callback_node = ctx.nodes().ancestors(declaration.id()).find(|candidate| {
        matches!(
            candidate.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        )
    })?;
    let first_parameter = match callback_node.kind() {
        oxc_ast::AstKind::Function(function) => function.params.items.first(),
        oxc_ast::AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    }?;
    if first_parameter
        .pattern
        .get_binding_identifier()
        .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    let parent = ctx.nodes().parent_node(callback_node.id());
    let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
        return None;
    };
    if call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_none_or(|argument| argument.span() != callback_node.span())
    {
        return None;
    }
    let member_expression = call_expression.callee.as_member_expression()?;
    if matches!(
        member_expression.static_property_name(),
        Some("traverse" | "traverseVisible")
    ) {
        return Some(member_expression.object());
    }
    if !matches!(
        member_expression.static_property_name(),
        Some("every" | "filter" | "find" | "findIndex" | "flatMap" | "forEach" | "map" | "some")
    ) {
        return None;
    }
    let oxc_ast::ast::Expression::CallExpression(values_call) =
        member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let Some(values_member_expression) = values_call.callee.as_member_expression() else {
        return None;
    };
    if values_member_expression.static_property_name() != Some("values")
        || !is_proven_global_namespace_reference(values_member_expression.object(), "Object", ctx)
    {
        return None;
    }
    values_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
}
