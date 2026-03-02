let tableConfig = {};
let currentTable = "tblXeMienPhi";
let currentOwner = null;
let vehicles = [];
let selectedIds = new Set();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Theme ----

(function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

function setupThemeToggle() {
  $("#themeToggle").addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
  });
}

function removeTones(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

// ---- Init ----

async function init() {
  tableConfig = await window.api.getTableConfig();

  const conn = await window.api.testConnection();
  const status = $("#connStatus");
  if (conn.success) {
    status.textContent = "Đã kết nối";
    status.className = "connection-status connected";
  } else {
    status.textContent = "Lỗi kết nối";
    status.className = "connection-status error";
    showToast("Không thể kết nối SQL Server: " + conn.message, "error");
    return;
  }

  setupThemeToggle();
  setupTabs();
  setupSearch();
  setupActions();
  loadOwners();
}

// ---- Tabs ----

function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTable = tab.dataset.table;
      currentOwner = null;
      selectedIds.clear();
      clearTable();
      loadOwners();
    });
  });
}

// ---- Owner search ----

function setupSearch() {
  $("#ownerSearch").addEventListener("input", (e) => {
    const raw = e.target.value.toLowerCase();
    const query = removeTones(raw);
    $$("#ownerList li").forEach((li) => {
      if (!li.dataset.owner) return;
      const ownerLower = li.dataset.owner.toLowerCase();
      const ownerNoTones = removeTones(ownerLower);
      const match = ownerLower.includes(raw) || ownerNoTones.includes(query);
      li.style.display = match ? "" : "none";
    });
  });
}

// ---- Load owners ----

function showOwnerSkeleton() {
  const list = $("#ownerList");
  list.innerHTML = "";
  const skeleton = document.createElement("div");
  skeleton.className = "sidebar-loading";
  for (let i = 0; i < 8; i++) {
    const el = document.createElement("div");
    el.className = "skeleton";
    skeleton.appendChild(el);
  }
  list.appendChild(skeleton);
}

async function loadOwners() {
  showOwnerSkeleton();
  $("#ownerSearch").value = "";

  try {
    const owners = await window.api.getOwners(currentTable);
    const list = $("#ownerList");
    list.innerHTML = "";

    if (owners.length === 0) {
      list.innerHTML =
        '<li style="color:var(--text-tertiary);cursor:default;justify-content:center">Không có dữ liệu</li>';
      return;
    }

    owners.forEach((owner) => {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.className = "owner-name";
      nameSpan.textContent = owner;
      li.appendChild(nameSpan);
      li.dataset.owner = owner;
      li.addEventListener("click", () => selectOwner(owner, li));
      list.appendChild(li);
    });
  } catch (err) {
    const list = $("#ownerList");
    list.innerHTML =
      '<li style="color:var(--danger);cursor:default">Lỗi: ' + err.message + "</li>";
  }
}

// ---- Select owner ----

async function selectOwner(owner, li) {
  currentOwner = owner;
  selectedIds.clear();

  $$("#ownerList li").forEach((l) => l.classList.remove("active"));
  li.classList.add("active");

  $("#contentTitle").textContent = owner;
  $("#emptyState").classList.add("hidden");
  $("#actionsBar").style.display = "flex";
  $("#btnSelectAll").style.display = "";

  renderUpdateGroup();
  await loadVehicles();
}

// ---- Render update controls based on table type ----

function renderUpdateGroup() {
  const cfg = tableConfig[currentTable];
  const now = new Date();

  const expiryGroup = $("#expiryGroup");
  expiryGroup.innerHTML = `
    <label>Tháng:</label>
    <select id="newMonth">
      ${Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        return `<option value="${m}" ${m === now.getMonth() + 1 ? "selected" : ""}>${m}</option>`;
      }).join("")}
    </select>
    <label>Năm:</label>
    <input type="number" id="newYear" value="${now.getFullYear()}" min="2020" max="2030" style="width:80px" />
  `;

  $("#newMonth").addEventListener("change", updateBtnState);
  $("#newYear").addEventListener("input", updateBtnState);

  const panelStatus = $("#panelStatus");
  if (cfg.statusCol) {
    panelStatus.style.display = "";
    const statusGroup = $("#statusGroup");
    statusGroup.innerHTML = `
      <select id="newStatus">
        ${Object.entries(TRANG_THAI_MAP)
          .map(([val, label]) => `<option value="${val}">${label}</option>`)
          .join("")}
      </select>
    `;
    $("#btnUpdateStatus").addEventListener("click", doUpdateStatus);
  } else {
    panelStatus.style.display = "none";
  }
}

