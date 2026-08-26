fn is_local_test_scaffold_jsx<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if is_inside_recognized_test_mock_factory(node, ctx) {
        return true;
    }
    let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    is_direct_test_callback(enclosing_function, ctx)
        && has_imported_product_component_attribute_ancestor(node, enclosing_function, ctx)
}

fn is_inside_recognized_test_mock_factory<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        if !matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let factory_root = transparent_expression_root(ancestor, ctx);
        let parent = ctx.nodes().parent_node(factory_root.id());
        let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
            return false;
        };
        is_recognized_test_mock_factory_call(call_expression, factory_root, ctx)
    })
}

fn is_recognized_test_mock_factory_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    factory_root: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_span::GetSpan;

    if call_expression
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_none_or(|argument| argument.span() != factory_root.span())
        || !matches!(
            call_expression.arguments.first(),
            Some(oxc_ast::ast::Argument::StringLiteral(_))
        )
    {
        return false;
    }
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if !matches!(
        member_expression.static_property_name().as_deref(),
        Some("doMock" | "mock" | "unstable_mockModule")
    ) {
        return false;
    }
    let oxc_ast::ast::Expression::Identifier(receiver) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    is_recognized_test_binding(receiver, &["jest", "vi"], ctx)
}

fn is_direct_test_callback<'a>(
    function_node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_span::GetSpan;

    let callback_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(callback_root.id());
    let oxc_ast::AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if !call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == callback_root.span())
    }) {
        return false;
    }
    get_test_callback_base_identifier(&call_expression.callee)
        .is_some_and(|identifier| is_recognized_test_binding(identifier, &["it", "test"], ctx))
}

fn get_test_callback_base_identifier<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    use oxc_ast::ast::Expression;

    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => {
            if let Some(member_expression) = expression.as_member_expression() {
                return matches!(
                    member_expression.static_property_name().as_deref(),
                    Some("concurrent" | "only" | "skip")
                )
                .then(|| get_test_callback_base_identifier(member_expression.object()))
                .flatten();
            }
            let table_builder = match expression {
                Expression::CallExpression(call_expression) => {
                    call_expression.callee.get_inner_expression()
                }
                Expression::TaggedTemplateExpression(tagged_template) => {
                    tagged_template.tag.get_inner_expression()
                }
                _ => return None,
            };
            let member_expression = table_builder.as_member_expression()?;
            (member_expression.static_property_name().as_deref() == Some("each"))
                .then(|| get_test_callback_base_identifier(member_expression.object()))
                .flatten()
        }
    }
}

fn is_recognized_test_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    expected_export_names: &[&str],
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    if let Some(import_entry) = resolve_identifier_import(identifier, ctx) {
        return matches!(
            &import_entry.import_name,
            crate::module_record::ImportImportName::Name(imported_name)
                if expected_export_names.contains(&imported_name.name())
                    && matches!(
                        import_entry.module_request.name(),
                        "@jest/globals" | "bun:test" | "node:test" | "vitest"
                    )
        );
    }
    has_unit_test_filename(ctx)
        && expected_export_names.contains(&identifier.name.as_str())
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn has_unit_test_filename(ctx: &crate::context::LintContext<'_>) -> bool {
    let filename = format!("/{}", ctx.file_path().to_string_lossy().replace('\\', "/"));
    let basename = filename.rsplit('/').next().unwrap_or_default();
    basename.contains(".test.")
        || basename.contains(".spec.")
        || filename.contains("/__tests__/")
        || filename.contains("/__test__/")
        || filename.contains("/__mocks__/")
}

fn has_imported_product_component_attribute_ancestor<'a>(
    node: &crate::AstNode<'a>,
    enclosing_function: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    use oxc_span::GetSpan;

    let mut attribute_ancestor = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == enclosing_function.id() {
            break;
        }
        if matches!(
            ancestor.kind(),
            oxc_ast::AstKind::Function(_) | oxc_ast::AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        match ancestor.kind() {
            oxc_ast::AstKind::JSXAttribute(attribute) => {
                attribute_ancestor = Some((ancestor.id(), attribute));
            }
            oxc_ast::AstKind::JSXElement(element) => {
                let Some((attribute_node_id, attribute)) = attribute_ancestor else {
                    continue;
                };
                let attribute_parent = ctx.nodes().parent_node(attribute_node_id);
                if attribute_parent.span() == element.opening_element.span
                    && imported_product_component_source(&element.opening_element, ctx)
                        .is_some_and(|source| !is_react_or_test_library_source(source))
                    && matches!(
                        &attribute.name,
                        oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                            if identifier.name != "children"
                    )
                {
                    return true;
                }
                attribute_ancestor = None;
            }
            _ => {}
        }
    }
    false
}

fn imported_product_component_source<'a, 'b>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b crate::context::LintContext<'a>,
) -> Option<&'b str> {
    let oxc_ast::ast::JSXElementName::IdentifierReference(identifier) = &opening_element.name
    else {
        return None;
    };
    resolve_identifier_import(identifier, ctx).map(|entry| entry.module_request.name())
}

fn is_react_or_test_library_source(source: &str) -> bool {
    matches!(
        source,
        "react"
            | "react/jsx-dev-runtime"
            | "react/jsx-runtime"
            | "vitest"
            | "jest"
            | "mocha"
            | "chai"
            | "sinon"
            | "expect"
            | "ava"
            | "uvu"
            | "node:test"
            | "bun:test"
            | "@testing-library/react"
            | "@testing-library/react-native"
            | "@testing-library/react-hooks"
            | "@testing-library/dom"
            | "@testing-library/user-event"
            | "@testing-library/jest-dom"
            | "@testing-library/vue"
            | "@testing-library/svelte"
            | "@testing-library/preact"
            | "@testing-library/cypress"
            | "playwright"
            | "playwright-core"
            | "@playwright/test"
            | "@playwright/experimental-ct-react"
            | "@playwright/experimental-ct-react17"
            | "cypress"
            | "@cypress/react"
            | "@cypress/react18"
            | "@storybook/test"
            | "@storybook/test-runner"
            | "@storybook/testing-library"
            | "@storybook/jest"
            | "puppeteer"
            | "puppeteer-core"
            | "webdriverio"
            | "@wdio/globals"
            | "@nuxt/test-utils"
    ) || [
        "vitest/",
        "@vitest/",
        "@jest/",
        "@testing-library/",
        "@playwright/",
        "@storybook/test/",
        "@storybook/test-runner/",
        "@storybook/testing-library/",
        "@cypress/",
        "@nuxt/test-utils/",
    ]
    .iter()
    .any(|prefix| source.starts_with(prefix))
}
