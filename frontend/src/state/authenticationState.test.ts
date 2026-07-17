import assert from "node:assert/strict";
import test from "node:test";
import { authenticationReducer, type AuthenticationState } from "./authenticationState.ts";

const identity={userId:"usr",email:"person@example.com",locale:"en",status:"active",idleExpiresAt:"2026-07-17T00:30:00Z",absoluteExpiresAt:"2026-07-17T12:00:00Z"};

test("authentication starts booting and transitions without a Login state",()=>{const booting:AuthenticationState={status:"booting"};const authenticated=authenticationReducer(booting,{type:"authenticated",result:{status:"authenticated",identity,csrfToken:"csrf-2",csrfGeneration:2}});assert.equal(authenticated.status,"authenticated");assert.equal(authenticationReducer(booting,{type:"unauthenticated"}).status,"unauthenticated");assert.equal(authenticationReducer(booting,{type:"retryable",error:"retry"}).status,"retryable-error");});

test("stale CSRF generations and broadcasts cannot replace the current token",()=>{const state:AuthenticationState={status:"authenticated",identity,csrfToken:"csrf-3",csrfGeneration:3};assert.equal(authenticationReducer(state,{type:"token",csrfToken:"stale",csrfGeneration:2}),state);assert.equal(authenticationReducer(state,{type:"token",csrfToken:"same",csrfGeneration:3}),state);const next=authenticationReducer(state,{type:"token",csrfToken:"csrf-4",csrfGeneration:4});assert.equal(next.status,"authenticated");if(next.status==="authenticated"){assert.equal(next.csrfToken,"csrf-4");assert.equal(next.csrfGeneration,4);}});

test("logout destroys authenticated identity and CSRF state",()=>{const state:AuthenticationState={status:"authenticated",identity,csrfToken:"csrf",csrfGeneration:1};assert.deepEqual(authenticationReducer(state,{type:"unauthenticated"}),{status:"unauthenticated"});});
