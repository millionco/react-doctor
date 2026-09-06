fn tailwind_token_priority(token: &str) -> (bool, &str) {
    token
        .strip_prefix('!')
        .map_or((false, token), |utility| (true, utility))
}
