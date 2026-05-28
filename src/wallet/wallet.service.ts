import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private prisma: PrismaService) {}

  async getWallet(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const transactions = await this.prisma.transaction.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    return {
      balance: Number(user.balance),
      transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount) })),
    };
  }

  async deposit(userId: string, amount: number, proofUrl: string, notes?: string) {
    if (!amount || amount <= 0) throw new BadRequestException('Monto debe ser mayor a 0');
    if (!proofUrl) throw new BadRequestException('Comprobante requerido');

    const tx = await this.prisma.transaction.create({
      data: {
        user_id: userId,
        type: 'deposit',
        amount,
        status: 'pending',
        proof_url: proofUrl,
        notes: notes || null,
      },
    });

    this.logger.log(`Deposit request: user=${userId} amount=${amount}`);
    return { ...tx, amount: Number(tx.amount) };
  }

  async withdrawal(userId: string, amount: number, notes?: string) {
    if (!amount || amount <= 0) throw new BadRequestException('Monto debe ser mayor a 0');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (Number(user.balance) < amount) throw new BadRequestException('Saldo insuficiente');

    const tx = await this.prisma.transaction.create({
      data: {
        user_id: userId,
        type: 'withdrawal',
        amount,
        status: 'pending',
        notes: notes || null,
      },
    });

    this.logger.log(`Withdrawal request: user=${userId} amount=${amount}`);
    return { ...tx, amount: Number(tx.amount) };
  }

  async approveTransaction(txId: string, adminNotes?: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'pending') throw new BadRequestException('Transaction is not pending');

    return this.prisma.$transaction(async (prisma) => {
      // Update transaction status
      const updated = await prisma.transaction.update({
        where: { id: txId },
        data: {
          status: 'approved',
          notes: adminNotes || tx.notes,
          updated_at: new Date(),
        },
      });

      // Adjust user balance
      const amount = Number(tx.amount);
      if (tx.type === 'deposit') {
        await prisma.user.update({
          where: { id: tx.user_id },
          data: { balance: { increment: amount }, updated_at: new Date() },
        });
      } else if (tx.type === 'withdrawal') {
        await prisma.user.update({
          where: { id: tx.user_id },
          data: { balance: { decrement: amount }, updated_at: new Date() },
        });
      }

      this.logger.log(`Transaction ${txId} approved: type=${tx.type} amount=${amount}`);
      return { ...updated, amount: Number(updated.amount) };
    });
  }

  async rejectTransaction(txId: string, reason: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'pending') throw new BadRequestException('Transaction is not pending');

    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        status: 'rejected',
        notes: reason || 'Rechazado por admin',
        updated_at: new Date(),
      },
    });

    this.logger.log(`Transaction ${txId} rejected`);
    return { ...updated, amount: Number(updated.amount) };
  }

  // QR Codes
  async getActiveQr() {
    const qr = await this.prisma.qr_code.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });
    return qr || null;
  }

  async createQr(imageUrl: string, label: string) {
    // Deactivate all existing
    await this.prisma.qr_code.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });

    const qr = await this.prisma.qr_code.create({
      data: {
        image_url: imageUrl,
        label,
        is_active: true,
      },
    });

    this.logger.log(`New QR code created: ${qr.id}`);
    return qr;
  }
}
