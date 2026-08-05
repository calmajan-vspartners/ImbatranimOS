import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const MAX_NAME = 100;

export class CreateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  name: string;
}

export class UpdateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME)
  @IsOptional()
  name?: string;
}
