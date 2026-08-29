use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, ImportDeclarationSpecifier},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct RnNoDimensionsGet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RnDimensionsBindingKind {
    Import(bool),
    Variable,
    Other,
}

#[derive(Debug, Clone, Copy)]
struct RnDimensionsBindingCandidate<'a> {
    owner_id: NodeId,
    declarator_initializer: Option<&'a Expression<'a>>,
    selection_has_initializer: bool,
    kind: RnDimensionsBindingKind,
}

type RnDimensionsBindingIndex<'a> = FxHashMap<&'a str, Vec<RnDimensionsBindingCandidate<'a>>>;

declare_oxc_lint!(
    /// Prefer reactive window dimensions in React Native render code.
    RnNoDimensionsGet,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Dimensions.get over useWindowDimensions.",
);

impl Rule for RnNoDimensionsGet {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let binding_index = rn_dimensions_build_binding_index(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(member) = call.callee.as_member_expression() else {
                continue;
            };
            let Some(method_name) = member_expression_identifier_property_name(member) else {
                continue;
            };
            if !matches!(method_name, "get" | "addEventListener")
                || !rn_dimensions_receiver_matches(member.object(), &binding_index, node, ctx)
            {
                continue;
            }
            if method_name == "get" {
                if !ctx.nodes().ancestors(node.id()).any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                }) || rn_dimensions_inside_style_factory(node, ctx)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Dimensions.get() reads the size once and never updates, so layouts built from it go stale on rotation or resize.",
                    )
                    .with_label(call.span),
                );
            } else {
                ctx.diagnostic(
                    OxcDiagnostic::warn(
                        "Your users hit a crash from Dimensions.addEventListener(), which was removed in React Native 0.72.",
                    )
                    .with_label(call.span),
                );
            }
        }
    }
}

fn rn_dimensions_receiver_matches<'a>(
    receiver: &Expression<'a>,
    binding_index: &RnDimensionsBindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let receiver = receiver.get_inner_expression();
    if let Some(member) = receiver.as_member_expression() {
        return !member.is_computed()
            && member.static_property_name() == Some("Dimensions")
            && rn_dimensions_initializer_module_source_matches(member.object(), ctx);
    }
    let Expression::Identifier(identifier) = receiver else {
        return false;
    };
    let Some(candidate) =
        rn_dimensions_resolve_binding_candidate(identifier.name.as_str(), binding_index, node, ctx)
    else {
        return identifier.name == "Dimensions";
    };
    match candidate.kind {
        RnDimensionsBindingKind::Import(matches_dimensions) => matches_dimensions,
        RnDimensionsBindingKind::Other => false,
        RnDimensionsBindingKind::Variable => {
            candidate.declarator_initializer.is_none_or(|initializer| {
                rn_dimensions_initializer_module_source_matches(initializer, ctx)
            })
        }
    }
}

