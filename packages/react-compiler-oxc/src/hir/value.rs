//! Instruction values (`InstructionValue` and its constituent types in
//! `HIR/HIR.ts`): primitives, patterns, object/array expressions, calls,
//! property access, JSX, function expressions, memoization markers, etc.

use super::model::HirFunction;
use super::place::{Place, SourceLocation, Type};

/// `InstructionKind` (`HIR/HIR.ts`) — how an lvalue is being bound/written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstructionKind {
    /// `const` declaration.
    Const,
    /// `let` declaration.
    Let,
    /// Reassignment of an existing `let` binding.
    Reassign,
    /// `catch` clause binding.
    Catch,
    /// Hoisted `const` declaration.
    HoistedConst,
    /// Hoisted `let` declaration.
    HoistedLet,
    /// Hoisted function declaration.
    HoistedFunction,
    /// Function declaration.
    Function,
}

impl InstructionKind {
    /// `convertHoistedLValueKind(kind)`: maps `Hoisted*` kinds to their realized
    /// kind (`HoistedConst -> Const`, …), and returns `None` for an already-real
    /// kind. Used by `PruneHoistedContexts` to detect hoisted declarations.
    pub fn convert_hoisted_lvalue_kind(self) -> Option<InstructionKind> {
        match self {
            InstructionKind::HoistedLet => Some(InstructionKind::Let),
            InstructionKind::HoistedConst => Some(InstructionKind::Const),
            InstructionKind::HoistedFunction => Some(InstructionKind::Function),
            InstructionKind::Let
            | InstructionKind::Const
            | InstructionKind::Function
            | InstructionKind::Reassign
            | InstructionKind::Catch => None,
        }
    }

    /// The string spelling used by `PrintHIR`.
    pub fn as_str(self) -> &'static str {
        match self {
            InstructionKind::Const => "Const",
            InstructionKind::Let => "Let",
            InstructionKind::Reassign => "Reassign",
            InstructionKind::Catch => "Catch",
            InstructionKind::HoistedConst => "HoistedConst",
            InstructionKind::HoistedLet => "HoistedLet",
            InstructionKind::HoistedFunction => "HoistedFunction",
            InstructionKind::Function => "Function",
        }
    }
}

/// A constant primitive value (`Primitive` / the `Primitive` instruction value
/// in `HIR/HIR.ts`). `undefined` and `null` are distinct variants.
#[derive(Clone, Debug, PartialEq)]
pub enum PrimitiveValue {
    /// A numeric literal.
    Number(f64),
    /// A boolean literal.
    Boolean(bool),
    /// A string literal.
    String(String),
    /// The `null` literal.
    Null,
    /// The `undefined` value.
    Undefined,
}

/// A property name literal (`PropertyLiteral` in `HIR/HIR.ts`): a string or a
/// numeric index.
#[derive(Clone, Debug, PartialEq)]
pub enum PropertyLiteral {
    /// A string property name.
    String(String),
    /// A numeric property index.
    Number(f64),
}

/// An lvalue: a [`Place`] bound with a given [`InstructionKind`] (`LValue`).
#[derive(Clone, Debug, PartialEq)]
pub struct LValue {
    /// The place being written.
    pub place: Place,
    /// How the place is bound.
    pub kind: InstructionKind,
}

/// An lvalue that destructures into a [`Pattern`] (`LValuePattern`).
#[derive(Clone, Debug, PartialEq)]
pub struct LValuePattern {
    /// The destructuring pattern.
    pub pattern: Pattern,
    /// How the bound places are bound.
    pub kind: InstructionKind,
}

/// A spread element in a pattern or collection (`SpreadPattern`).
#[derive(Clone, Debug, PartialEq)]
pub struct SpreadPattern {
    /// The spread place.
    pub place: Place,
}

/// A destructuring pattern (`Pattern` = `ArrayPattern | ObjectPattern`).
#[derive(Clone, Debug, PartialEq)]
pub enum Pattern {
    /// `[a, b, ...rest]`.
    Array(ArrayPattern),
    /// `{a, b, ...rest}`.
    Object(ObjectPattern),
}

