use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, BindingPattern, ChainElement, Expression, JSXAttributeName,
        JSXAttributeValue, JSXElementName, ObjectPropertyKind, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const JSX_NO_NEW_FUNCTION_AS_PROP_MESSAGE: &str =
    "This child redraws every render because the prop gets a brand new function each time.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoNewFunctionAsProp;

declare_oxc_lint!(
    /// Disallow functions allocated while rendering JSX props.
    JsxNoNewFunctionAsProp,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow new functions as JSX props.",
);

impl Rule for JsxNoNewFunctionAsProp {
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
            if jsx_no_new_function_skip_native(attribute, &opening.name, curated, ctx)
                || (curated && !jsx_no_new_function_memoized_consumer(&opening.name, ctx))
                || crate::ast_util::get_enclosing_function(node, ctx).is_none()
            {
                continue;
            }
            if curated {
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    continue;
                };
                if jsx_no_new_function_one_shot_prop(attribute_name.name.as_str()) {
                    continue;
                }
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if curated && jsx_no_new_function_stable_wrapper(expression) {
                continue;
            }
            if jsx_no_new_function_expression(expression)
                || jsx_no_new_function_render_local_binding(expression, curated, ctx)
            {
                ctx.diagnostic(
                    OxcDiagnostic::warn(JSX_NO_NEW_FUNCTION_AS_PROP_MESSAGE)
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

fn jsx_no_new_function_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::NewExpression(expression) => {
            matches!(expression.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Function")
        }
        Expression::CallExpression(call) => match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => identifier.name == "Function",
            Expression::StaticMemberExpression(member) => member.property.name == "bind",
            Expression::ComputedMemberExpression(member) => {
                matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == "bind")
            }
            _ => false,
        },
        Expression::LogicalExpression(logical) => {
            jsx_no_new_function_expression(&logical.left)
                || jsx_no_new_function_expression(&logical.right)
        }
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_function_expression(&conditional.consequent)
                || jsx_no_new_function_expression(&conditional.alternate)
        }
        _ => false,
    }
}

fn jsx_no_new_function_render_local_binding<'a>(
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
    let declaration = ctx.symbol_declaration(symbol_id);
    let initializer = match declaration.kind() {
        AstKind::Function(_) => return true,
        AstKind::VariableDeclarator(declarator) => jsx_no_new_function_binding_initializer(
            &declarator.id,
            declarator.init.as_ref(),
            symbol_id,
        ),
        _ => None,
    };
    let Some(initializer) = initializer else {
        return false;
    };
    jsx_no_new_function_expression(initializer)
        && !(curated && jsx_no_new_function_stable_wrapper(initializer))
}

fn jsx_no_new_function_binding_initializer<'a>(
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
            jsx_no_new_function_binding_initializer(&property.value, None, symbol_id)
        }),
        BindingPattern::ArrayPattern(array) => {
            array.elements.iter().flatten().find_map(|element| {
                jsx_no_new_function_binding_initializer(element, None, symbol_id)
            })
        }
        _ => None,
    }
}

fn jsx_no_new_function_stable_wrapper(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(arrow) => {
            if let Some(body) = arrow.get_expression() {
                jsx_no_new_function_lightweight_expression(body)
            } else {
                jsx_no_new_function_function_body_is_stable(arrow.get_function_body())
            }
        }
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_function_nullish_or_wrapper(&conditional.consequent)
                && jsx_no_new_function_nullish_or_wrapper(&conditional.alternate)
                && (matches!(
                    conditional.consequent.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_)
                ) || matches!(
                    conditional.alternate.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_)
                ))
        }
        _ => false,
    }
}

fn jsx_no_new_function_nullish_or_wrapper(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::ArrowFunctionExpression(_) => jsx_no_new_function_stable_wrapper(expression),
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_function_nullish_or_wrapper(&conditional.consequent)
                && jsx_no_new_function_nullish_or_wrapper(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            jsx_no_new_function_nullish_or_wrapper(&logical.left)
                && jsx_no_new_function_nullish_or_wrapper(&logical.right)
        }
        _ => false,
    }
}

fn jsx_no_new_function_lightweight_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(_) => jsx_no_new_function_stable_call(expression),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => jsx_no_new_function_call_is_stable(call),
            ChainElement::TSNonNullExpression(non_null) => {
                jsx_no_new_function_lightweight_expression(&non_null.expression)
            }
            _ => false,
        },
        Expression::LogicalExpression(logical) => {
            (jsx_no_new_function_stable_argument(&logical.left)
                || jsx_no_new_function_lightweight_expression(&logical.left))
                && (jsx_no_new_function_stable_argument(&logical.right)
                    || jsx_no_new_function_lightweight_expression(&logical.right))
                && (jsx_no_new_function_is_direct_or_chain_call(&logical.left)
                    || jsx_no_new_function_is_direct_or_chain_call(&logical.right))
        }
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_function_lightweight_expression(&conditional.consequent)
                && jsx_no_new_function_lightweight_expression(&conditional.alternate)
        }
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::Void | UnaryOperator::LogicalNot
            ) =>
        {
            jsx_no_new_function_lightweight_expression(&unary.argument)
        }
        Expression::AwaitExpression(await_expression) => {
            jsx_no_new_function_lightweight_expression(&await_expression.argument)
        }
        _ => false,
    }
}

