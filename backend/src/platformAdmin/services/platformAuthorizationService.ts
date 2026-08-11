import type { UserId } from "../../identity/domain/user.js";

export interface PlatformAdministratorAccessPort { isActive(userId: UserId): boolean; }

export class PlatformAuthorizationService {
  public constructor(private readonly administrators: PlatformAdministratorAccessPort) {}
  public isPlatformAdministrator(userId: UserId): boolean { return this.administrators.isActive(userId); }
}
