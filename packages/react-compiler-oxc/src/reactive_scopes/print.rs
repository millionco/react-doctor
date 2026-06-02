//! Textual printer for the [`ReactiveFunction`] tree, ported from
//! `packages/react-compiler/src/ReactiveScopes/PrintReactiveFunction.ts`.
//!
//! [`print_reactive_function`] / [`print_reactive_function_with_outlined`]
//! reproduce the React Compiler's `printReactiveFunction` /
//! `printReactiveFunctionWithOutlined` output byte-for-byte: the multi-line
//! function header, the nested block/scope structure, the `scope @N [a:b]
//! dependencies=[…] declarations=[…] reassignments=[…] { … }` summaries, the
//! `<pruned>` scope blocks, the labeled terminal statements (`bbN: [i] …`), the
//! reactive-terminal forms (if/switch/for/while/…), and the compound reactive
//! value forms (Ternary/Logical/Sequence/OptionalExpression).
//!
//! Place/value rendering reuses the existing HIR printer ([`print_place`],
//! [`print_instruction_value`], [`print_identifier`], [`print_type`],
//! [`print_source_location`]) so reactive output stays consistent with the HIR
//! dump's `printPlace` (effect + ident + range + type + `{reactive}`).

use crate::hir::print::{
    print_identifier, print_instruction_value, print_place, print_source_location, print_type,
};
use crate::hir::terminal::{ReactiveScope, ReactiveScopeDependency};

use super::model::{
    ReactiveBlock, ReactiveFunction, ReactiveInstruction, ReactiveStatement, ReactiveTerminal,
    ReactiveValue,
};

/// Print a reactive function and all of its outlined functions
/// (`printReactiveFunctionWithOutlined`): the reactive body, then one `\nfunction
/// <printFunction(outlined)>` line per outlined function.
///
/// Outlined functions are produced by `OutlineFunctions`
/// (`enableFunctionOutlining`) and live on the originating
/// [`HirFunction`](crate::hir::model::HirFunction); they are passed in here as
/// already-printed `printFunction(outlined)` strings (the same source the TS reads
/// via `fn.env.getOutlinedFunctions()`), so the reactive printer does not need the
/// `Environment`.
pub fn print_reactive_function_with_outlined(
    func: &ReactiveFunction,
    outlined: &[String],
) -> String {
    let mut writer = Writer::new();
    write_reactive_function(func, &mut writer);
    for printed in outlined {
        // `writer.writeLine('\nfunction ' + printFunction(outlined.fn))`: a single
        // `writeLine` of a multi-line string. The `Writer` only prepends
        // indentation when the current line is empty *and* depth > 0; at depth 0
        // (where we are after the function body) it appends the whole string —
        // embedded `\n`s and all — as one buffer entry, so they survive verbatim.
        writer.write_line(&format!("\nfunction {printed}"));
    }
    writer.complete()
}

/// Print just the reactive function body (`printReactiveFunction`).
pub fn print_reactive_function(func: &ReactiveFunction) -> String {
    let mut writer = Writer::new();
    write_reactive_function(func, &mut writer);
    writer.complete()
}

fn write_reactive_function(func: &ReactiveFunction, writer: &mut Writer) {
    let name = func.id.as_deref().unwrap_or("<unknown>");
    writer.write_line(&format!("function {name}("));
    writer.indented(|writer| {
        for param in &func.params {
            match param {
                crate::hir::model::FunctionParam::Place(place) => {
                    writer.write_line(&format!("{},", print_place(place)));
                }
                crate::hir::model::FunctionParam::Spread(spread) => {
                    writer.write_line(&format!("...{},", print_place(&spread.place)));
                }
            }
        }
    });
    writer.write_line(") {");
    write_reactive_instructions(writer, &func.body);
    writer.write_line("}");
}

