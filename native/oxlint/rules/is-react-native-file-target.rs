use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

#[derive(Debug)]
struct ReactNativePackageSummary {
    directory: PathBuf,
    platform: ReactNativePackagePlatform,
}

#[derive(Debug, Clone, Copy)]
enum ReactNativePackagePlatform {
    ReactNative,
    Web,
    Neutral,
    Unknown,
}

const EXPO_MANAGED_DEPENDENCY_NAMES: [&str; 5] = [
    "expo",
    "expo-router",
    "@expo/cli",
    "@expo/metro-config",
    "@expo/metro-runtime",
];
const REACT_NATIVE_DEPENDENCY_NAMES: [&str; 4] = [
    "react-native",
    "react-native-tvos",
    "react-native-windows",
    "react-native-macos",
];
const WEB_FRAMEWORK_DEPENDENCY_NAMES: [&str; 17] = [
    "next",
    "vite",
    "react-scripts",
    "gatsby",
    "@remix-run/react",
    "@remix-run/node",
    "@docusaurus/core",
    "@docusaurus/preset-classic",
    "@storybook/react",
    "@storybook/react-vite",
    "@storybook/react-webpack5",
    "@storybook/nextjs",
    "@storybook/web-components",
    "storybook",
    "react-dom",
    "@vitejs/plugin-react",
    "@vitejs/plugin-react-swc",
];

static REACT_NATIVE_PACKAGE_SUMMARIES: LazyLock<
    Mutex<HashMap<PathBuf, Option<Arc<ReactNativePackageSummary>>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn is_react_native_file_target(ctx: &crate::context::ContextHost<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if has_platform_file_extension(&filename, &["ios", "android", "native"]) {
        return true;
    }
    if has_platform_file_extension(&filename, &["web"]) {
        return false;
    }
    if let Some(package_summary) = nearest_react_native_package_summary(ctx.file_path()) {
        match package_summary.platform {
            ReactNativePackagePlatform::ReactNative => {
                return true;
            }
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
    matches!(
        react_doctor_framework_setting(ctx),
        Some("react-native" | "expo")
    )
}

fn has_platform_file_extension(filename: &str, platforms: &[&str]) -> bool {
    let Some((stem, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    matches!(
        extension,
        "js" | "jsx"
            | "ts"
            | "tsx"
            | "mjs"
            | "mjsx"
            | "mts"
            | "mtsx"
            | "cjs"
            | "cjsx"
            | "cts"
            | "ctsx"
    ) && platforms.iter().any(|platform| {
        stem.strip_suffix(platform)
            .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

fn react_doctor_framework_setting<'a>(ctx: &'a crate::context::ContextHost<'_>) -> Option<&'a str> {
    react_doctor_platform_settings(ctx)?
        .get("framework")?
        .as_str()
}

fn react_doctor_root_directory_for_platform(
    ctx: &crate::context::ContextHost<'_>,
) -> Option<PathBuf> {
    react_doctor_platform_settings(ctx)?
        .get("rootDirectory")?
        .as_str()
        .filter(|root_directory| !root_directory.is_empty())
        .map(PathBuf::from)
}

fn react_doctor_platform_settings<'a>(
    ctx: &'a crate::context::ContextHost<'_>,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    ctx.settings()
        .json
        .as_ref()?
        .get("react-doctor")?
        .as_object()
}

fn package_is_nested_within_root(package_directory: &Path, root_directory: &Path) -> bool {
    let resolved_package_directory = package_directory
        .canonicalize()
        .unwrap_or_else(|_| package_directory.to_path_buf());
    resolved_package_directory != root_directory
        && resolved_package_directory.starts_with(root_directory)
}

fn nearest_react_native_package_summary(
    file_path: &Path,
) -> Option<Arc<ReactNativePackageSummary>> {
    let mut directory = file_path.parent()?;
    let mut visited_directories = Vec::new();
    loop {
        let cached_summary = {
            let summaries = REACT_NATIVE_PACKAGE_SUMMARIES
                .lock()
                .expect("react native package cache lock should not be poisoned");
            summaries.get(directory).cloned()
        };
        if let Some(summary) = cached_summary {
            cache_react_native_package_summary(&visited_directories, summary.clone());
            return summary;
        }
        visited_directories.push(directory.to_path_buf());
        let package_json_path = directory.join("package.json");
        if package_json_path.is_file() {
            let summary = read_react_native_package_summary(directory, &package_json_path);
            cache_react_native_package_summary(&visited_directories, summary.clone());
            return summary;
        }
        let Some(parent_directory) = directory.parent() else {
            cache_react_native_package_summary(&visited_directories, None);
            return None;
        };
        directory = parent_directory;
    }
}

fn cache_react_native_package_summary(
    directories: &[PathBuf],
    summary: Option<Arc<ReactNativePackageSummary>>,
) {
    let mut summaries = REACT_NATIVE_PACKAGE_SUMMARIES
        .lock()
        .expect("react native package cache lock should not be poisoned");
    for directory in directories {
        summaries.insert(directory.clone(), summary.clone());
    }
}

fn read_react_native_package_summary(
    package_directory: &Path,
    package_json_path: &Path,
) -> Option<Arc<ReactNativePackageSummary>> {
    let package_json = std::fs::read_to_string(package_json_path).ok()?;
    let manifest = serde_json::from_str::<serde_json::Value>(&package_json).ok()?;
    let manifest = manifest.as_object()?;
    let has_react_native_field = manifest
        .get("react-native")
        .is_some_and(serde_json::Value::is_string);
    let mut has_any_dependency = false;
    let mut has_react_native_dependency = false;
    let mut has_web_dependency = false;
    for section_name in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        let Some(dependencies) = manifest
            .get(section_name)
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        has_any_dependency |= !dependencies.is_empty();
        for dependency_name in dependencies.keys() {
            has_react_native_dependency |= is_react_native_dependency_name(dependency_name);
            has_web_dependency |=
                WEB_FRAMEWORK_DEPENDENCY_NAMES.contains(&dependency_name.as_str());
        }
    }
    let platform = if has_react_native_field || has_react_native_dependency {
        ReactNativePackagePlatform::ReactNative
    } else if has_web_dependency {
        ReactNativePackagePlatform::Web
    } else if has_any_dependency {
        ReactNativePackagePlatform::Neutral
    } else {
        ReactNativePackagePlatform::Unknown
    };
    Some(Arc::new(ReactNativePackageSummary {
        directory: package_directory.to_path_buf(),
        platform,
    }))
}

fn is_react_native_dependency_name(dependency_name: &str) -> bool {
    REACT_NATIVE_DEPENDENCY_NAMES.contains(&dependency_name)
        || EXPO_MANAGED_DEPENDENCY_NAMES.contains(&dependency_name)
        || dependency_name.starts_with("@react-native/")
        || dependency_name.starts_with("@react-native-")
}
