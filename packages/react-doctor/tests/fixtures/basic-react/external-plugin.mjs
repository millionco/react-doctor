export default {
  meta: {
    name: "test-external-plugin",
  },
  rules: {
    "no-local-storage-set-item": {
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee?.type !== "MemberExpression") return;
            if (node.callee.object?.type !== "Identifier") return;
            if (node.callee.object.name !== "localStorage") return;
            if (node.callee.property?.type !== "Identifier") return;
            if (node.callee.property.name !== "setItem") return;
            context.report({
              node,
              message: "Avoid localStorage.setItem in tests",
            });
          },
        };
      },
    },
  },
};
