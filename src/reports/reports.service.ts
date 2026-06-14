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
    if (subtitle && subtitle !== appTitle) {
      // Solo mostramos el subtítulo (nombre del torneo) si NO repite el título
      // grande del header (app_title). Si son iguales, era redundante.
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

  /**
   * Ícono vectorial simple, centrado en (cx, cy). PDFKit usa Helvetica, que NO
   * tiene glifos de íconos, así que los dibujamos a mano con formas.
   */
  private drawStatIcon(doc: PDFKit.PDFDocument, type: string, cx: number, cy: number, color: string) {
    const r = 7;
    doc.save();
    if (type === 'coin') {
      doc.circle(cx, cy, r).lineWidth(1.4).stroke(color);
      doc.circle(cx, cy, r * 0.45).lineWidth(1).stroke(color);
    } else if (type === 'users') {
      doc.circle(cx, cy - r * 0.42, r * 0.4).fill(color);
      doc.path(`M ${cx - r * 0.78} ${cy + r} Q ${cx} ${cy - r * 0.15} ${cx + r * 0.78} ${cy + r} Z`).fill(color);
    } else if (type === 'clock') {
      doc.circle(cx, cy, r).lineWidth(1.4).stroke(color);
      doc.moveTo(cx, cy).lineTo(cx, cy - r * 0.55).lineWidth(1.2).stroke(color);
      doc.moveTo(cx, cy).lineTo(cx + r * 0.45, cy + r * 0.12).lineWidth(1.2).stroke(color);
    } else if (type === 'calendar') {
      doc.roundedRect(cx - r * 0.85, cy - r * 0.65, r * 1.7, r * 1.45, 1.5).lineWidth(1.3).stroke(color);
      doc.moveTo(cx - r * 0.85, cy - r * 0.2).lineTo(cx + r * 0.85, cy - r * 0.2).lineWidth(1).stroke(color);
      doc.moveTo(cx - r * 0.4, cy - r * 0.9).lineTo(cx - r * 0.4, cy - r * 0.45).lineWidth(1.3).stroke(color);
      doc.moveTo(cx + r * 0.4, cy - r * 0.9).lineTo(cx + r * 0.4, cy - r * 0.45).lineWidth(1.3).stroke(color);
    } else if (type === 'trophy') {
      doc.path(`M ${cx - r * 0.65} ${cy - r * 0.75} L ${cx + r * 0.65} ${cy - r * 0.75} L ${cx + r * 0.4} ${cy + r * 0.1} L ${cx - r * 0.4} ${cy + r * 0.1} Z`).fill(color);
      doc.rect(cx - r * 0.12, cy + r * 0.1, r * 0.24, r * 0.42).fill(color);
      doc.rect(cx - r * 0.5, cy + r * 0.52, r, r * 0.22).fill(color);
      doc.path(`M ${cx - r * 0.65} ${cy - r * 0.6} C ${cx - r * 1.1} ${cy - r * 0.5} ${cx - r * 0.95} ${cy} ${cx - r * 0.5} ${cy - r * 0.15}`).lineWidth(1.2).stroke(color);
      doc.path(`M ${cx + r * 0.65} ${cy - r * 0.6} C ${cx + r * 1.1} ${cy - r * 0.5} ${cx + r * 0.95} ${cy} ${cx + r * 0.5} ${cy - r * 0.15}`).lineWidth(1.2).stroke(color);
    }
    doc.restore();
  }

  private drawStatsBox(doc: PDFKit.PDFDocument, stats: { label: string; value: string; color?: string; icon?: string }[]) {
    const boxX = 40;
    const boxW = doc.page.width - 80;
    const boxH = 68;
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
      // Ícono vectorial arriba (si se especifica)
      if (s.icon) {
        this.drawStatIcon(doc, s.icon, cx + colW / 2, y + 16, valueColor);
      }
      // Value (big number)
      doc.fontSize(15).font('Helvetica-Bold').fillColor(valueColor)
        .text(s.value, cx + 6, y + 28, { width: colW - 12, align: 'center' });
      // Label
      doc.fontSize(8).font('Helvetica').fillColor(C.muted)
        .text(s.label.toUpperCase(), cx + 6, y + 50, { width: colW - 12, align: 'center', characterSpacing: 0.5 });
      // Column divider (except first)
      if (i > 0) {
        doc.moveTo(cx, y + 14).lineTo(cx, y + boxH - 8).lineWidth(0.5).stroke(C.borderSoft);
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

  /** Tilde (✓) vectorial verde — "apostó este partido". */
  private drawCheckMark(doc: PDFKit.PDFDocument, cx: number, cy: number, color = C.success) {
    doc.save().lineWidth(1.6).lineJoin('round').strokeColor(color);
    doc.moveTo(cx - 3.6, cy + 0.2).lineTo(cx - 1, cy + 3).lineTo(cx + 4, cy - 3.4).stroke();
    doc.restore();
  }

  /** Cruz (✗) vectorial roja — "NO apostó este partido". */
  private drawXMark(doc: PDFKit.PDFDocument, cx: number, cy: number, color = C.danger) {
    doc.save().lineWidth(1.6).lineCap('round').strokeColor(color);
    doc.moveTo(cx - 3.2, cy - 3.2).lineTo(cx + 3.2, cy + 3.2).stroke();
    doc.moveTo(cx + 3.2, cy - 3.2).lineTo(cx - 3.2, cy + 3.2).stroke();
    doc.restore();
  }

  /**
   * Página de PIVOT "Quién apostó cada partido" — SIEMPRE en hoja aparte.
   * Filas = TODOS los inscritos aprobados (apostaron o no), columnas = partidos.
   * Tilde verde = apostó ese partido; cruz roja = NO apostó ese partido.
   * Incluye columna "Sin apostar" por persona y fila total "No apostaron" por partido.
   */
  private drawBetMatrixPage(doc: PDFKit.PDFDocument, report: any, appTitle: string) {
    const matches: any[] = report?.matches ?? [];
    const n = matches.length;

    // Filas: bettors (con sus picks) + no-apostaron (set vacío). Orden alfabético
    // para encontrar a cualquiera rápido; el color hace saltar a la vista los huecos.
    // SOLO se listan quienes NO apostaron algún partido (Sin apostar > 0). Los que
    // apostaron TODOS los partidos se omiten (a pedido: no aportan información aquí).
    const rows: { name: string; picked: Set<string>; bet: boolean }[] = [
      ...((report?.users_bet ?? []).map((u: any) => ({
        name: u?.full_name ?? '-',
        picked: new Set<string>(u?.picked_match_ids ?? []),
        bet: true,
      }))),
      ...((report?.pending_users ?? []).map((u: any) => ({
        name: u?.full_name ?? '-',
        picked: new Set<string>(),
        bet: false,
      }))),
    ]
      .filter(r => n - r.picked.size > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    // ── Geometría de la página (ancho/alto dinámicos para que TODO entre) ──
    const posW = 26, nameW = 170, matchW = 34, skipW = 60, left = 40;
    const tableW = posW + nameW + n * matchW + skipW;
    const pageW = Math.max(612, left * 2 + tableW);
    const rowH = 18, headRowH = 24;
    const legendH = n > 0 ? 70 + n * 12 : 40;
    const pageH = Math.max(792, 150 + legendH + (rows.length + 2) * rowH + 90);

    doc.addPage({ size: [pageW, pageH], margin: 40 });

    // Encabezado compacto de la página
    doc.rect(0, 0, pageW, 3).fill(C.gold);
    this.drawSectionTitle(doc, 'Quiénes No Apostaron Algún Partido', C.primaryDk, 'users');
    doc.fontSize(9).font('Helvetica').fillColor(C.muted)
      .text('Cruz roja = NO apostó ese partido   ·   Tilde verde = sí apostó. Solo se listan quienes dejaron de apostar al menos un partido.', 40, doc.y, { width: pageW - 80 });
    doc.moveDown(0.6);

    if (n === 0) {
      doc.fontSize(10).font('Helvetica').fillColor(C.muted).text('Esta jornada no tiene partidos cargados.');
      return;
    }

    if (rows.length === 0) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(C.success)
        .text('Todos los inscritos apostaron todos los partidos de la jornada.', 40, doc.y + 4, { width: pageW - 80 });
      return;
    }

    // Leyenda P1..Pn → enfrentamientos
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.primaryDk).text('Partidos:', 40, doc.y);
    doc.moveDown(0.2);
    matches.forEach((m, i) => {
      doc.fontSize(8).font('Helvetica').fillColor(C.text)
        .text(`P${i + 1}:  ${m?.team_a ?? '-'}  vs  ${m?.team_b ?? '-'}`, 50, doc.y, { width: pageW - 90 });
    });
    doc.moveDown(0.5);

    const colWidths = [posW, nameW, ...matches.map(() => matchW), skipW];
    const headers = ['#', 'Participante', ...matches.map((_, i) => `P${i + 1}`), 'Sin apostar'];

    const drawHeader = () => {
      const y = doc.y;
      doc.roundedRect(left, y, tableW, headRowH, 4).fill(C.primaryDk);
      doc.roundedRect(left, y, tableW * 0.7, headRowH, 4).fill(C.primary);
      let x = left;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(C.headerText);
      headers.forEach((h, i) => {
        doc.text(h, x + 3, y + 8, { width: colWidths[i] - 6, align: i === 1 ? 'left' : 'center' });
        x += colWidths[i];
      });
      doc.y = y + headRowH;
      doc.fillColor(C.text);
    };

    drawHeader();

    rows.forEach((r, idx) => {
      if (doc.y > pageH - 60) {
        doc.addPage({ size: [pageW, pageH], margin: 40 });
        drawHeader();
      }
      const y = doc.y;
      const skip = n - r.picked.size;
      // Fila con leve tinte rojo si NO apostó algún partido → resalta los huecos.
      const bg = skip > 0 ? (idx % 2 === 0 ? '#FEF2F2' : '#FEE2E2') : (idx % 2 === 0 ? C.rowEven : C.rowOdd);
      doc.rect(left, y, tableW, rowH).fill(bg);
      doc.moveTo(left, y + rowH).lineTo(left + tableW, y + rowH).lineWidth(0.4).stroke(C.borderSoft);

      let x = left;
      // #
      doc.fontSize(8).font('Helvetica').fillColor(C.muted)
        .text(String(idx + 1), x + 2, y + 5, { width: posW - 4, align: 'center' });
      x += posW;
      // Nombre (una línea, con elipsis)
      doc.fontSize(8).font('Helvetica').fillColor(C.text)
        .text(r.name, x + 4, y + 5, { width: nameW - 8, align: 'left', lineBreak: false, ellipsis: true });
      x += nameW;
      // Marcas por partido
      matches.forEach(m => {
        const cx = x + matchW / 2;
        const cy = y + rowH / 2;
        if (r.picked.has(m.id)) this.drawCheckMark(doc, cx, cy);
        else this.drawXMark(doc, cx, cy);
        x += matchW;
      });
      // Sin apostar (conteo por persona)
      doc.fontSize(8).font('Helvetica-Bold').fillColor(skip > 0 ? C.danger : C.muted)
        .text(String(skip), x + 2, y + 5, { width: skipW - 4, align: 'center' });
      doc.y = y + rowH;
    });

    // Fila TOTAL: cuántos NO apostaron cada partido
    if (doc.y > pageH - 40) {
      doc.addPage({ size: [pageW, pageH], margin: 40 });
      drawHeader();
    }
    const ty = doc.y;
    doc.rect(left, ty, tableW, rowH + 2).fill(C.primaryDk);
    let tx = left;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.headerText)
      .text('No apostaron', tx + 2, ty + 6, { width: posW + nameW - 4, align: 'left' });
    tx += posW + nameW;
    let totalSkips = 0;
    matches.forEach(m => {
      const noBet = rows.filter(r => !r.picked.has(m.id)).length;
      totalSkips += noBet;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#FCA5A5')
        .text(String(noBet), tx + 2, ty + 6, { width: matchW - 4, align: 'center' });
      tx += matchW;
    });
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#FCA5A5')
      .text(String(totalSkips), tx + 2, ty + 6, { width: skipW - 4, align: 'center' });
    doc.y = ty + rowH + 2;
  }

  private drawSectionTitle(doc: PDFKit.PDFDocument, title: string, color = C.primary, icon = '') {
    doc.moveDown(0.5);
    const y = doc.y;
    // Colored left bar
    doc.rect(40, y + 2, 4, 16).fill(color);
    // Ícono vectorial opcional antes del título (mismo set que el stats box).
    let titleX = 50;
    if (icon) {
      this.drawStatIcon(doc, icon, 58, y + 9, color);
      titleX = 74;
    }
    doc.fontSize(13).font('Helvetica-Bold').fillColor(color)
      .text(title, titleX, y, { width: doc.page.width - 40 - titleX });
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
    const appSettings = await this.getAppSettings();

    return new Promise((resolve, reject) => {
      // Alto DINÁMICO: la página crece hacia abajo para que entren TODAS las filas
      // (los que apostaron + los que NO apostaron) sin cortarse al cruzar el borde
      // de página. 612 = ancho LETTER (vertical); el problema era el alto fijo (792).
      const rowsTotal = (report?.users_bet?.length ?? 0) + (report?.pending_users?.length ?? 0);
      const pageH = Math.max(792, 500 + rowsTotal * 21);
      const doc = new PDFDocument({ size: [612, pageH], margin: 40 });
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
        { label: 'Apuesta',    value: `${cur} ${report?.matchday?.bet_per_matchday ?? 0}`,  color: C.primary, icon: 'coin' },
        { label: 'Apostaron',  value: String(report?.stats?.users_bet ?? 0),                  color: C.success, icon: 'users' },
        { label: 'Pendientes', value: String(report?.stats?.users_pending ?? 0),              color: C.warning, icon: 'clock' },
        { label: 'Pozo total', value: `${cur} ${Number(report?.stats?.expected_pool ?? 0).toFixed(2)}`, color: C.gold, icon: 'trophy' },
      ]);

      // Total de partidos de la jornada → N en "Pronosticó X/N".
      const matchesCount = Number(report?.matchday?.matches_count ?? 0);

      // Users who bet
      this.drawSectionTitle(doc, 'Participantes que Apostaron', C.success, 'users');
      if ((report?.users_bet?.length ?? 0) > 0) {
        // Privacidad: NO mostramos usuario (@) ni telefono en los reportes.
        const headers = ['#', 'Nombre', 'Pronosticos', 'Aciertos', 'Premio'];
        const widths = [28, 214, 90, 70, 88];
        this.drawGridHeader(doc, headers, widths);
        // Orden alfabetico por nombre (locale es → respeta acentos/ñ). Los
        // ganadores empatan y reparten parejo (no hay 1°/2°/3°), asi que TODOS
        // llevan el mismo resaltado de ganador, no un podio por posicion.
        // Orden: por ACIERTOS desc, luego PREMIO desc, y alfabético entre empates.
        const betSorted = [...(report?.users_bet ?? [])].sort((a: any, b: any) => {
          const corr = Number(b?.total_correct ?? 0) - Number(a?.total_correct ?? 0);
          if (corr !== 0) return corr;
          const prize = Number(b?.prize_won ?? 0) - Number(a?.prize_won ?? 0);
          if (prize !== 0) return prize;
          return (a?.full_name ?? '').localeCompare(b?.full_name ?? '', 'es', { sensitivity: 'base' });
        });
        betSorted.forEach((u: any, i: number) => {
          const isWinner = u?.status === 'won';
          this.drawGridRow(doc, [
            String(i + 1),
            u?.full_name ?? '-',
            `${Number(u?.picks_count ?? 0)}/${matchesCount}`,
            String(u?.total_correct ?? '-'),
            (u?.prize_won ?? 0) > 0 ? `${cur} ${Number(u.prize_won).toFixed(2)}` : '-',
          ], widths, i, isWinner ? true : undefined);
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
        const pendingSorted = [...(report?.pending_users ?? [])].sort((a: any, b: any) =>
          (a?.full_name ?? '').localeCompare(b?.full_name ?? '', 'es', { sensitivity: 'base' }),
        );
        pendingSorted.forEach((u: any, i: number) => {
          this.drawGridRow(doc, [String(i + 1), u?.full_name ?? '-'], pWidths, i);
        });
      }

      // (Footer de ganadores quitado a pedido — los ganadores ya se ven por el
      //  orden de la tabla, el premio y el resaltado dorado de la fila.)

      // SIEMPRE en hoja aparte: pivot de quién apostó cada partido (y quién no).
      this.drawBetMatrixPage(doc, report, appSettings.app_title);

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
      // Orden: más dinero primero, luego más aciertos, luego alfabético (es).
      .sort((a, b) =>
        b.totalPrize - a.totalPrize ||
        b.totalCorrect - a.totalCorrect ||
        (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es'),
      );

    return new Promise((resolve, reject) => {
      // La página crece a lo ANCHO para que TODAS las jornadas entren en UNA
      // sola tabla, sin cortarse ni paginar horizontalmente. (fixedW=232:
      // pos 32 + nombre 130 + ganado 70; mdColW=56 por jornada). Mínimo 792
      // (= landscape letter) para torneos con pocas jornadas.
      const pageW = Math.max(792, 80 + 232 + matchdays.length * 56);
      // Alto dinámico: la página crece hacia ABAJO según la cantidad de
      // participantes → TODO entra en UNA sola página (no se pagina vertical).
      const pageH = Math.max(612, 380 + ranking.length * 21);
      const doc = new PDFDocument({ size: [pageW, pageH], margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cur2 = tournament.currency ?? 'Bs';
      const totalPrizeAll = ranking.reduce((s, u) => s + (u.totalPrize ?? 0), 0);

      this.drawPdfHeader(doc, 'Reporte Acumulado por Jornada', tournament.name, appSettings.app_title);

      this.drawStatsBox(doc, [
        { label: 'Apuesta/Jornada', value: `${cur2} ${Number(tournament.bet_per_matchday)}`, color: C.primary, icon: 'coin' },
        { label: 'Jornadas',        value: String(matchdays.length),                          color: C.accent, icon: 'calendar' },
        { label: 'Participantes',   value: String(ranking.length),                            color: C.primaryDk, icon: 'users' },
        { label: 'Pozo repartido',  value: `${cur2} ${formatMoney(totalPrizeAll)}`,             color: C.success, icon: 'trophy' },
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
      const fixedW    = posW + nameW + ganadoW;
      // TODAS las jornadas en un solo "chunk" → una sola tabla en la página ancha.
      const mdPerPage = Math.max(1, matchdays.length);

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

      this.drawSectionTitle(doc, 'Tabla Acumulada (Dinero Ganado por Jornada)', C.primary, 'trophy');

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
            const moneyStr = prize > 0 ? formatMoney(prize) : '0'; // sin "Bs" por celda (solo en GANADO)
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
      // Alto DINÁMICO (landscape, ancho 792) → TODAS las filas (apostaron + no
      // apostaron) entran sin cortarse al cruzar el borde de página.
      const pollaRows = (report?.bets?.length ?? 0) + pendingUsers.length;
      const pageHpf = Math.max(612, 420 + pollaRows * 21);
      const doc = new PDFDocument({ size: [792, pageHpf], margin: 40 });
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
      this.drawSectionTitle(doc, 'Apuestas de los Participantes', C.primary, 'users');
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