//! `incompatible-library` (`IncompatibleLibrary`): flags use of libraries whose
//! APIs return functions that cannot be memoized safely. The TS attaches a
//! `knownIncompatible` marker to specific signatures in `DefaultModuleTypeProvider`
//! (`react-hook-form`'s `useForm().watch`, TanStack Table's `useReactTable()`,
//! TanStack Virtual's `useVirtualizer()`); this is a focused, type-system-free
//! port that recognizes those exact import + call patterns.

use std::collections::HashMap;

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::IdentifierId;
use crate::hir::model::HirFunction;
use crate::hir::value::{InstructionValue, NonLocalBinding, PropertyLiteral};

const REASON: &str = "Use of incompatible library";
const DESCRIPTION: &str = "This API returns functions which cannot be memoized without leading to stale UI. To prevent this, by default React Compiler will skip memoizing this component/hook. However, you may see issues if values from this API are passed to other components/hooks that are memoized";

const HOOK_FORM_MESSAGE: &str =
    "React Hook Form's `useForm()` API returns a `watch()` function which cannot be memoized safely.";
const TANSTACK_TABLE_MESSAGE: &str =
    "TanStack Table's `useReactTable()` API returns functions that cannot be memoized safely";
const TANSTACK_VIRTUAL_MESSAGE: &str =
    "TanStack Virtual's `useVirtualizer()` API returns functions that cannot be memoized safely";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tracked {
    /// `useForm` imported from `react-hook-form`.
    UseFormHook,
    /// The object returned by a `useForm()` call.
    FormObject,
    /// The `form.watch` member.
    FormWatch,
    /// A directly-incompatible hook (`useReactTable` / `useVirtualizer`), carrying
    /// its diagnostic message.
    DirectHook(&'static str),
}

fn import_kind(binding: &NonLocalBinding) -> Option<Tracked> {
    let NonLocalBinding::ImportSpecifier { module, imported, .. } = binding else {
        return None;
    };
    match (module.as_str(), imported.as_str()) {
        ("react-hook-form", "useForm") => Some(Tracked::UseFormHook),
        ("@tanstack/react-table", "useReactTable") => {
            Some(Tracked::DirectHook(TANSTACK_TABLE_MESSAGE))
        }
        ("@tanstack/react-virtual", "useVirtualizer") => {
            Some(Tracked::DirectHook(TANSTACK_VIRTUAL_MESSAGE))
        }
        _ => None,
    }
}

pub fn validate_incompatible_library(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    let mut tracked: HashMap<IdentifierId, Tracked> = HashMap::new();

    for block in func.body.blocks() {
        for instr in &block.instructions {
            match &instr.value {
                InstructionValue::LoadGlobal { binding, .. } => {
                    if let Some(kind) = import_kind(binding) {
                        tracked.insert(instr.lvalue.identifier.id, kind);
                    }
                }
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(kind) = tracked.get(&place.identifier.id).copied() {
                        tracked.insert(instr.lvalue.identifier.id, kind);
                    }
                }
                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    if let Some(kind) = tracked.get(&value.identifier.id).copied() {
                        tracked.insert(lvalue.place.identifier.id, kind);
                        tracked.insert(instr.lvalue.identifier.id, kind);
                    }
                }
                InstructionValue::PropertyLoad { object, property, .. } => {
                    if tracked.get(&object.identifier.id).copied() == Some(Tracked::FormObject)
                        && matches!(property, PropertyLiteral::String(name) if name == "watch")
                    {
                        tracked.insert(instr.lvalue.identifier.id, Tracked::FormWatch);
                    }
                }
                InstructionValue::CallExpression { callee, .. } => {
                    match tracked.get(&callee.identifier.id).copied() {
                        Some(Tracked::UseFormHook) => {
                            tracked.insert(instr.lvalue.identifier.id, Tracked::FormObject);
                        }
                        Some(Tracked::FormWatch) => {
                            push(diagnostics, resolver, &callee.loc, HOOK_FORM_MESSAGE);
                        }
                        Some(Tracked::DirectHook(message)) => {
                            push(diagnostics, resolver, &callee.loc, message);
                        }
                        _ => {}
                    }
                }
                // `form.watch()` lowers to a MethodCall whose `property` temp is the
                // `.watch` PropertyLoad result (tracked as FormWatch above).
                InstructionValue::MethodCall { property, .. } => {
                    if tracked.get(&property.identifier.id).copied() == Some(Tracked::FormWatch) {
                        push(diagnostics, resolver, &property.loc, HOOK_FORM_MESSAGE);
                    }
                }
                _ => {}
            }
        }
    }
}

fn push(
    diagnostics: &mut Diagnostics,
    resolver: &PositionResolver,
    loc: &crate::hir::place::SourceLocation,
    message: &str,
) {
    diagnostics.push(
        Diagnostic::create(ErrorCategory::IncompatibleLibrary, REASON)
            .with_description(DESCRIPTION)
            .with_error_detail(resolver.resolve(loc), Some(message.to_string())),
    );
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::IncompatibleLibrary)
            .count()
    }

    #[test]
    fn flags_tanstack_table() {
        let code = "import { useReactTable } from \"@tanstack/react-table\";\nfunction Component(props) {\n  const table = useReactTable(props.options);\n  return <div>{table.foo}</div>;\n}\n";
        assert_eq!(count(code), 1);
    }

    #[test]
    fn flags_react_hook_form_watch() {
        let code = "import { useForm } from \"react-hook-form\";\nfunction Component() {\n  const form = useForm();\n  const value = form.watch();\n  return <div>{value}</div>;\n}\n";
        assert_eq!(count(code), 1);
    }

    #[test]
    fn allows_unrelated_libraries() {
        let code = "import { useThing } from \"some-lib\";\nfunction Component() {\n  const x = useThing();\n  return <div>{x}</div>;\n}\n";
        assert_eq!(count(code), 0);
    }
}
