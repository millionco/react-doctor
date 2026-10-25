import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasDelegatedNativeComboboxCommands } from "../../utils/has-delegated-native-combobox-commands.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

interface CommandSourceEdit {
  readonly before: string;
  readonly after: string;
}

interface DelegatedCommandCase {
  readonly name: string;
  readonly edits: ReadonlyArray<CommandSourceEdit>;
  readonly expected: boolean;
  readonly diagnostics: number | null;
}

const commandProbe: Rule = {
  ...clickEventsHaveKeyEvents,
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        hasJsxPropIgnoreCase(node.attributes, "data-command-probe") &&
        hasDelegatedNativeComboboxCommands(node, context)
      ) {
        context.report({ node: node.name, message: "Delegated commands established" });
      }
    },
  }),
};

const source =
  'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\nexport const ChoiceField = ({ expanded, onExpandedChange, onCommit, inactive = false, step = 1 }) => {\n  const [innerOpen, updateInnerOpen] = useState(false);\n  const [waiting, updateWaiting] = useState(false);\n  const [mounted, updateMounted] = useState(false);\n  const waitingRef = useRef(false);\n  const ticket = useRef<number | null>(null);\n  const rootRef = useRef<HTMLDivElement>(null);\n  const triggerRef = useRef<HTMLDivElement>(null);\n  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n  const dismiss = useCallback(() => {\n    if (waitingRef.current) return;\n    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(() => {\n      waitingRef.current = false;\n      updateWaiting(false);\n      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n  }, []);\n  useEffect(() => {\n    if (!isOpen) return;\n    if (ticket.current !== null) {\n      window.clearTimeout(ticket.current);\n      ticket.current = null;\n    }\n    waitingRef.current = false;\n    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n    dismiss();\n    triggerRef.current?.focus();\n  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n    if (!isOpen) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n      }\n      return;\n    }\n    if (key === "Escape") {\n      event.preventDefault();\n      dismiss();\n      triggerRef.current?.focus();\n    } else if (key === "Enter") {\n      event.preventDefault();\n      commit();\n    }\n  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </div>\n  );\n};\n';

