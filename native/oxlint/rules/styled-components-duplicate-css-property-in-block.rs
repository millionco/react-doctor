use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, CallExpression, ChainElement, Expression,
        FormalParameters, MemberExpression, ObjectPropertyKind, Statement, TemplateLiteral,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const STYLED_COMPONENTS_MODULES: [&str; 1] = ["styled-components"];
const STYLED_CSS_MAX_SAFE_ARRAY_INDEX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Default, Clone)]
pub struct StyledComponentsDuplicateCssPropertyInBlock;

#[derive(Clone)]
struct StyledCssTest {
    key: String,
    always_produces_css_value: bool,
}

struct StyledCssDeclaration {
    property: String,
    is_important: bool,
    tests: Vec<StyledCssTest>,
}

#[derive(Clone)]
struct StyledCssParameterBinding<'ast, 'borrow> {
    path: StyledCssParameterPath,
    default_values: Vec<&'borrow Expression<'ast>>,
}

#[derive(Clone)]
struct StyledCssParameterPath {
    parameter_index: usize,
    segments: Vec<StyledCssParameterSegment>,
}

#[derive(Clone, Eq, PartialEq)]
enum StyledCssParameterSegment {
    Property(String),
    ArrayRest(usize),
    ObjectRest(Vec<String>),
}

struct StyledCssTestEnvironment<'ast, 'borrow, 'ctx, 'analysis> {
    parameter_bindings: FxHashMap<SymbolId, StyledCssParameterBinding<'ast, 'borrow>>,
    local_binding_symbols: FxHashSet<SymbolId>,
    local_initializers: FxHashMap<SymbolId, &'borrow Expression<'ast>>,
    ctx: &'ctx LintContext<'ast>,
    mutation_spans: &'analysis [Span],
}

declare_oxc_lint!(
    /// Disallow conflicting conditional declarations of the same CSS property.
    StyledComponentsDuplicateCssPropertyInBlock,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow conflicting conditional declarations in styled blocks.",
);

impl Rule for StyledComponentsDuplicateCssPropertyInBlock {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut mutation_spans = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(
                    node.kind(),
                    AstKind::AssignmentExpression(_) | AstKind::UpdateExpression(_)
                )
                .then(|| node.span())
            })
            .collect::<Vec<_>>();
        mutation_spans.sort_unstable_by_key(|span| (span.start, span.end));
        for node in ctx.nodes().iter() {
            let AstKind::TaggedTemplateExpression(template) = node.kind() else {
                continue;
            };
            if !styled_css_is_proven_template_tag(&template.tag, ctx) {
                continue;
            }
            let declarations =
                styled_css_top_level_declarations(&template.quasi, &mutation_spans, ctx);
            let mut occurrences_by_property: FxHashMap<String, Vec<StyledCssDeclaration>> =
                FxHashMap::default();
            let mut property_order = Vec::new();
            for declaration in declarations {
                if !occurrences_by_property.contains_key(&declaration.property) {
                    property_order.push(declaration.property.clone());
                }
                occurrences_by_property
                    .entry(declaration.property.clone())
                    .or_default()
                    .push(declaration);
            }
            for property in property_order {
                let occurrences = &occurrences_by_property[&property];
                let conditional = occurrences
                    .iter()
                    .filter(|occurrence| !occurrence.tests.is_empty())
                    .collect::<Vec<_>>();
                if conditional.len() < 2 || styled_css_all_tests_equal(&conditional) {
                    continue;
                }
                if !styled_css_has_conflicting_override(occurrences) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "The CSS property `{property}` is declared {} times at the same level here, so a later conditional value can override an earlier one — merge them into a single declaration to make the precedence explicit.",
                        occurrences.len()
                    ))
                    .with_label(template.span),
                );
            }
        }
    }
}

fn styled_css_is_proven_template_tag<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if module_api_path_matches(expression, &["css"], &STYLED_COMPONENTS_MODULES, false, ctx) {
        return true;
    }
    let Some(root) = styled_css_factory_root(expression) else {
        return false;
    };
    module_api_path_matches(root, &[], &STYLED_COMPONENTS_MODULES, true, ctx)
        || module_api_path_matches(root, &["styled"], &STYLED_COMPONENTS_MODULES, false, ctx)
}

