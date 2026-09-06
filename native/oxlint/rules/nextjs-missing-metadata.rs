use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{Declaration, Expression, ModuleExportName, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_span::SourceType;

const MESSAGE: &str =
    "This page has no metadata, so search engines and social previews get no title or description.";

#[derive(Debug, Default, Clone)]
pub struct NextjsMissingMetadata;
declare_oxc_lint!(
    /// Require public Next.js pages to define metadata.
    NextjsMissingMetadata,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require metadata in Next.js pages."
);

impl Rule for NextjsMissingMetadata {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_next_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let path = ctx.file_path().to_string_lossy().replace('\\', "/");
        if !nextjs_missing_page_path(&path) || nextjs_missing_internal_path(&path) {
            return;
        }
        let program = ctx.nodes().program();
        if program
            .directives
            .iter()
            .any(|directive| directive.expression.value == "use client")
            || program.body.iter().any(|statement| {
                matches!(statement,
                    Statement::ExpressionStatement(statement)
                        if matches!(&statement.expression,
                            Expression::StringLiteral(literal)
                                if literal.value == "use client"))
            })
            || nextjs_missing_has_metadata_export(program)
            || nextjs_missing_redirect_only(ctx)
            || nextjs_missing_has_ancestor_layout(&path)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(program_estree_span(program)));
    }
}

fn nextjs_missing_page_path(path: &str) -> bool {
    ["ts", "tsx", "js", "jsx", "mts", "mjs"]
        .iter()
        .any(|extension| path.ends_with(&format!("/page.{extension}")))
}

fn nextjs_missing_internal_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        "dashboard",
        "admin",
        "settings",
        "account",
        "internal",
        "manage",
        "console",
        "portal",
    ]
    .iter()
    .any(|segment| lower.contains(&format!("/{segment}/")))
        || [
            "dashboard",
            "admin",
            "settings",
            "account",
            "internal",
            "manage",
            "console",
            "portal",
            "auth",
            "onboarding",
            "app",
            "ee",
            "protected",
        ]
        .iter()
        .any(|segment| lower.contains(&format!("/({segment})/")))
}

fn nextjs_missing_has_metadata_export(program: &oxc_ast::ast::Program<'_>) -> bool {
    program.body.iter().any(|statement| match statement {
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => {
                declaration.declarations.iter().any(|declarator| {
                    declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|identifier| {
                            matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
                        })
                })
            }
            Declaration::FunctionDeclaration(function) => function
                .id
                .as_ref()
                .is_some_and(|identifier| identifier.name == "generateMetadata"),
            _ => false,
        },
        Statement::ExportNamedDeclaration(export) => {
            nextjs_missing_specifiers_export_metadata(&export.specifiers)
        }
        Statement::ExportFromDeclaration(export) => {
            nextjs_missing_specifiers_export_metadata(&export.specifiers)
        }
        _ => false,
    })
}

fn nextjs_missing_specifiers_export_metadata(
    specifiers: &[oxc_ast::ast::ExportSpecifier<'_>],
) -> bool {
    specifiers
        .iter()
        .any(|specifier| match &specifier.exported {
            ModuleExportName::IdentifierName(identifier) => {
                matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
            }
            ModuleExportName::IdentifierReference(identifier) => {
                matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
            }
            ModuleExportName::StringLiteral(_) => false,
        })
}

fn nextjs_missing_redirect_only(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| match node.kind() {
        AstKind::Function(function) if nextjs_missing_function_is_default_export(node, ctx) => {
            function
                .body
                .as_ref()
                .is_some_and(|body| nextjs_missing_statements_redirect_only(&body.statements, ctx))
        }
        AstKind::ArrowFunctionExpression(function)
            if nextjs_missing_function_is_default_export(node, ctx) =>
        {
            if let Some(expression) = function.get_expression() {
                nextjs_missing_redirect_expression(expression.get_inner_expression(), ctx)
            } else {
                function.get_function_body().is_some_and(|body| {
                    nextjs_missing_statements_redirect_only(&body.statements, ctx)
                })
            }
        }
        _ => false,
    })
}

fn nextjs_missing_statements_redirect_only<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    if statements.len() != 1 {
        return false;
    }
    match &statements[0] {
        Statement::ExpressionStatement(statement) => {
            nextjs_missing_redirect_expression(statement.expression.get_inner_expression(), ctx)
        }
        Statement::ReturnStatement(statement) => {
            statement.argument.as_ref().is_some_and(|expression| {
                nextjs_missing_redirect_expression(expression.get_inner_expression(), ctx)
            })
        }
        _ => false,
    }
}

