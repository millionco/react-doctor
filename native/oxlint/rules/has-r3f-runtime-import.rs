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
