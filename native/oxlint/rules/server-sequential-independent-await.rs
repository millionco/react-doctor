use oxc_ast::{
    AstKind,
    ast::{Expression, Statement, VariableDeclaration},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str =
    "This await doesn't use the previous result, so your users wait twice as long for nothing.";
const GATE_LEADING_VERBS: &[&str] = &[
    "require",
    "ensure",
    "assert",
    "verify",
    "validate",
    "check",
    "connect",
    "disconnect",
    "begin",
    "acquire",
    "lock",
    "init",
    "initialize",
    "setup",
    "authorize",
    "authenticate",
];
const INTENTIONAL_SEQUENCING_CALLEE_NAMES: &[&str] = &[
    "sleep",
    "delay",
    "wait",
    "pause",
    "throttle",
    "debounce",
    "tick",
    "nextTick",
    "advanceTimersByTime",
    "advanceTimersByTimeAsync",
    "runAllTimers",
    "runAllTimersAsync",
    "runOnlyPendingTimers",
    "runOnlyPendingTimersAsync",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "yieldNow",
    "yieldTo",
    "yieldToBrowser",
    "slice",
    "sliceYield",
    "nextFrame",
    "breathe",
    "onYield",
    "onProgress",
    "progress",
    "onStep",
    "step",
    "stage",
    "runStage",
    "animate",
    "transition",
    "spring",
    "tween",
    "stagger",
    "sequence",
    "timeline",
    "scrub",
    "query",
    "execute",
    "exec",
    "raw",
    "transaction",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "lock",
    "unlock",
    "spawn",
    "spawnSync",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
    "$",
    "sh",
    "mkdir",
    "rmdir",
    "rename",
    "rm",
    "unlink",
    "writeFile",
    "appendFile",
    "copyFile",
    "navigate",
    "goto",
    "waitForNavigation",
    "waitForURL",
    "waitForLoadState",
    "waitForResponse",
    "waitForRequest",
    "waitForSelector",
    "waitForFunction",
    "waitForEvent",
];

#[derive(Debug, Default, Clone)]
pub struct ServerSequentialIndependentAwait;

declare_oxc_lint!(
    /// Warn about adjacent independent awaits in async server functions.
    ServerSequentialIndependentAwait,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Sequential independent awaits.",
);

impl Rule for ServerSequentialIndependentAwait {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for node in ctx.nodes().iter() {
            let statements = match node.kind() {
                AstKind::Function(function) if function.r#async => {
                    let Some(body) = function.body.as_deref() else {
                        continue;
                    };
                    body.statements.as_slice()
                }
                AstKind::ArrowFunctionExpression(function) if function.r#async => {
                    let Some(body) = function.body.as_function_body() else {
                        continue;
                    };
                    body.statements.as_slice()
                }
                _ => continue,
            };
            server_sequential_inspect_statements(statements, ctx, &mut resolution_cache);
        }
    }
}

fn server_sequential_inspect_statements<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) {
    let mut statement_index = 0;
    while statement_index + 1 < statements.len() {
        let Statement::VariableDeclaration(current) = &statements[statement_index] else {
            statement_index += 1;
            continue;
        };
        if !server_sequential_declaration_starts_with_await(current) {
            statement_index += 1;
            continue;
        }
        let Statement::VariableDeclaration(next) = &statements[statement_index + 1] else {
            statement_index += 1;
            continue;
        };
        if !server_sequential_declaration_starts_with_await(next) {
            statement_index += 1;
            continue;
        }
        let declared_symbols = current
            .declarations
            .iter()
            .flat_map(|declarator| declarator.id.get_binding_identifiers())
            .map(|identifier| identifier.symbol_id())
            .collect::<FxHashSet<_>>();
        if server_sequential_declaration_reads_symbols(next, &declared_symbols, ctx)
            || server_sequential_declaration_awaits_existing_promise(next)
            || server_sequential_declaration_awaits_request_scoped_call(current, ctx)
            || server_sequential_declaration_awaits_request_scoped_call(next, ctx)
            || server_sequential_declaration_awaits_intentional_sequence(
                current,
                ctx,
                resolution_cache,
            )
            || server_sequential_declaration_awaits_intentional_sequence(
                next,
                ctx,
                resolution_cache,
            )
            || server_sequential_declaration_awaits_gate(current, ctx, resolution_cache)
        {
            statement_index += 1;
            continue;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(next.span));
        statement_index += 2;
    }
}

