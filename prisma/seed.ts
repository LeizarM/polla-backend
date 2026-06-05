import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Sin defaults débiles: las contraseñas del seed vienen de env vars. Si no
  // están seteadas, el seed se aborta → ya NO se crea admin/admin123 (una
  // credencial conocida con rol admin).
  const seedAdminPwd = process.env.SEED_ADMIN_PASSWORD;
  const seedUserPwd = process.env.SEED_USER_PASSWORD;
  if (!seedAdminPwd || !seedUserPwd) {
    throw new Error('Setea SEED_ADMIN_PASSWORD y SEED_USER_PASSWORD antes de correr el seed.');
  }
  const adminPassword = await bcrypt.hash(seedAdminPwd, 12);
  const userPassword = await bcrypt.hash(seedUserPwd, 12);

  // Upsert users
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      full_name: 'Administrador',
      phone: '0000000000',
      role: 'admin',
      balance: 0.00,
    },
  });

  const user1 = await prisma.user.upsert({
    where: { username: 'user1' },
    update: {},
    create: {
      username: 'user1',
      password: userPassword,
      full_name: 'Usuario Uno',
      phone: '1111111111',
      role: 'user',
      balance: 500.00,
    },
  });

  const user2 = await prisma.user.upsert({
    where: { username: 'user2' },
    update: {},
    create: {
      username: 'user2',
      password: userPassword,
      full_name: 'Usuario Dos',
      phone: '2222222222',
      role: 'user',
      balance: 250.00,
    },
  });

  const user3 = await prisma.user.upsert({
    where: { username: 'user3' },
    update: {},
    create: {
      username: 'user3',
      password: userPassword,
      full_name: 'Usuario Tres',
      phone: '3333333333',
      role: 'user',
      balance: 100.00,
    },
  });

  console.log('Created users:', { admin, user1, user2, user3 });

  // Create teams
  const teams = [
    { name: 'Argentina', country: 'Argentina' },
    { name: 'Brasil', country: 'Brasil' },
    { name: 'Francia', country: 'Francia' },
    { name: 'España', country: 'España' },
    { name: 'Alemania', country: 'Alemania' },
    { name: 'Inglaterra', country: 'Inglaterra' },
  ];

  const teamCount = await prisma.team.count();
  if (teamCount === 0) {
    await prisma.team.createMany({
      data: teams,
    });
    console.log('Created teams:', teams.length);
  } else {
    console.log('Teams already exist, skipping...');
  }

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
