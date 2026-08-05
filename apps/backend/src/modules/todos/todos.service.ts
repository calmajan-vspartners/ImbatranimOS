import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { CreateListDto, UpdateListDto } from './dto/list.dto';

/**
 * Todos, and the lists they can be filed under.
 *
 * Unlike Clock and Calendar (briefs 71/72) this module never needed moving — it
 * has always persisted here. Brief 73 extends the model instead: a due date, a
 * priority flag, and one level of lists.
 *
 * **This module now maps rows to camelCase at the service boundary**, matching
 * `clock` and `calendar`. Brief 71 deliberately left the older modules alone
 * because changing them is a client-visible break for no user gain — but this
 * brief rewrites both sides of the Todo surface in the same commit, and the
 * alternative was a response mixing `created_at` with `dueAt`. `completed` is a
 * real boolean now too; it used to arrive as `0 | 1` and the frontend's own type
 * said `boolean | number`, which is a type admitting it had a problem.
 *
 * `dueAt` is epoch ms with **local wall-clock meaning**, the same convention
 * Calendar uses: no timezone conversion anywhere.
 *
 * One level of lists, deliberately: arbitrary nesting turns a task list into an
 * outliner and complicates every query. `listId === null` means unfiled.
 */

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  /** 1-based rank across the whole table; see `reorder`. */
  position: number;
  /** epoch ms, or null for no due date. */
  dueAt: number | null;
  priority: boolean;
  listId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoList {
  id: number;
  name: string;
  position: number;
}

interface TodoRow {
  id: number;
  text: string;
  completed: number;
  position: number;
  due_at: number | null;
  priority: number;
  list_id: number | null;
  created_at: string;
  updated_at: string;
}

interface ListRow {
  id: number;
  name: string;
  position: number;
}

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed === 1,
    position: row.position,
    dueAt: row.due_at,
    priority: row.priority === 1,
    listId: row.list_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TODO_COLUMNS = `id, text, completed, position, due_at, priority, list_id,
       created_at, updated_at`;

@Injectable()
export class TodosService {
  constructor(private readonly db: DbService) {}

  // --- todos ----------------------------------------------------------------

