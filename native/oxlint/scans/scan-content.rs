use std::{borrow::Cow, cell::OnceCell, ops::Deref};

use super::{
    get_scannable_content::get_scannable_content,
    normalize_js_regex_content::normalize_js_regex_content,
};

pub struct ScanContent<'a> {
    relative_path: &'a str,
    source: &'a str,
    scannable: [OnceCell<Cow<'a, str>>; 2],
    normalized_scannable: [OnceCell<Option<String>>; 2],
    normalized_source: OnceCell<Cow<'a, str>>,
}

impl<'a> ScanContent<'a> {
    pub fn new(relative_path: &'a str, source: &'a str) -> Self {
        Self {
            relative_path,
            source,
            scannable: [OnceCell::new(), OnceCell::new()],
            normalized_scannable: [OnceCell::new(), OnceCell::new()],
            normalized_source: OnceCell::new(),
        }
    }

    pub fn scannable(&self, ignore_string_literals: bool) -> &str {
        self.scannable[usize::from(ignore_string_literals)]
            .get_or_init(|| {
                get_scannable_content(self.relative_path, self.source, ignore_string_literals)
            })
            .as_ref()
    }

    pub fn normalized_scannable(&self, ignore_string_literals: bool) -> &str {
        let scannable = self.scannable(ignore_string_literals);
        self.normalized_scannable[usize::from(ignore_string_literals)]
            .get_or_init(|| match normalize_js_regex_content(scannable) {
                Cow::Borrowed(_) => None,
                Cow::Owned(normalized) => Some(normalized),
            })
            .as_deref()
            .unwrap_or(scannable)
    }

    pub fn normalized_source(&self) -> &str {
        self.normalized_source
            .get_or_init(|| normalize_js_regex_content(self.source))
            .as_ref()
    }
}

impl Deref for ScanContent<'_> {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.source
    }
}
