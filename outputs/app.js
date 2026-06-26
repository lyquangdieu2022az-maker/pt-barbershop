const STORE_KEY = "barbershop-order-v1";
const ACCOUNT_STORE_KEY = "barbershop-accounts-v1";
const SESSION_KEY = "barbershop-session-v1";
const BACKUP_VERSION = 1;
const SYNC_INTERVAL_MS = 2500;
const ACCOUNT_SYNC_INTERVAL_MS = 3500;
const API_BASE_URL = String(window.PT_API_BASE_URL || "").replace(/\/+$/, "");
const DEFAULT_WORKSPACE_ID = "pt-main";

const USERS = [
  { id: "9939", password: "040426", role: "admin", name: "Admin" },
  { id: "3122", password: "152004", role: "cashier", name: "Thu Ngân" }
];

const defaultAccountState = {
  groups: [
    {
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: "PT Barbershop",
      managerId: "9939",
      cashierId: "3122",
      createdAt: ""
    }
  ],
  users: [
    { id: "9939", password: "040426", role: "admin", name: "Admin", workspaceId: DEFAULT_WORKSPACE_ID, workspaceName: "PT Barbershop" },
    { id: "3122", password: "152004", role: "cashier", name: "Thu Ngan", workspaceId: DEFAULT_WORKSPACE_ID, workspaceName: "PT Barbershop" }
  ]
};

const categoryNames = {
  cut: "Cắt",
  perm: "Uốn",
  color: "Nhuộm",
  extra: "Dịch vụ"
};

const categoryOrder = ["cut", "perm", "color", "extra"];

const paymentNames = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  other: "Khác"
};

const paymentOrder = ["cash", "transfer", "card", "other"];
const SECURITY_LOG_LIMIT = 500;

const defaultState = {
  session: null,
  loggedIn: false,
  workspaceId: DEFAULT_WORKSPACE_ID,
  invoiceCounter: 0,
  staff: [
    { id: crypto.randomUUID(), name: "Nhân viên A" },
    { id: crypto.randomUUID(), name: "Nhân viên B" }
  ],
  services: [
    { id: crypto.randomUUID(), category: "cut", name: "Player", price: 80000, commission: 30 },
    { id: crypto.randomUUID(), category: "cut", name: "Fade", price: 70000, commission: 30 },
    { id: crypto.randomUUID(), category: "perm", name: "Phồng", price: 250000, commission: 35 },
    { id: crypto.randomUUID(), category: "color", name: "Hồng phấn", price: 350000, commission: 35 },
    { id: crypto.randomUUID(), category: "extra", name: "Cạo mặt", price: 50000, commission: 25 },
    { id: crypto.randomUUID(), category: "extra", name: "Gội đầu lấy tai", price: 70000, commission: 25 },
    { id: crypto.randomUUID(), category: "extra", name: "Đắp mặt nạ", price: 60000, commission: 20 },
    { id: crypto.randomUUID(), category: "extra", name: "Lột mụn", price: 90000, commission: 25 }
  ],
  selectedServiceIds: [],
  shopInfo: {
    receiptName: "PT Barbershop",
    address: "",
    phone: "",
    receiptWidth: "58mm"
  },
  bills: [],
  cancelRequests: [],
  shift: {
    id: "",
    isOpen: false,
    openedAt: "",
    closedAt: "",
    cashierName: "",
    openingCash: 0,
    closingCash: 0,
    queueCounter: 0
  },
  shiftLogs: [],
  securityLog: []
};

let accountState = loadAccountState();
saveSession(null);
let state = loadState(DEFAULT_WORKSPACE_ID);
state.session = null;
state.loggedIn = false;
let cloudStarted = false;
let cloudBooting = false;
let cloudSaveTimer = null;
let cloudPendingSave = false;
let applyingRemoteState = false;
let lastRemoteUpdatedAt = "";
let syncOnline = false;
let accountSyncOnline = false;
let accountSyncStatus = "Chưa kiểm tra";
let toastTimer = null;
let deferredInstallPrompt = null;
let pendingShiftExcel = null;

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0)) + " VND";
const timeText = (iso) => iso ? new Date(iso).toLocaleString("vi-VN") : "";
const receiptTimeText = (iso) => iso ? new Date(iso).toLocaleString("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
}) : "";
const apiUrl = (path) => `${API_BASE_URL}${path}`;

function isFileOfflineMode() {
  return window.location.protocol === "file:";
}

function canUseLocalLoginFallback() {
  return isFileOfflineMode() || window.navigator.onLine === false;
}

function accountSyncMessage() {
  if (accountSyncOnline) return `${accountSyncStatus} - mọi máy sẽ thấy cùng danh sách ID`;
  if (isFileOfflineMode()) return "Bản offline dự phòng - tài khoản chỉ nằm trên máy này";
  return `${accountSyncStatus} - kiểm tra Render/Postgres trước khi giao khách`;
}

function isRunningAsApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updateInstallButton() {
  const button = $("#installAppBtn");
  if (!button) return;
  button.classList.toggle("is-hidden", isRunningAsApp());
}

async function handleInstallApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      showToast("Đã cài app PT Barbershop");
    }
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }

  alert([
    "iPhone: mở bằng Safari, bấm nút Chia sẻ, chọn Thêm vào Màn hình chính.",
    "Android: bấm menu trình duyệt, chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính."
  ].join("\n"));
}

function sequenceFromInvoiceNo(invoiceNo) {
  const digits = String(invoiceNo || "").match(/\d+/g)?.join("");
  return digits ? Number(digits) : 0;
}

function formatInvoiceNo(sequence) {
  return `HD${String(Number(sequence || 0)).padStart(6, "0")}`;
}

function safePaymentMethod(method) {
  return paymentNames[method] ? method : "cash";
}

function paymentLabel(method) {
  return paymentNames[safePaymentMethod(method)];
}

function normalizeReceiptWidth(width) {
  return ["58mm", "80mm"].includes(String(width || "")) ? String(width) : "58mm";
}

function normalizeShopInfo(info = {}) {
  return {
    receiptName: String(info.receiptName || "PT Barbershop").trim() || "PT Barbershop",
    address: String(info.address || "").trim(),
    phone: String(info.phone || "").trim(),
    receiptWidth: normalizeReceiptWidth(info.receiptWidth)
  };
}

function currentShopInfo() {
  return normalizeShopInfo(state.shopInfo || {});
}

function setReceiptPrintStyle() {
  const width = currentShopInfo().receiptWidth;
  document.documentElement.style.setProperty("--receipt-width", width);
  let style = document.getElementById("receiptPrintSizeStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "receiptPrintSizeStyle";
    document.head.appendChild(style);
  }
  style.textContent = `@media print { @page { size: ${width} auto; margin: 2mm; } .print-area, .receipt { width: ${width}; max-width: ${width}; } }`;
}

function receiptShopHeaderHtml() {
  const info = currentShopInfo();
  return `
    <h1>${escapeHtml(info.receiptName)}</h1>
    ${info.address ? `<p class="receipt-address">${escapeHtml(info.address)}</p>` : ""}
    ${info.phone ? `<p class="receipt-address">ĐT: ${escapeHtml(info.phone)}</p>` : ""}
  `;
}

