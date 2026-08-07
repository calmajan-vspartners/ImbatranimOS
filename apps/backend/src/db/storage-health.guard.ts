import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Refuse every API request while a migration has failed (brief 110).
 *
 * A half-migrated schema serving "most" routes is how data gets corrupted
 * confidently: the tables that migrated accept writes, the ones that did not
 * 500 somewhere unrelated, and the audit log fills with `server.error` lines
 * pointing nowhere near the cause. One honest 503 naming the failed step is
 * worth more than a partly-working machine.
 *
 * `/health` is deliberately NOT behind this — it lives outside the API prefix
 * and must keep answering 200 so the message can be read (a compose
 * healthcheck restart cannot fix a half-migrated disk, and flapping the
 * container only hides it).
 */
@Injectable()
export class StorageHealthGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  canActivate(): boolean {
    if (this.db.migrationFailure) {
      throw new ServiceUnavailableException(
        `System storage needs attention: ${this.db.migrationFailure}`,
      );
    }
    return true;
  }
}
