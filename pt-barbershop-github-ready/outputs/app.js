const STORE_KEY = "barbershop-order-v1";
const BACKUP_VERSION = 1;

const USERS = [
  { id: "9939", password: "040426", role: "manager", name: "Quản Lý" },
  { id: "3122", password: "152004", role: "cashier", name: "Thu Ngân" }
];

const categoryNames = {
  cut: "Cắt",
  perm: "Uốn",
  color: "Nhuộm",
  extra: "Dịch vụ"
};

const categoryOrder = ["cut", "perm", "color", "extra"];

const defaultState = {
  session: null,
  loggedIn: false,
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
  shiftLogs: []
};

let state = loadState();

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0)) + " VND";
const timeText = (iso) => iso ? new Date(iso).toLocaleString("vi-VN") : "";

function sequenceFromInvoiceNo(invoiceNo) {
  const digits = String(invoiceNo || "").match(/\d+/g)?.join("");
  return digits ? Number(digits) : 0;
}

function formatInvoiceNo(sequence) {
  return `HD${String(Number(sequence || 0)).padStart(6, "0")}`;
}

function nextInvoiceSequence() {
  state.invoiceCounter = Number(state.invoiceCounter || 0) + 1;
  return state.invoiceCounter;
}

function nextQueueNumber() {
  state.shift.queueCounter = Number(state.shift.queueCounter || 0) + 1;
  return state.shift.queueCounter;
}