fn styled_css_factory_root<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
) -> Option<&'borrow Expression<'ast>> {
    match expression.get_inner_expression() {
        identifier @ Expression::Identifier(_) => Some(identifier),
        expression => {
            if let Some(member) = expression.as_member_expression() {
                return styled_css_factory_root(member.object());
            }
            let Expression::CallExpression(call) = expression else {
                return None;
            };
            styled_css_factory_root(&call.callee)
        }
    }
}

fn styled_css_top_level_declarations<'a>(
    template: &TemplateLiteral<'a>,
    mutation_spans: &[Span],
    ctx: &LintContext<'a>,
) -> Vec<StyledCssDeclaration> {
    let mut declarations = Vec::new();
    let mut brace_depth = 0usize;
    let mut parenthesis_depth = 0usize;
    let mut current_text = String::new();
    let mut current_tests = Vec::new();
    let mut active_quote = None;
    let mut is_escaped = false;
    let mut active_comment = None;

    for (quasi_index, quasi) in template.quasis.iter().enumerate() {
        let static_text = quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str());
        let characters = static_text.chars().collect::<Vec<_>>();
        let mut index = 0usize;
        while index < characters.len() {
            let character = characters[index];
            let next = characters.get(index + 1).copied();
            if active_comment == Some('b') {
                if character == '*' && next == Some('/') {
                    active_comment = None;
                    index += 2;
                } else {
                    index += 1;
                }
                continue;
            }
            if active_comment == Some('l') {
                if matches!(character, '\n' | '\r') {
                    active_comment = None;
                }
                index += 1;
                continue;
            }
            if let Some(quote) = active_quote {
                current_text.push(character);
                if is_escaped {
                    is_escaped = false;
                } else if character == '\\' {
                    is_escaped = true;
                } else if character == quote {
                    active_quote = None;
                }
                index += 1;
                continue;
            }
            if character == '/' && next == Some('*') {
                active_comment = Some('b');
                index += 2;
                continue;
            }
            if character == '/' && next == Some('/') && current_text.trim().is_empty() {
                active_comment = Some('l');
                index += 2;
                continue;
            }
            if matches!(character, '\'' | '"') {
                active_quote = Some(character);
                current_text.push(character);
            } else if character == '(' {
                parenthesis_depth += 1;
                current_text.push(character);
            } else if character == ')' {
                parenthesis_depth = parenthesis_depth.saturating_sub(1);
                current_text.push(character);
            } else if character == '{' && parenthesis_depth == 0 {
                if brace_depth == 0 {
                    styled_css_finalize_declaration(
                        &current_text,
                        &mut current_tests,
                        &mut declarations,
                    );
                }
                brace_depth += 1;
                current_text.clear();
                current_tests.clear();
            } else if character == '}' && parenthesis_depth == 0 {
                brace_depth = brace_depth.saturating_sub(1);
                current_text.clear();
                current_tests.clear();
            } else if character == ';' && parenthesis_depth == 0 {
                if brace_depth == 0 {
                    styled_css_finalize_declaration(
                        &current_text,
                        &mut current_tests,
                        &mut declarations,
                    );
                }
                current_text.clear();
                current_tests.clear();
            } else {
                current_text.push(character);
            }
            index += 1;
        }
        if let Some(expression) = template.expressions.get(quasi_index)
            && brace_depth == 0
            && active_comment.is_none()
        {
            if current_text.trim().is_empty() {
                current_text.clear();
                current_tests.clear();
            } else {
                current_text.push('\0');
                if let Some(test) = styled_css_ternary_test(expression, mutation_spans, ctx) {
                    current_tests.push(test);
                }
            }
        }
    }
    if brace_depth == 0 {
        styled_css_finalize_declaration(&current_text, &mut current_tests, &mut declarations);
    }
    declarations
}

fn styled_css_finalize_declaration(
    text: &str,
    tests: &mut Vec<StyledCssTest>,
    declarations: &mut Vec<StyledCssDeclaration>,
) {
    let Some(colon_index) = text.find(':') else {
        return;
    };
    let property = text[..colon_index].trim().to_ascii_lowercase();
    if property.is_empty()
        || property.starts_with("--")
        || !styled_css_valid_property_name(&property)
    {
        return;
    }
    declarations.push(StyledCssDeclaration {
        property,
        is_important: styled_css_ends_with_important(text),
        tests: std::mem::take(tests),
    });
}

