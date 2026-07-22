import assert from "node:assert/strict";
import test from "node:test";
import { initialOperationalAssistantExecutionState, operationalAssistantExecutionReducer, operationalMessageLength, operationalMessageValid } from "./operationalAssistantExecutionState.ts";
test("operational execution state rejects stale completions and counts code points",()=>{let state=operationalAssistantExecutionReducer(initialOperationalAssistantExecutionState,{type:"started",requestId:1});state=operationalAssistantExecutionReducer(state,{type:"contextChanged"});assert.equal(operationalAssistantExecutionReducer(state,{type:"succeeded",requestId:1,outcome:"answered",answer:"stale"}).status,"idle");assert.equal(operationalMessageLength("😀"),1);});
test("operational message bounds use trimmed Unicode code points",()=>{assert.equal(operationalMessageValid("   "),false);assert.equal(operationalMessageValid("😀".repeat(2_000)),true);assert.equal(operationalMessageValid("😀".repeat(2_001)),false);});