fn nextjs_missing_function_is_default_export(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut function_root_id = node.id();
    loop {
        let parent = ctx.nodes().parent_node(function_root_id);
        if matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSInstantiationExpression(_)
                | AstKind::ChainExpression(_)
        ) {
            function_root_id = parent.id();
        } else {
            break;
        }
    }
    let function_parent = ctx.nodes().parent_node(function_root_id);
    if matches!(
        function_parent.kind(),
        AstKind::ExportDefaultDeclaration(_)
    ) {
        return true;
    }
    let symbol_id = match function_parent.kind() {
        AstKind::VariableDeclarator(declarator) => {
            let Some(identifier) = declarator.id.get_binding_identifier() else {
                return false;
            };
            identifier.symbol_id()
        }
        _ => {
            let AstKind::Function(function) = node.kind() else {
                return false;
            };
            let Some(identifier) = &function.id else {
                return false;
            };
            identifier.symbol_id()
        }
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            matches!(
                ctx.nodes().parent_node(reference.node_id()).kind(),
                AstKind::ExportDefaultDeclaration(_)
            )
        })
        || ctx.nodes().program().body.iter().any(|statement| {
            let Statement::ExportNamedDeclaration(export) = statement else {
                return false;
            };
            export.specifiers.iter().any(|specifier| {
                nextjs_missing_module_export_name_matches(&specifier.exported, "default")
                    && match &specifier.local {
                        ModuleExportName::IdentifierReference(identifier) => {
                            ctx.scoping()
                                .get_reference(identifier.reference_id())
                                .symbol_id()
                                == Some(symbol_id)
                        }
                        ModuleExportName::IdentifierName(identifier) => {
                            ctx.scoping().get_root_binding(identifier.name) == Some(symbol_id)
                        }
                        ModuleExportName::StringLiteral(_) => false,
                    }
            })
        })
}

fn nextjs_missing_module_export_name_matches(name: &ModuleExportName<'_>, expected: &str) -> bool {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name == expected,
        ModuleExportName::IdentifierReference(identifier) => identifier.name == expected,
        ModuleExportName::StringLiteral(value) => value.value == expected,
    }
}

fn nextjs_missing_redirect_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression = expression.get_inner_expression();
    while let Expression::AwaitExpression(await_expression) = expression {
        expression = await_expression.argument.get_inner_expression();
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    imported_module_api_matches(&call.callee, "redirect", "next/navigation", ctx)
        || imported_module_api_matches(&call.callee, "permanentRedirect", "next/navigation", ctx)
}

fn nextjs_missing_has_ancestor_layout(page_path: &str) -> bool {
    let mut directory = std::path::Path::new(page_path).parent();
    for _ in 0..30 {
        let Some(current) = directory else { break };
        for name in [
            "layout.tsx",
            "layout.jsx",
            "layout.ts",
            "layout.js",
            "layout.mts",
            "layout.mjs",
        ] {
            let layout_path = current.join(name);
            if let Ok(source) = std::fs::read_to_string(&layout_path)
                && nextjs_missing_layout_exports_metadata(&layout_path, &source)
            {
                return true;
            }
        }
        let Some(parent) = current.parent() else {
            break;
        };
        if current.file_name().and_then(|name| name.to_str()) == Some("app")
            && parent.file_name().and_then(|name| name.to_str()) != Some("app")
        {
            break;
        }
        directory = Some(parent);
    }
    false
}

fn nextjs_missing_layout_exports_metadata(path: &std::path::Path, source: &str) -> bool {
    let Ok(source_type) = SourceType::from_path(path).map(|source_type| source_type.with_jsx(true))
    else {
        return false;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, source, source_type).parse();
    parser_return
        .program
        .body
        .iter()
        .any(|statement| match statement {
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => declaration
                    .declarations
                    .iter()
                    .filter_map(|declarator| declarator.id.get_binding_identifier())
                    .any(|identifier| {
                        matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
                    }),
                Declaration::FunctionDeclaration(function) => {
                    function.id.as_ref().is_some_and(|identifier| {
                        matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
                    })
                }
                Declaration::ClassDeclaration(class) => {
                    class.id.as_ref().is_some_and(|identifier| {
                        matches!(identifier.name.as_str(), "metadata" | "generateMetadata")
                    })
                }
                Declaration::TSTypeAliasDeclaration(declaration) => {
                    matches!(
                        declaration.id.name.as_str(),
                        "metadata" | "generateMetadata"
                    )
                }
                Declaration::TSInterfaceDeclaration(declaration) => {
                    matches!(
                        declaration.id.name.as_str(),
                        "metadata" | "generateMetadata"
                    )
                }
                Declaration::TSEnumDeclaration(declaration) => {
                    matches!(
                        declaration.id.name.as_str(),
                        "metadata" | "generateMetadata"
                    )
                }
                _ => false,
            },
            Statement::ExportNamedDeclaration(export) => {
                nextjs_missing_specifiers_export_metadata(&export.specifiers)
            }
            Statement::ExportFromDeclaration(export) => {
                nextjs_missing_specifiers_export_metadata(&export.specifiers)
            }
            _ => false,
        })
}
