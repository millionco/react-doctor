//! Statement lowering (`lowerStatement` in `BuildHIR.ts`) and the assignment /
//! destructuring helper (`lowerAssignment`).
//!
//! The structure mirrors the TS one-to-one so that id-allocation order — and
//! thus the printed `$id` / `bbN` / `[id]` numbers — matches the parity oracle.
//! Blocks for `if`/`for`/`while`/`switch` are reserved and entered in exactly
//! the same order, and the loop/switch tests are lowered at the same point.

use oxc::ast::ast::{
    AssignmentTarget, AssignmentTargetMaybeDefault, AssignmentTargetProperty, BindingIdentifier,
    BindingPattern, ForStatementInit, ForStatementLeft, PropertyKey, Statement,
    VariableDeclaration, VariableDeclarationKind,
};
use oxc::span::GetSpan;

use crate::hir::instruction::Instruction;
use crate::hir::model::BlockKind;
use crate::hir::place::{Effect, Place, SourceLocation};
use crate::hir::terminal::{ReturnVariant, SwitchCase as HirSwitchCase, Terminal};
use crate::hir::value::{
    ArrayPattern, ArrayPatternItem, InstructionKind, InstructionValue, LValue, LValuePattern,
    ObjectPattern, ObjectProperty, ObjectPropertyKey, ObjectPatternProperty, Pattern,
    PrimitiveValue, PropertyLiteral, PropertyType, SpreadPattern, VariableBinding,
};

use super::builder::{
    HirBuilder, build_temporary_place, goto_break, goto_continue, zero_id,
};
use super::lower_expression::{lower_expression_to_temporary, lower_value_to_temporary};
use super::{LowerError, span_to_loc};

/// Whether an assignment is a plain assignment or a destructure
/// (`'Destructure' | 'Assignment'`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignmentKind {
    Assignment,
    Destructure,
}

/// `lowerStatement` for a `BlockStatement`-like list of statements with TDZ
/// hoisting (`BuildHIR.ts`'s `case 'BlockStatement'`). For each statement, any
/// hoistable binding of `block_scope` that is referenced *before* its
/// declaration — either from within a nested function (`fnDepth > 0`) or because
/// it is a `hoisted` (function-declaration) binding — is pre-declared with a
/// `DeclareContext` (`HoistedConst`/`HoistedLet`/`HoistedFunction`) at the point
/// of first reference, before the statement is lowered. `addHoistedIdentifier`
/// then makes its later loads/stores `LoadContext`/`StoreContext`.
pub fn lower_block_statements(
    builder: &mut HirBuilder<'_, '_>,
    statements: &[Statement<'_>],
    block_scope: oxc::semantic::ScopeId,
) -> Result<(), LowerError> {
    use oxc::semantic::SymbolId;
    use std::collections::BTreeSet;

    // Hoistable identifier bindings defined for this precise block scope
    // (excluding `param` bindings, which never need hoisting).
    let mut hoistable: BTreeSet<SymbolId> = BTreeSet::new();
    {
        let symbols: Vec<SymbolId> = builder
            .scoping()
            .get_bindings(block_scope)
            .values()
            .copied()
            .collect();
        for symbol in symbols {
            // `param` bindings are never hoisted (refs to params are always valid).
            if is_param_symbol(builder, symbol) {
                continue;
            }
            hoistable.insert(symbol);
        }
    }

    for stmt in statements {
        // Collect the references in this statement that target a still-hoistable
        // binding under `fnDepth > 0` or a `hoisted` (function-decl) binding, in
        // source order (the TS populates a `Set` during traversal).
        let mut will_hoist: Vec<SymbolId> = Vec::new();
        if !hoistable.is_empty() {
            collect_will_hoist(builder, stmt, &hoistable, &mut will_hoist);
        }

        // After visiting the statement, any binding *declared* by it is no longer
        // hoistable for subsequent statements.
        for symbol in declared_symbols(builder, stmt, &hoistable) {
            hoistable.remove(&symbol);
        }

        // Hoist each needed declaration to the point it is first referenced.
        for symbol in will_hoist {
            if builder.is_hoisted_identifier(symbol) {
                continue;
            }
            let kind = match binding_hoist_kind(builder, symbol) {
                Some(kind) => kind,
                // `Unsupported declaration type for hoisting` / `Handle non-const
                // declarations for hoisting`: skip (the TS records a Todo and
                // continues), leaving the binding non-hoisted.
                None => continue,
            };
            let name = builder.scoping().symbol_name(symbol).to_string();
            let loc = SourceLocation::Generated;
            let identifier = builder.resolve_binding(symbol, &name, loc.clone());
            let place = Place {
                identifier,
                effect: Effect::Unknown,
                reactive: false,
                loc: loc.clone(),
            };
            lower_value_to_temporary(
                builder,
                InstructionValue::DeclareContext { kind, place, loc },
            );
            builder.add_hoisted_identifier(symbol);
        }

        lower_statement(builder, stmt, None)?;
    }

    Ok(())
}

/// Whether `symbol`'s declaration is a function parameter (`binding.kind ===
/// 'param'`). oxc gives params the same `FunctionScopedVariable` flag as `var`,
/// so the distinction is made by the declaration node's `AstKind`: a param's
/// binding identifier sits under a `FormalParameter` (or `FormalParameters` /
/// `BindingRestElement`), whereas a `var`/`const`/`let` sits under a
/// `VariableDeclarator` and a function declaration is a `Function`.
fn is_param_symbol(builder: &HirBuilder<'_, '_>, symbol: oxc::semantic::SymbolId) -> bool {
    use oxc::ast::AstKind;
    let decl = builder.scoping().symbol_declaration(symbol);
    let nodes = builder.semantic().nodes();
    let mut id = decl;
    // Walk up to the nearest declarator / function / formal-parameter ancestor.
    // `parent_id` of the program root is the root itself, so stop on a fixpoint.
    loop {
        match nodes.kind(id) {
            AstKind::FormalParameter(_)
            | AstKind::FormalParameters(_)
            | AstKind::BindingRestElement(_) => return true,
            AstKind::VariableDeclarator(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::Program(_) => return false,
            _ => {}
        }
        let parent = nodes.parent_id(id);
        if parent == id {
            return false;
        }
        id = parent;
    }
}

/// The symbols among `hoistable` whose declaration falls within `stmt` (in TS,
/// the post-visit pass that deletes from `hoistableIdentifiers` any identifier
/// it sees inside `s`). Approximated by span containment of the symbol's
/// declaration node.
fn declared_symbols(
    builder: &HirBuilder<'_, '_>,
    stmt: &Statement<'_>,
    hoistable: &std::collections::BTreeSet<oxc::semantic::SymbolId>,
) -> Vec<oxc::semantic::SymbolId> {
    use oxc::span::GetSpan;
    let span = stmt.span();
    let scoping = builder.scoping();
    hoistable
        .iter()
        .copied()
        .filter(|&symbol| {
            let s = scoping.symbol_span(symbol);
            s.start >= span.start && s.end <= span.end
        })
        .collect()
}

/// Collect, in source order, the symbols in `hoistable` that `stmt` references
/// under a nested function (`fnDepth > 0`) or that are `hoisted`
/// (function-declaration) bindings (`BuildHIR`'s `willHoist` set).
fn collect_will_hoist(
    builder: &HirBuilder<'_, '_>,
    stmt: &Statement<'_>,
    hoistable: &std::collections::BTreeSet<oxc::semantic::SymbolId>,
    out: &mut Vec<oxc::semantic::SymbolId>,
) {
    use oxc::ast::ast::{ArrowFunctionExpression, Function, IdentifierReference};
    use oxc::ast_visit::Visit;
    use oxc::semantic::SymbolId;
    use oxc::syntax::scope::ScopeFlags;
    use oxc::syntax::symbol::SymbolFlags;
    use std::collections::BTreeSet;

    struct Collector<'b, 's, 'h> {
        builder: &'b HirBuilder<'b, 's>,
        hoistable: &'h BTreeSet<SymbolId>,
        fn_depth: u32,
        seen: BTreeSet<SymbolId>,
        out: &'h mut Vec<SymbolId>,
    }

    impl<'b, 's, 'h> Collector<'b, 's, 'h> {
        fn consider(&mut self, ident: &IdentifierReference<'_>) {
            let Some(reference_id) = ident.reference_id.get() else {
                return;
            };
            let Some(symbol) = self
                .builder
                .scoping()
                .get_reference(reference_id)
                .symbol_id()
            else {
                return;
            };
            if !self.hoistable.contains(&symbol) || self.seen.contains(&symbol) {
                return;
            }
            // We can only hoist if (1) the ref occurs within an inner function,
            // or (2) the declaration itself is hoistable (a function decl).
            let is_hoisted_kind = self
                .builder
                .scoping()
                .symbol_flags(symbol)
                .contains(SymbolFlags::Function);
            if self.fn_depth > 0 || is_hoisted_kind {
                self.seen.insert(symbol);
                self.out.push(symbol);
            }
        }
    }

    impl<'a, 'b, 's, 'h> Visit<'a> for Collector<'b, 's, 'h> {
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            self.consider(ident);
        }
        fn visit_function(&mut self, func: &Function<'a>, flags: ScopeFlags) {
            self.fn_depth += 1;
            oxc::ast_visit::walk::walk_function(self, func, flags);
            self.fn_depth -= 1;
        }
        fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
            self.fn_depth += 1;
            oxc::ast_visit::walk::walk_arrow_function_expression(self, arrow);
            self.fn_depth -= 1;
        }
    }

    // `fnDepth` starts at 1 for a function declaration (its body is an inner fn
    // relative to the block; the declared name lives in the block scope).
    let initial_depth = u32::from(matches!(stmt, Statement::FunctionDeclaration(_)));
    let mut collector = Collector {
        builder,
        hoistable,
        fn_depth: initial_depth,
        seen: BTreeSet::new(),
        out,
    };
    collector.visit_statement(stmt);
}

