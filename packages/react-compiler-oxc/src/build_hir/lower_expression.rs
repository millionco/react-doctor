//! Expression lowering (`lowerExpression` in `BuildHIR.ts`).
//!
//! Part 2 fills in the full expression dispatch: member access, calls / new /
//! method calls, optional chaining (`?.`), binary / logical / unary / update,
//! assignment + compound assignment, conditional (ternary), object / array
//! literals, template + tagged-template literals, sequence, JSX, nested
//! arrow / function expressions (with `@context` capture), spread args, await,
//! and the leaf forms (literals + identifier loads) carried over from part 1.
//!
//! The single most important fidelity property is **id-allocation order**: every
//! temporary / identifier / block id is allocated at the same point as the TS
//! lowering so the printed `$id` / `bbN` / `[i]` numbers match the parity oracle.

use oxc::ast::ast::{
    Argument, ArrayExpressionElement, AssignmentExpression, AssignmentOperator, AssignmentTarget,
    BinaryExpression, CallExpression, ChainElement, ComputedMemberExpression, ConditionalExpression,
    Expression, IdentifierReference, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
    JSXChild, JSXElement, JSXElementName, JSXExpression, JSXMemberExpression,
    JSXMemberExpressionObject, LogicalExpression, LogicalOperator, MemberExpression, NewExpression,
    ObjectPropertyKind, PropertyKey, SequenceExpression, StaticMemberExpression, TemplateLiteral,
    UnaryExpression, UnaryOperator, UpdateExpression,
};
use oxc::semantic::SymbolId;
use oxc::span::GetSpan;

use crate::environment::shapes::BUILTIN_ARRAY_ID;
use crate::hir::instruction::Instruction;
use crate::hir::model::BlockKind;
use crate::hir::place::{Effect, Place, SourceLocation, Type};
use crate::hir::terminal::{LogicalOperator as HirLogicalOperator, Terminal};
use crate::hir::value::{
    ArrayElement, BuiltinTag, CallArgument, InstructionKind, InstructionValue, JsxAttribute,
    JsxTag, LValue, ObjectExpressionProperty, ObjectProperty, ObjectPropertyKey, PrimitiveValue,
    PropertyLiteral, PropertyType, SpreadPattern, TemplateQuasi, TypeAnnotationKind,
    VariableBinding,
};

use super::builder::{HirBuilder, build_temporary_place, goto_break, zero_id};
use super::lower_statement::{AssignmentKind, lower_assignment_target};
use super::{LowerError, lower_function_to_value, span_to_loc};

/// The kind of load to emit for an identifier reference (`getLoadKind`).
pub enum LoadKind {
    Local,
    Context,
}

/// `lowerType(node)`: map a TypeScript type annotation node to the HIR [`Type`]
/// lattice, mirroring `lowerType` in `BuildHIR.ts`. Only the cases that produce
/// a meaningful (non-`makeType`) type are handled specially: `Array<T>` /
/// `T[]` -> `Object<BuiltInArray>`, and the primitive keyword types ->
/// `Primitive`. Everything else falls back to a fresh type variable
/// (`builder.make_type()`), matching the TS `default` / non-`Array` reference
/// arms. Flow nodes never reach the oxc `tsx` parser, so only the `TS*` variants
/// are mapped.
fn lower_type(builder: &mut HirBuilder<'_, '_>, node: &oxc::ast::ast::TSType<'_>) -> Type {
    use oxc::ast::ast::{TSType, TSTypeName};
    match node {
        // `Array<U>` reference -> `{kind: 'Object', shapeId: BuiltInArrayId}`.
        TSType::TSTypeReference(reference) => match &reference.type_name {
            TSTypeName::IdentifierReference(ident) if ident.name == "Array" => Type::Object {
                shape_id: Some(BUILTIN_ARRAY_ID.to_string()),
            },
            _ => builder.make_type(),
        },
        // `U[]` -> `{kind: 'Object', shapeId: BuiltInArrayId}`.
        TSType::TSArrayType(_) => Type::Object {
            shape_id: Some(BUILTIN_ARRAY_ID.to_string()),
        },
        // Primitive keyword types -> `{kind: 'Primitive'}`.
        TSType::TSBooleanKeyword(_)
        | TSType::TSNullKeyword(_)
        | TSType::TSNumberKeyword(_)
        | TSType::TSStringKeyword(_)
        | TSType::TSSymbolKeyword(_)
        | TSType::TSUndefinedKeyword(_)
        | TSType::TSVoidKeyword(_) => Type::Primitive,
        _ => builder.make_type(),
    }
}

/// `lowerExpression`: produce the [`InstructionValue`] for an expression without
/// yet binding it to a temporary.
pub fn lower_expression(
    builder: &mut HirBuilder<'_, '_>,
    expr: &Expression<'_>,
) -> Result<InstructionValue, LowerError> {
    let loc = span_to_loc(expr.span(), builder);
    match expr {
        Expression::Identifier(ident) => {
            let place = lower_identifier(builder, ident)?;
            let kind = get_load_kind(builder, reference_symbol(builder, ident));
            Ok(match kind {
                LoadKind::Local => InstructionValue::LoadLocal { place, loc },
                LoadKind::Context => InstructionValue::LoadContext { place, loc },
            })
        }
        Expression::NullLiteral(_) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Null,
            loc,
        }),
        Expression::BooleanLiteral(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Boolean(lit.value),
            loc,
        }),
        Expression::NumericLiteral(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::Number(lit.value),
            loc,
        }),
        Expression::StringLiteral(lit) => Ok(InstructionValue::Primitive {
            value: PrimitiveValue::String(lit.value.as_str().to_string()),
            loc,
        }),
        Expression::RegExpLiteral(lit) => Ok(InstructionValue::RegExpLiteral {
            pattern: lit.regex.pattern.text.as_str().to_string(),
            flags: lit.regex.flags.to_string(),
            loc,
        }),
        Expression::ParenthesizedExpression(paren) => lower_expression(builder, &paren.expression),
        Expression::TSNonNullExpression(e) => lower_expression(builder, &e.expression),
        Expression::TSInstantiationExpression(e) => lower_expression(builder, &e.expression),
        Expression::TSAsExpression(e) => {
            let value = lower_expression_to_temporary(builder, &e.expression)?;
            let type_annotation = builder
                .semantic()
                .source_text()[e.type_annotation.span().start as usize
                ..e.type_annotation.span().end as usize]
                .to_string();
            let type_ = lower_type(builder, &e.type_annotation);
            Ok(InstructionValue::TypeCastExpression {
                value,
                type_,
                type_annotation,
                type_annotation_kind: TypeAnnotationKind::As,
                loc,
            })
        }
        Expression::TSSatisfiesExpression(e) => {
            let value = lower_expression_to_temporary(builder, &e.expression)?;
            let type_annotation = builder
                .semantic()
                .source_text()[e.type_annotation.span().start as usize
                ..e.type_annotation.span().end as usize]
                .to_string();
            let type_ = lower_type(builder, &e.type_annotation);
            Ok(InstructionValue::TypeCastExpression {
                value,
                type_,
                type_annotation,
                type_annotation_kind: TypeAnnotationKind::Satisfies,
                loc,
            })
        }
        Expression::ObjectExpression(obj) => lower_object_expression(builder, obj, loc),
        Expression::ArrayExpression(arr) => lower_array_expression(builder, arr, loc),
        Expression::NewExpression(new_expr) => lower_new_expression(builder, new_expr, loc),
        Expression::CallExpression(call) => lower_call_expression(builder, call, loc),
        Expression::BinaryExpression(bin) => lower_binary_expression(builder, bin, loc),
        Expression::SequenceExpression(seq) => lower_sequence_expression(builder, seq, loc),
        Expression::ConditionalExpression(cond) => {
            lower_conditional_expression(builder, cond, loc)
        }
        Expression::LogicalExpression(logical) => {
            lower_logical_expression(builder, logical, loc)
        }
        Expression::AssignmentExpression(assign) => {
            lower_assignment_expression(builder, assign, loc)
        }
        Expression::StaticMemberExpression(member) => {
            let lowered = lower_static_member(builder, member, None)?;
            let place = lower_value_to_temporary(builder, lowered.value);
            Ok(InstructionValue::LoadLocal {
                loc: place.loc.clone(),
                place,
            })
        }
        Expression::ComputedMemberExpression(member) => {
            let lowered = lower_computed_member(builder, member, None)?;
            let place = lower_value_to_temporary(builder, lowered.value);
            Ok(InstructionValue::LoadLocal {
                loc: place.loc.clone(),
                place,
            })
        }
        Expression::ChainExpression(chain) => lower_chain_expression(builder, &chain.expression),
        Expression::JSXElement(element) => lower_jsx_element_value(builder, element, loc),
        Expression::JSXFragment(fragment) => {
            let mut children: Vec<Place> = Vec::new();
            for child in &fragment.children {
                if let Some(place) = lower_jsx_child(builder, child)? {
                    children.push(place);
                }
            }
            Ok(InstructionValue::JsxFragment { children, loc })
        }
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            lower_function_to_value(builder, expr, loc)
        }
        Expression::TaggedTemplateExpression(tagged) => {
            if !tagged.quasi.expressions.is_empty() || tagged.quasi.quasis.len() != 1 {
                return Err(LowerError::UnsupportedExpression {
                    kind: "TaggedTemplateExpression(interpolations)".to_string(),
                    loc,
                });
            }
            let quasi = &tagged.quasi.quasis[0];
            let raw = quasi.value.raw.as_str().to_string();
            let cooked = quasi.value.cooked.as_ref().map(|c| c.as_str().to_string());
            if cooked.as_deref() != Some(raw.as_str()) {
                return Err(LowerError::UnsupportedExpression {
                    kind: "TaggedTemplateExpression(raw!=cooked)".to_string(),
                    loc,
                });
            }
            let tag = lower_expression_to_temporary(builder, &tagged.tag)?;
            Ok(InstructionValue::TaggedTemplateExpression {
                tag,
                value: TemplateQuasi { raw, cooked },
                loc,
            })
        }
        Expression::TemplateLiteral(template) => lower_template_literal(builder, template, loc),
        Expression::UnaryExpression(unary) => lower_unary_expression(builder, unary, loc),
        Expression::UpdateExpression(update) => lower_update_expression(builder, update, loc),
        Expression::AwaitExpression(await_expr) => Ok(InstructionValue::Await {
            value: lower_expression_to_temporary(builder, &await_expr.argument)?,
            loc,
        }),
        Expression::MetaProperty(meta) => {
            if meta.meta.name == "import" && meta.property.name == "meta" {
                Ok(InstructionValue::MetaProperty {
                    meta: meta.meta.name.as_str().to_string(),
                    property: meta.property.name.as_str().to_string(),
                    loc,
                })
            } else {
                Err(LowerError::UnsupportedExpression {
                    kind: "MetaProperty".to_string(),
                    loc,
                })
            }
        }
        other => Err(LowerError::UnsupportedExpression {
            kind: expression_kind(other).to_string(),
            loc,
        }),
    }
}

