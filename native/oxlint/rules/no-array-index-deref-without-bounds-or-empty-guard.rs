use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, JSXAttributeName, MemberExpression, RegExpFlags,
        PropertyKey, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This dereferences an array index result that can be undefined at runtime (empty list, no regex match, or a short split), which throws `Cannot read properties of undefined`. Guard with a length/emptiness check or optional chaining before the access.";

#[derive(Debug, Default, Clone)]
pub struct NoArrayIndexDerefWithoutBoundsOrEmptyGuard;

declare_oxc_lint!(
    /// Disallow dereferencing empty-prone indexed reads without a guard.
    NoArrayIndexDerefWithoutBoundsOrEmptyGuard,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Array index result dereferenced without a guard.",
);

impl Rule for NoArrayIndexDerefWithoutBoundsOrEmptyGuard {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_non_source_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some((outer_object, outer_is_optional)) = member_for_node(node) else {
            return;
        };
        if outer_is_optional {
            return;
        }
        let Some(MemberExpression::ComputedMemberExpression(index_read)) =
            outer_object.get_inner_expression().as_member_expression()
        else {
            return;
        };
        if index_read.optional {
            return;
        }
        let index = numeric_index(&index_read.expression);
        let base = index_read.object.get_inner_expression();

        if let Expression::CallExpression(call) = base {
            if let Some((regex_pattern, regex_flags)) = regex_result_pattern(call) {
                if index == Some(0.0) && regex_is_always_matching(regex_pattern, regex_flags) {
                    return;
                }
                if index.is_some_and(|part_index| {
                    part_index >= 0.0
                        && part_index.fract() == 0.0
                        && !regex_result_is_global(call)
                        && capture_is_definitely_present(regex_pattern, part_index as usize)
                }) && repeated_call_is_guarded(node, call, ctx)
                {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
                return;
            }

            if split_call(call) && index.is_some_and(|part_index| part_index >= 1.0) {
                let index = index.unwrap_or_default();
                if split_part_is_statically_present(call, index)
                    || split_part_has_known_format(call, index, ctx)
                    || split_part_is_guarded(node, call, index, ctx)
                    || split_part_is_filtered(node, call, ctx)
                {
                    return;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
                return;
            }
        }

        if touch_list_access(base)
            && inside_touch_end_handler(node, ctx)
            && !touch_read_is_guarded(node, base, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(node.span()));
        }
    }
}

fn member_for_node<'a, 'b>(node: &'b AstNode<'a>) -> Option<(&'b Expression<'a>, bool)> {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => Some((&member.object, member.optional)),
        AstKind::ComputedMemberExpression(member) => Some((&member.object, member.optional)),
        AstKind::PrivateFieldExpression(member) => Some((&member.object, false)),
        _ => None,
    }
}

fn numeric_index(expression: &Expression<'_>) -> Option<f64> {
    let Expression::NumericLiteral(literal) = expression.get_inner_expression() else {
        return None;
    };
    Some(literal.value)
}

fn regex_result_pattern<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<(&'a str, RegExpFlags)> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    match member.static_property_name().as_deref()? {
        "exec" => match member.object().get_inner_expression() {
            Expression::RegExpLiteral(regex) => {
                Some((regex.regex.pattern.text.as_str(), regex.regex.flags))
            }
            _ => None,
        },
        "match" => match call
            .arguments
            .first()?
            .as_expression()?
            .get_inner_expression()
        {
            Expression::RegExpLiteral(regex) => {
                Some((regex.regex.pattern.text.as_str(), regex.regex.flags))
            }
            _ => None,
        },
        _ => None,
    }
}

fn regex_result_is_global(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let regex = match member.static_property_name().as_deref() {
        Some("exec") => member.object().get_inner_expression(),
        Some("match") => match call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .map(Expression::get_inner_expression)
        {
            Some(regex) => regex,
            None => return false,
        },
        _ => return false,
    };
    matches!(regex, Expression::RegExpLiteral(regex) if regex.regex.flags.contains(RegExpFlags::G))
}