  /**
   * Todos, ordered by their manual position.
   *
   * `filter` narrows by done-ness and `listId` by list; sorting by due date or
   * creation is the client's job, because the manual order is the only one the
   * server owns and the others are pure functions of fields it already returns.
   */
  findAll(filter?: 'active' | 'completed', listId?: number): Todo[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter === 'active') where.push('completed = 0');
    else if (filter === 'completed') where.push('completed = 1');
    if (listId !== undefined) {
      where.push('list_id = @listId');
      params.listId = listId;
    }
    const sql =
      `SELECT ${TODO_COLUMNS} FROM todos` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY position ASC, id ASC';
    return (this.db.db.prepare(sql).all(params) as TodoRow[]).map(toTodo);
  }

  create(dto: CreateTodoDto): Todo {
    if (dto.listId !== undefined && dto.listId !== null) {
      this.assertListExists(dto.listId);
    }
    const maxRow = this.db.db
      .prepare('SELECT MAX(position) as max_pos FROM todos')
      .get() as { max_pos: number | null };
    const position = (maxRow.max_pos ?? 0) + 1;

    const info = this.db.db
      .prepare(
        `INSERT INTO todos (text, completed, position, due_at, priority, list_id)
         VALUES (@text, 0, @position, @dueAt, @priority, @listId)`,
      )
      .run({
        text: dto.text,
        position,
        dueAt: dto.dueAt ?? null,
        priority: dto.priority ? 1 : 0,
        listId: dto.listId ?? null,
      });

    return this.get(Number(info.lastInsertRowid));
  }

  update(id: number, dto: UpdateTodoDto): Todo {
    const existing = this.db.db
      .prepare('SELECT id FROM todos WHERE id = ?')
      .get(id);
    if (!existing) throw new NotFoundException(`Todo ${id} not found`);
    if (dto.listId !== undefined && dto.listId !== null) {
      this.assertListExists(dto.listId);
    }

    const fields: string[] = [];
    const values: Record<string, unknown> = { id };
    const set = (column: string, key: string, value: unknown) => {
      fields.push(`${column} = @${key}`);
      values[key] = value;
    };

    if (dto.text !== undefined) set('text', 'text', dto.text);
    if (dto.completed !== undefined)
      set('completed', 'completed', dto.completed ? 1 : 0);
    if (dto.priority !== undefined)
      set('priority', 'priority', dto.priority ? 1 : 0);
    // `null` clears these, so both check `undefined` rather than falsiness: "no
    // due date" and "not filed" are values, not absences.
    if (dto.dueAt !== undefined) set('due_at', 'dueAt', dto.dueAt ?? null);
    if (dto.listId !== undefined) set('list_id', 'listId', dto.listId ?? null);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    this.db.db
      .prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = @id`)
      .run(values);

    return this.get(id);
  }

  /**
   * Reorder, treating `ids` as a **relative** reordering of a subset.
   *
   * The old implementation wrote positions 1..N for whatever ids it was handed,
   * which is wrong whenever the client shows a filtered or per-list view: the
   * Active tab hands over only its own ids and stamps 1..N over the top of the
   * completed ones, leaving two todos sharing position 3 and `ORDER BY position`
   * free to pick either. It looked like it worked because the visible list was
   * exactly the one being renumbered.
   *
   * Instead: normalise the whole table to 1..N, find the slots the given ids
   * currently occupy, and place them into those same slots in their new order.
   * Rows the client cannot see keep their exact places.
   */
  reorder(ids: number[]): void {
    const update = this.db.db.prepare(
      'UPDATE todos SET position = @position WHERE id = @id',
    );

    this.db.db.transaction((idList: number[]) => {
      const all = this.db.db
        .prepare('SELECT id FROM todos ORDER BY position ASC, id ASC')
        .all() as { id: number }[];

      // Normalise first, so "the slot a row occupies" is a meaningful number even
      // if the table arrived with ties.
      all.forEach((row, index) =>
        update.run({ position: index + 1, id: row.id }),
      );

      const known = new Set(all.map((row) => row.id));
      const requested = idList.filter((id) => known.has(id));
      const requestedSet = new Set(requested);
      const slots = all
        .map((row, index) => ({ id: row.id, position: index + 1 }))
        .filter((slot) => requestedSet.has(slot.id))
        .map((slot) => slot.position);

      requested.forEach((id, index) => {
        update.run({ position: slots[index], id });
      });
    })(ids);
  }

  remove(id: number): void {
    const info = this.db.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundException(`Todo ${id} not found`);
  }

  /**
   * Delete every completed todo, optionally within one list.
   *
   * One statement rather than N deletes from the client: "clear completed" is a
   * single intent, and row-by-row means a half-cleared list if one call fails.
   */
  clearCompleted(listId?: number): { deleted: number } {
    const sql =
      'DELETE FROM todos WHERE completed = 1' +
      (listId !== undefined ? ' AND list_id = @listId' : '');
    const info = this.db.db
      .prepare(sql)
      .run(listId !== undefined ? { listId } : {});
    return { deleted: info.changes };
  }

  private get(id: number): Todo {
    const row = this.db.db
      .prepare(`SELECT ${TODO_COLUMNS} FROM todos WHERE id = ?`)
      .get(id) as TodoRow;
    return toTodo(row);
  }

  // --- lists ----------------------------------------------------------------

  findLists(): TodoList[] {
    return this.db.db
      .prepare(
        'SELECT id, name, position FROM todo_lists ORDER BY position ASC, id ASC',
      )
      .all() as ListRow[];
  }

  createList(dto: CreateListDto): TodoList {
    const maxRow = this.db.db
      .prepare('SELECT MAX(position) as max_pos FROM todo_lists')
      .get() as { max_pos: number | null };
    const info = this.db.db
      .prepare(
        'INSERT INTO todo_lists (name, position) VALUES (@name, @position)',
      )
      .run({ name: dto.name, position: (maxRow.max_pos ?? 0) + 1 });
    return this.getList(Number(info.lastInsertRowid));
  }

  updateList(id: number, dto: UpdateListDto): TodoList {
    this.assertListExists(id);
    if (dto.name !== undefined) {
      this.db.db
        .prepare('UPDATE todo_lists SET name = @name WHERE id = @id')
        .run({ name: dto.name, id });
    }
    return this.getList(id);
  }

  /**
   * Delete a list and unfile its todos, in one transaction.
   *
   * Deliberately not `ON DELETE CASCADE`: `PRAGMA foreign_keys` is never enabled
   * on this connection, so a cascade in the schema would do nothing at all. And
   * unfiling is the right behaviour regardless — deleting a list should not
   * silently delete the work in it.
   */
  removeList(id: number): { unfiled: number } {
    this.assertListExists(id);
    return this.db.db.transaction((listId: number) => {
      const info = this.db.db
        .prepare('UPDATE todos SET list_id = NULL WHERE list_id = ?')
        .run(listId);
      this.db.db.prepare('DELETE FROM todo_lists WHERE id = ?').run(listId);
      return { unfiled: info.changes };
    })(id);
  }

  private getList(id: number): TodoList {
    return this.db.db
      .prepare('SELECT id, name, position FROM todo_lists WHERE id = ?')
      .get(id) as ListRow;
  }

  private assertListExists(id: number): void {
    const row = this.db.db
      .prepare('SELECT id FROM todo_lists WHERE id = ?')
      .get(id);
    if (!row) throw new NotFoundException(`List ${id} not found`);
  }
}
