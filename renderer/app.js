let tableConfig = {};
let currentTable = "tblXeMienPhi";
let currentOwner = null;
let currentSidebarMode = "chuxe"; // "chuxe" | "soxe"
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

  const version = await window.api.getAppVersion();
  $("#appVersion").textContent = `v${version}`;

  setupThemeToggle();
  setupTabs();
  setupSidebarTabs();
  setupSearch();
  setupVehicleSearch();
  setupActions();
  setupModal();
  setupAddButtons();
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
      currentSidebarMode = "chuxe";
      selectedIds.clear();
      clearTable();
      $("#sidebarContentChuxe").style.display = "flex";
      $("#sidebarContentSoxe").style.display = "none";
      $$(".sidebar-tab").forEach((t) => t.classList.remove("active"));
      $('.sidebar-tab[data-mode="chuxe"]').classList.add("active");
      $("#vehicleSearchSidebar").value = "";
      loadOwners();
    });
  });
}

// ---- Sidebar tabs (Chủ xe / Số xe) ----

function setupSidebarTabs() {
  $$(".sidebar-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      if (mode === currentSidebarMode) return;
      currentSidebarMode = mode;
      $$(".sidebar-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      if (mode === "chuxe") {
        $("#sidebarContentChuxe").style.display = "flex";
        $("#sidebarContentSoxe").style.display = "none";
        $("#vehicleSearchSidebar").value = "";
        currentOwner = null;
        selectedIds.clear();
        clearTable();
        loadOwners();
      } else {
        $("#sidebarContentChuxe").style.display = "none";
        $("#sidebarContentSoxe").style.display = "flex";
        currentOwner = null;
        selectedIds.clear();
        clearTable();
        const q = $("#vehicleSearchSidebar").value.trim();
        if (q) onVehicleSearchChange(q);
      }
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

// ---- Vehicle search (full table) ----

let vehicleSearchDebounce = null;

function setupVehicleSearch() {
  const handleSearch = (e) => {
    const query = e.target.value.trim();
    clearTimeout(vehicleSearchDebounce);
    vehicleSearchDebounce = setTimeout(() => {
      onVehicleSearchChange(query);
    }, 300);
  };
  $("#vehicleSearch")?.addEventListener("input", handleSearch);
  $("#vehicleSearchSidebar")?.addEventListener("input", handleSearch);
}

async function onVehicleSearchChange(query) {
  if (query) {
    await loadVehiclesBySearch(query);
  } else {
    if (currentOwner) {
      await loadVehicles();
    } else {
      clearTable();
    }
  }
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
      $("#vehicleSearch").value = "";
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
    $("#vehicleSearch").value = "";
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
  $("#vehicleSearch").style.display = "";
  $("#vehicleSearch").value = "";

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

async function loadVehiclesBySearch(query) {
  const tbody = $("#tableBody");
  const thead = $("#tableHead");
  tbody.innerHTML = "";
  const cfg = tableConfig[currentTable];
  const displayCols = cfg.displayCols.includes(cfg.ownerCol)
    ? cfg.displayCols
    : [cfg.ownerCol, ...cfg.displayCols];

  try {
    vehicles = await window.api.searchVehicles(currentTable, query);
    $("#emptyState").classList.add("hidden");
    $("#actionsBar").style.display = "flex";
    $("#btnSelectAll").style.display = "";
    $("#vehicleSearch").style.display = currentSidebarMode === "chuxe" && currentOwner ? "" : "none";
    renderUpdateGroup();

    thead.innerHTML = `<tr>
      <th><input type="checkbox" id="checkAll" /></th>
      ${displayCols.map((col) => `<th>${formatColName(col)}</th>`).join("")}
      <th class="actions-th">Sửa/Xóa</th>
    </tr>`;

    $("#checkAll").addEventListener("change", (e) => {
      const checked = e.target.checked;
      $$('#tableBody input[type="checkbox"]').forEach((cb) => {
        const tr = cb.closest("tr");
        if (!tr?.dataset.id || tr.style.display === "none") return;
        cb.checked = checked;
        toggleSelection(cb.dataset.id, checked);
        tr.classList.toggle("selected", checked);
      });
      updateSelectAllBtn();
    });

    if (vehicles.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="99" style="text-align:center;color:var(--text-tertiary);padding:40px">Không tìm thấy xe nào</td></tr>';
      $("#contentTitle").textContent = `Tìm số xe: "${query}"`;
      return;
    }

    $("#contentTitle").textContent = `Tìm số xe: "${query}" (${vehicles.length} kết quả)`;
    renderVehicleRows(tbody, vehicles, cfg, displayCols);
    updateSelectAllBtn();
    updateBtnState();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="99" style="color:var(--danger);padding:20px">Lỗi: ${err.message}</td></tr>`;
  }
}

function renderVehicleRows(tbody, data, cfg, displayCols) {
  data.forEach((v) => {
    const idVal = v[cfg.idCol];
    const tr = document.createElement("tr");
    tr.dataset.searchValue = String(idVal || "");
    tr.dataset.id = String(idVal);

    tr.innerHTML = `
      <td><input type="checkbox" data-id="${idVal}" /></td>
      ${displayCols.map((col) => `<td>${formatValue(col, v[col])}</td>`).join("")}
      <td class="actions-cell">
        <button class="row-action edit" title="Sửa" data-action="edit" data-id="${escapeAttr(idVal)}">✎</button>
        <button class="row-action delete" title="Xóa" data-action="delete" data-id="${escapeAttr(idVal)}">🗑</button>
      </td>
    `;

    const cb = tr.querySelector('input[type="checkbox"]');
    cb.addEventListener("change", () => {
      toggleSelection(String(idVal), cb.checked);
      tr.classList.toggle("selected", cb.checked);
    });

    tr.querySelector('button[data-action="edit"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openEditVehicleModal(v);
    });
    tr.querySelector('button[data-action="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDeleteVehicle(v);
    });

    tbody.appendChild(tr);
  });
}

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
      <th class="actions-th">Sửa/Xóa</th>
    </tr>`;

    $("#checkAll").addEventListener("change", (e) => {
      const checked = e.target.checked;
      const visibleIds = getVisibleVehicleIds();
      $$('#tableBody input[type="checkbox"]').forEach((cb) => {
        const tr = cb.closest("tr");
        if (!tr?.dataset.id || tr.style.display === "none") return;
        cb.checked = checked;
        toggleSelection(cb.dataset.id, checked);
        tr.classList.toggle("selected", checked);
      });
      updateSelectAllBtn();
    });

    if (vehicles.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="99" style="text-align:center;color:var(--text-tertiary);padding:40px">Không có dữ liệu</td></tr>';
      return;
    }

    renderVehicleRows(tbody, vehicles, cfg, cfg.displayCols);

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
  updateSelectAllBtn();
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

function getVisibleVehicleIds() {
  return [...$$("#tableBody tr")]
    .filter((tr) => tr.dataset.id && tr.style.display !== "none")
    .map((tr) => tr.dataset.id);
}

function updateSelectAllBtn() {
  const btn = $("#btnSelectAll");
  const checkAll = $("#checkAll");
  const visibleIds = getVisibleVehicleIds();
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  btn.textContent = allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả";
  if (checkAll) checkAll.checked = allVisibleSelected;
}

// ---- Actions ----

function setupActions() {
  $("#btnUpdate").addEventListener("click", doUpdate);
  $("#btnSelectAll").addEventListener("click", () => {
    const visibleIds = getVisibleVehicleIds();
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

    $$('#tableBody input[type="checkbox"]').forEach((cb) => {
      const tr = cb.closest("tr");
      if (!tr?.dataset.id || tr.style.display === "none") return;
      const newChecked = !allVisibleSelected;
      cb.checked = newChecked;
      toggleSelection(cb.dataset.id, newChecked);
      tr.classList.toggle("selected", newChecked);
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
  const y = endOfMonth.getFullYear();
  const m = String(endOfMonth.getMonth() + 1).padStart(2, "0");
  const d = String(endOfMonth.getDate()).padStart(2, "0");
  const newValue = `${y}-${m}-${d}`;

  const ids = Array.from(selectedIds);
  const btn = $("#btnUpdate");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span>Đang cập nhật...';

  try {
    const result = await window.api.updateExpiry(currentTable, ids, newValue);
    showToast(`Đã cập nhật ${result.affected} bản ghi thành công!`, "success");
    selectedIds.clear();
    const q = (currentSidebarMode === "soxe" ? $("#vehicleSearchSidebar") : $("#vehicleSearch"))?.value?.trim();
    if (q) await loadVehiclesBySearch(q);
    else await loadVehicles();
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
    const q = (currentSidebarMode === "soxe" ? $("#vehicleSearchSidebar") : $("#vehicleSearch"))?.value?.trim();
    if (q) await loadVehiclesBySearch(q);
    else await loadVehicles();
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
    ghiChu: "Chủ xe",
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
  const vehicleSearch = $("#vehicleSearch");
  if (vehicleSearch) {
    vehicleSearch.style.display = "none";
    vehicleSearch.value = "";
  }
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

// ---- Modal ----

let modalSubmitHandler = null;

function setupModal() {
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalCancel").addEventListener("click", closeModal);
  $("#modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modalOverlay").classList.contains("hidden")) {
      closeModal();
    }
  });
  $("#modalSubmit").addEventListener("click", () => {
    if (modalSubmitHandler) modalSubmitHandler();
  });
}

function openModal(title, bodyHTML, onSubmit, submitLabel = "Lưu", opts = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;
  $("#modalSubmit").textContent = submitLabel;
  $("#modalSubmit").disabled = false;
  $("#modalSubmit").style.display = opts.hideSubmit ? "none" : "";
  $("#modal").classList.toggle("modal-wide", !!opts.wide);
  modalSubmitHandler = onSubmit;
  $("#modalOverlay").classList.remove("hidden");
  const firstInput = $("#modalBody input, #modalBody select, #modalBody textarea");
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeModal() {
  $("#modalOverlay").classList.add("hidden");
  $("#modalBody").innerHTML = "";
  $("#modal").classList.remove("modal-wide");
  $("#modalSubmit").style.display = "";
  modalSubmitHandler = null;
}

function setSubmitLoading(loading, label = "Lưu") {
  const btn = $("#modalSubmit");
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="loading"></span>Đang lưu...' : label;
}

// ---- Add Customer / Add Vehicle ----

function setupAddButtons() {
  $("#btnAddCustomer")?.addEventListener("click", openAddCustomerModal);
  $("#btnAddVehicle")?.addEventListener("click", () => openAddVehicleModal());
  $("#btnManageCustomers")?.addEventListener("click", openManageCustomersModal);
}

// ---- Manage / Edit / Delete Customer ----

let manageSearchDebounce = null;

async function openManageCustomersModal() {
  const body = `
    <div class="form-group" style="margin-bottom:12px">
      <input type="text" id="kh_listSearch" class="combo-search-input" placeholder="Tìm theo mã, họ, tên, cửa hàng, CMND, địa chỉ..." autocomplete="off" />
    </div>
    <div id="kh_listBox" style="max-height:60vh;overflow-y:auto"></div>
  `;
  openModal("Quản lý khách hàng", body, null, "", { wide: true, hideSubmit: true });
  await renderCustomerList("");

  $("#kh_listSearch").addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(manageSearchDebounce);
    manageSearchDebounce = setTimeout(() => renderCustomerList(q), 250);
  });
}

async function renderCustomerList(q) {
  const box = $("#kh_listBox");
  box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">Đang tải...</div>';
  try {
    const list = await window.api.listCustomers(q);
    if (!list.length) {
      box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-tertiary)">Không tìm thấy KH</div>';
      return;
    }
    const rows = list
      .map((c) => {
        const name = [c.ho, c.ten].filter(Boolean).join(" ") || "(chưa có tên)";
        return `
        <tr data-id="${escapeAttr(c.maKhachHang)}">
          <td>${escapeHTML(c.maKhachHang)}</td>
          <td>${escapeHTML(name)}</td>
          <td>${escapeHTML(c.tenCuaHang || "")}</td>
          <td>${escapeHTML(c.diaChi || "")}</td>
          <td class="actions-cell">
            <button class="row-action edit" data-action="kh-edit" title="Sửa">✎</button>
            <button class="row-action delete" data-action="kh-delete" title="Xóa">🗑</button>
          </td>
        </tr>`;
      })
      .join("");
    box.innerHTML = `
      <table class="kh-list-table">
        <thead><tr><th>Mã</th><th>Họ tên</th><th>Cửa hàng</th><th>Địa chỉ</th><th>Sửa/Xóa</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    box.querySelectorAll('button[data-action="kh-edit"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const c = list.find((x) => String(x.maKhachHang) === String(id));
        if (c) openEditCustomerModal(c);
      });
    });
    box.querySelectorAll('button[data-action="kh-delete"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const c = list.find((x) => String(x.maKhachHang) === String(id));
        if (c) confirmDeleteCustomer(c, q);
      });
    });
  } catch (err) {
    box.innerHTML = `<div style="padding:20px;color:var(--danger)">Lỗi: ${escapeHTML(err.message)}</div>`;
  }
}

function openEditCustomerModal(c) {
  const body = `
    <div class="form-group">
      <label>Mã khách hàng</label>
      <input type="text" id="kh_maKhachHang" readonly value="${escapeAttr(c.maKhachHang)}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Họ <span class="required">*</span></label>
        <input type="text" id="kh_ho" value="${escapeAttr(c.ho || "")}" />
      </div>
      <div class="form-group">
        <label>Tên <span class="required">*</span></label>
        <input type="text" id="kh_ten" value="${escapeAttr(c.ten || "")}" />
      </div>
    </div>
    <div class="form-group">
      <label>Tên cửa hàng / ô vựa <span class="required">*</span></label>
      <input type="text" id="kh_tenCuaHang" value="${escapeAttr(c.tenCuaHang || "")}" />
    </div>
    <div class="form-group">
      <label>CMND / CCCD</label>
      <input type="text" id="kh_cmnd" value="${escapeAttr(c.cmnd || "")}" />
    </div>
    <div class="form-group">
      <label>Địa chỉ</label>
      <input type="text" id="kh_diaChi" value="${escapeAttr(c.diaChi || "")}" />
    </div>
    <div class="form-group">
      <label>Ghi chú</label>
      <textarea id="kh_ghiChu">${escapeHTML(c.ghiChu || "")}</textarea>
    </div>
  `;
  openModal(`Sửa KH #${c.maKhachHang}`, body, async () => {
    const data = {
      maKhachHang: c.maKhachHang,
      ho: $("#kh_ho").value,
      ten: $("#kh_ten").value,
      tenCuaHang: $("#kh_tenCuaHang").value,
      cmnd: $("#kh_cmnd").value,
      diaChi: $("#kh_diaChi").value,
      ghiChu: $("#kh_ghiChu").value,
    };
    if (!data.ho.trim()) return showToast("Vui lòng nhập Họ", "error");
    if (!data.ten.trim()) return showToast("Vui lòng nhập Tên", "error");
    if (!data.tenCuaHang.trim()) return showToast("Vui lòng nhập Tên cửa hàng", "error");

    setSubmitLoading(true);
    try {
      const r = await window.api.updateCustomer(data);
      if (r.success) {
        showToast(`Đã cập nhật KH #${c.maKhachHang}`, "success");
        closeModal();
      } else {
        showToast("Lỗi: " + r.message, "error");
        setSubmitLoading(false);
      }
    } catch (err) {
      showToast("Lỗi: " + err.message, "error");
      setSubmitLoading(false);
    }
  });
}

async function confirmDeleteCustomer(c, refreshQuery) {
  const name = [c.ho, c.ten].filter(Boolean).join(" ") || c.tenCuaHang || `#${c.maKhachHang}`;
  if (!confirm(`Xóa khách hàng #${c.maKhachHang} — ${name}?\n\nNếu KH còn xe, xóa sẽ bị từ chối.`)) return;
  try {
    const r = await window.api.deleteCustomer(c.maKhachHang);
    if (r.success) {
      showToast(`Đã xóa KH #${c.maKhachHang}`, "success");
      await renderCustomerList(refreshQuery || "");
    } else {
      showToast("Lỗi: " + r.message, "error");
    }
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  }
}

async function openAddCustomerModal() {
  const body = `
    <div class="form-group">
      <label>Mã khách hàng (tự sinh)</label>
      <input type="text" id="kh_maKhachHang" readonly value="Đang tải..." />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Họ <span class="required">*</span></label>
        <input type="text" id="kh_ho" placeholder="VD: Nguyễn" />
      </div>
      <div class="form-group">
        <label>Tên <span class="required">*</span></label>
        <input type="text" id="kh_ten" placeholder="VD: Văn A" />
      </div>
    </div>
    <div class="form-group">
      <label>Tên cửa hàng / ô vựa <span class="required">*</span></label>
      <input type="text" id="kh_tenCuaHang" placeholder="VD: Cty TNHH ABC" />
    </div>
    <div class="form-group">
      <label>CMND / CCCD</label>
      <input type="text" id="kh_cmnd" placeholder="VD: 079123456789" />
    </div>
    <div class="form-group">
      <label>Địa chỉ</label>
      <input type="text" id="kh_diaChi" placeholder="VD: 141 QL1A, P.Tam Bình, TP.Thủ Đức" />
    </div>
    <div class="form-group">
      <label>Ghi chú</label>
      <textarea id="kh_ghiChu" placeholder="Số điện thoại, ghi chú khác..."></textarea>
    </div>
  `;
  openModal("Thêm khách hàng mới", body, async () => {
    const data = {
      ho: $("#kh_ho").value,
      ten: $("#kh_ten").value,
      cmnd: $("#kh_cmnd").value,
      tenCuaHang: $("#kh_tenCuaHang").value,
      diaChi: $("#kh_diaChi").value,
      ghiChu: $("#kh_ghiChu").value,
    };
    if (!data.ho.trim()) {
      showToast("Vui lòng nhập Họ", "error");
      return;
    }
    if (!data.ten.trim()) {
      showToast("Vui lòng nhập Tên", "error");
      return;
    }
    if (!data.tenCuaHang.trim()) {
      showToast("Vui lòng nhập Tên cửa hàng / ô vựa", "error");
      return;
    }
    setSubmitLoading(true);
    try {
      const result = await window.api.insertCustomer(data);
      if (result.success) {
        showToast(`Đã thêm khách hàng #${result.maKhachHang}`, "success");
        closeModal();
      } else {
        showToast("Lỗi: " + result.message, "error");
        setSubmitLoading(false);
      }
    } catch (err) {
      showToast("Lỗi: " + err.message, "error");
      setSubmitLoading(false);
    }
  });

  try {
    const { nextId } = await window.api.getNextCustomerId();
    $("#kh_maKhachHang").value = nextId != null ? String(nextId) : "(không xác định)";
  } catch {
    $("#kh_maKhachHang").value = "(không xác định)";
  }
}

function endOfMonthISO(date = new Date()) {
  const eom = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const y = eom.getFullYear();
  const m = String(eom.getMonth() + 1).padStart(2, "0");
  const d = String(eom.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfMonthISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

let selectedCustomer = null;
let customerSearchDebounce = null;

function openAddVehicleModal() {
  selectedCustomer = null;
  const defaultExpiry = endOfMonthISO();
  const statusOptions = Object.entries(TRANG_THAI_MAP)
    .map(([val, label]) => `<option value="${val}" ${val === "1" ? "selected" : ""}>${label}</option>`)
    .join("");

  const body = `
    <div class="form-group">
      <label>Khách hàng <span class="required">*</span></label>
      <div class="combo-search">
        <input type="text" id="xe_khSearch" class="combo-search-input" placeholder="Gõ tên, mã KH hoặc cửa hàng..." autocomplete="off" />
        <div class="combo-search-results hidden" id="xe_khResults"></div>
      </div>
      <div id="xe_khSelected"></div>
    </div>
    <div class="form-group">
      <label>Biển số xe — mỗi dòng 1 biển <span class="required">*</span></label>
      <textarea id="xe_bienSo" rows="5" placeholder="VD:&#10;51A12345&#10;51B98765&#10;51C11223" autocomplete="off" style="font-family:monospace;text-transform:uppercase"></textarea>
      <div id="xe_bienSoCount" style="font-size:12px;color:var(--text-tertiary);margin-top:4px"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ngày hiệu lực</label>
        <input type="text" id="xe_ngayHieuLuc" autocomplete="off" />
      </div>
      <div class="form-group">
        <label>Ngày hết hạn <span class="required">*</span></label>
        <input type="text" id="xe_ngayHetHan" autocomplete="off" />
      </div>
    </div>
    <div class="form-group">
      <label>Trạng thái <span class="required">*</span></label>
      <select id="xe_trangThai">${statusOptions}</select>
    </div>
    <div class="form-group">
      <label>Chủ xe / ghi chú (hiển thị ở sidebar) <span class="required">*</span></label>
      <input type="text" id="xe_ghiChu" placeholder="Tự fill từ tên cửa hàng khi chọn KH, có thể sửa" />
    </div>
  `;

  openModal("Thêm xe mới", body, async () => {
    if (!selectedCustomer) {
      showToast("Vui lòng chọn khách hàng", "error");
      return;
    }
    const plates = parsePlates($("#xe_bienSo").value);
    if (plates.length === 0) {
      showToast("Vui lòng nhập ít nhất 1 biển số", "error");
      return;
    }
    const rawHetHan = $("#xe_ngayHetHan").value;
    const ngayHetHan = ddmmyyyyToISO(rawHetHan);
    if (!ngayHetHan) {
      showToast(`[DEBUG] Ngày hết hạn raw="${rawHetHan}" len=${rawHetHan.length}`, "error");
      console.log("[DEBUG ngayHetHan]", JSON.stringify(rawHetHan), "len=", rawHetHan.length, "charCodes=", [...rawHetHan].map(c => c.charCodeAt(0)));
      return;
    }
    const ngayHieuLucRaw = $("#xe_ngayHieuLuc").value.trim();
    const ngayHieuLuc = ngayHieuLucRaw ? ddmmyyyyToISO(ngayHieuLucRaw) : null;
    if (ngayHieuLucRaw && !ngayHieuLuc) {
      showToast(`[DEBUG] Ngày hiệu lực raw="${ngayHieuLucRaw}"`, "error");
      return;
    }
    const ghiChuVal = $("#xe_ghiChu").value.trim();
    if (!ghiChuVal) {
      showToast("Vui lòng nhập 'Chủ xe / ghi chú' (cột group ở sidebar)", "error");
      return;
    }

    setSubmitLoading(true);
    const shared = {
      tableName: currentTable,
      maKhachHang: selectedCustomer.maKhachHang,
      ngayHieuLuc,
      ngayHetHan,
      ghiChu: ghiChuVal,
      trangThai: parseInt($("#xe_trangThai").value, 10),
    };

    const ok = [];
    const fail = [];
    for (const bienSo of plates) {
      try {
        const r = await window.api.insertVehicle({ ...shared, bienSo });
        if (r.success) ok.push(bienSo);
        else fail.push({ bienSo, msg: r.message });
      } catch (err) {
        fail.push({ bienSo, msg: err.message });
      }
    }

    if (fail.length === 0) {
      showToast(`Đã thêm ${ok.length} xe thành công`, "success");
      closeModal();
      await loadOwners();
    } else if (ok.length === 0) {
      showToast(`Lỗi: ${fail.map(f => f.bienSo + ' (' + f.msg + ')').join('; ')}`, "error");
      setSubmitLoading(false);
    } else {
      showToast(`Thêm ${ok.length}/${plates.length} xe. Lỗi: ${fail.map(f => f.bienSo).join(', ')}`, "error");
      // remove successful plates from textarea so user thấy chỉ cái fail còn lại
      $("#xe_bienSo").value = fail.map(f => f.bienSo).join("\n");
      updatePlateCount();
      setSubmitLoading(false);
      await loadOwners();
    }
  });

  $("#xe_bienSo").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
    updatePlateCount();
  });

  $("#xe_ngayHetHan").value = isoToDDMMYYYY(defaultExpiry);
  $("#xe_ngayHieuLuc").value = isoToDDMMYYYY(startOfMonthISO());
  attachDateMask($("#xe_ngayHetHan"));
  attachDateMask($("#xe_ngayHieuLuc"));

  setupCustomerCombo();
  updatePlateCount();
}

function parsePlates(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(/\r?\n|,|;/)
        .map((s) => s.trim().toUpperCase().replace(/\s+/g, ""))
        .filter(Boolean)
    ),
  ];
}

function updatePlateCount() {
  const el = $("#xe_bienSoCount");
  const textarea = $("#xe_bienSo");
  if (!el || !textarea) return;
  const plates = parsePlates(textarea.value);
  el.textContent = plates.length ? `${plates.length} biển số sẽ được thêm` : "";
}

function setupCustomerCombo() {
  const input = $("#xe_khSearch");
  const results = $("#xe_khResults");

  const renderResults = (list) => {
    if (!list.length) {
      results.innerHTML = '<div class="combo-search-empty">Không tìm thấy khách hàng</div>';
    } else {
      results.innerHTML = list
        .map((c) => {
          const name = [c.ho, c.ten].filter(Boolean).join(" ") || "(chưa có tên)";
          const store = c.tenCuaHang ? ` — ${c.tenCuaHang}` : "";
          return `<div class="combo-search-item" data-id="${c.maKhachHang}" data-name="${escapeAttr(name)}" data-store="${escapeAttr(c.tenCuaHang || "")}"><span class="item-id">#${c.maKhachHang}</span>${escapeHTML(name)}${escapeHTML(store)}</div>`;
        })
        .join("");
      results.querySelectorAll(".combo-search-item").forEach((el) => {
        el.addEventListener("click", () => {
          selectedCustomer = {
            maKhachHang: el.dataset.id,
            name: el.dataset.name,
            store: el.dataset.store,
          };
          renderSelectedCustomer();
          const ghiChuInput = $("#xe_ghiChu");
          if (ghiChuInput) {
            ghiChuInput.value = selectedCustomer.store || selectedCustomer.name || "";
          }
          results.classList.add("hidden");
          input.value = "";
        });
      });
    }
    results.classList.remove("hidden");
  };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(customerSearchDebounce);
    if (!q) {
      results.classList.add("hidden");
      return;
    }
    customerSearchDebounce = setTimeout(async () => {
      try {
        const list = await window.api.searchCustomers(q);
        renderResults(list);
      } catch (err) {
        results.innerHTML = `<div class="combo-search-empty">Lỗi: ${escapeHTML(err.message)}</div>`;
        results.classList.remove("hidden");
      }
    }, 300);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) results.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".combo-search")) results.classList.add("hidden");
  });
}

