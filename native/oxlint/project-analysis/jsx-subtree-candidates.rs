use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::{AstKind, ast::*};
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::node::NodeId;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::DuplicateJsxOccurrence;

const MAX_HASH_DEPTH: usize = 256;
const MAX_COMPOSITION_ANCESTORS: usize = 19;

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum JsxSubtreeExtractionResult {
    Supported {
        candidates: Vec<JsxSubtreeCandidate>,
        #[serde(rename = "limitExceeded")]
        limit_exceeded: bool,
    },
    Unsupported {
        unsupported: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
pub struct JsxSubtreeCandidate {
    metadata: JsxSubtreeMetadata,
    occurrence: DuplicateJsxOccurrence,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsxSubtreeMetadata {
    fingerprint: String,
    node_count: usize,
    depth: usize,
}

#[derive(Clone)]
struct StructuralHash {
    value: String,
    jsx_count: usize,
    jsx_depth: usize,
}

impl StructuralHash {
    fn literal(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            jsx_count: 0,
            jsx_depth: 0,
        }
    }

    fn node(kind: &str, children: Vec<Self>) -> Self {
        let mut parts = Vec::with_capacity(children.len() + 1);
        parts.push(kind);
        parts.extend(children.iter().map(|child| child.value.as_str()));
        Self {
            value: hash_parts(&parts),
            jsx_count: children.iter().map(|child| child.jsx_count).sum(),
            jsx_depth: children
                .iter()
                .map(|child| child.jsx_depth)
                .max()
                .unwrap_or(0),
        }
    }

    fn token(kind: &str) -> Self {
        Self::node(kind, Vec::new())
    }
}

fn hash_parts(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update(part.encode_utf16().count().to_string().as_bytes());
        digest.update(b":");
        digest.update(part.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

struct SourcePositions {
    line_starts: Vec<usize>,
    utf16_corrections: Vec<(usize, usize)>,
}

impl SourcePositions {
    fn new(source: &str) -> Self {
        let mut line_starts = vec![0];
        let mut utf16_corrections = Vec::new();
        let mut correction = 0;
        let mut characters = source.char_indices().peekable();
        while let Some((offset, character)) = characters.next() {
            let end = offset + character.len_utf8();
            if character.len_utf8() != character.len_utf16() {
                correction += character.len_utf8() - character.len_utf16();
                utf16_corrections.push((end, correction));
            }
            match character {
                '\r' if characters.peek().is_some_and(|(_, next)| *next == '\n') => {}
                '\r' | '\n' | '\u{2028}' | '\u{2029}' => line_starts.push(end),
                _ => {}
            }
        }
        Self {
            line_starts,
            utf16_corrections,
        }
    }

    fn offset(&self, byte_offset: usize) -> usize {
        let index = self
            .utf16_corrections
            .partition_point(|(end, _)| *end <= byte_offset);
        byte_offset
            - index
                .checked_sub(1)
                .map_or(0, |index| self.utf16_corrections[index].1)
    }

    fn location(&self, byte_offset: usize) -> (usize, usize) {
        let line = self
            .line_starts
            .partition_point(|start| *start <= byte_offset)
            - 1;
        (
            line + 1,
            self.offset(byte_offset) - self.offset(self.line_starts[line]) + 1,
        )
    }
}

fn is_typescript_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | ' ' | '\u{0085}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200b}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn skip_trivia(source: &str) -> usize {
    let mut offset = 0;
    loop {
        let remaining = &source[offset..];
        if let Some(character) = remaining.chars().next()
            && is_typescript_whitespace(character)
        {
            offset += character.len_utf8();
        } else if let Some(comment) = remaining.strip_prefix("/*") {
            let Some(end) = comment.find("*/") else {
                return offset;
            };
            offset += end + 4;
        } else if let Some(comment) = remaining.strip_prefix("//") {
            offset += 2 + comment
                .find(['\r', '\n', '\u{2028}', '\u{2029}'])
                .unwrap_or(comment.len());
        } else {
            return offset;
        }
    }
}

fn matches_package(source: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| {
        source == *prefix
            || source
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn is_non_react(semantic: &Semantic<'_>) -> bool {
    let mut has_react_runtime = false;
    let mut has_other_runtime = false;
    let mut has_other_marker = false;
    for node in semantic.nodes().iter() {
        match node.kind() {
            AstKind::ImportDeclaration(import)
                if import.import_kind != ImportOrExportKind::Type =>
            {
                let has_runtime = import.specifiers.as_ref().is_none_or(|specifiers| {
                    specifiers.iter().any(|specifier| match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                            specifier.import_kind != ImportOrExportKind::Type
                        }
                        _ => true,
                    })
                });
                if has_runtime {
                    let source = import.source.value.as_str();
                    has_react_runtime |= matches_package(source, &["react", "react-dom", "preact"]);
                    has_other_runtime |= matches!(source, "voby" | "vidode")
                        || matches_package(source, &["solid-js", "@builder.io/qwik"]);
                }
            }
            AstKind::JSXAttribute(attribute) => match &attribute.name {
                JSXAttributeName::NamespacedName(name) => {
                    has_other_marker |= matches!(name.namespace.name.as_str(), "class" | "bind");
                }
                JSXAttributeName::Identifier(name) if name.name == "classList" => {
                    has_other_marker |= matches!(&attribute.value,
                        Some(JSXAttributeValue::ExpressionContainer(container))
                        if matches!(&container.expression, JSXExpression::ObjectExpression(_)));
                }
                _ => {}
            },
            _ => {}
        }
    }
    !has_react_runtime && (has_other_runtime || has_other_marker)
}

struct Extractor<'semantic, 'ast> {
    source: &'ast str,
    semantic: &'semantic Semantic<'ast>,
    comments: &'semantic [Comment],
    children: HashMap<NodeId, Vec<NodeId>>,
    jsx_metrics: HashMap<NodeId, (usize, usize)>,
    hashes: HashMap<NodeId, StructuralHash>,
    positions: SourcePositions,
}

impl<'semantic, 'ast> Extractor<'semantic, 'ast> {
    fn text(&self, span: Span) -> &'ast str {
        &self.source[span.start as usize..span.end as usize]
    }

    fn raw_name(
        &self,
        key: &PropertyKey<'ast>,
        computed: bool,
        owner: Span,
    ) -> Result<String, &'static str> {
        if computed {
            let key_span = key.span();
            let prefix = &self.source[owner.start as usize..key_span.start as usize];
            let opening = prefix
                .rmatch_indices('[')
                .find_map(|(offset, _)| {
                    let absolute_offset = owner.start as usize + offset;
                    let following_comment = self
                        .comments
                        .partition_point(|comment| comment.span.start as usize <= absolute_offset);
                    if following_comment.checked_sub(1).is_some_and(|index| {
                        absolute_offset < self.comments[index].span.end as usize
                    }) {
                        return None;
                    }
                    let trailing = &prefix[offset + 1..];
                    (skip_trivia(trailing) == trailing.len()).then_some(absolute_offset)
                })
                .ok_or("computed property opening requires canonical extraction")?;
            let suffix = &self.source[key_span.end as usize..owner.end as usize];
            let closing = skip_trivia(suffix);
            if suffix.as_bytes().get(closing) != Some(&b']') {
                return Err("computed property closing requires canonical extraction");
            }
            return Ok(self.source[opening..key_span.end as usize + closing + 1].to_owned());
        }
        Ok(self.text(key.span()).to_owned())
    }

    fn flattened_children(&self, node: NodeId) -> Vec<NodeId> {
        let mut children = Vec::new();
        for child in self.children.get(&node).into_iter().flatten() {
            match self.semantic.nodes().kind(*child) {
                AstKind::FormalParameters(_)
                | AstKind::TSTypeAnnotation(_)
                | AstKind::TSTypeParameterInstantiation(_)
                | AstKind::TSTypeParameterDeclaration(_) => {
                    children.extend(self.children.get(child).into_iter().flatten().copied());
                }
                _ => children.push(*child),
            }
        }
        children
    }

    fn child_hashes(
        &mut self,
        node: NodeId,
        depth: usize,
    ) -> Result<Vec<StructuralHash>, &'static str> {
        self.flattened_children(node)
            .into_iter()
            .map(|child| self.hash(child, depth + 1))
            .collect()
    }

    fn generic(
        &mut self,
        node: NodeId,
        kind: &str,
        depth: usize,
    ) -> Result<StructuralHash, &'static str> {
        Ok(StructuralHash::node(kind, self.child_hashes(node, depth)?))
    }

    fn root_name(&self, node: NodeId) -> String {
        match self.semantic.nodes().kind(node) {
            AstKind::JSXElement(element) => {
                self.text(element.opening_element.name.span()).to_owned()
            }
            _ => "Fragment".to_owned(),
        }
    }

    fn opening_hashes(
        &mut self,
        opening: &'ast JSXOpeningElement<'ast>,
        depth: usize,
    ) -> Result<Vec<StructuralHash>, &'static str> {
        let mut hashes = vec![self.hash(opening.name.node_id(), depth + 1)?];
        if let Some(arguments) = &opening.type_arguments {
            for argument in &arguments.params {
                hashes.push(self.hash(argument.node_id(), depth + 1)?);
            }
        }
        let attributes = opening
            .attributes
            .iter()
            .map(|attribute| self.hash(attribute.node_id(), depth + 1))
            .collect::<Result<Vec<_>, _>>()?;
        hashes.push(StructuralHash::node("JsxAttributes", attributes));
        Ok(hashes)
    }

    fn jsx_hash(&mut self, node: NodeId, depth: usize) -> Result<StructuralHash, &'static str> {
        let mut children = Vec::new();
        let kind = match self.semantic.nodes().kind(node) {
            AstKind::JSXElement(element) => {
                children.push(StructuralHash::literal(
                    self.text(element.opening_element.name.span()),
                ));
                if element.closing_element.is_none() {
                    children.extend(self.opening_hashes(&element.opening_element, depth)?);
                    "JsxSelfClosingElement"
                } else {
                    children.push(self.hash(element.opening_element.node_id(), depth + 1)?);
                    for child in &element.children {
                        if !self.skip_jsx_child(child.node_id()) {
                            children.push(self.hash(child.node_id(), depth + 1)?);
                        }
                    }
                    "JsxElement"
                }
            }
            AstKind::JSXFragment(fragment) => {
                children.push(StructuralHash::literal("fragment"));
                children.push(StructuralHash::token("JsxOpeningFragment"));
                for child in &fragment.children {
                    if !self.skip_jsx_child(child.node_id()) {
                        children.push(self.hash(child.node_id(), depth + 1)?);
                    }
                }
                "JsxFragment"
            }
            _ => return Err("unexpected JSX candidate kind"),
        };
        let mut result = StructuralHash::node(kind, children);
        result.value.insert_str(0, "jsx:");
        let (jsx_count, jsx_depth) = self.jsx_metrics.get(&node).copied().unwrap_or((1, 1));
        result.jsx_count = jsx_count;
        result.jsx_depth = jsx_depth;
        Ok(result)
    }

    fn skip_jsx_child(&self, node: NodeId) -> bool {
        match self.semantic.nodes().kind(node) {
            AstKind::JSXText(text) => self.text(text.span).chars().all(is_typescript_whitespace),
            AstKind::JSXExpressionContainer(container) => {
                matches!(container.expression, JSXExpression::EmptyExpression(_))
            }
            _ => false,
        }
    }

    fn binary(
        &mut self,
        operator: &str,
        left: NodeId,
        right: NodeId,
        depth: usize,
    ) -> Result<StructuralHash, &'static str> {
        Ok(StructuralHash::node(
            "binary-expression",
            vec![
                StructuralHash::literal(operator_kind(operator)?),
                self.hash(left, depth + 1)?,
                self.hash(right, depth + 1)?,
            ],
        ))
    }

    fn hash(&mut self, node: NodeId, depth: usize) -> Result<StructuralHash, &'static str> {
        if depth > MAX_HASH_DEPTH {
            return Err("structural hash depth requires canonical extraction");
        }
        if let Some(hash) = self.hashes.get(&node) {
            return Ok(hash.clone());
        }
        let hash = match self.semantic.nodes().kind(node) {
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) => self.jsx_hash(node, depth)?,
            AstKind::JSXOpeningElement(opening) => {
                StructuralHash::node("JsxOpeningElement", self.opening_hashes(opening, depth)?)
            }
            AstKind::JSXText(text) => StructuralHash::literal(
                if self.text(text.span).chars().all(is_typescript_whitespace) {
                    "jsx-whitespace"
                } else {
                    "jsx-text"
                },
            ),
            AstKind::JSXExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    StructuralHash::token("JsxExpression")
                } else {
                    self.generic(node, "JsxExpression", depth)?
                }
            }
            AstKind::JSXEmptyExpression(_) => StructuralHash::token("JsxExpression"),
            AstKind::JSXSpreadChild(child) => StructuralHash::node(
                "JsxExpression",
                vec![
                    StructuralHash::token("DotDotDotToken"),
                    self.hash(child.expression.node_id(), depth + 1)?,
                ],
            ),
            AstKind::JSXNamespacedName(_) => self.generic(node, "JsxNamespacedName", depth)?,
            AstKind::JSXMemberExpression(member) => StructuralHash::node(
                "property-access",
                vec![
                    StructuralHash::literal("required"),
                    self.hash(member.object.node_id(), depth + 1)?,
                    StructuralHash::literal(member.property.name.as_str()),
                ],
            ),
            AstKind::JSXAttribute(attribute) => {
                let initializer = match &attribute.value {
                    None => StructuralHash::literal("present"),
                    Some(JSXAttributeValue::StringLiteral(literal)) => {
                        let raw = self.text(literal.span);
                        StructuralHash::literal(format!("string:{}", &raw[1..raw.len() - 1]))
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container))
                        if matches!(
                            &container.expression,
                            JSXExpression::StringLiteral(_)
                                | JSXExpression::NumericLiteral(_)
                                | JSXExpression::BooleanLiteral(_)
                                | JSXExpression::NullLiteral(_)
                        ) =>
                    {
                        StructuralHash::literal(format!(
                            "static:{}",
                            self.text(container.expression.span())
                        ))
                    }
                    Some(value) => self.hash(value.node_id(), depth + 1)?,
                };
                StructuralHash::node(
                    "attribute",
                    vec![
                        StructuralHash::literal(self.text(attribute.name.span())),
                        initializer,
                    ],
                )
            }
            AstKind::JSXSpreadAttribute(attribute) => StructuralHash::node(
                "spread",
                vec![self.hash(attribute.argument.node_id(), depth + 1)?],
            ),
            AstKind::IdentifierName(_)
            | AstKind::IdentifierReference(_)
            | AstKind::BindingIdentifier(_)
            | AstKind::LabelIdentifier(_)
            | AstKind::JSXIdentifier(_) => StructuralHash::literal("identifier"),
            AstKind::StringLiteral(_) => StructuralHash::literal("StringLiteral"),
            AstKind::NumericLiteral(_) => StructuralHash::literal("FirstLiteralToken"),
            AstKind::RegExpLiteral(_) => StructuralHash::literal("RegularExpressionLiteral"),
            AstKind::BigIntLiteral(_) => StructuralHash::token("BigIntLiteral"),
            AstKind::BooleanLiteral(literal) => StructuralHash::token(if literal.value {
                "TrueKeyword"
            } else {
                "FalseKeyword"
            }),
            AstKind::NullLiteral(_) => StructuralHash::token("NullKeyword"),
            AstKind::ThisExpression(_) => StructuralHash::token("ThisKeyword"),
            AstKind::Super(_) => StructuralHash::token("SuperKeyword"),
            AstKind::StaticMemberExpression(member) => StructuralHash::node(
                "property-access",
                vec![
                    StructuralHash::literal(if member.optional {
                        "optional"
                    } else {
                        "required"
                    }),
                    self.hash(member.object.node_id(), depth + 1)?,
                    StructuralHash::literal(member.property.name.as_str()),
                ],
            ),
            AstKind::ComputedMemberExpression(member) => {
                let argument = match &member.expression {
                    Expression::StringLiteral(literal) => {
                        if literal.lone_surrogates {
                            return Err(
                                "cooked lone-surrogate property key requires canonical extraction",
                            );
                        }
                        StructuralHash::literal(format!("StringLiteral:{}", literal.value))
                    }
                    Expression::NumericLiteral(literal) => {
                        let value = literal.value;
                        if !value.is_finite()
                            || value.fract() != 0.0
                            || value.abs() > 9_007_199_254_740_991.0
                        {
                            return Err(
                                "numeric property key formatting requires canonical extraction",
                            );
                        }
                        StructuralHash::literal(format!("FirstLiteralToken:{value}"))
                    }
                    expression => self.hash(expression.node_id(), depth + 1)?,
                };
                StructuralHash::node(
                    "element-access",
                    vec![
                        StructuralHash::literal(if member.optional {
                            "optional"
                        } else {
                            "required"
                        }),
                        self.hash(member.object.node_id(), depth + 1)?,
                        argument,
                    ],
                )
            }
            AstKind::PrivateFieldExpression(_) => {
                return Err("private property name hashing requires canonical extraction");
            }
            AstKind::BinaryExpression(expression) => self.binary(
                expression.operator.as_str(),
                expression.left.node_id(),
                expression.right.node_id(),
                depth,
            )?,
            AstKind::LogicalExpression(expression) => self.binary(
                expression.operator.as_str(),
                expression.left.node_id(),
                expression.right.node_id(),
                depth,
            )?,
            AstKind::AssignmentExpression(expression) => self.binary(
                expression.operator.as_str(),
                expression.left.node_id(),
                expression.right.node_id(),
                depth,
            )?,
            AstKind::SequenceExpression(expression) => {
                let mut expressions = expression.expressions.iter();
                let Some(first) = expressions.next() else {
                    return Err("empty sequence expression");
                };
                let mut result = self.hash(first.node_id(), depth + 1)?;
                for expression in expressions {
                    result = StructuralHash::node(
                        "binary-expression",
                        vec![
                            StructuralHash::literal("CommaToken"),
                            result,
                            self.hash(expression.node_id(), depth + 1)?,
                        ],
                    );
                }
                result
            }
            AstKind::UnaryExpression(expression) => {
                let operand = self.hash(expression.argument.node_id(), depth + 1)?;
                match expression.operator.as_str() {
                    "typeof" => StructuralHash::node("TypeOfExpression", vec![operand]),
                    "void" => StructuralHash::node("VoidExpression", vec![operand]),
                    "delete" => StructuralHash::node("DeleteExpression", vec![operand]),
                    operator => StructuralHash::node(
                        "PrefixUnaryExpression",
                        vec![StructuralHash::literal(operator_kind(operator)?), operand],
                    ),
                }
            }
            AstKind::UpdateExpression(expression) => StructuralHash::node(
                if expression.prefix {
                    "PrefixUnaryExpression"
                } else {
                    "PostfixUnaryExpression"
                },
                vec![
                    StructuralHash::literal(operator_kind(expression.operator.as_str())?),
                    self.hash(expression.argument.node_id(), depth + 1)?,
                ],
            ),
            AstKind::ConditionalExpression(expression) => StructuralHash::node(
                "ConditionalExpression",
                vec![
                    self.hash(expression.test.node_id(), depth + 1)?,
                    StructuralHash::token("QuestionToken"),
                    self.hash(expression.consequent.node_id(), depth + 1)?,
                    StructuralHash::token("ColonToken"),
                    self.hash(expression.alternate.node_id(), depth + 1)?,
                ],
            ),
            AstKind::CallExpression(call) => {
                let mut hashes = vec![self.hash(call.callee.node_id(), depth + 1)?];
                if call.optional {
                    hashes.push(StructuralHash::token("QuestionDotToken"));
                }
                if let Some(arguments) = &call.type_arguments {
                    for argument in &arguments.params {
                        hashes.push(self.hash(argument.node_id(), depth + 1)?);
                    }
                }
                for argument in &call.arguments {
                    hashes.push(self.hash(argument.node_id(), depth + 1)?);
                }
                StructuralHash::node("CallExpression", hashes)
            }
            AstKind::ChainExpression(_) => {
                let children = self.flattened_children(node);
                let Some(child) = children.first() else {
                    return Err("empty optional chain");
                };
                self.hash(*child, depth + 1)?
            }
            AstKind::NewExpression(_) => self.generic(node, "NewExpression", depth)?,
            AstKind::ArrayExpression(_) => self.generic(node, "ArrayLiteralExpression", depth)?,
            AstKind::Elision(_) => StructuralHash::token("OmittedExpression"),
            AstKind::ObjectExpression(_) => self.generic(node, "ObjectLiteralExpression", depth)?,
            AstKind::ObjectProperty(property) => {
                if property.method || property.kind != PropertyKind::Init {
                    return Err("object method structural hashing requires canonical extraction");
                }
                let name = self.raw_name(&property.key, property.computed, property.span)?;
                if property.shorthand {
                    let PropertyKey::StaticIdentifier(identifier) = &property.key else {
                        return Err("unexpected shorthand property name");
                    };
                    StructuralHash::node(
                        "shorthand-property",
                        vec![StructuralHash::literal(identifier.name.as_str())],
                    )
                } else {
                    StructuralHash::node(
                        "property-assignment",
                        vec![
                            StructuralHash::literal(name),
                            self.hash(property.value.node_id(), depth + 1)?,
                        ],
                    )
                }
            }
            AstKind::SpreadElement(_) => {
                let kind = if matches!(
                    self.semantic.nodes().parent_kind(node),
                    AstKind::ObjectExpression(_)
                ) {
                    "SpreadAssignment"
                } else {
                    "SpreadElement"
                };
                self.generic(node, kind, depth)?
            }
            AstKind::ParenthesizedExpression(_) => {
                self.generic(node, "ParenthesizedExpression", depth)?
            }
            AstKind::AwaitExpression(_) => self.generic(node, "AwaitExpression", depth)?,
            AstKind::YieldExpression(expression) => {
                let mut children = Vec::new();
                if expression.delegate {
                    children.push(StructuralHash::token("AsteriskToken"));
                }
                children.extend(self.child_hashes(node, depth)?);
                StructuralHash::node("YieldExpression", children)
            }
            AstKind::TemplateLiteral(template) => {
                if template.expressions.is_empty() {
                    StructuralHash::literal("FirstTemplateToken")
                } else {
                    let mut children = vec![StructuralHash::token("TemplateHead")];
                    for (index, expression) in template.expressions.iter().enumerate() {
                        let tail = if index + 1 == template.expressions.len() {
                            "LastTemplateToken"
                        } else {
                            "TemplateMiddle"
                        };
                        children.push(StructuralHash::node(
                            "TemplateSpan",
                            vec![
                                self.hash(expression.node_id(), depth + 1)?,
                                StructuralHash::token(tail),
                            ],
                        ));
                    }
                    StructuralHash::node("TemplateExpression", children)
                }
            }
            AstKind::TaggedTemplateExpression(_) => {
                self.generic(node, "TaggedTemplateExpression", depth)?
            }
            AstKind::ImportExpression(import) => {
                if import.phase.is_some() {
                    return Err("phased import requires canonical extraction");
                }
                let mut children = vec![
                    StructuralHash::token("ImportKeyword"),
                    self.hash(import.source.node_id(), depth + 1)?,
                ];
                if let Some(options) = &import.options {
                    children.push(self.hash(options.node_id(), depth + 1)?);
                }
                StructuralHash::node("CallExpression", children)
            }
            AstKind::ArrowFunctionExpression(arrow) => {
                let mut children = Vec::new();
                if arrow.r#async {
                    children.push(StructuralHash::token("AsyncKeyword"));
                }
                for child in self.flattened_children(node) {
                    if child == arrow.body.node_id() {
                        children.push(StructuralHash::token("EqualsGreaterThanToken"));
                    }
                    children.push(self.hash(child, depth + 1)?);
                }
                StructuralHash::node("ArrowFunction", children)
            }
            AstKind::Function(function) => {
                if function.declare || function.this_param.is_some() {
                    return Err("declared function hashing requires canonical extraction");
                }
                let kind = if function.r#type == FunctionType::FunctionDeclaration {
                    "FunctionDeclaration"
                } else {
                    "FunctionExpression"
                };
                let mut children = Vec::new();
                if function.r#async {
                    children.push(StructuralHash::token("AsyncKeyword"));
                }
                if function.generator {
                    children.push(StructuralHash::token("AsteriskToken"));
                }
                children.extend(self.child_hashes(node, depth)?);
                StructuralHash::node(kind, children)
            }
            AstKind::FormalParameter(parameter) => {
                if !parameter.decorators.is_empty()
                    || parameter.accessibility.is_some()
                    || parameter.readonly
                    || parameter.r#override
                {
                    return Err("parameter modifiers require canonical extraction");
                }
                let mut children = vec![self.hash(parameter.pattern.node_id(), depth + 1)?];
                if parameter.optional {
                    children.push(StructuralHash::token("QuestionToken"));
                }
                if let Some(annotation) = &parameter.type_annotation {
                    children.push(self.hash(annotation.type_annotation.node_id(), depth + 1)?);
                }
                if let Some(initializer) = &parameter.initializer {
                    children.push(self.hash(initializer.node_id(), depth + 1)?);
                }
                StructuralHash::node("Parameter", children)
            }
            AstKind::FormalParameterRest(parameter) => {
                if !parameter.decorators.is_empty() {
                    return Err("rest parameter decorators require canonical extraction");
                }
                let mut children = vec![
                    StructuralHash::token("DotDotDotToken"),
                    self.hash(parameter.rest.argument.node_id(), depth + 1)?,
                ];
                if let Some(annotation) = &parameter.type_annotation {
                    children.push(self.hash(annotation.type_annotation.node_id(), depth + 1)?);
                }
                StructuralHash::node("Parameter", children)
            }
            AstKind::FunctionBody(_) | AstKind::BlockStatement(_) => {
                self.generic(node, "Block", depth)?
            }
            AstKind::ReturnStatement(_) => self.generic(node, "ReturnStatement", depth)?,
            AstKind::ExpressionStatement(_) => self.generic(node, "ExpressionStatement", depth)?,
            AstKind::IfStatement(_) => self.generic(node, "IfStatement", depth)?,
            AstKind::ThrowStatement(_) => self.generic(node, "ThrowStatement", depth)?,
            AstKind::EmptyStatement(_) => StructuralHash::token("EmptyStatement"),
            AstKind::VariableDeclaration(_) => {
                let declarations = self.child_hashes(node, depth)?;
                StructuralHash::node(
                    "FirstStatement",
                    vec![StructuralHash::node(
                        "VariableDeclarationList",
                        declarations,
                    )],
                )
            }
            AstKind::VariableDeclarator(declaration) => {
                let mut children = vec![self.hash(declaration.id.node_id(), depth + 1)?];
                if declaration.definite {
                    children.push(StructuralHash::token("ExclamationToken"));
                }
                if let Some(annotation) = &declaration.type_annotation {
                    children.push(self.hash(annotation.type_annotation.node_id(), depth + 1)?);
                }
                if let Some(initializer) = &declaration.init {
                    children.push(self.hash(initializer.node_id(), depth + 1)?);
                }
                StructuralHash::node("VariableDeclaration", children)
            }
            AstKind::TSAsExpression(_) => self.generic(node, "AsExpression", depth)?,
            AstKind::TSSatisfiesExpression(_) => {
                self.generic(node, "SatisfiesExpression", depth)?
            }
            AstKind::TSNonNullExpression(_) => self.generic(node, "NonNullExpression", depth)?,
            AstKind::TSInstantiationExpression(_) => {
                self.generic(node, "ExpressionWithTypeArguments", depth)?
            }
            AstKind::TSTypeAssertion(assertion) => StructuralHash::node(
                "TypeAssertionExpression",
                vec![
                    self.hash(assertion.type_annotation.node_id(), depth + 1)?,
                    self.hash(assertion.expression.node_id(), depth + 1)?,
                ],
            ),
            AstKind::TSTypeReference(_) => self.generic(node, "TypeReference", depth)?,
            AstKind::TSQualifiedName(_) => self.generic(node, "FirstNode", depth)?,
            AstKind::TSLiteralType(_) => self.generic(node, "LiteralType", depth)?,
            AstKind::TSUnionType(_) => self.generic(node, "UnionType", depth)?,
            AstKind::TSIntersectionType(_) => self.generic(node, "IntersectionType", depth)?,
            AstKind::TSArrayType(_) => self.generic(node, "ArrayType", depth)?,
            AstKind::TSParenthesizedType(_) => self.generic(node, "ParenthesizedType", depth)?,
            AstKind::TSAnyKeyword(_) => StructuralHash::token("AnyKeyword"),
            AstKind::TSStringKeyword(_) => StructuralHash::token("StringKeyword"),
            AstKind::TSNumberKeyword(_) => StructuralHash::token("NumberKeyword"),
            AstKind::TSBooleanKeyword(_) => StructuralHash::token("BooleanKeyword"),
            AstKind::TSUnknownKeyword(_) => StructuralHash::token("UnknownKeyword"),
            AstKind::TSNeverKeyword(_) => StructuralHash::token("NeverKeyword"),
            AstKind::TSVoidKeyword(_) => StructuralHash::token("VoidKeyword"),
            AstKind::TSNullKeyword(_) => {
                StructuralHash::node("LiteralType", vec![StructuralHash::token("NullKeyword")])
            }
            AstKind::TSUndefinedKeyword(_) => StructuralHash::token("UndefinedKeyword"),
            AstKind::TSObjectKeyword(_) => StructuralHash::token("ObjectKeyword"),
            AstKind::TSBigIntKeyword(_) => StructuralHash::token("BigIntKeyword"),
            AstKind::TSSymbolKeyword(_) => StructuralHash::token("SymbolKeyword"),
            AstKind::TSThisType(_) => StructuralHash::token("ThisType"),
            _ => return Err("syntax structural hashing requires canonical extraction"),
        };
        self.hashes.insert(node, hash.clone());
        Ok(hash)
    }

    fn declaration_start(&self, node: NodeId) -> usize {
        let kind = self.semantic.nodes().kind(node);
        let mut declaration_start = kind.span().start as usize;
        if let AstKind::Class(class) = kind
            && let Some(decorator) = class.decorators.first()
        {
            declaration_start = declaration_start.min(decorator.span.start as usize);
        }
        let parent = self.semantic.nodes().parent_node(node);
        match parent.kind() {
            AstKind::ExportDeclaration(_) | AstKind::ExportDefaultDeclaration(_) => {
                declaration_start.min(parent.kind().span().start as usize)
            }
            _ => declaration_start,
        }
    }

    fn function_identity(&self, node: NodeId) -> Result<Option<(String, usize)>, &'static str> {
        for ancestor in self.semantic.nodes().ancestor_ids(node) {
            let kind = self.semantic.nodes().kind(ancestor);
            match kind {
                AstKind::MethodDefinition(method)
                    if method.kind == MethodDefinitionKind::Method =>
                {
                    let class = self
                        .semantic
                        .nodes()
                        .ancestor_ids(ancestor)
                        .find_map(|parent| {
                            if let AstKind::Class(class) = self.semantic.nodes().kind(parent) {
                                Some((parent, class))
                            } else {
                                None
                            }
                        });
                    if let Some((class_node, class)) = class
                        && class.r#type == ClassType::ClassDeclaration
                        && let Some(identifier) = &class.id
                    {
                        return Ok(Some((
                            identifier.name.to_string(),
                            self.declaration_start(class_node),
                        )));
                    }
                    return Ok(Some((
                        self.raw_name(&method.key, method.computed, method.span)?,
                        method.span.start as usize,
                    )));
                }
                AstKind::ObjectProperty(property)
                    if property.method && property.kind == PropertyKind::Init =>
                {
                    return Ok(Some((
                        self.raw_name(&property.key, property.computed, property.span)?,
                        property.span.start as usize,
                    )));
                }
                AstKind::Function(function) => {
                    let parent = self.semantic.nodes().parent_kind(ancestor);
                    if matches!(parent, AstKind::MethodDefinition(_))
                        || matches!(parent, AstKind::ObjectProperty(property) if property.method || property.kind != PropertyKind::Init)
                    {
                        continue;
                    }
                    if let Some(identifier) = &function.id {
                        return Ok(Some((
                            identifier.name.to_string(),
                            self.declaration_start(ancestor),
                        )));
                    }
                    if function.r#type == FunctionType::FunctionDeclaration {
                        if matches!(
                            self.semantic.nodes().parent_kind(ancestor),
                            AstKind::ExportDefaultDeclaration(_)
                        ) {
                            return Ok(Some((
                                "default export".to_owned(),
                                self.declaration_start(ancestor),
                            )));
                        }
                        continue;
                    }
                }
                AstKind::ArrowFunctionExpression(_) => {}
                _ => continue,
            }
            if !matches!(
                kind,
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            for assignment in self.semantic.nodes().ancestor_ids(ancestor) {
                match self.semantic.nodes().kind(assignment) {
                    AstKind::CallExpression(_)
                    | AstKind::ChainExpression(_)
                    | AstKind::TSInstantiationExpression(_)
                    | AstKind::ParenthesizedExpression(_)
                    | AstKind::TSAsExpression(_)
                    | AstKind::TSSatisfiesExpression(_)
                    | AstKind::TSTypeAssertion(_)
                    | AstKind::TSNonNullExpression(_) => continue,
                    AstKind::VariableDeclarator(declaration) => {
                        return Ok(Some((
                            self.text(declaration.id.span()).to_owned(),
                            declaration.span.start as usize,
                        )));
                    }
                    AstKind::ObjectProperty(property)
                        if !property.method
                            && property.kind == PropertyKind::Init
                            && !property.shorthand =>
                    {
                        return Ok(Some((
                            self.raw_name(&property.key, property.computed, property.span)?,
                            property.span.start as usize,
                        )));
                    }
                    AstKind::ExportDefaultDeclaration(declaration) => {
                        return Ok(Some((
                            "default export".to_owned(),
                            declaration.span.start as usize,
                        )));
                    }
                    _ => break,
                }
            }
        }
        Ok(None)
    }

    fn occurrence(
        &self,
        file_name: &str,
        node: NodeId,
    ) -> Result<DuplicateJsxOccurrence, &'static str> {
        let span = self.semantic.nodes().kind(node).span();
        let (start_line, start_column) = self.positions.location(span.start as usize);
        let (end_line, end_column) = self.positions.location(span.end as usize);
        let mut ancestors = self
            .semantic
            .nodes()
            .ancestor_ids(node)
            .filter(|ancestor| {
                matches!(
                    self.semantic.nodes().kind(*ancestor),
                    AstKind::JSXElement(_) | AstKind::JSXFragment(_)
                )
            })
            .take(MAX_COMPOSITION_ANCESTORS)
            .map(|ancestor| self.root_name(ancestor))
            .collect::<Vec<_>>();
        ancestors.reverse();
        let parent_root_name = ancestors.last().cloned();
        let root_name = self.root_name(node);
        ancestors.push(root_name.clone());
        let identity = self.function_identity(node)?;
        if let Some((name, _)) = &identity {
            ancestors.insert(0, name.clone());
        }
        Ok(DuplicateJsxOccurrence {
            path: file_name.to_owned(),
            path_sort_index: 0,
            start_offset: self.positions.offset(span.start as usize),
            end_offset: self.positions.offset(span.end as usize),
            start_line,
            start_column,
            end_line,
            end_column,
            root_name,
            parent_root_name,
            composition_path: ancestors,
            composition_root_start_offset: identity.map(|(_, start)| self.positions.offset(start)),
        })
    }
}

