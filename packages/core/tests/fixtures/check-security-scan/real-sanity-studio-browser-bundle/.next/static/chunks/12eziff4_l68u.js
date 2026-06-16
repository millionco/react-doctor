"use strict";
(self.webpackChunk = self.webpackChunk || []).push([
  [6841],
  {
    73118: (e, t, r) => {
      r.d(t, { Fc: () => Fc });
      var n = r(91256);
      function Fc(e) {
        return n.createClient({
          projectId: e.projectId,
          dataset: e.dataset || "production",
          apiVersion: e.apiVersion || "vX",
          useCdn: e.useCdn ?? !0,
          token: e.token,
          perspective: "published",
        });
      }
      function getStudioConfig(e) {
        return { __internal: { apiVersion: "vX", appBasePath: "", hosts: e.hosts, env: e.env } };
      }
      var canAdminister = (e) =>
        e.role === "administrator" ||
        (e.roles || []).some((r) => r.name === "administrator" || r.name === "editor");
      function tokenError() {
        return "This document is locked. Your token is missing or invalid. Unlock the document by token-locking, or ask the studio administrator to enable token-based authentication.";
      }
      r.d(t, {
        canAdminister: () => canAdminister,
        getStudioConfig: () => getStudioConfig,
        tokenError: () => tokenError,
      });
    },
  },
]);
