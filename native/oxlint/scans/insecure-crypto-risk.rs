use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.";
const SECURITY_CONTEXT_WINDOW_CHARS: usize = 250;

static DEMO_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:examples?|tutorials?|demos?|samples?|playgrounds?)(?:/|$)");
static PROTOCOL_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)gravatar|digest[-_ ]?auth|oauth[-_ ]?1|pkcs#?12|smime|\b_id\b|\betag\b|checksum|cache[-_ ]?key|fingerprint"
);
static CRYPTO_TRIGGER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)createHash|md5|cipher|encrypt|decrypt|crypto|signature|Math\.random");
static WEAK_HASH_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?i)createHash\s*\(\s*["'](?:md5|sha1)["']|\bmd5\s*\("#);
static SECURITY_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:password|token|secret|signature|signing|auth|credential|session|cookie|csrf|api.?key)\b"
);
static WEAK_CIPHER_ALGORITHM_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)\bcreate(?:Cipher|Decipher)iv\s*\(\s*["'](?:des|des3|des-?ede3?|rc4|rc2|bf|blowfish)\b"#
);
static DEPRECATED_CIPHER_API_PATTERN: Lazy<Regex> =
    lazy_regex!(r"\bcreate(?:Cipher|Decipher)\s*\(");
static WEAK_CIPHER_NAME_PATTERN: Lazy<Regex> = lazy_regex!(r"\b(?:DES|RC4|Blowfish)\b");
static CIPHER_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)\b(?:cipher|decipher|encrypt|decrypt|crypto)\b");
static UNSAFE_SIGNATURE_COMPARISON_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)[A-Za-z_$][A-Za-z0-9_$.]{0,100}signature[A-Za-z0-9_$]*(?:\([^)]*\))?\s*(?:===?|!==?)\s*[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^)]*\))?|[A-Za-z_$][A-Za-z0-9_$.]{0,100}(?:\([^)]*\))?\s*(?:===?|!==?)\s*[A-Za-z_$][A-Za-z0-9_$.]{0,100}signature[A-Za-z0-9_$]*(?:\([^)]*\))?"
);
static SIGNATURE_METADATA_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)signature(?:Method|Type|Status|Algorithm|Kind|Mode|Version)\b");
static BOOLEAN_COMPARAND_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:===?|!==?)\s*(?:true|false|null|undefined)\b");
static LENGTH_COMPARAND_PATTERN: Lazy<Regex> =
    lazy_regex!(r"\.(?:length|size|byteLength)\s*(?:===?|!==?)|\.(?:length|size|byteLength)\s*$");
