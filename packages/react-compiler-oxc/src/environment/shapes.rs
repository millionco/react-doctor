//! The minimal object-shape and global *type* registry, ported from the subset
//! of `packages/react-compiler/src/HIR/ObjectShape.ts` and `HIR/Globals.ts` that
//! the stage-2 fixtures actually exercise during `inferTypes`.
//!
//! This is **data only** — no inference runs here. It supplies:
//! - the built-in [`ShapeRegistry`] ([`builtin_shapes`]), keyed by shape id
//!   (the `BuiltIn*Id` constants), each [`ObjectShape`] carrying its typed
//!   properties (for property-load inference) and an optional
//!   [`FunctionSignature`] (its callable return type);
//! - the default global *type* registry ([`default_globals`]) mapping a global
//!   name to the [`Type`] `getGlobalDeclaration` would return.
//!
//! Only the surface the curated fixtures need is materialized (per the stage-2
//! spec): the `BuiltInArray` / `BuiltInObject` / `BuiltInProps` / `BuiltInJsx` /
//! `BuiltInFunction` / `BuiltInUseState` / `BuiltInSetState` / `BuiltInUseRefId` /
//! `BuiltInRefValue` shapes, the `Object` global object, and the callable
//! `Boolean` / `Number` / `useState` globals.
//!
//! ## Generated shape ids
//!
//! `ObjectShape.ts::createAnonId()` mints `<generated_N>` ids from a module-wide
//! counter that advances on every anonymous `addFunction`/`addHook`/`addObject`
//! during registry construction. The callable globals the fixtures hit resolve
//! to fixed ids in the real compiler — `Boolean` -> `<generated_82>`,
//! `Number` -> `<generated_83>`, `useState` -> `<generated_97>` — which the
//! parity oracle prints verbatim. Reproducing the full counter walk would
//! require porting all ~100 builtin shape entries (far beyond the "minimum"
//! surface), so those ids are pinned here as named constants matching the
//! oracle's output exactly. See [`GENERATED_BOOLEAN_ID`] et al.

use std::collections::BTreeMap;

use crate::hir::instruction::{
    AliasingSignature, CallSignature, LegacyEffect, SigEffect, SigPlace,
};
use crate::hir::place::{ValueKind, ValueReason};
use crate::hir::Type;

/// Shape id for component/hook props (`BuiltInPropsId`).
pub const BUILTIN_PROPS_ID: &str = "BuiltInProps";
/// Shape id for array literals and array-returning methods (`BuiltInArrayId`).
pub const BUILTIN_ARRAY_ID: &str = "BuiltInArray";
/// Shape id for plain object literals (`BuiltInObjectId`).
pub const BUILTIN_OBJECT_ID: &str = "BuiltInObject";
/// Shape id for function expressions (`BuiltInFunctionId`).
pub const BUILTIN_FUNCTION_ID: &str = "BuiltInFunction";
/// Shape id for JSX elements/fragments (`BuiltInJsxId`).
pub const BUILTIN_JSX_ID: &str = "BuiltInJsx";
/// Shape id for the "mixed readonly" type (`BuiltInMixedReadonlyId`): the frozen,
/// read-only value the `shared-runtime` `useFragment` hook returns. Every property
/// access (`*` wildcard) yields another `MixedReadonly`, and its array-iteration
/// methods (`map`/`filter`/…) behave like the `BuiltInArray` ones (`ObjectShape.ts`).
pub const BUILTIN_MIXED_READONLY_ID: &str = "BuiltInMixedReadonly";
/// Shape id for the `useState` return tuple (`BuiltInUseStateId`).
pub const BUILTIN_USE_STATE_ID: &str = "BuiltInUseState";
/// Shape id for the `setState` updater (`BuiltInSetStateId`).
pub const BUILTIN_SET_STATE_ID: &str = "BuiltInSetState";
/// Shape id for the `useRef` return (`BuiltInUseRefId`). Note the trailing `Id`
/// is part of the string in the TS source.
pub const BUILTIN_USE_REF_ID: &str = "BuiltInUseRefId";
/// Shape id for the (recursive) value behind a ref's `.current` (`BuiltInRefValueId`).
pub const BUILTIN_REF_VALUE_ID: &str = "BuiltInRefValue";

/// Shape id for `Map` instances (`BuiltInMapId`).
pub const BUILTIN_MAP_ID: &str = "BuiltInMap";
/// Shape id for `Set` instances (`BuiltInSetId`).
pub const BUILTIN_SET_ID: &str = "BuiltInSet";
/// Shape id for `WeakMap` instances (`BuiltInWeakMapId`).
pub const BUILTIN_WEAKMAP_ID: &str = "BuiltInWeakMap";
/// Shape id for `WeakSet` instances (`BuiltInWeakSetId`).
pub const BUILTIN_WEAKSET_ID: &str = "BuiltInWeakSet";

/// Shape id for the `useActionState` return tuple (`BuiltInUseActionStateId`).
pub const BUILTIN_USE_ACTION_STATE_ID: &str = "BuiltInUseActionState";
/// Shape id for the `useActionState` setter (`BuiltInSetActionStateId`).
pub const BUILTIN_SET_ACTION_STATE_ID: &str = "BuiltInSetActionState";
/// Shape id for the `useReducer` return tuple (`BuiltInUseReducerId`).
pub const BUILTIN_USE_REDUCER_ID: &str = "BuiltInUseReducer";
/// Shape id for the `useReducer` dispatcher (`BuiltInDispatchId`).
pub const BUILTIN_DISPATCH_ID: &str = "BuiltInDispatch";
/// Shape id for the `useTransition` return tuple (`BuiltInUseTransitionId`).
pub const BUILTIN_USE_TRANSITION_ID: &str = "BuiltInUseTransition";
/// Shape id for the `useTransition` `startTransition` (`BuiltInStartTransitionId`).
pub const BUILTIN_START_TRANSITION_ID: &str = "BuiltInStartTransition";
/// Shape id for the `useOptimistic` return tuple (`BuiltInUseOptimisticId`).
pub const BUILTIN_USE_OPTIMISTIC_ID: &str = "BuiltInUseOptimistic";
/// Shape id for the `useOptimistic` setter (`BuiltInSetOptimisticId`).
pub const BUILTIN_SET_OPTIMISTIC_ID: &str = "BuiltInSetOptimistic";

/// Shape id for the `useContext` hook (`BuiltInUseContextHookId`). Explicit id in
/// `Globals.ts` (`addHook(..., BuiltInUseContextHookId)`), returns `Poly`.
pub const BUILTIN_USE_CONTEXT_HOOK_ID: &str = "BuiltInUseContextHook";
/// Shape id for the `useEffect` hook (`BuiltInUseEffectHookId`). Carries the
/// effect-hook aliasing signature (freeze deps, create a frozen effect object that
/// captures the deps, return undefined).
pub const BUILTIN_USE_EFFECT_HOOK_ID: &str = "BuiltInUseEffectHook";
/// Shape id for the `useLayoutEffect` hook (`BuiltInUseLayoutEffectHookId`).
pub const BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID: &str = "BuiltInUseLayoutEffectHook";
/// Shape id for the `useInsertionEffect` hook (`BuiltInUseInsertionEffectHookId`).
pub const BUILTIN_USE_INSERTION_EFFECT_HOOK_ID: &str = "BuiltInUseInsertionEffectHook";
/// Shape id for the `useEffectEvent` hook (`BuiltInUseEffectEventId`). Returns a
/// function whose shape id is `BuiltInEffectEventFunction`.
pub const BUILTIN_USE_EFFECT_EVENT_ID: &str = "BuiltInUseEffectEvent";
/// Shape id for the function returned by `useEffectEvent`
/// (`BuiltInEffectEventFunctionId`), conditionally-mutating its arguments.
pub const BUILTIN_EFFECT_EVENT_FUNCTION_ID: &str = "BuiltInEffectEventFunction";
/// Shape id for the `use` operator (`BuiltInUseOperatorId`). Freezes its arg,
/// returns a frozen `Poly`.
pub const BUILTIN_USE_OPERATOR_ID: &str = "BuiltInUseOperator";

/// Shape id for the default non-mutating custom hook (`DefaultNonmutatingHook`),
/// returned by `Environment.#getCustomHookType()` when
/// `enableAssumeHooksFollowRulesOfReact` is on (the schema default). A `Function`
/// shape with `return: Poly`, registered with this explicit id in `ObjectShape.ts`
/// (so it does *not* consume an anonymous `<generated_N>` slot).
pub const DEFAULT_NONMUTATING_HOOK_ID: &str = "DefaultNonmutatingHook";
/// Shape id for the default mutating custom hook (`DefaultMutatingHook`), returned
/// by `#getCustomHookType()` when `enableAssumeHooksFollowRulesOfReact` is off.
/// Also a `Function` shape with `return: Poly` and an explicit id.
pub const DEFAULT_MUTATING_HOOK_ID: &str = "DefaultMutatingHook";

// === shared-runtime module type provider shape ids ==========================
//
// The snapshot test harness (`__tests__/runner/harness.ts`) installs
// `makeSharedRuntimeTypeProvider` as the `moduleTypeProvider` for every fixture,
// so every `import {...} from 'shared-runtime'` is resolved through
// `Environment.#resolveModuleType` → `installTypeConfig`. That call mints fresh
// anonymous `<generated_N>` shape ids in the running compiler, but the corpus
// parity metric compares canonicalized *code* (where shape-id strings never
// appear), so we pin stable named ids here and register their call signatures in
// [`call_signature_for_shape`]. Only the *function* exports the corpus imports
// are materialized; the typed hooks are deferred (see [`install_shared_runtime_shapes`]).

/// Shape id for the `graphql` / `default` / `typedLog` shared-runtime functions:
/// `restParam: Read, calleeEffect: Read, returnType: Primitive, returnValueKind:
/// Primitive`. A primitive-returning, read-only call — never memoized.
pub const SHARED_RUNTIME_PRIMITIVE_FN_ID: &str = "SharedRuntimePrimitiveFn";
/// Shape id for the `typedArrayPush` shared-runtime function: `positionalParams:
/// [Store, Capture], restParam: Capture, calleeEffect: Read, returnType:
/// Primitive, returnValueKind: Primitive`.
pub const SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID: &str = "SharedRuntimeTypedArrayPush";
/// Shape id for the `shared-runtime` module object itself — the object shape
/// `installTypeConfig` builds for the module type, whose typed properties map an
/// import name to its resolved [`Type`].
pub const SHARED_RUNTIME_MODULE_ID: &str = "SharedRuntimeModule";

/// `createAnonId()` result for `BuiltInObject.toString` — the 16th anonymous
/// `addFunction` (right after the 15 array methods `indexOf`..`join` = 0..14).
pub const GENERATED_OBJECT_TO_STRING_ID: &str = "<generated_15>";
/// `createAnonId()` result for the global `Object.fromEntries` static method.
/// Note the registration order in `Globals.ts` (`keys`, `fromEntries`, `entries`,
/// duplicate `keys`, `values`) means these ids are *not* in property order; the
/// values here are verified verbatim against the oracle.
pub const GENERATED_OBJECT_FROM_ENTRIES_ID: &str = "<generated_60>";
/// `createAnonId()` result for the global `Object.entries` static method.
pub const GENERATED_OBJECT_ENTRIES_ID: &str = "<generated_61>";
/// `createAnonId()` result for the global `Object.keys` static method (the second,
/// surviving `keys` registration overwrites the first in the ordered map).
pub const GENERATED_OBJECT_KEYS_ID: &str = "<generated_62>";
/// `createAnonId()` result for the global `Object.values` static method.
pub const GENERATED_OBJECT_VALUES_ID: &str = "<generated_63>";

/// `createAnonId()` results for the global `Array` constructor's static methods,
/// registered in `Globals.ts` declaration order `isArray`, `from`, `of`
/// immediately after the `Object` statics. Pinned verbatim against the
/// `InferTypes` oracle (`Array.from` prints `TFunction<<generated_65>>`), so
/// `isArray` is the slot before (64) and `of` the slot after (66).
pub const GENERATED_ARRAY_IS_ARRAY_ID: &str = "<generated_64>";
/// `createAnonId()` result for the global `Array.from` static method.
pub const GENERATED_ARRAY_FROM_ID: &str = "<generated_65>";
/// `createAnonId()` result for the global `Array.of` static method.
pub const GENERATED_ARRAY_OF_ID: &str = "<generated_66>";

/// `createAnonId()` results for the `performance`/`Date`/`Math`/`console` global
/// objects' methods, registered in `Globals.ts::TYPED_GLOBALS` declaration order
/// immediately after the `Array` statics (`isArray`/`from`/`of` -> 64/65/66) and
/// before `Boolean` (82). Verified verbatim against the oracle:
/// `performance.now` -> 67, `Date.now` -> 68, `Math.{max,min,trunc,ceil,floor,
/// pow,random}` -> 69..75, `console.{error,info,log,table,trace,warn}` -> 76..81.
pub const GENERATED_PERFORMANCE_NOW_ID: &str = "<generated_67>";
/// `createAnonId()` result for `Date.now`.
pub const GENERATED_DATE_NOW_ID: &str = "<generated_68>";
/// `createAnonId()` result for `Math.max`.
pub const GENERATED_MATH_MAX_ID: &str = "<generated_69>";
/// `createAnonId()` result for `Math.min`.
pub const GENERATED_MATH_MIN_ID: &str = "<generated_70>";
/// `createAnonId()` result for `Math.trunc`.
pub const GENERATED_MATH_TRUNC_ID: &str = "<generated_71>";
/// `createAnonId()` result for `Math.ceil`.
pub const GENERATED_MATH_CEIL_ID: &str = "<generated_72>";
/// `createAnonId()` result for `Math.floor`.
pub const GENERATED_MATH_FLOOR_ID: &str = "<generated_73>";
/// `createAnonId()` result for `Math.pow`.
pub const GENERATED_MATH_POW_ID: &str = "<generated_74>";
/// `createAnonId()` result for `Math.random`.
pub const GENERATED_MATH_RANDOM_ID: &str = "<generated_75>";
/// `createAnonId()` result for `console.error`.
pub const GENERATED_CONSOLE_ERROR_ID: &str = "<generated_76>";
/// `createAnonId()` result for `console.info`.
pub const GENERATED_CONSOLE_INFO_ID: &str = "<generated_77>";
/// `createAnonId()` result for `console.log`.
pub const GENERATED_CONSOLE_LOG_ID: &str = "<generated_78>";
/// `createAnonId()` result for `console.table`.
pub const GENERATED_CONSOLE_TABLE_ID: &str = "<generated_79>";
/// `createAnonId()` result for `console.trace`.
pub const GENERATED_CONSOLE_TRACE_ID: &str = "<generated_80>";
/// `createAnonId()` result for `console.warn`.
pub const GENERATED_CONSOLE_WARN_ID: &str = "<generated_81>";
/// `createAnonId()` result for the global `Boolean` constructor.
pub const GENERATED_BOOLEAN_ID: &str = "<generated_82>";
/// `createAnonId()` result for the global `Number` constructor.
pub const GENERATED_NUMBER_ID: &str = "<generated_83>";
/// `createAnonId()` result for the global `String` constructor. It and the
/// contiguous primitive-returning globals below (`parseInt`..`decodeURIComponent`)
/// are registered immediately after `Boolean`/`Number` in `Globals.ts`, so their
/// anonymous `addFunction` ids run `<generated_84>` (`String`) through
/// `<generated_92>` (`decodeURIComponent`) in declaration order — verified verbatim
/// against the oracle (`String` -> 84, `parseInt` -> 85).
pub const GENERATED_STRING_ID: &str = "<generated_84>";
/// `createAnonId()` result for the global `parseInt`.
pub const GENERATED_PARSE_INT_ID: &str = "<generated_85>";
/// `createAnonId()` result for the global `parseFloat`.
pub const GENERATED_PARSE_FLOAT_ID: &str = "<generated_86>";
/// `createAnonId()` result for the global `isNaN`.
pub const GENERATED_IS_NAN_ID: &str = "<generated_87>";
/// `createAnonId()` result for the global `isFinite`.
pub const GENERATED_IS_FINITE_ID: &str = "<generated_88>";
/// `createAnonId()` result for the global `encodeURI`.
pub const GENERATED_ENCODE_URI_ID: &str = "<generated_89>";
/// `createAnonId()` result for the global `encodeURIComponent`.
pub const GENERATED_ENCODE_URI_COMPONENT_ID: &str = "<generated_90>";
/// `createAnonId()` result for the global `decodeURI`.
pub const GENERATED_DECODE_URI_ID: &str = "<generated_91>";
/// `createAnonId()` result for the global `decodeURIComponent`.
pub const GENERATED_DECODE_URI_COMPONENT_ID: &str = "<generated_92>";
/// `createAnonId()` results for the `Set` / `Map` / `WeakSet` / `WeakMap`
/// instance methods, minted by the `addObject(BUILTIN_SHAPES, BuiltIn*Id, …)`
/// calls in `ObjectShape.ts` that immediately follow `BuiltInObject.toString`
/// (`<generated_15>`). The collection shapes register in source order Set, Map,
/// WeakSet, WeakMap; each method's anonymous `addFunction` advances the counter.
///
/// Set methods (16..28): add, clear, delete, has, [size: no fn], difference,
/// union, symmetricalDifference, isSubsetOf, isSupersetOf, forEach, entries,
/// keys, values. Map methods (29..37): clear, delete, get, has, set, [size],
/// forEach, entries, keys, values. WeakSet (38..40): add, delete, has. WeakMap
/// (41..44): delete, get, has, set. Verified verbatim against the oracle
/// (`Set.add` -> `<generated_16>`, `Map.set` -> `<generated_33>`).
pub const GENERATED_SET_ADD_ID: &str = "<generated_16>";
/// `Set.prototype.clear`.
pub const GENERATED_SET_CLEAR_ID: &str = "<generated_17>";
/// `Set.prototype.delete`.
pub const GENERATED_SET_DELETE_ID: &str = "<generated_18>";
/// `Set.prototype.has`.
pub const GENERATED_SET_HAS_ID: &str = "<generated_19>";
/// `Set.prototype.difference`.
pub const GENERATED_SET_DIFFERENCE_ID: &str = "<generated_20>";
/// `Set.prototype.union`.
pub const GENERATED_SET_UNION_ID: &str = "<generated_21>";
/// `Set.prototype.symmetricalDifference`.
pub const GENERATED_SET_SYMMETRICAL_DIFFERENCE_ID: &str = "<generated_22>";
/// `Set.prototype.isSubsetOf`.
pub const GENERATED_SET_IS_SUBSET_OF_ID: &str = "<generated_23>";
/// `Set.prototype.isSupersetOf`.
pub const GENERATED_SET_IS_SUPERSET_OF_ID: &str = "<generated_24>";
/// `Set.prototype.forEach`.
pub const GENERATED_SET_FOREACH_ID: &str = "<generated_25>";
/// `Set.prototype.entries`.
pub const GENERATED_SET_ENTRIES_ID: &str = "<generated_26>";
/// `Set.prototype.keys`.
pub const GENERATED_SET_KEYS_ID: &str = "<generated_27>";
/// `Set.prototype.values`.
pub const GENERATED_SET_VALUES_ID: &str = "<generated_28>";
/// `Map.prototype.clear`.
pub const GENERATED_MAP_CLEAR_ID: &str = "<generated_29>";
/// `Map.prototype.delete`.
pub const GENERATED_MAP_DELETE_ID: &str = "<generated_30>";
/// `Map.prototype.get`.
pub const GENERATED_MAP_GET_ID: &str = "<generated_31>";
/// `Map.prototype.has`.
pub const GENERATED_MAP_HAS_ID: &str = "<generated_32>";
/// `Map.prototype.set`.
pub const GENERATED_MAP_SET_ID: &str = "<generated_33>";
/// `Map.prototype.forEach`.
pub const GENERATED_MAP_FOREACH_ID: &str = "<generated_34>";
/// `Map.prototype.entries`.
pub const GENERATED_MAP_ENTRIES_ID: &str = "<generated_35>";
/// `Map.prototype.keys`.
pub const GENERATED_MAP_KEYS_ID: &str = "<generated_36>";
/// `Map.prototype.values`.
pub const GENERATED_MAP_VALUES_ID: &str = "<generated_37>";
/// `WeakSet.prototype.add`.
pub const GENERATED_WEAKSET_ADD_ID: &str = "<generated_38>";
/// `WeakSet.prototype.delete`.
pub const GENERATED_WEAKSET_DELETE_ID: &str = "<generated_39>";
/// `WeakSet.prototype.has`.
pub const GENERATED_WEAKSET_HAS_ID: &str = "<generated_40>";
/// `WeakMap.prototype.delete`.
pub const GENERATED_WEAKMAP_DELETE_ID: &str = "<generated_41>";
/// `WeakMap.prototype.get`.
pub const GENERATED_WEAKMAP_GET_ID: &str = "<generated_42>";
/// `WeakMap.prototype.has`.
pub const GENERATED_WEAKMAP_HAS_ID: &str = "<generated_43>";
/// `WeakMap.prototype.set`.
pub const GENERATED_WEAKMAP_SET_ID: &str = "<generated_44>";

