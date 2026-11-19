import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRecordingDto {
  @IsString()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  createdById?: number;
}
