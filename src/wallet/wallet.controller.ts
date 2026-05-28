import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('wallet')
@Controller('api')
@ApiBearerAuth()
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get('wallet/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get user wallet info (balance + recent transactions)' })
  async getWallet(@CurrentUser() user: any) {
    return this.walletService.getWallet(user.userId);
  }

  @Post('transactions/deposit')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request a deposit' })
  async deposit(
    @CurrentUser() user: any,
    @Body() body: { amount: number; proof_url: string; notes?: string },
  ) {
    return this.walletService.deposit(user.userId, body.amount, body.proof_url, body.notes);
  }

  @Post('transactions/withdrawal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Request a withdrawal' })
  async withdrawal(
    @CurrentUser() user: any,
    @Body() body: { amount: number; notes?: string },
  ) {
    return this.walletService.withdrawal(user.userId, body.amount, body.notes);
  }

  @Get('qr-codes/active')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get active QR code for deposits' })
  async getActiveQr() {
    return this.walletService.getActiveQr();
  }

  @Post('qr-codes')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Create new QR code (admin)' })
  async createQr(@Body() body: { image_url: string; label: string }) {
    return this.walletService.createQr(body.image_url, body.label);
  }

  @Patch('admin/transactions/:id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Approve or reject transaction (admin)' })
  async updateTransactionStatus(
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected'; notes?: string },
  ) {
    if (body.status === 'approved') {
      return this.walletService.approveTransaction(id, body.notes);
    } else {
      return this.walletService.rejectTransaction(id, body.notes ?? '');
    }
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a file (returns base64 data URL)' })
  async uploadFile(@UploadedFile() file: any) {
    if (!file) {
      return { url: '' };
    }
    // Convert to base64 data URL (no S3 needed for MVP)
    const base64 = file.buffer.toString('base64');
    const mimeType = file.mimetype || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return { url: dataUrl };
  }
}
