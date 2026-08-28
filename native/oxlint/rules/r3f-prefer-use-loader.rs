use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This Three.js loader runs imperatively in a React effect, bypassing R3F Suspense caching, deduplication, and parental error handling. Load the asset with useLoader under Suspense and an error boundary";
const REACT_EFFECT_API_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const REACT_RUNTIME_MODULES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];
const R3F_CONTEXT_HOOK_NAMES: [&str; 2] = ["useFrame", "useThree"];
const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const IMPERATIVE_LOADER_METHOD_NAMES: [&str; 2] = ["load", "loadAsync"];
const THREE_CORE_LOADER_NAMES: [&str; 10] = [
    "AnimationLoader",
    "AudioLoader",
    "BufferGeometryLoader",
    "CubeTextureLoader",
    "FileLoader",
    "ImageBitmapLoader",
    "ImageLoader",
    "MaterialLoader",
    "ObjectLoader",
    "TextureLoader",
];
const THREE_EXTENSION_LOADER_MODULES: [&str; 3] = [
    "three-stdlib",
    "three/addons/loaders/",
    "three/examples/jsm/loaders/",
];

#[derive(Debug, Default, Clone)]
pub struct R3FPreferUseLoader;

impl RuleMeta for R3FPreferUseLoader {
    const NAME: &'static str = "r3f-prefer-use-loader";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Prefer R3F useLoader over imperative Three.js loading in effects.",
    };
}

impl Rule for R3FPreferUseLoader {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_r3f_runtime_import(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut owner_runs_inside_r3f_by_id = rustc_hash::FxHashMap::default();
        let mut reported_call_ids = rustc_hash::FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = node.kind() else {
                continue;
            };
            if !REACT_EFFECT_API_NAMES.iter().any(|api_name| {
                r3f_prefer_use_loader_react_api_call_matches(effect_call, api_name, &analysis, ctx)
            }) {
                continue;
            }
            let Some(owner_id) = local_callback_nearest_function_id(node.id(), ctx) else {
                continue;
            };
            let owner_runs_inside_r3f = owner_runs_inside_r3f_by_id
                .get(&owner_id)
                .copied()
                .unwrap_or_else(|| {
                    let result = r3f_prefer_use_loader_owner_runs_inside_r3f(
                        owner_id,
                        &node_index,
                        &analysis,
                        ctx,
                    );
                    owner_runs_inside_r3f_by_id.insert(owner_id, result);
                    result
                });
            if !owner_runs_inside_r3f {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    if reported_call_ids.contains(&candidate.id())
                        || !r3f_prefer_use_loader_is_imperative_loader_call(
                            candidate, &analysis, ctx,
                        )
                    {
                        return;
                    }
                    reported_call_ids.insert(candidate.id());
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.span()));
                },
            );
        }
    }
}

fn r3f_prefer_use_loader_react_api_call_matches<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    api_name: &str,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let direct_react_match = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
        .is_some()
        && is_react_api_call(call_expression, api_name, ctx)
        && !r3f_prefer_use_loader_is_global_react_namespace_call(call_expression, ctx);
    direct_react_match
        || module_api_reference_matches(
            &call_expression.callee,
            api_name,
            &REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
        || type_import_module_api_reference_matches(
            &call_expression.callee,
            api_name,
            &REACT_RUNTIME_MODULES,
            analysis,
            ctx,
        )
}

fn r3f_prefer_use_loader_is_global_react_namespace_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    matches!(
        member_expression.object().get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "React"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn r3f_prefer_use_loader_owner_runs_inside_r3f<'a>(
    owner_id: oxc_semantic::NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    for &candidate_id in node_index.node_ids(owner_id) {
        let candidate = ctx.nodes().get_node(candidate_id);
        if r3f_prefer_use_loader_is_inside_canvas(candidate, owner_id, ctx) {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression)
                if R3F_CONTEXT_HOOK_NAMES.iter().any(|hook_name| {
                    module_api_reference_matches(
                        &call_expression.callee,
                        hook_name,
                        &R3F_PUBLIC_MODULES,
                        analysis,
                        ctx,
                    ) || type_import_module_api_reference_matches(
                        &call_expression.callee,
                        hook_name,
                        &R3F_PUBLIC_MODULES,
                        analysis,
                        ctx,
                    )
                }) =>
            {
                return true;
            }
            AstKind::JSXOpeningElement(opening_element)
                if is_r3f_host_intrinsic(opening_element, ctx) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn r3f_prefer_use_loader_is_inside_canvas(
    node: &crate::AstNode<'_>,
    owner_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == owner_id {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::JSXElement(element) if is_r3f_canvas(&element.opening_element, ctx)
        ) {
            return true;
        }
    }
    false
}

fn r3f_prefer_use_loader_is_imperative_loader_call<'a>(
    node: &crate::AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::CallExpression(call_expression) = node.kind() else {
        return false;
    };
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    static_member_expression_property_name(member_expression)
        .is_some_and(|method_name| IMPERATIVE_LOADER_METHOD_NAMES.contains(&method_name))
        && r3f_prefer_use_loader_resolves_to_known_loader_instance(
            member_expression.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
}

fn r3f_prefer_use_loader_resolves_to_known_loader_instance<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        return r3f_prefer_use_loader_is_known_loader_constructor(
            &new_expression.callee,
            analysis,
            ctx,
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        r3f_prefer_use_loader_resolves_to_known_loader_instance(
            initializer,
            analysis,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn r3f_prefer_use_loader_is_known_loader_constructor<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(api_name) = r3f_prefer_use_loader_api_name_candidate(expression, ctx, &mut Vec::new())
    else {
        return false;
    };
    (THREE_CORE_LOADER_NAMES.contains(&api_name.as_str())
        && (module_api_reference_matches(expression, &api_name, &["three"], analysis, ctx)
            || type_import_module_api_reference_matches(
                expression,
                &api_name,
                &["three"],
                analysis,
                ctx,
            )))
        || (api_name.ends_with("Loader")
            && (module_api_reference_matches(
                expression,
                &api_name,
                &THREE_EXTENSION_LOADER_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                expression,
                &api_name,
                &THREE_EXTENSION_LOADER_MODULES,
                analysis,
                ctx,
            )))
}

fn r3f_prefer_use_loader_api_name_candidate<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return static_member_expression_property_name(member_expression).map(ToString::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return matches!(
            &qualified_name.left,
            oxc_ast::ast::TSTypeName::IdentifierReference(_)
        )
        .then(|| qualified_name.right.name.to_string());
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
            .is_some_and(|binding_identifier| binding_identifier.symbol_id() == symbol_id)
        {
            return r3f_prefer_use_loader_api_name_candidate(
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