/// `createAnonId()` results for the `BuiltInMixedReadonly` methods, registered in
/// `ObjectShape.ts` declaration order immediately after the `WeakMap` shape
/// (`set` = 44): `toString` = 45 … `join` = 58. Verified verbatim against the
/// oracle (`<array>.map` on a `MixedReadonly` receiver prints `<generated_49>`,
/// `useFragment` lands on `<generated_116>`).
pub const GENERATED_MIXED_READONLY_TO_STRING_ID: &str = "<generated_45>";
/// `MixedReadonly.prototype.indexOf`.
pub const GENERATED_MIXED_READONLY_INDEX_OF_ID: &str = "<generated_46>";
/// `MixedReadonly.prototype.includes`.
pub const GENERATED_MIXED_READONLY_INCLUDES_ID: &str = "<generated_47>";
/// `MixedReadonly.prototype.at`.
pub const GENERATED_MIXED_READONLY_AT_ID: &str = "<generated_48>";
/// `MixedReadonly.prototype.map`.
pub const GENERATED_MIXED_READONLY_MAP_ID: &str = "<generated_49>";
/// `MixedReadonly.prototype.flatMap`.
pub const GENERATED_MIXED_READONLY_FLAT_MAP_ID: &str = "<generated_50>";
/// `MixedReadonly.prototype.filter`.
pub const GENERATED_MIXED_READONLY_FILTER_ID: &str = "<generated_51>";
/// `MixedReadonly.prototype.concat`.
pub const GENERATED_MIXED_READONLY_CONCAT_ID: &str = "<generated_52>";
/// `MixedReadonly.prototype.slice`.
pub const GENERATED_MIXED_READONLY_SLICE_ID: &str = "<generated_53>";
/// `MixedReadonly.prototype.every`.
pub const GENERATED_MIXED_READONLY_EVERY_ID: &str = "<generated_54>";
/// `MixedReadonly.prototype.some`.
pub const GENERATED_MIXED_READONLY_SOME_ID: &str = "<generated_55>";
/// `MixedReadonly.prototype.find`.
pub const GENERATED_MIXED_READONLY_FIND_ID: &str = "<generated_56>";
/// `MixedReadonly.prototype.findIndex`.
pub const GENERATED_MIXED_READONLY_FIND_INDEX_ID: &str = "<generated_57>";
/// `MixedReadonly.prototype.join`.
pub const GENERATED_MIXED_READONLY_JOIN_ID: &str = "<generated_58>";

/// `createAnonId()` results for the `shared-runtime` typed exports, minted lazily
/// when `installTypeConfig` resolves the module type. In the property declaration
/// order of `makeSharedRuntimeTypeProvider` (`default`, `graphql`, `typedArrayPush`,
/// `typedLog`, then the typed hooks `useFreeze`, `useFragment`, `useNoAlias`), and
/// after the React-global ids (last = `<generated_109>`), they take `<generated_110>`
/// onward. Verified against the oracle (`graphql` = 112, `useFreeze` = 115,
/// `useFragment` = 116, `useNoAlias` = 117).
pub const GENERATED_SHARED_RUNTIME_DEFAULT_ID: &str = "<generated_110>";
/// `shared-runtime` `graphql` function.
pub const GENERATED_SHARED_RUNTIME_GRAPHQL_ID: &str = "<generated_112>";
/// `shared-runtime` `typedArrayPush` function.
pub const GENERATED_SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID: &str = "<generated_113>";
/// `shared-runtime` `typedLog` function.
pub const GENERATED_SHARED_RUNTIME_TYPED_LOG_ID: &str = "<generated_114>";
/// `shared-runtime` `useFreeze` hook: `restParam: Freeze`, `returnType: Poly`,
/// `returnValueKind: Frozen` (the `addHook` default), no `noAlias`.
pub const GENERATED_USE_FREEZE_ID: &str = "<generated_115>";
/// `shared-runtime` `useFragment` hook: `restParam: Freeze`, `returnType:
/// MixedReadonly`, `returnValueKind: Frozen`, `noAlias: true`.
pub const GENERATED_USE_FRAGMENT_ID: &str = "<generated_116>";
/// `shared-runtime` `useNoAlias` hook: `restParam: Freeze`, `returnType: Poly`,
/// `returnValueKind: Mutable`, `noAlias: true`.
pub const GENERATED_USE_NO_ALIAS_ID: &str = "<generated_117>";

/// `createAnonId()` results for the `shared-runtime` typed functions that carry an
/// explicit `aliasing` config (`makeSharedRuntimeTypeProvider`). They follow the
/// typed hooks (last = `useNoAlias` = `<generated_117>`) in `installTypeConfig`'s
/// `Object.entries` property order — `typedIdentity` (118), `typedAssign` (119),
/// `typedAlias` (120), `typedCapture` (121), `typedCreateFrom` (122),
/// `typedMutate` (123) — verified verbatim against the `InferTypes` oracle
/// (`typedCapture` prints `TFunction<<generated_121>>(): :TObject<BuiltInArray>`,
/// `typedCreateFrom` = 122, `typedMutate` = 123). Unlike `typedArrayPush`, each
/// has an `aliasing` signature so `InferMutationAliasingEffects` emits the precise
/// `Capture`/`CreateFrom`/`Mutate` effects (a clean `Capture` from `@value` into
/// the return, *not* the untyped-function `MaybeAlias`/`MutateTransitive`
/// fallback) — that is what keeps `o`'s frozen scope from being merged into `x`'s
/// in the `transitivity-*` fixtures.
///
/// `typedIdentity`: `params: [@value]`, `Assign(@value -> @return)`, `Any`.
pub const GENERATED_SHARED_RUNTIME_TYPED_IDENTITY_ID: &str = "<generated_118>";
/// `typedAssign`: `params: [@value]`, `Create(@return, Mutable) + Alias(@value ->
/// @return)`, `Any` (mutable return).
pub const GENERATED_SHARED_RUNTIME_TYPED_ASSIGN_ID: &str = "<generated_119>";
/// `typedAlias`: `params: [@value]`, `Create(@return, Mutable) + Alias(@value ->
/// @return)`, `Any` (mutable return).
pub const GENERATED_SHARED_RUNTIME_TYPED_ALIAS_ID: &str = "<generated_120>";
/// `typedCapture`: `params: [@value]`, `Create(@return, Mutable) + Capture(@value
/// -> @return)`, `Array` return.
pub const GENERATED_SHARED_RUNTIME_TYPED_CAPTURE_ID: &str = "<generated_121>";
/// `typedCreateFrom`: `params: [@value]`, `CreateFrom(@value -> @return)`, `Any`
/// (mutable) return.
pub const GENERATED_SHARED_RUNTIME_TYPED_CREATE_FROM_ID: &str = "<generated_122>";
/// `typedMutate`: `params: [@object, @value]`, `Create(@return, Primitive) +
/// Mutate(@object) + Capture(@value -> @object)`, `Primitive` return.
pub const GENERATED_SHARED_RUNTIME_TYPED_MUTATE_ID: &str = "<generated_123>";

/// Shape ids for the `react-native-reanimated` module type
/// (`Globals.ts::getReanimatedModuleType`), installed only when
/// `enableCustomTypeDefinitionForReanimated` is set. The TS builds them in the
/// `Environment` constructor after the standard `BUILTIN_SHAPES`/shared-runtime
/// hooks (last anon id `<generated_117>`), so `createAnonId()` hands them
/// `<generated_118>` onward, in declaration order: the 6 frozen hooks
/// (`useFrameCallback`..`useWorkletCallback` = 118..123), the 2 mutable hooks
/// (`useSharedValue` = 124, `useDerivedValue` = 125), then the 7 functions
/// (`withTiming`..`executeOnUIRuntimeSync` = 126..132). These ids are never
/// load-bearing for parity (no fixture prints their `LoadGlobal` type and the
/// corpus metric compares canonicalized code), but are pinned in TS order for
/// fidelity. The pass is gated, so they only become reachable under the pragma.
///
/// The shared "frozen" hook shape id used by all 6 frozen hooks
/// (`positionalParams: [], restParam: Freeze, returnType: Poly, returnValueKind:
/// Frozen, noAlias: true, calleeEffect: Read, hookKind: Custom`). The TS mints a
/// distinct id per hook, but they all carry identical signatures and an empty
/// property set, so one shape backs all six (id values are unobservable here).
///
/// In the running compiler this would be `<generated_118>`, but the
/// `react-native-reanimated` and `shared-runtime` module types are *never*
/// resolved in the same compilation (each is installed lazily on first import), so
/// `<generated_118>` is also `typedIdentity`'s id under the shared-runtime provider.
/// Our static registry merges both providers, so we give the (unobservable, never
/// printed) reanimated frozen-hook shape a distinct synthetic id to disambiguate
/// the merged `call_signature_for_shape` keying — the shared-runtime typed-function
/// ids (`<generated_118..123>`) ARE printed in the `transitivity-*` IR refs and so
/// keep their TS-faithful values.
pub const GENERATED_REANIMATED_FROZEN_HOOK_ID: &str = "<reanimated_frozen_hook>";
/// The shared mutable-hook shape id for `useSharedValue`/`useDerivedValue`
/// (`restParam: Freeze, returnType: Object<ReanimatedSharedValueId>,
/// returnValueKind: Mutable, noAlias: true, calleeEffect: Read, hookKind:
/// Custom`).
pub const GENERATED_REANIMATED_MUTABLE_HOOK_ID: &str = "<generated_124>";
/// The shared function shape id for the reanimated value-producing functions
/// (`withTiming`/`withSpring`/`createAnimatedPropAdapter`/`withDecay`/`withRepeat`/
/// `runOnUI`/`executeOnUIRuntimeSync`): `restParam: Read, returnType: Poly,
/// calleeEffect: Read, returnValueKind: Mutable, noAlias: true` (not a hook).
pub const GENERATED_REANIMATED_FN_ID: &str = "<generated_126>";

/// Shape id for the `react-native-reanimated` module object, mapping each typed
/// import name to its resolved [`Type`]. Resolved through
/// [`TypeProvider::resolve_module_type`] only when
/// `enableCustomTypeDefinitionForReanimated` is set.
pub const REANIMATED_MODULE_ID: &str = "ReanimatedModule";
/// Shape id for the value `useSharedValue`/`useDerivedValue` return
/// (`ObjectShape.ts::ReanimatedSharedValueId`): an empty object whose `.value`
/// reads fall through. Registered in `BUILTIN_SHAPES` as `addObject(..., [])`.
pub const REANIMATED_SHARED_VALUE_ID: &str = "ReanimatedSharedValueId";

/// `createAnonId()` results for the global `Map` / `Set` / `WeakMap` / `WeakSet`
/// constructors, registered in `Globals.ts` declaration order immediately after
/// `decodeURIComponent` (`<generated_92>`). Verified verbatim against the oracle
/// (`Map` -> `<generated_93>`, `Set` -> `<generated_94>`, etc.).
pub const GENERATED_MAP_CTOR_ID: &str = "<generated_93>";
/// `createAnonId()` result for the global `Set` constructor.
pub const GENERATED_SET_CTOR_ID: &str = "<generated_94>";
/// `createAnonId()` result for the global `WeakMap` constructor.
pub const GENERATED_WEAKMAP_CTOR_ID: &str = "<generated_95>";
/// `createAnonId()` result for the global `WeakSet` constructor.
pub const GENERATED_WEAKSET_CTOR_ID: &str = "<generated_96>";

/// `createAnonId()` result for the `useState` hook.
pub const GENERATED_USE_STATE_ID: &str = "<generated_97>";
/// `createAnonId()` result for the `useRef` hook.
pub const GENERATED_USE_REF_ID: &str = "<generated_100>";
/// `createAnonId()` result for the `useMemo` hook (`addHook` in `Globals.ts`).
pub const GENERATED_USE_MEMO_ID: &str = "<generated_102>";
/// `createAnonId()` result for the `useCallback` hook (`addHook` in `Globals.ts`).
pub const GENERATED_USE_CALLBACK_ID: &str = "<generated_103>";
/// `createAnonId()` result for the `useActionState` hook. In `REACT_APIS`
/// declaration order it is the `addHook` immediately after `useState` (97), so it
/// takes `<generated_98>`. (Its return-tuple shape `BuiltInUseActionState` and the
/// setter `BuiltInSetActionState` use explicit ids, so they do not consume slots.)
pub const GENERATED_USE_ACTION_STATE_ID: &str = "<generated_98>";
/// `createAnonId()` result for the `useReducer` hook (right after `useActionState`).
pub const GENERATED_USE_REDUCER_ID: &str = "<generated_99>";
/// `createAnonId()` result for the `useTransition` hook. Registered after
/// `useCallback` (103); the intervening `useEffect`/`useLayoutEffect`/
/// `useInsertionEffect` hooks use explicit shape ids (no anon mint), so the next
/// anonymous `addHook` slot is `<generated_104>`. Not load-bearing for parity (no
/// fixture prints `useTransition`'s `LoadGlobal` type); pinned for fidelity.
pub const GENERATED_USE_TRANSITION_ID: &str = "<generated_104>";
/// `createAnonId()` result for the `useOptimistic` hook (right after `useTransition`).
pub const GENERATED_USE_OPTIMISTIC_ID: &str = "<generated_105>";