/// `lowerExpressionToTemporary`: lower an expression and bind the result to a
/// fresh temporary, returning its [`Place`].
pub fn lower_expression_to_temporary(
    builder: &mut HirBuilder<'_, '_>,
    expr: &Expression<'_>,
) -> Result<Place, LowerError> {
    let value = lower_expression(builder, expr)?;
    Ok(lower_value_to_temporary(builder, value))
}

/// `lowerValueToTemporary`: push the value as an instruction binding a fresh
/// temporary and return its [`Place`]. A `LoadLocal` of an *unnamed* (temporary)
/// place is returned directly without emitting a redundant instruction.
pub fn lower_value_to_temporary(
    builder: &mut HirBuilder<'_, '_>,
    value: InstructionValue,
) -> Place {
    if let InstructionValue::LoadLocal { place, .. } = &value
        && place.identifier.name.is_none()
    {
        return place.clone();
    }
    let loc = value_loc(&value);
    let place = build_temporary_place(builder, loc.clone());
    builder.push(Instruction {
        id: zero_id(),
        lvalue: place.clone(),
        value,
        loc,
        effects: None,
    });
    place
}

/// `lowerIdentifier`: resolve an identifier reference to a [`Place`]. Local
/// bindings reference the interned identifier directly; non-local bindings emit
/// a `LoadGlobal` and reference its temporary.
pub fn lower_identifier(
    builder: &mut HirBuilder<'_, '_>,
    ident: &IdentifierReference<'_>,
) -> Result<Place, LowerError> {
    let loc = span_to_loc(ident.span(), builder);
    let symbol = reference_symbol(builder, ident);
    let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
    match binding {
        VariableBinding::Identifier { identifier, .. } => Ok(Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc,
        }),
        VariableBinding::NonLocal(binding) => Ok(lower_value_to_temporary(
            builder,
            InstructionValue::LoadGlobal {
                binding,
                loc: loc.clone(),
            },
        )),
    }
}

/// `getLoadKind`: `LoadContext` for captured context identifiers, else
/// `LoadLocal`.
pub fn get_load_kind(builder: &HirBuilder<'_, '_>, symbol: Option<SymbolId>) -> LoadKind {
    if builder.is_context_identifier(symbol) {
        LoadKind::Context
    } else {
        LoadKind::Local
    }
}

/// The oxc symbol an identifier reference resolves to, if any.
pub fn reference_symbol(
    builder: &HirBuilder<'_, '_>,
    ident: &IdentifierReference<'_>,
) -> Option<SymbolId> {
    let reference_id = ident.reference_id.get()?;
    builder
        .semantic()
        .scoping()
        .get_reference(reference_id)
        .symbol_id()
}

// === object / array literals ===============================================

fn lower_object_expression(
    builder: &mut HirBuilder<'_, '_>,
    obj: &oxc::ast::ast::ObjectExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let mut properties: Vec<ObjectExpressionProperty> = Vec::new();
    for property in &obj.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.method {
                    // Object method shorthand: `{ foo() {} }`.
                    let prop_loc = span_to_loc(prop.span, builder);
                    let func_value = match &prop.value {
                        Expression::FunctionExpression(func) => {
                            super::lower_object_method(builder, func, prop_loc)?
                        }
                        _ => {
                            return Err(LowerError::UnsupportedExpression {
                                kind: "ObjectMethod(non-function)".to_string(),
                                loc: prop_loc,
                            });
                        }
                    };
                    let place = lower_value_to_temporary(builder, func_value);
                    let key = lower_object_property_key(builder, &prop.key, prop.computed)?;
                    properties.push(ObjectExpressionProperty::Property(ObjectProperty {
                        key,
                        property_type: PropertyType::Method,
                        place,
                    }));
                } else {
                    let key = lower_object_property_key(builder, &prop.key, prop.computed)?;
                    let value = lower_expression_to_temporary(builder, &prop.value)?;
                    properties.push(ObjectExpressionProperty::Property(ObjectProperty {
                        key,
                        property_type: PropertyType::Property,
                        place: value,
                    }));
                }
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                let place = lower_expression_to_temporary(builder, &spread.argument)?;
                properties.push(ObjectExpressionProperty::Spread(SpreadPattern { place }));
            }
        }
    }
    Ok(InstructionValue::ObjectExpression { properties, loc })
}

fn lower_array_expression(
    builder: &mut HirBuilder<'_, '_>,
    arr: &oxc::ast::ast::ArrayExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let mut elements: Vec<ArrayElement> = Vec::new();
    for element in &arr.elements {
        match element {
            ArrayExpressionElement::Elision(_) => elements.push(ArrayElement::Hole),
            ArrayExpressionElement::SpreadElement(spread) => {
                let place = lower_expression_to_temporary(builder, &spread.argument)?;
                elements.push(ArrayElement::Spread(SpreadPattern { place }));
            }
            other => {
                let expr = other.as_expression().ok_or_else(|| {
                    LowerError::UnsupportedExpression {
                        kind: "ArrayElement".to_string(),
                        loc: loc.clone(),
                    }
                })?;
                elements.push(ArrayElement::Place(lower_expression_to_temporary(
                    builder, expr,
                )?));
            }
        }
    }
    Ok(InstructionValue::ArrayExpression { elements, loc })
}

/// `lowerObjectPropertyKey`.
fn lower_object_property_key(
    builder: &mut HirBuilder<'_, '_>,
    key: &PropertyKey<'_>,
    computed: bool,
) -> Result<ObjectPropertyKey, LowerError> {
    match key {
        PropertyKey::StringLiteral(s) => Ok(ObjectPropertyKey::String {
            name: s.value.as_str().to_string(),
        }),
        _ if computed => {
            let expr = key.as_expression().ok_or_else(|| {
                LowerError::UnsupportedExpression {
                    kind: "ObjectPropertyKey(computed-non-expr)".to_string(),
                    loc: span_to_loc(key.span(), builder),
                }
            })?;
            let place = lower_expression_to_temporary(builder, expr)?;
            Ok(ObjectPropertyKey::Computed { name: place })
        }
        PropertyKey::StaticIdentifier(id) => Ok(ObjectPropertyKey::Identifier {
            name: id.name.as_str().to_string(),
        }),
        PropertyKey::NumericLiteral(n) => Ok(ObjectPropertyKey::Identifier {
            name: format_number_key(n.value),
        }),
        other => Err(LowerError::UnsupportedExpression {
            kind: "ObjectPropertyKey".to_string(),
            loc: span_to_loc(other.span(), builder),
        }),
    }
}