function stableDataString(value) {
  if (Array.isArray(value)) return `[${value.map(stableDataString).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableDataString(value[key])}`).join(",")}}`;
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
  return simpleHash(stableDataString(billSecurityPayload(bill, previousHash)));
}

function billVerifyCode(bill) {
  const hash = bill.billHash || billHashFor(bill, bill.previousBillHash || "");
  return `PT-${String(bill.invoiceNo || "HD000000").replace(/\D/g, "").slice(-6)}-${hash.slice(0, 6)}`;
}

function receiptSealHtml(code = "") {
  const seed = simpleHash(code || "PT");
  const bits = Array.from({ length: 49 }, (_, index) => {
    const char = seed.charCodeAt(index % seed.length);
    return ((char + index * 17) % 5) < 2 ? " on" : "";
  });
  return `<div class="receipt-seal" aria-label="Tem xác thực">${bits.map((bit) => `<i class="${bit.trim()}"></i>`).join("")}</div>`;
}

function emptyPaymentTotals() {
  return paymentOrder.reduce((totals, method) => {
    totals[method] = 0;
    return totals;
  }, {});
}

function normalizePaymentTotals(totals = {}) {
  return paymentOrder.reduce((nextTotals, method) => {
    nextTotals[method] = Number(totals[method] || 0);
    return nextTotals;
  }, {});
}

function nextInvoiceSequence() {
  state.invoiceCounter = Number(state.invoiceCounter || 0) + 1;
  return state.invoiceCounter;
}

function nextQueueNumber() {
  state.shift.queueCounter = Number(state.shift.queueCounter || 0) + 1;
  return state.shift.queueCounter;
}

function normalizeAccountState(nextAccountState) {
  const merged = {
    groups: Array.isArray(nextAccountState?.groups) ? nextAccountState.groups : [],
    users: Array.isArray(nextAccountState?.users) ? nextAccountState.users : []
  };
  const usersById = new Map();
  [...defaultAccountState.users, ...merged.users].forEach((user) => {
    if (!user?.id) return;
    const role = ["admin", "manager", "cashier"].includes(user.role) ? user.role : "cashier";
    usersById.set(String(user.id), {
      id: String(user.id),
      password: String(user.password || ""),
      role,
      name: user.name || (role === "admin" ? "Admin" : role === "manager" ? "Quan Li" : "Thu Ngan"),
      workspaceId: user.workspaceId || DEFAULT_WORKSPACE_ID,
      workspaceName: user.workspaceName || "PT Barbershop"
    });
  });
  const rootAdmin = usersById.get("9939");
  if (rootAdmin && rootAdmin.workspaceId === DEFAULT_WORKSPACE_ID) {
    rootAdmin.role = "admin";
    rootAdmin.name = "Admin";
    rootAdmin.password = rootAdmin.password || "040426";
  }

  const groupsById = new Map();
  [...defaultAccountState.groups, ...merged.groups].forEach((group) => {
    if (!group?.workspaceId) return;
    const users = [...usersById.values()].filter((user) => user.workspaceId === group.workspaceId);
    groupsById.set(String(group.workspaceId), {
      workspaceId: String(group.workspaceId),
      workspaceName: group.workspaceName || users[0]?.workspaceName || "PT Barbershop",
      managerId: group.managerId || users.find((user) => user.role === "manager")?.id || "",
      cashierId: group.cashierId || users.find((user) => user.role === "cashier")?.id || "",
      createdAt: group.createdAt || ""
    });
  });

  return {
    groups: [...groupsById.values()],
    users: [...usersById.values()]
  };
}

function loadAccountState() {
  const saved = localStorage.getItem(ACCOUNT_STORE_KEY);
  if (!saved) return structuredClone(defaultAccountState);
  try {
    return normalizeAccountState(JSON.parse(saved));
  } catch {
    return structuredClone(defaultAccountState);
  }
}

function saveAccountState() {
  accountState = normalizeAccountState(accountState);
  localStorage.setItem(ACCOUNT_STORE_KEY, JSON.stringify(accountState));
}

function saveSession(session) {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function workspaceStoreKey(workspaceId) {
  return `${STORE_KEY}:${workspaceId || DEFAULT_WORKSPACE_ID}`;
}

function activeWorkspaceId() {
  return state.session?.workspaceId || state.workspaceId || DEFAULT_WORKSPACE_ID;
}

function publicUser(user) {
  return user ? {
    id: user.id,
    role: user.role,
    name: user.name,
    workspaceId: user.workspaceId || DEFAULT_WORKSPACE_ID,
    workspaceName: user.workspaceName || "PT Barbershop"
  } : null;
}

function findLocalUser(id, password) {
  return accountState.users.find((user) => user.id === String(id) && user.password === String(password));
}

function mergeAccountGroup(group, users = []) {
  if (!group?.workspaceId) return;
  accountState.groups = accountState.groups.filter((item) => item.workspaceId !== group.workspaceId);
  accountState.groups.push(group);
  users.forEach((user) => {
    const existing = accountState.users.find((item) => item.id === user.id);
    accountState.users = accountState.users.filter((item) => item.id !== user.id);
    accountState.users.push({
      ...existing,
      ...user,
      password: user.password || existing?.password || ""
    });
  });
  saveAccountState();
}

function loadState(workspaceId = DEFAULT_WORKSPACE_ID) {
  const key = workspaceStoreKey(workspaceId);
  const saved = localStorage.getItem(key) || (workspaceId === DEFAULT_WORKSPACE_ID ? localStorage.getItem(STORE_KEY) : null);
  if (!saved) return normalizeState({ ...structuredClone(defaultState), workspaceId });

  try {
    return normalizeState({ ...structuredClone(defaultState), ...JSON.parse(saved), workspaceId });
  } catch {
    return normalizeState({ ...structuredClone(defaultState), workspaceId });
  }
}

function normalizeState(nextState) {
  nextState.session = nextState.session?.role ? nextState.session : null;
  nextState.loggedIn = Boolean(nextState.session);
  nextState.workspaceId = nextState.workspaceId || nextState.session?.workspaceId || DEFAULT_WORKSPACE_ID;
  nextState.invoiceCounter = Number(nextState.invoiceCounter || 0);
  nextState.staff = Array.isArray(nextState.staff) ? nextState.staff : structuredClone(defaultState.staff);
  nextState.services = Array.isArray(nextState.services) ? nextState.services : structuredClone(defaultState.services);
  nextState.selectedServiceIds = Array.isArray(nextState.selectedServiceIds) ? nextState.selectedServiceIds : [];
  nextState.shopInfo = normalizeShopInfo(nextState.shopInfo);
  nextState.cancelRequests = Array.isArray(nextState.cancelRequests) ? nextState.cancelRequests.map((request) => ({
    id: request.id || crypto.randomUUID(),
    billId: request.billId || "",
    invoiceNo: request.invoiceNo || "",
    reason: request.reason || "",
    requestedAt: request.requestedAt || new Date().toISOString(),
    requestedById: request.requestedById || "",
    requestedBy: request.requestedBy || "Thu Ngân",
    status: ["pending", "approved", "rejected"].includes(request.status) ? request.status : "pending",
    resolvedAt: request.resolvedAt || "",
    resolvedById: request.resolvedById || "",
    resolvedBy: request.resolvedBy || "",
    resolutionNote: request.resolutionNote || ""
  })) : [];
  nextState.securityLog = Array.isArray(nextState.securityLog) ? nextState.securityLog.map((entry) => ({
    id: entry.id || crypto.randomUUID(),
    createdAt: entry.createdAt || new Date().toISOString(),
    userId: entry.userId || "",
    userName: entry.userName || "Hệ thống",
    role: entry.role || "",
    shiftId: entry.shiftId || "",
    action: entry.action || "Thao tác",
    invoiceNo: entry.invoiceNo || "",
    detail: entry.detail || ""
  })).slice(0, SECURITY_LOG_LIMIT) : [];
  nextState.shift = { ...structuredClone(defaultState.shift), ...(nextState.shift || {}) };
  nextState.shift.queueCounter = Number(nextState.shift.queueCounter || 0);
  nextState.shiftLogs = Array.isArray(nextState.shiftLogs) ? nextState.shiftLogs.map((shift) => ({
    id: shift.id || crypto.randomUUID(),
    isOpen: false,
    openedAt: shift.openedAt || "",
    closedAt: shift.closedAt || "",
    cashierName: shift.cashierName || "-",
    openingCash: Number(shift.openingCash || 0),
    closingCash: Number(shift.closingCash || 0),
    sales: Number(shift.sales || 0),
    commission: Number(shift.commission || 0),
    canceledAmount: Number(shift.canceledAmount || 0),
    billCount: Number(shift.billCount || 0),
    canceledCount: Number(shift.canceledCount || 0),
    expectedCash: Number(shift.expectedCash || 0),
    difference: Number(shift.difference || 0),
    paymentTotals: normalizePaymentTotals(shift.paymentTotals),
    staffCommissions: Array.isArray(shift.staffCommissions) ? shift.staffCommissions.map((row) => ({
      name: row.name || "-",
      amount: Number(row.amount || 0)
    })) : []
  })) : [];

  if (!nextState.shift.id && nextState.shift.openedAt) {
    nextState.shift.id = "legacy-shift";
  }

  let invoiceCounter = nextState.invoiceCounter;
  const shiftQueueCounters = new Map();

  nextState.bills = Array.isArray(nextState.bills) ? nextState.bills.map((bill) => {
    const items = Array.isArray(bill.items) ? bill.items : [];
    const total = Number(bill.total ?? items.reduce((sum, item) => sum + Number(item.price || 0), 0));
    const commission = Number(bill.commission ?? items.reduce((sum, item) => {
      return sum + Number(item.price || 0) * Number(item.commission || 0) / 100;
    }, 0));
    const invoiceSequence = Number(bill.invoiceSequence || sequenceFromInvoiceNo(bill.invoiceNo) || 0) || (invoiceCounter + 1);
    const invoiceNo = bill.invoiceNo || formatInvoiceNo(invoiceSequence);
    const shiftId = bill.shiftId || nextState.shift.id || "legacy-shift";
    const queueNo = Number(bill.queueNo || 0) || ((shiftQueueCounters.get(shiftId) || 0) + 1);

    invoiceCounter = Math.max(invoiceCounter, invoiceSequence);
    shiftQueueCounters.set(shiftId, Math.max(shiftQueueCounters.get(shiftId) || 0, queueNo));

    return {
      id: bill.id || crypto.randomUUID(),
      createdAt: bill.createdAt || new Date().toISOString(),
      invoiceSequence,
      invoiceNo,
      queueNo,
      customer: bill.customer || "Khách lẻ",
      phone: bill.phone || "",
      staffId: bill.staffId || "",
      staffName: bill.staffName || "Chưa chọn",
      note: bill.note || "",
      paymentMethod: safePaymentMethod(bill.paymentMethod),
      shiftId,
      createdBy: bill.createdBy || "Hệ thống",
      status: bill.status || "paid",
      canceledAt: bill.canceledAt || "",
      canceledBy: bill.canceledBy || "",
      cancelReason: bill.cancelReason || "",
      approvedBy: bill.approvedBy || "",
      approvedAt: bill.approvedAt || "",
      locked: bill.locked !== false,
      previousBillHash: bill.previousBillHash || "",
      billHash: bill.billHash || "",
      verifyCode: bill.verifyCode || "",
      items,
      total,
      commission
    };
  }) : [];

  nextState.bills
    .slice()
    .sort((left, right) => Number(left.invoiceSequence || 0) - Number(right.invoiceSequence || 0) || new Date(left.createdAt) - new Date(right.createdAt))
    .forEach((bill, index, orderedBills) => {
      const previousBill = orderedBills[index - 1];
      const previousHash = bill.previousBillHash || previousBill?.billHash || "";
      if (!bill.previousBillHash) bill.previousBillHash = previousHash;
      if (!bill.billHash) bill.billHash = billHashFor(bill, previousHash);
      if (!bill.verifyCode) bill.verifyCode = billVerifyCode(bill);
    });

  nextState.shiftLogs = nextState.shiftLogs.map((shift) => {
    const hasPayments = paymentOrder.some((method) => Number(shift.paymentTotals?.[method] || 0));
    if (hasPayments) return shift;
    const billsInShift = nextState.bills.filter((bill) => bill.shiftId === shift.id);
    return {
      ...shift,
      paymentTotals: paymentTotalsForBills(billsInShift)
    };
  });

  nextState.invoiceCounter = Math.max(nextState.invoiceCounter, invoiceCounter);
  if (nextState.shift.id) {
    nextState.shift.queueCounter = Math.max(nextState.shift.queueCounter, shiftQueueCounters.get(nextState.shift.id) || 0);
  }

  return nextState;
}

function saveState() {
  state.workspaceId = activeWorkspaceId();
  localStorage.setItem(workspaceStoreKey(state.workspaceId), JSON.stringify(state));
  if (cloudStarted && isLoggedIn() && !applyingRemoteState) {
    scheduleCloudSave();
  }
}

function businessState() {
  return {
    invoiceCounter: state.invoiceCounter,
    shopInfo: state.shopInfo,
    staff: state.staff,
    services: state.services,
    bills: state.bills,
    cancelRequests: state.cancelRequests,
    shift: state.shift,
    shiftLogs: state.shiftLogs,
    securityLog: state.securityLog
  };
}

function hasBusinessData(data = businessState()) {
  return Boolean(
    Number(data.invoiceCounter || 0) ||
    (Array.isArray(data.bills) && data.bills.length) ||
    (Array.isArray(data.cancelRequests) && data.cancelRequests.length) ||
    (Array.isArray(data.shiftLogs) && data.shiftLogs.length) ||
    (Array.isArray(data.securityLog) && data.securityLog.length) ||
    data.shift?.isOpen ||
    Number(data.shift?.openingCash || 0) ||
    stableDataString(normalizeShopInfo(data.shopInfo)) !== stableDataString(defaultState.shopInfo) ||
    (Array.isArray(data.staff) && data.staff.length !== defaultState.staff.length) ||
    (Array.isArray(data.services) && data.services.length !== defaultState.services.length)
  );
}

function applyBusinessState(data) {
  const currentSession = state.session;
  const currentSelected = state.selectedServiceIds;
  const currentWorkspaceId = activeWorkspaceId();
  applyingRemoteState = true;
  state = normalizeState({
    ...structuredClone(defaultState),
    ...data,
    workspaceId: currentWorkspaceId,
    session: currentSession,
    loggedIn: Boolean(currentSession),
    selectedServiceIds: currentSelected
  });
  saveState();
  applyingRemoteState = false;
  renderAll();
}

function syncHeaders() {
  return { "Content-Type": "application/json" };
}

function setSyncStatus(text, online = false) {
  syncOnline = online;
  const element = $("#syncStatus");
  if (element) element.textContent = text;
}

function showToast(message, tone = "ok") {
  const element = $("#toast");
  if (!element) return;
  clearTimeout(toastTimer);
  element.textContent = message;
  element.className = `toast ${tone}`;
  toastTimer = setTimeout(() => element.classList.add("is-hidden"), 2600);
}

function logSecurity(action, detail = "", bill = null) {
  if (!Array.isArray(state.securityLog)) state.securityLog = [];
  state.securityLog.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    userId: state.session?.id || "",
    userName: state.session?.name || "Hệ thống",
    role: state.session?.role || "",
    shiftId: state.shift?.id || "",
    action,
    invoiceNo: bill?.invoiceNo || "",
    detail
  });
  state.securityLog = state.securityLog.slice(0, SECURITY_LOG_LIMIT);
}

async function fetchCloudState() {
  const response = await fetch(apiUrl("/api/state"), { headers: syncHeaders(), credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Sync fetch failed");
  return response.json();
}

async function cloudLogin(id, password) {
  const response = await fetch(apiUrl("/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id, password })
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const error = new Error(errorPayload.error || "Không đăng nhập được server.");
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (payload.user) {
    mergeAccountGroup(payload.group, payload.users || [payload.user]);
    return payload.user;
  }
  return null;
}

async function restoreCloudSession() {
  try {
    const response = await fetch(apiUrl("/api/session"), {
      headers: syncHeaders(),
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.user) return;
    const session = publicUser(payload.user);
    mergeAccountGroup({
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName,
      managerId: ["admin", "manager"].includes(session.role) ? session.id : "",
      cashierId: session.role === "cashier" ? session.id : "",
      createdAt: ""
    }, [payload.user]);
    pendingShiftExcel = null;
    state = loadState(session.workspaceId);
    state.session = session;
    state.loggedIn = true;
    state.workspaceId = session.workspaceId;
    saveState();
    renderAll();
    setActiveTab("order");
    startCloudSync();
    syncAccountGroups({ silent: true });
  } catch {
    // Offline mode requires a fresh local login.
  }
}

async function syncAccountGroups(options = {}) {
  if (!isAdmin()) return false;
  const silent = options.silent !== false;
  try {
    const response = await fetch(apiUrl("/api/account-groups"), {
      headers: syncHeaders(),
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const error = new Error(errorPayload.error || "Không đồng bộ được tài khoản.");
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    (payload.groups || []).forEach((group) => mergeAccountGroup(group, group.users || []));
    accountSyncOnline = true;
    accountSyncStatus = `Online ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
    renderAccountGroups();
    return true;
  } catch {
    accountSyncOnline = false;
    accountSyncStatus = isFileOfflineMode() ? "Offline dự phòng" : "Chưa nối được server tài khoản";
    renderAccountGroups();
    if (!silent) {
      const status = $("#accountStatus");
      if (status) status.textContent = accountSyncMessage();
    }
    return false;
  }
}