/// `createAnonId()` result for the `useImperativeHandle` hook. In `REACT_APIS`
/// declaration order it is registered between `useRef` (100) and `useMemo` (102),
/// so it mints `<generated_101>`. Verified against the oracle
/// (`React.useImperativeHandle` prints `TFunction<<generated_101>>`).
pub const GENERATED_USE_IMPERATIVE_HANDLE_ID: &str = "<generated_101>";
/// `createAnonId()` result for `React.createElement`. Registered in the `React`
/// object after the REACT_APIS list, so it follows `useOptimistic`/`use`/
/// `useEffectEvent` and lands on `<generated_106>` (verified against the oracle).
pub const GENERATED_CREATE_ELEMENT_ID: &str = "<generated_106>";
/// `createAnonId()` result for `React.cloneElement` (right after `createElement`).
pub const GENERATED_CLONE_ELEMENT_ID: &str = "<generated_107>";
/// `createAnonId()` result for `React.createRef` (right after `cloneElement`).
pub const GENERATED_CREATE_REF_ID: &str = "<generated_108>";
/// `createAnonId()` result for the `React` namespace object itself. The
/// `addObject(DEFAULT_SHAPES, null, [...REACT_APIS, createElement, cloneElement,
/// createRef])` call mints its anonymous id last, so it lands on `<generated_109>`
/// (verified against the oracle: `LoadGlobal React` prints `TObject<<generated_109>>`).
pub const GENERATED_REACT_ID: &str = "<generated_109>";

/// A function's call signature, as far as type inference needs it
/// (`ObjectShape.ts::FunctionSignature`). Only the `return` type participates in
/// printed output; effects/value-kinds/aliasing are deferred to later stages and
/// are intentionally omitted from this minimal port.
#[derive(Clone, Debug, PartialEq)]
pub struct FunctionSignature {
    /// The call's result type (`returnType`).
    pub return_type: Type,
    /// Whether this signature is for a constructor (`new`-callable).
    pub is_constructor: bool,
}

/// `Environment.getFunctionSignature(type)` (the effect-data path): the
/// [`CallSignature`] for a callable [`Type::Function`], keyed by its shape id.
///
/// Mirrors looking up the function shape's `functionType` and returning its
/// effect signature. Only the shape ids the curated fixtures reach carry effect
/// data; the rest (and bare `:TFunction` with no shape id) return `None`, which
/// drives the unsignatured default capture path.
pub fn get_function_signature(type_: &Type) -> Option<CallSignature> {
    let Type::Function {
        shape_id: Some(shape_id),
        ..
    } = type_
    else {
        return None;
    };
    call_signature_for_shape(shape_id)
}

/// Legacy call signature with the common shape: a positional-param effect list,
/// optional rest effect, callee effect, return kind/reason; no aliasing, not
/// `mutableOnlyIfOperandsAreMutable`, not impure.
fn legacy(
    positional_params: Vec<LegacyEffect>,
    rest_param: Option<LegacyEffect>,
    callee_effect: LegacyEffect,
    return_value_kind: ValueKind,
    return_value_reason: ValueReason,
) -> CallSignature {
    CallSignature {
        positional_params,
        rest_param,
        callee_effect,
        return_value_kind,
        return_value_reason,
        mutable_only_if_operands_are_mutable: false,
        impure: false,
        no_alias: false,
        aliasing: None,
    }
}

/// As [`legacy`] but with `mutableOnlyIfOperandsAreMutable: true`,
/// `returnValueReason: Other`, and `noAlias: true`. Used by the array iteration
/// methods (filter / map / forEach / every / some / find / findIndex) whose
/// receiver/args are only transitively mutated if the callback might mutate them
/// and whose results do not alias the args via the callee (ObjectShape.ts, each
/// registered with `noAlias: true`).
fn mutable_only(
    positional_params: Vec<LegacyEffect>,
    rest_param: Option<LegacyEffect>,
    callee_effect: LegacyEffect,
    return_value_kind: ValueKind,
) -> CallSignature {
    CallSignature {
        positional_params,
        rest_param,
        callee_effect,
        return_value_kind,
        return_value_reason: ValueReason::Other,
        mutable_only_if_operands_are_mutable: true,
        impure: false,
        no_alias: true,
        aliasing: None,
    }
}