fn server_sequential_declaration_starts_with_await(declaration: &VariableDeclaration<'_>) -> bool {
    declaration
        .declarations
        .iter()
        .any(|declarator| matches!(declarator.init, Some(Expression::AwaitExpression(_))))
}

fn server_sequential_declaration_reads_symbols(
    declaration: &VariableDeclaration<'_>,
    symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    declaration.declarations.iter().any(|declarator| {
        let Some(initializer) = &declarator.init else {
            return false;
        };
        symbols.iter().any(|symbol_id| {
            ctx.scoping()
                .get_resolved_references(*symbol_id)
                .any(|reference| {
                    reference.is_read()
                        && initializer
                            .span()
                            .contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
                })
        })
    })
}

fn server_sequential_declaration_awaits_existing_promise(
    declaration: &VariableDeclaration<'_>,
) -> bool {
    declaration.declarations.iter().any(|declarator| {
        let Some(Expression::AwaitExpression(await_expression)) = &declarator.init else {
            return false;
        };
        matches!(
            await_expression.argument.get_inner_expression(),
            Expression::Identifier(_)
        ) || await_expression
            .argument
            .get_inner_expression()
            .as_member_expression()
            .is_some()
    })
}

fn server_sequential_declaration_awaits_request_scoped_call(
    declaration: &VariableDeclaration<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    declaration.declarations.iter().any(|declarator| {
        let Some(Expression::AwaitExpression(await_expression)) = &declarator.init else {
            return false;
        };
        let Expression::CallExpression(call) = await_expression.argument.get_inner_expression()
        else {
            return false;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            return false;
        };
        ["next/headers", "next-intl/server"]
            .iter()
            .any(|source| server_sequential_named_import(identifier, source, None, ctx))
            || server_sequential_named_import(identifier, "next/server", Some("connection"), ctx)
    })
}

fn server_sequential_named_import(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    module_source: &str,
    expected_imported_name: Option<&str>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == module_source
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if expected_imported_name.is_none_or(|expected| imported_name.name() == expected)
            )
    })
}

fn server_sequential_declaration_awaits_intentional_sequence<'a>(
    declaration: &VariableDeclaration<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    declaration.declarations.iter().any(|declarator| {
        let Some(Expression::AwaitExpression(await_expression)) = &declarator.init else {
            return false;
        };
        let Expression::CallExpression(call) = await_expression.argument.get_inner_expression()
        else {
            return false;
        };
        let local_function =
            server_sequential_order_independent_local_function(call, ctx, resolution_cache);
        if local_function.is_none()
            && server_sequential_callee_name(&call.callee)
                .is_some_and(|name| INTENTIONAL_SEQUENCING_CALLEE_NAMES.contains(&name))
        {
            return true;
        }
        call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| server_sequential_progress_callback(expression, ctx))
        })
    })
}

fn server_sequential_progress_callback(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let callback_id = match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
        Expression::FunctionExpression(function) => function.node_id.get(),
        _ => return false,
    };
    let callback_span = ctx.nodes().get_node(callback_id).span();
    ctx.nodes().iter().any(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        callback_span.contains_inclusive(node.span())
            && crate::ast_util::get_enclosing_function(node, ctx).map(AstNode::id)
                == Some(callback_id)
            && server_sequential_callee_name(&call.callee).is_some_and(|name| {
                server_sequential_identifier_words(name)
                    .iter()
                    .any(|word| matches!(word.as_str(), "progress" | "stage" | "step"))
            })
    })
}