fn styled_css_valid_property_name(property: &str) -> bool {
    let property = property.strip_prefix('-').unwrap_or(property);
    !property.is_empty()
        && property.as_bytes()[0].is_ascii_lowercase()
        && property
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
}

fn styled_css_ends_with_important(text: &str) -> bool {
    let text = text.trim_end();
    let Some(suffix_start) = text.len().checked_sub("important".len()) else {
        return false;
    };
    if !text.as_bytes()[suffix_start..].eq_ignore_ascii_case(b"important") {
        return false;
    }
    text[..suffix_start].trim_end().ends_with('!')
}

fn styled_css_ternary_test<'a>(
    expression: &Expression<'a>,
    mutation_spans: &[Span],
    ctx: &LintContext<'a>,
) -> Option<StyledCssTest> {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            let environment = StyledCssTestEnvironment {
                parameter_bindings: FxHashMap::default(),
                local_binding_symbols: FxHashSet::default(),
                local_initializers: FxHashMap::default(),
                ctx,
                mutation_spans,
            };
            Some(StyledCssTest {
                key: styled_css_expression_key(
                    &conditional.test,
                    &environment,
                    &mut FxHashSet::default(),
                ),
                always_produces_css_value: styled_css_conditional_always_produces(conditional),
            })
        }
        Expression::ArrowFunctionExpression(function) => {
            let function_body = function.body.as_function_body();
            let (returned, statements) = if let Some(returned) = function.get_expression() {
                (returned, None)
            } else {
                styled_css_conditional_return(function_body?.statements.as_slice())?
            };
            styled_css_callback_ternary(returned, &function.params, statements, mutation_spans, ctx)
        }
        Expression::FunctionExpression(function) => {
            let body = function.body.as_ref()?;
            let (returned, statements) = styled_css_conditional_return(body.statements.as_slice())?;
            styled_css_callback_ternary(returned, &function.params, statements, mutation_spans, ctx)
        }
        _ => None,
    }
}

fn styled_css_conditional_return<'ast, 'borrow>(
    statements: &'borrow [Statement<'ast>],
) -> Option<(
    &'borrow Expression<'ast>,
    Option<&'borrow [Statement<'ast>]>,
)> {
    statements
        .iter()
        .enumerate()
        .find_map(|(statement_index, statement)| {
            let Statement::ReturnStatement(statement) = statement else {
                return None;
            };
            let argument = statement.argument.as_ref()?;
            matches!(
                argument.get_inner_expression(),
                Expression::ConditionalExpression(_)
            )
            .then_some((argument, Some(&statements[..=statement_index])))
        })
}

fn styled_css_callback_ternary<'a>(
    returned: &Expression<'a>,
    parameters: &FormalParameters<'a>,
    statements: Option<&[Statement<'a>]>,
    mutation_spans: &[Span],
    ctx: &LintContext<'a>,
) -> Option<StyledCssTest> {
    let Expression::ConditionalExpression(conditional) = returned.get_inner_expression() else {
        return None;
    };
    let environment = styled_css_test_environment(parameters, statements, mutation_spans, ctx);
    Some(StyledCssTest {
        key: styled_css_expression_key(&conditional.test, &environment, &mut FxHashSet::default()),
        always_produces_css_value: styled_css_conditional_always_produces(conditional),
    })
}

fn styled_css_conditional_always_produces(
    conditional: &oxc_ast::ast::ConditionalExpression<'_>,
) -> bool {
    [&conditional.consequent, &conditional.alternate]
        .into_iter()
        .all(|branch| match branch.get_inner_expression() {
            Expression::ConditionalExpression(nested) => {
                styled_css_conditional_always_produces(nested)
            }
            expression => !styled_css_is_flattened_value(expression),
        })
}

fn styled_css_is_flattened_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::StringLiteral(literal) => literal.value.is_empty(),
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        _ => false,
    }
}

