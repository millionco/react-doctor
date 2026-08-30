use oxc_ast::{
    ast::{
        Expression, ImportDeclaration, ImportDeclarationSpecifier, JSXAttributeItem,
        JSXAttributeName, JSXAttributeValue, JSXElementName, ObjectPropertyKind, TSType,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str =
    "Your styles don't render because you passed the `style` prop a string instead of an object.";

#[derive(Debug, Default, Clone)]
pub struct StylePropObject;

declare_oxc_lint!(
    /// Require React DOM style props to be objects.
    StylePropObject,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require style prop values to be objects.",
);

impl Rule for StylePropObject {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if style_prop_is_solid_file(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXOpeningElement(opening) => {
                    if !matches!(
                        &opening.name,
                        JSXElementName::Identifier(_) | JSXElementName::IdentifierReference(_)
                    ) {
                        continue;
                    }
                    let Some((element_name, _)) = resolve_jsx_element_type(opening, ctx) else {
                        continue;
                    };
                    if style_prop_allowed(ctx, element_name)
                        || (should_use_curated_port_behavior(ctx)
                            && !element_name
                                .as_bytes()
                                .first()
                                .is_some_and(u8::is_ascii_lowercase))
                    {
                        continue;
                    }
                    for item in &opening.attributes {
                        let JSXAttributeItem::Attribute(attribute) = item else {
                            continue;
                        };
                        if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == "style")
                        {
                            continue;
                        }
                        let invalid = match &attribute.value {
                            Some(JSXAttributeValue::StringLiteral(_)) => {
                                ctx.diagnostic(
                                    OxcDiagnostic::warn(MESSAGE).with_label(attribute.span),
                                );
                                break;
                            }
                            Some(JSXAttributeValue::ExpressionContainer(container)) => container
                                .expression
                                .as_expression()
                                .is_some_and(|expression| {
                                    style_prop_invalid_expression(expression, ctx)
                                }),
                            _ => false,
                        };
                        if invalid {
                            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
                        }
                    }
                }
                AstKind::CallExpression(call) if is_create_element_call(call) => {
                    let Some(first_argument) =
                        call.arguments.first().and_then(|arg| arg.as_expression())
                    else {
                        continue;
                    };
                    let element_name = match first_argument.get_inner_expression() {
                        Expression::StringLiteral(value) => Some(value.value.as_str()),
                        Expression::Identifier(value) => Some(value.name.as_str()),
                        _ => None,
                    };
                    if element_name.is_some_and(|name| style_prop_allowed(ctx, name)) {
                        continue;
                    }
                    let Some(Expression::ObjectExpression(props)) = call
                        .arguments
                        .get(1)
                        .and_then(|arg| arg.as_expression())
                        .map(Expression::get_inner_expression)
                    else {
                        continue;
                    };
                    for property in &props.properties {
                        let ObjectPropertyKind::ObjectProperty(property) = property else {
                            continue;
                        };
                        if !property.computed
                            && property.key.static_name().as_deref() == Some("style")
                            && style_prop_invalid_expression(&property.value, ctx)
                        {
                            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property.span));
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn style_prop_invalid_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if style_prop_statically_invalid_expression(expression) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    if identifier.name == "undefined" {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    if let Some(initializer) = &declarator.init {
        return style_prop_statically_invalid_expression(initializer.get_inner_expression());
    }
    declarator
        .type_annotation
        .as_ref()
        .is_some_and(|annotation| {
            style_prop_classify_ts_type(&annotation.type_annotation)
                == StylePropTypeClassification::Primitive
        })
}

fn style_prop_statically_invalid_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::TemplateLiteral(_)
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StylePropTypeClassification {
    Object,
    Primitive,
    Unknown,
}

fn style_prop_classify_ts_type(type_node: &TSType<'_>) -> StylePropTypeClassification {
    match type_node {
        TSType::TSStringKeyword(_)
        | TSType::TSNumberKeyword(_)
        | TSType::TSBooleanKeyword(_)
        | TSType::TSBigIntKeyword(_)
        | TSType::TSSymbolKeyword(_) => StylePropTypeClassification::Primitive,
        TSType::TSObjectKeyword(_)
        | TSType::TSTypeLiteral(_)
        | TSType::TSTypeReference(_)
        | TSType::TSArrayType(_)
        | TSType::TSTupleType(_)
        | TSType::TSFunctionType(_)
        | TSType::TSNullKeyword(_)
        | TSType::TSUndefinedKeyword(_) => StylePropTypeClassification::Object,
        TSType::TSUnionType(union) => {
            let mut has_primitive = false;
            for member in &union.types {
                if matches!(
                    member,
                    TSType::TSUndefinedKeyword(_)
                        | TSType::TSNullKeyword(_)
                        | TSType::TSNeverKeyword(_)
                ) {
                    continue;
                }
                match style_prop_classify_ts_type(member) {
                    StylePropTypeClassification::Unknown => {
                        return StylePropTypeClassification::Unknown;
                    }
                    StylePropTypeClassification::Primitive => has_primitive = true,
                    StylePropTypeClassification::Object => {
                        return StylePropTypeClassification::Object;
                    }
                }
            }
            if has_primitive {
                StylePropTypeClassification::Primitive
            } else {
                StylePropTypeClassification::Unknown
            }
        }
        _ => StylePropTypeClassification::Unknown,
    }
}

fn style_prop_allowed(ctx: &LintContext<'_>, element_name: &str) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("stylePropObject"))
        .and_then(|settings| settings.get("allow"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|allowed| {
            allowed
                .iter()
                .any(|value| value.as_str() == Some(element_name))
        })
}

fn style_prop_is_solid_file(ctx: &LintContext<'_>) -> bool {
    let mut has_react_runtime = false;
    let mut has_solid_runtime = false;
    let mut has_solid_syntax_marker = false;
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::ImportDeclaration(declaration)
                if !style_prop_is_type_only_import(declaration) =>
            {
                let source = declaration.source.value.as_str();
                has_react_runtime |= style_prop_matches_package(source, "react")
                    || style_prop_matches_package(source, "react-dom");
                has_solid_runtime |= style_prop_matches_package(source, "solid-js");
            }
            AstKind::JSXOpeningElement(opening) => {
                has_solid_syntax_marker |= opening.attributes.iter().any(|item| {
                    let JSXAttributeItem::Attribute(attribute) = item else {
                        return false;
                    };
                    matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                        if identifier.name == "classList")
                        && matches!(&attribute.value,
                            Some(JSXAttributeValue::ExpressionContainer(container))
                                if matches!(container.expression.as_expression(), Some(Expression::ObjectExpression(_))))
                });
            }
            _ => {}
        }
    }
    !has_react_runtime && (has_solid_runtime || has_solid_syntax_marker)
}

fn style_prop_is_type_only_import(declaration: &ImportDeclaration<'_>) -> bool {
    if declaration.import_kind.is_type() {
        return true;
    }
    let Some(specifiers) = &declaration.specifiers else {
        return false;
    };
    !specifiers.is_empty()
        && specifiers.iter().all(|specifier| {
            matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(specifier)
                if specifier.import_kind.is_type())
        })
}

fn style_prop_matches_package(source: &str, package_name: &str) -> bool {
    source == package_name
        || source
            .strip_prefix(package_name)
            .is_some_and(|suffix| suffix.starts_with('/'))
}
