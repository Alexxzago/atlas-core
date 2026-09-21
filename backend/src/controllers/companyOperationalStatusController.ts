import type { RequestHandler, Response } from "express";
import { CompanyOperationalStatusNotFoundError, CompanyOperationalStatusService } from "../company/services/companyOperationalStatusService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createGetCompanyOperationalStatusController(service: CompanyOperationalStatusService, context: WorkspaceContext): RequestHandler { return async (request, response): Promise<void> => { try { response.json(await service.get(context, companyId(request.params.companyId))); } catch (error: unknown) { respond(response, error); } }; }
function companyId(value: unknown): number { const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new CompanyOperationalStatusNotFoundError(); return parsed; }
function respond(response: Response, error: unknown): void { if (error instanceof CompanyOperationalStatusNotFoundError) { response.status(404).json({ error: { code: "company_operational_status_not_found", message: "Company operational status is unavailable." } }); return; } response.status(500).json({ error: { code: "company_operational_status_unavailable", message: "Company operational status is temporarily unavailable." } }); }
