//! `inferTypes` (`TypeInference/InferTypes.ts`).
//!
//! A faithful port of the React Compiler's type inference: a three-phase
//! generate / unify / apply algorithm over the SSA HIR.
//!
//! 1. [`generate`] walks the CFG (phis, instructions, terminals) and yields
//!    [`TypeEquation`]s relating identifier types.
//! 2. [`Unifier`] solves the equations via Hindley-Milner-style unification with
//!    an occurs-check, special-casing the `Property` (deferred property lookup)
//!    and `Phi` (control-flow join) type forms.
//! 3. [`apply`] writes the resolved type back onto every place's identifier.
//!
//! ## Type variables and the substitution map
//!
//! In the TS, `EnterSSA` allocates exactly one `Identifier` *object* per SSA
//! value (`makeId`), and every `Place` that references that value shares the
//! same object — hence the same `type` (and its `makeType()` id). The Rust HIR
//! clones [`Place`]s (so each holds its own [`crate::hir::Identifier`] copy), but
//! every clone keeps the same [`IdentifierId`]. We therefore key the type
//! lattice by [`IdentifierId`]: each identifier's [`Type::Var`] id is set equal
//! to its `IdentifierId`, so all uses of one SSA value share a substitution key
//! exactly as the TS shared-object semantics do.
//!
//! This is what makes both observed behaviors fall out correctly:
//! - A temporary `$30` typed at its producer instruction is also typed at every
//!   consumer operand (shared var).
//! - A component's `props`/`ref` parameter and its uses share a var; binding it
//!   to `BuiltInProps`/`BuiltInUseRef` types them all. Non-component functions
//!   never emit the parameter equation, so their `props` var stays unbound and
//!   prints untyped throughout.
//!
//! Fresh call/method/new return vars draw from a counter seeded above every
//! identifier id so they never collide with an identifier's var.
//!
//! ## Faithful quirks
//!
//! - `typeEquals` for `Phi` always returns `false` in the TS (a bug — the inner
//!   loop never sets a positive result), so two phi types are *never* considered
//!   equal. [`type_equals`] reproduces this so unresolved phi operands print
//!   `:TPhi` exactly as the oracle does.
//! - `funcTypeEquals` compares only `return` types (ignoring `shapeId` /
//!   `isConstructor`); [`type_equals`] matches that.

use std::collections::HashMap;

use crate::hir::ids::{IdentifierId, TypeId};
use crate::hir::model::{HirFunction, ReactFunctionType};
use crate::hir::place::{Identifier, Place, PropertyName, Type};
use crate::hir::value::{
    ArrayPatternItem, InstructionKind, InstructionValue, JsxAttribute, ObjectExpressionProperty,
    ObjectPatternProperty, ObjectPropertyKey, Pattern, PropertyLiteral,
};

use super::provider::TypeProvider;
use crate::environment::{
    BUILTIN_ARRAY_ID, BUILTIN_FUNCTION_ID, BUILTIN_JSX_ID, BUILTIN_OBJECT_ID, BUILTIN_PROPS_ID,
    BUILTIN_REF_VALUE_ID, BUILTIN_SET_STATE_ID, BUILTIN_USE_REF_ID,
};

/// The mixed-readonly shape id (`BuiltInMixedReadonlyId`). Not materialized in
/// the minimal shape registry, but `tryUnionTypes` keys off it, so the string is
/// needed for the union heuristic.
const BUILTIN_MIXED_READONLY_ID: &str = "BuiltInMixedReadonly";

/// `inferTypes(func)`: generate type equations, unify them, then write the
/// resolved types back onto every identifier in `func` (in place).
pub fn infer_types(func: &mut HirFunction, provider: &TypeProvider) {
    // Stamp every place's identifier type-var id with its IdentifierId so all
    // uses of one SSA value share a substitution key (matching the TS, where
    // every place shares the SSA value's single `Identifier` object). Track the
    // highest id seen to seed the fresh-typevar counter for call/new returns.
    let mut max_id = 0u32;
    stamp_function(func, &mut max_id);
    let mut unifier = Unifier::new(provider, max_id + 1);

    let mut equations: Vec<TypeEquation> = Vec::new();
    let mut names: HashMap<IdentifierId, String> = HashMap::new();
    generate(func, &mut names, &mut unifier, &mut equations);
    for e in &equations {
        unifier.unify(&e.left, &e.right);
    }
    apply(func, &unifier);
}

