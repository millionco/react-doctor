fn has_r3f_runtime_import(ctx: &crate::context::LintContext<'_>) -> bool {
    use oxc_ast::{ast::TSModuleReference, AstKind};

    let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
        AstKind::Program(program) => Some(program),
        _ => None,
    }) else {
        return false;
    };
    program.body.iter().any(|statement| {
        let source = match statement {
            oxc_ast::ast::Statement::ImportDeclaration(declaration)
                if !is_type_only_import(declaration) =>
            {
                Some(declaration.source.value.as_str())
            }
            oxc_ast::ast::Statement::TSImportEqualsDeclaration(declaration) => {
                let TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return false;
                };
                Some(reference.expression.value.as_str())
            }
            oxc_ast::ast::Statement::ExpressionStatement(statement) => {
                global_require_module_source(&statement.expression, ctx)
            }
            oxc_ast::ast::Statement::VariableDeclaration(declaration) => {
                return declaration.declarations.iter().any(|declarator| {
                    declarator.init.as_ref().is_some_and(|initializer| {
                        global_require_module_source(initializer, ctx)
                            .is_some_and(is_r3f_runtime_module)
                    })
                });
            }
            _ => None,
        };
        source.is_some_and(is_r3f_runtime_module)
    })
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
