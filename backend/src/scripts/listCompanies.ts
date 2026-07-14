import { database } from "../config/database.js";

const companies = database
  .prepare(`
    SELECT
      id,
      name,
      website,
      phone,
      email,
      created_at
    FROM companies
    ORDER BY id
  `)
  .all();

console.table(companies);

const knowledge = database
  .prepare(`
    SELECT
      company_id,
      updated_at
    FROM company_knowledge
    ORDER BY company_id
  `)
  .all();

console.table(knowledge);