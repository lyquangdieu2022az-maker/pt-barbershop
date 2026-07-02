const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHmac } = crypto;
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;
const outputsDir = path.join(__dirname, "outputs");
const publicDir = path.join(__dirname, "public-site");
const DEFAULT_WORKSPACE_ID = "pt-main";
const SESSION_COOKIE_NAME = "pt_barbershop_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_GLOBAL_MAX = Number(process.env.RATE_LIMIT_GLOBAL_MAX || 240);
const RATE_LIMIT_API_MAX = Number(process.env.RATE_LIMIT_API_MAX || 90);
const RATE_LIMIT_WRITE_MAX = Number(process.env.RATE_LIMIT_WRITE_MAX || 35);
const RATE_LIMIT_LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX || 20);
const TEMP_BLOCK_MS = Number(process.env.TEMP_BLOCK_MS || 10 * 60 * 1000);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "2mb";
const loginAttempts = new Map();
const rateBuckets = new Map();
const abuseScores = new Map();
const blockedClients = new Map();

function envText(name) {
  return String(process.env[name] || "").trim();
}

const bootstrapConfig = {
  adminId: envText("PT_ADMIN_ID"),
  adminPassword: envText("PT_ADMIN_PASSWORD"),
  cashierId: envText("PT_CASHIER_ID"),
  cashierPassword: envText("PT_CASHIER_PASSWORD")
};

const defaultUsers = new Map();
if (isValidAccountId(bootstrapConfig.adminId) && isValidPassword(bootstrapConfig.adminPassword)) {
  defaultUsers.set(bootstrapConfig.adminId, {
    password: bootstrapConfig.adminPassword,
    role: "admin",
    name: "Admin",
    workspaceId: DEFAULT_WORKSPACE_ID,
    workspaceName: "PT Barbershop"
  });
}
if (isValidAccountId(bootstrapConfig.cashierId) && isValidPassword(bootstrapConfig.cashierPassword)) {
  defaultUsers.set(bootstrapConfig.cashierId, {
    password: bootstrapConfig.cashierPassword,
    role: "cashier",
    name: "Thu Ngan",
    workspaceId: DEFAULT_WORKSPACE_ID,
    workspaceName: "PT Barbershop"
  });
}

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false }
    })
  : null;

let dbReady = false;

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function cleanupRateState() {
  const now = Date.now();
  for (const [key, record] of rateBuckets.entries()) {
    if (now - record.startedAt > RATE_LIMIT_WINDOW_MS * 3) rateBuckets.delete(key);
  }
  for (const [key, record] of abuseScores.entries()) {
    if (now - record.startedAt > TEMP_BLOCK_MS) abuseScores.delete(key);
  }
  for (const [key, blockedUntil] of blockedClients.entries()) {
    if (blockedUntil <= now) blockedClients.delete(key);
  }
}

setInterval(cleanupRateState, 60 * 1000).unref?.();

function markAbuse(ip) {
  const now = Date.now();
  const record = abuseScores.get(ip);
  if (!record || now - record.startedAt > TEMP_BLOCK_MS) {
    abuseScores.set(ip, { count: 1, startedAt: now });
    return;
  }
  record.count += 1;
  if (record.count >= 6) {
    blockedClients.set(ip, now + TEMP_BLOCK_MS);
    abuseScores.delete(ip);
  }
}

function rateLimit(scope, max, windowMs = RATE_LIMIT_WINDOW_MS) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const blockedUntil = blockedClients.get(ip);
    if (blockedUntil && blockedUntil > Date.now()) {
      res.set("Retry-After", String(Math.ceil((blockedUntil - Date.now()) / 1000)));
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const record = rateBuckets.get(key);
    if (!record || now - record.startedAt > windowMs) {
      rateBuckets.set(key, { count: 1, startedAt: now });
      next();
      return;
    }
    record.count += 1;
    const remaining = Math.max(0, max - record.count);
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(remaining));
    if (record.count > max) {
      markAbuse(ip);
      res.set("Retry-After", String(Math.ceil((windowMs - (now - record.startedAt)) / 1000)));
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    next();
  };
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  req.setTimeout(15 * 1000);
  res.setTimeout(15 * 1000);
  next();
});
app.use(rateLimit("global", RATE_LIMIT_GLOBAL_MAX));
app.use("/api/", rateLimit("api", RATE_LIMIT_API_MAX));
app.use(express.json({ limit: JSON_BODY_LIMIT }));

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  res.set("Cross-Origin-Resource-Policy", "same-origin");
  res.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
  if (req.secure || process.env.NODE_ENV === "production") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