fn regex_is_always_matching(pattern: &str, flags: RegExpFlags) -> bool {
    let (has_start_anchor, without_start_anchor) = pattern
        .strip_prefix('^')
        .map_or((false, pattern), |remaining| (true, remaining));
    let (has_end_anchor, without_anchors) = without_start_anchor
        .strip_suffix('$')
        .map_or((false, without_start_anchor), |remaining| (true, remaining));
    let Some(atom) = without_anchors.strip_suffix('*') else {
        return false;
    };
    let is_single_atom = atom == "."
        || atom.strip_prefix('\\').is_some_and(|escaped| {
            escaped.len() == 1 && escaped.as_bytes()[0].is_ascii_alphabetic()
        })
        || atom.starts_with('[')
            && atom.ends_with(']')
            && atom[1..atom.len() - 1].find(']').is_none();
    if !is_single_atom {
        return false;
    }
    let must_reach_end_boundary =
        has_end_anchor && (has_start_anchor || flags.contains(RegExpFlags::Y));
    if !must_reach_end_boundary {
        return true;
    }
    matches!(
        atom,
        "[^]" | "[\\s\\S]" | "[\\S\\s]" | "[\\d\\D]" | "[\\D\\d]" | "[\\w\\W]" | "[\\W\\w]"
    ) || atom == "." && (flags.contains(RegExpFlags::S) || flags.contains(RegExpFlags::M))
        || flags.contains(RegExpFlags::M)
            && matches!(atom, "[^\\n]" | "[^\\r]" | "[^\\r\\n]" | "[^\\n\\r]")
}

fn capture_is_definitely_present(pattern: &str, capture_index: usize) -> bool {
    if capture_index == 0 {
        return true;
    }
    if pattern.contains('|') {
        return false;
    }
    let bytes = pattern.as_bytes();
    let mut escaped = false;
    let mut character_class = false;
    let mut capture_count = 0;
    let mut target_depth = None;
    let mut group_stack = Vec::new();
    for (index, byte) in bytes.iter().copied().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            continue;
        }
        if byte == b'[' {
            character_class = true;
            continue;
        }
        if byte == b']' {
            character_class = false;
            continue;
        }
        if character_class {
            continue;
        }
        if byte == b'(' {
            let suffix = &pattern[index + 1..];
            let capturing = !suffix.starts_with('?')
                || suffix.starts_with("?<")
                    && !suffix.starts_with("?<=")
                    && !suffix.starts_with("?<!");
            group_stack.push(index);
            if capturing {
                capture_count += 1;
                if capture_count == capture_index {
                    target_depth = Some(group_stack.len());
                }
            }
        } else if byte == b')' {
            let depth = group_stack.len();
            group_stack.pop();
            if target_depth.is_some_and(|target| depth <= target) {
                let suffix = &pattern[index + 1..];
                if suffix.starts_with('?')
                    || suffix.starts_with('*')
                    || suffix.starts_with("{0,")
                    || suffix.starts_with("{0}")
                {
                    return false;
                }
            }
        }
    }
    capture_count >= capture_index
}

fn split_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call.callee
        .get_inner_expression()
        .as_member_expression()
        .is_some_and(|member| member.static_property_name().as_deref() == Some("split"))
}

fn split_part_is_statically_present(call: &oxc_ast::ast::CallExpression<'_>, index: f64) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Expression::StringLiteral(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(Expression::StringLiteral(delimiter)) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    receiver.value.split(delimiter.value.as_str()).count() as f64 > index
}

fn split_part_has_known_format(
    call: &oxc_ast::ast::CallExpression<'_>,
    index: f64,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(Expression::StringLiteral(delimiter)) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let receiver = member.object().get_inner_expression();
    let is_global_date_iso_string = matches!(receiver, Expression::CallExpression(receiver_call)
    if receiver_call.callee.get_inner_expression().as_member_expression().is_some_and(|to_iso_string| {
        to_iso_string.static_property_name().as_deref() == Some("toISOString")
            && matches!(to_iso_string.object().get_inner_expression(), Expression::NewExpression(construction)
                if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "Date" && ctx.is_reference_to_global_variable(identifier)))
    }));
    let is_global_window_pathname = receiver
        .as_member_expression()
        .is_some_and(|pathname| {
            pathname.static_property_name().as_deref() == Some("pathname")
                && pathname.object().as_member_expression().is_some_and(|location| {
                    location.static_property_name().as_deref() == Some("location")
                        && matches!(location.object().get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "window" && ctx.is_reference_to_global_variable(identifier))
                })
        });
    (is_global_date_iso_string
        && ((matches!(delimiter.value.as_str(), "T" | ".") && index <= 1.0)
            || (matches!(delimiter.value.as_str(), ":" | "-") && index <= 2.0)))
        || is_global_window_pathname && delimiter.value == "/" && index == 1.0
}

