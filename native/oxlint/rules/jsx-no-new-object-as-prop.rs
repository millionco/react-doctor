use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeName, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::LogicalOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const JSX_NO_NEW_OBJECT_AS_PROP_MESSAGE: &str =
    "This child redraws every render because the prop gets a brand new object each time.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoNewObjectAsProp;

declare_oxc_lint!(
    /// Disallow objects allocated while rendering JSX props.
    JsxNoNewObjectAsProp,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow new objects as JSX props.",
);

impl Rule for JsxNoNewObjectAsProp {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let curated = should_use_curated_port_behavior(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let AstKind::JSXOpeningElement(opening) = ctx.nodes().parent_node(node.id()).kind()
            else {
                continue;
            };
            if jsx_no_new_object_skip_native(attribute, &opening.name, curated, ctx)
                || (curated && !jsx_no_new_object_memoized_consumer(&opening.name, ctx))
                || crate::ast_util::get_enclosing_function(node, ctx).is_none()
            {
                continue;
            }
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if curated && jsx_no_new_object_config_prop(attribute_name.name.as_str()) {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if jsx_no_new_object_expression(expression, curated)
                || jsx_no_new_object_render_local_binding(expression, curated, ctx)
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(JSX_NO_NEW_OBJECT_AS_PROP_MESSAGE)
                        .with_label(attribute.span),
                );
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !(should_use_curated_port_behavior_host(ctx) && is_non_production_file(ctx))
    }
}

fn jsx_no_new_object_expression(expression: &Expression<'_>, curated: bool) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_) => true,
        Expression::NewExpression(expression) => {
            matches!(expression.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
        }
        Expression::CallExpression(call) => match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => identifier.name == "Object",
            Expression::StaticMemberExpression(member) => {
                matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
                    && matches!(
                        member.property.name.as_str(),
                        "assign" | "create" | "fromEntries" | "groupBy" | "freeze" | "seal"
                    )
            }
            Expression::ComputedMemberExpression(member) => {
                matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
                    && matches!(&member.expression, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "assign" | "create" | "fromEntries" | "groupBy" | "freeze" | "seal"))
            }
            _ => false,
        },
        Expression::LogicalExpression(logical) => {
            if curated
                && matches!(
                    logical.operator,
                    LogicalOperator::Or | LogicalOperator::Coalesce
                )
            {
                let left_empty = jsx_no_new_object_is_empty(&logical.left);
                let right_empty = jsx_no_new_object_is_empty(&logical.right);
                if left_empty {
                    return jsx_no_new_object_expression(&logical.right, curated);
                }
                if right_empty {
                    return jsx_no_new_object_expression(&logical.left, curated);
                }
            }
            jsx_no_new_object_expression(&logical.left, curated)
                || jsx_no_new_object_expression(&logical.right, curated)
        }
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_object_expression(&conditional.consequent, curated)
                || jsx_no_new_object_expression(&conditional.alternate, curated)
        }
        _ => false,
    }
}

fn jsx_no_new_object_is_empty(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::ObjectExpression(object) if object.properties.is_empty())
}

fn jsx_no_new_object_render_local_binding<'a>(
    expression: &Expression<'a>,
    curated: bool,
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
    let initializer = match ctx.symbol_declaration(symbol_id).kind() {
        AstKind::VariableDeclarator(declarator) => jsx_no_new_object_binding_initializer(
            &declarator.id,
            declarator.init.as_ref(),
            symbol_id,
        ),
        AstKind::FormalParameter(parameter) => {
            jsx_no_new_object_binding_initializer(&parameter.pattern, None, symbol_id)
        }
        _ => None,
    };
    initializer.is_some_and(|initializer| jsx_no_new_object_expression(initializer, curated))
}

fn jsx_no_new_object_binding_initializer<'a>(
    pattern: &'a BindingPattern<'a>,
    declarator_initializer: Option<&'a Expression<'a>>,
    symbol_id: oxc_semantic::SymbolId,
) -> Option<&'a Expression<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id => {
            declarator_initializer
        }
        BindingPattern::AssignmentPattern(assignment)
            if binding_pattern_has_symbol(&assignment.left, symbol_id) =>
        {
            Some(&assignment.right)
        }
        BindingPattern::ObjectPattern(object) => object.properties.iter().find_map(|property| {
            jsx_no_new_object_binding_initializer(&property.value, None, symbol_id)
        }),
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .find_map(|element| jsx_no_new_object_binding_initializer(element, None, symbol_id)),
        _ => None,
    }
}

