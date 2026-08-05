import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_TEXT } from './create-todo.dto';

/**
 * Every field optional. `null` is meaningful for `dueAt` and `listId` — it clears
 * the due date / unfiles the todo — so the service checks `undefined`, not
 * falsiness.
 */
export class UpdateTodoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT)
  @IsOptional()
  text?: string;

  @IsBoolean()
  @IsOptional()
  completed?: boolean;

  @IsBoolean()
  @IsOptional()
  priority?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  dueAt?: number | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  listId?: number | null;
}