fn split_part_is_guarded(
    node: &AstNode<'_>,
    call: &oxc_ast::ast::CallExpression<'_>,
    index: f64,
    ctx: &LintContext<'_>,
) -> bool {
    let call_source = compact_source(ctx.source_range(call.span));
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let receiver = compact_source(ctx.source_range(member.object().span()));
    let delimiter = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(|argument| compact_source(ctx.source_range(argument.span())))
        .unwrap_or_default();
    let delimiter_value = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
        .and_then(|argument| match argument {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        });
    if alternate_guard_sources(node, ctx).iter().any(|source| {
        let compact = compact_source(&source);
        let includes_call = format!("{receiver}.includes({delimiter})");
        compact.contains(&format!("!{includes_call}"))
            || compact.contains(&format!("{receiver}.indexOf({delimiter})===-1"))
            || compact.contains(&format!("{receiver}.indexOf({delimiter})==-1"))
    }) {
        return true;
    }
    guard_sources(node, ctx).iter().any(|source| {
        let compact = compact_source(&source);
        let includes_call = format!("{receiver}.includes({delimiter})");
        let positive_includes =
            compact.contains(&includes_call) && !compact.contains(&format!("!{includes_call}"));
        let early_exit_includes = compact.contains(&format!("if(!{includes_call})return"))
            || compact.contains(&format!("if(!{includes_call})throw"))
            || compact.contains(&format!("if(!{includes_call}){{return"))
            || compact.contains(&format!("if(!{includes_call}){{throw"));
        positive_includes
            || early_exit_includes
            || compact.contains(&format!("{receiver}.indexOf({delimiter})!==-1"))
            || compact.contains(&format!("{call_source}.length>{index}"))
            || compact.contains(&format!("{call_source}.length>={}", index + 1.0))
            || delimiter_value.is_some_and(|delimiter_value| {
                regex_guard_proves_delimiter(&compact, &receiver, delimiter_value)
            })
    })
}

fn regex_guard_proves_delimiter(source: &str, receiver: &str, delimiter: &str) -> bool {
    let test_suffix = format!(".test({receiver})");
    let Some(test_index) = source.find(&test_suffix) else {
        return false;
    };
    let prefix = &source[..test_index];
    let Some(pattern_end) = prefix.rfind('/') else {
        return false;
    };
    let Some(pattern_start) = prefix[..pattern_end].rfind('/') else {
        return false;
    };
    let pattern = &prefix[pattern_start + 1..pattern_end];
    if pattern.contains('|')
        || pattern.contains('?')
        || pattern.contains('*')
        || pattern.contains("{0")
    {
        return false;
    }
    let escaped_delimiter = delimiter
        .chars()
        .flat_map(|character| {
            if "\\^$.*+?()[]{}|/".contains(character) {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect::<String>();
    pattern.contains(&escaped_delimiter)
}

fn split_part_is_filtered(
    node: &AstNode<'_>,
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(function) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
        )
    }) else {
        return false;
    };
    let Some(parameter_name) = first_function_parameter_name(function) else {
        return false;
    };
    if parameter_name != receiver.name {
        return false;
    }
    let iteration_call_node = ctx.nodes().parent_node(function.id());
    let AstKind::CallExpression(iteration_call) = iteration_call_node.kind() else {
        return false;
    };
    if !iteration_call.arguments.iter().any(|argument| argument.span() == function.span()) {
        return false;
    }
    let Some(iteration_member) = iteration_call.callee.as_member_expression() else {
        return false;
    };
    if !matches!(
        iteration_member.static_property_name().as_deref(),
        Some("map" | "forEach" | "flatMap")
    ) {
        return false;
    }
    let split_delimiter = call.arguments.first().and_then(Argument::as_expression);
    let mut iteration_receiver = iteration_member.object().get_inner_expression();
    while let Expression::CallExpression(receiver_call) = iteration_receiver {
        let Some(receiver_member) = receiver_call.callee.as_member_expression() else {
            break;
        };
        if receiver_member.static_property_name().as_deref() == Some("filter") {
            let Some(filter_callback) = receiver_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                return false;
            };
            let Some((filter_parameter_name, predicate)) = filter_callback_parts(filter_callback)
            else {
                return false;
            };
            let Expression::CallExpression(predicate_call) = predicate.get_inner_expression()
            else {
                return false;
            };
            let Some(predicate_member) = predicate_call.callee.as_member_expression() else {
                return false;
            };
            let Expression::Identifier(predicate_receiver) =
                predicate_member.object().get_inner_expression()
            else {
                return false;
            };
            return predicate_member.static_property_name().as_deref() == Some("includes")
                && predicate_receiver.name == filter_parameter_name
                && expressions_have_same_source(
                    predicate_call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression),
                    split_delimiter,
                    ctx,
                );
        }
        iteration_receiver = receiver_member.object().get_inner_expression();
    }
    false
}

