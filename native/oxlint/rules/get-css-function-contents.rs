fn get_css_function_contents(value: &str) -> Option<&str> {
    let opening_parenthesis_index = value.find('(')?;
    if !value.ends_with(')') {
        return None;
    }
    let mut depth = 0_i32;
    for (character_index, character) in value.char_indices().skip_while(|(character_index, _)| {
        *character_index < opening_parenthesis_index
    }) {
        if character == '(' {
            depth += 1;
        }
        if character == ')' {
            depth -= 1;
        }
        if depth < 0 || depth == 0 && character_index != value.len() - 1 {
            return None;
        }
    }
    (depth == 0).then_some(&value[opening_parenthesis_index + 1..value.len() - 1])
}
