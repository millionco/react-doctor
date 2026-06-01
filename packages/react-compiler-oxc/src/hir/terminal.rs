//! Control-flow terminals (`Terminal` and its variants in `HIR/HIR.ts`).
//!
//! Every basic block ends in exactly one [`Terminal`]. Variants carrying a
//! `fallthrough: BlockId` correspond to `TerminalWithFallthrough`; the rest
//! (`goto`/`return`/`throw`/`unreachable`/`unsupported`/`maybe-throw`) have no
//! fallthrough.

use std::collections::BTreeSet;

use super::ids::{BlockId, InstructionId, ScopeId};
use super::instruction::AliasingEffect;
use super::place::{Identifier, MutableRange, Place, SourceLocation};
use super::value::DependencyPathEntry;

/// A reactive-scope dependency (`ReactiveScopeDependency` in `HIR/HIR.ts`): a
/// base [`Identifier`] plus a (possibly empty) property path, rendered in a
/// scope terminal's `dependencies=[...]` list after
/// `propagateScopeDependenciesHIR`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveScopeDependency {
    /// The base identifier the dependency reads from.
    pub identifier: Identifier,
    /// Whether the dependency is reactive.
    pub reactive: bool,
    /// The `.prop` / `?.prop` access path off the base identifier.
    pub path: Vec<DependencyPathEntry>,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// The early-return information recorded on a [`ReactiveScope`] by
/// `PropagateEarlyReturns` (`ReactiveScope['earlyReturnValue']` in `HIR/HIR.ts`):
/// the temporary the (possibly-unset) return value is assigned to, plus the label
/// the synthesized `break`s target. `None` until `PropagateEarlyReturns` runs.
#[derive(Clone, Debug, PartialEq)]
pub struct EarlyReturnValue {
    /// The temporary holding the early-return value (or the sentinel).
    pub value: Identifier,
    /// Originating source location.
    pub loc: SourceLocation,
    /// The label the synthesized `break`s target.
    pub label: BlockId,
}

/// A declaration recorded on a [`ReactiveScope`]: the declared [`Identifier`]
/// plus the [`ScopeId`] it was declared in (`scope.declarations` value in the TS,
/// printed via `printIdentifier({...decl.identifier, scope: decl.scope})`).
#[derive(Clone, Debug, PartialEq)]
pub struct ScopeDeclaration {
    /// The declared identifier.
    pub identifier: Identifier,
    /// The scope the identifier was declared in.
    pub scope: ScopeId,
}

/// A reactive scope (`ReactiveScope` in `HIR/HIR.ts`), as materialized into the
/// `scope`/`pruned-scope` terminals by `buildReactiveScopeTerminalsHIR`. Stage-1
/// lowering carries only the opaque [`ScopeId`] on identifiers; this fuller
/// structure exists from terminal-building onward to drive
/// `printReactiveScopeSummary`. `dependencies`/`declarations`/`reassignments`
/// stay empty until `propagateScopeDependenciesHIR`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveScope {
    /// The scope id (the `_@N` suffix / `@N` in the summary).
    pub id: ScopeId,
    /// The scope's instruction range `[start:end]`.
    pub range: MutableRange,
    /// The scope's reactive dependencies (insertion order), filled by
    /// `propagateScopeDependenciesHIR`.
    pub dependencies: Vec<ReactiveScopeDependency>,
    /// The scope's declared values, keyed by [`IdentifierId`](super::ids::IdentifierId)
    /// in insertion order.
    pub declarations: Vec<(super::ids::IdentifierId, ScopeDeclaration)>,
    /// The scope's reassigned variables (insertion order).
    pub reassignments: Vec<Identifier>,
    /// The early-return information, set by `PropagateEarlyReturns` for the
    /// outermost reactive scope that (transitively) contains a `return`. `None`
    /// for scopes without early returns. When set, `printReactiveScopeSummary`
    /// renders an `earlyReturn={…}` item.
    pub early_return_value: Option<EarlyReturnValue>,
    /// The set of scope ids merged into this one by
    /// `MergeReactiveScopesThatInvalidateTogether` (insertion order, deduped).
    /// Not printed; tracked for later passes that reason about which scopes still
    /// exist in some form.
    pub merged: BTreeSet<ScopeId>,
}

impl ReactiveScope {
    /// A fresh scope with the given id/range and empty dependency lists.
    pub fn new(id: ScopeId, range: MutableRange) -> Self {
        ReactiveScope {
            id,
            range,
            dependencies: Vec::new(),
            declarations: Vec::new(),
            reassignments: Vec::new(),
            early_return_value: None,
            merged: BTreeSet::new(),
        }
    }
}

/// The flavor of a [`Terminal::Goto`] (`GotoVariant` in `HIR/HIR.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GotoVariant {
    /// A `break`.
    Break,
    /// A `continue`.
    Continue,
    /// A `try` fall-through goto.
    Try,
}

impl GotoVariant {
    /// The string spelling of this variant.
    pub fn as_str(self) -> &'static str {
        match self {
            GotoVariant::Break => "Break",
            GotoVariant::Continue => "Continue",
            GotoVariant::Try => "Try",
        }
    }
}