// ---- Load vehicles ----

async function loadVehicles() {
  const tbody = $("#tableBody");
  const thead = $("#tableHead");
  tbody.innerHTML = "";

  try {
    vehicles = await window.api.getVehicles(currentTable, currentOwner);
    const cfg = tableConfig[currentTable];

    thead.innerHTML = `<tr>
      <th><input type="checkbox" id="checkAll" /></th>
      ${cfg.displayCols.map((col) => `<th>${formatColName(col)}</th>`).join("")}
    </tr>`;

    $("#checkAll").addEventListener("change", (e) => {
      const checked = e.target.checked;
      $$('#tableBody input[type="checkbox"]').forEach((cb) => {
        cb.checked = checked;
        toggleSelection(cb.dataset.id, checked);
        cb.closest("tr").classList.toggle("selected", checked);
      });
      updateSelectAllBtn();
    });

    if (vehicles.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="99" style="text-align:center;color:var(--text-tertiary);padding:40px">Không có dữ liệu</td></tr>';
      return;
    }

    vehicles.forEach((v) => {
      const idVal = v[cfg.idCol];
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td><input type="checkbox" data-id="${idVal}" /></td>
        ${cfg.displayCols.map((col) => `<td>${formatValue(col, v[col])}</td>`).join("")}
      `;

      const cb = tr.querySelector('input[type="checkbox"]');
      cb.addEventListener("change", () => {
        toggleSelection(String(idVal), cb.checked);
        tr.classList.toggle("selected", cb.checked);
      });

      tbody.appendChild(tr);
    });

    updateSelectAllBtn();
    updateBtnState();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="99" style="color:var(--danger);padding:20px">Lỗi: ${err.message}</td></tr>`;
  }
}

function toggleSelection(id, checked) {
  if (checked) selectedIds.add(String(id));
  else selectedIds.delete(String(id));
  updateBtnState();
}

function updateBtnState() {
  const btn = $("#btnUpdate");
  const monthEl = $("#newMonth");
  const yearEl = $("#newYear");
  let label = "Cập nhật";
  if (monthEl && yearEl) {
    label += ` T${monthEl.value}/${yearEl.value}`;
  }
  if (selectedIds.size > 0) {
    label += ` (${selectedIds.size})`;
  }
  btn.disabled = selectedIds.size === 0;
  btn.textContent = label;
}

function updateSelectAllBtn() {
  const btn = $("#btnSelectAll");
  btn.textContent = selectedIds.size === vehicles.length && vehicles.length > 0
    ? "Bỏ chọn tất cả"
    : "Chọn tất cả";
}

// ---- Actions ----

function setupActions() {
  $("#btnUpdate").addEventListener("click", doUpdate);
  $("#btnSelectAll").addEventListener("click", () => {
    const allSelected = selectedIds.size === vehicles.length && vehicles.length > 0;

    $$('#tableBody input[type="checkbox"]').forEach((cb) => {
      cb.checked = !allSelected;
      toggleSelection(cb.dataset.id, !allSelected);
      cb.closest("tr").classList.toggle("selected", !allSelected);
    });

    const checkAll = $("#checkAll");
    if (checkAll) checkAll.checked = !allSelected;

    updateSelectAllBtn();
  });
}

async function doUpdate() {
  if (selectedIds.size === 0) return;

  const month = parseInt($("#newMonth").value, 10);
  const year = parseInt($("#newYear").value, 10);

  if (!month || !year) {
    showToast("Vui lòng chọn tháng và năm", "error");
    return;
  }

  const endOfMonth = new Date(year, month, 0);
  const newValue = endOfMonth.toISOString().split("T")[0];

  const ids = Array.from(selectedIds);
  const btn = $("#btnUpdate");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>Đang cập nhật...';

  try {
    const result = await window.api.updateExpiry(currentTable, ids, newValue);
    showToast(`Đã cập nhật ${result.affected} bản ghi thành công!`, "success");
    selectedIds.clear();
    await loadVehicles();
  } catch (err) {
    showToast("Lỗi cập nhật: " + err.message, "error");
  } finally {
    updateBtnState();
  }
}

async function doUpdateStatus() {
  if (selectedIds.size === 0) {
    showToast("Vui lòng chọn ít nhất một xe", "error");
    return;
  }

  const newStatus = parseInt($("#newStatus").value, 10);
  const ids = Array.from(selectedIds);
  const btn = $("#btnUpdateStatus");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>Đang cập nhật...';

  try {
    const result = await window.api.updateStatus(currentTable, ids, newStatus);
    showToast(`Đã cập nhật trạng thái ${result.affected} xe thành công!`, "success");
    selectedIds.clear();
    await loadVehicles();
  } catch (err) {
    showToast("Lỗi cập nhật trạng thái: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Cập nhật TT";
  }
}

// ---- Helpers ----

function formatColName(col) {
  const map = {
    bienSo: "Biển số",
    bienSoXe: "Biển số",
    trangThai: "Trạng thái",
    ngayHieuLuc: "Ngày hiệu lực",
    ngayHetHan: "Ngày hết hạn",
    ghiChu: "Ghi chú",
    maKhachHang: "Mã KH",
    thang: "Tháng",
    nam: "Năm",
    loaiVe: "Loại vé",
    phanLoaiVe: "Phân loại",
    phi: "Phí",
    ngayBan: "Ngày bán",
    soHoadon: "Số HĐ",
    LoaiXe: "Loại xe",
    id: "ID",
    kyHieuThue: "Ký hiệu thuế",
    maNhanVien: "Mã NV",
  };
  return map[col] || col;
}

const TRANG_THAI_MAP = {
  1: "Miễn phí nhập chợ",
  2: "Miễn phí lưu đậu",
  3: "MP nhập chợ & lưu đậu",
};

function formatValue(col, val) {
  if (val === null || val === undefined) return "";
  if (col === "ngayHieuLuc" || col === "ngayHetHan" || col === "ngayBan") {
    return formatDate(val);
  }
  if (col === "phi") {
    return Number(val).toLocaleString("vi-VN") + " đ";
  }
  if (col === "trangThai") {
    return TRANG_THAI_MAP[val] || val;
  }
  return String(val);
}

function formatDate(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function clearTable() {
  $("#tableHead").innerHTML = "";
  $("#tableBody").innerHTML = "";
  $("#emptyState").classList.remove("hidden");
  $("#actionsBar").style.display = "none";
  $("#btnSelectAll").style.display = "none";
  $("#contentTitle").textContent = "Chọn chủ xe để xem danh sách";
}

function showToast(msg, type = "success") {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// ---- Auto Update ----

function setupAutoUpdate() {
  const banner = $("#updateBanner");
  const text = $("#updateText");
  const progressBar = $("#updateProgressBar");
  const progressFill = $("#updateProgressFill");
  const btnDownload = $("#btnDownloadUpdate");
  const btnInstall = $("#btnInstallUpdate");
  const btnClose = $("#btnCloseBanner");

  window.api.onUpdateAvailable((version) => {
    banner.style.display = "flex";
    text.textContent = `Phiên bản mới ${version} đã sẵn sàng!`;
    btnDownload.style.display = "";
    btnInstall.style.display = "none";
    progressBar.style.display = "none";
  });

  window.api.onUpdateNotAvailable(() => {
    // App is up to date, no banner needed
  });

  window.api.onUpdateDownloadProgress((percent) => {
    text.textContent = `Đang tải bản cập nhật... ${percent}%`;
    progressBar.style.display = "";
    progressFill.style.width = percent + "%";
    btnDownload.style.display = "none";
  });

  window.api.onUpdateDownloaded(() => {
    text.textContent = "Bản cập nhật đã tải xong!";
    progressBar.style.display = "none";
    btnDownload.style.display = "none";
    btnInstall.style.display = "";
  });

  window.api.onUpdateError((msg) => {
    console.error("Update error:", msg);
    banner.style.display = "none";
  });

  btnDownload.addEventListener("click", () => {
    window.api.downloadUpdate();
    btnDownload.style.display = "none";
    text.textContent = "Đang bắt đầu tải...";
    progressBar.style.display = "";
  });

  btnInstall.addEventListener("click", () => {
    window.api.installUpdate();
  });

  btnClose.addEventListener("click", () => {
    banner.style.display = "none";
  });
}

// ---- Start ----

init();
setupAutoUpdate();
