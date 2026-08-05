import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { CreateLinkDto } from './dto/create-link.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import {
  ImportBookmarksDto,
  ImportFolderDto,
} from './dto/import-bookmarks.dto';
import { ReorderDto } from './dto/reorder.dto';

/**
 * camelCase at the service boundary, and `url` rather than `href`.
 *
 * The rename is the contract brief 50 will consume (`openApp('browser', { url })`);
 * the case is the rule briefs 71 and 73 set — no snake_case reaches a React prop.
 * Both happen here, at the one seam, rather than being translated by every caller.
 */
export interface BookmarkLink {
  id: number;
  groupId: number;
  title: string;
  url: string;
  icon: string | null;
  position: number;
}

export interface BookmarkGroup {
  id: number;
  name: string;
  icon: string | null;
  parentId: number | null;
  position: number;
  links: BookmarkLink[];
}

type GroupRow = {
  id: number;
  name: string;
  icon: string | null;
  parent_id: number | null;
  position: number;
};

type LinkRow = {
  id: number;
  group_id: number;
  title: string;
  url: string;
  icon: string | null;
  position: number;
};

/** Values bag for a dynamic UPDATE — only bound param types, never `any`. */
type UpdateValues = Record<string, string | number | null>;

const toGroup = (row: GroupRow, links: BookmarkLink[]): BookmarkGroup => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  parentId: row.parent_id,
  position: row.position,
  links,
});

const toLink = (row: LinkRow): BookmarkLink => ({
  id: row.id,
  groupId: row.group_id,
  title: row.title,
  url: row.url,
  icon: row.icon,
  position: row.position,
});

@Injectable()
export class BookmarksService {
  constructor(private readonly db: DbService) {}

  /**
   * Every folder, flat, each with its own links.
   *
   * The **tree is assembled on the client** from `parentId`, deliberately: the whole
   * set is one screenful of data even after a large import, the palette's command
   * source needs the flat link list anyway, and a nested JSON response would make
   * "move this folder" a diff of two trees instead of one field.
   */
  findAllGroups(): BookmarkGroup[] {
    const groups = this.db.db
      .prepare('SELECT * FROM bookmark_groups ORDER BY position ASC, id ASC')
      .all() as GroupRow[];

    const links = this.db.db
      .prepare('SELECT * FROM bookmark_links ORDER BY position ASC, id ASC')
      .all() as LinkRow[];

    // Bucket links by group in one pass (O(g + l)) instead of filtering the
    // full link list per group (O(g × l)).
    const linksByGroup = new Map<number, BookmarkLink[]>();
    for (const row of links) {
      const link = toLink(row);
      const bucket = linksByGroup.get(link.groupId);
      if (bucket) bucket.push(link);
      else linksByGroup.set(link.groupId, [link]);
    }

    return groups.map((group) =>
      toGroup(group, linksByGroup.get(group.id) ?? []),
    );
  }

  createGroup(dto: CreateGroupDto): BookmarkGroup {
    if (dto.parentId !== undefined && dto.parentId !== null) {
      this.requireGroup(dto.parentId);
    }
    const parentId = dto.parentId ?? null;
    const info = this.db.db
      .prepare(
        `INSERT INTO bookmark_groups (name, icon, parent_id, position)
         VALUES (@name, @icon, @parentId, @position)`,
      )
      .run({
        name: dto.name,
        icon: dto.icon ?? null,
        parentId,
        position: this.nextGroupPosition(parentId),
      });

    return toGroup(this.groupRow(Number(info.lastInsertRowid)), []);
  }

  updateGroup(id: number, dto: UpdateGroupDto): BookmarkGroup {
    this.requireGroup(id);

    const fields: string[] = [];
    const values: UpdateValues = { id };

    if (dto.name !== undefined) {
      fields.push('name = @name');
      values.name = dto.name;
    }
    if (dto.icon !== undefined) {
      fields.push('icon = @icon');
      values.icon = dto.icon;
    }
    if (dto.parentId !== undefined) {
      const parentId = dto.parentId ?? null;
      if (parentId !== null) {
        this.requireGroup(parentId);
        this.refuseCycle(id, parentId);
      }
      fields.push('parent_id = @parentId');
      values.parentId = parentId;
      // Moving to a new parent means taking a position among its children. The old
      // siblings' numbering is left alone: a gap changes no ordering.
      fields.push('position = @position');
      values.position = this.nextGroupPosition(parentId);
    }

    if (fields.length > 0) {
      this.db.db
        .prepare(
          `UPDATE bookmark_groups SET ${fields.join(', ')} WHERE id = @id`,
        )
        .run(values);
    }

    return toGroup(this.groupRow(id), this.linksOf(id));
  }

