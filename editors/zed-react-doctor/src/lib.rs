use zed_extension_api::{self as zed, Command, LanguageServerId, Result, Worktree};

const SERVER_BINARY: &str = "react-doctor";
const NPX_BINARY: &str = "npx";
const NPX_PACKAGE_SPEC: &str = "react-doctor@latest";
const LOCAL_PACKAGE_MANIFEST: &str = "node_modules/react-doctor/package.json";
const LOCAL_BIN_DIR: &str = "node_modules/.bin";
const WINDOWS_BIN_SHIM: &str = "react-doctor.cmd";

struct ReactDoctorExtension;

impl ReactDoctorExtension {
    /// Resolves the project-pinned CLI shim under `node_modules/.bin`, but only
    /// when the package is actually installed in the worktree. Reading the
    /// manifest doubles as the existence check, since the worktree API exposes
    /// no direct stat.
    fn local_server(worktree: &Worktree) -> Option<String> {
        worktree.read_text_file(LOCAL_PACKAGE_MANIFEST).ok()?;

        // The extension runs as Wasm, so the host platform must be queried at
        // runtime rather than via compile-time `cfg!`.
        let shim = match zed::current_platform() {
            (zed::Os::Windows, _) => WINDOWS_BIN_SHIM,
            _ => SERVER_BINARY,
        };

        Some(format!("{}/{}/{}", worktree.root_path(), LOCAL_BIN_DIR, shim))
    }
}

impl zed::Extension for ReactDoctorExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Command> {
        let env = worktree.shell_env();

        if let Some(command) = Self::local_server(worktree) {
            return Ok(Command {
                command,
                args: stdio_args(),
                env,
            });
        }

        if let Some(command) = worktree.which(SERVER_BINARY) {
            return Ok(Command {
                command,
                args: stdio_args(),
                env,
            });
        }

        if let Some(command) = worktree.which(NPX_BINARY) {
            return Ok(Command {
                command,
                args: npx_args(),
                env,
            });
        }

        Err(format!(
            "react-doctor language server not found. install it in your project (npm i -D {SERVER_BINARY}) or make `{NPX_BINARY}` available on your PATH."
        ))
    }
}

fn stdio_args() -> Vec<String> {
    vec!["experimental-lsp".into(), "--stdio".into()]
}

fn npx_args() -> Vec<String> {
    let mut args = vec!["-y".into(), NPX_PACKAGE_SPEC.into()];
    args.extend(stdio_args());
    args
}

zed::register_extension!(ReactDoctorExtension);
