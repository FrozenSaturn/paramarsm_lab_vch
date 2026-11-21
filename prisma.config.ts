// Prisma CLI config (shared). With the schema split across prisma/schema/*.prisma, Prisma looks for
// migrations next to the datasource file (prisma/schema/migrations) and finds none; this points it at
// prisma/migrations, where they live. Prisma stops reading .env once a config file exists, so load it here.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(".env"); // never overrides variables already set in the shell
} catch {
  // no .env: rely on the shell
}

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations" },
});
