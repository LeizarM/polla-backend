import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiProperty({ description: 'Key-value map of settings to update', example: { logo_url: 'https://play-lh.googleusercontent.com/Yfp6COYwU1qIkZ7teFVYGh4kHvIe8lEuSZ2Wi4B66BamilN3Vlpurt8MqmHhBPNWUw=w526-h296-rw', app_title: 'My App' } })
  @IsObject()
  settings: Record<string, string>;
}
