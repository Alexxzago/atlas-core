import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncUsers } from "../../identity/infrastructure/asyncIdentity.js";
import { AsyncCommercialControlsRepository } from "../../platformAdmin/infrastructure/asyncPlatformAdministrationPersistence.js";
import type { WorkspaceAdministrationRepositories, WorkspaceAdministrationTransactionPort } from "../application/ports.js";
import { AsyncInvitationRepository, AsyncMembershipRepository, AsyncWorkspaceRepository, AsyncWorkspaceSelectionRepository } from "./asyncWorkspaceAdministration.js";

/** Runs every workspace state change through the shared async SQL transaction boundary. */
export class SqlWorkspaceAdministrationTransaction implements WorkspaceAdministrationTransactionPort {
  public constructor(private readonly database: SqlDatabase) {}
  public execute<T>(operation: (repositories: WorkspaceAdministrationRepositories) => Promise<T>): Promise<T> {
    return this.database.transaction(database => operation({ users:new AsyncUsers(database),workspaces:new AsyncWorkspaceRepository(database),memberships:new AsyncMembershipRepository(database),invitations:new AsyncInvitationRepository(database),selections:new AsyncWorkspaceSelectionRepository(database),commercial:new AsyncCommercialControlsRepository(database) }));
  }
}