const cases: DelegatedCommandCase[] = [
  {
    name: "closed and open command roles with controlled Boolean forwarding",
    expected: true,
    diagnostics: 0,
    edits: [],
  },
  {
    name: "native wrapper may be a section",
    expected: true,
    diagnostics: null,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <section ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
      {
        before:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </div>\n  );\n};\n',
        after:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </section>\n  );\n};\n',
      },
    ],
  },
  {
    name: "numeric literal timer delay",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before:
          "      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
        after:
          "      requestOpen(false);\n      updateMounted(false);\n    }, 75);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
      },
    ],
  },
  {
    name: "Escape focus restoration is optional",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before:
          '      event.preventDefault();\n      dismiss();\n      triggerRef.current?.focus();\n    } else if (key === "Enter") {\n      event.preventDefault();\n',
        after:
          '      event.preventDefault();\n      dismiss();\n    } else if (key === "Enter") {\n      event.preventDefault();\n',
      },
    ],
  },
  {
    name: "transparent ref wrapper",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
        after:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={(triggerRef as React.RefObject<HTMLDivElement>)} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
      },
    ],
  },
  {
    name: "literal void and empty noops in handler",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before:
          "    triggerRef.current?.focus();\n  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n",
        after:
          "    triggerRef.current?.focus();\n  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => { ; void 0;\n    if (inactive) return;\n    const { key } = event;\n",
      },
    ],
  },
  {
    name: "literal void and empty noops in timer callback",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(() => {\n      waitingRef.current = false;\n      updateWaiting(false);\n",
        after:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(() => { ; void 0;\n      waitingRef.current = false;\n      updateWaiting(false);\n",
      },
    ],
  },
  {
    name: "missing parent key handler",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div ref={rootRef} data-handler={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "unknown parent handler",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={() => {}}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "wrong key discriminant",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n    if (!isOpen) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n',
        after:
          '  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { code: key } = event;\n    if (!isOpen) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n',
      },
    ],
  },
  {
    name: "missing Enter opening",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    const { key } = event;\n    if (!isOpen) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n',
        after:
          '    const { key } = event;\n    if (!isOpen) {\n      if (key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n',
      },
    ],
  },
  {
    name: "wrong opening value",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n      }\n      return;\n',
        after:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(false);\n      }\n      return;\n',
      },
    ],
  },
  {
    name: "unknown command prefix",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n      }\n',
        after:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        prepare();\n        requestOpen(true);\n      }\n',
      },
    ],
  },
  {
    name: "unknown side-effecting void prefix",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        requestOpen(true);\n      }\n',
        after:
          '      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n        void prepare();\n        requestOpen(true);\n      }\n',
      },
    ],
  },
  {
    name: "different disabled gate",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n    if (!isOpen) {\n",
        after:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (step) return;\n    const { key } = event;\n    if (!isOpen) {\n",
      },
    ],
  },
  {
    name: "event target restriction",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n",
        after:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (event.target !== event.currentTarget) return;\n    if (inactive) return;\n    const { key } = event;\n",
      },
    ],
  },
  {
    name: "late stop propagation prefix",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n",
        after:
          "  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    event.stopPropagation();\n    if (inactive) return;\n    const { key } = event;\n",
      },
    ],
  },
  {
    name: "parent capture handler",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys} onKeyDownCapture={(event) => event.stopPropagation()}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "parent spread can overwrite key handler",
    expected: false,
    diagnostics: null,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys} {...{onKeyDown: () => {}}}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "target duplicate click overrides",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n      </div>\n',
        after:
          '      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)} onClick={() => {}}>\n        Select a shade\n      </div>\n',
      },
    ],
  },
  {
    name: "target ref spread overwrites native ref",
    expected: false,
    diagnostics: null,
    edits: [
      {
        before:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
        after:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} {...{ref: null}} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
      },
    ],
  },
  {
    name: "hidden ancestor",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div hidden ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "inert ancestor",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <div inert ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
    ],
  },
  {
    name: "aria hidden target",
    expected: false,
    diagnostics: 0,
    edits: [
      {
        before:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
        after:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div aria-hidden data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
      },
    ],
  },
  {
    name: "target changes role",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
        after:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="listbox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
      },
    ],
  },
  {
    name: "target wrong popup role",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
        after:
          '  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="menu"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n',
      },
    ],
  },
  {
    name: "target nonfocusable when enabled",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n',
        after:
          '    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : -1}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n',
      },
    ],
  },
  {
    name: "phase mismatch",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n',
        after:
          '    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={waiting} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n',
      },
    ],
  },
  {
    name: "toggle wrong phase",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!isOpen)}>\n        Select a shade\n      </div>\n',
        after:
          '      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n        onClick={() => !inactive && !waiting && requestOpen(!waiting)}>\n        Select a shade\n      </div>\n',
      },
    ],
  },
  {
    name: "closed branch different phase",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    if (inactive) return;\n    const { key } = event;\n    if (!isOpen) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n',
        after:
          '    if (inactive) return;\n    const { key } = event;\n    if (!waiting) {\n      if (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp") {\n        event.preventDefault();\n',
      },
    ],
  },
  {
    name: "mutable keyboard callback binding",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "    triggerRef.current?.focus();\n  };\n  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n",
        after:
          "    triggerRef.current?.focus();\n  };\n  let handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {\n    if (inactive) return;\n    const { key } = event;\n",
      },
    ],
  },
  {
    name: "custom native intermediary",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <Shell ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
      {
        before:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </div>\n  );\n};\n',
        after:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </Shell>\n  );\n};\n',
      },
    ],
  },
  {
    name: "root hidden in data attribute",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
        after:
          '  };\n  return (\n    <section data-view={<div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n        aria-expanded={isOpen} tabIndex={inactive ? -1 : 0}\n',
      },
      {
        before:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </div>\n  );\n};\n',
        after:
          '      </div>\n      {isOpen && <button type="button" onClick={commit}>Commit</button>}\n    </div>} />\n  );\n};\n',
      },
    ],
  },
  {
    name: "unreachable return in branch",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    }\n  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n',
        after:
          '    }\n  };\n  if (false) return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n      <div data-command-probe ref={triggerRef} role="combobox" aria-haspopup="dialog"\n',
      },
      {
        before: "    </div>\n  );\n};\n",
        after: "    </div>\n  );\n  return null;\n};\n",
      },
    ],
  },
  {
    name: "unreachable return after earlier exit",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "    }\n  };\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n",
        after:
          "    }\n  };\n  return null;\n  return (\n    <div ref={rootRef} onKeyDown={handleKeys}>\n",
      },
    ],
  },
  {
    name: "wrong timer dispatcher",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
        after:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      updateInnerOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
      },
    ],
  },
  {
    name: "missing timer dispatch",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
        after:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      void 0;\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
      },
    ],
  },
  {
    name: "unknown timer callback operation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      updateWaiting(false);\n      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n",
        after:
          "      updateWaiting(false);\n      requestOpen(false);\n      prepare();\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n",
      },
    ],
  },
  {
    name: "coercing timer delay",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
        after:
          "      requestOpen(false);\n      updateMounted(false);\n    }, { valueOf() { return 1; } });\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
      },
    ],
  },
  {
    name: "negative timer delay",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
        after:
          "      requestOpen(false);\n      updateMounted(false);\n    }, -1);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
      },
    ],
  },
  {
    name: "nonfinite delay",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
        after:
          "      requestOpen(false);\n      updateMounted(false);\n    }, Infinity);\n  }, [requestOpen]);\n  useEffect(() => () => {\n",
      },
    ],
  },
  {
    name: "unknown timer provider",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(() => {\n      waitingRef.current = false;\n      updateWaiting(false);\n",
        after:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = schedule(() => {\n      waitingRef.current = false;\n      updateWaiting(false);\n",
      },
    ],
  },
  {
    name: "async timer callback",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(() => {\n      waitingRef.current = false;\n      updateWaiting(false);\n",
        after:
          "    waitingRef.current = true;\n    updateWaiting(true);\n    ticket.current = window.setTimeout(async () => {\n      waitingRef.current = false;\n      updateWaiting(false);\n",
      },
    ],
  },
  {
    name: "cleanup missing dependencies",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n  }, []);\n  useEffect(() => {\n    if (!isOpen) return;\n",
        after:
          "  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n  });\n  useEffect(() => {\n    if (!isOpen) return;\n",
      },
    ],
  },
  {
    name: "cleanup closing dependency",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n  }, []);\n  useEffect(() => {\n    if (!isOpen) return;\n",
        after:
          "  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n  }, [waiting]);\n  useEffect(() => {\n    if (!isOpen) return;\n",
      },
    ],
  },
  {
    name: "opening reset reacts to closing state",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    waitingRef.current = false;\n    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    waitingRef.current = false;\n    updateWaiting(false);\n  }, [isOpen, waiting]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "opening reset missing phase dependency",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    waitingRef.current = false;\n    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    waitingRef.current = false;\n    updateWaiting(false);\n  }, [step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "timer ticket escapes",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  consume(ticket);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "closing ref escapes",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  consume(waitingRef);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "unknown closing ref writer",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  waitingRef.current = true;\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "unconditional timer cancellation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  window.clearTimeout(ticket.current);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "trigger ref transported by logical alias",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const alias = triggerRef.current || {};\n  consume(alias);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "trigger ref setter writes",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  triggerRef.current = suppliedNode;\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "native key listener can stop event",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  document.addEventListener("keydown", event => event.stopPropagation(), true);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "bare global timer assignment",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: 'import React, { useCallback, useEffect, useRef, useState } from "react";\n',
        after:
          'setTimeout = () => 0;\nimport React, { useCallback, useEffect, useRef, useState } from "react";\n',
      },
    ],
  },
  {
    name: "bare global clear assignment",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: 'import React, { useCallback, useEffect, useRef, useState } from "react";\n',
        after:
          'clearTimeout = () => {};\nimport React, { useCallback, useEffect, useRef, useState } from "react";\n',
      },
    ],
  },
  {
    name: "window timer visible mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'window.setTimeout = () => 0;\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "Window prototype timer mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'Window.prototype.setTimeout = () => 0;\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "document defaultView timer mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'document.defaultView.setTimeout = () => 0;\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "global namespace timer alias",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'const nativeWindow = globalThis.window; consume(nativeWindow);\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "reflection timer mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'Object.defineProperty(window, "setTimeout", {value: () => 0});\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "Function capability",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'Function("window.setTimeout=()=>0")();\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "computed constructor capability",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'const key = ["constructor"][0]; consume((() => {})[key]);\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "erased window binding",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'declare const window: {setTimeout: (...args: any[]) => any; clearTimeout: (...args: any[]) => void};\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "React hook provider mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'React.useCallback = callback => () => {};\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "React JSX factory mutation",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'React.createElement = () => null;\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "opaque side effect provider import",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          'import React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
        after:
          'import "./provider-change";\nimport React, { useCallback, useEffect, useRef, useState } from "react";\nconst DISMISS_DELAY_MS = 120;\n',
      },
    ],
  },
  {
    name: "dispatcher callback omitted controlled dependency",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n  const dismiss = useCallback(() => {\n    if (waitingRef.current) return;\n",
        after:
          "    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [onExpandedChange]);\n  const dismiss = useCallback(() => {\n    if (waitingRef.current) return;\n",
      },
    ],
  },
  {
    name: "dispatcher callback omitted change dependency",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n  const dismiss = useCallback(() => {\n    if (waitingRef.current) return;\n",
        after:
          "    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded]);\n  const dismiss = useCallback(() => {\n    if (waitingRef.current) return;\n",
      },
    ],
  },
  {
    name: "dismiss callback omitted dispatcher dependency",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, [requestOpen]);\n  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n",
        after:
          "      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n  }, []);\n  useEffect(() => () => {\n    if (ticket.current !== null) window.clearTimeout(ticket.current);\n",
      },
    ],
  },
  {
    name: "unknown state setter escape",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  const commit = () => {\n    onCommit?.("accepted");\n',
        after:
          '    updateWaiting(false);\n  }, [isOpen, step]);\n  consume(updateWaiting);\n  const commit = () => {\n    onCommit?.("accepted");\n',
      },
    ],
  },
  {
    name: "controlled branch selects wrong local state",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  const rootRef = useRef<HTMLDivElement>(null);\n  const triggerRef = useRef<HTMLDivElement>(null);\n  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n",
        after:
          "  const rootRef = useRef<HTMLDivElement>(null);\n  const triggerRef = useRef<HTMLDivElement>(null);\n  const isOpen = expanded !== undefined ? expanded : waiting;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n",
      },
    ],
  },
  {
    name: "controlled dispatcher writes wrong local setter",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n",
        after:
          "  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateWaiting(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n",
      },
    ],
  },
  {
    name: "dispatcher forwards unrelated value",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n  }, [expanded, onExpandedChange]);\n  const dismiss = useCallback(() => {\n",
        after:
          "  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(false);\n  }, [expanded, onExpandedChange]);\n  const dismiss = useCallback(() => {\n",
      },
    ],
  },
  {
    name: "dispatcher unknown prefix",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n",
        after:
          "  const isOpen = expanded !== undefined ? expanded : innerOpen;\n  const requestOpen = useCallback((next: boolean) => {\n    prepare();\n    if (expanded === undefined) updateInnerOpen(next);\n    onExpandedChange?.(next);\n",
      },
    ],
  },
  {
    name: "timer returns function instead of dispatching",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
        after:
          "      waitingRef.current = false;\n      updateWaiting(false);\n      () => requestOpen(false);\n      updateMounted(false);\n    }, DISMISS_DELAY_MS);\n",
      },
    ],
  },
  {
    name: "mutable local state binding",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "const [innerOpen, updateInnerOpen] = useState(false);",
        after: "let [innerOpen, updateInnerOpen] = useState(false); innerOpen = true;",
      },
    ],
  },
  {
    name: "mutable closing state binding",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "const [waiting, updateWaiting] = useState(false);",
        after: "let [waiting, updateWaiting] = useState(false); waiting = false;",
      },
    ],
  },
  {
    name: "native timer cancellation without ticket reference",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "  const commit = () => {",
        after:
          "  useEffect(() => { if (waiting) { for (let handle = 0; handle < 1000; handle += 1) window.clearTimeout(handle); } }, [waiting]);\n  const commit = () => {",
      },
    ],
  },
  {
    name: "explicit custom JSX factory pragma",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after: "/** @jsx customFactory */\nimport React,",
      },
    ],
  },
  {
    name: "explicit custom JSX import source pragma",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after: "/** @jsxImportSource custom-runtime */\nimport React,",
      },
    ],
  },
  {
    name: "member JSX factory is not a native selected host",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "<div data-command-probe",
        after: "<motion.div data-command-probe",
      },
      {
        before: "Select a shade\n      </div>",
        after: "Select a shade\n      </motion.div>",
      },
    ],
  },
  {
    name: "arbitrary selected component is not native",
    expected: false,
    diagnostics: null,
    edits: [
      {
        before: "<div data-command-probe",
        after: "<Trigger data-command-probe",
      },
      {
        before: "Select a shade\n      </div>",
        after: "Select a shade\n      </Trigger>",
      },
    ],
  },
  {
    name: "ordinary CSS module token read",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before: "import React,",
        after: 'import styles from "./choice.module.less";\nimport React,',
      },
      {
        before: "<div data-command-probe",
        after: "<div data-command-probe className={styles[`slot-${step}`]}",
      },
    ],
  },
  {
    name: "explicit same disabled ARIA projection",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before: "aria-expanded={isOpen}",
        after: "aria-disabled={inactive || undefined} aria-expanded={isOpen}",
      },
    ],
  },
  {
    name: "unknown ARIA disabled projection",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "aria-expanded={isOpen}",
        after: "aria-disabled={otherState} aria-expanded={isOpen}",
      },
    ],
  },
  {
    name: "selected customized built-in refused",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "<div data-command-probe",
        after: '<div is="custom-trigger" data-command-probe',
      },
    ],
  },
  {
    name: "ancestor customized built-in refused",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "<div ref={rootRef} onKeyDown={handleKeys}>",
        after: '<div is="custom-owner" ref={rootRef} onKeyDown={handleKeys}>',
      },
    ],
  },
  {
    name: "selected key handler may stop propagation",
    expected: false,
    diagnostics: 0,
    edits: [
      {
        before: "<div data-command-probe",
        after: "<div onKeyDown={event => event.stopPropagation()} data-command-probe",
      },
    ],
  },
  {
    name: "native ref geometry and passive pointer listener roles",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before: "  const commit = () => {",
        after:
          '  const outside = (event: MouseEvent) => {\n    if (rootRef.current && !rootRef.current.contains(event.target as Node)) dismiss();\n  };\n  useEffect(() => {\n    if (isOpen) document.addEventListener("mousedown", outside);\n    return () => document.removeEventListener("mousedown", outside);\n  }, [isOpen, dismiss]);\n  useEffect(() => {\n    if (isOpen && rootRef.current) {\n      const bounds = rootRef.current.getBoundingClientRect();\n      if (bounds.bottom < window.innerHeight) requestAnimationFrame(() => updateMounted(true));\n    }\n  }, [isOpen]);\n  const commit = () => {',
      },
      {
        before: "aria-expanded={isOpen}",
        after: "aria-disabled={inactive || undefined} aria-expanded={isOpen}",
      },
    ],
  },
  {
    name: "fresh local callbacks without memo wrappers",
    expected: true,
    diagnostics: 0,
    edits: [
      {
        before: "const requestOpen = useCallback((next: boolean) => {",
        after: "const requestOpen = (next: boolean) => {",
      },
      {
        before: "}, [expanded, onExpandedChange]);",
        after: "};",
      },
      {
        before: "const dismiss = useCallback(() => {",
        after: "const dismiss = () => {",
      },
      {
        before: "}, [requestOpen]);",
        after: "};",
      },
    ],
  },
  {
    name: "bare clearInterval cannot cancel native timeout pool",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "  const commit = () => {",
        after: "  clearInterval(1);\n  const commit = () => {",
      },
    ],
  },
  {
    name: "bare native global capture blocks key transport",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after:
          'addEventListener("keydown", event => event.stopPropagation(), true);\nimport React,',
      },
    ],
  },
  {
    name: "bare native listener alias capability",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after:
          'const listen = addEventListener;\nlisten("keydown", event => event.stopImmediatePropagation(), true);\nimport React,',
      },
    ],
  },
  {
    name: "erased native listener binding cannot bypass capability fence",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after:
          'declare const addEventListener: (kind: string, handler: any, capture?: boolean) => void;\naddEventListener("keydown", event => event.stopPropagation(), true);\nimport React,',
      },
    ],
  },
  {
    name: "bare native listener removal capability escape",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "import React,",
        after: "const remove = removeEventListener;\nconsume(remove);\nimport React,",
      },
    ],
  },
  {
    name: "actual key callback reassignment",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "const handleKeys = (event:",
        after: "let handleKeys = (event:",
      },
      {
        before: "  return (\n    <div ref={rootRef}",
        after: "  handleKeys = () => {};\n  return (\n    <div ref={rootRef}",
      },
    ],
  },
  {
    name: "saved JSX shell does not establish direct rendered owner",
    expected: false,
    diagnostics: 1,
    edits: [
      {
        before: "  return (\n    <div ref={rootRef}",
        after: "  const view = (\n    <div ref={rootRef}",
      },
      {
        before: "    </div>\n  );\n};",
        after: "    </div>\n  );\n  return view;\n};",
      },
    ],
  },
];

