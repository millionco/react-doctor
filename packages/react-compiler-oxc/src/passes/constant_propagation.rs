//! `constantPropagation` (`Optimization/ConstantPropagation.ts`).
//!
//! Sparse Conditional Constant Propagation (SCCP): abstract-interpret the
//! function, recording the known constant value of each SSA identifier (a
//! [`Constant`], either a [`PrimitiveValue`] or a [`NonLocalBinding`] from a
//! `LoadGlobal`). Instructions whose operands are all known constants and which
//! can be compile-time evaluated are replaced by their `Primitive` result;
//! `if` terminals whose test folds to a constant are rewritten to a `goto` of
//! the live branch.
//!
//! After each round of pruning the CFG is re-minified — reverse-postorder,
//! unreachable/dead-block removal, instruction renumbering, predecessor
//! recompute, phi-operand pruning, [`eliminate_redundant_phi`], then
//! [`merge_consecutive_blocks`] — and the loop repeats until no terminal
//! changes (the SCCP fixpoint). `markInstructionIds` runs *before* the merge, so
//! the merged block keeps the renumbered ids and the dropped `goto`/`if`
//! terminals leave numbering gaps (matching the TS exactly).
//!
//! The pass mutates the [`HirFunction`] in place and recurses into nested
//! function expressions / object methods via the shared `constants` map, exactly
//! as the TS threads one `Map` through the whole closure tree.

use std::collections::HashMap;

use crate::hir::ids::IdentifierId;
use crate::hir::model::{BlockKind, HirFunction};
use crate::hir::place::{Place, SourceLocation};
use crate::hir::terminal::{GotoVariant, Terminal};
use crate::hir::value::{
    InstructionValue, NonLocalBinding, PrimitiveValue, PropertyLiteral,
};

use super::cfg::{
    mark_instruction_ids, mark_predecessors, remove_dead_do_while_statements,
    remove_unnecessary_try_catch, remove_unreachable_for_updates, reverse_postorder_blocks,
};
use super::eliminate_redundant_phi::eliminate_redundant_phi;
use super::merge_consecutive_blocks::merge_consecutive_blocks;
use super::PassContext;

/// A known compile-time value (`Constant = Primitive | LoadGlobal` in the TS).
#[derive(Clone, Debug, PartialEq)]
enum Constant {
    /// A primitive literal value.
    Primitive(PrimitiveValue),
    /// A `LoadGlobal` binding (propagated but never folded).
    LoadGlobal(NonLocalBinding),
}

/// The per-identifier constant map (`Map<IdentifierId, Constant>`).
type Constants = HashMap<IdentifierId, Constant>;

/// `constantPropagation`: the [`PassContext`]-signature entry point. Allocates no
/// ids of its own (the cleanup passes it calls don't either), but `ctx` is
/// threaded so the re-run of [`eliminate_redundant_phi`] / [`merge_consecutive_blocks`]
/// keeps the uniform pass signature.
pub fn constant_propagation(func: &mut HirFunction, ctx: &mut PassContext) {
    let mut constants: Constants = HashMap::new();
    constant_propagation_impl(func, &mut constants, ctx);
}

fn constant_propagation_impl(func: &mut HirFunction, constants: &mut Constants, ctx: &mut PassContext) {
    loop {
        let have_terminals_changed = apply_constant_propagation(func, constants, ctx);
        if !have_terminals_changed {
            break;
        }
        // Terminals changed, so blocks may have become unreachable. Re-run the
        // graph minification (incl. reordering instruction ids).
        reverse_postorder_blocks(&mut func.body);
        remove_unreachable_for_updates(&mut func.body);
        remove_dead_do_while_statements(&mut func.body);
        remove_unnecessary_try_catch(&mut func.body);
        mark_instruction_ids(&mut func.body);
        mark_predecessors(&mut func.body);

        // Now that predecessors are updated, prune phi operands whose
        // predecessor block can no longer be reached.
        for block in func.body.blocks_mut() {
            for phi in &mut block.phis {
                let preds: Vec<_> = phi.operands.keys().copied().collect();
                for predecessor in preds {
                    if !block.preds.contains(&predecessor) {
                        phi.operands.remove(&predecessor);
                    }
                }
            }
        }
        // Removing some phi operands may have made previously-non-trivial phis
        // trivial.
        eliminate_redundant_phi(func, ctx);
        // Finally, merge blocks that are now guaranteed to execute consecutively.
        merge_consecutive_blocks(func, ctx);
    }
}

