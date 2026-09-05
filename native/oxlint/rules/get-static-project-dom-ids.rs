const STATIC_PROJECT_DOM_ID_PARSE_MAX_BYTES: u64 = 2_000_000;
const STATIC_PROJECT_DOM_ID_IGNORED_DIRECTORIES: &[&str] = &[
    ".angular",
    ".astro",
    ".cache",
    ".contentlayer",
    ".docusaurus",
    ".expo",
    ".git",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".turbo",
    ".vercel",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "storybook-static",
];
const STATIC_PROJECT_DOM_ID_RAW_HTML_ELEMENTS: &[&str] = &[
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "template",
];

static STATIC_PROJECT_DOM_IDS_BY_ROOT: std::sync::LazyLock<
    std::sync::Mutex<
        std::collections::HashMap<std::path::PathBuf, Option<std::collections::HashSet<String>>>,
    >,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn get_static_project_dom_ids(
    ctx: &crate::context::LintContext<'_>,
) -> Option<std::collections::HashSet<String>> {
    let mut current_ids = std::collections::HashSet::new();
    collect_current_static_jsx_dom_ids(ctx, &mut current_ids);
    let Ok(current_file_path) = std::path::absolute(ctx.file_path()) else {
        return Some(current_ids);
    };
    let Some(root_directory) = resolve_static_project_dom_id_root(ctx, &current_file_path) else {
        return Some(current_ids);
    };
    let mut cached_ids_by_root = STATIC_PROJECT_DOM_IDS_BY_ROOT.lock().ok()?;
    if let Some(cached_ids) = cached_ids_by_root.get(&root_directory) {
        let mut project_ids = cached_ids.clone()?;
        project_ids.extend(current_ids);
        return Some(project_ids);
    }
    let project_ids = collect_static_project_dom_ids(&root_directory, &current_file_path).map(
        |mut project_ids| {
            project_ids.extend(current_ids);
            project_ids
        },
    );
    cached_ids_by_root.insert(root_directory, project_ids.clone());
    project_ids
}

fn resolve_static_project_dom_id_root(
    ctx: &crate::context::LintContext<'_>,
    current_file_path: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .map(std::path::PathBuf::from)?;
    if !root_directory.is_absolute()
        || !current_file_path.is_absolute()
        || current_file_path.strip_prefix(&root_directory).is_err()
    {
        return None;
    }
    Some(root_directory)
}

fn collect_current_static_jsx_dom_ids(
    ctx: &crate::context::LintContext<'_>,
    ids: &mut std::collections::HashSet<String>,
) {
    for node in ctx.nodes().iter() {
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if is_inside_jsx_template_content(node, ctx.nodes()) {
            continue;
        }
        let resolution = resolve_static_jsx_attribute(opening_element, "id", false);
        if resolution.is_unknown {
            for attribute in &opening_element.attributes {
                match attribute {
                    oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                        if jsx_attribute_name_matches(attribute, "id", false) =>
                    {
                        collect_current_static_jsx_attribute_dom_ids(attribute, ctx, ids);
                    }
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread_attribute) => {
                        if let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
                            &spread_attribute.argument
                        {
                            collect_current_static_object_dom_ids(object_expression, ctx, ids);
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }
        if let Some(attribute) = resolution.attribute {
            collect_current_static_jsx_attribute_dom_ids(attribute, ctx, ids);
        } else if let Some(expression) = resolution.expression {
            collect_current_static_expression_dom_ids(expression, ctx, ids);
        }
    }
}

fn collect_current_static_jsx_attribute_dom_ids<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &crate::context::LintContext<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    for candidate in
        get_known_static_jsx_attribute_string_values(attribute, ctx).unwrap_or_default()
    {
        insert_static_project_dom_id(ids, &candidate);
    }
}

fn collect_current_static_expression_dom_ids<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &crate::context::LintContext<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    for candidate in get_known_static_string_expression_values(expression, ctx).unwrap_or_default()
    {
        insert_static_project_dom_id(ids, &candidate);
    }
}

fn collect_current_static_object_dom_ids<'a>(
    object_expression: &oxc_ast::ast::ObjectExpression<'a>,
    ctx: &crate::context::LintContext<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    for property in &object_expression.properties {
        match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread_property) => {
                if let oxc_ast::ast::Expression::ObjectExpression(nested_object_expression) =
                    &spread_property.argument
                {
                    collect_current_static_object_dom_ids(nested_object_expression, ctx, ids);
                }
            }
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property)
                if object_property
                    .key
                    .static_name()
                    .is_some_and(|name| name.eq_ignore_ascii_case("id")) =>
            {
                collect_current_static_expression_dom_ids(&object_property.value, ctx, ids);
            }
            _ => {}
        }
    }
}

