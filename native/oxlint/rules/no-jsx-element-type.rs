use oxc_ast::{
    AstKind,
    ast::{BindingPattern, FunctionType, ImportDeclarationSpecifier, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`JSX.Element` is too narrow: it excludes `null`, strings, numbers, and fragments that components commonly return. Use `React.ReactNode` instead.";

#[derive(Debug, Default, Clone)]
pub struct NoJsxElementType;

declare_oxc_lint!(
    /// Disallow JSX.Element component return annotations.
    NoJsxElementType,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow JSX.Element component return annotations.",
);

impl Rule for NoJsxElementType {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_jsx_import_binding(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let return_type = match node.kind() {
                AstKind::Function(function) if is_component_function(node, function.r#type, ctx) => {
                    function.return_type.as_ref()
                }
                AstKind::ArrowFunctionExpression(function)
                    if is_component_expression(node, ctx) =>
                {
                    function.return_type.as_ref()
                }
                _ => None,
            };
            let Some(return_type) = return_type else {
                continue;
            };
            let TSType::TSTypeReference(type_reference) = &return_type.type_annotation else {
                continue;
            };
            let TSTypeName::QualifiedName(qualified_name) = &type_reference.type_name else {
                continue;
            };
            if qualified_name.right.name != "Element"
                || !matches!(
                    &qualified_name.left,
                    TSTypeName::IdentifierReference(identifier) if identifier.name == "JSX"
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(type_reference.span));
        }
    }
}

fn has_jsx_import_binding(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return false;
        };
        import_declaration
            .specifiers
            .iter()
            .flatten()
            .any(|specifier| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    specifier.local.name == "JSX"
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    specifier.local.name == "JSX"
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => false,
            })
    })
}

fn is_component_function<'a>(
    node: &AstNode<'a>,
    function_type: FunctionType,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::Function(function) = node.kind() else {
        return false;
    };
    match function_type {
        FunctionType::TSDeclareFunction => function
            .id
            .as_ref()
            .is_some_and(|identifier| is_react_component_name(identifier.name.as_str())),
        FunctionType::FunctionDeclaration => {
            function.id.as_ref().is_none_or(|identifier| {
                identifier.name == "default"
                    || is_react_component_name(identifier.name.as_str())
            }) || matches!(
                ctx.nodes().parent_node(node.id()).kind(),
                AstKind::ExportDefaultDeclaration(_)
            )
        }
        FunctionType::FunctionExpression | FunctionType::TSEmptyBodyFunctionExpression => {
            is_component_expression(node, ctx)
        }
    }
}

fn is_component_expression<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut parent = ctx.nodes().parent_node(node.id());
    while matches!(parent.kind(), AstKind::CallExpression(_)) {
        parent = ctx.nodes().parent_node(parent.id());
    }
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => matches!(
            &declarator.id,
            BindingPattern::BindingIdentifier(identifier)
                if is_react_component_name(identifier.name.as_str())
        ),
        AstKind::ExportDefaultDeclaration(_) => true,
        _ => false,
    }
}

fn is_react_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
