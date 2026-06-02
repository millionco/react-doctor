//! The lowering engine: [`HirBuilder`], ported from
//! `packages/react-compiler/src/HIR/HIRBuilder.ts`.
//!
//! [`HirBuilder`] holds the work-in-progress CFG (completed blocks + the current
//! [`WipBlock`]), the control-flow scope stack (loops / switches / labels), the
//! exception-handler stack, and the binding map that interns oxc
//! [`SymbolId`]s into stable HIR [`Identifier`]s. It threads an
//! [`Environment`] (the id counters + config) and the oxc [`Semantic`] result
//! used for scope/symbol resolution.
//!
//! The single most important fidelity property is **id allocation order**:
//! every `make_temporary` / `resolve_binding` / block reservation reads the same
//! counter at the same point as the TS lowering, so the printed `$id`s match the
//! parity oracle exactly.

use std::collections::{BTreeMap, BTreeSet};

use oxc::semantic::{ScopeId, Semantic, SymbolId};

use crate::environment::{Environment, ResolvedReference, resolve_identifier};
use crate::hir::ids::{BlockId, DeclarationId, IdentifierId};
use crate::hir::instruction::Instruction;
use crate::hir::model::{BasicBlock, BlockKind, Hir};
use crate::hir::place::{
    Effect, Identifier, IdentifierName, MutableRange, Place, SourceLocation, Type,
};
use crate::hir::terminal::{GotoVariant, Terminal};
use crate::hir::value::VariableBinding;

use super::post::build_hir;

/// A work-in-progress block that does not yet have a terminator (`WipBlock`).
#[derive(Clone, Debug)]
pub struct WipBlock {
    /// The reserved block id.
    pub id: BlockId,
    /// The block kind.
    pub kind: BlockKind,
    /// Instructions accumulated so far.
    pub instructions: Vec<Instruction>,
}

impl WipBlock {
    fn new(id: BlockId, kind: BlockKind) -> Self {
        WipBlock {
            id,
            kind,
            instructions: Vec::new(),
        }
    }
}

/// A control-flow scope tracked for `break`/`continue` resolution
/// (`Scope` = `LoopScope | SwitchScope | LabelScope`).
#[derive(Clone, Debug)]
enum Scope {
    Loop {
        label: Option<String>,
        continue_block: BlockId,
        break_block: BlockId,
    },
    Switch {
        label: Option<String>,
        break_block: BlockId,
    },
    Label {
        label: String,
        break_block: BlockId,
    },
}

/// Helper for constructing a control-flow graph (`HIRBuilder`).
pub struct HirBuilder<'a, 's> {
    completed: BTreeMap<BlockId, BasicBlock>,
    current: WipBlock,
    entry: BlockId,
    scopes: Vec<Scope>,
    exception_handler_stack: Vec<BlockId>,

    /// Interned local bindings: oxc symbol -> stable HIR identifier. Mirrors the
    /// TS `#bindings` map (keyed by Babel identifier node there). Shared across
    /// nested functions by cloning the parent's map into the child builder.
    bindings: BTreeMap<SymbolId, Identifier>,

    /// The set of binding *names* already claimed. The TS `#bindings` map is keyed
    /// by name, so this set is what `resolveBinding`'s rename loop consults
    /// (`#bindings.get(name) !== undefined`). It is kept separate from `bindings`
    /// (which oxc keys by `SymbolId`) so that adopting a nested function's claimed
    /// names — to force a later same-named outer declaration to be renamed —
    /// does *not* also leak the nested function's symbol→identifier interning into
    /// the parent (which would corrupt hoisted-binding resolution).
    claimed_names: BTreeSet<String>,

    /// The binding-collision renames performed by [`Self::resolve_binding`]: every
    /// `(symbol, resolved_name)` where the resolved name differs from the source
    /// name. Mirrors the TS `babelBinding.scope.rename(originalName,
    /// resolvedBinding.name.value)` side-effect (`HIRBuilder.ts:292`), which mutates
    /// the *original* Babel AST. In `outputMode: 'lint'` (where the compiled
    /// function is never emitted) that mutation is the only change visible in the
    /// printed output, so the lint-mode codegen path replays these renames onto the
    /// original source. Renames bubble from nested functions to the parent (adopted
    /// after each nested lowering) so the full top-level tree's renames are
    /// collected, just like [`claimed_names`](Self::claimed_names).
    renames: Vec<(SymbolId, String)>,

