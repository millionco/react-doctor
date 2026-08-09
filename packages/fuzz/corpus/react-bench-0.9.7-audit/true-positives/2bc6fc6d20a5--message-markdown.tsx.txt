// rule: dangerous-html-sink
// file-path: src/components/chat/message/message-markdown.tsx
// verdict: fail
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.9 exhaustive audit 2bc6fc6d20a5cd769a0806ef42bab0baf0595e5dc24e70972dfa0081234f7190
"use client";

import { useConnection } from "@/components/connection/connection-context";
import { OpenNodeTabButton } from "@/components/node-tab/open-node-tab-button";
import { showSettingsDialog } from "@/components/settings/settings-dialog";
import { ThemedSyntaxHighlighter } from "@/components/shared/themed-syntax-highlighter";
import { OpenDatabaseTabButton } from "@/components/table-tab/open-database-tab-button";
import { OpenTableTabButton } from "@/components/table-tab/open-table-tab-button";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import katex from "katex";
import { memo, useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { FileLink } from "./file-link";
import { MessageMarkdownChartSpec } from "./message-markdown-chat";
import { escapeTextUnderscores, normalizeMathMarkdown } from "./message-markdown-math";
import { MessageMarkdownSql } from "./message-markdown-sql";
import { MessageMarkdownVizlayer } from "./message-markdown-vizlayer";
import { remarkExtensions } from "./remark-extensions";


function transformMarkdownUrl(url: string) {
  if (url.startsWith("skill://")) {
    return url;
  }
  if (url.startsWith("codefile://")) {
    return url;
  }

  return defaultUrlTransform(url);
}

/**
 * Render text message with markdown support
 */
interface MessageMarkdownProps {
  text: string;
  messageId?: string;
  customStyle?: React.CSSProperties;
  showExecuteButton?: boolean;
  /**
   * Allow expandable SQL blocks inside markdown. Default: false.
   */
  expandable?: boolean;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  customStyle,
  showExecuteButton = true,
  expandable = false,
}: MessageMarkdownProps) {
  const { connection } = useConnection();
  const normalizedText = useMemo(() => normalizeMathMarkdown(text), [text]);

  const codeBlockStyle = useMemo<React.CSSProperties>(
    () => ({
      margin: "0rem",
      padding: "0rem",
      fontSize: "0.85rem",
      ...customStyle,
    }),
    [customStyle]
  );

  // Use refs to store stable references to metadata maps to avoid infinite loops
  // The connection object may be mutated, but we only care about the map references
  const tableNamesRef = useRef(connection?.metadata?.tableNames);
  const databaseNamesRef = useRef(connection?.metadata?.databaseNames);
  const nodeNamesRef = useRef(connection?.metadata?.hostNames);

  // Update refs when connection metadata changes
  useEffect(() => {
    tableNamesRef.current = connection?.metadata?.tableNames;
    databaseNamesRef.current = connection?.metadata?.databaseNames;
    nodeNamesRef.current = connection?.metadata?.hostNames;
  }, [
    connection?.metadata?.tableNames,
    connection?.metadata?.databaseNames,
    connection?.metadata?.hostNames,
  ]);

  const components = useMemo<Components>(
    () => ({
      code: ({ className: codeClassName, children, ...props }: React.ComponentProps<"code">) => {
        const classNameStr = typeof codeClassName === "string" ? codeClassName : "";

        // Handle KaTeX math: remark-math produces code elements with language-math
        if (classNameStr.includes("language-math")) {
          const isDisplay = classNameStr.includes("math-display");
          const raw = String(children).replace(/\n$/, "");
          const processed = escapeTextUnderscores(raw);
          let html: string;
          try {
            html = katex.renderToString(processed, {
              throwOnError: false,
              displayMode: isDisplay,
              strict: false,
            });
          } catch {
            // Fallback: render raw as error span via KaTeX (should not happen with throwOnError false)
            try {
              html = katex.renderToString(raw, {
                throwOnError: false,
                displayMode: isDisplay,
              });
            } catch {
              html = `<span>${raw}</span>`;
            }
          }

          if (isDisplay) {
            return (
              <div
                className="my-2 overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }

          return <span dangerouslySetInnerHTML={{ __html: html }} />;
        }

        if (codeClassName === "language-sql" || codeClassName === "language-clickhouse") {
          return (
            <MessageMarkdownSql
              code={String(children).replace(/\n$/, "")}
              language="sql"
              customStyle={customStyle}
              showExecuteButton={showExecuteButton}
              showLineNumbers={false}
              expandable={expandable}
            />
          );
        }

        if (codeClassName === "language-chart-spec") {
          return <MessageMarkdownChartSpec spec={String(children)} />;
        }
        if (codeClassName === "language-vizlayer") {
          return <MessageMarkdownVizlayer spec={String(children)} />;
        }

        const languageMatch = codeClassName?.match(/language-([^\s]+)/);
        if (languageMatch?.[1] && languageMatch[1] !== "mermaid") {
          return (
            <ThemedSyntaxHighlighter
              language={languageMatch[1]}
              customStyle={codeBlockStyle}
              wrapLongLines={true}
            >
              {String(children).replace(/\n$/, "")}
            </ThemedSyntaxHighlighter>
          );
        }

        // Check if inline code is a table name or database name
        const isInline = !codeClassName || !codeClassName.includes("language-");
        if (isInline) {
          const codeText = String(children).trim();

          // First check if it's a table name
          const tableNames = tableNamesRef.current;
          if (tableNames && codeText) {
            const tableInfo = tableNames.get(codeText);
            if (tableInfo) {
              return (
                <OpenTableTabButton
                  database={tableInfo.database}
                  table={tableInfo.table}
                  showDatabase={true}
                  variant="link"
                  className="underline decoration-dotted underline-offset-2 font-normal text-sm gap-1"
                  showLinkIcon={true}
                  // Use a large number to make sure name is completely displayed
                  maxLength={4096}
                />
              );
            }
          }

          // Then check if it's a database name
          const databaseNames = databaseNamesRef.current;
          if (databaseNames && codeText) {
            const databaseInfo = databaseNames.get(codeText);
            if (databaseInfo) {
              return (
                <OpenDatabaseTabButton
                  database={databaseInfo.name}
                  variant="link"
                  className="underline decoration-dotted underline-offset-2 font-normal text-sm"
                  showLinkIcon={true}
                  // Use a large number to make sure name is completely displayed
                  maxLength={512}
                />
              );
            }
          }

          const nodeNames = nodeNamesRef.current;
          if (nodeNames && codeText) {
            if (nodeNames.has(codeText)) {
              return (
                <OpenNodeTabButton
                  host={codeText}
                  className="underline decoration-dotted underline-offset-2 font-normal text-sm"
                  showLinkIcon={true}
                  maxLength={512}
                />
              );
            }
          }
        }

        return (
          <code
            className={cn(
              "bg-muted/30 rounded px-1 py-0.5 text-[0.8em] font-mono whitespace-pre-wrap break-all",
              codeClassName
            )}
            {...props}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
        // If pre contains math display, avoid wrapping it in <pre>
        // Check children for math-display
        // children could be a React element (code) or array
        const checkIsMathDisplay = (child: unknown): boolean => {
          if (!child || typeof child !== "object") return false;
          const c = child as { props?: { className?: string; children?: unknown } };
          if (c.props?.className && typeof c.props.className === "string") {
            if (c.props.className.includes("language-math") && c.props.className.includes("math-display")) {
              return true;
            }
          }
          // If child is result of our code component that already rendered div, it won't have that className
          // So check if it's a div with katex? Our code component returns div for display, which would be inside pre.
          // In that case we still want to unwrap.
          // We can check if the child type is string? Simpler: if child is element and its props include dangerouslySetInnerHTML containing katex-display
          return false;
        };

        // For simplicity, if any child looks like math display (via our earlier logic, the code component would have already returned a div, not code),
        // we still want to render without <pre> wrapper.
        // We'll inspect children: if it's a single child that is a div with overflow-x-auto (our display wrapper), unwrap.
        // This is a bit heuristic, but we can just check if children is an element whose type is 'div' or if it's a custom element.

        // If pre contains a div (our KaTeX display) or span (inline math that somehow ended up in pre?), unwrap
        // The safest: if the child is not a string but an element, return fragment
        const childArray = Array.isArray(children) ? children : [children];
        for (const ch of childArray) {
          if (typeof ch === "object" && ch !== null && "props" in (ch as object)) {
            const p = (ch as { props?: { className?: string } }).props;
            if (p?.className && p.className.includes("language-math")) {
              return <>{children}</>;
            }
          }
        }

        // Also check if children is a div produced by our code component (has my-2 overflow-x-auto)
        // In that case, the code component already returned div, and pre currently wraps it.
        // We can unwrap to avoid <pre><div> structure.
        for (const ch of childArray) {
          if (typeof ch === "object" && ch !== null && "props" in (ch as object)) {
            const props = (ch as { props?: { className?: string; dangerouslySetInnerHTML?: { __html: string } } }).props;
            if (props?.dangerouslySetInnerHTML?.__html?.includes("katex")) {
              return <>{children}</>;
            }
          }
        }

        return <pre className="my-2 overflow-x-auto rounded bg-muted/30 p-2 text-[0.85em]">{children}</pre>;
      },
      a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (href?.startsWith("skill://")) {
          const skillId = href.replace("skill://", "");
          const trigger = (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 rounded-sm px-1.5 font-mono text-primary text-xs bg-accent text-accent-foreground"
              onClick={() => {
                showSettingsDialog({
                  initialSection: "skills",
                  initialSkillId: skillId,
                });
              }}
            >
              {children}
            </Button>
          );

          if (!props.title) {
            return trigger;
          }

          return (
            <HoverCard openDelay={150} closeDelay={100}>
              <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
              <HoverCardContent
                side="bottom"
                align="start"
                className="w-80 break-words p-2 text-sm leading-relaxed"
              >
                {props.title}
              </HoverCardContent>
            </HoverCard>
          );
        }

        if (href?.startsWith("codefile://")) {
          const parsed = new URL(href);
          const filePath = parsed.searchParams.get("path") ?? "";
          const viewerUrl = FileLink.toViewerUrl(href);

          return (
            <a
              href={viewerUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={filePath}
              className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-primary transition-colors hover:underline underline-offset-4"
              {...props}
            >
              <span className="truncate">{children}</span>
            </a>
          );
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline underline-offset-4"
            {...props}
          >
            {children}
          </a>
        );
      },
      ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
        <ul className="list-disc pl-4 mb-2 space-y-1" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }: React.OlHTMLAttributes<HTMLOListElement>) => (
        <ol className="list-decimal pl-4 mb-2 space-y-1" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
        <li className="mb-0.5" {...props}>
          {children}
        </li>
      ),
      p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className="mb-1 last:mb-0 leading-relaxed" {...props}>
          {children}
        </p>
      ),
      table: ({ children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
        <div className="my-2 overflow-x-auto border rounded-sm">
          <table className="w-full border-collapse text-sm" {...props}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <thead className="bg-muted/50 border-b" {...props}>
          {children}
        </thead>
      ),
      tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <tbody className="divide-y divide-border" {...props}>
          {children}
        </tbody>
      ),
      tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
        <tr className="hover:bg-muted/30 transition-colors" {...props}>
          {children}
        </tr>
      ),
      th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableHeaderCellElement>) => (
        <th
          className="px-4 py-2 text-left font-bold text-muted-foreground border-r last:border-r-0"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableDataCellElement>) => (
        <td className="px-4 py-2 border-r last:border-r-0" {...props}>
          {children}
        </td>
      ),
      h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 className="text-2xl font-semibold" {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className="text-xl font-semibold" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className="text-lg font-semibold" {...props}>
          {children}
        </h3>
      ),
      h4: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h4 className="text-base font-semibold" {...props}>
          {children}
        </h4>
      ),
      h5: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h5 className="text-sm font-semibold" {...props}>
          {children}
        </h5>
      ),
      h6: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h6 className="text-sm font-semibold" {...props}>
          {children}
        </h6>
      ),
    }),
    [codeBlockStyle, customStyle, expandable, showExecuteButton]
  );

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm relative">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm, remarkExtensions]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
});