/// `ArrayPattern` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ArrayPattern {
    /// The destructured items (place / spread / hole).
    pub items: Vec<ArrayPatternItem>,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// One item of an [`ArrayPattern`] (`Place | SpreadPattern | Hole`).
#[derive(Clone, Debug, PartialEq)]
pub enum ArrayPatternItem {
    /// A bound place.
    Place(Place),
    /// A `...rest` element.
    Spread(SpreadPattern),
    /// An elision/hole.
    Hole,
}

/// `ObjectPattern` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectPattern {
    /// The destructured properties (property / spread).
    pub properties: Vec<ObjectPatternProperty>,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// One property of an [`ObjectPattern`] (`ObjectProperty | SpreadPattern`).
#[derive(Clone, Debug, PartialEq)]
pub enum ObjectPatternProperty {
    /// A `key: place` property.
    Property(ObjectProperty),
    /// A `...rest` element.
    Spread(SpreadPattern),
}

/// The key of an [`ObjectProperty`] (`ObjectPropertyKey` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum ObjectPropertyKey {
    /// `{kind: 'string', name}`.
    String {
        /// The quoted key.
        name: String,
    },
    /// `{kind: 'identifier', name}`.
    Identifier {
        /// The identifier key.
        name: String,
    },
    /// `{kind: 'computed', name}`.
    Computed {
        /// The place evaluated for the key.
        name: Place,
    },
    /// `{kind: 'number', name}`.
    Number {
        /// The numeric key.
        name: f64,
    },
}

/// Whether an [`ObjectProperty`] is a data property or a method (`'property' |
/// 'method'`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PropertyType {
    /// A data property.
    Property,
    /// A method.
    Method,
}

/// `ObjectProperty` in `HIR/HIR.ts`.
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectProperty {
    /// The property key.
    pub key: ObjectPropertyKey,
    /// Whether the property is data or a method.
    pub property_type: PropertyType,
    /// The place holding the property's value.
    pub place: Place,
}

/// One element of an array literal (`Place | SpreadPattern | Hole`).
#[derive(Clone, Debug, PartialEq)]
pub enum ArrayElement {
    /// An element value.
    Place(Place),
    /// A `...spread` element.
    Spread(SpreadPattern),
    /// An elision/hole (`[1, , 3]`).
    Hole,
}

/// One property of an object literal (`ObjectProperty | SpreadPattern`).
#[derive(Clone, Debug, PartialEq)]
pub enum ObjectExpressionProperty {
    /// A `key: value` (or method) property.
    Property(ObjectProperty),
    /// A `...spread` element.
    Spread(SpreadPattern),
}

/// One argument to a call/new (`Place | SpreadPattern`).
#[derive(Clone, Debug, PartialEq)]
pub enum CallArgument {
    /// A positional argument.
    Place(Place),
    /// A `...spread` argument.
    Spread(SpreadPattern),
}

/// A function lowered to HIR form (`LoweredFunction`).
#[derive(Clone, Debug, PartialEq)]
pub struct LoweredFunction {
    /// The lowered function body.
    pub func: HirFunction,
}

/// The syntactic origin of a [`InstructionValue::FunctionExpression`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FunctionExpressionType {
    /// `() => ...`.
    ArrowFunctionExpression,
    /// `function () { ... }` expression.
    FunctionExpression,
    /// `function f() { ... }` declaration.
    FunctionDeclaration,
}

impl FunctionExpressionType {
    /// The string spelling of this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            FunctionExpressionType::ArrowFunctionExpression => "ArrowFunctionExpression",
            FunctionExpressionType::FunctionExpression => "FunctionExpression",
            FunctionExpressionType::FunctionDeclaration => "FunctionDeclaration",
        }
    }
}