fn collect_static_project_dom_ids(
    root_directory: &std::path::Path,
    current_file_path: &std::path::Path,
) -> Option<std::collections::HashSet<String>> {
    let mut source_file_paths = Vec::new();
    let mut html_file_paths = Vec::new();
    let mut pending_directories = vec![root_directory.to_path_buf()];
    while let Some(current_directory) = pending_directories.pop() {
        for entry in std::fs::read_dir(current_directory).ok()? {
            let entry = entry.ok()?;
            let file_name = entry.file_name();
            let file_name = file_name.to_str()?;
            let file_type = entry.file_type().ok()?;
            let is_ignored_directory = static_project_dom_id_directory_is_ignored(file_name);
            if file_type.is_symlink() {
                if is_ignored_directory {
                    continue;
                }
                return None;
            }
            if file_type.is_dir() {
                if !is_ignored_directory {
                    pending_directories.push(entry.path());
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let file_path = entry.path();
            let normalized_file_path = file_path.to_string_lossy().replace('\\', "/");
            if is_non_production_filename(&normalized_file_path) {
                continue;
            }
            if static_project_dom_id_is_html_file(file_name) {
                html_file_paths.push(file_path);
            } else if static_project_dom_id_is_source_file(file_name)
                && !static_project_dom_id_is_declaration_file(file_name)
            {
                source_file_paths.push(file_path);
            }
        }
    }
    let mut ids = std::collections::HashSet::new();
    for source_file_path in source_file_paths {
        if source_file_path == current_file_path {
            continue;
        }
        collect_parsed_source_static_dom_ids(&source_file_path, &mut ids)?;
    }
    for html_file_path in html_file_paths {
        let content = std::fs::read_to_string(html_file_path).ok()?;
        collect_static_html_dom_ids(&content, &mut ids);
    }
    Some(ids)
}

fn static_project_dom_id_directory_is_ignored(name: &str) -> bool {
    STATIC_PROJECT_DOM_ID_IGNORED_DIRECTORIES.contains(&name)
        || name.starts_with('.') && name != ".dumi" && name != ".storybook"
}

fn static_project_dom_id_is_source_file(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    [
        ".js", ".jsx", ".ts", ".tsx", ".cjs", ".cjsx", ".cts", ".ctsx", ".mjs", ".mjsx", ".mts",
        ".mtsx",
    ]
    .iter()
    .any(|extension| lowercase_name.ends_with(extension))
}

fn static_project_dom_id_is_declaration_file(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    [".d.js", ".d.ts", ".d.cjs", ".d.cts", ".d.mjs", ".d.mts"]
        .iter()
        .any(|extension| lowercase_name.ends_with(extension))
}

fn static_project_dom_id_is_html_file(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    lowercase_name.ends_with(".html") || lowercase_name.ends_with(".htm")
}

fn collect_parsed_source_static_dom_ids(
    file_path: &std::path::Path,
    ids: &mut std::collections::HashSet<String>,
) -> Option<()> {
    let metadata = std::fs::metadata(file_path).ok()?;
    if !metadata.is_file() || metadata.len() > STATIC_PROJECT_DOM_ID_PARSE_MAX_BYTES {
        return None;
    }
    let source_text = std::fs::read_to_string(file_path).ok()?;
    let source_type = oxc_span::SourceType::from_path(file_path).ok()?;
    let allocator = oxc_allocator::Allocator::default();
    let parser_return = oxc_parser::Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let semantic_return = oxc_semantic::SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parser_return.program);
    collect_semantic_static_jsx_dom_ids(&semantic_return.semantic, ids);
    Some(())
}

fn collect_semantic_static_jsx_dom_ids<'a>(
    semantic: &oxc_semantic::Semantic<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    for node in semantic.nodes().iter() {
        let oxc_ast::AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if is_inside_jsx_template_content(node, semantic.nodes()) {
            continue;
        }
        let resolution = resolve_static_jsx_attribute(opening_element, "id", false);
        if resolution.is_unknown {
            for attribute in &opening_element.attributes {
                match attribute {
                    oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                        if jsx_attribute_name_matches(attribute, "id", false) =>
                    {
                        collect_semantic_static_jsx_attribute_dom_ids(attribute, semantic, ids);
                    }
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread_attribute) => {
                        if let oxc_ast::ast::Expression::ObjectExpression(object_expression) =
                            &spread_attribute.argument
                        {
                            collect_semantic_static_object_dom_ids(
                                object_expression,
                                semantic,
                                ids,
                            );
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }
        if let Some(attribute) = resolution.attribute {
            collect_semantic_static_jsx_attribute_dom_ids(attribute, semantic, ids);
        } else if let Some(expression) = resolution.expression {
            collect_semantic_static_expression_dom_ids(expression, semantic, ids);
        }
    }
}

fn collect_semantic_static_jsx_attribute_dom_ids<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    let Some(value) = attribute.value.as_ref() else {
        return;
    };
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            insert_static_project_dom_id(ids, string_literal.value.as_str());
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            if let Some(expression) = container.expression.as_expression() {
                collect_semantic_static_expression_dom_ids(expression, semantic, ids);
            }
        }
        _ => {}
    }
}

