use oxc_ast::{
    AstKind,
    ast::{
        Expression, FormalParameter, IdentifierReference, JSXAttributeName, JSXAttributeValue,
        JSXElementName, TSSignature, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "This child redraws every render because the prop gets brand new JSX each time.";

const KNOWN_SLOT_PROP_NAMES: &[&str] = &[
    "icon",
    "Icon",
    "iconLeft",
    "iconRight",
    "leftIcon",
    "rightIcon",
    "startIcon",
    "endIcon",
    "prefixIcon",
    "suffixIcon",
    "iconBefore",
    "iconAfter",
    "prefix",
    "suffix",
    "separator",
    "divider",
    "indicator",
    "decoration",
    "before",
    "after",
    "header",
    "footer",
    "title",
    "subtitle",
    "description",
    "caption",
    "label",
    "labelExtra",
    "tooltip",
    "trigger",
    "triggerContent",
    "content",
    "body",
    "action",
    "actions",
    "controls",
    "placeholder",
    "endAdornment",
    "startAdornment",
    "leftSection",
    "rightSection",
    "addonBefore",
    "addonAfter",
    "selectButton",
    "badge",
    "message",
    "info",
    "infoMessage",
    "help",
    "helpText",
    "helpTooltip",
    "avatar",
    "preview",
    "adornment",
    "callToAction",
    "extraControls",
    "contextualText",
    "topHeading",
    "topContent",
    "bottomContent",
    "leftContent",
    "rightContent",
    "config",
    "value",
    "currentValue",
    "form",
    "text",
    "count",
    "modal",
    "rightOptions",
    "leftOptions",
    "titleHelper",
    "inputDisplay",
    "outputDisplay",
    "animatedSvg",
    "Status",
    "additionalEmptyState",
    "left",
    "right",
    "top",
    "bottom",
    "start",
    "end",
    "aside",
    "details",
    "extra",
    "overlay",
    "emptyState",
    "element",
    "fallback",
    "fallbackRender",
    "FallbackComponent",
    "ErrorFallback",
    "loadingFallback",
    "loader",
    "errorElement",
    "render",
    "renderItem",
    "renderRow",
    "renderCell",
    "renderEmpty",
    "renderError",
    "renderLoading",
    "renderHeader",
    "renderFooter",
    "renderItemActions",
    "renderName",
    "renderContent",
    "renderTrigger",
    "renderOption",
    "button",
    "primaryButton",
    "secondaryButton",
    "tertiaryButton",
    "leftButton",
    "rightButton",
    "submitButton",
    "cancelButton",
    "closeButton",
    "actionButton",
    "ctaButton",
    "menuButton",
    "iconButton",
    "dialog",
    "drawer",
    "popover",
    "sheet",
    "menu",
    "submenu",
    "dropdown",
    "dropdownContent",
    "dropdownComponents",
    "toolbar",
    "toolbarContent",
    "navigation",
    "breadcrumbs",
    "sidebar",
    "topBar",
    "bottomBar",
    "container",
    "wrapper",
    "main",
    "section",
    "panel",
    "card",
    "tile",
    "row",
    "column",
    "cell",
    "item",
    "items",
    "list",
    "table",
    "tableHeader",
    "tableFooter",
    "input",
    "inputElement",
    "select",
    "checkbox",
    "radio",
    "switch",
    "field",
    "fieldset",
    "legend",
    "control",
    "controlPanel",
    "image",
    "img",
    "thumbnail",
    "logo",
    "media",
    "cover",
    "banner",
    "hero",
];

const SLOT_PROP_SUFFIXES: &[&str] = &[
    "Button",
    "Buttons",
    "Icon",
    "Icons",
    "Component",
    "Components",
    "Element",
    "Elements",
    "Slot",
    "Slots",
    "Content",
    "Contents",
    "Renderer",
    "Trigger",
    "Header",
    "Footer",
    "Badge",
    "Label",
    "Tooltip",
    "Indicator",
    "Adornment",
    "Section",
    "Panel",
    "Overlay",
    "Shape",
    "Avatar",
    "Text",
    "State",
    "Zone",
    "Override",
    "Overrides",
    "Items",
    "Item",
    "Action",
    "Actions",
    "Controls",
    "Message",
    "Heading",
    "Details",
    "Preview",
    "Info",
    "Children",
];

#[derive(Debug, Default, Clone)]
pub struct JsxNoJsxAsProp;

declare_oxc_lint!(
    /// Disallow JSX allocated while rendering memoized component props.
    JsxNoJsxAsProp,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow JSX as a prop.",
);

impl Rule for JsxNoJsxAsProp {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let curated = should_use_curated_port_behavior(ctx);
        let memoized_component_names = if curated {
            jsx_no_jsx_as_prop_memoized_component_names(ctx)
        } else {
            FxHashSet::default()
        };
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let AstKind::JSXOpeningElement(opening_element) =
                ctx.nodes().parent_node(node.id()).kind()
            else {
                continue;
            };
            if jsx_no_jsx_as_prop_skip_native(attribute, &opening_element.name, curated, ctx)
                || (curated
                    && !jsx_no_jsx_as_prop_memoized_consumer(
                        &opening_element.name,
                        &memoized_component_names,
                        ctx,
                    ))
                || crate::ast_util::get_enclosing_function(node, ctx).is_none()
            {
                continue;
            }
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if curated
                && (jsx_no_jsx_as_prop_is_slot_name(attribute_name.name.as_str())
                    || jsx_no_jsx_as_prop_is_typed_slot(
                        &opening_element.name,
                        attribute_name.name.as_str(),
                        ctx,
                    ))
            {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if jsx_no_jsx_as_prop_expression(expression)
                || jsx_no_jsx_as_prop_render_local_binding(expression, ctx)
            {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !(should_use_curated_port_behavior_host(ctx) && is_non_production_file(ctx))
    }
}

fn jsx_no_jsx_as_prop_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::LogicalExpression(logical_expression) => {
            jsx_no_jsx_as_prop_expression(&logical_expression.left)
                || jsx_no_jsx_as_prop_expression(&logical_expression.right)
        }
        Expression::ConditionalExpression(conditional_expression) => {
            jsx_no_jsx_as_prop_expression(&conditional_expression.consequent)
                || jsx_no_jsx_as_prop_expression(&conditional_expression.alternate)
        }
        _ => false,
    }
}

fn jsx_no_jsx_as_prop_render_local_binding<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .init
        .as_ref()
        .is_some_and(jsx_no_jsx_as_prop_expression)
}

