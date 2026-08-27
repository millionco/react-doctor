fn is_react_native_file_active(ctx: &crate::context::ContextHost<'_>) -> bool {
    if is_react_native_file_target(ctx) {
        return true;
    }
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if has_platform_file_extension(&filename, &["web"]) {
        return false;
    }
    if let Some(package_summary) = nearest_react_native_package_summary(ctx.file_path()) {
        match package_summary.platform {
            ReactNativePackagePlatform::ReactNative => return true,
            ReactNativePackagePlatform::Web => return false,
            ReactNativePackagePlatform::Neutral
                if react_doctor_root_directory_for_platform(ctx)
                    .as_deref()
                    .is_some_and(|root_directory| {
                        package_is_nested_within_root(&package_summary.directory, root_directory)
                    }) =>
            {
                return false;
            }
            ReactNativePackagePlatform::Neutral | ReactNativePackagePlatform::Unknown => {}
        }
    }
    !matches!(
        react_doctor_framework_setting_from_json(ctx.settings().json.as_ref()),
        Some("nextjs" | "vite" | "cra" | "remix" | "gatsby" | "tanstack-start")
    )
}
