//! Source locations, the minimal [`Type`] lattice, [`Identifier`], and
//! [`Place`] — the value-reference primitives shared by every instruction and
//! terminal. Ports the corresponding declarations from `HIR/HIR.ts` and
//! `HIR/Types.ts`.

use super::ids::{DeclarationId, IdentifierId, InstructionId, ScopeId, TypeId};

/// A location in a source file, or the [`SourceLocation::Generated`] sentinel
/// for synthesized code (TS `GeneratedSource = Symbol()`).
///
/// Stage 1 only needs byte spans plus an optional filename; the full Babel
/// `SourceLocation` shape (line/column) is not required for HIR printing.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum SourceLocation {
    /// No single originating source location (synthesized code).
    #[default]
    Generated,
    /// A byte span `[start, end)` within an optional source file.
    Span {
        /// Inclusive start byte offset.
        start: u32,
        /// Exclusive end byte offset.
        end: u32,
        /// Originating filename, if known.
        filename: Option<String>,
    },
    /// A source span already resolved to Babel-style 1-based line / 0-based
    /// column. Only `propagateScopeDependenciesHIR` produces this (resolving the
    /// byte span of each dependency's load via the source text), because the
    /// dependency print form is the only HIR dump that renders
    /// `printSourceLocation` as `start.line:start.column:end.line:end.column`.
    Resolved {
        /// Babel `start.line` (1-based).
        start_line: u32,
        /// Babel `start.column` (0-based, UTF-16 code units).
        start_column: u32,
        /// Babel `end.line` (1-based).
        end_line: u32,
        /// Babel `end.column` (0-based, UTF-16 code units).
        end_column: u32,
    },
}

/// Minimal `Type` lattice (`HIR/Types.ts`). Post-lowering every identifier has
/// the default [`Type::Var`] (printed as `<unknown>` by `PrintHIR`), so stage 1
/// only needs faithful construction and the common variants; full shape/return
/// inference is a later stage.
#[derive(Clone, Debug, PartialEq)]
pub enum Type {
    /// `{kind: 'Primitive'}`.
    Primitive,
    /// `{kind: 'Function', shapeId, return, isConstructor}`.
    Function {
        /// Key into the shape registry, if known.
        shape_id: Option<String>,
        /// The call signature's return type.
        return_type: Box<Type>,
        /// Whether the function is a constructor.
        is_constructor: bool,
    },
    /// `{kind: 'Object', shapeId}`.
    Object {
        /// Key into the shape registry, if known.
        shape_id: Option<String>,
    },
    /// `{kind: 'Phi', operands}`.
    Phi {
        /// The merged operand types.
        operands: Vec<Type>,
    },
    /// `{kind: 'Poly'}`.
    Poly,
    /// `{kind: 'Type', id}` — an abstract type variable. This is the default
    /// type produced by `makeType()` and is what `PrintHIR` renders `<unknown>`.
    Var {
        /// The type variable's id.
        id: TypeId,
    },
    /// `{kind: 'ObjectMethod'}`.
    ObjectMethod,
    /// `{kind: 'Property', objectType, objectName, propertyName}` — a deferred
    /// property access, resolved during unification by looking up `propertyName`
    /// on `objectType`'s shape. Only produced/consumed by type inference; it
    /// never survives into printed output in practice (always resolved or
    /// dropped), but [`super::print::print_type`] still renders it `:TProperty`
    /// to match `PrintHIR`.
    Property {
        /// The type of the object whose property is accessed.
        object_type: Box<Type>,
        /// The (best-effort) source name of the object, for ref-like detection.
        object_name: String,
        /// The accessed property name (literal or computed).
        property_name: PropertyName,
    },
}

/// The `propertyName` of a [`Type::Property`] (`PropType['propertyName']`):
/// either a literal name or a computed expression whose type is given.
#[derive(Clone, Debug, PartialEq)]
pub enum PropertyName {
    /// `{kind: 'literal', value}` — a statically-known property name.
    Literal(String),
    /// `{kind: 'computed', value}` — a dynamic property; the inner [`Type`] is
    /// the computed key's type. Resolved via the fallthrough (`*`) shape entry.
    Computed(Box<Type>),
}

impl Type {
    /// The default abstract type produced by `makeType()`, carrying the given
    /// fresh [`TypeId`].
    pub fn var(id: TypeId) -> Self {
        Type::Var { id }
    }
}