fn jsx_no_jsx_as_prop_memoized_consumer<'a>(
    name: &JSXElementName<'a>,
    memoized_component_names: &FxHashSet<&str>,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = name else {
        return false;
    };
    memoized_component_names.contains(identifier.name.as_str())
        && !jsx_no_jsx_as_prop_has_custom_memo_comparator(identifier, ctx)
}

fn jsx_no_jsx_as_prop_memoized_component_names<'a>(ctx: &LintContext<'a>) -> FxHashSet<&'a str> {
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                return None;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                return None;
            };
            (is_program_owned_variable_declarator(binding.symbol_id(), ctx)
                && declarator
                    .init
                    .as_ref()
                    .is_some_and(jsx_no_jsx_as_prop_is_memoizing_call))
            .then_some(binding.name.as_str())
        })
        .collect()
}

fn jsx_no_jsx_as_prop_is_memoizing_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return false;
    };
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => matches!(
            identifier.name.as_str(),
            "memo" | "observer" | "observable" | "withTracking"
        ),
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "memo"
                && matches!(member_expression.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    }
}

fn jsx_no_jsx_as_prop_has_custom_memo_comparator<'a>(
    identifier: &IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(initializer) = identifier_initializer(identifier, ctx) else {
        return false;
    };
    let Expression::CallExpression(call_expression) = initializer.get_inner_expression() else {
        return false;
    };
    let is_memo_call = match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "memo",
        Expression::StaticMemberExpression(member_expression) => {
            member_expression.property.name == "memo"
                && matches!(member_expression.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    };
    if !is_memo_call {
        return false;
    }
    call_expression.arguments.get(1).is_some_and(|argument| {
        !argument.as_expression().is_some_and(|expression| {
            matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "undefined"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                || imported_module_api_matches(expression, "shallowEqual", "react-redux", ctx)
        })
    })
}

