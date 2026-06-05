import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * AllExceptionsFilter — red de seguridad global.
 *
 * - HttpException (400/401/403/404/validación, etc.) → se respeta su respuesta.
 * - Cualquier OTRO error (500 no controlado, error de Prisma, etc.) → NUNCA se
 *   expone el mensaje/stack interno al cliente. Solo un texto genérico; el
 *   detalle queda en los logs del server.
 *
 * Esto evita filtrar detalles internos (queries, rutas, stack) en errores 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let body: any;
    if (isHttp) {
      // Respuesta controlada (incluye mensajes de validación de class-validator).
      body = exception.getResponse();
    } else {
      // Error NO controlado: genérico al cliente, detalle solo en logs.
      body = { statusCode: status, message: 'Error interno del servidor' };
      this.logger.error(
        `Unhandled ${req?.method} ${req?.url} -> ${(exception as any)?.message ?? exception}`,
        (exception as any)?.stack,
      );
    }

    res
      .status(status)
      .json(
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : body,
      );
  }
}