fn jsx_no_new_object_memoized_consumer<'a>(
    name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXElementName::IdentifierReference(identifier) = name else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !is_program_owned_variable_declarator(symbol_id, ctx) {
        return false;
    }
    let Some(initializer) = identifier_initializer(identifier, ctx) else {
        return false;
    };
    let Expression::CallExpression(call) = initializer.get_inner_expression() else {
        return false;
    };
    let callee = call.callee.get_inner_expression();
    let memoized = match callee {
        Expression::Identifier(identifier) => matches!(
            identifier.name.as_str(),
            "memo" | "observer" | "observable" | "withTracking"
        ),
        Expression::StaticMemberExpression(member) => {
            member.property.name == "memo"
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    };
    if !memoized {
        return false;
    }
    let is_memo_call = match callee {
        Expression::Identifier(identifier) => identifier.name == "memo",
        Expression::StaticMemberExpression(member) => {
            member.property.name == "memo"
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    };
    !is_memo_call || call.arguments.get(1).is_none_or(|argument| argument.as_expression().is_some_and(|expression| {
        matches!(expression.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "undefined" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
            || imported_module_api_matches(expression, "shallowEqual", "react-redux", ctx)
    }))
}

fn jsx_no_new_object_skip_native(
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
        .and_then(|settings| settings.get("jsxNoNewObjectAsProp"))
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

fn jsx_no_new_object_config_prop(name: &str) -> bool {
    const NAMES: &[&str] = &[
        "dangerouslySetInnerHTML",
        "style",
        "options",
        "config",
        "settings",
        "params",
        "input",
        "value",
        "values",
        "data",
        "metadata",
        "components",
        "customComponents",
        "slots",
        "elements",
        "classNames",
        "theme",
        "styles",
        "sx",
        "css",
        "margin",
        "padding",
        "viewport",
        "viewBox",
        "bounds",
        "extent",
        "domain",
        "range",
        "animate",
        "initial",
        "exit",
        "transition",
        "variants",
        "whileHover",
        "whileTap",
        "whileFocus",
        "whileInView",
        "drag",
        "dragConstraints",
        "UIOptions",
        "renderConfig",
        "shape",
        "shapes",
        "user",
        "users",
        "args",
        "avatar",
        "dot",
        "action",
        "expandable",
        "defaultSort",
        "resourceType",
        "truncateText",
        "formatters",
        "label",
        "context",
        "query",
        "props",
        "pagination",
        "filters",
        "person",
        "command",
        "cursor",
        "payload",
        "tooltip",
        "properties",
        "metadataSource",
        "queryParams",
        "extraQueryParams",
        "selectedOption",
        "emptyOption",
        "pinnedOption",
        "excludedProperties",
        "disabledReasons",
        "fallbackApplicationData",
        "fieldMetadataItem",
        "contextDescription",
        "emptyMessage",
        "defaultSorting",
        "defaultValue",
        "dropdown",
        "sideAction",
        "dropdownOffset",
        "collisionPadding",
        "forceBackTo",
        "resource",
        "field",
        "menu",
        "survey",
        "legend",
        "defaultFilters",
        "introOverride",
        "searchParams",
        "commandMenuContextApi",
        "nodeTypes",
        "forceParams",
        "callToActionButton",
        "a",
        "b",
        "edgeTypes",
        "axisBottom",
        "axisLeft",
        "axisRight",
        "axisTop",
        "xScale",
        "yScale",
        "xAxis",
        "yAxis",
        "xData",
        "yData",
        "activeDot",
        "defaultViewport",
        "effectiveValueRange",
        "arcLinkLabelsColor",
        "applicationInfo",
        "developerLinks",
        "permission",
        "modifier",
        "modifiers",
        "animationDurations",
        "targetRecordIdentifier",
        "web",
        "item",
        "overflow",
        "button",
    ];
    const SUFFIXES: &[&str] = &[
        "Props",
        "Config",
        "Configuration",
        "Options",
        "Settings",
        "Style",
        "Styles",
        "ClassName",
        "ClassNames",
        "Theme",
        "Sort",
        "Sorting",
        "Filter",
        "Pagination",
        "Format",
        "Locale",
        "Validator",
        "Args",
        "Type",
        "Item",
        "Option",
        "Record",
        "Metadata",
        "Context",
        "Query",
        "Source",
        "Target",
        "Action",
        "Properties",
        "Property",
        "Reasons",
        "Reason",
        "Padding",
        "Margin",
        "Offset",
        "Position",
        "Placement",
        "Value",
        "Defaults",
        "Default",
        "Schema",
        "Payload",
        "Cursor",
        "Tooltip",
        "Scale",
        "Axis",
        "Range",
        "Domain",
        "Tick",
        "Bar",
        "Line",
        "Area",
        "Mark",
        "Point",
        "Dot",
        "Label",
        "Color",
        "Stroke",
        "Fill",
        "Bottom",
        "Top",
        "Left",
        "Right",
        "Layer",
        "Viewport",
        "ViewBox",
        "Bounds",
        "Date",
        "Time",
        "Period",
        "Window",
        "Interval",
        "Duration",
        "Identifier",
        "Permission",
        "Info",
        "Link",
        "Links",
        "Animation",
        "Modifier",
        "Modifiers",
        "Strategy",
    ];
    NAMES.contains(&name)
        || SUFFIXES
            .iter()
            .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
}