async function createCloudAccountGroup(payload) {
  const response = await fetch(apiUrl("/api/account-groups"), {
    method: "POST",
    headers: syncHeaders(),
    credentials: "include",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const error = new Error(errorPayload.error || "Không tạo được tài khoản online.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function updateCloudAccountGroup(workspaceId, payload) {
  const response = await fetch(apiUrl(`/api/account-groups/${encodeURIComponent(workspaceId)}`), {
    method: "PUT",
    headers: syncHeaders(),
    credentials: "include",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const error = new Error(errorPayload.error || "Không sửa được tài khoản online.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function deleteCloudAccountGroup(workspaceId) {
  const response = await fetch(apiUrl(`/api/account-groups/${encodeURIComponent(workspaceId)}`), {
    method: "DELETE",
    headers: syncHeaders(),
    credentials: "include"
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const error = new Error(errorPayload.error || "Không xóa được tài khoản online.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function pushCloudState() {
  const response = await fetch(apiUrl("/api/state"), {
    method: "POST",
    headers: syncHeaders(),
    credentials: "include",
    body: JSON.stringify({ data: businessState() })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403) {
      showToast(payload.error || "Bảo mật đã chặn thao tác bill.", "danger");
    }
    throw new Error(payload.error || "Sync save failed");
  }
  const payload = await response.json();
  lastRemoteUpdatedAt = payload.updatedAt || lastRemoteUpdatedAt;
  setSyncStatus("Online", true);
}

async function pullCloudState() {
  if (!isLoggedIn()) return;
  const payload = await fetchCloudState();
  if (!payload.data) {
    if (hasBusinessData()) {
      await pushCloudState();
    } else {
      setSyncStatus("Online", true);
    }
    return;
  }
  if (payload.updatedAt && payload.updatedAt !== lastRemoteUpdatedAt) {
    lastRemoteUpdatedAt = payload.updatedAt;
    applyBusinessState(payload.data);
  }
  setSyncStatus("Online", true);
}

function scheduleCloudSave() {
  cloudPendingSave = true;
  if (cloudBooting) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    cloudPendingSave = false;
    try {
      await pushCloudState();
    } catch {
      setSyncStatus("Lưu trên máy này", false);
    }
  }, 500);
}

async function startCloudSync() {
  if (!isLoggedIn()) {
    setSyncStatus("Chưa đăng nhập", false);
    return;
  }
  cloudStarted = true;
  cloudBooting = true;
  setSyncStatus("Đang đồng bộ", false);
  try {
    await pullCloudState();
    if (isAdmin()) syncAccountGroups({ silent: true });
    cloudBooting = false;
    if (cloudPendingSave) scheduleCloudSave();
    clearInterval(window.__ptSyncInterval);
    clearInterval(window.__ptAccountSyncInterval);
    window.__ptSyncInterval = setInterval(() => {
      pullCloudState().catch(() => setSyncStatus("Lưu trên máy này", false));
    }, SYNC_INTERVAL_MS);
    if (isAdmin()) {
      window.__ptAccountSyncInterval = setInterval(() => {
        syncAccountGroups({ silent: true });
      }, ACCOUNT_SYNC_INTERVAL_MS);
    }
  } catch {
    cloudBooting = false;
    setSyncStatus("Lưu trên máy này", false);
  }
}

function dataForBackup() {
  return {
    invoiceCounter: state.invoiceCounter,
    shopInfo: state.shopInfo,
    staff: state.staff,
    services: state.services,
    bills: state.bills,
    cancelRequests: state.cancelRequests,
    shift: state.shift,
    shiftLogs: state.shiftLogs,
    securityLog: state.securityLog
  };
}

function renderBackupInfo() {
  const container = $("#backupInfo");
  if (!container) return;
  container.innerHTML = `
    <div class="summary-row"><span>Dịch vụ</span><strong>${state.services.length}</strong></div>
    <div class="summary-row"><span>Nhân viên</span><strong>${state.staff.length}</strong></div>
    <div class="summary-row"><span>Bill đã lưu</span><strong>${state.bills.length}</strong></div>
    <div class="summary-row"><span>Lịch sử kết ca</span><strong>${state.shiftLogs.length}</strong></div>
    <div class="summary-row"><span>Nhật ký bảo mật</span><strong>${state.securityLog.length}</strong></div>
  `;
}

function setBackupStatus(message) {
  const element = $("#backupStatus");
  if (element) element.textContent = message;
}

function downloadBackup() {
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được sao lưu dữ liệu.");
    return;
  }

  const payload = {
    app: "PT Barbershop POS",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: dataForBackup()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const dateName = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `pt-barbershop-sao-luu-${dateName}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  setBackupStatus("Đã tải file sao lưu. Hãy giữ file này trong USB, Zalo, Google Drive hoặc iCloud.");
}

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function excelDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function excelDateFromKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function excelDateLabel(key) {
  const date = excelDateFromKey(key);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function excelTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function lastThirtyExcelDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    days.push(excelDayKey(date));
  }
  return days;
}

function reportBranchName() {
  return String(state.session?.workspaceName || "PT Barbershop").trim() || "PT Barbershop";
}

function reportRoleLabel() {
  return isAdmin() ? "Admin" : "Quản Lý";
}

function setExcelExportStatus(message) {
  const element = $("#excelExportStatus");
  if (element) element.textContent = message;
}

function renderExcelReportInfo() {
  const element = $("#excelReportScope");
  if (element) {
    const days = lastThirtyExcelDays();
    element.textContent = `${branchBrandName(reportBranchName())} | ${excelDateLabel(days[0])} - ${excelDateLabel(days[days.length - 1])}`;
  }
  const shiftButton = $("#downloadShiftExcelBtn");
  if (shiftButton) {
    const belongsToCurrentWorkspace = pendingShiftExcel?.workspaceId === activeWorkspaceId();
    shiftButton.classList.toggle("is-hidden", !pendingShiftExcel || !isManager() || !belongsToCurrentWorkspace);
  }
}

function excelEscape(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[character]));
}

function excelColumnName(index) {
  let current = Number(index) + 1;
  let name = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function excelCellXml(columnIndex, rowNumber, value, style = 0) {
  if (value === null || value === undefined) return "";
  const reference = `${excelColumnName(columnIndex)}${rowNumber}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  const text = String(value);
  const preserveSpace = /^\s|\s$/.test(text) ? " xml:space=\"preserve\"" : "";
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t${preserveSpace}>${excelEscape(text)}</t></is></c>`;
}

function excelRowXml(rowNumber, cells, options = {}) {
  const height = options.height ? ` ht="${options.height}" customHeight="1"` : "";
  return `<row r="${rowNumber}"${height}>${cells.join("")}</row>`;
}

function excelNormalizeRow(values, columnCount) {
  return Array.from({ length: columnCount }, (_, index) => values[index] ?? "");
}

function excelRowHeight(values, widths, baseHeight = 24) {
  const lineCount = values.reduce((highest, value, index) => {
    const width = Math.max(9, Number(widths[index] || 14));
    const lines = String(value ?? "")
      .split(/\r?\n/)
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(8, width * 1.15))), 0);
    return Math.max(highest, lines);
  }, 1);
  return Math.min(120, Math.max(baseHeight, 12 + lineCount * 14));
}

function excelCellStyle(columnIndex, row, options) {
  const isCanceled = row?.kind === "canceled";
  if (options.currencyColumns.includes(columnIndex)) return isCanceled ? 12 : 6;
  if (options.percentageColumns.includes(columnIndex)) return isCanceled ? 14 : 11;
  if (options.numberColumns.includes(columnIndex)) return isCanceled ? 13 : 7;
  return isCanceled ? 10 : 5;
}

function excelSheetXml(options) {
  const columnCount = options.headers.length;
  const lastColumn = excelColumnName(columnCount - 1);
  const headerRow = 6;
  const sourceRows = options.rows.length
    ? options.rows
    : [{ values: ["Chưa có dữ liệu trong 30 ngày gần nhất"], kind: "empty" }];
  const rows = [];
  rows.push(excelRowXml(1, [excelCellXml(0, 1, options.title, 1)], { height: 30 }));
  rows.push(excelRowXml(2, [excelCellXml(0, 2, options.subtitle, 2)], { height: 22 }));
  rows.push(excelRowXml(3, []));
  rows.push(excelRowXml(4, [excelCellXml(0, 4, options.info, 3)], { height: 20 }));
  rows.push(excelRowXml(5, []));
  rows.push(excelRowXml(
    headerRow,
    options.headers.map((header, index) => excelCellXml(index, headerRow, header, 4)),
    { height: 30 }
  ));

  sourceRows.forEach((row, rowIndex) => {
    const rowNumber = headerRow + 1 + rowIndex;
    const values = excelNormalizeRow(row.values || [], columnCount);
    rows.push(excelRowXml(
      rowNumber,
      values.map((value, columnIndex) => excelCellXml(
        columnIndex,
        rowNumber,
        value,
        excelCellStyle(columnIndex, row, options)
      )),
      { height: excelRowHeight(values, options.widths) }
    ));
  });

  const dataEndRow = headerRow + sourceRows.length;
  let totalRowXml = "";
  if (options.totalRow?.values) {
    const totalRowNumber = dataEndRow + 1;
    const values = excelNormalizeRow(options.totalRow.values, columnCount);
    totalRowXml = excelRowXml(
      totalRowNumber,
      values.map((value, columnIndex) => {
        const style = options.currencyColumns.includes(columnIndex) ? 9 : 8;
        return excelCellXml(columnIndex, totalRowNumber, value, style);
      }),
      { height: 24 }
    );
  }

  const columns = options.widths.map((width, index) => {
    const column = index + 1;
    return `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`;
  }).join("");
  const autoFilter = options.autoFilter === false ? "" : `<autoFilter ref="A${headerRow}:${lastColumn}${dataEndRow}"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rows.join("")}${totalRowXml}</sheetData>
  ${autoFilter}
  <mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A4:${lastColumn}4"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function excelStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#\,##0 &quot;VND&quot;"/>
    <numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF101820"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="11"/><color rgb="FF101820"/><name val="Times New Roman"/><family val="1"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF080B10"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC9282D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F5FB8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCEEFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE3E5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD7E0EA"/></left><right style="thin"><color rgb="FFD7E0EA"/></right><top style="thin"><color rgb="FFD7E0EA"/></top><bottom style="thin"><color rgb="FFD7E0EA"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="1" fillId="2" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="7" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="7" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function excelCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function excelConcatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function excelDosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function excelDosDate(date) {
  return ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function excelStoredZip(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = excelDosTime(now);
  const dosDate = excelDosDate(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(file.data);
    const crc = excelCrc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034B50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014B50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralDirectory = excelConcatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054B50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);
  return excelConcatBytes([...localParts, centralDirectory, endRecord]);
}

function excelContentTypesXml(sheetCount) {
  const worksheets = Array.from({ length: sheetCount }, (_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheets}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function excelWorkbookXml(sheets) {
  const sheetXml = sheets.map((sheet, index) => {
    return `<sheet name="${excelEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheetXml}</sheets>
</workbook>`;
}

function excelWorkbookRelsXml(sheetCount) {
  const worksheetRelationships = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRelationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function excelWorkbookBytes(sheets) {
  const createdAt = new Date().toISOString();
  const files = [
    { name: "[Content_Types].xml", data: excelContentTypesXml(sheets.length) },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>PT Barbershop POS</dc:creator>
  <cp:lastModifiedBy>PT Barbershop POS</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>PT Barbershop POS</Application>
  <Company>PT Barbershop</Company>
</Properties>`
    },
    { name: "xl/workbook.xml", data: excelWorkbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: excelWorkbookRelsXml(sheets.length) },
    { name: "xl/styles.xml", data: excelStylesXml() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.xml }))
  ];
  return excelStoredZip(files);
}

function excelServiceSummary(bill) {
  return (bill.items || []).map((item) => {
    const category = categoryNames[item.category] || "Dịch vụ";
    return `${category}: ${item.name} (${Number(item.commission || 0)}%)`;
  }).join(" | ");
}

function excelCommissionPercent(bill) {
  const total = Number(bill.total || 0);
  if (!total) return 0;
  return Math.round((Number(bill.commission || 0) / total * 100) * 10) / 10;
}

function excelFileNameSegment(value) {
  return String(value || "PT-Barbershop")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "PT-Barbershop";
}

function downloadExcelWorkbook(workbook, fileName) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([workbook], { type: EXCEL_MIME_TYPE }));
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadPendingShiftExcel() {
  if (!isManager()) {
    alert("Chỉ Admin hoặc Quản Lý mới được tải Excel kết ca.");
    return;
  }
  if (!pendingShiftExcel || pendingShiftExcel.workspaceId !== activeWorkspaceId()) {
    alert("Chưa có file Excel kết ca mới. Hãy chốt ca trước hoặc xuất báo cáo 30 ngày.");
    return;
  }
  downloadExcelWorkbook(pendingShiftExcel.workbook, pendingShiftExcel.fileName);
  setExcelExportStatus(`Đã tải lại ${pendingShiftExcel.fileName}.`);
  showToast("Đã tải Excel kết ca");
}

function excelReportDaysForBills(bills, fallbackDate) {
  const days = Array.from(new Set((bills || []).map((bill) => excelDayKey(bill.createdAt)).filter(Boolean))).sort();
  if (days.length) return days;
  const fallbackDay = excelDayKey(fallbackDate || new Date());
  return fallbackDay ? [fallbackDay] : lastThirtyExcelDays();
}

function exportExcelReport(options = {}) {
  if (!isManager()) {
    alert("Chỉ Admin hoặc Quản Lý mới được xuất báo cáo Excel.");
    return null;
  }
  if (typeof TextEncoder === "undefined") {
    alert("Trình duyệt này chưa hỗ trợ xuất Excel. Hãy cập nhật Safari, Chrome hoặc Edge.");
    return null;
  }

  const days = Array.isArray(options.days) && options.days.length
    ? Array.from(new Set(options.days)).sort()
    : lastThirtyExcelDays();
  const startDay = days[0];
  const endDay = days[days.length - 1];
  const sourceBills = Array.isArray(options.bills) ? options.bills : state.bills;
  const reportBills = sourceBills
    .filter((bill) => {
      const day = excelDayKey(bill.createdAt);
      return day >= startDay && day <= endDay;
    })
    .slice()
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  const billsByDay = new Map();
  reportBills.forEach((bill) => {
    const day = excelDayKey(bill.createdAt);
    const bills = billsByDay.get(day) || [];
    bills.push(bill);
    billsByDay.set(day, bills);
  });

  const dailyRows = days.map((day) => {
    const dayBills = billsByDay.get(day) || [];
    const totals = totalsForBills(dayBills);
    const payments = paymentTotalsForBills(dayBills);
    return {
      values: [
        excelDateLabel(day),
        totals.billCount,
        totals.sales,
        totals.commission,
        Math.max(0, totals.sales - totals.commission),
        payments.cash,
        payments.transfer,
        payments.card,
        payments.other,
        totals.canceledCount,
        totals.canceledAmount
      ]
    };
  });
  const reportTotals = totalsForBills(reportBills);
  const reportPayments = paymentTotalsForBills(reportBills);

  const detailRows = reportBills.map((bill) => ({
    kind: bill.status === "canceled" ? "canceled" : "paid",
    values: [
      excelDateLabel(excelDayKey(bill.createdAt)),
      excelTimeLabel(bill.createdAt),
      bill.invoiceNo || "-",
      bill.verifyCode || billVerifyCode(bill),
      bill.billHash || "-",
      bill.queueNo ? `#${bill.queueNo}` : "-",
      bill.customer || "Khách lẻ",
      bill.phone || "",
      bill.staffName || "-",
      excelServiceSummary(bill),
      paymentLabel(bill.paymentMethod),
      Number(bill.total || 0),
      excelCommissionPercent(bill),
      bill.status === "canceled" ? 0 : Number(bill.commission || 0),
      bill.status === "canceled" ? "Đã hủy" : "Đã tính tiền",
      bill.createdBy || "-",
      bill.status === "canceled" ? (bill.cancelReason || "Không ghi") : ""
    ]
  }));

  const staffDailyMap = new Map();
  activeBills(reportBills).forEach((bill) => {
    const day = excelDayKey(bill.createdAt);
    const staffName = bill.staffName || "Không xác định";
    const key = `${day}|${staffName}`;
    const row = staffDailyMap.get(key) || { day, staffName, billCount: 0, sales: 0, commission: 0 };
    row.billCount += 1;
    row.sales += Number(bill.total || 0);
    row.commission += Number(bill.commission || 0);
    staffDailyMap.set(key, row);
  });
  const staffDailyRows = Array.from(staffDailyMap.values())
    .sort((left, right) => left.day.localeCompare(right.day) || left.staffName.localeCompare(right.staffName, "vi"))
    .map((row) => ({
      values: [
        excelDateLabel(row.day),
        row.staffName,
        row.billCount,
        row.sales,
        row.commission,
        row.sales ? Math.round((row.commission / row.sales * 100) * 10) / 10 : 0
      ]
    }));

  const staffTotalMap = new Map();
  Array.from(staffDailyMap.values()).forEach((row) => {
    const total = staffTotalMap.get(row.staffName) || { staffName: row.staffName, billCount: 0, sales: 0, commission: 0 };
    total.billCount += row.billCount;
    total.sales += row.sales;
    total.commission += row.commission;
    staffTotalMap.set(row.staffName, total);
  });
  const staffTotalRows = Array.from(staffTotalMap.values())
    .sort((left, right) => right.commission - left.commission)
    .map((row) => ({
      values: [
        row.staffName,
        row.billCount,
        row.sales,
        row.commission,
        row.sales ? Math.round((row.commission / row.sales * 100) * 10) / 10 : 0
      ]
    }));

  const branch = reportBranchName();
  const reportLabel = options.reportLabel || "BÁO CÁO 30 NGÀY";
  const totalLabel = options.totalLabel || "30 NGÀY";
  const title = `PT BARBERSHOP | ${reportLabel}`;
  const subtitle = `CHI NHÁNH: ${branchBrandName(branch)}`;
  const info = `Khoảng thời gian: ${excelDateLabel(startDay)} - ${excelDateLabel(endDay)} | Xuất lúc: ${timeText(new Date().toISOString())} | Người xuất: ID ${state.session.id} (${reportRoleLabel()})`;
  const sheets = [
    {
      name: options.summarySheetName || "Tổng hợp 30 ngày",
      xml: excelSheetXml({
        title,
        subtitle,
        info,
        headers: ["Ngày", "Bill hợp lệ", "Doanh thu", "Chia thợ", "Tiệm còn lại", "Tiền mặt", "Chuyển khoản", "Thẻ", "Khác", "Đơn hủy", "Giá trị hủy"],
        rows: dailyRows,
        totalRow: {
          values: [`TỔNG ${totalLabel}`, reportTotals.billCount, reportTotals.sales, reportTotals.commission, Math.max(0, reportTotals.sales - reportTotals.commission), reportPayments.cash, reportPayments.transfer, reportPayments.card, reportPayments.other, reportTotals.canceledCount, reportTotals.canceledAmount]
        },
        widths: [14, 13, 17, 17, 17, 16, 17, 15, 15, 12, 17],
        currencyColumns: [2, 3, 4, 5, 6, 7, 8, 10],
        numberColumns: [1, 9],
        percentageColumns: []
      })
    },
    {
      name: "Chi tiết bill",
      xml: excelSheetXml({
        title,
        subtitle,
        info,
        headers: ["Ngày", "Giờ", "Số HĐ", "Mã xác thực", "Khóa bill", "STT", "Khách", "SĐT", "Thợ cắt/làm", "Dịch vụ", "Thanh toán", "Doanh thu", "% chia TB", "Chia thợ", "Trạng thái", "Thu ngân", "Lý do hủy"],
        rows: detailRows,
        totalRow: {
          values: ["TỔNG", "", "", "", "", "", "", "", "", "", "", reportTotals.sales, "", reportTotals.commission, `${reportTotals.billCount} hợp lệ / ${reportTotals.canceledCount} hủy`, "", ""]
        },
        widths: [13, 10, 14, 18, 14, 9, 22, 16, 22, 52, 16, 18, 13, 18, 16, 20, 36],
        currencyColumns: [11, 13],
        numberColumns: [],
        percentageColumns: [12]
      })
    },
    {
      name: "Chia thợ theo ngày",
      xml: excelSheetXml({
        title,
        subtitle,
        info,
        headers: ["Ngày", "Nhân viên", "Bill hợp lệ", "Doanh thu", "Tiền chia", "% chia TB"],
        rows: staffDailyRows,
        totalRow: {
          values: [`TỔNG ${totalLabel}`, "", reportTotals.billCount, reportTotals.sales, reportTotals.commission, ""]
        },
        widths: [14, 24, 13, 18, 18, 13],
        currencyColumns: [3, 4],
        numberColumns: [2],
        percentageColumns: [5]
      })
    },
    {
      name: "Tổng chia từng thợ",
      xml: excelSheetXml({
        title,
        subtitle,
        info,
        headers: ["Nhân viên", "Bill hợp lệ", "Doanh thu", "Tổng tiền chia", "% chia TB"],
        rows: staffTotalRows,
        totalRow: {
          values: [`TỔNG ${totalLabel}`, reportTotals.billCount, reportTotals.sales, reportTotals.commission, ""]
        },
        widths: [28, 13, 18, 20, 13],
        currencyColumns: [2, 3],
        numberColumns: [1],
        percentageColumns: [4]
      })
    }
  ];

  const workbook = excelWorkbookBytes(sheets);
  const fileTag = options.fileTag || "bao-cao-30-ngay";
  const fileName = `PT-Barbershop-${excelFileNameSegment(branch)}-${fileTag}-${excelDayKey(new Date()).replaceAll("-", "")}.xlsx`;
  const result = { fileName, workbook, reportTotals, workspaceId: activeWorkspaceId() };
  if (options.keepForManual) {
    pendingShiftExcel = result;
    renderExcelReportInfo();
  } else {
    downloadExcelWorkbook(workbook, fileName);
  }
  setExcelExportStatus(options.keepForManual
    ? `Đã tạo ${fileName}. Bấm Tải Excel kết ca để lưu file vào máy.`
    : `Đã tải ${fileName}. Báo cáo gồm ${reportTotals.billCount} bill hợp lệ và doanh thu chi tiết.`);
  showToast(options.toastMessage || "Đã xuất báo cáo Excel 30 ngày");
  return result;
}

function importBackupFile(file) {
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được khôi phục dữ liệu.");
    return;
  }
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed.data || parsed;
      if (!Array.isArray(data.services) || !Array.isArray(data.staff) || !Array.isArray(data.bills)) {
        throw new Error("Invalid backup");
      }

      const currentSession = state.session;
      const currentWorkspaceId = activeWorkspaceId();
      state = normalizeState({
        ...structuredClone(defaultState),
        ...data,
        workspaceId: currentWorkspaceId,
        session: currentSession,
        loggedIn: true,
        selectedServiceIds: []
      });
      logSecurity("Khôi phục dữ liệu", `Nhập file sao lưu: ${file.name || "không rõ tên"}`);
      saveState();
      renderAll();
      setBackupStatus("Đã khôi phục dữ liệu thành công từ file sao lưu.");
    } catch {
      alert("File sao lưu không hợp lệ hoặc đã bị lỗi.");
      setBackupStatus("Chưa khôi phục được dữ liệu. Hãy chọn đúng file sao lưu PT Barbershop.");
    }
  });
  reader.readAsText(file);
}

function isManager() {
  return ["admin", "manager"].includes(state.session?.role);
}

function isAdmin() {
  return state.session?.role === "admin";
}

function isLoggedIn() {
  return Boolean(state.session);
}

function serviceById(id) {
  return state.services.find((service) => service.id === id);
}

function staffById(id) {
  return state.staff.find((person) => person.id === id);
}

function selectedServiceIds() {
  const container = $("#serviceGroups");
  if (container && container.querySelectorAll("input[type='checkbox']").length) {
    return Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map((input) => {
      return input.dataset.serviceId;
    });
  }
  return state.selectedServiceIds;
}

function selectedServices() {
  return selectedServiceIds().map(serviceById).filter(Boolean);
}

function billTotals(services = selectedServices()) {
  const total = services.reduce((sum, service) => sum + Number(service.price || 0), 0);
  const commission = services.reduce((sum, service) => {
    return sum + Number(service.price || 0) * Number(service.commission || 0) / 100;
  }, 0);
  return { total, commission };
}

function currentShiftBills() {
  if (!state.shift.id) return [];
  return state.bills.filter((bill) => bill.shiftId === state.shift.id);
}

function visibleBills() {
  return currentShiftBills();
}

function activeBills(bills) {
  return bills.filter((bill) => bill.status !== "canceled");
}

function canceledBills(bills) {
  return bills.filter((bill) => bill.status === "canceled");
}

function totalsForBills(bills) {
  const validBills = activeBills(bills);
  const voidBills = canceledBills(bills);
  return {
    sales: validBills.reduce((sum, bill) => sum + Number(bill.total || 0), 0),
    commission: validBills.reduce((sum, bill) => sum + Number(bill.commission || 0), 0),
    canceledAmount: voidBills.reduce((sum, bill) => sum + Number(bill.total || 0), 0),
    billCount: validBills.length,
    canceledCount: voidBills.length
  };
}

function paymentTotalsForBills(bills) {
  const totals = emptyPaymentTotals();
  activeBills(bills).forEach((bill) => {
    const method = safePaymentMethod(bill.paymentMethod);
    totals[method] += Number(bill.total || 0);
  });
  return totals;
}

function paymentSummaryText(totals) {
  return paymentOrder
    .map((method) => `${paymentLabel(method)}: ${money(totals[method])}`)
    .join(" | ");
}

function paymentRowsHtml(totals) {
  return paymentOrder.map((method) => `
    <div class="summary-row">
      <span>${paymentLabel(method)}</span>
      <strong>${money(totals[method])}</strong>
    </div>
  `).join("");
}

function phoneKey(phone = "") {
  return String(phone || "").replace(/\D/g, "");
}

function customerProfiles() {
  const profiles = new Map();
  activeBills(state.bills).forEach((bill) => {
    const key = phoneKey(bill.phone);
    if (!key) return;
    const profile = profiles.get(key) || {
      phone: bill.phone,
      name: bill.customer || "Khách lẻ",
      visits: 0,
      total: 0,
      lastAt: "",
      lastServices: ""
    };
    profile.visits += 1;
    profile.total += Number(bill.total || 0);
    if (!profile.lastAt || new Date(bill.createdAt) > new Date(profile.lastAt)) {
      profile.name = bill.customer || profile.name;
      profile.phone = bill.phone || profile.phone;
      profile.lastAt = bill.createdAt;
      profile.lastServices = (bill.items || []).map((item) => item.name).join(", ");
    }
    profiles.set(key, profile);
  });
  return profiles;
}

function customerProfileForPhone(phone) {
  return customerProfiles().get(phoneKey(phone));
}

function billIntegrityReport() {
  const orderedBills = state.bills
    .slice()
    .sort((left, right) => Number(left.invoiceSequence || 0) - Number(right.invoiceSequence || 0) || new Date(left.createdAt) - new Date(right.createdAt));
  const issues = [];
  let previousHash = "";
  let expectedSequence = orderedBills[0]?.invoiceSequence ? Number(orderedBills[0].invoiceSequence) : 1;
  orderedBills.forEach((bill) => {
    const expectedHash = billHashFor(bill, bill.previousBillHash || previousHash);
    if (bill.billHash && bill.billHash !== expectedHash) {
      issues.push(`${bill.invoiceNo || bill.id}: mã khóa lệch`);
    }
    if (bill.previousBillHash && previousHash && bill.previousBillHash !== previousHash) {
      issues.push(`${bill.invoiceNo || bill.id}: chuỗi khóa đứt`);
    }
    if (Number(bill.invoiceSequence || 0) > expectedSequence) {
      issues.push(`Thiếu số HĐ ${formatInvoiceNo(expectedSequence)}`);
    }
    previousHash = bill.billHash || expectedHash;
    expectedSequence = Number(bill.invoiceSequence || expectedSequence) + 1;
  });
  return {
    billCount: orderedBills.length,
    issueCount: issues.length,
    issues: issues.slice(0, 5),
    score: orderedBills.length ? Math.max(0, Math.round((1 - issues.length / Math.max(orderedBills.length, 1)) * 100)) : 100
  };
}

function shiftInsights() {
  const bills = currentShiftBills();
  const totals = totalsForBills(bills);
  const payments = paymentTotalsForBills(bills);
  const integrity = billIntegrityReport();
  const pendingCancels = state.cancelRequests.filter((request) => request.status === "pending").length;
  const insights = [];

  if (!state.shift.isOpen && !state.shift.closedAt) insights.push({ tone: "warn", text: "Chưa mở ca, hãy nhập tiền đầu ca trước khi nhận khách." });
  if (state.shift.isOpen && !bills.length) insights.push({ tone: "ok", text: "Ca đang sạch, sẵn sàng nhận bill đầu tiên." });
  if (pendingCancels) insights.push({ tone: "danger", text: `${pendingCancels} yêu cầu hủy đang chờ Quản Lý duyệt.` });
  if (totals.canceledCount >= 2) insights.push({ tone: "danger", text: `Ca này có ${totals.canceledCount} đơn hủy, nên kiểm tra lại lý do hủy.` });
  if (state.shift.closedAt) {
    const expectedCash = Number(state.shift.openingCash || 0) + payments.cash;
    const difference = Number(state.shift.closingCash || 0) - expectedCash;
    if (difference) insights.push({ tone: difference > 0 ? "warn" : "danger", text: `Két lệch ${money(difference)} so với tiền mặt dự kiến.` });
  }
  if (integrity.issueCount) insights.push({ tone: "danger", text: `Phát hiện ${integrity.issueCount} cảnh báo chuỗi khóa hóa đơn.` });
  if (!integrity.issueCount && totals.billCount) insights.push({ tone: "ok", text: "Chuỗi khóa hóa đơn đang sạch, chưa thấy dấu hiệu sửa/xóa bill." });
  if (payments.transfer > payments.cash && payments.transfer) insights.push({ tone: "ok", text: "Chuyển khoản đang cao hơn tiền mặt, kết ca cần đối chiếu ngân hàng." });
  return insights.slice(0, 4);
}

function commissionByStaff(bills) {
  const rows = new Map();
  activeBills(bills).forEach((bill) => {
    rows.set(bill.staffName, (rows.get(bill.staffName) || 0) + Number(bill.commission || 0));
  });
  return Array.from(rows.entries());
}

function pendingCancelRequestForBill(billId) {
  return state.cancelRequests.find((request) => request.billId === billId && request.status === "pending");
}

function canCancelBill(bill) {
  return bill.status !== "canceled" && state.shift.isOpen && bill.shiftId === state.shift.id && !pendingCancelRequestForBill(bill.id);
}

function billSearchTerm() {
  return ($("#billSearch")?.value || "").trim().toLowerCase();
}

function billMatchesSearch(bill, term) {
  if (!term) return true;
  return [
    bill.invoiceNo,
    bill.verifyCode,
    bill.billHash,
    bill.invoiceSequence,
    bill.queueNo,
    `#${bill.queueNo}`,
    bill.customer,
    bill.phone,
    bill.staffName,
    paymentLabel(bill.paymentMethod)
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function billIdentityHtml(bill) {
  return `
    <strong>${escapeHtml(bill.invoiceNo || "-")}</strong>
    <div class="row-meta">STT chờ: #${escapeHtml(bill.queueNo || "-")}</div>
    <div class="verify-chip">${escapeHtml(bill.verifyCode || billVerifyCode(bill))}</div>
  `;
}

function cancelDetailsHtml(bill) {
  if (!isManager() || bill.status !== "canceled") return "";
  return `
    <div class="row-meta">Hủy bởi: ${escapeHtml(bill.canceledBy || "-")} ${timeText(bill.canceledAt) ? `- ${timeText(bill.canceledAt)}` : ""}</div>
    <div class="row-meta">Quản Lý duyệt: ${escapeHtml(bill.approvedBy || "-")} ${timeText(bill.approvedAt) ? `- ${timeText(bill.approvedAt)}` : ""}</div>
    <div class="row-meta">Lý do: ${escapeHtml(bill.cancelReason || "Không ghi")}</div>
  `;
}

function requireLogin() {
  $("#loginScreen").classList.toggle("is-hidden", isLoggedIn());
  $("#appScreen").classList.toggle("is-hidden", !isLoggedIn());
}

function setActiveTab(tabName) {
  const managerTabs = new Set(["catalog", "staff"]);
  const adminTabs = new Set(["accounts"]);
  const safeTab = managerTabs.has(tabName) && !isManager() ? "order" : tabName;
  const finalTab = adminTabs.has(safeTab) && !isAdmin() ? "order" : safeTab;

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === finalTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("is-hidden"));
  $(`#tab-${finalTab}`).classList.remove("is-hidden");
}

function branchBrandName(workspaceName = "") {
  const branchName = String(workspaceName || "PT Barbershop").trim() || "PT Barbershop";
  const upperBranch = branchName.toLocaleUpperCase("vi-VN");
  return upperBranch.includes("PT BARBERSHOP") ? upperBranch : `${upperBranch} x PT BARBERSHOP`;
}

function renderPermissions() {
  const roleLabel = isAdmin() ? "Admin" : isManager() ? "Quản Lý" : "Thu Ngân";
  $("#sessionLabel").textContent = state.session ? `ID ${state.session.id} - ${branchBrandName(state.session.workspaceName)}` : "Chưa đăng nhập";
  $("#roleBadge").textContent = state.session ? roleLabel : "Guest";
  $("#roleBadge").classList.toggle("manager", isManager());

  document.querySelectorAll("[data-manager-only]").forEach((element) => {
    element.classList.toggle("is-hidden", !isManager());
  });
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.classList.toggle("is-hidden", !isAdmin());
  });

  if (!isManager()) {
    const activeButton = document.querySelector(".tab-button.is-active");
    if (activeButton && ["catalog", "staff"].includes(activeButton.dataset.tab)) {
      setActiveTab("order");
    }
  }
  if (!isAdmin()) {
    const activeButton = document.querySelector(".tab-button.is-active");
    if (activeButton && activeButton.dataset.tab === "accounts") {
      setActiveTab("order");
    }
  }
}

function renderQuickStats() {
  const container = $("#quickStats");
  if (!container) return;

  const shiftBills = currentShiftBills();
  const shiftTotals = totalsForBills(shiftBills);
  const paymentTotals = paymentTotalsForBills(shiftBills);
  const staffRows = commissionByStaff(shiftBills).sort((a, b) => b[1] - a[1]);
  const topStaff = staffRows.length ? `${staffRows[0][0]} - ${money(staffRows[0][1])}` : "Chưa có";
  const nextQueue = state.shift.isOpen ? `#${Number(state.shift.queueCounter || 0) + 1}` : "Mở ca trước";
  const shopNet = Math.max(0, shiftTotals.sales - shiftTotals.commission);

  container.innerHTML = `
    <article class="metric-tile accent-blue">
      <span>Doanh thu ca</span>
      <strong>${money(shiftTotals.sales)}</strong>
      <small>${shiftTotals.billCount} bill hợp lệ</small>
    </article>
    <article class="metric-tile accent-red">
      <span>STT tiếp theo</span>
      <strong>${nextQueue}</strong>
      <small>${state.shift.isOpen ? "Khách mới trong ca" : "Chưa mở ca"}</small>
    </article>
    <article class="metric-tile">
      <span>Tiền mặt trong ca</span>
      <strong>${money(paymentTotals.cash)}</strong>
      <small>${paymentTotals.transfer ? `CK ${money(paymentTotals.transfer)}` : "Chưa có chuyển khoản"}</small>
    </article>
    <article class="metric-tile ${isManager() ? "" : "is-muted"}">
      <span>${isManager() ? "Nhân viên nổi bật" : "Đơn đã hủy"}</span>
      <strong>${isManager() ? escapeHtml(topStaff) : shiftTotals.canceledCount}</strong>
      <small>${isManager() ? `Tiệm còn ${money(shopNet)}` : `${money(shiftTotals.canceledAmount)}`}</small>
    </article>
  `;
}

function renderProCommandCenter() {
  const container = $("#quickStats");
  if (!container) return;

  const shiftBills = currentShiftBills();
  const shiftTotals = totalsForBills(shiftBills);
  const paymentTotals = paymentTotalsForBills(shiftBills);
  const staffRows = commissionByStaff(shiftBills).sort((a, b) => b[1] - a[1]);
  const topStaff = staffRows.length ? `${staffRows[0][0]} - ${money(staffRows[0][1])}` : "Chưa có";
  const pendingCancels = state.cancelRequests.filter((request) => request.status === "pending").length;
  const integrity = billIntegrityReport();
  const profiles = customerProfiles();
  const vipCustomers = Array.from(profiles.values()).filter((profile) => profile.visits >= 2).length;
  const nextQueue = state.shift.isOpen ? `#${Number(state.shift.queueCounter || 0) + 1}` : "Mở ca";
  const insights = shiftInsights();

  container.innerHTML = `
    <section class="command-center">
      <article class="command-hero">
        <span class="command-kicker">PT Barbershop Live</span>
        <strong>${money(shiftTotals.sales)}</strong>
        <small>${shiftTotals.billCount} bill hợp lệ · STT tiếp theo ${nextQueue}</small>
      </article>
      <article class="metric-tile accent-blue">
        <span>An toàn bill</span>
        <strong>${integrity.score}%</strong>
        <small>${integrity.issueCount ? `${integrity.issueCount} cảnh báo` : "Chuỗi khóa sạch"}</small>
      </article>
      <article class="metric-tile accent-red">
        <span>Chờ duyệt hủy</span>
        <strong>${pendingCancels}</strong>
        <small>${shiftTotals.canceledCount} đơn đã hủy trong ca</small>
      </article>
      <article class="metric-tile">
        <span>Khách quen</span>
        <strong>${vipCustomers}</strong>
        <small>${profiles.size} hồ sơ có SĐT</small>
      </article>
      <article class="metric-tile ${isManager() ? "" : "is-muted"}">
        <span>${isManager() ? "Nhân viên nổi bật" : "Tiền mặt ca"}</span>
        <strong>${isManager() ? escapeHtml(topStaff) : money(paymentTotals.cash)}</strong>
        <small>${isManager() ? `Chia ${money(shiftTotals.commission)}` : `CK ${money(paymentTotals.transfer)}`}</small>
      </article>
    </section>
    <section class="insight-strip">
      ${insights.length ? insights.map((item) => `<div class="insight ${item.tone}">${escapeHtml(item.text)}</div>`).join("") : `<div class="insight ok">Hệ thống ổn định, chưa có cảnh báo mới.</div>`}
    </section>
  `;
}

function renderStaffSelect() {
  const select = $("#orderStaff");
  const current = select.value;
  select.innerHTML = state.staff.map((person) => {
    return `<option value="${person.id}">${escapeHtml(person.name)}</option>`;
  }).join("");
  if (state.staff.some((person) => person.id === current)) select.value = current;
}

function renderServices() {
  const container = $("#serviceGroups");
  container.innerHTML = categoryOrder.map((category) => {
    const services = state.services.filter((service) => service.category === category);
    const rows = services.length ? services.map((service) => {
      const checked = state.selectedServiceIds.includes(service.id) ? "checked" : "";
      const commissionText = isManager() ? `<span>Chia ${service.commission}%</span>` : "";
      return `
        <label class="service-option">
          <input type="checkbox" data-service-id="${service.id}" ${checked}>
          <span>
            <strong>${escapeHtml(service.name)}</strong>
            <span class="service-meta">
              <span>${escapeHtml(categoryNames[service.category])}</span>
              ${commissionText}
            </span>
          </span>
          <span class="price">${money(service.price)}</span>
        </label>
      `;
    }).join("") : `<p class="empty-state">Chưa có dịch vụ trong mục này.</p>`;

    return `
      <div class="service-group">
        <h4>${escapeHtml(categoryNames[category])}</h4>
        ${rows}
      </div>
    `;
  }).join("");
}

function renderBillPreview() {
  const staff = staffById($("#orderStaff").value);
  const services = selectedServices();
  const { total, commission } = billTotals(services);
  const nextInvoiceNo = formatInvoiceNo(Number(state.invoiceCounter || 0) + 1);
  const nextQueueText = state.shift.isOpen ? `#${Number(state.shift.queueCounter || 0) + 1}` : "Chưa mở ca";
  const customer = $("#customerName").value.trim() || "Khách lẻ";
  const phone = $("#customerPhone").value.trim();
  const profile = customerProfileForPhone(phone);
  const paymentMethod = $("#paymentMethod").value;

  if (!services.length) {
    $("#billPreview").innerHTML = `<p class="empty-state">Chọn dịch vụ để tạo bill.</p>`;
    return;
  }

  $("#billPreview").innerHTML = `
    <div class="bill-number-strip">
      <span>Số HĐ: <strong>${nextInvoiceNo}</strong></span>
      <span>STT chờ: <strong>${nextQueueText}</strong></span>
    </div>
    <div class="bill-client">
      <strong>${escapeHtml(customer)}</strong>
      ${phone ? `<span>SĐT: ${escapeHtml(phone)}</span>` : ""}
      <span>Nhân viên: ${escapeHtml(staff?.name || "Chưa chọn")}</span>
      <span>Thanh toán: ${paymentLabel(paymentMethod)}</span>
    </div>
    ${profile ? `
      <div class="customer-signal">
        <strong>Khách quen: ${profile.visits} lần</strong>
        <span>Tổng chi ${money(profile.total)} · Gần nhất ${receiptTimeText(profile.lastAt)} · ${escapeHtml(profile.lastServices || "Chưa rõ dịch vụ")}</span>
      </div>
    ` : phone ? `
      <div class="customer-signal">
        <strong>Khách mới</strong>
        <span>SĐT này chưa có lịch sử trong hệ thống.</span>
      </div>
    ` : ""}
    ${services.map((service) => `
      <div class="bill-line">
        <span>${escapeHtml(service.name)} <small>(${escapeHtml(categoryNames[service.category])}${isManager() ? `, ${service.commission}%` : ""})</small></span>
        <strong>${money(service.price)}</strong>
      </div>
    `).join("")}
    <div class="bill-total">
      <span>Tổng tiền</span>
      <span>${money(total)}</span>
    </div>
    ${isManager() ? `
      <div class="bill-line muted-line">
        <span>Chia cho nhân viên</span>
        <strong>${money(commission)}</strong>
      </div>
    ` : ""}
  `;
}

function renderCatalog() {
  const container = $("#catalogList");
  container.innerHTML = categoryOrder.map((category) => {
    const services = state.services.filter((service) => service.category === category);
    const rows = services.length ? services.map((service) => `
      <div class="catalog-row">
        <span>
          <strong>${escapeHtml(service.name)}</strong>
          <span class="row-meta">
            <span>${money(service.price)}</span>
            <span>Chia ${service.commission}%</span>
          </span>
        </span>
        <span class="row-actions">
          <button class="small-button" data-edit-service="${service.id}">Sửa</button>
          <button class="small-button danger-button" data-delete-service="${service.id}">Xóa</button>
        </span>
      </div>
    `).join("") : `<p class="empty-state">Chưa có mục nào.</p>`;
    return `<div class="service-group"><h4>${categoryNames[category]}</h4>${rows}</div>`;
  }).join("");
}

function renderStaffList() {
  const container = $("#staffList");
  container.innerHTML = state.staff.length ? state.staff.map((person) => `
    <div class="staff-row">
      <strong>${escapeHtml(person.name)}</strong>
      <span class="row-actions">
        <button class="small-button" data-edit-staff="${person.id}">Sửa</button>
        <button class="small-button danger-button" data-delete-staff="${person.id}">Xóa</button>
      </span>
    </div>
  `).join("") : `<p class="empty-state">Chưa có nhân viên.</p>`;

  const isEditing = Boolean($("#staffId")?.value);
  const submit = $("#staffSubmitBtn");
  if (submit) submit.textContent = isEditing ? "Lưu nhân viên" : "Thêm nhân viên";
}

function renderAccountGroups() {
  const container = $("#accountGroupList");
  if (!container) return;
  const term = ($("#accountSearch")?.value || "").trim().toLowerCase();
  const groups = accountState.groups.slice().sort((a, b) => {
    if (a.workspaceId === activeWorkspaceId()) return -1;
    if (b.workspaceId === activeWorkspaceId()) return 1;
    return String(a.workspaceName).localeCompare(String(b.workspaceName));
  }).filter((group) => {
    const users = accountState.users.filter((user) => user.workspaceId === group.workspaceId);
    const searchable = [
      group.workspaceId,
      group.workspaceName,
      group.managerId,
      group.cashierId,
      ...users.flatMap((user) => [user.id, user.name, user.role])
    ].join(" ").toLowerCase();
    return !term || searchable.includes(term);
  });
  const totalText = `
    <div class="account-sync-card ${accountSyncOnline ? "is-online" : "is-warning"}">
      <strong>${accountSyncOnline ? "Tài khoản đang đồng bộ online" : "Tài khoản chưa chắc đã online"}</strong>
      <span>${escapeHtml(accountSyncMessage())}</span>
    </div>
    <p class="backup-status account-limit-note">Đang có ${accountState.groups.length} bộ tài khoản. Có thể tạo không giới hạn chi nhánh, chỉ cần ID không trùng.</p>
  `;

  if (!groups.length) {
    container.innerHTML = `${totalText}<p class="empty-state">Không tìm thấy tài khoản phù hợp.</p>`;
    return;
  }

  container.innerHTML = `${totalText}${groups.map((group) => {
    const manager = accountState.users.find((user) => user.workspaceId === group.workspaceId && ["admin", "manager"].includes(user.role));
    const cashier = accountState.users.find((user) => user.workspaceId === group.workspaceId && user.role === "cashier");
    const current = group.workspaceId === activeWorkspaceId();
    return `
      <div class="summary-row">
        <span>
          <strong>${escapeHtml(group.workspaceName || "Bo tai khoan")}${current ? " (dang dung)" : ""}</strong>
          <span class="row-meta">${manager?.role === "admin" ? "Admin" : "Quan Li"}: ${escapeHtml(manager?.id || group.managerId || "-")}</span>
          <span class="row-meta">Thu Ngan: ${escapeHtml(cashier?.id || group.cashierId || "-")}</span>
        </span>
        <span class="row-actions">
          <button class="small-button" data-edit-account="${escapeHtml(group.workspaceId)}">Sửa</button>
          ${current ? "" : `<button class="small-button danger-button" data-delete-account="${escapeHtml(group.workspaceId)}">Xóa</button>`}
        </span>
      </div>
    `;
  }).join("")}`;
}

function resetAccountForm() {
  $("#accountGroupForm").reset();
  $("#accountWorkspaceId").value = "";
  $("#accountSubmitBtn").textContent = "Tạo bộ tài khoản";
  $("#accountCancelEditBtn").classList.add("is-hidden");
  $("#accountStatus").textContent = accountSyncOnline
    ? "Tạo không giới hạn chi nhánh, dữ liệu sẽ đồng bộ qua server online."
    : accountSyncMessage();
}

function accountIdExists(id, exceptWorkspaceId = "") {
  return accountState.users.some((user) => user.workspaceId !== exceptWorkspaceId && user.id === id);
}

function nextAccountCredentials() {
  const exceptWorkspaceId = $("#accountWorkspaceId")?.value || "";
  let serial = Math.max(2, accountState.groups.length + 1);

  while (true) {
    const suffix = String(serial).padStart(2, "0");
    const managerId = `9939${suffix}`;
    const cashierId = `3122${suffix}`;
    if (!accountIdExists(managerId, exceptWorkspaceId) && !accountIdExists(cashierId, exceptWorkspaceId)) {
      return { suffix, managerId, cashierId };
    }
    serial += 1;
  }
}

function generateAccountCredentials() {
  if (!isAdmin()) return;
  if ($("#accountWorkspaceId").value) {
    resetAccountForm();
  }
  const next = nextAccountCredentials();
  $("#accountWorkspaceName").value = `Chi nhánh ${next.suffix}`;
  $("#accountManagerId").value = next.managerId;
  $("#accountManagerPassword").value = `040426${next.suffix}`;
  $("#accountCashierId").value = next.cashierId;
  $("#accountCashierPassword").value = `152004${next.suffix}`;
  $("#accountStatus").textContent = `Đã tạo sẵn ID cho Chi nhánh ${next.suffix}. Bấm Tạo bộ tài khoản để lưu.`;
  $("#accountManagerId").focus();
  showToast("Đã tạo ID tự động");
}

function fillAccountForm(workspaceId) {
  const group = accountState.groups.find((item) => item.workspaceId === workspaceId);
  if (!group) return;
  const manager = accountState.users.find((user) => user.workspaceId === workspaceId && ["admin", "manager"].includes(user.role));
  const cashier = accountState.users.find((user) => user.workspaceId === workspaceId && user.role === "cashier");
  $("#accountWorkspaceId").value = workspaceId;
  $("#accountWorkspaceName").value = group.workspaceName || "";
  $("#accountManagerId").value = manager?.id || group.managerId || "";
  $("#accountManagerPassword").value = "";
  $("#accountCashierId").value = cashier?.id || group.cashierId || "";
  $("#accountCashierPassword").value = "";
  $("#accountSubmitBtn").textContent = "Lưu tài khoản";
  $("#accountCancelEditBtn").classList.remove("is-hidden");
  $("#accountStatus").textContent = "Đang sửa bộ tài khoản. Nhập mật khẩu mới cho cả hai tài khoản rồi bấm Lưu.";
}

function renderBillHistory() {
  const body = $("#billHistory");
  const cards = $("#billCards");
  const term = billSearchTerm();
  const bills = visibleBills()
    .filter((bill) => billMatchesSearch(bill, term))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#historyTitle").textContent = "Bill trong ca hiện tại";
  $("#historyScope").textContent = state.shift.isOpen
    ? "Bill ca đang mở. Đơn hủy vẫn được kiểm soát."
    : state.shift.id
      ? "Ca đã chốt. Kiểm tra chênh lệch rồi bấm In kết ca để reset ca mới."
      : "Ca đã chốt. Lịch sử đã được lưu trong Excel và nhật ký bảo mật.";

  if (!bills.length) {
    const emptyText = term ? "Không tìm thấy hóa đơn phù hợp." : "Chưa có bill nào.";
    body.innerHTML = `<tr><td colspan="${isManager() ? 10 : 9}">${emptyText}</td></tr>`;
    cards.innerHTML = `<p class="empty-state">${emptyText}</p>`;
    return;
  }

  body.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const pendingCancel = pendingCancelRequestForBill(bill.id);
    const statusClass = canceled ? "canceled" : pendingCancel ? "pending" : "paid";
    const statusText = canceled ? "Đã hủy" : pendingCancel ? "Chờ QL duyệt" : "Đã tính tiền";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const cancelNote = cancelDetailsHtml(bill);
    const commissionCell = isManager() ? `<td>${canceled ? "0 VND" : money(bill.commission)}</td>` : "";
    const customerMeta = (bill.phone || bill.note) ? `
      <div class="row-meta">
        ${bill.phone ? `<span>SĐT: ${escapeHtml(bill.phone)}</span>` : ""}
        ${bill.note ? `<span>Ghi chú: ${escapeHtml(bill.note)}</span>` : ""}
      </div>
    ` : "";
    const cancelButtonText = isManager() ? "Hủy đơn" : "Yêu cầu hủy";
    const actions = `
      <button class="small-button" data-print-bill="${bill.id}">In lại</button>
      ${canCancelBill(bill) ? `<button class="small-button danger-button" data-cancel-bill="${bill.id}">${cancelButtonText}</button>` : ""}
    `;

    return `
      <tr class="${canceled ? "row-canceled" : ""}">
        <td>${billIdentityHtml(bill)}</td>
        <td>${timeText(bill.createdAt)}</td>
        <td>${escapeHtml(bill.customer)}${customerMeta}${cancelNote}</td>
        <td>${escapeHtml(bill.staffName)}</td>
        <td>${services}</td>
        <td><span class="status ${statusClass}">${statusText}</span></td>
        <td>${paymentLabel(bill.paymentMethod)}</td>
        <td><strong>${money(bill.total)}</strong></td>
        ${commissionCell}
        <td><span class="row-actions">${actions}</span></td>
      </tr>
    `;
  }).join("");

  cards.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const pendingCancel = pendingCancelRequestForBill(bill.id);
    const statusClass = canceled ? "canceled" : pendingCancel ? "pending" : "paid";
    const statusText = canceled ? "Đã hủy" : pendingCancel ? "Chờ QL duyệt" : "Đã tính tiền";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const cancelButtonText = isManager() ? "Hủy đơn" : "Yêu cầu hủy";
    const actions = `
      <button class="small-button" data-print-bill="${bill.id}">In lại</button>
      ${canCancelBill(bill) ? `<button class="small-button danger-button" data-cancel-bill="${bill.id}">${cancelButtonText}</button>` : ""}
    `;

    return `
      <article class="bill-card ${canceled ? "row-canceled" : ""}">
        <div class="bill-card-head">
          <div>
            <strong>${escapeHtml(bill.customer)}</strong>
            <div class="bill-card-meta">
              <span>${escapeHtml(bill.invoiceNo || "-")} - STT #${escapeHtml(bill.queueNo || "-")}</span>
              <span>Mã: ${escapeHtml(bill.verifyCode || billVerifyCode(bill))}</span>
              <span>${timeText(bill.createdAt)}</span>
              <span>Nhân viên: ${escapeHtml(bill.staffName)}</span>
              <span>Thanh toán: ${paymentLabel(bill.paymentMethod)}</span>
              ${bill.phone ? `<span>SĐT: ${escapeHtml(bill.phone)}</span>` : ""}
            </div>
          </div>
          <span class="status ${statusClass}">${statusText}</span>
        </div>
        <div>${services}</div>
        ${cancelDetailsHtml(bill)}
        <div class="bill-line">
          <span>Tổng tiền</span>
          <strong>${money(bill.total)}</strong>
        </div>
        ${isManager() ? `
          <div class="bill-line row-meta">
            <span>Chia nhân viên</span>
            <strong>${canceled ? "0 VND" : money(bill.commission)}</strong>
          </div>
        ` : ""}
        <div class="row-actions">${actions}</div>
      </article>
    `;
  }).join("");
}

