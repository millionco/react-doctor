import { highlighter } from "@react-doctor/core";

const CODE_TOKEN_PATTERN =
  /\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|with|yield)\b|\b(?:0[xob][\da-f]+|\d+(?:\.\d+)?)\b/giu;

export const highlightCodeLine = (codeLine: string): string =>
  codeLine.replace(CODE_TOKEN_PATTERN, (token) => {
    if (token.startsWith("/")) return highlighter.gray(token);
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      return highlighter.success(token);
    }
    if (/^\d|^0[xob]/i.test(token)) return highlighter.warn(token);
    return highlighter.info(token);
  });
