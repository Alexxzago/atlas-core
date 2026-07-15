import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const databasePath = resolve(projectRoot, "database/atlas.sqlite");

export function createDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const instance = new DatabaseSync(path);
  instance.exec("PRAGMA foreign_keys = ON;");
  runMigrations(instance);

  return instance;
}

export const database = createDatabase(databasePath);