fn styled_css_test_environment<'ast, 'borrow, 'ctx, 'analysis>(
    parameters: &'borrow FormalParameters<'ast>,
    statements: Option<&'borrow [Statement<'ast>]>,
    mutation_spans: &'analysis [Span],
    ctx: &'ctx LintContext<'ast>,
) -> StyledCssTestEnvironment<'ast, 'borrow, 'ctx, 'analysis> {
    let mut environment = StyledCssTestEnvironment {
        parameter_bindings: FxHashMap::default(),
        local_binding_symbols: FxHashSet::default(),
        local_initializers: FxHashMap::default(),
        ctx,
        mutation_spans,
    };
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        styled_css_collect_binding_symbols(
            &parameter.pattern,
            &mut environment.local_binding_symbols,
        );
        styled_css_collect_parameter_bindings(
            &parameter.pattern,
            StyledCssParameterPath {
                parameter_index,
                segments: Vec::new(),
            },
            Vec::new(),
            &mut environment.parameter_bindings,
        );
    }
    if let Some(rest) = &parameters.rest {
        styled_css_collect_binding_symbols(
            &rest.rest.argument,
            &mut environment.local_binding_symbols,
        );
        styled_css_collect_parameter_bindings(
            &rest.rest.argument,
            StyledCssParameterPath {
                parameter_index: parameters.items.len(),
                segments: vec![StyledCssParameterSegment::ArrayRest(0)],
            },
            Vec::new(),
            &mut environment.parameter_bindings,
        );
    }
    let Some(statements) = statements else {
        return environment;
    };
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            styled_css_collect_binding_symbols(
                &declarator.id,
                &mut environment.local_binding_symbols,
            );
            let Some(initializer) = &declarator.init else {
                continue;
            };
            if declaration.kind.is_const()
                && let Some(binding) = styled_css_parameter_binding(
                    initializer,
                    &environment,
                    &mut FxHashSet::default(),
                )
            {
                styled_css_collect_parameter_bindings(
                    &declarator.id,
                    binding.path,
                    binding.default_values,
                    &mut environment.parameter_bindings,
                );
            }
            if declaration.kind.is_const()
                && let BindingPattern::BindingIdentifier(identifier) = &declarator.id
            {
                environment
                    .local_initializers
                    .insert(identifier.symbol_id(), initializer);
            }
        }
    }
    environment
}

fn styled_css_collect_parameter_bindings<'ast, 'borrow>(
    pattern: &'borrow BindingPattern<'ast>,
    path: StyledCssParameterPath,
    mut default_values: Vec<&'borrow Expression<'ast>>,
    bindings: &mut FxHashMap<SymbolId, StyledCssParameterBinding<'ast, 'borrow>>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            bindings.insert(
                identifier.symbol_id(),
                StyledCssParameterBinding {
                    path,
                    default_values,
                },
            );
        }
        BindingPattern::AssignmentPattern(assignment) => {
            if !path.segments.is_empty() {
                default_values.push(&assignment.right);
            }
            styled_css_collect_parameter_bindings(&assignment.left, path, default_values, bindings);
        }
        BindingPattern::ObjectPattern(object) => {
            let mut property_names = Vec::new();
            let mut has_dynamic_property = false;
            for property in &object.properties {
                let Some(property_name) = property.key.static_name() else {
                    has_dynamic_property = true;
                    continue;
                };
                property_names.push(property_name.to_string());
                let mut property_path = path.clone();
                property_path
                    .segments
                    .push(StyledCssParameterSegment::Property(
                        property_name.to_string(),
                    ));
                styled_css_collect_parameter_bindings(
                    &property.value,
                    property_path,
                    default_values.clone(),
                    bindings,
                );
            }
            if !has_dynamic_property && let Some(rest) = &object.rest {
                property_names.sort();
                property_names.dedup();
                let mut rest_path = path;
                rest_path
                    .segments
                    .push(StyledCssParameterSegment::ObjectRest(property_names));
                styled_css_collect_parameter_bindings(
                    &rest.argument,
                    rest_path,
                    default_values,
                    bindings,
                );
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for (index, element) in array.elements.iter().enumerate() {
                let Some(element) = element else {
                    continue;
                };
                let mut element_path = path.clone();
                element_path
                    .segments
                    .push(StyledCssParameterSegment::Property(index.to_string()));
                styled_css_collect_parameter_bindings(
                    element,
                    element_path,
                    default_values.clone(),
                    bindings,
                );
            }
            if let Some(rest) = &array.rest {
                let mut rest_path = path;
                rest_path
                    .segments
                    .push(StyledCssParameterSegment::ArrayRest(array.elements.len()));
                styled_css_collect_parameter_bindings(
                    &rest.argument,
                    rest_path,
                    default_values,
                    bindings,
                );
            }
        }
    }
}

