const STORE_KEY = "barbershop-order-v1";
const ACCOUNT_STORE_KEY = "barbershop-accounts-v1";
const SESSION_KEY = "barbershop-session-v1";
const BACKUP_VERSION = 1;
const SYNC_INTERVAL_MS = 2500;
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
  bills: [],
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
let savedSession = loadSavedSession();
let state = loadState(savedSession?.workspaceId || DEFAULT_WORKSPACE_ID);
if (savedSession && findLocalUser(savedSession.id, savedSession.password)) {
  state.session = publicUser(findLocalUser(savedSession.id, savedSession.password));
  state.loggedIn = true;
  state.workspaceId = state.session.workspaceId;
} else {
  savedSession = null;
  saveSession(null);
}
let cloudStarted = false;
let cloudBooting = false;
let cloudSaveTimer = null;
let cloudPendingSave = false;
let applyingRemoteState = false;
let lastRemoteUpdatedAt = "";
let syncOnline = false;
let toastTimer = null;
let pendingManagerApproval = null;
let deferredInstallPrompt = null;

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

function loadSavedSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
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
    password: user.password,
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
    accountState.users = accountState.users.filter((item) => item.id !== user.id);
    accountState.users.push(user);
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
  nextState.securityLog = Array.isArray(nextState.securityLog) ? nextState.securityLog.map((entry) => ({
    id: entry.id || crypto.randomUUID(),
    createdAt: entry.createdAt || new Date().toISOString(),
    userId: entry.userId || "",
    userName: entry.userName || "Hệ thống",
    role: entry.role || "",
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
      items,
      total,
      commission
    };
  }) : [];

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
    staff: state.staff,
    services: state.services,
    bills: state.bills,
    shift: state.shift,
    shiftLogs: state.shiftLogs,
    securityLog: state.securityLog
  };
}

function hasBusinessData(data = businessState()) {
  return Boolean(
    Number(data.invoiceCounter || 0) ||
    (Array.isArray(data.bills) && data.bills.length) ||
    (Array.isArray(data.shiftLogs) && data.shiftLogs.length) ||
    (Array.isArray(data.securityLog) && data.securityLog.length) ||
    data.shift?.isOpen ||
    Number(data.shift?.openingCash || 0) ||
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
  const user = accountState.users.find((item) => item.id === state.session?.id);
  const headers = { "Content-Type": "application/json" };
  if (state.session) {
    headers["X-PT-User"] = state.session.id;
    headers["X-PT-Password"] = state.session.password || user?.password || "";
  }
  return headers;
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
    action,
    invoiceNo: bill?.invoiceNo || "",
    detail
  });
  state.securityLog = state.securityLog.slice(0, SECURITY_LOG_LIMIT);
}

function managerUser() {
  return accountState.users.find((user) => {
    return ["admin", "manager"].includes(user.role) && user.workspaceId === activeWorkspaceId();
  });
}

function requestManagerApproval(actionText) {
  if (isManager()) {
    const manager = managerUser();
    if (!manager) return null;
    return { id: manager.id, name: manager.name, password: manager.password };
  }

  const id = prompt(`Cần Quản Lý duyệt để ${actionText}.\nNhập ID Quản Lý:`);
  if (id === null) return null;
  const password = prompt("Nhập mật khẩu Quản Lý:");
  if (password === null) return null;

  const manager = managerUser();
  if (!manager || id.trim() !== manager.id || password !== manager.password) {
    alert("Mã Quản Lý không đúng. Bill chưa bị hủy.");
    logSecurity("Chặn hủy bill", `Sai mã Quản Lý khi ${actionText}`);
    saveState();
    return null;
  }

  pendingManagerApproval = { id: manager.id, password: manager.password };
  return { id: manager.id, name: manager.name, password: manager.password };
}