/// The [`CallSignature`] for a known builtin/global function shape id, or `None`.
fn call_signature_for_shape(shape_id: &str) -> Option<CallSignature> {
    use LegacyEffect::*;
    use ValueKind::*;
    let sig = match shape_id {
        // Array methods (generated ids, declaration order indexOf=0..join=14).
        "<generated_0>" | "<generated_1>" => {
            // indexOf / includes
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        "<generated_2>" => {
            // pop: calleeEffect Store, returns Mutable
            legacy(vec![], None, Store, Mutable, ValueReason::Other)
        }
        "<generated_3>" => {
            // at
            legacy(vec![Read], None, Capture, Mutable, ValueReason::Other)
        }
        "<generated_4>" => {
            // concat
            legacy(vec![], Some(Capture), Capture, Mutable, ValueReason::Other)
        }
        "<generated_5>" => {
            // push (aliasing signature)
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Capture),
                callee_effect: Store,
                return_value_kind: Primitive,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(push_aliasing_signature()),
            }
        }
        "<generated_6>" => {
            // slice
            legacy(vec![], Some(Read), Capture, Mutable, ValueReason::Other)
        }
        "<generated_7>" => {
            // map (aliasing signature)
            CallSignature {
                positional_params: vec![],
                rest_param: Some(ConditionallyMutate),
                callee_effect: ConditionallyMutate,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: true,
                impure: false,
                no_alias: true,
                aliasing: Some(map_aliasing_signature()),
            }
        }
        "<generated_8>" | "<generated_9>" => {
            // flatMap / filter: restParam/calleeEffect ConditionallyMutate, mutable
            // array return, `mutableOnlyIfOperandsAreMutable: true` (ObjectShape.ts).
            // The flag lets the fast path alias the receiver (and immutable-capture
            // the args) when every arg is a non-mutating function/immutable value.
            mutable_only(vec![], Some(ConditionallyMutate), ConditionallyMutate, Mutable)
        }
        "<generated_10>" | "<generated_11>" | "<generated_13>" => {
            // every / some / findIndex: same shape, primitive return,
            // `mutableOnlyIfOperandsAreMutable: true` (ObjectShape.ts).
            mutable_only(vec![], Some(ConditionallyMutate), ConditionallyMutate, Primitive)
        }
        "<generated_12>" => {
            // find: same shape, mutable return, `mutableOnlyIfOperandsAreMutable:
            // true` (ObjectShape.ts).
            mutable_only(vec![], Some(ConditionallyMutate), ConditionallyMutate, Mutable)
        }
        "<generated_14>" => {
            // join
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        // === BuiltInMixedReadonly methods (ObjectShape.ts) =================
        GENERATED_MIXED_READONLY_TO_STRING_ID
        | GENERATED_MIXED_READONLY_INDEX_OF_ID
        | GENERATED_MIXED_READONLY_INCLUDES_ID
        | GENERATED_MIXED_READONLY_JOIN_ID => {
            // toString / indexOf / includes / join: restParam Read, calleeEffect
            // Read, primitive return (ObjectShape.ts). `toString` has no rest param,
            // but a `None` rest is equivalent here (there are no args to capture).
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        GENERATED_MIXED_READONLY_AT_ID => {
            // at: positionalParams [Read], calleeEffect Capture, returns a frozen
            // MixedReadonly (ObjectShape.ts).
            legacy(
                vec![Read],
                None,
                Capture,
                Frozen,
                ValueReason::Other,
            )
        }
        GENERATED_MIXED_READONLY_MAP_ID
        | GENERATED_MIXED_READONLY_FLAT_MAP_ID
        | GENERATED_MIXED_READONLY_FILTER_ID => {
            // map / flatMap / filter: restParam/calleeEffect ConditionallyMutate,
            // mutable BuiltInArray return, `noAlias: true` (ObjectShape.ts). Unlike
            // the BuiltInArray `map`, these have no aliasing config and no
            // `mutableOnlyIfOperandsAreMutable`, so they take the plain legacy path.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(ConditionallyMutate),
                callee_effect: ConditionallyMutate,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        GENERATED_MIXED_READONLY_CONCAT_ID => {
            // concat: restParam/calleeEffect Capture, mutable BuiltInArray return
            // (ObjectShape.ts).
            legacy(vec![], Some(Capture), Capture, Mutable, ValueReason::Other)
        }
        GENERATED_MIXED_READONLY_SLICE_ID => {
            // slice: restParam Read, calleeEffect Capture, mutable BuiltInArray
            // return (ObjectShape.ts).
            legacy(vec![], Some(Read), Capture, Mutable, ValueReason::Other)
        }
        GENERATED_MIXED_READONLY_EVERY_ID
        | GENERATED_MIXED_READONLY_SOME_ID
        | GENERATED_MIXED_READONLY_FIND_INDEX_ID => {
            // every / some / findIndex: restParam/calleeEffect ConditionallyMutate,
            // primitive return, `noAlias: true`, `mutableOnlyIfOperandsAreMutable:
            // true` (ObjectShape.ts).
            mutable_only(vec![], Some(ConditionallyMutate), ConditionallyMutate, Primitive)
        }
        GENERATED_MIXED_READONLY_FIND_ID => {
            // find: restParam/calleeEffect ConditionallyMutate, frozen MixedReadonly
            // return, `noAlias: true`, `mutableOnlyIfOperandsAreMutable: true`
            // (ObjectShape.ts).
            mutable_only(vec![], Some(ConditionallyMutate), ConditionallyMutate, Frozen)
        }
        GENERATED_OBJECT_TO_STRING_ID => {
            // Object.prototype.toString
            legacy(vec![], None, Read, Primitive, ValueReason::Other)
        }
        GENERATED_OBJECT_KEYS_ID => {
            // `Object.keys(object)` (`Globals.ts`, the surviving second `keys`
            // registration): `positionalParams: [Read]`, `calleeEffect: Read`,
            // returns a fresh mutable `BuiltInArray`. Its `aliasing` config creates
            // the mutable return then *immutable-captures* the object into it (only
            // the keys are captured, and keys are immutable) — so the source object
            // is NOT transitively mutated by `Object.keys`, unlike the default
            // capture path. This keeps a read-only `Object.keys(obj)` from extending
            // `obj`'s mutable range.
            CallSignature {
                positional_params: vec![Read],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(object_keys_aliasing_signature()),
            }
        }
        GENERATED_OBJECT_ENTRIES_ID | GENERATED_OBJECT_VALUES_ID => {
            // `Object.entries(object)` / `Object.values(object)` (`Globals.ts`):
            // `positionalParams: [Capture]`, `calleeEffect: Read`, returns a fresh
            // mutable `BuiltInArray`. Their `aliasing` config creates the mutable
            // return then *captures* the object's values into it (object values are
            // captured — so the return aliases the object's mutability, but the
            // object is not itself mutated).
            CallSignature {
                positional_params: vec![Capture],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(object_values_aliasing_signature()),
            }
        }
        GENERATED_OBJECT_FROM_ENTRIES_ID => {
            // `Object.fromEntries(iterable)` (`Globals.ts`): `positionalParams:
            // [ConditionallyMutate]`, `calleeEffect: Read`, returns a fresh mutable
            // `BuiltInObject`. No `aliasing` config in the TS, so it takes the
            // legacy path (the iterable arg is conditionally mutated by the
            // construction, the result is a fresh mutable object).
            legacy(
                vec![ConditionallyMutate],
                None,
                Read,
                Mutable,
                ValueReason::Other,
            )
        }
        GENERATED_ARRAY_IS_ARRAY_ID => {
            // Array.isArray(value): reads its argument, returns a primitive
            // (`positionalParams: [Read]`, `calleeEffect: Read`, primitive return).
            legacy(vec![Read], None, Read, Primitive, ValueReason::Other)
        }
        GENERATED_ARRAY_FROM_ID => {
            // Array.from(arrayLike, optionalFn, optionalThis) — `Globals.ts`:
            //   positionalParams: [
            //     ConditionallyMutateIterator,  // arg0 (the iterable)
            //     ConditionallyMutate,           // arg1 (the map fn)
            //     ConditionallyMutate,           // arg2 (thisArg)
            //   ],
            //   restParam: Read, calleeEffect: Read,
            //   returnType: BuiltInArray, returnValueKind: Mutable.
            // The `ConditionallyMutateIterator` on arg0 is the polymorphic
            // "mutate only if the iterable is itself mutable/self-mutative" rule;
            // it extends arg0's mutable range into the call (so e.g. an array
            // literal passed to `Array.from` is given a reactive scope), matching
            // the oracle's `array-from-*` memoization.
            legacy(
                vec![
                    ConditionallyMutateIterator,
                    ConditionallyMutate,
                    ConditionallyMutate,
                ],
                Some(Read),
                Read,
                Mutable,
                ValueReason::Other,
            )
        }
        GENERATED_ARRAY_OF_ID => {
            // Array.of(...elements): `restParam: Read`, `calleeEffect: Read`,
            // returns a fresh mutable array.
            legacy(vec![], Some(Read), Read, Mutable, ValueReason::Other)
        }
        GENERATED_MAP_CTOR_ID
        | GENERATED_SET_CTOR_ID
        | GENERATED_WEAKMAP_CTOR_ID
        | GENERATED_WEAKSET_CTOR_ID => {
            // `new Map/Set/WeakMap/WeakSet(iterable)` (`Globals.ts`):
            //   positionalParams: [ConditionallyMutateIterator], restParam: null,
            //   calleeEffect: Read, returnValueKind: Mutable. The
            //   `ConditionallyMutateIterator` on the optional iterable arg extends
            //   its mutable range into the constructor only when it is a
            //   self-mutating iterable (not an Array/Set/Map).
            legacy(
                vec![ConditionallyMutateIterator],
                None,
                Read,
                Mutable,
                ValueReason::Other,
            )
        }
        GENERATED_SET_ADD_ID => {
            // `Set.prototype.add(value)` (`ObjectShape.ts`): legacy
            //   positionalParams: [Capture], calleeEffect: Store, returns Mutable.
            // Set.add carries an `aliasing` config: the call returns the receiver,
            // mutates it, and *captures* the value INTO the receiver (so the value
            // is captured — not transitively mutated — and keeps its own scope).
            CallSignature {
                positional_params: vec![Capture],
                rest_param: None,
                callee_effect: Store,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(set_add_aliasing_signature()),
            }
        }
        GENERATED_WEAKSET_ADD_ID => {
            // `WeakSet.prototype.add(value)`: legacy positionalParams [Capture],
            // calleeEffect Store, returns Mutable. Unlike `Set.add`, WeakSet.add
            // has NO `aliasing` config in the TS, so it takes the legacy lowering
            // (`Mutate(receiver)` + `Capture(value -> receiver)` + an `Alias` of
            // the receiver into the result).
            legacy(vec![Capture], None, Store, Mutable, ValueReason::Other)
        }
        GENERATED_MAP_SET_ID | GENERATED_WEAKMAP_SET_ID => {
            // `Map/WeakMap.prototype.set(key, value)` (`ObjectShape.ts`): legacy
            //   positionalParams: [Capture, Capture], calleeEffect: Store, returns
            //   Mutable. No aliasing config in the TS — the legacy `Store` callee +
            //   `Capture` positionals already yield `Mutate(receiver)` +
            //   `Capture(arg -> receiver)` for each arg.
            legacy(
                vec![Capture, Capture],
                None,
                Store,
                Mutable,
                ValueReason::Other,
            )
        }
        GENERATED_SET_CLEAR_ID | GENERATED_MAP_CLEAR_ID => {
            // Set/Map.clear(): calleeEffect Store, primitive return.
            legacy(vec![], None, Store, Primitive, ValueReason::Other)
        }
        GENERATED_SET_DELETE_ID
        | GENERATED_MAP_DELETE_ID
        | GENERATED_WEAKSET_DELETE_ID
        | GENERATED_WEAKMAP_DELETE_ID => {
            // .delete(value): positionalParams [Read], calleeEffect Store,
            // primitive return.
            legacy(vec![Read], None, Store, Primitive, ValueReason::Other)
        }
        GENERATED_SET_HAS_ID
        | GENERATED_MAP_HAS_ID
        | GENERATED_WEAKSET_HAS_ID
        | GENERATED_WEAKMAP_HAS_ID => {
            // .has(value): positionalParams [Read], calleeEffect Read, primitive.
            legacy(vec![Read], None, Read, Primitive, ValueReason::Other)
        }
        GENERATED_MAP_GET_ID | GENERATED_WEAKMAP_GET_ID => {
            // .get(key): positionalParams [Read], calleeEffect Capture, returns
            // a mutable Poly value aliased from the receiver.
            legacy(vec![Read], None, Capture, Mutable, ValueReason::Other)
        }
        GENERATED_SET_DIFFERENCE_ID
        | GENERATED_SET_UNION_ID
        | GENERATED_SET_SYMMETRICAL_DIFFERENCE_ID => {
            // Set.{difference,union,symmetricalDifference}(other): positionalParams
            // [Capture], calleeEffect Capture, returns a fresh mutable Set.
            legacy(vec![Capture], None, Capture, Mutable, ValueReason::Other)
        }
        GENERATED_SET_IS_SUBSET_OF_ID | GENERATED_SET_IS_SUPERSET_OF_ID => {
            // Set.{isSubsetOf,isSupersetOf}(other): positionalParams [Read],
            // calleeEffect Read, primitive return.
            legacy(vec![Read], None, Read, Primitive, ValueReason::Other)
        }
        GENERATED_SET_FOREACH_ID | GENERATED_MAP_FOREACH_ID => {
            // Set/Map.forEach(cb): restParam ConditionallyMutate, calleeEffect
            // ConditionallyMutate, primitive return, mutableOnlyIfOperandsAreMutable.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(ConditionallyMutate),
                callee_effect: ConditionallyMutate,
                return_value_kind: Primitive,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: true,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        GENERATED_SET_ENTRIES_ID
        | GENERATED_SET_KEYS_ID
        | GENERATED_SET_VALUES_ID
        | GENERATED_MAP_ENTRIES_ID
        | GENERATED_MAP_KEYS_ID
        | GENERATED_MAP_VALUES_ID => {
            // iterator methods (entries/keys/values): calleeEffect Capture, returns
            // a mutable Poly value aliased from the receiver.
            legacy(vec![], None, Capture, Mutable, ValueReason::Other)
        }
        GENERATED_BOOLEAN_ID
        | GENERATED_NUMBER_ID
        | GENERATED_STRING_ID
        | GENERATED_PARSE_INT_ID
        | GENERATED_PARSE_FLOAT_ID
        | GENERATED_IS_NAN_ID
        | GENERATED_IS_FINITE_ID
        | GENERATED_ENCODE_URI_ID
        | GENERATED_ENCODE_URI_COMPONENT_ID
        | GENERATED_DECODE_URI_ID
        | GENERATED_DECODE_URI_COMPONENT_ID => {
            // Boolean / Number / String / parseInt / parseFloat / isNaN / isFinite /
            // encodeURI(Component) / decodeURI(Component): all share the same shape —
            // `restParam: Read`, `calleeEffect: Read`, primitive return. The call
            // result is a non-allocating primitive, so it is never given a reactive
            // scope (no spurious memoization of `String(state)` etc.).
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        GENERATED_MATH_MAX_ID
        | GENERATED_MATH_MIN_ID
        | GENERATED_MATH_TRUNC_ID
        | GENERATED_MATH_CEIL_ID
        | GENERATED_MATH_FLOOR_ID
        | GENERATED_MATH_POW_ID => {
            // `Math.{max,min,trunc,ceil,floor,pow}` (`Globals.ts`): `positionalParams:
            // []`, `restParam: Read`, `calleeEffect: Read`, primitive return. The
            // result is a non-allocating primitive, so `Math.max(a, b)` never gets a
            // reactive scope and its operands are only Read (not mutated).
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        GENERATED_CONSOLE_ERROR_ID
        | GENERATED_CONSOLE_INFO_ID
        | GENERATED_CONSOLE_LOG_ID
        | GENERATED_CONSOLE_TABLE_ID
        | GENERATED_CONSOLE_TRACE_ID
        | GENERATED_CONSOLE_WARN_ID => {
            // `console.{error,info,log,table,trace,warn}` (`Globals.ts`):
            // `restParam: Read`, `calleeEffect: Read`, primitive return. The args are
            // only read (logging does not mutate them).
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        GENERATED_MATH_RANDOM_ID | GENERATED_PERFORMANCE_NOW_ID | GENERATED_DATE_NOW_ID => {
            // `Math.random()` / `performance.now()` / `Date.now()` (`Globals.ts`):
            // no args, `calleeEffect: Read`, `returnType: Poly`,
            // `returnValueKind: Mutable`, `impure: true`. The impure flag keeps the
            // call from being treated as a pure, hoistable/memoizable expression.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Read),
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: true,
                no_alias: false,
                aliasing: None,
            }
        }
        GENERATED_USE_STATE_ID => {
            // useState: restParam Freeze, returns Frozen (reason State)
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::State)
        }
        GENERATED_USE_REF_ID => {
            // useRef: restParam Capture, returns Mutable
            legacy(vec![], Some(Capture), Read, Mutable, ValueReason::Other)
        }
        GENERATED_USE_ACTION_STATE_ID => {
            // useActionState: restParam Freeze, returns Frozen (reason State).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::State)
        }
        GENERATED_USE_REDUCER_ID => {
            // useReducer: restParam Freeze, returns Frozen (reason ReducerState).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::ReducerState)
        }
        GENERATED_USE_OPTIMISTIC_ID => {
            // useOptimistic: restParam Freeze, returns Frozen (reason State).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::State)
        }
        GENERATED_USE_TRANSITION_ID => {
            // useTransition: no rest param, returns Frozen.
            legacy(vec![], None, Read, Frozen, ValueReason::Other)
        }
        BUILTIN_SET_ACTION_STATE_ID | BUILTIN_DISPATCH_ID | BUILTIN_SET_OPTIMISTIC_ID => {
            // The stable setter/dispatcher of useActionState / useReducer /
            // useOptimistic: restParam Freeze, calleeEffect Read, primitive return.
            legacy(vec![], Some(Freeze), Read, Primitive, ValueReason::Other)
        }
        BUILTIN_START_TRANSITION_ID => {
            // startTransition: no rest param, calleeEffect Read, primitive return.
            legacy(vec![], None, Read, Primitive, ValueReason::Other)
        }
        GENERATED_USE_MEMO_ID | GENERATED_USE_CALLBACK_ID => {
            // useMemo / useCallback: restParam Freeze, returns Frozen. (Dead by
            // `InferTypes` after `dropManualMemoization`; pinned for completeness.)
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        DEFAULT_NONMUTATING_HOOK_ID => {
            // The default custom/builtin hook (`useEffect`, `useLayoutEffect`,
            // user hooks, …): freezes its arguments, returns a frozen value that
            // may alias the arguments. Uses the new-style aliasing signature so
            // `InferMutationAliasingEffects` emits the `Freeze`/`Alias` effects.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Frozen,
                return_value_reason: ValueReason::HookReturn,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(default_nonmutating_hook_aliasing_signature()),
            }
        }
        DEFAULT_MUTATING_HOOK_ID => {
            // The mutating-hook fallback (`enableAssumeHooksFollowRulesOfReact`
            // off): conditionally mutates its arguments, returns a mutable value.
            legacy(vec![], Some(ConditionallyMutate), Read, Mutable, ValueReason::Other)
        }
        BUILTIN_SET_STATE_ID => {
            // setState: restParam Freeze, returns Primitive
            legacy(vec![], Some(Freeze), Read, Primitive, ValueReason::Other)
        }
        BUILTIN_USE_CONTEXT_HOOK_ID => {
            // useContext: restParam Read, calleeEffect Read, returns Frozen
            // (reason Context). (Globals.ts `addHook(..., BuiltInUseContextHookId)`.)
            legacy(vec![], Some(Read), Read, Frozen, ValueReason::Context)
        }
        BUILTIN_USE_EFFECT_HOOK_ID => {
            // useEffect: restParam Freeze, calleeEffect Read, returns a frozen
            // (undefined) value. Carries the explicit effect-hook aliasing signature
            // (Globals.ts): freeze the deps, create a frozen effect object that
            // captures the deps, then create an undefined (primitive) return — the
            // return does NOT alias the args (unlike a generic hook).
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Frozen,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(use_effect_aliasing_signature()),
            }
        }
        BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID | BUILTIN_USE_INSERTION_EFFECT_HOOK_ID => {
            // useLayoutEffect / useInsertionEffect: restParam Freeze, calleeEffect
            // Read, returns Frozen (Poly). No explicit aliasing in Globals.ts, so
            // they take the legacy path (freeze args, frozen return).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        GENERATED_USE_IMPERATIVE_HANDLE_ID => {
            // useImperativeHandle: restParam Freeze, calleeEffect Read, returns a
            // frozen primitive.
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        BUILTIN_USE_OPERATOR_ID => {
            // `use`: restParam Freeze, calleeEffect Read, returns Frozen (Poly).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        BUILTIN_USE_EFFECT_EVENT_ID => {
            // useEffectEvent: restParam Freeze, calleeEffect Read, returns Frozen.
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        BUILTIN_EFFECT_EVENT_FUNCTION_ID => {
            // The function returned by useEffectEvent: restParam
            // ConditionallyMutate, calleeEffect ConditionallyMutate, returns Mutable.
            legacy(
                vec![],
                Some(ConditionallyMutate),
                ConditionallyMutate,
                Mutable,
                ValueReason::Other,
            )
        }
        GENERATED_CREATE_ELEMENT_ID | GENERATED_CLONE_ELEMENT_ID => {
            // React.createElement / cloneElement: restParam Freeze, calleeEffect
            // Read, returns Frozen (Poly).
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::Other)
        }
        GENERATED_CREATE_REF_ID => {
            // React.createRef: restParam Capture, calleeEffect Read, returns Mutable.
            legacy(vec![], Some(Capture), Read, Mutable, ValueReason::Other)
        }
        // === shared-runtime module type provider signatures =================
        SHARED_RUNTIME_PRIMITIVE_FN_ID
        | GENERATED_SHARED_RUNTIME_DEFAULT_ID
        | GENERATED_SHARED_RUNTIME_GRAPHQL_ID
        | GENERATED_SHARED_RUNTIME_TYPED_LOG_ID => {
            // `graphql` / `default` / `typedLog` (`makeSharedRuntimeTypeProvider`):
            // `positionalParams: [], restParam: Read, calleeEffect: Read,
            // returnType: Primitive, returnValueKind: Primitive`. A pure read-only
            // call producing a primitive — its result is never memoized.
            legacy(vec![], Some(Read), Read, Primitive, ValueReason::Other)
        }
        SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID | GENERATED_SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID => {
            // `typedArrayPush(arr, value)`: `positionalParams: [Store, Capture],
            // restParam: Capture, calleeEffect: Read, returnType: Primitive,
            // returnValueKind: Primitive`. Stores into the array, captures the
            // pushed value(s) — no `aliasing` config, so the legacy path applies.
            legacy(
                vec![Store, Capture],
                Some(Capture),
                Read,
                Primitive,
                ValueReason::Other,
            )
        }
        GENERATED_SHARED_RUNTIME_TYPED_CAPTURE_ID => {
            // `typedCapture(value)`: `positionalParams: [Read], calleeEffect: Read,
            // returnType: Array, returnValueKind: Mutable`. The `aliasing` config
            // (`Create(@return, Mutable) + Capture(@value -> @return)`) is what
            // produces the precise single `Capture $return <- value` effect instead
            // of the untyped-function `MaybeAlias`/`MutateTransitiveConditionally`
            // fallback — keeping the argument's mutable range from being inflated.
            CallSignature {
                positional_params: vec![Read],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::KnownReturnSignature,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(typed_capture_aliasing_signature()),
            }
        }
        GENERATED_SHARED_RUNTIME_TYPED_CREATE_FROM_ID => {
            // `typedCreateFrom(value)`: `positionalParams: [Read], calleeEffect:
            // Read, returnType: Any, returnValueKind: Mutable`. `aliasing`:
            // `CreateFrom(@value -> @return)`.
            CallSignature {
                positional_params: vec![Read],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::KnownReturnSignature,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(typed_create_from_aliasing_signature()),
            }
        }
        GENERATED_SHARED_RUNTIME_TYPED_MUTATE_ID => {
            // `typedMutate(object, value)`: `positionalParams: [Read, Capture],
            // calleeEffect: Store, returnType: Primitive, returnValueKind:
            // Primitive`. `aliasing`: `Create(@return, Primitive) + Mutate(@object) +
            // Capture(@value -> @object)`.
            CallSignature {
                positional_params: vec![Read, Capture],
                rest_param: None,
                callee_effect: Store,
                return_value_kind: Primitive,
                return_value_reason: ValueReason::KnownReturnSignature,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(typed_mutate_aliasing_signature()),
            }
        }
        GENERATED_SHARED_RUNTIME_TYPED_IDENTITY_ID
        | GENERATED_SHARED_RUNTIME_TYPED_ASSIGN_ID => {
            // `typedIdentity(value)` / `typedAssign(value)`: `positionalParams:
            // [Read], calleeEffect: Read, returnType: Any, returnValueKind: Mutable`.
            // `aliasing`: `Assign(@value -> @return)` — the return is the argument.
            CallSignature {
                positional_params: vec![Read],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::KnownReturnSignature,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(typed_identity_aliasing_signature()),
            }
        }
        GENERATED_SHARED_RUNTIME_TYPED_ALIAS_ID => {
            // `typedAlias(value)`: `positionalParams: [Read], calleeEffect: Read,
            // returnType: Any, returnValueKind: Mutable`. `aliasing`: `Create(@return,
            // Mutable) + Alias(@value -> @return)`.
            CallSignature {
                positional_params: vec![Read],
                rest_param: None,
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::KnownReturnSignature,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: false,
                aliasing: Some(typed_alias_aliasing_signature()),
            }
        }
        GENERATED_USE_FREEZE_ID => {
            // `useFreeze` (`makeSharedRuntimeTypeProvider`): a hook with
            // `restParam: Freeze`, `calleeEffect: Read`, `returnType: Poly`,
            // `returnValueKind: Frozen` (the `addHook` default), no `noAlias`. The
            // typed shared-runtime hooks carry *no* `aliasing` config (unlike the
            // built-in `DefaultNonmutatingHook`), so they take the legacy effect
            // path: freeze the rest args, create a frozen return that captures only
            // the (frozen) callee.
            legacy(vec![], Some(Freeze), Read, Frozen, ValueReason::HookReturn)
        }
        GENERATED_USE_FRAGMENT_ID => {
            // `useFragment` (`makeSharedRuntimeTypeProvider`): a hook with
            // `restParam: Freeze`, `calleeEffect: Read`, `returnType: MixedReadonly`,
            // `returnValueKind: Frozen`, `noAlias: true`. Legacy path (no aliasing
            // config); `noAlias` keeps the call's args from escaping into a reactive
            // scope (`PruneNonEscapingScopes`).
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Frozen,
                return_value_reason: ValueReason::HookReturn,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        GENERATED_USE_NO_ALIAS_ID => {
            // `useNoAlias` (`makeSharedRuntimeTypeProvider`): a hook with
            // `restParam: Freeze`, `calleeEffect: Read`, `returnType: Poly`,
            // `returnValueKind: Mutable`, `noAlias: true`. Freezes its args (a hook)
            // but returns a *mutable* value; `noAlias` keeps the args from escaping
            // into the result's reactive scope. Legacy path (no aliasing config).
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::HookReturn,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        // === react-native-reanimated module type provider signatures ===========
        GENERATED_REANIMATED_FROZEN_HOOK_ID => {
            // `useFrameCallback`/`useAnimatedStyle`/`useAnimatedProps`/
            // `useAnimatedScrollHandler`/`useAnimatedReaction`/`useWorkletCallback`
            // (`getReanimatedModuleType` frozen hooks): `positionalParams: [],
            // restParam: Freeze, calleeEffect: Read, returnType: Poly,
            // returnValueKind: Frozen, noAlias: true, hookKind: Custom`. Freezing the
            // rest args is what keeps an inline animation callback from escaping into
            // a reactive scope (it does not close over a mutated value once frozen),
            // so `useAnimatedProps(() => …)` needs no memoization of its argument.
            // Legacy path (no aliasing config), like the shared-runtime hooks.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Frozen,
                return_value_reason: ValueReason::HookReturn,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        GENERATED_REANIMATED_MUTABLE_HOOK_ID => {
            // `useSharedValue`/`useDerivedValue` (`getReanimatedModuleType` mutable
            // hooks): `restParam: Freeze, calleeEffect: Read, returnType:
            // Object<ReanimatedSharedValueId>, returnValueKind: Mutable, noAlias:
            // true, hookKind: Custom`. Returns a mutable shared-value object;
            // `noAlias` keeps the args from escaping into the result's range.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Freeze),
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::HookReturn,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        GENERATED_REANIMATED_FN_ID => {
            // `withTiming`/`withSpring`/`createAnimatedPropAdapter`/`withDecay`/
            // `withRepeat`/`runOnUI`/`executeOnUIRuntimeSync`
            // (`getReanimatedModuleType` functions, via `addFunction`):
            // `positionalParams: [], restParam: Read, calleeEffect: Read, returnType:
            // Poly, returnValueKind: Mutable, noAlias: true`. Not a hook. Legacy path.
            CallSignature {
                positional_params: vec![],
                rest_param: Some(Read),
                callee_effect: Read,
                return_value_kind: Mutable,
                return_value_reason: ValueReason::Other,
                mutable_only_if_operands_are_mutable: false,
                impure: false,
                no_alias: true,
                aliasing: None,
            }
        }
        _ => return None,
    };
    Some(sig)
}

/// The `DefaultNonmutatingHook` aliasing signature (`ObjectShape.ts`): freeze the
/// rest args (`HookCaptured`), create a frozen return (`HookReturn`), and alias
/// the rest args into the return.
fn default_nonmutating_hook_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 0,
        has_rest: true,
        temporaries: 0,
        effects: vec![
            SigEffect::Freeze {
                value: SigPlace::Rest,
                reason: ValueReason::HookCaptured,
            },
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Frozen,
                reason: ValueReason::HookReturn,
            },
            SigEffect::Alias {
                from: SigPlace::Rest,
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The `useEffect` aliasing signature (`Globals.ts`): freeze the deps (`@rest`),
/// create a frozen effect object (`@effect` temporary) that captures the deps, and
/// return undefined (a primitive). Unlike the generic hook signature, the return
/// does NOT alias the args — so an effect call never extends the deps' mutable
/// range into the (unused) result.
fn use_effect_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 0,
        has_rest: true,
        temporaries: 1,
        effects: vec![
            // Freezes the function and deps.
            SigEffect::Freeze {
                value: SigPlace::Rest,
                reason: ValueReason::Effect,
            },
            // Internally creates a frozen effect object capturing the fn and deps.
            SigEffect::Create {
                into: SigPlace::Temporary(0),
                value: ValueKind::Frozen,
                reason: ValueReason::KnownReturnSignature,
            },
            // The effect stores the function and dependencies.
            SigEffect::Capture {
                from: SigPlace::Rest,
                into: SigPlace::Temporary(0),
            },
            // Returns undefined.
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Primitive,
                reason: ValueReason::KnownReturnSignature,
            },
        ],
    }
}

/// The `typedCapture(value)` aliasing signature (`makeSharedRuntimeTypeProvider`):
/// `params: [@value]`, effects `Create(@return, Mutable, KnownReturnSignature)` then
/// `Capture(@value -> @return)`. A clean single `Capture` from the (single
/// positional) argument into the freshly-created mutable return — *not* the
/// untyped-function `MaybeAlias` + `MutateTransitiveConditionally` fallback. This is
/// what lets `InferMutationAliasingRanges` keep the captured value's mutable range
/// confined to the `useMemo` callback scope rather than inflating an earlier frozen
/// value's range (the `transitivity-*` regression).
fn typed_capture_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Mutable,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::Capture {
                from: SigPlace::Param(0),
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The `typedCreateFrom(value)` aliasing signature
/// (`makeSharedRuntimeTypeProvider`): `params: [@value]`, single effect
/// `CreateFrom(@value -> @return)`. The return is created *from* the argument
/// (a transitive-mutation source that does not extend the argument's own range
/// the way a plain `Capture` would).
fn typed_create_from_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![SigEffect::CreateFrom {
            from: SigPlace::Param(0),
            into: SigPlace::Returns,
        }],
    }
}

/// The `typedMutate(object, value)` aliasing signature
/// (`makeSharedRuntimeTypeProvider`): `params: [@object, @value]`, effects
/// `Create(@return, Primitive, KnownReturnSignature)`, `Mutate(@object)`,
/// `Capture(@value -> @object)`. Mutates the first argument and captures the second
/// into it, returning a primitive.
fn typed_mutate_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 2,
        has_rest: false,
        temporaries: 0,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Primitive,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::Mutate(SigPlace::Param(0)),
            SigEffect::Capture {
                from: SigPlace::Param(1),
                into: SigPlace::Param(0),
            },
        ],
    }
}

/// The `typedIdentity(value)` / `typedAssign(value)` aliasing signature
/// (`makeSharedRuntimeTypeProvider`): `params: [@value]`, single effect
/// `Assign(@value -> @return)` — the return *is* the argument (identity / direct
/// assignment), so it shares the argument's identity and mutable range without a
/// fresh `Create`.
fn typed_identity_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![SigEffect::Assign {
            from: SigPlace::Param(0),
            into: SigPlace::Returns,
        }],
    }
}

