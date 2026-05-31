import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ReportsService } from './reports.service';
import type { Response } from 'express';

@ApiTags('Reports (PDF)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  // ── PDFs financieros/operativos = ADMIN ONLY ──────────────────────────
  // Exponen quién pagó, pendientes, recaudación. NO deben filtrarse a usuarios.
  // El JSON `accumulated` (abajo) SÍ es público porque alimenta el ranking
  // "Torneo Completo" que ven todos los participantes (solo standings, sin PII).
  @Get('matchday/:id/pdf')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Descargar reporte PDF de una jornada (admin)' })
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
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Descargar reporte acumulado PDF de un torneo (admin)' })
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
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Descargar reporte PDF de Polla Final (admin)' })
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