/// How a function returns (`ReturnVariant` in `HIR/HIR.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReturnVariant {
    /// `() => { ... }` / `function() { ... }`.
    Void,
    /// `() => foo` (arrow only).
    Implicit,
    /// `() => { return ... }` / `function() { return ... }`.
    Explicit,
}

impl ReturnVariant {
    /// The string spelling of this variant.
    pub fn as_str(self) -> &'static str {
        match self {
            ReturnVariant::Void => "Void",
            ReturnVariant::Implicit => "Implicit",
            ReturnVariant::Explicit => "Explicit",
        }
    }
}

/// The operator of a [`Terminal::Logical`] (`&&` / `||` / `??`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogicalOperator {
    /// `&&`.
    And,
    /// `||`.
    Or,
    /// `??`.
    NullCoalescing,
}

impl LogicalOperator {
    /// The string spelling of this operator.
    pub fn as_str(self) -> &'static str {
        match self {
            LogicalOperator::And => "&&",
            LogicalOperator::Or => "||",
            LogicalOperator::NullCoalescing => "??",
        }
    }
}

/// One case of a [`Terminal::Switch`] (`Case` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct SwitchCase {
    /// The case test, or `None` for the `default` case.
    pub test: Option<Place>,
    /// The block this case jumps to.
    pub block: BlockId,
}