function publicUser(user) {
  return user ? {
    id: user.id,
    role: user.role,
    name: user.name,
    workspaceId: user.workspaceId || DEFAULT_WORKSPACE_ID,
    workspaceName: user.workspaceName || "PT Barbershop"
  } : null;
}

function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + derived;
}

function passwordMatches(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(String(password), salt, 64).toString("hex");
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function parseCookies(req) {
  return String(req.get("Cookie") || "")
    .split(";")
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index < 0) return cookies;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload?.id && Number(payload.exp) > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function issueSession(req, res, user) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  res.cookie(SESSION_COOKIE_NAME, signSession({ id: user.id, exp: expiresAt }), {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: "lax",
    maxAge: SESSION_DURATION_MS,
    path: "/"
  });
}

function clearSession(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: "lax",
    path: "/"
  });
}

function loginKey(req, id) {
  return (req.ip || "unknown") + ":" + String(id || "").trim();
}

function isLoginLimited(req, id) {
  const record = loginAttempts.get(loginKey(req, id));
  if (!record) return false;
  if (Date.now() - record.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(loginKey(req, id));
    return false;
  }
  return record.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(req, id) {
  const key = loginKey(req, id);
  const record = loginAttempts.get(key);
  if (!record || Date.now() - record.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, startedAt: Date.now() });
    return;
  }
  record.count += 1;
}

function clearLoginFailures(req, id) {
  loginAttempts.delete(loginKey(req, id));
}

function isValidAccountId(value) {
  return /^[A-Za-z0-9_-]{4,32}$/.test(String(value || ""));
}

function isValidPassword(value) {
  return String(value || "").length >= 6 && String(value || "").length <= 128;
}

function userFromRow(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    passwordHash: row.password_hash || "",
    legacyPassword: row.password || ""
  };
}

async function findUser(id, password) {
  const fallback = defaultUsers.get(String(id));
  if (!pool) {
    return fallback && fallback.password === String(password) ? { id: String(id), ...fallback } : null;
  }
  await ensureDb();
  const result = await pool.query(
    "SELECT id, password, password_hash, role, name, workspace_id, workspace_name FROM app_users WHERE id = $1",
    [String(id)]
  );
  if (!result.rows.length) return null;
  const user = userFromRow(result.rows[0]);
  const valid = user.passwordHash
    ? passwordMatches(password, user.passwordHash)
    : user.legacyPassword === String(password);
  if (!valid) return null;
  if (!user.passwordHash || user.legacyPassword) {
    await pool.query(
      "UPDATE app_users SET password = '', password_hash = $2 WHERE id = $1",
      [user.id, passwordHash(password)]
    );
  }
  return user;
}

async function findUserById(id) {
  const fallback = defaultUsers.get(String(id));
  if (!pool) return fallback ? { id: String(id), ...fallback } : null;
  await ensureDb();
  const result = await pool.query(
    "SELECT id, password, password_hash, role, name, workspace_id, workspace_name FROM app_users WHERE id = $1",
    [String(id)]
  );
  return result.rows.length ? userFromRow(result.rows[0]) : null;
}

async function requireAuth(req, res, next) {
  const session = readSession(req);
  const user = session ? await findUserById(session.id).catch(() => null) : null;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
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

function simpleHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function formatInvoiceNo(sequence) {
  return "HD" + String(Math.max(0, Number(sequence || 0))).padStart(6, "0");
}

function safePaymentMethod(value) {
  return ["cash", "transfer", "card", "other"].includes(String(value || "")) ? String(value) : "cash";
}

function normalizeBillItem(item = {}) {
  return {
    id: String(item.id || ""),
    category: String(item.category || "extra"),
    name: String(item.name || "Dich vu").trim() || "Dich vu",
    price: Math.max(0, Number(item.price || 0)),
    commission: Math.max(0, Math.min(100, Number(item.commission || 0)))
  };
}

function billTotalsFromItems(items = []) {
  return items.reduce((totals, item) => {
    const price = Number(item.price || 0);
    totals.total += price;
    totals.commission += Math.round(price * Number(item.commission || 0) / 100);
    return totals;
  }, { total: 0, commission: 0 });
}

function billSecurityPayload(bill = {}, previousHash = "") {
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
    paymentMethod: safePaymentMethod(bill.paymentMethod),
    shiftId: bill.shiftId || "",
    createdBy: bill.createdBy || "",
    items: Array.isArray(bill.items) ? bill.items.map((item) => ({
      id: item.id || "",
      category: item.category || "",
      name: item.name || "",
      price: Number(item.price || 0),
      commission: Number(item.commission || 0)
    })) : [],
    total: Number(bill.total || 0),
    commission: Number(bill.commission || 0),
    previousHash: previousHash || ""
  };
}

