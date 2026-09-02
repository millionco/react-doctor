use std::path::Path;

use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, ImportDeclarationSpecifier, JSXElementName, MemberExpression,
        ObjectExpression, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::Span;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXPO_MANAGED_DEPENDENCY_NAMES: [&str; 5] = [
    "expo",
    "expo-router",
    "@expo/cli",
    "@expo/metro-config",
    "@expo/metro-runtime",
];
const REACT_NATIVE_DEPENDENCY_NAMES: [&str; 4] = [
    "react-native",
    "react-native-tvos",
    "react-native-windows",
    "react-native-macos",
];
const WEB_FRAMEWORK_DEPENDENCY_NAMES: [&str; 17] = [
    "next",
    "vite",
    "react-scripts",
    "gatsby",
    "@remix-run/react",
    "@remix-run/node",
    "@docusaurus/core",
    "@docusaurus/preset-classic",
    "@storybook/react",
    "@storybook/react-vite",
    "@storybook/react-webpack5",
    "@storybook/nextjs",
    "@storybook/web-components",
    "storybook",
    "react-dom",
    "@vitejs/plugin-react",
    "@vitejs/plugin-react-swc",
];
const MEMBER_PATH_FAN_OUT_LIMIT: usize = 32;

#[derive(Debug, Default, Clone)]
pub struct RnPreferExpoImage;

declare_oxc_lint!(
    /// Prefer expo-image over React Native Image for remotely loaded images.
    RnPreferExpoImage,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer expo-image over React Native Image for remotely loaded images.",
);

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExpoImagePackagePlatform {
    Expo,
    ReactNative,
    Web,
    Neutral,
    Unknown,
}

struct ExpoImageImport {
    local_name: String,
    imported_name: String,
    span: Span,
}

enum ExpoImageMemberPathStep {
    Static(String),
    Dynamic,
}

impl Rule for RnPreferExpoImage {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && expo_image_is_managed_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut flagged_imports = Vec::new();
        let mut asset_binding_names = rustc_hash::FxHashSet::default();
        let mut module_object_literals = rustc_hash::FxHashMap::default();
        let mut source_expressions_by_local_name = rustc_hash::FxHashMap::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::ImportDeclaration(import_declaration) => {
                    let source = import_declaration.source.value.as_str();
                    if expo_image_is_bundled_asset_source(source) {
                        for specifier in import_declaration.specifiers.iter().flatten() {
                            if let ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) =
                                specifier
                            {
                                asset_binding_names.insert(specifier.local.name.to_string());
                            }
                        }
                        continue;
                    }
                    if source != "react-native" || is_type_only_import(import_declaration) {
                        continue;
                    }
                    for specifier in import_declaration.specifiers.iter().flatten() {
                        let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                        else {
                            continue;
                        };
                        if specifier.import_kind.is_type() {
                            continue;
                        }
                        let imported_name = specifier.imported.name();
                        if !matches!(imported_name.as_str(), "Image" | "ImageBackground") {
                            continue;
                        }
                        flagged_imports.push(ExpoImageImport {
                            local_name: specifier.local.name.to_string(),
                            imported_name: imported_name.to_string(),
                            span: specifier.span,
                        });
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let Some(binding) = declarator.id.get_binding_identifier() else {
                        continue;
                    };
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    if expo_image_is_require_of_bundled_asset(initializer) {
                        asset_binding_names.insert(binding.name.to_string());
                    } else if let Expression::ObjectExpression(object_expression) = initializer
                        && !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                            matches!(
                                ancestor.kind(),
                                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                            )
                        })
                    {
                        module_object_literals
                            .insert(binding.name.to_string(), object_expression.node_id.get());
                    }
                }
                AstKind::JSXOpeningElement(opening_element) => {
                    let JSXElementName::Identifier(identifier) = &opening_element.name else {
                        continue;
                    };
                    let source_expression = find_jsx_attribute(opening_element, "source")
                        .and_then(jsx_attribute_expression);
                    source_expressions_by_local_name
                        .entry(identifier.name.to_string())
                        .or_insert_with(Vec::new)
                        .push(source_expression);
                }
                _ => {}
            }
        }

        for flagged_import in flagged_imports {
            if source_expressions_by_local_name
                .get(&flagged_import.local_name)
                .is_some_and(|source_expressions| {
                    source_expressions.iter().all(|source_expression| {
                        source_expression.is_some_and(|expression| {
                            expo_image_is_static_asset_expression(
                                expression,
                                &asset_binding_names,
                                &module_object_literals,
                                ctx,
                            )
                        })
                    })
                })
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users watch images reload often because {} from react-native has no caching.",
                    flagged_import.imported_name
                ))
                .with_label(flagged_import.span),
            );
        }
    }
}

