import type { RequestHandler, Response } from "express";
import type { CompanyService } from "../services/companyService.js";
import {
  CompanyNotFoundError,
  CompanyValidationError,
  DuplicateWebsiteError,
} from "../services/companyValidation.js";

export function createListCompaniesController(service: CompanyService): RequestHandler {
  return (_req, res): void => { res.json(service.list()); };
}

export function createGetCompanyController(service: CompanyService): RequestHandler {
  return (req, res): void => {
    try {
      res.json(service.get(req.params.companyId));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createCompanyController(service: CompanyService): RequestHandler {
  return (req, res): void => {
    try {
      res.status(201).json(service.create(req.body));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createUpdateCompanyController(service: CompanyService): RequestHandler {
  return (req, res): void => {
    try {
      res.json(service.update(req.params.companyId, req.body));
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
}

export function createDeleteCompanyController(service: CompanyService): RequestHandler {
  return (req, res): void => {
    try {
      service.delete(req.params.companyId);
      res.status(204).send();
    } catch (error: unknown) {
      respondToCompanyError(res, error);
    }
  };
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
