const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;
const outputsDir = path.join(__dirname, "outputs");
const DEFAULT_WORKSPACE_ID = "pt-main";

const defaultUsers = new Map([
  ["9939", { password: "040426", role: "admin", name: "Admin", workspaceId: DEFAULT_WORKSPACE_ID, workspaceName: "PT Barbershop" }],
  ["3122", { password: "152004", role: "cashier", name: "Thu Ngan", workspaceId: DEFAULT_WORKSPACE_ID, workspaceName: "PT Barbershop" }]
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

function publicUser(user) {
  return user ? {
    id: user.id,
    password: user.password,
    role: user.role,
    name: user.name,
    workspaceId: user.workspaceId || DEFAULT_WORKSPACE_ID,
    workspaceName: user.workspaceName || "PT Barbershop"
  } : null;
}

async function findUser(id, password) {
  const fallback = defaultUsers.get(String(id));
  if (!pool) {
    return fallback && fallback.password === String(password) ? { id: String(id), ...fallback } : null;
  }
  await ensureDb();
  const result = await pool.query(
    "SELECT id, password, role, name, workspace_id, workspace_name FROM app_users WHERE id = $1 AND password = $2",
    [String(id), String(password)]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    password: row.password,
    role: row.role,
    name: row.name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name
  };
}

async function requireAuth(req, res, next) {
  const id = String(req.get("X-PT-User") || "");
  const password = String(req.get("X-PT-Password") || "");
  const user = await findUser(id, password).catch(() => null);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}

async function managerApproved(req) {
  const id = String(req.get("X-PT-Manager-User") || "");
  const password = String(req.get("X-PT-Manager-Password") || "");
  const user = await findUser(id, password).catch(() => null);
  return Boolean(user && ["admin", "manager"].includes(user.role) && user.workspaceId === req.user.workspaceId);
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
      if (!req.managerApproved) {
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
    CREATE TABLE IF NOT EXISTS account_groups (
      workspace_id text PRIMARY KEY,
      workspace_name text NOT NULL,
      manager_id text NOT NULL,
      cashier_id text NOT NULL,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id text PRIMARY KEY,
      password text NOT NULL,
      role text NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
      name text NOT NULL,
      workspace_id text NOT NULL REFERENCES account_groups(workspace_id) ON DELETE CASCADE,
      workspace_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check");
  await pool.query("ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'manager', 'cashier'))");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_states (
      workspace_id text PRIMARY KEY REFERENCES account_groups(workspace_id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `
      INSERT INTO account_groups (workspace_id, workspace_name, manager_id, cashier_id, created_by)
      VALUES ($1, 'PT Barbershop', '9939', '3122', 'system')
      ON CONFLICT (workspace_id) DO NOTHING
    `,
    [DEFAULT_WORKSPACE_ID]
  );
  for (const [id, user] of defaultUsers.entries()) {
    await pool.query(
      `
        INSERT INTO app_users (id, password, role, name, workspace_id, workspace_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id)
        DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, name = EXCLUDED.name, workspace_id = EXCLUDED.workspace_id, workspace_name = EXCLUDED.workspace_name
      `,
      [id, user.password, user.role, user.name, user.workspaceId, user.workspaceName]
    );
  }
  const legacyTable = await pool.query("SELECT to_regclass('public.app_state') AS table_name");
  if (legacyTable.rows[0]?.table_name) {
    const existing = await pool.query("SELECT workspace_id FROM workspace_states WHERE workspace_id = $1", [DEFAULT_WORKSPACE_ID]);
    if (!existing.rows.length) {
      const legacy = await pool.query("SELECT data FROM app_state WHERE id = 1");
      if (legacy.rows.length) {
        await pool.query(
          "INSERT INTO workspace_states (workspace_id, data, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (workspace_id) DO NOTHING",
          [DEFAULT_WORKSPACE_ID, JSON.stringify(legacy.rows[0].data)]
        );
      }
    }
  }
  dbReady = true;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/login", async (req, res, next) => {
  try {
    const id = String(req.body?.id || "");
    const password = String(req.body?.password || "");
    const user = await findUser(id, password);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let group = {
      workspaceId: user.workspaceId,
      workspaceName: user.workspaceName,
      managerId: ["admin", "manager"].includes(user.role) ? user.id : "",
      cashierId: user.role === "cashier" ? user.id : "",
      createdAt: ""
    };
    let usersInWorkspace = [publicUser(user)];
    if (pool) {
      const groupResult = await pool.query(
        "SELECT workspace_id, workspace_name, manager_id, cashier_id, created_at FROM account_groups WHERE workspace_id = $1",
        [user.workspaceId]
      );
      if (groupResult.rows.length) {
        const row = groupResult.rows[0];
        group = {
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          managerId: row.manager_id,
          cashierId: row.cashier_id,
          createdAt: row.created_at?.toISOString?.() || ""
        };
      }
      const usersResult = await pool.query(
        "SELECT id, password, role, name, workspace_id, workspace_name FROM app_users WHERE workspace_id = $1",
        [user.workspaceId]
      );
      usersInWorkspace = usersResult.rows.map((row) => publicUser({
        id: row.id,
        password: row.password,
        role: row.role,
        name: row.name,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name
      }));
    }
    res.json({
      user: publicUser(user),
      group,
      users: usersInWorkspace
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/account-groups", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Only admin can view accounts" });
      return;
    }
    await ensureDb();
    const groups = await pool.query("SELECT workspace_id, workspace_name, manager_id, cashier_id, created_at FROM account_groups ORDER BY created_at ASC");
    const usersResult = await pool.query("SELECT id, password, role, name, workspace_id, workspace_name FROM app_users ORDER BY created_at ASC");
    const usersByWorkspace = new Map();
    usersResult.rows.forEach((row) => {
      const workspaceUsers = usersByWorkspace.get(row.workspace_id) || [];
      workspaceUsers.push(publicUser({
        id: row.id,
        password: row.password,
        role: row.role,
        name: row.name,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name
      }));
      usersByWorkspace.set(row.workspace_id, workspaceUsers);
    });
    res.set("Cache-Control", "no-store");
    res.json({
      groups: groups.rows.map((row) => ({
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        managerId: row.manager_id,
        cashierId: row.cashier_id,
        createdAt: row.created_at?.toISOString?.() || "",
        users: usersByWorkspace.get(row.workspace_id) || []
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/account-groups", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Only admin can create accounts" });
      return;
    }
    await ensureDb();
    const workspaceName = String(req.body?.workspaceName || "").trim() || "PT Barbershop";
    const managerId = String(req.body?.managerId || "").trim();
    const managerPassword = String(req.body?.managerPassword || "").trim();
    const cashierId = String(req.body?.cashierId || "").trim();
    const cashierPassword = String(req.body?.cashierPassword || "").trim();
    if (!managerId || !managerPassword || !cashierId || !cashierPassword || managerId === cashierId) {
      res.status(400).json({ error: "Invalid account data" });
      return;
    }
    const exists = await pool.query("SELECT id FROM app_users WHERE id = ANY($1::text[])", [[managerId, cashierId]]);
    if (exists.rows.length) {
      res.status(409).json({ error: "ID already exists" });
      return;
    }
    const workspaceId = `pt-${randomUUID()}`;
    const group = { workspaceId, workspaceName, managerId, cashierId, createdAt: new Date().toISOString() };
    const users = [
      { id: managerId, password: managerPassword, role: "manager", name: `Quan Li ${workspaceName}`, workspaceId, workspaceName },
      { id: cashierId, password: cashierPassword, role: "cashier", name: `Thu Ngan ${workspaceName}`, workspaceId, workspaceName }
    ];
    await pool.query("BEGIN");
    try {
      await pool.query(
        "INSERT INTO account_groups (workspace_id, workspace_name, manager_id, cashier_id, created_by) VALUES ($1, $2, $3, $4, $5)",
        [workspaceId, workspaceName, managerId, cashierId, req.user.id]
      );
      for (const user of users) {
        await pool.query(
          "INSERT INTO app_users (id, password, role, name, workspace_id, workspace_name) VALUES ($1, $2, $3, $4, $5, $6)",
          [user.id, user.password, user.role, user.name, workspaceId, workspaceName]
        );
      }
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    res.status(201).json({ online: true, group, users });
  } catch (error) {
    next(error);
  }
});

app.put("/api/account-groups/:workspaceId", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Only admin can update accounts" });
      return;
    }
    await ensureDb();
    const workspaceId = String(req.params.workspaceId || "");
    const workspaceName = String(req.body?.workspaceName || "").trim() || "PT Barbershop";
    const managerId = String(req.body?.managerId || "").trim();
    const managerPassword = String(req.body?.managerPassword || "").trim();
    const cashierId = String(req.body?.cashierId || "").trim();
    const cashierPassword = String(req.body?.cashierPassword || "").trim();
    if (!workspaceId || !managerId || !managerPassword || !cashierId || !cashierPassword || managerId === cashierId) {
      res.status(400).json({ error: "Invalid account data" });
      return;
    }
    const groupExists = await pool.query("SELECT workspace_id FROM account_groups WHERE workspace_id = $1", [workspaceId]);
    if (!groupExists.rows.length) {
      res.status(404).json({ error: "Account group not found" });
      return;
    }
    const duplicate = await pool.query(
      "SELECT id FROM app_users WHERE workspace_id <> $1 AND id = ANY($2::text[])",
      [workspaceId, [managerId, cashierId]]
    );
    if (duplicate.rows.length) {
      res.status(409).json({ error: "ID already exists" });
      return;
    }

    const existingAdmin = await pool.query(
      "SELECT id FROM app_users WHERE workspace_id = $1 AND role = 'admin' LIMIT 1",
      [workspaceId]
    );
    const managerRole = existingAdmin.rows.length ? "admin" : "manager";
    const managerName = managerRole === "admin" ? "Admin" : `Quan Li ${workspaceName}`;
    const users = [
      { id: managerId, password: managerPassword, role: managerRole, name: managerName, workspaceId, workspaceName },
      { id: cashierId, password: cashierPassword, role: "cashier", name: `Thu Ngan ${workspaceName}`, workspaceId, workspaceName }
    ];
    await pool.query("BEGIN");
    try {
      await pool.query(
        "UPDATE account_groups SET workspace_name = $2, manager_id = $3, cashier_id = $4 WHERE workspace_id = $1",
        [workspaceId, workspaceName, managerId, cashierId]
      );
      await pool.query("DELETE FROM app_users WHERE workspace_id = $1", [workspaceId]);
      for (const user of users) {
        await pool.query(
          "INSERT INTO app_users (id, password, role, name, workspace_id, workspace_name) VALUES ($1, $2, $3, $4, $5, $6)",
          [user.id, user.password, user.role, user.name, workspaceId, workspaceName]
        );
      }
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    res.json({
      online: true,
      group: { workspaceId, workspaceName, managerId, cashierId, createdAt: "" },
      users
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/account-groups/:workspaceId", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Only admin can delete accounts" });
      return;
    }
    await ensureDb();
    const workspaceId = String(req.params.workspaceId || "");
    if (!workspaceId || workspaceId === req.user.workspaceId) {
      res.status(400).json({ error: "Cannot delete current account group" });
      return;
    }
    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM workspace_states WHERE workspace_id = $1", [workspaceId]);
      await pool.query("DELETE FROM app_users WHERE workspace_id = $1", [workspaceId]);
      const result = await pool.query("DELETE FROM account_groups WHERE workspace_id = $1", [workspaceId]);
      await pool.query("COMMIT");
      if (!result.rowCount) {
        res.status(404).json({ error: "Account group not found" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.get("/api/state", requireAuth, async (req, res, next) => {
  try {
    await ensureDb();
    const result = await pool.query("SELECT data, updated_at FROM workspace_states WHERE workspace_id = $1", [req.user.workspaceId]);
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
    const previousResult = await pool.query("SELECT data FROM workspace_states WHERE workspace_id = $1", [req.user.workspaceId]);
    const previous = previousResult.rows[0]?.data || null;
    if (!["admin", "manager"].includes(req.user.role)) {
      req.managerApproved = await managerApproved(req);
      requireCashierSafeUpdate(previous, data, req);
    }
    const result = await pool.query(
      `
        INSERT INTO workspace_states (workspace_id, data, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (workspace_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at
      `,
      [req.user.workspaceId, JSON.stringify(data)]
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
