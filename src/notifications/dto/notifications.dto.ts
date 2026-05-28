import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'Expo Push Token', example: 'ExponentPushToken[xxxx]' })
  @IsString()
  token: string;

  @ApiPropertyOptional({ description: 'Device type (ios, android)', example: 'android' })
  @IsOptional()
  @IsString()
  device_type?: string;
}

export class SendNotificationDto {
  @ApiProperty({ description: 'User IDs to notify' })
  user_ids: string[];

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @IsString()
  body: string;

  @ApiPropertyOptional({ description: 'Extra data payload' })
  @IsOptional()
  data?: Record<string, any>;
}
