import type { RequestHandler, Response } from "express";
import type { CompanyService } from "../services/companyService.js";
import type { Company } from "../types/company.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import {
  CompanyNotFoundError,
  CompanyValidationError,
  DuplicateWebsiteError,
} from "../services/companyValidation.js";

export function createListCompaniesController(service: CompanyService, context: WorkspaceContext): RequestHandler {
  return (_req, res): void => { res.json(service.list(context).map(toCompanyResponse)); };
}

export function createGetCompanyController(service: CompanyService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try {
      res.json(toCompanyResponse(service.get(context, req.params.companyId)));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createCompanyController(service: CompanyService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try {
      res.status(201).json(toCompanyResponse(service.create(context, req.body)));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createUpdateCompanyController(service: CompanyService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try {
      res.json(toCompanyResponse(service.update(context, req.params.companyId, req.body)));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createDeleteCompanyController(service: CompanyService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try {
      service.delete(context, req.params.companyId);
      res.status(204).send();
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

function toCompanyResponse(company: Company): Omit<Company, "workspaceId"> {
  const { workspaceId: _workspaceId, ...response } = company;
  return response;
}

export function respondToCompanyError(res: Response, error: unknown): void {
  if (error instanceof CompanyValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof CompanyNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof DuplicateWebsiteError) {
    res.status(409).json({ error: error.message });
    return;
  }
  console.error("Company operation failed.", error);
  res.status(500).json({ error: "Company operation failed." });
}
