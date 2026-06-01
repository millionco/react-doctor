//! Renders an oxc AST as a structured, source-anchored control-flow outline.
//!
//! The shape mirrors how the code behaves — unconditional runs, branches with
//! their `then`/`else`, loops, switches, early returns, and nested callbacks —
//! and every node is tagged with its source line (and the line text). Reading
//! the source together with this outline is enough to understand behavior,
//! without resolving any block ids.

use oxc::ast::ast::{
    ArrowFunctionExpression, Declaration, ExportDefaultDeclarationKind, Expression, Function,
    FunctionBody, Statement, SwitchCase,
};
use oxc::ast_visit::Visit;
use oxc::span::{GetSpan, Span};
use oxc::syntax::scope::ScopeFlags;

use crate::line_map::LineMap;

const MAX_SOURCE_TEXT_LEN: usize = 100;
const INDENT_STEP: usize = 2;

pub struct Printer<'s> {
    source: &'s str,
    line_map: LineMap<'s>,
    out: String,
}

impl<'s> Printer<'s> {
    pub fn new(source: &'s str) -> Self {
        Self {
            source,
            line_map: LineMap::new(source),
            out: String::new(),
        }
    }

    pub fn finish(self) -> String {
        self.out
    }

    fn line_of(&self, span: Span) -> usize {
        self.line_map.line(span.start)
    }

    /// `  L<line>  «<source text>»` — the anchor an agent reads alongside code.
    fn tag(&self, span: Span) -> String {
        let line = self.line_of(span);
        let text = self.line_map.text(line);
        if text.is_empty() {
            return format!("  L{line}");
        }
        let clipped: String = if text.chars().count() > MAX_SOURCE_TEXT_LEN {
            let mut truncated: String = text.chars().take(MAX_SOURCE_TEXT_LEN).collect();
            truncated.push('…');
            truncated
        } else {
            text.to_string()
        };
        format!("  L{line}  «{clipped}»")
    }

    fn source_slice(&self, span: Span) -> String {
        self.source
            .get(span.start as usize..span.end as usize)
            .unwrap_or("")
            .trim()
            .to_string()
    }

    fn push(&mut self, indent: usize, text: &str) {
        for _ in 0..indent {
            self.out.push(' ');
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    /// Render every top-level function-like declaration in the program.
    pub fn render_program(&mut self, statements: &[Statement<'_>]) {
        let mut first = true;
        for statement in statements {
            self.render_top_level(statement, &mut first);
        }
    }

    fn render_top_level(&mut self, statement: &Statement<'_>, first: &mut bool) {
        match statement {
            Statement::FunctionDeclaration(func) => {
                let name = func.id.as_ref().map(|id| id.name.as_str());
                if let Some(body) = &func.body {
                    self.emit_top(name, body, false, first);
                }
            }
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    self.render_top_level_declarator(declarator, first);
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    self.render_top_level_declaration(declaration, first);
                }
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                    let name = func.id.as_ref().map(|id| id.name.as_str());
                    if let Some(body) = &func.body {
                        self.emit_top(name, body, false, first);
                    }
                }
                expression => {
                    if let Some(expr) = expression.as_expression()
                        && let Some((body, is_expr)) = callable_from_expr(expr)
                    {
                        self.emit_top(None, body, is_expr, first);
                    }
                }
            },
            _ => {}
        }
    }

