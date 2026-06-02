//! `renameVariables`, ported from
//! `packages/react-compiler/src/ReactiveScopes/RenameVariables.ts`
//! (+ `CollectReferencedGlobals.ts`).
//!
//! Ensures each named variable has a unique name that does not collide with any
//! other variable in the same (final, inferred) block scope. Promoted temporaries
//! (`#t…`/`#T…`) become `t0`/`T0` (incrementing the numeric suffix on collision);
//! other names that collide get an `<original>$<n>` suffix.
//!
//! Returns the set of all unique variable names after renaming, unioned with the
//! referenced globals — this is the `uniqueIdentifiers` set codegen consumes.
//!
//! The block-scope stack is keyed by [`DeclarationId`] so every instance of one
//! declaration is renamed once and reused. Names are assigned in visit order:
//! params, then body instructions (lvalues before value operands), then scope
//! declarations, descending into nested blocks (each block pushes a fresh scope
//! frame), mirroring the `ReactiveFunctionVisitor` traversal exactly.

use std::collections::{HashMap, HashSet};

use crate::hir::ids::DeclarationId;
use crate::hir::model::FunctionParam;
use crate::hir::place::{Identifier, IdentifierName, is_promoted_jsx_temporary, is_promoted_temporary};
use crate::hir::value::InstructionValue;

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveStatement,
    ReactiveTerminal, ReactiveValue,
};
use super::prune_non_reactive_dependencies::each_reactive_value_operand;

/// `renameVariables(fn)`: rename all named identifiers, returning the set of
/// unique names (∪ referenced globals) for codegen.
pub fn rename_variables(func: &mut ReactiveFunction) -> HashSet<String> {
    let globals = collect_referenced_globals(func);
    let mut scopes = Scopes::new(globals.clone());

    // `renameVariablesImpl`: enter a scope, visit params, then the body.
    scopes.enter();
    for param in &mut func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &mut spread.place,
        };
        scopes.visit(&mut place.identifier);
    }
    visit_block(&mut func.body, &mut scopes);
    scopes.exit();

    // In the TS compiler `scope.dependencies[].identifier`,
    // `scope.declarations[].identifier`, and `scope.reassignments[]` are the *same*
    // `Identifier` objects referenced elsewhere as places, so renaming an instance
    // renames the scope metadata too. Our model clones identifiers into each place,
    // so re-apply the final `declarationId -> name` mapping to every scope-metadata
    // identifier to reproduce that shared-reference aliasing.
    apply_seen_block(&mut func.body, &scopes.seen);

    let mut out = scopes.names;
    out.extend(globals);
    out
}

/// Re-apply the resolved `declarationId -> name` mapping to the cloned identifiers
/// carried on scope dependencies / declarations / reassignments / early-return
/// values (which the visitor does not rename directly).
fn apply_seen_block(block: &mut ReactiveBlock, seen: &HashMap<DeclarationId, IdentifierName>) {
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(_) => {}
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                for dep in scope.scope.dependencies.iter_mut() {
                    apply_seen(&mut dep.identifier, seen);
                }
                for (_, decl) in scope.scope.declarations.iter_mut() {
                    apply_seen(&mut decl.identifier, seen);
                }
                for reassign in scope.scope.reassignments.iter_mut() {
                    apply_seen(reassign, seen);
                }
                if let Some(early) = &mut scope.scope.early_return_value {
                    apply_seen(&mut early.value, seen);
                }
                apply_seen_block(&mut scope.instructions, seen);
            }
            ReactiveStatement::Terminal(stmt) => apply_seen_terminal(&mut stmt.terminal, seen),
        }
    }
}

fn apply_seen(identifier: &mut Identifier, seen: &HashMap<DeclarationId, IdentifierName>) {
    if let Some(name) = seen.get(&identifier.declaration_id) {
        identifier.name = Some(name.clone());
    }
}