/// `printReactiveScopeSummary`: `scope @<id> [<start>:<end>] dependencies=[…]
/// declarations=[…] reassignments=[…]` (+ optional `earlyReturn={…}`). Reused for
/// both `scope` and `pruned-scope` blocks (the latter gains a `<pruned> ` prefix
/// at the call site).
pub fn print_reactive_scope_summary(scope: &ReactiveScope) -> String {
    let mut items: Vec<String> = Vec::new();
    items.push("scope".to_string());
    items.push(format!("@{}", scope.id.as_u32()));
    items.push(format!(
        "[{}:{}]",
        scope.range.start.as_u32(),
        scope.range.end.as_u32()
    ));
    let dependencies = scope
        .dependencies
        .iter()
        .map(print_dependency)
        .collect::<Vec<_>>()
        .join(", ");
    items.push(format!("dependencies=[{dependencies}]"));
    // `printIdentifier({...decl.identifier, scope: decl.scope})`: the declaration
    // identifier rendered with its declaring scope as the `_@N` suffix.
    let declarations = scope
        .declarations
        .iter()
        .map(|(_, decl)| {
            let mut ident = decl.identifier.clone();
            ident.scope = Some(decl.scope);
            print_identifier(&ident)
        })
        .collect::<Vec<_>>()
        .join(", ");
    items.push(format!("declarations=[{declarations}]"));
    // The TS uses `Array.from(scope.reassignments).map(...)` with default `,`
    // join (no space), matching `reassignments=[a,b]`.
    let reassignments = scope
        .reassignments
        .iter()
        .map(print_identifier)
        .collect::<Vec<_>>()
        .join(",");
    items.push(format!("reassignments=[{reassignments}]"));
    // `earlyReturnValue` is populated by `PropagateEarlyReturns` for the outermost
    // reactive scope wrapping an early return. The TS renders
    // `earlyReturn={id: <printIdentifier(value)>, label: <label>}}` (the extra
    // closing brace matches the oracle's `printReactiveScopeSummary`).
    if let Some(early_return) = &scope.early_return_value {
        items.push(format!(
            "earlyReturn={{id: {}, label: {}}}}}",
            print_identifier(&early_return.value),
            early_return.label.as_u32()
        ));
    }
    items.join(" ")
}

/// `printDependency`: `printIdentifier(dep.identifier) + printType(...) + path +
/// '_' + printSourceLocation(dep.loc)`.
fn print_dependency(dep: &ReactiveScopeDependency) -> String {
    let mut out = print_identifier(&dep.identifier);
    out.push_str(&print_type(&dep.identifier.type_));
    for token in &dep.path {
        out.push_str(if token.optional { "?." } else { "." });
        out.push_str(&print_property_literal(&token.property));
    }
    out.push('_');
    out.push_str(&print_source_location(&dep.loc));
    out
}

fn print_property_literal(property: &crate::hir::value::PropertyLiteral) -> String {
    match property {
        crate::hir::value::PropertyLiteral::String(name) => name.clone(),
        crate::hir::value::PropertyLiteral::Number(name) => {
            // `String(number)` semantics (integral f64s print without `.0`).
            if *name == name.trunc() && name.is_finite() && name.abs() < 1e21 {
                format!("{}", *name as i64)
            } else {
                format!("{name}")
            }
        }
    }
}

fn write_reactive_instructions(writer: &mut Writer, instructions: &ReactiveBlock) {
    writer.indented(|writer| {
        for instr in instructions {
            write_reactive_instruction(writer, instr);
        }
    });
}

fn write_reactive_instruction(writer: &mut Writer, instr: &ReactiveStatement) {
    match instr {
        ReactiveStatement::Instruction(instruction) => {
            write_instruction_statement(writer, instruction);
        }
        ReactiveStatement::Scope(block) => {
            writer.write_line(&format!("{} {{", print_reactive_scope_summary(&block.scope)));
            write_reactive_instructions(writer, &block.instructions);
            writer.write_line("}");
        }
        ReactiveStatement::PrunedScope(block) => {
            writer.write_line(&format!(
                "<pruned> {} {{",
                print_reactive_scope_summary(&block.scope)
            ));
            write_reactive_instructions(writer, &block.instructions);
            writer.write_line("}");
        }
        ReactiveStatement::Terminal(stmt) => {
            if let Some(label) = &stmt.label {
                writer.write(&format!("bb{}: ", label.id.as_u32()));
            }
            write_terminal(writer, &stmt.terminal);
        }
    }
}

/// Emit a `{kind: 'instruction'}` statement, shared between top-level statements
/// and the entries of a `SequenceExpression`.
fn write_instruction_statement(writer: &mut Writer, instruction: &ReactiveInstruction) {
    let id = format!("[{}]", instruction.id.as_u32());
    match &instruction.lvalue {
        Some(lvalue) => {
            writer.write(&format!("{id} {} = ", print_place(lvalue)));
            write_reactive_value(writer, &instruction.value);
            writer.newline();
        }
        None => {
            writer.write(&format!("{id} "));
            write_reactive_value(writer, &instruction.value);
            writer.newline();
        }
    }
}

