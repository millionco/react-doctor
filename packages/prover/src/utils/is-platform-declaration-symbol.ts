import type ts from "typescript";

export const isPlatformDeclarationSymbol = (symbol: ts.Symbol | null): boolean =>
  Boolean(
    symbol?.declarations?.length &&
    symbol.declarations.every((declaration) => {
      const sourceFileName = declaration.getSourceFile().fileName.replaceAll("\\", "/");
      return (
        sourceFileName.includes("/typescript/lib/lib.") ||
        sourceFileName.includes("/node_modules/@types/node/")
      );
    }),
  );
