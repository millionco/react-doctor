pub fn is_firebase_rules_path(relative_path: &str) -> bool {
    ["firestore.rules", "storage.rules", "database.rules.json"]
        .iter()
        .any(|file_name| {
            relative_path == *file_name || relative_path.ends_with(&format!("/{file_name}"))
        })
}
