fn does_tailwind_variant_scope_cover(candidate_scope: &[&str], target_scope: &[&str]) -> bool {
    let mut target_variant_index = 0;
    for candidate_variant in candidate_scope {
        while target_variant_index < target_scope.len()
            && target_scope[target_variant_index] != *candidate_variant
        {
            target_variant_index += 1;
        }
        if target_variant_index == target_scope.len() {
            return false;
        }
        target_variant_index += 1;
    }
    true
}
