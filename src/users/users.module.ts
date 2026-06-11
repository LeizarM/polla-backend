import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AvatarController } from './avatar.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, AvatarController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
