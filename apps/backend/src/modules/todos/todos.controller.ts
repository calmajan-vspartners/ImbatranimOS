import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TodosService } from './todos.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { ReorderTodosDto } from './dto/reorder-todos.dto';
import { CreateListDto, UpdateListDto } from './dto/list.dto';

/**
 * Session-guarded by the global `SessionAuthGuard`, as it always has been —
 * nothing here is `@Public()`.
 *
 * Route order matters: `lists` and `clear-completed` are declared **before**
 * `:id`, or Nest matches `/todos/lists` against the `:id` route and
 * `ParseIntPipe` 400s on "lists". The pre-existing `reorder` route sits above
 * `:id` for exactly this reason.
 */
@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get('lists')
  findLists() {
    return this.todosService.findLists();
  }

  @Post('lists')
  @HttpCode(HttpStatus.CREATED)
  createList(@Body() dto: CreateListDto) {
    return this.todosService.createList(dto);
  }

  @Patch('lists/:id')
  updateList(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateListDto,
  ) {
    return this.todosService.updateList(id, dto);
  }

  @Delete('lists/:id')
  removeList(@Param('id', ParseIntPipe) id: number) {
    return this.todosService.removeList(id);
  }

  @Get()
  findAll(
    @Query('filter') filter?: 'active' | 'completed',
    @Query('listId') listId?: string,
  ) {
    return this.todosService.findAll(filter, optionalId(listId));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTodoDto) {
    return this.todosService.create(dto);
  }

  @Patch('reorder')
  reorder(@Body() dto: ReorderTodosDto) {
    this.todosService.reorder(dto.ids);
  }

  @Delete('clear-completed')
  clearCompleted(@Query('listId') listId?: string) {
    return this.todosService.clearCompleted(optionalId(listId));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTodoDto) {
    return this.todosService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    this.todosService.remove(id);
  }
}

/**
 * Parse an optional numeric query parameter.
 *
 * By hand rather than with `ParseIntPipe`, because absent must stay absent: "All
 * lists" sends nothing, and a pipe would either 400 or coerce it to 0 — and list 0
 * does not exist, so every todo would vanish.
 *
 * `undefined` is reserved for absent/empty ONLY. A present-but-invalid value
 * (e.g. `listId=abc` or `listId=0`) throws rather than collapsing to
 * `undefined` — otherwise `clearCompleted` would silently widen from "this list"
 * to "ALL lists" and delete across every list.
 */
function optionalId(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new BadRequestException('listId must be a positive integer');
}