fn styled_css_collect_binding_symbols(
    pattern: &BindingPattern<'_>,
    symbols: &mut FxHashSet<SymbolId>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            symbols.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(assignment) => {
            styled_css_collect_binding_symbols(&assignment.left, symbols);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                styled_css_collect_binding_symbols(&property.value, symbols);
            }
            if let Some(rest) = &object.rest {
                styled_css_collect_binding_symbols(&rest.argument, symbols);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                styled_css_collect_binding_symbols(element, symbols);
            }
            if let Some(rest) = &array.rest {
                styled_css_collect_binding_symbols(&rest.argument, symbols);
            }
        }
    }
}

fn styled_css_parameter_binding<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
    environment: &StyledCssTestEnvironment<'ast, 'borrow, '_, '_>,
    resolving_local_symbols: &mut FxHashSet<SymbolId>,
) -> Option<StyledCssParameterBinding<'ast, 'borrow>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = environment
                .ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(binding) = environment.parameter_bindings.get(&symbol_id) {
                return Some(binding.clone());
            }
            let initializer = environment.local_initializers.get(&symbol_id)?;
            if !resolving_local_symbols.insert(symbol_id) {
                return None;
            }
            let binding =
                styled_css_parameter_binding(initializer, environment, resolving_local_symbols);
            resolving_local_symbols.remove(&symbol_id);
            binding
        }
        expression => {
            let member = expression.as_member_expression()?;
            let mut binding = styled_css_parameter_binding(
                member.object(),
                environment,
                resolving_local_symbols,
            )?;
            let property_name = member.static_property_name()?.to_string();
            let numeric_index = property_name
                .parse::<u64>()
                .ok()
                .filter(|index| {
                    *index <= STYLED_CSS_MAX_SAFE_ARRAY_INDEX && property_name == index.to_string()
                })
                .and_then(|index| usize::try_from(index).ok());
            let can_resolve_array_rest = matches!(
                binding.path.segments.last(),
                Some(StyledCssParameterSegment::ArrayRest(_))
            ) && numeric_index.is_some();
            if can_resolve_array_rest {
                let StyledCssParameterSegment::ArrayRest(offset) = binding.path.segments.pop()?
                else {
                    return None;
                };
                let resolved_index = offset + numeric_index?;
                if binding.path.segments.is_empty() {
                    binding.path.parameter_index += resolved_index;
                } else {
                    binding
                        .path
                        .segments
                        .push(StyledCssParameterSegment::Property(
                            resolved_index.to_string(),
                        ));
                }
            } else {
                binding
                    .path
                    .segments
                    .push(StyledCssParameterSegment::Property(property_name));
            }
            Some(binding)
        }
    }
}

