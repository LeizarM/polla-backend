import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { MatchdaysService } from '../matchdays/matchdays.service';
import { FinalBetsService } from '../final-bets/final-bets.service';

// Color palette for PDF — vivid, modern, high-contrast
const C = {
  // Brand
  primary:    '#1D4ED8',   // royal blue
  primaryDk:  '#1E3A8A',   // deep navy
  accent:     '#3B82F6',   // bright blue
  // Metals (for podium / winners)
  gold:       '#D4A017',
  goldLt:     '#FEF3C7',
  silver:     '#94A3B8',
  silverLt:   '#F1F5F9',
  bronze:     '#CD7F32',
  bronzeLt:   '#FED7AA',
  // Surfaces
  bg:         '#F8FAFC',
  surface:    '#FFFFFF',
  headerBg:   '#1D4ED8',
  headerBgDk: '#1E3A8A',
  headerText: '#FFFFFF',
  rowEven:    '#FFFFFF',
  rowOdd:     '#F1F5F9',
  rowWinner:  '#FEF3C7',
  rowGold:    '#FFFBEB',
  rowSilver:  '#F8FAFC',
  rowBronze:  '#FEF3E2',
  border:     '#CBD5E1',
  borderSoft: '#E2E8F0',
  // Text
  text:       '#0F172A',
  textMuted:  '#475569',
  muted:      '#64748B',
  // Semantic
  danger:     '#DC2626',
  dangerLt:   '#FEE2E2',
  success:    '#10B981',
  successLt:  '#D1FAE5',
  warning:    '#F59E0B',
  warningLt:  '#FEF3C7',
};

/**
 * Smart money formatter — no decimals if integer, 2 decimals otherwise.
 *   formatMoney(10)    → "10"
 *   formatMoney(7.5)   → "7.50"
 *   formatMoney(2.50)  → "2.50"
 */