function billHashFor(bill, previousHash = bill?.previousBillHash || "") {
  return simpleHash(stableStringify(billSecurityPayload(bill, previousHash)));
}

function billVerifyCode(bill) {
  const hash = bill.billHash || billHashFor(bill, bill.previousBillHash || "");
  return `PT-${String(bill.invoiceNo || "HD000000").replace(/\D/g, "").slice(-6)}-${hash.slice(0, 6)}`;
}

function sequenceFromInvoiceNo(invoiceNo) {
  const match = String(invoiceNo || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function maxInvoiceSequence(data = {}) {
  return Math.max(
    Number(data.invoiceCounter || 0),
    ...((data.bills || []).map((bill) => Number(bill.invoiceSequence || sequenceFromInvoiceNo(bill.invoiceNo) || 0)))
  );
}

function mergeRecordsById(previousItems = [], nextItems = []) {
  const records = new Map();
  previousItems.forEach((item) => {
    if (item?.id) records.set(String(item.id), item);
  });
  nextItems.forEach((item) => {
    if (item?.id) records.set(String(item.id), item);
  });
  return [...records.values()];
}

function mergeWorkspaceState(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, ...next };
  merged.bills = mergeRecordsById(previous.bills || [], next.bills || [])
    .sort((left, right) => Number(left.invoiceSequence || 0) - Number(right.invoiceSequence || 0));
  merged.cancelRequests = mergeRecordsById(previous.cancelRequests || [], next.cancelRequests || []);
  merged.shiftLogs = mergeRecordsById(previous.shiftLogs || [], next.shiftLogs || []);
  merged.securityLog = mergeRecordsById(previous.securityLog || [], next.securityLog || [])
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 500);
  merged.invoiceCounter = Math.max(maxInvoiceSequence(previous), maxInvoiceSequence(next), maxInvoiceSequence(merged));
  if (previous.shift?.id && next.shift?.id && previous.shift.id === next.shift.id) {
    merged.shift = {
      ...previous.shift,
      ...next.shift,
      queueCounter: Math.max(Number(previous.shift.queueCounter || 0), Number(next.shift.queueCounter || 0))
    };
  }
  return merged;
}

function appendSecurityLog(data, req, action, detail, bill = null) {
  const entry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    userId: req.user?.id || "",
    userName: req.user?.name || "Server",
    role: req.user?.role || "",
    shiftId: data.shift?.id || bill?.shiftId || "",
    action,
    invoiceNo: bill?.invoiceNo || "",
    detail
  };
  data.securityLog = [entry, ...mergeRecordsById(data.securityLog || [], [])].slice(0, 500);
}

