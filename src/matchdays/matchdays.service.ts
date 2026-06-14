import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MatchdaysService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    userId?: string,
    userRole?: string,
    tournament_id?: string,
    status?: string,
    upcoming?: boolean,
  ) {
    const where: Prisma.matchdayWhereInput = {
      ...(tournament_id && { tournament_id }),
      ...(status && { status }),
    };

    // Ventana de fechas POR DÍA, en HORA DE BOLIVIA (UTC-4). Regla:
    //   - La jornada del día D se ve 1 día ANTES (D-1) y el mismo día (D).
    //   - Desde D+1 (pasó el día) ya NO aparece en la lista de apuestas.
    //   - Es por FECHA, no por la hora de los partidos → visible TODO el día D.
    //   Ej.: jornada 11/06 → visible 10/06 y 11/06, fuera el 12/06.
    //
    // "hoy" y "mañana" como fechas (medianoche), en el mismo formato que el campo
    // @db.Date (que guarda el día calendario boliviano como medianoche UTC).
    const nowBo = new Date(Date.now() - 4 * 60 * 60 * 1000); // instante → reloj de pared Bolivia
    const hoyBo    = new Date(Date.UTC(nowBo.getUTCFullYear(), nowBo.getUTCMonth(), nowBo.getUTCDate()));
    const mananaBo = new Date(Date.UTC(nowBo.getUTCFullYear(), nowBo.getUTCMonth(), nowBo.getUTCDate() + 1));

    // Límite SUPERIOR (apostar + historial + cualquier no-admin): nunca mostrar
    // jornadas a más de 1 día. SEGURIDAD: se fuerza acá en el server para
    // no-admins (no depende del query param `upcoming`). El admin (sin upcoming)
    // ve todas en sus vistas de gestión.
    if (upcoming || userRole !== 'admin') {
      where.date = { lte: mananaBo };
    }

    // Vista "PARA APOSTAR" (status=open + upcoming): además aplicamos el límite
    // INFERIOR → ventana [hoy, mañana]. Así, pasado el día de la jornada, ya no
    // aparece para apostar. El HISTORIAL (sin status) y la gestión admin (sin
    // upcoming) NO aplican este límite → ahí siguen viéndose las pasadas.
    if (status === 'open' && upcoming) {
      where.date = { gte: hoyBo, lte: mananaBo };
    }

    // Regular users only see matchdays from their enrolled (approved) tournaments.
    // enrolledAtByTournament: cuándo se inscribió el usuario a cada torneo, para
    // OCULTARLE las jornadas que ya estaban en juego antes de su inscripción.
    let enrolledAtByTournament: Record<string, Date> | null = null;
    if (userId && userRole !== 'admin') {
      const myParts = await this.prisma.tournament_participant.findMany({
        where: { user_id: userId, status: 'approved' },
        select: { tournament_id: true, created_at: true },
      });
      if (myParts.length === 0) return [];
      enrolledAtByTournament = {};
      for (const p of myParts) enrolledAtByTournament[p.tournament_id] = p.created_at;
      if (!tournament_id) {
        where.tournament_id = { in: myParts.map(p => p.tournament_id) };
      }
    }

    const rawMatchdays = await this.prisma.matchday.findMany({
      where,
      include: {
        tournament: true,
        // Include match count via Prisma's _count selector so the frontend
        // can show "N partidos" without loading the full match array.
        _count: { select: { matches: true } },
        // Último partido de la jornada (fecha máx) → para saber si la jornada ya
        // estaba en juego cuando el usuario se inscribió.
        matches: { orderBy: { match_date: 'desc' }, take: 1, select: { match_date: true } },
      },
      orderBy: { date: 'desc' },
    });

    // Inscrito tardío NO ve jornadas pasadas: si se inscribió DESPUÉS de que
    // arrancó el último partido de la jornada, ya no la ve (igual la "hereda" en
    // el pozo vía ghost ticket si esa jornada se resuelve después — esa plata va a
    // los ganadores de esa jornada). Los inscritos a tiempo ven todo su historial.
    const matchdays = enrolledAtByTournament
      ? rawMatchdays.filter(m => {
          const enrolledAt = enrolledAtByTournament![m.tournament_id];
          const lastMatch = m.matches?.[0]?.match_date;
          if (!enrolledAt || !lastMatch) return true; // sin dato → no ocultar
          return new Date(enrolledAt).getTime() <= new Date(lastMatch).getTime();
        })
      : rawMatchdays;

    if (matchdays.length === 0) return [];

    // Get approved participant counts per tournament for expected_pool
    const tournamentIds = [...new Set(matchdays.map(m => m.tournament_id))];
    const participantCounts: any[] = await this.prisma.$queryRaw`
      SELECT tournament_id::text, COUNT(*)::int as count
      FROM tournament_participant
      WHERE tournament_id = ANY(${tournamentIds}::uuid[])
      AND status = 'approved'
      GROUP BY tournament_id
    `;

    const countMap: Record<string, number> = {};
    participantCounts.forEach((p: any) => { countMap[p.tournament_id] = Number(p.count); });

    return matchdays.map((md) => {
      // Quitamos `matches` (solo lo usamos arriba para el filtro de inscritos tardíos)
      const { matches: _omit, ...m } = md as any;
      return {
        ...m,
        total_pool: Number(m.total_pool),
        expected_pool: Number(m.tournament?.bet_per_matchday ?? 0) * (countMap[m.tournament_id] ?? 0),
        participant_count: countMap[m.tournament_id] ?? 0,
        // Expose match count directly for easier client access
        match_count: m._count?.matches ?? 0,
      };
    });
  }

  async findOne(id: string) {
    const matchday = await this.prisma.matchday.findUnique({
      where: { id },
      include: {
        tournament: true,
        matches: {
          include: { team_a: true, team_b: true },
          orderBy: { match_date: 'asc' },
        },
      },
    });
    if (!matchday) throw new NotFoundException('Matchday not found');

    const participantCount = await this.prisma.tournament_participant.count({
      where: { tournament_id: matchday.tournament_id, status: 'approved' },
    });
    const betPerMatchday = Number(matchday.tournament?.bet_per_matchday ?? 0);

    return {
      ...matchday,
      total_pool: Number(matchday.total_pool),
      expected_pool: betPerMatchday * participantCount,
      participant_count: participantCount,
    };
  }

  async create(data: any) {
    const matchday = await this.prisma.matchday.create({
      data: { ...data, date: new Date(data.date) },
    });
    return { ...matchday, total_pool: Number(matchday.total_pool) };
  }

  async update(id: string, data: any) {
    await this.findOne(id);

    const { propagate_date, ...updateFields } = data;

    const updated = await this.prisma.matchday.update({
      where: { id },
      data: {
        ...updateFields,
        ...(updateFields.date && { date: new Date(updateFields.date) }),
        updated_at: new Date(),
      },
    });

    // Propagate new date to all match dates (preserving individual times)
    if (updateFields.date) {
      const newDate = new Date(updateFields.date);
      const matches = await this.prisma.match.findMany({ where: { matchday_id: id } });

      for (const match of matches) {
        const matchDate = new Date(match.match_date);
        // Keep the time (hours/minutes/seconds), only change year/month/day
        matchDate.setUTCFullYear(newDate.getUTCFullYear());
        matchDate.setUTCMonth(newDate.getUTCMonth());
        matchDate.setUTCDate(newDate.getUTCDate());

        await this.prisma.match.update({
          where: { id: match.id },
          data: { match_date: matchDate },
        });
      }
    }

    return { ...updated, total_pool: Number(updated.total_pool) };
  }

  async getRanking(id: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { matchday_id: id },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        // Compute total_correct LIVE by comparing pick → match.result.
        // is_correct may be null for picks updated before the per-match score fix.
        ticket_picks: {
          select: {
            pick: true,
            is_correct: true,
            match: { select: { result: true } },
          },
        },
      },
    });
    // Compute live and sort
    const enriched = tickets.map(t => {
      const livePicks = (t as any).ticket_picks ?? [];
      let liveCorrect = 0;
      for (const p of livePicks) {
        const result = p?.match?.result;
        if (result && p?.pick && p.pick === result) liveCorrect++;
      }
      const finalCorrect = livePicks.length > 0 ? liveCorrect : (t.total_correct ?? 0);
      return { t, finalCorrect };
    });
    enriched.sort((a, b) => {
      if (b.finalCorrect !== a.finalCorrect) return b.finalCorrect - a.finalCorrect;
      const ad = a.t.created_at ? new Date(a.t.created_at).getTime() : 0;
      const bd = b.t.created_at ? new Date(b.t.created_at).getTime() : 0;
      return ad - bd;
    });
    return enriched.map(({ t, finalCorrect }, index) => ({
      position: index + 1,
      user_id: t.user?.id,
      username: t.user?.username,
      full_name: t.user?.full_name,
      total_correct: finalCorrect,
      amount_bet: Number(t.amount_bet),
      prize_won: t.prize_won ? Number(t.prize_won) : 0,
      status: t.status,
    }));
  }

  async getReport(id: string) {
    const matchday = await this.findOne(id);
    const tournamentId = matchday.tournament_id;

    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: tournamentId, status: 'approved' },
      include: { user: { select: { id: true, username: true, full_name: true, phone: true } } },
    });

    const tickets = await this.prisma.ticket.findMany({
      where: { matchday_id: id, amount_bet: { gt: 0 } },
      include: {
        user: { select: { id: true, username: true, full_name: true, phone: true } },
        // Conteo de pronósticos del boleto → para "Pronosticó X/N partidos".
        _count: { select: { ticket_picks: true } },
        // Qué partidos pronosticó (match_id) → para la matriz "quién apostó qué".
        ticket_picks: { select: { match_id: true } },
      },
    });

    const userIdsWithTickets = new Set(tickets.map(t => t.user_id));
    const betPerMatchday = Number(matchday.tournament?.bet_per_matchday ?? 0);
    // Partidos de la jornada (orden por fecha) → columnas del pivot + N en "X/N".
    const matchesList = (matchday.matches ?? []).map((m: any) => ({
      id: m.id,
      team_a: m.team_a?.name ?? '-',
      team_b: m.team_b?.name ?? '-',
      match_date: m.match_date,
    }));
    const matchesCount = matchesList.length;

    const usersBet = tickets.map(t => ({
      id: t.user?.id,
      username: t.user?.username,
      full_name: t.user?.full_name,
      phone: t.user?.phone,
      amount_bet: Number(t.amount_bet),
      total_correct: t.total_correct ?? null,
      // Cuántos partidos pronosticó este participante (de matchesCount).
      picks_count: (t as any)._count?.ticket_picks ?? 0,
      // IDs de los partidos que SÍ pronosticó → el pivot marca el resto como "no apostó".
      picked_match_ids: ((t as any).ticket_picks ?? []).map((p: any) => p.match_id),
      status: t.status,
      prize_won: t.prize_won ? Number(t.prize_won) : 0,
      created_at: t.created_at,
      ticket_id: t.id,
    }));

    const usersPending = participants
      .filter(p => !userIdsWithTickets.has(p.user_id))
      .map(p => ({
        id: p.user?.id,
        username: p.user?.username,
        full_name: p.user?.full_name,
        phone: p.user?.phone,
      }));

    // Pool = ALL approved participants × bet (not just real bettors)
    const expectedPool = betPerMatchday * participants.length;

    return {
      matchday: {
        id: matchday.id,
        name: matchday.name,
        date: matchday.date,
        status: matchday.status,
        total_pool: expectedPool,
        tournament_name: matchday.tournament?.name,
        bet_per_matchday: betPerMatchday,
        currency: matchday.tournament?.currency ?? 'Bs',
        matches_count: matchesCount,
      },
      stats: {
        total_active_users: participants.length,
        users_bet: usersBet.length,
        users_pending: usersPending.length,
        pool_collected: betPerMatchday * tickets.length,
        expected_pool: expectedPool,
      },
      total_users: participants.length,
      bet_count: usersBet.length,
      pending_count: usersPending.length,
      users_bet: usersBet,
      pending_users: usersPending,
      // Partidos de la jornada (columnas del pivot "quién apostó qué partido").
      matches: matchesList,
    };
  }

  async getWinners(id: string) {
    const matchday = await this.findOne(id);
    const betPerMatchday = Number(matchday.tournament?.bet_per_matchday ?? 0);

    const allTickets = await this.prisma.ticket.findMany({
      where: { matchday_id: id },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
      orderBy: [{ total_correct: 'desc' }, { amount_bet: 'desc' }],
    });

    const realTickets = allTickets.filter(t => Number(t.amount_bet) > 0);
    const ghostTickets = allTickets.filter(t => Number(t.amount_bet) === 0);
    // Pool uses participant_count (includes non-bettors)
    const pool = betPerMatchday * matchday.participant_count;

    const maxCorrect = realTickets.length > 0
      ? Math.max(...realTickets.map(t => t.total_correct ?? 0))
      : 0;
    const winners = realTickets.filter(t => (t.total_correct ?? 0) === maxCorrect && t.status === 'won');
    const prizePerWinner = winners.length > 0 ? Number(winners[0]?.prize_won ?? 0) : 0;

    const formatTicket = (t: any, pos: number) => ({
      position: pos,
      user_id: t.user?.id,
      username: t.user?.username,
      full_name: t.user?.full_name,
      total_correct: t.total_correct ?? 0,
      amount_bet: Number(t.amount_bet),
      prize_won: t.prize_won ? Number(t.prize_won) : 0,
      status: t.status,
    });

    return {
      matchday: {
        id: matchday.id,
        name: matchday.name,
        date: matchday.date,
        total_pool: pool,
        status: matchday.status,
        tournament_name: matchday.tournament?.name,
        bet_per_matchday: betPerMatchday,
        currency: matchday.tournament?.currency ?? 'Bs',
      },
      max_correct: maxCorrect,
      winners_count: winners.length,
      prize_per_winner: prizePerWinner,
      winners: winners.map((t, i) => formatTicket(t, i + 1)),
      all_tickets: [
        ...realTickets.map((t, i) => formatTicket(t, i + 1)),
        ...ghostTickets.map(t => formatTicket(t, 0)),
      ],
    };
  }

  async resolve(id: string) {
    const matchday = await this.findOne(id);
    if (matchday.status === 'resolved') throw new BadRequestException('Jornada ya resuelta');

    const unfinished = matchday.matches.filter((m: any) => !m.result);
    if (unfinished.length > 0) throw new BadRequestException(`${unfinished.length} partidos sin resultado`);

    // Get all approved participants
    const participants = await this.prisma.tournament_participant.findMany({
      where: { tournament_id: matchday.tournament_id, status: 'approved' },
      select: { user_id: true },
    });

    const existingTickets = await this.prisma.ticket.findMany({
      where: { matchday_id: id },
      select: { user_id: true },
    });
    const userIdsWithTickets = new Set(existingTickets.map(t => t.user_id));
    const usersWithoutTicket = participants.filter(p => !userIdsWithTickets.has(p.user_id));

    // Create ghost tickets for participants who didn't bet
    if (usersWithoutTicket.length > 0) {
      await this.prisma.$executeRaw`
        INSERT INTO ticket (user_id, matchday_id, amount_bet, pool_contribution, total_correct, status, prize_won)
        SELECT u.id, ${id}::uuid, 0, 0, 0, 'lost', 0
        FROM "user" u
        WHERE u.id = ANY(${usersWithoutTicket.map(u => u.user_id)}::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM ticket t WHERE t.user_id = u.id AND t.matchday_id = ${id}::uuid
        )
      `;
    }

    const betPerMatchday = Number(matchday.tournament?.bet_per_matchday ?? 0);
    // REGLA DE NEGOCIO (decisión del organizador): el pozo es de TODOS los
    // inscritos aprobados, apuesten o no. Al inscribirse al torneo ya "entran" al
    // pozo (los Bs se cobran por fuera de la app). El pozo se reparte entre los
    // GANADORES (los de más aciertos); un inscrito que no apostó igual aporta su
    // parte. (Antes el pozo era solo bettors × bet — cambiado a pedido.)
    const pool = betPerMatchday * participants.length;

    // Mark picks correct/incorrect
    await this.prisma.$executeRaw`
      UPDATE ticket_pick tp
      SET is_correct = (tp.pick = m.result)
      FROM match m
      WHERE tp.match_id = m.id AND m.matchday_id = ${id}::uuid AND m.result IS NOT NULL
    `;

    // Count correct picks per real ticket
    await this.prisma.$executeRaw`
      UPDATE ticket t
      SET total_correct = (
        SELECT COUNT(*) FROM ticket_pick tp WHERE tp.ticket_id = t.id AND tp.is_correct = true
      )
      WHERE t.matchday_id = ${id}::uuid AND t.amount_bet > 0
    `;

    // Find max correct among real bettors
    const maxResult: any[] = await this.prisma.$queryRaw`
      SELECT MAX(total_correct) as max_correct
      FROM ticket WHERE matchday_id = ${id}::uuid AND amount_bet > 0
    `;
    const maxCorrect = maxResult?.[0]?.max_correct ?? 0;

    let winnersCount = 0;
    let totalDistributed = 0;

    if (Number(maxCorrect) > 0 && pool > 0) {
      const countResult: any[] = await this.prisma.$queryRaw`
        SELECT COUNT(*) as cnt FROM ticket
        WHERE matchday_id = ${id}::uuid AND total_correct = ${maxCorrect} AND amount_bet > 0
      `;
      winnersCount = Number(countResult?.[0]?.cnt ?? 0);
      const prizePerWinner = pool / winnersCount;
      totalDistributed = pool;

      await this.prisma.$executeRaw`
        UPDATE ticket SET status = 'won', prize_won = ${prizePerWinner}
        WHERE matchday_id = ${id}::uuid AND total_correct = ${maxCorrect} AND amount_bet > 0
      `;

      await this.prisma.$executeRaw`
        UPDATE ticket SET status = 'lost'
        WHERE matchday_id = ${id}::uuid AND amount_bet > 0
        AND (total_correct < ${maxCorrect} OR total_correct IS NULL)
      `;
    } else {
      await this.prisma.$executeRaw`
        UPDATE ticket SET status = 'lost' WHERE matchday_id = ${id}::uuid AND amount_bet > 0
      `;
    }

    // Ghost tickets always lost
    await this.prisma.$executeRaw`
      UPDATE ticket SET status = 'lost', total_correct = 0, prize_won = 0
      WHERE matchday_id = ${id}::uuid AND amount_bet = 0
    `;

    await this.prisma.matchday.update({
      where: { id },
      data: { status: 'resolved', total_pool: pool, updated_at: new Date() },
    });

    return { success: true, winners_count: winnersCount, total_distributed: totalDistributed };
  }

  async getBetLog(matchdayId: string) {
    const matchday = await this.prisma.matchday.findUnique({
      where: { id: matchdayId },
      include: {
        tournament: { select: { currency: true } },
        matches: {
          include: {
            team_a: { select: { id: true, name: true, country: true } },
            team_b: { select: { id: true, name: true, country: true } },
          },
          orderBy: { match_date: 'asc' },
        },
      },
    });
    if (!matchday) throw new NotFoundException('Jornada no encontrada');

    const now = new Date();
    const isResolved = matchday.status === 'resolved' || matchday.status === 'locked';
    // PER-MATCH reveal: a pick is revealed when ITS match has started.
    // No more all-or-nothing.
    const startedMatchIds = new Set(
      matchday.matches.filter(m => new Date(m.match_date) <= now).map(m => m.id),
    );

    // Always fetch picks — we'll redact per-pick below.
    const tickets = await this.prisma.ticket.findMany({
      where: { matchday_id: matchdayId },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        ticket_picks: {
          include: {
            match: {
              select: {
                id: true,
                match_date: true,
                team_a: { select: { name: true } },
                team_b: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const betLog = tickets.map((t, idx) => ({
      position: idx + 1,
      user_id: t.user_id,
      username: t.user?.username ?? '-',
      full_name: t.user?.full_name ?? '-',
      bet_time: t.created_at,
      total_correct: t.total_correct ?? null,
      prize_won: isResolved ? Number(t.prize_won ?? 0) : null,
      picks: (t.ticket_picks ?? []).map((p: any) => {
        const matchStarted = startedMatchIds.has(p.match_id);
        return {
          match_id: p.match_id,
          team_a: p.match?.team_a?.name ?? '-',
          team_b: p.match?.team_b?.name ?? '-',
          match_date: p.match?.match_date,
          match_started: matchStarted,
          // Only reveal `pick` and `is_correct` if the match has started.
          // Unstarted match picks return null → frontend hides them as "Oculto".
          pick:       matchStarted ? p.pick       : null,
          is_correct: matchStarted ? p.is_correct : null,
        };
      }),
    }));

    return {
      matchday_id: matchday.id,
      matchday_name: matchday.name,
      status: matchday.status,
      currency: (matchday as any).tournament?.currency ?? 'Bs',
      // Kept for backwards-compat; now means "any match started" instead of "all".
      reveal_picks: startedMatchIds.size > 0,
      total_bets: tickets.length,
      matches: matchday.matches.map(m => ({
        id: m.id,
        team_a: m.team_a?.name,
        team_b: m.team_b?.name,
        match_date: m.match_date,
        started: new Date(m.match_date) <= now,
        score_a: m.score_a,
        score_b: m.score_b,
        result: m.result,
      })),
      bets: betLog,
    };
  }
}