    env: &'a mut Environment,
    semantic: &'s Semantic<'s>,
    /// The scope of the outermost function being compiled; its parent is "module
    /// scope" for non-local resolution (`env.parentFunction.scope`).
    root_fn_scope: ScopeId,
    /// The scope of the *component* (outermost) function. Equals `root_fn_scope`
    /// for the top-level function; for a nested function it is inherited from the
    /// parent so context-capture (`gatherCapturedContext`) scopes the pure-scope
    /// walk up to the component, mirroring `env.parentFunction.scope`.
    component_scope: ScopeId,
    /// The captured context refs of *this* function (the symbols + first-reference
    /// locations passed in as `capturedRefs`). Nested functions inherit these
    /// (merged ahead of their own newly-captured refs), mirroring the TS
    /// `new Map([...builder.context, ...capturedContext])`.
    context: Vec<(SymbolId, SourceLocation)>,

    /// Nesting depth inside `<fbt>`/`<fbs>` JSX elements (`HIRBuilder.fbtDepth`).
    /// Incremented before lowering an fbt element's children and decremented
    /// after, so JSX-text whitespace is preserved verbatim within fbt subtrees
    /// (the fbt babel transform, which runs afterwards, has its own whitespace
    /// rules — see `BuildHIR.ts` `builder.fbtDepth > 0` branch).
    fbt_depth: usize,
}

impl<'a, 's> HirBuilder<'a, 's> {
    /// Construct a fresh builder. `bindings` seeds the binding map (used for
    /// nested functions to share their parent's interned identifiers); pass an
    /// empty map for the outermost function.
    pub fn new(
        env: &'a mut Environment,
        semantic: &'s Semantic<'s>,
        root_fn_scope: ScopeId,
        bindings: BTreeMap<SymbolId, Identifier>,
        inherited_claimed_names: BTreeSet<String>,
    ) -> Self {
        let entry = env.next_block_id();
        let current = WipBlock::new(entry, BlockKind::Block);
        // Seed the claimed-names set from the inherited bindings so a nested
        // function does not re-claim a name its parent already interned.
        // Additionally union the parent's *adopted* claimed names: in the TS
        // `HIRBuilder` the `#bindings` map is shared by reference, so a name a
        // *prior sibling* lambda claimed (added to the shared `#bindings`, but in
        // our model only carried as an adopted name on the parent — see
        // `adopt_claimed_names`) is visible to a *later sibling* lambda and forces
        // the collision rename `<name>_<index>`. Threading `inherited_claimed_names`
        // reproduces that cross-sibling visibility.
        let mut claimed_names: BTreeSet<String> = bindings
            .values()
            .filter_map(|ident| match &ident.name {
                Some(IdentifierName::Named { value }) => Some(value.clone()),
                _ => None,
            })
            .collect();
        claimed_names.extend(inherited_claimed_names);
        HirBuilder {
            completed: BTreeMap::new(),
            current,
            entry,
            scopes: Vec::new(),
            exception_handler_stack: Vec::new(),
            bindings,
            claimed_names,
            renames: Vec::new(),
            env,
            semantic,
            root_fn_scope,
            component_scope: root_fn_scope,
            context: Vec::new(),
            fbt_depth: 0,
        }
    }

    /// `builder.fbtDepth > 0`: whether lowering is currently inside an
    /// `<fbt>`/`<fbs>` subtree (JSX-text whitespace is then preserved verbatim).
    pub fn in_fbt(&self) -> bool {
        self.fbt_depth > 0
    }

    /// `builder.fbtDepth++` before lowering an fbt element's children.
    pub fn enter_fbt(&mut self) {
        self.fbt_depth += 1;
    }

    /// `builder.fbtDepth--` after lowering an fbt element's children.
    pub fn exit_fbt(&mut self) {
        self.fbt_depth -= 1;
    }

    /// The current binding map (cloned by nested-function lowering).
    pub fn bindings(&self) -> &BTreeMap<SymbolId, Identifier> {
        &self.bindings
    }

    /// The names this function (and the nested functions it has lowered so far)
    /// have claimed. Adopted by the parent after a nested function is lowered.
    pub fn claimed_names(&self) -> &BTreeSet<String> {
        &self.claimed_names
    }