/// A builtin (lowercase) JSX tag (`BuiltinTag`).
#[derive(Clone, Debug, PartialEq)]
pub struct BuiltinTag {
    /// The tag name, e.g. `div`.
    pub name: String,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// The tag of a [`InstructionValue::JsxExpression`] (`Place | BuiltinTag`).
#[derive(Clone, Debug, PartialEq)]
pub enum JsxTag {
    /// A component referenced via a place.
    Place(Place),
    /// A builtin (host) tag.
    Builtin(BuiltinTag),
}

/// A JSX attribute (`JsxAttribute` in `HIR/HIR.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum JsxAttribute {
    /// `{...argument}`.
    Spread {
        /// The spread place.
        argument: Place,
    },
    /// `name={place}`.
    Attribute {
        /// The attribute name.
        name: String,
        /// The place holding the attribute value.
        place: Place,
    },
}

/// One quasi (raw/cooked string) of a template literal.
#[derive(Clone, Debug, PartialEq)]
pub struct TemplateQuasi {
    /// The raw (escaped) text.
    pub raw: String,
    /// The cooked text, if available.
    pub cooked: Option<String>,
}

/// TypeScript/Flow type-cast flavor (`typeAnnotationKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypeAnnotationKind {
    /// Flow `(x: T)` cast.
    Cast,
    /// TypeScript `x as T`.
    As,
    /// TypeScript `x satisfies T`.
    Satisfies,
}

/// Root of a manual-memo dependency (`ManualMemoDependency.root`).
#[derive(Clone, Debug, PartialEq)]
pub enum MemoDependencyRoot {
    /// `{kind: 'NamedLocal', value, constant}`.
    NamedLocal {
        /// The local place.
        value: Place,
        /// Whether the binding is constant.
        constant: bool,
    },
    /// `{kind: 'Global', identifierName}`.
    Global {
        /// The global identifier name.
        identifier_name: String,
    },
}

