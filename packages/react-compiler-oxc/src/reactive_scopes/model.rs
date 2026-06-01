//! The `ReactiveFunction` data model, ported from the `Reactive*` type
//! declarations in `packages/react-compiler/src/HIR/HIR.ts` (lines ~59-282).
//!
//! Unlike the [`Hir`](crate::hir::Hir) control-flow graph, a [`ReactiveFunction`]
//! is a *tree* that restores the original source-level control constructs
//! (if/while/for/switch/try/…) plus the reactive-scope nesting. It is produced by
//! [`build_reactive_function`](super::build::build_reactive_function)
//! (`BuildReactiveFunction`) from the post-`PropagateScopeDependenciesHIR`
//! `HIRFunction`, and printed by
//! [`print_reactive_function`](super::print::print_reactive_function).
//!
//! Shared HIR primitives are reused directly: [`Place`], [`Identifier`],
//! [`InstructionId`], [`BlockId`], [`SourceLocation`], [`FunctionParam`],
//! [`InstructionValue`], and the already-materialized [`ReactiveScope`] /
//! [`ReactiveScopeDependency`] / [`ScopeDeclaration`] structures (these last three
//! live on the `scope`/`pruned-scope` HIR terminals from stage 4 and are carried
//! verbatim into the reactive tree).

use crate::hir::ids::{BlockId, InstructionId};
use crate::hir::instruction::AliasingEffect;
use crate::hir::model::FunctionParam;
use crate::hir::place::{Place, SourceLocation};
use crate::hir::terminal::{LogicalOperator, ReactiveScope};
use crate::hir::value::InstructionValue;

/// A function lowered into the reactive-scope tree representation
/// (`ReactiveFunction` in `HIR/HIR.ts`).
///
/// `env` is not carried (the Rust crate threads the
/// [`Environment`](crate::environment::Environment) separately and printing does
/// not need it); the outlined-function list lives on the originating
/// [`HirFunction`](crate::hir::model::HirFunction) and is appended by
/// [`print_reactive_function_with_outlined`](super::print::print_reactive_function_with_outlined).
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveFunction {
    /// Originating source location.
    pub loc: SourceLocation,
    /// The function name, if any (a `ValidIdentifierName`).
    pub id: Option<String>,
    /// A name hint for anonymous functions.
    pub name_hint: Option<String>,
    /// The parameters (`Place | SpreadPattern`).
    pub params: Vec<FunctionParam>,
    /// Whether this is a generator function.
    pub generator: bool,
    /// Whether this is an async function.
    pub async_: bool,
    /// The function body as a tree of reactive statements.
    pub body: ReactiveBlock,
    /// Source directives (e.g. `"use strict"`).
    pub directives: Vec<String>,
}

/// A sequence of statements (`ReactiveBlock = Array<ReactiveStatement>`). This is
/// the tree representation, not a CFG.
pub type ReactiveBlock = Vec<ReactiveStatement>;

/// One statement in a [`ReactiveBlock`] (`ReactiveStatement` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum ReactiveStatement {
    /// An instruction statement (`{kind: 'instruction', instruction}`).
    Instruction(ReactiveInstruction),
    /// A terminal statement (`{kind: 'terminal', terminal, label}`).
    Terminal(Box<ReactiveTerminalStatement>),
    /// A reactive scope block (`{kind: 'scope', scope, instructions}`).
    Scope(Box<ReactiveScopeBlock>),
    /// A pruned reactive scope block (`{kind: 'pruned-scope', scope, instructions}`).
    PrunedScope(Box<ReactiveScopeBlock>),
}

/// A reactive scope block (`ReactiveScopeBlock` / `PrunedReactiveScopeBlock`):
/// a [`ReactiveScope`] plus the nested instructions it scopes. The `kind`
/// (`scope` vs `pruned-scope`) is encoded by the enclosing
/// [`ReactiveStatement`] variant.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveScopeBlock {
    /// The reactive scope (id, range, dependencies, declarations, …).
    pub scope: ReactiveScope,
    /// The instructions within this scope.
    pub instructions: ReactiveBlock,
}