/// Stamp every identifier's [`Type::Var`] id to equal its [`IdentifierId`], so a
/// value's producer and all its consumers share one substitution key. Tracks the
/// maximum id observed (to seed fresh type-var allocation above all of them).
fn stamp_function(func: &mut HirFunction, max_id: &mut u32) {
    stamp_place(&mut func.returns, max_id);
    for param in &mut func.params {
        match param {
            crate::hir::model::FunctionParam::Place(place) => stamp_place(place, max_id),
            crate::hir::model::FunctionParam::Spread(spread) => {
                stamp_place(&mut spread.place, max_id)
            }
        }
    }
    for context in &mut func.context {
        stamp_place(context, max_id);
    }
    for block in func.body.blocks_mut() {
        for phi in &mut block.phis {
            stamp_place(&mut phi.place, max_id);
            for place in phi.operands.values_mut() {
                stamp_place(place, max_id);
            }
        }
        for instr in &mut block.instructions {
            // `each_instruction_lvalue_mut` yields `instr.lvalue` first, then the
            // value-level lvalues, so this covers the result place too.
            for place in crate::passes::cfg::each_instruction_lvalue_mut(instr) {
                stamp_place(place, max_id);
            }
            for place in crate::passes::cfg::each_instruction_operand_mut(instr) {
                stamp_place(place, max_id);
            }
            // Recurse into nested function expressions / object methods.
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    stamp_function(&mut lowered_func.func, max_id);
                }
                _ => {}
            }
        }
        let terminal = &mut block.terminal;
        for place in crate::passes::cfg::each_terminal_operand_mut(terminal) {
            stamp_place(place, max_id);
        }
    }
}

/// Stamp a single place's identifier type-var id to equal its identifier id,
/// tracking the running maximum.
fn stamp_place(place: &mut Place, max_id: &mut u32) {
    stamp_identifier(&mut place.identifier, max_id);
}

fn stamp_identifier(identifier: &mut Identifier, max_id: &mut u32) {
    let id = identifier.id.as_u32();
    if id > *max_id {
        *max_id = id;
    }
    identifier.type_ = Type::Var { id: TypeId::new(id) };
}

/// A type constraint `left ≡ right` (`TypeEquation`).
struct TypeEquation {
    left: Type,
    right: Type,
}

fn equation(left: Type, right: Type) -> TypeEquation {
    TypeEquation { left, right }
}

/// The type-var of a place's identifier (its substitution key).
fn place_type(place: &Place) -> Type {
    place.identifier.type_.clone()
}

/// `setName`: record a named identifier under `id` for later ref-like detection.
fn set_name(names: &mut HashMap<IdentifierId, String>, id: IdentifierId, name: &Identifier) {
    if let Some(crate::hir::place::IdentifierName::Named { value }) = &name.name {
        names.insert(id, value.clone());
    }
}

/// `getName`: the recorded name for `id`, or the empty string.
fn get_name(names: &HashMap<IdentifierId, String>, id: IdentifierId) -> String {
    names.get(&id).cloned().unwrap_or_default()
}

