import { companyRepository } from "../repositories/companyRepository.js";
import { workspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const context = createWorkspaceContext(workspaceRepository.resolveDefault());
const companies = companyRepository.list(context);

console.table(companies);