function renderCancelApprovalRequests() {
  const panel = $("#cancelApprovalPanel");
  const container = $("#cancelApprovalList");
  const count = $("#cancelApprovalCount");
  if (!panel || !container || !count) return;

  if (!isManager()) {
    panel.classList.add("is-hidden");
    return;
  }

  const requests = state.cancelRequests
    .filter((request) => request.status === "pending")
    .map((request) => ({ request, bill: state.bills.find((bill) => bill.id === request.billId) }))
    .filter(({ bill }) => bill && bill.status !== "canceled")
    .sort((left, right) => new Date(left.request.requestedAt) - new Date(right.request.requestedAt));

  count.textContent = `${requests.length} yêu cầu chờ duyệt`;
  if (!requests.length) {
    panel.classList.add("is-hidden");
    return;
  }

  panel.classList.remove("is-hidden");
  container.innerHTML = requests.map(({ request, bill }) => `
    <div class="summary-row">
      <span>
        <strong>${escapeHtml(bill.invoiceNo || request.invoiceNo || "-")} · ${escapeHtml(bill.customer || "Khách lẻ")}</strong>
        <span class="row-meta">Thợ: ${escapeHtml(bill.staffName || "-")} · ${money(bill.total)}</span>
        <span class="row-meta">Gửi bởi: ${escapeHtml(request.requestedBy || "Thu Ngân")} · ${timeText(request.requestedAt)}</span>
        <span class="row-meta">Lý do: ${escapeHtml(request.reason || "Không ghi")}</span>
      </span>
      <span class="row-actions">
        <button class="small-button" data-reject-cancel-request="${request.id}">Từ chối</button>
        <button class="small-button danger-button" data-approve-cancel-request="${request.id}">Duyệt hủy</button>
      </span>
    </div>
  `).join("");
}