/// `applyConstantPropagation`: one pass over the blocks. Records phi/instruction
/// constants and rewrites foldable instructions; rewrites a constant-test `if` to
/// a `goto`. Returns whether any terminal changed.
fn apply_constant_propagation(
    func: &mut HirFunction,
    constants: &mut Constants,
    ctx: &mut PassContext,
) -> bool {
    let mut has_changes = false;
    let block_ids: Vec<_> = func.body.blocks().iter().map(|b| b.id).collect();

    for block_id in block_ids {
        // Initialize phi values if all operands share a known constant. This is a
        // single pass, so it never fills phi values for blocks with a back-edge.
        let phi_constants: Vec<(IdentifierId, Constant)> = {
            let block = func.body.block(block_id).expect("block exists");
            block
                .phis
                .iter()
                .filter_map(|phi| {
                    evaluate_phi(phi, constants).map(|value| (phi.place.identifier.id, value))
                })
                .collect()
        };
        for (id, value) in phi_constants {
            constants.insert(id, value);
        }

        let block_kind = func.body.block(block_id).expect("block exists").kind;
        let instr_count = func.body.block(block_id).expect("block exists").instructions.len();
        for i in 0..instr_count {
            if block_kind == BlockKind::Sequence && i == instr_count - 1 {
                // Evaluating the last value of a value block can break order of
                // evaluation; skip these instructions.
                continue;
            }
            // Evaluate (and possibly rewrite) the instruction in place.
            let result = {
                let block = func.body.block_mut(block_id).expect("block exists");
                let instr = &mut block.instructions[i];
                let lvalue_id = instr.lvalue.identifier.id;
                evaluate_instruction(constants, instr, ctx).map(|value| (lvalue_id, value))
            };
            if let Some((lvalue_id, value)) = result {
                constants.insert(lvalue_id, value);
            }
        }

        // Constant-test `if` terminals are rewritten to a `goto` of the live
        // branch.
        let new_terminal = {
            let block = func.body.block(block_id).expect("block exists");
            if let Terminal::If {
                test,
                consequent,
                alternate,
                id,
                loc,
                ..
            } = &block.terminal
            {
                match read(constants, test) {
                    Some(Constant::Primitive(value)) => {
                        let target = if is_truthy(&value) {
                            *consequent
                        } else {
                            *alternate
                        };
                        Some(Terminal::Goto {
                            block: target,
                            variant: GotoVariant::Break,
                            id: *id,
                            loc: loc.clone(),
                        })
                    }
                    _ => None,
                }
            } else {
                None
            }
        };
        if let Some(terminal) = new_terminal {
            has_changes = true;
            func.body.block_mut(block_id).expect("block exists").terminal = terminal;
        }
    }

    has_changes
}

/// `evaluatePhi`: if every operand resolves to the *same* constant (same kind and
/// same concrete value / global binding name), the phi's value is that constant.
fn evaluate_phi(phi: &crate::hir::model::Phi, constants: &Constants) -> Option<Constant> {
    let mut value: Option<Constant> = None;
    for (_, operand) in phi.operands.iter() {
        let operand_value = constants.get(&operand.identifier.id)?.clone();
        let Some(current) = &value else {
            value = Some(operand_value);
            continue;
        };
        match (current, &operand_value) {
            (Constant::Primitive(a), Constant::Primitive(b)) => {
                if !primitive_strict_eq(a, b) {
                    return None;
                }
            }
            (Constant::LoadGlobal(a), Constant::LoadGlobal(b)) => {
                if binding_name(a) != binding_name(b) {
                    return None;
                }
            }
            // Differing kinds: can't propagate.
            _ => return None,
        }
    }
    value
}

