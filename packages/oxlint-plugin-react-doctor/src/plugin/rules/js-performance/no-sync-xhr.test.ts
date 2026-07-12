import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSyncXhr } from "./no-sync-xhr.js";

describe("no-sync-xhr", () => {
  it("flags `xhr.open(method, url, false)`", () => {
    const result = runRule(
      noSyncXhr,
      `const xhr = new XMLHttpRequest(); xhr.open("GET", "/api", false);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("synchronous");
  });

  it("does not flag an async open (third arg true)", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", "/api", true);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an open with no async argument (defaults to async)", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", "/api");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-open method with a false argument", () => {
    const result = runRule(noSyncXhr, `widget.toggle("a", "b", false);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic async flag", () => {
    const result = runRule(noSyncXhr, `xhr.open("GET", url, isSync);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unrelated typed open method", () => {
    const result = runRule(
      noSyncXhr,
      `interface Archive { open(mode: string, path: string, createIfMissing: boolean): void; }
       const openArchive = (archive: Archive) => archive.open("read", "/documents.zip", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags typed XMLHttpRequest parameters and nullable unions", () => {
    const result = runRule(
      noSyncXhr,
      `const load = (first: XMLHttpRequest, second: XMLHttpRequest | null) => {
         first.open("GET", "/one", false);
         second?.open("GET", "/two", false);
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("follows direct and multi-hop XMLHttpRequest value aliases", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const firstAlias = request;
       const secondAlias = firstAlias;
       secondAlias.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows aliases of global and window XMLHttpRequest constructors", () => {
    const result = runRule(
      noSyncXhr,
      `const GlobalRequest = XMLHttpRequest;
       const WindowRequest = window.XMLHttpRequest;
       new GlobalRequest().open("GET", "/one", false);
       new WindowRequest().open("GET", "/two", false);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust shadowed XMLHttpRequest constructor or type names", () => {
    const result = runRule(
      noSyncXhr,
      `class XMLHttpRequest {
         open(mode: string, path: string, createIfMissing: boolean) {}
       }
       const request = new XMLHttpRequest();
       request.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust unresolved or mutable aliases", () => {
    const result = runRule(
      noSyncXhr,
      `let request = new XMLHttpRequest();
       request = archive;
       request.open("read", "/archive", false);
       unknown.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report after the XMLHttpRequest open method is replaced", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       request.open = ((...args: unknown[]) => {}) as XMLHttpRequest["open"];
       request.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows aliases when checking for open method replacement", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const alias = request;
       alias.open = ((...args: unknown[]) => {}) as XMLHttpRequest["open"];
       request.open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports when the open method is replaced only after the synchronous call", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       request.open("GET", "/api", false);
       request.open = ((...args: unknown[]) => {}) as XMLHttpRequest["open"];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports XMLHttpRequest type assertions and asserted initializers", () => {
    const result = runRule(
      noSyncXhr,
      `(getRequest() as XMLHttpRequest).open("GET", "/one", false);
       const request = getRequest() satisfies XMLHttpRequest;
       request.open("GET", "/two", false);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports destructured XMLHttpRequest parameters", () => {
    const result = runRule(
      noSyncXhr,
      `const load = ({ request }: { request: XMLHttpRequest }) => {
         request.open("GET", "/api", false);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports XMLHttpRequest class fields by initializer and annotation", () => {
    const result = runRule(
      noSyncXhr,
      `class Loader {
         first = new XMLHttpRequest();
         second: XMLHttpRequest;
         load() {
           this.first.open("GET", "/one", false);
           this.second.open("GET", "/two", false);
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports same-file factories that return XMLHttpRequest instances", () => {
    const result = runRule(
      noSyncXhr,
      `const createRequest = () => new XMLHttpRequest();
       function makeRequest() { return createRequest(); }
       makeRequest().open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not prove a mixed-return XMLHttpRequest factory", () => {
    const result = runRule(
      noSyncXhr,
      `class Archive { open() {} }
       const makeRequest = (useXhr: boolean) => useXhr ? new XMLHttpRequest() : new Archive();
       makeRequest(false).open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("proves a factory only when every return is XMLHttpRequest", () => {
    const result = runRule(
      noSyncXhr,
      `const makeRequest = (useFirst: boolean) => useFirst
         ? new XMLHttpRequest()
         : new window.XMLHttpRequest();
       makeRequest(false).open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent after an XMLHttpRequest class field is reassigned", () => {
    const result = runRule(
      noSyncXhr,
      `class Archive { open() {} }
       class Loader {
         request = new XMLHttpRequest();
         load() {
           this.request = new Archive();
           this.request.open("read", "/archive", false);
         }
       }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when an XMLHttpRequest class field is reassigned only after opening", () => {
    const result = runRule(
      noSyncXhr,
      `class Archive { open() {} }
       class Loader {
         request = new XMLHttpRequest();
         load() {
           this.request.open("GET", "/api", false);
           this.request = new Archive();
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not bind nested ordinary-function this to the outer loader", () => {
    const result = runRule(
      noSyncXhr,
      `class Loader {
         request = new XMLHttpRequest();
         load() {
           function run() { this.request.open("read", "/archive", false); }
           run.call({ request: { open() {} } });
         }
       }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still binds arrow-function this to the outer loader", () => {
    const result = runRule(
      noSyncXhr,
      `class Loader {
         request = new XMLHttpRequest();
         load() {
           const run = () => this.request.open("GET", "/api", false);
           run();
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when open is replaced before a declared function runs", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       function run() { request.open("GET", "/api", false); }
       request.open = customOpen;
       run();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports when open is replaced only after a declared function runs", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       function run() { request.open("GET", "/api", false); }
       run();
       request.open = customOpen;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows synchronous helpers that replace open", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const replace = () => { request.open = customOpen; };
       replace();
       request.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows helper parameters through mutations and opaque multi-hop escapes", () => {
    const directMutation = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const patch = (receiver) => { receiver.open = customOpen; };
       patch(request);
       request.open("GET", "/api", false);`,
    );
    const opaqueEscape = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const second = (receiver) => external(receiver);
       const first = (receiver) => second(receiver);
       first(request);
       request.open("GET", "/api", false);`,
    );
    expect(directMutation.diagnostics).toEqual([]);
    expect(opaqueEscape.diagnostics).toEqual([]);
  });

  it("does not overflow on recursive helper invocation", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const run = () => {
         request.open("GET", "/api", false);
         if (more) run();
       };
       request.open = customOpen;
       run();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent after an opaque receiver escape", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       customize(request);
       request.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows receiver escapes through aliases and containers", () => {
    const result = runRule(
      noSyncXhr,
      `const first = new XMLHttpRequest();
       const firstAlias = first;
       customize(firstAlias);
       first.open("GET", "/one", false);

       const second = new XMLHttpRequest();
       customize({ second });
       second.open("GET", "/two", false);

       const third = new XMLHttpRequest();
       const registry = {};
       registry.request = third;
       customize(registry);
       third.open("GET", "/three", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat derived receiver properties as receiver escapes", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       inspect(request.responseURL);
       request.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports after a non-dominating conditional open replacement", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       if (replaceOpen) request.open = customOpen;
       request.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent after XMLHttpRequest prototype replacement", () => {
    const result = runRule(
      noSyncXhr,
      `XMLHttpRequest.prototype.open = customOpen;
       const request = new XMLHttpRequest();
       request.open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent after prototype replacement on an immediate receiver", () => {
    const result = runRule(
      noSyncXhr,
      `XMLHttpRequest.prototype.open = customOpen;
       new XMLHttpRequest().open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a double assertion through unknown", () => {
    const result = runRule(
      noSyncXhr,
      `class Archive { open() {} }
       (new Archive() as unknown as XMLHttpRequest).open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust an asserted userland construction", () => {
    const result = runRule(
      noSyncXhr,
      `class Archive { open() {} }
       (new Archive() as XMLHttpRequest).open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust asserted object literals or const userland initializers", () => {
    const result = runRule(
      noSyncXhr,
      `const archive = { open() {} };
       (archive as XMLHttpRequest).open("read", "/archive", false);
       ({ open() {} } as XMLHttpRequest).open("read", "/archive", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust assertions on mutable bindings, parameters, or members", () => {
    const result = runRule(
      noSyncXhr,
      `let mutableRequest = archive;
       (mutableRequest as XMLHttpRequest).open("read", "/one", false);
       const load = (request) => {
         (request as XMLHttpRequest).open("read", "/two", false);
       };
       (holder.request as XMLHttpRequest).open("read", "/three", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust assertions laundered through const aliases", () => {
    const result = runRule(
      noSyncXhr,
      `const load = (source) => {
         const request = source;
         (request as XMLHttpRequest).open("read", "/archive", false);
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps constructed receivers proven through asserted const aliases", () => {
    const result = runRule(
      noSyncXhr,
      `const source = new XMLHttpRequest();
       const request = source;
       (request as XMLHttpRequest).open("GET", "/api", false);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps typed parameters proven through redundant assertions", () => {
    const result = runRule(
      noSyncXhr,
      `const load = (request: XMLHttpRequest) => {
         (request as XMLHttpRequest).open("GET", "/api", false);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not prove reassigned receiver factories", () => {
    const result = runRule(
      noSyncXhr,
      `let make = () => new XMLHttpRequest();
       make = () => archive;
       make().open("GET", "/", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes method mutations on factory return values", () => {
    const result = runRule(
      noSyncXhr,
      `const make = () => {
         const request = new XMLHttpRequest();
         request.open = customOpen;
         return request;
       };
       make().open("GET", "/", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes mutations across sibling helpers, branches, and constructors", () => {
    const result = runRule(
      noSyncXhr,
      `const first = new XMLHttpRequest();
       function patch() { first.open = customOpen; }
       function attach() { first.open("GET", "/one", false); }
       function setup() { patch(); attach(); }
       setup();

       const second = new XMLHttpRequest();
       if (condition) second.open = firstOpen;
       else second.open = secondOpen;
       second.open("GET", "/two", false);

       class View {
         request = new XMLHttpRequest();
         constructor() { this.request.open = customOpen; }
         run() { this.request.open("GET", "/three", false); }
       }
       new View().run();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes Reflect prototype replacement", () => {
    const result = runRule(
      noSyncXhr,
      `Reflect.defineProperty(XMLHttpRequest.prototype, "open", { value: customOpen });
       const request = new XMLHttpRequest();
       request.open("GET", "/", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("retains findings after proven native receiver replacement", () => {
    const result = runRule(
      noSyncXhr,
      `let first: XMLHttpRequest = new XMLHttpRequest();
       first = first;
       first.open("GET", "/one", false);
       let second: XMLHttpRequest = new XMLHttpRequest();
       second = new XMLHttpRequest();
       second.open("GET", "/two", false);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes factory receiver escapes and defineProperty mutations", () => {
    const opaqueEscape = runRule(
      noSyncXhr,
      `const make = () => {
         const request = new XMLHttpRequest();
         customize(request);
         return request;
       };
       make().open("GET", "/", false);`,
    );
    const definedMethod = runRule(
      noSyncXhr,
      `const make = () => {
         const request = new XMLHttpRequest();
         Reflect.defineProperty(request, "open", { value: customOpen });
         return request;
       };
       make().open("GET", "/", false);`,
    );
    expect(opaqueEscape.diagnostics).toEqual([]);
    expect(definedMethod.diagnostics).toEqual([]);
  });

  it("follows receiver escapes through identity-return helpers", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const identity = (value) => value;
       const alias = identity(request);
       customize(alias);
       request.open("GET", "/", false);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes mutations before mutually recursive helper calls", () => {
    const result = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       function first() {
         request.open = customOpen;
         second();
       }
       function second() {
         request.open("GET", "/", false);
         if (more) first();
       }
       first();`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("follows receiver escapes through object spreads", () => {
    const inline = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       customize({ ...request });
       request.open("GET", "/one", false);`,
    );
    const aliased = runRule(
      noSyncXhr,
      `const request = new XMLHttpRequest();
       const box = { ...request };
       customize(box);
       request.open("GET", "/two", false);`,
    );
    expect(inline.diagnostics).toEqual([]);
    expect(aliased.diagnostics).toEqual([]);
  });
});
