import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import type { Response } from 'express';

@ApiTags('Reports (PDF)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('matchday/:id/pdf')
  @ApiOperation({ summary: 'Descargar reporte PDF de una jornada' })
  @ApiProduces('application/pdf')
  async matchdayPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generateMatchdayPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-jornada-${id.slice(0, 8)}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('tournament/:id/accumulated')
  @ApiOperation({ summary: 'Get accumulated report JSON for a tournament' })
  async tournamentAccumulatedJson(@Param('id') id: string) {
    return this.service.getAccumulatedReport(id);
  }

  @Get('tournament/:id/accumulated/pdf')
  @ApiOperation({ summary: 'Descargar reporte acumulado PDF de un torneo' })
  @ApiProduces('application/pdf')
  async tournamentAccumulatedPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generateTournamentAccumulatedPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-acumulado-${id.slice(0, 8)}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('tournament/:id/polla-final/pdf')
  @ApiOperation({ summary: 'Descargar reporte PDF de Polla Final' })
  @ApiProduces('application/pdf')
  async pollaFinalPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePollaFinalPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-polla-final-${id.slice(0, 8)}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