/// `evaluateInstruction`: fold (and rewrite in place) the instruction's value if
/// its operands are known constants. Returns the resulting [`Constant`] for the
/// instruction's lvalue, or `None` if nothing could be folded.
fn evaluate_instruction(
    constants: &mut Constants,
    instr: &mut crate::hir::instruction::Instruction,
    ctx: &mut PassContext,
) -> Option<Constant> {
    match &mut instr.value {
        InstructionValue::Primitive { value, .. } => Some(Constant::Primitive(value.clone())),
        InstructionValue::LoadGlobal { binding, .. } => {
            Some(Constant::LoadGlobal(binding.clone()))
        }
        InstructionValue::ComputedLoad {
            object,
            property,
            loc,
        } => {
            if let Some(Constant::Primitive(p)) = read(constants, property)
                && let Some(literal) = property_literal_for(&p)
            {
                instr.value = InstructionValue::PropertyLoad {
                    object: object.clone(),
                    property: literal,
                    loc: loc.clone(),
                };
            }
            None
        }
        InstructionValue::ComputedStore {
            object,
            property,
            value,
            loc,
        } => {
            if let Some(Constant::Primitive(p)) = read(constants, property)
                && let Some(literal) = property_literal_for(&p)
            {
                instr.value = InstructionValue::PropertyStore {
                    object: object.clone(),
                    property: literal,
                    value: value.clone(),
                    loc: loc.clone(),
                };
            }
            None
        }
        InstructionValue::PostfixUpdate {
            lvalue,
            operation,
            value,
            loc,
        } => {
            if let Some(Constant::Primitive(PrimitiveValue::Number(previous))) =
                read(constants, value)
            {
                let next = if operation == "++" {
                    previous + 1.0
                } else {
                    previous - 1.0
                };
                // Store the updated value, but return the value prior to the update.
                constants.insert(
                    lvalue.identifier.id,
                    Constant::Primitive(PrimitiveValue::Number(next)),
                );
                let _ = loc;
                return Some(Constant::Primitive(PrimitiveValue::Number(previous)));
            }
            None
        }
        InstructionValue::PrefixUpdate {
            lvalue,
            operation,
            value,
            loc: _,
        } => {
            if let Some(Constant::Primitive(PrimitiveValue::Number(previous))) =
                read(constants, value)
            {
                let next = if operation == "++" {
                    previous + 1.0
                } else {
                    previous - 1.0
                };
                let result = Constant::Primitive(PrimitiveValue::Number(next));
                constants.insert(lvalue.identifier.id, result.clone());
                return Some(result);
            }
            None
        }
        InstructionValue::UnaryExpression {
            operator,
            value,
            loc,
        } => match operator.as_str() {
            "!" => {
                if let Some(Constant::Primitive(p)) = read(constants, value) {
                    let result = PrimitiveValue::Boolean(!is_truthy(&p));
                    instr.value = InstructionValue::Primitive {
                        value: result.clone(),
                        loc: loc.clone(),
                    };
                    return Some(Constant::Primitive(result));
                }
                None
            }
            "-" => {
                if let Some(Constant::Primitive(PrimitiveValue::Number(n))) = read(constants, value)
                {
                    // TS: `operand.value * -1`; `-n` is identical (incl. signed 0).
                    let result = PrimitiveValue::Number(-n);
                    instr.value = InstructionValue::Primitive {
                        value: result.clone(),
                        loc: loc.clone(),
                    };
                    return Some(Constant::Primitive(result));
                }
                None
            }
            _ => None,
        },
        InstructionValue::BinaryExpression {
            operator,
            left,
            right,
            loc,
        } => {
            let lhs = read(constants, left);
            let rhs = read(constants, right);
            if let (Some(Constant::Primitive(lhs)), Some(Constant::Primitive(rhs))) = (lhs, rhs)
                && let Some(result) = fold_binary(operator, &lhs, &rhs)
            {
                instr.value = InstructionValue::Primitive {
                    value: result.clone(),
                    loc: loc.clone(),
                };
                return Some(Constant::Primitive(result));
            }
            None
        }
        InstructionValue::PropertyLoad {
            object,
            property,
            loc,
        } => {
            if let Some(Constant::Primitive(PrimitiveValue::String(s))) = read(constants, object)
                && matches!(property, PropertyLiteral::String(p) if p == "length")
            {
                // `.length` of a constant string folds to its UTF-16 code-unit count.
                let length = s.encode_utf16().count() as f64;
                let result = PrimitiveValue::Number(length);
                instr.value = InstructionValue::Primitive {
                    value: result.clone(),
                    loc: loc.clone(),
                };
                return Some(Constant::Primitive(result));
            }
            None
        }
        InstructionValue::TemplateLiteral {
            subexprs,
            quasis,
            loc,
        } => {
            if let Some(result) = fold_template_literal(constants, subexprs, quasis) {
                instr.value = InstructionValue::Primitive {
                    value: PrimitiveValue::String(result),
                    loc: loc.clone(),
                };
                if let InstructionValue::Primitive { value, .. } = &instr.value {
                    return Some(Constant::Primitive(value.clone()));
                }
            }
            None
        }
        InstructionValue::LoadLocal { place, loc } => {
            let place_value = read(constants, place);
            if let Some(constant) = &place_value {
                instr.value = constant_to_value(constant, loc.clone());
            }
            place_value
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            let place_value = read(constants, value);
            if let Some(constant) = &place_value {
                constants.insert(lvalue.place.identifier.id, constant.clone());
            }
            place_value
        }
        InstructionValue::FunctionExpression { lowered_func, .. }
        | InstructionValue::ObjectMethod { lowered_func, .. } => {
            constant_propagation_impl(&mut lowered_func.func, constants, ctx);
            None
        }
        InstructionValue::StartMemoize { deps, .. } => {
            if let Some(deps) = deps {
                for dep in deps.iter_mut() {
                    if let crate::hir::value::MemoDependencyRoot::NamedLocal { value, constant } =
                        &mut dep.root
                        && matches!(read(constants, value), Some(Constant::Primitive(_)))
                    {
                        *constant = true;
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// `read(constants, place)`: the known constant for a place's identifier, if any.
fn read(constants: &Constants, place: &Place) -> Option<Constant> {
    constants.get(&place.identifier.id).cloned()
}

/// Materialize a [`Constant`] back into an [`InstructionValue`] (`Primitive` or
/// `LoadGlobal`), used when a `LoadLocal` of a known constant is replaced by the
/// constant itself.
fn constant_to_value(constant: &Constant, loc: SourceLocation) -> InstructionValue {
    match constant {
        Constant::Primitive(value) => InstructionValue::Primitive {
            value: value.clone(),
            loc,
        },
        Constant::LoadGlobal(binding) => InstructionValue::LoadGlobal {
            binding: binding.clone(),
            loc,
        },
    }
}

/// The `name` field shared by every [`NonLocalBinding`] variant (the TS
/// `binding.name`).
fn binding_name(binding: &NonLocalBinding) -> &str {
    match binding {
        NonLocalBinding::ImportDefault { name, .. }
        | NonLocalBinding::ImportNamespace { name, .. }
        | NonLocalBinding::ImportSpecifier { name, .. }
        | NonLocalBinding::ModuleLocal { name }
        | NonLocalBinding::Global { name } => name,
    }
}

/// JS truthiness of a primitive (`!!value` semantics).
fn is_truthy(value: &PrimitiveValue) -> bool {
    match value {
        PrimitiveValue::Boolean(b) => *b,
        PrimitiveValue::Number(n) => *n != 0.0 && !n.is_nan(),
        PrimitiveValue::String(s) => !s.is_empty(),
        PrimitiveValue::Null | PrimitiveValue::Undefined => false,
    }
}

/// `===` over two primitives: same type and same value (NaN is never equal,
/// `+0 === -0`).
fn primitive_strict_eq(a: &PrimitiveValue, b: &PrimitiveValue) -> bool {
    match (a, b) {
        (PrimitiveValue::Number(x), PrimitiveValue::Number(y)) => x == y,
        (PrimitiveValue::Boolean(x), PrimitiveValue::Boolean(y)) => x == y,
        (PrimitiveValue::String(x), PrimitiveValue::String(y)) => x == y,
        (PrimitiveValue::Null, PrimitiveValue::Null) => true,
        (PrimitiveValue::Undefined, PrimitiveValue::Undefined) => true,
        _ => false,
    }
}

/// JS `String(value)` for the primitive kinds template literals admit
/// (number/string/boolean/null). Used by [`fold_template_literal`].
fn primitive_to_string(value: &PrimitiveValue) -> Option<String> {
    match value {
        PrimitiveValue::Number(n) => Some(number_to_string(*n)),
        PrimitiveValue::String(s) => Some(s.clone()),
        PrimitiveValue::Boolean(b) => Some(b.to_string()),
        PrimitiveValue::Null => Some("null".to_string()),
        // `undefined` and any non-primitive are rejected by the template path.
        PrimitiveValue::Undefined => None,
    }
}

/// JS `String(number)`: integral finite values print without a decimal point.
fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_string()
    } else if n.is_infinite() {
        if n > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        }
    } else if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// The static-property literal a constant computed key folds to: a number, or a
/// string that is a valid JS identifier (`isValidIdentifier` in the TS). Other
/// primitives leave the access computed.
fn property_literal_for(value: &PrimitiveValue) -> Option<PropertyLiteral> {
    match value {
        PrimitiveValue::Number(n) => Some(PropertyLiteral::Number(*n)),
        PrimitiveValue::String(s) if is_valid_identifier(s) => {
            Some(PropertyLiteral::String(s.clone()))
        }
        _ => None,
    }
}

/// `@babel/types isValidIdentifier`: an ES identifier (non-empty, starts with a
/// letter / `_` / `$`, rest letters / digits / `_` / `$`) that is not a reserved
/// word. The curated fixtures only feed ASCII keys, so this conservative ASCII
/// check is sufficient.
fn is_valid_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return false;
    }
    !is_reserved_word(s)
}

/// The ECMAScript reserved words `isValidIdentifier` rejects.
fn is_reserved_word(s: &str) -> bool {
    matches!(
        s,
        "break"
            | "case"
            | "catch"
            | "class"
            | "const"
            | "continue"
            | "debugger"
            | "default"
            | "delete"
            | "do"
            | "else"
            | "enum"
            | "export"
            | "extends"
            | "false"
            | "finally"
            | "for"
            | "function"
            | "if"
            | "import"
            | "in"
            | "instanceof"
            | "new"
            | "null"
            | "return"
            | "super"
            | "switch"
            | "this"
            | "throw"
            | "true"
            | "try"
            | "typeof"
            | "var"
            | "void"
            | "while"
            | "with"
            | "yield"
            | "let"
            | "static"
            | "await"
            | "implements"
            | "interface"
            | "package"
            | "private"
            | "protected"
            | "public"
    )
}

/// Fold a `TemplateLiteral` whose subexpressions are all constant primitives,
/// returning the concatenated string (or `None` if any part is unfoldable),
/// mirroring the TS `TemplateLiteral` case.
fn fold_template_literal(
    constants: &Constants,
    subexprs: &[Place],
    quasis: &[crate::hir::value::TemplateQuasi],
) -> Option<String> {
    if subexprs.is_empty() {
        // No interpolation: concatenate all cooked quasis (cooked may be empty
        // string; only `undefined`/`None` is disqualifying — but with zero
        // subexprs the TS joins regardless of cooked-ness).
        let mut out = String::new();
        for quasi in quasis {
            out.push_str(quasi.cooked.as_deref().unwrap_or(""));
        }
        return Some(out);
    }

    if subexprs.len() != quasis.len().checked_sub(1)? {
        return None;
    }
    if quasis.iter().any(|q| q.cooked.is_none()) {
        return None;
    }

    let mut quasi_index = 0usize;
    let mut result = quasis[quasi_index].cooked.clone()?;
    quasi_index += 1;

    for subexpr in subexprs {
        let Some(Constant::Primitive(value)) = read(constants, subexpr) else {
            return None;
        };
        let part = primitive_to_string(&value)?;
        let suffix = quasis.get(quasi_index).and_then(|q| q.cooked.clone())?;
        quasi_index += 1;
        result.push_str(&part);
        result.push_str(&suffix);
    }

    Some(result)
}

/// Fold a binary operator over two constant primitive operands, replicating JS
/// numeric/string/comparison/equality semantics. `None` when the operator+types
/// are not foldable (matching the TS, which leaves the instruction unchanged).
fn fold_binary(
    operator: &str,
    lhs: &PrimitiveValue,
    rhs: &PrimitiveValue,
) -> Option<PrimitiveValue> {
    use PrimitiveValue::{Boolean, Number, String as Str};

    // Numeric helper: both operands must be numbers.
    let nums = || match (lhs, rhs) {
        (Number(a), Number(b)) => Some((*a, *b)),
        _ => None,
    };
    // JS `ToInt32` for the bitwise operators.
    let to_i32 = |n: f64| -> i32 { js_to_int32(n) };
    let to_u32 = |n: f64| -> u32 { js_to_int32(n) as u32 };

    match operator {
        "+" => match (lhs, rhs) {
            (Number(a), Number(b)) => Some(Number(a + b)),
            (Str(a), Str(b)) => Some(Str(format!("{a}{b}"))),
            _ => None,
        },
        "-" => nums().map(|(a, b)| Number(a - b)),
        "*" => nums().map(|(a, b)| Number(a * b)),
        "/" => nums().map(|(a, b)| Number(a / b)),
        "%" => nums().map(|(a, b)| Number(js_mod(a, b))),
        "**" => nums().map(|(a, b)| Number(a.powf(b))),
        "|" => nums().map(|(a, b)| Number((to_i32(a) | to_i32(b)) as f64)),
        "&" => nums().map(|(a, b)| Number((to_i32(a) & to_i32(b)) as f64)),
        "^" => nums().map(|(a, b)| Number((to_i32(a) ^ to_i32(b)) as f64)),
        "<<" => nums().map(|(a, b)| Number((to_i32(a).wrapping_shl(to_u32(b) & 31)) as f64)),
        ">>" => nums().map(|(a, b)| Number((to_i32(a).wrapping_shr(to_u32(b) & 31)) as f64)),
        ">>>" => nums().map(|(a, b)| Number((to_u32(a).wrapping_shr(to_u32(b) & 31)) as f64)),
        "<" => nums().map(|(a, b)| Boolean(a < b)),
        "<=" => nums().map(|(a, b)| Boolean(a <= b)),
        ">" => nums().map(|(a, b)| Boolean(a > b)),
        ">=" => nums().map(|(a, b)| Boolean(a >= b)),
        "==" => Some(Boolean(js_loose_eq(lhs, rhs))),
        "===" => Some(Boolean(primitive_strict_eq(lhs, rhs))),
        "!=" => Some(Boolean(!js_loose_eq(lhs, rhs))),
        "!==" => Some(Boolean(!primitive_strict_eq(lhs, rhs))),
        _ => None,
    }
}

/// JS `n % m` (`%` is the remainder, sign of the dividend).
fn js_mod(a: f64, b: f64) -> f64 {
    a % b
}

/// JS `ToInt32` for the bitwise operators.
fn js_to_int32(n: f64) -> i32 {
    if !n.is_finite() {
        return 0;
    }
    let n = n.trunc();
    let m = 4294967296.0_f64; // 2^32
    let mut int32 = n.rem_euclid(m);
    if int32 >= 2147483648.0 {
        int32 -= m;
    }
    int32 as i64 as i32
}

/// JS loose equality (`==`) over two primitives. Number/string comparisons
/// coerce; `null == undefined`; NaN is never equal.
fn js_loose_eq(a: &PrimitiveValue, b: &PrimitiveValue) -> bool {
    use PrimitiveValue::{Boolean, Null, Number, String as Str, Undefined};
    match (a, b) {
        (Number(x), Number(y)) => x == y,
        (Str(x), Str(y)) => x == y,
        (Boolean(x), Boolean(y)) => x == y,
        (Null, Null) | (Undefined, Undefined) | (Null, Undefined) | (Undefined, Null) => true,
        // Boolean coerces to number, then compares.
        (Boolean(x), _) => js_loose_eq(&Number(if *x { 1.0 } else { 0.0 }), b),
        (_, Boolean(y)) => js_loose_eq(a, &Number(if *y { 1.0 } else { 0.0 })),
        // number == string: coerce the string to a number.
        (Number(x), Str(s)) => string_to_number(s).is_some_and(|y| *x == y),
        (Str(s), Number(y)) => string_to_number(s).is_some_and(|x| x == *y),
        // null/undefined are only loosely equal to each other.
        _ => false,
    }
}

/// JS `Number(string)` for `==` coercion: empty/whitespace is `0`, otherwise a
/// numeric parse (returns `None` for `NaN`, which compares unequal to everything).
fn string_to_number(s: &str) -> Option<f64> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed.parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile_to_stage;

    fn printed(source: &str, name: &str, stage: &str) -> String {
        let lowered = compile_to_stage(source, &format!("{name}.js"), stage);
        lowered
            .iter()
            .find_map(|f| f.printed.clone())
            .expect("function lowered")
            .trim_end()
            .to_string()
    }

    /// `is_truthy`/`primitive_strict_eq` follow JS semantics for the edge cases the
    /// folder relies on (NaN, empty string, zero).
    #[test]
    fn truthiness_and_equality() {
        assert!(!is_truthy(&PrimitiveValue::Number(0.0)));
        assert!(is_truthy(&PrimitiveValue::Number(2.0)));
        assert!(!is_truthy(&PrimitiveValue::String(String::new())));
        assert!(is_truthy(&PrimitiveValue::String("x".to_string())));
        assert!(!is_truthy(&PrimitiveValue::Null));
        assert!(!is_truthy(&PrimitiveValue::Undefined));
        assert!(!is_truthy(&PrimitiveValue::Number(f64::NAN)));
        assert!(!primitive_strict_eq(
            &PrimitiveValue::Number(f64::NAN),
            &PrimitiveValue::Number(f64::NAN)
        ));
    }

    /// Binary folding for the arithmetic + comparison operators the fixtures use.
    #[test]
    fn folds_arithmetic_and_comparison() {
        assert_eq!(
            fold_binary("+", &PrimitiveValue::Number(2.0), &PrimitiveValue::Number(3.0)),
            Some(PrimitiveValue::Number(5.0))
        );
        assert_eq!(
            fold_binary(
                "+",
                &PrimitiveValue::String("a".into()),
                &PrimitiveValue::String("b".into())
            ),
            Some(PrimitiveValue::String("ab".into()))
        );
        assert_eq!(
            fold_binary("<", &PrimitiveValue::Number(1.0), &PrimitiveValue::Number(2.0)),
            Some(PrimitiveValue::Boolean(true))
        );
        // `+` of non-matching primitive types is not folded.
        assert_eq!(
            fold_binary("-", &PrimitiveValue::String("a".into()), &PrimitiveValue::Number(1.0)),
            None
        );
    }

    /// `is_valid_identifier` matches Babel: rejects reserved words and bad starts,
    /// accepts `$`/`_` leads.
    #[test]
    fn valid_identifier_check() {
        assert!(is_valid_identifier("name"));
        assert!(is_valid_identifier("$x"));
        assert!(is_valid_identifier("_0"));
        assert!(!is_valid_identifier("0a"));
        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("class"));
        assert!(!is_valid_identifier("a-b"));
    }

    /// A constant `if (true)` prunes the dead branch, then reverse-postorder +
    /// merge collapses the surviving blocks into one. The merged block keeps the
    /// renumbered ids, leaving gaps where the dropped goto/if terminals were.
    #[test]
    fn prunes_constant_if_and_merges() {
        let source = "function foo() {\n  let x = 1;\n  let y = 2;\n  if (y) {\n    let z = x + y;\n  }\n}\n";
        let out = printed(source, "foo", "ConstantPropagation");
        // The `if (y)` test folds to the constant `2` (truthy), so the dead
        // branch is pruned and everything merges into bb0.
        assert!(out.contains("[5] <unknown> $20 = 2"), "y folded to constant\n{out}");
        assert!(out.contains("[9] <unknown> $23 = 3"), "x+y folded\n{out}");
        assert!(!out.contains("If ("), "the if terminal is pruned\n{out}");
        assert!(!out.contains("Goto"), "merged away\n{out}");
        // Only one block remains.
        assert_eq!(out.matches("(block):").count(), 1, "single block\n{out}");
    }

    /// A `LoadLocal` of a constant-stored local folds to the constant value.
    #[test]
    fn folds_load_local_of_constant() {
        let source = "function f() {\n  const x = 42;\n  return x;\n}\n";
        let out = printed(source, "f", "ConstantPropagation");
        assert!(out.contains("= 42"), "x loaded as 42\n{out}");
    }
}