/// The `typedAlias(value)` aliasing signature (`makeSharedRuntimeTypeProvider`):
/// `params: [@value]`, effects `Create(@return, Mutable, KnownReturnSignature)` then
/// `Alias(@value -> @return)`. Creates a fresh mutable return that aliases the
/// argument (mutating the return mutates the argument).
fn typed_alias_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Mutable,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::Alias {
                from: SigPlace::Param(0),
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The `push` aliasing signature: `Mutate(receiver)`, `Capture(rest -> receiver)`,
/// `Create(returns, Primitive, KnownReturnSignature)`.
fn push_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 0,
        has_rest: true,
        temporaries: 0,
        effects: vec![
            SigEffect::Mutate(SigPlace::Receiver),
            SigEffect::Capture {
                from: SigPlace::Rest,
                into: SigPlace::Receiver,
            },
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Primitive,
                reason: ValueReason::KnownReturnSignature,
            },
        ],
    }
}

/// The `Object.keys` aliasing signature (`Globals.ts`): create the mutable array
/// return, then *immutable-capture* the object (`@param0`) into it. Only the keys
/// are captured and keys are immutable, so the object's mutable range is not
/// extended — a read-only `Object.keys(obj)` does not pull `obj` into a scope.
fn object_keys_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Mutable,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::ImmutableCapture {
                from: SigPlace::Param(0),
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The `Object.entries` / `Object.values` aliasing signature (`Globals.ts`):
/// create the mutable array return, then *capture* the object's values
/// (`@param0`) into it. The object values are captured (so the return aliases the
/// object), but the object itself is not mutated.
fn object_values_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 0,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Mutable,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::Capture {
                from: SigPlace::Param(0),
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The `Set.add` aliasing signature (`ObjectShape.ts`): the call returns the
/// receiver set, mutates it, and *captures* the added value into the set. Crucially
/// the value is only **captured** (not transitively mutated), so it keeps its own
/// reactive scope rather than being merged into the set's mutable range.
fn set_add_aliasing_signature() -> AliasingSignature {
    AliasingSignature {
        params: 0,
        has_rest: true,
        temporaries: 0,
        effects: vec![
            // Set.add returns the receiver Set.
            SigEffect::Assign {
                from: SigPlace::Receiver,
                into: SigPlace::Returns,
            },
            // Set.add mutates the set itself.
            SigEffect::Mutate(SigPlace::Receiver),
            // Captures the value(s) into the set.
            SigEffect::Capture {
                from: SigPlace::Rest,
                into: SigPlace::Receiver,
            },
        ],
    }
}

/// The `map` aliasing signature: creates a new array, extracts items, calls the
/// callback, captures the result.
fn map_aliasing_signature() -> AliasingSignature {
    // temporaries: 0 = @item, 1 = @callbackReturn, 2 = @thisArg
    AliasingSignature {
        params: 1,
        has_rest: false,
        temporaries: 3,
        effects: vec![
            SigEffect::Create {
                into: SigPlace::Returns,
                value: ValueKind::Mutable,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::CreateFrom {
                from: SigPlace::Receiver,
                into: SigPlace::Temporary(0),
            },
            SigEffect::Create {
                into: SigPlace::Temporary(2),
                value: ValueKind::Primitive,
                reason: ValueReason::KnownReturnSignature,
            },
            SigEffect::Apply {
                receiver: SigPlace::Temporary(2),
                function: SigPlace::Param(0),
                args: vec![Some(SigPlace::Temporary(0)), None, Some(SigPlace::Receiver)],
                into: SigPlace::Temporary(1),
                mutates_function: false,
            },
            SigEffect::Capture {
                from: SigPlace::Temporary(1),
                into: SigPlace::Returns,
            },
        ],
    }
}

/// The shape of a JavaScript object/function value (`ObjectShape.ts::ObjectShape`):
/// its named property types plus an optional call signature when the value is
/// itself callable.
///
/// Properties preserve insertion order (the TS uses an ordered `Map`); lookups
/// honor the `*` wildcard entry as a fallback, matching `getPropertyType`.
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectShape {
    /// Named property types, in insertion order.
    pub properties: Vec<(String, Type)>,
    /// The call signature if this shape is callable, else `None`.
    pub function_type: Option<FunctionSignature>,
}

impl ObjectShape {
    /// A non-callable object with the given ordered properties.
    fn object(properties: Vec<(String, Type)>) -> Self {
        ObjectShape {
            properties,
            function_type: None,
        }
    }

    /// Look up a property by exact name, falling back to the `*` wildcard entry
    /// (`getPropertyType` semantics). Returns `None` if neither is present.
    pub fn property_type(&self, name: &str) -> Option<&Type> {
        self.properties
            .iter()
            .find(|(k, _)| k == name)
            .or_else(|| self.properties.iter().find(|(k, _)| k == "*"))
            .map(|(_, t)| t)
    }
}

/// A registry of object shapes keyed by shape id (`ObjectShape.ts::ShapeRegistry`).
pub type ShapeRegistry = BTreeMap<String, ObjectShape>;

/// A registry mapping a global name to the [`Type`] it resolves to
/// (`Globals.ts::GlobalRegistry`).
pub type GlobalRegistry = BTreeMap<String, Type>;

/// Build a [`Type::Object`] with the given shape id.
fn object_type(shape_id: &str) -> Type {
    Type::Object {
        shape_id: Some(shape_id.to_string()),
    }
}

/// Build a (non-constructor) [`Type::Function`] with the given shape id and
/// return type.
fn function_type(shape_id: &str, return_type: Type) -> Type {
    Type::Function {
        shape_id: Some(shape_id.to_string()),
        return_type: Box::new(return_type),
        is_constructor: false,
    }
}

/// Build a constructor [`Type::Function`] (`new`-callable) with the given shape
/// id and return type — used for the `Map`/`Set`/`WeakMap`/`WeakSet` globals
/// (`Globals.ts` registers them with `isConstructor=true`).
fn constructor_function_type(shape_id: &str, return_type: Type) -> Type {
    Type::Function {
        shape_id: Some(shape_id.to_string()),
        return_type: Box::new(return_type),
        is_constructor: true,
    }
}

/// Build a (non-constructor) [`Type::Function`] whose shape id is the anonymous
/// `<generated_N>` id `ObjectShape.ts::addFunction` mints for it.
///
/// `createAnonId()` advances a module-wide counter on every anonymous
/// `addFunction`/`addObject`/`addHook` during `BUILTIN_SHAPES` construction. The
/// builtin-array methods are the *first* anonymous functions registered, so they
/// take ids `<generated_0>` (`indexOf`) through `<generated_14>` (`join`) in
/// declaration order — verified against the oracle. The fixtures only print the
/// `pop`/`push`/`join` ids, but every array method is given its true generated
/// id here for fidelity.
fn generated_function_type(n: u32, return_type: Type) -> Type {
    Type::Function {
        shape_id: Some(format!("<generated_{n}>")),
        return_type: Box::new(return_type),
        is_constructor: false,
    }
}

/// The default built-in [`ShapeRegistry`] (`ObjectShape.ts::BUILTIN_SHAPES`),
/// reduced to the shapes the stage-2 fixtures reach during type inference.
///
/// Note: this returns a freshly-built registry on each call. Callers that need a
/// shared instance should construct it once and reuse it.
pub fn builtin_shapes() -> ShapeRegistry {
    let mut shapes = ShapeRegistry::new();

    // If the `ref` prop exists, it has the ref type.
    shapes.insert(
        BUILTIN_PROPS_ID.to_string(),
        ObjectShape::object(vec![("ref".to_string(), object_type(BUILTIN_USE_REF_ID))]),
    );

    // Built-in array shape. Only the `return` types are printed, so effects /
    // value-kinds / aliasing from the TS signatures are dropped. Each method's
    // function shape carries the `<generated_N>` id `addFunction` mints in
    // declaration order (indexOf=0 .. join=14).
    shapes.insert(
        BUILTIN_ARRAY_ID.to_string(),
        ObjectShape::object(vec![
            ("indexOf".to_string(), generated_function_type(0, Type::Primitive)),
            ("includes".to_string(), generated_function_type(1, Type::Primitive)),
            ("pop".to_string(), generated_function_type(2, Type::Poly)),
            ("at".to_string(), generated_function_type(3, Type::Poly)),
            ("concat".to_string(), generated_function_type(4, object_type(BUILTIN_ARRAY_ID))),
            ("length".to_string(), Type::Primitive),
            ("push".to_string(), generated_function_type(5, Type::Primitive)),
            ("slice".to_string(), generated_function_type(6, object_type(BUILTIN_ARRAY_ID))),
            ("map".to_string(), generated_function_type(7, object_type(BUILTIN_ARRAY_ID))),
            ("flatMap".to_string(), generated_function_type(8, object_type(BUILTIN_ARRAY_ID))),
            ("filter".to_string(), generated_function_type(9, object_type(BUILTIN_ARRAY_ID))),
            ("every".to_string(), generated_function_type(10, Type::Primitive)),
            ("some".to_string(), generated_function_type(11, Type::Primitive)),
            ("find".to_string(), generated_function_type(12, Type::Poly)),
            ("findIndex".to_string(), generated_function_type(13, Type::Primitive)),
            ("join".to_string(), generated_function_type(14, Type::Primitive)),
        ]),
    );

    // Built-in "mixed readonly" shape (`ObjectShape.ts` `BuiltInMixedReadonly`):
    // the frozen value `useFragment` returns. Each property access (`*` wildcard)
    // resolves to another `MixedReadonly`; the array-iteration methods carry their
    // own `<generated_45..58>` ids (declaration order toString=45 .. join=58, right
    // after the `WeakMap` shape). `map`/`flatMap`/`filter`/`concat`/`slice` return
    // `BuiltInArray`; `find`/`at` return `MixedReadonly`; the rest return primitives.
    shapes.insert(
        BUILTIN_MIXED_READONLY_ID.to_string(),
        ObjectShape::object(vec![
            (
                "toString".to_string(),
                function_type(GENERATED_MIXED_READONLY_TO_STRING_ID, Type::Primitive),
            ),
            (
                "indexOf".to_string(),
                function_type(GENERATED_MIXED_READONLY_INDEX_OF_ID, Type::Primitive),
            ),
            (
                "includes".to_string(),
                function_type(GENERATED_MIXED_READONLY_INCLUDES_ID, Type::Primitive),
            ),
            (
                "at".to_string(),
                function_type(
                    GENERATED_MIXED_READONLY_AT_ID,
                    object_type(BUILTIN_MIXED_READONLY_ID),
                ),
            ),
            (
                "map".to_string(),
                function_type(GENERATED_MIXED_READONLY_MAP_ID, object_type(BUILTIN_ARRAY_ID)),
            ),
            (
                "flatMap".to_string(),
                function_type(
                    GENERATED_MIXED_READONLY_FLAT_MAP_ID,
                    object_type(BUILTIN_ARRAY_ID),
                ),
            ),
            (
                "filter".to_string(),
                function_type(
                    GENERATED_MIXED_READONLY_FILTER_ID,
                    object_type(BUILTIN_ARRAY_ID),
                ),
            ),
            (
                "concat".to_string(),
                function_type(
                    GENERATED_MIXED_READONLY_CONCAT_ID,
                    object_type(BUILTIN_ARRAY_ID),
                ),
            ),
            (
                "slice".to_string(),
                function_type(GENERATED_MIXED_READONLY_SLICE_ID, object_type(BUILTIN_ARRAY_ID)),
            ),
            (
                "every".to_string(),
                function_type(GENERATED_MIXED_READONLY_EVERY_ID, Type::Primitive),
            ),
            (
                "some".to_string(),
                function_type(GENERATED_MIXED_READONLY_SOME_ID, Type::Primitive),
            ),
            (
                "find".to_string(),
                function_type(
                    GENERATED_MIXED_READONLY_FIND_ID,
                    object_type(BUILTIN_MIXED_READONLY_ID),
                ),
            ),
            (
                "findIndex".to_string(),
                function_type(GENERATED_MIXED_READONLY_FIND_INDEX_ID, Type::Primitive),
            ),
            (
                "join".to_string(),
                function_type(GENERATED_MIXED_READONLY_JOIN_ID, Type::Primitive),
            ),
            // Any other property access yields another `MixedReadonly` value.
            ("*".to_string(), object_type(BUILTIN_MIXED_READONLY_ID)),
        ]),
    );

    // Built-in plain-object shape. `toString` is an anonymous `addFunction` in
    // `ObjectShape.ts`, so it takes the `<generated_15>` slot (right after the 15
    // array methods), *not* the `BuiltInFunction` shape id.
    shapes.insert(
        BUILTIN_OBJECT_ID.to_string(),
        ObjectShape::object(vec![(
            "toString".to_string(),
            function_type(GENERATED_OBJECT_TO_STRING_ID, Type::Primitive),
        )]),
    );

    // `useState` return tuple: `[state: Poly, setState: SetState]`.
    shapes.insert(
        BUILTIN_USE_STATE_ID.to_string(),
        ObjectShape::object(vec![
            ("0".to_string(), Type::Poly),
            (
                "1".to_string(),
                function_type(BUILTIN_SET_STATE_ID, Type::Primitive),
            ),
        ]),
    );

    // `setState` updater function: returns a primitive (undefined).
    shapes.insert(
        BUILTIN_SET_STATE_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Primitive,
                is_constructor: false,
            }),
        },
    );

    // `useRef` return `{current: RefValue}`.
    shapes.insert(
        BUILTIN_USE_REF_ID.to_string(),
        ObjectShape::object(vec![(
            "current".to_string(),
            object_type(BUILTIN_REF_VALUE_ID),
        )]),
    );

    // Ref value: self-recursive wildcard (`.current.anything` stays a RefValue).
    shapes.insert(
        BUILTIN_REF_VALUE_ID.to_string(),
        ObjectShape::object(vec![("*".to_string(), object_type(BUILTIN_REF_VALUE_ID))]),
    );

    // The stable-container hook return tuples. Each is `[value, setter]` where the
    // setter is a known-stable, identity-preserving function (its shape id is what
    // `isStableType` keys on so the destructured setter/dispatcher is treated as
    // non-reactive and never becomes a memoization dependency). Mirrors the
    // `addObject(BUILTIN_SHAPES, BuiltIn*Id, [...])` entries in `ObjectShape.ts`.
    //
    // `useActionState`: `[state: Poly, setActionState: SetActionState]`.
    shapes.insert(
        BUILTIN_USE_ACTION_STATE_ID.to_string(),
        ObjectShape::object(vec![
            ("0".to_string(), Type::Poly),
            (
                "1".to_string(),
                function_type(BUILTIN_SET_ACTION_STATE_ID, Type::Primitive),
            ),
        ]),
    );
    // `useReducer`: `[state: Poly, dispatch: Dispatch]`.
    shapes.insert(
        BUILTIN_USE_REDUCER_ID.to_string(),
        ObjectShape::object(vec![
            ("0".to_string(), Type::Poly),
            (
                "1".to_string(),
                function_type(BUILTIN_DISPATCH_ID, Type::Primitive),
            ),
        ]),
    );
    // `useTransition`: `[isPending: Primitive, startTransition: StartTransition]`.
    shapes.insert(
        BUILTIN_USE_TRANSITION_ID.to_string(),
        ObjectShape::object(vec![
            ("0".to_string(), Type::Primitive),
            (
                "1".to_string(),
                function_type(BUILTIN_START_TRANSITION_ID, Type::Primitive),
            ),
        ]),
    );
    // `useOptimistic`: `[value: Poly, setOptimistic: SetOptimistic]`.
    shapes.insert(
        BUILTIN_USE_OPTIMISTIC_ID.to_string(),
        ObjectShape::object(vec![
            ("0".to_string(), Type::Poly),
            (
                "1".to_string(),
                function_type(BUILTIN_SET_OPTIMISTIC_ID, Type::Primitive),
            ),
        ]),
    );
    // The stable setter/dispatcher function shapes (all return a primitive).
    let primitive_returning_fn = ObjectShape {
        properties: Vec::new(),
        function_type: Some(FunctionSignature {
            return_type: Type::Primitive,
            is_constructor: false,
        }),
    };
    shapes.insert(
        BUILTIN_SET_ACTION_STATE_ID.to_string(),
        primitive_returning_fn.clone(),
    );
    shapes.insert(BUILTIN_DISPATCH_ID.to_string(), primitive_returning_fn.clone());
    shapes.insert(
        BUILTIN_START_TRANSITION_ID.to_string(),
        primitive_returning_fn.clone(),
    );
    shapes.insert(
        BUILTIN_SET_OPTIMISTIC_ID.to_string(),
        primitive_returning_fn,
    );

    // The remaining React-hook function shapes that are accessed as members of the
    // `React` namespace object (`React.useEffect`, `React.useContext`, …). Each is
    // a callable `Function` whose `returnType` matches its `addHook` declaration in
    // `Globals.ts`; the call effects/aliasing live in `call_signature_for_shape`.
    // `useContext`/`useLayoutEffect`/`useInsertionEffect` return `Poly`,
    // `useEffect` returns a primitive (undefined), `useEffectEvent` returns the
    // effect-event function, `use` returns `Poly`.
    let poly_returning_fn = ObjectShape {
        properties: Vec::new(),
        function_type: Some(FunctionSignature {
            return_type: Type::Poly,
            is_constructor: false,
        }),
    };
    shapes.insert(
        BUILTIN_USE_CONTEXT_HOOK_ID.to_string(),
        poly_returning_fn.clone(),
    );
    shapes.insert(
        BUILTIN_USE_EFFECT_HOOK_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Primitive,
                is_constructor: false,
            }),
        },
    );
    shapes.insert(
        BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID.to_string(),
        poly_returning_fn.clone(),
    );
    shapes.insert(
        BUILTIN_USE_INSERTION_EFFECT_HOOK_ID.to_string(),
        poly_returning_fn.clone(),
    );
    shapes.insert(
        BUILTIN_USE_OPERATOR_ID.to_string(),
        poly_returning_fn,
    );
    // `useEffectEvent` returns a function whose shape id is
    // `BuiltInEffectEventFunction` (a callable `Function` returning `Poly`).
    shapes.insert(
        BUILTIN_USE_EFFECT_EVENT_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: function_type(BUILTIN_EFFECT_EVENT_FUNCTION_ID, Type::Poly),
                is_constructor: false,
            }),
        },
    );
    shapes.insert(
        BUILTIN_EFFECT_EVENT_FUNCTION_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Poly,
                is_constructor: false,
            }),
        },
    );

    // The `React` namespace object (`Globals.ts`'s `addObject(DEFAULT_SHAPES, null,
    // [...REACT_APIS, createElement, cloneElement, createRef])`). Registering this
    // shape is what makes `React.useState` / `React.useReducer` / … resolve to the
    // *typed* hook shape (so the destructured setter is `BuiltInSetState` and is
    // recognized as stable) instead of falling through to the generic custom-hook
    // type. Each member's `function_type` shape id matches the oracle's `InferTypes`
    // printout verbatim (verified via `React.<member>` PropertyLoad types).
    shapes.insert(
        GENERATED_REACT_ID.to_string(),
        ObjectShape::object(vec![
            (
                "useContext".to_string(),
                function_type(BUILTIN_USE_CONTEXT_HOOK_ID, Type::Poly),
            ),
            (
                "useState".to_string(),
                function_type(GENERATED_USE_STATE_ID, object_type(BUILTIN_USE_STATE_ID)),
            ),
            (
                "useActionState".to_string(),
                function_type(
                    GENERATED_USE_ACTION_STATE_ID,
                    object_type(BUILTIN_USE_ACTION_STATE_ID),
                ),
            ),
            (
                "useReducer".to_string(),
                function_type(GENERATED_USE_REDUCER_ID, object_type(BUILTIN_USE_REDUCER_ID)),
            ),
            (
                "useRef".to_string(),
                function_type(GENERATED_USE_REF_ID, object_type(BUILTIN_USE_REF_ID)),
            ),
            (
                "useImperativeHandle".to_string(),
                function_type(GENERATED_USE_IMPERATIVE_HANDLE_ID, Type::Primitive),
            ),
            (
                "useMemo".to_string(),
                function_type(GENERATED_USE_MEMO_ID, Type::Poly),
            ),
            (
                "useCallback".to_string(),
                function_type(GENERATED_USE_CALLBACK_ID, Type::Poly),
            ),
            (
                "useEffect".to_string(),
                function_type(BUILTIN_USE_EFFECT_HOOK_ID, Type::Primitive),
            ),
            (
                "useLayoutEffect".to_string(),
                function_type(BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID, Type::Poly),
            ),
            (
                "useInsertionEffect".to_string(),
                function_type(BUILTIN_USE_INSERTION_EFFECT_HOOK_ID, Type::Poly),
            ),
            (
                "useTransition".to_string(),
                function_type(
                    GENERATED_USE_TRANSITION_ID,
                    object_type(BUILTIN_USE_TRANSITION_ID),
                ),
            ),
            (
                "useOptimistic".to_string(),
                function_type(
                    GENERATED_USE_OPTIMISTIC_ID,
                    object_type(BUILTIN_USE_OPTIMISTIC_ID),
                ),
            ),
            (
                "use".to_string(),
                function_type(BUILTIN_USE_OPERATOR_ID, Type::Poly),
            ),
            (
                "useEffectEvent".to_string(),
                function_type(
                    BUILTIN_USE_EFFECT_EVENT_ID,
                    function_type(BUILTIN_EFFECT_EVENT_FUNCTION_ID, Type::Poly),
                ),
            ),
            (
                "createElement".to_string(),
                function_type(GENERATED_CREATE_ELEMENT_ID, Type::Poly),
            ),
            (
                "cloneElement".to_string(),
                function_type(GENERATED_CLONE_ELEMENT_ID, Type::Poly),
            ),
            (
                "createRef".to_string(),
                function_type(GENERATED_CREATE_REF_ID, object_type(BUILTIN_USE_REF_ID)),
            ),
        ]),
    );

    // The collection shapes (`addObject(BUILTIN_SHAPES, BuiltIn{Set,Map,WeakSet,
    // WeakMap}Id, …)` in `ObjectShape.ts`). Only the method `return` types are
    // printed by `InferTypes`; the effect signatures (incl. `Set.add` /
    // `Map.set`'s receiver-capturing aliasing) live in `call_signature_for_shape`.
    shapes.insert(
        BUILTIN_SET_ID.to_string(),
        ObjectShape::object(vec![
            ("add".to_string(), function_type(GENERATED_SET_ADD_ID, object_type(BUILTIN_SET_ID))),
            ("clear".to_string(), function_type(GENERATED_SET_CLEAR_ID, Type::Primitive)),
            ("delete".to_string(), function_type(GENERATED_SET_DELETE_ID, Type::Primitive)),
            ("has".to_string(), function_type(GENERATED_SET_HAS_ID, Type::Primitive)),
            ("size".to_string(), Type::Primitive),
            ("difference".to_string(), function_type(GENERATED_SET_DIFFERENCE_ID, object_type(BUILTIN_SET_ID))),
            ("union".to_string(), function_type(GENERATED_SET_UNION_ID, object_type(BUILTIN_SET_ID))),
            ("symmetricalDifference".to_string(), function_type(GENERATED_SET_SYMMETRICAL_DIFFERENCE_ID, object_type(BUILTIN_SET_ID))),
            ("isSubsetOf".to_string(), function_type(GENERATED_SET_IS_SUBSET_OF_ID, Type::Primitive)),
            ("isSupersetOf".to_string(), function_type(GENERATED_SET_IS_SUPERSET_OF_ID, Type::Primitive)),
            ("forEach".to_string(), function_type(GENERATED_SET_FOREACH_ID, Type::Primitive)),
            ("entries".to_string(), function_type(GENERATED_SET_ENTRIES_ID, Type::Poly)),
            ("keys".to_string(), function_type(GENERATED_SET_KEYS_ID, Type::Poly)),
            ("values".to_string(), function_type(GENERATED_SET_VALUES_ID, Type::Poly)),
        ]),
    );
    shapes.insert(
        BUILTIN_MAP_ID.to_string(),
        ObjectShape::object(vec![
            ("clear".to_string(), function_type(GENERATED_MAP_CLEAR_ID, Type::Primitive)),
            ("delete".to_string(), function_type(GENERATED_MAP_DELETE_ID, Type::Primitive)),
            ("get".to_string(), function_type(GENERATED_MAP_GET_ID, Type::Poly)),
            ("has".to_string(), function_type(GENERATED_MAP_HAS_ID, Type::Primitive)),
            ("set".to_string(), function_type(GENERATED_MAP_SET_ID, object_type(BUILTIN_MAP_ID))),
            ("size".to_string(), Type::Primitive),
            ("forEach".to_string(), function_type(GENERATED_MAP_FOREACH_ID, Type::Primitive)),
            ("entries".to_string(), function_type(GENERATED_MAP_ENTRIES_ID, Type::Poly)),
            ("keys".to_string(), function_type(GENERATED_MAP_KEYS_ID, Type::Poly)),
            ("values".to_string(), function_type(GENERATED_MAP_VALUES_ID, Type::Poly)),
        ]),
    );
    shapes.insert(
        BUILTIN_WEAKSET_ID.to_string(),
        ObjectShape::object(vec![
            ("add".to_string(), function_type(GENERATED_WEAKSET_ADD_ID, object_type(BUILTIN_WEAKSET_ID))),
            ("delete".to_string(), function_type(GENERATED_WEAKSET_DELETE_ID, Type::Primitive)),
            ("has".to_string(), function_type(GENERATED_WEAKSET_HAS_ID, Type::Primitive)),
        ]),
    );
    shapes.insert(
        BUILTIN_WEAKMAP_ID.to_string(),
        ObjectShape::object(vec![
            ("delete".to_string(), function_type(GENERATED_WEAKMAP_DELETE_ID, Type::Primitive)),
            ("get".to_string(), function_type(GENERATED_WEAKMAP_GET_ID, Type::Poly)),
            ("has".to_string(), function_type(GENERATED_WEAKMAP_HAS_ID, Type::Primitive)),
            ("set".to_string(), function_type(GENERATED_WEAKMAP_SET_ID, object_type(BUILTIN_WEAKMAP_ID))),
        ]),
    );

    // The global `Object` constructor's static methods. Each is an anonymous
    // `addFunction` in `Globals.ts`, so it carries the `<generated_N>` id its
    // registration mints — pinned here verbatim against the oracle (the source
    // order keys/fromEntries/entries/keys/values means the ids are not in
    // property order, and the duplicate `keys` overwrites the first slot).
    shapes.insert(
        "Object".to_string(),
        ObjectShape::object(vec![
            ("keys".to_string(), function_type(GENERATED_OBJECT_KEYS_ID, object_type(BUILTIN_ARRAY_ID))),
            ("values".to_string(), function_type(GENERATED_OBJECT_VALUES_ID, object_type(BUILTIN_ARRAY_ID))),
            ("entries".to_string(), function_type(GENERATED_OBJECT_ENTRIES_ID, object_type(BUILTIN_ARRAY_ID))),
            ("fromEntries".to_string(), function_type(GENERATED_OBJECT_FROM_ENTRIES_ID, object_type(BUILTIN_OBJECT_ID))),
        ]),
    );

    // The global `Array` constructor's static methods (`Globals.ts`'s
    // `addObject(DEFAULT_SHAPES, 'Array', [...])`): `isArray` returns a primitive,
    // `from`/`of` return a fresh `BuiltInArray`. The function shape ids are the
    // anonymous slots `<generated_64>`/`65`/`66` (pinned against the oracle).
    shapes.insert(
        "Array".to_string(),
        ObjectShape::object(vec![
            ("isArray".to_string(), function_type(GENERATED_ARRAY_IS_ARRAY_ID, Type::Primitive)),
            ("from".to_string(), function_type(GENERATED_ARRAY_FROM_ID, object_type(BUILTIN_ARRAY_ID))),
            ("of".to_string(), function_type(GENERATED_ARRAY_OF_ID, object_type(BUILTIN_ARRAY_ID))),
        ]),
    );

    // The `Math` global object (`Globals.ts`'s `addObject(DEFAULT_SHAPES, 'Math',
    // [...])`): a static `PI` primitive property plus the static methods
    // `max`/`min`/`trunc`/`ceil`/`floor`/`pow` (primitive returns) and `random`
    // (Poly, impure). The method function-shape ids are the anonymous slots
    // `<generated_69..75>` (pinned against the oracle).
    shapes.insert(
        "Math".to_string(),
        ObjectShape::object(vec![
            ("PI".to_string(), Type::Primitive),
            ("max".to_string(), function_type(GENERATED_MATH_MAX_ID, Type::Primitive)),
            ("min".to_string(), function_type(GENERATED_MATH_MIN_ID, Type::Primitive)),
            ("trunc".to_string(), function_type(GENERATED_MATH_TRUNC_ID, Type::Primitive)),
            ("ceil".to_string(), function_type(GENERATED_MATH_CEIL_ID, Type::Primitive)),
            ("floor".to_string(), function_type(GENERATED_MATH_FLOOR_ID, Type::Primitive)),
            ("pow".to_string(), function_type(GENERATED_MATH_POW_ID, Type::Primitive)),
            ("random".to_string(), function_type(GENERATED_MATH_RANDOM_ID, Type::Poly)),
        ]),
    );

    // The `performance` / `Date` global objects (`Globals.ts`): each has a single
    // static `now()` method returning a Poly impure value. Ids `<generated_67>` /
    // `<generated_68>` (pinned against the oracle).
    shapes.insert(
        "performance".to_string(),
        ObjectShape::object(vec![(
            "now".to_string(),
            function_type(GENERATED_PERFORMANCE_NOW_ID, Type::Poly),
        )]),
    );
    shapes.insert(
        "Date".to_string(),
        ObjectShape::object(vec![(
            "now".to_string(),
            function_type(GENERATED_DATE_NOW_ID, Type::Poly),
        )]),
    );

    // The `console` global object (`Globals.ts`): the static logging methods
    // `error`/`info`/`log`/`table`/`trace`/`warn`, all primitive-returning. Ids
    // `<generated_76..81>` (pinned against the oracle).
    shapes.insert(
        "console".to_string(),
        ObjectShape::object(vec![
            ("error".to_string(), function_type(GENERATED_CONSOLE_ERROR_ID, Type::Primitive)),
            ("info".to_string(), function_type(GENERATED_CONSOLE_INFO_ID, Type::Primitive)),
            ("log".to_string(), function_type(GENERATED_CONSOLE_LOG_ID, Type::Primitive)),
            ("table".to_string(), function_type(GENERATED_CONSOLE_TABLE_ID, Type::Primitive)),
            ("trace".to_string(), function_type(GENERATED_CONSOLE_TRACE_ID, Type::Primitive)),
            ("warn".to_string(), function_type(GENERATED_CONSOLE_WARN_ID, Type::Primitive)),
        ]),
    );

    // The recursive `globalThis` / `global` objects (`Globals.ts`'s
    // `addObject(DEFAULT_SHAPES, 'globalThis'/'global', TYPED_GLOBALS)`): each maps
    // every TYPED_GLOBALS top-level name to its typed value, so e.g.
    // `globalThis.Math.max` resolves the same as a bare `Math.max`. Note `globalThis`
    // is NOT itself a TYPED_GLOBALS entry, so `globalThis.globalThis` has no shape
    // (the oracle prints `<unknown>` for it) — matching the TS exactly.
    let typed_globals_props = typed_global_properties();
    shapes.insert(
        "globalThis".to_string(),
        ObjectShape::object(typed_globals_props.clone()),
    );
    shapes.insert(
        "global".to_string(),
        ObjectShape::object(typed_globals_props),
    );

    // The default custom-hook function shapes. Both are registered with explicit
    // ids in `ObjectShape.ts` (`DefaultMutatingHook` / `DefaultNonmutatingHook`),
    // each a callable `Function` returning `Poly`. `getGlobalDeclaration` /
    // `getPropertyType` resolve hook-named bindings/properties to one of these via
    // `Environment.#getCustomHookType()`.
    let hook_shape = ObjectShape {
        properties: Vec::new(),
        function_type: Some(FunctionSignature {
            return_type: Type::Poly,
            is_constructor: false,
        }),
    };
    shapes.insert(DEFAULT_MUTATING_HOOK_ID.to_string(), hook_shape.clone());
    shapes.insert(DEFAULT_NONMUTATING_HOOK_ID.to_string(), hook_shape);

    // Empty JSX + generic-function shapes (no properties, but must exist).
    shapes.insert(BUILTIN_JSX_ID.to_string(), ObjectShape::object(Vec::new()));
    shapes.insert(BUILTIN_FUNCTION_ID.to_string(), ObjectShape::object(Vec::new()));

    install_shared_runtime_shapes(&mut shapes);
    install_reanimated_shapes(&mut shapes);

    shapes
}

