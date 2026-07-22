import assert from "node:assert/strict";
import test from "node:test";
import { WorkerPdfTextExtractor } from "../knowledge/infrastructure/pdfTextExtractor.js";
import { KnowledgeDomainError } from "../knowledge/domain/knowledge.js";

const bytes=Buffer.from("%PDF-safe\nBT\nstartxref\n0\n%%EOF");
test("PDF worker memory pressure closes deterministically",async()=>{await assert.rejects(new WorkerPdfTextExtractor({workerCode:"const a=[];while(true)a.push(new Array(100000).fill('x'))",resourceLimits:{maxOldGenerationSizeMb:8,maxYoungGenerationSizeMb:4,stackSizeMb:2}}).extract(bytes,new AbortController().signal),KnowledgeDomainError);});
test("PDF worker crash closes deterministically",async()=>{await assert.rejects(new WorkerPdfTextExtractor({workerCode:"throw Error('crash')"}).extract(bytes,new AbortController().signal),KnowledgeDomainError);});
test("PDF worker forced timeout closes deterministically",async()=>{await assert.rejects(new WorkerPdfTextExtractor({workerCode:"setInterval(()=>{},1000)",timeoutMilliseconds:10}).extract(bytes,new AbortController().signal),KnowledgeDomainError);});
test("PDF worker caller abort closes deterministically",async()=>{const controller=new AbortController(),pending=new WorkerPdfTextExtractor({workerCode:"setInterval(()=>{},1000)"}).extract(bytes,controller.signal);controller.abort();await assert.rejects(pending,KnowledgeDomainError);});