fn expo_image_is_managed_file_active(ctx: &ContextHost<'_>) -> bool {
    let normalized_file_path = ctx.file_path().to_string_lossy().replace('\\', "/");
    let package_platform = if normalized_file_path.is_empty() {
        ExpoImagePackagePlatform::Unknown
    } else {
        expo_image_nearest_package_platform(Path::new(&normalized_file_path))
    };
    match package_platform {
        ExpoImagePackagePlatform::Expo => true,
        ExpoImagePackagePlatform::ReactNative | ExpoImagePackagePlatform::Web => false,
        ExpoImagePackagePlatform::Neutral | ExpoImagePackagePlatform::Unknown => matches!(
            react_doctor_framework_setting_from_json(ctx.settings().json.as_ref()),
            Some("expo")
        ),
    }
}

fn expo_image_nearest_package_platform(file_path: &Path) -> ExpoImagePackagePlatform {
    let Some(mut directory) = file_path.parent() else {
        return ExpoImagePackagePlatform::Unknown;
    };
    loop {
        let package_json_path = directory.join("package.json");
        if package_json_path.is_file() {
            return expo_image_read_package_platform(&package_json_path);
        }
        let Some(parent_directory) = directory.parent() else {
            return ExpoImagePackagePlatform::Unknown;
        };
        directory = parent_directory;
    }
}

fn expo_image_read_package_platform(package_json_path: &Path) -> ExpoImagePackagePlatform {
    let Some(manifest) = std::fs::read_to_string(package_json_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|manifest| manifest.as_object().cloned())
    else {
        return ExpoImagePackagePlatform::Unknown;
    };
    let mut dependency_names = Vec::new();
    let mut declares_any_dependency = false;
    for section_name in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        match manifest.get(section_name) {
            Some(serde_json::Value::Object(dependencies)) => {
                declares_any_dependency |= !dependencies.is_empty();
                dependency_names.extend(dependencies.keys().map(String::as_str));
            }
            Some(serde_json::Value::Array(dependencies)) => {
                declares_any_dependency |= !dependencies.is_empty();
            }
            _ => {}
        }
    }
    if dependency_names
        .iter()
        .any(|dependency_name| EXPO_MANAGED_DEPENDENCY_NAMES.contains(dependency_name))
    {
        return ExpoImagePackagePlatform::Expo;
    }
    if manifest
        .get("react-native")
        .is_some_and(serde_json::Value::is_string)
        || dependency_names.iter().any(|dependency_name| {
            REACT_NATIVE_DEPENDENCY_NAMES.contains(dependency_name)
                || dependency_name.starts_with("@react-native/")
                || dependency_name.starts_with("@react-native-")
        })
    {
        return ExpoImagePackagePlatform::ReactNative;
    }
    if dependency_names
        .iter()
        .any(|dependency_name| WEB_FRAMEWORK_DEPENDENCY_NAMES.contains(dependency_name))
    {
        return ExpoImagePackagePlatform::Web;
    }
    if declares_any_dependency {
        ExpoImagePackagePlatform::Neutral
    } else {
        ExpoImagePackagePlatform::Unknown
    }
}

fn expo_image_is_bundled_asset_source(source: &str) -> bool {
    let source = source.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
        .iter()
        .any(|extension| source.ends_with(extension))
}

