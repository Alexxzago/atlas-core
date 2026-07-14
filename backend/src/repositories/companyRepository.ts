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

  public save(input: {
  name: string;
  website: string;
  phone?: string;
  email?: string;
  status?: CompanyStatus;
}): Company {
  const existingCompany = this.findByWebsite(input.website);

  if (existingCompany) {
    this.db
      .prepare(`
        UPDATE companies
        SET
          name = ?,
          phone = ?,
          email = ?,
          status = ?
        WHERE id = ?
      `)
      .run(
        input.name,
        input.phone ?? "",
        input.email ?? "",
        input.status ?? existingCompany.status,
        existingCompany.id
      );

    const updatedCompany = this.findById(existingCompany.id);

    if (!updatedCompany) {
      throw new Error("Company could not be updated.");
    }

    return updatedCompany;
  }

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
export const saveCompany = (input: Parameters<CompanyRepository["save"]>[0]): Company => companyRepository.save(input);
export const updateCompanyStatus = (companyId: number, status: CompanyStatus): Company => companyRepository.updateStatus(companyId, status);
