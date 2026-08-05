import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Bounded so a row cannot become a document. */
export const MAX_TEXT = 500;

export class CreateTodoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT)
  text: string;

  /** epoch ms, local wall-clock meaning. Null or absent for no due date. */
  @IsInt()
  @Min(0)
  @IsOptional()
  dueAt?: number | null;

  @IsBoolean()
  @IsOptional()
  priority?: boolean;

  /** Null or absent files it under no list. */
  @IsInt()
  @Min(1)
  @IsOptional()
  listId?: number | null;
}
