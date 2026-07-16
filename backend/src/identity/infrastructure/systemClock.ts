import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  public now(): string { return new Date().toISOString(); }
}
