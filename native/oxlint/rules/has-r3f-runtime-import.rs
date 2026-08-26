fn has_r3f_runtime_import(ctx: &crate::context::LintContext<'_>) -> bool {
    use oxc_ast::{ast::TSModuleReference, AstKind};

    ctx.nodes().iter().any(|node| {
        if matches!(node.kind(), AstKind::Program(_)) {
            return false;
        }
        if !matches!(
            ctx.nodes().parent_node(node.id()).kind(),
            AstKind::Program(_)
        ) {
            return false;
        }
        let source = match node.kind() {
            AstKind::ImportDeclaration(declaration) if !is_type_only_import(declaration) => {
                Some(declaration.source.value.as_str())
            }
            AstKind::TSImportEqualsDeclaration(declaration) => {
                let TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return false;
                };
                Some(reference.expression.value.as_str())
            }
            AstKind::ExpressionStatement(statement) => {
                global_require_module_source(&statement.expression, ctx)
            }
            AstKind::VariableDeclaration(declaration) => declaration
                .declarations
                .iter()
                .filter_map(|declarator| declarator.init.as_ref())
                .find_map(|initializer| global_require_module_source(initializer, ctx)),
            _ => None,
        };
        source.is_some_and(is_r3f_runtime_module)
    })
}

fn global_require_module_source<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'_>,
) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return global_require_module_source(member_expression.object(), ctx);
    }
    let oxc_ast::ast::Expression::CallExpression(call_expression) = expression else {
        return None;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) =
        call_expression.callee.get_inner_expression()
    else {
        return None;
    };
    if identifier.name != "require"
        || ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    call_expression
        .common_js_require()
        .map(|source| source.value.as_str())
}

fn is_r3f_runtime_module(source: &str) -> bool {
    matches!(
        source,
        "@react-three/fiber"
            | "@react-three/fiber/legacy"
            | "@react-three/fiber/native"
            | "@react-three/fiber/webgpu"
            | "react-three-fiber"
    ) || source.starts_with("@react-three/")
}