function buildServerBill(draft, context) {
  const items = Array.isArray(draft.items) ? draft.items.map(normalizeBillItem).filter((item) => item.name && item.price >= 0) : [];
  if (!items.length) {
    const error = new Error("Bill must contain at least one service");
    error.statusCode = 400;
    throw error;
  }
  const totals = billTotalsFromItems(items);
  const bill = {
    id: String(draft.id || randomUUID()),
    createdAt: new Date().toISOString(),
    invoiceSequence: context.invoiceSequence,
    invoiceNo: formatInvoiceNo(context.invoiceSequence),
    queueNo: context.queueNo,
    customer: String(draft.customer || "Khach le").trim() || "Khach le",
    phone: String(draft.phone || "").trim(),
    staffId: String(draft.staffId || ""),
    staffName: String(draft.staffName || "Nhan vien").trim() || "Nhan vien",
    note: String(draft.note || "").trim(),
    paymentMethod: safePaymentMethod(draft.paymentMethod),
    shiftId: context.shiftId,
    createdBy: context.createdBy,
    createdById: context.createdById,
    status: "paid",
    canceledAt: "",
    canceledBy: "",
    cancelReason: "",
    items,
    total: totals.total,
    commission: totals.commission,
    previousBillHash: context.previousBillHash || "",
    billHash: "",
    verifyCode: "",
    lockedByServer: true
  };
  bill.billHash = billHashFor(bill, bill.previousBillHash);
  bill.verifyCode = billVerifyCode(bill);
  return bill;
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

function billLockedSnapshot(bill = {}) {
  const copy = { ...bill };
  delete copy.previousBillHash;
  delete copy.billHash;
  delete copy.verifyCode;
  return copy;
}

function cancelRequestCore(request = {}) {
  return {
    id: request.id || "",
    billId: request.billId || "",
    invoiceNo: request.invoiceNo || "",
    reason: request.reason || "",
    requestedAt: request.requestedAt || "",
    requestedById: request.requestedById || "",
    requestedBy: request.requestedBy || "",
    status: request.status || "pending",
    resolvedAt: request.resolvedAt || "",
    resolvedById: request.resolvedById || "",
    resolvedBy: request.resolvedBy || "",
    resolutionNote: request.resolutionNote || ""
  };
}

function requireCashierCancelRequestUpdate(previous, next, req) {
  const previousRequests = new Map((previous.cancelRequests || []).map((request) => [request.id, request]));
  const nextRequests = new Map((next.cancelRequests || []).map((request) => [request.id, request]));
  const previousBills = new Map((previous.bills || []).map((bill) => [bill.id, bill]));
  const pendingBillIds = new Set((previous.cancelRequests || [])
    .filter((request) => request.status === "pending")
    .map((request) => request.billId));

  for (const oldRequest of previous.cancelRequests || []) {
    const nextRequest = nextRequests.get(oldRequest.id);
    if (!nextRequest) continue;
    if (stableStringify(cancelRequestCore(oldRequest)) !== stableStringify(cancelRequestCore(nextRequest))) {
      throw securityError("Cashier cannot edit a cancellation request.");
    }
  }

  for (const request of next.cancelRequests || []) {
    if (previousRequests.has(request.id)) continue;
    const bill = previousBills.get(request.billId);
    if (!request.id || !bill || bill.status === "canceled") {
      throw securityError("Invalid cancellation request.");
    }
    if (!previous.shift?.isOpen || bill.shiftId !== previous.shift.id) {
      throw securityError("Cashier can request cancellation only during the active shift.");
    }
    if (request.status !== "pending" || !String(request.reason || "").trim()) {
      throw securityError("Cancellation request requires a reason and pending status.");
    }
    if (String(request.invoiceNo || "") !== String(bill.invoiceNo || "") || String(request.requestedById || "") !== String(req.user.id)) {
      throw securityError("Invalid cancellation request details.");
    }
    if (pendingBillIds.has(request.billId)) {
      throw securityError("This bill already has a pending cancellation request.");
    }
    pendingBillIds.add(request.billId);
  }
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

  if (previous.shopInfo && stableStringify(previous.shopInfo) !== stableStringify(next.shopInfo || {})) {
    throw securityError("Bao mat: Thu Ngan khong duoc sua thong tin in bill.");
  }

  requireCashierCancelRequestUpdate(previous, next, req);

  const nextBills = new Map((next.bills || []).map((bill) => [bill.id, bill]));
  for (const oldBill of previous.bills || []) {
    const newBill = nextBills.get(oldBill.id);
    if (!newBill) continue;
    if (stableStringify(billCore(oldBill)) !== stableStringify(billCore(newBill))) {
      throw securityError(`Bảo mật: Bill ${oldBill.invoiceNo || oldBill.id} đã khóa, không được sửa.`);
    }
    if (newBill.status === oldBill.status && stableStringify(billLockedSnapshot(oldBill)) !== stableStringify(billLockedSnapshot(newBill))) {
      throw securityError("Saved bill cannot be edited.");
    }
    if (oldBill.status === "canceled") {
      if (stableStringify(billLockedSnapshot(oldBill)) !== stableStringify(billLockedSnapshot(newBill))) {
        throw securityError(`Bảo mật: Bill đã hủy ${oldBill.invoiceNo || oldBill.id} không được sửa lại.`);
      }
      continue;
    }
    if (newBill.status !== oldBill.status) {
      throw securityError(`Bảo mật: Thu Ngân không được đổi trạng thái bill ${oldBill.invoiceNo || oldBill.id}.`);
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
    if (!newShift) continue;
    if (stableStringify(oldShift) !== stableStringify(newShift)) {
      throw securityError("Bảo mật: Lịch sử kết ca đã khóa, không được sửa.");
    }
  }

  const nextSecurityLogs = new Map((next.securityLog || []).map((entry) => [entry.id, entry]));
  for (const oldEntry of previous.securityLog || []) {
    const newEntry = nextSecurityLogs.get(oldEntry.id);
    if (!newEntry) continue;
    if (stableStringify(oldEntry) !== stableStringify(newEntry)) {
      throw securityError("Bảo mật: Nhật ký bảo mật đã khóa, không được sửa.");
    }
  }
}

async function upsertBillsFromState(workspaceId, data = {}) {
  const bills = Array.isArray(data.bills) ? data.bills : [];
  for (const bill of bills) {
    if (!bill?.id || !bill?.invoiceNo) continue;
    const sequence = Number(bill.invoiceSequence || sequenceFromInvoiceNo(bill.invoiceNo) || 0);
    const existing = await pool.query(
      `
        SELECT id FROM app_bills
        WHERE workspace_id = $1 AND (id = $2 OR invoice_no = $3 OR invoice_sequence = $4)
        LIMIT 1
      `,
      [workspaceId, bill.id, bill.invoiceNo, sequence]
    );
    if (existing.rows.length && existing.rows[0].id !== bill.id) continue;
    await pool.query(
      `
        INSERT INTO app_bills (
          id, workspace_id, invoice_sequence, invoice_no, queue_no, shift_id,
          status, bill_hash, verify_code, data, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, COALESCE($11::timestamptz, now()), now())
        ON CONFLICT (id)
        DO UPDATE SET
          status = EXCLUDED.status,
          bill_hash = EXCLUDED.bill_hash,
          verify_code = EXCLUDED.verify_code,
          data = EXCLUDED.data,
          updated_at = now()
      `,
      [
        bill.id,
        workspaceId,
        sequence,
        bill.invoiceNo,
        Number(bill.queueNo || 0),
        bill.shiftId || "",
        bill.status || "paid",
        bill.billHash || "",
        bill.verifyCode || "",
        JSON.stringify(bill),
        bill.createdAt || null
      ]
    );
  }
}

async function hydrateStateFromBillTable(workspaceId, data = {}) {
  const result = await pool.query(
    "SELECT data FROM app_bills WHERE workspace_id = $1 ORDER BY invoice_sequence ASC",
    [workspaceId]
  );
  if (!result.rows.length) return data;
  const billRows = result.rows.map((row) => row.data).filter(Boolean);
  const hydrated = {
    ...data,
    bills: mergeRecordsById(data.bills || [], billRows)
      .sort((left, right) => Number(left.invoiceSequence || 0) - Number(right.invoiceSequence || 0))
  };
  hydrated.invoiceCounter = Math.max(maxInvoiceSequence(data), maxInvoiceSequence(hydrated));
  if (hydrated.shift?.id) {
    const queueMax = hydrated.bills
      .filter((bill) => bill.shiftId === hydrated.shift.id)
      .reduce((max, bill) => Math.max(max, Number(bill.queueNo || 0)), Number(hydrated.shift.queueCounter || 0));
    hydrated.shift = { ...hydrated.shift, queueCounter: queueMax };
  }
  return hydrated;
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
      password_hash text,
      role text NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')),
      name text NOT NULL,
      workspace_id text NOT NULL REFERENCES account_groups(workspace_id) ON DELETE CASCADE,
      workspace_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash text");
  await pool.query("ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check");
  await pool.query("ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'manager', 'cashier'))");
  const legacyUsers = await pool.query(
    "SELECT id, password FROM app_users WHERE COALESCE(password_hash, '') = '' AND password <> ''"
  );
  for (const user of legacyUsers.rows) {
    await pool.query(
      "UPDATE app_users SET password = '', password_hash = $2 WHERE id = $1",
      [user.id, passwordHash(user.password)]
    );
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_states (
      workspace_id text PRIMARY KEY REFERENCES account_groups(workspace_id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_bills (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES account_groups(workspace_id) ON DELETE CASCADE,
      invoice_sequence integer NOT NULL,
      invoice_no text NOT NULL,
      queue_no integer NOT NULL DEFAULT 0,
      shift_id text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'paid',
      bill_hash text NOT NULL DEFAULT '',
      verify_code text NOT NULL DEFAULT '',
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, invoice_sequence),
      UNIQUE (workspace_id, invoice_no)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS app_bills_workspace_shift_idx ON app_bills (workspace_id, shift_id)");
  if (defaultUsers.size >= 2 && defaultUsers.has(bootstrapConfig.adminId) && defaultUsers.has(bootstrapConfig.cashierId)) {
    await pool.query(
      `
        INSERT INTO account_groups (workspace_id, workspace_name, manager_id, cashier_id, created_by)
        VALUES ($1, 'PT Barbershop', $2, $3, 'system')
        ON CONFLICT (workspace_id)
        DO UPDATE SET manager_id = EXCLUDED.manager_id, cashier_id = EXCLUDED.cashier_id
      `,
      [DEFAULT_WORKSPACE_ID, bootstrapConfig.adminId, bootstrapConfig.cashierId]
    );
    for (const [id, user] of defaultUsers.entries()) {
      await pool.query(
        `
          INSERT INTO app_users (id, password, password_hash, role, name, workspace_id, workspace_name)
          VALUES ($1, '', $2, $3, $4, $5, $6)
          ON CONFLICT (id)
          DO UPDATE SET
            password = '',
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            name = EXCLUDED.name,
            workspace_id = EXCLUDED.workspace_id,
            workspace_name = EXCLUDED.workspace_name
        `,
        [id, passwordHash(user.password), user.role, user.name, user.workspaceId, user.workspaceName]
      );
    }
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
  const statesForBillMigration = await pool.query("SELECT workspace_id, data FROM workspace_states");
  for (const row of statesForBillMigration.rows) {
    await upsertBillsFromState(row.workspace_id, row.data || {});
  }
  dbReady = true;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/login", rateLimit("login", RATE_LIMIT_LOGIN_MAX), async (req, res, next) => {
  try {
    const id = String(req.body?.id || "");
    const password = String(req.body?.password || "");
    if (isLoginLimited(req, id)) {
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }
    const user = await findUser(id, password);
    if (!user) {
      recordLoginFailure(req, id);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    clearLoginFailures(req, id);
    issueSession(req, res, user);
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
        "SELECT id, role, name, workspace_id, workspace_name FROM app_users WHERE workspace_id = $1",
        [user.workspaceId]
      );
      usersInWorkspace = usersResult.rows.map((row) => publicUser({
        id: row.id,
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

app.get("/api/session", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ user: publicUser(req.user) });
});

app.post("/api/logout", rateLimit("write", RATE_LIMIT_WRITE_MAX), (req, res) => {
  clearSession(req, res);
  res.status(204).end();
});

app.get("/api/account-groups", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "Only admin can view accounts" });
      return;
    }
    await ensureDb();
    const groups = await pool.query("SELECT workspace_id, workspace_name, manager_id, cashier_id, created_at FROM account_groups ORDER BY created_at ASC");
    const usersResult = await pool.query("SELECT id, role, name, workspace_id, workspace_name FROM app_users ORDER BY created_at ASC");
    const usersByWorkspace = new Map();
    usersResult.rows.forEach((row) => {
      const workspaceUsers = usersByWorkspace.get(row.workspace_id) || [];
      workspaceUsers.push(publicUser({
        id: row.id,
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

app.post("/api/account-groups", rateLimit("write", RATE_LIMIT_WRITE_MAX), requireAuth, async (req, res, next) => {
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
    if (!isValidAccountId(managerId) || !isValidPassword(managerPassword) || !isValidAccountId(cashierId) || !isValidPassword(cashierPassword) || managerId === cashierId) {
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
      { id: managerId, passwordHash: passwordHash(managerPassword), role: "manager", name: `Quan Li ${workspaceName}`, workspaceId, workspaceName },
      { id: cashierId, passwordHash: passwordHash(cashierPassword), role: "cashier", name: `Thu Ngan ${workspaceName}`, workspaceId, workspaceName }
    ];
    await pool.query("BEGIN");
    try {
      await pool.query(
        "INSERT INTO account_groups (workspace_id, workspace_name, manager_id, cashier_id, created_by) VALUES ($1, $2, $3, $4, $5)",
        [workspaceId, workspaceName, managerId, cashierId, req.user.id]
      );
      for (const user of users) {
        await pool.query(
          "INSERT INTO app_users (id, password, password_hash, role, name, workspace_id, workspace_name) VALUES ($1, '', $2, $3, $4, $5, $6)",
          [user.id, user.passwordHash, user.role, user.name, workspaceId, workspaceName]
        );
      }
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    res.status(201).json({ online: true, group, users: users.map(publicUser) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/account-groups/:workspaceId", rateLimit("write", RATE_LIMIT_WRITE_MAX), requireAuth, async (req, res, next) => {
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
    if (!workspaceId || !isValidAccountId(managerId) || !isValidPassword(managerPassword) || !isValidAccountId(cashierId) || !isValidPassword(cashierPassword) || managerId === cashierId) {
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
      { id: managerId, passwordHash: passwordHash(managerPassword), role: managerRole, name: managerName, workspaceId, workspaceName },
      { id: cashierId, passwordHash: passwordHash(cashierPassword), role: "cashier", name: `Thu Ngan ${workspaceName}`, workspaceId, workspaceName }
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
          "INSERT INTO app_users (id, password, password_hash, role, name, workspace_id, workspace_name) VALUES ($1, '', $2, $3, $4, $5, $6)",
          [user.id, user.passwordHash, user.role, user.name, workspaceId, workspaceName]
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
      users: users.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/account-groups/:workspaceId", rateLimit("write", RATE_LIMIT_WRITE_MAX), requireAuth, async (req, res, next) => {
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

app.post("/api/bills", rateLimit("write", RATE_LIMIT_WRITE_MAX), requireAuth, async (req, res, next) => {
  try {
    await ensureDb();
    const draft = req.body?.bill || {};
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      res.status(400).json({ error: "Invalid bill payload" });
      return;
    }
    await pool.query("BEGIN");
    try {
      const existing = draft.id
        ? await pool.query("SELECT data FROM app_bills WHERE id = $1 AND workspace_id = $2", [String(draft.id), req.user.workspaceId])
        : { rows: [] };
      if (existing.rows.length) {
        const stateResult = await pool.query("SELECT data, updated_at FROM workspace_states WHERE workspace_id = $1", [req.user.workspaceId]);
        const data = stateResult.rows.length
          ? await hydrateStateFromBillTable(req.user.workspaceId, stateResult.rows[0].data || {})
          : { bills: [existing.rows[0].data] };
        await pool.query("COMMIT");
        res.json({
          ok: true,
          duplicate: true,
          bill: existing.rows[0].data,
          data,
          updatedAt: stateResult.rows[0]?.updated_at?.toISOString?.() || new Date().toISOString()
        });
        return;
      }

      const stateResult = await pool.query(
        "SELECT data FROM workspace_states WHERE workspace_id = $1 FOR UPDATE",
        [req.user.workspaceId]
      );
      if (!stateResult.rows.length) {
        const error = new Error("Open and sync the shift before saving bills online");
        error.statusCode = 409;
        throw error;
      }
      let data = await hydrateStateFromBillTable(req.user.workspaceId, stateResult.rows[0].data || {});
      if (!data.shift?.isOpen || !data.shift?.id) {
        const error = new Error("Shift is not open");
        error.statusCode = 409;
        throw error;
      }

      const maxBillResult = await pool.query(
        "SELECT MAX(invoice_sequence) AS max_sequence FROM app_bills WHERE workspace_id = $1",
        [req.user.workspaceId]
      );
      const invoiceSequence = Math.max(
        maxInvoiceSequence(data),
        Number(maxBillResult.rows[0]?.max_sequence || 0)
      ) + 1;
      const queueNo = Number(data.shift.queueCounter || 0) + 1;
      const previousBill = (data.bills || [])
        .slice()
        .sort((left, right) => Number(right.invoiceSequence || 0) - Number(left.invoiceSequence || 0))[0];
      const bill = buildServerBill(draft, {
        invoiceSequence,
        queueNo,
        shiftId: data.shift.id,
        previousBillHash: previousBill?.billHash || "",
        createdBy: req.user.name,
        createdById: req.user.id
      });

      data.bills = mergeRecordsById(data.bills || [], [bill])
        .sort((left, right) => Number(left.invoiceSequence || 0) - Number(right.invoiceSequence || 0));
      data.invoiceCounter = Math.max(maxInvoiceSequence(data), invoiceSequence);
      data.shift = { ...data.shift, queueCounter: queueNo };
      appendSecurityLog(
        data,
        req,
        "Luu bill server",
        `${bill.staffName} lam ${bill.items.length} dich vu, tong ${bill.total}, STT #${bill.queueNo}`,
        bill
      );

      await pool.query(
        `
          INSERT INTO app_bills (
            id, workspace_id, invoice_sequence, invoice_no, queue_no, shift_id,
            status, bill_hash, verify_code, data, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, now())
        `,
        [
          bill.id,
          req.user.workspaceId,
          bill.invoiceSequence,
          bill.invoiceNo,
          bill.queueNo,
          bill.shiftId,
          bill.status,
          bill.billHash,
          bill.verifyCode,
          JSON.stringify(bill),
          bill.createdAt
        ]
      );
      const updateResult = await pool.query(
        `
          INSERT INTO workspace_states (workspace_id, data, updated_at)
          VALUES ($1, $2::jsonb, now())
          ON CONFLICT (workspace_id)
          DO UPDATE SET data = EXCLUDED.data, updated_at = now()
          RETURNING updated_at
        `,
        [req.user.workspaceId, JSON.stringify(data)]
      );
      await pool.query("COMMIT");
      res.set("Cache-Control", "no-store");
      res.status(201).json({
        ok: true,
        bill,
        data,
        updatedAt: updateResult.rows[0].updated_at.toISOString()
      });
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
    const data = await hydrateStateFromBillTable(req.user.workspaceId, result.rows[0].data);
    res.json({
      data,
      updatedAt: result.rows[0].updated_at.toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/state", rateLimit("write", RATE_LIMIT_WRITE_MAX), requireAuth, async (req, res, next) => {
  try {
    await ensureDb();
    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      res.status(400).json({ error: "Invalid state payload" });
      return;
    }
    const previousResult = await pool.query("SELECT data FROM workspace_states WHERE workspace_id = $1", [req.user.workspaceId]);
    const previous = previousResult.rows[0]?.data
      ? await hydrateStateFromBillTable(req.user.workspaceId, previousResult.rows[0].data)
      : null;
    if (!["admin", "manager"].includes(req.user.role)) {
      requireCashierSafeUpdate(previous, data, req);
    }
    const mergedData = await hydrateStateFromBillTable(
      req.user.workspaceId,
      mergeWorkspaceState(previous, data)
    );
    await upsertBillsFromState(req.user.workspaceId, mergedData);
    const result = await pool.query(
      `
        INSERT INTO workspace_states (workspace_id, data, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (workspace_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at
      `,
      [req.user.workspaceId, JSON.stringify(mergedData)]
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, updatedAt: result.rows[0].updated_at.toISOString() });
  } catch (error) {
    next(error);
  }
});

function setStaticCacheHeaders(res, filePath) {
  if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
    res.setHeader("Cache-Control", "no-store");
  } else {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
}

app.get("/pos", (req, res) => {
  res.redirect(302, "/pos/");
});

app.use("/pos", express.static(outputsDir, {
  dotfiles: "ignore",
  etag: true,
  maxAge: "1h",
  setHeaders: setStaticCacheHeaders
}));

app.get("/pos/*", (req, res) => {
  res.sendFile(path.join(outputsDir, "index.html"));
});

app.use(express.static(publicDir, {
  dotfiles: "ignore",
  etag: true,
  maxAge: "1h",
  setHeaders: setStaticCacheHeaders
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "Server error" : error.message });
});

app.listen(port, () => {
  console.log(`PT Barbershop POS running on port ${port}`);
});
