//! Type inference (`TypeInference/InferTypes.ts`), the final stage-2 pass.
//!
//! [`infer_types`] runs after `constantPropagation` in the pipeline: it
//! generates type equations from the SSA HIR, solves them by unification, and
//! writes the resolved [`crate::hir::Type`] onto every identifier so the printed
//! dump gains the `:TPrimitive` / `:TObject<…>` / `:TFunction<…>` / `:TPhi`
//! suffixes the oracle emits at `--stage InferTypes`.
//!
//! The minimal type provider it consults ([`TypeProvider`]) is built from the
//! shape/global registries in [`crate::environment`].

pub mod infer_types;
pub mod provider;

pub use infer_types::infer_types;
pub use provider::TypeProvider;