fn collect_semantic_static_expression_dom_ids<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    let mut values = Vec::new();
    collect_known_static_string_values_from_semantic(
        expression,
        semantic,
        MAX_KNOWN_CONST_STRING_ALIASES,
        &mut Vec::new(),
        &mut values,
    );
    for value in values {
        insert_static_project_dom_id(ids, &value);
    }
}

fn collect_known_static_string_values_from_semantic<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    remaining_const_aliases: usize,
    resolving_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
    values: &mut Vec<String>,
) {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::StringLiteral(string_literal) => {
            values.push(string_literal.value.to_string());
        }
        oxc_ast::ast::Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            values.push(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            );
        }
        oxc_ast::ast::Expression::ConditionalExpression(conditional_expression) => {
            collect_known_static_string_values_from_semantic(
                &conditional_expression.consequent,
                semantic,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
            collect_known_static_string_values_from_semantic(
                &conditional_expression.alternate,
                semantic,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
        }
        oxc_ast::ast::Expression::LogicalExpression(logical_expression)
            if matches!(
                logical_expression.operator,
                oxc_syntax::operator::LogicalOperator::Or
                    | oxc_syntax::operator::LogicalOperator::Coalesce
            ) =>
        {
            collect_known_static_string_values_from_semantic(
                &logical_expression.left,
                semantic,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
            collect_known_static_string_values_from_semantic(
                &logical_expression.right,
                semantic,
                remaining_const_aliases,
                &mut resolving_symbol_ids.clone(),
                values,
            );
        }
        oxc_ast::ast::Expression::Identifier(identifier) if remaining_const_aliases > 0 => {
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return;
            };
            if resolving_symbol_ids.contains(&symbol_id) {
                return;
            }
            let declaration = semantic.symbol_declaration(symbol_id);
            let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return;
            };
            let parent = semantic.nodes().parent_node(declaration.id());
            let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return;
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return;
            }
            let Some(initializer) = declarator.init.as_ref() else {
                return;
            };
            resolving_symbol_ids.push(symbol_id);
            collect_known_static_string_values_from_semantic(
                initializer,
                semantic,
                remaining_const_aliases - 1,
                resolving_symbol_ids,
                values,
            );
            resolving_symbol_ids.pop();
        }
        _ => {}
    }
}

fn collect_semantic_static_object_dom_ids<'a>(
    object_expression: &oxc_ast::ast::ObjectExpression<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    ids: &mut std::collections::HashSet<String>,
) {
    for property in &object_expression.properties {
        match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(spread_property) => {
                if let oxc_ast::ast::Expression::ObjectExpression(nested_object_expression) =
                    &spread_property.argument
                {
                    collect_semantic_static_object_dom_ids(nested_object_expression, semantic, ids);
                }
            }
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(object_property)
                if object_property
                    .key
                    .static_name()
                    .is_some_and(|name| name.eq_ignore_ascii_case("id")) =>
            {
                collect_semantic_static_expression_dom_ids(&object_property.value, semantic, ids);
            }
            _ => {}
        }
    }
}

fn is_inside_jsx_template_content<'a>(
    node: &oxc_semantic::AstNode<'a>,
    nodes: &oxc_semantic::AstNodes<'a>,
) -> bool {
    nodes.ancestors(node.id()).skip(1).any(|ancestor| {
        let oxc_ast::AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        matches!(
            &element.opening_element.name,
            oxc_ast::ast::JSXElementName::Identifier(identifier) if identifier.name == "template"
        )
    })
}