fn styled_css_expression_key<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
    environment: &StyledCssTestEnvironment<'ast, 'borrow, '_, '_>,
    resolving_local_symbols: &mut FxHashSet<SymbolId>,
) -> String {
    if let Some(binding) =
        styled_css_parameter_binding(expression, environment, &mut FxHashSet::default())
    {
        let mut key = format!("parameter:{}", binding.path.parameter_index);
        for segment in &binding.path.segments {
            match segment {
                StyledCssParameterSegment::Property(property_name) => {
                    styled_css_push_key_part(&mut key, "property", property_name);
                }
                StyledCssParameterSegment::ArrayRest(offset) => {
                    styled_css_push_key_part(&mut key, "array-rest", &offset.to_string());
                }
                StyledCssParameterSegment::ObjectRest(property_names) => {
                    key.push_str("|object-rest");
                    for property_name in property_names {
                        styled_css_push_key_part(&mut key, "excluded", property_name);
                    }
                }
            }
        }
        for default_value in binding.default_values {
            let default_key =
                styled_css_expression_key(default_value, environment, resolving_local_symbols);
            styled_css_push_key_part(&mut key, "default", &default_key);
        }
        return key;
    }

    let expression = expression.get_inner_expression();
    match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = environment
                .ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return styled_css_key_part("identifier", identifier.name.as_str());
            };
            if let Some(initializer) = environment.local_initializers.get(&symbol_id) {
                if !resolving_local_symbols.insert(symbol_id) {
                    return styled_css_unique_expression_key("cyclic-local", expression);
                }
                let key =
                    styled_css_expression_key(initializer, environment, resolving_local_symbols);
                resolving_local_symbols.remove(&symbol_id);
                return key;
            }
            if environment.local_binding_symbols.contains(&symbol_id) {
                return format!("local:{symbol_id:?}");
            }
            styled_css_key_part("identifier", identifier.name.as_str())
        }
        Expression::BooleanLiteral(literal) => format!("boolean:{}", literal.value),
        Expression::NullLiteral(_) => "null".to_string(),
        Expression::NumericLiteral(literal) => format!("number:{:?}", literal.value),
        Expression::BigIntLiteral(literal) => {
            styled_css_key_part("bigint", &literal.value.to_string())
        }
        Expression::StringLiteral(literal) => styled_css_key_part("string", literal.value.as_str()),
        Expression::RegExpLiteral(literal) => format!(
            "regexp:{:?}:{}:{}",
            literal.regex.flags,
            literal.regex.pattern.text.len(),
            literal.regex.pattern.text.as_str()
        ),
        Expression::ThisExpression(_) => "this".to_string(),
        expression if expression.as_member_expression().is_some() => styled_css_member_key(
            expression.as_member_expression().unwrap(),
            environment,
            resolving_local_symbols,
        ),
        Expression::UnaryExpression(unary) => {
            let argument =
                styled_css_expression_key(&unary.argument, environment, resolving_local_symbols);
            format!("unary:{:?}:{argument}", unary.operator)
        }
        Expression::BinaryExpression(binary) => {
            let left =
                styled_css_expression_key(&binary.left, environment, resolving_local_symbols);
            let right =
                styled_css_expression_key(&binary.right, environment, resolving_local_symbols);
            format!("binary:{:?}:{}:{}", binary.operator, left.len(), left) + &right
        }
        Expression::LogicalExpression(logical) => {
            let left =
                styled_css_expression_key(&logical.left, environment, resolving_local_symbols);
            let right =
                styled_css_expression_key(&logical.right, environment, resolving_local_symbols);
            format!("logical:{:?}:{}:{}", logical.operator, left.len(), left) + &right
        }
        Expression::ConditionalExpression(conditional) => {
            let mut key = "conditional".to_string();
            for child in [
                &conditional.test,
                &conditional.consequent,
                &conditional.alternate,
            ] {
                let child_key =
                    styled_css_expression_key(child, environment, resolving_local_symbols);
                styled_css_push_key_part(&mut key, "child", &child_key);
            }
            key
        }
        Expression::SequenceExpression(sequence) => {
            let mut key = "sequence".to_string();
            for child in &sequence.expressions {
                let child_key =
                    styled_css_expression_key(child, environment, resolving_local_symbols);
                styled_css_push_key_part(&mut key, "child", &child_key);
            }
            key
        }
        Expression::TemplateLiteral(template) => {
            let mut key = "template".to_string();
            for (quasi_index, quasi) in template.quasis.iter().enumerate() {
                let quasi_value = quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str());
                styled_css_push_key_part(&mut key, "quasi", quasi_value);
                if let Some(interpolation) = template.expressions.get(quasi_index) {
                    let interpolation_key = styled_css_expression_key(
                        interpolation,
                        environment,
                        resolving_local_symbols,
                    );
                    styled_css_push_key_part(&mut key, "expression", &interpolation_key);
                }
            }
            key
        }
        Expression::CallExpression(call) => {
            styled_css_call_key(call, environment, resolving_local_symbols)
        }
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => {
                styled_css_call_key(call, environment, resolving_local_symbols)
            }
            ChainElement::TSNonNullExpression(non_null) => styled_css_expression_key(
                &non_null.expression,
                environment,
                resolving_local_symbols,
            ),
            chain_expression => chain_expression.as_member_expression().map_or_else(
                || styled_css_unique_expression_key("chain", expression),
                |member| styled_css_member_key(member, environment, resolving_local_symbols),
            ),
        },
        Expression::ArrayExpression(array) => {
            let mut key = "array".to_string();
            for element in &array.elements {
                match element {
                    ArrayExpressionElement::Elision(_) => key.push_str("|hole"),
                    ArrayExpressionElement::SpreadElement(spread) => {
                        let argument_key = styled_css_expression_key(
                            &spread.argument,
                            environment,
                            resolving_local_symbols,
                        );
                        styled_css_push_key_part(&mut key, "spread", &argument_key);
                    }
                    element => {
                        let Some(element) = element.as_expression() else {
                            return styled_css_unique_expression_key("array-element", expression);
                        };
                        let element_key = styled_css_expression_key(
                            element,
                            environment,
                            resolving_local_symbols,
                        );
                        styled_css_push_key_part(&mut key, "element", &element_key);
                    }
                }
            }
            key
        }
        Expression::ObjectExpression(object) => {
            let mut key = "object".to_string();
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::SpreadProperty(spread) => {
                        let argument_key = styled_css_expression_key(
                            &spread.argument,
                            environment,
                            resolving_local_symbols,
                        );
                        styled_css_push_key_part(&mut key, "spread", &argument_key);
                    }
                    ObjectPropertyKind::ObjectProperty(property) => {
                        let property_key = if let Some(property_name) = property.key.static_name() {
                            styled_css_key_part("static", property_name.as_ref())
                        } else if property.computed {
                            property.key.as_expression().map_or_else(
                                || styled_css_unique_span_key("property-key", property.key.span()),
                                |property_expression| {
                                    let expression_key = styled_css_expression_key(
                                        property_expression,
                                        environment,
                                        resolving_local_symbols,
                                    );
                                    styled_css_key_part("computed", &expression_key)
                                },
                            )
                        } else {
                            styled_css_unique_span_key("property-key", property.key.span())
                        };
                        let value_key = styled_css_expression_key(
                            &property.value,
                            environment,
                            resolving_local_symbols,
                        );
                        let property_value =
                            format!("{:?}:{}:{}", property.kind, property.method, property_key);
                        styled_css_push_key_part(&mut key, &property_value, &value_key);
                    }
                }
            }
            key
        }
        _ => styled_css_unique_expression_key("unsupported", expression),
    }
}

