import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBroadcastDto {
  @IsString()
  @MaxLength(100)
  title: string;

  @IsInt()
  recordingId: number;

  /** 생략하면 내선번호가 있는 전체 사용자 */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  userIds?: number[];

  /** ISO-8601. 지정하면 start 호출 시 이 시각까지 대기 */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  retryDelaySec?: number;

  @IsOptional()
  @IsInt()
  createdById?: number;
}

/** 앱이 방송 수신 화면에서의 사용자 행동을 보고 */
export class BroadcastReportDto {
  @IsInt()
  userId: number;

  @IsIn(['accepted', 'rejected', 'missed'])
  result: 'accepted' | 'rejected' | 'missed';
}
