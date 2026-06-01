//! `outlineFunctions(fn, fbtOperands)` — port of
//! `Optimization/OutlineFunctions.ts`.
//!
//! Hoists eligible anonymous function expressions out of the component/hook into
//! top-level functions, replacing the inline `FunctionExpression` with a
//! `LoadGlobal(global) <name>` of the generated name. A function expression is
//! eligible when it captures no context (`context.length === 0`), has no name
//! (`func.id === null`), and is not an fbt/macro operand. Recurses into nested
//! functions first so inner closures can also be outlined.
//!
//! Outlined functions accumulate on the *top-level* function's
//! [`HirFunction::outlined`] list (mirroring the shared `Environment` the TS uses)
//! and are appended after the main body by `printFunctionWithOutlined`. Generated
//! names follow Babel's `generateUid`: `_temp`, `_temp2`, … (or `_<nameHint>` when
//! the closure carried a name hint).

use std::collections::HashSet;

use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::value::{InstructionValue, NonLocalBinding};

/// Generates Babel-`generateUid`-style globally-unique names: `_<base>`,
/// `_<base>2`, `_<base>3`, … The default base (no name hint) is `temp`.
struct UidAllocator {
    used: HashSet<String>,
}

impl UidAllocator {
    fn new() -> Self {
        UidAllocator {
            used: HashSet::new(),
        }
    }

    /// `generateGloballyUniqueIdentifierName(name)` → Babel `scope.generateUid`:
    /// clean the hint into an identifier (`toIdentifier`), strip leading `_`s and a
    /// trailing run of digits, then form `_<name>` with a collision suffix drawn
    /// from Babel's ladder (`i>=11 → i-1`, `i>=9 → i-9`, `i>=1 → i+1`). The default
    /// base (no hint) is `temp`. NameAnonymousFunctions feeds bracketed hints like
    /// `Component[callback]`, which `toIdentifier` camel-cases to `ComponentCallback`
    /// → `_ComponentCallback`, matching the oracle.
    fn generate(&mut self, name: Option<&str>) -> String {
        let raw = name.unwrap_or("temp");
        // `toIdentifier(name).replace(/^_+/, "").replace(/\d+$/g, "")`.
        let cleaned = to_identifier(raw);
        let base = cleaned
            .trim_start_matches('_')
            .trim_end_matches(|c: char| c.is_ascii_digit());
        let mut i = 0u32;
        loop {
            let mut uid = format!("_{base}");
            if i >= 11 {
                uid.push_str(&(i - 1).to_string());
            } else if i >= 9 {
                uid.push_str(&(i - 9).to_string());
            } else if i >= 1 {
                uid.push_str(&(i + 1).to_string());
            }
            i += 1;
            if !self.used.contains(&uid) {
                self.used.insert(uid.clone());
                return uid;
            }
        }
    }
}

/// `@babel/types` `toIdentifier`: replace each non-identifier char with `-`, drop a
/// leading run of `-`/digits, camel-case `-`/whitespace-separated segments, and
/// `_`-prefix the result if it would not be a valid identifier start. ASCII-faithful
/// (the curated fixtures use ASCII name hints).
fn to_identifier(input: &str) -> String {
    let mut name = String::new();
    for c in input.chars() {
        if c.is_ascii_alphanumeric() || c == '$' || c == '_' {
            name.push(c);
        } else {
            name.push('-');
        }
    }
    // `name.replace(/^[-0-9]+/, "")`.
    let trimmed: String = {
        let rest = name.trim_start_matches(|c: char| c == '-' || c.is_ascii_digit());
        rest.to_string()
    };
    // `name.replace(/[-\s]+(.)?/g, (m, c) => c ? c.toUpperCase() : "")`.
    let mut out = String::new();
    let mut chars = trimmed.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-' || c.is_whitespace() {
            // Consume the rest of this `-`/whitespace run.
            while matches!(chars.peek(), Some(&n) if n == '-' || n.is_whitespace()) {
                chars.next();
            }
            // Uppercase the following char, if any.
            if let Some(&next) = chars.peek() {
                chars.next();
                out.extend(next.to_uppercase());
            }
        } else {
            out.push(c);
        }
    }
    // `if (!isValidIdentifier(name)) name = `_${name}`` — only an invalid *start*
    // can occur here (interior chars are already valid); a leading digit or empty
    // string needs the `_` prefix.
    let valid_start = out
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '$' || c == '_');
    if !valid_start {
        out = format!("_{out}");
    }
    if out.is_empty() { "_".to_string() } else { out }
}

/// `outlineFunctions(fn, fbtOperands)` on the top-level function. Appends the
/// outlined functions onto `fn.outlined`. Any functions already present (e.g. the
/// components produced by `OutlineJSX`, which runs first and shares the env's
/// `#outlinedFunctions` list) are preserved, and their generated names seed the
/// allocator so a fresh closure does not collide with an already-claimed `_temp`.
pub fn outline_functions(func: &mut HirFunction, fbt_operands: &HashSet<IdentifierId>) {
    let mut allocator = UidAllocator::new();
    // Reserve names already claimed by an earlier pass (`OutlineJSX`).
    for existing in &func.outlined {
        if let Some(id) = &existing.id {
            allocator.used.insert(id.clone());
        }
    }
    let mut outlined: Vec<HirFunction> = Vec::new();
    outline_in(func, fbt_operands, &mut allocator, &mut outlined);
    func.outlined.extend(outlined);
}

/// Recursive worker: outlines eligible function expressions within `func`,
/// pushing them onto `outlined` and rewriting their instruction to a
/// `LoadGlobal`.
fn outline_in(
    func: &mut HirFunction,
    fbt_operands: &HashSet<IdentifierId>,
    allocator: &mut UidAllocator,
    outlined: &mut Vec<HirFunction>,
) {
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();
    for block_id in block_ids {
        let block = func.body.block_mut(block_id).expect("block exists");
        for instr in &mut block.instructions {
            // Recurse into nested functions first.
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    outline_in(&mut lowered_func.func, fbt_operands, allocator, outlined);
                }
                _ => {}
            }

            // Outline eligible bare function expressions.
            let lvalue_id = instr.lvalue.identifier.id;
            if let InstructionValue::FunctionExpression {
                lowered_func, loc, ..
            } = &mut instr.value
            {
                let eligible = lowered_func.func.context.is_empty()
                    && lowered_func.func.id.is_none()
                    && !fbt_operands.contains(&lvalue_id);
                if eligible {
                    let name_hint = lowered_func
                        .func
                        .id
                        .clone()
                        .or_else(|| lowered_func.func.name_hint.clone());
                    let generated = allocator.generate(name_hint.as_deref());
                    lowered_func.func.id = Some(generated.clone());
                    outlined.push(lowered_func.func.clone());
                    let loc = loc.clone();
                    instr.value = InstructionValue::LoadGlobal {
                        binding: NonLocalBinding::Global { name: generated },
                        loc,
                    };
                }
            }
        }
    }
}