fn format_number_key(value: f64) -> String {
    if value.fract() == 0.0 && value.is_finite() {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

// === calls / new ============================================================

fn lower_new_expression(
    builder: &mut HirBuilder<'_, '_>,
    new_expr: &NewExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let callee = lower_expression_to_temporary(builder, &new_expr.callee)?;
    let args = lower_arguments(builder, &new_expr.arguments)?;
    Ok(InstructionValue::NewExpression { callee, args, loc })
}

fn lower_call_expression(
    builder: &mut HirBuilder<'_, '_>,
    call: &CallExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    match member_of_callee(&call.callee) {
        Some(member) => {
            let lowered = lower_member_expression(builder, member, None)?;
            let property_place = lower_value_to_temporary(builder, lowered.value);
            let args = lower_arguments(builder, &call.arguments)?;
            Ok(InstructionValue::MethodCall {
                receiver: lowered.object,
                property: property_place,
                args,
                loc,
            })
        }
        None => {
            let callee = lower_expression_to_temporary(builder, &call.callee)?;
            let args = lower_arguments(builder, &call.arguments)?;
            Ok(InstructionValue::CallExpression { callee, args, loc })
        }
    }
}

/// `lowerArguments`.
fn lower_arguments(
    builder: &mut HirBuilder<'_, '_>,
    args: &oxc::allocator::Vec<'_, Argument<'_>>,
) -> Result<Vec<CallArgument>, LowerError> {
    let mut out: Vec<CallArgument> = Vec::new();
    for arg in args {
        match arg {
            Argument::SpreadElement(spread) => {
                out.push(CallArgument::Spread(SpreadPattern {
                    place: lower_expression_to_temporary(builder, &spread.argument)?,
                }));
            }
            other => {
                let expr = other.as_expression().ok_or_else(|| {
                    LowerError::UnsupportedExpression {
                        kind: "CallArgument".to_string(),
                        loc: SourceLocation::Generated,
                    }
                })?;
                out.push(CallArgument::Place(lower_expression_to_temporary(
                    builder, expr,
                )?));
            }
        }
    }
    Ok(out)
}

// === binary / logical / unary / update ======================================

fn lower_binary_expression(
    builder: &mut HirBuilder<'_, '_>,
    bin: &BinaryExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let left = lower_expression_to_temporary(builder, &bin.left)?;
    let right = lower_expression_to_temporary(builder, &bin.right)?;
    Ok(InstructionValue::BinaryExpression {
        operator: bin.operator.as_str().to_string(),
        left,
        right,
        loc,
    })
}

fn lower_unary_expression(
    builder: &mut HirBuilder<'_, '_>,
    unary: &UnaryExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    if unary.operator == UnaryOperator::Delete {
        match &unary.argument {
            Expression::StaticMemberExpression(member) => {
                let lowered = lower_static_member(builder, member, None)?;
                match lowered.property {
                    MemberProperty::Literal(property) => Ok(InstructionValue::PropertyDelete {
                        object: lowered.object,
                        property,
                        loc,
                    }),
                    MemberProperty::Computed(property) => Ok(InstructionValue::ComputedDelete {
                        object: lowered.object,
                        property,
                        loc,
                    }),
                }
            }
            Expression::ComputedMemberExpression(member) => {
                let lowered = lower_computed_member(builder, member, None)?;
                match lowered.property {
                    MemberProperty::Literal(property) => Ok(InstructionValue::PropertyDelete {
                        object: lowered.object,
                        property,
                        loc,
                    }),
                    MemberProperty::Computed(property) => Ok(InstructionValue::ComputedDelete {
                        object: lowered.object,
                        property,
                        loc,
                    }),
                }
            }
            _ => Err(LowerError::UnsupportedExpression {
                kind: "UnaryExpression(delete non-member)".to_string(),
                loc,
            }),
        }
    } else {
        Ok(InstructionValue::UnaryExpression {
            operator: unary.operator.as_str().to_string(),
            value: lower_expression_to_temporary(builder, &unary.argument)?,
            loc,
        })
    }
}

fn lower_sequence_expression(
    builder: &mut HirBuilder<'_, '_>,
    seq: &SequenceExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;
    let place = build_temporary_place(builder, loc.clone());

    let seq_loc = loc.clone();
    let place_for_block = place.clone();
    let mut inner_err: Option<LowerError> = None;
    let sequence_block = builder.enter(BlockKind::Sequence, |builder, _| {
        let mut last: Option<Place> = None;
        for item in &seq.expressions {
            match lower_expression_to_temporary(builder, item) {
                Ok(p) => last = Some(p),
                Err(e) => {
                    inner_err = Some(e);
                    break;
                }
            }
        }
        if let Some(last) = last {
            lower_value_to_temporary(
                builder,
                InstructionValue::StoreLocal {
                    lvalue: LValue {
                        place: place_for_block.clone(),
                        kind: InstructionKind::Const,
                    },
                    value: last,
                    type_annotation: None,
                    loc: seq_loc.clone(),
                },
            );
        }
        goto_break(continuation_id, seq_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Sequence {
            block: sequence_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(InstructionValue::LoadLocal {
        loc: place.loc.clone(),
        place,
    })
}

fn lower_conditional_expression(
    builder: &mut HirBuilder<'_, '_>,
    cond: &ConditionalExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;
    let test_block = builder.reserve(BlockKind::Value);
    let test_block_id = test_block.id;
    let place = build_temporary_place(builder, loc.clone());

    let consequent_loc = span_to_loc(cond.consequent.span(), builder);
    let place_for_cons = place.clone();
    let cond_loc = loc.clone();
    let mut inner_err: Option<LowerError> = None;
    let consequent_block = builder.enter(BlockKind::Value, |builder, _| {
        match lower_expression_to_temporary(builder, &cond.consequent) {
            Ok(value) => {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: place_for_cons.clone(),
                            kind: InstructionKind::Const,
                        },
                        value,
                        type_annotation: None,
                        loc: cond_loc.clone(),
                    },
                );
            }
            Err(e) => inner_err = Some(e),
        }
        goto_break(continuation_id, consequent_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    let alternate_loc = span_to_loc(cond.alternate.span(), builder);
    let place_for_alt = place.clone();
    let cond_loc = loc.clone();
    let mut inner_err: Option<LowerError> = None;
    let alternate_block = builder.enter(BlockKind::Value, |builder, _| {
        match lower_expression_to_temporary(builder, &cond.alternate) {
            Ok(value) => {
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: place_for_alt.clone(),
                            kind: InstructionKind::Const,
                        },
                        value,
                        type_annotation: None,
                        loc: cond_loc.clone(),
                    },
                );
            }
            Err(e) => inner_err = Some(e),
        }
        goto_break(continuation_id, alternate_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Ternary {
            test: test_block_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        test_block,
    );
    let test_place = lower_expression_to_temporary(builder, &cond.test)?;
    builder.terminate_with_continuation(
        Terminal::Branch {
            test: test_place,
            consequent: consequent_block,
            alternate: alternate_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(InstructionValue::LoadLocal {
        loc: place.loc.clone(),
        place,
    })
}

fn lower_logical_expression(
    builder: &mut HirBuilder<'_, '_>,
    logical: &LogicalExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;
    let test_block = builder.reserve(BlockKind::Value);
    let test_block_id = test_block.id;
    let place = build_temporary_place(builder, loc.clone());
    let left_loc = span_to_loc(logical.left.span(), builder);
    let left_place = build_temporary_place(builder, left_loc.clone());

    let place_for_cons = place.clone();
    let left_for_cons = left_place.clone();
    let consequent = builder.enter(BlockKind::Value, |builder, _| {
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: place_for_cons.clone(),
                    kind: InstructionKind::Const,
                },
                value: left_for_cons.clone(),
                type_annotation: None,
                loc: left_for_cons.loc.clone(),
            },
        );
        goto_break(continuation_id, left_for_cons.loc.clone())
    });

    let place_for_alt = place.clone();
    let mut inner_err: Option<LowerError> = None;
    let alternate = builder.enter(BlockKind::Value, |builder, _| {
        match lower_expression_to_temporary(builder, &logical.right) {
            Ok(right) => {
                let right_loc = right.loc.clone();
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: place_for_alt.clone(),
                            kind: InstructionKind::Const,
                        },
                        value: right,
                        type_annotation: None,
                        loc: right_loc.clone(),
                    },
                );
                goto_break(continuation_id, right_loc)
            }
            Err(e) => {
                inner_err = Some(e);
                goto_break(continuation_id, SourceLocation::Generated)
            }
        }
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Logical {
            operator: logical_operator(logical.operator),
            test: test_block_id,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        test_block,
    );
    let left_value = lower_expression_to_temporary(builder, &logical.left)?;
    builder.push(Instruction {
        id: zero_id(),
        lvalue: left_place.clone(),
        value: InstructionValue::LoadLocal {
            place: left_value,
            loc: loc.clone(),
        },
        loc: loc.clone(),
        effects: None,
    });
    builder.terminate_with_continuation(
        Terminal::Branch {
            test: left_place,
            consequent,
            alternate,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(InstructionValue::LoadLocal {
        loc: place.loc.clone(),
        place,
    })
}

fn logical_operator(op: LogicalOperator) -> HirLogicalOperator {
    match op {
        LogicalOperator::And => HirLogicalOperator::And,
        LogicalOperator::Or => HirLogicalOperator::Or,
        LogicalOperator::Coalesce => HirLogicalOperator::NullCoalescing,
    }
}

// === assignment / compound assignment =======================================

fn lower_assignment_expression(
    builder: &mut HirBuilder<'_, '_>,
    assign: &AssignmentExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    if assign.operator == AssignmentOperator::Assign {
        let left_loc = span_to_loc(assign.left.span(), builder);
        let value = lower_expression_to_temporary(builder, &assign.right)?;
        let assignment_kind = match &assign.left {
            AssignmentTarget::ArrayAssignmentTarget(_)
            | AssignmentTarget::ObjectAssignmentTarget(_) => AssignmentKind::Destructure,
            _ => AssignmentKind::Assignment,
        };
        return lower_assignment_target(
            builder,
            left_loc,
            InstructionKind::Reassign,
            &assign.left,
            value,
            assignment_kind,
        );
    }

    let binary_operator = match compound_to_binary(assign.operator) {
        Some(op) => op,
        None => {
            return Err(LowerError::UnsupportedExpression {
                kind: format!("AssignmentExpression({})", assign.operator.as_str()),
                loc,
            });
        }
    };

    match &assign.left {
        AssignmentTarget::AssignmentTargetIdentifier(left) => {
            let left_place = lower_assignment_target_identifier_load(builder, left)?;
            let right = lower_expression_to_temporary(builder, &assign.right)?;
            let binary_place = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: binary_operator.to_string(),
                    left: left_place,
                    right,
                    loc: loc.clone(),
                },
            );
            let symbol = assignment_target_identifier_symbol(builder, left);
            let binding = builder.resolve_identifier(left.name.as_str(), symbol, loc.clone());
            match binding {
                VariableBinding::Identifier { identifier, .. } => {
                    let place = Place {
                        identifier,
                        effect: Effect::Unknown,
                        reactive: false,
                        loc: loc.clone(),
                    };
                    if builder.is_context_identifier(symbol) {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreContext {
                                kind: InstructionKind::Reassign,
                                place: place.clone(),
                                value: binary_place,
                                loc: loc.clone(),
                            },
                        );
                        Ok(InstructionValue::LoadContext { place, loc })
                    } else {
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::StoreLocal {
                                lvalue: LValue {
                                    place: place.clone(),
                                    kind: InstructionKind::Reassign,
                                },
                                value: binary_place,
                                type_annotation: None,
                                loc: loc.clone(),
                            },
                        );
                        Ok(InstructionValue::LoadLocal { place, loc })
                    }
                }
                VariableBinding::NonLocal(_) => {
                    let temporary = lower_value_to_temporary(
                        builder,
                        InstructionValue::StoreGlobal {
                            name: left.name.as_str().to_string(),
                            value: binary_place,
                            loc: loc.clone(),
                        },
                    );
                    Ok(InstructionValue::LoadLocal {
                        loc: temporary.loc.clone(),
                        place: temporary,
                    })
                }
            }
        }
        AssignmentTarget::StaticMemberExpression(member) => {
            let lowered = lower_static_member(builder, member, None)?;
            let previous = lower_value_to_temporary(builder, lowered.value);
            let right = lower_expression_to_temporary(builder, &assign.right)?;
            let member_loc = span_to_loc(member.span, builder);
            let new_value = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: binary_operator.to_string(),
                    left: previous,
                    right,
                    loc: member_loc.clone(),
                },
            );
            Ok(member_store(lowered.object, lowered.property, new_value, member_loc))
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            let lowered = lower_computed_member(builder, member, None)?;
            let previous = lower_value_to_temporary(builder, lowered.value);
            let right = lower_expression_to_temporary(builder, &assign.right)?;
            let member_loc = span_to_loc(member.span, builder);
            let new_value = lower_value_to_temporary(
                builder,
                InstructionValue::BinaryExpression {
                    operator: binary_operator.to_string(),
                    left: previous,
                    right,
                    loc: member_loc.clone(),
                },
            );
            Ok(member_store(lowered.object, lowered.property, new_value, member_loc))
        }
        _ => Err(LowerError::UnsupportedExpression {
            kind: "AssignmentExpression(compound target)".to_string(),
            loc,
        }),
    }
}

