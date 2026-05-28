import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Defaults que SIEMPRE deben existir. Si no están en BD al arrancar, se crean.
const DEFAULTS: Record<string, string> = {
  polla_final_enabled: 'false',
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Seed defaults if missing — idempotent.
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const exists = await this.prisma.app_setting.findUnique({ where: { key } });
      if (!exists) {
        await this.prisma.app_setting.create({ data: { key, value } });
        this.logger.log(`Seeded default setting: ${key}=${value}`);
      }
    }
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.app_setting.findMany();
    const result: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.app_setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.app_setting.upsert({
      where: { key },
      update: { value, updated_at: new Date() },
      create: { key, value },
    });
  }

  async setMany(settings: Record<string, string>): Promise<void> {
    const ops = Object.entries(settings).map(([key, value]) =>
      this.prisma.app_setting.upsert({
        where: { key },
        update: { value, updated_at: new Date() },
        create: { key, value },
      })
    );
    await this.prisma.$transaction(ops);
  }
}
