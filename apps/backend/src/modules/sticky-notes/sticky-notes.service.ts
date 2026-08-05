import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { CreateStickyNoteDto } from './dto/create-sticky-note.dto';
import { UpdateStickyNoteDto } from './dto/update-sticky-note.dto';

/**
 * Sticky notes, and where on the desktop they sit.
 *
 * Brief 74 turned these from "a list inside a window" into notes that live on the
 * desktop, so a note now carries a size, a colour and an `onDesktop` flag beside
 * its position.
 *
 * **`pos_x`/`pos_y` are reused as the desktop position.** They already existed and
 * already held a position — the spawn point of a per-note OS window, a mode the
 * desktop layer replaces — so adding an `x`/`y` pair beside them would have left
 * two sources of truth for the same thing. They are exposed as `x`/`y`.
 *
 * Like `clock`, `calendar` and `todos`, rows are mapped to **camelCase at the
 * service boundary**. This is the module brief 71 named as leaking `snake_case`
 * into React props (`pos_x`, `created_at`); it is rewritten on both sides in this
 * commit, so the break is bounded and paid for.
 */

export interface StickyNote {
  id: number;
  content: string;
  /** Desktop position, px from the desktop layer's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** One of the shared palette names, or null for the default surface. */
  color: string | null;
  /** False means it exists only in the manager window. */
  onDesktop: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StickyNoteRow {
  id: number;
  content: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  color: string | null;
  on_desktop: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, content, pos_x, pos_y, width, height, color, on_desktop,
       created_at, updated_at`;

function toNote(row: StickyNoteRow): StickyNote {
  return {
    id: row.id,
    content: row.content,
    x: row.pos_x,
    y: row.pos_y,
    width: row.width,
    height: row.height,
    color: row.color,
    onDesktop: row.on_desktop === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class StickyNotesService {
  constructor(private readonly db: DbService) {}

  findAll(): StickyNote[] {
    const rows = this.db.db
      .prepare(
        `SELECT ${COLUMNS} FROM sticky_notes ORDER BY created_at DESC, id DESC`,
      )
      .all() as StickyNoteRow[];
    return rows.map(toNote);
  }

  create(dto: CreateStickyNoteDto): StickyNote {
    const info = this.db.db
      .prepare(
        `INSERT INTO sticky_notes (content, pos_x, pos_y, width, height, color, on_desktop)
         VALUES (@content, @x, @y, @width, @height, @color, @onDesktop)`,
      )
      .run({
        content: dto.content ?? '',
        x: dto.x ?? 100,
        y: dto.y ?? 100,
        width: dto.width ?? 200,
        height: dto.height ?? 180,
        color: dto.color ?? null,
        onDesktop: dto.onDesktop ? 1 : 0,
      });
    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, dto: UpdateStickyNoteDto): StickyNote {
    const existing = this.db.db
      .prepare('SELECT id FROM sticky_notes WHERE id = ?')
      .get(id);
    if (!existing) {
      throw new NotFoundException(`Sticky note ${id} not found`);
    }

    const fields: string[] = [];
    const values: Record<string, unknown> = { id };
    const set = (column: string, key: string, value: unknown) => {
      fields.push(`${column} = @${key}`);
      values[key] = value;
    };

    if (dto.content !== undefined) set('content', 'content', dto.content);
    if (dto.x !== undefined) set('pos_x', 'x', dto.x);
    if (dto.y !== undefined) set('pos_y', 'y', dto.y);
    if (dto.width !== undefined) set('width', 'width', dto.width);
    if (dto.height !== undefined) set('height', 'height', dto.height);
    if (dto.onDesktop !== undefined)
      set('on_desktop', 'onDesktop', dto.onDesktop ? 1 : 0);
    // `null` clears the colour back to the default surface, so this checks
    // `undefined` rather than falsiness.
    if (dto.color !== undefined) set('color', 'color', dto.color ?? null);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    this.db.db
      .prepare(`UPDATE sticky_notes SET ${fields.join(', ')} WHERE id = @id`)
      .run(values);

    return this.get(id);
  }

  remove(id: number): void {
    const info = this.db.db
      .prepare('DELETE FROM sticky_notes WHERE id = ?')
      .run(id);
    if (info.changes === 0) {
      throw new NotFoundException(`Sticky note ${id} not found`);
    }
  }

  private get(id: number): StickyNote {
    const row = this.db.db
      .prepare(`SELECT ${COLUMNS} FROM sticky_notes WHERE id = ?`)
      .get(id) as StickyNoteRow;
    return toNote(row);
  }
}