fn apply_seen_terminal(
    terminal: &mut ReactiveTerminal,
    seen: &HashMap<DeclarationId, IdentifierName>,
) {
    match terminal {
        ReactiveTerminal::For { loop_, .. }
        | ReactiveTerminal::ForOf { loop_, .. }
        | ReactiveTerminal::ForIn { loop_, .. }
        | ReactiveTerminal::DoWhile { loop_, .. }
        | ReactiveTerminal::While { loop_, .. } => apply_seen_block(loop_, seen),
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            apply_seen_block(consequent, seen);
            if let Some(alternate) = alternate {
                apply_seen_block(alternate, seen);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &mut case.block {
                    apply_seen_block(block, seen);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => apply_seen_block(block, seen),
        ReactiveTerminal::Try { block, handler, .. } => {
            apply_seen_block(block, seen);
            apply_seen_block(handler, seen);
        }
        _ => {}
    }
}

// ---- the scope-stack collision resolver (TS `Scopes`) ----

struct Scopes {
    seen: HashMap<DeclarationId, IdentifierName>,
    stack: Vec<HashMap<String, DeclarationId>>,
    globals: HashSet<String>,
    names: HashSet<String>,
}

impl Scopes {
    fn new(globals: HashSet<String>) -> Self {
        Scopes {
            seen: HashMap::new(),
            stack: vec![HashMap::new()],
            globals,
            names: HashSet::new(),
        }
    }

    fn enter(&mut self) {
        self.stack.push(HashMap::new());
    }

    fn exit(&mut self) {
        self.stack.pop();
    }

    fn lookup(&self, name: &str) -> Option<DeclarationId> {
        for scope in self.stack.iter().rev() {
            if let Some(decl) = scope.get(name) {
                return Some(*decl);
            }
        }
        None
    }

    fn visit(&mut self, identifier: &mut Identifier) {
        let Some(original_name) = identifier.name.clone() else {
            return;
        };
        let original_value = match &original_name {
            IdentifierName::Named { value } | IdentifierName::Promoted { value } => value.clone(),
        };

        if let Some(mapped) = self.seen.get(&identifier.declaration_id) {
            identifier.name = Some(mapped.clone());
            return;
        }

        let is_promoted = is_promoted_temporary(&original_value);
        let is_jsx = is_promoted_jsx_temporary(&original_value);

        let mut id = 0u32;
        let mut name = if is_promoted {
            let n = format!("t{id}");
            id += 1;
            n
        } else if is_jsx {
            let n = format!("T{id}");
            id += 1;
            n
        } else {
            original_value.clone()
        };

        while self.lookup(&name).is_some() || self.globals.contains(&name) {
            if is_promoted {
                name = format!("t{id}");
                id += 1;
            } else if is_jsx {
                name = format!("T{id}");
                id += 1;
            } else {
                name = format!("{original_value}${id}");
                id += 1;
            }
        }

        let identifier_name = IdentifierName::Named { value: name.clone() };
        identifier.name = Some(identifier_name.clone());
        self.seen.insert(identifier.declaration_id, identifier_name);
        self.stack
            .last_mut()
            .unwrap()
            .insert(name.clone(), identifier.declaration_id);
        self.names.insert(name);
    }
}

// ---- traversal (mirrors `Visitor`) ----

/// `visitBlock`: each block pushes a fresh scope frame (`state.enter`).
fn visit_block(block: &mut ReactiveBlock, scopes: &mut Scopes) {
    scopes.enter();
    for stmt in block.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => visit_instruction(instruction, scopes),
            ReactiveStatement::Scope(scope) => visit_scope(scope, scopes),
            ReactiveStatement::PrunedScope(scope) => visit_pruned_scope(scope, scopes),
            ReactiveStatement::Terminal(stmt) => visit_terminal(&mut stmt.terminal, scopes),
        }
    }
    scopes.exit();
}

/// `visitScope`: visit declarations, then `traverseScope` (the body block).
fn visit_scope(scope: &mut ReactiveScopeBlock, scopes: &mut Scopes) {
    for (_, decl) in scope.scope.declarations.iter_mut() {
        scopes.visit(&mut decl.identifier);
    }
    visit_block(&mut scope.instructions, scopes);
}

/// `visitPrunedScope`: `traverseBlock` directly (no new frame, no declarations).
fn visit_pruned_scope(scope: &mut ReactiveScopeBlock, scopes: &mut Scopes) {
    for stmt in scope.instructions.iter_mut() {
        match stmt {
            ReactiveStatement::Instruction(instruction) => visit_instruction(instruction, scopes),
            ReactiveStatement::Scope(scope) => visit_scope(scope, scopes),
            ReactiveStatement::PrunedScope(scope) => visit_pruned_scope(scope, scopes),
            ReactiveStatement::Terminal(stmt) => visit_terminal(&mut stmt.terminal, scopes),
        }
    }
}

/// `traverseInstruction`: lvalues (instr.lvalue, then value lvalues) before the
/// value's operands.
fn visit_instruction(instruction: &mut ReactiveInstruction, scopes: &mut Scopes) {
    if let Some(lvalue) = &mut instruction.lvalue {
        scopes.visit(&mut lvalue.identifier);
    }
    if let ReactiveValue::Instruction(value) = &mut instruction.value {
        for place in crate::passes::cfg::each_instruction_value_lvalue_mut(value) {
            scopes.visit(&mut place.identifier);
        }
    }
    visit_value(&mut instruction.value, scopes);
}