function renderShift() {
  const bills = currentShiftBills();
  const totals = totalsForBills(bills);
  const paymentTotals = paymentTotalsForBills(bills);
  const expectedCash = Number(state.shift.openingCash || 0) + paymentTotals.cash;
  const hasClosed = Boolean(state.shift.closedAt);
  const difference = Number(state.shift.closingCash || 0) - expectedCash;

  $("#shiftStatus").textContent = state.shift.isOpen ? "Đang mở ca" : hasClosed ? "Đã kết ca" : "Chưa mở ca";
  $("#cashStatus").textContent = money(expectedCash);
  $("#paymentStatus").textContent = totals.sales ? `${money(totals.sales)}` : "0 VND";
  $("#openingCash").value = state.shift.isOpen ? Number(state.shift.openingCash || 0) : "";
  $("#openingCash").placeholder = state.shift.isOpen ? String(state.shift.openingCash || 0) : "0";
  $("#closingCash").value = hasClosed ? Number(state.shift.closingCash || 0) : "";
  $("#closingCash").placeholder = String(expectedCash);
  $("#openingCash").disabled = Boolean(state.shift.id);
  $("#closingCash").disabled = hasClosed;
  $("#closeShiftBtn").disabled = !state.shift.isOpen;
  $("#printShiftBtn").textContent = hasClosed
    ? "In kết ca & về ca mới"
    : "In kết ca";

  const staffRows = isManager() ? commissionByStaff(bills).map(([name, amount]) => `
    <div class="summary-row">
      <span>Chia ${escapeHtml(name)}</span>
      <strong>${money(amount)}</strong>
    </div>
  `).join("") : "";
  const closeNotice = hasClosed
    ? '<p class="backup-status">Đã chốt ca. Kiểm tra chênh lệch, sau đó bấm In kết ca &amp; về ca mới để reset màn hình.</p>'
    : "";

  $("#shiftSummary").innerHTML = `
    <div class="summary-row"><span>Lưu dữ liệu</span><strong>${syncOnline ? "Đã đồng bộ online" : "Đang lưu trên máy này"}</strong></div>
    <div class="summary-row"><span>Trạng thái</span><strong>${state.shift.isOpen ? "Đang mở" : hasClosed ? "Đã kết ca" : "Chưa mở ca"}</strong></div>
    <div class="summary-row"><span>Người mở ca</span><strong>${escapeHtml(state.shift.cashierName || "-")}</strong></div>
    <div class="summary-row"><span>Mở ca lúc</span><strong>${timeText(state.shift.openedAt) || "-"}</strong></div>
    <div class="summary-row"><span>Kết ca lúc</span><strong>${timeText(state.shift.closedAt) || "-"}</strong></div>
    <div class="summary-row"><span>Tiền đầu ca</span><strong>${money(state.shift.openingCash)}</strong></div>
    <div class="summary-row"><span>Số bill hợp lệ</span><strong>${totals.billCount}</strong></div>
    <div class="summary-row"><span>Doanh thu hợp lệ</span><strong>${money(totals.sales)}</strong></div>
    ${paymentRowsHtml(paymentTotals)}
    <div class="summary-row"><span>Đơn đã hủy</span><strong>${totals.canceledCount} đơn / ${money(totals.canceledAmount)}</strong></div>
    <div class="summary-row"><span>Tiền dự kiến trong két</span><strong>${money(expectedCash)}</strong></div>
    ${isManager() ? `<div class="summary-row"><span>Tổng chia nhân viên</span><strong>${money(totals.commission)}</strong></div>` : ""}
    ${isManager() ? `<div class="summary-row"><span>Tiệm còn lại</span><strong>${money(Math.max(0, totals.sales - totals.commission))}</strong></div>` : ""}
    ${staffRows || (isManager() ? `<p class="empty-state">Chưa có tiền chia nhân viên.</p>` : "")}
    <div class="summary-row"><span>Tiền thực tế kết ca</span><strong>${hasClosed ? money(state.shift.closingCash) : "-"}</strong></div>
    <div class="summary-row"><span>Chênh lệch</span><strong class="${difference >= 0 ? "ok" : "danger-text"}">${hasClosed ? money(difference) : "-"}</strong></div>
    ${closeNotice}
  `;
}