fn server_sequential_declaration_awaits_gate<'a>(
    declaration: &VariableDeclaration<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    declaration.declarations.iter().any(|declarator| {
        let Some(Expression::AwaitExpression(await_expression)) = &declarator.init else {
            return false;
        };
        let Expression::CallExpression(call) = await_expression.argument.get_inner_expression()
        else {
            return false;
        };
        if server_sequential_has_possible_static_member_call_write(call, ctx) {
            return true;
        }
        if server_sequential_order_independent_local_function(call, ctx, resolution_cache).is_some()
        {
            return false;
        }
        let Some(callee_name) = server_sequential_callee_name(&call.callee) else {
            return false;
        };
        server_sequential_is_auth_guard_name(callee_name)
            || server_sequential_identifier_words(callee_name)
                .first()
                .is_some_and(|word| GATE_LEADING_VERBS.contains(&word.as_str()))
    })
}

fn server_sequential_order_independent_local_function<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    if server_sequential_has_possible_static_member_call_write(call, ctx) {
        return None;
    }
    exact_local_function_id(&call.callee, ctx, &mut Vec::new(), resolution_cache)
        .filter(|function_id| async_local_function_is_order_independent(*function_id, ctx))
}

fn server_sequential_has_possible_static_member_call_write<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(receiver, ctx) else {
        return false;
    };
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .any(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let Some(written_member) = static_property_write_member(identifier_node, ctx) else {
                return false;
            };
            resolved_static_member_property_name(written_member, ctx)
                .is_none_or(|written_property| written_property == property_name)
        })
}

fn server_sequential_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression.as_member_expression()?.static_property_name(),
    }
}

fn server_sequential_identifier_words(identifier: &str) -> Vec<String> {
    let characters = identifier.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        if characters[index].is_ascii_digit() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        } else if characters[index].is_ascii_uppercase() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                if index + 1 < characters.len() && characters[index + 1].is_ascii_lowercase() {
                    break;
                }
                index += 1;
            }
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        } else {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        }
        words.push(
            characters[start..index]
                .iter()
                .collect::<String>()
                .to_ascii_lowercase(),
        );
    }
    words
}

fn server_sequential_is_auth_guard_name(name: &str) -> bool {
    let mut tokens = server_sequential_identifier_words(name);
    let mut token_index = 0;
    while token_index + 1 < tokens.len() {
        if matches!(tokens[token_index].as_str(), "signed" | "logged" | "sign")
            && tokens[token_index + 1] == "in"
        {
            tokens[token_index] = format!("{}in", tokens[token_index]);
            tokens.remove(token_index + 1);
        } else {
            token_index += 1;
        }
    }
    let mut has_assertive = false;
    let mut has_getter = false;
    let mut has_qualifier = false;
    let mut has_strong_noun = false;
    let mut has_weak_noun = false;
    for token in tokens {
        if matches!(
            token.as_str(),
            "auth"
                | "authn"
                | "authz"
                | "authed"
                | "authenticate"
                | "authenticated"
                | "authenticating"
                | "authentication"
                | "authorize"
                | "authorized"
                | "authorizing"
                | "authorization"
                | "authorizer"
                | "signedin"
                | "loggedin"
                | "signin"
        ) {
            return true;
        }
        has_assertive |= matches!(
            token.as_str(),
            "require"
                | "ensure"
                | "assert"
                | "verify"
                | "validate"
                | "check"
                | "protect"
                | "enforce"
                | "guard"
                | "gate"
                | "restrict"
                | "is"
                | "has"
                | "can"
                | "must"
        );
        has_getter |= matches!(
            token.as_str(),
            "get" | "fetch" | "load" | "read" | "resolve" | "retrieve" | "use"
        );
        has_qualifier |= matches!(token.as_str(), "current" | "my" | "own");
        has_strong_noun |= matches!(
            token.as_str(),
            "session"
                | "sessions"
                | "login"
                | "admin"
                | "admins"
                | "superadmin"
                | "superuser"
                | "role"
                | "roles"
                | "permission"
                | "permissions"
                | "jwt"
                | "identity"
                | "principal"
                | "credential"
                | "credentials"
        );
        has_weak_noun |= matches!(
            token.as_str(),
            "user"
                | "users"
                | "account"
                | "accounts"
                | "token"
                | "tokens"
                | "access"
                | "me"
                | "viewer"
                | "caller"
                | "subject"
                | "scope"
                | "scopes"
        );
    }
    has_assertive && (has_strong_noun || has_weak_noun)
        || has_getter && has_strong_noun
        || has_qualifier && has_weak_noun
}