/// Build the `PropertyStore`/`ComputedStore` for a member-target store.
fn member_store(
    object: Place,
    property: MemberProperty,
    value: Place,
    loc: SourceLocation,
) -> InstructionValue {
    match property {
        MemberProperty::Literal(property) => InstructionValue::PropertyStore {
            object,
            property,
            value,
            loc,
        },
        MemberProperty::Computed(property) => InstructionValue::ComputedStore {
            object,
            property,
            value,
            loc,
        },
    }
}

/// Map a compound assignment operator to its binary operator spelling.
fn compound_to_binary(op: AssignmentOperator) -> Option<&'static str> {
    Some(match op {
        AssignmentOperator::Addition => "+",
        AssignmentOperator::Subtraction => "-",
        AssignmentOperator::Multiplication => "*",
        AssignmentOperator::Division => "/",
        AssignmentOperator::Remainder => "%",
        AssignmentOperator::Exponential => "**",
        AssignmentOperator::BitwiseAnd => "&",
        AssignmentOperator::BitwiseOR => "|",
        AssignmentOperator::BitwiseXOR => "^",
        AssignmentOperator::ShiftLeft => "<<",
        AssignmentOperator::ShiftRight => ">>",
        AssignmentOperator::ShiftRightZeroFill => ">>>",
        _ => return None,
    })
}

/// Load an assignment-target identifier (the `x` of `x += 1`) by reusing
/// [`lower_identifier`]-equivalent resolution; mirrors `lowerExpressionToTemporary`
/// of the identifier expression in the compound-assignment branch.
fn lower_assignment_target_identifier_load(
    builder: &mut HirBuilder<'_, '_>,
    target: &oxc::ast::ast::IdentifierReference<'_>,
) -> Result<Place, LowerError> {
    let value = {
        let place = lower_identifier(builder, target)?;
        let kind = get_load_kind(builder, reference_symbol(builder, target));
        match kind {
            LoadKind::Local => InstructionValue::LoadLocal {
                loc: place.loc.clone(),
                place,
            },
            LoadKind::Context => InstructionValue::LoadContext {
                loc: place.loc.clone(),
                place,
            },
        }
    };
    Ok(lower_value_to_temporary(builder, value))
}

/// An `AssignmentTargetIdentifier` is structurally an `IdentifierReference`; in
/// oxc it carries its own reference id, resolvable to a symbol.
fn assignment_target_identifier_symbol(
    builder: &HirBuilder<'_, '_>,
    target: &oxc::ast::ast::IdentifierReference<'_>,
) -> Option<SymbolId> {
    reference_symbol(builder, target)
}

// === update (++/--) =========================================================

fn lower_update_expression(
    builder: &mut HirBuilder<'_, '_>,
    update: &UpdateExpression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let binary_operator = match update.operator {
        oxc::ast::ast::UpdateOperator::Increment => "+",
        oxc::ast::ast::UpdateOperator::Decrement => "-",
    };

    if let Some(member) = simple_target_member(&update.argument) {
        let lowered = lower_member_expression(builder, member, None)?;
        let previous_value = lower_value_to_temporary(builder, lowered.value);
        let member_loc = match member {
            MemberExpression::StaticMemberExpression(m) => span_to_loc(m.span, builder),
            MemberExpression::ComputedMemberExpression(m) => span_to_loc(m.span, builder),
            MemberExpression::PrivateFieldExpression(m) => span_to_loc(m.span, builder),
        };
        let one = lower_value_to_temporary(
            builder,
            InstructionValue::Primitive {
                value: PrimitiveValue::Number(1.0),
                loc: SourceLocation::Generated,
            },
        );
        let updated_value = lower_value_to_temporary(
            builder,
            InstructionValue::BinaryExpression {
                operator: binary_operator.to_string(),
                left: previous_value.clone(),
                right: one,
                loc: member_loc.clone(),
            },
        );
        let new_value_place = lower_value_to_temporary(
            builder,
            member_store(
                lowered.object,
                lowered.property,
                updated_value,
                member_loc,
            ),
        );
        let place = if update.prefix {
            new_value_place
        } else {
            previous_value
        };
        return Ok(InstructionValue::LoadLocal { place, loc });
    }

    // Identifier target.
    let ident = match &update.argument {
        oxc::ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => id,
        _ => {
            return Err(LowerError::UnsupportedExpression {
                kind: "UpdateExpression(target)".to_string(),
                loc,
            });
        }
    };
    let symbol = reference_symbol(builder, ident);
    if builder.is_context_identifier(symbol) {
        return Err(LowerError::UnsupportedExpression {
            kind: "UpdateExpression(context)".to_string(),
            loc,
        });
    }
    let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
    let lvalue = match binding {
        VariableBinding::Identifier { identifier, .. } => Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc: loc.clone(),
        },
        VariableBinding::NonLocal(_) => {
            return Err(LowerError::UnsupportedExpression {
                kind: "UpdateExpression(global)".to_string(),
                loc,
            });
        }
    };
    // The `value` is a fresh LoadLocal of the same identifier.
    let value = Place {
        identifier: lvalue.identifier.clone(),
        effect: Effect::Unknown,
        reactive: false,
        loc: loc.clone(),
    };
    let operation = update.operator.as_str().to_string();
    if update.prefix {
        Ok(InstructionValue::PrefixUpdate {
            lvalue,
            operation,
            value,
            loc,
        })
    } else {
        Ok(InstructionValue::PostfixUpdate {
            lvalue,
            operation,
            value,
            loc,
        })
    }
}

/// The `MemberExpression` of an update target, if any.
fn simple_target_member<'a, 'ast>(
    target: &'a oxc::ast::ast::SimpleAssignmentTarget<'ast>,
) -> Option<&'a MemberExpression<'ast>> {
    target.as_member_expression()
}

// === template literals ======================================================

fn lower_template_literal(
    builder: &mut HirBuilder<'_, '_>,
    template: &TemplateLiteral<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    if template.expressions.len() != template.quasis.len().saturating_sub(1) {
        return Err(LowerError::Invariant {
            reason: "Unexpected quasi and subexpression lengths in template literal".to_string(),
            loc,
        });
    }
    let mut subexprs: Vec<Place> = Vec::new();
    for expr in &template.expressions {
        subexprs.push(lower_expression_to_temporary(builder, expr)?);
    }
    let quasis: Vec<TemplateQuasi> = template
        .quasis
        .iter()
        .map(|q| TemplateQuasi {
            raw: q.value.raw.as_str().to_string(),
            cooked: q.value.cooked.as_ref().map(|c| c.as_str().to_string()),
        })
        .collect();
    Ok(InstructionValue::TemplateLiteral {
        subexprs,
        quasis,
        loc,
    })
}

// === member expression lowering =============================================

/// The lowered property of a member access: a literal name/index
/// (`PropertyLoad`) or a computed place (`ComputedLoad`).
pub enum MemberProperty {
    Literal(PropertyLiteral),
    Computed(Place),
}

/// The result of lowering a member expression (`LoweredMemberExpression`): the
/// (already lowered) object place, the property, and the load instruction value.
pub struct LoweredMember {
    pub object: Place,
    pub property: MemberProperty,
    pub value: InstructionValue,
}

/// `lowerMemberExpression` dispatcher over oxc's split static/computed member nodes.
pub fn lower_member_expression(
    builder: &mut HirBuilder<'_, '_>,
    member: &MemberExpression<'_>,
    lowered_object: Option<Place>,
) -> Result<LoweredMember, LowerError> {
    match member {
        MemberExpression::StaticMemberExpression(m) => {
            lower_static_member(builder, m, lowered_object)
        }
        MemberExpression::ComputedMemberExpression(m) => {
            lower_computed_member(builder, m, lowered_object)
        }
        MemberExpression::PrivateFieldExpression(m) => Err(LowerError::UnsupportedExpression {
            kind: "PrivateFieldExpression".to_string(),
            loc: span_to_loc(m.span, builder),
        }),
    }
}