fn jsx_no_new_function_is_direct_or_chain_call(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(_) => true,
        Expression::ChainExpression(chain) => {
            matches!(&chain.expression, ChainElement::CallExpression(_))
        }
        _ => false,
    }
}

fn jsx_no_new_function_stable_argument(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_)
        | Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::BooleanLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::TaggedTemplateExpression(_) => true,
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .all(jsx_no_new_function_stable_argument),
        Expression::UnaryExpression(unary) => jsx_no_new_function_stable_argument(&unary.argument),
        Expression::ConditionalExpression(conditional) => {
            jsx_no_new_function_stable_argument(&conditional.test)
                && jsx_no_new_function_stable_argument(&conditional.consequent)
                && jsx_no_new_function_stable_argument(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            jsx_no_new_function_stable_argument(&logical.left)
                && jsx_no_new_function_stable_argument(&logical.right)
        }
        Expression::BinaryExpression(binary) => {
            jsx_no_new_function_stable_argument(&binary.left)
                && jsx_no_new_function_stable_argument(&binary.right)
        }
        Expression::ObjectExpression(object) => {
            object.properties.iter().all(|property| match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    jsx_no_new_function_stable_argument(&spread.argument)
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    property.shorthand || jsx_no_new_function_stable_argument(&property.value)
                }
            })
        }
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            ArrayExpressionElement::SpreadElement(spread) => {
                jsx_no_new_function_stable_argument(&spread.argument)
            }
            ArrayExpressionElement::Elision(_) => true,
            element => ArrayExpressionElement::as_expression(element)
                .is_some_and(jsx_no_new_function_stable_argument),
        }),
        Expression::CallExpression(_) => jsx_no_new_function_stable_call(expression),
        Expression::ChainExpression(chain) => {
            if chain.expression.as_member_expression().is_some() {
                true
            } else {
                match &chain.expression {
                    ChainElement::CallExpression(call) => jsx_no_new_function_call_is_stable(call),
                    ChainElement::TSNonNullExpression(non_null) => {
                        jsx_no_new_function_stable_argument(&non_null.expression)
                    }
                    _ => false,
                }
            }
        }
        _ => false,
    }
}

fn jsx_no_new_function_stable_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    jsx_no_new_function_call_is_stable(call)
}

fn jsx_no_new_function_call_is_stable(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    if !matches!(
        call.callee.get_inner_expression(),
        Expression::Identifier(_)
            | Expression::StaticMemberExpression(_)
            | Expression::ComputedMemberExpression(_)
    ) {
        return false;
    }
    if jsx_no_new_function_callee_receiver(&call.callee)
        .is_some_and(jsx_no_new_function_safe_receiver)
    {
        return true;
    }
    call.arguments.iter().all(|argument| {
        argument
            .as_expression()
            .is_some_and(jsx_no_new_function_stable_argument)
    })
}

