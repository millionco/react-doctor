const BROWSER_BUNDLE_NODE_MODULES: [&str; 41] = [
    "fs",
    "child_process",
    "os",
    "module",
    "worker_threads",
    "v8",
    "net",
    "tls",
    "dns",
    "dgram",
    "cluster",
    "readline",
    "repl",
    "inspector",
    "perf_hooks",
    "async_hooks",
    "vm",
    "tty",
    "http",
    "https",
    "http2",
    "zlib",
    "express",
    "fastify",
    "koa",
    "hapi",
    "@hapi/hapi",
    "multer",
    "body-parser",
    "gulp",
    "grunt",
    "webpack",
    "rollup",
    "esbuild",
    "chokidar",
    "execa",
    "fs-extra",
    "commander",
    "yargs",
    "inquirer",
    "electron",
];
const BROWSER_BUNDLE_NODE_PROCESS_PROPERTIES: [&str; 10] = [
    "cwd",
    "exit",
    "argv",
    "execPath",
    "chdir",
    "resourcesPath",
    "stdout",
    "stderr",
    "stdin",
    "pid",
];

fn is_outside_browser_bundle(ctx: &crate::context::LintContext<'_>) -> bool {
    if ctx
        .nodes()
        .iter()
        .any(|node| browser_bundle_node_signal(node, ctx))
    {
        return true;
    }
    let is_cli_package = nearest_bundle_package_manifest(ctx.file_path()).is_some_and(|manifest| {
        manifest
            .get("bin")
            .is_some_and(|bin| bin.is_string() || bin.is_object())
    });
    is_cli_package
        && !ctx.nodes().iter().any(|node| match node.kind() {
            oxc_ast::AstKind::ImportDeclaration(declaration) => {
                let source = declaration.source.value.as_str();
                source == "react"
                    || source == "react-dom"
                    || source.starts_with("react/")
                    || source.starts_with("react-dom/")
            }
            oxc_ast::AstKind::JSXOpeningElement(_) => true,
            _ => false,
        })
}

fn browser_bundle_node_signal(
    node: &crate::AstNode<'_>,
    _ctx: &crate::context::LintContext<'_>,
) -> bool {
    use oxc_ast::{AstKind, ast::Expression};

    match node.kind() {
        AstKind::ImportDeclaration(declaration) if !declaration.import_kind.is_type() => {
            browser_bundle_is_node_module(declaration.source.value.as_str())
        }
        AstKind::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "require")
                && call.arguments.first().is_some_and(|argument| {
                    matches!(argument, oxc_ast::ast::Argument::StringLiteral(literal)
                        if browser_bundle_is_node_module(literal.value.as_str()))
                })
        }
        AstKind::StaticMemberExpression(member) => {
            let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
                return false;
            };
            match receiver.name.as_str() {
                "require" => matches!(member.property.name.as_str(), "cache" | "resolve" | "main"),
                "module" => member.property.name == "exports",
                "process" => BROWSER_BUNDLE_NODE_PROCESS_PROPERTIES
                    .contains(&member.property.name.as_str()),
                _ => false,
            }
        }
        AstKind::IdentifierReference(identifier) => {
            matches!(identifier.name.as_str(), "__dirname" | "__filename")
        }
        AstKind::AssignmentExpression(assignment) => assignment
            .left
            .as_member_expression()
            .is_some_and(|member| {
                matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "exports")
            }),
        _ => false,
    }
}

fn browser_bundle_is_node_module(source: &str) -> bool {
    if source.starts_with("node:") {
        return true;
    }
    let mut segments = source.split('/');
    let first = segments.next().unwrap_or(source);
    let root = if first.starts_with('@') {
        segments
            .next()
            .map_or_else(|| first.to_string(), |second| format!("{first}/{second}"))
    } else {
        first.to_string()
    };
    BROWSER_BUNDLE_NODE_MODULES.contains(&root.as_str())
        || matches!(
            root.as_str(),
            "fast-glob"
                | "glob"
                | "globby"
                | "rimraf"
                | "mkdirp"
                | "resolve-from"
                | "ora"
                | "winston"
                | "pino"
                | "nodemailer"
                | "dotenv"
        )
}