/// A labeled terminal statement (`ReactiveTerminalStatement` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveTerminalStatement {
    /// The terminal.
    pub terminal: ReactiveTerminal,
    /// The naive label (the fallthrough block id + whether it is implicit), or
    /// `None`. `PruneUnusedLabels` later removes unnecessary labels.
    pub label: Option<TerminalLabel>,
}

/// A terminal label (`ReactiveTerminalStatement['label']`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalLabel {
    /// The block id used as the label.
    pub id: BlockId,
    /// Whether the label was implicit.
    pub implicit: bool,
}

/// A reactive instruction (`ReactiveInstruction` in `HIR/HIR.ts`). Like an HIR
/// [`Instruction`](crate::hir::instruction::Instruction) but the `value` may be a
/// compound [`ReactiveValue`] and the `lvalue` is optional.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveInstruction {
    /// Sequencing id (stable across passes).
    pub id: InstructionId,
    /// Where the value is assigned, or `None`.
    pub lvalue: Option<Place>,
    /// The computed value.
    pub value: ReactiveValue,
    /// Aliasing/mutation effects (`None` after `BuildReactiveFunction`).
    pub effects: Option<Vec<AliasingEffect>>,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// A reactive value (`ReactiveValue` in `HIR/HIR.ts`): a base
/// [`InstructionValue`] or one of the compound forms restored from value blocks.
#[derive(Clone, Debug, PartialEq)]
pub enum ReactiveValue {
    /// A base HIR instruction value (primitives, calls, loads, …).
    Instruction(Box<InstructionValue>),
    /// `left && right` / `left || right` / `left ?? right`.
    Logical(Box<ReactiveLogicalValue>),
    /// `test ? consequent : alternate`.
    Ternary(Box<ReactiveTernaryValue>),
    /// `inst1; …; value` (flattens nested sequences).
    Sequence(Box<ReactiveSequenceValue>),
    /// An optional-chaining expression (`?.()` / `?.prop`).
    OptionalCall(Box<ReactiveOptionalCallValue>),
}

/// `ReactiveLogicalValue` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveLogicalValue {
    /// `&&` / `||` / `??`.
    pub operator: LogicalOperator,
    /// The left operand.
    pub left: ReactiveValue,
    /// The right operand.
    pub right: ReactiveValue,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// `ReactiveTernaryValue` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveTernaryValue {
    /// The test expression.
    pub test: ReactiveValue,
    /// The value if the test is truthy.
    pub consequent: ReactiveValue,
    /// The value if the test is falsy.
    pub alternate: ReactiveValue,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// `ReactiveSequenceValue` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveSequenceValue {
    /// The instructions preceding the final value.
    pub instructions: Vec<ReactiveInstruction>,
    /// Sequencing id of the final instruction.
    pub id: InstructionId,
    /// The final value.
    pub value: ReactiveValue,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// `ReactiveOptionalCallValue` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveOptionalCallValue {
    /// Sequencing id.
    pub id: InstructionId,
    /// The optional expression value.
    pub value: ReactiveValue,
    /// Whether this is a truly-optional access (`?.`).
    pub optional: bool,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// The kind of control transfer a `break`/`continue` performs
/// (`ReactiveTerminalTargetKind` in `HIR/HIR.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReactiveTerminalTargetKind {
    /// Control transfers implicitly to the target.
    Implicit,
    /// A labeled break/continue is required.
    Labeled,
    /// An unlabeled break/continue would transfer to the target.
    Unlabeled,
}

impl ReactiveTerminalTargetKind {
    /// The string spelling used by `PrintReactiveFunction`.
    pub fn as_str(self) -> &'static str {
        match self {
            ReactiveTerminalTargetKind::Implicit => "implicit",
            ReactiveTerminalTargetKind::Labeled => "labeled",
            ReactiveTerminalTargetKind::Unlabeled => "unlabeled",
        }
    }
}