static CRYPTO_PROVENANCE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\bcrypto\b|createH(?:mac|ash)|createSign|createVerify|\bsubtle\b|\bhmac\b|\bdigest\b|\bsha-?(?:1|256|384|512)\b|\bmd5\b|\bwebhook|x-(?:hub-)?signature"
);
static TIMING_SAFE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)timingSafeEqual|timing.?safe");
static CLIENT_COMPONENT_PATH_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.[cm]?[jt]sx$");
static MATH_RANDOM_PATTERN: Lazy<Regex> = lazy_regex!(r"Math\.random\s*\(");
static SECURITY_RANDOM_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)token|secret|password|nonce|salt|csrf|credential|otp");
static UI_NONCE_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:focus|render|refresh|remount|redraw|animation|layout|cache|update)[-_]?nonce"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    if DEMO_CONTEXT_PATTERN.is_match(&normalized_path)
        || PROTOCOL_CONTEXT_PATTERN.is_match(&normalized_path)
        || !CRYPTO_TRIGGER_PATTERN.is_match(&normalized_source)
    {
        return Vec::new();
    }
    let stripped =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&stripped);

    let mut match_index = WEAK_HASH_PATTERN.find_iter(&content).find_map(|found| {
        let start = content[..found.start()]
            .char_indices()
            .rev()
            .nth(SECURITY_CONTEXT_WINDOW_CHARS - 1)
            .map_or(0, |(index, _)| index);
        let end = content[found.start()..]
            .char_indices()
            .nth(SECURITY_CONTEXT_WINDOW_CHARS)
            .map_or(content.len(), |(offset, _)| found.start() + offset);
        let surrounding = &content[start..end];
        (SECURITY_CONTEXT_PATTERN.is_match(surrounding)
            && !PROTOCOL_CONTEXT_PATTERN.is_match(surrounding))
        .then_some(found.start())
    });
    if match_index.is_none() {
        match_index = WEAK_CIPHER_ALGORITHM_PATTERN
            .find(&content)
            .map(|found| found.start());
    }
    if match_index.is_none() {
        match_index = DEPRECATED_CIPHER_API_PATTERN
            .find_iter(&content)
            .find_map(|found| {
                (!content[..found.start()].ends_with("cipher.")).then_some(found.start())
            });
    }
    if match_index.is_none() && CIPHER_CONTEXT_PATTERN.is_match(&content) {
        match_index = WEAK_CIPHER_NAME_PATTERN
            .find(&content)
            .map(|found| found.start());
    }
    if match_index.is_none()
        && !TIMING_SAFE_PATTERN.is_match(&content)
        && !CLIENT_COMPONENT_PATH_PATTERN.is_match(&normalized_path)
        && CRYPTO_PROVENANCE_PATTERN.is_match(&content)
        && let Some(comparison) = UNSAFE_SIGNATURE_COMPARISON_PATTERN.find(&content)
    {
        let comparison_text = comparison.as_str();
        if !is_enum_comparison(comparison_text)
            && !SIGNATURE_METADATA_PATTERN.is_match(comparison_text)
            && !BOOLEAN_COMPARAND_PATTERN.is_match(comparison_text)
            && !LENGTH_COMPARAND_PATTERN.is_match(comparison_text)
        {
            match_index = Some(comparison.start());
        }
    }
    if match_index.is_none() {
        match_index = MATH_RANDOM_PATTERN.find_iter(&content).find_map(|found| {
            let line_start = content[..found.start()]
                .rfind('\n')
                .map_or(0, |index| index + 1);
            let line_end = content[found.start()..]
                .find('\n')
                .map_or(content.len(), |offset| found.start() + offset);
            let line = &content[line_start..line_end];
            (SECURITY_RANDOM_CONTEXT_PATTERN.is_match(line)
                && !UI_NONCE_CONTEXT_PATTERN.is_match(line))
            .then_some(found.start())
        });
    }
    let Some(index) = match_index else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &content, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn is_enum_comparison(comparison: &str) -> bool {
    let Some(operator_index) = comparison.find("===").or_else(|| comparison.find("!==")) else {
        let Some(operator_index) = comparison.find("==").or_else(|| comparison.find("!=")) else {
            return false;
        };
        return is_enum_member_comparand(&comparison[operator_index + 2..])
            || is_enum_member_comparand(&comparison[..operator_index]);
    };
    is_enum_member_comparand(&comparison[operator_index + 3..])
        || is_enum_member_comparand(&comparison[..operator_index])
}

fn is_enum_member_comparand(source: &str) -> bool {
    let source = source.trim_start();
    let mut characters = source.char_indices();
    let Some((_, first_character)) = characters.next() else {
        return false;
    };
    if !first_character.is_ascii_uppercase() {
        return false;
    }
    if characters
        .clone()
        .next()
        .is_some_and(|(_, character)| character.is_ascii_lowercase())
    {
        return true;
    }
    let uppercase_name_end = characters
        .find(|(_, character)| {
            !(character.is_ascii_uppercase() || character.is_ascii_digit() || *character == '_')
        })
        .map_or(source.len(), |(index, _)| index);
    let suffix = &source[uppercase_name_end..];
    suffix
        .chars()
        .next()
        .is_none_or(|character| !character.is_ascii_lowercase())
        && !matches!(suffix.trim_start().chars().next(), Some('.' | '('))
}