    fn render_top_level_declaration(&mut self, declaration: &Declaration<'_>, first: &mut bool) {
        match declaration {
            Declaration::FunctionDeclaration(func) => {
                let name = func.id.as_ref().map(|id| id.name.as_str());
                if let Some(body) = &func.body {
                    self.emit_top(name, body, false, first);
                }
            }
            Declaration::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    self.render_top_level_declarator(declarator, first);
                }
            }
            _ => {}
        }
    }

    fn render_top_level_declarator(
        &mut self,
        declarator: &oxc::ast::ast::VariableDeclarator<'_>,
        first: &mut bool,
    ) {
        let Some(init) = &declarator.init else {
            return;
        };
        let Some((body, is_expr)) = callable_from_expr(init) else {
            return;
        };
        let name = declarator.id.get_identifier_name();
        self.emit_top(name.as_ref().map(|n| n.as_str()), body, is_expr, first);
    }

    fn emit_top(
        &mut self,
        name: Option<&str>,
        body: &FunctionBody<'_>,
        is_expr_arrow: bool,
        first: &mut bool,
    ) {
        if !*first {
            self.out.push('\n');
        }
        *first = false;
        let header = name.unwrap_or("<anonymous>").to_string();
        self.push(0, &header);
        self.render_function_body(body, is_expr_arrow, 0);
    }

    fn render_function_body(
        &mut self,
        body: &FunctionBody<'_>,
        is_expr_arrow: bool,
        indent: usize,
    ) {
        if is_expr_arrow {
            if let Some(statement) = body.statements.first() {
                let tag = self.tag(statement.span());
                self.push(indent, &format!("return{tag}"));
                self.render_nested(statement, indent + INDENT_STEP);
            }
            return;
        }
        self.render_statements(&body.statements, indent);
    }

    fn render_statements(&mut self, statements: &[Statement<'_>], indent: usize) {
        let mut index = 0;
        while index < statements.len() {
            match &statements[index] {
                Statement::FunctionDeclaration(func) => {
                    self.render_named_function(func, indent);
                    index += 1;
                }
                Statement::BlockStatement(block) => {
                    self.render_statements(&block.body, indent);
                    index += 1;
                }
                statement if is_control(statement) => {
                    self.render_control(statement, indent);
                    index += 1;
                }
                _ => {
                    let start = index;
                    while index < statements.len() && is_run(&statements[index]) {
                        index += 1;
                    }
                    self.render_run(&statements[start..index], indent);
                }
            }
        }
    }

    fn render_run(&mut self, run: &[Statement<'_>], indent: usize) {
        let lines: Vec<usize> = run.iter().map(|s| self.line_of(s.span())).collect();
        if let (Some(&lo), Some(&hi)) = (lines.iter().min(), lines.iter().max()) {
            let range = if lo == hi {
                format!("run L{lo}")
            } else {
                format!("run L{lo}-{hi}")
            };
            self.push(indent, &range);
        }
        for statement in run {
            self.render_nested(statement, indent + INDENT_STEP);
        }
    }

    fn render_control(&mut self, statement: &Statement<'_>, indent: usize) {
        match statement {
            Statement::IfStatement(if_stmt) => {
                let condition = self.source_slice(if_stmt.test.span());
                let tag = self.tag(if_stmt.span);
                self.push(indent, &format!("if ({condition}){tag}"));
                self.push(indent + INDENT_STEP, "then:");
                self.render_branch(&if_stmt.consequent, indent + INDENT_STEP * 2);
                if let Some(alternate) = &if_stmt.alternate {
                    self.push(indent + INDENT_STEP, "else:");
                    self.render_branch(alternate, indent + INDENT_STEP * 2);
                }
            }
            Statement::ForStatement(stmt) => self.render_loop("for", stmt.span, &stmt.body, indent),
            Statement::ForInStatement(stmt) => {
                self.render_loop("for-in", stmt.span, &stmt.body, indent)
            }
            Statement::ForOfStatement(stmt) => {
                self.render_loop("for-of", stmt.span, &stmt.body, indent)
            }
            Statement::WhileStatement(stmt) => {
                self.render_loop("while", stmt.span, &stmt.body, indent)
            }
            Statement::DoWhileStatement(stmt) => {
                self.render_loop("do-while", stmt.span, &stmt.body, indent)
            }
            Statement::SwitchStatement(switch) => {
                let discriminant = self.source_slice(switch.discriminant.span());
                let tag = self.tag(switch.span);
                self.push(indent, &format!("switch ({discriminant}){tag}"));
                for case in &switch.cases {
                    self.render_switch_case(case, indent + INDENT_STEP);
                }
            }
            Statement::ReturnStatement(stmt) => {
                let tag = self.tag(stmt.span);
                self.push(indent, &format!("return{tag}"));
                self.render_nested(statement, indent + INDENT_STEP);
            }
            Statement::ThrowStatement(stmt) => {
                let tag = self.tag(stmt.span);
                self.push(indent, &format!("throw{tag}"));
            }
            Statement::BreakStatement(stmt) => {
                let tag = self.tag(stmt.span);
                self.push(indent, &format!("break{tag}"));
            }
            Statement::ContinueStatement(stmt) => {
                let tag = self.tag(stmt.span);
                self.push(indent, &format!("continue{tag}"));
            }
            _ => {}
        }
    }

    fn render_loop(&mut self, kind: &str, span: Span, body: &Statement<'_>, indent: usize) {
        let tag = self.tag(span);
        self.push(indent, &format!("loop {kind}{tag}"));
        self.render_branch(body, indent + INDENT_STEP);
    }

    fn render_switch_case(&mut self, case: &SwitchCase<'_>, indent: usize) {
        match &case.test {
            Some(test) => {
                let label = self.source_slice(test.span());
                self.push(indent, &format!("case {label}:"));
            }
            None => self.push(indent, "default:"),
        }
        self.render_statements(&case.consequent, indent + INDENT_STEP);
    }

    fn render_branch(&mut self, statement: &Statement<'_>, indent: usize) {
        match statement {
            Statement::BlockStatement(block) => self.render_statements(&block.body, indent),
            other => self.render_statements(std::slice::from_ref(other), indent),
        }
    }

    fn render_named_function(&mut self, func: &Function<'_>, indent: usize) {
        let name = func
            .id
            .as_ref()
            .map(|id| id.name.as_str())
            .unwrap_or("<anonymous>");
        let tag = self.tag(func.span);
        self.push(indent, &format!("↳ function {name}{tag}"));
        if let Some(body) = &func.body {
            self.render_statements(&body.statements, indent + INDENT_STEP);
        }
    }

    /// Render the functions appearing directly inside `statement` (e.g. an
    /// effect callback in `useEffect(...)`), without descending into them.
    fn render_nested(&mut self, statement: &Statement<'_>, indent: usize) {
        let mut renderer = NestedFunctionRenderer {
            printer: self,
            indent,
        };
        renderer.visit_statement(statement);
    }
}

/// Visitor that renders each immediately-nested function it encounters and does
/// not descend into them (their bodies are rendered recursively instead).
struct NestedFunctionRenderer<'p, 's> {
    printer: &'p mut Printer<'s>,
    indent: usize,
}

impl<'a, 'p, 's> Visit<'a> for NestedFunctionRenderer<'p, 's> {
    fn visit_function(&mut self, func: &Function<'a>, _flags: ScopeFlags) {
        let name = func.id.as_ref().map(|id| id.name.as_str());
        let tag = self.printer.tag(func.span);
        let label = match name {
            Some(name) => format!("↳ function {name}{tag}"),
            None => format!("↳ function{tag}"),
        };
        self.printer.push(self.indent, &label);
        if let Some(body) = &func.body {
            self.printer
                .render_statements(&body.statements, self.indent + INDENT_STEP);
        }
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let tag = self.printer.tag(arrow.span);
        self.printer.push(self.indent, &format!("↳ arrow fn{tag}"));
        self.printer
            .render_function_body(&arrow.body, arrow.expression, self.indent + INDENT_STEP);
    }
}

fn is_control(statement: &Statement<'_>) -> bool {
    matches!(
        statement,
        Statement::IfStatement(_)
            | Statement::ForStatement(_)
            | Statement::ForInStatement(_)
            | Statement::ForOfStatement(_)
            | Statement::WhileStatement(_)
            | Statement::DoWhileStatement(_)
            | Statement::SwitchStatement(_)
            | Statement::ReturnStatement(_)
            | Statement::ThrowStatement(_)
            | Statement::BreakStatement(_)
            | Statement::ContinueStatement(_)
    )
}

fn is_run(statement: &Statement<'_>) -> bool {
    !is_control(statement)
        && !matches!(
            statement,
            Statement::FunctionDeclaration(_) | Statement::BlockStatement(_)
        )
}

fn callable_from_expr<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<(&'b FunctionBody<'a>, bool)> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => Some((&arrow.body, arrow.expression)),
        Expression::FunctionExpression(func) => func.body.as_deref().map(|body| (body, false)),
        _ => None,
    }
}