fn insert_static_project_dom_id(ids: &mut std::collections::HashSet<String>, candidate: &str) {
    let candidate = candidate.trim();
    if !candidate.is_empty() {
        ids.insert(candidate.to_string());
    }
}

fn collect_static_html_dom_ids(content: &str, ids: &mut std::collections::HashSet<String>) {
    let bytes = content.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some(relative_opening_index) = content[cursor..].find('<') else {
            break;
        };
        let opening_index = cursor + relative_opening_index;
        if content[opening_index..].starts_with("<!--") {
            cursor = content[opening_index + 4..]
                .find("-->")
                .map_or(bytes.len(), |index| opening_index + 4 + index + 3);
            continue;
        }
        let name_start = opening_index + 1;
        if name_start >= bytes.len() || !bytes[name_start].is_ascii_alphabetic() {
            cursor = name_start;
            continue;
        }
        let mut name_end = name_start + 1;
        while name_end < bytes.len()
            && (bytes[name_end].is_ascii_alphanumeric()
                || matches!(bytes[name_end], b'_' | b'-' | b':' | b'.'))
        {
            name_end += 1;
        }
        let Some(tag_end) = static_project_dom_id_find_tag_end(content, name_end) else {
            break;
        };
        collect_static_html_tag_dom_ids(&content[name_end..tag_end], ids);
        let tag_name = &content[name_start..name_end];
        cursor = tag_end + 1;
        if STATIC_PROJECT_DOM_ID_RAW_HTML_ELEMENTS
            .iter()
            .any(|raw_name| tag_name.eq_ignore_ascii_case(raw_name))
        {
            let closing_prefix = format!("</{tag_name}");
            let Some(relative_closing_index) = static_project_dom_id_find_ascii_case_insensitive(
                &content[cursor..],
                &closing_prefix,
            ) else {
                break;
            };
            let closing_index = cursor + relative_closing_index;
            cursor = content[closing_index..]
                .find('>')
                .map_or(bytes.len(), |index| closing_index + index + 1);
        }
    }
}

fn static_project_dom_id_find_tag_end(content: &str, start: usize) -> Option<usize> {
    let bytes = content.as_bytes();
    let mut quote = None;
    for (offset, byte) in bytes[start..].iter().enumerate() {
        match (*byte, quote) {
            (b'"' | b'\'', None) => quote = Some(*byte),
            (current, Some(expected)) if current == expected => quote = None,
            (b'>', None) => return Some(start + offset),
            _ => {}
        }
    }
    None
}

fn collect_static_html_tag_dom_ids(attributes: &str, ids: &mut std::collections::HashSet<String>) {
    let bytes = attributes.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] == b'/' {
            break;
        }
        let name_start = cursor;
        while cursor < bytes.len()
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'"' | b'\'' | b'<' | b'>' | b'/' | b'=')
        {
            cursor += 1;
        }
        if cursor == name_start {
            cursor += 1;
            continue;
        }
        let attribute_name = &attributes[name_start..cursor];
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let mut attribute_value = "";
        if cursor < bytes.len() && bytes[cursor] == b'=' {
            cursor += 1;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if cursor < bytes.len() && matches!(bytes[cursor], b'"' | b'\'') {
                let quote = bytes[cursor];
                cursor += 1;
                let value_start = cursor;
                while cursor < bytes.len() && bytes[cursor] != quote {
                    cursor += 1;
                }
                attribute_value = &attributes[value_start..cursor];
                cursor += usize::from(cursor < bytes.len());
            } else {
                let value_start = cursor;
                while cursor < bytes.len()
                    && !bytes[cursor].is_ascii_whitespace()
                    && !matches!(bytes[cursor], b'"' | b'\'' | b'=' | b'<' | b'>' | b'`')
                {
                    cursor += 1;
                }
                attribute_value = &attributes[value_start..cursor];
            }
        }
        if attribute_name.eq_ignore_ascii_case("id") {
            insert_static_project_dom_id(ids, attribute_value);
        }
    }
}

fn static_project_dom_id_find_ascii_case_insensitive(
    haystack: &str,
    needle: &str,
) -> Option<usize> {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|window| {
        window
            .iter()
            .zip(needle)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}
