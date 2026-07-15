import { database } from "../config/database.js";
import type { DatabaseSync } from "node:sqlite";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { CompanyRepository } from "./companyRepository.js";
import { companyRepository } from "./companyRepository.js";

interface KnowledgeRow {
  company_id: number;
  services_json: string;
  hours: string;
  locations_json: string;
  faq_json: string;
}

export class KnowledgeRepository {
  public constructor(
    private readonly db: DatabaseSync,
    private readonly companies: CompanyRepository
  ) {}

  public save(
  companyId: number,
  knowledge: CompanyKnowledge
): void {
  const statement = this.db.prepare(`
    INSERT INTO company_knowledge (
      company_id,
      services_json,
      hours,
      locations_json,
      faq_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

    ON CONFLICT(company_id)
    DO UPDATE SET
      services_json = excluded.services_json,
      hours = excluded.hours,
      locations_json = excluded.locations_json,
      faq_json = excluded.faq_json,
      updated_at = CURRENT_TIMESTAMP
  `);

  statement.run(
    companyId,
    JSON.stringify(knowledge.business.services),
    knowledge.business.hours,
    JSON.stringify(knowledge.business.locations),
    JSON.stringify(knowledge.faq)
  );
}

  public load(
  companyId: number
): CompanyKnowledge | null {
  const company = this.companies.findById(companyId);

  if (!company) {
    return null;
  }

  const statement = this.db.prepare(`
    SELECT
      company_id,
      services_json,
      hours,
      locations_json,
      faq_json
    FROM company_knowledge
    WHERE company_id = ?
  `);

  const row = statement.get(companyId) as KnowledgeRow | undefined;

  if (!row) {
    return null;
  }

  return {
    company: {
      name: company.name,
      website: company.website,
      phone: company.phone,
      email: company.email,
    },
    business: {
      services: JSON.parse(row.services_json) as string[],
      hours: row.hours,
      locations: JSON.parse(row.locations_json) as string[],
    },
    faq: JSON.parse(row.faq_json) as CompanyKnowledge["faq"],
  };
  }

  public delete(companyId: number): boolean {
    const result = this.db
      .prepare("DELETE FROM company_knowledge WHERE company_id = ?")
      .run(companyId);
    return result.changes > 0;
  }
}

export const knowledgeRepository = new KnowledgeRepository(database, companyRepository);

export const saveCompanyKnowledge = (companyId: number, knowledge: CompanyKnowledge): void => knowledgeRepository.save(companyId, knowledge);
export const loadCompanyKnowledge = (companyId: number): CompanyKnowledge | null => knowledgeRepository.load(companyId);
