import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('groups')
@Controller('api/groups')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all groups' })
  async findAll(
    @Query('tournament_id') tournament_id?: string,
    @Query('status') status?: string,
  ) {
    return this.groupsService.findAll(tournament_id, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get group details' })
  async findOne(@Param('id') id: string) {
    return this.groupsService.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create group (admin)' })
  async create(@Body() data: any) {
    return this.groupsService.create(data);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update group (admin)' })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.groupsService.update(id, data);
  }

  @Patch(':id/results')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update group results (admin)' })
  async updateResults(@Param('id') id: string, @Body() data: any) {
    return this.groupsService.updateResults(id, data);
  }

  @Post(':id/resolve')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Resolve group and distribute prizes (admin)' })
  async resolve(@Param('id') id: string) {
    return this.groupsService.resolve(id);
  }
}
