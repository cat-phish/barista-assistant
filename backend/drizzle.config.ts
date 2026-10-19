import "dotenv/config";
import { connectionSettings } from "@barista/shared/env";
import { defineConfig } from "drizzle-kit";

// drizzle-kit needs one URL, so the separately supplied password is put back in here.
const { url, password } = connectionSettings("DATABASE_URL", "DATABASE_PASSWORD");
const databaseUrl = new URL(url);
if (password) databaseUrl.password = password;

export default defineConfig({
  dialect: "mysql",
  schema: "../shared/src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl.toString() },
});