fn operator_kind(operator: &str) -> Result<&'static str, &'static str> {
    Ok(match operator {
        "+" => "PlusToken",
        "-" => "MinusToken",
        "*" => "AsteriskToken",
        "/" => "SlashToken",
        "%" => "PercentToken",
        "**" => "AsteriskAsteriskToken",
        "++" => "PlusPlusToken",
        "--" => "MinusMinusToken",
        "!" => "ExclamationToken",
        "~" => "TildeToken",
        "<" => "FirstBinaryOperator",
        ">" => "GreaterThanToken",
        "<=" => "LessThanEqualsToken",
        ">=" => "GreaterThanEqualsToken",
        "==" => "EqualsEqualsToken",
        "!=" => "ExclamationEqualsToken",
        "===" => "EqualsEqualsEqualsToken",
        "!==" => "ExclamationEqualsEqualsToken",
        "<<" => "LessThanLessThanToken",
        ">>" => "GreaterThanGreaterThanToken",
        ">>>" => "GreaterThanGreaterThanGreaterThanToken",
        "&" => "AmpersandToken",
        "|" => "BarToken",
        "^" => "CaretToken",
        "&&" => "AmpersandAmpersandToken",
        "||" => "BarBarToken",
        "??" => "QuestionQuestionToken",
        "in" => "InKeyword",
        "instanceof" => "InstanceOfKeyword",
        "=" => "FirstAssignment",
        "+=" => "FirstCompoundAssignment",
        "-=" => "MinusEqualsToken",
        "*=" => "AsteriskEqualsToken",
        "/=" => "SlashEqualsToken",
        "%=" => "PercentEqualsToken",
        "**=" => "AsteriskAsteriskEqualsToken",
        "<<=" => "LessThanLessThanEqualsToken",
        ">>=" => "GreaterThanGreaterThanEqualsToken",
        ">>>=" => "GreaterThanGreaterThanGreaterThanEqualsToken",
        "&=" => "AmpersandEqualsToken",
        "|=" => "BarEqualsToken",
        "^=" => "LastBinaryOperator",
        "&&=" => "AmpersandAmpersandEqualsToken",
        "||=" => "BarBarEqualsToken",
        "??=" => "QuestionQuestionEqualsToken",
        _ => return Err("operator token requires canonical extraction"),
    })
}

