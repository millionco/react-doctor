//! Identifier shape-type predicates, ported from the `isXType` cluster in
//! `HIR/HIR.ts`. Each checks an [`Identifier`]'s inferred [`Type`] against a known
//! builtin shape id. Validation passes (and the lint surface) use these to
//! recognize React builtins (`setState`, effect hooks, refs) by type.

use super::place::{Identifier, Type};

fn is_function_shape(type_: &Type, shape: &str) -> bool {
    matches!(type_, Type::Function { shape_id: Some(id), .. } if id == shape)
}

fn is_object_shape(type_: &Type, shape: &str) -> bool {
    matches!(type_, Type::Object { shape_id: Some(id) } if id == shape)
}

/// `isSetStateType`: the `BuiltInSetState` updater function.
pub fn is_set_state_type(identifier: &Identifier) -> bool {
    is_function_shape(&identifier.type_, "BuiltInSetState")
}

/// `isUseRefType`: the `useRef()` return object (`BuiltInUseRefId`).
pub fn is_use_ref_type(identifier: &Identifier) -> bool {
    is_object_shape(&identifier.type_, "BuiltInUseRefId")
}

/// `isRefValueType`: the value behind a ref's `.current` (`BuiltInRefValue`).
pub fn is_ref_value_type(identifier: &Identifier) -> bool {
    is_object_shape(&identifier.type_, "BuiltInRefValue")
}

/// `isUseEffectHookType`: the `useEffect` hook (`BuiltInUseEffectHook`).
pub fn is_use_effect_hook_type(identifier: &Identifier) -> bool {
    is_function_shape(&identifier.type_, "BuiltInUseEffectHook")
}

/// `isUseLayoutEffectHookType`: the `useLayoutEffect` hook.
pub fn is_use_layout_effect_hook_type(identifier: &Identifier) -> bool {
    is_function_shape(&identifier.type_, "BuiltInUseLayoutEffectHook")
}

/// `isUseInsertionEffectHookType`: the `useInsertionEffect` hook.
pub fn is_use_insertion_effect_hook_type(identifier: &Identifier) -> bool {
    is_function_shape(&identifier.type_, "BuiltInUseInsertionEffectHook")
}

/// `isUseEffectEventType`: the `useEffectEvent` hook (`BuiltInUseEffectEvent`).
pub fn is_use_effect_event_type(identifier: &Identifier) -> bool {
    is_function_shape(&identifier.type_, "BuiltInUseEffectEvent")
}
