import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  type ClientCapabilities,
  type Executable,
  type FeatureState,
  type LanguageClientOptions,
  type ServerOptions,
  type StaticFeature,
} from "vscode-languageclient/node";

const CLIENT_ID = "reactDoctor";
const CLIENT_NAME = "React Doctor";
const COMMAND_SCAN_FILE = "react-doctor.scanFile";
const COMMAND_FIX_ALL = "react-doctor.fixAll";
const COMMAND_RESTART = "react-doctor.restart";
const COMMAND_SHOW_OUTPUT = "react-doctor.showOutput";
const SERVER_STATUS_METHOD = "experimental/serverStatus";

interface ServerStatusParams {
  readonly health: "ok" | "warning" | "error";
  readonly quiescent: boolean;
  readonly message?: string;
}

/** Reflects the server's rust-analyzer-style status in the editor footer. */
const renderStatus = (item: vscode.StatusBarItem, status: ServerStatusParams): void => {
  if (!status.quiescent) {
    item.text = "$(sync~spin) React Doctor";
    item.tooltip = `${CLIENT_NAME}: scanning…`;
    return;
  }
  if (status.health === "error") item.text = "$(error) React Doctor";
  else if (status.health === "warning") item.text = "$(warning) React Doctor";
  else item.text = "$(check) React Doctor";
  item.tooltip = status.message ?? `${CLIENT_NAME}: ready`;
};

/** Opts into the server's `experimental/serverStatus` notification. */
const createServerStatusFeature = (): StaticFeature => ({
  fillClientCapabilities(capabilities: ClientCapabilities) {
    const experimental = (capabilities.experimental ?? (capabilities.experimental = {})) as Record<
      string,
      unknown
    >;
    experimental.serverStatusNotification = true;
  },
  initialize() {},
  getState(): FeatureState {
    return { kind: "static" };
  },
  clear() {},
});

const DOCUMENT_LANGUAGE_IDS = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
] as const;
const ACTIVE_FILE_COMMANDS = new Set([COMMAND_SCAN_FILE, COMMAND_FIX_ALL]);
const IS_WINDOWS = process.platform === "win32";

let client: LanguageClient | undefined;

interface ResolvedServer {
  readonly command: string;
  readonly args: string[];
  readonly shell: boolean;
}

/**
 * Resolves how to launch `react-doctor experimental-lsp --stdio`, preferring
 * the project's own install so the editor uses the exact version pinned in
 * the repo, then falling back to `npx` so the extension works with zero
 * setup:
 *   1. `reactDoctor.serverPath` setting (explicit override)
 *   2. workspace `node_modules/.bin/react-doctor`
 *   3. `npx react-doctor@latest`
 */
const resolveServer = (configuration: vscode.WorkspaceConfiguration): ResolvedServer => {
  const explicitPath = configuration.get<string>("serverPath", "").trim();
  if (explicitPath.length > 0) {
    return { command: explicitPath, args: ["experimental-lsp", "--stdio"], shell: false };
  }

  const binName = IS_WINDOWS ? "react-doctor.cmd" : "react-doctor";
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const localBin = path.join(folder.uri.fsPath, "node_modules", ".bin", binName);
    if (fs.existsSync(localBin)) {
      return { command: localBin, args: ["experimental-lsp", "--stdio"], shell: IS_WINDOWS };
    }
  }

  return {
    command: IS_WINDOWS ? "npx.cmd" : "npx",
    args: ["-y", "react-doctor@latest", "experimental-lsp", "--stdio"],
    shell: IS_WINDOWS,
  };
};

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const configuration = vscode.workspace.getConfiguration(CLIENT_ID);
  if (!configuration.get<boolean>("enable", true)) return;

  const outputChannel = vscode.window.createOutputChannel(CLIENT_NAME);
  const resolved = resolveServer(configuration);
  const executable: Executable = {
    command: resolved.command,
    args: resolved.args,
    transport: TransportKind.stdio,
    options: { shell: resolved.shell },
  };
  const serverOptions: ServerOptions = { run: executable, debug: executable };

  const clientOptions: LanguageClientOptions = {
    documentSelector: DOCUMENT_LANGUAGE_IDS.map((language) => ({ scheme: "file", language })),
    outputChannel,
    traceOutputChannel: outputChannel,
    initializationOptions: { scanOnType: configuration.get<boolean>("scanOnType", true) },
    // The server advertises its commands, so vscode-languageclient already
    // registers them as editor commands. Intercept to fill the active file
    // for file-scoped commands and to restart the client process itself.
    middleware: {
      executeCommand: (command, commandArguments, forwardToServer) => {
        if (command === COMMAND_RESTART) return client?.restart();
        if (!ACTIVE_FILE_COMMANDS.has(command) || commandArguments.length > 0) {
          return forwardToServer(command, commandArguments);
        }
        const activeDocumentUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (activeDocumentUri === undefined) {
          void vscode.window.showInformationMessage(
            `${CLIENT_NAME}: open a file in the editor to run this command.`,
          );
          return undefined;
        }
        return forwardToServer(command, [{ uri: activeDocumentUri }]);
      },
    },
  };

  const languageClient = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
  client = languageClient;
  languageClient.registerFeature(createServerStatusFeature());

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBarItem.command = COMMAND_SHOW_OUTPUT;
  renderStatus(statusBarItem, {
    health: "ok",
    quiescent: false,
    message: `${CLIENT_NAME}: starting…`,
  });
  statusBarItem.show();

  context.subscriptions.push(
    outputChannel,
    languageClient,
    statusBarItem,
    vscode.commands.registerCommand(COMMAND_SHOW_OUTPUT, () => outputChannel.show()),
  );

  try {
    await languageClient.start();
    languageClient.onNotification(SERVER_STATUS_METHOD, (status: ServerStatusParams) =>
      renderStatus(statusBarItem, status),
    );
    renderStatus(statusBarItem, { health: "ok", quiescent: true });
  } catch (error) {
    renderStatus(statusBarItem, {
      health: "error",
      quiescent: true,
      message: `${CLIENT_NAME}: failed to start`,
    });
    outputChannel.appendLine(
      `Failed to start the React Doctor language server: ${error instanceof Error ? error.message : String(error)}`,
    );
    void vscode.window.showErrorMessage(
      `${CLIENT_NAME}: failed to start. Ensure Node.js is installed and "react-doctor" is available (npm i -D react-doctor).`,
    );
  }
};

export const deactivate = (): Thenable<void> | undefined => client?.stop();