function formatMoney(amount: number | string | null | undefined): string {
  const num = Number(amount ?? 0);
  const rounded = Math.round(num * 100) / 100;
  return rounded === Math.trunc(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(2);
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private matchdaysService: MatchdaysService,
    private finalBetsService: FinalBetsService,
  ) {}

  private async getAppSettings(): Promise<{ app_title: string; logo_url: string }> {
    try {
      const settings = await this.prisma.app_setting.findMany();
      const map = new Map(settings.map(s => [s.key, s.value]));
      return {
        app_title: map.get('app_title') || 'Mundial 2026',
        logo_url: map.get('logo_url') || '',
      };
    } catch {
      return { app_title: 'Mundial 2026', logo_url: '' };
    }
  }

  private drawPdfHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string, appTitle: string) {
    const W = doc.page.width;
    const barH = 70;

    // Gradient-like layered header (deep navy → royal blue → bright blue)
    doc.rect(0, 0, W, barH).fill(C.headerBgDk);
    doc.rect(0, 0, W * 0.7, barH).fill(C.headerBg);
    doc.rect(0, 0, W * 0.35, barH).fill(C.primary);

    // Decorative gold accent stripe at the very top
    doc.rect(0, 0, W, 3).fill(C.gold);

    // App title (white, bold) — centered for a cleaner look
    doc.fontSize(22).font('Helvetica-Bold').fillColor(C.headerText)
      .text(appTitle, 40, 18, { width: W - 80, align: 'center' });
    // Date (light blue subtitle) — also centered
    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(10).font('Helvetica').fillColor('#BFDBFE')
      .text(dateStr, 40, 46, { width: W - 80, align: 'center' });

    // Title section below header bar — explicit x + width so it centers across
    // the FULL page width (no badge squeezing it to the right).
    const titleY = barH + 18;
    doc.fontSize(18).font('Helvetica-Bold').fillColor(C.primaryDk)
      .text(title, 40, titleY, { width: W - 80, align: 'center' });
    if (subtitle) {
      // Use the next-line Y from the title (lineGap = ~6)
      const subY = doc.y + 2;
      doc.fontSize(12).font('Helvetica').fillColor(C.muted)
        .text(subtitle, 40, subY, { width: W - 80, align: 'center' });
    }
    doc.moveDown(0.5);

    // Triple-color accent bar
    const lineY = doc.y;
    const segW = (W - 80) / 3;
    doc.rect(40,            lineY, segW, 3).fill(C.primary);
    doc.rect(40 + segW,     lineY, segW, 3).fill(C.accent);
    doc.rect(40 + 2 * segW, lineY, segW, 3).fill(C.gold);
    doc.y = lineY + 12;
  }

  private drawStatsBox(doc: PDFKit.PDFDocument, stats: { label: string; value: string; color?: string }[]) {
    const boxX = 40;
    const boxW = doc.page.width - 80;
    const boxH = 56;
    const y = doc.y;

    // Card background with subtle shadow effect (two layers)
    doc.roundedRect(boxX + 2, y + 2, boxW, boxH, 8).fill('#CBD5E120'); // shadow
    doc.roundedRect(boxX, y, boxW, boxH, 8).fill(C.surface);
    doc.roundedRect(boxX, y, boxW, boxH, 8).lineWidth(1).stroke(C.borderSoft);

    // Top accent stripe
    doc.rect(boxX, y, boxW, 3).fill(C.primary);

    const colW = boxW / stats.length;
    stats.forEach((s, i) => {
      const cx = boxX + i * colW;
      const valueColor = s.color ?? C.primaryDk;
      // Value (big number)
      doc.fontSize(15).font('Helvetica-Bold').fillColor(valueColor)
        .text(s.value, cx + 6, y + 14, { width: colW - 12, align: 'center' });
      // Label
      doc.fontSize(8).font('Helvetica').fillColor(C.muted)
        .text(s.label.toUpperCase(), cx + 6, y + 36, { width: colW - 12, align: 'center', characterSpacing: 0.5 });
      // Column divider (except first)
      if (i > 0) {
        doc.moveTo(cx, y + 12).lineTo(cx, y + boxH - 8).lineWidth(0.5).stroke(C.borderSoft);
      }
    });
    doc.y = y + boxH + 14;
  }

  private drawGridHeader(doc: PDFKit.PDFDocument, headers: string[], colWidths: number[], startX = 40) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const y = doc.y;
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const rowH = 22;

    // Header bg with gradient-like effect (two layers)
    doc.roundedRect(startX, y, totalW, rowH, 4).fill(C.primaryDk);
    doc.roundedRect(startX, y, totalW * 0.7, rowH, 4).fill(C.primary);

    let x = startX;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.headerText);
    headers.forEach((h, i) => {
      doc.text(h.toUpperCase(), x + 4, y + 7, {
        width: colWidths[i] - 8,
        align: i === 1 ? 'left' : 'center',
        characterSpacing: 0.4,
      });
      x += colWidths[i];
    });
    doc.y = y + rowH;
    doc.fillColor(C.text);
  }

  /**
   * Draw a grid row with optional highlight types:
   *   'gold' / 'silver' / 'bronze' → podium row with metallic tint
   *   'winner' → general winner highlight (legacy)
   *   undefined → normal alternating row
   */
  private drawGridRow(
    doc: PDFKit.PDFDocument,
    cells: string[],
    colWidths: number[],
    rowIndex: number,
    highlight?: boolean | 'gold' | 'silver' | 'bronze',
    startX = 40,
  ) {
    if (doc.y > doc.page.height - 30) doc.addPage();
    const y = doc.y;
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const rowH = 20;

    // Choose row background based on highlight type
    let bg: string;
    let textColor: string = C.text;
    let leftAccent: string | null = null;
    if (highlight === 'gold') {
      bg = C.rowGold;
      textColor = C.text;
      leftAccent = C.gold;
    } else if (highlight === 'silver') {
      bg = C.rowSilver;
      leftAccent = C.silver;
    } else if (highlight === 'bronze') {
      bg = C.rowBronze;
      leftAccent = C.bronze;
    } else if (highlight === true) {
      bg = C.rowWinner;
      textColor = C.text;
      leftAccent = C.gold;
    } else {
      bg = rowIndex % 2 === 0 ? C.rowEven : C.rowOdd;
    }

    // Row background
    doc.rect(startX, y, totalW, rowH).fill(bg);
    // Left accent stripe (for podium rows)
    if (leftAccent) {
      doc.rect(startX, y, 3, rowH).fill(leftAccent);
    }
    // Bottom border
    doc.moveTo(startX, y + rowH).lineTo(startX + totalW, y + rowH).lineWidth(0.4).stroke(C.borderSoft);

    let x = startX;
    const isBold = highlight === 'gold' || highlight === 'silver' || highlight === 'bronze' || highlight === true;
    doc.fontSize(8).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(textColor);
    cells.forEach((c, i) => {
      doc.text(c, x + 5, y + 6, { width: colWidths[i] - 10, align: i === 1 ? 'left' : 'center' });
      x += colWidths[i];
    });
    doc.y = y + rowH;
    doc.fillColor(C.text);
  }

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string, color = C.primary, _legacyIcon = '') {
    // _legacyIcon kept for backwards compatibility but ignored — PDFKit Helvetica
    // doesn't render Unicode emojis; we use a styled colored bar instead.
    doc.moveDown(0.5);
    const y = doc.y;
    // Colored left bar
    doc.rect(40, y + 2, 4, 16).fill(color);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(color)
      .text(title, 50, y, { width: doc.page.width - 90 });
    doc.moveDown(0.35);
    doc.fillColor(C.text);
  }

  private drawFooter(doc: PDFKit.PDFDocument) {
    doc.moveDown(1.5);
    const y = doc.y;
    const W = doc.page.width;
    doc.moveTo(40, y).lineTo(W - 40, y).lineWidth(0.5).stroke(C.borderSoft);
    doc.moveDown(0.4);
    // Formato solicitado: dd/MM/yyyy HH:mm
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    doc.fontSize(7).font('Helvetica').fillColor(C.muted)
      .text(`Documento generado automaticamente  |  ${stamp}`, { align: 'center' });
  }

  /** Generate PDF for a single matchday report */
  async generateMatchdayPdf(matchdayId: string): Promise<Buffer> {
    const report = await this.matchdaysService.getReport(matchdayId);
    const winners = await this.matchdaysService.getWinners(matchdayId);
    const appSettings = await this.getAppSettings();

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const mdName = report?.matchday?.name ?? 'Jornada';
      const tournName = report?.matchday?.tournament_name ?? '';
      const cur = report?.matchday?.currency ?? 'Bs';
      this.drawPdfHeader(doc, `Reporte de ${mdName}`, tournName, appSettings.app_title);

      // Stats box with semantic colors
      this.drawStatsBox(doc, [
        { label: 'Apuesta',    value: `${cur} ${report?.matchday?.bet_per_matchday ?? 0}`,  color: C.primary },
        { label: 'Apostaron',  value: String(report?.stats?.users_bet ?? 0),                  color: C.success },
        { label: 'Pendientes', value: String(report?.stats?.users_pending ?? 0),              color: C.warning },
        { label: 'Pozo total', value: `${cur} ${Number(report?.stats?.pool_collected ?? 0).toFixed(2)}`, color: C.gold },
      ]);

      // Users who bet
      this.drawSectionTitle(doc, 'Participantes que Apostaron', C.success);
      if ((report?.users_bet?.length ?? 0) > 0) {
        // Privacidad: NO mostramos usuario (@) ni telefono en los reportes.
        const headers = ['#', 'Nombre', 'Aciertos', 'Premio', 'Estado'];
        const widths = [30, 250, 60, 70, 70];
        this.drawGridHeader(doc, headers, widths);
        (report?.users_bet ?? []).forEach((u: any, i: number) => {
          const isWinner = u?.status === 'won';
          // Top 3 winners get podium tint via row color (no emoji icons — PDFKit
          // Helvetica doesn't render Unicode emojis cleanly).
          const highlight = isWinner
            ? (i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : (true as any))
            : undefined;
          this.drawGridRow(doc, [
            String(i + 1),
            u?.full_name ?? '-',
            String(u?.total_correct ?? '-'),
            (u?.prize_won ?? 0) > 0 ? `${cur} ${Number(u.prize_won).toFixed(2)}` : '-',
            u?.status === 'won' ? 'GANADOR' : (u?.status ?? '-'),
          ], widths, i, highlight as any);
        });
      } else {
        doc.fontSize(9).font('Helvetica').fillColor(C.muted).text('No hay apuestas registradas en esta jornada');
      }

      // Pending users
      if ((report?.pending_users?.length ?? 0) > 0) {
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'No Apostaron', C.danger);
        // Privacidad: solo numero y nombre (sin usuario ni telefono).
        const pHeaders = ['#', 'Nombre'];
        const pWidths = [40, 410];
        this.drawGridHeader(doc, pHeaders, pWidths);
        (report?.pending_users ?? []).forEach((u: any, i: number) => {
          this.drawGridRow(doc, [String(i + 1), u?.full_name ?? '-'], pWidths, i);
        });
      }

      // Winners callout box
      if (winners?.winners?.length > 0) {
        doc.moveDown(0.6);
        const y = doc.y;
        const W = doc.page.width;
        // Gold callout box
        doc.roundedRect(40, y, W - 80, 60, 8).fill(C.goldLt);
        doc.rect(40, y, 4, 60).fill(C.gold);
        doc.fontSize(13).font('Helvetica-Bold').fillColor(C.gold)
          .text(`${winners?.winners?.length === 1 ? 'GANADOR' : 'GANADORES'} DE LA JORNADA`, 60, y + 10);
        doc.fontSize(9).font('Helvetica').fillColor(C.text)
          .text(`Maximo aciertos: ${winners?.max_correct ?? 0}  |  Premio por ganador: ${cur} ${Number(winners?.prize_per_winner ?? 0).toFixed(2)}`, 60, y + 30);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(C.primaryDk)
          .text((winners?.winners ?? []).map((w: any) => `${w?.full_name ?? '-'}`).join('   |   '),
                60, y + 44, { width: W - 100 });
        doc.y = y + 70;
      }

      this.drawFooter(doc);
      doc.end();
    });
  }

  /** Get accumulated report as JSON */
  async getAccumulatedReport(tournamentId: string, userId?: string, userRole?: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { matchdays: { orderBy: { date: 'asc' } } },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');

    // SEGURIDAD: solo admins o participantes APROBADOS del torneo pueden ver el
    // ranking acumulado. Antes cualquier usuario autenticado podía enumerar el
    // roster (nombres) de CUALQUIER torneo por ID.
    if (userRole !== 'admin') {
      const part = userId
        ? await this.prisma.tournament_participant.findUnique({
            where: { user_id_tournament_id: { user_id: userId, tournament_id: tournamentId } },
          })
        : null;
      if (!part || part.status !== 'approved') {
        throw new ForbiddenException('No estás inscrito en este torneo');
      }
    }

    const matchdays = tournament.matchdays;
    const allTickets = await this.prisma.ticket.findMany({
      where: { matchday_id: { in: matchdays.map(m => m.id) }, amount_bet: { gt: 0 } },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        // Include picks WITH each pick's match.result so we can compute live
        // even when is_correct flag in the DB is stale or null.
        ticket_picks: {
          select: {
            is_correct: true,
            pick: true,
            match: { select: { result: true } },
          },
        },
      },
    });

    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: { user: { select: { id: true, username: true, full_name: true } } },
    });

    const userMap = new Map<string, {
      full_name: string; username: string;
      perMatchday: Record<string, number>;
      perMatchdayPrize: Record<string, number>;
      totalCorrect: number; totalPrize: number;
    }>();
    for (const p of participants) {
      if (!userMap.has(p.user_id)) {
        userMap.set(p.user_id, {
          full_name: p.user?.full_name ?? '', username: p.user?.username ?? '',
          perMatchday: {}, perMatchdayPrize: {},
          totalCorrect: 0, totalPrize: 0,
        });
      }
    }
    for (const t of allTickets) {
      if (!userMap.has(t.user_id)) {
        userMap.set(t.user_id, {
          full_name: t.user?.full_name ?? '', username: t.user?.username ?? '',
          perMatchday: {}, perMatchdayPrize: {},
          totalCorrect: 0, totalPrize: 0,
        });
      }
      const u = userMap.get(t.user_id)!;
      // Live-compute total_correct by comparing each pick to its match's actual
      // result. We DON'T trust is_correct because it can be null when the score
      // was entered before the per-match update logic was deployed.
      const picks = (t as any).ticket_picks ?? [];
      let liveCorrect = 0;
      for (const p of picks) {
        const result = p?.match?.result;
        // Only count if the match has a result AND the pick matches it
        if (result && p?.pick && p.pick === result) liveCorrect++;
      }
      // Fall back to stored value only when no picks exist at all
      const finalCorrect = picks.length > 0 ? liveCorrect : (t.total_correct ?? 0);
      u.perMatchday[t.matchday_id]      = finalCorrect;
      u.perMatchdayPrize[t.matchday_id] = Number(t.prize_won ?? 0);
      u.totalCorrect += finalCorrect;
      u.totalPrize   += Number(t.prize_won ?? 0);
    }

    const ranking = Array.from(userMap.entries()).map(([uid, u]) => ({ uid, ...u }))
      .sort((a, b) =>
        b.totalPrize - a.totalPrize ||          // 1º mayor dinero
        b.totalCorrect - a.totalCorrect ||      // 2º más aciertos
        (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es'), // 3º alfabético
      );

    const openMatchdays = matchdays.filter(m => m.status === 'open');
    const pendingByMatchday: Record<string, { full_name: string; username: string }[]> = {};
    for (const md of openMatchdays) {
      const ticketUserIds = new Set(allTickets.filter(t => t.matchday_id === md.id).map(t => t.user_id));
      const pending = participants.filter(p => !ticketUserIds.has(p.user_id)).map(p => ({ full_name: p.user?.full_name ?? '', username: p.user?.username ?? '' }));
      if (pending.length > 0) pendingByMatchday[md.id] = pending;
    }

    return {
      tournament: { id: tournament.id, name: tournament.name, bet_per_matchday: Number(tournament.bet_per_matchday), currency: tournament.currency ?? 'Bs' },
      matchdays: matchdays.map((m, i) => ({ id: m.id, name: m.name, label: `J${i + 1}`, date: m.date, status: m.status })),
      ranking,
      pending_by_matchday: pendingByMatchday,
    };
  }

  /** Generate accumulated PDF with J1, J2, ... JN columns per user */
  async generateTournamentAccumulatedPdf(tournamentId: string): Promise<Buffer> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { matchdays: { orderBy: { date: 'asc' } } },
    });
    if (!tournament) throw new NotFoundException('Torneo no encontrado');
    const appSettings = await this.getAppSettings();

    const matchdays = tournament.matchdays;
    const allTickets = await this.prisma.ticket.findMany({
      where: { matchday_id: { in: matchdays.map(m => m.id) }, amount_bet: { gt: 0 } },
      include: { user: { select: { id: true, username: true, full_name: true, phone: true } } },
    });

    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: { user: { select: { id: true, username: true, full_name: true, phone: true } } },
    });

    // Mantenemos perMatchday (aciertos) para detectar al ganador de cada jornada,
    // y perMatchdayPrize (premio en dinero) para mostrar en la celda según pedido.
    const userMap = new Map<string, {
      full_name: string; username: string; phone: string;
      perMatchday: Map<string, number>;
      perMatchdayPrize: Map<string, number>;
      totalCorrect: number; totalPrize: number;
    }>();

    for (const p of participants) {
      if (!userMap.has(p.user_id)) {
        userMap.set(p.user_id, {
          full_name: p.user?.full_name ?? '-', username: p.user?.username ?? '-',
          phone: (p.user as any)?.phone ?? '-',
          perMatchday: new Map(),
          perMatchdayPrize: new Map(),
          totalCorrect: 0, totalPrize: 0,
        });
      }
    }

    for (const t of allTickets) {
      if (!userMap.has(t.user_id)) {
        userMap.set(t.user_id, {
          full_name: t.user?.full_name ?? '-', username: t.user?.username ?? '-',
          phone: (t.user as any)?.phone ?? '-',
          perMatchday: new Map(),
          perMatchdayPrize: new Map(),
          totalCorrect: 0, totalPrize: 0,
        });
      }
      const u = userMap.get(t.user_id)!;
      const correct = t.total_correct ?? 0;
      const prize   = Number(t.prize_won ?? 0);
      u.perMatchday.set(t.matchday_id, correct);
      u.perMatchdayPrize.set(t.matchday_id, prize);
      u.totalCorrect += correct;
      u.totalPrize   += prize;
    }

    const ranking = Array.from(userMap.entries())
      .map(([uid, u]) => ({ uid, ...u }))
      // Ordenamos por dinero (ya que ahora mostramos dinero), de mayor a menor.
      .sort((a, b) => b.totalPrize - a.totalPrize || b.totalCorrect - a.totalCorrect);

    const openMatchdays = matchdays.filter(m => m.status === 'open');
    const pendingByMatchday = new Map<string, { full_name: string; username: string }[]>();
    for (const md of openMatchdays) {
      const ticketUserIds = new Set(allTickets.filter(t => t.matchday_id === md.id).map(t => t.user_id));
      const pending = participants.filter(p => !ticketUserIds.has(p.user_id))
        .map(p => ({ full_name: p.user?.full_name ?? '-', username: p.user?.username ?? '-' }));
      if (pending.length > 0) pendingByMatchday.set(md.id, pending);
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cur2 = tournament.currency ?? 'Bs';
      const totalPrizeAll = ranking.reduce((s, u) => s + (u.totalPrize ?? 0), 0);

      this.drawPdfHeader(doc, 'Reporte Acumulado por Jornada', tournament.name, appSettings.app_title);

      this.drawStatsBox(doc, [
        { label: 'Apuesta/Jornada', value: `${cur2} ${Number(tournament.bet_per_matchday)}`, color: C.primary },
        { label: 'Jornadas',        value: String(matchdays.length),                          color: C.accent },
        { label: 'Participantes',   value: String(ranking.length),                            color: C.primaryDk },
        { label: 'Pozo repartido',  value: `${cur2} ${formatMoney(totalPrizeAll)}`,             color: C.success },
      ]);

      // Per-matchday winner detection (max aciertos per jornada)
      const maxByMd = new Map<string, number>();
      for (const md of matchdays) {
        let max = 0;
        for (const u of ranking) {
          const v = u.perMatchday.get(md.id) ?? 0;
          if (v > max) max = v;
        }
        if (max > 0) maxByMd.set(md.id, max);
      }

      // ─── Tabla con paginación horizontal ──────────────────────────────────
      // Para no cortar con N jornadas grandes (ej. 40), partimos las
      // jornadas en chunks. En cada chunk repetimos las columnas fijas
      // (#, Participante, Ganado) y mostramos un subconjunto de jornadas.
      //
      // Decisión de tamaño:
      //   - mdColW fijo en 56 (suficiente para "Bs 30" / "Bs 7.5")
      //   - Calculamos cuántas jornadas caben por página para el ancho disponible.
      // ───────────────────────────────────────────────────────────────────────
      const mdColW    = 56;                 // ancho por columna de jornada (dinero)
      const posW      = 32;
      const nameW     = 130;
      const ganadoW   = 70;
      const pageWAvail = doc.page.width - 80; // márgenes 40px a cada lado
      const fixedW    = posW + nameW + ganadoW;
      const mdPerPage = Math.max(1, Math.floor((pageWAvail - fixedW) / mdColW));

      // Chunks de matchdays — cada chunk va en una página horizontal nueva
      // Renombrado a `mdChunks` para no chocar con `chunks: Buffer[]` del doc stream
      const mdChunks: { start: number; end: number; mds: typeof matchdays }[] = [];
      for (let i = 0; i < matchdays.length; i += mdPerPage) {
        mdChunks.push({
          start: i,
          end:   Math.min(i + mdPerPage, matchdays.length),
          mds:   matchdays.slice(i, i + mdPerPage),
        });
      }
      // Si por alguna razón no hay jornadas, al menos un chunk vacío.
      if (mdChunks.length === 0) mdChunks.push({ start: 0, end: 0, mds: [] });

      this.drawSectionTitle(doc, 'Tabla Acumulada (Dinero Ganado por Jornada)', C.primary);

      mdChunks.forEach((chunk, chunkIdx) => {
        // Nueva página por cada chunk SALVO el primero (que va en la página actual)
        if (chunkIdx > 0) doc.addPage();

        // Sub-título indicando el rango de jornadas de esta sección
        if (mdChunks.length > 1) {
          const rangeLabel =
            chunk.mds.length === 1
              ? `Jornada ${chunk.start + 1}`
              : `Jornadas ${chunk.start + 1} a ${chunk.end}`;
          doc.fontSize(10).font('Helvetica-Bold').fillColor(C.primary)
            .text(`${rangeLabel}  ·  Página ${chunkIdx + 1} de ${mdChunks.length}`, 40, doc.y);
          doc.moveDown(0.4);
        }

        // Headers para este chunk
        const mdHeaders = chunk.mds.map((_, i) => `J${chunk.start + i + 1}`);
        const headers   = ['#', 'Participante', ...mdHeaders, 'Ganado'];
        const colWidths = [posW, nameW, ...chunk.mds.map(() => mdColW), ganadoW];

        this.drawGridHeader(doc, headers, colWidths);

        // Filas
        ranking.forEach((u, i) => {
          const pos = i + 1;
          const mdValues = chunk.mds.map(md => {
            const correct = u.perMatchday.get(md.id);
            const prize   = u.perMatchdayPrize.get(md.id) ?? 0;
            // Sin ticket en esa jornada → guión
            if (correct === undefined) return '-';
            // Detectar si ganó la jornada (más aciertos del grupo)
            const isWinner = correct === (maxByMd.get(md.id) ?? -1) && correct > 0;
            // Si ganó algo de dinero, mostramos el monto; sino "0"
            const moneyStr = prize > 0 ? `${cur2} ${formatMoney(prize)}` : '0';
            return isWinner ? `*${moneyStr}` : moneyStr;
          });
          const highlight: 'gold' | 'silver' | 'bronze' | undefined =
            pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : undefined;

          this.drawGridRow(doc, [
            String(pos),
            u.full_name,
            ...mdValues,
            u.totalPrize > 0 ? `${cur2} ${formatMoney(u.totalPrize)}` : '-',
          ], colWidths, i, highlight);
        });

        // Leyenda solo en el último chunk para no repetirla
        if (chunkIdx === mdChunks.length - 1) {
          doc.moveDown(0.4);
          const legendY = doc.y;
          let legendX = 40;
          const drawLegendItem = (color: string, label: string) => {
            doc.rect(legendX, legendY + 3, 8, 8).fill(color);
            doc.fontSize(8).font('Helvetica').fillColor(C.muted)
              .text(label, legendX + 12, legendY + 3, { continued: false });
            legendX += doc.widthOfString(label) + 24;
          };
          drawLegendItem(C.gold,   '1er lugar');
          drawLegendItem(C.silver, '2do lugar');
          drawLegendItem(C.bronze, '3er lugar');
          doc.fontSize(8).font('Helvetica-Bold').fillColor(C.gold)
            .text('* = Ganador de la jornada', legendX, legendY + 3);
          doc.y = legendY + 16;
        }
      });

      // Pending users
      if (pendingByMatchday.size > 0) {
        doc.moveDown(0.4);
        this.drawSectionTitle(doc, 'Usuarios que No Han Apostado', C.danger);
        for (const md of openMatchdays) {
          const pending = pendingByMatchday.get(md.id);
          if (!pending || pending.length === 0) continue;
          doc.fontSize(10).font('Helvetica-Bold').fillColor(C.primaryDk)
            .text(`${md.name} `, { continued: true })
            .fontSize(8).font('Helvetica').fillColor(C.muted)
            .text(`(${new Date(md.date).toLocaleDateString('es-MX')}) - ${pending.length} pendiente${pending.length === 1 ? '' : 's'}`);
          doc.fontSize(8).font('Helvetica').fillColor(C.text);
          // Privacidad: sin (@usuario) en el listado de pendientes.
          pending.forEach((p, i) => {
            doc.text(`   ${i + 1}.  ${p.full_name}`);
          });
          doc.moveDown(0.3);
        }
      }

      this.drawFooter(doc);
      doc.end();
    });
  }

  /** Generate PDF for polla final report */
  async generatePollaFinalPdf(tournamentId: string): Promise<Buffer> {
    const report = await this.finalBetsService.getReport(tournamentId);
    const appSettings = await this.getAppSettings();

    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: { user: { select: { id: true, username: true, full_name: true, phone: true } } },
    });
    const betUserIds = new Set((report?.bets ?? []).map((b: any) => b?.user_id));
    const pendingUsers = participants
      .filter(p => !betUserIds.has(p.user_id))
      .map(p => ({ full_name: p.user?.full_name ?? '-', username: p.user?.username ?? '-', phone: (p.user as any)?.phone ?? '-' }));

    const teamMap = new Map<string, string>();
    for (const t of (report?.quarter_teams ?? [])) {
      teamMap.set(t.id, t.name);
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cur3 = report?.tournament?.currency ?? 'Bs';
      this.drawPdfHeader(doc, 'Reporte Polla Final', report?.tournament?.name ?? '-', appSettings.app_title);

      this.drawStatsBox(doc, [
        { label: 'Apuesta Final/Jornada', value: `${cur3} ${report?.tournament?.bet_final ?? 0}` },
        { label: 'Jornadas', value: String(report?.tournament?.matchday_count ?? 0) },
        { label: 'Apostaron', value: String(report?.participant_count ?? 0) },
        { label: 'Pendientes', value: String(pendingUsers.length) },
        { label: 'Pozo', value: `${cur3} ${Number(report?.pool ?? 0).toFixed(2)}` },
      ]);

      // Quarter teams
      if ((report?.quarter_teams?.length ?? 0) > 0) {
        this.drawSectionTitle(doc, 'Equipos en Cuartos de Final');
        const names = (report?.quarter_teams ?? []).map((t: any) => t?.name ?? '-').join('  *  ');
        doc.fontSize(9).font('Helvetica').fillColor(C.text).text(names);
        doc.moveDown(0.5);
      }

      // Bets table
      this.drawSectionTitle(doc, 'Apuestas de los Participantes');
      if ((report?.bets?.length ?? 0) > 0) {
        const headers = ['#', 'Nombre', 'Campeón', 'Subcampeón', '3er Lugar', '4to Lugar', 'Pts', 'Premio'];
        const colWidths = [30, 130, 105, 105, 95, 95, 40, 60];
        this.drawGridHeader(doc, headers, colWidths);
        (report?.bets ?? []).forEach((b: any, i: number) => {
          const isTop = i < 3;
          this.drawGridRow(doc, [
            String(b?.position ?? '-'), b?.full_name ?? '-',
            teamMap.get(b?.pick_1st) ?? '-', teamMap.get(b?.pick_2nd) ?? '-',
            teamMap.get(b?.pick_3rd) ?? '-', teamMap.get(b?.pick_4th) ?? '-',
            String(b?.total_points ?? 0), `${cur3} ${formatMoney(b?.prize_won ?? 0)}`,
          ], colWidths, i, isTop);
        });
      } else {
        doc.fontSize(9).font('Helvetica').fillColor(C.muted).text('No hay apuestas registradas');
      }

      // Pending users
      if (pendingUsers.length > 0) {
        this.drawSectionTitle(doc, 'No Apostaron en la Polla Final', C.danger);
        // Privacidad: solo numero y nombre (sin usuario ni telefono).
        const pHeaders = ['#', 'Nombre'];
        const pWidths = [40, 460];
        this.drawGridHeader(doc, pHeaders, pWidths);
        pendingUsers.forEach((u, i) => {
          this.drawGridRow(doc, [String(i + 1), u.full_name], pWidths, i);
        });
      }

      this.drawFooter(doc);
      doc.end();
    });
  }
}