/// The effect with which a value is referenced (`Effect` enum in `HIR/HIR.ts`).
/// The string form drives `PrintHIR`'s `printPlace` output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    /// `<unknown>` — default value before lifetime inference.
    Unknown,
    /// `freeze`.
    Freeze,
    /// `read`.
    Read,
    /// `capture`.
    Capture,
    /// `mutate-iterator?`.
    ConditionallyMutateIterator,
    /// `mutate?`.
    ConditionallyMutate,
    /// `mutate`.
    Mutate,
    /// `store`.
    Store,
}

impl Effect {
    /// The string used by `PrintHIR`/`printPlace`.
    pub fn as_str(self) -> &'static str {
        match self {
            Effect::Unknown => "<unknown>",
            Effect::Freeze => "freeze",
            Effect::Read => "read",
            Effect::Capture => "capture",
            Effect::ConditionallyMutateIterator => "mutate-iterator?",
            Effect::ConditionallyMutate => "mutate?",
            Effect::Mutate => "mutate",
            Effect::Store => "store",
        }
    }
}

/// Inference classification of a value (`ValueKind` enum in `HIR/HIR.ts`). Not
/// computed during lowering, included for completeness.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueKind {
    /// `maybefrozen`.
    MaybeFrozen,
    /// `frozen`.
    Frozen,
    /// `primitive`.
    Primitive,
    /// `global`.
    Global,
    /// `mutable`.
    Mutable,
    /// `context`.
    Context,
}

impl ValueKind {
    /// The string spelling of this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            ValueKind::MaybeFrozen => "maybefrozen",
            ValueKind::Frozen => "frozen",
            ValueKind::Primitive => "primitive",
            ValueKind::Global => "global",
            ValueKind::Mutable => "mutable",
            ValueKind::Context => "context",
        }
    }
}

/// The reason for a value's [`ValueKind`] (`ValueReason` enum in `HIR/HIR.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueReason {
    /// `global`.
    Global,
    /// `jsx-captured`.
    JsxCaptured,
    /// `hook-captured`.
    HookCaptured,
    /// `hook-return`.
    HookReturn,
    /// `effect`.
    Effect,
    /// `known-return-signature`.
    KnownReturnSignature,
    /// `context`.
    Context,
    /// `state`.
    State,
    /// `reducer-state`.
    ReducerState,
    /// `reactive-function-argument`.
    ReactiveFunctionArgument,
    /// `other`.
    Other,
}

impl ValueReason {
    /// The string spelling of this reason.
    pub fn as_str(self) -> &'static str {
        match self {
            ValueReason::Global => "global",
            ValueReason::JsxCaptured => "jsx-captured",
            ValueReason::HookCaptured => "hook-captured",
            ValueReason::HookReturn => "hook-return",
            ValueReason::Effect => "effect",
            ValueReason::KnownReturnSignature => "known-return-signature",
            ValueReason::Context => "context",
            ValueReason::State => "state",
            ValueReason::ReducerState => "reducer-state",
            ValueReason::ReactiveFunctionArgument => "reactive-function-argument",
            ValueReason::Other => "other",
        }
    }
}

/// The name of an [`Identifier`] (`IdentifierName` in `HIR/HIR.ts`): either a
/// validated user-source name, or a promoted temporary (`#t<id>`/`#T<id>`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdentifierName {
    /// `{kind: 'named', value}` — a `ValidIdentifierName` from source.
    Named {
        /// The validated identifier name.
        value: String,
    },
    /// `{kind: 'promoted', value}` — a synthesized name for a temporary.
    Promoted {
        /// The promoted name, e.g. `#t12` or `#T12`.
        value: String,
    },
}

/// Range in which an identifier is mutable; `start` inclusive, `end` exclusive
/// (`MutableRange` in `HIR/HIR.ts`). Both default to `0` at lowering time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MutableRange {
    /// First instruction id (inclusive) for which the value is mutable.
    pub start: InstructionId,
    /// First instruction id (exclusive) for which the value is no longer mutable.
    pub end: InstructionId,
}

impl Default for MutableRange {
    fn default() -> Self {
        MutableRange {
            start: InstructionId::new(0),
            end: InstructionId::new(0),
        }
    }
}

