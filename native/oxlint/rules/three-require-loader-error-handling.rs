use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const LOAD_MESSAGE: &str = "This Loader.load call omits its onError callback. Surface failed model or texture requests through an explicit error path";
const LOAD_ASYNC_MESSAGE: &str = "This Loader.loadAsync promise is discarded, so a failed asset request has no observable error path. Await, return, or handle the promise";
const THREE_LOADER_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireLoaderErrorHandling;

impl RuleMeta for ThreeRequireLoaderErrorHandling {
    const NAME: &'static str = "three-require-loader-error-handling";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require an observable error path for Three.js loader calls.",
    };
}

impl Rule for ThreeRequireLoaderErrorHandling {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let candidate_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call_expression) = node.kind() else {
                    return None;
                };
                let callee = call_expression.callee.as_member_expression()?;
                matches!(
                    static_member_expression_property_name(callee),
                    Some("load" | "loadAsync")
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if candidate_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        for candidate_id in candidate_ids {
            let node = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(callee) = call_expression.callee.as_member_expression() else {
                continue;
            };
            let Some(method_name @ ("load" | "loadAsync")) =
                static_member_expression_property_name(callee)
            else {
                continue;
            };
            let Some(constructor) =
                three_loader_resolve_constructor(callee.object(), &analysis, ctx, &mut Vec::new())
            else {
                continue;
            };
            if !constructor.constructor_name.ends_with("Loader") {
                continue;
            }

            if method_name == "load" {
                if three_loader_has_explicit_error_callback(call_expression.arguments.get(3))
                    || !constructor.node.arguments.is_empty()
                {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(LOAD_MESSAGE).with_label(node.span()));
                continue;
            }
            if three_loader_async_call_is_unobserved(node, ctx) {
                ctx.diagnostic(OxcDiagnostic::warn(LOAD_ASYNC_MESSAGE).with_label(node.span()));
            }
        }
    }
}

struct ThreeLoaderConstructor<'a, 'b> {
    constructor_name: String,
    node: &'b oxc_ast::ast::NewExpression<'a>,
}

fn three_loader_resolve_constructor<'a, 'b>(
    expression: &'b Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<ThreeLoaderConstructor<'a, 'b>> {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(new_expression) = expression {
        let constructor_name =
            three_loader_candidate_api_name(&new_expression.callee, ctx, &mut Vec::new())?;
        if !module_api_reference_matches(
            &new_expression.callee,
            &constructor_name,
            &THREE_LOADER_MODULES,
            analysis,
            ctx,
        ) && !type_import_module_api_reference_matches(
            &new_expression.callee,
            &constructor_name,
            &THREE_LOADER_MODULES,
            analysis,
            ctx,
        ) {
            return None;
        }
        return Some(ThreeLoaderConstructor {
            constructor_name,
            node: new_expression,
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    three_loader_resolve_constructor(declarator.init.as_ref()?, analysis, ctx, visited_symbol_ids)
}

fn three_loader_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_member_expression_property_name(member).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_loader_candidate_api_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}

fn three_loader_has_explicit_error_callback(argument: Option<&Argument<'_>>) -> bool {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return false;
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => false,
        Expression::Identifier(identifier) if identifier.name == "undefined" => false,
        _ => true,
    }
}

fn three_loader_async_call_is_unobserved(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    if matches!(parent.kind(), AstKind::ExpressionStatement(_)) {
        return true;
    }
    matches!(
        parent.kind(),
        AstKind::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::Void
                && matches!(
                    ctx.nodes().parent_node(parent.id()).kind(),
                    AstKind::ExpressionStatement(_)
                )
    )
}