function renderShopInfoSettings() {
  const form = $("#shopInfoForm");
  if (!form) return;
  const info = currentShopInfo();
  $("#shopReceiptName").value = info.receiptName;
  $("#shopReceiptAddress").value = info.address;
  $("#shopReceiptPhone").value = info.phone;
  $("#receiptPaperWidth").value = info.receiptWidth;
}

function renderShiftLogs() {
  const body = $("#shiftLogBody");
  if (!body) return;

  const logs = state.shift.id
    ? state.shiftLogs.filter((shift) => shift.id === state.shift.id)
    : [];
  if (!logs.length) {
    body.innerHTML = `<tr><td colspan="9">Ca đã chốt sẽ được lưu vào Excel. Mở ca mới để bắt đầu lịch sử mới.</td></tr>`;
    return;
  }

  body.innerHTML = logs.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((shift) => {
    const payments = normalizePaymentTotals(shift.paymentTotals);
    return `
      <tr>
        <td>${escapeHtml(shift.cashierName)}</td>
        <td>${timeText(shift.openedAt)}</td>
        <td>${timeText(shift.closedAt)}</td>
        <td>${money(shift.openingCash)}</td>
        <td><strong>${money(shift.sales)}</strong><div class="row-meta">${shift.billCount} bill hợp lệ</div><div class="row-meta">${escapeHtml(paymentSummaryText(payments))}</div></td>
        <td>${shift.canceledCount} đơn<div class="row-meta">${money(shift.canceledAmount)}</div></td>
        <td>${money(shift.expectedCash)}</td>
        <td>${money(shift.closingCash)}</td>
        <td><strong class="${shift.difference >= 0 ? "ok" : "danger-text"}">${money(shift.difference)}</strong></td>
      </tr>
    `;
  }).join("");
}

function renderSecurityLog() {
  const body = $("#securityLogBody");
  if (!body) return;

  const entries = state.shift.id && Array.isArray(state.securityLog)
    ? state.securityLog.filter((entry) => entry.shiftId === state.shift.id).slice(0, SECURITY_LOG_LIMIT)
    : [];
  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="5">Nhật ký ca đã chốt được lưu an toàn trong dữ liệu và báo cáo.</td></tr>`;
    return;
  }

  body.innerHTML = entries
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((entry) => `
      <tr>
        <td>${timeText(entry.createdAt)}</td>
        <td>${escapeHtml(entry.userName || "-")}<div class="row-meta">${escapeHtml(entry.role || "-")}</div></td>
        <td><strong>${escapeHtml(entry.action || "-")}</strong></td>
        <td>${escapeHtml(entry.invoiceNo || "-")}</td>
        <td>${escapeHtml(entry.detail || "-")}</td>
      </tr>
    `).join("");
}

function renderAll() {
  requireLogin();
  renderPermissions();
  if (!isLoggedIn()) return;

  $("#todayLabel").textContent = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  renderStaffSelect();
  renderServices();
  renderBillPreview();
  renderQuickStats();
  renderProCommandCenter();
  renderCatalog();
  renderStaffList();
  renderAccountGroups();
  renderBillHistory();
  renderCancelApprovalRequests();
  renderShift();
  renderShopInfoSettings();
  renderShiftLogs();
  renderSecurityLog();
  renderBackupInfo();
  renderExcelReportInfo();
}

function resetOrder() {
  state.selectedServiceIds = [];
  $("#customerName").value = "";
  $("#customerPhone").value = "";
  $("#paymentMethod").value = "cash";
  $("#orderNote").value = "";
  saveState();
  renderAll();
}

function clearSelectedServices() {
  state.selectedServiceIds = [];
  saveState();
  renderAll();
  showToast("Đã xóa dịch vụ đang chọn.");
}

function saveBill(options = {}) {
  const shouldPrint = options?.print === true;
  const staff = staffById($("#orderStaff").value);
  state.selectedServiceIds = selectedServiceIds();
  const services = selectedServices();
  if (!staff) {
    alert("Hãy thêm hoặc chọn nhân viên.");
    return null;
  }
  if (!services.length) {
    alert("Hãy chọn ít nhất 1 dịch vụ.");
    return null;
  }
  if (!state.shift.isOpen) {
    alert("Hãy nhập đầu ca trước khi lưu bill.");
    setActiveTab("shift");
    return null;
  }

  const { total, commission } = billTotals(services);
  const invoiceSequence = nextInvoiceSequence();
  const queueNo = nextQueueNumber();
  const previousBill = state.bills.slice().sort((left, right) => Number(right.invoiceSequence || 0) - Number(left.invoiceSequence || 0))[0];
  const previousBillHash = previousBill?.billHash || "";
  const bill = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    invoiceSequence,
    invoiceNo: formatInvoiceNo(invoiceSequence),
    queueNo,
    customer: $("#customerName").value.trim() || "Khách lẻ",
    phone: $("#customerPhone").value.trim(),
    staffId: staff.id,
    staffName: staff.name,
    note: $("#orderNote").value.trim(),
    paymentMethod: safePaymentMethod($("#paymentMethod").value),
    shiftId: state.shift.id,
    createdBy: state.session.name,
    status: "paid",
    canceledAt: "",
    canceledBy: "",
    cancelReason: "",
    items: services.map((service) => ({
      id: service.id,
      category: service.category,
      name: service.name,
      price: Number(service.price || 0),
      commission: Number(service.commission || 0)
    })),
    total,
    commission,
    previousBillHash,
    billHash: "",
    verifyCode: ""
  };
  bill.billHash = billHashFor(bill, previousBillHash);
  bill.verifyCode = billVerifyCode(bill);
  state.bills.push(bill);
  logSecurity(
    "Lưu bill",
    `${bill.staffName} làm ${bill.items.length} dịch vụ, ${paymentLabel(bill.paymentMethod)}, tổng ${money(bill.total)}, STT #${bill.queueNo}`,
    bill
  );
  resetOrder();
  showToast(`${shouldPrint ? "Đã lưu và in" : "Đã lưu"} ${bill.invoiceNo} - STT #${bill.queueNo}`);
  return bill;
}