fn jsx_no_new_function_callee_receiver<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let mut expression = expression.get_inner_expression();
    while let Some(member) = expression.as_member_expression() {
        expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn jsx_no_new_function_safe_receiver(name: &str) -> bool {
    matches!(
        name,
        "router"
            | "navigate"
            | "navigation"
            | "history"
            | "console"
            | "window"
            | "document"
            | "location"
            | "localStorage"
            | "sessionStorage"
            | "analytics"
            | "telemetry"
            | "logger"
            | "log"
            | "posthog"
            | "Sentry"
            | "Math"
            | "Number"
            | "String"
            | "Boolean"
            | "Array"
            | "Object"
            | "JSON"
            | "Date"
            | "Promise"
            | "Map"
            | "Set"
            | "Symbol"
    )
}

fn jsx_no_new_function_function_body_is_stable(
    body: Option<&oxc_ast::ast::FunctionBody<'_>>,
) -> bool {
    let Some(body) = body else {
        return false;
    };
    if body.statements.len() > 8 {
        return false;
    }
    jsx_no_new_function_statements_are_stable(&body.statements)
}

fn jsx_no_new_function_statements_are_stable(statements: &[Statement<'_>]) -> bool {
    statements.len() <= 8
        && statements
            .iter()
            .all(jsx_no_new_function_statement_is_stable)
}

fn jsx_no_new_function_statement_is_stable(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ExpressionStatement(statement) => {
            jsx_no_new_function_lightweight_expression(&statement.expression)
        }
        Statement::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .is_none_or(jsx_no_new_function_lightweight_expression),
        Statement::VariableDeclaration(declaration) => {
            declaration.declarations.iter().all(|declarator| {
                declarator
                    .init
                    .as_ref()
                    .is_none_or(jsx_no_new_function_stable_argument)
            })
        }
        Statement::IfStatement(statement) => {
            jsx_no_new_function_stable_argument(&statement.test)
                && jsx_no_new_function_statement_is_stable(&statement.consequent)
                && statement
                    .alternate
                    .as_ref()
                    .is_none_or(|alternate| jsx_no_new_function_statement_is_stable(alternate))
        }
        Statement::BlockStatement(block) => jsx_no_new_function_statements_are_stable(&block.body),
        _ => false,
    }
}

fn jsx_no_new_function_memoized_consumer<'a>(
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

fn jsx_no_new_function_skip_native(
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
        .and_then(|settings| settings.get("jsxNoNewFunctionAsProp"))
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

fn jsx_no_new_function_one_shot_prop(name: &str) -> bool {
    const NAMES: &[&str] = &[
        "onMount",
        "onUnmount",
        "onReady",
        "onInit",
        "onLoad",
        "onDestroy",
        "onBeforeMount",
        "onAfterMount",
        "onBeforeUnmount",
        "onAfterUnmount",
        "onError",
        "onComplete",
        "onCompleted",
        "onFinish",
        "onFinished",
        "onSuccess",
        "onAbort",
        "onOpen",
        "onClose",
        "onDismiss",
        "onCancel",
        "onConfirm",
        "onSave",
        "onSubmit",
        "onCommit",
        "onApply",
        "onRemove",
        "onDelete",
        "onDuplicate",
        "onReset",
        "onRetry",
        "onRefresh",
        "onAdd",
        "onCreate",
        "onUpdate",
        "onConfirmClick",
        "onAcceptClick",
        "onCancelClick",
        "onSaveClick",
        "onClickOutside",
        "onPressEnter",
        "onEnter",
        "onEscape",
        "onLeave",
        "onDragStart",
        "onDragEnd",
        "onDrop",
        "onSort",
        "fallback",
        "fallbackRender",
        "render",
        "renderItem",
        "renderRow",
        "renderCell",
        "renderEmpty",
        "renderError",
        "renderLoading",
        "renderHeader",
        "renderFooter",
        "renderName",
        "renderContent",
        "renderTrigger",
        "renderOption",
        "renderItemActions",
        "children",
        "useCustom",
        "Icon",
        "Trigger",
        "Header",
        "Footer",
        "Label",
        "Content",
        "Adornment",
        "Indicator",
        "Tooltip",
        "Badge",
        "Panel",
        "Overlay",
        "Section",
        "Button",
        "Action",
        "onValueChange",
        "onCheckedChange",
        "onOpenChange",
        "onSelectionChange",
        "onPressedChange",
        "onToggleChange",
        "onSearch",
        "onSearchChange",
        "onClear",
        "onCopy",
        "onPaste",
        "onPick",
        "onActiveChange",
        "onExpandedChange",
        "onSortChange",
        "onFilterChange",
        "onSelectChange",
        "onSelect",
        "onToggle",
        "onTab",
        "onShiftTab",
        "onBack",
        "onForward",
        "onPrev",
        "onNext",
        "onSkip",
        "onContinue",
        "onPressCmdEnter",
        "onPressCmdK",
        "onCloseRequest",
        "onCloseRequested",
        "onRowClick",
        "onCellClick",
        "onHeaderClick",
        "onToggleExpand",
        "onToggleCollapse",
        "onVisibilityChange",
        "onVariableSelect",
        "onSelectColor",
        "action",
        "onEdit",
        "onView",
        "onApprove",
        "onReject",
        "onArchive",
        "onUnarchive",
        "onPin",
        "onUnpin",
        "onShare",
        "onDownload",
        "onUpload",
        "onPrint",
        "onExport",
        "onImport",
        "onMove",
        "onRename",
        "rowKey",
        "onRow",
        "onCell",
        "onHeader",
        "onHeaderRow",
        "onHeaderCell",
        "onPageChange",
        "onTabChange",
        "onNameChange",
        "onDescriptionChange",
        "onInputChange",
        "onLabelChange",
        "onValueCommit",
    ];
    const PREFIXES: &[&str] = &[
        "get", "format", "parse", "validate", "is", "should", "match", "select", "filter",
        "compare",
    ];
    const SUFFIXES: &[&str] = &[
        "Render",
        "Renderer",
        "Slot",
        "Component",
        "Element",
        "Icon",
        "Trigger",
        "Header",
        "Footer",
        "Label",
        "Content",
        "Adornment",
        "Indicator",
        "Tooltip",
        "Badge",
        "Panel",
        "Overlay",
        "Section",
        "Button",
        "Action",
        "Override",
        "Fallback",
    ];
    NAMES.contains(&name)
        || (name.starts_with("render")
            && name.as_bytes().get(6).is_some_and(u8::is_ascii_uppercase))
        || PREFIXES.iter().any(|prefix| {
            name.len() > prefix.len()
                && name.starts_with(prefix)
                && name
                    .as_bytes()
                    .get(prefix.len())
                    .is_some_and(u8::is_ascii_uppercase)
        })
        || SUFFIXES
            .iter()
            .any(|suffix| name.len() > suffix.len() && name.ends_with(suffix))
}
