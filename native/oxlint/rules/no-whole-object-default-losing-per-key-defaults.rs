use oxc_ast::{
    ast::{
        Argument, BindingPattern, Declaration, Expression, ObjectPropertyKind, Statement,
        TSSignature, TSType, TSTypeName,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This whole-object default is discarded the moment a caller passes any object, so every omitted key becomes undefined instead of falling back. Give each binding its own default instead: `({ a = 1, b = false } = {})`.";

#[derive(Debug, Default, Clone)]
pub struct NoWholeObjectDefaultLosingPerKeyDefaults;

declare_oxc_lint!(
    /// Warns when a whole-object parameter default loses per-key fallbacks.
    NoWholeObjectDefaultLosingPerKeyDefaults,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Whole-object parameter default loses per-key defaults.",
);

impl Rule for NoWholeObjectDefaultLosingPerKeyDefaults {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let type_index = whole_default_build_type_index(ctx);
        for node in ctx.nodes().iter() {
            let parameters = match node.kind() {
                AstKind::Function(function) => &function.params,
                AstKind::ArrowFunctionExpression(function) => &function.params,
                _ => continue,
            };
            for (parameter_index, parameter) in parameters.items.iter().enumerate() {
                let BindingPattern::ObjectPattern(object_pattern) = &parameter.pattern else {
                    continue;
                };
                let Some(initializer) = parameter.initializer.as_ref() else {
                    continue;
                };
                let Expression::ObjectExpression(default_object) =
                    initializer.get_inner_expression()
                else {
                    continue;
                };

                let undefaulted_keys = object_pattern
                    .properties
                    .iter()
                    .filter(|property| {
                        !property.computed
                            && !matches!(property.value, BindingPattern::AssignmentPattern(_))
                    })
                    .filter_map(|property| property.key.static_name().map(|name| name.to_string()))
                    .collect::<FxHashSet<_>>();
                if undefaulted_keys.is_empty() {
                    continue;
                }

                let observable_fallbacks = default_object
                    .properties
                    .iter()
                    .filter_map(|property| {
                        let ObjectPropertyKind::ObjectProperty(property) = property else {
                            return None;
                        };
                        if property.computed {
                            return None;
                        }
                        let key = property.key.static_name()?.to_string();
                        undefaulted_keys
                            .contains(&key)
                            .then_some((key, &property.value))
                    })
                    .filter(|(key, value)| {
                        !whole_default_is_undefined_value(value, ctx)
                            && !whole_default_is_noop_optional_callback(
                                object_pattern,
                                key,
                                value,
                                ctx,
                            )
                    })
                    .collect::<Vec<_>>();
                if observable_fallbacks.is_empty() {
                    continue;
                }
                if parameter
                    .type_annotation
                    .as_ref()
                    .is_some_and(|annotation| {
                        observable_fallbacks.iter().all(|(key, _)| {
                            whole_default_type_requires_property(
                                WholeDefaultType::Type(&annotation.type_annotation),
                                key,
                                &type_index,
                                &mut FxHashSet::default(),
                            )
                        })
                    })
                {
                    continue;
                }

                let at_risk_keys = observable_fallbacks
                    .iter()
                    .map(|(key, _)| key.clone())
                    .collect::<FxHashSet<_>>();
                if whole_default_every_call_site_covers_keys(
                    node.id(),
                    parameter_index,
                    &at_risk_keys,
                    ctx,
                ) {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(Span::new(
                    parameter.pattern.span().start,
                    initializer.span().end,
                )));
            }
        }
    }
}

#[derive(Clone, Copy)]
enum WholeDefaultType<'a> {
    Type(&'a TSType<'a>),
    Interface(&'a oxc_ast::ast::TSInterfaceDeclaration<'a>),
    Alias(&'a oxc_ast::ast::TSTypeAliasDeclaration<'a>),
}

type WholeDefaultTypeIndex<'a> = FxHashMap<String, Vec<WholeDefaultType<'a>>>;