function finalizeBillCancellation(bill, reason, request = null) {
  const now = new Date().toISOString();
  bill.status = "canceled";
  bill.canceledAt = now;
  bill.canceledBy = state.session.name;
  bill.cancelReason = reason;
  bill.approvedBy = state.session.name;
  bill.approvedAt = now;
  if (request) {
    request.status = "approved";
    request.resolvedAt = now;
    request.resolvedById = state.session.id;
    request.resolvedBy = state.session.name;
  }
  logSecurity(
    request ? "Duyệt hủy bill" : "Hủy bill",
    `${request ? `Yêu cầu từ ${request.requestedBy || "Thu Ngân"}. ` : ""}Lý do: ${reason}.`,
    bill
  );
}

function submitCancelRequest(bill, reason) {
  if (pendingCancelRequestForBill(bill.id)) {
    showToast("Bill này đang chờ Quản Lí duyệt.", "danger");
    return;
  }
  const request = {
    id: crypto.randomUUID(),
    billId: bill.id,
    invoiceNo: bill.invoiceNo || "",
    reason,
    requestedAt: new Date().toISOString(),
    requestedById: state.session.id,
    requestedBy: state.session.name,
    status: "pending",
    resolvedAt: "",
    resolvedById: "",
    resolvedBy: "",
    resolutionNote: ""
  };
  state.cancelRequests.push(request);
  logSecurity("Gửi yêu cầu hủy bill", `Lý do: ${reason}. Chờ Quản Lí duyệt.`, bill);
  saveState();
  renderAll();
  showToast(syncOnline
    ? `Đã gửi yêu cầu hủy ${bill.invoiceNo}. Chờ Quản Lí duyệt.`
    : `Đã tạo yêu cầu hủy ${bill.invoiceNo}. Cần đồng bộ online để Quản Lí ở máy khác duyệt.`);
}

function closeCancelBillDialog() {
  const dialog = $("#cancelBillDialog");
  if (!dialog) return;
  dialog.classList.add("is-hidden");
  dialog.setAttribute("aria-hidden", "true");
  $("#cancelBillForm").reset();
  $("#cancelBillError").textContent = "";
}

function openCancelBillDialog(billId) {
  const bill = state.bills.find((item) => item.id === billId);
  if (!bill || !canCancelBill(bill)) return;

  const managerMode = isManager();
  $("#cancelBillId").value = bill.id;
  $("#cancelBillDialogTitle").textContent = managerMode ? "Hủy bill" : "Yêu cầu hủy bill";
  $("#cancelBillDialogInfo").textContent = `${bill.invoiceNo} · ${bill.customer || "Khách lẻ"} · ${money(bill.total)}`;
  $("#cancelBillDialogSubmit").textContent = managerMode ? "Xác nhận hủy" : "Gửi yêu cầu hủy";
  $("#cancelBillError").textContent = "";
  const dialog = $("#cancelBillDialog");
  dialog.classList.remove("is-hidden");
  dialog.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => $("#cancelBillReason").focus());
}

function submitCancelBillForm(event) {
  event.preventDefault();
  const bill = state.bills.find((item) => item.id === $("#cancelBillId").value);
  if (!bill || !canCancelBill(bill)) {
    $("#cancelBillError").textContent = "Bill này không còn đủ điều kiện để hủy.";
    return;
  }
  const cleanReason = $("#cancelBillReason").value.trim();
  if (!cleanReason) {
    $("#cancelBillError").textContent = "Hãy nhập lý do hủy bill.";
    return;
  }

  if (!isManager()) {
    submitCancelRequest(bill, cleanReason);
    closeCancelBillDialog();
    return;
  }

  finalizeBillCancellation(bill, cleanReason);
  saveState();
  renderAll();
  closeCancelBillDialog();
  showToast(`Đã hủy ${bill.invoiceNo}`);
}

function cancelBill(billId) {
  openCancelBillDialog(billId);
}

function approveCancelRequest(requestId) {
  if (!isManager()) return;
  const request = state.cancelRequests.find((item) => item.id === requestId && item.status === "pending");
  const bill = request ? state.bills.find((item) => item.id === request.billId) : null;
  if (!request || !bill || bill.status === "canceled") {
    showToast("Yêu cầu hủy không còn hợp lệ.", "danger");
    return;
  }
  if (!state.shift.isOpen || bill.shiftId !== state.shift.id) {
    showToast("Ca của bill này đã chốt, không thể duyệt hủy trực tiếp.", "danger");
    return;
  }
  finalizeBillCancellation(bill, request.reason || "Không ghi", request);
  saveState();
  renderAll();
  showToast(`Đã duyệt hủy ${bill.invoiceNo}`);
}

function rejectCancelRequest(requestId) {
  if (!isManager()) return;
  const request = state.cancelRequests.find((item) => item.id === requestId && item.status === "pending");
  if (!request) return;
  if (!confirm(`Từ chối yêu cầu hủy ${request.invoiceNo || "bill"}?`)) return;
  const bill = state.bills.find((item) => item.id === request.billId);
  request.status = "rejected";
  request.resolvedAt = new Date().toISOString();
  request.resolvedById = state.session.id;
  request.resolvedBy = state.session.name;
  request.resolutionNote = "Quản Lí từ chối yêu cầu hủy.";
  logSecurity("Từ chối hủy bill", request.resolutionNote, bill || null);
  saveState();
  renderAll();
  showToast(`Đã từ chối yêu cầu hủy ${request.invoiceNo || "bill"}`);
}

function printPaymentBill() {
  const bill = saveBill({ print: true });
  if (bill) printBill(bill);
}

function printSavedBill(billId) {
  const bill = state.bills.find((item) => item.id === billId);
  if (!bill) return;
  printBill(bill);
}

function printBill(bill) {
  setReceiptPrintStyle();
  $("#printArea").innerHTML = `
    <div class="receipt">
      ${receiptShopHeaderHtml()}
      <p>Hóa đơn dịch vụ</p>
      <div class="receipt-row"><span>Số HĐ</span><strong>${escapeHtml(bill.invoiceNo || "-")}</strong></div>
      <div class="receipt-row"><span>STT chờ</span><strong>${bill.queueNo ? `#${escapeHtml(bill.queueNo)}` : "-"}</strong></div>
      <div class="receipt-row"><span>Thời gian</span><strong>${receiptTimeText(bill.createdAt)}</strong></div>
      <div class="receipt-row"><span>Khách</span><strong>${escapeHtml(bill.customer)}</strong></div>
      ${bill.phone ? `<div class="receipt-row"><span>SĐT</span><strong>${escapeHtml(bill.phone)}</strong></div>` : ""}
      <div class="receipt-row"><span>Nhân viên</span><strong>${escapeHtml(bill.staffName)}</strong></div>
      <div class="receipt-row"><span>Thanh toán</span><strong>${paymentLabel(bill.paymentMethod)}</strong></div>
      <div class="receipt-row"><span>Mã xác thực</span><strong>${escapeHtml(bill.verifyCode || billVerifyCode(bill))}</strong></div>
      ${receiptSealHtml(bill.verifyCode || billVerifyCode(bill))}
      ${bill.status === "canceled" ? `<div class="receipt-status">Đơn đã hủy</div>` : ""}
      ${bill.status === "canceled" && isManager() ? `<div class="receipt-row"><span>Lý do hủy</span><strong>${escapeHtml(bill.cancelReason || "Không ghi")}</strong></div>` : ""}
      ${bill.status === "canceled" && isManager() ? `<div class="receipt-row"><span>QL duyệt</span><strong>${escapeHtml(bill.approvedBy || "-")}</strong></div>` : ""}
      <hr>
      ${bill.items.map((item) => `
        <div class="receipt-row">
          <span>${escapeHtml(item.name)}</span>
          <strong>${money(item.price)}</strong>
        </div>
      `).join("")}
      <hr>
      <div class="receipt-row receipt-total"><span>Tổng tiền</span><strong>${money(bill.total)}</strong></div>
    </div>
  `;
  window.print();
}

function printShiftReport(report) {
  setReceiptPrintStyle();
  const staffRows = Array.isArray(report.staffCommissions) && report.staffCommissions.length
    ? report.staffCommissions.map((row) => `
      <div class="receipt-row">
        <span>Chia ${escapeHtml(row.name)}</span>
        <strong>${money(row.amount)}</strong>
      </div>
    `).join("")
    : `<div class="receipt-row"><span>Chia nhân viên</span><strong>0 VND</strong></div>`;
  const paymentRows = paymentOrder.map((method) => `
    <div class="receipt-row">
      <span>${paymentLabel(method)}</span>
      <strong>${money(normalizePaymentTotals(report.paymentTotals)[method])}</strong>
    </div>
  `).join("");

  $("#printArea").innerHTML = `
    <div class="receipt">
      ${receiptShopHeaderHtml()}
      <p>Phiếu kết ca</p>
      <div class="receipt-row"><span>Người trực</span><strong>${escapeHtml(report.cashierName || "-")}</strong></div>
      <div class="receipt-row"><span>Mở ca</span><strong>${timeText(report.openedAt) || "-"}</strong></div>
      <div class="receipt-row"><span>Kết ca</span><strong>${timeText(report.closedAt) || "-"}</strong></div>
      <hr>
      <div class="receipt-row"><span>Tiền đầu ca</span><strong>${money(report.openingCash)}</strong></div>
      <div class="receipt-row"><span>Bill hợp lệ</span><strong>${Number(report.billCount || 0)}</strong></div>
      <div class="receipt-row"><span>Doanh thu</span><strong>${money(report.sales)}</strong></div>
      ${paymentRows}
      <div class="receipt-row"><span>Đơn hủy</span><strong>${Number(report.canceledCount || 0)} / ${money(report.canceledAmount)}</strong></div>
      <div class="receipt-row"><span>Tiền dự kiến</span><strong>${money(report.expectedCash)}</strong></div>
      <div class="receipt-row"><span>Tiền thực tế</span><strong>${money(report.closingCash)}</strong></div>
      <div class="receipt-row receipt-total"><span>Chênh lệch</span><strong>${money(report.difference)}</strong></div>
      <hr>
      ${staffRows}
      <hr>
      <p>Đã lưu kết ca. Doanh thu ca hiện tại đã về 0.</p>
    </div>
  `;
  window.print();
}

function openShift() {
  if (state.shift.isOpen) {
    alert("Ca hiện tại đang mở. Hãy kết ca trước khi mở ca mới.");
    return;
  }
  if (state.shift.id && state.shift.closedAt) {
    alert("Ca đã kết. Hãy bấm In kết ca để kiểm tra xong và đưa màn hình về ca mới.");
    return;
  }

  state.shift = {
    id: crypto.randomUUID(),
    isOpen: true,
    openedAt: new Date().toISOString(),
    closedAt: "",
    cashierName: state.session.name,
    openingCash: Number($("#openingCash").value || 0),
    closingCash: 0,
    queueCounter: 0
  };
  state.selectedServiceIds = [];
  logSecurity("Mở ca", `Tiền đầu ca ${money(state.shift.openingCash)}`);
  saveState();
  renderAll();
  showToast(`Đã mở ca với ${money(state.shift.openingCash)}`);
}

function closeShift(options = {}) {
  if (!state.shift.isOpen) {
    alert("Chưa có ca đang mở.");
    return null;
  }

  const bills = currentShiftBills();
  const totals = totalsForBills(bills);
  const paymentTotals = paymentTotalsForBills(bills);
  const staffCommissions = commissionByStaff(bills).map(([name, amount]) => ({ name, amount }));
  const expectedCash = Number(state.shift.openingCash || 0) + paymentTotals.cash;
  const closingCashInput = $("#closingCash").value;
  const closingCash = closingCashInput === "" ? expectedCash : Number(closingCashInput || 0);

  state.shift.isOpen = false;
  state.shift.closedAt = new Date().toISOString();
  state.shift.closingCash = closingCash;

  const report = {
    ...state.shift,
    sales: totals.sales,
    commission: totals.commission,
    canceledAmount: totals.canceledAmount,
    billCount: totals.billCount,
    canceledCount: totals.canceledCount,
    paymentTotals,
    staffCommissions,
    expectedCash,
    difference: closingCash - expectedCash
  };
  state.shiftLogs = state.shiftLogs.filter((shift) => shift.id !== state.shift.id);
  state.shiftLogs.push(report);
  logSecurity(
    "Kết ca",
    `Doanh thu ${money(report.sales)}, tiền mặt dự kiến ${money(report.expectedCash)}, thực tế ${money(report.closingCash)}, lệch ${money(report.difference)}`
  );
  state.cancelRequests.forEach((request) => {
    const bill = state.bills.find((item) => item.id === request.billId);
    if (request.status !== "pending" || bill?.shiftId !== report.id) return;
    request.status = "rejected";
    request.resolvedAt = report.closedAt;
    request.resolvedById = state.session?.id || "";
    request.resolvedBy = state.session?.name || "Hệ thống";
    request.resolutionNote = "Ca đã kết trước khi yêu cầu được duyệt.";
  });
  saveState();
  renderAll();
  const shiftExcel = isManager() ? exportExcelReport({
    bills,
    days: excelReportDaysForBills(bills, report.closedAt),
    reportLabel: "BÁO CÁO KẾT CA",
    totalLabel: "KẾT CA",
    summarySheetName: "Tổng hợp kết ca",
    fileTag: "bao-cao-ket-ca",
    keepForManual: true,
    toastMessage: "Đã tạo Excel chi tiết kết ca"
  }) : null;
  showToast(shiftExcel
    ? "Đã chốt ca. Kiểm tra chênh lệch rồi bấm In kết ca để đưa ca mới về 0."
    : "Đã chốt ca. Kiểm tra chênh lệch rồi bấm In kết ca để đưa ca mới về 0.");
  if (options.print) {
    printShiftReport(report);
    resetShiftAfterPrinting();
  }
  return report;
}

function resetShiftAfterPrinting() {
  state.shift = structuredClone(defaultState.shift);
  state.selectedServiceIds = [];
  saveState();
  renderAll();
  showToast("Đã in kết ca. Màn hình đã sẵn sàng cho ca mới.");
}

function saveShopInfoSettings(event) {
  event.preventDefault();
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được sửa thông tin in bill.");
    return;
  }
  state.shopInfo = normalizeShopInfo({
    receiptName: $("#shopReceiptName").value,
    address: $("#shopReceiptAddress").value,
    phone: $("#shopReceiptPhone").value,
    receiptWidth: $("#receiptPaperWidth").value
  });
  logSecurity("Sửa thông tin in bill", `Khổ giấy ${state.shopInfo.receiptWidth}, địa chỉ: ${state.shopInfo.address || "chưa nhập"}`);
  saveState();
  renderAll();
  $("#shopInfoStatus").textContent = "Đã lưu thông tin in bill cho chi nhánh này.";
  showToast("Đã lưu địa chỉ và khổ giấy in bill");
}

async function createAccountGroup(event) {
  event.preventDefault();
  if (!isAdmin()) {
    alert("Chỉ Admin mới được quản lý tài khoản.");
    return;
  }

  const editWorkspaceId = $("#accountWorkspaceId").value;
  const workspaceName = $("#accountWorkspaceName").value.trim() || `Chi nhánh ${String(accountState.groups.length + 1).padStart(2, "0")}`;
  const managerId = $("#accountManagerId").value.trim();
  const managerPassword = $("#accountManagerPassword").value.trim();
  const cashierId = $("#accountCashierId").value.trim();
  const cashierPassword = $("#accountCashierPassword").value.trim();

  if (!managerId || !managerPassword || !cashierId || !cashierPassword) {
    $("#accountStatus").textContent = "Hãy nhập đủ ID và mật khẩu cho Quản Lí / Thu Ngân.";
    return;
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(managerId) || !/^[A-Za-z0-9_-]{4,32}$/.test(cashierId) || managerPassword.length < 6 || cashierPassword.length < 6) {
    $("#accountStatus").textContent = "ID cần 4-32 ký tự chữ/số; mật khẩu cần tối thiểu 6 ký tự.";
    return;
  }
  if (managerId === cashierId) {
    $("#accountStatus").textContent = "ID Quản Lí và ID Thu Ngân phải khác nhau.";
    return;
  }
  if (accountState.users.some((user) => {
    return user.workspaceId !== editWorkspaceId && (user.id === managerId || user.id === cashierId);
  })) {
    $("#accountStatus").textContent = "ID này đã tồn tại. Hãy chọn ID khác.";
    return;
  }

  const payload = { workspaceName, managerId, managerPassword, cashierId, cashierPassword };
  let created = null;
  try {
    created = editWorkspaceId
      ? await updateCloudAccountGroup(editWorkspaceId, payload)
      : await createCloudAccountGroup(payload);
  } catch (error) {
    if (error.status === 409) {
      $("#accountStatus").textContent = "ID này đã tồn tại trên hệ thống online. Bấm Tạo ID tự động hoặc nhập ID khác.";
      showToast("ID đã tồn tại", "danger");
      return;
    }
    if (!isFileOfflineMode()) {
      accountSyncOnline = false;
      accountSyncStatus = window.navigator.onLine === false ? "Máy đang offline" : "Lỗi server/database";
      $("#accountStatus").textContent = window.navigator.onLine === false
        ? "Máy đang offline nên chưa thể tạo tài khoản dùng chung. Kết nối mạng rồi tạo lại để điện thoại/máy khác thấy ngay."
        : "Chưa tạo được trên server online. Hãy kiểm tra Render đã có Postgres/DATABASE_URL rồi tạo lại, tránh tài khoản chỉ nằm ở một máy.";
      renderAccountGroups();
      showToast("Chưa tạo tài khoản online", "danger");
      return;
    }
    const workspaceId = editWorkspaceId || `pt-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const existingAdmin = accountState.users.find((user) => user.workspaceId === workspaceId && user.role === "admin");
    created = {
      online: false,
      group: { workspaceId, workspaceName, managerId, cashierId, createdAt: new Date().toISOString() },
      users: [
        { id: managerId, password: managerPassword, role: existingAdmin ? "admin" : "manager", name: existingAdmin ? "Admin" : `Quan Li ${workspaceName}`, workspaceId, workspaceName },
        { id: cashierId, password: cashierPassword, role: "cashier", name: `Thu Ngan ${workspaceName}`, workspaceId, workspaceName }
      ]
    };
  }

  mergeAccountGroup(created.group, created.users || []);
  if (created.online !== false) {
    accountSyncOnline = true;
    accountSyncStatus = `Online ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
    syncAccountGroups({ silent: true });
  }
  if (created.group?.workspaceId === activeWorkspaceId()) {
    const updatedSession = (created.users || []).find((user) => ["admin", "manager"].includes(user.role)) || (created.users || [])[0];
    if (updatedSession) {
      state.session = publicUser(updatedSession);
      state.workspaceId = state.session.workspaceId;
      saveSession(state.session);
      saveState();
    }
  }
  resetAccountForm();
  renderAccountGroups();
  $("#accountStatus").textContent = created.online === false
    ? "Đã tạo trên máy này. Muốn máy khác dùng chung, hãy chạy bản Render có database."
    : editWorkspaceId ? "Đã cập nhật tài khoản." : "Đã tạo bộ tài khoản riêng. Có thể tạo thêm không giới hạn, miễn ID không trùng.";
  showToast(editWorkspaceId ? "Đã sửa tài khoản" : "Đã tạo bộ tài khoản");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#loginId").value.trim();
  const password = $("#loginPassword").value;
  let cloudError = null;
  let user = null;
  try {
    user = await cloudLogin(id, password);
  } catch (error) {
    cloudError = error;
  }
  if (!user && (!cloudError || canUseLocalLoginFallback())) user = findLocalUser(id, password);

  if (user) {
    const session = publicUser(user);
    pendingShiftExcel = null;
    state = loadState(session.workspaceId);
    state.session = session;
    state.loggedIn = true;
    state.workspaceId = session.workspaceId;
    $("#loginError").textContent = "";
    saveSession(session);
    saveState();
    renderAll();
    setActiveTab("order");
    startCloudSync();
    syncAccountGroups({ silent: true });
    return;
  }
  if (cloudError?.status === 429) {
    $("#loginError").textContent = "Nhập sai quá nhiều lần. Chờ một chút rồi thử lại.";
  } else if (cloudError && !canUseLocalLoginFallback() && cloudError.status !== 401) {
    $("#loginError").textContent = "Chưa kết nối được server/database online. Kiểm tra Render rồi đăng nhập lại.";
  } else {
    $("#loginError").textContent = "Sai ID hoặc mật khẩu.";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  fetch(apiUrl("/api/logout"), {
    method: "POST",
    headers: syncHeaders(),
    credentials: "include"
  }).catch(() => {});
  clearInterval(window.__ptSyncInterval);
  clearInterval(window.__ptAccountSyncInterval);
  cloudStarted = false;
  accountSyncOnline = false;
  accountSyncStatus = "Chưa kiểm tra";
  pendingShiftExcel = null;
  state.session = null;
  state.loggedIn = false;
  saveSession(null);
  saveState();
  renderAll();
  setSyncStatus("Chưa đăng nhập", false);
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

$("#serviceGroups").addEventListener("change", (event) => {
  const id = event.target.dataset.serviceId;
  if (!id) return;
  if (event.target.checked) {
    state.selectedServiceIds = [...new Set([...state.selectedServiceIds, id])];
  } else {
    state.selectedServiceIds = state.selectedServiceIds.filter((serviceId) => serviceId !== id);
  }
  saveState();
  renderAll();
});

["customerName", "customerPhone", "orderStaff", "paymentMethod", "orderNote"].forEach((id) => {
  $(`#${id}`).addEventListener("input", renderBillPreview);
  $(`#${id}`).addEventListener("change", renderBillPreview);
});