fn lower_static_member(
    builder: &mut HirBuilder<'_, '_>,
    member: &StaticMemberExpression<'_>,
    lowered_object: Option<Place>,
) -> Result<LoweredMember, LowerError> {
    let loc = span_to_loc(member.span, builder);
    let object = match lowered_object {
        Some(place) => place,
        None => lower_expression_to_temporary(builder, &member.object)?,
    };
    let property = PropertyLiteral::String(member.property.name.as_str().to_string());
    let value = InstructionValue::PropertyLoad {
        object: object.clone(),
        property: property.clone(),
        loc: loc.clone(),
    };
    Ok(LoweredMember {
        object,
        property: MemberProperty::Literal(property),
        value,
    })
}

fn lower_computed_member(
    builder: &mut HirBuilder<'_, '_>,
    member: &ComputedMemberExpression<'_>,
    lowered_object: Option<Place>,
) -> Result<LoweredMember, LowerError> {
    let loc = span_to_loc(member.span, builder);
    let object = match lowered_object {
        Some(place) => place,
        None => lower_expression_to_temporary(builder, &member.object)?,
    };
    // `obj[0]` with a numeric-literal index lowers to a `PropertyLoad` with a
    // numeric property (matching the TS `expr.node.property.type === 'NumericLiteral'`).
    if let Expression::NumericLiteral(n) = &member.expression {
        let property = PropertyLiteral::Number(n.value);
        let value = InstructionValue::PropertyLoad {
            object: object.clone(),
            property: property.clone(),
            loc: loc.clone(),
        };
        return Ok(LoweredMember {
            object,
            property: MemberProperty::Literal(property),
            value,
        });
    }
    let property = lower_expression_to_temporary(builder, &member.expression)?;
    let value = InstructionValue::ComputedLoad {
        object: object.clone(),
        property: property.clone(),
        loc: loc.clone(),
    };
    Ok(LoweredMember {
        object,
        property: MemberProperty::Computed(property),
        value,
    })
}

/// The `MemberExpression` form of a call callee, if the callee is a (non-private)
/// member access — used to distinguish method calls from plain calls.
fn member_of_callee<'a, 'ast>(
    callee: &'a Expression<'ast>,
) -> Option<&'a MemberExpression<'ast>> {
    match callee {
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            callee.as_member_expression()
        }
        _ => None,
    }
}

// === optional chaining (`?.`) ===============================================

/// Lower a `ChainExpression`'s inner expression (a member or call whose chain
/// may contain optional `?.` segments).
fn lower_chain_expression(
    builder: &mut HirBuilder<'_, '_>,
    element: &ChainElement<'_>,
) -> Result<InstructionValue, LowerError> {
    match element {
        ChainElement::CallExpression(call) => {
            let value = lower_optional_call(builder, call, None)?;
            Ok(value)
        }
        ChainElement::StaticMemberExpression(member) => {
            let lowered = lower_optional_static_member(builder, member, None)?;
            Ok(InstructionValue::LoadLocal {
                loc: lowered.value.loc.clone(),
                place: lowered.value,
            })
        }
        ChainElement::ComputedMemberExpression(member) => {
            let lowered = lower_optional_computed_member(builder, member, None)?;
            Ok(InstructionValue::LoadLocal {
                loc: lowered.value.loc.clone(),
                place: lowered.value,
            })
        }
        ChainElement::PrivateFieldExpression(m) => Err(LowerError::UnsupportedExpression {
            kind: "PrivateFieldExpression".to_string(),
            loc: span_to_loc(m.span, builder),
        }),
        ChainElement::TSNonNullExpression(e) => lower_expression(builder, &e.expression),
    }
}

/// The result of lowering one optional member: the object place (for method
/// receivers) and the result place.
struct OptionalMember {
    object: Place,
    value: Place,
}

fn lower_optional_static_member(
    builder: &mut HirBuilder<'_, '_>,
    member: &StaticMemberExpression<'_>,
    parent_alternate: Option<crate::hir::ids::BlockId>,
) -> Result<OptionalMember, LowerError> {
    lower_optional_member(
        builder,
        OptionalMemberRef::Static(member),
        member.optional,
        span_to_loc(member.span, builder),
        parent_alternate,
    )
}

fn lower_optional_computed_member(
    builder: &mut HirBuilder<'_, '_>,
    member: &ComputedMemberExpression<'_>,
    parent_alternate: Option<crate::hir::ids::BlockId>,
) -> Result<OptionalMember, LowerError> {
    lower_optional_member(
        builder,
        OptionalMemberRef::Computed(member),
        member.optional,
        span_to_loc(member.span, builder),
        parent_alternate,
    )
}

/// A reference to either flavor of member node, so the optional-chain machinery
/// can be shared.
enum OptionalMemberRef<'a, 'ast> {
    Static(&'a StaticMemberExpression<'ast>),
    Computed(&'a ComputedMemberExpression<'ast>),
}

impl<'a, 'ast> OptionalMemberRef<'a, 'ast> {
    fn object(&self) -> &'a Expression<'ast> {
        match self {
            OptionalMemberRef::Static(m) => &m.object,
            OptionalMemberRef::Computed(m) => &m.object,
        }
    }
}

/// `lowerOptionalMemberExpression`: build the `optional` terminal subtree for a
/// member access, threading `parent_alternate` for nested optional segments.
fn lower_optional_member(
    builder: &mut HirBuilder<'_, '_>,
    member: OptionalMemberRef<'_, '_>,
    optional: bool,
    loc: SourceLocation,
    parent_alternate: Option<crate::hir::ids::BlockId>,
) -> Result<OptionalMember, LowerError> {
    let place = build_temporary_place(builder, loc.clone());
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;
    let consequent = builder.reserve(BlockKind::Value);
    let consequent_id = consequent.id;

    let alternate = match parent_alternate {
        Some(block) => block,
        None => build_optional_alternate(builder, place.clone(), continuation_id, loc.clone()),
    };

    let object_expr = member.object();
    let mut object: Option<Place> = None;
    let mut inner_err: Option<LowerError> = None;
    let test_loc = loc.clone();
    let test_block = builder.enter(BlockKind::Value, |builder, _| {
        match lower_optional_object(builder, object_expr, alternate) {
            Ok(place) => object = Some(place),
            Err(e) => inner_err = Some(e),
        }
        let test = object
            .clone()
            .unwrap_or_else(|| build_temporary_place(builder, test_loc.clone()));
        Terminal::Branch {
            test,
            consequent: consequent_id,
            alternate,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: test_loc.clone(),
        }
    });
    if let Some(e) = inner_err {
        return Err(e);
    }
    let object = object.ok_or_else(|| LowerError::Invariant {
        reason: "optional member object was not lowered".to_string(),
        loc: loc.clone(),
    })?;

    // Consequent block: evaluate the property access using the already-lowered object.
    let object_for_consequent = object.clone();
    let place_for_consequent = place.clone();
    let consequent_loc = loc.clone();
    let mut inner_err: Option<LowerError> = None;
    builder.enter_reserved(consequent, |builder| {
        let lowered = match &member {
            OptionalMemberRef::Static(m) => {
                lower_static_member(builder, m, Some(object_for_consequent.clone()))
            }
            OptionalMemberRef::Computed(m) => {
                lower_computed_member(builder, m, Some(object_for_consequent.clone()))
            }
        };
        match lowered {
            Ok(lowered) => {
                let temp = lower_value_to_temporary(builder, lowered.value);
                lower_value_to_temporary(
                    builder,
                    InstructionValue::StoreLocal {
                        lvalue: LValue {
                            place: place_for_consequent.clone(),
                            kind: InstructionKind::Const,
                        },
                        value: temp,
                        type_annotation: None,
                        loc: consequent_loc.clone(),
                    },
                );
            }
            Err(e) => inner_err = Some(e),
        }
        goto_break(continuation_id, consequent_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Optional {
            optional,
            test: test_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc,
        },
        continuation,
    );
    Ok(OptionalMember {
        object,
        value: place,
    })
}

/// Build the shared alternate block for an optional chain: stores `undefined`
/// into `place` then gotos the continuation.
fn build_optional_alternate(
    builder: &mut HirBuilder<'_, '_>,
    place: Place,
    continuation_id: crate::hir::ids::BlockId,
    loc: SourceLocation,
) -> crate::hir::ids::BlockId {
    builder.enter(BlockKind::Value, |builder, _| {
        let temp = lower_value_to_temporary(
            builder,
            InstructionValue::Primitive {
                value: PrimitiveValue::Undefined,
                loc: loc.clone(),
            },
        );
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: place.clone(),
                    kind: InstructionKind::Const,
                },
                value: temp,
                type_annotation: None,
                loc: loc.clone(),
            },
        );
        goto_break(continuation_id, loc.clone())
    })
}

/// Lower the object of an optional member/call, recursing into nested optional
/// members/calls (threading the shared `alternate`).
fn lower_optional_object(
    builder: &mut HirBuilder<'_, '_>,
    object: &Expression<'_>,
    alternate: crate::hir::ids::BlockId,
) -> Result<Place, LowerError> {
    match object {
        Expression::StaticMemberExpression(m) if is_in_optional_chain_static(m) => {
            Ok(lower_optional_static_member(builder, m, Some(alternate))?.value)
        }
        Expression::ComputedMemberExpression(m) if is_in_optional_chain_computed(m) => {
            Ok(lower_optional_computed_member(builder, m, Some(alternate))?.value)
        }
        Expression::CallExpression(call) if is_in_optional_chain_call(call) => {
            let value = lower_optional_call(builder, call, Some(alternate))?;
            Ok(lower_value_to_temporary(builder, value))
        }
        _ => lower_expression_to_temporary(builder, object),
    }
}