/// `traverseValue`: recurse into compound members, then visit each operand.
fn visit_value(value: &mut ReactiveValue, scopes: &mut Scopes) {
    match value {
        ReactiveValue::Sequence(seq) => {
            for instr in seq.instructions.iter_mut() {
                visit_instruction(instr, scopes);
            }
            visit_value(&mut seq.value, scopes);
        }
        ReactiveValue::Logical(logical) => {
            visit_value(&mut logical.left, scopes);
            visit_value(&mut logical.right, scopes);
        }
        ReactiveValue::Ternary(ternary) => {
            visit_value(&mut ternary.test, scopes);
            visit_value(&mut ternary.consequent, scopes);
            visit_value(&mut ternary.alternate, scopes);
        }
        ReactiveValue::OptionalCall(optional) => {
            visit_value(&mut optional.value, scopes);
        }
        ReactiveValue::Instruction(instr_value) => {
            // `traverseValue` default: visit the value's own operands (for a
            // FunctionExpression/ObjectMethod these are the captured context
            // places).
            for place in crate::passes::cfg::each_instruction_value_operand_mut(instr_value) {
                scopes.visit(&mut place.identifier);
            }
            // `visitValue` override (RenameVariables.ts:108-113): after the base
            // traversal, descend into the nested HIR function body so its
            // params/lvalues/operands are renamed using the same Scopes stack.
            match instr_value.as_mut() {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    visit_hir_function(&mut lowered_func.func, scopes);
                }
                _ => {}
            }
        }
    }
}

/// `ReactiveFunctionVisitor.visitHirFunction` (visitors.ts:233-252): visit the
/// nested HIR function's params, then each block's instructions (lvalues before
/// operands, recursing into further-nested functions) and terminal operands. No
/// new Scopes frame is pushed — the same block-scope stack is shared.
fn visit_hir_function(func: &mut crate::hir::model::HirFunction, scopes: &mut Scopes) {
    for param in &mut func.params {
        let place = match param {
            FunctionParam::Place(place) => place,
            FunctionParam::Spread(spread) => &mut spread.place,
        };
        scopes.visit(&mut place.identifier);
    }
    for block in func.body.blocks_mut() {
        for instr in &mut block.instructions {
            // `traverseInstruction`: lvalues (instr.lvalue + value lvalues) first.
            for lvalue in crate::passes::cfg::each_instruction_lvalue_mut(instr) {
                scopes.visit(&mut lvalue.identifier);
            }
            // then the value operands.
            for place in crate::passes::cfg::each_instruction_value_operand_mut(&mut instr.value) {
                scopes.visit(&mut place.identifier);
            }
            // recurse into further-nested functions.
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    visit_hir_function(&mut lowered_func.func, scopes);
                }
                _ => {}
            }
        }
        for operand in crate::passes::cfg::each_terminal_operand_mut(&mut block.terminal) {
            scopes.visit(&mut operand.identifier);
        }
    }
}

