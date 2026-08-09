// rule: dangerous-html-sink
// file-path: src/components/chat/message/message-markdown.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b9a3bd477bfcaf071e70b13b8fcb36c3455fb860425b10ddf723b5fb4dae7ae9
import { useConnection } from "@/components/connection/connection-context";
import { OpenNodeTabButton } from "@/components/node-tab/open-node-tab-button";
import { showSettingsDialog } from "@/components/settings/settings-dialog";
import { ThemedSyntaxHighlighter } from "@/components/shared/themed-syntax-highlighter";
import { OpenDatabaseTabButton } from "@/components/table-tab/open-database-tab-button";
import { OpenTableTabButton } from "@/components/table-tab/open-table-tab-button";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { memo, useEffect, useMemo, useRef } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { FileLink } from "./file-link";
import { MessageMarkdownChartSpec } from "./message-markdown-chat";
import { normalizeMathMarkdown, renderMathMarkdown } from "./message-markdown-math";
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

function getDisplayMathExpression(node: ExtraProps["node"]) {
  if (node?.children.length !== 1) {
    return null;
  }

  const codeNode = node.children[0];
  if (codeNode.type !== "element" || codeNode.tagName !== "code") {
    return null;
  }

  const className = codeNode.properties.className;
  const classNames = Array.isArray(className)
    ? className.map(String)
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];

  if (!classNames.includes("math-display") || codeNode.children.length !== 1) {
    return null;
  }

  const textNode = codeNode.children[0];
  return textNode.type === "text" ? textNode.value : null;
}

function usesDisplayDollarDelimiter(node: ExtraProps["node"], source: string) {
  const startOffset = node?.position?.start.offset;
  return typeof startOffset === "number" && source.startsWith("$$", startOffset);
}

interface MessageMarkdownMathProps {
  value: string;
  displayMode: boolean;
}

const MessageMarkdownMath = memo(function MessageMarkdownMath({
  value,
  displayMode,
}: MessageMarkdownMathProps) {
  const renderedMath = useMemo(() => renderMathMarkdown(value, displayMode), [displayMode, value]);

  return (
    <span
      className={renderedMath.displayMode ? "block max-w-full overflow-x-auto" : undefined}
      dangerouslySetInnerHTML={{ __html: renderedMath.html }}
    />
  );
});

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
      pre: ({ node, children, ...props }: React.ComponentProps<"pre"> & ExtraProps) => {
        const mathExpression = getDisplayMathExpression(node);
        if (mathExpression !== null) {
          return <MessageMarkdownMath value={mathExpression} displayMode={true} />;
        }

        return <pre {...props}>{children}</pre>;
      },
      code: ({
        className: codeClassName,
        children,
        node,
        ...props
      }: React.ComponentProps<"code"> & ExtraProps) => {
        if (codeClassName?.split(/\s+/).includes("math-inline")) {
          return (
            <MessageMarkdownMath
              value={String(children)}
              displayMode={usesDisplayDollarDelimiter(node, normalizedText)}
            />
          );
        }

        if (codeClassName?.split(/\s+/).includes("math-display")) {
          return <MessageMarkdownMath value={String(children)} displayMode={true} />;
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
    [codeBlockStyle, customStyle, expandable, normalizedText, showExecuteButton]
  );

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm relative">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkExtensions]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
});
