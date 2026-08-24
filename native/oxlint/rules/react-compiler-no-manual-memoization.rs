use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const USE_MEMO_MESSAGE: &str = "React Compiler can cache this value automatically. Verify that removing `useMemo` preserves behavior before simplifying it.";
const USE_CALLBACK_MESSAGE: &str = "React Compiler can cache this function automatically. Verify that removing `useCallback` preserves behavior before simplifying it.";
const MEMO_MESSAGE: &str = "React Compiler can cache this component output automatically. Verify that removing `memo()` preserves behavior before simplifying it.";

#[derive(Debug, Default, Clone)]
pub struct ReactCompilerNoManualMemoization;

declare_oxc_lint!(
    /// Identifies redundant manual memoization in React Compiler projects.
    ReactCompilerNoManualMemoization,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Identifies redundant manual memoization in compiler-managed code.",
);

impl Rule for ReactCompilerNoManualMemoization {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(api_name) = resolve_react_memoization_api(&call_expression.callee, ctx) else {
            return;
        };
        if api_name == "memo" {
            if call_expression
                .arguments
                .get(1)
                .is_some_and(|argument| !is_nullish_comparator(argument))
            {
                return;
            }
        } else {
            let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx)
            else {
                return;
            };
            if !is_compiler_inferable_function(enclosing_function, ctx) {
                return;
            }
        }
        let message = match api_name {
            "useMemo" => USE_MEMO_MESSAGE,
            "useCallback" => USE_CALLBACK_MESSAGE,
            "memo" => MEMO_MESSAGE,
            _ => return,
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call_expression.span));
    }
}

fn resolve_react_memoization_api<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let import_entry = resolve_identifier_import(identifier, ctx)?;
            if import_entry.module_request.name() != "react" {
                return None;
            }
            let crate::module_record::ImportImportName::Name(imported_name) =
                &import_entry.import_name
            else {
                return None;
            };
            canonical_memoization_api_name(imported_name.name())
        }
        Expression::StaticMemberExpression(member_expression) => {
            let api_name =
                canonical_memoization_api_name(member_expression.property.name.as_str())?;
            let Expression::Identifier(receiver) = member_expression.object.get_inner_expression()
            else {
                return None;
            };
            if let Some(import_entry) = resolve_identifier_import(receiver, ctx) {
                return (import_entry.module_request.name() == "react").then_some(api_name);
            }
            (is_canonical_react_namespace_name(receiver.name.as_str())
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none())
            .then_some(api_name)
        }
        _ => None,
    }
}

fn canonical_memoization_api_name(api_name: &str) -> Option<&'static str> {
    match api_name {
        "useMemo" => Some("useMemo"),
        "useCallback" => Some("useCallback"),
        "memo" => Some("memo"),
        _ => None,
    }
}

fn is_canonical_react_namespace_name(name: &str) -> bool {
    matches!(name, "React" | "react") || name.starts_with("_react") || name.starts_with("_React")
}

fn is_nullish_comparator(argument: &oxc_ast::ast::Argument<'_>) -> bool {
    match argument
        .as_expression()
        .map(Expression::get_inner_expression)
    {
        Some(Expression::NullLiteral(_)) => true,
        Some(Expression::Identifier(identifier)) => identifier.name == "undefined",
        _ => false,
    }
}

fn is_compiler_inferable_function<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    if matches!(
        function_node.kind(),
        AstKind::Function(function)
            if function.id.as_ref().is_some_and(|identifier| {
                crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
            })
    ) {
        return true;
    }
    let expression_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| {
                declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == expression_root.span())
                    && crate::utils::is_react_component_or_hook_name(identifier.name.as_str())
            }),
        AstKind::CallExpression(call_expression) => {
            call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(|argument| argument.span() == expression_root.span())
                && matches!(call_expression.callee_name(), Some("memo" | "forwardRef"))
        }
        _ => false,
    }
}