fn visit_terminal(terminal: &mut ReactiveTerminal, scopes: &mut Scopes) {
    match terminal {
        ReactiveTerminal::Break { .. } | ReactiveTerminal::Continue { .. } => {}
        ReactiveTerminal::Return { value, .. } | ReactiveTerminal::Throw { value, .. } => {
            scopes.visit(&mut value.identifier)
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            visit_value(init, scopes);
            visit_value(test, scopes);
            visit_block(loop_, scopes);
            if let Some(update) = update {
                visit_value(update, scopes);
            }
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            visit_value(init, scopes);
            visit_value(test, scopes);
            visit_block(loop_, scopes);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            visit_value(init, scopes);
            visit_block(loop_, scopes);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            visit_block(loop_, scopes);
            visit_value(test, scopes);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            visit_value(test, scopes);
            visit_block(loop_, scopes);
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            ..
        } => {
            scopes.visit(&mut test.identifier);
            visit_block(consequent, scopes);
            if let Some(alternate) = alternate {
                visit_block(alternate, scopes);
            }
        }
        ReactiveTerminal::Switch { test, cases, .. } => {
            scopes.visit(&mut test.identifier);
            for case in cases {
                if let Some(case_test) = &mut case.test {
                    scopes.visit(&mut case_test.identifier);
                }
                if let Some(block) = &mut case.block {
                    visit_block(block, scopes);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => visit_block(block, scopes),
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            ..
        } => {
            visit_block(block, scopes);
            if let Some(binding) = handler_binding {
                scopes.visit(&mut binding.identifier);
            }
            visit_block(handler, scopes);
        }
    }
}

// ---- collectReferencedGlobals ----

/// `collectReferencedGlobals(fn)`: every `LoadGlobal` binding name reachable in
/// the reactive tree.
fn collect_referenced_globals(func: &ReactiveFunction) -> HashSet<String> {
    let mut globals = HashSet::new();
    globals_block(&func.body, &mut globals);
    globals
}

fn globals_block(block: &ReactiveBlock, globals: &mut HashSet<String>) {
    for stmt in block {
        match stmt {
            ReactiveStatement::Instruction(instruction) => {
                globals_value(&instruction.value, globals)
            }
            ReactiveStatement::Scope(scope) | ReactiveStatement::PrunedScope(scope) => {
                globals_block(&scope.instructions, globals)
            }
            ReactiveStatement::Terminal(stmt) => globals_terminal(&stmt.terminal, globals),
        }
    }
}

fn globals_value(value: &ReactiveValue, globals: &mut HashSet<String>) {
    if let ReactiveValue::Sequence(seq) = value {
        for instr in &seq.instructions {
            globals_value(&instr.value, globals);
        }
    }
    match value {
        ReactiveValue::Logical(logical) => {
            globals_value(&logical.left, globals);
            globals_value(&logical.right, globals);
        }
        ReactiveValue::Ternary(ternary) => {
            globals_value(&ternary.test, globals);
            globals_value(&ternary.consequent, globals);
            globals_value(&ternary.alternate, globals);
        }
        ReactiveValue::Sequence(seq) => globals_value(&seq.value, globals),
        ReactiveValue::OptionalCall(optional) => globals_value(&optional.value, globals),
        ReactiveValue::Instruction(instr_value) => match instr_value.as_ref() {
            InstructionValue::LoadGlobal { binding, .. } => {
                globals.insert(binding_name(binding));
            }
            // `visitValue` override (CollectReferencedGlobals.ts:27-31): descend
            // into nested HIR function bodies so LoadGlobals referenced only
            // inside a FunctionExpression/ObjectMethod are still collected.
            InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } => {
                globals_hir_function(&lowered_func.func, globals);
            }
            _ => {}
        },
    }
    // The reactive-value operands themselves carry no globals; only the base
    // `LoadGlobal` value (and nested function bodies) do (handled above).
    let _ = each_reactive_value_operand;
}

/// `ReactiveFunctionVisitor.visitHirFunction` for global collection: walk every
/// HIR instruction value in the nested function body, collecting `LoadGlobal`
/// names and recursing into further-nested functions.
fn globals_hir_function(func: &crate::hir::model::HirFunction, globals: &mut HashSet<String>) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadGlobal { binding, .. } => {
                    globals.insert(binding_name(binding));
                }
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    globals_hir_function(&lowered_func.func, globals);
                }
                _ => {}
            }
        }
    }
}

fn binding_name(binding: &crate::hir::value::NonLocalBinding) -> String {
    use crate::hir::value::NonLocalBinding;
    match binding {
        NonLocalBinding::ImportDefault { name, .. }
        | NonLocalBinding::ImportNamespace { name, .. }
        | NonLocalBinding::ImportSpecifier { name, .. }
        | NonLocalBinding::ModuleLocal { name }
        | NonLocalBinding::Global { name } => name.clone(),
    }
}

fn globals_terminal(terminal: &ReactiveTerminal, globals: &mut HashSet<String>) {
    match terminal {
        ReactiveTerminal::Break { .. }
        | ReactiveTerminal::Continue { .. }
        | ReactiveTerminal::Return { .. }
        | ReactiveTerminal::Throw { .. } => {}
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            ..
        } => {
            globals_value(init, globals);
            globals_value(test, globals);
            if let Some(update) = update {
                globals_value(update, globals);
            }
            globals_block(loop_, globals);
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, ..
        } => {
            globals_value(init, globals);
            globals_value(test, globals);
            globals_block(loop_, globals);
        }
        ReactiveTerminal::ForIn { init, loop_, .. } => {
            globals_value(init, globals);
            globals_block(loop_, globals);
        }
        ReactiveTerminal::DoWhile { loop_, test, .. } => {
            globals_block(loop_, globals);
            globals_value(test, globals);
        }
        ReactiveTerminal::While { test, loop_, .. } => {
            globals_value(test, globals);
            globals_block(loop_, globals);
        }
        ReactiveTerminal::If {
            consequent,
            alternate,
            ..
        } => {
            globals_block(consequent, globals);
            if let Some(alternate) = alternate {
                globals_block(alternate, globals);
            }
        }
        ReactiveTerminal::Switch { cases, .. } => {
            for case in cases {
                if let Some(block) = &case.block {
                    globals_block(block, globals);
                }
            }
        }
        ReactiveTerminal::Label { block, .. } => globals_block(block, globals),
        ReactiveTerminal::Try { block, handler, .. } => {
            globals_block(block, globals);
            globals_block(handler, globals);
        }
    }
}