/// The `InstructionKind` to declare a hoisted binding with, or `None` for an
/// unsupported declaration form (the TS records a `Todo` and skips).
fn binding_hoist_kind(
    builder: &HirBuilder<'_, '_>,
    symbol: oxc::semantic::SymbolId,
) -> Option<InstructionKind> {
    use oxc::syntax::symbol::SymbolFlags;
    let flags = builder.scoping().symbol_flags(symbol);
    if flags.contains(SymbolFlags::Function) {
        Some(InstructionKind::HoistedFunction)
    } else if flags.contains(SymbolFlags::ConstVariable)
        || flags.contains(SymbolFlags::FunctionScopedVariable)
    {
        // `const` and `var` both hoist as `HoistedConst`.
        Some(InstructionKind::HoistedConst)
    } else if flags.contains(SymbolFlags::BlockScopedVariable) {
        // `let`.
        Some(InstructionKind::HoistedLet)
    } else {
        None
    }
}

/// `lowerStatement`: lower a single statement into the current block, possibly
/// terminating it and creating new blocks.
pub fn lower_statement(
    builder: &mut HirBuilder<'_, '_>,
    stmt: &Statement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    match stmt {
        Statement::ExpressionStatement(s) => {
            lower_expression_to_temporary(builder, &s.expression)?;
            Ok(())
        }
        Statement::ReturnStatement(s) => {
            let loc = span_to_loc(s.span, builder);
            let value = match &s.argument {
                Some(arg) => lower_expression_to_temporary(builder, arg)?,
                None => lower_value_to_temporary(
                    builder,
                    InstructionValue::Primitive {
                        value: PrimitiveValue::Undefined,
                        loc: SourceLocation::Generated,
                    },
                ),
            };
            builder.terminate(
                Terminal::Return {
                    return_variant: ReturnVariant::Explicit,
                    value,
                    id: zero_id(),
                    effects: None,
                    loc,
                },
                Some(BlockKind::Block),
            );
            Ok(())
        }
        Statement::ThrowStatement(s) => {
            let value = lower_expression_to_temporary(builder, &s.argument)?;
            let loc = span_to_loc(s.span, builder);
            builder.terminate(
                Terminal::Throw {
                    value,
                    id: zero_id(),
                    loc,
                },
                Some(BlockKind::Block),
            );
            Ok(())
        }
        Statement::IfStatement(s) => lower_if(builder, s),
        Statement::BlockStatement(s) => {
            if let Some(scope_id) = s.scope_id.get() {
                lower_block_statements(builder, &s.body, scope_id)
            } else {
                for stmt in &s.body {
                    lower_statement(builder, stmt, None)?;
                }
                Ok(())
            }
        }
        Statement::BreakStatement(s) => {
            let loc = span_to_loc(s.span, builder);
            let label_name = s.label.as_ref().map(|l| l.name.as_str());
            let block = builder
                .lookup_break(label_name)
                .ok_or_else(|| LowerError::Invariant {
                    reason: "Expected a loop or switch to be in scope".to_string(),
                    loc: loc.clone(),
                })?;
            builder.terminate(goto_break(block, loc), Some(BlockKind::Block));
            Ok(())
        }
        Statement::ContinueStatement(s) => {
            let loc = span_to_loc(s.span, builder);
            let label_name = s.label.as_ref().map(|l| l.name.as_str());
            let block = builder
                .lookup_continue(label_name)
                .ok_or_else(|| LowerError::Invariant {
                    reason: "Expected a loop to be in scope".to_string(),
                    loc: loc.clone(),
                })?;
            builder.terminate(goto_continue(block, loc), Some(BlockKind::Block));
            Ok(())
        }
        Statement::VariableDeclaration(s) => lower_variable_declaration(builder, s),
        Statement::WhileStatement(s) => lower_while(builder, s, label),
        Statement::DoWhileStatement(s) => lower_do_while(builder, s, label),
        Statement::ForStatement(s) => lower_for(builder, s, label),
        Statement::ForOfStatement(s) => lower_for_of(builder, s, label),
        Statement::ForInStatement(s) => lower_for_in(builder, s, label),
        Statement::SwitchStatement(s) => lower_switch(builder, s, label),
        Statement::LabeledStatement(s) => {
            let label_name = s.label.name.as_str().to_string();
            match &s.body {
                Statement::ForStatement(_)
                | Statement::ForOfStatement(_)
                | Statement::ForInStatement(_)
                | Statement::WhileStatement(_)
                | Statement::DoWhileStatement(_) => {
                    lower_statement(builder, &s.body, Some(&label_name))
                }
                _ => {
                    let loc = span_to_loc(s.span, builder);
                    let continuation = builder.reserve(BlockKind::Block);
                    let continuation_id = continuation.id;
                    let body_loc = span_to_loc(s.body.span(), builder);
                    let label_for_scope = label_name.clone();
                    let mut inner_err: Option<LowerError> = None;
                    let block = builder.enter(BlockKind::Block, |builder, _| {
                        builder.label_scope(label_for_scope, continuation_id, |builder| {
                            if let Err(e) = lower_statement(builder, &s.body, None) {
                                inner_err = Some(e);
                            }
                        });
                        goto_break(continuation_id, body_loc.clone())
                    });
                    if let Some(e) = inner_err {
                        return Err(e);
                    }
                    builder.terminate_with_continuation(
                        Terminal::Label {
                            block,
                            fallthrough: continuation_id,
                            id: zero_id(),
                            loc,
                        },
                        continuation,
                    );
                    Ok(())
                }
            }
        }
        Statement::FunctionDeclaration(func) => {
            let loc = span_to_loc(func.span, builder);
            let func_value = super::lower_function_declaration_value(builder, func, loc.clone())?;
            let fn_place = lower_value_to_temporary(builder, func_value);
            let id = func.id.as_ref().ok_or_else(|| LowerError::Invariant {
                reason: "function declarations must have a name".to_string(),
                loc: loc.clone(),
            })?;
            lower_binding_identifier_assignment(
                builder,
                loc,
                InstructionKind::Function,
                id,
                fn_place,
            )?;
            Ok(())
        }
        Statement::DebuggerStatement(s) => {
            let loc = span_to_loc(s.span, builder);
            let place = build_temporary_place(builder, loc.clone());
            builder.push(Instruction {
                id: zero_id(),
                lvalue: place,
                value: InstructionValue::Debugger { loc: loc.clone() },
                loc,
                effects: None,
            });
            Ok(())
        }
        Statement::EmptyStatement(_) => Ok(()),
        Statement::TryStatement(s) => lower_try_statement(builder, s),
        // Type-only declarations are dropped, matching the TS `return;`.
        Statement::TSTypeAliasDeclaration(_)
        | Statement::TSInterfaceDeclaration(_)
        | Statement::TSModuleDeclaration(_)
        | Statement::TSImportEqualsDeclaration(_) => Ok(()),
        // `enum E { ... }` lowers to an `UnsupportedNode` value carrying the
        // enum's source text — matching `BuildHIR.ts`'s `case 'EnumDeclaration':
        // case 'TSEnumDeclaration'` (which records NO error, just
        // `lowerValueToTemporary({kind: 'UnsupportedNode', node})`). Codegen
        // re-emits the statement verbatim (the React Compiler does not transpile
        // TS/Flow enums — a separate plugin does), so the rest of the function is
        // still compiled. The TS type cast `let x: E = …` annotation is stripped
        // naturally (the variable declaration lowering ignores type annotations).
        Statement::TSEnumDeclaration(s) => {
            let loc = span_to_loc(s.span, builder);
            let node = builder.semantic().source_text()
                [s.span.start as usize..s.span.end as usize]
                .to_string();
            lower_value_to_temporary(
                builder,
                InstructionValue::UnsupportedNode {
                    node,
                    node_type: "TSEnumDeclaration".to_string(),
                    is_statement: true,
                    loc,
                },
            );
            Ok(())
        }
        other => Err(LowerError::UnsupportedStatement {
            kind: statement_kind(other).to_string(),
            loc: span_to_loc(other.span(), builder),
        }),
    }
}

