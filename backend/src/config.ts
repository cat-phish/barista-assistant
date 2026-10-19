import { connectionSettings, requireSecret } from "@barista/shared/env";

// Secrets accept NAME or NAME_FILE (Docker secrets); see shared/src/env.ts.
const jwtSecret = requireSecret("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redis: connectionSettings("REDIS_URL", "REDIS_PASSWORD"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production",
  jwtSecret,
} as const;
