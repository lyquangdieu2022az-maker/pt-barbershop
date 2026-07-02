const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".site-nav");
const bookingForm = document.querySelector("#bookingForm");
const bookingResult = document.querySelector("#bookingResult");
const dateInput = document.querySelector("#guestDate");

const today = new Date();
dateInput.min = today.toISOString().slice(0, 10);

function closeMenu() {
  document.body.classList.remove("is-menu-open");
  menuButton?.setAttribute("aria-expanded", "false");
}

menuButton?.addEventListener("click", () => {
  const open = !document.body.classList.contains("is-menu-open");
  document.body.classList.toggle("is-menu-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
});

nav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});

const sectionLinks = [...document.querySelectorAll(".site-nav a")];
const sections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

const navObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    sectionLinks.forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
    });
  });
}, { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 });

sections.forEach((section) => navObserver.observe(section));

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("is-visible");
  });
}, { threshold: 0.16 });

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

function formatDate(value) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function bookingText(data) {
  return [
    "PT Barbershop - Phiếu đặt lịch",
    `Khách: ${data.name}`,
    `SĐT: ${data.phone}`,
    `Dịch vụ: ${data.service}`,
    `Thợ: ${data.barber}`,
    `Ngày: ${formatDate(data.date)}`,
    `Giờ: ${data.time}`,
    `Ghi chú: ${data.note || "Không"}`
  ].join("\n");
}

bookingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {
    name: document.querySelector("#guestName").value.trim(),
    phone: document.querySelector("#guestPhone").value.trim(),
    service: document.querySelector("#guestService").value,
    barber: document.querySelector("#guestBarber").value,
    date: document.querySelector("#guestDate").value,
    time: document.querySelector("#guestTime").value,
    note: document.querySelector("#guestNote").value.trim()
  };
  const text = bookingText(data);
  localStorage.setItem("ptbarbershop-last-booking", JSON.stringify({ ...data, createdAt: new Date().toISOString() }));
  bookingResult.innerHTML = `
    <span>Phiếu hẹn đã tạo</span>
    <strong>${data.name} - ${data.service}</strong>
    <p>${formatDate(data.date)} lúc ${data.time}. Thợ: ${data.barber}. SĐT: ${data.phone}.</p>
    <button type="button" id="copyBooking">Sao chép phiếu hẹn</button>
  `;
  document.querySelector("#copyBooking").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      document.querySelector("#copyBooking").textContent = "Đã sao chép";
    } catch {
      window.prompt("Sao chép phiếu hẹn:", text);
    }
  });
});

const savedBooking = localStorage.getItem("ptbarbershop-last-booking");
if (savedBooking) {
  try {
    const data = JSON.parse(savedBooking);
    bookingResult.innerHTML = `
      <span>Lịch hẹn gần nhất</span>
      <strong>${data.name || "Khách"} - ${data.service || "Dịch vụ"}</strong>
      <p>${formatDate(data.date)} lúc ${data.time || "-"}. Thợ: ${data.barber || "PT Team"}.</p>
    `;
  } catch {
    localStorage.removeItem("ptbarbershop-last-booking");
  }
}
