import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@Controller('api/users')
export class AvatarController {
  constructor(private usersService: UsersService) {}

  // Subir/actualizar MI avatar — AUTHED (solo el propio usuario).
  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subir/actualizar mi foto de perfil (data URI base64)' })
  async upload(@CurrentUser() user: any, @Body() body: { image: string }) {
    return this.usersService.setAvatar(user.userId, body?.image);
  }

  // Servir el avatar de un usuario — PÚBLICO. El <Image> del cliente NO manda
  // header de auth, y el avatar se muestra en el ranking igual. Sin guard a
  // propósito (el UUID es difícil de adivinar y no es dato sensible).
  @Get(':id/avatar')
  @ApiOperation({ summary: 'Servir el avatar de un usuario (público)' })
  async serve(@Param('id') id: string, @Res() res: Response) {
    const av = await this.usersService.getAvatar(id);
    if (!av) throw new NotFoundException('Sin avatar');
    res.set({
      'Content-Type': av.mime,
      // Override del no-store global: el avatar SÍ se cachea (cambia poco). El ?v=
      // del avatar_url cache-bustea cuando el usuario cambia la foto.
      'Cache-Control': 'public, max-age=60',
      // Override del CORP `same-origin` de Helmet: el frontend vive en OTRO dominio
      // (impexpap.com) que el backend (esppapel.com), y el <img> lo carga cross-origin.
      // Sin esto el navegador bloquea la imagen. Solo este recurso público se relaja.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(av.data);
  }
}
