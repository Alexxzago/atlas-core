import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const databasePath = resolve(projectRoot, "database/atlas.sqlite");

export function createDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const instance = new DatabaseSync(path);

  instance.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS company_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE,
    services_json TEXT NOT NULL DEFAULT '[]',
    hours TEXT NOT NULL DEFAULT '',
    locations_json TEXT NOT NULL DEFAULT '[]',
    faq_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id)
      REFERENCES companies(id)
      ON DELETE CASCADE
  );
`);

  return instance;
}

export const database = createDatabase(databasePath);
