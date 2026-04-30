import { BARREL_INDEX_SUFFIXES, HEAVY_LIBRARIES } from "../constants.js";
import { findJsxAttribute, hasJsxAttribute } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const noBarrelImport: Rule = {
  create: (context: RuleContext) => {
    let didReportForFile = false;

    return {
      ImportDeclaration(node: EsTreeNode) {
        if (didReportForFile) return;

        const source = node.source?.value;
        if (typeof source !== "string" || !source.startsWith(".")) return;

        if (BARREL_INDEX_SUFFIXES.some((suffix) => source.endsWith(suffix))) {
          didReportForFile = true;
          context.report({
            node,
            message:
              "Import from barrel/index file — import directly from the source module for better tree-shaking",
          });
        }
      },
    };
  },
};

export const noFullLodashImport: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (source === "lodash" || source === "lodash-es") {
        context.report({
          node,
          message: "Importing entire lodash library — import from 'lodash/functionName' instead",
        });
      }
    },
  }),
};

export const noMoment: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value === "moment") {
        context.report({
          node,
          message: 'moment.js is 300kb+ — use "date-fns" or "dayjs" instead',
        });
      }
    },
  }),
};

export const preferDynamicImport: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (typeof source === "string" && HEAVY_LIBRARIES.has(source)) {
        context.report({
          node,
          message: `"${source}" is a heavy library — use React.lazy() or next/dynamic for code splitting`,
        });
      }
    },
  }),
};

export const useLazyMotion: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (source !== "framer-motion" && source !== "motion/react") return;

      const hasFullMotionImport = node.specifiers?.some(
        (specifier: EsTreeNode) =>
          specifier.type === "ImportSpecifier" && specifier.imported?.name === "motion",
      );

      if (hasFullMotionImport) {
        context.report({
          node,
          message: 'Import "m" with LazyMotion instead of "motion" — saves ~30kb in bundle size',
        });
      }
    },
  }),
};

// HACK: bundlers can only tree-shake / split when the import target is a
// statically-analyzable string literal. `import(variable)` or
// `require(variable)` defeats trace targets and forces a fat bundle.
export const noDynamicImportPath: Rule = {
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNode) {
      const source = node.source;
      if (source && source.type !== "Literal" && source.type !== "TemplateLiteral") {
        context.report({
          node,
          message:
            "Dynamic import path is not statically analyzable — use a string literal so the bundler can split this chunk",
        });
        return;
      }
      if (source?.type === "TemplateLiteral" && (source.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "Template literal with interpolation in dynamic import — use a string literal so the bundler can split this chunk",
        });
      }
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return;
      const arg = node.arguments?.[0];
      if (!arg) return;
      if (arg.type !== "Literal" && arg.type !== "TemplateLiteral") {
        context.report({
          node,
          message:
            "Dynamic require() path is not statically analyzable — use a string literal so the bundler can trace this dependency",
        });
        return;
      }
      if (arg.type === "TemplateLiteral" && (arg.expressions?.length ?? 0) > 0) {
        context.report({
          node,
          message:
            "Template literal with interpolation in require() — use a string literal so the bundler can trace this dependency",
        });
      }
    },
  }),
};

export const noUndeferredThirdParty: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "script") return;
      const attributes = node.attributes ?? [];
      if (!findJsxAttribute(attributes, "src")) return;

      if (!hasJsxAttribute(attributes, "defer") && !hasJsxAttribute(attributes, "async")) {
        context.report({
          node,
          message:
            "Synchronous <script> with src — add defer or async to avoid blocking first paint",
        });
      }
    },
  }),
};