/// `lowerOptionalCallExpression`: the call analog of [`lower_optional_member`].
fn lower_optional_call(
    builder: &mut HirBuilder<'_, '_>,
    call: &CallExpression<'_>,
    parent_alternate: Option<crate::hir::ids::BlockId>,
) -> Result<InstructionValue, LowerError> {
    let loc = span_to_loc(call.span, builder);
    let optional = call.optional;
    let place = build_temporary_place(builder, loc.clone());
    let continuation = builder.reserve(builder.current_block_kind());
    let continuation_id = continuation.id;
    let consequent = builder.reserve(BlockKind::Value);

    let alternate = match parent_alternate {
        Some(block) => block,
        None => build_optional_alternate(builder, place.clone(), continuation_id, loc.clone()),
    };

    // Lower the callee within the test block.
    let mut callee_kind: Option<CalleeKind> = None;
    let mut inner_err: Option<LowerError> = None;
    let test_loc = loc.clone();
    let test_block = builder.enter(BlockKind::Value, |builder, _| {
        match lower_optional_callee(builder, &call.callee, alternate) {
            Ok(kind) => callee_kind = Some(kind),
            Err(e) => inner_err = Some(e),
        }
        let test = match &callee_kind {
            Some(CalleeKind::Call { callee }) => callee.clone(),
            Some(CalleeKind::Method { property, .. }) => property.clone(),
            None => build_temporary_place(builder, test_loc.clone()),
        };
        Terminal::Branch {
            test,
            consequent: consequent.id,
            alternate,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: test_loc.clone(),
        }
    });
    if let Some(e) = inner_err {
        return Err(e);
    }
    let callee_kind = callee_kind.ok_or_else(|| LowerError::Invariant {
        reason: "optional call callee was not lowered".to_string(),
        loc: loc.clone(),
    })?;

    // Consequent block: lower arguments and emit the call.
    let place_for_consequent = place.clone();
    let consequent_loc = loc.clone();
    let mut inner_err: Option<LowerError> = None;
    builder.enter_reserved(consequent, |builder| {
        let args = match lower_arguments(builder, &call.arguments) {
            Ok(args) => args,
            Err(e) => {
                inner_err = Some(e);
                Vec::new()
            }
        };
        let temp = build_temporary_place(builder, consequent_loc.clone());
        let call_value = match &callee_kind {
            CalleeKind::Call { callee } => InstructionValue::CallExpression {
                callee: callee.clone(),
                args,
                loc: consequent_loc.clone(),
            },
            CalleeKind::Method { receiver, property } => InstructionValue::MethodCall {
                receiver: receiver.clone(),
                property: property.clone(),
                args,
                loc: consequent_loc.clone(),
            },
        };
        builder.push(Instruction {
            id: zero_id(),
            lvalue: temp.clone(),
            value: call_value,
            loc: consequent_loc.clone(),
            effects: None,
        });
        lower_value_to_temporary(
            builder,
            InstructionValue::StoreLocal {
                lvalue: LValue {
                    place: place_for_consequent.clone(),
                    kind: InstructionKind::Const,
                },
                value: temp,
                type_annotation: None,
                loc: consequent_loc.clone(),
            },
        );
        goto_break(continuation_id, consequent_loc.clone())
    });
    if let Some(e) = inner_err {
        return Err(e);
    }

    builder.terminate_with_continuation(
        Terminal::Optional {
            optional,
            test: test_block,
            fallthrough: continuation_id,
            id: zero_id(),
            loc: loc.clone(),
        },
        continuation,
    );
    Ok(InstructionValue::LoadLocal {
        loc: place.loc.clone(),
        place,
    })
}

/// How an optional call's callee resolves: a plain function value or a method
/// (receiver + property).
enum CalleeKind {
    Call { callee: Place },
    Method { receiver: Place, property: Place },
}

fn lower_optional_callee(
    builder: &mut HirBuilder<'_, '_>,
    callee: &Expression<'_>,
    alternate: crate::hir::ids::BlockId,
) -> Result<CalleeKind, LowerError> {
    match callee {
        Expression::CallExpression(call) if is_in_optional_chain_call(call) => {
            let value = lower_optional_call(builder, call, Some(alternate))?;
            let callee = lower_value_to_temporary(builder, value);
            Ok(CalleeKind::Call { callee })
        }
        Expression::StaticMemberExpression(m) if is_in_optional_chain_static(m) => {
            let lowered = lower_optional_static_member(builder, m, Some(alternate))?;
            Ok(CalleeKind::Method {
                receiver: lowered.object,
                property: lowered.value,
            })
        }
        Expression::ComputedMemberExpression(m) if is_in_optional_chain_computed(m) => {
            let lowered = lower_optional_computed_member(builder, m, Some(alternate))?;
            Ok(CalleeKind::Method {
                receiver: lowered.object,
                property: lowered.value,
            })
        }
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            let member = callee.as_member_expression().unwrap();
            let lowered = lower_member_expression(builder, member, None)?;
            let property_place = lower_value_to_temporary(builder, lowered.value);
            Ok(CalleeKind::Method {
                receiver: lowered.object,
                property: property_place,
            })
        }
        _ => Ok(CalleeKind::Call {
            callee: lower_expression_to_temporary(builder, callee)?,
        }),
    }
}

/// Whether a static member participates in an optional chain (it or any of its
/// object-chain ancestors is `optional`).
fn is_in_optional_chain_static(member: &StaticMemberExpression<'_>) -> bool {
    member.optional || expr_in_optional_chain(&member.object)
}

fn is_in_optional_chain_computed(member: &ComputedMemberExpression<'_>) -> bool {
    member.optional || expr_in_optional_chain(&member.object)
}

fn is_in_optional_chain_call(call: &CallExpression<'_>) -> bool {
    call.optional || expr_in_optional_chain(&call.callee)
}

fn expr_in_optional_chain(expr: &Expression<'_>) -> bool {
    match expr {
        Expression::StaticMemberExpression(m) => is_in_optional_chain_static(m),
        Expression::ComputedMemberExpression(m) => is_in_optional_chain_computed(m),
        Expression::CallExpression(c) => is_in_optional_chain_call(c),
        _ => false,
    }
}

// === JSX ====================================================================

fn lower_jsx_element_value(
    builder: &mut HirBuilder<'_, '_>,
    element: &JSXElement<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let opening = &element.opening_element;
    let opening_loc = span_to_loc(opening.span, builder);
    let tag = lower_jsx_element_name(builder, &opening.name)?;

    let mut props: Vec<JsxAttribute> = Vec::new();
    for attribute in &opening.attributes {
        match attribute {
            JSXAttributeItem::SpreadAttribute(spread) => {
                let argument = lower_expression_to_temporary(builder, &spread.argument)?;
                props.push(JsxAttribute::Spread { argument });
            }
            JSXAttributeItem::Attribute(attr) => {
                let name = jsx_attribute_name(&attr.name);
                let place = match &attr.value {
                    None => lower_value_to_temporary(
                        builder,
                        InstructionValue::Primitive {
                            value: PrimitiveValue::Boolean(true),
                            loc: span_to_loc(attr.span, builder),
                        },
                    ),
                    Some(JSXAttributeValue::StringLiteral(s)) => lower_value_to_temporary(
                        builder,
                        InstructionValue::Primitive {
                            // Babel decodes HTML entities in JSX string-attribute
                            // values into the AST `value`; oxc keeps them raw.
                            value: PrimitiveValue::String(decode_jsx_entities(s.value.as_str())),
                            loc: span_to_loc(s.span, builder),
                        },
                    ),
                    Some(JSXAttributeValue::Element(el)) => {
                        let el_loc = span_to_loc(el.span, builder);
                        let value = lower_jsx_element_value(builder, el, el_loc)?;
                        lower_value_to_temporary(builder, value)
                    }
                    Some(JSXAttributeValue::Fragment(frag)) => {
                        let frag_loc = span_to_loc(frag.span, builder);
                        let mut children: Vec<Place> = Vec::new();
                        for child in &frag.children {
                            if let Some(place) = lower_jsx_child(builder, child)? {
                                children.push(place);
                            }
                        }
                        lower_value_to_temporary(
                            builder,
                            InstructionValue::JsxFragment {
                                children,
                                loc: frag_loc,
                            },
                        )
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container)) => {
                        match container.expression.as_expression() {
                            Some(expr) => lower_expression_to_temporary(builder, expr)?,
                            None => {
                                return Err(LowerError::UnsupportedExpression {
                                    kind: "JSXAttribute(empty expression)".to_string(),
                                    loc: span_to_loc(attr.span, builder),
                                });
                            }
                        }
                    }
                };
                props.push(JsxAttribute::Attribute { name, place });
            }
        }
    }

    // `isFbt`: a builtin `<fbt>`/`<fbs>` tag. The fbt babel transform (run after
    // the compiler) has its own JSX-text whitespace rules, so we preserve
    // whitespace verbatim within fbt subtrees by tracking `builder.fbtDepth`.
    let is_fbt = matches!(
        &tag,
        JsxTag::Builtin(b) if b.name == "fbt" || b.name == "fbs"
    );

    if is_fbt {
        builder.enter_fbt();
    }
    let mut children: Vec<Place> = Vec::new();
    for child in &element.children {
        if let Some(place) = lower_jsx_child(builder, child)? {
            children.push(place);
        }
    }
    if is_fbt {
        builder.exit_fbt();
    }

    let closing_loc = element
        .closing_element
        .as_ref()
        .map(|c| span_to_loc(c.span, builder))
        .unwrap_or(SourceLocation::Generated);

    Ok(InstructionValue::JsxExpression {
        tag,
        props,
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
        loc,
        opening_loc,
        closing_loc,
    })
}

