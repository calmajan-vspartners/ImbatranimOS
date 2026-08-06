import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { UpsertRecentDto } from './dto/upsert-recent.dto';

@Injectable()
export class NotesService {
  constructor(private readonly db: DbService) {}

  getRecent() {
    return this.db.db
      .prepare('SELECT * FROM recent_files ORDER BY last_opened DESC LIMIT 10')
      .all();
  }

  upsertRecent(dto: UpsertRecentDto) {
    this.db.db
      .prepare(
        `INSERT INTO recent_files (path, last_opened)
         VALUES (@path, CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET last_opened = CURRENT_TIMESTAMP`,
      )
      .run({ path: dto.path });
    // Bound the table: the read only ever shows the 10 most recent, so keep a
    // small buffer (50) and drop anything older. Without this the table grew one
    // row per distinct path opened, forever.
    this.db.db
      .prepare(
        `DELETE FROM recent_files
          WHERE id NOT IN (
            SELECT id FROM recent_files ORDER BY last_opened DESC LIMIT 50
          )`,
      )
      .run();
    return { path: dto.path };
  }
}
