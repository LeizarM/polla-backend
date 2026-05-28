"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    const adminPassword = await bcrypt.hash('admin123', 12);
    const userPassword = await bcrypt.hash('user123', 12);
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
    }
    else {
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
//# sourceMappingURL=seed.js.map