/// A control-flow terminal (`Terminal` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum Terminal {
    /// `unsupported` — a terminal that could not be lowered.
    Unsupported {
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `unreachable` — an unreachable block's terminal.
    Unreachable {
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `throw`.
    Throw {
        /// The thrown value.
        value: Place,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `return`.
    Return {
        /// How the function returns.
        return_variant: ReturnVariant,
        /// The returned value.
        value: Place,
        /// Sequencing id.
        id: InstructionId,
        /// Aliasing effects (stubbed; `None` after lowering).
        effects: Option<Vec<AliasingEffect>>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `goto`.
    Goto {
        /// The target block.
        block: BlockId,
        /// The goto flavor.
        variant: GotoVariant,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `if`.
    If {
        /// The test place.
        test: Place,
        /// The consequent block.
        consequent: BlockId,
        /// The alternate block.
        alternate: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `branch` — like `if` but for value blocks.
    Branch {
        /// The test place.
        test: Place,
        /// The consequent block.
        consequent: BlockId,
        /// The alternate block.
        alternate: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `switch`.
    Switch {
        /// The discriminant place.
        test: Place,
        /// The cases.
        cases: Vec<SwitchCase>,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `do-while`.
    DoWhile {
        /// The loop body block.
        loop_block: BlockId,
        /// The test block.
        test: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `while`.
    While {
        /// The test block.
        test: BlockId,
        /// The loop body block.
        loop_block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for`.
    For {
        /// The initializer block.
        init: BlockId,
        /// The test block.
        test: BlockId,
        /// The update block, if any.
        update: Option<BlockId>,
        /// The loop body block.
        loop_block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for-of`.
    ForOf {
        /// The initializer block.
        init: BlockId,
        /// The test block.
        test: BlockId,
        /// The loop body block.
        loop_block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for-in`.
    ForIn {
        /// The initializer block.
        init: BlockId,
        /// The loop body block.
        loop_block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `logical` — `&&` / `||` / `??` value terminal.
    Logical {
        /// The logical operator.
        operator: LogicalOperator,
        /// The test block.
        test: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ternary` — `a ? b : c` value terminal.
    Ternary {
        /// The test block.
        test: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `optional` — an optional-chaining element.
    Optional {
        /// Whether this element was itself optional (`?.`).
        optional: bool,
        /// The test block.
        test: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `label`.
    Label {
        /// The labeled block.
        block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `sequence` — comma-separated expression sequence.
    Sequence {
        /// The sequence block.
        block: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `try`.
    Try {
        /// The protected block.
        block: BlockId,
        /// The `catch` binding place, if any.
        handler_binding: Option<Place>,
        /// The handler block.
        handler: BlockId,
        /// The fallthrough block.
        fallthrough: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `maybe-throw` — a point at which an instruction may throw.
    MaybeThrow {
        /// The non-throwing continuation block.
        continuation: BlockId,
        /// The handler block, if within a `try`.
        handler: Option<BlockId>,
        /// Sequencing id.
        id: InstructionId,
        /// Aliasing effects (stubbed; `None` after lowering).
        effects: Option<Vec<AliasingEffect>>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `scope` — a reactive scope (`ReactiveScopeTerminal`), introduced by
    /// `buildReactiveScopeTerminalsHIR`.
    Scope {
        /// The fallthrough block.
        fallthrough: BlockId,
        /// The scope body block.
        block: BlockId,
        /// The reactive scope (id, range, dependencies, declarations, …).
        scope: ReactiveScope,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `pruned-scope` — a pruned reactive scope (`PrunedScopeTerminal`).
    PrunedScope {
        /// The fallthrough block.
        fallthrough: BlockId,
        /// The scope body block.
        block: BlockId,
        /// The reactive scope (id, range, dependencies, declarations, …).
        scope: ReactiveScope,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
}

impl Terminal {
    /// Mutable access to the aliasing-effect list this terminal carries, if any
    /// (`Return`/`MaybeThrow`). Lets a pass rewrite the `Place`s in the effect
    /// lines (e.g. the `Freeze $N jsx-captured` on a `Return`).
    pub fn effects_mut(&mut self) -> Option<&mut Vec<AliasingEffect>> {
        match self {
            Terminal::Return { effects, .. } | Terminal::MaybeThrow { effects, .. } => {
                effects.as_mut()
            }
            _ => None,
        }
    }

    /// Mutable access to the [`ReactiveScope`] carried by a `scope`/`pruned-scope`
    /// terminal, if this is one. Lets `fixScopeAndIdentifierRanges` /
    /// `propagateScopeDependenciesHIR` rewrite the scope's range / deps in place.
    pub fn scope_mut(&mut self) -> Option<&mut ReactiveScope> {
        match self {
            Terminal::Scope { scope, .. } | Terminal::PrunedScope { scope, .. } => Some(scope),
            _ => None,
        }
    }

    /// The sequencing id of this terminal (every variant has one).
    pub fn id(&self) -> InstructionId {
        match self {
            Terminal::Unsupported { id, .. }
            | Terminal::Unreachable { id, .. }
            | Terminal::Throw { id, .. }
            | Terminal::Return { id, .. }
            | Terminal::Goto { id, .. }
            | Terminal::If { id, .. }
            | Terminal::Branch { id, .. }
            | Terminal::Switch { id, .. }
            | Terminal::DoWhile { id, .. }
            | Terminal::While { id, .. }
            | Terminal::For { id, .. }
            | Terminal::ForOf { id, .. }
            | Terminal::ForIn { id, .. }
            | Terminal::Logical { id, .. }
            | Terminal::Ternary { id, .. }
            | Terminal::Optional { id, .. }
            | Terminal::Label { id, .. }
            | Terminal::Sequence { id, .. }
            | Terminal::Try { id, .. }
            | Terminal::MaybeThrow { id, .. }
            | Terminal::Scope { id, .. }
            | Terminal::PrunedScope { id, .. } => *id,
        }
    }

    /// The fallthrough block of this terminal, if it has one
    /// (`TerminalWithFallthrough`).
    pub fn fallthrough(&self) -> Option<BlockId> {
        match self {
            Terminal::If { fallthrough, .. }
            | Terminal::Branch { fallthrough, .. }
            | Terminal::Switch { fallthrough, .. }
            | Terminal::DoWhile { fallthrough, .. }
            | Terminal::While { fallthrough, .. }
            | Terminal::For { fallthrough, .. }
            | Terminal::ForOf { fallthrough, .. }
            | Terminal::ForIn { fallthrough, .. }
            | Terminal::Logical { fallthrough, .. }
            | Terminal::Ternary { fallthrough, .. }
            | Terminal::Optional { fallthrough, .. }
            | Terminal::Label { fallthrough, .. }
            | Terminal::Sequence { fallthrough, .. }
            | Terminal::Try { fallthrough, .. }
            | Terminal::Scope { fallthrough, .. }
            | Terminal::PrunedScope { fallthrough, .. } => Some(*fallthrough),
            Terminal::Unsupported { .. }
            | Terminal::Unreachable { .. }
            | Terminal::Throw { .. }
            | Terminal::Return { .. }
            | Terminal::Goto { .. }
            | Terminal::MaybeThrow { .. } => None,
        }
    }

    /// Mutable access to the fallthrough block of this terminal, if it has one.
    /// The Rust analog of writing `terminal.fallthrough = ...` on a
    /// `TerminalWithFallthrough` in the TS.
    pub fn fallthrough_mut(&mut self) -> Option<&mut BlockId> {
        match self {
            Terminal::If { fallthrough, .. }
            | Terminal::Branch { fallthrough, .. }
            | Terminal::Switch { fallthrough, .. }
            | Terminal::DoWhile { fallthrough, .. }
            | Terminal::While { fallthrough, .. }
            | Terminal::For { fallthrough, .. }
            | Terminal::ForOf { fallthrough, .. }
            | Terminal::ForIn { fallthrough, .. }
            | Terminal::Logical { fallthrough, .. }
            | Terminal::Ternary { fallthrough, .. }
            | Terminal::Optional { fallthrough, .. }
            | Terminal::Label { fallthrough, .. }
            | Terminal::Sequence { fallthrough, .. }
            | Terminal::Try { fallthrough, .. }
            | Terminal::Scope { fallthrough, .. }
            | Terminal::PrunedScope { fallthrough, .. } => Some(fallthrough),
            Terminal::Unsupported { .. }
            | Terminal::Unreachable { .. }
            | Terminal::Throw { .. }
            | Terminal::Return { .. }
            | Terminal::Goto { .. }
            | Terminal::MaybeThrow { .. } => None,
        }
    }
}
