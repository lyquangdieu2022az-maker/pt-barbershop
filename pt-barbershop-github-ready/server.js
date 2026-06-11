const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;
const outputsDir = path.join(__dirname, "outputs");

const users = new Map([
  ["9939", "040426"],
  ["3122", "152004"]
]);

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false }
    })
  : null;

let dbReady = false;

app.use(express.json({ limit: "5mb" }));

function requireAuth(req, res, next) {
  const id = String(req.get("X-PT-User") || "");
  const password = String(req.get("X-PT-Password") || "");
  if (!users.has(id) || users.get(id) !== password) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function ensureDb() {
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured");
    error.statusCode = 503;
    throw error;
  }
  if (dbReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id integer PRIMARY KEY DEFAULT 1,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  dbReady = true;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", requireAuth, async (req, res, next) => {
  try {
    await ensureDb();
    const result = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 1");
    res.set("Cache-Control", "no-store");
    if (!result.rows.length) {
      res.json({ data: null, updatedAt: null });
      return;
    }
    res.json({
      data: result.rows[0].data,
      updatedAt: result.rows[0].updated_at.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/state", requireAuth, async (req, res, next) => {
  try {
    await ensureDb();
    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      res.status(400).json({ error: "Invalid state payload" });
      return;
    }
    const result = await pool.query(
      `
        INSERT INTO app_state (id, data, updated_at)
        VALUES (1, $1::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at
      `,
      [JSON.stringify(data)]
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, updatedAt: result.rows[0].updated_at.toISOString() });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(outputsDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(outputsDir, "index.html"));
});

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "Server error" : error.message });
});

app.listen(port, () => {
  console.log(`PT Barbershop POS running on port ${port}`);
});
