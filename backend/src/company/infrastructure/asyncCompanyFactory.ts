import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncCompanyDomainRepository } from "./asyncCompanyDomain.js";
import { AsyncInvitationRepository, AsyncMembershipRepository, AsyncWorkspaceSelectionRepository } from "../../workspace/infrastructure/asyncWorkspaceAdministration.js";

/** Composition-ready boundary for PASS5A2B async persistence slices. */
export function createAsyncWorkspaceCompanyPersistence(database: SqlDatabase): Readonly<{ memberships: AsyncMembershipRepository; invitations: AsyncInvitationRepository; selections: AsyncWorkspaceSelectionRepository; companies: AsyncCompanyDomainRepository }> {
  return Object.freeze({ memberships:new AsyncMembershipRepository(database), invitations:new AsyncInvitationRepository(database), selections:new AsyncWorkspaceSelectionRepository(database), companies:new AsyncCompanyDomainRepository(database) });
}
