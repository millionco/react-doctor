use std::path::{Path, PathBuf};

use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttributeName, JSXAttributeValue, MemberExpression,
        ObjectExpression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const FIRST_BOX_SHADOW_REACT_NATIVE_MINOR: u32 = 76;
const IOS_SHADOW_KEYS: [&str; 4] = [
    "shadowColor",
    "shadowOffset",
    "shadowOpacity",
    "shadowRadius",
];
const LEGACY_SHADOW_STYLE_PROPERTIES: [&str; 5] = [
    "shadowColor",
    "shadowOffset",
    "shadowOpacity",
    "shadowRadius",
    "elevation",
];
const DYNAMIC_EXPO_CONFIG_FILENAMES: [&str; 4] = [
    "app.config.ts",
    "app.config.js",
    "app.config.cjs",
    "app.config.mjs",
];
const STATIC_EXPO_CONFIG_FILENAMES: [&str; 2] = ["app.config.json", "app.json"];

#[derive(Debug, Default, Clone)]
pub struct RnStylePreferBoxshadow;

declare_oxc_lint!(
    /// Prefer cross-platform boxShadow over platform-specific React Native shadow styles.
    RnStylePreferBoxshadow,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer cross-platform boxShadow over platform-specific shadow styles.",
);

impl Rule for RnStylePreferBoxshadow {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
            && !rn_box_shadow_is_legacy_arch_react_native_file(ctx.file_path())
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXAttribute(attribute) => {
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    return;
                };
                if attribute_name.name != "style" && !attribute_name.name.ends_with("Style") {
                    return;
                }
                let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                else {
                    return;
                };
                let Some(expression) = container.expression.as_expression() else {
                    return;
                };
                match expression {
                    Expression::ObjectExpression(object_expression) => {
                        rn_box_shadow_report_legacy_property(
                            object_expression,
                            &FxHashSet::default(),
                            ctx,
                        );
                    }
                    Expression::ArrayExpression(array_expression) => {
                        let mut sibling_key_names = FxHashSet::default();
                        for element in &array_expression.elements {
                            let Some(expression) = element.as_expression() else {
                                continue;
                            };
                            if let Expression::ObjectExpression(object_expression) = expression {
                                rn_box_shadow_collect_property_key_names(
                                    object_expression,
                                    &mut sibling_key_names,
                                );
                            } else if let Some(key_names) =
                                rn_box_shadow_resolve_style_sheet_member_keys(expression, ctx)
                            {
                                sibling_key_names.extend(key_names);
                            }
                        }
                        for element in &array_expression.elements {
                            let Some(Expression::ObjectExpression(object_expression)) =
                                element.as_expression()
                            else {
                                continue;
                            };
                            if rn_box_shadow_report_legacy_property(
                                object_expression,
                                &sibling_key_names,
                                ctx,
                            ) {
                                return;
                            }
                        }
                    }
                    _ => {}
                }
            }
            AstKind::CallExpression(call_expression) => {
                if !rn_box_shadow_is_style_sheet_create_call(call_expression) {
                    return;
                }
                let Some(Argument::ObjectExpression(styles_argument)) =
                    call_expression.arguments.first()
                else {
                    return;
                };
                for style_definition in &styles_argument.properties {
                    let ObjectPropertyKind::ObjectProperty(style_definition) = style_definition
                    else {
                        continue;
                    };
                    let Expression::ObjectExpression(object_expression) = &style_definition.value
                    else {
                        continue;
                    };
                    rn_box_shadow_report_legacy_property(
                        object_expression,
                        &FxHashSet::default(),
                        ctx,
                    );
                }
            }
            _ => {}
        }
    }
}

fn rn_box_shadow_collect_property_key_names(
    object_expression: &ObjectExpression<'_>,
    key_names: &mut FxHashSet<String>,
) {
    for property in &object_expression.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if let Some(key_name) = property_key_identifier_name(&property.key) {
            key_names.insert(key_name.to_string());
        }
    }
}