fn expo_image_is_require_of_bundled_asset(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    if !matches!(
        &call_expression.callee,
        Expression::Identifier(identifier) if identifier.name == "require"
    ) || call_expression.arguments.len() != 1
    {
        return false;
    }
    matches!(
        call_expression.arguments.first(),
        Some(Argument::StringLiteral(literal))
            if expo_image_is_bundled_asset_source(literal.value.as_str())
    )
}

fn expo_image_is_static_asset_expression<'a>(
    expression: &Expression<'a>,
    asset_binding_names: &rustc_hash::FxHashSet<String>,
    module_object_literals: &rustc_hash::FxHashMap<String, NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Expression::Identifier(identifier) = expression {
        return asset_binding_names.contains(identifier.name.as_str());
    }
    if expo_image_is_require_of_bundled_asset(expression) {
        return true;
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    let Some((root_name, path)) = expo_image_flatten_member_path(member_expression) else {
        return false;
    };
    let Some(object_id) = module_object_literals.get(root_name) else {
        return false;
    };
    let AstKind::ObjectExpression(object_expression) = ctx.nodes().get_node(*object_id).kind()
    else {
        return false;
    };
    let Some(candidates) = expo_image_resolve_member_candidates(object_expression, &path) else {
        return false;
    };
    candidates.iter().all(|candidate| {
        matches!(candidate, Expression::Identifier(identifier)
            if asset_binding_names.contains(identifier.name.as_str()))
            || expo_image_is_require_of_bundled_asset(candidate)
    })
}

fn expo_image_flatten_member_path<'a, 'b>(
    member_expression: &'b MemberExpression<'a>,
) -> Option<(&'b str, Vec<ExpoImageMemberPathStep>)> {
    let mut path = Vec::new();
    let mut cursor = member_expression;
    loop {
        match cursor {
            MemberExpression::StaticMemberExpression(member) => {
                path.push(ExpoImageMemberPathStep::Static(
                    member.property.name.to_string(),
                ));
                match &member.object {
                    Expression::Identifier(identifier) => {
                        path.reverse();
                        return Some((identifier.name.as_str(), path));
                    }
                    expression => cursor = expression.as_member_expression()?,
                }
            }
            MemberExpression::ComputedMemberExpression(member) => {
                path.push(match &member.expression {
                    Expression::StringLiteral(literal) => {
                        ExpoImageMemberPathStep::Static(literal.value.to_string())
                    }
                    _ => ExpoImageMemberPathStep::Dynamic,
                });
                match &member.object {
                    Expression::Identifier(identifier) => {
                        path.reverse();
                        return Some((identifier.name.as_str(), path));
                    }
                    expression => cursor = expression.as_member_expression()?,
                }
            }
            MemberExpression::PrivateFieldExpression(_) => return None,
        }
    }
}

fn expo_image_resolve_member_candidates<'a, 'b>(
    literal: &'b ObjectExpression<'a>,
    path: &[ExpoImageMemberPathStep],
) -> Option<Vec<&'b Expression<'a>>> {
    let mut candidates = vec![literal];
    let mut values = Vec::new();
    for (step_index, step) in path.iter().enumerate() {
        values.clear();
        for candidate in &candidates {
            for property in &candidate.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return None;
                };
                if property.computed {
                    return None;
                }
                let key_name = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => identifier.name.as_str(),
                    PropertyKey::Identifier(identifier) => identifier.name.as_str(),
                    PropertyKey::StringLiteral(literal) => literal.value.as_str(),
                    _ => return None,
                };
                if matches!(step, ExpoImageMemberPathStep::Dynamic)
                    || matches!(step, ExpoImageMemberPathStep::Static(expected) if expected == key_name)
                {
                    values.push(&property.value);
                }
            }
        }
        if values.is_empty() || values.len() > MEMBER_PATH_FAN_OUT_LIMIT {
            return None;
        }
        if step_index + 1 == path.len() {
            return Some(values);
        }
        candidates = values
            .iter()
            .map(|value| match value {
                Expression::ObjectExpression(object_expression) => Some(object_expression.as_ref()),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
    }
    None
}
