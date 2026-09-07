use oxc_allocator::Allocator;
use oxc_ast::{AstKind, ast::*};
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span};
use serde::{Deserialize, Serialize};
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReducedMotionSourceInput {
    pub file_name: String,
    pub source_text: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReducedMotionEvidence {
    pub has_motion_use: bool,
    pub has_reduced_motion_handling: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum ReducedMotionAnalysisResult {
    Supported(ReducedMotionEvidence),
    Unsupported { unsupported: Vec<String> },
}

#[derive(Clone, Default)]
enum ExpressionEvidence {
    #[default]
    Empty,
    Symbol(SymbolId),
    Global(String),
    String(String),
    Member(Box<ExpressionEvidence>, String),
    Call(Box<ExpressionEvidence>, bool),
    Import(String, String),
    Namespace,
    GlobalRequire,
    Merge(Vec<ExpressionEvidence>),
    Unsupported(&'static str),
}

struct Binding {
    initializer: ExpressionEvidence,
    is_const: bool,
    is_destructured: bool,
}
enum Export {
    Default(ExpressionEvidence),
    From {
        name: Option<String>,
        source: String,
        imported: String,
    },
    Local {
        name: String,
        symbol: SymbolId,
        alias: bool,
    },
}
enum Use {
    Call {
        callee: ExpressionEvidence,
        consumed: bool,
        call_or_apply_receiver: Option<ExpressionEvidence>,
    },
    Jsx {
        tag: ExpressionEvidence,
        attributes: Vec<ExpressionEvidence>,
    },
}
#[derive(Default)]
struct File {
    name: PathBuf,
    is_commonjs: bool,
    bindings: HashMap<SymbolId, Binding>,
    exports: Vec<Export>,
    uses: Vec<Use>,
    globals: HashMap<SymbolId, String>,
    global_namespaces: HashMap<SymbolId, String>,
    namespace_symbols: HashSet<SymbolId>,
    mergeable_globals: HashSet<SymbolId>,
    function_globals: HashSet<SymbolId>,
}

#[derive(Clone, Copy, Default)]
struct Evidence(u8);
const ANIMATION: u8 = 1;
const COMPONENT: u8 = 2;
const FACTORY: u8 = 4;
const COMPONENT_NAMESPACE: u8 = 8;
const CONFIG: u8 = 16;
const NAMESPACE: u8 = 32;
const HOOK: u8 = 64;
const COMMONJS_ALIAS_DISCOVERY_LIMIT: usize = 100;
const MAX_ANALYZER_RECURSION_DEPTH: usize = 256;
const MAX_LOWERED_AST_DEPTH: usize = 256;
const MAX_MERGED_INITIALIZER_DEPTH: usize = 128;

fn classify_export(name: &str) -> Evidence {
    Evidence(match name {
        "animate" => ANIMATION,
        "motion" | "m" => FACTORY,
        "Reorder" => COMPONENT_NAMESPACE,
        "MotionConfig" => CONFIG,
        "useReducedMotion" => HOOK,
        _ => 0,
    })
}

fn classify_member(receiver: Evidence, name: &str) -> Evidence {
    if receiver.0 & NAMESPACE != 0 {
        return classify_export(name);
    }
    if receiver.0 & FACTORY != 0 || receiver.0 & COMPONENT_NAMESPACE != 0 && name == "Item" {
        return Evidence(COMPONENT);
    }
    Evidence::default()
}

fn is_motion_source(source: &str) -> bool {
    ["motion", "framer-motion"].iter().any(|package| {
        source == *package
            || source
                .strip_prefix(package)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}

fn is_normalized_source_path(file_name: &str) -> bool {
    file_name.is_ascii()
        && file_name.starts_with('/')
        && !file_name.contains(['\\', ':', '\0'])
        && file_name[1..]
            .split('/')
            .all(|component| !matches!(component, "" | "." | ".."))
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn identifier(identifier: &IdentifierReference<'_>, semantic: &Semantic<'_>) -> ExpressionEvidence {
    let symbol = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .or_else(|| {
            let node = semantic.nodes().get_node(identifier.node_id.get());
            semantic
                .scoping()
                .scope_ancestors(node.scope_id())
                .find_map(|scope| {
                    semantic
                        .scoping()
                        .get_binding(scope, identifier.name.as_str().into())
                        .filter(|symbol| semantic.scoping().symbol_flags(*symbol).is_import())
                })
        });
    symbol
        .map(ExpressionEvidence::Symbol)
        .unwrap_or_else(|| ExpressionEvidence::Global(identifier.name.to_string()))
}

fn lower_expression(expression: &Expression<'_>, semantic: &Semantic<'_>) -> ExpressionEvidence {
    match expression {
        Expression::Identifier(reference) => identifier(reference, semantic),
        Expression::StringLiteral(literal) => ExpressionEvidence::String(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map(|value| ExpressionEvidence::String(value.to_string()))
            .unwrap_or_default(),
        Expression::ParenthesizedExpression(wrapper) => {
            lower_expression(&wrapper.expression, semantic)
        }
        Expression::TSAsExpression(wrapper) => lower_expression(&wrapper.expression, semantic),
        Expression::TSSatisfiesExpression(wrapper) => {
            lower_expression(&wrapper.expression, semantic)
        }
        Expression::TSNonNullExpression(wrapper) => lower_expression(&wrapper.expression, semantic),
        Expression::TSTypeAssertion(wrapper) => lower_expression(&wrapper.expression, semantic),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => lower_call(call, semantic),
            ChainElement::StaticMemberExpression(member) => ExpressionEvidence::Member(
                Box::new(lower_expression(&member.object, semantic)),
                member.property.name.to_string(),
            ),
            ChainElement::ComputedMemberExpression(member) => lower_computed(member, semantic),
            _ => ExpressionEvidence::Empty,
        },
        Expression::StaticMemberExpression(member) => ExpressionEvidence::Member(
            Box::new(lower_expression(&member.object, semantic)),
            member.property.name.to_string(),
        ),
        Expression::ComputedMemberExpression(member) => lower_computed(member, semantic),
        Expression::CallExpression(call) => lower_call(call, semantic),
        _ => ExpressionEvidence::Empty,
    }
}

fn lower_computed(
    member: &ComputedMemberExpression<'_>,
    semantic: &Semantic<'_>,
) -> ExpressionEvidence {
    if !matches!(
        &member.expression,
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_)
    ) {
        return ExpressionEvidence::Empty;
    }
    match lower_expression(&member.expression, semantic) {
        ExpressionEvidence::String(name) => {
            ExpressionEvidence::Member(Box::new(lower_expression(&member.object, semantic)), name)
        }
        _ => ExpressionEvidence::Empty,
    }
}

fn lower_call(call: &CallExpression<'_>, semantic: &Semantic<'_>) -> ExpressionEvidence {
    if let Expression::Identifier(reference) = &call.callee
        && semantic.source_type().is_typescript()
        && reference.name == "require"
        && matches!(
            identifier(reference, semantic),
            ExpressionEvidence::Global(_)
        )
        && call.arguments.len() == 1
        && let Argument::StringLiteral(source) = &call.arguments[0]
        && is_motion_source(&source.value)
    {
        return ExpressionEvidence::GlobalRequire;
    }
    ExpressionEvidence::Call(
        Box::new(lower_expression(&call.callee, semantic)),
        matches!(&call.callee, Expression::StaticMemberExpression(member) if member.property.name == "bind"),
    )
}

fn lower_jsx_member(
    member: &JSXMemberExpression<'_>,
    semantic: &Semantic<'_>,
) -> ExpressionEvidence {
    let receiver = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(reference) => {
            identifier(reference, semantic)
        }
        JSXMemberExpressionObject::MemberExpression(inner) => lower_jsx_member(inner, semantic),
        _ => ExpressionEvidence::Empty,
    };
    ExpressionEvidence::Member(Box::new(receiver), member.property.name.to_string())
}

fn lower_binding(
    pattern: &BindingPattern<'_>,
    initializer: ExpressionEvidence,
    is_const: bool,
    file: &mut File,
) {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => {
            if let Some(previous) = file.bindings.get_mut(&binding.symbol_id()) {
                let mut merge_depth = 0;
                let mut previous_initializer = &previous.initializer;
                while let ExpressionEvidence::Merge(initializers) = previous_initializer {
                    merge_depth += 1;
                    if merge_depth >= MAX_MERGED_INITIALIZER_DEPTH {
                        previous.initializer = ExpressionEvidence::Unsupported(
                            "declaration merge depth requires canonical analysis",
                        );
                        return;
                    }
                    let Some(first_initializer) = initializers.first() else {
                        break;
                    };
                    previous_initializer = first_initializer;
                }
                let first = std::mem::take(&mut previous.initializer);
                previous.initializer = ExpressionEvidence::Merge(vec![first, initializer]);
            } else {
                file.bindings.insert(
                    binding.symbol_id(),
                    Binding {
                        initializer,
                        is_const,
                        is_destructured: false,
                    },
                );
            }
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                let name = match &property.key {
                    PropertyKey::StaticIdentifier(name) if !property.computed => {
                        Some(name.name.to_string())
                    }
                    PropertyKey::StringLiteral(name) if !property.computed => {
                        Some(name.value.to_string())
                    }
                    _ => None,
                };
                let binding = match &property.value {
                    BindingPattern::BindingIdentifier(binding) => Some(binding.as_ref()),
                    BindingPattern::AssignmentPattern(assignment) => {
                        assignment.left.get_binding_identifier()
                    }
                    _ => None,
                };
                if let (Some(name), Some(binding)) = (name, binding) {
                    file.bindings.insert(
                        binding.symbol_id(),
                        Binding {
                            initializer: ExpressionEvidence::Member(
                                Box::new(initializer.clone()),
                                name,
                            ),
                            is_const: false,
                            is_destructured: true,
                        },
                    );
                }
            }
            if let Some(rest) = &pattern.rest
                && let BindingPattern::BindingIdentifier(binding) = &rest.argument
            {
                file.bindings.insert(
                    binding.symbol_id(),
                    Binding {
                        initializer: ExpressionEvidence::Member(
                            Box::new(initializer),
                            binding.name.to_string(),
                        ),
                        is_const: false,
                        is_destructured: true,
                    },
                );
            }
        }
        _ => {}
    }
}

fn declaration_body_is_type_only(body: &oxc_allocator::Vec<'_, Statement<'_>>) -> bool {
    body.iter().all(|statement| match statement {
        Statement::EmptyStatement(_)
        | Statement::TSInterfaceDeclaration(_)
        | Statement::TSTypeAliasDeclaration(_) => true,
        Statement::TSNamespaceDeclaration(namespace) => namespace_is_type_only(namespace),
        Statement::ExportDeclaration(export) => matches!(
            &export.declaration,
            Declaration::TSInterfaceDeclaration(_) | Declaration::TSTypeAliasDeclaration(_)
        ),
        _ => false,
    })
}

fn namespace_is_type_only(namespace: &TSNamespaceDeclaration<'_>) -> bool {
    namespace_value_state(namespace) == Some(false)
}

fn namespace_value_state(namespace: &TSNamespaceDeclaration<'_>) -> Option<bool> {
    match &namespace.body {
        TSNamespaceDeclarationBody::TSNamespaceDeclaration(nested) => namespace_value_state(nested),
        TSNamespaceDeclarationBody::TSModuleBlock(body) => {
            let mut has_value = false;
            let mut has_unknown = false;
            for statement in &body.body {
                let state = match statement {
                    Statement::TSInterfaceDeclaration(_)
                    | Statement::TSTypeAliasDeclaration(_)
                    | Statement::ImportDeclaration(_) => Some(false),
                    Statement::EmptyStatement(_)
                    | Statement::VariableDeclaration(_)
                    | Statement::FunctionDeclaration(_)
                    | Statement::ClassDeclaration(_)
                    | Statement::TSEnumDeclaration(_) => Some(true),
                    Statement::TSNamespaceDeclaration(nested) => namespace_value_state(nested),
                    Statement::ExportDeclaration(export) => match &export.declaration {
                        Declaration::TSInterfaceDeclaration(_)
                        | Declaration::TSTypeAliasDeclaration(_) => Some(false),
                        Declaration::VariableDeclaration(_)
                        | Declaration::FunctionDeclaration(_)
                        | Declaration::ClassDeclaration(_)
                        | Declaration::TSEnumDeclaration(_) => Some(true),
                        Declaration::TSNamespaceDeclaration(nested) => {
                            namespace_value_state(nested)
                        }
                        _ => None,
                    },
                    _ => None,
                };
                has_value |= state == Some(true);
                has_unknown |= state.is_none();
            }
            if has_value {
                Some(true)
            } else if has_unknown {
                None
            } else {
                Some(false)
            }
        }
    }
}

fn declaration_region_is_inert(
    region: Span,
    semantic: &Semantic<'_>,
    is_external_module: bool,
) -> bool {
    semantic.nodes().iter().all(|node| {
        let span = node.kind().span();
        if span.start < region.start || span.end > region.end {
            return true;
        }
        match node.kind() {
            AstKind::CallExpression(_)
            | AstKind::JSXOpeningElement(_)
            | AstKind::TSGlobalDeclaration(_)
            | AstKind::TSNamespaceExportDeclaration(_) => false,
            AstKind::TSExternalModuleDeclaration(nested) => {
                is_external_module && nested.span == region
            }
            AstKind::TSImportEqualsDeclaration(_) | AstKind::TSExportAssignment(_) => {
                is_external_module
            }
            _ => true,
        }
    })
}

fn ambient_module_is_inert(
    module: &TSExternalModuleDeclaration<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    let name = module.id.value.as_str();
    name.is_ascii()
        && !name.starts_with(['.', '/'])
        && !name.contains(['\\', ':'])
        && declaration_region_is_inert(module.span, semantic, true)
}

struct StaticAccess {
    root: String,
    properties: Vec<String>,
}

fn literal_property_name(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::NumericLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()?
            .value
            .cooked
            .as_ref()
            .map(ToString::to_string),
        _ => None,
    }
}

fn append_static_access(object: &Expression<'_>, property: String) -> Option<StaticAccess> {
    let mut access = static_access(object)?;
    access.properties.push(property);
    Some(access)
}

fn static_access(expression: &Expression<'_>) -> Option<StaticAccess> {
    match expression {
        Expression::Identifier(identifier) => Some(StaticAccess {
            root: identifier.name.to_string(),
            properties: Vec::new(),
        }),
        Expression::StaticMemberExpression(member) => {
            append_static_access(&member.object, member.property.name.to_string())
        }
        Expression::ComputedMemberExpression(member) => {
            append_static_access(&member.object, literal_property_name(&member.expression)?)
        }
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::StaticMemberExpression(member) => {
                append_static_access(&member.object, member.property.name.to_string())
            }
            ChainElement::ComputedMemberExpression(member) => {
                append_static_access(&member.object, literal_property_name(&member.expression)?)
            }
            _ => None,
        },
        _ => None,
    }
}

