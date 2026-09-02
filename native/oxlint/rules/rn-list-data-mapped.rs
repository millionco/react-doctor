use oxc_ast::{
    AstKind,
    ast::{
        Argument, ChainElement, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXElementName, JSXMemberExpression, JSXMemberExpressionObject,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const RN_LIST_DATA_BUILTIN_NAMES: [&str; 3] = ["FlatList", "SectionList", "VirtualizedList"];
const RN_LIST_DATA_MODULE_SOURCES: [&str; 2] = ["react-native", "react-native-gesture-handler"];
const RN_LIST_DATA_FRESH_ARRAY_METHODS: [&str; 9] = [
    "map",
    "filter",
    "toSorted",
    "slice",
    "toReversed",
    "concat",
    "flat",
    "flatMap",
    "toSpliced",
];

#[derive(Debug, Default, Clone)]
pub struct RnListDataMapped;

declare_oxc_lint!(
    /// Warns when a React Native list receives a freshly allocated data array.
    RnListDataMapped,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when a React Native list receives a freshly allocated data array.",
);

impl Rule for RnListDataMapped {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let Some(element_name) = resolve_jsx_element_name(opening_element) else {
            return;
        };
        if !rn_list_data_is_virtualized_list(opening_element, element_name, ctx) {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if attribute_name.name != "data" {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if !rn_list_data_is_fresh_array_expression(expression) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users see every row redraw when <{element_name}> gets a new data array each render."
                ))
                .with_label(attribute.span),
            );
            return;
        }
    }
}

fn rn_list_data_is_virtualized_list<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    element_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    if rn_list_data_is_imported_recycler(opening_element, ctx) {
        return true;
    }
    if let JSXElementName::MemberExpression(member_expression) = &opening_element.name {
        if !RN_LIST_DATA_BUILTIN_NAMES.contains(&element_name) {
            return false;
        }
        let Some(root_name) = rn_list_data_jsx_member_root_name(member_expression) else {
            return false;
        };
        return rn_list_data_textual_import(root_name, ctx).map_or(true, |entry| {
            RN_LIST_DATA_MODULE_SOURCES.contains(&entry.module_request.name())
        });
    }
    if let Some(import_entry) = rn_list_data_textual_import(element_name, ctx) {
        let canonical_name = match &import_entry.import_name {
            ImportImportName::Name(imported_name) => imported_name.name(),
            ImportImportName::Default(_) => "default",
            ImportImportName::NamespaceObject => element_name,
        };
        return RN_LIST_DATA_MODULE_SOURCES.contains(&import_entry.module_request.name())
            && RN_LIST_DATA_BUILTIN_NAMES.contains(&canonical_name);
    }
    if !RN_LIST_DATA_BUILTIN_NAMES.contains(&element_name) {
        return false;
    }
    rn_list_data_is_local_react_native_list(opening_element, ctx)
}

fn rn_list_data_is_imported_recycler<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_imported_jsx_component_name(opening_element, "@shopify/flash-list", ctx)
        .is_some_and(|name| matches!(name, "FlashList" | "AnimatedFlashList"))
        || resolve_imported_jsx_component_name(opening_element, "@legendapp/list", ctx)
            .is_some_and(|name| name == "LegendList")
        || resolve_imported_jsx_component_name(opening_element, "@legendapp/list/react-native", ctx)
            .is_some_and(|name| name == "LegendList")
        || resolve_imported_jsx_component_name(opening_element, "@legendapp/list/animated", ctx)
            .is_some_and(|name| name == "AnimatedLegendList")
        || resolve_imported_jsx_component_name(opening_element, "@legendapp/list/reanimated", ctx)
            .is_some_and(|name| name == "AnimatedLegendList")
        || resolve_imported_jsx_component_name(opening_element, "@legendapp/list/keyboard", ctx)
            .is_some_and(|name| name == "KeyboardAwareLegendList")
        || resolve_imported_jsx_component_name(
            opening_element,
            "@legendapp/list/keyboard-legacy",
            ctx,
        )
        .is_some_and(|name| name == "KeyboardAvoidingLegendList")
}

