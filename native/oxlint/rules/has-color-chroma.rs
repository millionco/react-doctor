const COLOR_CHROMA_THRESHOLD: f64 = 30.0;

fn has_color_chroma(color: Rgb) -> bool {
    let maximum = color.red.max(color.green).max(color.blue);
    let minimum = color.red.min(color.green).min(color.blue);
    maximum - minimum >= COLOR_CHROMA_THRESHOLD
}
