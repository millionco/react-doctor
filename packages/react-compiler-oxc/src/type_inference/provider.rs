//! The type-provider surface `inferTypes` consumes (`Environment.getPropertyType`
//! / `getFallthroughPropertyType` / `getGlobalDeclaration`), reduced to the
//! minimum the curated stage-2 fixtures exercise.
//!
//! A [`TypeProvider`] bundles the built-in [`ShapeRegistry`] and
//! [`GlobalRegistry`] (from [`crate::environment`]) with the two config flags the
//! inference reads, so the pass takes a single immutable handle.

use crate::environment::shapes::{REANIMATED_MODULE_ID, SHARED_RUNTIME_MODULE_ID};
use crate::environment::{
    custom_hook_type, get_global_declaration, is_hook_name, is_known_react_module, GlobalRegistry,
    ShapeRegistry,
};
use crate::hir::place::Type;
use crate::hir::value::NonLocalBinding;

/// The bundled type provider for one inference run.
pub struct TypeProvider {
    /// Built-in object/function shapes, keyed by shape id.
    pub shapes: ShapeRegistry,
    /// Built-in global types, keyed by global name.
    pub globals: GlobalRegistry,
    /// `config.enableTreatRefLikeIdentifiersAsRefs`.
    pub enable_treat_ref_like_identifiers_as_refs: bool,
    /// `config.enableTreatSetIdentifiersAsStateSetters`.
    pub enable_treat_set_identifiers_as_state_setters: bool,
    /// `config.enableAssumeHooksFollowRulesOfReact`. Selects which custom-hook
    /// shape (`DefaultNonmutatingHook` vs `DefaultMutatingHook`) hook-named
    /// bindings/properties resolve to, mirroring `Environment.#getCustomHookType()`.
    pub enable_assume_hooks_follow_rules_of_react: bool,
    /// `config.enableCustomTypeDefinitionForReanimated`. Gates whether
    /// [`resolve_module_type`](Self::resolve_module_type) resolves the
    /// `react-native-reanimated` module type (`Environment.ts:603-606` only
    /// `set`s the module type when the flag is on).
    pub enable_custom_type_definition_for_reanimated: bool,
}

impl TypeProvider {
    /// `Environment.getPropertyType(receiver, property)` for a literal string
    /// property. Looks up `property` (then the `*` wildcard) on the receiver's
    /// shape; on a shaped miss (and on a no-shape receiver) falls back to the
    /// custom-hook type when `property` is hook-named, mirroring the
    /// `isHookName(property) ? this.#getCustomHookType() : null` branches in the
    /// TS (`Environment.ts` ~996 and ~1001).
    pub fn get_property_type(&self, receiver: &Type, property: &str) -> Option<Type> {
        if let Some(shape_id) = shape_id_of(receiver) {
            let shape = self.shapes.get(shape_id)?;
            if let Some(ty) = shape.property_type(property) {
                return Some(ty.clone());
            }
            // Shaped miss (no `property` and no `*` entry): hook-named properties
            // still resolve to the custom-hook type.
            return self.custom_hook_for(property);
        }
        // No shape: a hook-named property resolves to the custom-hook type.
        self.custom_hook_for(property)
    }

    /// `Environment.getFallthroughPropertyType(receiver, _)`: the `*` wildcard
    /// entry of the receiver's shape, used for computed property access.
    pub fn get_fallthrough_property_type(&self, receiver: &Type) -> Option<Type> {
        let shape_id = shape_id_of(receiver)?;
        let shape = self.shapes.get(shape_id)?;
        shape.property_type("*").cloned()
    }