fn rightmost_assigned_expression<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    while let Expression::AssignmentExpression(assignment) = expression {
        if assignment.operator.as_str() != "=" {
            break;
        }
        expression = &assignment.right;
    }
    expression
}

fn rightmost_binary_expression<'a, 'b>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::AssignmentExpression(assignment) => &assignment.right,
            Expression::BinaryExpression(binary) => &binary.right,
            Expression::LogicalExpression(logical) => &logical.right,
            _ => return expression,
        };
    }
}

fn commonjs_assignment_indicator(assignment: &AssignmentExpression<'_>) -> bool {
    if assignment.operator.as_str() != "=" {
        return false;
    }
    if matches!(rightmost_assigned_expression(&assignment.right), Expression::UnaryExpression(unary) if unary.operator.as_str() == "void" && matches!(&unary.argument, Expression::NumericLiteral(number) if number.value == 0.0))
    {
        return false;
    }
    let access = match &assignment.left {
        AssignmentTarget::StaticMemberExpression(member) => {
            append_static_access(&member.object, member.property.name.to_string())
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            literal_property_name(&member.expression)
                .and_then(|property| append_static_access(&member.object, property))
        }
        _ => None,
    };
    let Some(access) = access else {
        return false;
    };
    if access
        .properties
        .last()
        .is_some_and(|property| property == "prototype")
        && matches!(
            rightmost_binary_expression(&assignment.right),
            Expression::ObjectExpression(_)
        )
    {
        return false;
    }
    if access.root == "module" && access.properties.as_slice() == ["exports"] {
        return true;
    }
    if access
        .properties
        .iter()
        .rev()
        .nth(1)
        .is_some_and(|property| property == "prototype")
    {
        return false;
    }
    access.root == "exports"
        || access.root == "module"
            && access
                .properties
                .first()
                .is_some_and(|property| property == "exports")
}