/// Lower a `try { ... } catch (e?) { ... }` statement to a [`Terminal::Try`]
/// (`BuildHIR.ts` `case 'TryStatement'`). The handler binding (if present) is a
/// promoted temporary that the catch body destructures via a `Catch`
/// assignment. `finally` and catch-less `try` are not yet supported.
fn lower_try_statement(
    builder: &mut HirBuilder<'_, '_>,
    stmt: &oxc::ast::ast::TryStatement<'_>,
) -> Result<(), LowerError> {
    let stmt_loc = span_to_loc(stmt.span, builder);

    // A `finally` clause is not yet supported. Checked BEFORE the catch-clause
    // check so a `try { } finally { }` (no catch) bails as "with finalizer" — this
    // matches `babel-plugin-react-compiler`, which flags any `try` with a
    // finalizer as a Todo regardless of whether a `catch` is present. (The TS
    // records the error but proceeds; here we bail so the function is left as-is.)
    if stmt.finalizer.is_some() {
        return Err(LowerError::UnsupportedStatement {
            kind: "TryStatement (with finalizer)".to_string(),
            loc: stmt_loc,
        });
    }
    // A `try` without a `catch` clause (and without a finalizer, handled above) is
    // not yet supported.
    let Some(handler_clause) = &stmt.handler else {
        return Err(LowerError::UnsupportedStatement {
            kind: "TryStatement (without catch clause)".to_string(),
            loc: stmt_loc,
        });
    };

    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    // Lower the catch parameter, if present, to a promoted temporary `Place`
    // declared via `DeclareLocal` with `InstructionKind::Catch`.
    let handler_binding: Option<Place> = match &handler_clause.param {
        Some(param) => {
            let param_loc = span_to_loc(param.pattern.span(), builder);
            let mut place = build_temporary_place(builder, param_loc.clone());
            promote_temporary(&mut place);
            lower_value_to_temporary(
                builder,
                InstructionValue::DeclareLocal {
                    lvalue: LValue {
                        place: place.clone(),
                        kind: InstructionKind::Catch,
                    },
                    type_annotation: None,
                    loc: param_loc,
                },
            );
            Some(place)
        }
        None => None,
    };

    // Catch handler block: assign the caught value into the binding pattern
    // (if any), lower the catch body, then `goto continuation (Break)`.
    let handler_binding_for_block = handler_binding.clone();
    let handler_loc = span_to_loc(handler_clause.span, builder);
    let mut inner_err: Option<LowerError> = None;
    let handler = builder.enter(BlockKind::Catch, |builder, _| {
        if let (Some(binding), Some(param)) =
            (&handler_binding_for_block, &handler_clause.param)
        {
            let assign_loc = span_to_loc(param.pattern.span(), builder);
            if let Err(e) = lower_assignment(
                builder,
                assign_loc,
                InstructionKind::Catch,
                &param.pattern,
                binding.clone(),
                AssignmentKind::Assignment,
            ) {
                inner_err = Some(e);
            }
        }
        if inner_err.is_none() {
            for s in &handler_clause.body.body {
                if let Err(e) = lower_statement(builder, s, None) {
                    inner_err = Some(e);
                    break;
                }
            }
        }
        goto_break(continuation_id, handler_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    // Protected `try` block: lower its body with `handler` installed as the
    // active exception handler, then `goto continuation (Try)`.
    let block_loc = span_to_loc(stmt.block.span, builder);
    let block = builder.enter(BlockKind::Block, |builder, _| {
        builder.enter_try_catch(handler, |builder| {
            for s in &stmt.block.body {
                if inner_err.is_none() {
                    if let Err(e) = lower_statement(builder, s, None) {
                        inner_err = Some(e);
                    }
                }
            }
        });
        Terminal::Goto {
            block: continuation_id,
            variant: crate::hir::terminal::GotoVariant::Try,
            id: zero_id(),
            loc: block_loc.clone(),
        }
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Try {
            block,
            handler_binding,
            handler,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: stmt_loc,
        },
        continuation,
    );

    Ok(())
}

/// Lower a `VariableDeclaration` (`const`/`let`/`var`), emitting `DeclareLocal`
/// / `DeclareContext` for bare declarations and assignment/destructure for
/// initialized ones.
fn lower_variable_declaration(
    builder: &mut HirBuilder<'_, '_>,
    s: &VariableDeclaration<'_>,
) -> Result<(), LowerError> {
    if s.kind == VariableDeclarationKind::Using || s.kind == VariableDeclarationKind::AwaitUsing {
        return Err(LowerError::UnsupportedStatement {
            kind: "VariableDeclaration(using)".to_string(),
            loc: span_to_loc(s.span, builder),
        });
    }
    let kind = match s.kind {
        VariableDeclarationKind::Const => InstructionKind::Const,
        // `var` is treated as `let` (matching the TS fallback).
        _ => InstructionKind::Let,
    };
    for declarator in &s.declarations {
        let decl_loc = span_to_loc(declarator.span, builder);
        if let Some(init) = &declarator.init {
            let value = lower_expression_to_temporary(builder, init)?;
            let assignment_kind = match &declarator.id {
                BindingPattern::ObjectPattern(_) | BindingPattern::ArrayPattern(_) => {
                    AssignmentKind::Destructure
                }
                _ => AssignmentKind::Assignment,
            };
            lower_assignment(builder, decl_loc, kind, &declarator.id, value, assignment_kind)?;
        } else if let BindingPattern::BindingIdentifier(ident) = &declarator.id {
            let loc = span_to_loc(ident.span, builder);
            let symbol = ident.symbol_id.get();
            let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
            match binding {
                VariableBinding::Identifier { identifier, .. } => {
                    let place = Place {
                        identifier,
                        effect: Effect::Unknown,
                        reactive: false,
                        loc: loc.clone(),
                    };
                    if builder.is_context_identifier(symbol) {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::DeclareContext {
                                kind: InstructionKind::Let,
                                place,
                                loc,
                            },
                        );
                    } else {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::DeclareLocal {
                                lvalue: LValue { place, kind },
                                type_annotation: None,
                                loc,
                            },
                        );
                    }
                }
                VariableBinding::NonLocal(_) => {
                    return Err(LowerError::Invariant {
                        reason: "Could not find binding for declaration".to_string(),
                        loc,
                    });
                }
            }
        } else {
            return Err(LowerError::UnsupportedStatement {
                kind: "VariableDeclaration(no-init pattern)".to_string(),
                loc: decl_loc,
            });
        }
    }
    Ok(())
}

fn lower_if(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::IfStatement<'_>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    let consequent_loc = span_to_loc(s.consequent.span(), builder);
    let mut inner_err: Option<LowerError> = None;
    let consequent_block = builder.enter(BlockKind::Block, |builder, _| {
        if let Err(e) = lower_statement(builder, &s.consequent, None) {
            inner_err = Some(e);
        }
        goto_break(continuation_id, consequent_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let alternate_block = if let Some(alternate) = &s.alternate {
        let alternate_loc = span_to_loc(alternate.span(), builder);
        let mut inner_err: Option<LowerError> = None;
        let block = builder.enter(BlockKind::Block, |builder, _| {
            if let Err(e) = lower_statement(builder, alternate, None) {
                inner_err = Some(e);
            }
            goto_break(continuation_id, alternate_loc.clone())
        });
        if let Some(e) = inner_err {
            return Err(e);
        }
        block
    } else {
        continuation_id
    };

    let test = lower_expression_to_temporary(builder, &s.test)?;
    builder.terminate_with_continuation(
        Terminal::If {
            test,
            consequent: consequent_block,
            alternate: alternate_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

fn lower_while(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::WhileStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let conditional = builder.reserve(BlockKind::Loop);
    let conditional_id = conditional.id;
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    let body_loc = span_to_loc(s.body.span(), builder);
    let owned_label = label.map(str::to_string);
    let mut inner_err: Option<LowerError> = None;
    let loop_block = builder.enter(BlockKind::Block, |builder, _| {
        builder.loop_scope(owned_label, conditional_id, continuation_id, |builder| {
            if let Err(e) = lower_statement(builder, &s.body, None) {
                inner_err = Some(e);
            }
            goto_continue(conditional_id, body_loc.clone())
        })
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::While {
            test: conditional_id,
            loop_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        conditional,
    );

    let test = lower_expression_to_temporary(builder, &s.test)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: loop_block,
            alternate: continuation_id,
            fallthrough: conditional_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

fn lower_do_while(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::DoWhileStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let conditional = builder.reserve(BlockKind::Loop);
    let conditional_id = conditional.id;
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    let body_loc = span_to_loc(s.body.span(), builder);
    let owned_label = label.map(str::to_string);
    let mut inner_err: Option<LowerError> = None;
    let loop_block = builder.enter(BlockKind::Block, |builder, _| {
        builder.loop_scope(owned_label, conditional_id, continuation_id, |builder| {
            if let Err(e) = lower_statement(builder, &s.body, None) {
                inner_err = Some(e);
            }
            goto_continue(conditional_id, body_loc.clone())
        })
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::DoWhile {
            loop_block,
            test: conditional_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        conditional,
    );

    let test = lower_expression_to_temporary(builder, &s.test)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: loop_block,
            alternate: continuation_id,
            fallthrough: conditional_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

fn lower_for(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::ForStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let test_block = builder.reserve(BlockKind::Loop);
    let test_block_id = test_block.id;
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    let mut inner_err: Option<LowerError> = None;
    let init_loc = loc.clone();
    let init_block = builder.enter(BlockKind::Loop, |builder, _| {
        match &s.init {
            None => {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::Primitive {
                        value: PrimitiveValue::Undefined,
                        loc: init_loc.clone(),
                    },
                );
            }
            Some(ForStatementInit::VariableDeclaration(decl)) => {
                if let Err(e) = lower_variable_declaration(builder, decl) {
                    inner_err = Some(e);
                }
            }
            Some(init_expr) => {
                // Non-variable init: lower as best-effort expression.
                if let Some(expr) = init_expr.as_expression() {
                    match lower_expression_to_temporary(builder, expr) {
                        Ok(_) => {}
                        Err(e) => inner_err = Some(e),
                    }
                } else {
                    inner_err = Some(LowerError::UnsupportedStatement {
                        kind: "ForStatement(init)".to_string(),
                        loc: init_loc.clone(),
                    });
                }
            }
        }
        goto_break(test_block_id, init_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let update_block = if let Some(update) = &s.update {
        let update_loc = span_to_loc(update.span(), builder);
        let mut inner_err: Option<LowerError> = None;
        let block = builder.enter(BlockKind::Loop, |builder, _| {
            if let Err(e) = lower_expression_to_temporary(builder, update) {
                inner_err = Some(e);
            }
            goto_break(test_block_id, update_loc.clone())
        });
        if let Some(e) = inner_err {
            return Err(e);
        }
        Some(block)
    } else {
        None
    };

    let continue_target = update_block.unwrap_or(test_block_id);
    let body_loc = span_to_loc(s.body.span(), builder);
    let owned_label = label.map(str::to_string);
    let mut inner_err: Option<LowerError> = None;
    let body_block = builder.enter(BlockKind::Block, |builder, _| {
        builder.loop_scope(owned_label, continue_target, continuation_id, |builder| {
            if let Err(e) = lower_statement(builder, &s.body, None) {
                inner_err = Some(e);
            }
            goto_continue(continue_target, body_loc.clone())
        })
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::For {
            init: init_block,
            test: test_block_id,
            update: update_block,
            loop_block: body_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        test_block,
    );

    let test = match &s.test {
        Some(test) => lower_expression_to_temporary(builder, test)?,
        None => lower_value_to_temporary(
            builder,
            InstructionValue::Primitive {
                value: PrimitiveValue::Boolean(true),
                loc: loc.clone(),
            },
        ),
    };
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: body_block,
            alternate: continuation_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

fn lower_for_of(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::ForOfStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    if s.r#await {
        return Err(LowerError::UnsupportedStatement {
            kind: "ForOfStatement(await)".to_string(),
            loc,
        });
    }
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;
    let init_block = builder.reserve(BlockKind::Loop);
    let init_block_id = init_block.id;
    let test_block = builder.reserve(BlockKind::Loop);
    let test_block_id = test_block.id;

    let body_loc = span_to_loc(s.body.span(), builder);
    let owned_label = label.map(str::to_string);
    let mut inner_err: Option<LowerError> = None;
    let loop_block = builder.enter(BlockKind::Block, |builder, _| {
        builder.loop_scope(owned_label, init_block_id, continuation_id, |builder| {
            if let Err(e) = lower_statement(builder, &s.body, None) {
                inner_err = Some(e);
            }
            goto_continue(init_block_id, body_loc.clone())
        })
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let value = lower_expression_to_temporary(builder, &s.right)?;
    builder.terminate_with_continuation(
        Terminal::ForOf {
            init: init_block_id,
            test: test_block_id,
            loop_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        init_block,
    );

    let iterator = lower_value_to_temporary(
        builder,
        InstructionValue::GetIterator {
            collection: value.clone(),
            loc: value.loc.clone(),
        },
    );
    builder.terminate_with_continuation(goto_break(test_block_id, loc.clone()), test_block);

    let left_loc = span_to_loc(s.left.span(), builder);
    let advance_iterator = lower_value_to_temporary(
        builder,
        InstructionValue::IteratorNext {
            iterator: iterator.clone(),
            collection: value.clone(),
            loc: left_loc.clone(),
        },
    );
    let test = lower_for_left(builder, &s.left, left_loc, advance_iterator)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: loop_block,
            alternate: continuation_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

fn lower_for_in(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::ForInStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;
    let init_block = builder.reserve(BlockKind::Loop);
    let init_block_id = init_block.id;

    let body_loc = span_to_loc(s.body.span(), builder);
    let owned_label = label.map(str::to_string);
    let mut inner_err: Option<LowerError> = None;
    let loop_block = builder.enter(BlockKind::Block, |builder, _| {
        builder.loop_scope(owned_label, init_block_id, continuation_id, |builder| {
            if let Err(e) = lower_statement(builder, &s.body, None) {
                inner_err = Some(e);
            }
            goto_continue(init_block_id, body_loc.clone())
        })
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let value = lower_expression_to_temporary(builder, &s.right)?;
    builder.terminate_with_continuation(
        Terminal::ForIn {
            init: init_block_id,
            loop_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        init_block,
    );

    let left_loc = span_to_loc(s.left.span(), builder);
    let next_property = lower_value_to_temporary(
        builder,
        InstructionValue::NextPropertyOf {
            value: value.clone(),
            loc: left_loc.clone(),
        },
    );
    let test = lower_for_left(builder, &s.left, left_loc, next_property)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent: loop_block,
            alternate: continuation_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

/// Lower the `left` of a for-of/for-in into an assignment of `value`, returning
/// the `LoadLocal` temporary that the loop's `branch` tests.
fn lower_for_left(
    builder: &mut HirBuilder<'_, '_>,
    left: &ForStatementLeft<'_>,
    left_loc: SourceLocation,
    value: Place,
) -> Result<Place, LowerError> {
    match left {
        ForStatementLeft::VariableDeclaration(decl) => {
            let declarator = decl.declarations.first().ok_or_else(|| LowerError::Invariant {
                reason: "Expected one declaration in for-of/for-in".to_string(),
                loc: left_loc.clone(),
            })?;
            let assign = lower_assignment(
                builder,
                left_loc,
                InstructionKind::Let,
                &declarator.id,
                value,
                AssignmentKind::Assignment,
            )?;
            Ok(lower_value_to_temporary(builder, assign))
        }
        // A non-declaration (LVal) left, e.g. `for (x of items)` where `x` is
        // pre-declared. TS lowers this via `lowerAssignment(..., Reassign, left,
        // value, 'Assignment')` (BuildHIR.ts:1201-1215 / 1292-1306) and tests the
        // resulting temporary.
        ForStatementLeft::AssignmentTargetIdentifier(_)
        | ForStatementLeft::ComputedMemberExpression(_)
        | ForStatementLeft::StaticMemberExpression(_)
        | ForStatementLeft::PrivateFieldExpression(_)
        | ForStatementLeft::ArrayAssignmentTarget(_)
        | ForStatementLeft::ObjectAssignmentTarget(_) => {
            let target = left.to_assignment_target();
            let assign = lower_assignment_target(
                builder,
                left_loc,
                InstructionKind::Reassign,
                target,
                value,
                AssignmentKind::Assignment,
            )?;
            Ok(lower_value_to_temporary(builder, assign))
        }
        _ => Err(LowerError::UnsupportedStatement {
            kind: "ForStatement(lval left)".to_string(),
            loc: left_loc,
        }),
    }
}

fn lower_switch(
    builder: &mut HirBuilder<'_, '_>,
    s: &oxc::ast::ast::SwitchStatement<'_>,
    label: Option<&str>,
) -> Result<(), LowerError> {
    let loc = span_to_loc(s.span, builder);
    let continuation = builder.reserve(BlockKind::Block);
    let continuation_id = continuation.id;

    let mut fallthrough = continuation_id;
    let mut cases: Vec<HirSwitchCase> = Vec::new();
    let mut has_default = false;

    for case in s.cases.iter().rev() {
        if case.test.is_none() {
            has_default = true;
        }
        let case_loc = span_to_loc(case.span, builder);
        let owned_label = label.map(str::to_string);
        let current_fallthrough = fallthrough;
        let mut inner_err: Option<LowerError> = None;
        let block = builder.enter(BlockKind::Block, |builder, _| {
            builder.switch_scope(owned_label, continuation_id, |builder| {
                for consequent in &case.consequent {
                    if let Err(e) = lower_statement(builder, consequent, None) {
                        inner_err = Some(e);
                        break;
                    }
                }
                goto_break(current_fallthrough, case_loc.clone())
            })
        });
        if let Some(e) = inner_err {
            return Err(e);
        }
        let test = match &case.test {
            Some(test) => Some(lower_expression_to_temporary(builder, test)?),
            None => None,
        };
        cases.push(HirSwitchCase { test, block });
        fallthrough = block;
    }
    cases.reverse();
    if !has_default {
        cases.push(HirSwitchCase {
            test: None,
            block: continuation_id,
        });
    }

    let test = lower_expression_to_temporary(builder, &s.discriminant)?;
    builder.terminate_with_continuation(
        Terminal::Switch {
            test,
            cases,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(())
}

/// `lowerAssignment`: bind `value` into `lvalue`, emitting `StoreLocal` /
/// `StoreContext` / `Destructure` instructions as appropriate, and return a
/// `LoadLocal` of the produced temporary.
pub fn lower_assignment(
    builder: &mut HirBuilder<'_, '_>,
    loc: SourceLocation,
    kind: InstructionKind,
    pattern: &BindingPattern<'_>,
    value: Place,
    assignment_kind: AssignmentKind,
) -> Result<InstructionValue, LowerError> {
    match pattern {
        BindingPattern::BindingIdentifier(ident) => {
            let symbol = ident.symbol_id.get();
            let binding =
                builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
            let place = match binding {
                VariableBinding::Identifier { identifier, .. } => Place {
                    identifier,
                    effect: Effect::Unknown,
                    reactive: false,
                    loc: loc.clone(),
                },
                VariableBinding::NonLocal(_) => {
                    return Err(LowerError::Invariant {
                        reason: "Could not find binding for declaration".to_string(),
                        loc,
                    });
                }
            };
            let temporary = if builder.is_context_identifier(symbol) {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreContext {
                        kind,
                        place,
                        value,
                        loc: loc.clone(),
                    },
                )
            } else {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue { place, kind },
                        value,
                        type_annotation: None,
                        loc: loc.clone(),
                    },
                )
            };
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
        BindingPattern::ArrayPattern(array) => {
            let pattern_loc = span_to_loc(array.span, builder);
            let mut items: Vec<ArrayPatternItem> = Vec::new();
            let mut followups: Vec<Followup<'_>> = Vec::new();
            // `forceTemporaries` (BuildHIR.ts:3988-3996) is only ever true for
            // reassignments; declaration destructures always pass `false`.
            let force_temporaries = kind == InstructionKind::Reassign;
            for element in &array.elements {
                match element {
                    None => items.push(ArrayPatternItem::Hole),
                    Some(elem) => {
                        let place = pattern_element_place(
                            builder,
                            elem,
                            assignment_kind,
                            force_temporaries,
                            &mut followups,
                        )?;
                        items.push(ArrayPatternItem::Place(place));
                    }
                }
            }
            if let Some(rest) = &array.rest {
                let place = pattern_element_place(
                    builder,
                    &rest.argument,
                    assignment_kind,
                    force_temporaries,
                    &mut followups,
                )?;
                items.push(ArrayPatternItem::Spread(SpreadPattern { place }));
            }
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Array(ArrayPattern {
                            items,
                            loc: pattern_loc,
                        }),
                        kind,
                    },
                    value: value.clone(),
                    loc,
                },
            );
            run_followups(builder, followups, kind, assignment_kind)?;
            Ok(InstructionValue::LoadLocal {
                loc: value.loc.clone(),
                place: temporary,
            })
        }
        BindingPattern::ObjectPattern(object) => {
            let pattern_loc = span_to_loc(object.span, builder);
            let mut properties: Vec<ObjectPatternProperty> = Vec::new();
            let mut followups: Vec<Followup<'_>> = Vec::new();
            // `forceTemporaries` (BuildHIR.ts:4122-4132) is only ever true for
            // reassignments; declaration destructures always pass `false`.
            let force_temporaries = kind == InstructionKind::Reassign;
            for property in &object.properties {
                if property.computed {
                    return Err(LowerError::UnsupportedStatement {
                        kind: "ObjectPattern(computed)".to_string(),
                        loc: span_to_loc(property.span, builder),
                    });
                }
                let key = lower_binding_property_key(builder, &property.key)?;
                let place = pattern_element_place(
                    builder,
                    &property.value,
                    assignment_kind,
                    force_temporaries,
                    &mut followups,
                )?;
                properties.push(ObjectPatternProperty::Property(ObjectProperty {
                    key,
                    property_type: PropertyType::Property,
                    place,
                }));
            }
            if let Some(rest) = &object.rest {
                let place = pattern_element_place(
                    builder,
                    &rest.argument,
                    assignment_kind,
                    force_temporaries,
                    &mut followups,
                )?;
                properties.push(ObjectPatternProperty::Spread(SpreadPattern { place }));
            }
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Object(ObjectPattern {
                            properties,
                            loc: pattern_loc,
                        }),
                        kind,
                    },
                    value: value.clone(),
                    loc,
                },
            );
            run_followups(builder, followups, kind, assignment_kind)?;
            Ok(InstructionValue::LoadLocal {
                loc: value.loc.clone(),
                place: temporary,
            })
        }
        BindingPattern::AssignmentPattern(assign) => lower_default_value_assignment(
            builder,
            loc,
            kind,
            &assign.left,
            &assign.right,
            value,
            assignment_kind,
        ),
    }
}

/// A deferred nested-pattern assignment: a promoted temporary plus the pattern
/// that destructures it (`{place, path}` in the TS `followups`).
struct Followup<'a> {
    place: Place,
    pattern: &'a BindingPattern<'a>,
}

/// Resolve a destructuring element to the place stored in the parent pattern.
///
/// Mirrors the element branches of `lowerAssignment`'s `ArrayPattern`/
/// `ObjectPattern` cases (`BuildHIR.ts:4048-4082`): a plain identifier binds
/// directly into the pattern *only* when the destructure is a reassignment
/// (`assignmentKind === 'Assignment'`) or the binding is a `StoreLocal` (i.e. not
/// a context variable). When the element is a nested pattern, or an identifier
/// that stores to a context variable during a declaration, it is routed through a
/// promoted temporary and re-stored via a [`Followup`] — which, for a context
/// variable, lowers to a `StoreContext` so the variable keeps its mutable range.
///
/// `force_temporaries` matches the TS guard: it is only ever set for reassignments
/// (declaration destructures pass `false`).
fn pattern_element_place<'a>(
    builder: &mut HirBuilder<'_, '_>,
    pattern: &'a BindingPattern<'a>,
    assignment_kind: AssignmentKind,
    force_temporaries: bool,
    followups: &mut Vec<Followup<'a>>,
) -> Result<Place, LowerError> {
    match pattern {
        BindingPattern::BindingIdentifier(ident)
            if !force_temporaries
                && (assignment_kind == AssignmentKind::Assignment
                    || !builder.is_context_identifier(ident.symbol_id.get())) =>
        {
            let loc = span_to_loc(ident.span, builder);
            let symbol = ident.symbol_id.get();
            let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
            match binding {
                VariableBinding::Identifier { identifier, .. } => Ok(Place {
                    identifier,
                    effect: Effect::Unknown,
                    reactive: false,
                    loc,
                }),
                VariableBinding::NonLocal(_) => Err(LowerError::Invariant {
                    reason: "Could not find binding for destructure element".to_string(),
                    loc,
                }),
            }
        }
        _ => {
            let loc = span_to_loc(pattern.span(), builder);
            let mut temp = build_temporary_place(builder, loc);
            promote_temporary(&mut temp);
            followups.push(Followup {
                place: temp.clone(),
                pattern,
            });
            Ok(temp)
        }
    }
}

/// Run the deferred nested-pattern assignments collected during a destructure.
fn run_followups(
    builder: &mut HirBuilder<'_, '_>,
    followups: Vec<Followup<'_>>,
    kind: InstructionKind,
    assignment_kind: AssignmentKind,
) -> Result<(), LowerError> {
    for followup in followups {
        let loc = span_to_loc(followup.pattern.span(), builder);
        lower_assignment(
            builder,
            loc,
            kind,
            followup.pattern,
            followup.place,
            assignment_kind,
        )?;
    }
    Ok(())
}

/// `promoteTemporary`: give an unnamed temporary a `#t<declarationId>` name.
fn promote_temporary(place: &mut Place) {
    let decl = place.identifier.declaration_id.as_u32();
    place.identifier.name = Some(crate::hir::place::IdentifierName::Promoted {
        value: format!("#t{decl}"),
    });
}

/// Lower a target with a default value (`AssignmentPattern`):
/// `value === undefined ? <default> : value`, then assign the chosen value into
/// the inner target (`lowerAssignment`'s `AssignmentPattern` case, BuildHIR.ts:
/// 4299-4391). Takes the `left`/`right` separately so it serves both a babel-style
/// `AssignmentPattern` destructure element and an oxc `FormalParameter` whose
/// default lives in `FormalParameter::initializer` (oxc never nests a parameter
/// default as an `AssignmentPattern` — see [`lower_param`]).
pub(crate) fn lower_default_value_assignment(
    builder: &mut HirBuilder<'_, '_>,
    loc: SourceLocation,
    kind: InstructionKind,
    left: &BindingPattern<'_>,
    right: &oxc::ast::ast::Expression<'_>,
    value: Place,
    assignment_kind: AssignmentKind,
) -> Result<InstructionValue, LowerError> {
    let temp = build_temporary_place(builder, loc.clone());

    let test_block = builder.reserve(BlockKind::Value);
    let test_block_id = test_block.id;
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;

    let temp_for_cons = temp.clone();
    let cons_loc = loc.clone();
    let mut inner_err: Option<LowerError> = None;
    let consequent = builder.enter(BlockKind::Value, |builder, _| {
        match lower_expression_to_temporary(builder, right) {
            Ok(default_value) => {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: temp_for_cons.clone(),
                            kind: InstructionKind::Const,
                        },
                        value: default_value,
                        type_annotation: None,
                        loc: cons_loc.clone(),
                    },
                );
            }
            Err(e) => inner_err = Some(e),
        }
        goto_break(continuation_id, cons_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let temp_for_alt = temp.clone();
    let value_for_alt = value.clone();
    let alt_loc = loc.clone();
    let alternate = builder.enter(BlockKind::Value, |builder, _| {
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: temp_for_alt.clone(),
                    kind: InstructionKind::Const,
                },
                value: value_for_alt.clone(),
                type_annotation: None,
                loc: alt_loc.clone(),
            },
        );
        goto_break(continuation_id, alt_loc.clone())
    });

    builder.terminate_with_continuation(
        Terminal::Ternary {
            test: test_block_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        test_block,
    );
    let undef = lower_value_to_temporary(
        builder,
        InstructionValue::Primitive {
            value: PrimitiveValue::Undefined,
            loc: loc.clone(),
        },
    );
    let test = lower_value_to_temporary(
        builder,
        InstructionValue::BinaryExpression {
            operator: "===".to_string(),
            left: value.clone(),
            right: undef,
            loc: loc.clone(),
        },
    );
    builder.terminate_with_continuation(
        Terminal::Branch {
            test,
            consequent,
            alternate,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        continuation,
    );

    lower_assignment(builder, loc, kind, left, temp, assignment_kind)
}

/// Lower a `StoreLocal`/`StoreContext`/`StoreGlobal` for a binding identifier
/// (function declarations, simple `=` targets resolved as identifiers).
fn lower_binding_identifier_assignment(
    builder: &mut HirBuilder<'_, '_>,
    loc: SourceLocation,
    kind: InstructionKind,
    ident: &BindingIdentifier<'_>,
    value: Place,
) -> Result<InstructionValue, LowerError> {
    let symbol = ident.symbol_id.get();
    let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
    match binding {
        VariableBinding::Identifier { identifier, .. } => {
            let place = Place {
                identifier,
                effect: Effect::Unknown,
                reactive: false,
                loc: loc.clone(),
            };
            let temporary = if builder.is_context_identifier(symbol) {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreContext {
                        kind,
                        place,
                        value,
                        loc: loc.clone(),
                    },
                )
            } else {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue { place, kind },
                        value,
                        type_annotation: None,
                        loc: loc.clone(),
                    },
                )
            };
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
        VariableBinding::NonLocal(_) => Err(LowerError::Invariant {
            reason: "Could not find binding for declaration".to_string(),
            loc,
        }),
    }
}

/// `lowerAssignment` over oxc's `AssignmentTarget` (the LHS of an `=`/`for-of`/
/// `for-in`): identifiers, member expressions, and array/object destructuring
/// targets. Returns a `LoadLocal` of the produced value.
pub fn lower_assignment_target(
    builder: &mut HirBuilder<'_, '_>,
    loc: SourceLocation,
    kind: InstructionKind,
    target: &AssignmentTarget<'_>,
    value: Place,
    assignment_kind: AssignmentKind,
) -> Result<InstructionValue, LowerError> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(ident) => {
            let symbol = super::lower_expression::reference_symbol(builder, ident);
            let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
            match binding {
                VariableBinding::Identifier { identifier, .. } => {
                    let place = Place {
                        identifier,
                        effect: Effect::Unknown,
                        reactive: false,
                        loc: loc.clone(),
                    };
                    let temporary = if builder.is_context_identifier(symbol) {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreContext {
                                kind,
                                place,
                                value,
                                loc: loc.clone(),
                            },
                        )
                    } else {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreLocal {
                                lvalue: LValue { place, kind },
                                value,
                                type_annotation: None,
                                loc: loc.clone(),
                            },
                        )
                    };
                    Ok(InstructionValue::LoadLocal {
                        loc: temporary.loc.clone(),
                        place: temporary,
                    })
                }
                VariableBinding::NonLocal(_) => {
                    let temporary = lower_value_to_temporary(
                        builder,
                        InstructionValue::StoreGlobal {
                            name: ident.name.as_str().to_string(),
                            value,
                            loc: loc.clone(),
                        },
                    );
                    Ok(InstructionValue::LoadLocal {
                        loc: temporary.loc.clone(),
                        place: temporary,
                    })
                }
            }
        }
        AssignmentTarget::StaticMemberExpression(member) => {
            let object = lower_expression_to_temporary(builder, &member.object)?;
            let property = PropertyLiteral::String(member.property.name.as_str().to_string());
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::PropertyStore {
                    object,
                    property,
                    value,
                    loc: loc.clone(),
                },
            );
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            let object = lower_expression_to_temporary(builder, &member.object)?;
            if let oxc::ast::ast::Expression::NumericLiteral(n) = &member.expression {
                let temporary = lower_value_to_temporary(
                    builder,
                    InstructionValue::PropertyStore {
                        object,
                        property: PropertyLiteral::Number(n.value),
                        value,
                        loc: loc.clone(),
                    },
                );
                return Ok(InstructionValue::LoadLocal {
                    loc: temporary.loc.clone(),
                    place: temporary,
                });
            }
            let property = lower_expression_to_temporary(builder, &member.expression)?;
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::ComputedStore {
                    object,
                    property,
                    value,
                    loc: loc.clone(),
                },
            );
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
        AssignmentTarget::ArrayAssignmentTarget(array) => {
            let pattern_loc = span_to_loc(array.span, builder);
            let mut items: Vec<ArrayPatternItem> = Vec::new();
            let mut followups: Vec<TargetFollowup<'_>> = Vec::new();
            // `forceTemporaries` (BuildHIR.ts:3988-3996): when reassigning, if any
            // element is not a plain identifier, or is an identifier that stores to
            // a context variable or a global, route ALL targets through promoted
            // temporaries and re-store them via follow-up instructions.
            let force_temporaries = kind == InstructionKind::Reassign
                && (array.rest.is_some()
                    || array.elements.iter().any(|element| {
                        !matches!(
                            element,
                            Some(AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(_))
                        )
                    })
                    || array.elements.iter().any(|element| {
                        match element {
                            Some(AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(
                                ident,
                            )) => identifier_forces_temporary(builder, ident),
                            _ => false,
                        }
                    }));
            for element in &array.elements {
                match element {
                    None => items.push(ArrayPatternItem::Hole),
                    Some(AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(ident))
                        if !force_temporaries
                            && (assignment_kind == AssignmentKind::Assignment
                                || !is_target_context(builder, ident)) =>
                    {
                        // Bind directly (`StoreLocal` will be the Destructure's
                        // implicit store) — only valid for non-global locals.
                        let place_loc = span_to_loc(ident.span, builder);
                        let place = resolve_target_identifier_place(builder, ident, place_loc)?;
                        items.push(ArrayPatternItem::Place(place));
                    }
                    Some(elem) => {
                        let elem_loc = span_to_loc(elem.span(), builder);
                        let mut temp = build_temporary_place(builder, elem_loc);
                        promote_temporary(&mut temp);
                        items.push(ArrayPatternItem::Place(temp.clone()));
                        followups.push(TargetFollowup::MaybeDefault {
                            place: temp,
                            target: elem,
                        });
                    }
                }
            }
            if let Some(rest) = &array.rest {
                let rest_loc = span_to_loc(rest.span, builder);
                match &rest.target {
                    AssignmentTarget::AssignmentTargetIdentifier(ident)
                        if !force_temporaries
                            && (assignment_kind == AssignmentKind::Assignment
                                || !is_target_context(builder, ident)) =>
                    {
                        let place = resolve_target_identifier_place(builder, ident, rest_loc)?;
                        items.push(ArrayPatternItem::Spread(SpreadPattern { place }));
                    }
                    target => {
                        let mut temp = build_temporary_place(builder, rest_loc);
                        promote_temporary(&mut temp);
                        items.push(ArrayPatternItem::Spread(SpreadPattern { place: temp.clone() }));
                        followups.push(TargetFollowup::Target {
                            place: temp,
                            target,
                        });
                    }
                }
            }
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Array(ArrayPattern {
                            items,
                            loc: pattern_loc,
                        }),
                        kind,
                    },
                    value: value.clone(),
                    loc,
                },
            );
            run_target_followups(builder, followups, kind, assignment_kind)?;
            Ok(InstructionValue::LoadLocal {
                loc: value.loc.clone(),
                place: temporary,
            })
        }
        AssignmentTarget::ObjectAssignmentTarget(object) => {
            let pattern_loc = span_to_loc(object.span, builder);
            let mut properties: Vec<ObjectPatternProperty> = Vec::new();
            let mut followups: Vec<TargetFollowup<'_>> = Vec::new();
            // `forceTemporaries` (BuildHIR.ts:4122-4132): when reassigning, if there
            // is a rest element or any property whose value is not a plain local
            // identifier (e.g. a nested pattern or a global), route ALL targets
            // through promoted temporaries.
            let force_temporaries = kind == InstructionKind::Reassign
                && (object.rest.is_some()
                    || object.properties.iter().any(|property| match property {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(prop) => {
                            // shorthand `{x}`: value is the identifier binding.
                            binding_reference_is_global(builder, &prop.binding)
                        }
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(prop) => {
                            match assignment_target_value_identifier(&prop.binding) {
                                Some(ident) => binding_reference_is_global(builder, ident),
                                None => true,
                            }
                        }
                    }));
            for property in &object.properties {
                match property {
                    AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(prop) => {
                        if prop.init.is_some() {
                            return Err(LowerError::UnsupportedStatement {
                                kind: "ObjectAssignmentTarget(default)".to_string(),
                                loc: span_to_loc(prop.span, builder),
                            });
                        }
                        let key = ObjectPropertyKey::Identifier {
                            name: prop.binding.name.as_str().to_string(),
                        };
                        let place_loc = span_to_loc(prop.binding.span, builder);
                        if !force_temporaries
                            && (assignment_kind == AssignmentKind::Assignment
                                || !is_target_context(builder, &prop.binding))
                        {
                            let place = resolve_target_identifier_place(
                                builder,
                                &prop.binding,
                                place_loc,
                            )?;
                            properties.push(ObjectPatternProperty::Property(ObjectProperty {
                                key,
                                property_type: PropertyType::Property,
                                place,
                            }));
                        } else {
                            let mut temp = build_temporary_place(builder, place_loc);
                            promote_temporary(&mut temp);
                            properties.push(ObjectPatternProperty::Property(ObjectProperty {
                                key,
                                property_type: PropertyType::Property,
                                place: temp.clone(),
                            }));
                            followups.push(TargetFollowup::Identifier {
                                place: temp,
                                target: &prop.binding,
                            });
                        }
                    }
                    AssignmentTargetProperty::AssignmentTargetPropertyProperty(prop) => {
                        let key = lower_assignment_target_property_key(builder, &prop.name)?;
                        match &prop.binding {
                            AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(ident)
                                if !force_temporaries
                                    && (assignment_kind == AssignmentKind::Assignment
                                        || !is_target_context(builder, ident)) =>
                            {
                                let place_loc = span_to_loc(ident.span, builder);
                                let place =
                                    resolve_target_identifier_place(builder, ident, place_loc)?;
                                properties.push(ObjectPatternProperty::Property(ObjectProperty {
                                    key,
                                    property_type: PropertyType::Property,
                                    place,
                                }));
                            }
                            binding => {
                                let elem_loc = span_to_loc(binding.span(), builder);
                                let mut temp = build_temporary_place(builder, elem_loc);
                                promote_temporary(&mut temp);
                                properties.push(ObjectPatternProperty::Property(ObjectProperty {
                                    key,
                                    property_type: PropertyType::Property,
                                    place: temp.clone(),
                                }));
                                followups.push(TargetFollowup::MaybeDefault {
                                    place: temp,
                                    target: binding,
                                });
                            }
                        }
                    }
                }
            }
            if let Some(rest) = &object.rest {
                let rest_loc = span_to_loc(rest.span, builder);
                match &rest.target {
                    // Object rest forces a temporary whenever `forceTemporaries`
                    // holds or the target is a context identifier (BuildHIR.ts:
                    // 4148-4186).
                    AssignmentTarget::AssignmentTargetIdentifier(ident)
                        if !force_temporaries && !is_target_context(builder, ident) =>
                    {
                        let place = resolve_target_identifier_place(builder, ident, rest_loc)?;
                        properties
                            .push(ObjectPatternProperty::Spread(SpreadPattern { place }));
                    }
                    target => {
                        let mut temp = build_temporary_place(builder, rest_loc);
                        promote_temporary(&mut temp);
                        properties.push(ObjectPatternProperty::Spread(SpreadPattern {
                            place: temp.clone(),
                        }));
                        followups.push(TargetFollowup::Target {
                            place: temp,
                            target,
                        });
                    }
                }
            }
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::Destructure {
                    lvalue: LValuePattern {
                        pattern: Pattern::Object(ObjectPattern {
                            properties,
                            loc: pattern_loc,
                        }),
                        kind,
                    },
                    value: value.clone(),
                    loc,
                },
            );
            run_target_followups(builder, followups, kind, assignment_kind)?;
            Ok(InstructionValue::LoadLocal {
                loc: value.loc.clone(),
                place: temporary,
            })
        }
        _ => Err(LowerError::UnsupportedStatement {
            kind: "AssignmentTarget".to_string(),
            loc,
        }),
    }
}

/// A deferred reassignment target collected during a destructure-assignment with
/// `forceTemporaries` (the TS `followups` array): a promoted temporary plus the
/// original assignment target it should be re-stored into.
enum TargetFollowup<'a> {
    /// An `AssignmentTarget` (a rest element's target).
    Target {
        place: Place,
        target: &'a AssignmentTarget<'a>,
    },
    /// An `AssignmentTargetMaybeDefault` (an array element / object property
    /// value, possibly with a default).
    MaybeDefault {
        place: Place,
        target: &'a AssignmentTargetMaybeDefault<'a>,
    },
    /// A shorthand object-pattern identifier (`{x}`), re-stored to `target`.
    Identifier {
        place: Place,
        target: &'a oxc::ast::ast::IdentifierReference<'a>,
    },
}

/// Run the deferred reassignment follow-ups collected during a destructure-
/// assignment, re-storing each promoted temporary into its real target via
/// `lowerAssignment` (BuildHIR.ts:4097-4106 / 4287-4296).
fn run_target_followups(
    builder: &mut HirBuilder<'_, '_>,
    followups: Vec<TargetFollowup<'_>>,
    kind: InstructionKind,
    assignment_kind: AssignmentKind,
) -> Result<(), LowerError> {
    for followup in followups {
        match followup {
            TargetFollowup::Target { place, target } => {
                let loc = span_to_loc(target.span(), builder);
                lower_assignment_target(builder, loc, kind, target, place, assignment_kind)?;
            }
            TargetFollowup::MaybeDefault { place, target } => {
                lower_assignment_target_maybe_default(
                    builder,
                    kind,
                    target,
                    place,
                    assignment_kind,
                )?;
            }
            TargetFollowup::Identifier { place, target } => {
                let loc = span_to_loc(target.span, builder);
                lower_assignment_target_identifier_store(builder, loc, kind, target, place)?;
            }
        }
    }
    Ok(())
}

/// Lower an `AssignmentTargetMaybeDefault` re-store: a plain target delegates to
/// [`lower_assignment_target`]; a `[x = default]` default applies the
/// `value === undefined ? default : value` ternary (mirroring `lowerAssignment`'s
/// `AssignmentPattern` case) before re-storing.
fn lower_assignment_target_maybe_default(
    builder: &mut HirBuilder<'_, '_>,
    kind: InstructionKind,
    target: &AssignmentTargetMaybeDefault<'_>,
    value: Place,
    assignment_kind: AssignmentKind,
) -> Result<InstructionValue, LowerError> {
    match target {
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(with_default) => {
            let loc = span_to_loc(with_default.span, builder);
            let temp = build_temporary_place(builder, loc.clone());

            let test_block = builder.reserve(BlockKind::Value);
            let test_block_id = test_block.id;
            let continuation = builder.reserve(builder.current_block_kind());
            let continuation_id = continuation.id;

            let temp_for_cons = temp.clone();
            let cons_loc = loc.clone();
            let mut inner_err: Option<LowerError> = None;
            let consequent = builder.enter(BlockKind::Value, |builder, _| {
                match lower_expression_to_temporary(builder, &with_default.init) {
                    Ok(default_value) => {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreLocal {
                                lvalue: LValue {
                                    place: temp_for_cons.clone(),
                                    kind: InstructionKind::Const,
                                },
                                value: default_value,
                                type_annotation: None,
                                loc: cons_loc.clone(),
                            },
                        );
                    }
                    Err(e) => inner_err = Some(e),
                }
                goto_break(continuation_id, cons_loc.clone())
            });
            if let Some(e) = inner_err {
                return Err(e);
            }

            let temp_for_alt = temp.clone();
            let value_for_alt = value.clone();
            let alt_loc = loc.clone();
            let alternate = builder.enter(BlockKind::Value, |builder, _| {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: temp_for_alt.clone(),
                            kind: InstructionKind::Const,
                        },
                        value: value_for_alt.clone(),
                        type_annotation: None,
                        loc: alt_loc.clone(),
                    },
                );
                goto_break(continuation_id, alt_loc.clone())
            });

            builder.terminate_with_continuation(
                Terminal::Ternary {
                    test: test_block_id,
                    fallthrough: continuation_id,
                    id: zero_id(),
                    loc: loc.clone(),
                },
                test_block,
            );
            let undef = lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::Undefined,
                    loc: loc.clone(),
                },
            );
            let test = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: "===".to_string(),
                    left: value.clone(),
                    right: undef,
                    loc: loc.clone(),
                },
            );
            builder.terminate_with_continuation(
                Terminal::Branch {
                    test,
                    consequent,
                    alternate,
                    fallthrough: continuation_id,
                    id: zero_id(),
                    loc: loc.clone(),
                },
                continuation,
            );

            lower_assignment_target(builder, loc, kind, &with_default.binding, temp, assignment_kind)
        }
        // Otherwise this is an inherited `AssignmentTarget` variant.
        other => {
            let target = other.to_assignment_target();
            let loc = span_to_loc(target.span(), builder);
            lower_assignment_target(builder, loc, kind, target, value, assignment_kind)
        }
    }
}