fn styled_css_member_key<'ast, 'borrow>(
    member: &'borrow MemberExpression<'ast>,
    environment: &StyledCssTestEnvironment<'ast, 'borrow, '_, '_>,
    resolving_local_symbols: &mut FxHashSet<SymbolId>,
) -> String {
    let object_key =
        styled_css_expression_key(member.object(), environment, resolving_local_symbols);
    if let Some(property_name) = member.static_property_name() {
        let property_key = styled_css_key_part("static", property_name.as_ref());
        return format!("member:{}:{}", object_key.len(), object_key) + &property_key;
    }
    let MemberExpression::ComputedMemberExpression(computed) = member else {
        return styled_css_unique_span_key("member", member.span());
    };
    let property_key =
        styled_css_expression_key(&computed.expression, environment, resolving_local_symbols);
    format!("member:{}:{}", object_key.len(), object_key) + &property_key
}

fn styled_css_call_key<'ast, 'borrow>(
    call: &'borrow CallExpression<'ast>,
    environment: &StyledCssTestEnvironment<'ast, 'borrow, '_, '_>,
    resolving_local_symbols: &mut FxHashSet<SymbolId>,
) -> String {
    if styled_css_is_obviously_stateful_call(call, environment)
        || (call.arguments.is_empty()
            && styled_css_parameter_binding(&call.callee, environment, &mut FxHashSet::default())
                .is_none())
    {
        return styled_css_unique_span_key("unstable-call", call.span);
    }
    let callee_key = styled_css_expression_key(&call.callee, environment, resolving_local_symbols);
    let mut key = styled_css_key_part("call", &callee_key);
    for argument in &call.arguments {
        match argument {
            Argument::SpreadElement(spread) => {
                let argument_key = styled_css_expression_key(
                    &spread.argument,
                    environment,
                    resolving_local_symbols,
                );
                styled_css_push_key_part(&mut key, "spread", &argument_key);
            }
            argument => {
                let Some(argument) = argument.as_expression() else {
                    return styled_css_unique_span_key("call-argument", call.span);
                };
                let argument_key =
                    styled_css_expression_key(argument, environment, resolving_local_symbols);
                styled_css_push_key_part(&mut key, "argument", &argument_key);
            }
        }
    }
    key
}

