fn program_references_r3f(ctx: &crate::context::LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let module_source = match node.kind() {
            oxc_ast::AstKind::ImportDeclaration(declaration) => {
                Some(declaration.source.value.as_str())
            }
            oxc_ast::AstKind::TSImportEqualsDeclaration(declaration)
                if matches!(
                    ctx.nodes().parent_node(node.id()).kind(),
                    oxc_ast::AstKind::Program(_)
                ) =>
            {
                let oxc_ast::ast::TSModuleReference::ExternalModuleReference(reference) =
                    &declaration.module_reference
                else {
                    return false;
                };
                Some(reference.expression.value.as_str())
            }
            oxc_ast::AstKind::CallExpression(call_expression) => call_expression
                .common_js_require()
                .map(|source| source.value.as_str()),
            _ => None,
        };
        module_source.is_some_and(|module_source| {
            matches!(
                module_source,
                "@react-three/fiber"
                    | "@react-three/fiber/legacy"
                    | "@react-three/fiber/native"
                    | "@react-three/fiber/webgpu"
                    | "react-three-fiber"
            )
        })
    })
}
