fn should_use_curated_port_behavior(ctx: &crate::context::LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("portedRuleMode"))
        .and_then(serde_json::Value::as_str)
        == Some("curated")
}

fn should_use_curated_port_behavior_host(ctx: &crate::context::ContextHost) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("portedRuleMode"))
        .and_then(serde_json::Value::as_str)
        == Some("curated")
}