pub fn extract_jsx_subtree_candidates(
    file_name: &str,
    source_text: &str,
    maximum_candidate_count: f64,
) -> JsxSubtreeExtractionResult {
    let empty = |limit_exceeded| JsxSubtreeExtractionResult::Supported {
        candidates: Vec::new(),
        limit_exceeded,
    };
    let unsupported = |reason: &str| JsxSubtreeExtractionResult::Unsupported {
        unsupported: vec![reason.to_owned()],
    };
    if !source_text.contains('<') {
        return empty(false);
    }
    let source_type = if file_name.ends_with(".tsx") {
        SourceType::tsx()
    } else if file_name.ends_with(".ts") {
        SourceType::ts()
    } else {
        SourceType::jsx()
    };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source_text, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return unsupported("TypeScript parser recovery requires canonical extraction");
    }
    let built = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program);
    let semantic = &built.semantic;
    if is_non_react(semantic) {
        return empty(false);
    }
    let mut candidates = semantic
        .nodes()
        .iter()
        .filter(|node| {
            matches!(
                node.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            )
        })
        .map(|node| node.id())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|node| semantic.nodes().kind(*node).span().start);
    if candidates
        .iter()
        .enumerate()
        .any(|(index, _)| index as f64 >= maximum_candidate_count)
    {
        return empty(true);
    }
    let mut children = HashMap::<NodeId, Vec<NodeId>>::new();
    for node in semantic.nodes().iter().skip(1) {
        children
            .entry(semantic.nodes().parent_id(node.id()))
            .or_default()
            .push(node.id());
    }
    let mut jsx_metrics = HashMap::<NodeId, (usize, usize)>::new();
    let node_ids = semantic
        .nodes()
        .iter()
        .map(|node| node.id())
        .collect::<Vec<_>>();
    for node in node_ids.into_iter().rev() {
        let mut count = 0;
        let mut depth = 0;
        for child in children.get(&node).into_iter().flatten() {
            if let Some((child_count, child_depth)) = jsx_metrics.get(child) {
                count += child_count;
                depth = depth.max(*child_depth);
            }
        }
        if matches!(
            semantic.nodes().kind(node),
            AstKind::JSXElement(_) | AstKind::JSXFragment(_)
        ) {
            count += 1;
            depth += 1;
        }
        jsx_metrics.insert(node, (count, depth));
    }
    let mut extractor = Extractor {
        source: source_text,
        semantic,
        comments: &parsed.program.comments,
        children,
        jsx_metrics,
        hashes: HashMap::new(),
        positions: SourcePositions::new(source_text),
    };
    let mut output = Vec::with_capacity(candidates.len());
    for node in candidates {
        let hash = match extractor.hash(node, 0) {
            Ok(hash) => hash,
            Err(reason) => return unsupported(reason),
        };
        let occurrence = match extractor.occurrence(file_name, node) {
            Ok(occurrence) => occurrence,
            Err(reason) => return unsupported(reason),
        };
        output.push(JsxSubtreeCandidate {
            metadata: JsxSubtreeMetadata {
                fingerprint: hash.value,
                node_count: hash.jsx_count,
                depth: hash.jsx_depth,
            },
            occurrence,
        });
    }
    JsxSubtreeExtractionResult::Supported {
        candidates: output,
        limit_exceeded: false,
    }
}