/// One case of a [`ReactiveTerminal::Switch`] (`ReactiveSwitchTerminal['cases']`
/// element). `test` is `None` for the `default` case; `block` may be `None` for a
/// fallthrough case.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactiveSwitchCase {
    /// The case test, or `None` for `default`.
    pub test: Option<Place>,
    /// The case body, or `None` for a fallthrough case.
    pub block: Option<ReactiveBlock>,
}

/// A reactive control-flow terminal (`ReactiveTerminal` in `HIR/HIR.ts`). Every
/// variant carries an `id: InstructionId` and `loc: SourceLocation`.
#[derive(Clone, Debug, PartialEq)]
pub enum ReactiveTerminal {
    /// `break`.
    Break {
        /// The block being broken to.
        target: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// How control transfers to the target.
        target_kind: ReactiveTerminalTargetKind,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `continue`.
    Continue {
        /// The loop being continued.
        target: BlockId,
        /// Sequencing id.
        id: InstructionId,
        /// How control transfers to the target.
        target_kind: ReactiveTerminalTargetKind,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `return`.
    Return {
        /// The returned value.
        value: Place,
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
    /// `switch`.
    Switch {
        /// The discriminant.
        test: Place,
        /// The case branches.
        cases: Vec<ReactiveSwitchCase>,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `do-while`.
    DoWhile {
        /// The loop body (executed at least once).
        loop_: ReactiveBlock,
        /// The condition to continue looping.
        test: ReactiveValue,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `while`.
    While {
        /// The loop condition.
        test: ReactiveValue,
        /// The loop body.
        loop_: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for`.
    For {
        /// The initializer expression.
        init: ReactiveValue,
        /// The test condition.
        test: ReactiveValue,
        /// The update expression, if any.
        update: Option<ReactiveValue>,
        /// The loop body.
        loop_: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for-of`.
    ForOf {
        /// The loop variable binding.
        init: ReactiveValue,
        /// The iterable expression.
        test: ReactiveValue,
        /// The loop body.
        loop_: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `for-in`.
    ForIn {
        /// The loop variable binding.
        init: ReactiveValue,
        /// The loop body.
        loop_: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `if`.
    If {
        /// The condition.
        test: Place,
        /// The consequent block.
        consequent: ReactiveBlock,
        /// The alternate block, if any.
        alternate: Option<ReactiveBlock>,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `label`.
    Label {
        /// The labeled block.
        block: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `try`.
    Try {
        /// The protected block.
        block: ReactiveBlock,
        /// The caught-exception binding, if any.
        handler_binding: Option<Place>,
        /// The handler/catch block.
        handler: ReactiveBlock,
        /// Sequencing id.
        id: InstructionId,
        /// Originating source location.
        loc: SourceLocation,
    },
}

impl ReactiveTerminal {
    /// The sequencing id of this terminal (every variant has one — enforced by
    /// the `_staticInvariantReactiveTerminalHasInstructionId` invariant in the TS).
    pub fn id(&self) -> InstructionId {
        match self {
            ReactiveTerminal::Break { id, .. }
            | ReactiveTerminal::Continue { id, .. }
            | ReactiveTerminal::Return { id, .. }
            | ReactiveTerminal::Throw { id, .. }
            | ReactiveTerminal::Switch { id, .. }
            | ReactiveTerminal::DoWhile { id, .. }
            | ReactiveTerminal::While { id, .. }
            | ReactiveTerminal::For { id, .. }
            | ReactiveTerminal::ForOf { id, .. }
            | ReactiveTerminal::ForIn { id, .. }
            | ReactiveTerminal::If { id, .. }
            | ReactiveTerminal::Label { id, .. }
            | ReactiveTerminal::Try { id, .. } => *id,
        }
    }
}