/// Register the `shared-runtime` module type-provider shapes
/// (`makeSharedRuntimeTypeProvider` + `installTypeConfig`), reduced to the typed
/// *function* exports the corpus actually imports. The shapes are installed
/// unconditionally (the module type is resolved lazily in the TS, but installing
/// eagerly here is observationally identical — the shapes are only reachable via a
/// `shared-runtime` import resolved through [`TypeProvider::get_global_declaration`]).
///
/// Both the *function* exports (`graphql`/`default`/`typedLog`/`typedArrayPush`,
/// all primitive-returning) and the typed *hooks* (`useFreeze` → frozen `Poly`,
/// `useFragment` → frozen `MixedReadonly` with `noAlias`, `useNoAlias` → mutable
/// `Poly` with `noAlias`) are installed. The hooks' `MixedReadonly`/`noAlias`/
/// Mutable return semantics drive scope-dependency propagation and
/// non-escaping-scope pruning, so an import like `useFragment(...)` resolves to its
/// real frozen `MixedReadonly` type rather than the generic custom-hook fallback.
fn install_shared_runtime_shapes(shapes: &mut ShapeRegistry) {
    // The legacy `SharedRuntimePrimitiveFn` shape is kept for back-compat (it is
    // still referenced where a primitive-returning shared-runtime function is built
    // without a generated id), but the module object below pins the *true*
    // `<generated_110..114>` ids so the printed `LoadGlobal` types match the oracle.
    shapes.insert(
        SHARED_RUNTIME_PRIMITIVE_FN_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Primitive,
                is_constructor: false,
            }),
        },
    );
    shapes.insert(
        SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Primitive,
                is_constructor: false,
            }),
        },
    );

    // `default` / `graphql` / `typedLog`: primitive-returning read-only functions,
    // pinned to `<generated_110>` / `<generated_112>` / `<generated_114>`.
    for id in [
        GENERATED_SHARED_RUNTIME_DEFAULT_ID,
        GENERATED_SHARED_RUNTIME_GRAPHQL_ID,
        GENERATED_SHARED_RUNTIME_TYPED_LOG_ID,
    ] {
        shapes.insert(
            id.to_string(),
            ObjectShape {
                properties: Vec::new(),
                function_type: Some(FunctionSignature {
                    return_type: Type::Primitive,
                    is_constructor: false,
                }),
            },
        );
    }
    // `typedArrayPush`: stores into arg0, captures arg1/rest, primitive return.
    shapes.insert(
        GENERATED_SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Primitive,
                is_constructor: false,
            }),
        },
    );

    // The typed hooks. Each is a callable function shape whose return type is the
    // hook's return type (`installTypeConfig` `case 'hook'`); the `hookKind:
    // 'Custom'` is recognized in `get_hook_kind` by shape id, and the call effects
    // (freeze args, frozen/mutable return, `noAlias`) live in
    // `call_signature_for_shape`.
    shapes.insert(
        GENERATED_USE_FREEZE_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Poly,
                is_constructor: false,
            }),
        },
    );
    shapes.insert(
        GENERATED_USE_FRAGMENT_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: object_type(BUILTIN_MIXED_READONLY_ID),
                is_constructor: false,
            }),
        },
    );
    shapes.insert(
        GENERATED_USE_NO_ALIAS_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Poly,
                is_constructor: false,
            }),
        },
    );

    // The typed `shared-runtime` *functions* carrying an explicit `aliasing`
    // config (`typedIdentity`/`typedAssign`/`typedAlias`/`typedCapture`/
    // `typedCreateFrom`/`typedMutate`). Each is a callable function shape; the
    // call effects (the precise `Capture`/`CreateFrom`/`Mutate`/`Alias` signature)
    // live in `call_signature_for_shape`. The return *type* is the function shape's
    // `function_type.return_type` (`installTypeConfig` `case 'function'` →
    // `returnType`): `typedCapture` returns `Array`, `typedCreateFrom`/`typedAlias`/
    // `typedAssign`/`typedIdentity` return `Any` (Poly), `typedMutate` returns
    // `Primitive`.
    for (id, return_type) in [
        (GENERATED_SHARED_RUNTIME_TYPED_IDENTITY_ID, Type::Poly),
        (GENERATED_SHARED_RUNTIME_TYPED_ASSIGN_ID, Type::Poly),
        (GENERATED_SHARED_RUNTIME_TYPED_ALIAS_ID, Type::Poly),
        (
            GENERATED_SHARED_RUNTIME_TYPED_CAPTURE_ID,
            object_type(BUILTIN_ARRAY_ID),
        ),
        (GENERATED_SHARED_RUNTIME_TYPED_CREATE_FROM_ID, Type::Poly),
        (GENERATED_SHARED_RUNTIME_TYPED_MUTATE_ID, Type::Primitive),
    ] {
        shapes.insert(
            id.to_string(),
            ObjectShape {
                properties: Vec::new(),
                function_type: Some(FunctionSignature {
                    return_type,
                    is_constructor: false,
                }),
            },
        );
    }

    // The `shared-runtime` module object: maps each typed import name to its
    // resolved type. Names absent here fall through to the hook-name custom-hook
    // fallback in `get_global_declaration`.
    shapes.insert(
        SHARED_RUNTIME_MODULE_ID.to_string(),
        ObjectShape::object(vec![
            (
                "default".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_DEFAULT_ID, Type::Primitive),
            ),
            (
                "graphql".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_GRAPHQL_ID, Type::Primitive),
            ),
            (
                "typedLog".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_LOG_ID, Type::Primitive),
            ),
            (
                "typedArrayPush".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_ARRAY_PUSH_ID, Type::Primitive),
            ),
            (
                "useFreeze".to_string(),
                function_type(GENERATED_USE_FREEZE_ID, Type::Poly),
            ),
            (
                "useFragment".to_string(),
                function_type(GENERATED_USE_FRAGMENT_ID, object_type(BUILTIN_MIXED_READONLY_ID)),
            ),
            (
                "useNoAlias".to_string(),
                function_type(GENERATED_USE_NO_ALIAS_ID, Type::Poly),
            ),
            // The typed functions with explicit `aliasing` configs.
            (
                "typedIdentity".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_IDENTITY_ID, Type::Poly),
            ),
            (
                "typedAssign".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_ASSIGN_ID, Type::Poly),
            ),
            (
                "typedAlias".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_ALIAS_ID, Type::Poly),
            ),
            (
                "typedCapture".to_string(),
                function_type(
                    GENERATED_SHARED_RUNTIME_TYPED_CAPTURE_ID,
                    object_type(BUILTIN_ARRAY_ID),
                ),
            ),
            (
                "typedCreateFrom".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_CREATE_FROM_ID, Type::Poly),
            ),
            (
                "typedMutate".to_string(),
                function_type(GENERATED_SHARED_RUNTIME_TYPED_MUTATE_ID, Type::Primitive),
            ),
        ]),
    );
}

