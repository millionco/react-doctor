//! `validateStaticComponents` (`Validation/ValidateStaticComponents.ts`): flags a
//! component whose identity is created during render (a function expression, call,
//! or `new`) and then used as a JSX tag — such a component resets its state on
//! every re-render.

use std::collections::HashMap;

use crate::diagnostic::{BabelSourceLocation, Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::value::{InstructionValue, JsxTag};

const REASON: &str = "Cannot create components during render";
const DESCRIPTION: &str = "Components created during render will reset their state each time they are created. Declare components outside of render";
const TAG_DETAIL: &str = "This component is created during render";
const CREATION_DETAIL: &str = "The component is created during render here";

pub fn validate_static_components(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    // identifier id -> the (resolved) source location where the dynamic value was
    // created.
    let mut known_dynamic: HashMap<IdentifierId, Option<BabelSourceLocation>> = HashMap::new();

    for block in func.body.blocks() {
        'phis: for phi in &block.phis {
            for operand in phi.operands.values() {
                if let Some(loc) = known_dynamic.get(&operand.identifier.id).copied() {
                    known_dynamic.insert(phi.place.identifier.id, loc);
                    continue 'phis;
                }
            }
        }
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::FunctionExpression { loc, .. }
                | InstructionValue::NewExpression { loc, .. }
                | InstructionValue::MethodCall { loc, .. }
                | InstructionValue::CallExpression { loc, .. } => {
                    known_dynamic.insert(instr.lvalue.identifier.id, resolver.resolve(loc));
                }
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(loc) = known_dynamic.get(&place.identifier.id).copied() {
                        known_dynamic.insert(instr.lvalue.identifier.id, loc);
                    }
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if let Some(loc) = known_dynamic.get(&value.identifier.id).copied() {
                        known_dynamic.insert(instr.lvalue.identifier.id, loc);
                        known_dynamic.insert(lvalue.place.identifier.id, loc);
                    }
                }
                InstructionValue::JsxExpression { tag, .. } => {
                    if let JsxTag::Place(tag_place) = tag {
                        if let Some(creation_loc) =
                            known_dynamic.get(&tag_place.identifier.id).copied()
                        {
                            diagnostics.push(
                                Diagnostic::create(ErrorCategory::StaticComponents, REASON)
                                    .with_description(DESCRIPTION)
                                    .with_error_detail(
                                        resolver.resolve(&tag_place.loc),
                                        Some(TAG_DETAIL.to_string()),
                                    )
                                    .with_error_detail(creation_loc, Some(CREATION_DETAIL.to_string())),
                            );
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::StaticComponents)
            .count()
    }

    #[test]
    fn flags_component_created_in_render() {
        let code = "function Component(props) {\n  const Inner = () => <div>{props.a}</div>;\n  return <Inner />;\n}\n";
        assert_eq!(count(code), 1);
    }

    #[test]
    fn allows_static_component_tag() {
        let code = "function Component() {\n  return <div><Child /></div>;\n}\n";
        assert_eq!(count(code), 0);
    }
}