/// One entry of a manual-memo dependency path (`DependencyPathEntry`).
#[derive(Clone, Debug, PartialEq)]
pub struct DependencyPathEntry {
    /// The accessed property.
    pub property: PropertyLiteral,
    /// Whether the access was optional (`?.`).
    pub optional: bool,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// A manual-memo dependency (`ManualMemoDependency`).
#[derive(Clone, Debug, PartialEq)]
pub struct ManualMemoDependency {
    /// The dependency root.
    pub root: MemoDependencyRoot,
    /// The property path from the root.
    pub path: Vec<DependencyPathEntry>,
    /// Originating source location.
    pub loc: SourceLocation,
}

/// The value computed by an [`super::instruction::Instruction`]
/// (`InstructionValue` in `HIR/HIR.ts`). Operands are always [`Place`]s.
#[derive(Clone, Debug, PartialEq)]
pub enum InstructionValue {
    /// `LoadLocal`.
    LoadLocal {
        /// The local place being loaded.
        place: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `LoadContext`.
    LoadContext {
        /// The context place being loaded.
        place: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `StoreLocal`.
    StoreLocal {
        /// The lvalue being written.
        lvalue: LValue,
        /// The value being stored.
        value: Place,
        /// Optional type annotation (stubbed as text).
        type_annotation: Option<String>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `LoadGlobal`.
    LoadGlobal {
        /// The non-local binding being loaded.
        binding: NonLocalBinding,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `StoreGlobal`.
    StoreGlobal {
        /// The global name being written.
        name: String,
        /// The value being stored.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `DeclareLocal`.
    DeclareLocal {
        /// The lvalue being declared.
        lvalue: LValue,
        /// Optional type annotation (stubbed as text).
        type_annotation: Option<String>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `DeclareContext`. The lvalue kind is restricted to `Let`/`HoistedConst`/
    /// `HoistedLet`/`HoistedFunction` by the TS model.
    DeclareContext {
        /// How the context place is declared.
        kind: InstructionKind,
        /// The context place being declared.
        place: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `StoreContext`. The lvalue kind is restricted to `Reassign`/`Const`/
    /// `Let`/`Function` by the TS model.
    StoreContext {
        /// How the context place is bound.
        kind: InstructionKind,
        /// The context place being written.
        place: Place,
        /// The value being stored.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `Destructure`.
    Destructure {
        /// The destructuring lvalue pattern.
        lvalue: LValuePattern,
        /// The value being destructured.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `Primitive`.
    Primitive {
        /// The constant value.
        value: PrimitiveValue,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `JSXText`.
    JsxText {
        /// The raw text value.
        value: String,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `BinaryExpression`.
    BinaryExpression {
        /// The operator (textual, e.g. `+`).
        operator: String,
        /// The left operand.
        left: Place,
        /// The right operand.
        right: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `UnaryExpression`.
    UnaryExpression {
        /// The operator (textual, e.g. `!`).
        operator: String,
        /// The operand.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `NewExpression`.
    NewExpression {
        /// The constructor place.
        callee: Place,
        /// The constructor arguments.
        args: Vec<CallArgument>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `CallExpression`.
    CallExpression {
        /// The callee place.
        callee: Place,
        /// The arguments.
        args: Vec<CallArgument>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `MethodCall`.
    MethodCall {
        /// The receiver place.
        receiver: Place,
        /// The method property (a temporary produced by a property load).
        property: Place,
        /// The arguments.
        args: Vec<CallArgument>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `TypeCastExpression`.
    TypeCastExpression {
        /// The value being cast.
        value: Place,
        /// The cast-to type.
        type_: Type,
        /// The type annotation text.
        type_annotation: String,
        /// The cast flavor.
        type_annotation_kind: TypeAnnotationKind,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `JsxExpression`.
    JsxExpression {
        /// The element/component tag.
        tag: JsxTag,
        /// The attributes/props.
        props: Vec<JsxAttribute>,
        /// The children (`None` === no children).
        children: Option<Vec<Place>>,
        /// Originating source location.
        loc: SourceLocation,
        /// Source location of the opening element.
        opening_loc: SourceLocation,
        /// Source location of the closing element.
        closing_loc: SourceLocation,
    },
    /// `ObjectExpression`.
    ObjectExpression {
        /// The properties.
        properties: Vec<ObjectExpressionProperty>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ObjectMethod`.
    ObjectMethod {
        /// The lowered method body.
        lowered_func: Box<LoweredFunction>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ArrayExpression`.
    ArrayExpression {
        /// The elements (place / spread / hole).
        elements: Vec<ArrayElement>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `JsxFragment`.
    JsxFragment {
        /// The fragment children.
        children: Vec<Place>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `RegExpLiteral`.
    RegExpLiteral {
        /// The pattern source.
        pattern: String,
        /// The flags.
        flags: String,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `MetaProperty` (e.g. `import.meta`).
    MetaProperty {
        /// The meta object (e.g. `import`).
        meta: String,
        /// The property (e.g. `meta`).
        property: String,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `PropertyStore` — `object.property = value`.
    PropertyStore {
        /// The receiver object.
        object: Place,
        /// The property name.
        property: PropertyLiteral,
        /// The value being stored.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `PropertyLoad` — `object.property`.
    PropertyLoad {
        /// The receiver object.
        object: Place,
        /// The property name.
        property: PropertyLiteral,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `PropertyDelete` — `delete object.property`.
    PropertyDelete {
        /// The receiver object.
        object: Place,
        /// The property name.
        property: PropertyLiteral,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ComputedStore` — `object[index] = value`.
    ComputedStore {
        /// The receiver object.
        object: Place,
        /// The computed property place.
        property: Place,
        /// The value being stored.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ComputedLoad` — `object[index]`.
    ComputedLoad {
        /// The receiver object.
        object: Place,
        /// The computed property place.
        property: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `ComputedDelete` — `delete object[property]`.
    ComputedDelete {
        /// The receiver object.
        object: Place,
        /// The computed property place.
        property: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `FunctionExpression`.
    FunctionExpression {
        /// The function name, if any.
        name: Option<String>,
        /// A name hint for anonymous functions.
        name_hint: Option<String>,
        /// The lowered function.
        lowered_func: Box<LoweredFunction>,
        /// The syntactic origin.
        function_type: FunctionExpressionType,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `TaggedTemplateExpression`.
    TaggedTemplateExpression {
        /// The tag place.
        tag: Place,
        /// The (single) template quasi.
        value: TemplateQuasi,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `TemplateLiteral`.
    TemplateLiteral {
        /// The interpolated subexpression places.
        subexprs: Vec<Place>,
        /// The static quasis.
        quasis: Vec<TemplateQuasi>,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `Await`.
    Await {
        /// The awaited value.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `GetIterator`.
    GetIterator {
        /// The collection being iterated.
        collection: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `IteratorNext`.
    IteratorNext {
        /// The iterator created with `GetIterator`.
        iterator: Place,
        /// The collection being iterated.
        collection: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `NextPropertyOf`.
    NextPropertyOf {
        /// The collection.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `PrefixUpdate` — `++x` / `--x`.
    PrefixUpdate {
        /// The updated lvalue.
        lvalue: Place,
        /// The operator (textual, `++` / `--`).
        operation: String,
        /// The value prior to the update.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `PostfixUpdate` — `x++` / `x--`.
    PostfixUpdate {
        /// The updated lvalue.
        lvalue: Place,
        /// The operator (textual, `++` / `--`).
        operation: String,
        /// The value after the update.
        value: Place,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `Debugger` statement.
    Debugger {
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `StartMemoize` marker.
    StartMemoize {
        /// Matches the paired `FinishMemoize`.
        manual_memo_id: u32,
        /// The dependency list, or `None` if not provided.
        deps: Option<Vec<ManualMemoDependency>>,
        /// Source location of the dependencies argument.
        deps_loc: Option<SourceLocation>,
        /// Whether the deps list was invalid.
        has_invalid_deps: bool,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `FinishMemoize` marker.
    FinishMemoize {
        /// Matches the paired `StartMemoize`.
        manual_memo_id: u32,
        /// The memoized declaration place.
        decl: Place,
        /// Whether the memoization was pruned.
        pruned: bool,
        /// Originating source location.
        loc: SourceLocation,
    },
    /// `UnsupportedNode` — a node the compiler does not lower, preserved
    /// verbatim through codegen.
    UnsupportedNode {
        /// The node's source text, re-emitted verbatim by codegen.
        node: String,
        /// The Babel AST node *type* (e.g. `TSEnumDeclaration`). `PrintHIR.ts`
        /// prints `UnsupportedNode ${node.type}`, so the HIR dump shows the type
        /// name, not the source text.
        node_type: String,
        /// Whether `node` is a *statement* (e.g. a `TSEnumDeclaration`) rather
        /// than an expression. Statement-kind unsupported nodes are emitted
        /// verbatim as a statement by codegen, mirroring
        /// `CodegenReactiveFunction.ts`'s `codegenInstruction`
        /// (`if (t.isStatement(value)) return value`) and its `UnsupportedNode`
        /// case (`if (!t.isExpression(node)) return node`).
        is_statement: bool,
        /// Originating source location.
        loc: SourceLocation,
    },
}

/// A binding declared outside the current component/hook (`NonLocalBinding`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NonLocalBinding {
    /// `import Foo from 'foo'`.
    ImportDefault {
        /// The local name.
        name: String,
        /// The module specifier.
        module: String,
    },
    /// `import * as Foo from 'foo'`.
    ImportNamespace {
        /// The local name.
        name: String,
        /// The module specifier.
        module: String,
    },
    /// `import {bar as baz} from 'foo'`.
    ImportSpecifier {
        /// The local name (`baz`).
        name: String,
        /// The module specifier (`foo`).
        module: String,
        /// The imported name (`bar`).
        imported: String,
    },
    /// A module-local binding outside the current component/hook.
    ModuleLocal {
        /// The local name.
        name: String,
    },
    /// An unresolved/global binding.
    Global {
        /// The global name.
        name: String,
    },
}

/// A variable binding (`VariableBinding`): either a local [`Identifier`] (with
/// its Babel `BindingKind`) or a [`NonLocalBinding`].
#[derive(Clone, Debug, PartialEq)]
pub enum VariableBinding {
    /// A local binding.
    Identifier {
        /// The bound identifier.
        identifier: super::place::Identifier,
        /// The Babel binding kind (stubbed as text in stage 1).
        binding_kind: String,
    },
    /// A non-local binding.
    NonLocal(NonLocalBinding),
}
