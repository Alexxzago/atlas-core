import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { UserId } from "../identity/domain/user.js";
import type { PlatformAdministratorAccessPort } from "../platformAdmin/services/platformAuthorizationService.js";

export class PlatformAdministratorRepository implements PlatformAdministratorAccessPort {
  public constructor(private readonly database: SynchronousDatabase) {}
  public isActive(userId: UserId): boolean { return this.database.prepare("SELECT 1 FROM platform_administrators WHERE user_id=? AND status='active'").get(userId) !== undefined; }
}
