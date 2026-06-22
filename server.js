const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;
const outputsDir = path.join(__dirname, "outputs");

const users = new Map([
  ["9939", { password: "040426", role: "manager", name: "Quản Lý" }],
  ["3122", { password: "152004", role: "cashier", name: "Thu Ngân" }]
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

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", [
    "Content-Type",
    "X-PT-User",
    "X-PT-Password",
    "X-PT-Manager-User",
    "X-PT-Manager-Password"
  ].join(", "));
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function requireAuth(req, res, next) {
  const id = String(req.get("X-PT-User") || "");
  const password = String(req.get("X-PT-Password") || "");
  const user = users.get(id);
  if (!user || user.password !== password) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = { id, ...user };
  next();
}

function managerApproved(req) {
  const id = String(req.get("X-PT-Manager-User") || "");
  const password = String(req.get("X-PT-Manager-Password") || "");
  const user = users.get(id);
  return Boolean(user && user.role === "manager" && user.password === password);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function securityError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function billCore(bill = {}) {
  return {
    id: bill.id || "",
    createdAt: bill.createdAt || "",
    invoiceSequence: Number(bill.invoiceSequence || 0),
    invoiceNo: bill.invoiceNo || "",
    queueNo: Number(bill.queueNo || 0),
    customer: bill.customer || "",
    phone: bill.phone || "",
    staffId: bill.staffId || "",
    staffName: bill.staffName || "",
    note: bill.note || "",
    paymentMethod: bill.paymentMethod || "cash",
    shiftId: bill.shiftId || "",
    createdBy: bill.createdBy || "",
    items: Array.isArray(bill.items) ? bill.items : [],
    total: Number(bill.total || 0),
    commission: Number(bill.commission || 0)
  };
}

function requireCashierSafeUpdate(previous, next, req) {
  if (!previous) return;

  if (Number(next.invoiceCounter || 0) < Number(previous.invoiceCounter || 0)) {
    throw securityError("Bảo mật: Thu Ngân không được lùi số hóa đơn.");
  }
  if (stableStringify(previous.staff || []) !== stableStringify(next.staff || [])) {
    throw securityError("Bảo mật: Thu Ngân không được sửa nhân viên.");
  }
  if (stableStringify(previous.services || []) !== stableStringify(next.services || [])) {
    throw securityError("Bảo mật: Thu Ngân không được sửa bảng giá.");
  }

  const nextBills = new Map((next.bills || []).map((bill) => [bill.id, bill]));
  for (const oldBill of previous.bills || []) {
    const newBill = nextBills.get(oldBill.id);
    if (!newBill) throw securityError(`Bảo mật: Bill ${oldBill.invoiceNo || oldBill.id} không được xóa.`);
    if (stableStringify(billCore(oldBill)) !== stableStringify(billCore(newBill))) {
      throw securityError(`Bảo mật: Bill ${oldBill.invoiceNo || oldBill.id} đã khóa, không được sửa.`);
    }
    if (oldBill.status === "canceled") {
      if (stableStringify(oldBill) !== stableStringify(newBill)) {
        throw securityError(`Bảo mật: Bill đã hủy ${oldBill.invoiceNo || oldBill.id} không được sửa lại.`);
      }
      continue;
    }
    if (newBill.status !== oldBill.status) {
      const isCancel = oldBill.status !== "canceled" && newBill.status === "canceled";
      if (!isCancel) throw securityError(`Bảo mật: Trạng thái bill ${oldBill.invoiceNo || oldBill.id} không hợp lệ.`);
      if (!managerApproved(req)) {
        throw securityError("Bảo mật: Hủy bill cần Quản Lý duyệt.");
      }
      if (!String(newBill.cancelReason || "").trim()) {
        throw securityError("Bảo mật: Hủy bill phải có lý do.");
      }
    }
  }

  const oldBillIds = new Set((previous.bills || []).map((bill) => bill.id));
  for (const bill of next.bills || []) {
    if (oldBillIds.has(bill.id)) continue;
    if (bill.status && bill.status !== "paid") {
      throw securityError("Bảo mật: Bill mới phải là bill thanh toán hợp lệ.");
    }
    if (!bill.invoiceNo || !bill.createdAt || !Array.isArray(bill.items) || !bill.items.length) {
      throw securityError("Bảo mật: Bill mới thiếu thông tin bắt buộc.");
    }
  }

  const nextShiftLogs = new Map((next.shiftLogs || []).map((shift) => [shift.id, shift]));
  for (const oldShift of previous.shiftLogs || []) {
    const newShift = nextShiftLogs.get(oldShift.id);
    if (!newShift) throw securityError("Bảo mật: Lịch sử kết ca không được xóa.");
    if (stableStringify(oldShift) !== stableStringify(newShift)) {
      throw securityError("Bảo mật: Lịch sử kết ca đã khóa, không được sửa.");
    }
  }

  const nextSecurityLogs = new Map((next.securityLog || []).map((entry) => [entry.id, entry]));
  for (const oldEntry of previous.securityLog || []) {
    const newEntry = nextSecurityLogs.get(oldEntry.id);
    if (!newEntry) {
      throw securityError("Bảo mật: Nhật ký bảo mật không được xóa.");
    }
    if (stableStringify(oldEntry) !== stableStringify(newEntry)) {
      throw securityError("Bảo mật: Nhật ký bảo mật đã khóa, không được sửa.");
    }
  }
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
    const previousResult = await pool.query("SELECT data FROM app_state WHERE id = 1");
    const previous = previousResult.rows[0]?.data || null;
    if (req.user.role !== "manager") {
      requireCashierSafeUpdate(previous, data, req);
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