fn commonjs_define_property_indicator(call: &CallExpression<'_>) -> bool {
    if call.arguments.len() != 3
        || !matches!(&call.callee, Expression::StaticMemberExpression(member) if member.property.name == "defineProperty" && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "Object"))
    {
        return false;
    }
    let Some(property) = call.arguments[1].as_expression() else {
        return false;
    };
    if literal_property_name(property).is_none() {
        return false;
    }
    let Some(target) = call.arguments[0].as_expression().and_then(static_access) else {
        return false;
    };
    target.root == "exports" && target.properties.is_empty()
        || target.root == "module" && target.properties.as_slice() == ["exports"]
}

fn potential_export_alias(expression: &Expression<'_>, aliases: &HashSet<String>) -> bool {
    match expression {
        Expression::Identifier(identifier) => {
            identifier.name == "exports" || aliases.contains(identifier.name.as_str())
        }
        Expression::AssignmentExpression(assignment) if assignment.operator.as_str() == "=" => {
            let left_alias = match &assignment.left {
                AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
                    identifier.name == "exports" || aliases.contains(identifier.name.as_str())
                }
                AssignmentTarget::StaticMemberExpression(member) => {
                    member.property.name == "exports"
                        && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "module")
                }
                AssignmentTarget::ComputedMemberExpression(member) => {
                    literal_property_name(&member.expression)
                        .is_some_and(|property| property == "exports")
                        && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "module")
                }
                _ => false,
            };
            left_alias || potential_export_alias(&assignment.right, aliases)
        }
        _ => static_access(expression).is_some_and(|access| {
            access.root == "module" && access.properties.as_slice() == ["exports"]
        }),
    }
}