fn jsx_no_jsx_as_prop_skip_native(
    attribute: &oxc_ast::ast::JSXAttribute<'_>,
    name: &JSXElementName<'_>,
    curated: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let JSXElementName::Identifier(identifier) = name else {
        return false;
    };
    if !identifier
        .name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_lowercase)
    {
        return false;
    }
    if curated {
        return true;
    }
    let Some(allow_list) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxNoJsxAsProp"))
        .and_then(|settings| settings.get("nativeAllowList"))
    else {
        return false;
    };
    if allow_list.as_str() == Some("all") {
        return true;
    }
    let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return false;
    };
    allow_list.as_array().is_some_and(|names| {
        names
            .iter()
            .filter_map(serde_json::Value::as_str)
            .any(|name| name.eq_ignore_ascii_case(attribute_name.name.as_str()))
    })
}

fn jsx_no_jsx_as_prop_is_slot_name(name: &str) -> bool {
    if KNOWN_SLOT_PROP_NAMES.contains(&name) {
        return true;
    }
    let mut characters = name.chars();
    let Some(first_character) = characters.next() else {
        return false;
    };
    if first_character.is_ascii_uppercase() {
        let mut decapitalized = first_character.to_ascii_lowercase().to_string();
        decapitalized.extend(characters);
        if KNOWN_SLOT_PROP_NAMES.contains(&decapitalized.as_str()) {
            return true;
        }
    }
    SLOT_PROP_SUFFIXES
        .iter()
        .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
}

fn jsx_no_jsx_as_prop_is_typed_slot<'a>(
    opening_name: &JSXElementName<'a>,
    attribute_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = opening_name else {
        return false;
    };
    let Some(initializer) = identifier_initializer(identifier, ctx) else {
        return false;
    };
    if jsx_no_jsx_as_prop_component_parameter(initializer, ctx, 0)
        .and_then(|parameter| parameter.type_annotation.as_ref())
        .is_some_and(|annotation| {
            jsx_no_jsx_as_prop_type_has_slot(&annotation.type_annotation, attribute_name, ctx, 0)
        })
    {
        return true;
    }
    let Expression::CallExpression(call_expression) = initializer.get_inner_expression() else {
        return false;
    };
    call_expression
        .type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
        .is_some_and(|type_argument| {
            jsx_no_jsx_as_prop_type_has_slot(type_argument, attribute_name, ctx, 0)
        })
}

fn jsx_no_jsx_as_prop_component_parameter<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> Option<&'a FormalParameter<'a>> {
    if depth > 8 {
        return None;
    }
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.params.items.first(),
        Expression::FunctionExpression(function) => function.params.items.first(),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => function.params.items.first(),
                AstKind::VariableDeclarator(declarator) => {
                    let AstKind::VariableDeclaration(variable_declaration) =
                        ctx.nodes().parent_node(declaration.id()).kind()
                    else {
                        return None;
                    };
                    variable_declaration.kind.is_const().then_some(())?;
                    declarator.init.as_ref().and_then(|initializer| {
                        jsx_no_jsx_as_prop_component_parameter(initializer, ctx, depth + 1)
                    })
                }
                _ => None,
            }
        }
        Expression::CallExpression(call_expression)
            if jsx_no_jsx_as_prop_is_react_hoc_call(call_expression) =>
        {
            call_expression
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
                .and_then(|component| {
                    jsx_no_jsx_as_prop_component_parameter(component, ctx, depth + 1)
                })
        }
        _ => None,
    }
}

fn jsx_no_jsx_as_prop_is_react_hoc_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "memo" | "forwardRef")
        }
        Expression::StaticMemberExpression(member_expression) => {
            matches!(
                member_expression.property.name.as_str(),
                "memo" | "forwardRef"
            ) && matches!(member_expression.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    }
}