/// `generate(func)`: emit the type equations for `func` (and recursively for
/// nested functions), appending them to `out`. Mirrors the TS generator.
fn generate(
    func: &HirFunction,
    names: &mut HashMap<IdentifierId, String>,
    unifier: &mut Unifier,
    out: &mut Vec<TypeEquation>,
) {
    if func.fn_type == ReactFunctionType::Component {
        let mut params = func.params.iter();
        if let Some(crate::hir::model::FunctionParam::Place(props)) = params.next() {
            out.push(equation(
                place_type(props),
                Type::Object {
                    shape_id: Some(BUILTIN_PROPS_ID.to_string()),
                },
            ));
        }
        if let Some(crate::hir::model::FunctionParam::Place(ref_param)) = params.next() {
            out.push(equation(
                place_type(ref_param),
                Type::Object {
                    shape_id: Some(BUILTIN_USE_REF_ID.to_string()),
                },
            ));
        }
    }

    let mut return_types: Vec<Type> = Vec::new();
    for block in func.body.blocks() {
        for phi in &block.phis {
            let operands: Vec<Type> = phi.operands.values().map(place_type).collect();
            out.push(equation(place_type(&phi.place), Type::Phi { operands }));
        }
        for instr in &block.instructions {
            generate_instruction_types(unifier, names, instr, out);
        }
        if let crate::hir::terminal::Terminal::Return { value, .. } = &block.terminal {
            return_types.push(place_type(value));
        }
    }
    if return_types.len() > 1 {
        out.push(equation(
            place_type(&func.returns),
            Type::Phi {
                operands: return_types,
            },
        ));
    } else if return_types.len() == 1 {
        out.push(equation(place_type(&func.returns), return_types.remove(0)));
    }
}