fn whole_default_build_type_index<'a>(ctx: &LintContext<'a>) -> WholeDefaultTypeIndex<'a> {
    let mut type_index = WholeDefaultTypeIndex::default();
    let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
        AstKind::Program(program) => Some(program),
        _ => None,
    }) else {
        return type_index;
    };
    for statement in &program.body {
        let declaration = match statement {
            Statement::TSInterfaceDeclaration(interface) => WholeDefaultType::Interface(interface),
            Statement::TSTypeAliasDeclaration(alias) => WholeDefaultType::Alias(alias),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::TSInterfaceDeclaration(interface) => {
                    WholeDefaultType::Interface(interface)
                }
                Declaration::TSTypeAliasDeclaration(alias) => WholeDefaultType::Alias(alias),
                _ => continue,
            },
            _ => continue,
        };
        let name = match declaration {
            WholeDefaultType::Interface(interface) => interface.id.name.to_string(),
            WholeDefaultType::Alias(alias) => alias.id.name.to_string(),
            WholeDefaultType::Type(_) => continue,
        };
        type_index.entry(name).or_default().push(declaration);
    }
    type_index
}

fn whole_default_is_undefined_value(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        _ => false,
    }
}

fn whole_default_is_noop_optional_callback(
    object_pattern: &oxc_ast::ast::ObjectPattern<'_>,
    fallback_key: &str,
    fallback_value: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !whole_default_is_noop_function(fallback_value, ctx) {
        return false;
    }
    let Some(binding_symbol_id) = object_pattern.properties.iter().find_map(|property| {
        if property.computed || property.key.static_name().as_deref() != Some(fallback_key) {
            return None;
        }
        let BindingPattern::BindingIdentifier(binding) = &property.value else {
            return None;
        };
        Some(binding.symbol_id())
    }) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(binding_symbol_id)
        .all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            matches!(ctx.nodes().parent_node(reference_root.id()).kind(), AstKind::CallExpression(call)
                if call.optional && call.callee.span() == reference_root.span())
        })
}

fn whole_default_is_noop_function(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(body_expression) = function.get_expression() {
                return whole_default_is_undefined_value(body_expression, ctx);
            }
            let oxc_ast::ast::ArrowFunctionBody::FunctionBody(body) = &function.body else {
                return false;
            };
            whole_default_statements_are_noop(&body.statements)
        }
        Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .is_some_and(|body| whole_default_statements_are_noop(&body.statements)),
        _ => false,
    }
}

