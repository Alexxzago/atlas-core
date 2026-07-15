import { database } from "../config/database.js";
import type { DatabaseSync } from "node:sqlite";

export type CompanyStatus = "processing" | "ready" | "failed";

export interface Company {
  id: number;
  name: string;
  website: string;
  phone: string;
  email: string;
  status: CompanyStatus;
  createdAt: string;
}

interface CompanyRow {
  id: number;
  name: string;
  website: string;
  phone: string;
  email: string;
  status: CompanyStatus;
  created_at: string;
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    phone: row.phone,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class CompanyRepository {
  public constructor(private readonly db: DatabaseSync) {}

  public findById(id: number): Company | null {
  const row = this.db
    .prepare(`
      SELECT
        id,
        name,
        website,
        phone,
        email,
        status,
        created_at
      FROM companies
      WHERE id = ?
    `)
    .get(id) as CompanyRow | undefined;

  return row ? mapCompany(row) : null;
}

  public findByWebsite(website: string): Company | null {
  const row = this.db
    .prepare(`
      SELECT
        id,
        name,
        website,
        phone,
        email,
        status,
        created_at
      FROM companies
      WHERE website = ?
    `)
    .get(website) as CompanyRow | undefined;

  return row ? mapCompany(row) : null;
}

  public list(): Company[] {
  const rows = this.db
    .prepare(`
      SELECT
        id,
        name,
        website,
        phone,
        email,
        status,
        created_at
      FROM companies
      ORDER BY id DESC
    `)
    .all() as unknown as CompanyRow[];

  return rows.map(mapCompany);
}

  public create(input: {
    name: string;
    website: string;
    phone?: string;
    email?: string;
    status?: CompanyStatus;
  }): Company {
  const result = this.db
    .prepare(`
      INSERT INTO companies (
        name,
        website,
        phone,
        email,
        status
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      input.name,
      input.website,
      input.phone ?? "",
      input.email ?? "",
      input.status ?? "processing"
    );

  const company = this.findById(Number(result.lastInsertRowid));

  if (!company) {
    throw new Error("Company could not be created.");
  }

  return company;
  }

  public update(companyId: number, input: {
    name: string;
    website: string;
    phone: string;
    email: string;
    status: CompanyStatus;
  }): Company | null {
    const result = this.db
      .prepare(`
        UPDATE companies
        SET name = ?, website = ?, phone = ?, email = ?, status = ?
        WHERE id = ?
      `)
      .run(input.name, input.website, input.phone, input.email, input.status, companyId);

    return result.changes === 0 ? null : this.findById(companyId);
  }

  public delete(companyId: number): boolean {
    const result = this.db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
    return result.changes > 0;
  }

  public updateStatus(
  companyId: number,
  status: CompanyStatus
): Company {
  this.db
    .prepare(`
      UPDATE companies
      SET status = ?
      WHERE id = ?
    `)
    .run(status, companyId);

  const company = this.findById(companyId);

  if (!company) {
    throw new Error("Company could not be found after status update.");
  }

  return company;
  }
}

export const companyRepository = new CompanyRepository(database);

export const findCompanyById = (id: number): Company | null => companyRepository.findById(id);
export const findCompanyByWebsite = (website: string): Company | null => companyRepository.findByWebsite(website);
export const listCompanies = (): Company[] => companyRepository.list();
export const saveCompany = (input: Parameters<CompanyRepository["create"]>[0]): Company => companyRepository.create(input);
export const updateCompanyStatus = (companyId: number, status: CompanyStatus): Company => companyRepository.updateStatus(companyId, status);