fn jsx_no_jsx_as_prop_type_has_slot<'a>(
    type_node: &'a TSType<'a>,
    attribute_name: &str,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 8 {
        return false;
    }
    match type_node {
        TSType::TSTypeLiteral(type_literal) => {
            jsx_no_jsx_as_prop_members_have_slot(&type_literal.members, attribute_name, ctx, depth)
        }
        TSType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .any(|member| jsx_no_jsx_as_prop_type_has_slot(member, attribute_name, ctx, depth + 1)),
        TSType::TSTypeReference(reference) => {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            match ctx.symbol_declaration(symbol_id).kind() {
                AstKind::TSInterfaceDeclaration(interface) => jsx_no_jsx_as_prop_members_have_slot(
                    &interface.body.body,
                    attribute_name,
                    ctx,
                    depth + 1,
                ),
                AstKind::TSTypeAliasDeclaration(alias) => jsx_no_jsx_as_prop_type_has_slot(
                    &alias.type_annotation,
                    attribute_name,
                    ctx,
                    depth + 1,
                ),
                _ => false,
            }
        }
        _ => false,
    }
}

fn jsx_no_jsx_as_prop_members_have_slot<'a>(
    members: &'a [TSSignature<'a>],
    attribute_name: &str,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    members.iter().any(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return false;
        };
        !property.computed
            && property.key.static_name().as_deref() == Some(attribute_name)
            && property.type_annotation.as_ref().is_some_and(|annotation| {
                jsx_no_jsx_as_prop_is_react_slot_type(&annotation.type_annotation, ctx, depth + 1)
            })
    })
}

fn jsx_no_jsx_as_prop_is_react_slot_type<'a>(
    type_node: &'a TSType<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 8 {
        return false;
    }
    match type_node {
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .any(|member| jsx_no_jsx_as_prop_is_react_slot_type(member, ctx, depth + 1)),
        TSType::TSTypeReference(reference) => {
            jsx_no_jsx_as_prop_type_name_is_react_slot(&reference.type_name, ctx, depth + 1)
        }
        _ => false,
    }
}

fn jsx_no_jsx_as_prop_type_name_is_react_slot<'a>(
    type_name: &'a TSTypeName<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    match type_name {
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if jsx_no_jsx_as_prop_type_import(identifier, ctx).is_some_and(|entry| {
                entry.module_request.name() == "react"
                    && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported)
                        if matches!(imported.name(), "ReactNode" | "ReactElement"))
            }) {
                return true;
            }
            matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::TSTypeAliasDeclaration(alias)
                    if jsx_no_jsx_as_prop_is_react_slot_type(
                        &alias.type_annotation,
                        ctx,
                        depth + 1,
                    )
            )
        }
        TSTypeName::QualifiedName(qualified_name) => {
            if matches!(
                qualified_name.right.name.as_str(),
                "ReactNode" | "ReactElement"
            ) {
                let TSTypeName::IdentifierReference(namespace) = &qualified_name.left else {
                    return false;
                };
                return jsx_no_jsx_as_prop_type_import(namespace, ctx).is_some_and(|entry| {
                    entry.module_request.name() == "react"
                        && matches!(
                            entry.import_name,
                            crate::module_record::ImportImportName::Default(_)
                                | crate::module_record::ImportImportName::NamespaceObject
                        )
                });
            }
            if qualified_name.right.name != "Element" {
                return false;
            }
            match &qualified_name.left {
                TSTypeName::IdentifierReference(namespace) => {
                    if namespace.name == "JSX" {
                        return ctx
                            .scoping()
                            .get_reference(namespace.reference_id())
                            .symbol_id()
                            .is_none()
                            || jsx_no_jsx_as_prop_type_import(namespace, ctx).is_some_and(|entry| {
                                entry.module_request.name() == "react"
                                    && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported) if imported.name() == "JSX")
                            });
                    }
                    false
                }
                TSTypeName::QualifiedName(react_jsx) if react_jsx.right.name == "JSX" => {
                    let TSTypeName::IdentifierReference(namespace) = &react_jsx.left else {
                        return false;
                    };
                    jsx_no_jsx_as_prop_type_import(namespace, ctx).is_some_and(|entry| {
                        entry.module_request.name() == "react"
                            && matches!(
                                entry.import_name,
                                crate::module_record::ImportImportName::Default(_)
                                    | crate::module_record::ImportImportName::NamespaceObject
                            )
                    })
                }
                _ => false,
            }
        }
        TSTypeName::ThisExpression(_) => false,
    }
}

fn jsx_no_jsx_as_prop_type_import<'a, 'b>(
    identifier: &IdentifierReference<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b crate::module_record::ImportEntry> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    ctx.module_record().import_entries.iter().find(|entry| {
        ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
    })
}