    /// Adopt the names claimed by a nested function. The TS `HIRBuilder` shares its
    /// `#bindings` map *by reference* with the lambdas it lowers
    /// (`lower(expr, env, builder.bindings, ...)`), so a name a nested function
    /// claims becomes visible to the parent afterwards. Because we key `bindings`
    /// by `SymbolId` (not name), we share only the *names* back, not the
    /// symbol→identifier interning. This is what makes a name shadowed *inside* a
    /// lambda claim the bare name first, forcing a later outer declaration of the
    /// same name to be renamed `<name>_<index>` — matching the oracle.
    pub fn adopt_claimed_names(&mut self, names: BTreeSet<String>) {
        self.claimed_names.extend(names);
    }

    /// The binding-collision renames recorded by [`Self::resolve_binding`]
    /// (`(symbol, resolved_name)` pairs). See the [`renames`](Self::renames) field.
    pub fn renames(&self) -> &[(SymbolId, String)] {
        &self.renames
    }

    /// Adopt the renames a nested function recorded, so the full top-level tree's
    /// scope-rename side-effects are collected on the outermost builder (mirroring
    /// the TS shared mutation of the single Babel AST).
    pub fn adopt_renames(&mut self, renames: Vec<(SymbolId, String)>) {
        self.renames.extend(renames);
    }

    /// The current block kind (`currentBlockKind`).
    pub fn current_block_kind(&self) -> BlockKind {
        self.current.kind
    }

    /// The borrowed environment.
    pub fn environment(&self) -> &Environment {
        self.env
    }

    /// The mutable borrowed environment (for id allocation in lowering).
    pub fn environment_mut(&mut self) -> &mut Environment {
        self.env
    }

    /// The borrowed semantic result.
    pub fn semantic(&self) -> &'s Semantic<'s> {
        self.semantic
    }

    /// The root function scope.
    pub fn root_fn_scope(&self) -> ScopeId {
        self.root_fn_scope
    }

    /// The component (outermost) function scope (`env.parentFunction.scope`).
    pub fn component_scope(&self) -> ScopeId {
        self.component_scope
    }

    /// Override the component scope. Used when lowering a nested function so the
    /// child builder inherits the outermost component scope from its parent.
    pub fn set_component_scope(&mut self, scope: ScopeId) {
        self.component_scope = scope;
    }

    /// This function's captured context refs (inherited by nested functions).
    pub fn context(&self) -> &[(SymbolId, SourceLocation)] {
        &self.context
    }

    /// Record this function's captured context refs (set once from `capturedRefs`).
    pub fn set_context(&mut self, context: Vec<(SymbolId, SourceLocation)>) {
        self.context = context;
    }

    // --- id allocation -----------------------------------------------------

    /// `env.nextIdentifierId`: allocate a fresh [`IdentifierId`].
    pub fn next_identifier_id(&mut self) -> IdentifierId {
        self.env.next_identifier_id()
    }

    /// `makeTemporary(loc)`: a fresh unnamed [`Identifier`].
    pub fn make_temporary(&mut self, loc: SourceLocation) -> Identifier {
        let id = self.next_identifier_id();
        make_temporary_identifier(id, loc)
    }

    // --- instruction pushing ----------------------------------------------

    /// Push an instruction onto the current block (`push`). When inside a
    /// try/catch, a `maybe-throw` terminal + continuation block is synthesized.
    pub fn push(&mut self, instr: Instruction) {
        let loc = instr.loc.clone();
        self.current.instructions.push(instr);
        if let Some(&handler) = self.exception_handler_stack.last() {
            let continuation = self.reserve(self.current_block_kind());
            let continuation_id = continuation.id;
            self.terminate_with_continuation(
                Terminal::MaybeThrow {
                    continuation: continuation_id,
                    handler: Some(handler),
                    id: zero_id(),
                    effects: None,
                    loc,
                },
                continuation,
            );
        }
    }

    /// Run `f` with `handler` pushed as the active exception handler
    /// (`enterTryCatch`).
    pub fn enter_try_catch<F: FnOnce(&mut Self)>(&mut self, handler: BlockId, f: F) {
        self.exception_handler_stack.push(handler);
        f(self);
        self.exception_handler_stack.pop();
    }

    /// The active exception handler block, if any (`resolveThrowHandler`).
    pub fn resolve_throw_handler(&self) -> Option<BlockId> {
        self.exception_handler_stack.last().copied()
    }

    // --- block construction ------------------------------------------------

    /// Reserve a block id without making it current (`reserve`).
    pub fn reserve(&mut self, kind: BlockKind) -> WipBlock {
        WipBlock::new(self.env.next_block_id(), kind)
    }

