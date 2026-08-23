struct TailwindClassNameToken<'a> {
    utility: &'a str,
    #[allow(dead_code)]
    has_variants: bool,
}

fn tailwind_class_name_tokens(value: &str) -> Vec<TailwindClassNameToken<'_>> {
    let mut tokens = Vec::new();
    let mut token_start = 0;
    let mut bracket_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;

    for (character_index, character) in value.char_indices() {
        if is_escaped {
            is_escaped = false;
            continue;
        }
        if character == '\\' {
            is_escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if bracket_depth == 0 && parenthesis_depth == 0 && is_js_whitespace(character) {
            if token_start < character_index {
                tokens.push(parse_tailwind_class_name_token(
                    &value[token_start..character_index],
                ));
            }
            token_start = character_index + character.len_utf8();
        }
    }
    if token_start < value.len() {
        tokens.push(parse_tailwind_class_name_token(&value[token_start..]));
    }
    tokens
}

fn parse_tailwind_class_name_token(raw_token: &str) -> TailwindClassNameToken<'_> {
    let mut utility_start = 0;
    let mut has_variants = false;
    let mut bracket_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;

    for (character_index, character) in raw_token.char_indices() {
        if is_escaped {
            is_escaped = false;
            continue;
        }
        if character == '\\' {
            is_escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }
        match character {
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            ':' if bracket_depth == 0 && parenthesis_depth == 0 => {
                utility_start = character_index + character.len_utf8();
                has_variants = true;
            }
            _ => {}
        }
    }

    let mut utility = &raw_token[utility_start..];
    if let Some(stripped_utility) = utility.strip_prefix('!') {
        utility = stripped_utility;
    }
    if utility.ends_with('!') {
        let preceding_backslash_count = utility[..utility.len() - 1]
            .chars()
            .rev()
            .take_while(|character| *character == '\\')
            .count();
        if preceding_backslash_count % 2 == 0 {
            utility = &utility[..utility.len() - 1];
        }
    }
    TailwindClassNameToken {
        utility,
        has_variants,
    }
}