fn jsx_attribute_name(name: &JSXAttributeName<'_>) -> String {
    match name {
        JSXAttributeName::Identifier(id) => id.name.as_str().to_string(),
        JSXAttributeName::NamespacedName(ns) => {
            format!("{}:{}", ns.namespace.name.as_str(), ns.name.name.as_str())
        }
    }
}

/// `lowerJsxElementName`.
fn lower_jsx_element_name(
    builder: &mut HirBuilder<'_, '_>,
    name: &JSXElementName<'_>,
) -> Result<JsxTag, LowerError> {
    match name {
        JSXElementName::Identifier(id) => {
            let tag = id.name.as_str();
            if starts_uppercase(tag) {
                // Component reference: resolve as an identifier load.
                let place = lower_jsx_identifier_place(builder, tag, span_to_loc(id.span, builder))?;
                Ok(JsxTag::Place(place))
            } else {
                Ok(JsxTag::Builtin(BuiltinTag {
                    name: tag.to_string(),
                    loc: span_to_loc(id.span, builder),
                }))
            }
        }
        JSXElementName::IdentifierReference(id) => {
            let place = lower_jsx_identifier_ref_place(builder, id)?;
            Ok(JsxTag::Place(place))
        }
        JSXElementName::MemberExpression(member) => {
            let place = lower_jsx_member_expression(builder, member)?;
            Ok(JsxTag::Place(place))
        }
        JSXElementName::NamespacedName(ns) => {
            let namespace = ns.namespace.name.as_str();
            let local = ns.name.name.as_str();
            let tag = format!("{namespace}:{local}");
            let place = lower_value_to_temporary(
                builder,
                InstructionValue::Primitive {
                    value: PrimitiveValue::String(tag),
                    loc: span_to_loc(ns.span, builder),
                },
            );
            Ok(JsxTag::Place(place))
        }
        JSXElementName::ThisExpression(this) => Err(LowerError::UnsupportedExpression {
            kind: "JSXThisTag".to_string(),
            loc: span_to_loc(this.span, builder),
        }),
    }
}

/// Resolve a JSX identifier *name* (an oxc `JSXIdentifier`, which is not a
/// reference node) to a place by looking it up as a symbol in the function scope.
fn lower_jsx_identifier_place(
    builder: &mut HirBuilder<'_, '_>,
    name: &str,
    loc: SourceLocation,
) -> Result<Place, LowerError> {
    let symbol = builder
        .semantic()
        .scoping()
        .find_binding(builder.root_fn_scope(), name.into());
    let kind = get_load_kind(builder, symbol);
    let binding = builder.resolve_identifier(name, symbol, loc.clone());
    let place = match binding {
        VariableBinding::Identifier { identifier, .. } => Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc: loc.clone(),
        },
        VariableBinding::NonLocal(binding) => {
            return Ok(lower_value_to_temporary(
                builder,
                InstructionValue::LoadGlobal {
                    binding,
                    loc: loc.clone(),
                },
            ));
        }
    };
    let value = match kind {
        LoadKind::Local => InstructionValue::LoadLocal {
            loc: loc.clone(),
            place,
        },
        LoadKind::Context => InstructionValue::LoadContext {
            loc: loc.clone(),
            place,
        },
    };
    Ok(lower_value_to_temporary(builder, value))
}

fn lower_jsx_identifier_ref_place(
    builder: &mut HirBuilder<'_, '_>,
    id: &IdentifierReference<'_>,
) -> Result<Place, LowerError> {
    let loc = span_to_loc(id.span, builder);
    let symbol = reference_symbol(builder, id);
    let kind = get_load_kind(builder, symbol);
    let place = lower_identifier(builder, id)?;
    if place.identifier.name.is_none() {
        // Already a LoadGlobal temporary.
        return Ok(place);
    }
    let value = match kind {
        LoadKind::Local => InstructionValue::LoadLocal {
            loc: loc.clone(),
            place,
        },
        LoadKind::Context => InstructionValue::LoadContext {
            loc: loc.clone(),
            place,
        },
    };
    Ok(lower_value_to_temporary(builder, value))
}

/// `lowerJsxMemberExpression`.
fn lower_jsx_member_expression(
    builder: &mut HirBuilder<'_, '_>,
    member: &JSXMemberExpression<'_>,
) -> Result<Place, LowerError> {
    let loc = span_to_loc(member.span, builder);
    let object = match &member.object {
        JSXMemberExpressionObject::MemberExpression(inner) => {
            lower_jsx_member_expression(builder, inner)?
        }
        JSXMemberExpressionObject::IdentifierReference(id) => {
            lower_jsx_identifier_ref_place(builder, id)?
        }
        JSXMemberExpressionObject::ThisExpression(this) => {
            return Err(LowerError::UnsupportedExpression {
                kind: "JSXThisObject".to_string(),
                loc: span_to_loc(this.span, builder),
            });
        }
    };
    let property = PropertyLiteral::String(member.property.name.as_str().to_string());
    Ok(lower_value_to_temporary(
        builder,
        InstructionValue::PropertyLoad {
            object,
            property,
            loc,
        },
    ))
}

/// `lowerJsxElement`: lower a single JSX child to a place, or `None` when the
/// child is whitespace-only text or an empty expression container.
fn lower_jsx_child(
    builder: &mut HirBuilder<'_, '_>,
    child: &JSXChild<'_>,
) -> Result<Option<Place>, LowerError> {
    match child {
        JSXChild::Element(element) => {
            let loc = span_to_loc(element.span, builder);
            let value = lower_jsx_element_value(builder, element, loc)?;
            Ok(Some(lower_value_to_temporary(builder, value)))
        }
        JSXChild::Fragment(fragment) => {
            let loc = span_to_loc(fragment.span, builder);
            let mut children: Vec<Place> = Vec::new();
            for c in &fragment.children {
                if let Some(place) = lower_jsx_child(builder, c)? {
                    children.push(place);
                }
            }
            Ok(Some(lower_value_to_temporary(
                builder,
                InstructionValue::JsxFragment { children, loc },
            )))
        }
        JSXChild::ExpressionContainer(container) => {
            match &container.expression {
                JSXExpression::EmptyExpression(_) => Ok(None),
                expr => {
                    let expr = expr.as_expression().ok_or_else(|| {
                        LowerError::UnsupportedExpression {
                            kind: "JSXChild(expression)".to_string(),
                            loc: span_to_loc(container.span, builder),
                        }
                    })?;
                    Ok(Some(lower_expression_to_temporary(builder, expr)?))
                }
            }
        }
        JSXChild::Text(text) => {
            // Babel's parser decodes HTML entities into `node.value` before
            // `trimJsxText` runs; oxc keeps the raw source text, so decode first.
            let decoded = decode_jsx_entities(text.value.as_str());
            // Inside an `<fbt>`/`<fbs>` subtree, preserve whitespace verbatim
            // (the fbt transform handles its own normalization); otherwise apply
            // the JSX-spec trim. Matches `BuildHIR.ts` `builder.fbtDepth > 0`.
            let text_value = if builder.in_fbt() {
                Some(decoded)
            } else {
                trim_jsx_text(&decoded)
            };
            match text_value {
                Some(text_value) => Ok(Some(lower_value_to_temporary(
                    builder,
                    InstructionValue::JsxText {
                        value: text_value,
                        loc: span_to_loc(text.span, builder),
                    },
                ))),
                None => Ok(None),
            }
        }
        JSXChild::Spread(spread) => Err(LowerError::UnsupportedExpression {
            kind: "JSXSpreadChild".to_string(),
            loc: span_to_loc(spread.span, builder),
        }),
    }
}

/// Decode HTML/XML character references in JSX text and JSX string-attribute
/// values, matching the decoding babel's parser performs into the AST `value`.
///
/// oxc keeps the raw source text (`&amp;`, `&copy;`, `&#169;`, `&#xA9;`), but the
/// React compiler reads babel's decoded `node.value` (`&`, `©`, `©`, `©`).
/// We therefore decode here so the downstream codegen's container/escaping
/// heuristics see the same string babel does. Handles numeric references
/// (decimal `&#NN;` and hex `&#xNN;`) and the common named references; unknown
/// references are left verbatim (as a permissive parser would).
fn decode_jsx_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            // Copy one full UTF-8 char.
            let ch_len = utf8_char_len(bytes[i]);
            out.push_str(&input[i..i + ch_len]);
            i += ch_len;
            continue;
        }
        // Find the terminating `;` within a bounded window.
        if let Some(semi) = input[i + 1..]
            .as_bytes()
            .iter()
            .take(32)
            .position(|&b| b == b';')
        {
            let entity = &input[i + 1..i + 1 + semi];
            if let Some(decoded) = decode_single_entity(entity) {
                out.push_str(&decoded);
                i = i + 1 + semi + 1;
                continue;
            }
        }
        // Not a recognized entity: emit the literal `&`.
        out.push('&');
        i += 1;
    }
    out
}

fn utf8_char_len(first_byte: u8) -> usize {
    if first_byte < 0x80 {
        1
    } else if first_byte < 0xE0 {
        2
    } else if first_byte < 0xF0 {
        3
    } else {
        4
    }
}

