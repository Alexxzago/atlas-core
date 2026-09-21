import type { UserId } from "../../identity/domain/user.js";

export interface PlatformAdministratorAccessPort { isActive(userId: UserId): boolean | Promise<boolean>; }

export class PlatformAuthorizationService {
  public constructor(private readonly administrators: PlatformAdministratorAccessPort) {}
  public async isPlatformAdministrator(userId: UserId): Promise<boolean> { return await this.administrators.isActive(userId); }
}
