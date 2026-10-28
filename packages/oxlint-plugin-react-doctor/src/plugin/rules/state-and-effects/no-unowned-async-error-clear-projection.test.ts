import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

describe("no-unowned-async-error-clear request projections", () => {
  it.each([
    {
      name: "readonly parameter member captured by zero-parameter async closure",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "identifier owner parameter and direct member projection",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = (props) => {
          const [failure, setFailure] = useState(null);
          const requestId = props.requestId;
          const submit = async () => {
            const result = await props.send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "one readonly parameter receiver alias",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const packet = payload;
          const requestId = packet.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "renamed scalar projection retains binding identity",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const submit = async () => {
            const result = await send({requestId: ticket});
            if (result.ok) setFailure(null);
            else setFailure({requestId: ticket, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "transparent receiver and projected value wrappers",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = ((payload)).requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "async useCallback closure captures owner projection",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = useCallback(async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          }, [send, requestId]);
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "direct parameter projection in async request and failure data",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const submit = async () => {
            const result = await send({requestId: payload.requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId: payload.requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "boolean activity state start and late stop",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [pending, setPending] = useState(false);
          const requestId = payload.requestId;
          const submit=async()=> {
            setPending(true);
            await send({requestId});
            setPending(false);
          };
          return <button onClick={submit}>{pending?'Busy':'Send'}</button>;
        };
      `,
    },
    {
      name: "legacy directly named request parameter",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({requestId, send}) => {
          const [failure, setFailure] = useState(null);
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "ownership mismatch exit before both completion writes",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const currentRequestIdRef=useRef(requestId);
          currentRequestIdRef.current=requestId;
          const submit = async () => {
            const sentRequestId=requestId;
            const result = await send({requestId});
            if (currentRequestIdRef.current !== sentRequestId) return;
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "ownership equality branch encloses completion writes",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const currentRequestIdRef=useRef(requestId);
          currentRequestIdRef.current=requestId;
          const submit = async () => {
            const sentRequestId=requestId;
            const result = await send({requestId});
            if (currentRequestIdRef.current === sentRequestId) { if (result.ok) setFailure(null);
              else setFailure({requestId, result});
            } };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "functional state update retains request ownership",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            setFailure(previous => previous?.requestId === requestId ? (result.ok ? null : {requestId, result}) : previous);
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "all visible owner uses keyed by identity",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
        export const Fixture=({payload,send})=><Panel key={payload.requestId} payload={payload} send={send}/>;
      `,
    },
    {
      name: "one keyed and one unkeyed owner use",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
        export const Fixture=({payload,send})=><Panel key={payload.requestId} payload={payload} send={send}/>;
        export const Other=({payload,send})=><Panel payload={payload} send={send}/>;
      `,
    },
    {
      name: "ambient local object is not owner parameter",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const payload={requestId:'local'};
        const Panel = ({send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "unused valid projection does not certify unrelated async state",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send();
            if (result.ok) setFailure(null);
            else setFailure(result);
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "projection only in unused nested function",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const unused=()=> {
            const requestId=payload.requestId;
            return requestId;
          };
          const submit = async () => {
            const result = await send();
            if (result.ok) setFailure(null);
            else setFailure(result);
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "inner shadowed payload is not owner parameter",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const submit = async () => {
            const payload={requestId:"inner"};
            const requestId=payload.requestId;
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "inner unrelated formal shadows owner receiver",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const submit = async (payload) => {
            const requestId=payload.requestId;
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "mutable receiver alias is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          let packet=payload;
          packet={requestId:"replacement"};
          const requestId=packet.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "mutable scalar alias is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          let requestId=payload.requestId;
          requestId="replacement";
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "unknown nested property projection is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.details.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "dynamic property projection is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload,send,field}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload[field];
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "opaque function-produced receiver is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload,send,getPacket}) => {
          const [failure, setFailure] = useState(null);
          const requestId = getPacket(payload).requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "one-hop alias declared inside unrelated scope is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const unused=()=> {
            const packet=payload;
            return packet.requestId;
          };
          const requestId="fixed";
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "preserves legacy defaulted request-shaped parameter admission",
      expectedCount: 1,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload={requestId:"fallback"},send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "same field without request meaning is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId=payload.color;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "same request-shaped local variable without projection is unsupported",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId="fixed";
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "foreign state provider is unsupported",
      expectedCount: 0,
      code: `
        import {useState} from 'foreign-state';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "locally shadowed state provider is unsupported",
      expectedCount: 0,
      code: `
        const useState=()=>[null,()=> {
        }];
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "namespace React state provider visibly replaced is unsupported",
      expectedCount: 0,
      code: `
        import * as Runtime from 'react';
        Runtime.useState=()=>[null,()=> {
        }];
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = Runtime.useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "ordinary imported React alias remains supported",
      expectedCount: 1,
      code: `
        import {useState as state} from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = state(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "no await has no stale completion boundary",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "failure-only completion has no clear",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "clear-only completion lacks failure ownership",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            setFailure(null);
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "unrelated awaited worker cannot lend identity to another closure",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          const [failure, setFailure] = useState(null);
          const requestId = payload.requestId;
          const worker=async()=> {
            await send({requestId});
          };
          const submit = async () => {
            const result = await send();
            if (result.ok) setFailure(null);
            else setFailure(result);
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "valid renamed identity ownership exit guard",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            if(activeIdRef.current!==ticket)return;
            if(result.ok)setFailure(null);
            else setFailure({requestId:ticket,result});
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "valid renamed identity and arbitrary ref name ownership exit guard",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const latest=useRef(ticket);
          latest.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            if(latest.current!==ticket)return;
            if(result.ok)setFailure(null);
            else setFailure({requestId:ticket,result});
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "opaque-predicate exit",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            if(!owns(ticket))return;
            if(result.ok)setFailure(null);
            else setFailure({requestId:ticket,result});
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "equality enclosing completion",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            if(latest.current===ticket){
              if(result.ok)setFailure(null);
              else setFailure({requestId:ticket,result});
            }};
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "logical ownership completion",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            activeIdRef.current===ticket && (result.ok ? setFailure(null) : setFailure({requestId:ticket,result}));
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "conditional ownership completion",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            activeIdRef.current===ticket ? (result.ok ? setFailure(null) : setFailure({requestId:ticket,result})) : undefined;
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "setter binding visibly replaced by noop",
      expectedCount: 0,
      code: `
        import { useState, useRef, useCallback } from 'react';
        const Panel = ({payload, send}) => {
          let [failure, setFailure] = useState(null);
          setFailure=()=> {
          };
          const requestId = payload.requestId;
          const submit = async () => {
            const result = await send({requestId});
            if (result.ok) setFailure(null);
            else setFailure({requestId, result});
          };
          return <button onClick={submit}>{failure ? 'Retry' : 'Send'}</button>;
        };
      `,
    },
    {
      name: "projection read in preceding nonexit does not guard clear",
      expectedCount: 1,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send})=> {
          const [failure,setFailure]=useState(null);
          const ticket=payload.requestId;
          const activeIdRef=useRef(ticket);
          activeIdRef.current=ticket;
          const submit=async()=> {
            const result=await send({requestId:ticket});
            if(ticket)console.log("observed");
            if(result.ok)setFailure(null);
            else setFailure({requestId:ticket,result});
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "opaque ownership predicate with direct parameter member projection",
      expectedCount: 0,
      code: `
        import {useState,useRef} from 'react';
        const Panel=({payload,send,owns})=> {
          const [failure,setFailure]=useState(null);
          const activeIdRef=useRef(payload.requestId);
          activeIdRef.current=payload.requestId;
          const submit=async()=> {
            const result=await send({requestId:payload.requestId});
            if(!owns(payload.requestId))return;
            if(result.ok)setFailure(null);
            else setFailure({requestId:payload.requestId,result});
          };
          return <button onClick={submit}>{failure?'Retry':'Send'}</button>;
        };
      `,
    },
    {
      name: "declines unsupported switch mismatch returns",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            switch (latest.current) {
              case ticket:
                break;
              default:
                return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported while mismatch returns",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            while (latest.current !== ticket) {
              return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported for mismatch returns",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            for (; latest.current !== ticket;) {
              return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported do while enclosing exit guard",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            do {
              if (latest.current !== ticket) return;
            } while (false);
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported try finally enclosing exit guard",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            try {
              if (latest.current !== ticket) return;
            } finally {}
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported plain block enclosing exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            {
              if (latest.current !== ticket) return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported label enclosing exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            ownerCheck: {
              if (latest.current !== ticket) return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported for of enclosing exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            for (const marker of [true]) {
              if (latest.current !== ticket) return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported for in enclosing exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            for (const marker in {once:true}) {
              if (latest.current !== ticket) return;
            }
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported try catch enclosing exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            try {
              if (latest.current !== ticket) return;
            } catch {}
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "flags nested function exit that does not guard async writer",
      expectedCount: 1,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            (() => {
              if (latest.current !== ticket) return;
            })();
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported boolean comparison alias exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const stillCurrent = latest.current === ticket;
            if (!stillCurrent) return;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported boolean comparison alias enclosing completion",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const stillCurrent = latest.current === ticket;
            if (stillCurrent) {
              if (result.ok) setFailure(null);
              else setFailure({ requestId: ticket, result });
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported opaque predicate alias exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const owns = (identity) => latest.current === identity;
            const stillCurrent = owns(ticket);
            if (!stillCurrent) return;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported closure predicate exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const owns = () => latest.current === ticket;
            if (!owns()) return;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported owned cancellation lease exit",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({current:true}), [ticket]);
          useLayoutEffect(() => () => {
            lease.current=false;
          }, [lease]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            if (!lease.current) return;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported owned cancellation lease enclosing completion",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({current:true}), [ticket]);
          useLayoutEffect(() => () => {
            lease.current=false;
          }, [lease]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            if (lease.current) {
              if (result.ok) setFailure(null);
              else setFailure({ requestId: ticket, result });
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported outcome ok visibly replaced with ownership check",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            result.ok = latest.current === ticket;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported outcome ok replaced through readonly alias",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const reply = result;
            reply.ok = latest.current === ticket;
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported outcome escaped to local mutator before test",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const update = (reply) => {
              reply.ok = latest.current === ticket;
            };
            update(result);
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported outcome defineProperty before test",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            Object.defineProperty(result, "ok", { value: latest.current === ticket });
            if (result.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "reports stale clear with readonly awaited reply spelling remains supported",
      expectedCount: 1,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const reply = await send({ requestId: ticket });
            if (reply.ok) setFailure(null);
            else setFailure({ requestId: ticket, reply });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported unrelated ownership result must not borrow awaited binding",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            const other = { ok: latest.current === ticket };
            if (other.ok) setFailure(null);
            else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines unsupported shadowed outcome spelling is not awaited result",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            {
              const result = { ok: latest.current === ticket };
              if (result.ok) setFailure(null);
              else setFailure({ requestId: ticket, result });
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "reports stale clear with failure branch escape after ok test remains supported",
      expectedCount: 1,
      code: `
        import { useLayoutEffect, useRef, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const latest = useRef(ticket);
          useLayoutEffect(() => {
            latest.current = ticket;
          }, [ticket]);
          const submit = async () => {
            const result = await send({ requestId: ticket });
            if (result.ok) setFailure(null);
            else {
              result.ok = false;
              setFailure({ requestId: ticket, result });
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines projected clear inside while cancellation break",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({ current: true, requestId: ticket }), [ticket]);
          useLayoutEffect(
            () => () => {
              lease.current = false;
            },
            [lease],
          );
          const submit = async () => {
            const result = await send({ requestId: ticket });
            if (result.ok) {
              while (result.ok) {
                if (!lease.current) break;
                setFailure(null);
                break;
              }
            } else setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines projected clear inside testless for cancellation break",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({ current: true, requestId: ticket }), [ticket]);
          useLayoutEffect(
            () => () => {
              lease.current = false;
            },
            [lease],
          );
          const submit = async () => {
            const result = await send({ requestId: ticket });
            for (;;) {
              if (!lease.current) break;
              if (result.ok) setFailure(null);
              else setFailure({ requestId: ticket, result });
              break;
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines projected clear inside labelled block cancellation break",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({ current: true, requestId: ticket }), [ticket]);
          useLayoutEffect(
            () => () => {
              lease.current = false;
            },
            [lease],
          );
          const submit = async () => {
            const result = await send({ requestId: ticket });
            ownerCheck: {
              if (!lease.current) break ownerCheck;
              if (result.ok) setFailure(null);
              else setFailure({ requestId: ticket, result });
            }
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
    {
      name: "declines projected clear inside default switch cancellation break",
      expectedCount: 0,
      code: `
        import { useLayoutEffect, useMemo, useState } from "react";

        export const RequestStatus = ({ payload, send }) => {
          const [failure, setFailure] = useState(null);
          const ticket = payload.requestId;
          const lease = useMemo(() => ({ current: true, requestId: ticket }), [ticket]);
          useLayoutEffect(
            () => () => {
              lease.current = false;
            },
            [lease],
          );
          const submit = async () => {
            const result = await send({ requestId: ticket });
            switch (result.ok) {
              default:
                if (!lease.current) break;
                setFailure(null);
            }
            if (!result.ok) setFailure({ requestId: ticket, result });
          };
          return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
        };
      `,
    },
  ])("$name", ({ code, expectedCount }) => {
    const result = runRule(noUnownedAsyncErrorClear, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