/// Decode the inside of a `&…;` reference (without the `&`/`;`). Returns `None`
/// for an unrecognized reference.
fn decode_single_entity(entity: &str) -> Option<String> {
    if let Some(num) = entity.strip_prefix('#') {
        let code = if let Some(hex) = num.strip_prefix(['x', 'X']) {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            num.parse::<u32>().ok()?
        };
        return char::from_u32(code).map(|c| c.to_string());
    }
    let c = match entity {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{00A0}',
        "copy" => '\u{00A9}',
        "reg" => '\u{00AE}',
        "trade" => '\u{2122}',
        "hellip" => '\u{2026}',
        "mdash" => '\u{2014}',
        "ndash" => '\u{2013}',
        "lsquo" => '\u{2018}',
        "rsquo" => '\u{2019}',
        "ldquo" => '\u{201C}',
        "rdquo" => '\u{201D}',
        "laquo" => '\u{00AB}',
        "raquo" => '\u{00BB}',
        "deg" => '\u{00B0}',
        "plusmn" => '\u{00B1}',
        "times" => '\u{00D7}',
        "divide" => '\u{00F7}',
        "middot" => '\u{00B7}',
        "bull" => '\u{2022}',
        "dagger" => '\u{2020}',
        "Dagger" => '\u{2021}',
        "para" => '\u{00B6}',
        "sect" => '\u{00A7}',
        "euro" => '\u{20AC}',
        "pound" => '\u{00A3}',
        "yen" => '\u{00A5}',
        "cent" => '\u{00A2}',
        "frac12" => '\u{00BD}',
        "frac14" => '\u{00BC}',
        "frac34" => '\u{00BE}',
        "iexcl" => '\u{00A1}',
        "iquest" => '\u{00BF}',
        "infin" => '\u{221E}',
        "ne" => '\u{2260}',
        "le" => '\u{2264}',
        "ge" => '\u{2265}',
        "larr" => '\u{2190}',
        "uarr" => '\u{2191}',
        "rarr" => '\u{2192}',
        "darr" => '\u{2193}',
        "harr" => '\u{2194}',
        "spades" => '\u{2660}',
        "clubs" => '\u{2663}',
        "hearts" => '\u{2665}',
        "diams" => '\u{2666}',
        "alpha" => '\u{03B1}',
        "beta" => '\u{03B2}',
        "gamma" => '\u{03B3}',
        "delta" => '\u{03B4}',
        "pi" => '\u{03C0}',
        "sigma" => '\u{03C3}',
        "omega" => '\u{03C9}',
        "Alpha" => '\u{0391}',
        "Beta" => '\u{0392}',
        "Gamma" => '\u{0393}',
        "Delta" => '\u{0394}',
        "Omega" => '\u{03A9}',
        _ => return None,
    };
    Some(c.to_string())
}

/// `trimJsxText`: trim whitespace per the JSX spec, returning `None` if the text
/// is whitespace-only.
///
/// Exposed `pub(crate)` so the codegen canonicalizer ([`crate::codegen`]) can
/// apply the *same* JSX-whitespace normalization to both sides of the parity
/// comparison: the runtime children a JSX element produces are determined by this
/// trim, so a prettier-rewrapped multi-line oracle and a single-line Rust output
/// describe the *same* program iff their `trim_jsx_text`-normalized text agrees.
pub(crate) fn trim_jsx_text(original: &str) -> Option<String> {
    let lines: Vec<&str> = original.split(['\n', '\r']).collect();
    // Note: split on `\r` and `\n` separately also splits `\r\n` into an empty
    // middle line; this matches Babel's `/\r\n|\n|\r/` closely enough for the
    // common single-`\n` cases in fixtures.
    let mut last_non_empty_line = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if line.chars().any(|c| c != ' ' && c != '\t') {
            last_non_empty_line = i;
        }
    }
    let mut out = String::new();
    let len = lines.len();
    for (i, line) in lines.iter().enumerate() {
        let is_first = i == 0;
        let is_last = i == len - 1;
        let is_last_non_empty = i == last_non_empty_line;
        let mut trimmed = line.replace('\t', " ");
        if !is_first {
            trimmed = trimmed.trim_start_matches(' ').to_string();
        }
        if !is_last {
            trimmed = trimmed.trim_end_matches(' ').to_string();
        }
        if !trimmed.is_empty() {
            if !is_last_non_empty {
                trimmed.push(' ');
            }
            out.push_str(&trimmed);
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

fn starts_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// The location of an [`InstructionValue`] (its `loc` field).
pub fn value_loc(value: &InstructionValue) -> SourceLocation {
    match value {
        InstructionValue::LoadLocal { loc, .. }
        | InstructionValue::LoadContext { loc, .. }
        | InstructionValue::StoreLocal { loc, .. }
        | InstructionValue::LoadGlobal { loc, .. }
        | InstructionValue::StoreGlobal { loc, .. }
        | InstructionValue::DeclareLocal { loc, .. }
        | InstructionValue::DeclareContext { loc, .. }
        | InstructionValue::StoreContext { loc, .. }
        | InstructionValue::Destructure { loc, .. }
        | InstructionValue::Primitive { loc, .. }
        | InstructionValue::JsxText { loc, .. }
        | InstructionValue::BinaryExpression { loc, .. }
        | InstructionValue::UnaryExpression { loc, .. }
        | InstructionValue::NewExpression { loc, .. }
        | InstructionValue::CallExpression { loc, .. }
        | InstructionValue::MethodCall { loc, .. }
        | InstructionValue::TypeCastExpression { loc, .. }
        | InstructionValue::JsxExpression { loc, .. }
        | InstructionValue::ObjectExpression { loc, .. }
        | InstructionValue::ObjectMethod { loc, .. }
        | InstructionValue::ArrayExpression { loc, .. }
        | InstructionValue::JsxFragment { loc, .. }
        | InstructionValue::RegExpLiteral { loc, .. }
        | InstructionValue::MetaProperty { loc, .. }
        | InstructionValue::PropertyStore { loc, .. }
        | InstructionValue::PropertyLoad { loc, .. }
        | InstructionValue::PropertyDelete { loc, .. }
        | InstructionValue::ComputedStore { loc, .. }
        | InstructionValue::ComputedLoad { loc, .. }
        | InstructionValue::ComputedDelete { loc, .. }
        | InstructionValue::FunctionExpression { loc, .. }
        | InstructionValue::TaggedTemplateExpression { loc, .. }
        | InstructionValue::TemplateLiteral { loc, .. }
        | InstructionValue::Await { loc, .. }
        | InstructionValue::GetIterator { loc, .. }
        | InstructionValue::IteratorNext { loc, .. }
        | InstructionValue::NextPropertyOf { loc, .. }
        | InstructionValue::PrefixUpdate { loc, .. }
        | InstructionValue::PostfixUpdate { loc, .. }
        | InstructionValue::Debugger { loc, .. }
        | InstructionValue::StartMemoize { loc, .. }
        | InstructionValue::FinishMemoize { loc, .. }
        | InstructionValue::UnsupportedNode { loc, .. } => loc.clone(),
    }
}

/// A short textual kind name for an unsupported expression (mirrors the Babel
/// `node.type` strings surfaced in the TS `recordError` messages).
fn expression_kind(expr: &Expression<'_>) -> &'static str {
    match expr {
        Expression::BooleanLiteral(_) => "BooleanLiteral",
        Expression::NullLiteral(_) => "NullLiteral",
        Expression::NumericLiteral(_) => "NumericLiteral",
        Expression::BigIntLiteral(_) => "BigIntLiteral",
        Expression::RegExpLiteral(_) => "RegExpLiteral",
        Expression::StringLiteral(_) => "StringLiteral",
        Expression::TemplateLiteral(_) => "TemplateLiteral",
        Expression::Identifier(_) => "Identifier",
        Expression::MetaProperty(_) => "MetaProperty",
        Expression::Super(_) => "Super",
        Expression::ArrayExpression(_) => "ArrayExpression",
        Expression::ArrowFunctionExpression(_) => "ArrowFunctionExpression",
        Expression::AssignmentExpression(_) => "AssignmentExpression",
        Expression::AwaitExpression(_) => "AwaitExpression",
        Expression::BinaryExpression(_) => "BinaryExpression",
        Expression::CallExpression(_) => "CallExpression",
        Expression::ChainExpression(_) => "ChainExpression",
        Expression::ClassExpression(_) => "ClassExpression",
        Expression::ConditionalExpression(_) => "ConditionalExpression",
        Expression::FunctionExpression(_) => "FunctionExpression",
        Expression::ImportExpression(_) => "ImportExpression",
        Expression::LogicalExpression(_) => "LogicalExpression",
        Expression::NewExpression(_) => "NewExpression",
        Expression::ObjectExpression(_) => "ObjectExpression",
        Expression::ParenthesizedExpression(_) => "ParenthesizedExpression",
        Expression::SequenceExpression(_) => "SequenceExpression",
        Expression::TaggedTemplateExpression(_) => "TaggedTemplateExpression",
        Expression::ThisExpression(_) => "ThisExpression",
        Expression::UnaryExpression(_) => "UnaryExpression",
        Expression::UpdateExpression(_) => "UpdateExpression",
        Expression::YieldExpression(_) => "YieldExpression",
        Expression::PrivateInExpression(_) => "PrivateInExpression",
        Expression::JSXElement(_) => "JSXElement",
        Expression::JSXFragment(_) => "JSXFragment",
        Expression::StaticMemberExpression(_) => "StaticMemberExpression",
        Expression::ComputedMemberExpression(_) => "ComputedMemberExpression",
        Expression::PrivateFieldExpression(_) => "PrivateFieldExpression",
        _ => "Expression",
    }
}