    /// Terminate the current block, optionally starting a new one
    /// (`terminate`). Returns the terminated block's id.
    pub fn terminate(&mut self, terminal: Terminal, next_block_kind: Option<BlockKind>) -> BlockId {
        let block_id = self.current.id;
        let kind = self.current.kind;
        let instructions = std::mem::take(&mut self.current.instructions);
        self.completed.insert(
            block_id,
            BasicBlock {
                kind,
                id: block_id,
                instructions,
                terminal,
                preds: Default::default(),
                phis: Vec::new(),
            },
        );
        if let Some(next_kind) = next_block_kind {
            let next_id = self.env.next_block_id();
            self.current = WipBlock::new(next_id, next_kind);
        }
        block_id
    }

    /// Terminate the current block and set `continuation` as the new current
    /// block (`terminateWithContinuation`).
    pub fn terminate_with_continuation(&mut self, terminal: Terminal, continuation: WipBlock) {
        let block_id = self.current.id;
        let kind = self.current.kind;
        let instructions = std::mem::take(&mut self.current.instructions);
        self.completed.insert(
            block_id,
            BasicBlock {
                kind,
                id: block_id,
                instructions,
                terminal,
                preds: Default::default(),
                phis: Vec::new(),
            },
        );
        self.current = continuation;
    }

    /// Save a previously-reserved block as completed (`complete`).
    pub fn complete(&mut self, block: WipBlock, terminal: Terminal) {
        self.completed.insert(
            block.id,
            BasicBlock {
                kind: block.kind,
                id: block.id,
                instructions: block.instructions,
                terminal,
                preds: Default::default(),
                phis: Vec::new(),
            },
        );
    }

    /// Set `wip` as the current block, run `f` to populate it up to its
    /// terminal, then restore the previously-active block (`enterReserved`).
    pub fn enter_reserved<F>(&mut self, wip: WipBlock, f: F)
    where
        F: FnOnce(&mut Self) -> Terminal,
    {
        let previous = std::mem::replace(&mut self.current, wip);
        let terminal = f(self);
        let block_id = self.current.id;
        let kind = self.current.kind;
        let instructions = std::mem::take(&mut self.current.instructions);
        self.completed.insert(
            block_id,
            BasicBlock {
                kind,
                id: block_id,
                instructions,
                terminal,
                preds: Default::default(),
                phis: Vec::new(),
            },
        );
        self.current = previous;
    }

    /// Create a new block, run `f` to populate it, and return its id (`enter`).
    pub fn enter<F>(&mut self, next_block_kind: BlockKind, f: F) -> BlockId
    where
        F: FnOnce(&mut Self, BlockId) -> Terminal,
    {
        let wip = self.reserve(next_block_kind);
        let id = wip.id;
        self.enter_reserved(wip, |builder| f(builder, id));
        id
    }

    // --- control-flow scopes ----------------------------------------------

    /// Run `f` within a loop scope (`loop`).
    pub fn loop_scope<F, T>(
        &mut self,
        label: Option<String>,
        continue_block: BlockId,
        break_block: BlockId,
        f: F,
    ) -> T
    where
        F: FnOnce(&mut Self) -> T,
    {
        self.scopes.push(Scope::Loop {
            label,
            continue_block,
            break_block,
        });
        let value = f(self);
        self.scopes.pop();
        value
    }

    /// Run `f` within a switch scope (`switch`).
    pub fn switch_scope<F, T>(&mut self, label: Option<String>, break_block: BlockId, f: F) -> T
    where
        F: FnOnce(&mut Self) -> T,
    {
        self.scopes.push(Scope::Switch { label, break_block });
        let value = f(self);
        self.scopes.pop();
        value
    }

    /// Run `f` within a label scope (`label`).
    pub fn label_scope<F, T>(&mut self, label: String, break_block: BlockId, f: F) -> T
    where
        F: FnOnce(&mut Self) -> T,
    {
        self.scopes.push(Scope::Label { label, break_block });
        let value = f(self);
        self.scopes.pop();
        value
    }

    /// Resolve the target block of a `break` (`lookupBreak`).
    pub fn lookup_break(&self, label: Option<&str>) -> Option<BlockId> {
        for scope in self.scopes.iter().rev() {
            match scope {
                Scope::Loop {
                    label: lbl,
                    break_block,
                    ..
                } => {
                    if label.is_none() || label == lbl.as_deref() {
                        return Some(*break_block);
                    }
                }
                Scope::Switch {
                    label: lbl,
                    break_block,
                } => {
                    if label.is_none() || label == lbl.as_deref() {
                        return Some(*break_block);
                    }
                }
                Scope::Label {
                    label: lbl,
                    break_block,
                } => {
                    if label == Some(lbl.as_str()) {
                        return Some(*break_block);
                    }
                }
            }
        }
        None
    }

