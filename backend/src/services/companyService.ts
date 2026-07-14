import type { Company, CompanyRepository } from "../repositories/companyRepository.js";

export class CompanyService {
  public constructor(private readonly companies: CompanyRepository) {}
  public list(): Company[] { return this.companies.list(); }
  public create(input: { name: string; website: string; phone?: string; email?: string }): Company {
    return this.companies.save(input);
  }
}
