import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

describe("TanStack file-route component hook scopes", () => {
  it.each([
    {
      name: "canonical-route-members",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; export const Route=createFileRoute("/demo")({component:()=>{const params=Route.useParams();const search=Route.useSearch();return <div>{params.id}{search.q}</div>;}});',
      expected: 0,
    },
    {
      name: "renamed-canonical-factory",
      source:
        'import {createFileRoute as defineFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=defineFileRoute("/demo")({component:()=>{useState(0);return null;}});',
      expected: 0,
    },
    {
      name: "conditional-hook",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{if(enabled)useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "early-return-hook",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{if(!enabled)return null;useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "loop-hook",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{for(const value of values){useState(value);}return null;}});',
      expected: 1,
    },
    {
      name: "try-hook",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{try{useState(0);}catch{}return null;}});',
      expected: 1,
    },
    {
      name: "async-component",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:async()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "nested-callback",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{items.map(()=>{useState(0);return null;});return null;}});',
      expected: 1,
    },
    {
      name: "loader-role",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({loader:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "event-role",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nexport const Route=createFileRoute("/demo")({component:()=>{return <button onClick={()=>{useState(0);}}>Go</button>;}});',
      expected: 1,
    },
    {
      name: "shadowed-factory",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\nfunction register(createFileRoute){return createFileRoute("/demo")({component:()=>{useState(0);return null;}});}',
      expected: 1,
    },
    {
      name: "replaced-import",
      source:
        'import { createFileRoute } from "@tanstack/react-router"; import { useState } from "react";\ncreateFileRoute=replacement;export const Route=createFileRoute("/demo")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "ordinary validation option",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=createFileRoute("/sample")({validateSearch:validate,component:()=>{useState(0);return null;}});',
      expected: 0,
    },
    {
      name: "ordinary function component",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=createFileRoute("/sample")({component:function(){useState(0);return null;}});',
      expected: 0,
    },
    {
      name: "lowercase named function component",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=createFileRoute("/sample")({component:function view(){useState(0);return null;}});',
      expected: 0,
    },
    {
      name: "transparent component annotation",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=createFileRoute("/sample")({component:(()=>{useState(0);return null;}) satisfies (()=>unknown)});',
      expected: 0,
    },
    {
      name: "multiple independent route calls",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const First=createFileRoute("/one")({component:()=>{useState(0);return null;}});export const Second=createFileRoute("/two")({component:()=>{useState(0);return null;}});',
      expected: 0,
    },
    {
      name: "ordinary uppercase component",
      source: 'import {useState} from "react";export const Panel=()=>{useState(0);return null;};',
      expected: 0,
    },
    {
      name: "sibling loader still illegal",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; export const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;},loader:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "wrong module",
      source:
        'import {createFileRoute} from "./route-factory";import {useState} from "react";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "same-name local factory",
      source:
        'import {useState} from "react";const createFileRoute=path=>options=>options;const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "wrong named export",
      source:
        'import {createRoute as createFileRoute} from "@tanstack/react-router";import {useState} from "react";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "namespace factory",
      source:
        'import * as Router from "@tanstack/react-router";import {useState} from "react";const Route=Router.createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "default factory",
      source:
        'import createFileRoute from "@tanstack/react-router";import {useState} from "react";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "type-only declaration",
      source:
        'import type {createFileRoute} from "@tanstack/react-router";import {useState} from "react";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "type-only specifier",
      source:
        'import {type createFileRoute} from "@tanstack/react-router";import {useState} from "react";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "local factory alias",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const defineRoute=createFileRoute;const Route=defineRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "pattern replacement",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; ({createFileRoute}=providers);const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "loop replacement",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; for(createFileRoute of replacements){}const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "opaque factory escape",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; install(createFileRoute);const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "factory metadata unsupported",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; createFileRoute.description="local";const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "factory callable projection unsupported",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const invoke=createFileRoute.call;const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "optional factory call",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute?.("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "optional options call",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")?.({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "extra factory argument",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample",extra)({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "extra options argument",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;}},extra);',
      expected: 1,
    },
    {
      name: "dynamic route path",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute(path)({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "spread route path",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute(...paths)({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "options spread",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({...options,component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "computed option key",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({[key]:value,component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "duplicate component option",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({component:()=>{useState(0);return null;},component:()=>null});',
      expected: 1,
    },
    {
      name: "accessor option",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({get loader(){return load;},component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "method option",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({loader(){return null;},component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "component method",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({component(){useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "options alias",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const options={component:()=>{useState(0);return null;}};const Route=createFileRoute("/sample")(options);',
      expected: 1,
    },
    {
      name: "function alias",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const view=()=>{useState(0);return null;};const Route=createFileRoute("/sample")({component:view});',
      expected: 1,
    },
    {
      name: "unregistered component key",
      source:
        'import {useState} from "react";const options={component:()=>{useState(0);return null;}};consume(options);',
      expected: 1,
    },
    {
      name: "arbitrary factory",
      source:
        'import {useState} from "react";const Route=makeRoute("/sample")({component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "generator component",
      source:
        'import {createFileRoute} from "@tanstack/react-router"; import {useState} from "react"; const Route=createFileRoute("/sample")({component:function*(){useState(0);yield null;}});',
      expected: 1,
    },
    {
      name: "prototype options accessor",
      source:
        'import {createFileRoute} from "@tanstack/react-router";import {useState} from "react";const Route=createFileRoute("/sample")({__proto__:{get id(){this.component();return undefined;}},component:()=>{useState(0);return null;}});',
      expected: 1,
    },
    {
      name: "route component contains a genuine Markdown component",
      source:
        'import Markdown from "react-markdown";import {createFileRoute} from "@tanstack/react-router";import {useState} from "react";export const Route=createFileRoute("/demo")({component:()=>{useState(0);return <Markdown components={{count:()=>{useState(0);return <span/>;}}}/>;}});',
      expected: 0,
    },
    {
      name: "Markdown event inside route component remains invalid",
      source:
        'import Markdown from "react-markdown";import {createFileRoute} from "@tanstack/react-router";import {useState} from "react";export const Route=createFileRoute("/demo")({component:()=>{useState(0);return <Markdown components={{count:()=>{useState(0);return <button onClick={()=>useState(0)}>Go</button>;}}}/>;}});',
      expected: 1,
    },
    {
      name: "Markdown component contains a genuine route component",
      source:
        'import Markdown from "react-markdown";import {createFileRoute} from "@tanstack/react-router";import {useState} from "react";function View(){return <Markdown components={{count:()=>{useState(0);const Route=createFileRoute("/demo")({component:()=>{useState(0);return <span/>;}});return <span/>;}}}/>;}',
      expected: 0,
    },
    {
      name: "route nested callback inside Markdown component remains invalid",
      source:
        'import Markdown from "react-markdown";import {createFileRoute} from "@tanstack/react-router";import {useState} from "react";function View(){return <Markdown components={{count:()=>{useState(0);const Route=createFileRoute("/demo")({component:()=>{[1].map(()=>useState(0));return <span/>;}});return <span/>;}}}/>;}',
      expected: 1,
    },
  ])("$name", ({ source, expected }) => {
    const result = runRule(rulesOfHooks, source, { filename: "route.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
