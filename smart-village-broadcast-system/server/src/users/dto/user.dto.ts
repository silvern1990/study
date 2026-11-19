import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PushPlatform, UserRole } from '../user.entity.js';

export class CreateUserDto {
  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsIn(['admin', 'resident'])
  role?: UserRole;
}

export class UpdatePushTokenDto {
  @IsIn(['ios', 'android'])
  platform: PushPlatform;

  @IsOptional()
  @IsString()
  pushToken?: string;

  /** iOS 전용 PushKit 토큰 */
  @IsOptional()
  @IsString()
  voipPushToken?: string;
}
