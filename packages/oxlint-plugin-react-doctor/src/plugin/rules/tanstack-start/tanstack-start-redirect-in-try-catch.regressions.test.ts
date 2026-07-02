import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartRedirectInTryCatch } from "./tanstack-start-redirect-in-try-catch.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-redirect-in-try-catch — regressions", () => {
  it("stays silent when the catch re-throws via an isRedirect guard", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `export const Route = createFileRoute('/dashboard')({ beforeLoad: async () => { try { const user = await getUser(); if (!user) throw redirect({ to: '/login' }); return { user }; } catch (error) { if (isRedirect(error)) throw error; throw new Error('Failed to load user'); } } });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the catch bare re-throws the caught binding", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { throw redirect({ to: '/x' }); } catch (e) { throw e; } }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the throw runs in a deferred setTimeout callback", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `function load() { try { setTimeout(() => { throw redirect({ to: '/login' }); }, 1000); } catch (e) { console.log(e); } }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a catch that logs and swallows the redirect", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { throw redirect({ to: '/login' }); } catch (error) { console.error(error); return null; } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: an isRedirect() guard with NO rethrow still swallows the redirect —
  // only an actual `throw error` forwards it.
  it("still flags a catch that checks isRedirect but only logs (no rethrow)", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { throw redirect({ to: '/login' }); } catch (error) { if (isRedirect(error)) { console.error('redirecting'); } return null; } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a bare try/finally has no catch, so nothing swallows the redirect —
  // the finalizer runs and the router error propagates.
  it("stays silent for a throw inside try/finally with no catch", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { throw redirect({ to: '/login' }); } finally { cleanup(); } }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent for a throw inside a finally clause", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { await work(); } catch (error) { console.error(error); } finally { throw redirect({ to: '/login' }); } }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a nested try whose inner catch rethrows into an outer swallowing catch", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { try { throw redirect({ to: '/done' }); } catch (e) { throw e; } } catch (outer) { console.error(outer); } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a nested try when every catch on the path rethrows", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { try { throw redirect({ to: '/done' }); } catch (e) { throw e; } } catch (outer) { throw outer; } }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a throw redirect inside an IIFE invoked within the try block", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `function load() { try { (() => { throw redirect({ to: '/login' }); })(); } catch (e) { console.log(e); } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when the catch's rethrow is swallowed by a nested try/catch", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { throw redirect({ to: '/done' }); } catch (e) { try { throw e; } catch (inner) { console.error(inner); } } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a try/finally nested inside an outer swallowing try/catch", () => {
    const { diagnostics } = runRule(
      tanstackStartRedirectInTryCatch,
      `async function load() { try { try { throw redirect({ to: '/login' }); } finally { cleanup(); } } catch (error) { console.error(error); } }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
