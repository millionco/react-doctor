//! Minimal global/import resolution, ported from the parts of
//! `packages/react-compiler/src/HIR/Globals.ts` and the `getGlobalDeclaration`
//! path of `Environment.ts` that stage-1 lowering needs.
//!
//! Stage 1 prints raw post-lowering HIR, before any type inference. At this
//! point the only thing lowering needs from the global subsystem is to turn a
//! free identifier into the right [`NonLocalBinding`] so `LoadGlobal` prints
//! correctly (`(global) name`, `(module) name`, or one of the `import ...`
//! forms). The full `BuiltInType`/`ObjectShape`/`ShapeRegistry` machinery that
//! `getGlobalDeclaration` returns is deferred to a later (type inference) stage.
//!
//! We do port the small classification helpers lowering consults:
//! - [`is_hook_name`] (`isHookName`, regex `/^use[A-Z0-9]/`)
//! - [`is_known_react_module`] (`Environment.#isKnownReactModule`)
//! - [`is_known_global`] (membership in the default global registry's names)

use crate::hir::value::NonLocalBinding;

/// Modules the compiler ships built-in type definitions for
/// (`Environment.knownReactModules`). Matched case-insensitively, mirroring
/// `#isKnownReactModule`.
pub const KNOWN_REACT_MODULES: [&str; 2] = ["react", "react-dom"];

/// `Environment.#isKnownReactModule`: whether type definitions for `module` are
/// owned by the compiler. Compared lowercased, matching the TS implementation.
pub fn is_known_react_module(module: &str) -> bool {
    let lowered = module.to_ascii_lowercase();
    KNOWN_REACT_MODULES.contains(&lowered.as_str())
}

/// `isHookName` from `Environment.ts`: matches `/^use[A-Z0-9]/`, i.e. a name
/// starting with `use` immediately followed by an uppercase letter or digit.
pub fn is_hook_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("use") else {
        return false;
    };
    matches!(rest.chars().next(), Some(c) if c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// The names present in the compiler's default global registry: the union of
/// `UNTYPED_GLOBALS` and the top-level keys of `TYPED_GLOBALS` + `REACT_APIS`
/// in `Globals.ts`. Stage 1 does not need the associated type *shapes* (those
/// are deferred), only whether a name is a recognized global — which gates hook
/// classification and certain validations during lowering.
pub const DEFAULT_GLOBAL_NAMES: &[&str] = &[
    // UNTYPED_GLOBALS
    "Object",
    "Function",
    "RegExp",
    "Date",
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "DataView",
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "WeakMap",
    "Uint8Array",
    "Uint8ClampedArray",
    "Uint16Array",
    "Uint32Array",
    "ArrayBuffer",
    "JSON",
    "console",
    "eval",
    // TYPED_GLOBALS top-level keys (shapes deferred)
    "Object",
    "Array",
    "Boolean",
    "Number",
    "String",
    "Math",
    "Infinity",
    "NaN",
    "isFinite",
    "isNaN",
    "parseFloat",
    "parseInt",
    "Promise",
    "Map",
    "Set",
    "globalThis",
    "performance",
    // REACT_APIS top-level keys
    "React",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useEffect",
    "useEffectEvent",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useTransition",
    "_jsx",
];

/// Whether `name` is a recognized default global (see [`DEFAULT_GLOBAL_NAMES`]),
/// or is hook-like (`isHookName`) and therefore resolves to a custom-hook type
/// in the TS `getGlobalDeclaration`. This is the stage-1 surface of
/// `Environment.getGlobalDeclaration` for `Global`/`ModuleLocal` bindings,
/// without materializing the type itself.
pub fn is_known_global(name: &str) -> bool {
    DEFAULT_GLOBAL_NAMES.contains(&name) || is_hook_name(name)
}

/// The result of resolving an identifier reference, as a [`NonLocalBinding`].
///
/// `LoadGlobal` carries exactly this; the [`crate::hir::PrintHIR`]-equivalent
/// printer formats each variant as in `PrintHIR.ts`:
/// - [`NonLocalBinding::Global`] -> `LoadGlobal(global) name`
/// - [`NonLocalBinding::ModuleLocal`] -> `LoadGlobal(module) name`
/// - [`NonLocalBinding::ImportDefault`] -> `LoadGlobal import name from 'mod'`
/// - [`NonLocalBinding::ImportNamespace`] -> `LoadGlobal import * as name from 'mod'`
/// - [`NonLocalBinding::ImportSpecifier`] -> `LoadGlobal import { imported as name } from 'mod'`
pub type GlobalResolution = NonLocalBinding;
