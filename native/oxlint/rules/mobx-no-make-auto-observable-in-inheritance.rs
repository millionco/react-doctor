use oxc_ast::{
    AstKind,
    ast::{Argument, Class, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "MobX does not support `makeAutoObservable(this)` in inherited classes. Use composition or explicit `makeObservable` annotations.";
const MOBX_MODULE_SOURCES: [&str; 1] = ["mobx"];

#[derive(Debug, Default, Clone)]
pub struct MobxNoMakeAutoObservableInInheritance;

declare_oxc_lint!(
    /// Disallow makeAutoObservable(this) in inherited classes.
    MobxNoMakeAutoObservableInInheritance,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Unsupported MobX auto-observable inheritance.",
);

impl Rule for MobxNoMakeAutoObservableInInheritance {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "mobx:6") {
            return;
        }
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        let subclassed_class_symbol_ids = collect_subclassed_class_symbol_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "makeAutoObservable",
                &MOBX_MODULE_SOURCES,
                &property_write_analysis,
                ctx,
            ) || !call_expression
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|target| {
                    matches!(target.get_inner_expression(), Expression::ThisExpression(_))
                })
            {
                continue;
            }
            let Some(class_node_id) = enclosing_instance_class_node_id(node, ctx) else {
                continue;
            };
            let class_node = ctx.nodes().get_node(class_node_id);
            let AstKind::Class(class) = class_node.kind() else {
                continue;
            };
            let is_subclassed = class_binding_symbol_id(class_node, class, ctx)
                .is_some_and(|symbol_id| subclassed_class_symbol_ids.contains(&symbol_id));
            if !has_non_null_superclass(class) && !is_subclassed {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn collect_subclassed_class_symbol_ids(ctx: &LintContext<'_>) -> FxHashSet<SymbolId> {
    ctx.nodes()
        .iter()
        .filter_map(|node| {
            let AstKind::Class(class) = node.kind() else {
                return None;
            };
            let superclass = class.heritage_expression()?.get_inner_expression();
            if matches!(superclass, Expression::NullLiteral(_)) {
                return None;
            }
            let Expression::Identifier(identifier) = superclass else {
                return None;
            };
            let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
            is_class_binding_symbol(symbol_id, ctx).then_some(symbol_id)
        })
        .collect()
}

fn is_class_binding_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Class(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            let parent = ctx.nodes().parent_node(declaration.id());
            matches!(
                parent.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && matches!(
                    declarator
                        .init
                        .as_ref()
                        .map(Expression::get_inner_expression),
                    Some(Expression::ClassExpression(_))
                )
        }
        _ => false,
    }
}

fn enclosing_instance_class_node_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::ArrowFunctionExpression(_) => {}
            AstKind::Function(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                return match parent.kind() {
                    AstKind::MethodDefinition(method) if !method.r#static => {
                        enclosing_class_node_id(parent, ctx)
                    }
                    AstKind::PropertyDefinition(property) if !property.r#static => {
                        enclosing_class_node_id(parent, ctx)
                    }
                    _ => None,
                };
            }
            AstKind::PropertyDefinition(property) => {
                return (!property.r#static)
                    .then(|| enclosing_class_node_id(ancestor, ctx))
                    .flatten();
            }
            _ => {}
        }
    }
    None
}

fn enclosing_class_node_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find_map(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)).then(|| ancestor.id()))
}

fn class_binding_symbol_id(
    class_node: &AstNode<'_>,
    class: &Class<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(class_node.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && let Some(binding) = declarator.id.get_binding_identifier()
    {
        return Some(binding.symbol_id());
    }
    class.id.as_ref().map(|identifier| identifier.symbol_id())
}

fn has_non_null_superclass(class: &Class<'_>) -> bool {
    class.heritage_expression().is_some_and(|superclass| {
        !matches!(
            superclass.get_inner_expression(),
            Expression::NullLiteral(_)
        )
    })
}