fn styled_css_is_obviously_stateful_call<'ast>(
    call: &CallExpression<'ast>,
    environment: &StyledCssTestEnvironment<'ast, '_, '_, '_>,
) -> bool {
    let ctx = environment.ctx;
    let Some(root_identifier) = styled_css_callee_root_identifier(&call.callee) else {
        return false;
    };
    let Some(symbol_id) = resolve_const_identifier_root_symbol(root_identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let body_span = match declaration.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().and_then(|initializer| {
                let initializer = if let Some(member) = call.callee.as_member_expression()
                    && let Expression::ObjectExpression(object) = initializer.get_inner_expression()
                    && let Some(property_name) = member.static_property_name()
                {
                    object.properties.iter().find_map(|candidate| {
                        let ObjectPropertyKind::ObjectProperty(property) = candidate else {
                            return None;
                        };
                        (property.key.static_name().as_deref() == Some(property_name.as_ref()))
                            .then_some(&property.value)
                    })
                } else {
                    Some(initializer)
                }?;
                styled_css_function_body_span(initializer)
            })
        }
        _ => None,
    };
    let Some(body_span) = body_span else {
        return false;
    };
    let first_possible_mutation = environment
        .mutation_spans
        .partition_point(|mutation_span| mutation_span.start < body_span.start);
    environment
        .mutation_spans
        .get(first_possible_mutation)
        .is_some_and(|mutation_span| body_span.contains_inclusive(*mutation_span))
}

fn styled_css_callee_root_identifier<'ast, 'borrow>(
    expression: &'borrow Expression<'ast>,
) -> Option<&'borrow oxc_ast::ast::IdentifierReference<'ast>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => expression
            .as_member_expression()
            .and_then(|member| styled_css_callee_root_identifier(member.object())),
    }
}

fn styled_css_function_body_span(expression: &Expression<'_>) -> Option<Span> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.body.span()),
        Expression::FunctionExpression(function) => function.body.as_ref().map(|body| body.span),
        _ => None,
    }
}

fn styled_css_key_part(kind: &str, value: &str) -> String {
    format!("{kind}:{}:{value}", value.len())
}

fn styled_css_push_key_part(key: &mut String, kind: &str, value: &str) {
    key.push('|');
    key.push_str(&styled_css_key_part(kind, value));
}

fn styled_css_unique_expression_key(kind: &str, expression: &Expression<'_>) -> String {
    styled_css_unique_span_key(kind, expression.span())
}

fn styled_css_unique_span_key(kind: &str, span: Span) -> String {
    format!("{kind}:{}:{}", span.start, span.end)
}

fn styled_css_all_tests_equal(occurrences: &[&StyledCssDeclaration]) -> bool {
    let first = &occurrences[0].tests;
    occurrences.iter().all(|occurrence| {
        occurrence.tests.len() == first.len()
            && occurrence
                .tests
                .iter()
                .zip(first)
                .all(|(left, right)| left.key == right.key)
    })
}

fn styled_css_has_conflicting_override(occurrences: &[StyledCssDeclaration]) -> bool {
    for (later_index, later) in occurrences.iter().enumerate() {
        if later.tests.is_empty()
            || !later
                .tests
                .iter()
                .all(|test| test.always_produces_css_value)
        {
            continue;
        }
        for prior in occurrences[..later_index].iter().rev() {
            if !prior.tests.is_empty()
                && !prior
                    .tests
                    .iter()
                    .all(|test| test.always_produces_css_value)
            {
                continue;
            }
            if !later.is_important && prior.is_important {
                break;
            }
            if prior.tests.is_empty() {
                break;
            }
            if prior.tests.len() != later.tests.len()
                || prior
                    .tests
                    .iter()
                    .zip(&later.tests)
                    .any(|(left, right)| left.key != right.key)
            {
                return true;
            }
        }
    }
    false
}