/// Install the `react-native-reanimated` module type
/// (`Globals.ts::getReanimatedModuleType`, registered for
/// `'react-native-reanimated'` in the `Environment` constructor when
/// `enableCustomTypeDefinitionForReanimated` is set, `Environment.ts:603-606`).
///
/// The shapes are installed unconditionally into the registry (as with
/// [`install_shared_runtime_shapes`]); the module *resolution* is what is gated on
/// the config flag, in [`crate::type_inference::TypeProvider::resolve_module_type`].
/// This is observationally identical to the TS, since these shapes are only
/// reachable via a `react-native-reanimated` import resolved through the gated
/// module type — when the flag is off, the imports take the generic custom-hook
/// fallback exactly as before.
///
/// Six frozen hooks (`useFrameCallback`/`useAnimatedStyle`/`useAnimatedProps`/
/// `useAnimatedScrollHandler`/`useAnimatedReaction`/`useWorkletCallback`) share one
/// frozen-hook function shape (freeze args → frozen `Poly` return, `noAlias`); two
/// mutable hooks (`useSharedValue`/`useDerivedValue`) share one mutable-hook shape
/// returning the `ReanimatedSharedValueId` object; seven functions
/// (`withTiming`/`withSpring`/`createAnimatedPropAdapter`/`withDecay`/`withRepeat`/
/// `runOnUI`/`executeOnUIRuntimeSync`) share one function shape (read args → mutable
/// `Poly`). The call effects live in [`call_signature_for_shape`]; `hookKind:
/// 'Custom'` for the hooks is recognized by shape id in `get_hook_kind`.
fn install_reanimated_shapes(shapes: &mut ShapeRegistry) {
    // `ReanimatedSharedValueId`: the (empty) object `useSharedValue`/
    // `useDerivedValue` return. `ObjectShape.ts:1233` registers it as
    // `addObject(BUILTIN_SHAPES, ReanimatedSharedValueId, [])`, so a `.value` read
    // has no typed property and falls through (the value is mutable/ref-like).
    shapes.insert(
        REANIMATED_SHARED_VALUE_ID.to_string(),
        ObjectShape::object(Vec::new()),
    );

    // The shared frozen-hook function shape (return type `Poly`).
    shapes.insert(
        GENERATED_REANIMATED_FROZEN_HOOK_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Poly,
                is_constructor: false,
            }),
        },
    );
    // The shared mutable-hook function shape (return type `ReanimatedSharedValueId`).
    shapes.insert(
        GENERATED_REANIMATED_MUTABLE_HOOK_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: object_type(REANIMATED_SHARED_VALUE_ID),
                is_constructor: false,
            }),
        },
    );
    // The shared value-producing function shape (return type `Poly`).
    shapes.insert(
        GENERATED_REANIMATED_FN_ID.to_string(),
        ObjectShape {
            properties: Vec::new(),
            function_type: Some(FunctionSignature {
                return_type: Type::Poly,
                is_constructor: false,
            }),
        },
    );

    // The `react-native-reanimated` module object: maps each typed export name to
    // its resolved type. Names absent here fall through to the hook-name custom-hook
    // fallback in `get_global_declaration`.
    let frozen_hook = || function_type(GENERATED_REANIMATED_FROZEN_HOOK_ID, Type::Poly);
    let mutable_hook = || {
        function_type(
            GENERATED_REANIMATED_MUTABLE_HOOK_ID,
            object_type(REANIMATED_SHARED_VALUE_ID),
        )
    };
    let func = || function_type(GENERATED_REANIMATED_FN_ID, Type::Poly);
    shapes.insert(
        REANIMATED_MODULE_ID.to_string(),
        ObjectShape::object(vec![
            // Frozen hooks.
            ("useFrameCallback".to_string(), frozen_hook()),
            ("useAnimatedStyle".to_string(), frozen_hook()),
            ("useAnimatedProps".to_string(), frozen_hook()),
            ("useAnimatedScrollHandler".to_string(), frozen_hook()),
            ("useAnimatedReaction".to_string(), frozen_hook()),
            ("useWorkletCallback".to_string(), frozen_hook()),
            // Mutable hooks.
            ("useSharedValue".to_string(), mutable_hook()),
            ("useDerivedValue".to_string(), mutable_hook()),
            // Value-producing functions.
            ("withTiming".to_string(), func()),
            ("withSpring".to_string(), func()),
            ("createAnimatedPropAdapter".to_string(), func()),
            ("withDecay".to_string(), func()),
            ("withRepeat".to_string(), func()),
            ("runOnUI".to_string(), func()),
            ("executeOnUIRuntimeSync".to_string(), func()),
        ]),
    );
}