fn rn_list_data_textual_import<'a, 'b>(
    local_name: &str,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    ctx.module_record()
        .import_entries
        .iter()
        .find(|entry| entry.local_name.name() == local_name)
}

fn rn_list_data_jsx_member_root_name<'a>(
    member_expression: &'a JSXMemberExpression<'a>,
) -> Option<&'a str> {
    match &member_expression.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        JSXMemberExpressionObject::MemberExpression(member_expression) => {
            rn_list_data_jsx_member_root_name(member_expression)
        }
        JSXMemberExpressionObject::ThisExpression(_) => None,
    }
}

fn rn_list_data_is_local_react_native_list<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = &opening_element.name else {
        return true;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return true;
    };
    rn_list_data_initializer_is_react_native(initializer, ctx)
}

fn rn_list_data_initializer_is_react_native<'a>(
    initializer: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if rn_list_data_require_module_source(initializer)
        .is_some_and(|source| RN_LIST_DATA_MODULE_SOURCES.contains(&source))
    {
        return true;
    }
    let Some(root_name) = rn_list_data_expression_root_identifier_name(initializer) else {
        return false;
    };
    rn_list_data_textual_import(root_name, ctx).is_some_and(|entry| {
        RN_LIST_DATA_MODULE_SOURCES.contains(&entry.module_request.name())
            && matches!(entry.import_name, ImportImportName::NamespaceObject)
    })
}

fn rn_list_data_require_module_source<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return rn_list_data_require_module_source(member_expression.object());
    }
    let call_expression = match expression {
        Expression::CallExpression(call_expression) => call_expression,
        Expression::ChainExpression(chain_expression) => {
            if let Some(member_expression) = chain_expression.expression.as_member_expression() {
                return rn_list_data_require_module_source(member_expression.object());
            }
            match &chain_expression.expression {
                ChainElement::CallExpression(call_expression) => call_expression,
                ChainElement::TSNonNullExpression(non_null_expression) => {
                    return rn_list_data_require_module_source(&non_null_expression.expression);
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    if !matches!(&call_expression.callee, Expression::Identifier(identifier) if identifier.name == "require")
    {
        return None;
    }
    match call_expression.arguments.first()? {
        Argument::StringLiteral(source) => Some(source.value.as_str()),
        _ => None,
    }
}

fn rn_list_data_expression_root_identifier_name<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return Some(identifier.name.as_str());
    }
    if let Expression::ChainExpression(chain_expression) = expression {
        if let Some(member_expression) = chain_expression.expression.as_member_expression() {
            return rn_list_data_expression_root_identifier_name(member_expression.object());
        }
        if let ChainElement::TSNonNullExpression(non_null_expression) = &chain_expression.expression
        {
            return rn_list_data_expression_root_identifier_name(&non_null_expression.expression);
        }
        return None;
    }
    expression
        .as_member_expression()
        .and_then(|member_expression| {
            rn_list_data_expression_root_identifier_name(member_expression.object())
        })
}

fn rn_list_data_is_fresh_array_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ArrayExpression(array) => !array.elements.is_empty(),
        Expression::CallExpression(call) => {
            if let Some(member_expression) = call.callee.as_member_expression() {
                let method_name = member_expression_identifier_property_name(member_expression);
                if method_name.is_some_and(|name| RN_LIST_DATA_FRESH_ARRAY_METHODS.contains(&name))
                {
                    return true;
                }
                if method_name == Some("from")
                    && matches!(member_expression.object(), Expression::Identifier(identifier) if identifier.name == "Array")
                {
                    return true;
                }
                return rn_list_data_is_fresh_array_expression(member_expression.object());
            }
            matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "Array")
        }
        _ => false,
    }
}
