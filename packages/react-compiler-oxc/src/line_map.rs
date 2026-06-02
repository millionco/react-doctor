/// Maps byte offsets in a source string to 1-based line numbers and exposes the
/// trimmed text of each line, so control-flow nodes can be anchored to source.
pub struct LineMap<'s> {
    line_starts: Vec<u32>,
    lines: Vec<&'s str>,
}

impl<'s> LineMap<'s> {
    pub fn new(source: &'s str) -> Self {
        let mut line_starts = vec![0u32];
        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                line_starts.push((index + 1) as u32);
            }
        }
        Self {
            line_starts,
            lines: source.lines().collect(),
        }
    }

    /// 1-based line number containing `offset`.
    pub fn line(&self, offset: u32) -> usize {
        self.line_starts.partition_point(|&start| start <= offset)
    }

    /// Trimmed text of a 1-based line, or an empty string when out of range.
    pub fn text(&self, line: usize) -> &'s str {
        self.lines
            .get(line.saturating_sub(1))
            .map_or("", |l| l.trim())
    }
}