function renderSelectedCustomer() {
  const wrap = $("#xe_khSelected");
  if (!selectedCustomer) {
    wrap.innerHTML = "";
    return;
  }
  const label = selectedCustomer.name + (selectedCustomer.store ? ` — ${selectedCustomer.store}` : "");
  wrap.innerHTML = `<span class="selected-chip">KH #${selectedCustomer.maKhachHang}: ${escapeHTML(label)}<button type="button" id="xe_khClear" aria-label="Bỏ chọn">&times;</button></span>`;
  $("#xe_khClear").addEventListener("click", () => {
    selectedCustomer = null;
    renderSelectedCustomer();
  });
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function isoDateOnly(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ddmmyyyyToISO(str) {
  const m = String(str || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isoToDDMMYYYY(val) {
  const iso = isoDateOnly(val);
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function attachDateMask(inputEl) {
  if (!inputEl) return;
  inputEl.setAttribute("inputmode", "numeric");
  inputEl.setAttribute("maxlength", "10");
  inputEl.setAttribute("placeholder", "dd/mm/yyyy");
  inputEl.addEventListener("input", (e) => {
    let v = e.target.value.replace(/\D/g, "").slice(0, 8);
    if (v.length >= 5) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
    else if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    e.target.value = v;
  });
}

// ---- Edit / Delete Vehicle ----

function openEditVehicleModal(v) {
  selectedCustomer = null;
  const cfg = tableConfig[currentTable];
  const idVal = v[cfg.idCol];

  const statusOptions = Object.entries(TRANG_THAI_MAP)
    .map(([val, label]) => {
      const selected = String(v.trangThai) === String(val) ? "selected" : "";
      return `<option value="${val}" ${selected}>${label}</option>`;
    })
    .join("");

  const body = `
    <div class="form-group">
      <label>Biển số xe</label>
      <input type="text" id="xe_bienSo" value="${escapeAttr(idVal)}" readonly />
    </div>
    <div class="form-group">
      <label>Khách hàng <span class="required">*</span></label>
      <div class="combo-search">
        <input type="text" id="xe_khSearch" class="combo-search-input" placeholder="Gõ để đổi KH..." autocomplete="off" />
        <div class="combo-search-results hidden" id="xe_khResults"></div>
      </div>
      <div id="xe_khSelected"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ngày hiệu lực <span class="required">*</span></label>
        <input type="text" id="xe_ngayHieuLuc" autocomplete="off" />
      </div>
      <div class="form-group">
        <label>Ngày hết hạn <span class="required">*</span></label>
        <input type="text" id="xe_ngayHetHan" autocomplete="off" />
      </div>
    </div>
    <div class="form-group">
      <label>Trạng thái <span class="required">*</span></label>
      <select id="xe_trangThai">${statusOptions}</select>
    </div>
    <div class="form-group">
      <label>Chủ xe / ghi chú (hiển thị ở sidebar) <span class="required">*</span></label>
      <input type="text" id="xe_ghiChu" value="${escapeAttr(v.ghiChu || "")}" />
    </div>
  `;

  openModal(`Sửa xe ${idVal}`, body, async () => {
    if (!selectedCustomer) {
      showToast("Vui lòng chọn khách hàng", "error");
      return;
    }
    const rawHL = $("#xe_ngayHieuLuc").value;
    const rawHH = $("#xe_ngayHetHan").value;
    const ngayHieuLuc = ddmmyyyyToISO(rawHL);
    const ngayHetHan = ddmmyyyyToISO(rawHH);
    if (!ngayHieuLuc) {
      showToast(`[DEBUG] Sửa - Ngày hiệu lực raw="${rawHL}"`, "error");
      return;
    }
    if (!ngayHetHan) {
      showToast(`[DEBUG] Sửa - Ngày hết hạn raw="${rawHH}"`, "error");
      return;
    }
    const ghiChuVal = $("#xe_ghiChu").value.trim();
    if (!ghiChuVal) {
      showToast("Vui lòng nhập 'Chủ xe / ghi chú'", "error");
      return;
    }

    setSubmitLoading(true);
    try {
      const r = await window.api.updateVehicle({
        tableName: currentTable,
        bienSo: idVal,
        maKhachHang: selectedCustomer.maKhachHang,
        ngayHieuLuc,
        ngayHetHan,
        ghiChu: ghiChuVal,
        trangThai: parseInt($("#xe_trangThai").value, 10),
      });
      if (r.success) {
        showToast(`Đã cập nhật xe ${idVal}`, "success");
        closeModal();
        await reloadCurrentView();
      } else {
        showToast("Lỗi: " + r.message, "error");
        setSubmitLoading(false);
      }
    } catch (err) {
      showToast("Lỗi: " + err.message, "error");
      setSubmitLoading(false);
    }
  });

  $("#xe_ngayHieuLuc").value = isoToDDMMYYYY(v.ngayHieuLuc);
  $("#xe_ngayHetHan").value = isoToDDMMYYYY(v.ngayHetHan);
  attachDateMask($("#xe_ngayHieuLuc"));
  attachDateMask($("#xe_ngayHetHan"));

  // Pre-fill selected customer (lookup by maKhachHang for display name)
  if (v.maKhachHang) {
    selectedCustomer = {
      maKhachHang: String(v.maKhachHang),
      name: "KH #" + v.maKhachHang,
      store: "",
    };
    renderSelectedCustomer();
    // Async fetch to get full info
    window.api.searchCustomers(String(v.maKhachHang)).then((list) => {
      const c = list.find((x) => String(x.maKhachHang) === String(v.maKhachHang));
      if (c) {
        const name = [c.ho, c.ten].filter(Boolean).join(" ") || "(chưa có tên)";
        selectedCustomer = { maKhachHang: String(c.maKhachHang), name, store: c.tenCuaHang || "" };
        renderSelectedCustomer();
      }
    });
  }

  setupCustomerCombo();
}

async function confirmDeleteVehicle(v) {
  const cfg = tableConfig[currentTable];
  const idVal = v[cfg.idCol];
  if (!confirm(`Xóa xe ${idVal}?\n\nThao tác không thể hoàn tác.`)) return;
  try {
    const r = await window.api.deleteVehicle(currentTable, idVal);
    if (r.success) {
      showToast(`Đã xóa xe ${idVal}`, "success");
      await reloadCurrentView();
    } else {
      showToast("Lỗi: " + r.message, "error");
    }
  } catch (err) {
    showToast("Lỗi: " + err.message, "error");
  }
}

async function reloadCurrentView() {
  const q = (currentSidebarMode === "soxe" ? $("#vehicleSearchSidebar") : $("#vehicleSearch"))?.value?.trim();
  if (q) await loadVehiclesBySearch(q);
  else if (currentOwner) await loadVehicles();
  else await loadOwners();
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
    text.textContent = "Đang đóng ứng dụng để cập nhật...";
    btnInstall.disabled = true;
    window.api.installUpdate();
  });

  btnClose.addEventListener("click", () => {
    banner.style.display = "none";
  });
}

// ---- Start ----

init();
setupAutoUpdate();
