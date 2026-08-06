import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The virtual roots the files API serves (see files.service ROOTS). */
const ROOTS = ['home', 'notes'] as const;

export class RecordRecentDto {
  @IsIn(ROOTS)
  root: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  path: string;

  /** Which app recorded the open — reopening routes back to it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appId: string;
}

export class RemoveRecentQueryDto {
  @IsIn(ROOTS)
  root: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  path: string;
}
