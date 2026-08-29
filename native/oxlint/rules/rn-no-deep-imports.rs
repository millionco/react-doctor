use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const PUBLIC_RN_ROOT_EXPORTS: [&str; 35] = [
    "View",
    "Text",
    "Image",
    "ImageBackground",
    "ScrollView",
    "FlatList",
    "SectionList",
    "VirtualizedList",
    "TextInput",
    "Pressable",
    "TouchableOpacity",
    "TouchableHighlight",
    "TouchableWithoutFeedback",
    "TouchableNativeFeedback",
    "Button",
    "Switch",
    "Modal",
    "ActivityIndicator",
    "RefreshControl",
    "KeyboardAvoidingView",
    "StyleSheet",
    "Alert",
    "Animated",
    "Platform",
    "Dimensions",
    "AppRegistry",
    "AppState",
    "Linking",
    "Appearance",
    "Keyboard",
    "StatusBar",
    "PixelRatio",
    "PanResponder",
    "BackHandler",
    "InteractionManager",
];

#[derive(Debug, Default, Clone)]
pub struct RnNoDeepImports;

declare_oxc_lint!(
    /// Disallow deprecated imports from React Native internals.
    RnNoDeepImports,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Deep import into react-native internals.",
);

impl Rule for RnNoDeepImports {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::ImportDeclaration(declaration) => {
                if !is_type_only_import(declaration) {
                    rn_deep_import_report(declaration.source.value.as_str(), declaration.span, ctx);
                }
            }
            AstKind::ExportFromDeclaration(declaration) => {
                if declaration.export_kind.is_type()
                    || (!declaration.specifiers.is_empty()
                        && declaration
                            .specifiers
                            .iter()
                            .all(|specifier| specifier.export_kind.is_type()))
                {
                    return;
                }
                rn_deep_import_report(declaration.source.value.as_str(), declaration.span, ctx);
            }
            AstKind::ExportAllDeclaration(declaration) => {
                if !declaration.export_kind.is_type() {
                    rn_deep_import_report(declaration.source.value.as_str(), declaration.span, ctx);
                }
            }
            _ => {}
        }
    }
}

fn rn_deep_import_report(source: &str, span: oxc_span::Span, ctx: &LintContext<'_>) {
    let Some(path) = source.strip_prefix("react-native/Libraries/") else {
        return;
    };
    let message = if path == "NewAppScreen" || path.starts_with("NewAppScreen/") {
        "`react-native/Libraries/NewAppScreen` was moved out of core in React Native 0.80; import from `@react-native/new-app-screen` instead.".to_string()
    } else {
        let Some(export_name) = path.rsplit('/').next() else {
            return;
        };
        if !PUBLIC_RN_ROOT_EXPORTS.contains(&export_name) {
            return;
        }
        format!(
            "Deep import from \"{source}\" is a deprecated React Native internal subpath (RFC 0894) and breaks on upgrade. Import from \"react-native\" instead."
        )
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(span));
}