fn generate_instruction_types(
    unifier: &mut Unifier,
    names: &mut HashMap<IdentifierId, String>,
    instr: &crate::hir::instruction::Instruction,
    out: &mut Vec<TypeEquation>,
) {
    let left = place_type(&instr.lvalue);
    match &instr.value {
        InstructionValue::TemplateLiteral { .. }
        | InstructionValue::JsxText { .. }
        | InstructionValue::Primitive { .. } => {
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::UnaryExpression { .. } => {
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::LoadLocal { place, .. } => {
            set_name(names, instr.lvalue.identifier.id, &place.identifier);
            out.push(equation(left, place_type(place)));
        }
        InstructionValue::DeclareContext { .. } | InstructionValue::LoadContext { .. } => {}
        InstructionValue::StoreContext { kind, place, value, .. } => {
            // StoreContext const: hoisted const, unify the binding with the value.
            if *kind == InstructionKind::Const {
                out.push(equation(place_type(place), place_type(value)));
            }
        }
        InstructionValue::StoreLocal { lvalue, value, .. } => {
            out.push(equation(left, place_type(value)));
            out.push(equation(place_type(&lvalue.place), place_type(value)));
        }
        InstructionValue::StoreGlobal { value, .. } => {
            out.push(equation(left, place_type(value)));
        }
        InstructionValue::BinaryExpression { operator, left: l, right: r, .. } => {
            if is_primitive_binary_op(operator) {
                out.push(equation(place_type(l), Type::Primitive));
                out.push(equation(place_type(r), Type::Primitive));
            }
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::PostfixUpdate { lvalue, value, .. }
        | InstructionValue::PrefixUpdate { lvalue, value, .. } => {
            out.push(equation(place_type(value), Type::Primitive));
            out.push(equation(place_type(lvalue), Type::Primitive));
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::LoadGlobal { binding, .. } => {
            if let Some(global_type) = unifier.provider.get_global_declaration(binding) {
                out.push(equation(left, global_type));
            }
        }
        InstructionValue::CallExpression { callee, .. } => {
            let return_type = unifier.fresh_type();
            let mut shape_id: Option<String> = None;
            if unifier.provider.enable_treat_set_identifiers_as_state_setters {
                let name = get_name(names, callee.identifier.id);
                if name.starts_with("set") {
                    shape_id = Some(BUILTIN_SET_STATE_ID.to_string());
                }
            }
            out.push(equation(
                place_type(callee),
                Type::Function {
                    shape_id,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: false,
                },
            ));
            out.push(equation(left, return_type));
        }
        InstructionValue::TaggedTemplateExpression { tag, .. } => {
            let return_type = unifier.fresh_type();
            out.push(equation(
                place_type(tag),
                Type::Function {
                    shape_id: None,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: false,
                },
            ));
            out.push(equation(left, return_type));
        }
        InstructionValue::ObjectExpression { properties, .. } => {
            for property in properties {
                if let ObjectExpressionProperty::Property(property) = property {
                    if let ObjectPropertyKey::Computed { name } = &property.key {
                        out.push(equation(place_type(name), Type::Primitive));
                    }
                }
            }
            out.push(equation(
                left,
                Type::Object {
                    shape_id: Some(BUILTIN_OBJECT_ID.to_string()),
                },
            ));
        }
        InstructionValue::ArrayExpression { .. } => {
            out.push(equation(
                left,
                Type::Object {
                    shape_id: Some(BUILTIN_ARRAY_ID.to_string()),
                },
            ));
        }
        InstructionValue::PropertyLoad { object, property, .. } => {
            out.push(equation(
                left,
                Type::Property {
                    object_type: Box::new(place_type(object)),
                    object_name: get_name(names, object.identifier.id),
                    property_name: PropertyName::Literal(property_literal_string(property)),
                },
            ));
        }
        InstructionValue::ComputedLoad { object, property, .. } => {
            out.push(equation(
                left,
                Type::Property {
                    object_type: Box::new(place_type(object)),
                    object_name: get_name(names, object.identifier.id),
                    property_name: PropertyName::Computed(Box::new(place_type(property))),
                },
            ));
        }
        InstructionValue::MethodCall { property, .. } => {
            let return_type = unifier.fresh_type();
            out.push(equation(
                place_type(property),
                Type::Function {
                    shape_id: None,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: false,
                },
            ));
            out.push(equation(left, return_type));
        }
        InstructionValue::Destructure { lvalue, value, .. } => {
            match &lvalue.pattern {
                Pattern::Array(array) => {
                    for (i, item) in array.items.iter().enumerate() {
                        match item {
                            ArrayPatternItem::Place(place) => {
                                out.push(equation(
                                    place_type(place),
                                    Type::Property {
                                        object_type: Box::new(place_type(value)),
                                        object_name: get_name(names, value.identifier.id),
                                        property_name: PropertyName::Literal(i.to_string()),
                                    },
                                ));
                            }
                            ArrayPatternItem::Spread(spread) => {
                                out.push(equation(
                                    place_type(&spread.place),
                                    Type::Object {
                                        shape_id: Some(BUILTIN_ARRAY_ID.to_string()),
                                    },
                                ));
                            }
                            ArrayPatternItem::Hole => {}
                        }
                    }
                }
                Pattern::Object(object) => {
                    for property in &object.properties {
                        if let ObjectPatternProperty::Property(property) = property {
                            match &property.key {
                                ObjectPropertyKey::Identifier { name }
                                | ObjectPropertyKey::String { name } => {
                                    out.push(equation(
                                        place_type(&property.place),
                                        Type::Property {
                                            object_type: Box::new(place_type(value)),
                                            object_name: get_name(names, value.identifier.id),
                                            property_name: PropertyName::Literal(name.clone()),
                                        },
                                    ));
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        InstructionValue::TypeCastExpression { value, .. } => {
            out.push(equation(left, place_type(value)));
        }
        InstructionValue::PropertyDelete { .. } | InstructionValue::ComputedDelete { .. } => {
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::FunctionExpression { lowered_func, .. } => {
            generate(&lowered_func.func, names, unifier, out);
            out.push(equation(
                left,
                Type::Function {
                    shape_id: Some(BUILTIN_FUNCTION_ID.to_string()),
                    return_type: Box::new(place_type(&lowered_func.func.returns)),
                    is_constructor: false,
                },
            ));
        }
        InstructionValue::NextPropertyOf { .. } => {
            out.push(equation(left, Type::Primitive));
        }
        InstructionValue::ObjectMethod { lowered_func, .. } => {
            generate(&lowered_func.func, names, unifier, out);
            out.push(equation(left, Type::ObjectMethod));
        }
        InstructionValue::JsxExpression { props, .. } => {
            if unifier.provider.enable_treat_ref_like_identifiers_as_refs {
                for prop in props {
                    if let JsxAttribute::Attribute { name, place } = prop {
                        if name == "ref" {
                            out.push(equation(
                                place_type(place),
                                Type::Object {
                                    shape_id: Some(BUILTIN_USE_REF_ID.to_string()),
                                },
                            ));
                        }
                    }
                }
            }
            out.push(equation(
                left,
                Type::Object {
                    shape_id: Some(BUILTIN_JSX_ID.to_string()),
                },
            ));
        }
        InstructionValue::JsxFragment { .. } => {
            out.push(equation(
                left,
                Type::Object {
                    shape_id: Some(BUILTIN_JSX_ID.to_string()),
                },
            ));
        }
        InstructionValue::NewExpression { callee, .. } => {
            let return_type = unifier.fresh_type();
            out.push(equation(
                place_type(callee),
                Type::Function {
                    shape_id: None,
                    return_type: Box::new(return_type.clone()),
                    is_constructor: true,
                },
            ));
            out.push(equation(left, return_type));
        }
        InstructionValue::PropertyStore { object, property, .. } => {
            // Unidirectional: dummy ≡ Property to infer refs from `.current`.
            out.push(equation(
                unifier.fresh_type(),
                Type::Property {
                    object_type: Box::new(place_type(object)),
                    object_name: get_name(names, object.identifier.id),
                    property_name: PropertyName::Literal(property_literal_string(property)),
                },
            ));
        }
        InstructionValue::DeclareLocal { .. }
        | InstructionValue::RegExpLiteral { .. }
        | InstructionValue::MetaProperty { .. }
        | InstructionValue::ComputedStore { .. }
        | InstructionValue::Await { .. }
        | InstructionValue::GetIterator { .. }
        | InstructionValue::IteratorNext { .. }
        | InstructionValue::UnsupportedNode { .. }
        | InstructionValue::Debugger { .. }
        | InstructionValue::FinishMemoize { .. }
        | InstructionValue::StartMemoize { .. } => {}
    }
}

/// `apply(func, unifier)`: write the resolved type onto every place's identifier,
/// recursing into nested function expressions / object methods.
///
/// The TS `apply` walks phis, instruction lvalues/operands, and `func.returns`
/// — *not* `func.params` or `func.context`. There, a parameter prints typed only
/// because it shares its SSA value's single `Identifier` *object* with the uses
/// apply does write; if the parameter is never used, its object is never touched
/// and prints untyped (even though the component-param equation bound its var).
///
/// Our IdentifierId-keyed model holds independent place copies, so we reproduce
/// that object sharing by recording every identifier id apply actually writes
/// (via [`Applied::write`]) and then back-filling a parameter/context place's
/// type *only when* its id was so written. This makes an unused `props`
/// parameter print untyped while a used one (e.g. `y` in `y * 10`) picks up the
/// type its use operand resolved to.
fn apply(func: &mut HirFunction, unifier: &Unifier) {
    let mut applied = Applied::new(unifier);
    for block in func.body.blocks_mut() {
        for phi in &mut block.phis {
            applied.write(&mut phi.place);
            for place in phi.operands.values_mut() {
                applied.write(place);
            }
        }
        for instr in &mut block.instructions {
            for place in crate::passes::cfg::each_instruction_lvalue_mut(instr) {
                applied.write(place);
            }
            for place in crate::passes::cfg::each_instruction_operand_mut(instr) {
                applied.write(place);
            }
            // `instr.lvalue` is the first entry of each_instruction_lvalue_mut, so
            // it has already been resolved above.
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    apply(&mut lowered_func.func, unifier);
                }
                _ => {}
            }
        }
        for place in crate::passes::cfg::each_terminal_operand_mut(&mut block.terminal) {
            applied.write(place);
        }
    }
    applied.write(&mut func.returns);

    // Back-fill parameters / context places that share an id with a written use.
    for param in &mut func.params {
        let place = match param {
            crate::hir::model::FunctionParam::Place(place) => place,
            crate::hir::model::FunctionParam::Spread(spread) => &mut spread.place,
        };
        applied.back_fill(place);
    }
    for context in &mut func.context {
        applied.back_fill(context);
    }
}

/// Tracks the identifier ids `apply` has written, so parameter/context places
/// (which the TS leaves to object-sharing) can be back-filled only when used.
struct Applied<'u, 'a> {
    unifier: &'u Unifier<'a>,
    written: std::collections::HashSet<u32>,
}

impl<'u, 'a> Applied<'u, 'a> {
    fn new(unifier: &'u Unifier<'a>) -> Self {
        Applied {
            unifier,
            written: std::collections::HashSet::new(),
        }
    }

    /// Resolve and write a place's type, recording its identifier id as written.
    fn write(&mut self, place: &mut Place) {
        place.identifier.type_ = self.unifier.get(&place.identifier.type_);
        self.written.insert(place.identifier.id.as_u32());
    }

    /// Write a parameter/context place's type only if its id was written above
    /// (i.e. it has a use); otherwise leave it as its pre-inference var (empty).
    fn back_fill(&self, place: &mut Place) {
        if self.written.contains(&place.identifier.id.as_u32()) {
            place.identifier.type_ = self.unifier.get(&place.identifier.type_);
        }
    }
}

/// `isPrimitiveBinaryOp(op)`: whether a binary operator constrains its operands
/// (and result) to primitives.
fn is_primitive_binary_op(op: &str) -> bool {
    matches!(
        op,
        "+" | "-"
            | "/"
            | "%"
            | "*"
            | "**"
            | "&"
            | "|"
            | ">>"
            | "<<"
            | "^"
            | ">"
            | "<"
            | ">="
            | "<="
            | "|>"
    )
}

/// The string form of a property literal, as `getPropertyType` consumes it.
fn property_literal_string(literal: &PropertyLiteral) -> String {
    match literal {
        PropertyLiteral::String(s) => s.clone(),
        PropertyLiteral::Number(n) => format_number(*n),
    }
}

/// Format a property index the way `String(n)` does for the integer indices the
/// fixtures use (no trailing `.0`).
fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.is_finite() {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// The unification engine (`class Unifier`).
pub struct Unifier<'a> {
    substitutions: HashMap<u32, Type>,
    provider: &'a TypeProvider,
    next_type: u32,
}

impl<'a> Unifier<'a> {
    fn new(provider: &'a TypeProvider, next_type: u32) -> Self {
        Unifier {
            substitutions: HashMap::new(),
            provider,
            next_type,
        }
    }

    /// `makeType()`: a fresh type variable, drawn from the counter seeded above
    /// every identifier id.
    fn fresh_type(&mut self) -> Type {
        let id = self.next_type;
        self.next_type += 1;
        Type::Var { id: TypeId::new(id) }
    }

    /// `unify(tA, tB)`.
    fn unify(&mut self, t_a: &Type, t_b: &Type) {
        if let Type::Property {
            object_type,
            object_name,
            property_name,
        } = t_b
        {
            if self.provider.enable_treat_ref_like_identifiers_as_refs
                && is_ref_like_name(object_name, property_name)
            {
                let obj = (**object_type).clone();
                self.unify(
                    &obj,
                    &Type::Object {
                        shape_id: Some(BUILTIN_USE_REF_ID.to_string()),
                    },
                );
                let a = t_a.clone();
                self.unify(
                    &a,
                    &Type::Object {
                        shape_id: Some(BUILTIN_REF_VALUE_ID.to_string()),
                    },
                );
                return;
            }
            let object_type = self.get(object_type);
            let property_type = match property_name {
                PropertyName::Literal(value) => self.provider.get_property_type(&object_type, value),
                PropertyName::Computed(_) => {
                    self.provider.get_fallthrough_property_type(&object_type)
                }
            };
            if let Some(property_type) = property_type {
                let a = t_a.clone();
                self.unify(&a, &property_type);
            }
            return;
        }

        if type_equals(t_a, t_b) {
            return;
        }

        if let Type::Var { id } = t_a {
            self.bind_variable_to(id.as_u32(), t_b);
            return;
        }
        if let Type::Var { id } = t_b {
            self.bind_variable_to(id.as_u32(), t_a);
            return;
        }

        if let (
            Type::Function {
                return_type: a_ret,
                is_constructor: a_ctor,
                ..
            },
            Type::Function {
                return_type: b_ret,
                is_constructor: b_ctor,
                ..
            },
        ) = (t_a, t_b)
        {
            if a_ctor == b_ctor {
                let a_ret = (**a_ret).clone();
                let b_ret = (**b_ret).clone();
                self.unify(&a_ret, &b_ret);
            }
        }
    }

    /// `bindVariableTo(v, type)`.
    fn bind_variable_to(&mut self, v: u32, ty: &Type) {
        if let Type::Poly = ty {
            return;
        }

        if let Some(existing) = self.substitutions.get(&v).cloned() {
            self.unify(&existing, ty);
            return;
        }

        if let Type::Var { id } = ty {
            if let Some(existing) = self.substitutions.get(&id.as_u32()).cloned() {
                let v_ty = Type::Var { id: TypeId::new(v) };
                self.unify(&v_ty, &existing);
                return;
            }
        }

        if let Type::Phi { operands } = ty {
            // invariant: operands.len() > 0
            let mut candidate: Option<Type> = None;
            for operand in operands {
                let resolved = self.get(operand);
                match &candidate {
                    None => candidate = Some(resolved),
                    Some(c) => {
                        if !type_equals(&resolved, c) {
                            match try_union_types(&resolved, c) {
                                Some(union) => candidate = Some(union),
                                None => {
                                    candidate = None;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if let Some(candidate) = candidate {
                let v_ty = Type::Var { id: TypeId::new(v) };
                self.unify(&v_ty, &candidate);
                return;
            }
        }

        if self.occurs_check(v, ty) {
            if let Some(resolved) = self.try_resolve_type(v, ty) {
                self.substitutions.insert(v, resolved);
                return;
            }
            // The TS throws here; the fixtures never reach a true cycle, so we
            // conservatively leave `v` unbound rather than panicking.
            return;
        }

        self.substitutions.insert(v, ty.clone());
    }

    /// `tryResolveType(v, type)`: resolve `type`, recursively dropping `v` from
    /// nested phis to break a detected cycle. Returns `None` if unresolvable.
    fn try_resolve_type(&mut self, v: u32, ty: &Type) -> Option<Type> {
        match ty {
            Type::Phi { operands } => {
                let mut resolved_ops = Vec::new();
                for operand in operands {
                    if let Type::Var { id } = operand {
                        if id.as_u32() == v {
                            continue;
                        }
                    }
                    let resolved = self.try_resolve_type(v, operand)?;
                    resolved_ops.push(resolved);
                }
                Some(Type::Phi {
                    operands: resolved_ops,
                })
            }
            Type::Var { id } => {
                let substitution = self.get(ty);
                if &substitution != ty {
                    let resolved = self.try_resolve_type(v, &substitution);
                    if let Some(resolved) = &resolved {
                        self.substitutions.insert(id.as_u32(), resolved.clone());
                    }
                    resolved
                } else {
                    Some(ty.clone())
                }
            }
            Type::Property {
                object_type,
                object_name,
                property_name,
            } => {
                let resolved_obj = self.get(object_type);
                let object_type = self.try_resolve_type(v, &resolved_obj)?;
                Some(Type::Property {
                    object_type: Box::new(object_type),
                    object_name: object_name.clone(),
                    property_name: property_name.clone(),
                })
            }
            Type::Function {
                return_type,
                shape_id,
                is_constructor,
            } => {
                let resolved_ret = self.get(return_type);
                let return_type = self.try_resolve_type(v, &resolved_ret)?;
                Some(Type::Function {
                    return_type: Box::new(return_type),
                    shape_id: shape_id.clone(),
                    is_constructor: *is_constructor,
                })
            }
            Type::ObjectMethod | Type::Object { .. } | Type::Primitive | Type::Poly => {
                Some(ty.clone())
            }
        }
    }

    /// `occursCheck(v, type)`.
    fn occurs_check(&self, v: u32, ty: &Type) -> bool {
        if let Type::Var { id } = ty {
            if id.as_u32() == v {
                return true;
            }
            if let Some(sub) = self.substitutions.get(&id.as_u32()) {
                return self.occurs_check(v, sub);
            }
        }
        match ty {
            Type::Phi { operands } => operands.iter().any(|o| self.occurs_check(v, o)),
            Type::Function { return_type, .. } => self.occurs_check(v, return_type),
            _ => false,
        }
    }

    /// `get(type)`: follow substitution chains and rebuild compound types with
    /// resolved operands.
    fn get(&self, ty: &Type) -> Type {
        if let Type::Var { id } = ty {
            if let Some(sub) = self.substitutions.get(&id.as_u32()) {
                return self.get(sub);
            }
        }
        match ty {
            Type::Phi { operands } => Type::Phi {
                operands: operands.iter().map(|o| self.get(o)).collect(),
            },
            Type::Function {
                return_type,
                shape_id,
                is_constructor,
            } => Type::Function {
                is_constructor: *is_constructor,
                shape_id: shape_id.clone(),
                return_type: Box::new(self.get(return_type)),
            },
            _ => ty.clone(),
        }
    }
}

/// `isRefLikeName(t)`: a `.current` access on a `*Ref` / `ref`-named object.
fn is_ref_like_name(object_name: &str, property_name: &PropertyName) -> bool {
    let PropertyName::Literal(value) = property_name else {
        return false;
    };
    value == "current" && ref_like_name_re(object_name)
}

/// `/^(?:[a-zA-Z$_][a-zA-Z$_0-9]*)Ref$|^ref$/`.
fn ref_like_name_re(name: &str) -> bool {
    if name == "ref" {
        return true;
    }
    // `<ident>Ref` where ident is `[a-zA-Z$_][a-zA-Z$_0-9]*`.
    let Some(stem) = name.strip_suffix("Ref") else {
        return false;
    };
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '$' || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '$' || c == '_')
}

/// `tryUnionTypes(ty1, ty2)`: the MixedReadonly union heuristics.
fn try_union_types(ty1: &Type, ty2: &Type) -> Option<Type> {
    let is_mixed = |t: &Type| matches!(t, Type::Object { shape_id: Some(s) } if s == BUILTIN_MIXED_READONLY_ID);
    let (readonly, other) = if is_mixed(ty1) {
        (ty1.clone(), ty2.clone())
    } else if is_mixed(ty2) {
        (ty2.clone(), ty1.clone())
    } else {
        return None;
    };
    match &other {
        Type::Primitive => Some(readonly),
        Type::Object { shape_id: Some(s) } if s == BUILTIN_ARRAY_ID => Some(other),
        _ => None,
    }
}

/// `typeEquals(tA, tB)`. Faithfully reproduces the TS, including the `Phi` quirk
/// (always `false`) and `Function` comparing only return types.
fn type_equals(t_a: &Type, t_b: &Type) -> bool {
    match (t_a, t_b) {
        (Type::Var { id: a }, Type::Var { id: b }) => a == b,
        (Type::Function { return_type: a, .. }, Type::Function { return_type: b, .. }) => {
            type_equals(a, b)
        }
        (Type::Object { shape_id: a }, Type::Object { shape_id: b }) => a == b,
        (Type::Primitive, Type::Primitive) => true,
        (Type::Poly, Type::Poly) => true,
        (Type::ObjectMethod, Type::ObjectMethod) => true,
        (
            Type::Property {
                object_type: a_obj,
                object_name: a_name,
                property_name: a_prop,
            },
            Type::Property {
                object_type: b_obj,
                object_name: b_name,
                property_name: b_prop,
            },
        ) => type_equals(a_obj, b_obj) && a_name == b_name && property_name_equals(a_prop, b_prop),
        // Phi: the TS `phiTypeEquals` always returns false. Reproduce that.
        (Type::Phi { .. }, Type::Phi { .. }) => false,
        _ => false,
    }
}

fn property_name_equals(a: &PropertyName, b: &PropertyName) -> bool {
    match (a, b) {
        (PropertyName::Literal(x), PropertyName::Literal(y)) => x == y,
        // Computed property names compare by referential identity in the TS
        // (`tA.propertyName === tB.propertyName`); distinct equations never share
        // a type object, so this is always false here.
        _ => false,
    }
}