async function fetchCloudState() {
  const response = await fetch(apiUrl("/api/state"), { headers: syncHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error("Sync fetch failed");
  return response.json();
}

async function cloudLogin(id, password) {
  const response = await fetch(apiUrl("/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password })
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.user) {
    mergeAccountGroup(payload.group, payload.users || [payload.user]);
    return payload.user;
  }
  return null;
}

async function syncAccountGroups() {
  if (!isAdmin()) return;
  try {
    const response = await fetch(apiUrl("/api/account-groups"), {
      headers: syncHeaders(),
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    (payload.groups || []).forEach((group) => mergeAccountGroup(group, group.users || []));
    renderAccountGroups();
  } catch {
    // Offline/static mode still uses account groups saved on this device.
  }
}

async function createCloudAccountGroup(payload) {
  const response = await fetch(apiUrl("/api/account-groups"), {
    method: "POST",
    headers: syncHeaders(),
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
    headers: syncHeaders()
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
  const headers = syncHeaders();
  if (pendingManagerApproval) {
    headers["X-PT-Manager-User"] = pendingManagerApproval.id;
    headers["X-PT-Manager-Password"] = pendingManagerApproval.password;
  }
  const response = await fetch(apiUrl("/api/state"), {
    method: "POST",
    headers,
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
  pendingManagerApproval = null;
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
    cloudBooting = false;
    if (cloudPendingSave) scheduleCloudSave();
    clearInterval(window.__ptSyncInterval);
    window.__ptSyncInterval = setInterval(() => {
      pullCloudState().catch(() => setSyncStatus("Lưu trên máy này", false));
    }, SYNC_INTERVAL_MS);
  } catch {
    cloudBooting = false;
    setSyncStatus("Lưu trên máy này", false);
  }
}

function dataForBackup() {
  return {
    invoiceCounter: state.invoiceCounter,
    staff: state.staff,
    services: state.services,
    bills: state.bills,
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
  return isManager() ? state.bills : currentShiftBills();
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

function commissionByStaff(bills) {
  const rows = new Map();
  activeBills(bills).forEach((bill) => {
    rows.set(bill.staffName, (rows.get(bill.staffName) || 0) + Number(bill.commission || 0));
  });
  return Array.from(rows.entries());
}

function canCancelBill(bill) {
  return bill.status !== "canceled" && state.shift.isOpen && bill.shiftId === state.shift.id;
}

function billSearchTerm() {
  return ($("#billSearch")?.value || "").trim().toLowerCase();
}

function billMatchesSearch(bill, term) {
  if (!term) return true;
  return [
    bill.invoiceNo,
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
  const totalText = `<p class="backup-status account-limit-note">Đang có ${accountState.groups.length} bộ tài khoản. Có thể tạo không giới hạn chi nhánh, chỉ cần ID không trùng.</p>`;

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
          <span class="row-meta">${manager?.role === "admin" ? "Admin" : "Quan Li"}: ${escapeHtml(manager?.id || group.managerId || "-")} / ${escapeHtml(manager?.password || "-")}</span>
          <span class="row-meta">Thu Ngan: ${escapeHtml(cashier?.id || group.cashierId || "-")} / ${escapeHtml(cashier?.password || "-")}</span>
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
  $("#accountStatus").textContent = "Tạo không giới hạn chi nhánh, chỉ cần ID không trùng nhau.";
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
  $("#accountManagerPassword").value = manager?.password || "";
  $("#accountCashierId").value = cashier?.id || group.cashierId || "";
  $("#accountCashierPassword").value = cashier?.password || "";
  $("#accountSubmitBtn").textContent = "Lưu tài khoản";
  $("#accountCancelEditBtn").classList.remove("is-hidden");
  $("#accountStatus").textContent = "Đang sửa bộ tài khoản. Bấm Lưu tài khoản để cập nhật.";
}

function renderBillHistory() {
  const body = $("#billHistory");
  const cards = $("#billCards");
  const term = billSearchTerm();
  const bills = visibleBills()
    .filter((bill) => billMatchesSearch(bill, term))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#historyTitle").textContent = isManager() ? "Tất cả bill trong hệ thống" : "Bill trong ca hiện tại";
  $("#historyScope").textContent = isManager() ? "Quản lý xem cả đơn thanh toán và đơn hủy" : "Thu ngân chỉ thấy bill của ca này";

  if (!bills.length) {
    const emptyText = term ? "Không tìm thấy hóa đơn phù hợp." : "Chưa có bill nào.";
    body.innerHTML = `<tr><td colspan="${isManager() ? 10 : 9}">${emptyText}</td></tr>`;
    cards.innerHTML = `<p class="empty-state">${emptyText}</p>`;
    return;
  }

  body.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const cancelNote = cancelDetailsHtml(bill);
    const commissionCell = isManager() ? `<td>${canceled ? "0 VND" : money(bill.commission)}</td>` : "";
    const customerMeta = (bill.phone || bill.note) ? `
      <div class="row-meta">
        ${bill.phone ? `<span>SĐT: ${escapeHtml(bill.phone)}</span>` : ""}
        ${bill.note ? `<span>Ghi chú: ${escapeHtml(bill.note)}</span>` : ""}
      </div>
    ` : "";
    const cancelButtonText = isManager() ? "Hủy đơn" : "Hủy cần QL";
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
        <td><span class="status ${canceled ? "canceled" : "paid"}">${canceled ? "Đã hủy" : "Đã tính tiền"}</span></td>
        <td>${paymentLabel(bill.paymentMethod)}</td>
        <td><strong>${money(bill.total)}</strong></td>
        ${commissionCell}
        <td><span class="row-actions">${actions}</span></td>
      </tr>
    `;
  }).join("");

  cards.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const cancelButtonText = isManager() ? "Hủy đơn" : "Hủy cần QL";
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
              <span>${timeText(bill.createdAt)}</span>
              <span>Nhân viên: ${escapeHtml(bill.staffName)}</span>
              <span>Thanh toán: ${paymentLabel(bill.paymentMethod)}</span>
              ${bill.phone ? `<span>SĐT: ${escapeHtml(bill.phone)}</span>` : ""}
            </div>
          </div>
          <span class="status ${canceled ? "canceled" : "paid"}">${canceled ? "Đã hủy" : "Đã tính tiền"}</span>
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

  const staffRows = isManager() ? commissionByStaff(bills).map(([name, amount]) => `
    <div class="summary-row">
      <span>Chia ${escapeHtml(name)}</span>
      <strong>${money(amount)}</strong>
    </div>
  `).join("") : "";

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
  `;
}

function renderShiftLogs() {
  const body = $("#shiftLogBody");
  if (!body) return;

  if (!state.shiftLogs.length) {
    body.innerHTML = `<tr><td colspan="9">Chưa có ca nào đã kết.</td></tr>`;
    return;
  }

  body.innerHTML = state.shiftLogs.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((shift) => {
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

  const entries = Array.isArray(state.securityLog) ? state.securityLog.slice(0, SECURITY_LOG_LIMIT) : [];
  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="5">Chưa có nhật ký bảo mật.</td></tr>`;
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
  renderCatalog();
  renderStaffList();
  renderAccountGroups();
  renderBillHistory();
  renderShift();
  renderShiftLogs();
  renderSecurityLog();
  renderBackupInfo();
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
  showToast(`Đã mở ca với ${money(state.shift.openingCash)}`);
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
    commission
  };
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

function cancelBill(billId) {
  const bill = state.bills.find((item) => item.id === billId);
  if (!bill || !canCancelBill(bill)) return;
  const reason = prompt(`Nhập lý do hủy hóa đơn ${bill.invoiceNo || ""}:`);
  if (reason === null) return;
  const cleanReason = reason.trim();
  if (!cleanReason) {
    alert("Phải nhập lý do hủy đơn.");
    return;
  }
  const approval = requestManagerApproval(`hủy hóa đơn ${bill.invoiceNo || ""}`);
  if (!approval) return;

  bill.status = "canceled";
  bill.canceledAt = new Date().toISOString();
  bill.canceledBy = state.session.name;
  bill.cancelReason = cleanReason;
  bill.approvedBy = approval.name;
  bill.approvedAt = new Date().toISOString();
  logSecurity("Hủy bill", `Lý do: ${cleanReason}. Quản Lý duyệt: ${approval.name}`, bill);
  saveState();
  renderAll();
  showToast(`Đã hủy ${bill.invoiceNo}`);
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
  $("#printArea").innerHTML = `
    <div class="receipt">
      <h1>PT Barbershop</h1>
      <p>Hóa đơn dịch vụ</p>
      <div class="receipt-row"><span>Số HĐ</span><strong>${escapeHtml(bill.invoiceNo || "-")}</strong></div>
      <div class="receipt-row"><span>STT chờ</span><strong>${bill.queueNo ? `#${escapeHtml(bill.queueNo)}` : "-"}</strong></div>
      <div class="receipt-row"><span>Thời gian</span><strong>${receiptTimeText(bill.createdAt)}</strong></div>
      <div class="receipt-row"><span>Khách</span><strong>${escapeHtml(bill.customer)}</strong></div>
      ${bill.phone ? `<div class="receipt-row"><span>SĐT</span><strong>${escapeHtml(bill.phone)}</strong></div>` : ""}
      <div class="receipt-row"><span>Nhân viên</span><strong>${escapeHtml(bill.staffName)}</strong></div>
      <div class="receipt-row"><span>Thanh toán</span><strong>${paymentLabel(bill.paymentMethod)}</strong></div>
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
      <h1>PT Barbershop</h1>
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
  state.shift = structuredClone(defaultState.shift);
  state.selectedServiceIds = [];
  saveState();
  renderAll();
  showToast("Đã kết ca. Doanh thu ca hiện tại đã về 0.");
  if (options.print) {
    printShiftReport(report);
  }
  return report;
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
  let user = findLocalUser(id, password);
  if (!user) {
    user = await cloudLogin(id, password).catch(() => null);
  }

  if (user) {
    const session = publicUser(user);
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
    syncAccountGroups();
    return;
  }
  $("#loginError").textContent = "Sai ID hoặc mật khẩu.";
});

$("#logoutBtn").addEventListener("click", () => {
  clearInterval(window.__ptSyncInterval);
  cloudStarted = false;
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

$("#openShiftForm").addEventListener("submit", (event) => {
  event.preventDefault();
  openShift();
});

$("#closeShiftForm").addEventListener("submit", (event) => {
  event.preventDefault();
  closeShift();
});

$("#printShiftBtn").addEventListener("click", () => {
  if (state.shift.isOpen) {
    closeShift({ print: true });
    return;
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
    // Static/offline mode removes the local account only.
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

renderAll();
startCloudSync();
syncAccountGroups();
updateInstallButton();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
