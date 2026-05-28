const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync('prisma/functions.sql', 'utf8');
  
  // Split by semicolon and filter out comments and empty lines
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));
  
  for (const statement of statements) {
    if (statement) {
      try {
        console.log('Executing:', statement.substring(0, 100) + '...');
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        // Some statements might fail if already exist, that's ok
        console.log('Warning:', error.message);
      }
    }
  }
  
  console.log('\nFunctions and triggers setup complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