$("#serviceForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được sửa bảng giá.");
    return;
  }

  const editId = $("#serviceId").value;
  const category = $("#serviceCategory").value;
  const name = $("#serviceName").value.trim();
  const price = Number($("#servicePrice").value || 0);
  const commission = Number($("#serviceCommission").value || 0);

  if (!name) {
    alert("Hãy nhập tên dịch vụ.");
    return;
  }

  const existing = editId ? serviceById(editId) : state.services.find((service) => {
    return service.category === category && service.name.toLowerCase() === name.toLowerCase();
  });

  if (existing) {
    existing.category = category;
    existing.name = name;
    existing.price = price;
    existing.commission = commission;
  } else {
    state.services.push({ id: crypto.randomUUID(), category, name, price, commission });
  }

  event.target.reset();
  $("#serviceId").value = "";
  saveState();
  renderAll();
  showToast(existing ? "Đã sửa dịch vụ" : "Đã thêm dịch vụ");
});

$("#catalogList").addEventListener("click", (event) => {
  if (!isManager()) return;

  const editId = event.target.dataset.editService;
  const deleteId = event.target.dataset.deleteService;

  if (editId) {
    const service = serviceById(editId);
    if (!service) return;
    $("#serviceId").value = service.id;
    $("#serviceCategory").value = service.category;
    $("#serviceName").value = service.name;
    $("#servicePrice").value = service.price;
    $("#serviceCommission").value = service.commission;
    $("#serviceName").focus();
    return;
  }

  if (deleteId) {
    const service = serviceById(deleteId);
    if (!service) return;
    if (!confirm(`Xóa dịch vụ "${service.name}"?`)) return;
    state.services = state.services.filter((item) => item.id !== deleteId);
    state.selectedServiceIds = state.selectedServiceIds.filter((serviceId) => serviceId !== deleteId);
    saveState();
    renderAll();
    showToast("Đã xóa dịch vụ");
  }
});

$("#staffForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được sửa nhân viên.");
    return;
  }

  const editId = $("#staffId").value;
  const name = $("#staffName").value.trim();
  if (!name) {
    alert("Hãy nhập tên nhân viên.");
    return;
  }
  const existing = editId ? staffById(editId) : null;
  if (existing) {
    existing.name = name;
    state.bills.forEach((bill) => {
      if (bill.staffId === editId) bill.staffName = name;
    });
  } else {
    state.staff.push({ id: crypto.randomUUID(), name });
  }
  $("#staffId").value = "";
  event.target.reset();
  saveState();
  renderAll();
  showToast(existing ? "Đã sửa nhân viên" : "Đã thêm nhân viên");
});

$("#staffList").addEventListener("click", (event) => {
  if (!isManager()) return;
  const editId = event.target.dataset.editStaff;
  const id = event.target.dataset.deleteStaff;
  if (editId) {
    const person = staffById(editId);
    if (!person) return;
    $("#staffId").value = person.id;
    $("#staffName").value = person.name;
    $("#staffName").focus();
    renderStaffList();
    return;
  }
  if (!id) return;
  const person = staffById(id);
  if (person && !confirm(`Xóa nhân viên "${person.name}"?`)) return;
  state.staff = state.staff.filter((item) => item.id !== id);
  if ($("#staffId").value === id) {
    $("#staffId").value = "";
    $("#staffForm").reset();
  }
  saveState();
  renderAll();
  showToast("Đã xóa nhân viên");
});

$("#billHistory").addEventListener("click", (event) => {
  const printId = event.target.dataset.printBill;
  const cancelId = event.target.dataset.cancelBill;
  if (printId) printSavedBill(printId);
  if (cancelId) cancelBill(cancelId);
});

$("#billCards").addEventListener("click", (event) => {
  const printId = event.target.dataset.printBill;
  const cancelId = event.target.dataset.cancelBill;
  if (printId) printSavedBill(printId);
  if (cancelId) cancelBill(cancelId);
});

$("#cancelApprovalList").addEventListener("click", (event) => {
  const approveId = event.target.dataset.approveCancelRequest;
  const rejectId = event.target.dataset.rejectCancelRequest;
  if (approveId) approveCancelRequest(approveId);
  if (rejectId) rejectCancelRequest(rejectId);
});

$("#cancelBillForm").addEventListener("submit", submitCancelBillForm);
$("#cancelBillDialogClose").addEventListener("click", closeCancelBillDialog);
$("#cancelBillDialogCancel").addEventListener("click", closeCancelBillDialog);
$("#cancelBillDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeCancelBillDialog();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCancelBillDialog();
});

$("#openShiftForm").addEventListener("submit", (event) => {
  event.preventDefault();
  openShift();
});

$("#closeShiftForm").addEventListener("submit", (event) => {
  event.preventDefault();
  closeShift();
});

$("#shopInfoForm").addEventListener("submit", saveShopInfoSettings);

$("#printShiftBtn").addEventListener("click", () => {
  if (state.shift.isOpen) {
    closeShift({ print: true });
    return;
  }
  if (state.shift.id && state.shift.closedAt) {
    const currentReport = state.shiftLogs.find((shift) => shift.id === state.shift.id);
    if (currentReport) {
      printShiftReport(currentReport);
      resetShiftAfterPrinting();
      return;
    }
  }
  const latestReport = state.shiftLogs.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))[0];
  if (latestReport) {
    printShiftReport(latestReport);
    return;
  }
  alert("Chưa có ca nào để in.");
});

$("#downloadBackupBtn").addEventListener("click", downloadBackup);
$("#chooseBackupBtn").addEventListener("click", () => $("#backupFileInput").click());
$("#backupFileInput").addEventListener("change", (event) => {
  importBackupFile(event.target.files[0]);
  event.target.value = "";
});
$("#exportExcelBtn").addEventListener("click", exportExcelReport);
$("#downloadShiftExcelBtn").addEventListener("click", downloadPendingShiftExcel);

$("#accountGroupForm").addEventListener("submit", createAccountGroup);
$("#accountAutoFillBtn").addEventListener("click", generateAccountCredentials);
$("#accountCancelEditBtn").addEventListener("click", resetAccountForm);
$("#accountSearch").addEventListener("input", renderAccountGroups);
$("#accountGroupList").addEventListener("click", async (event) => {
  if (!isAdmin()) return;
  const editId = event.target.dataset.editAccount;
  const deleteId = event.target.dataset.deleteAccount;
  if (editId) {
    fillAccountForm(editId);
    $("#accountWorkspaceName").focus();
    return;
  }
  if (!deleteId) return;
  const group = accountState.groups.find((item) => item.workspaceId === deleteId);
  if (!group) return;
  if (deleteId === activeWorkspaceId()) {
    alert("Không thể xóa bộ tài khoản đang đăng nhập.");
    return;
  }
  if (!confirm(`Xóa bộ tài khoản "${group.workspaceName}"? Toàn bộ ID và dữ liệu của bộ này sẽ bị xóa khỏi hệ thống online.`)) return;
  try {
    await deleteCloudAccountGroup(deleteId);
  } catch {
    if (!isFileOfflineMode()) {
      accountSyncOnline = false;
      accountSyncStatus = window.navigator.onLine === false ? "Máy đang offline" : "Lỗi server/database";
      renderAccountGroups();
      showToast("Chưa xóa được trên server online", "danger");
      return;
    }
  }
  accountState.groups = accountState.groups.filter((item) => item.workspaceId !== deleteId);
  accountState.users = accountState.users.filter((user) => user.workspaceId !== deleteId);
  localStorage.removeItem(workspaceStoreKey(deleteId));
  saveAccountState();
  if ($("#accountWorkspaceId").value === deleteId) resetAccountForm();
  renderAccountGroups();
  showToast("Đã xóa tài khoản");
});
$("#resetOrderBtn").addEventListener("click", resetOrder);
$("#cancelCurrentBillBtn").addEventListener("click", clearSelectedServices);
$("#saveBillBtn").addEventListener("click", printPaymentBill);
$("#billSearch").addEventListener("input", renderBillHistory);
$("#installAppBtn").addEventListener("click", handleInstallApp);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  showToast("App PT Barbershop đã sẵn sàng");
});

function refreshCloudNow() {
  if (!isLoggedIn()) return;
  pullCloudState().catch(() => setSyncStatus("Lưu trên máy này", false));
  if (isAdmin()) syncAccountGroups({ silent: true });
}

window.addEventListener("focus", refreshCloudNow);
window.addEventListener("online", () => {
  if (isLoggedIn()) startCloudSync();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshCloudNow();
});

renderAll();
startCloudSync();
syncAccountGroups({ silent: true });
restoreCloudSession();
updateInstallButton();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