fn first_function_parameter_name<'a>(function: &AstNode<'a>) -> Option<&'a str> {
    let parameter = match function.kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    }?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn filter_callback_parts<'a>(callback: &'a Expression<'a>) -> Option<(&'a str, &'a Expression<'a>)> {
    let (parameters, expression) = match callback {
        Expression::ArrowFunctionExpression(function) => {
            (function.params.items.as_slice(), function.get_expression()?)
        }
        Expression::FunctionExpression(function) => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() || body.statements.len() != 1 {
                return None;
            }
            let Statement::ReturnStatement(statement) = &body.statements[0] else {
                return None;
            };
            (function.params.items.as_slice(), statement.argument.as_ref()?)
        }
        _ => return None,
    };
    let BindingPattern::BindingIdentifier(parameter) = &parameters.first()?.pattern else {
        return None;
    };
    Some((parameter.name.as_str(), expression))
}

fn expressions_have_same_source(
    first: Option<&Expression<'_>>,
    second: Option<&Expression<'_>>,
    ctx: &LintContext<'_>,
) -> bool {
    first.zip(second).is_some_and(|(first, second)| {
        compact_source(ctx.source_range(first.span()))
            == compact_source(ctx.source_range(second.span()))
    })
}

fn repeated_call_is_guarded(
    node: &AstNode<'_>,
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let call_source = compact_source(ctx.source_range(call.span));
    if alternate_guard_sources(node, ctx).iter().any(|source| {
        let guard = compact_source(&source);
        guard.contains(&format!("!{call_source}"))
            || guard.contains(&format!("{call_source}===null"))
            || guard.contains(&format!("{call_source}==null"))
    }) {
        return true;
    }
    guard_sources(node, ctx).iter().any(|source| {
        let guard = compact_source(source);
        let positive_guard = guard.contains(&call_source)
            && !guard.contains(&format!("!{call_source}"))
            && !guard.contains(&format!("{call_source}===null"))
            && !guard.contains(&format!("{call_source}==null"));
        let completed_negative_early_exit = [
            format!("if(!{call_source})return"),
            format!("if(!{call_source})throw"),
            format!("if({call_source}===null)return"),
            format!("if({call_source}==null)return"),
        ]
        .iter()
        .any(|pattern| guard.contains(pattern));
        positive_guard || completed_negative_early_exit
    })
}

fn touch_list_access(expression: &Expression<'_>) -> bool {
    expression
        .as_member_expression()
        .and_then(|member| member.static_property_name())
        .is_some_and(|name| {
            matches!(
                name.as_ref(),
                "changedTouches" | "touches" | "targetTouches"
            )
        })
}

