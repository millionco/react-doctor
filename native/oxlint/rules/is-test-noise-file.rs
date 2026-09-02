const AMBIGUOUS_TEST_NOISE_PATH_SEGMENTS: &[&str] = &[
    "/playground/",
    "/playgrounds/",
    "/examples/",
    "/example/",
    "/demo/",
    "/demos/",
    "/sandbox/",
    "/sandboxes/",
    "/specs/",
    "/spec/",
    "/integration/",
    "/it/",
    "/perf/",
    "/scripts/",
    "/cli/",
    "/bin/",
    "/tooling/",
    "/tools/",
    "/codemods/",
    "/codemod/",
    "/migrations/",
    "/migration/",
    "/generators/",
    "/generator/",
    "/runbooks/",
    "/devtools/",
    "/internal-tools/",
    "/seeds/",
    "/seed/",
    "/dev-seeder/",
];

fn is_test_noise_file(ctx: &crate::context::ContextHost) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    is_test_noise_filename(&filename)
}

fn is_test_noise_filename(filename: &str) -> bool {
    let rooted_filename_storage;
    let rooted_filename = if filename.starts_with('/') {
        filename
    } else {
        rooted_filename_storage = format!("/{filename}");
        &rooted_filename_storage
    };
    let basename = rooted_filename
        .rsplit('/')
        .next()
        .unwrap_or(rooted_filename);
    let lowercase_basename = basename.to_lowercase();
    if NON_PRODUCTION_BASENAMES.contains(&lowercase_basename.as_str())
        || NON_PRODUCTION_FILENAME_SUFFIXES
            .iter()
            .any(|suffix| basename.contains(suffix))
    {
        return true;
    }
    if ["/.storybook/", "/.dumi/"]
        .iter()
        .any(|segment| rooted_filename.contains(segment))
    {
        return true;
    }
    let is_below_source_root = SOURCE_ROOT_SEGMENTS
        .iter()
        .any(|segment| rooted_filename.contains(segment));
    let scoped_filename = SOURCE_ROOT_SEGMENTS
        .iter()
        .filter_map(|segment| rooted_filename.rfind(segment))
        .max()
        .map_or(rooted_filename, |source_root_index| {
            &rooted_filename[source_root_index..]
        });
    NON_PRODUCTION_PATH_SEGMENTS.iter().any(|segment| {
        if is_below_source_root && AMBIGUOUS_TEST_NOISE_PATH_SEGMENTS.contains(segment) {
            return false;
        }
        let haystack = if segment.starts_with("/.") {
            rooted_filename
        } else {
            scoped_filename
        };
        haystack.contains(segment)
    })
}