/// Store a promoted temporary into a shorthand object-pattern identifier
/// (`StoreLocal`/`StoreContext`/`StoreGlobal`), used by [`run_target_followups`].
fn lower_assignment_target_identifier_store(
    builder: &mut HirBuilder<'_, '_>,
    loc: SourceLocation,
    kind: InstructionKind,
    ident: &oxc::ast::ast::IdentifierReference<'_>,
    value: Place,
) -> Result<InstructionValue, LowerError> {
    let symbol = super::lower_expression::reference_symbol(builder, ident);
    let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
    match binding {
        VariableBinding::Identifier { identifier, .. } => {
            let place = Place {
                identifier,
                effect: Effect::Unknown,
                reactive: false,
                loc: loc.clone(),
            };
            let temporary = if builder.is_context_identifier(symbol) {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreContext {
                        kind,
                        place,
                        value,
                        loc: loc.clone(),
                    },
                )
            } else {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue { place, kind },
                        value,
                        type_annotation: None,
                        loc: loc.clone(),
                    },
                )
            };
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
        VariableBinding::NonLocal(_) => {
            let temporary = lower_value_to_temporary(
                builder,
                InstructionValue::StoreGlobal {
                    name: ident.name.as_str().to_string(),
                    value,
                    loc: loc.clone(),
                },
            );
            Ok(InstructionValue::LoadLocal {
                loc: temporary.loc.clone(),
                place: temporary,
            })
        }
    }
}

