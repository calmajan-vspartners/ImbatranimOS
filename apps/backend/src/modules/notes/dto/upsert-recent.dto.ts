import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpsertRecentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  path: string;
}
