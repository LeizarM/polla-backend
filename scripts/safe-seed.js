"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
try {
    const seedFile = path_1.default.resolve(process.cwd(), "scripts/seed.ts");
    const content = fs_1.default.readFileSync(seedFile, "utf-8");
    const forbiddenPatterns = [
        /prisma\.\w+\.delete\(/,
        /prisma\.\w+\.deleteMany\(/,
    ];
    const violations = forbiddenPatterns.filter((pattern) => pattern.test(content));
    if (violations.length > 0) {
        console.error("Seed aborted: seed.ts contains prisma.delete or prisma.deleteMany calls.");
        console.error("Remove all delete operations before seeding to avoid deleting production data.");
        console.error("Do not modify this file to bypass this check in development environment as production and deployment database can be shared.");
        process.exit(1);
    }
}
catch (err) {
}
(0, child_process_1.execSync)("tsx --require dotenv/config scripts/seed.ts", { stdio: "inherit" });
//# sourceMappingURL=safe-seed.js.map