fn program_estree_span(program: &oxc_ast::ast::Program) -> oxc_span::Span {
    let start = program
        .directives
        .first()
        .map(oxc_span::GetSpan::span)
        .or_else(|| program.body.first().map(oxc_span::GetSpan::span))
        .map_or(0, |first_span| first_span.start);
    oxc_span::Span::new(start, program.span.end)
}
