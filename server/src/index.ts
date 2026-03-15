import "dotenv/config";
import cors from "cors";
import express from "express";
import morgan from "morgan";
import { getUploadDirectory } from "./config/uploadConfig.js";
import { ensureSchema, pool } from "./db/pool.js";
import { syncRoutes } from "./routes/syncRoutes.js";
import { ensureUploadDirectory } from "./services/fileStorage.js";

const port = Number(process.env.PORT || 3000);
const uploadDir = getUploadDirectory();

async function waitForDatabase(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      const shouldRetry = attempt < maxAttempts;
      const message = error instanceof Error ? error.message : "Unknown DB error";
      // eslint-disable-next-line no-console
      console.warn(`Database not ready (attempt ${attempt}/${maxAttempts}): ${message}`);
      if (!shouldRetry) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function bootstrap(): Promise<void> {
  await waitForDatabase();
  await ensureSchema();
  await ensureUploadDirectory();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(morgan("dev"));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/uploads", express.static(uploadDir));
  app.use("/api", syncRoutes);

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Navlight Mapper API listening on port ${port}`);
    // eslint-disable-next-line no-console
    console.log(`Photo uploads directory: ${uploadDir}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Navlight Mapper API", error);
  process.exit(1);
});
