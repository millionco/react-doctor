fn r3f_constructor_name(element_type: &str) -> String {
    let mut characters = element_type.chars();
    let Some(first_character) = characters.next() else {
        return String::new();
    };
    first_character.to_uppercase().chain(characters).collect()
}