  /**
   * Delete a folder, its descendants, and all of their links.
   *
   * **This is the bug brief 73 handed over.** The schema declares
   * `ON DELETE CASCADE` and the old code carried a comment claiming SQLite handled
   * it — but `PRAGMA foreign_keys` is never enabled on this connection, so the
   * constraint was decorative and every folder deletion silently orphaned its
   * links. The subtree is now collected explicitly and deleted in one transaction,
   * the same shape Todo's list deletion uses for the same reason.
   */
  deleteGroup(id: number): void {
    this.requireGroup(id);
    const ids = this.subtreeIds(id);
    const placeholders = ids.map(() => '?').join(', ');
    this.db.db.transaction(() => {
      this.db.db
        .prepare(
          `DELETE FROM bookmark_links WHERE group_id IN (${placeholders})`,
        )
        .run(...ids);
      this.db.db
        .prepare(`DELETE FROM bookmark_groups WHERE id IN (${placeholders})`)
        .run(...ids);
    })();
  }

  createLink(dto: CreateLinkDto): BookmarkLink {
    this.requireGroup(dto.groupId);

    const info = this.db.db
      .prepare(
        `INSERT INTO bookmark_links (group_id, title, url, icon, position)
         VALUES (@groupId, @title, @url, @icon, @position)`,
      )
      .run({
        groupId: dto.groupId,
        title: dto.title,
        url: dto.url,
        icon: dto.icon ?? null,
        position: this.nextLinkPosition(dto.groupId),
      });

    return toLink(this.linkRow(Number(info.lastInsertRowid)));
  }

  updateLink(id: number, dto: UpdateLinkDto): BookmarkLink {
    this.requireLink(id);

    const fields: string[] = [];
    const values: UpdateValues = { id };

    if (dto.title !== undefined) {
      fields.push('title = @title');
      values.title = dto.title;
    }
    if (dto.url !== undefined) {
      fields.push('url = @url');
      values.url = dto.url;
    }
    if (dto.icon !== undefined) {
      fields.push('icon = @icon');
      values.icon = dto.icon;
    }
    if (dto.groupId !== undefined) {
      // Moving a bookmark between folders — the drag the brief asks for.
      this.requireGroup(dto.groupId);
      fields.push('group_id = @groupId');
      values.groupId = dto.groupId;
      fields.push('position = @position');
      values.position = this.nextLinkPosition(dto.groupId);
    }

    if (fields.length > 0) {
      this.db.db
        .prepare(
          `UPDATE bookmark_links SET ${fields.join(', ')} WHERE id = @id`,
        )
        .run(values);
    }

    return toLink(this.linkRow(id));
  }

  deleteLink(id: number): void {
    this.requireLink(id);
    this.db.db.prepare('DELETE FROM bookmark_links WHERE id = ?').run(id);
  }

  /**
   * Reorder siblings: stamp 1..N onto the ids in the order given.
   *
   * Brief 73's reorder bug was that ids from a **filtered** view got 1..N written
   * over rows the caller could not see, so two rows ended up sharing a position.
   * The defence here is structural rather than a comment: every id must share one
   * parent, and the caller must name **every** sibling, so there is no hidden row
   * for the numbering to collide with.
   */
  reorderLinks(dto: ReorderDto): BookmarkLink[] {
    this.checkReorder('bookmark_links', 'group_id', dto.ids);
    const update = this.db.db.prepare(
      'UPDATE bookmark_links SET position = @position WHERE id = @id',
    );
    this.db.db.transaction(() => {
      dto.ids.forEach((id, index) => update.run({ position: index + 1, id }));
    })();
    return dto.ids.map((id) => toLink(this.linkRow(id)));
  }

  reorderGroups(dto: ReorderDto): BookmarkGroup[] {
    this.checkReorder('bookmark_groups', 'parent_id', dto.ids);
    const update = this.db.db.prepare(
      'UPDATE bookmark_groups SET position = @position WHERE id = @id',
    );
    this.db.db.transaction(() => {
      dto.ids.forEach((id, index) => update.run({ position: index + 1, id }));
    })();
    return dto.ids.map((id) => toGroup(this.groupRow(id), this.linksOf(id)));
  }

