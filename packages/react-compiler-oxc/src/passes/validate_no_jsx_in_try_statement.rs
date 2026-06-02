//! `validateNoJSXInTryStatement` (`Validation/ValidateNoJSXInTryStatement.ts`):
//! flags JSX constructed inside a `try` block. Because React renders JSX lazily,
//! a `try { el = <Component/> } catch {}` does NOT catch render errors — an error
//! boundary is required. JSX in the `catch` handler is allowed (unless that
//! handler is itself nested in an outer `try`).

use crate::diagnostic::{Diagnostic, Diagnostics, ErrorCategory, PositionResolver};
use crate::hir::ids::BlockId;
use crate::hir::model::HirFunction;
use crate::hir::terminal::Terminal;
use crate::hir::value::InstructionValue;

const REASON: &str = "Avoid constructing JSX within try/catch";
const DESCRIPTION: &str = "React does not immediately render components when JSX is rendered, so any errors from this component will not be caught by the try/catch. To catch errors in rendering a given component, wrap that component in an error boundary. (https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)";

pub fn validate_no_jsx_in_try_statement(
    func: &HirFunction,
    resolver: &PositionResolver,
    diagnostics: &mut Diagnostics,
) {
    // The handler block ids of the `try` statements currently in scope. A block
    // is "inside a try" while its `catch` handler has not yet been reached, so
    // reaching the handler block drops it from the active set (allowing JSX in a
    // top-level catch).
    let mut active_try_blocks: Vec<BlockId> = Vec::new();

    for block in func.body.blocks() {
        active_try_blocks.retain(|&id| id != block.id);

        if !active_try_blocks.is_empty() {
            for instr in &block.instructions {
                let loc = match &instr.value {
                    InstructionValue::JsxExpression { loc, .. } => loc,
                    InstructionValue::JsxFragment { loc, .. } => loc,
                    _ => continue,
                };
                diagnostics.push(
                    Diagnostic::create(ErrorCategory::ErrorBoundaries, REASON)
                        .with_description(DESCRIPTION)
                        .with_error_detail(resolver.resolve(loc), Some(REASON.to_string())),
                );
            }
        }

        if let Terminal::Try { handler, .. } = &block.terminal {
            active_try_blocks.push(*handler);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::lint;
    use crate::diagnostic::ErrorCategory;

    fn error_boundary_count(code: &str) -> usize {
        lint(code, "Component.tsx")
            .iter()
            .filter(|diagnostic| diagnostic.category == ErrorCategory::ErrorBoundaries)
            .count()
    }

    #[test]
    fn flags_jsx_in_try_block() {
        let code = "function Component() {\n  let el;\n  try {\n    el = <Child />;\n  } catch {\n    el = null;\n  }\n  return el;\n}\n";
        assert_eq!(error_boundary_count(code), 1);
    }

    #[test]
    fn allows_jsx_in_catch_handler() {
        let code = "function Component() {\n  let el;\n  try {\n    doWork();\n  } catch {\n    el = <Fallback />;\n  }\n  return el;\n}\n";
        assert_eq!(error_boundary_count(code), 0);
    }

    #[test]
    fn allows_jsx_outside_try() {
        let code = "function Component() {\n  return <div />;\n}\n";
        assert_eq!(error_boundary_count(code), 0);
    }
}