fn rn_box_shadow_report_legacy_property(
    object_expression: &ObjectExpression<'_>,
    sibling_key_names: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut own_key_names = FxHashSet::default();
    rn_box_shadow_collect_property_key_names(object_expression, &mut own_key_names);
    let has_elevation =
        own_key_names.contains("elevation") || sibling_key_names.contains("elevation");
    let has_ios_shadow = IOS_SHADOW_KEYS
        .iter()
        .any(|key_name| own_key_names.contains(*key_name) || sibling_key_names.contains(*key_name));
    if has_elevation && has_ios_shadow {
        return false;
    }
    for property in &object_expression.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key_name) = property_key_identifier_name(&property.key) else {
            continue;
        };
        if !LEGACY_SHADOW_STYLE_PROPERTIES.contains(&key_name) {
            continue;
        }
        if key_name == "elevation" && own_key_names.contains("zIndex") {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users on the other platform see no shadow when you use {key_name}."
            ))
            .with_label(property.span),
        );
        return true;
    }
    false
}

fn rn_box_shadow_is_style_sheet_create_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member_expression) = call.callee.as_member_expression() else {
        return false;
    };
    matches!(member_expression.object(), Expression::Identifier(identifier) if identifier.name == "StyleSheet")
        && member_expression_identifier_property_name(member_expression) == Some("create")
}

fn rn_box_shadow_resolve_style_sheet_member_keys<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<FxHashSet<String>> {
    let MemberExpression::StaticMemberExpression(member_expression) =
        expression.as_member_expression()?
    else {
        return None;
    };
    let Expression::Identifier(styles_identifier) = &member_expression.object else {
        return None;
    };
    let declaration_object =
        rn_box_shadow_resolve_styles_declaration_object(styles_identifier, ctx)?;
    for style_definition in &declaration_object.properties {
        let ObjectPropertyKind::ObjectProperty(style_definition) = style_definition else {
            continue;
        };
        if property_key_identifier_name(&style_definition.key)
            != Some(member_expression.property.name.as_str())
        {
            continue;
        }
        let Expression::ObjectExpression(style_object) = &style_definition.value else {
            return None;
        };
        let mut key_names = FxHashSet::default();
        rn_box_shadow_collect_property_key_names(style_object, &mut key_names);
        return Some(key_names);
    }
    None
}

fn rn_box_shadow_resolve_styles_declaration_object<'a>(
    styles_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    let initializer = rn_box_shadow_variable_initializer(styles_identifier, ctx)?;
    let Expression::CallExpression(styles_call) = initializer else {
        return None;
    };
    if rn_box_shadow_is_style_sheet_create_call(styles_call) {
        return match styles_call.arguments.first() {
            Some(Argument::ObjectExpression(object_expression)) => Some(object_expression),
            _ => None,
        };
    }
    let Expression::Identifier(factory_identifier) = &styles_call.callee else {
        return None;
    };
    let factory_initializer = rn_box_shadow_variable_initializer(factory_identifier, ctx)?;
    rn_box_shadow_style_factory_callback_object(factory_initializer)
}

fn rn_box_shadow_variable_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        .then_some(())?;
    declarator.init.as_ref()
}

fn rn_box_shadow_style_factory_callback_object<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    let Expression::CallExpression(factory_call) = expression else {
        return None;
    };
    let Expression::Identifier(callee) = &factory_call.callee else {
        return None;
    };
    if !matches!(
        callee.name.as_str(),
        "makeStyles" | "createStyles" | "makeUseStyles" | "createUseStyles"
    ) {
        return None;
    }
    let callback = factory_call
        .arguments
        .first()
        .and_then(Argument::as_expression)?;
    match callback {
        Expression::ObjectExpression(object_expression) => Some(object_expression),
        Expression::ArrowFunctionExpression(arrow_function) => {
            match arrow_function.get_expression()? {
                Expression::ObjectExpression(object_expression) => Some(object_expression),
                _ => None,
            }
        }
        _ => None,
    }
}

