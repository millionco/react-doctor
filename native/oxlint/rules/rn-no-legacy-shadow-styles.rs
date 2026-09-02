use std::path::{Path, PathBuf};

use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, JSXAttributeValue, ObjectExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const FIRST_BOX_SHADOW_REACT_NATIVE_MINOR: u32 = 76;
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
pub struct RnNoLegacyShadowStyles;

declare_oxc_lint!(
    /// Disallow legacy platform-specific React Native shadow styles.
    RnNoLegacyShadowStyles,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy platform-specific React Native shadow styles.",
);

impl Rule for RnNoLegacyShadowStyles {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
            && !rn_legacy_shadow_is_legacy_arch_react_native_file(ctx.file_path())
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
                        rn_legacy_shadow_report_properties(object_expression, ctx);
                    }
                    Expression::ArrayExpression(array_expression) => {
                        for element in &array_expression.elements {
                            let Some(Expression::ObjectExpression(object_expression)) =
                                element.as_expression()
                            else {
                                continue;
                            };
                            rn_legacy_shadow_report_properties(object_expression, ctx);
                        }
                    }
                    _ => {}
                }
            }
            AstKind::CallExpression(call_expression) => {
                let Some(member_expression) = call_expression.callee.as_member_expression() else {
                    return;
                };
                let Expression::Identifier(receiver) =
                    member_expression.object().get_inner_expression()
                else {
                    return;
                };
                if receiver.name != "StyleSheet"
                    || member_expression_identifier_property_name(member_expression)
                        != Some("create")
                {
                    return;
                }
                let Some(Expression::ObjectExpression(styles_argument)) = call_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
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
                    rn_legacy_shadow_report_properties(object_expression, ctx);
                }
            }
            _ => {}
        }
    }
}

fn rn_legacy_shadow_report_properties(
    object_expression: &ObjectExpression<'_>,
    ctx: &LintContext<'_>,
) {
    let legacy_property_names = object_expression
        .properties
        .iter()
        .filter_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            let property_name = property_key_identifier_name(&property.key)?;
            LEGACY_SHADOW_STYLE_PROPERTIES
                .contains(&property_name)
                .then_some(property_name)
        })
        .collect::<Vec<_>>();
    if legacy_property_names.is_empty() {
        return;
    }
    let quoted_property_names = legacy_property_names
        .iter()
        .map(|property_name| format!("\"{property_name}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let plural = if legacy_property_names.len() > 1 {
        "s"
    } else {
        ""
    };
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Shadow style{plural} {quoted_property_names} only work on one platform, so your users on the other see no shadow."
        ))
        .with_label(object_expression.span),
    );
}

fn rn_legacy_shadow_is_legacy_arch_react_native_file(file_path: &Path) -> bool {
    if file_path.as_os_str().is_empty() {
        return false;
    }
    let Some(package_directory) = rn_legacy_shadow_nearest_package_directory(file_path) else {
        return false;
    };
    let Some(manifest_contents) =
        rn_legacy_shadow_read_text_file(&package_directory.join("package.json"))
    else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_contents) else {
        return false;
    };
    let Some(manifest) = manifest.as_object() else {
        return false;
    };
    if rn_legacy_shadow_declared_react_native_version(manifest)
        .and_then(rn_legacy_shadow_parse_react_native_minor)
        .is_some_and(|minor| minor < FIRST_BOX_SHADOW_REACT_NATIVE_MINOR)
    {
        return true;
    }
    rn_legacy_shadow_new_arch_disabled_in_gradle_properties(&package_directory)
        || rn_legacy_shadow_new_arch_disabled_in_static_expo_config(&package_directory)
}

fn rn_legacy_shadow_nearest_package_directory(file_path: &Path) -> Option<PathBuf> {
    let mut directory = file_path.parent()?;
    loop {
        if directory.join("package.json").is_file() {
            return Some(directory.to_path_buf());
        }
        directory = directory.parent()?;
    }
}

fn rn_legacy_shadow_read_text_file(file_path: &Path) -> Option<String> {
    std::fs::read(file_path)
        .ok()
        .map(|contents| String::from_utf8_lossy(&contents).into_owned())
}

fn rn_legacy_shadow_declared_react_native_version(
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

fn rn_legacy_shadow_parse_react_native_minor(version_spec: &str) -> Option<u32> {
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

fn rn_legacy_shadow_new_arch_disabled_in_gradle_properties(package_directory: &Path) -> bool {
    let Some(contents) = rn_legacy_shadow_read_text_file(
        &package_directory.join("android").join("gradle.properties"),
    ) else {
        return false;
    };
    contents.lines().any(|line| {
        line.split_once('=')
            .is_some_and(|(name, value)| name.trim() == "newArchEnabled" && value.trim() == "false")
    })
}

fn rn_legacy_shadow_new_arch_disabled_in_static_expo_config(package_directory: &Path) -> bool {
    if DYNAMIC_EXPO_CONFIG_FILENAMES
        .iter()
        .any(|filename| package_directory.join(filename).exists())
    {
        return false;
    }
    STATIC_EXPO_CONFIG_FILENAMES.iter().any(|filename| {
        rn_legacy_shadow_read_text_file(&package_directory.join(filename))
            .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
            .is_some_and(|config| {
                config
                    .get("expo")
                    .and_then(|expo| expo.get("newArchEnabled"))
                    == Some(&serde_json::Value::Bool(false))
            })
    })
}