    /// `Environment.getGlobalDeclaration(binding, loc)` for the binding forms the
    /// fixtures reach, mirroring the per-kind hook-name fallbacks in the TS
    /// (`Environment.ts` ~835-940). The minimal provider does not own non-React
    /// module type definitions (`#resolveModuleType` is always `null` here), so
    /// the non-React import paths reduce to their hook-name fallback.
    ///
    /// - `Global name`: registry lookup, else custom-hook type if `name` is
    ///   hook-named.
    /// - `ModuleLocal name`: never resolved as a typed global, but a hook-named
    ///   module local still yields the custom-hook type.
    /// - `ImportSpecifier`: for a known React module, registry lookup by
    ///   `imported`, else custom-hook type if `imported` *or* the local `name` is
    ///   hook-named. For a non-React module, custom-hook type if `imported` or
    ///   `name` is hook-named.
    /// - `ImportDefault` / `ImportNamespace`: for a known React module, registry
    ///   lookup by local `name`, else custom-hook type if `name` is hook-named.
    ///   For a non-React module, custom-hook type if `name` is hook-named.
    pub fn get_global_declaration(&self, binding: &NonLocalBinding) -> Option<Type> {
        match binding {
            NonLocalBinding::Global { name } => {
                get_global_declaration(&self.globals, name).or_else(|| self.custom_hook_for(name))
            }
            NonLocalBinding::ModuleLocal { name } => self.custom_hook_for(name),
            NonLocalBinding::ImportSpecifier {
                module,
                imported,
                name,
            } => {
                if is_known_react_module(module) {
                    get_global_declaration(&self.globals, imported).or_else(|| {
                        self.custom_hook_if(is_hook_name(imported) || is_hook_name(name))
                    })
                } else if let Some(module_type) = self.resolve_module_type(module) {
                    // Non-React module with an installed type (`moduleTypeProvider`):
                    // resolve the imported name on the module object's shape, else
                    // fall through to the hook-name check (Environment.ts ~862-900).
                    self.get_property_type(&module_type, imported)
                        .or_else(|| {
                            self.custom_hook_if(is_hook_name(imported) || is_hook_name(name))
                        })
                } else {
                    self.custom_hook_if(is_hook_name(imported) || is_hook_name(name))
                }
            }
            NonLocalBinding::ImportDefault { module, name } => {
                if is_known_react_module(module) {
                    get_global_declaration(&self.globals, name)
                        .or_else(|| self.custom_hook_for(name))
                } else if let Some(module_type) = self.resolve_module_type(module) {
                    // `import Foo from 'module'`: resolve the `default` property of
                    // the module type, else hook-name fallback (Environment.ts ~903-940).
                    self.get_property_type(&module_type, "default")
                        .or_else(|| self.custom_hook_for(name))
                } else {
                    self.custom_hook_for(name)
                }
            }
            NonLocalBinding::ImportNamespace { module, name } => {
                if is_known_react_module(module) {
                    get_global_declaration(&self.globals, name)
                        .or_else(|| self.custom_hook_for(name))
                } else if let Some(module_type) = self.resolve_module_type(module) {
                    // `import * as ns from 'module'`: the namespace *is* the module
                    // type (Environment.ts ~903-940).
                    Some(module_type)
                } else {
                    self.custom_hook_for(name)
                }
            }
        }
    }

    /// `Environment.#resolveModuleType(moduleName)`: the object [`Type`] the
    /// configured `moduleTypeProvider` installs for `module`, or `None` when no
    /// type is configured (the minimal provider only owns the `shared-runtime`
    /// module the snapshot harness installs). The module object shape is
    /// registered in [`crate::environment::builtin_shapes`], so this is a constant
    /// lookup rather than a lazy install.
    fn resolve_module_type(&self, module: &str) -> Option<Type> {
        if module == "shared-runtime" && self.shapes.contains_key(SHARED_RUNTIME_MODULE_ID) {
            Some(Type::Object {
                shape_id: Some(SHARED_RUNTIME_MODULE_ID.to_string()),
            })
        } else if module == "react-native-reanimated"
            && self.enable_custom_type_definition_for_reanimated
            && self.shapes.contains_key(REANIMATED_MODULE_ID)
        {
            // `Environment.ts:603-606`: the reanimated module type is only
            // installed (`#moduleTypes.set(REANIMATED_MODULE_NAME, …)`) when
            // `enableCustomTypeDefinitionForReanimated` is set, so the import
            // otherwise takes the generic custom-hook fallback.
            Some(Type::Object {
                shape_id: Some(REANIMATED_MODULE_ID.to_string()),
            })
        } else {
            None
        }
    }

    /// `this.#getCustomHookType()` when `name` is hook-named, else `None`.
    fn custom_hook_for(&self, name: &str) -> Option<Type> {
        self.custom_hook_if(is_hook_name(name))
    }

    /// `this.#getCustomHookType()` when `cond`, else `None`.
    fn custom_hook_if(&self, cond: bool) -> Option<Type> {
        cond.then(|| custom_hook_type(self.enable_assume_hooks_follow_rules_of_react))
    }
}

/// The shape id of a receiver type, if it carries one (`Object` / `Function`).
fn shape_id_of(receiver: &Type) -> Option<&str> {
    match receiver {
        Type::Object {
            shape_id: Some(shape_id),
        }
        | Type::Function {
            shape_id: Some(shape_id),
            ..
        } => Some(shape_id.as_str()),
        _ => None,
    }
}
