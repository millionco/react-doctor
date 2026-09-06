use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

const FRESH_ARRAY_METHODS: [&str; 12] = [
    "filter",
    "map",
    "flatMap",
    "slice",
    "concat",
    "flat",
    "toSorted",
    "toReversed",
    "toSpliced",
    "with",
    "sort",
    "reverse",
];

#[derive(Debug, Default, Clone)]
pub struct JotaiDerivedAtomReturnsFreshObject;

declare_oxc_lint!(
    /// Warn when a derived Jotai atom returns a fresh object or array.
    JotaiDerivedAtomReturnsFreshObject,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Derived atom returns fresh object.",
);

impl Rule for JotaiDerivedAtomReturnsFreshObject {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(atom_call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &atom_call.callee else {
            return;
        };
        let Some(import_entry) = resolve_identifier_import(callee, ctx) else {
            return;
        };
        if import_entry.module_request.name() != "jotai"
            || !matches!(
                &import_entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "atom"
            )
        {
            return;
        }
        let Some(reader) = atom_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let (function_node_id, function_span, return_expression, get_parameter_symbol_id) =
            match reader {
                Expression::ArrowFunctionExpression(function) => {
                    if function.params.items.len() != 1 {
                        return;
                    }
                    let Some(parameter) = function.params.items[0].pattern.get_binding_identifier()
                    else {
                        return;
                    };
                    (
                        function.node_id.get(),
                        function.span,
                        function.get_expression(),
                        parameter.symbol_id(),
                    )
                }
                Expression::FunctionExpression(function) => {
                    if function.params.items.len() != 1 {
                        return;
                    }
                    let Some(parameter) = function.params.items[0].pattern.get_binding_identifier()
                    else {
                        return;
                    };
                    (
                        function.node_id.get(),
                        function.span,
                        None,
                        parameter.symbol_id(),
                    )
                }
                _ => return,
            };
        if !jotai_reader_calls_get(function_node_id, get_parameter_symbol_id, ctx) {
            return;
        }
        if let Some(expression) = return_expression {
            if let Some((shape, span)) = jotai_fresh_return(expression) {
                jotai_report_fresh_return(shape, span, ctx);
            }
            return;
        }
        let returns = ctx
            .nodes()
            .iter()
            .filter_map(|candidate| {
                let AstKind::ReturnStatement(statement) = candidate.kind() else {
                    return None;
                };
                if !function_span.contains_inclusive(statement.span)
                    || nearest_jotai_function_node_id(candidate, ctx) != Some(function_node_id)
                {
                    return None;
                }
                Some(statement.argument.as_ref().and_then(jotai_fresh_return))
            })
            .collect::<Vec<_>>();
        if returns.is_empty() || returns.iter().any(Option::is_none) {
            return;
        }
        if let Some((shape, span)) = returns.into_iter().flatten().next() {
            jotai_report_fresh_return(shape, span, ctx);
        }
    }
}

fn jotai_reader_calls_get(
    function_node_id: oxc_semantic::NodeId,
    parameter_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(parameter_symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            let AstKind::CallExpression(call) = parent.kind() else {
                return false;
            };
            call.callee.span() == reference_node.span()
                && nearest_jotai_function_node_id(reference_node, ctx) == Some(function_node_id)
        })
}

fn nearest_jotai_function_node_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn jotai_fresh_return(expression: &Expression<'_>) -> Option<(&'static str, Span)> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ObjectExpression(object) => Some(("object", object.span)),
        Expression::ArrayExpression(array) => Some(("array", array.span)),
        Expression::CallExpression(call) => {
            let oxc_ast::ast::MemberExpression::StaticMemberExpression(member) =
                call.callee.as_member_expression()?
            else {
                return None;
            };
            let method_name = member.property.name.as_str();
            let receiver = member.object.get_inner_expression();
            if matches!(method_name, "sort" | "reverse") && jotai_fresh_return(receiver).is_none() {
                return None;
            }
            if FRESH_ARRAY_METHODS.contains(&method_name) {
                return Some(("array", call.span));
            }
            let Expression::Identifier(namespace) = receiver else {
                return None;
            };
            match (namespace.name.as_str(), method_name) {
                ("Array", "from" | "of") => Some(("array", call.span)),
                ("Object", "keys" | "values" | "entries") => Some(("array", call.span)),
                ("Object", "fromEntries" | "create") => Some(("object", call.span)),
                ("Object", "assign") => call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|target| {
                        matches!(
                            target.get_inner_expression(),
                            Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
                        )
                    })
                    .then_some(("object", call.span)),
                _ => None,
            }
        }
        _ => None,
    }
}

fn jotai_report_fresh_return(shape: &str, span: Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This derived atom returns a new {shape} each time, so jotai's Object.is check fails & re-renders every consumer on every update. Split into one atom per field, or use `selectAtom(source, fn, shallow)`."
        ))
        .with_label(span),
    );
}
