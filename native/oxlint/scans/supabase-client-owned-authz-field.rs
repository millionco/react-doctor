use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Client Supabase code appears to write user, tenant, owner, or role fields that should be enforced by RLS.";

static AUTH_FIELD_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\b)(?:ownerId|ownerID|creatorId|creatorID|userId|userID|uid|providerId|providerID|orgId|orgID|tenantId|tenantID|teamId|teamID|workspaceId|workspaceID|ghostOrg|role|roles|isAdmin|admin)(?-u:\b)"
);
static AUTH_WRITE_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?is:(?-u:\b)(?:supabase(?-u:\b)|\.from\s*\(\s*["'][^"']+["']\s*\))[\s\S]{0,700}(?-u:\b)(?:insert|upsert|update)\s*\(\s*(?:\{|\[?\s*\{)[\s\S]{0,700}(?-u:\b)(?:ownerId|creatorId|userId|orgId|tenantId|role|isAdmin)(?-u:\b))"#
);
static SERVER_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:api|backend|server|servers|middleware|route|routes|functions|lambdas|workers)(?:/|$)|(?:^|/)[^/]+\.server\.[cm]?[jt]sx?$"
);
static BUILD_CONFIG_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:vite|next|nuxt|astro|remix|webpack|rollup|rspack|rsbuild|esbuild|tsup|metro|expo|babel|tailwind|postcss|svelte|farm|parcel|snowpack)[^/]*\.config\.[cm]?[jt]sx?$"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !is_client_source_path(relative_path) {
        return Vec::new();
    }

    let lowercase_path = relative_path.to_ascii_lowercase();
    let Ok(source_type) = SourceType::from_path(&lowercase_path) else {
        return Vec::new();
    };
    let comment_stripped =
        super::strip_comments_preserving_positions::strip_comments_preserving_positions(source);
    let scannable =
        super::normalize_js_regex_content::normalize_js_regex_content(&comment_stripped);
    if !AUTH_WRITE_PATTERN.is_match(&scannable) {
        return Vec::new();
    }
    let Some(auth_field) = AUTH_FIELD_PATTERN.find(&scannable) else {
        return Vec::new();
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, source, source_type).parse();
    if !parser_return.panicked
        && parser_return.diagnostics.is_empty()
        && parser_return
            .program
            .directives
            .iter()
            .any(|directive| directive.directive == "use server")
    {
        return Vec::new();
    }

    let (line, column) = get_location_at_index(source, &scannable, auth_field.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn is_client_source_path(relative_path: &str) -> bool {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    super::is_production_file_path::is_production_source_path(relative_path)
        && !SERVER_CONTEXT_PATTERN.is_match(&normalized_path)
        && !BUILD_CONFIG_PATTERN.is_match(&normalized_path)
}

#[cfg(test)]
mod tests {
    use super::scan;

    #[test]
    fn matches_ecmascript_whitespace_but_not_unicode_only_whitespace() {
        let with_byte_order_mark = "supabase.insert\u{FEFF}({ ownerId: currentUser.id })";
        let with_next_line = "supabase.insert\u{0085}({ ownerId: currentUser.id })";

        assert_eq!(scan("src/client.ts", with_byte_order_mark).len(), 1);
        assert!(scan("src/client.ts", with_next_line).is_empty());
    }

    #[test]
    fn counts_astral_characters_as_utf16_units() {
        let source = format!(
            "supabase{}insert({{ ownerId: currentUser.id }})",
            "\u{1F642}".repeat(350)
        );

        assert_eq!(scan("src/client.ts", &source).len(), 1);
    }

    #[test]
    fn accepts_uppercase_source_extensions() {
        let source = "supabase.from(\"teams\").insert({ ownerId })";

        assert_eq!(scan("src/client.TS", source).len(), 1);
    }
}