/// Resolve an assignment-target identifier (used as a direct destructure target)
/// to its bound place. Returns an error for a global target (which must instead
/// be routed through `forceTemporaries`).
fn resolve_target_identifier_place(
    builder: &mut HirBuilder<'_, '_>,
    ident: &oxc::ast::ast::IdentifierReference<'_>,
    loc: SourceLocation,
) -> Result<Place, LowerError> {
    let symbol = super::lower_expression::reference_symbol(builder, ident);
    let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
    match binding {
        VariableBinding::Identifier { identifier, .. } => Ok(Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc,
        }),
        VariableBinding::NonLocal(_) => Err(LowerError::Invariant {
            reason: "Expected reassignment of globals to enable forceTemporaries".to_string(),
            loc,
        }),
    }
}

/// Whether a reassignment of `ident` would target a context (captured) variable
/// (`getStoreKind === 'StoreContext'`).
fn is_target_context(
    builder: &HirBuilder<'_, '_>,
    ident: &oxc::ast::ast::IdentifierReference<'_>,
) -> bool {
    let symbol = super::lower_expression::reference_symbol(builder, ident);
    builder.is_context_identifier(symbol)
}

/// Whether an identifier element forces all destructure targets through
/// temporaries: it stores to a context variable, or it resolves to a non-local
/// (global) binding (`getStoreKind !== 'StoreLocal' || resolveIdentifier.kind !==
/// 'Identifier'`).
fn identifier_forces_temporary(
    builder: &mut HirBuilder<'_, '_>,
    ident: &oxc::ast::ast::IdentifierReference<'_>,
) -> bool {
    if is_target_context(builder, ident) {
        return true;
    }
    binding_reference_is_global(builder, ident)
}

