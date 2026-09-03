use serde_json::Value;

pub fn mask_third_party_source_map_sources(relative_path: &str, source: &str) -> String {
    if !relative_path.to_ascii_lowercase().ends_with(".map")
        || !source.contains("\"sourcesContent\"")
    {
        return source.to_string();
    }
    let Ok(Value::Object(source_map)) = serde_json::from_str::<Value>(source) else {
        return source.to_string();
    };
    let Some(sources) = source_map.get("sources").and_then(Value::as_array) else {
        return source.to_string();
    };
    let Some(sources_content) = source_map.get("sourcesContent").and_then(Value::as_array) else {
        return source.to_string();
    };
    if sources.len() != sources_content.len()
        || sources.iter().any(|entry| !entry.is_string())
        || sources_content
            .iter()
            .any(|entry| !entry.is_string() && !entry.is_null())
    {
        return source.to_string();
    }
    let source_root = match source_map.get("sourceRoot") {
        None => "",
        Some(Value::String(source_root)) => source_root.as_str(),
        Some(_) => return source.to_string(),
    };
    let Some(content_start) = find_top_level_property_value_start(source, "sourcesContent") else {
        return source.to_string();
    };
    let Some(ranges) = find_source_content_ranges(source, content_start, sources_content) else {
        return source.to_string();
    };
    let mut output = source.as_bytes().to_vec();
    let mut did_mask = false;
    for ((source_path, _), range) in sources.iter().zip(sources_content).zip(ranges) {
        let source_path = source_path.as_str().unwrap_or("");
        if !format!("{source_root}/{source_path}")
            .split(['/', '\\'])
            .any(|segment| segment == "node_modules")
        {
            continue;
        }
        blank_range(&mut output, source, range.0, range.1);
        did_mask = true;
    }
    if did_mask {
        String::from_utf8(output).unwrap_or_else(|_| source.to_string())
    } else {
        source.to_string()
    }
}

fn find_top_level_property_value_start(source: &str, property: &str) -> Option<usize> {
    let mut cursor = skip_whitespace(source, 0);
    if source.as_bytes().get(cursor) != Some(&b'{') {
        return None;
    }
    cursor = skip_whitespace(source, cursor + 1);
    let mut match_start = None;
    while source.as_bytes().get(cursor) != Some(&b'}') {
        let key_end = find_json_string_end(source, cursor)?;
        let key = serde_json::from_str::<String>(&source[cursor..key_end]).ok()?;
        cursor = skip_whitespace(source, key_end);
        if source.as_bytes().get(cursor) != Some(&b':') {
            return None;
        }
        cursor = skip_whitespace(source, cursor + 1);
        if key == property {
            if match_start.is_some() {
                return None;
            }
            match_start = Some(cursor);
        }
        cursor = skip_whitespace(source, find_json_value_end(source, cursor)?);
        if source.as_bytes().get(cursor) == Some(&b',') {
            cursor = skip_whitespace(source, cursor + 1);
        } else if source.as_bytes().get(cursor) != Some(&b'}') {
            return None;
        }
    }
    match_start
}

fn find_source_content_ranges(
    source: &str,
    start: usize,
    values: &[Value],
) -> Option<Vec<(usize, usize)>> {
    let mut cursor = skip_whitespace(source, start);
    if source.as_bytes().get(cursor) != Some(&b'[') {
        return None;
    }
    cursor = skip_whitespace(source, cursor + 1);
    let mut ranges = Vec::with_capacity(values.len());
    for value in values {
        let end = if value.is_string() {
            find_json_string_end(source, cursor)?
        } else if source[cursor..].starts_with("null") {
            cursor + 4
        } else {
            return None;
        };
        ranges.push((cursor, end));
        cursor = skip_whitespace(source, end);
        if source.as_bytes().get(cursor) == Some(&b',') {
            cursor = skip_whitespace(source, cursor + 1);
        }
    }
    (source.as_bytes().get(cursor) == Some(&b']')).then_some(ranges)
}

fn find_json_value_end(source: &str, start: usize) -> Option<usize> {
    let start = skip_whitespace(source, start);
    if source.as_bytes().get(start) == Some(&b'"') {
        return find_json_string_end(source, start);
    }
    if !source
        .as_bytes()
        .get(start)
        .is_some_and(|byte| matches!(*byte, b'[' | b'{'))
    {
        return Some(
            source[start..]
                .find(|character| matches!(character, ',' | ']' | '}'))
                .map_or(source.len(), |offset| start + offset),
        );
    }
    let mut closings = vec![if source.as_bytes()[start] == b'[' {
        b']'
    } else {
        b'}'
    }];
    let mut cursor = start + 1;
    while cursor < source.len() {
        let byte = source.as_bytes()[cursor];
        if byte == b'"' {
            cursor = find_json_string_end(source, cursor)?;
            continue;
        }
        if byte == b'[' {
            closings.push(b']');
        } else if byte == b'{' {
            closings.push(b'}');
        } else if closings.last() == Some(&byte) {
            closings.pop();
            if closings.is_empty() {
                return Some(cursor + 1);
            }
        }
        cursor += 1;
    }
    None
}

fn find_json_string_end(source: &str, start: usize) -> Option<usize> {
    if source.as_bytes().get(start) != Some(&b'"') {
        return None;
    }
    let mut cursor = start + 1;
    while cursor < source.len() {
        match source.as_bytes()[cursor] {
            b'\\' => cursor += 2,
            b'"' => return Some(cursor + 1),
            _ => cursor += 1,
        }
    }
    None
}

fn skip_whitespace(source: &str, start: usize) -> usize {
    source[start..]
        .char_indices()
        .find(|(_, character)| !character.is_whitespace())
        .map_or(source.len(), |(offset, _)| start + offset)
}

fn blank_range(output: &mut [u8], source: &str, start: usize, end: usize) {
    for (offset, character) in source[start..end].char_indices() {
        if matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}') {
            continue;
        }
        let character_start = start + offset;
        let character_end = character_start + character.len_utf8();
        let replacement = match character.len_utf8() {
            1 => " ",
            2 => "\u{00A0}",
            3 => "\u{2000}",
            4 => "\u{00A0}\u{00A0}",
            _ => unreachable!(),
        };
        output[character_start..character_end].copy_from_slice(replacement.as_bytes());
    }
}