function loadState() {
  const saved = localStorage.getItem(STORE_KEY);
  if (!saved) return structuredClone(defaultState);

  try {
    return normalizeState({ ...structuredClone(defaultState), ...JSON.parse(saved) });
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(nextState) {
  nextState.session = nextState.session?.role ? nextState.session : null;
  nextState.loggedIn = Boolean(nextState.session);
  nextState.invoiceCounter = Number(nextState.invoiceCounter || 0);
  nextState.staff = Array.isArray(nextState.staff) ? nextState.staff : structuredClone(defaultState.staff);
  nextState.services = Array.isArray(nextState.services) ? nextState.services : structuredClone(defaultState.services);
  nextState.selectedServiceIds = Array.isArray(nextState.selectedServiceIds) ? nextState.selectedServiceIds : [];
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
    difference: Number(shift.difference || 0)
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
      staffId: bill.staffId || "",
      staffName: bill.staffName || "Chưa chọn",
      note: bill.note || "",
      shiftId,
      createdBy: bill.createdBy || "Hệ thống",
      status: bill.status || "paid",
      canceledAt: bill.canceledAt || "",
      canceledBy: bill.canceledBy || "",
      cancelReason: bill.cancelReason || "",
      items,
      total,
      commission
    };
  }) : [];

  nextState.invoiceCounter = Math.max(nextState.invoiceCounter, invoiceCounter);
  if (nextState.shift.id) {
    nextState.shift.queueCounter = Math.max(nextState.shift.queueCounter, shiftQueueCounters.get(nextState.shift.id) || 0);
  }

  return nextState;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function dataForBackup() {
  return {
    invoiceCounter: state.invoiceCounter,
    staff: state.staff,
    services: state.services,
    bills: state.bills,
    shift: state.shift,
    shiftLogs: state.shiftLogs
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
      state = normalizeState({
        ...structuredClone(defaultState),
        ...data,
        session: currentSession,
        loggedIn: true,
        selectedServiceIds: []
      });
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
  return state.session?.role === "manager";
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
    bill.staffName
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
    <div class="row-meta">Lý do: ${escapeHtml(bill.cancelReason || "Không ghi")}</div>
  `;
}

function requireLogin() {
  $("#loginScreen").classList.toggle("is-hidden", isLoggedIn());
  $("#appScreen").classList.toggle("is-hidden", !isLoggedIn());
}

function setActiveTab(tabName) {
  const managerTabs = new Set(["catalog", "staff"]);
  const safeTab = managerTabs.has(tabName) && !isManager() ? "order" : tabName;

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === safeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("is-hidden"));
  $(`#tab-${safeTab}`).classList.remove("is-hidden");
}

function renderPermissions() {
  const roleLabel = isManager() ? "Quản Lý" : "Thu Ngân";
  $("#sessionLabel").textContent = state.session ? `${state.session.name} đang trực` : "Chưa đăng nhập";
  $("#roleBadge").textContent = state.session ? roleLabel : "Guest";
  $("#roleBadge").classList.toggle("manager", isManager());

  document.querySelectorAll("[data-manager-only]").forEach((element) => {
    element.classList.toggle("is-hidden", !isManager());
  });

  if (!isManager()) {
    const activeButton = document.querySelector(".tab-button.is-active");
    if (activeButton && ["catalog", "staff"].includes(activeButton.dataset.tab)) {
      setActiveTab("order");
    }
  }
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
      <span>Nhân viên: ${escapeHtml(staff?.name || "Chưa chọn")}</span>
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
      <button class="small-button danger-button" data-delete-staff="${person.id}">Xóa</button>
    </div>
  `).join("") : `<p class="empty-state">Chưa có nhân viên.</p>`;
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
    body.innerHTML = `<tr><td colspan="${isManager() ? 9 : 8}">${emptyText}</td></tr>`;
    cards.innerHTML = `<p class="empty-state">${emptyText}</p>`;
    return;
  }

  body.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const cancelNote = cancelDetailsHtml(bill);
    const commissionCell = isManager() ? `<td>${canceled ? "0 VND" : money(bill.commission)}</td>` : "";
    const actions = `
      <button class="small-button" data-print-bill="${bill.id}">In lại</button>
      ${canCancelBill(bill) ? `<button class="small-button danger-button" data-cancel-bill="${bill.id}">Hủy đơn</button>` : ""}
    `;

    return `
      <tr class="${canceled ? "row-canceled" : ""}">
        <td>${billIdentityHtml(bill)}</td>
        <td>${timeText(bill.createdAt)}</td>
        <td>${escapeHtml(bill.customer)}${cancelNote}</td>
        <td>${escapeHtml(bill.staffName)}</td>
        <td>${services}</td>
        <td><span class="status ${canceled ? "canceled" : "paid"}">${canceled ? "Đã hủy" : "Đã tính tiền"}</span></td>
        <td><strong>${money(bill.total)}</strong></td>
        ${commissionCell}
        <td><span class="row-actions">${actions}</span></td>
      </tr>
    `;
  }).join("");

  cards.innerHTML = bills.map((bill) => {
    const canceled = bill.status === "canceled";
    const services = bill.items.map((item) => escapeHtml(item.name)).join(", ");
    const actions = `
      <button class="small-button" data-print-bill="${bill.id}">In lại</button>
      ${canCancelBill(bill) ? `<button class="small-button danger-button" data-cancel-bill="${bill.id}">Hủy đơn</button>` : ""}
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
  const expectedCash = Number(state.shift.openingCash || 0) + totals.sales;
  const hasClosed = Boolean(state.shift.closedAt);
  const difference = Number(state.shift.closingCash || 0) - expectedCash;

  $("#shiftStatus").textContent = state.shift.isOpen ? "Đang mở ca" : hasClosed ? "Đã kết ca" : "Chưa mở ca";
  $("#cashStatus").textContent = money(expectedCash);
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
    <div class="summary-row"><span>Lưu dữ liệu</span><strong>Đã lưu trên máy này</strong></div>
    <div class="summary-row"><span>Trạng thái</span><strong>${state.shift.isOpen ? "Đang mở" : hasClosed ? "Đã kết ca" : "Chưa mở ca"}</strong></div>
    <div class="summary-row"><span>Người mở ca</span><strong>${escapeHtml(state.shift.cashierName || "-")}</strong></div>
    <div class="summary-row"><span>Mở ca lúc</span><strong>${timeText(state.shift.openedAt) || "-"}</strong></div>
    <div class="summary-row"><span>Kết ca lúc</span><strong>${timeText(state.shift.closedAt) || "-"}</strong></div>
    <div class="summary-row"><span>Tiền đầu ca</span><strong>${money(state.shift.openingCash)}</strong></div>
    <div class="summary-row"><span>Số bill hợp lệ</span><strong>${totals.billCount}</strong></div>
    <div class="summary-row"><span>Doanh thu hợp lệ</span><strong>${money(totals.sales)}</strong></div>
    <div class="summary-row"><span>Đơn đã hủy</span><strong>${totals.canceledCount} đơn / ${money(totals.canceledAmount)}</strong></div>
    <div class="summary-row"><span>Tiền dự kiến trong két</span><strong>${money(expectedCash)}</strong></div>
    ${isManager() ? `<div class="summary-row"><span>Tổng chia nhân viên</span><strong>${money(totals.commission)}</strong></div>` : ""}
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

  body.innerHTML = state.shiftLogs.slice().sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((shift) => `
    <tr>
      <td>${escapeHtml(shift.cashierName)}</td>
      <td>${timeText(shift.openedAt)}</td>
      <td>${timeText(shift.closedAt)}</td>
      <td>${money(shift.openingCash)}</td>
      <td><strong>${money(shift.sales)}</strong><div class="row-meta">${shift.billCount} bill hợp lệ</div></td>
      <td>${shift.canceledCount} đơn<div class="row-meta">${money(shift.canceledAmount)}</div></td>
      <td>${money(shift.expectedCash)}</td>
      <td>${money(shift.closingCash)}</td>
      <td><strong class="${shift.difference >= 0 ? "ok" : "danger-text"}">${money(shift.difference)}</strong></td>
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
  renderCatalog();
  renderStaffList();
  renderBillHistory();
  renderShift();
  renderShiftLogs();
  renderBackupInfo();
}

function resetOrder() {
  state.selectedServiceIds = [];
  $("#customerName").value = "";
  $("#orderNote").value = "";
  saveState();
  renderAll();
}

function clearSelectedServices() {
  state.selectedServiceIds = [];
  saveState();
  renderAll();
}

function saveBill() {
  const staff = staffById($("#orderStaff").value);
  state.selectedServiceIds = selectedServiceIds();
  const services = selectedServices();
  if (!staff) {
    alert("Hãy thêm hoặc chọn nhân viên.");
    return;
  }
  if (!services.length) {
    alert("Hãy chọn ít nhất 1 dịch vụ.");
    return;
  }
  if (!state.shift.isOpen) {
    alert("Hãy nhập đầu ca trước khi lưu bill.");
    setActiveTab("shift");
    return;
  }

  const { total, commission } = billTotals(services);
  const invoiceSequence = nextInvoiceSequence();
  const queueNo = nextQueueNumber();
  state.bills.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    invoiceSequence,
    invoiceNo: formatInvoiceNo(invoiceSequence),
    queueNo,
    customer: $("#customerName").value.trim() || "Khách lẻ",
    staffId: staff.id,
    staffName: staff.name,
    note: $("#orderNote").value.trim(),
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
  });
  resetOrder();
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

  bill.status = "canceled";
  bill.canceledAt = new Date().toISOString();
  bill.canceledBy = state.session.name;
  bill.cancelReason = cleanReason;
  saveState();
  renderAll();
}

function printCurrentBill() {
  const staff = staffById($("#orderStaff").value);
  const services = selectedServices();
  if (!services.length) {
    alert("Hãy chọn dịch vụ trước khi in bill.");
    return;
  }
  const { total } = billTotals(services);
  printBill({
    createdAt: new Date().toISOString(),
    invoiceNo: formatInvoiceNo(Number(state.invoiceCounter || 0) + 1),
    queueNo: state.shift.isOpen ? Number(state.shift.queueCounter || 0) + 1 : "",
    customer: $("#customerName").value.trim() || "Khách lẻ",
    staffName: staff?.name || "Chưa chọn",
    items: services,
    total,
    status: "draft"
  });
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
      <div class="receipt-row"><span>Thời gian</span><strong>${timeText(bill.createdAt)}</strong></div>
      <div class="receipt-row"><span>Khách</span><strong>${escapeHtml(bill.customer)}</strong></div>
      <div class="receipt-row"><span>Nhân viên</span><strong>${escapeHtml(bill.staffName)}</strong></div>
      ${bill.status === "canceled" ? `<div class="receipt-status">Đơn đã hủy</div>` : ""}
      ${bill.status === "canceled" && isManager() ? `<div class="receipt-row"><span>Lý do hủy</span><strong>${escapeHtml(bill.cancelReason || "Không ghi")}</strong></div>` : ""}
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
  saveState();
  renderAll();
}

function closeShift() {
  if (!state.shift.isOpen) {
    alert("Chưa có ca đang mở.");
    return;
  }

  const bills = currentShiftBills();
  const totals = totalsForBills(bills);
  const expectedCash = Number(state.shift.openingCash || 0) + totals.sales;
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
    expectedCash,
    difference: closingCash - expectedCash
  };
  state.shiftLogs = state.shiftLogs.filter((shift) => shift.id !== state.shift.id);
  state.shiftLogs.push(report);
  saveState();
  renderAll();
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

$("#loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = $("#loginId").value.trim();
  const password = $("#loginPassword").value;
  const user = USERS.find((item) => item.id === id && item.password === password);

  if (user) {
    state.session = { id: user.id, role: user.role, name: user.name };
    state.loggedIn = true;
    $("#loginError").textContent = "";
    saveState();
    renderAll();
    setActiveTab("order");
    return;
  }
  $("#loginError").textContent = "Sai ID hoặc mật khẩu.";
});

$("#logoutBtn").addEventListener("click", () => {
  state.session = null;
  state.loggedIn = false;
  saveState();
  renderAll();
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

["customerName", "orderStaff", "orderNote"].forEach((id) => {
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
  }
});

$("#staffForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) {
    alert("Chỉ Quản Lý mới được sửa nhân viên.");
    return;
  }

  const name = $("#staffName").value.trim();
  if (!name) {
    alert("Hãy nhập tên nhân viên.");
    return;
  }
  state.staff.push({ id: crypto.randomUUID(), name });
  event.target.reset();
  saveState();
  renderAll();
});

$("#staffList").addEventListener("click", (event) => {
  if (!isManager()) return;
  const id = event.target.dataset.deleteStaff;
  if (!id) return;
  const person = staffById(id);
  if (person && !confirm(`Xóa nhân viên "${person.name}"?`)) return;
  state.staff = state.staff.filter((item) => item.id !== id);
  saveState();
  renderAll();
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

$("#downloadBackupBtn").addEventListener("click", downloadBackup);
$("#chooseBackupBtn").addEventListener("click", () => $("#backupFileInput").click());
$("#backupFileInput").addEventListener("change", (event) => {
  importBackupFile(event.target.files[0]);
  event.target.value = "";
});

$("#resetOrderBtn").addEventListener("click", resetOrder);
$("#cancelCurrentBillBtn").addEventListener("click", clearSelectedServices);
$("#saveBillBtn").addEventListener("click", saveBill);
$("#printBillBtn").addEventListener("click", printCurrentBill);
$("#billSearch").addEventListener("input", renderBillHistory);

renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