/// Whether `ident` resolves to a non-local (global / module) binding rather than
/// a local identifier (`resolveIdentifier(...).kind !== 'Identifier'`).
fn binding_reference_is_global(
    builder: &mut HirBuilder<'_, '_>,
    ident: &oxc::ast::ast::IdentifierReference<'_>,
) -> bool {
    let symbol = super::lower_expression::reference_symbol(builder, ident);
    let loc = span_to_loc(ident.span, builder);
    matches!(
        builder.resolve_identifier(ident.name.as_str(), symbol, loc),
        VariableBinding::NonLocal(_)
    )
}

/// Extract the value identifier of an object-property assignment target when it
/// is a plain `{key: value}` identifier (no default, no nested pattern).
fn assignment_target_value_identifier<'a>(
    binding: &'a AssignmentTargetMaybeDefault<'a>,
) -> Option<&'a oxc::ast::ast::IdentifierReference<'a>> {
    match binding {
        AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(ident) => Some(ident),
        _ => None,
    }
}

fn lower_assignment_target_property_key(
    builder: &mut HirBuilder<'_, '_>,
    key: &PropertyKey<'_>,
) -> Result<ObjectPropertyKey, LowerError> {
    lower_binding_property_key(builder, key)
}

/// `lowerObjectPropertyKey` restricted to non-computed binding-property keys.
fn lower_binding_property_key(
    builder: &mut HirBuilder<'_, '_>,
    key: &PropertyKey<'_>,
) -> Result<ObjectPropertyKey, LowerError> {
    match key {
        PropertyKey::StaticIdentifier(id) => Ok(ObjectPropertyKey::Identifier {
            name: id.name.as_str().to_string(),
        }),
        PropertyKey::StringLiteral(s) => Ok(ObjectPropertyKey::String {
            name: s.value.as_str().to_string(),
        }),
        PropertyKey::NumericLiteral(n) => Ok(ObjectPropertyKey::Identifier {
            name: format_number_key(n.value),
        }),
        other => Err(LowerError::UnsupportedStatement {
            kind: "ObjectPatternKey".to_string(),
            loc: span_to_loc(other.span(), builder),
        }),
    }
}

/// Render a numeric object key the way the TS `String(value)` does for the
/// integer keys that appear in patterns.
fn format_number_key(value: f64) -> String {
    if value.fract() == 0.0 && value.is_finite() {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

/// A short textual kind name for an unsupported statement.
fn statement_kind(stmt: &Statement<'_>) -> &'static str {
    match stmt {
        Statement::TryStatement(_) => "TryStatement",
        Statement::WithStatement(_) => "WithStatement",
        Statement::ClassDeclaration(_) => "ClassDeclaration",
        Statement::ImportDeclaration(_) => "ImportDeclaration",
        Statement::ExportAllDeclaration(_) => "ExportAllDeclaration",
        Statement::ExportDefaultDeclaration(_) => "ExportDefaultDeclaration",
        Statement::ExportNamedDeclaration(_) => "ExportNamedDeclaration",
        _ => "Statement",
    }
}
