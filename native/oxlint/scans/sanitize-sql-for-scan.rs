pub fn sanitize_sql_for_scan(source: &str) -> String {
    let source_bytes = source.as_bytes();
    let mut sanitized = source_bytes.to_vec();
    let mut index = 0;
    while index < source_bytes.len() {
        if source_bytes[index] == b'-' && source_bytes.get(index + 1) == Some(&b'-') {
            index = blank_until_line_end(&mut sanitized, source_bytes, index);
            continue;
        }
        if source_bytes[index] == b'/' && source_bytes.get(index + 1) == Some(&b'*') {
            index = blank_block_comment(&mut sanitized, source_bytes, index);
            continue;
        }
        if source_bytes[index] == b'\'' {
            index = blank_single_quoted(&mut sanitized, source_bytes, index, true);
            continue;
        }
        if source_bytes[index] == b'$'
            && let Some((tag, after_tag)) = dollar_quote_tag(source, index)
        {
            let close_start = source[after_tag..].find(tag).map(|offset| after_tag + offset);
            let close_end = close_start.map_or(source.len(), |start| start + tag.len());
            if dollar_quote_is_code_body(source, index) {
                sanitize_code_body(
                    &mut sanitized,
                    source_bytes,
                    after_tag,
                    close_start.unwrap_or(source.len()),
                );
            } else {
                blank_bytes(&mut sanitized, index, close_end);
            }
            index = close_end;
            continue;
        }
        if source_bytes[index] == b'"' {
            index = skip_double_quoted(source_bytes, index);
            continue;
        }
        index += 1;
    }
    String::from_utf8(sanitized).unwrap_or_else(|_| source.to_string())
}

fn dollar_quote_tag(source: &str, start: usize) -> Option<(&str, usize)> {
    let source_bytes = source.as_bytes();
    let mut end = start + 1;
    while source_bytes.get(end).is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_') {
        end += 1;
    }
    (source_bytes.get(end) == Some(&b'$')).then(|| (&source[start..=end], end + 1))
}

fn dollar_quote_is_code_body(source: &str, dollar_index: usize) -> bool {
    let source_bytes = source.as_bytes();
    let mut end = dollar_index;
    while end > 0 && source_bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0
        && (source_bytes[start - 1].is_ascii_alphanumeric() || source_bytes[start - 1] == b'_')
    {
        start -= 1;
    }
    matches!(
        source[start..end].to_ascii_lowercase().as_str(),
        "do" | "plpgsql" | "sql" | "plpython3u" | "plpythonu" | "plperl" | "plperlu" | "plv8"
    )
}

fn sanitize_code_body(sanitized: &mut [u8], source: &[u8], start: usize, end: usize) {
    let mut index = start;
    let mut is_execute_statement = false;
    while index < end {
        if source[index] == b';' {
            is_execute_statement = false;
            index += 1;
            continue;
        }
        if source[index].is_ascii_alphabetic() || source[index] == b'_' {
            let word_start = index;
            while index < end && (source[index].is_ascii_alphanumeric() || source[index] == b'_') {
                index += 1;
            }
            if source[word_start..index].eq_ignore_ascii_case(b"execute") {
                is_execute_statement = true;
            }
            continue;
        }
        if source[index] == b'\'' {
            index = if is_execute_statement {
                skip_single_quoted(source, index)
            } else {
                blank_single_quoted(sanitized, source, index, true)
            };
            continue;
        }
        if source[index] == b'"' {
            index = skip_double_quoted(source, index);
            continue;
        }
        if source[index] == b'-' && source.get(index + 1) == Some(&b'-') {
            index = blank_until_line_end(sanitized, source, index);
            continue;
        }
        if source[index] == b'/' && source.get(index + 1) == Some(&b'*') {
            index = blank_block_comment(sanitized, source, index);
            continue;
        }
        index += 1;
    }
}

fn blank_until_line_end(sanitized: &mut [u8], source: &[u8], mut index: usize) -> usize {
    while index < source.len() && source[index] != b'\n' {
        sanitized[index] = b' ';
        index += 1;
    }
    index
}

fn blank_block_comment(sanitized: &mut [u8], source: &[u8], mut index: usize) -> usize {
    while index < source.len() {
        let is_end = source[index] == b'*' && source.get(index + 1) == Some(&b'/');
        if source[index] != b'\n' {
            sanitized[index] = b' ';
        }
        index += 1;
        if is_end {
            if index < source.len() {
                sanitized[index] = b' ';
                index += 1;
            }
            break;
        }
    }
    index
}

fn blank_single_quoted(
    sanitized: &mut [u8],
    source: &[u8],
    mut index: usize,
    blank_delimiters: bool,
) -> usize {
    if blank_delimiters {
        sanitized[index] = b' ';
    }
    index += 1;
    while index < source.len() {
        if source[index] == b'\'' {
            if source.get(index + 1) == Some(&b'\'') {
                sanitized[index] = b' ';
                sanitized[index + 1] = b' ';
                index += 2;
                continue;
            }
            if blank_delimiters {
                sanitized[index] = b' ';
            }
            return index + 1;
        }
        if source[index] != b'\n' {
            sanitized[index] = b' ';
        }
        index += 1;
    }
    index
}

fn skip_single_quoted(source: &[u8], mut index: usize) -> usize {
    index += 1;
    while index < source.len() {
        if source[index] == b'\'' {
            if source.get(index + 1) == Some(&b'\'') {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    index
}

fn skip_double_quoted(source: &[u8], mut index: usize) -> usize {
    index += 1;
    while index < source.len() {
        if source[index] == b'"' {
            if source.get(index + 1) == Some(&b'"') {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    index
}

fn blank_bytes(source: &mut [u8], start: usize, end: usize) {
    let source_length = source.len();
    for byte in &mut source[start..end.min(source_length)] {
        if *byte != b'\n' {
            *byte = b' ';
        }
    }
}