/// The default global *type* registry (`Globals.ts::DEFAULT_GLOBALS`), reduced to
/// the named globals the stage-2 fixtures reach: the `Object` constructor object,
/// the callable `Boolean` / `Number` constructors, and the `useState` hook.
///
/// Globals not listed here are absent (the TS would map them to `Poly` via
/// `UNTYPED_GLOBALS`, but the fixtures never read their type, so they are
/// omitted from this minimal port).
pub fn default_globals() -> GlobalRegistry {
    let mut globals = GlobalRegistry::new();

    // The `Object` global resolves to its constructor-object shape.
    globals.insert("Object".to_string(), object_type("Object"));

    // The `Array` global resolves to its constructor-object shape (so
    // `Array.from`/`Array.of`/`Array.isArray` get their typed signatures).
    globals.insert("Array".to_string(), object_type("Array"));

    // The `Map` / `Set` / `WeakMap` / `WeakSet` global constructors (`Globals.ts`
    // registers each via `addFunction(…, isConstructor=true)`). `new Set()` etc.
    // resolve to the matching `BuiltIn*` instance shape so the receiver-capturing
    // `add`/`set` aliasing fires (the element gets its own reactive scope rather
    // than being merged into the collection's mutable range).
    globals.insert(
        "Map".to_string(),
        constructor_function_type(GENERATED_MAP_CTOR_ID, object_type(BUILTIN_MAP_ID)),
    );
    globals.insert(
        "Set".to_string(),
        constructor_function_type(GENERATED_SET_CTOR_ID, object_type(BUILTIN_SET_ID)),
    );
    globals.insert(
        "WeakMap".to_string(),
        constructor_function_type(GENERATED_WEAKMAP_CTOR_ID, object_type(BUILTIN_WEAKMAP_ID)),
    );
    globals.insert(
        "WeakSet".to_string(),
        constructor_function_type(GENERATED_WEAKSET_CTOR_ID, object_type(BUILTIN_WEAKSET_ID)),
    );

    // `Boolean(x)` / `Number(x)` — callable, returning a primitive.
    globals.insert(
        "Boolean".to_string(),
        function_type(GENERATED_BOOLEAN_ID, Type::Primitive),
    );
    globals.insert(
        "Number".to_string(),
        function_type(GENERATED_NUMBER_ID, Type::Primitive),
    );

    // The remaining primitive-coercing globals, in `Globals.ts` declaration order
    // (`String`..`decodeURIComponent`). Each is callable and returns a primitive;
    // registering their typed shape (rather than letting them fall back to a bare
    // `TFunction`) means `InferMutationAliasingEffects` sees the known primitive
    // call signature and does not allocate a reactive scope for e.g. `String(x)`.
    globals.insert(
        "String".to_string(),
        function_type(GENERATED_STRING_ID, Type::Primitive),
    );
    globals.insert(
        "parseInt".to_string(),
        function_type(GENERATED_PARSE_INT_ID, Type::Primitive),
    );
    globals.insert(
        "parseFloat".to_string(),
        function_type(GENERATED_PARSE_FLOAT_ID, Type::Primitive),
    );
    globals.insert(
        "isNaN".to_string(),
        function_type(GENERATED_IS_NAN_ID, Type::Primitive),
    );
    globals.insert(
        "isFinite".to_string(),
        function_type(GENERATED_IS_FINITE_ID, Type::Primitive),
    );
    globals.insert(
        "encodeURI".to_string(),
        function_type(GENERATED_ENCODE_URI_ID, Type::Primitive),
    );
    globals.insert(
        "encodeURIComponent".to_string(),
        function_type(GENERATED_ENCODE_URI_COMPONENT_ID, Type::Primitive),
    );
    globals.insert(
        "decodeURI".to_string(),
        function_type(GENERATED_DECODE_URI_ID, Type::Primitive),
    );
    globals.insert(
        "decodeURIComponent".to_string(),
        function_type(GENERATED_DECODE_URI_COMPONENT_ID, Type::Primitive),
    );

    // The `Math` / `performance` / `Date` / `console` global objects (`Globals.ts`'s
    // `TYPED_GLOBALS`). Each resolves to its constructor-object shape so its static
    // methods get their typed signatures (`Math.max` -> primitive, `Date.now` ->
    // impure Poly, …). Without these, `Math.max(a, b)` fell to the unsignatured
    // default-capture path: it returned a `Mutable` value (so the call was given a
    // reactive scope) and conditionally-mutated its operands — a real cache-size
    // divergence (`infer-global-object` `_c(7)` vs the oracle's `_c(4)`).
    globals.insert("Math".to_string(), object_type("Math"));
    globals.insert("performance".to_string(), object_type("performance"));
    globals.insert("Date".to_string(), object_type("Date"));
    globals.insert("console".to_string(), object_type("console"));

    // `Infinity` / `NaN` (`Globals.ts`): bare primitive globals. Typing them
    // `Primitive` keeps `Infinity` etc. from being treated as a mutable value.
    globals.insert("Infinity".to_string(), Type::Primitive);
    globals.insert("NaN".to_string(), Type::Primitive);

    // The recursive `globalThis` / `global` globals (`Globals.ts`'s
    // `addObject(DEFAULT_SHAPES, 'globalThis'/'global', TYPED_GLOBALS)`): resolve to
    // their object shape (every TYPED_GLOBALS name as a property), so
    // `globalThis.Math.max` types identically to `Math.max`.
    globals.insert("globalThis".to_string(), object_type("globalThis"));
    globals.insert("global".to_string(), object_type("global"));

    // `useState()` — callable, returning the `[state, setState]` tuple shape.
    globals.insert(
        "useState".to_string(),
        function_type(GENERATED_USE_STATE_ID, object_type(BUILTIN_USE_STATE_ID)),
    );

    // `useRef()` — callable, returning the `{current}` ref shape.
    globals.insert(
        "useRef".to_string(),
        function_type(GENERATED_USE_REF_ID, object_type(BUILTIN_USE_REF_ID)),
    );

    // The remaining stable-container hooks (`useActionState`/`useReducer`/
    // `useTransition`/`useOptimistic`) — each callable, returning its
    // `[value, setter]` tuple shape. Without these the hooks would fall back to
    // the generic custom-hook type (`Poly` return), so their destructured
    // setter/dispatcher would be typed `Poly`, treated as reactive, and wrongly
    // added as a memoization dependency. Registering the true tuple shapes lets
    // `InferReactivePlaces`'s `StableSidemap` recognize the setter as stable.
    globals.insert(
        "useActionState".to_string(),
        function_type(
            GENERATED_USE_ACTION_STATE_ID,
            object_type(BUILTIN_USE_ACTION_STATE_ID),
        ),
    );
    globals.insert(
        "useReducer".to_string(),
        function_type(GENERATED_USE_REDUCER_ID, object_type(BUILTIN_USE_REDUCER_ID)),
    );
    globals.insert(
        "useTransition".to_string(),
        function_type(
            GENERATED_USE_TRANSITION_ID,
            object_type(BUILTIN_USE_TRANSITION_ID),
        ),
    );
    globals.insert(
        "useOptimistic".to_string(),
        function_type(
            GENERATED_USE_OPTIMISTIC_ID,
            object_type(BUILTIN_USE_OPTIMISTIC_ID),
        ),
    );

    // `useMemo()` / `useCallback()` — callable, returning `Poly` (per their
    // `addHook` shapes). `dropManualMemoization` rewrites these calls away before
    // SSA, so the `LoadGlobal` is dead by `InferTypes`; the registration only
    // pins the printed shape id (`<generated_102>`/`<generated_103>`) so a manual-
    // memo fixture's `InferTypes` snapshot matches the oracle.
    globals.insert(
        "useMemo".to_string(),
        function_type(GENERATED_USE_MEMO_ID, Type::Poly),
    );
    globals.insert(
        "useCallback".to_string(),
        function_type(GENERATED_USE_CALLBACK_ID, Type::Poly),
    );

    // The `use` operator (`Globals.ts`'s `REACT_APIS` `'use'` entry:
    // `addFunction(... returnType Poly, restParam Freeze, calleeEffect Read,
    // returnValueKind Frozen, BuiltInUseOperatorId)`). Without it, `use(ctx)`
    // imported from `react` resolved to no typed shape (it is NOT hook-named —
    // `isHookName` requires `use` followed by an uppercase/digit), so the call
    // defaulted to capturing its argument and returning a *mutable* value. That
    // kept the single-instruction `use()` scope alive through
    // `PruneNonEscapingScopes` and wrongly memoized the call (e.g. the
    // `use-operator-*` fixtures). Pointing it at its `BuiltInUseOperator` shape
    // makes the call freeze its arg and return Frozen, so the scope is pruned and
    // the result becomes a plain reactive dependency, matching the oracle.
    globals.insert(
        "use".to_string(),
        function_type(BUILTIN_USE_OPERATOR_ID, Type::Poly),
    );

    // The effect hooks (`useEffect`/`useLayoutEffect`/`useInsertionEffect`/
    // `useEffectEvent`). Their `Globals.ts` shapes mirror the `React` namespace
    // members (see `GENERATED_REACT_ID` above): a typed-shape global is required so
    // the lint surface's `isUseEffectHookType` family recognizes them by type
    // (`validateNoSetStateInEffects`). Their aliasing signatures
    // (`call_signature_for_shape`) match the TS exactly, so codegen is unchanged.
    globals.insert(
        "useEffect".to_string(),
        function_type(BUILTIN_USE_EFFECT_HOOK_ID, Type::Primitive),
    );
    globals.insert(
        "useLayoutEffect".to_string(),
        function_type(BUILTIN_USE_LAYOUT_EFFECT_HOOK_ID, Type::Poly),
    );
    globals.insert(
        "useInsertionEffect".to_string(),
        function_type(BUILTIN_USE_INSERTION_EFFECT_HOOK_ID, Type::Poly),
    );
    globals.insert(
        "useEffectEvent".to_string(),
        function_type(
            BUILTIN_USE_EFFECT_EVENT_ID,
            function_type(BUILTIN_EFFECT_EVENT_FUNCTION_ID, Type::Poly),
        ),
    );

    // The `React` namespace object (`Globals.ts`'s `TYPED_GLOBALS` `React` entry).
    // Without this, `LoadGlobal React` resolved to no shape, so `React.useState` /
    // `React.useReducer` fell through `getPropertyType`'s `isHookName` branch to the
    // generic custom-hook type — typing the destructured setter `Poly`, treating it
    // as reactive, and adding it as a spurious memoization dependency (a real
    // cache-size divergence). Pointing `React` at its object shape makes the member
    // hooks resolve to their true typed shapes (stable `BuiltInSetState` setter, …).
    globals.insert(
        "React".to_string(),
        object_type(GENERATED_REACT_ID),
    );

    globals
}

/// The TYPED_GLOBALS top-level name -> type mapping, used as the property set of
/// the recursive `globalThis` / `global` object shapes (`Globals.ts`'s
/// `addObject(DEFAULT_SHAPES, 'globalThis'/'global', TYPED_GLOBALS)`). This is the
/// `TYPED_GLOBALS` list only — it does NOT include `React`/hooks (those are
/// `REACT_APIS`, added to `DEFAULT_GLOBALS` separately, not to the recursive
/// objects) nor `globalThis`/`global` themselves (so `globalThis.globalThis` has
/// no shape, matching the oracle's `<unknown>`).
fn typed_global_properties() -> Vec<(String, Type)> {
    vec![
        ("Object".to_string(), object_type("Object")),
        ("Array".to_string(), object_type("Array")),
        ("performance".to_string(), object_type("performance")),
        ("Date".to_string(), object_type("Date")),
        ("Math".to_string(), object_type("Math")),
        ("Infinity".to_string(), Type::Primitive),
        ("NaN".to_string(), Type::Primitive),
        ("console".to_string(), object_type("console")),
        ("Boolean".to_string(), function_type(GENERATED_BOOLEAN_ID, Type::Primitive)),
        ("Number".to_string(), function_type(GENERATED_NUMBER_ID, Type::Primitive)),
        ("String".to_string(), function_type(GENERATED_STRING_ID, Type::Primitive)),
        ("parseInt".to_string(), function_type(GENERATED_PARSE_INT_ID, Type::Primitive)),
        ("parseFloat".to_string(), function_type(GENERATED_PARSE_FLOAT_ID, Type::Primitive)),
        ("isNaN".to_string(), function_type(GENERATED_IS_NAN_ID, Type::Primitive)),
        ("isFinite".to_string(), function_type(GENERATED_IS_FINITE_ID, Type::Primitive)),
        ("encodeURI".to_string(), function_type(GENERATED_ENCODE_URI_ID, Type::Primitive)),
        (
            "encodeURIComponent".to_string(),
            function_type(GENERATED_ENCODE_URI_COMPONENT_ID, Type::Primitive),
        ),
        ("decodeURI".to_string(), function_type(GENERATED_DECODE_URI_ID, Type::Primitive)),
        (
            "decodeURIComponent".to_string(),
            function_type(GENERATED_DECODE_URI_COMPONENT_ID, Type::Primitive),
        ),
        (
            "Map".to_string(),
            constructor_function_type(GENERATED_MAP_CTOR_ID, object_type(BUILTIN_MAP_ID)),
        ),
        (
            "Set".to_string(),
            constructor_function_type(GENERATED_SET_CTOR_ID, object_type(BUILTIN_SET_ID)),
        ),
        (
            "WeakMap".to_string(),
            constructor_function_type(GENERATED_WEAKMAP_CTOR_ID, object_type(BUILTIN_WEAKMAP_ID)),
        ),
        (
            "WeakSet".to_string(),
            constructor_function_type(GENERATED_WEAKSET_CTOR_ID, object_type(BUILTIN_WEAKSET_ID)),
        ),
    ]
}

/// `Globals.ts::getGlobalDeclaration` (the data path): the [`Type`] a global
/// `name` resolves to, or `None` when it is not a typed global in this minimal
/// registry.
pub fn get_global_declaration(globals: &GlobalRegistry, name: &str) -> Option<Type> {
    globals.get(name).cloned()
}

/// `Environment.#getCustomHookType()`: the custom-hook [`Type`] returned for
/// hook-named bindings/properties the global/shape registry does not otherwise
/// resolve. A callable `Function` returning `Poly`, whose shape id selects the
/// `DefaultNonmutatingHook` shape when `enableAssumeHooksFollowRulesOfReact` is on
/// (the schema default) and `DefaultMutatingHook` otherwise.
pub fn custom_hook_type(assume_hooks_follow_rules_of_react: bool) -> Type {
    let shape_id = if assume_hooks_follow_rules_of_react {
        DEFAULT_NONMUTATING_HOOK_ID
    } else {
        DEFAULT_MUTATING_HOOK_ID
    };
    function_type(shape_id, Type::Poly)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::print_type;

    #[test]
    fn array_shape_has_typed_methods() {
        let shapes = builtin_shapes();
        let array = shapes.get(BUILTIN_ARRAY_ID).expect("array shape");
        assert_eq!(array.property_type("length"), Some(&Type::Primitive));
        // `map` (index 7) returns a new array.
        assert_eq!(
            array.property_type("map"),
            Some(&generated_function_type(7, object_type(BUILTIN_ARRAY_ID)))
        );
        // `find` (index 12) returns Poly.
        assert_eq!(
            array.property_type("find"),
            Some(&generated_function_type(12, Type::Poly))
        );
        // `pop` (index 2) prints with its pinned generated id.
        assert_eq!(
            crate::hir::print_type(array.property_type("pop").unwrap()),
            ":TFunction<<generated_2>>():  :TPoly"
        );
    }

    #[test]
    fn ref_value_wildcard_is_recursive() {
        let shapes = builtin_shapes();
        let ref_value = shapes.get(BUILTIN_REF_VALUE_ID).expect("ref value shape");
        // Any property name resolves to the ref-value shape via the `*` wildcard.
        assert_eq!(
            ref_value.property_type("anything"),
            Some(&object_type(BUILTIN_REF_VALUE_ID))
        );
    }

    #[test]
    fn use_state_tuple_shape() {
        let shapes = builtin_shapes();
        let use_state = shapes.get(BUILTIN_USE_STATE_ID).expect("useState shape");
        assert_eq!(use_state.property_type("0"), Some(&Type::Poly));
        assert_eq!(
            use_state.property_type("1"),
            Some(&function_type(BUILTIN_SET_STATE_ID, Type::Primitive))
        );
    }

    #[test]
    fn globals_resolve_to_callable_types() {
        let globals = default_globals();
        // Boolean / Number print with their generated shape ids + primitive return.
        let boolean = get_global_declaration(&globals, "Boolean").expect("Boolean");
        assert_eq!(print_type(&boolean), ":TFunction<<generated_82>>():  :TPrimitive");
        let number = get_global_declaration(&globals, "Number").expect("Number");
        assert_eq!(print_type(&number), ":TFunction<<generated_83>>():  :TPrimitive");
        // useState prints with its generated id + the useState tuple shape.
        let use_state = get_global_declaration(&globals, "useState").expect("useState");
        assert_eq!(
            print_type(&use_state),
            ":TFunction<<generated_97>>():  :TObject<BuiltInUseState>"
        );
        // The `Object` global is its constructor object shape.
        let object = get_global_declaration(&globals, "Object").expect("Object");
        assert_eq!(print_type(&object), ":TObject<Object>");
        // Unknown globals are absent in this minimal registry.
        assert_eq!(get_global_declaration(&globals, "Nope"), None);
    }

    #[test]
    fn empty_shapes_exist() {
        let shapes = builtin_shapes();
        assert!(shapes.get(BUILTIN_JSX_ID).expect("jsx").properties.is_empty());
        assert!(
            shapes
                .get(BUILTIN_FUNCTION_ID)
                .expect("function")
                .properties
                .is_empty()
        );
    }
}
