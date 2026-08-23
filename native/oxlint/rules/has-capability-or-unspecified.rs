fn has_capability_or_unspecified(ctx: &crate::context::LintContext, capability: &str) -> bool {
    let Some(settings) = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
    else {
        return true;
    };
    let Some(capabilities) = settings.get("capabilities") else {
        return true;
    };
    capabilities.as_array().is_some_and(|capabilities| {
        capabilities
            .iter()
            .any(|value| value.as_str() == Some(capability))
    })
}
