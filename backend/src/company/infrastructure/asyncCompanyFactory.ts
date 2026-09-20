import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncCompanyDomainRepository, AsyncCompanyRepository } from "./asyncCompanyDomain.js";
import { AsyncInvitationRepository, AsyncMembershipRepository, AsyncWorkspaceRepository, AsyncWorkspaceSelectionRepository } from "../../workspace/infrastructure/asyncWorkspaceAdministration.js";

/** Composition-ready boundary for PASS5A2B async persistence slices. */
export function createAsyncWorkspaceCompanyPersistence(database: SqlDatabase): Readonly<{ workspaces: AsyncWorkspaceRepository; memberships: AsyncMembershipRepository; invitations: AsyncInvitationRepository; selections: AsyncWorkspaceSelectionRepository; companies: AsyncCompanyDomainRepository; legacyCompanies: AsyncCompanyRepository }> {
  return Object.freeze({ workspaces:new AsyncWorkspaceRepository(database), memberships:new AsyncMembershipRepository(database), invitations:new AsyncInvitationRepository(database), selections:new AsyncWorkspaceSelectionRepository(database), companies:new AsyncCompanyDomainRepository(database), legacyCompanies:new AsyncCompanyRepository(database) });
}
