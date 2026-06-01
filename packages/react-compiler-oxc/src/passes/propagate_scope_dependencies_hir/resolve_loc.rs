// Included from `propagate_scope_dependencies_hir.rs`.
//
// Resolves the byte-span `loc` of every scope-terminal dependency into a
// Babel-style `SourceLocation::Resolved` (1-based line / 0-based UTF-16 column),
// which is the form `printSourceLocation` renders as
// `start.line:start.column:end.line:end.column`. This runs after
// `propagate_scope_dependencies_hir` from `compile.rs`, which holds the source
// text (the pass entry point stays source-free per its frozen signature).

/// A precomputed map of byte offset -> (line, column). `line` is 1-based;
/// `column` is the 0-based count of UTF-16 code units from the line start.
struct ByteLineCol {
    /// UTF-16 column at each byte offset, indexed by byte offset.
    col16: Vec<u32>,
    /// 1-based line number at each byte offset.
    line_at: Vec<u32>,
}

impl ByteLineCol {
    fn new(source: &str) -> Self {
        let len = source.len();
        let mut col16 = vec![0u32; len + 1];
        let mut line_at = vec![1u32; len + 1];

        let mut line = 1u32;
        let mut col = 0u32; // UTF-16 units since line start
        let mut i = 0usize;
        for (byte_idx, ch) in source.char_indices() {
            // Fill any gap (multibyte continuation positions) with the current
            // (line, col) — those offsets are never the start of a token here.
            while i <= byte_idx {
                line_at[i] = line;
                col16[i] = col;
                i += 1;
            }
            if ch == '\n' {
                line += 1;
                col = 0;
            } else {
                col += ch.len_utf16() as u32;
            }
        }
        while i <= len {
            line_at[i] = line;
            col16[i] = col;
            i += 1;
        }

        ByteLineCol { col16, line_at }
    }

    fn resolve(&self, offset: u32) -> (u32, u32) {
        let idx = (offset as usize).min(self.col16.len().saturating_sub(1));
        (self.line_at[idx], self.col16[idx])
    }
}

/// Resolve every scope-terminal dependency's byte-span `loc` to a
/// `SourceLocation::Resolved` using `source`, recursing into nested functions.
pub fn resolve_dependency_locations(func: &mut HirFunction, source: &str) {
    let map = ByteLineCol::new(source);
    resolve_in_function(func, &map);
}

fn resolve_in_function(func: &mut HirFunction, map: &ByteLineCol) {
    for block in func.body.blocks_mut() {
        if let Some(scope) = block.terminal.scope_mut() {
            for dep in &mut scope.dependencies {
                dep.loc = resolve_loc(&dep.loc, map);
            }
        }
        for instr in &mut block.instructions {
            match &mut instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    resolve_in_function(&mut lowered_func.func, map);
                }
                _ => {}
            }
        }
    }
    for outlined in &mut func.outlined {
        resolve_in_function(outlined, map);
    }
}

fn resolve_loc(loc: &SourceLocation, map: &ByteLineCol) -> SourceLocation {
    match loc {
        SourceLocation::Span { start, end, .. } => {
            let (start_line, start_column) = map.resolve(*start);
            let (end_line, end_column) = map.resolve(*end);
            SourceLocation::Resolved {
                start_line,
                start_column,
                end_line,
                end_column,
            }
        }
        other => other.clone(),
    }
}
