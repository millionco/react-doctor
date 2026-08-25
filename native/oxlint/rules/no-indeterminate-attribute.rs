use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, TSSignature, TSType,
        TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "The `indeterminate` HTML attribute does not set a checkbox's visual state. Assign the `HTMLInputElement.indeterminate` DOM property instead.";

#[derive(Debug, Default, Clone)]
pub struct NoIndeterminateAttribute;

declare_oxc_lint!(
    /// Disallow setting a checkbox's indeterminate state as an HTML attribute.
    NoIndeterminateAttribute,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow indeterminate checkbox attributes.",
);

impl Rule for NoIndeterminateAttribute {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_react_native_filename(&ctx.file_path().to_string_lossy())
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                check_indeterminate_jsx_attribute(opening_element, ctx);
            }
            AstKind::CallExpression(call_expression) => {
                check_indeterminate_attribute_call(call_expression, ctx);
            }
            _ => {}
        }
    }
}

fn is_react_native_filename(filename: &str) -> bool {
    let Some((stem, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "js" | "jsx" | "ts" | "tsx" | "cjs" | "cjsx" | "cts" | "ctsx" | "mjs" | "mjsx" | "mts" | "mtsx")
        && [".ios", ".android", ".native"]
            .iter()
            .any(|platform| stem.ends_with(platform))
}

fn check_indeterminate_jsx_attribute<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) {
    if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("input") {
        return;
    }
    let mut type_attribute = None;
    let mut type_attribute_index = None;
    let mut indeterminate_attribute = None;
    let mut indeterminate_attribute_index = None;
    let mut last_spread_index = None;
    for (attribute_index, attribute_item) in opening_element.attributes.iter().enumerate() {
        let JSXAttributeItem::Attribute(attribute) = attribute_item else {
            last_spread_index = Some(attribute_index);
            continue;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        match attribute_name.name.as_str() {
            "type" => {
                type_attribute = Some(attribute);
                type_attribute_index = Some(attribute_index);
            }
            "indeterminate" => {
                indeterminate_attribute = Some(attribute);
                indeterminate_attribute_index = Some(attribute_index);
            }
            _ => {}
        }
    }
    let (
        Some(type_attribute),
        Some(type_attribute_index),
        Some(indeterminate_attribute),
        Some(indeterminate_attribute_index),
    ) = (
        type_attribute,
        type_attribute_index,
        indeterminate_attribute,
        indeterminate_attribute_index,
    )
    else {
        return;
    };
    if last_spread_index.is_some_and(|spread_index| {
        spread_index > type_attribute_index || spread_index > indeterminate_attribute_index
    }) {
        return;
    }
    if get_static_jsx_attribute_string_values(type_attribute, ctx).is_some_and(|values| {
        values
            .iter()
            .all(|value| value.eq_ignore_ascii_case("checkbox"))
    }) {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(indeterminate_attribute.span));
    }
}

fn check_indeterminate_attribute_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return;
    };
    if !matches!(method_name, "setAttribute" | "toggleAttribute") {
        return;
    }
    if !matches!(
        call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression),
        Some(Expression::StringLiteral(attribute_name))
            if attribute_name.value == "indeterminate"
    ) {
        return;
    }
    if method_name == "setAttribute" {
        if call_expression
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_none()
        {
            return;
        }
    } else if call_expression.arguments.len() != 1
        && !matches!(
            call_expression
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::BooleanLiteral(force)) if force.value
        )
    {
        return;
    }
    if is_proven_html_input_element(member_expression.object(), ctx) {
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn is_proven_html_input_element<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression = expression.get_inner_expression();
    let mut visited_symbol_ids = Vec::new();
    loop {
        if let Some(member_expression) = expression.as_member_expression()
            && member_expression.static_property_name() == Some("current")
        {
            return has_typed_html_input_ref_origin(member_expression.object(), ctx);
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
        if symbol_type_annotation(symbol_id, ctx).is_some_and(|type_annotation| {
            is_html_input_element_type(type_annotation, ctx)
        }) {
            return true;
        }
        let Some(initializer) = direct_const_initializer(symbol_id, ctx) else {
            return false;
        };
        visited_symbol_ids.push(symbol_id);
        expression = initializer.get_inner_expression();
    }
}

fn has_typed_html_input_ref_origin<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression = expression.get_inner_expression();
    let mut visited_symbol_ids = Vec::new();
    loop {
        if let Expression::Identifier(identifier) = expression {
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
            let Some(initializer) = direct_const_initializer(symbol_id, ctx) else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            expression = initializer.get_inner_expression();
            continue;
        }
        let Expression::CallExpression(call_expression) = expression else {
            return false;
        };
        let Some(type_argument) = call_expression
            .type_arguments
            .as_ref()
            .and_then(|type_arguments| type_arguments.params.first())
        else {
            return false;
        };
        return is_imported_react_use_ref_call(call_expression, ctx)
            && is_html_input_element_type(type_argument, ctx);
    }
}

fn is_imported_react_use_ref_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Some(member_expression) = call_expression.callee.as_member_expression()
        && let Expression::Identifier(namespace) = member_expression.object().get_inner_expression()
        && namespace.name == "React"
        && ctx
            .scoping()
            .get_reference(namespace.reference_id())
            .symbol_id()
            .is_none()
    {
        return false;
    }
    is_react_api_call(call_expression, "useRef", ctx)
}

fn is_html_input_element_type(type_node: &TSType<'_>, ctx: &LintContext<'_>) -> bool {
    match type_node {
        TSType::TSTypeReference(type_reference) => matches!(
            &type_reference.type_name,
            TSTypeName::IdentifierReference(identifier)
                if identifier.name == "HTMLInputElement"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none()
        ),
        TSType::TSUnionType(union) => {
            let mut has_html_input_element = false;
            for member in &union.types {
                if matches!(member, TSType::TSNullKeyword(_) | TSType::TSUndefinedKeyword(_)) {
                    continue;
                }
                if !is_html_input_element_type(member, ctx) {
                    return false;
                }
                has_html_input_element = true;
            }
            has_html_input_element
        }
        _ => false,
    }
}

fn symbol_type_annotation<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a TSType<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .filter(|identifier| identifier.symbol_id() == symbol_id)
            .and(declarator.type_annotation.as_ref())
            .map(|annotation| &annotation.type_annotation),
        AstKind::FormalParameter(parameter) => {
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return parameter
                    .type_annotation
                    .as_ref()
                    .map(|annotation| &annotation.type_annotation);
            }
            let BindingPattern::ObjectPattern(object_pattern) = &parameter.pattern else {
                return None;
            };
            let property_name = object_pattern.properties.iter().find_map(|property| {
                property
                    .value
                    .get_binding_identifier()
                    .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                    .then(|| property.key.static_name())
                    .flatten()
            })?;
            let TSType::TSTypeLiteral(type_literal) = &parameter
                .type_annotation
                .as_ref()?
                .type_annotation
            else {
                return None;
            };
            type_literal.members.iter().find_map(|member| {
                let TSSignature::TSPropertySignature(property) = member else {
                    return None;
                };
                (property.key.static_name().as_deref() == Some(property_name.as_ref()))
                    .then(|| property.type_annotation.as_ref().map(|annotation| &annotation.type_annotation))?
            })
        }
        _ => None,
    }
}

fn direct_const_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|identifier| identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    variable_declaration
        .kind
        .is_const()
        .then_some(declarator.init.as_ref())?
}