fn has_uncertain_secondary_commonjs_assignment(semantic: &Semantic<'_>) -> bool {
    let mut aliases = HashSet::new();
    let mut did_converge = false;
    for _ in 0..COMMONJS_ALIAS_DISCOVERY_LIMIT {
        let previous_count = aliases.len();
        for node in semantic.nodes().iter() {
            if let AstKind::VariableDeclarator(declarator) = node.kind()
                && let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                && let Some(initializer) = &declarator.init
                && potential_export_alias(initializer, &aliases)
            {
                aliases.insert(identifier.name.to_string());
            }
        }
        if aliases.len() == previous_count {
            did_converge = true;
            break;
        }
    }
    if !did_converge {
        return true;
    }
    semantic.nodes().iter().any(|node| {
        let AstKind::AssignmentExpression(assignment) = node.kind() else { return false; };
        if assignment.operator.as_str() != "=" { return false; }
        let object = match &assignment.left {
            AssignmentTarget::StaticMemberExpression(member) => &member.object,
            AssignmentTarget::ComputedMemberExpression(member) => &member.object,
            _ => return false,
        };
        matches!(object, Expression::Identifier(identifier) if identifier.name == "exports" || aliases.contains(identifier.name.as_str()))
    })
}

fn lower_file(input: &ReducedMotionSourceInput) -> Result<File, String> {
    if !input.file_name.is_ascii() {
        return Err("Unicode filename case-folding parity required".into());
    }
    let source_type =
        SourceType::from_path(&input.file_name).map_err(|_| "unsupported file extension")?;
    let has_typescript_script_kind =
        input.file_name.ends_with(".ts") || input.file_name.ends_with(".tsx");
    if source_type.is_typescript() != has_typescript_script_kind {
        return Err("TypeScript script-kind filename parity required".into());
    }
    if input.file_name.ends_with(".mjs") || input.file_name.ends_with(".cjs") {
        return Err("TypeScript forced module scope parity required".into());
    }
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &input.source_text, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err("TypeScript parser recovery parity required".into());
    }
    let is_esm = parsed.program.body.iter().any(|statement| {
        matches!(
            statement,
            Statement::ImportDeclaration(_)
                | Statement::ExportDeclaration(_)
                | Statement::ExportNamedDeclaration(_)
                | Statement::ExportFromDeclaration(_)
                | Statement::ExportAllDeclaration(_)
                | Statement::ExportDefaultDeclaration(_)
        )
    });
    let built = SemanticBuilder::new_compiler()
        .with_build_nodes(true)
        .build(&parsed.program);
    if !built.diagnostics.is_empty() {
        return Err("TypeScript semantic recovery parity required".into());
    }
    let semantic = &built.semantic;
    if semantic.nodes().iter().any(|node| {
        semantic
            .nodes()
            .ancestor_kinds(node.id())
            .take(MAX_LOWERED_AST_DEPTH + 1)
            .count()
            > MAX_LOWERED_AST_DEPTH
    }) {
        return Err("AST depth requires canonical analysis".into());
    }
    let is_js = matches!(
        Path::new(&input.file_name)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("js" | "jsx")
    );
    let is_commonjs_require = is_js && semantic.nodes().iter().any(|node| matches!(node.kind(), AstKind::CallExpression(call) if call.arguments.len() == 1 && matches!(&call.callee, Expression::Identifier(reference) if reference.name == "require")));
    let is_commonjs = !is_esm
        && (is_commonjs_require
            || is_js
                && semantic.nodes().iter().any(|node| match node.kind() {
                    AstKind::AssignmentExpression(assignment) => {
                        commonjs_assignment_indicator(assignment)
                    }
                    AstKind::CallExpression(call) => commonjs_define_property_indicator(call),
                    _ => false,
                }));
    if is_js && !is_esm && !is_commonjs && has_uncertain_secondary_commonjs_assignment(semantic) {
        return Err("secondary CommonJS export assignment binding parity required".into());
    }
    let mut global_scopes = HashSet::new();
    if !is_esm && !is_commonjs {
        global_scopes.insert(semantic.scoping().root_scope_id());
    }
    let mut inert_ambient_modules = Vec::new();
    for node in semantic.nodes().iter() {
        if let AstKind::TSExternalModuleDeclaration(module) = node.kind() {
            if is_esm || is_commonjs {
                return Err("source-file module augmentation semantics".into());
            }
            if module
                .body
                .as_ref()
                .is_none_or(|body| declaration_body_is_type_only(&body.body))
            {
                continue;
            }
            if !input.file_name.ends_with(".d.ts") || !ambient_module_is_inert(module, semantic) {
                return Err("value-bearing ambient module semantics".into());
            }
            inert_ambient_modules.push(module.span);
        }
    }
    let mut namespace_states = HashMap::new();
    let mut file = File {
        name: normalize_absolute_path(Path::new(&input.file_name)),
        is_commonjs,
        ..File::default()
    };
    for node in semantic.nodes().iter() {
        match node.kind() {
            AstKind::TSNamespaceDeclaration(namespace) => {
                let has_value = namespace_value_state(namespace)
                    .ok_or("namespace instantiation alias semantics")?;
                if has_value && !input.file_name.ends_with(".d.ts")
                    || !declaration_region_is_inert(namespace.span, semantic, false)
                {
                    return Err("value-bearing TypeScript namespace semantics".into());
                }
                if semantic
                    .nodes()
                    .ancestor_kinds(node.id())
                    .any(|ancestor| matches!(ancestor, AstKind::TSGlobalDeclaration(_)))
                {
                    return Err("namespace inside global augmentation semantics".into());
                }
                *namespace_states
                    .entry(namespace.id.symbol_id())
                    .or_insert(false) |= has_value;
            }
            AstKind::TSNamespaceExportDeclaration(_) => {
                return Err("global namespace export binding semantics".into());
            }
            AstKind::TSGlobalDeclaration(global) => {
                if !is_esm {
                    return Err("global augmentation in a script".into());
                }
                if let Some(scope) = global.scope_id.get() {
                    global_scopes.insert(scope);
                }
            }
            AstKind::TSImportEqualsDeclaration(_) | AstKind::TSExportAssignment(_) => {
                let span = node.kind().span();
                if !inert_ambient_modules
                    .iter()
                    .any(|module| module.start <= span.start && span.end <= module.end)
                {
                    return Err("TypeScript import/export-equals semantics".into());
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                if let Some(initializer) = &declarator.init {
                    let is_const = matches!(semantic.nodes().parent_kind(node.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const());
                    lower_binding(
                        &declarator.id,
                        lower_expression(initializer, semantic),
                        is_const,
                        &mut file,
                    );
                }
            }
            AstKind::CallExpression(call) => {
                let call_or_apply_receiver = if matches!(
                    &call.callee,
                    Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)
                ) {
                    match lower_expression(&call.callee, semantic) {
                        ExpressionEvidence::Member(receiver, name)
                            if name == "call" || name == "apply" =>
                        {
                            Some(*receiver)
                        }
                        _ => None,
                    }
                } else {
                    None
                };
                let mut parent = semantic.nodes().parent_node(node.id());
                while matches!(
                    parent.kind(),
                    AstKind::ParenthesizedExpression(_)
                        | AstKind::TSAsExpression(_)
                        | AstKind::TSSatisfiesExpression(_)
                        | AstKind::TSNonNullExpression(_)
                        | AstKind::TSTypeAssertion(_)
                        | AstKind::ChainExpression(_)
                ) {
                    parent = semantic.nodes().parent_node(parent.id());
                }
                let consumed = !matches!(parent.kind(), AstKind::ExpressionStatement(_))
                    && !matches!(parent.kind(), AstKind::UnaryExpression(unary) if unary.operator.as_str() == "void");
                file.uses.push(Use::Call {
                    callee: lower_expression(&call.callee, semantic),
                    consumed,
                    call_or_apply_receiver,
                });
            }
            AstKind::JSXOpeningElement(opening) => {
                let tag = match &opening.name {
                    JSXElementName::IdentifierReference(reference) => {
                        identifier(reference, semantic)
                    }
                    JSXElementName::Identifier(_) => ExpressionEvidence::Empty,
                    JSXElementName::MemberExpression(member) => lower_jsx_member(member, semantic),
                    _ => ExpressionEvidence::Empty,
                };
                let attributes = opening.attributes.iter().filter_map(|attribute| {
                    let JSXAttributeItem::Attribute(attribute) = attribute else { return None; };
                    if !matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "reducedMotion") { return None; }
                    match &attribute.value {
                        Some(JSXAttributeValue::StringLiteral(value)) => Some(ExpressionEvidence::String(value.value.to_string())),
                        Some(JSXAttributeValue::ExpressionContainer(container)) => container.expression.as_expression().map(|expression| lower_expression(expression, semantic)),
                        _ => None,
                    }
                }).collect();
                file.uses.push(Use::Jsx { tag, attributes });
            }
            _ => {}
        }
    }
    for statement in &parsed.program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                for specifier in import.specifiers.iter().flatten() {
                    let (symbol, evidence) = match specifier {
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => (
                            namespace.local.symbol_id(),
                            if is_motion_source(&import.source.value) {
                                ExpressionEvidence::Namespace
                            } else {
                                ExpressionEvidence::Empty
                            },
                        ),
                        ImportDeclarationSpecifier::ImportSpecifier(named) => (
                            named.local.symbol_id(),
                            if named.import_kind.is_type() {
                                ExpressionEvidence::Empty
                            } else {
                                ExpressionEvidence::Import(
                                    import.source.value.to_string(),
                                    named.imported.name().to_string(),
                                )
                            },
                        ),
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => (
                            default.local.symbol_id(),
                            if import.import_kind.is_type() {
                                ExpressionEvidence::Empty
                            } else {
                                ExpressionEvidence::Import(
                                    import.source.value.to_string(),
                                    "default".into(),
                                )
                            },
                        ),
                    };
                    file.bindings.insert(
                        symbol,
                        Binding {
                            initializer: evidence,
                            is_const: false,
                            is_destructured: false,
                        },
                    );
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(expression) = export.declaration.as_expression() {
                    file.exports
                        .push(Export::Default(lower_expression(expression, semantic)));
                }
            }
            Statement::ExportAllDeclaration(export)
                if !export.export_kind.is_type() && export.exported.is_none() =>
            {
                file.exports.push(Export::From {
                    name: None,
                    source: export.source.value.to_string(),
                    imported: String::new(),
                });
            }
            Statement::ExportFromDeclaration(export) if !export.export_kind.is_type() => {
                for specifier in &export.specifiers {
                    if !specifier.export_kind.is_type() {
                        file.exports.push(Export::From {
                            name: Some(specifier.exported.name().to_string()),
                            source: export.source.value.to_string(),
                            imported: specifier.local.name().to_string(),
                        });
                    }
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    if let Some(symbol) = semantic
                        .scoping()
                        .get_root_binding(specifier.local.name().into())
                    {
                        file.exports.push(Export::Local {
                            name: specifier.exported.name().to_string(),
                            symbol,
                            alias: true,
                        });
                    }
                }
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(declaration) = &export.declaration {
                    for declarator in &declaration.declarations {
                        if let BindingPattern::BindingIdentifier(binding) = &declarator.id {
                            file.exports.push(Export::Local {
                                name: binding.name.to_string(),
                                symbol: binding.symbol_id(),
                                alias: false,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for symbol in semantic.scoping().symbol_ids() {
        let flags = semantic.scoping().symbol_flags(symbol);
        let namespace_state = namespace_states.get(&symbol).copied();
        let namespace_only = namespace_state.is_some()
            && semantic
                .scoping()
                .symbol_declarations(symbol)
                .all(|declaration| {
                    matches!(
                        semantic.nodes().kind(declaration),
                        AstKind::TSNamespaceDeclaration(_)
                    )
                });
        if namespace_only && flags.is_value() != (namespace_state == Some(true)) {
            return Err("namespace value binding semantic disagreement".into());
        }
        if namespace_only {
            file.namespace_symbols.insert(symbol);
        }
        if namespace_state.is_some()
            && global_scopes.contains(&semantic.scoping().symbol_scope_id(symbol))
        {
            file.global_namespaces
                .insert(symbol, semantic.scoping().symbol_name(symbol).to_string());
        }
        if namespace_state.is_some() && !namespace_only {
            file.bindings.insert(
                symbol,
                Binding {
                    initializer: ExpressionEvidence::Unsupported(
                        "reachable merged namespace binding parity required",
                    ),
                    is_const: false,
                    is_destructured: false,
                },
            );
        }
        if is_commonjs
            && matches!(semantic.scoping().symbol_name(symbol), "module" | "exports")
            && let Some(binding) = file.bindings.get_mut(&symbol)
        {
            binding.initializer = ExpressionEvidence::Unsupported(
                "reachable CommonJS synthetic/local export binding parity required",
            );
        }
        let is_value_binding = if namespace_only {
            namespace_state == Some(true)
        } else {
            flags.is_value()
        };
        if global_scopes.contains(&semantic.scoping().symbol_scope_id(symbol)) && is_value_binding {
            file.globals
                .insert(symbol, semantic.scoping().symbol_name(symbol).to_string());
            if flags.is_function_scoped_declaration() || flags.is_function() {
                file.mergeable_globals.insert(symbol);
            }
            if flags.is_function() {
                file.function_globals.insert(symbol);
            }
        }
        let redeclarations = semantic.scoping().symbol_redeclarations(symbol);
        if (!redeclarations.is_empty() || flags.is_function())
            && file.bindings.contains_key(&symbol)
        {
            let mut variable_declarations = 0;
            let mut all_variables_are_var = true;
            let is_supported_merge = !flags.is_function() && semantic.scoping().symbol_declarations(symbol).all(|declaration| match semantic.nodes().kind(declaration) {
                AstKind::VariableDeclarator(declarator) => {
                    variable_declarations += 1;
                    all_variables_are_var &= matches!(semantic.nodes().parent_kind(declaration), AstKind::VariableDeclaration(variable) if variable.kind.is_var());
                    matches!(&declarator.id, BindingPattern::BindingIdentifier(_))
                },
                AstKind::TSInterfaceDeclaration(_) | AstKind::TSTypeAliasDeclaration(_) => true,
                _ => false,
            }) && variable_declarations > 0 && (variable_declarations == 1 || all_variables_are_var);
            if !is_supported_merge {
                file.bindings
                    .get_mut(&symbol)
                    .expect("existing binding")
                    .initializer = ExpressionEvidence::Unsupported(
                    "reachable merged/redeclared symbol parity required",
                );
            }
        }
    }
    Ok(file)
}

#[derive(Clone, Default)]
struct Visited {
    symbols: HashSet<(usize, SymbolId)>,
    globals: HashSet<String>,
    modules: HashSet<usize>,
    exports: HashSet<(usize, String)>,
}

struct Resolver {
    files: Vec<File>,
    indexes: HashMap<PathBuf, usize>,
    folded_indexes: HashSet<String>,
    globals: HashMap<String, Vec<(usize, SymbolId)>>,
    namespace_globals: HashSet<String>,
    unsupported: RefCell<HashSet<String>>,
    recursion_depth: Cell<usize>,
}
struct ResolutionDepthGuard<'a> {
    depth: &'a Cell<usize>,
}
impl Drop for ResolutionDepthGuard<'_> {
    fn drop(&mut self) {
        self.depth.set(self.depth.get() - 1);
    }
}

impl Resolver {
    fn enter_resolution(&self, file: usize) -> Option<ResolutionDepthGuard<'_>> {
        let depth = self.recursion_depth.get();
        if depth >= MAX_ANALYZER_RECURSION_DEPTH {
            self.unknown(file, "resolution depth requires canonical analysis");
            return None;
        }
        self.recursion_depth.set(depth + 1);
        Some(ResolutionDepthGuard {
            depth: &self.recursion_depth,
        })
    }

    fn unknown(&self, file: usize, reason: &str) -> Evidence {
        self.unsupported
            .borrow_mut()
            .insert(format!("{}: {reason}", self.files[file].name.display()));
        Evidence::default()
    }

    fn global_declarations_conflict(&self, name: &str, declarations: &[(usize, SymbolId)]) -> bool {
        if self.namespace_globals.contains(name) {
            return declarations
                .iter()
                .any(|(file, symbol)| !self.files[*file].namespace_symbols.contains(symbol));
        }
        if declarations.len() < 2 {
            return false;
        }
        declarations
            .iter()
            .any(|(file, symbol)| !self.files[*file].mergeable_globals.contains(symbol))
            || declarations
                .iter()
                .any(|(file, symbol)| self.files[*file].function_globals.contains(symbol))
                && declarations
                    .iter()
                    .any(|(file, symbol)| self.files[*file].bindings.contains_key(symbol))
    }

    fn global(&self, from_file: usize, name: &str, visited: &Visited) -> Evidence {
        let Some(_depth_guard) = self.enter_resolution(from_file) else {
            return Evidence::default();
        };
        if self.files[from_file].is_commonjs && matches!(name, "module" | "exports") {
            return self.unknown(
                from_file,
                "reachable CommonJS implicit export binding parity required",
            );
        }
        let Some(declarations) = self.globals.get(name) else {
            return Evidence::default();
        };
        let mut next = visited.clone();
        if !next.globals.insert(name.to_string()) {
            return Evidence::default();
        }
        if self.global_declarations_conflict(name, declarations) {
            return self.unknown(
                from_file,
                "reachable conflicting global binding parity required",
            );
        }
        let mut result = Evidence::default();
        for (file, symbol) in declarations {
            if let Some(binding) = self.files[*file].bindings.get(symbol) {
                let mut branch = next.clone();
                branch.symbols.insert((*file, *symbol));
                result.0 |= self.expression(*file, &binding.initializer, &branch).0;
            }
        }
        result
    }

    fn local_module(&self, file: usize, source: &str) -> Option<usize> {
        if !source.starts_with('.') {
            return None;
        }
        if source.contains(['\\', ':', '\0']) {
            self.unknown(file, "unproven relative module path semantics");
            return None;
        }
        let base = normalize_absolute_path(&self.files[file].name.parent()?.join(source));
        let mut candidates = vec![base.clone()];
        if matches!(
            base.extension().and_then(|extension| extension.to_str()),
            Some("js" | "jsx")
        ) {
            let without_extension = base.with_extension("");
            candidates.push(PathBuf::from(format!("{}.ts", without_extension.display())));
            candidates.push(PathBuf::from(format!(
                "{}.tsx",
                without_extension.display()
            )));
            candidates.push(without_extension.join("index.ts"));
            candidates.push(without_extension.join("index.tsx"));
        }
        for extension in ["ts", "tsx", "js", "jsx"] {
            candidates.push(PathBuf::from(format!("{}.{}", base.display(), extension)));
        }
        for extension in ["ts", "tsx", "js", "jsx"] {
            candidates.push(base.join(format!("index.{extension}")));
        }
        for candidate in &candidates {
            let text = candidate.to_string_lossy();
            if !text.is_ascii() {
                self.unknown(file, "Unicode module filename case-folding parity required");
                return None;
            }
            if let Some(target) = self.indexes.get(candidate) {
                return Some(*target);
            }
            if self.folded_indexes.contains(&text.to_ascii_lowercase()) {
                self.unknown(
                    file,
                    "case-sensitive compiler-host resolution must be specified",
                );
                return None;
            }
        }
        None
    }

    fn expression(
        &self,
        file: usize,
        expression: &ExpressionEvidence,
        visited: &Visited,
    ) -> Evidence {
        let Some(_depth_guard) = self.enter_resolution(file) else {
            return Evidence::default();
        };
        match expression {
            ExpressionEvidence::Symbol(symbol) => {
                if let Some(name) = self.files[file].globals.get(symbol) {
                    return self.global(file, name, visited);
                }
                let mut next = visited.clone();
                if !next.symbols.insert((file, *symbol)) {
                    return Evidence::default();
                }
                self.files[file]
                    .bindings
                    .get(symbol)
                    .map(|binding| self.expression(file, &binding.initializer, &next))
                    .unwrap_or_default()
            }
            ExpressionEvidence::Global(name) => self.global(file, name, visited),
            ExpressionEvidence::GlobalRequire => {
                if self.globals.contains_key("require") {
                    let evidence = self.global(file, "require", visited);
                    if evidence.0 & FACTORY != 0 {
                        Evidence(COMPONENT)
                    } else {
                        evidence
                    }
                } else {
                    Evidence(NAMESPACE)
                }
            }
            ExpressionEvidence::Merge(initializers) => {
                let mut result = Evidence::default();
                for initializer in initializers {
                    result.0 |= self.expression(file, initializer, visited).0;
                }
                result
            }
            ExpressionEvidence::Unsupported(reason) => self.unknown(file, reason),
            ExpressionEvidence::Member(receiver, name) => {
                classify_member(self.expression(file, receiver, visited), name)
            }
            ExpressionEvidence::Call(callee, is_static_bind) => {
                if *is_static_bind && let ExpressionEvidence::Member(receiver, _) = callee.as_ref()
                {
                    let evidence = self.expression(file, receiver, visited);
                    if evidence.0 & ANIMATION != 0 {
                        return evidence;
                    }
                }
                let evidence = self.expression(file, callee, visited);
                if evidence.0 & FACTORY != 0 {
                    Evidence(COMPONENT)
                } else {
                    evidence
                }
            }
            ExpressionEvidence::Import(source, name) => {
                if is_motion_source(source) {
                    classify_export(name)
                } else {
                    self.local_module(file, source)
                        .map(|target| self.export(target, name, visited))
                        .unwrap_or_default()
                }
            }
            ExpressionEvidence::Namespace => Evidence(NAMESPACE),
            _ => Evidence::default(),
        }
    }

    fn export(&self, file: usize, name: &str, visited: &Visited) -> Evidence {
        let Some(_depth_guard) = self.enter_resolution(file) else {
            return Evidence::default();
        };
        let mut next = visited.clone();
        if !next.modules.insert(file) {
            return Evidence::default();
        }
        for export in &self.files[file].exports {
            match export {
                Export::Default(expression) if name == "default" => {
                    let evidence = self.expression(file, expression, &next);
                    if evidence.0 != 0 {
                        return evidence;
                    }
                }
                Export::From {
                    name: exported,
                    source,
                    imported,
                } if exported.as_ref().is_none_or(|exported| exported == name) => {
                    let imported = if exported.is_none() { name } else { imported };
                    let evidence = if is_motion_source(source) {
                        classify_export(imported)
                    } else {
                        let Some(target) = self.local_module(file, source) else {
                            continue;
                        };
                        self.export(target, imported, &next)
                    };
                    if exported.is_some() || evidence.0 != 0 {
                        return evidence;
                    }
                }
                _ => {}
            }
        }
        if !next.exports.insert((file, name.to_string())) {
            return Evidence::default();
        }
        let mut result = Evidence::default();
        for export in &self.files[file].exports {
            if let Export::Local {
                name: exported,
                symbol,
                alias,
            } = export
                && exported == name
            {
                let mut branch = next.clone();
                if !alias && !branch.symbols.insert((file, *symbol)) {
                    continue;
                }
                if let Some(binding) = self.files[file].bindings.get(symbol) {
                    if let ExpressionEvidence::Unsupported(reason) = &binding.initializer {
                        self.unknown(file, reason);
                    } else if !binding.is_destructured {
                        result.0 |= self.expression(file, &binding.initializer, &branch).0;
                    }
                }
            }
        }
        result
    }

    fn string<'a>(
        &'a self,
        file: usize,
        expression: &'a ExpressionEvidence,
        visited: &mut HashSet<(usize, SymbolId)>,
    ) -> Option<&'a str> {
        let Some(_depth_guard) = self.enter_resolution(file) else {
            return None;
        };
        match expression {
            ExpressionEvidence::String(value) => Some(value),
            ExpressionEvidence::Symbol(symbol) if self.files[file].globals.contains_key(symbol) => {
                self.global_string(file, &self.files[file].globals[symbol], visited)
            }
            ExpressionEvidence::Global(name) => self.global_string(file, name, visited),
            ExpressionEvidence::Symbol(symbol) if visited.insert((file, *symbol)) => {
                let binding = self.files[file].bindings.get(symbol)?;
                if let ExpressionEvidence::Unsupported(reason) = &binding.initializer {
                    self.unknown(file, reason);
                    return None;
                }
                if !binding.is_const {
                    return None;
                }
                self.string(file, &binding.initializer, visited)
            }
            ExpressionEvidence::Unsupported(reason) => {
                self.unknown(file, reason);
                None
            }
            _ => None,
        }
    }

    fn global_string<'a>(
        &'a self,
        from_file: usize,
        name: &str,
        visited: &mut HashSet<(usize, SymbolId)>,
    ) -> Option<&'a str> {
        let Some(_depth_guard) = self.enter_resolution(from_file) else {
            return None;
        };
        if self.files[from_file].is_commonjs && matches!(name, "module" | "exports") {
            self.unknown(
                from_file,
                "reachable CommonJS implicit export string binding parity required",
            );
            return None;
        }
        let declarations = self.globals.get(name)?;
        if self.global_declarations_conflict(name, declarations) {
            self.unknown(
                from_file,
                "reachable conflicting global string binding parity required",
            );
            return None;
        }
        if declarations.len() > 1 {
            for (file, symbol) in declarations {
                if let Some(binding) = self.files[*file].bindings.get(symbol)
                    && let ExpressionEvidence::Unsupported(reason) = &binding.initializer
                {
                    self.unknown(*file, reason);
                }
            }
            return None;
        }
        let (file, symbol) = declarations[0];
        if !visited.insert((file, symbol)) {
            return None;
        }
        let binding = self.files[file].bindings.get(&symbol)?;
        if let ExpressionEvidence::Unsupported(reason) = &binding.initializer {
            self.unknown(file, reason);
            return None;
        }
        if !binding.is_const {
            return None;
        }
        self.string(file, &binding.initializer, visited)
    }

    fn analyze(&self) -> ReducedMotionEvidence {
        let mut result = ReducedMotionEvidence::default();
        for (file, source) in self.files.iter().enumerate() {
            for usage in &source.uses {
                match usage {
                    Use::Call {
                        callee,
                        consumed,
                        call_or_apply_receiver,
                    } => {
                        let evidence = self.expression(file, callee, &Visited::default());
                        let call_or_apply =
                            call_or_apply_receiver.as_ref().is_some_and(|receiver| {
                                self.expression(file, receiver, &Visited::default()).0 & ANIMATION
                                    != 0
                            });
                        result.has_motion_use |= evidence.0 & ANIMATION != 0 || call_or_apply;
                        result.has_reduced_motion_handling |= evidence.0 & HOOK != 0 && *consumed;
                    }
                    Use::Jsx { tag, attributes } => {
                        let evidence = self.expression(file, tag, &Visited::default());
                        result.has_motion_use |= evidence.0 & (COMPONENT | FACTORY) != 0;
                        result.has_reduced_motion_handling |= evidence.0 & CONFIG != 0
                            && attributes.iter().any(|attribute| {
                                matches!(
                                    self.string(file, attribute, &mut HashSet::new()),
                                    Some("always" | "user")
                                )
                            });
                    }
                }
                if result.has_motion_use && result.has_reduced_motion_handling {
                    return result;
                }
            }
        }
        result
    }
}

