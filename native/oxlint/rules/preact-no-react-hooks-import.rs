use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const REACT_HOOK_NAMES: [&str; 15] = [
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
];

#[derive(Debug, Default, Clone)]
pub struct PreactNoReactHooksImport;

declare_oxc_lint!(
    /// Disallow React hook imports in pure Preact projects.
    PreactNoReactHooksImport,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React hook imports in pure Preact projects.",
);

impl Rule for PreactNoReactHooksImport {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        if import_declaration.source.value != "react" {
            return;
        }
        let mut imported_names = Vec::new();
        for_each_named_import(import_declaration, |import_specifier| {
            let imported_name = import_specifier.imported.name();
            if REACT_HOOK_NAMES.contains(&imported_name.as_str()) {
                imported_names.push(imported_name.to_string());
            }
        });
        if imported_names.is_empty() {
            return;
        }
        let formatted_names = imported_names
            .iter()
            .map(|imported_name| format!("`{imported_name}`"))
            .collect::<Vec<_>>()
            .join(", ");
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users hit `__H` undefined errors because importing {formatted_names} from `react` in a pure-Preact project loads a second copy of the hook state, so import from `preact/hooks` (or `preact/compat`) instead."
            ))
            .with_label(import_declaration.span),
        );
    }
}