fn inside_touch_end_handler(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(function) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
        )
    }) else {
        return false;
    };
    let parent = ctx.nodes().parent_node(function.id());
    let is_direct_handler = match parent.kind() {
        AstKind::CallExpression(call) => is_touch_end_listener_call(call, function.span()),
        AstKind::JSXExpressionContainer(_) => {
            let attribute = ctx.nodes().parent_node(parent.id());
            matches!(attribute.kind(), AstKind::JSXAttribute(attribute)
                if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if matches!(identifier.name.to_ascii_lowercase().as_str(), "ontouchend" | "ontouchcancel")))
        }
        AstKind::ObjectProperty(property) => matches!(&property.key,
            PropertyKey::StaticIdentifier(identifier)
                if matches!(identifier.name.to_ascii_lowercase().as_str(), "ontouchend" | "ontouchcancel")),
        AstKind::AssignmentExpression(assignment) => matches!(
            assignment.left.as_member_expression(),
            Some(MemberExpression::StaticMemberExpression(member))
                if matches!(member.property.name.to_ascii_lowercase().as_str(), "ontouchend" | "ontouchcancel")
        ),
        _ => false,
    };
    is_direct_handler
        || touch_handler_symbol_id(function, ctx).is_some_and(|symbol_id| {
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let parent = ctx.nodes().parent_node(reference_node.id());
                    matches!(parent.kind(), AstKind::CallExpression(call) if is_touch_end_listener_call(call, reference_node.span()))
                })
        })
}

fn touch_handler_symbol_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<SymbolId> {
    match node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(node.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        _ => None,
    }
}

fn is_touch_end_listener_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    handler_span: oxc_span::Span,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some("addEventListener") {
        return false;
    }
    let Some(Expression::StringLiteral(event_name)) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    matches!(event_name.value.as_str(), "touchend" | "touchcancel")
        && call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
            .is_some_and(|handler| handler.span() == handler_span)
}

fn touch_read_is_guarded(
    node: &AstNode<'_>,
    touch_list: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let source = compact_source(ctx.source_range(touch_list.span()));
    if alternate_guard_sources(node, ctx).iter().any(|guard| {
        let guard = compact_source(&guard);
        guard.contains(&format!("{source}.length===0"))
            || guard.contains(&format!("{source}.length==0"))
            || guard.contains(&format!("!{source}.length"))
    }) {
        return true;
    }
    guard_sources(node, ctx).iter().any(|guard| {
        let guard = compact_source(&guard);
        let positive_length = guard.contains(&format!("{source}.length"))
            && !guard.contains(&format!("{source}.length===0"))
            && !guard.contains(&format!("{source}.length==0"));
        let completed_empty_early_exit = [
            format!("if({source}.length===0)return"),
            format!("if({source}.length==0)return"),
            format!("if(!{source}.length)return"),
            format!("if({source}.length===0){{return"),
            format!("if(!{source}.length){{return"),
        ]
        .iter()
        .any(|pattern| guard.contains(pattern));
        positive_length || completed_empty_early_exit || guard.contains(&format!("{source}[0]"))
    })
}

fn guard_sources(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Vec<String> {
    let mut sources = Vec::new();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(node.span()) =>
            {
                sources.push(resolved_guard_source(&statement.test, ctx));
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span().contains_inclusive(node.span()) =>
            {
                sources.push(resolved_guard_source(&expression.test, ctx));
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(node.span()) =>
            {
                sources.push(resolved_guard_source(&expression.left, ctx));
            }
            _ => {}
        }
    }
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => continue,
        };
        let containing_statement_start = statements
                .iter()
                .find(|statement| statement.span().contains_inclusive(node.span()))
                .map_or(node.span().start, |statement| statement.span().start);
        for statement in statements.iter().filter(|statement| {
            statement.span().end <= containing_statement_start
                && matches!(statement, Statement::IfStatement(statement)
                    if statement.alternate.is_none()
                        && statement_always_exits(&statement.consequent))
        }) {
            sources.push(ctx.source_range(statement.span()).to_owned());
        }
    }
    sources
}

fn alternate_guard_sources(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Vec<String> {
    let mut sources = Vec::new();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(node.span())) =>
            {
                sources.push(resolved_guard_source(&statement.test, ctx));
            }
            AstKind::ConditionalExpression(expression)
                if expression.alternate.span().contains_inclusive(node.span()) =>
            {
                sources.push(resolved_guard_source(&expression.test, ctx));
            }
            _ => {}
        }
    }
    sources
}

fn resolved_guard_source<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> String {
    let expression = expression.get_inner_expression();
    let resolved = match expression {
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).unwrap_or(expression)
        }
        _ => expression,
    };
    ctx.source_range(resolved.span()).to_owned()
}

fn compact_source(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}
