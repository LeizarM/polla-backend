import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { GroupBetsService } from './group-bets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('group-bets')
@Controller('api/group-bets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GroupBetsController {
  constructor(private groupBetsService: GroupBetsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my group bets' })
  async findMyBets(@CurrentUser() user: any) {
    return this.groupBetsService.findMyBets(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Place a group bet' })
  async create(@CurrentUser() user: any, @Body() dto: any) {
    return this.groupBetsService.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group bet details' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.groupBetsService.findOne(user.userId, id);
  }
}
