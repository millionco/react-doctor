//! `OptimizePropsMethodCalls` — port of
//! `Optimization/OptimizePropsMethodCalls.ts`.
//!
//! Converts a `MethodCall` whose receiver is the props object into a plain
//! `CallExpression`, moving the loaded `property` temporary into the callee
//! position:
//!
//! ```text
//! // INPUT
//! props.foo();
//! // OUTPUT
//! const t0 = props.foo;
//! t0();
//! ```
//!
//! The rewrite only fires when the receiver is *exactly* the props object
//! (`receiver.identifier` has an `Object` type with the `BuiltInProps`
//! shape) — `props.foo.bar()` is left alone because its receiver is `foo`, not
//! `props`. This is the first stage-3 pass, run immediately after `InferTypes`
//! (which is what seeds the receiver's `BuiltInProps` type).
//!
//! It is a pure value-level transform: instruction/block ids, ordering, lvalues,
//! phis and terminals are all preserved; only `instr.value` flips kind from
//! `MethodCall` to `CallExpression` while keeping `args`/`loc`.

use crate::hir::model::HirFunction;
use crate::hir::place::{Identifier, Type};
use crate::hir::value::InstructionValue;

/// `isPropsType(id)` (`HIR.ts`): `id.type.kind === 'Object' && id.type.shapeId
/// === 'BuiltInProps'`.
fn is_props_type(identifier: &Identifier) -> bool {
    matches!(
        &identifier.type_,
        Type::Object { shape_id: Some(shape) } if shape == "BuiltInProps"
    )
}

/// Rewrite props-receiver `MethodCall`s into `CallExpression`s in place,
/// mirroring `optimizePropsMethodCalls`.
pub fn optimize_props_method_calls(func: &mut HirFunction) {
    for block in func.body.blocks_mut() {
        for instr in &mut block.instructions {
            // Only rewrite a method call whose receiver is the props object.
            let rewrite = matches!(
                &instr.value,
                InstructionValue::MethodCall { receiver, .. } if is_props_type(&receiver.identifier)
            );
            if rewrite {
                // Move out the method-call fields and rebuild as a call.
                let InstructionValue::MethodCall {
                    property,
                    args,
                    loc,
                    ..
                } = std::mem::replace(
                    &mut instr.value,
                    // Temporary placeholder; immediately overwritten below.
                    InstructionValue::Debugger {
                        loc: instr.loc.clone(),
                    },
                ) else {
                    unreachable!("matched MethodCall above");
                };
                instr.value = InstructionValue::CallExpression {
                    callee: property,
                    args,
                    loc,
                };
            }
        }
    }
}