describe("delegated native combobox command availability", () => {
  it.each(cases)("$name", (fixture) => {
    let fixtureSource = source;
    for (const edit of fixture.edits) {
      expect(fixtureSource.split(edit.before)).toHaveLength(2);
      fixtureSource = fixtureSource.replace(edit.before, edit.after);
    }
    const probe = runRule(commandProbe, fixtureSource, { filename: "choice-field.tsx" });
    expect(probe.parseErrors).toEqual([]);
    expect(probe.diagnostics).toHaveLength(fixture.expected ? 1 : 0);
    if (fixture.diagnostics !== null) {
      const result = runRule(clickEventsHaveKeyEvents, fixtureSource, {
        filename: "choice-field.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.diagnostics);
    }
  });

  it("refuses a settings-mapped custom selected host", () => {
    const customSource = source
      .replace("<div data-command-probe", "<Trigger data-command-probe")
      .replace("Select a shade\n      </div>", "Select a shade\n      </Trigger>");
    expect(runRule(commandProbe, customSource).diagnostics).toEqual([]);
    expect(
      runRule(clickEventsHaveKeyEvents, customSource, {
        settings: { "jsx-a11y": { components: { Trigger: "div" } } },
      }).diagnostics,
    ).toHaveLength(1);
  });

  it("does not change ordinary missing-key or own-key behavior", () => {
    expect(
      runRule(
        clickEventsHaveKeyEvents,
        "export const Card=({open})=><div onClick={open}>Open</div>",
      ).diagnostics,
    ).toHaveLength(1);
    expect(
      runRule(
        clickEventsHaveKeyEvents,
        "export const Card=({open})=><div onClick={open} onKeyDown={open}>Open</div>",
      ).diagnostics,
    ).toEqual([]);
  });
});