fn rn_dimensions_build_binding_index<'a>(ctx: &LintContext<'a>) -> RnDimensionsBindingIndex<'a> {
    let mut binding_index = FxHashMap::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let declaration = ctx.nodes().parent_node(node.id());
                let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
                    continue;
                };
                let Some(owner_id) = rn_dimensions_binding_owner_id(
                    node.id(),
                    !variable_declaration.kind.is_var(),
                    ctx,
                ) else {
                    continue;
                };
                rn_dimensions_collect_bindings(
                    &declarator.id,
                    declarator.init.as_ref(),
                    declarator.init.is_some(),
                    RnDimensionsBindingKind::Variable,
                    owner_id,
                    &mut binding_index,
                );
            }
            AstKind::FormalParameter(parameter) => {
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_collect_bindings(
                    &parameter.pattern,
                    None,
                    false,
                    RnDimensionsBindingKind::Other,
                    owner_id,
                    &mut binding_index,
                );
            }
            AstKind::Function(function) => {
                let Some(identifier) = &function.id else {
                    continue;
                };
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_push_binding_candidate(
                    identifier.name.as_str(),
                    RnDimensionsBindingCandidate {
                        owner_id,
                        declarator_initializer: None,
                        selection_has_initializer: true,
                        kind: RnDimensionsBindingKind::Other,
                    },
                    &mut binding_index,
                );
            }
            AstKind::Class(class) => {
                let Some(identifier) = &class.id else {
                    continue;
                };
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_push_binding_candidate(
                    identifier.name.as_str(),
                    RnDimensionsBindingCandidate {
                        owner_id,
                        declarator_initializer: None,
                        selection_has_initializer: true,
                        kind: RnDimensionsBindingKind::Other,
                    },
                    &mut binding_index,
                );
            }
            AstKind::ImportDeclaration(declaration) => {
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                for specifier in declaration.specifiers.iter().flatten() {
                    let (local_name, imported_name_matches) = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => (
                            specifier.local.name.as_str(),
                            specifier.imported.name().as_str() == "Dimensions",
                        ),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                            (specifier.local.name.as_str(), true)
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            (specifier.local.name.as_str(), true)
                        }
                    };
                    rn_dimensions_push_binding_candidate(
                        local_name,
                        RnDimensionsBindingCandidate {
                            owner_id,
                            declarator_initializer: None,
                            selection_has_initializer: true,
                            kind: RnDimensionsBindingKind::Import(
                                declaration.source.value == "react-native" && imported_name_matches,
                            ),
                        },
                        &mut binding_index,
                    );
                }
            }
            AstKind::TSImportEqualsDeclaration(declaration) => {
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_push_binding_candidate(
                    declaration.id.name.as_str(),
                    RnDimensionsBindingCandidate {
                        owner_id,
                        declarator_initializer: None,
                        selection_has_initializer: false,
                        kind: RnDimensionsBindingKind::Other,
                    },
                    &mut binding_index,
                );
            }
            AstKind::TSEnumDeclaration(declaration) => {
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_push_binding_candidate(
                    declaration.id.name.as_str(),
                    RnDimensionsBindingCandidate {
                        owner_id,
                        declarator_initializer: None,
                        selection_has_initializer: false,
                        kind: RnDimensionsBindingKind::Other,
                    },
                    &mut binding_index,
                );
            }
            AstKind::TSNamespaceDeclaration(declaration) => {
                let Some(owner_id) = rn_dimensions_binding_owner_id(node.id(), false, ctx) else {
                    continue;
                };
                rn_dimensions_push_binding_candidate(
                    declaration.id.name.as_str(),
                    RnDimensionsBindingCandidate {
                        owner_id,
                        declarator_initializer: None,
                        selection_has_initializer: false,
                        kind: RnDimensionsBindingKind::Other,
                    },
                    &mut binding_index,
                );
            }
            _ => {}
        }
    }
    binding_index
}

fn rn_dimensions_binding_owner_id(
    node_id: NodeId,
    is_block_scoped: bool,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if is_block_scoped && matches!(ancestor.kind(), AstKind::BlockStatement(_)) {
            let parent = ctx.nodes().parent_node(ancestor.id());
            if !matches!(
                parent.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                return Some(ancestor.id());
            }
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
        ) {
            return Some(ancestor.id());
        }
    }
    None
}