fn whole_default_statements_are_noop(statements: &[oxc_ast::ast::Statement<'_>]) -> bool {
    statements.iter().all(|statement| {
        matches!(statement, oxc_ast::ast::Statement::EmptyStatement(_))
            || matches!(statement, oxc_ast::ast::Statement::ReturnStatement(return_statement)
                if return_statement.argument.is_none())
    })
}

fn whole_default_type_requires_property(
    resolved: WholeDefaultType<'_>,
    property_name: &str,
    type_index: &WholeDefaultTypeIndex<'_>,
    visited_declaration_starts: &mut FxHashSet<u32>,
) -> bool {
    match resolved {
        WholeDefaultType::Alias(alias) => {
            if !visited_declaration_starts.insert(alias.span.start) {
                return false;
            }
            let result = whole_default_type_requires_property(
                WholeDefaultType::Type(&alias.type_annotation),
                property_name,
                type_index,
                visited_declaration_starts,
            );
            visited_declaration_starts.remove(&alias.span.start);
            result
        }
        WholeDefaultType::Interface(interface) => {
            if !visited_declaration_starts.insert(interface.span.start) {
                return false;
            }
            let result =
                whole_default_members_require_property(&interface.body.body, property_name)
                    || interface.extends.iter().any(|heritage| {
                        if heritage.type_arguments.is_some() {
                            return false;
                        }
                        let Some(type_name) = whole_default_type_name(&heritage.type_name) else {
                            return false;
                        };
                        type_index.get(type_name).is_some_and(|declarations| {
                            declarations.iter().copied().any(|declaration| {
                                whole_default_type_requires_property(
                                    declaration,
                                    property_name,
                                    type_index,
                                    visited_declaration_starts,
                                )
                            })
                        })
                    });
            visited_declaration_starts.remove(&interface.span.start);
            result
        }
        WholeDefaultType::Type(type_node) => match type_node {
            TSType::TSTypeLiteral(literal) => {
                whole_default_members_require_property(&literal.members, property_name)
            }
            TSType::TSIntersectionType(intersection) => intersection.types.iter().any(|member| {
                whole_default_type_requires_property(
                    WholeDefaultType::Type(member),
                    property_name,
                    type_index,
                    visited_declaration_starts,
                )
            }),
            TSType::TSUnionType(union) => union.types.iter().all(|member| {
                whole_default_type_requires_property(
                    WholeDefaultType::Type(member),
                    property_name,
                    type_index,
                    visited_declaration_starts,
                )
            }),
            TSType::TSTypeReference(reference) => {
                let Some(type_name) = whole_default_type_name(&reference.type_name) else {
                    return false;
                };
                type_index.get(type_name).is_some_and(|declarations| {
                    declarations.iter().copied().any(|declaration| {
                        whole_default_type_requires_property(
                            declaration,
                            property_name,
                            type_index,
                            visited_declaration_starts,
                        )
                    })
                })
            }
            _ => false,
        },
    }
}

fn whole_default_type_name<'a>(type_name: &'a TSTypeName<'a>) -> Option<&'a str> {
    let TSTypeName::IdentifierReference(identifier) = type_name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn whole_default_members_require_property(
    members: &[TSSignature<'_>],
    property_name: &str,
) -> bool {
    members.iter().any(|member| match member {
        TSSignature::TSPropertySignature(property) => {
            !property.computed
                && property.key.static_name().as_deref() == Some(property_name)
                && !property.optional
        }
        TSSignature::TSMethodSignature(method) => {
            !method.computed
                && method.key.static_name().as_deref() == Some(property_name)
                && !method.optional
        }
        _ => false,
    })
}

fn whole_default_every_call_site_covers_keys(
    function_id: NodeId,
    parameter_index: usize,
    at_risk_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_symbol_id) = whole_default_unexported_function_symbol(function_id, ctx)
    else {
        return false;
    };
    let mut saw_complete_call = false;
    for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        if matches!(parent.kind(), AstKind::StaticMemberExpression(member)
            if member.property.span == reference_node.span())
        {
            continue;
        }
        if matches!(parent.kind(), AstKind::ObjectProperty(property)
            if !property.computed && !property.shorthand && property.key.span() == reference_node.span())
        {
            continue;
        }
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if call.callee.span() != reference_node.span() {
            return false;
        }
        let argument = call.arguments.get(parameter_index);
        if argument.is_some_and(|argument| {
            !whole_default_call_argument_covers_keys(argument, at_risk_keys, ctx)
        }) {
            return false;
        }
        saw_complete_call = true;
    }
    saw_complete_call
}

fn whole_default_unexported_function_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_id);
    match function_node.kind() {
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let declarator_node = ctx.nodes().parent_node(function_id);
            let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                return None;
            };
            let binding = declarator.id.get_binding_identifier()?;
            let declaration_node = ctx.nodes().parent_node(declarator_node.id());
            if !matches!(declaration_node.kind(), AstKind::VariableDeclaration(_))
                || matches!(
                    ctx.nodes().parent_node(declaration_node.id()).kind(),
                    AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
                )
            {
                return None;
            }
            Some(binding.symbol_id())
        }
        _ => None,
    }
}

fn whole_default_call_argument_covers_keys(
    argument: &Argument<'_>,
    at_risk_keys: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(expression) = argument.as_expression() else {
        return false;
    };
    if whole_default_is_undefined_value(expression, ctx) {
        return true;
    }
    let Expression::ObjectExpression(object) = expression.get_inner_expression() else {
        return false;
    };
    let mut provided_keys = FxHashSet::default();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.computed {
            continue;
        }
        if let Some(property_name) = property.key.static_name() {
            provided_keys.insert(property_name.to_string());
        }
    }
    at_risk_keys.is_subset(&provided_keys)
}