fn write_reactive_value(writer: &mut Writer, value: &ReactiveValue) {
    match value {
        ReactiveValue::Ternary(ternary) => {
            // `writer.writeLine('Ternary ')` (trailing space trimmed away).
            writer.write_line("Ternary ");
            writer.indented(|writer| {
                write_reactive_value(writer, &ternary.test);
                writer.write_line("? ");
                writer.indented(|writer| {
                    write_reactive_value(writer, &ternary.consequent);
                });
                writer.write_line(": ");
                writer.indented(|writer| {
                    write_reactive_value(writer, &ternary.alternate);
                });
            });
            writer.newline();
        }
        ReactiveValue::Logical(logical) => {
            writer.write_line("Logical");
            writer.indented(|writer| {
                write_reactive_value(writer, &logical.left);
                // `writer.write('${operator} ')` — no newline; the operator joins
                // with the start of the right value's first line.
                writer.write(&format!("{} ", logical.operator.as_str()));
                write_reactive_value(writer, &logical.right);
            });
            writer.newline();
        }
        ReactiveValue::Sequence(sequence) => {
            writer.write_line("Sequence");
            writer.indented(|writer| {
                writer.indented(|writer| {
                    for instr in &sequence.instructions {
                        write_instruction_statement(writer, instr);
                    }
                    writer.write(&format!("[{}] ", sequence.id.as_u32()));
                    write_reactive_value(writer, &sequence.value);
                });
            });
            writer.newline();
        }
        ReactiveValue::OptionalCall(optional) => {
            writer.append(&format!("OptionalExpression optional={}", optional.optional));
            writer.newline();
            writer.indented(|writer| {
                write_reactive_value(writer, &optional.value);
            });
            writer.newline();
        }
        ReactiveValue::Instruction(instr_value) => {
            let printed = print_instruction_value(instr_value);
            let lines: Vec<&str> = printed.split('\n').collect();
            if lines.len() == 1 {
                writer.write_line(&printed);
            } else {
                writer.indented(|writer| {
                    for line in &lines {
                        writer.write_line(line);
                    }
                });
            }
        }
    }
}