  /**
   * Insert a whole folder tree in one transaction — the Netscape-HTML import.
   *
   * The **parsing happens on the client** (`netscape.ts`, pure and tested — the same
   * split Calendar's ICS reader uses), so this end takes an already-shaped tree and
   * a 2000-bookmark file is one authed round trip and one transaction rather than
   * two thousand. Nothing is inserted if any part fails, so a rejected URL cannot
   * leave half a tree behind.
   */
  importTree(dto: ImportBookmarksDto): { folders: number; links: number } {
    if (dto.parentId !== undefined && dto.parentId !== null) {
      this.requireGroup(dto.parentId);
    }
    const counts = { folders: 0, links: 0 };
    const insertGroup = this.db.db.prepare(
      `INSERT INTO bookmark_groups (name, icon, parent_id, position)
       VALUES (@name, NULL, @parentId, @position)`,
    );
    const insertLink = this.db.db.prepare(
      `INSERT INTO bookmark_links (group_id, title, url, icon, position)
       VALUES (@groupId, @title, @url, NULL, @position)`,
    );

    const walk = (folder: ImportFolderDto, parentId: number | null): void => {
      const info = insertGroup.run({
        name: folder.name,
        parentId,
        position: this.nextGroupPosition(parentId),
      });
      const groupId = Number(info.lastInsertRowid);
      counts.folders += 1;
      (folder.links ?? []).forEach((link, index) => {
        insertLink.run({
          groupId,
          title: link.title,
          url: link.url,
          position: index + 1,
        });
        counts.links += 1;
      });
      for (const child of folder.folders ?? []) walk(child, groupId);
    };

    this.db.db.transaction(() => {
      for (const folder of dto.folders) walk(folder, dto.parentId ?? null);
    })();

    return counts;
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private requireGroup(id: number): void {
    const row = this.db.db
      .prepare('SELECT id FROM bookmark_groups WHERE id = ?')
      .get(id);
    if (!row) throw new NotFoundException(`Bookmark group ${id} not found`);
  }

  private requireLink(id: number): void {
    const row = this.db.db
      .prepare('SELECT id FROM bookmark_links WHERE id = ?')
      .get(id);
    if (!row) throw new NotFoundException(`Bookmark link ${id} not found`);
  }

  private groupRow(id: number): GroupRow {
    return this.db.db
      .prepare('SELECT * FROM bookmark_groups WHERE id = ?')
      .get(id) as GroupRow;
  }

  private linkRow(id: number): LinkRow {
    return this.db.db
      .prepare('SELECT * FROM bookmark_links WHERE id = ?')
      .get(id) as LinkRow;
  }

  private linksOf(groupId: number): BookmarkLink[] {
    return (
      this.db.db
        .prepare(
          'SELECT * FROM bookmark_links WHERE group_id = ? ORDER BY position ASC, id ASC',
        )
        .all(groupId) as LinkRow[]
    ).map(toLink);
  }

  private nextGroupPosition(parentId: number | null): number {
    const row = this.db.db
      .prepare(
        parentId === null
          ? 'SELECT MAX(position) AS max FROM bookmark_groups WHERE parent_id IS NULL'
          : 'SELECT MAX(position) AS max FROM bookmark_groups WHERE parent_id = ?',
      )
      .get(...(parentId === null ? [] : [parentId])) as { max: number | null };
    return (row.max ?? 0) + 1;
  }

  private nextLinkPosition(groupId: number): number {
    const row = this.db.db
      .prepare(
        'SELECT MAX(position) AS max FROM bookmark_links WHERE group_id = ?',
      )
      .get(groupId) as { max: number | null };
    return (row.max ?? 0) + 1;
  }

  /**
   * A folder plus every descendant, parents before children.
   *
   * Iterative rather than a recursive CTE so the traversal is visible in one place,
   * and bounded by a seen-set: the cycle guard should make a loop impossible, but a
   * row written before that guard existed must not spin the server forever.
   */
  private subtreeIds(rootId: number): number[] {
    const childrenOf = this.db.db.prepare(
      'SELECT id FROM bookmark_groups WHERE parent_id = ?',
    );
    const ids: number[] = [];
    const seen = new Set<number>();
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift() as number;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      for (const child of childrenOf.all(id) as { id: number }[]) {
        queue.push(child.id);
      }
    }
    return ids;
  }

  /**
   * Refuse a move that would make a folder its own ancestor.
   *
   * Walking **up** from the proposed parent is the cheap direction: a cycle exists
   * exactly when `id` appears on that chain. The seen-set is again a guard against
   * pre-existing bad data rather than against this call.
   */
  private refuseCycle(id: number, parentId: number): void {
    const parentOf = this.db.db.prepare(
      'SELECT parent_id FROM bookmark_groups WHERE id = ?',
    );
    let cursor: number | null = parentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === id) {
        throw new BadRequestException(
          'A folder cannot be moved inside itself or one of its own subfolders',
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const row = parentOf.get(cursor) as
        | { parent_id: number | null }
        | undefined;
      cursor = row?.parent_id ?? null;
    }
  }

  /** Insist a reorder names every sibling of exactly one parent. */
  private checkReorder(
    table: 'bookmark_links' | 'bookmark_groups',
    parentColumn: 'group_id' | 'parent_id',
    ids: number[],
  ): void {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'A reorder cannot list the same item twice',
      );
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.db
      .prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as (LinkRow & GroupRow)[];
    if (rows.length !== ids.length) {
      throw new NotFoundException('One of those bookmarks no longer exists');
    }
    const parents = new Set(rows.map((row) => row[parentColumn]));
    if (parents.size > 1) {
      throw new BadRequestException(
        'Only bookmarks in the same folder can be reordered together',
      );
    }
    const parent = [...parents][0] ?? null;
    const siblings = this.db.db
      .prepare(
        parent === null
          ? `SELECT COUNT(*) AS n FROM ${table} WHERE ${parentColumn} IS NULL`
          : `SELECT COUNT(*) AS n FROM ${table} WHERE ${parentColumn} = ?`,
      )
      .get(...(parent === null ? [] : [parent])) as { n: number };
    if (siblings.n !== ids.length) {
      throw new BadRequestException(
        'A reorder must list every item in the folder, not a filtered subset',
      );
    }
  }
}
