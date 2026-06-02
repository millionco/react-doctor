//! Newtyped, opaque identifier types for the HIR, mirroring the simulated
//! opaque types in `HIR/HIR.ts` (`BlockId`, `IdentifierId`, `DeclarationId`,
//! `InstructionId`, `ScopeId`) and `HIR/Types.ts` (`TypeId`).
//!
//! Each id wraps a `u32` and is `Copy`/`Ord`/`Hash` so it can be used as a map
//! or set key with deterministic iteration order. A monotonic [`IdAllocator`]
//! mirrors the `next*Id` counters carried by `Environment` in the TS compiler.

/// Generates a newtyped wrapper over `u32` plus its `new` constructor.
macro_rules! define_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(pub u32);

        impl $name {
            /// Wrap a raw `u32` as this id. The TS compiler asserts the value is
            /// a non-negative integer; here that is guaranteed by the type.
            #[inline]
            pub const fn new(id: u32) -> Self {
                Self(id)
            }

            /// The underlying numeric value.
            #[inline]
            pub const fn as_u32(self) -> u32 {
                self.0
            }
        }
    };
}

define_id! {
    /// Identifies a [`crate::hir::BasicBlock`] within an [`crate::hir::Hir`].
    BlockId
}
define_id! {
    /// Identifies an SSA instance of a variable (`makeIdentifierId`).
    IdentifierId
}
define_id! {
    /// Groups all SSA instances originating from one source declaration.
    DeclarationId
}
define_id! {
    /// Sequences instructions/terminals within their containing function.
    InstructionId
}
define_id! {
    /// Identifies a reactive scope (opaque in stage 1).
    ScopeId
}
define_id! {
    /// Identifies an abstract type variable (`makeTypeId`).
    TypeId
}

/// A monotonic `u32` counter producing the next id of a given newtype.
///
/// One allocator backs each `next*Id` counter on the `Environment`. Cloning an
/// allocator copies its current position, matching the TS pattern of reading
/// then post-incrementing a numeric field.
#[derive(Clone, Debug, Default)]
pub struct IdAllocator {
    next: u32,
}

impl IdAllocator {
    /// A fresh allocator starting at `0`.
    #[inline]
    pub const fn new() -> Self {
        Self { next: 0 }
    }

    /// An allocator whose first handed-out value will be `start`.
    #[inline]
    pub const fn starting_at(start: u32) -> Self {
        Self { next: start }
    }

    /// Returns the current value then advances the counter (post-increment),
    /// matching `env.nextFooId++` in the TS compiler.
    #[inline]
    pub fn alloc(&mut self) -> u32 {
        let value = self.next;
        self.next += 1;
        value
    }

    /// The value that the next call to [`IdAllocator::alloc`] would return,
    /// without advancing.
    #[inline]
    pub const fn peek(&self) -> u32 {
        self.next
    }
}