fn write_terminal(writer: &mut Writer, terminal: &ReactiveTerminal) {
    match terminal {
        ReactiveTerminal::Break {
            target,
            id,
            target_kind,
            ..
        } => {
            writer.write_line(&format!(
                "[{}] break bb{} ({})",
                id.as_u32(),
                target.as_u32(),
                target_kind.as_str()
            ));
        }
        ReactiveTerminal::Continue {
            target,
            id,
            target_kind,
            ..
        } => {
            writer.write_line(&format!(
                "[{}] continue bb{} ({})",
                id.as_u32(),
                target.as_u32(),
                target_kind.as_str()
            ));
        }
        ReactiveTerminal::DoWhile {
            loop_, test, id, ..
        } => {
            writer.write_line(&format!("[{}] do-while {{", id.as_u32()));
            write_reactive_instructions(writer, loop_);
            writer.write_line("} (");
            writer.indented(|writer| {
                write_reactive_value(writer, test);
            });
            writer.write_line(")");
        }
        ReactiveTerminal::While {
            test, loop_, id, ..
        } => {
            writer.write_line(&format!("[{}] while (", id.as_u32()));
            writer.indented(|writer| {
                write_reactive_value(writer, test);
            });
            writer.write_line(") {");
            write_reactive_instructions(writer, loop_);
            writer.write_line("}");
        }
        ReactiveTerminal::If {
            test,
            consequent,
            alternate,
            id,
            ..
        } => {
            writer.write_line(&format!("[{}] if ({}) {{", id.as_u32(), print_place(test)));
            write_reactive_instructions(writer, consequent);
            if let Some(alternate) = alternate {
                writer.write_line("} else {");
                write_reactive_instructions(writer, alternate);
            }
            writer.write_line("}");
        }
        ReactiveTerminal::Switch {
            test, cases, id, ..
        } => {
            writer.write_line(&format!("[{}] switch ({}) {{", id.as_u32(), print_place(test)));
            writer.indented(|writer| {
                for case in cases {
                    let prefix = match &case.test {
                        Some(case_test) => format!("case {}", print_place(case_test)),
                        None => "default".to_string(),
                    };
                    writer.write_line(&format!("{prefix}: {{"));
                    writer.indented(|writer| {
                        // The TS invariants a non-null block here.
                        if let Some(block) = &case.block {
                            write_reactive_instructions(writer, block);
                        }
                    });
                    writer.write_line("}");
                }
            });
            writer.write_line("}");
        }
        ReactiveTerminal::For {
            init,
            test,
            update,
            loop_,
            id,
            ..
        } => {
            writer.write_line(&format!("[{}] for (", id.as_u32()));
            writer.indented(|writer| {
                write_reactive_value(writer, init);
                writer.write_line(";");
                write_reactive_value(writer, test);
                writer.write_line(";");
                if let Some(update) = update {
                    write_reactive_value(writer, update);
                }
            });
            writer.write_line(") {");
            write_reactive_instructions(writer, loop_);
            writer.write_line("}");
        }
        ReactiveTerminal::ForOf {
            init, test, loop_, id, ..
        } => {
            writer.write_line(&format!("[{}] for-of (", id.as_u32()));
            writer.indented(|writer| {
                write_reactive_value(writer, init);
                writer.write_line(";");
                write_reactive_value(writer, test);
            });
            writer.write_line(") {");
            write_reactive_instructions(writer, loop_);
            writer.write_line("}");
        }
        ReactiveTerminal::ForIn {
            init, loop_, id, ..
        } => {
            writer.write_line(&format!("[{}] for-in (", id.as_u32()));
            writer.indented(|writer| {
                write_reactive_value(writer, init);
            });
            writer.write_line(") {");
            write_reactive_instructions(writer, loop_);
            writer.write_line("}");
        }
        ReactiveTerminal::Throw { value, id, .. } => {
            writer.write_line(&format!("[{}] throw {}", id.as_u32(), print_place(value)));
        }
        ReactiveTerminal::Return { value, id, .. } => {
            writer.write_line(&format!("[{}] return {}", id.as_u32(), print_place(value)));
        }
        ReactiveTerminal::Label { block, .. } => {
            writer.write_line("{");
            write_reactive_instructions(writer, block);
            writer.write_line("}");
        }
        ReactiveTerminal::Try {
            block,
            handler_binding,
            handler,
            id,
            ..
        } => {
            writer.write_line(&format!("[{}] try {{", id.as_u32()));
            write_reactive_instructions(writer, block);
            writer.write("} catch ");
            match handler_binding {
                Some(binding) => writer.write_line(&format!("({}) {{", print_place(binding))),
                None => writer.write_line("{"),
            }
            write_reactive_instructions(writer, handler);
            writer.write_line("}");
        }
    }
}

/// Port of the `Writer` class in `PrintReactiveFunction.ts`: an output buffer with
/// a current line, depth-driven `'  '`-per-level indentation, and trailing-
/// whitespace trimming on each completed line.
struct Writer {
    out: Vec<String>,
    line: String,
    depth: usize,
}

impl Writer {
    fn new() -> Self {
        Writer {
            out: Vec::new(),
            line: String::new(),
            depth: 0,
        }
    }

    /// `complete()`: flush the current (trimmed) line, then join with `\n`.
    fn complete(mut self) -> String {
        let line = self.line.trim_end();
        if !line.is_empty() {
            self.out.push(line.to_string());
        }
        self.out.join("\n")
    }

    /// `append(s)` is an alias for `write(s)`.
    fn append(&mut self, s: &str) {
        self.write(s);
    }

    /// `newline()`: trim the current line, push it if non-empty, then reset.
    fn newline(&mut self) {
        let line = self.line.trim_end();
        if !line.is_empty() {
            self.out.push(line.to_string());
        }
        self.line = String::new();
    }

    /// `write(s)`: prefill the line with indentation if it is empty and depth > 0,
    /// then append `s`.
    fn write(&mut self, s: &str) {
        if self.line.is_empty() && self.depth > 0 {
            self.line = "  ".repeat(self.depth);
        }
        self.line.push_str(s);
    }

    /// `writeLine(s)`: write then newline.
    fn write_line(&mut self, s: &str) {
        self.write(s);
        self.newline();
    }

    /// `indented(f)`: run `f` at one extra indentation level.
    fn indented(&mut self, f: impl FnOnce(&mut Writer)) {
        self.depth += 1;
        f(self);
        self.depth -= 1;
    }
}