/// A user-defined variable or temporary (`Identifier` in `HIR/HIR.ts`).
///
/// `scope` is kept as an opaque [`ScopeId`] only; the full `ReactiveScope`
/// structure is deferred to later stages.
#[derive(Clone, Debug, PartialEq)]
pub struct Identifier {
    /// Unique per SSA instance (after EnterSSA); pre-SSA matches `declaration_id`.
    pub id: IdentifierId,
    /// Unique per original declaration; stable across reassignments.
    pub declaration_id: DeclarationId,
    /// `None` for temporaries; `Some` for user/promoted names.
    pub name: Option<IdentifierName>,
    /// The range over which this variable is mutable.
    pub mutable_range: MutableRange,
    /// The reactive scope that will compute this value (opaque in stage 1).
    pub scope: Option<ScopeId>,
    /// The scope whose (shared, mutable) range this identifier's `mutable_range`
    /// mirrors. In the TS compiler `identifier.mutableRange` and
    /// `identifier.scope.range` are the *same object*: setting one scope's range
    /// updates every member's printed `[a:b]`, and clearing `identifier.scope`
    /// (e.g. `AlignMethodCallScopes` case 3) detaches the printed `_@N` suffix but
    /// leaves `mutableRange` still aliased to that range object — so a later range
    /// extension still flows through. We model that aliasing explicitly: while
    /// `scope` drives the printed `_@N` suffix, `range_scope` drives which scope's
    /// range the printed `[a:b]` follows, and it survives a `scope` clear.
    /// Defaults to `None` (no scope), set in lock-step with `scope` by
    /// `inferReactiveScopeVariables`.
    pub range_scope: Option<ScopeId>,
    /// The inferred type (default [`Type::Var`] post-lowering).
    pub type_: Type,
    /// Originating source location.
    pub loc: SourceLocation,
}

impl Identifier {
    /// Construct a temporary (unnamed) identifier, mirroring
    /// `makeTemporaryIdentifier(id, loc)`: name `None`, `declaration_id` derived
    /// from `id`, empty mutable range, no scope, default `<unknown>` type.
    pub fn make_temporary(id: IdentifierId, type_id: TypeId, loc: SourceLocation) -> Self {
        Identifier {
            id,
            declaration_id: DeclarationId::new(id.as_u32()),
            name: None,
            mutable_range: MutableRange::default(),
            scope: None,
            range_scope: None,
            type_: Type::var(type_id),
            loc,
        }
    }

    /// `promoteTemporary(identifier)`: name an unnamed temporary `#t<declarationId>`,
    /// keyed by [`DeclarationId`] so every instance of the same declaration gets the
    /// same name. Panics if the identifier is already named (the TS `invariant`).
    pub fn promote_temporary(&mut self) {
        debug_assert!(self.name.is_none(), "Expected a temporary (unnamed) identifier");
        self.name = Some(IdentifierName::Promoted {
            value: format!("#t{}", self.declaration_id.as_u32()),
        });
    }

    /// `promoteTemporaryJsxTag(identifier)`: like [`Identifier::promote_temporary`]
    /// but distinguishes a JSX-tag-position value with `#T<declarationId>` (capital
    /// `T`), so [`RenameVariables`](super::super::reactive_scopes::rename_variables)
    /// later capitalizes it (`T0`).
    pub fn promote_temporary_jsx_tag(&mut self) {
        debug_assert!(self.name.is_none(), "Expected a temporary (unnamed) identifier");
        self.name = Some(IdentifierName::Promoted {
            value: format!("#T{}", self.declaration_id.as_u32()),
        });
    }
}

/// `isPromotedTemporary(name)`: a promoted non-JSX temporary name (`#t…`).
pub fn is_promoted_temporary(name: &str) -> bool {
    name.starts_with("#t")
}

/// `isPromotedJsxTemporary(name)`: a promoted JSX-tag temporary name (`#T…`).
pub fn is_promoted_jsx_temporary(name: &str) -> bool {
    name.starts_with("#T")
}

/// A place where data may be read from / written to (`Place` in `HIR/HIR.ts`).
/// Always references an [`Identifier`]; the `kind` is `'Identifier'` in the
/// current model so it is implicit here.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    /// The identifier referenced by this place.
    pub identifier: Identifier,
    /// The effect with which the value is used at this reference.
    pub effect: Effect,
    /// Whether this reference is reactive.
    pub reactive: bool,
    /// Originating source location.
    pub loc: SourceLocation,
}