    /// Resolve the target block of a `continue` (`lookupContinue`).
    pub fn lookup_continue(&self, label: Option<&str>) -> Option<BlockId> {
        for scope in self.scopes.iter().rev() {
            if let Scope::Loop {
                label: lbl,
                continue_block,
                ..
            } = scope
            {
                if label.is_none() || label == lbl.as_deref() {
                    return Some(*continue_block);
                }
            }
        }
        None
    }

    // --- binding resolution ------------------------------------------------

    /// `resolveIdentifier`: map a reference (`name` + resolved `symbol`) to a
    /// [`VariableBinding`]. Local symbols are interned via [`Self::resolve_binding`].
    pub fn resolve_identifier(
        &mut self,
        name: &str,
        symbol: Option<SymbolId>,
        loc: SourceLocation,
    ) -> VariableBinding {
        // Use the *component* scope (the outermost function) as the boundary for
        // non-local resolution, matching the TS `env.parentFunction.scope`. For a
        // top-level function this equals `root_fn_scope`; for a nested function it
        // is the component scope inherited from the parent, so an outer-scope
        // binding resolves to a local (captured) identifier instead of being
        // misclassified as module-local.
        let resolved = resolve_identifier(self.semantic, self.component_scope, name, symbol);
        match resolved {
            ResolvedReference::Local {
                symbol,
                name,
                binding_kind,
            } => {
                let identifier = self.resolve_binding(symbol, &name, loc);
                VariableBinding::Identifier {
                    identifier,
                    binding_kind,
                }
            }
            ResolvedReference::NonLocal(binding) => VariableBinding::NonLocal(binding),
        }
    }

    /// `resolveBinding`: intern an oxc symbol into a stable HIR [`Identifier`],
    /// allocating a fresh [`IdentifierId`] on first encounter. Repeated lookups
    /// of the same symbol return the same identifier (id + name).
    pub fn resolve_binding(
        &mut self,
        symbol: SymbolId,
        name: &str,
        loc: SourceLocation,
    ) -> Identifier {
        if let Some(existing) = self.bindings.get(&symbol) {
            return existing.clone();
        }
        // Mirror TS `HIRBuilder.resolveBinding`, whose `#bindings` map is keyed by
        // *name*: when a fresh binding's source name is already claimed by a
        // different binding (i.e. the source shadows an outer name), the new
        // binding is renamed `<original>_<index>` (index starting at 0,
        // incrementing until free). oxc instead gives shadowing declarations
        // distinct `SymbolId`s, so without this step the second `a` would keep the
        // bare name `a` and only later get a `$N` suffix from `RenameVariables` —
        // diverging from the oracle's HIR-build-time `a_0`. We reproduce the
        // name-collision rename here so the binding carries `a_0` from the start.
        let resolved_name = self.unique_binding_name(name);
        // `HIRBuilder.ts:290-292`: when the resolved name differs from the source
        // name, the TS compiler renames the binding in the *original* Babel AST
        // (`babelBinding.scope.rename(originalName, resolvedBinding.name.value)`).
        // Record the rename so the lint-mode codegen can replay it onto the source
        // (where the compiled function is never emitted, so this is the only
        // visible change).
        if resolved_name != name {
            self.renames.push((symbol, resolved_name.clone()));
        }
        let id = self.next_identifier_id();
        let identifier = Identifier {
            id,
            declaration_id: DeclarationId::new(id.as_u32()),
            name: Some(IdentifierName::Named {
                value: resolved_name.clone(),
            }),
            mutable_range: MutableRange::default(),
            scope: None,
            range_scope: None,
            type_: self.make_type(),
            loc,
        };
        self.bindings.insert(symbol, identifier.clone());
        self.claimed_names.insert(resolved_name);
        identifier
    }

    /// Find a binding name unique among the claimed names, matching the TS
    /// `while (this.#bindings.get(name) !== undefined) name =
    /// \`${originalName}_${index++}\`` loop. `original` keeps the bare name if it
    /// is free; otherwise it gets `_0`, `_1`, ... until unique.
    fn unique_binding_name(&self, original: &str) -> String {
        if !self.claimed_names.contains(original) {
            return original.to_string();
        }
        let mut index = 0usize;
        loop {
            let candidate = format!("{original}_{index}");
            if !self.claimed_names.contains(&candidate) {
                return candidate;
            }
            index += 1;
        }
    }