fn rn_box_shadow_is_legacy_arch_react_native_file(file_path: &Path) -> bool {
    if file_path.as_os_str().is_empty() {
        return false;
    }
    let Some(package_directory) = rn_box_shadow_nearest_package_directory(file_path) else {
        return false;
    };
    let Some(manifest_contents) =
        rn_box_shadow_read_text_file(&package_directory.join("package.json"))
    else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_contents) else {
        return false;
    };
    let Some(manifest) = manifest.as_object() else {
        return false;
    };
    if rn_box_shadow_declared_react_native_version(manifest)
        .and_then(rn_box_shadow_parse_react_native_minor)
        .is_some_and(|minor| minor < FIRST_BOX_SHADOW_REACT_NATIVE_MINOR)
    {
        return true;
    }
    rn_box_shadow_new_arch_disabled_in_gradle_properties(&package_directory)
        || rn_box_shadow_new_arch_disabled_in_static_expo_config(&package_directory)
}

fn rn_box_shadow_nearest_package_directory(file_path: &Path) -> Option<PathBuf> {
    let mut directory = file_path.parent()?;
    loop {
        if directory.join("package.json").is_file() {
            return Some(directory.to_path_buf());
        }
        directory = directory.parent()?;
    }
}

fn rn_box_shadow_read_text_file(file_path: &Path) -> Option<String> {
    std::fs::read(file_path)
        .ok()
        .map(|contents| String::from_utf8_lossy(&contents).into_owned())
}

fn rn_box_shadow_declared_react_native_version(
    manifest: &serde_json::Map<String, serde_json::Value>,
) -> Option<&str> {
    let dependency = manifest
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
        .and_then(|dependencies| dependencies.get("react-native"));
    let development_dependency = manifest
        .get("devDependencies")
        .and_then(serde_json::Value::as_object)
        .and_then(|dependencies| dependencies.get("react-native"));
    dependency
        .filter(|version| !version.is_null())
        .or(development_dependency)
        .and_then(serde_json::Value::as_str)
}

fn rn_box_shadow_parse_react_native_minor(version_spec: &str) -> Option<u32> {
    for (match_index, _) in version_spec.match_indices("0.") {
        if version_spec[..match_index]
            .chars()
            .next_back()
            .is_some_and(|character| character.is_ascii_digit() || character == '.')
        {
            continue;
        }
        let minor_digits = version_spec[match_index + 2..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>();
        if minor_digits.is_empty() {
            continue;
        }
        let significant_digits = minor_digits.trim_start_matches('0');
        if significant_digits.is_empty() {
            return Some(0);
        }
        if significant_digits.len() > 10 {
            return None;
        }
        return significant_digits.parse().ok();
    }
    None
}

fn rn_box_shadow_new_arch_disabled_in_gradle_properties(package_directory: &Path) -> bool {
    let Some(contents) =
        rn_box_shadow_read_text_file(&package_directory.join("android").join("gradle.properties"))
    else {
        return false;
    };
    contents.lines().any(|line| {
        line.split_once('=')
            .is_some_and(|(name, value)| name.trim() == "newArchEnabled" && value.trim() == "false")
    })
}

fn rn_box_shadow_new_arch_disabled_in_static_expo_config(package_directory: &Path) -> bool {
    if DYNAMIC_EXPO_CONFIG_FILENAMES
        .iter()
        .any(|filename| package_directory.join(filename).exists())
    {
        return false;
    }
    STATIC_EXPO_CONFIG_FILENAMES.iter().any(|filename| {
        rn_box_shadow_read_text_file(&package_directory.join(filename))
            .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
            .is_some_and(|config| {
                config
                    .get("expo")
                    .and_then(|expo| expo.get("newArchEnabled"))
                    == Some(&serde_json::Value::Bool(false))
            })
    })
}
