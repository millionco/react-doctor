fn react_doctor_framework_setting_from_json(
    settings: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<&str> {
    settings?
        .get("react-doctor")?
        .as_object()?
        .get("framework")?
        .as_str()
}