    /// `isContextIdentifier`: whether the symbol is a captured context variable
    /// (and not a module-scope binding).
    pub fn is_context_identifier(&self, symbol: Option<SymbolId>) -> bool {
        let Some(symbol) = symbol else {
            return false;
        };
        // Module-scope bindings are never context identifiers. The module scope
        // is the parent of the *component* (outermost) function scope.
        let scoping = self.semantic.scoping();
        let module_scope = scoping.scope_parent_id(self.component_scope);
        if module_scope == Some(scoping.symbol_scope_id(symbol)) {
            return false;
        }
        self.env.is_context_identifier(symbol)
    }

    /// `Environment.isHoistedIdentifier`: whether `symbol` was already hoisted by
    /// the TDZ-hoisting pass.
    pub fn is_hoisted_identifier(&self, symbol: SymbolId) -> bool {
        self.env.is_hoisted_identifier(symbol)
    }

    /// `Environment.addHoistedIdentifier`: record `symbol` as hoisted (so later
    /// references become context loads/stores and it is not hoisted twice).
    pub fn add_hoisted_identifier(&mut self, symbol: SymbolId) {
        self.env.add_hoisted_identifier(symbol);
    }

    /// The oxc scoping table (for scope/binding lookups during hoisting).
    pub fn scoping(&self) -> &oxc::semantic::Scoping {
        self.semantic.scoping()
    }

    /// `makeType()`: a fresh abstract type variable. Stage-1 printing renders
    /// every type as `<unknown>` and the `$id` parity only tracks identifier
    /// ids, so temporaries share a single type-variable id (`0`).
    pub fn make_type(&mut self) -> Type {
        Type::var(crate::hir::ids::TypeId::new(0))
    }

    // --- build -------------------------------------------------------------

    /// Finalize the CFG (`build`): reverse-postorder the blocks, prune
    /// unreachable for-updates / dead do-while / unnecessary try-catch, then
    /// number instructions and mark predecessors. The second element is the
    /// recoverable Todo `HIRBuilder.build()` records for a function with
    /// unreachable code that may contain hoisted declarations (a
    /// `FunctionExpression` in a pruned block); when present the caller bails the
    /// whole function, leaving the source untouched.
    pub fn build(self) -> (Hir, Option<SourceLocation>) {
        build_hir(self.entry, self.completed)
    }
}

/// `makeTemporaryIdentifier(id, loc)` without a type variable allocation. The
/// real TS calls `makeType()` (allocating a fresh type id); since stage-1
/// printing renders every type as `<unknown>` and we do not track type ids in
/// `$id` parity, temporaries use [`Type::Poly`]-free [`Type::Var`] with id `0`.
fn make_temporary_identifier(id: IdentifierId, loc: SourceLocation) -> Identifier {
    Identifier::make_temporary(id, crate::hir::ids::TypeId::new(0), loc)
}

/// A placeholder [`crate::hir::ids::InstructionId`] (`makeInstructionId(0)`);
/// real ids are assigned by `mark_instruction_ids` during [`HirBuilder::build`].
pub fn zero_id() -> crate::hir::ids::InstructionId {
    crate::hir::ids::InstructionId::new(0)
}

/// Build a temporary [`Place`] referencing a fresh [`Identifier`]
/// (`buildTemporaryPlace`): effect `Unknown`, non-reactive.
pub fn build_temporary_place(builder: &mut HirBuilder<'_, '_>, loc: SourceLocation) -> Place {
    Place {
        identifier: builder.make_temporary(loc.clone()),
        effect: Effect::Unknown,
        reactive: false,
        loc,
    }
}

/// A `goto` terminal with the [`GotoVariant::Break`] variant.
pub fn goto_break(block: BlockId, loc: SourceLocation) -> Terminal {
    Terminal::Goto {
        block,
        variant: GotoVariant::Break,
        id: zero_id(),
        loc,
    }
}

/// A `goto` terminal with the [`GotoVariant::Continue`] variant.
pub fn goto_continue(block: BlockId, loc: SourceLocation) -> Terminal {
    Terminal::Goto {
        block,
        variant: GotoVariant::Continue,
        id: zero_id(),
        loc,
    }
}