fn rn_dimensions_collect_bindings<'a>(
    pattern: &'a BindingPattern<'a>,
    declarator_initializer: Option<&'a Expression<'a>>,
    selection_has_initializer: bool,
    kind: RnDimensionsBindingKind,
    owner_id: NodeId,
    binding_index: &mut RnDimensionsBindingIndex<'a>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            rn_dimensions_push_binding_candidate(
                identifier.name.as_str(),
                RnDimensionsBindingCandidate {
                    owner_id,
                    declarator_initializer,
                    selection_has_initializer,
                    kind,
                },
                binding_index,
            );
        }
        BindingPattern::AssignmentPattern(assignment) => rn_dimensions_collect_bindings(
            &assignment.left,
            declarator_initializer,
            true,
            kind,
            owner_id,
            binding_index,
        ),
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                rn_dimensions_collect_bindings(
                    &property.value,
                    declarator_initializer,
                    matches!(property.value, BindingPattern::AssignmentPattern(_)),
                    kind,
                    owner_id,
                    binding_index,
                );
            }
            if let Some(rest) = &pattern.rest {
                rn_dimensions_collect_bindings(
                    &rest.argument,
                    declarator_initializer,
                    false,
                    kind,
                    owner_id,
                    binding_index,
                );
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                rn_dimensions_collect_bindings(
                    element,
                    declarator_initializer,
                    matches!(element, BindingPattern::AssignmentPattern(_)),
                    kind,
                    owner_id,
                    binding_index,
                );
            }
            if let Some(rest) = &pattern.rest {
                rn_dimensions_collect_bindings(
                    &rest.argument,
                    declarator_initializer,
                    false,
                    kind,
                    owner_id,
                    binding_index,
                );
            }
        }
    }
}

fn rn_dimensions_push_binding_candidate<'a>(
    name: &'a str,
    candidate: RnDimensionsBindingCandidate<'a>,
    binding_index: &mut RnDimensionsBindingIndex<'a>,
) {
    binding_index.entry(name).or_default().push(candidate);
}

fn rn_dimensions_resolve_binding_candidate<'a>(
    name: &str,
    binding_index: &RnDimensionsBindingIndex<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<RnDimensionsBindingCandidate<'a>> {
    let candidates = binding_index.get(name)?;
    if let [only_candidate] = candidates.as_slice() {
        return ctx
            .nodes()
            .ancestors(node.id())
            .any(|ancestor| ancestor.id() == only_candidate.owner_id)
            .then_some(*only_candidate);
    }
    ctx.nodes().ancestors(node.id()).find_map(|owner| {
        let mut best_candidate = None::<RnDimensionsBindingCandidate<'a>>;
        for candidate in candidates
            .iter()
            .filter(|candidate| candidate.owner_id == owner.id())
        {
            if best_candidate.is_none()
                || candidate.selection_has_initializer
                || best_candidate.is_some_and(|best| !best.selection_has_initializer)
            {
                best_candidate = Some(*candidate);
            }
        }
        best_candidate
    })
}

fn rn_dimensions_initializer_module_source_matches(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut root = expression.get_inner_expression();
    while let Some(member) = root.as_member_expression() {
        root = member.object().get_inner_expression();
    }
    if let Expression::CallExpression(call) = root
        && let Expression::Identifier(require_identifier) = call.callee.get_inner_expression()
        && require_identifier.name == "require"
        && call
            .common_js_require()
            .is_some_and(|source| source.value == "react-native")
    {
        return true;
    }
    let Expression::Identifier(identifier) = root else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "react-native"
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
            && entry.local_name.name() == identifier.name
    })
}

fn rn_dimensions_inside_style_factory<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(function_node) = crate::ast_util::get_enclosing_function(node, ctx) else {
        return false;
    };
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    if !call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|argument| argument.span() == function_node.span())
    }) {
        return false;
    }
    rn_dimensions_flatten_callee(&call.callee).is_some_and(|name| {
        name.rsplit('.').next().is_some_and(|last| {
            matches!(
                last,
                "makeStyles" | "makeUseStyles" | "createStyles" | "createUseStyles"
            )
        })
    })
}

fn rn_dimensions_flatten_callee(expression: &Expression<'_>) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return Some(identifier.name.to_string());
    }
    let member = expression.as_member_expression()?;
    if member.is_computed() {
        return None;
    }
    Some(format!(
        "{}.{}",
        rn_dimensions_flatten_callee(member.object())?,
        member.static_property_name()?
    ))
}