pub fn analyze_reduced_motion(
    sources: Vec<ReducedMotionSourceInput>,
) -> ReducedMotionAnalysisResult {
    if cfg!(windows) {
        return ReducedMotionAnalysisResult::Unsupported {
            unsupported: vec!["Windows path semantics require canonical analysis".into()],
        };
    }
    let invalid_paths: Vec<String> = sources
        .iter()
        .filter(|source| !is_normalized_source_path(&source.file_name))
        .map(|source| {
            format!(
                "{}: canonical normalized absolute ASCII source path required",
                source.file_name
            )
        })
        .collect();
    if !invalid_paths.is_empty() {
        return ReducedMotionAnalysisResult::Unsupported {
            unsupported: invalid_paths,
        };
    }
    let prefilter = lazy_regex::Regex::new(
        r#"framer-motion|["']motion(?:/[A-Za-z0-9_./-]+)?["']|MotionConfig|useReducedMotion"#,
    )
    .expect("canonical prefilter");
    if !sources
        .iter()
        .any(|source| prefilter.is_match(&source.source_text))
    {
        return ReducedMotionAnalysisResult::Supported(ReducedMotionEvidence::default());
    }
    let mut files = Vec::new();
    let mut indexes = HashMap::new();
    let mut folded_indexes = HashSet::new();
    let mut unsupported = Vec::new();
    for source in &sources {
        match lower_file(source) {
            Ok(file) => {
                if !folded_indexes.insert(file.name.to_string_lossy().to_ascii_lowercase()) {
                    unsupported.push(format!(
                        "{}: colliding normalized/case-folded source names",
                        source.file_name
                    ));
                }
                indexes.insert(file.name.clone(), files.len());
                files.push(file);
            }
            Err(reason) => unsupported.push(format!("{}: {reason}", source.file_name)),
        }
    }
    if !unsupported.is_empty() {
        return ReducedMotionAnalysisResult::Unsupported { unsupported };
    }
    let mut globals: HashMap<String, Vec<(usize, SymbolId)>> = HashMap::new();
    let mut namespace_globals = HashSet::new();
    for (file, source) in files.iter().enumerate() {
        for (symbol, name) in &source.globals {
            globals
                .entry(name.clone())
                .or_default()
                .push((file, *symbol));
        }
        namespace_globals.extend(source.global_namespaces.values().cloned());
    }
    let resolver = Resolver {
        files,
        indexes,
        folded_indexes,
        globals,
        namespace_globals,
        unsupported: RefCell::new(HashSet::new()),
        recursion_depth: Cell::new(0),
    };
    let evidence = resolver.analyze();
    let mut unresolved: Vec<String> = resolver.unsupported.into_inner().into_iter().collect();
    if unresolved.is_empty() {
        ReducedMotionAnalysisResult::Supported(evidence)
    } else {
        unresolved.sort();
        ReducedMotionAnalysisResult::Unsupported {
            unsupported: unresolved,
        }
    }
}
