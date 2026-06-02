//! Surfaces the render-time side-effect diagnostics that
//! `InferMutationAliasingEffects` records as error-carrying `AliasingEffect`s:
//! `MutateGlobal` -> `Globals`, `MutateFrozen` -> `Immutability`, `Impure` ->
//! `Purity`. The TS builds a `CompilerDiagnostic` at each inference site; the Rust
//! effect captures the `reason` + mutated `place`, so we re-derive the diagnostic
//! here (category, located at the mutated place) with the upstream descriptions.

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::instruction::AliasingEffect;
use crate::hir::model::HirFunction;
use crate::hir::value::InstructionValue;

const GLOBALS_DESCRIPTION: &str = "Reassigning a variable declared outside of the component/hook during render is a form of side effect, which can cause unpredictable behavior depending on when the component happens to re-render. If this variable is used in rendering, use useState instead. Otherwise, consider updating it in an effect. (https://react.dev/reference/rules/components-and-hooks-must-be-pure#side-effects-must-run-outside-of-render)";
const IMMUTABILITY_DESCRIPTION: &str = "Mutating a value that is owned by React (props, state, or values derived from them) during render can cause your component not to update as expected. (https://react.dev/reference/rules/components-and-hooks-must-be-pure#props-and-state-are-immutable)";
const PURITY_DESCRIPTION: &str = "Calling an impure function can produce unstable results that update unpredictably when the component happens to re-render. (https://react.dev/reference/rules/components-and-hooks-must-be-pure#components-and-hooks-must-be-idempotent)";

pub fn validate_render_side_effects(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    visit_function(func, resolver, diagnostics);
}

fn visit_function(func: &HirFunction, resolver: &PositionResolver, diagnostics: &mut Diagnostics) {
    for block in func.body.blocks() {
        for instr in &block.instructions {
            if let Some(effects) = &instr.effects {
                for effect in effects {
                    if let Some(diagnostic) = diagnostic_for_effect(effect, resolver) {
                        diagnostics.push(diagnostic);
                    }
                }
            }
            // Render-time effects can live on a nested function expression that is
            // invoked during render; recurse so their mutations are reported too.
            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    visit_function(&lowered_func.func, resolver, diagnostics);
                }
                _ => {}
            }
        }
    }
}

fn diagnostic_for_effect(
    effect: &AliasingEffect,
    resolver: &PositionResolver,
) -> Option<Diagnostic> {
    let (category, place, reason, description) = match effect {
        AliasingEffect::MutateGlobal { place, reason } => {
            (ErrorCategory::Globals, place, reason, GLOBALS_DESCRIPTION)
        }
        AliasingEffect::MutateFrozen { place, reason } => {
            (ErrorCategory::Immutability, place, reason, IMMUTABILITY_DESCRIPTION)
        }
        AliasingEffect::Impure { place, reason } => {
            (ErrorCategory::Purity, place, reason, PURITY_DESCRIPTION)
        }
        _ => return None,
    };
    Some(
        Diagnostic::create(category, reason.clone())
            .with_description(description)
            .with_error_detail(resolver.resolve(&place.loc), Some(reason.clone())),
    )
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn count(code: &str, category: ErrorCategory) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == category)
            .count()
    }

    #[test]
    fn flags_global_reassignment_in_render() {
        let code = "let tally = 0;\nfunction Component() {\n  tally = tally + 1;\n  return <div>{tally}</div>;\n}\n";
        assert_eq!(count(code, ErrorCategory::Globals), 1);
    }

    #[test]
    fn flags_impure_call_in_render() {
        let code = "function Component() {\n  const id = Math.random();\n  return <div>{id}</div>;\n}\n";
        assert_eq!(count(code, ErrorCategory::Purity), 1);
    }

    #[test]
    fn allows_pure_render() {
        let code = "function Component(props) {\n  const value = props.a + 1;\n  return <div>{value}</div>;\n}\n";
        assert_eq!(count(code, ErrorCategory::Globals), 0);
        assert_eq!(count(code, ErrorCategory::Immutability), 0);
        assert_eq!(count(code, ErrorCategory::Purity), 0);
    }
}
