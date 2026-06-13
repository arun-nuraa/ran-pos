// app.js — Naidu Hotel POS | Main Application Controller
// =========================================================

// ─── System Logs ─────────────────────────────────────────
function getSystemLogs() {
    const saved = localStorage.getItem("nh_logs");
    return saved ? JSON.parse(saved) : [
        { time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), text: "Naidu Hotel POS online. Database loaded." }
    ];
}

function addSystemLog(text) {
    const logs = getSystemLogs();
    logs.unshift({ time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), text });
    if (logs.length > 15) logs.pop();
    localStorage.setItem("nh_logs", JSON.stringify(logs));
    renderSystemLogs();
}

// ─── Active Session ───────────────────────────────────────
let activeOrderSession = null; // { id, type, table_id }
let isPreviewingKOT    = false;

// ─── Boot ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    window.DB.initDB();
    setupClock();
    setupTabs();
    setupModals();
    setupDashboardActions();
    setupBillingCartActions();
    setupPrinterConfig();
    setupSqlConsole();
    renderAll();

    // React to SQL console DB mutations
    window.addEventListener("db-updated", (e) => {
        addSystemLog(`SQL mutated table: '${e.detail.table}'`);
        renderAll();
        if (activeOrderSession) reloadActiveSessionCart();
    });
});

// ─── 1. Clock ─────────────────────────────────────────────
function setupClock() {
    const clock   = document.getElementById("live-clock");
    const sideTime = document.getElementById("sidebar-time");

    const tick = () => {
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-IN", {
            weekday: "short", day: "numeric", month: "short", year: "numeric"
        });
        const timeStr = now.toLocaleTimeString("en-IN", {
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
        if (clock)    clock.textContent    = `${dateStr}  |  ${timeStr}`;
        if (sideTime) sideTime.textContent = timeStr;
    };
    tick();
    setInterval(tick, 1000);
}

// ─── 2. Tab Navigation ────────────────────────────────────
const TAB_TITLES = {
    "dashboard":      ["Operations Control",   "Dashboard / Overview"],
    "billing-console":["Billing Panel",        "Menu / Active Cart"],
    "orders":         ["Orders & Bills",       "Billing Registers"],
    "printer-config": ["Receipt Studio",       "Thermal Print Designer"],
    "reports":        ["Reports",              "Sales & Item Analytics"],
    "sql-playground": ["SQL Console",          "Live Database Explorer"]
};

function setupTabs() {
    const navItems  = document.querySelectorAll(".sidebar .nav-item");
    const tabPanels = document.querySelectorAll(".tab-panel");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const tab = item.getAttribute("data-tab");

            navItems.forEach(n => n.classList.remove("active"));
            item.classList.add("active");

            tabPanels.forEach(p => p.classList.remove("active"));
            const panel = document.getElementById(`tab-${tab}`);
            if (panel) panel.classList.add("active");

            const [title, crumb] = TAB_TITLES[tab] || ["Naidu Hotel", ""];
            document.getElementById("tab-title").textContent      = title;
            document.getElementById("tab-breadcrumb").textContent = crumb;

            if (tab === "printer-config")   renderSampleReceipt();
            if (tab === "billing-console")  renderBillingMenu();
            if (tab === "reports")          setupReports();
        });
    });
}

function switchToTab(tabName) {
    const item = document.querySelector(`.sidebar .nav-item[data-tab="${tabName}"]`);
    if (item) item.click();
}

// ─── 3. Modals ────────────────────────────────────────────
function setupModals() {
    document.querySelectorAll(".modal-close-btn, .btn-close").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.closest(".modal-overlay")?.classList.remove("active");
        });
    });

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) overlay.classList.remove("active");
        });
    });
}

// ─── 4. Render All ────────────────────────────────────────
function renderAll() {
    renderStats();
    renderTablesGrid();
    renderActiveParcelsList();
    renderOrdersListTable();
    renderSystemLogs();
    updateNavBadge();
}

// ─── 5. Stats Cards ───────────────────────────────────────
function renderStats() {
    const tables     = window.DB.getTable("tables");
    const orders     = window.DB.getTable("orders");
    const orderItems = window.DB.getTable("order_items");

    const occupied     = tables.filter(t => t.status === "Occupied" || t.status === "Billing").length;
    const activeParcels= orders.filter(o => o.type === "Parcel" && o.status === "Active").length;
    const totalBills   = orders.length;

    // Calculate completed sales (no GST)
    let dailySales = 0;
    orders.filter(o => o.status === "Completed").forEach(ord => {
        const items = orderItems.filter(i => i.order_id === ord.id);
        let sub  = items.reduce((s, it) => s + it.price * it.quantity, 0);
        let pack = ord.type === "Parcel" ? (ord.packing_charge || 0) : 0;
        let disc = Math.round(sub * ((ord.discount || 0) / 100));
        dailySales += sub + pack - disc;
    });

    setEl("stat-active-tables", `${occupied} / ${tables.length}`);
    setEl("stat-active-parcels", `${activeParcels}`);
    setEl("stat-total-sales",    `Rs. ${dailySales.toFixed(0)}`);
    setEl("stat-total-bills",    `${totalBills}`);
}

function updateNavBadge() {
    const tables  = window.DB.getTable("tables");
    const orders  = window.DB.getTable("orders");
    const occupied = tables.filter(t => t.status === "Occupied" || t.status === "Billing").length;
    const parcels  = orders.filter(o => o.type === "Parcel" && o.status === "Active").length;
    const badge    = document.getElementById("nb-active-tables");
    if (badge) badge.textContent = occupied + parcels;
}

// ─── 6. Tables Grid ───────────────────────────────────────
function renderTablesGrid() {
    const tables = window.DB.getTable("tables");
    const orders = window.DB.getTable("orders");
    const grid   = document.getElementById("restaurant-tables-grid");
    if (!grid) return;

    grid.innerHTML = tables.map(table => {
        const statusCls = table.status === "Vacant" ? "vacant"
                        : table.status === "Billing" ? "billing" : "occupied";

        // Find active order for amount display
        let amountHtml = "";
        if (table.status !== "Vacant") {
            const activeOrder = orders.find(o => o.table_id === table.id && o.status === "Active");
            if (activeOrder) {
                const items = window.DB.getTable("order_items").filter(i => i.order_id === activeOrder.id);
                const amt   = items.reduce((s, it) => s + it.price * it.quantity, 0);
                amountHtml  = `<span class="table-card-amount">Rs. ${amt}</span>`;
            }
        }

        const statusLabel = table.status === "Vacant" ? "Vacant"
                          : table.status === "Billing" ? "Billing" : "Dining";

        return `
        <div class="restaurant-table-card ${statusCls}" data-table-id="${table.id}" title="${statusLabel} — Click to manage">
            <div class="table-icon-wrap">
                <div class="table-visual">
                    <div class="table-seat top"></div>
                    <div class="table-seat bottom"></div>
                    <div class="table-seat left"></div>
                    <div class="table-seat right"></div>
                    <div class="table-top"></div>
                </div>
            </div>
            <div class="table-card-footer">
                <div>
                    <div class="table-card-number">${table.table_number}</div>
                    ${amountHtml}
                </div>
                <div class="table-card-info">
                    <span class="table-card-cap"><i class="fa-solid fa-user"></i> ${table.capacity}</span>
                    <span class="table-card-status-led"></span>
                </div>
            </div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".restaurant-table-card").forEach(card => {
        card.addEventListener("click", () => {
            const tid = parseInt(card.getAttribute("data-table-id"));
            handleTableCardClick(tid);
        });
    });
}

function handleTableCardClick(tableId) {
    const tables = window.DB.getTable("tables");
    const table  = tables.find(t => t.id === tableId);
    if (!table) return;

    if (table.status === "Vacant") {
        openDineInModal(tableId);
    } else {
        const orders = window.DB.getTable("orders");
        const active = orders.find(o => o.table_id === tableId && o.status === "Active");
        if (active) {
            startBillingSession(active.id, "Dine-In", tableId);
        } else {
            if (confirm(`Table ${table.table_number} shows Occupied but has no active order. Vacate it?`)) {
                table.status = "Vacant";
                window.DB.saveTable("tables", tables);
                renderAll();
            }
        }
    }
}

// ─── 7. Parcels List ──────────────────────────────────────
function renderActiveParcelsList() {
    const orders     = window.DB.getTable("orders");
    const orderItems = window.DB.getTable("order_items");
    const container  = document.getElementById("active-parcels-list");
    if (!container) return;

    const activeParcels = orders.filter(o => o.type === "Parcel" && o.status === "Active");

    if (activeParcels.length === 0) {
        container.innerHTML = `<p style="color:var(--text-3); font-size:12px; font-style:italic; text-align:center; padding: 12px 0;">No active parcel orders.</p>`;
        return;
    }

    container.innerHTML = activeParcels.map(parcel => {
        const items = orderItems.filter(i => i.order_id === parcel.id);
        const amt   = items.reduce((s, it) => s + it.price * it.quantity, 0);
        return `
        <div class="parcel-order-row">
            <div class="parcel-info">
                <span class="parcel-title"><i class="fa-solid fa-box-open" style="color:var(--purple); font-size:11px;"></i> Parcel #${parcel.id}</span>
                <span class="parcel-time"><i class="fa-solid fa-clock"></i> ${parcel.order_time} &nbsp;·&nbsp; Rs. ${amt}</span>
            </div>
            <button class="btn btn-primary btn-sm btn-open-parcel" data-id="${parcel.id}" style="padding:5px 12px; font-size:11px;">
                Open
            </button>
        </div>`;
    }).join("");

    container.querySelectorAll(".btn-open-parcel").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.getAttribute("data-id"));
            startBillingSession(id, "Parcel");
        });
    });
}

// ─── 8. Orders Table ──────────────────────────────────────
function renderOrdersListTable() {
    const orders     = window.DB.getTable("orders");
    const tables     = window.DB.getTable("tables");
    const orderItems = window.DB.getTable("order_items");
    const config     = window.Printer.getReceiptConfig();
    const tbody      = document.getElementById("orders-table-body");
    if (!tbody) return;

    // Filter
    const filterSel = document.getElementById("orders-filter-status");
    const filterVal = filterSel ? filterSel.value : "all";
    const filtered  = filterVal === "all" ? orders : orders.filter(o => o.status === filterVal);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-3); padding:30px;">No orders found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(order => {
        const table = order.type === "Dine-In" ? tables.find(t => t.id === order.table_id) : null;
        const src   = order.type === "Dine-In"
            ? `<i class="fa-solid fa-chair" style="color:var(--cyan);"></i> ${table ? table.table_number : "N/A"}`
            : `<i class="fa-solid fa-box-open" style="color:var(--purple);"></i> Takeaway`;

        // Calculate amount (no GST)
        const items = orderItems.filter(i => i.order_id === order.id);
        let sub  = items.reduce((s, it) => s + it.price * it.quantity, 0);
        let pack = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
        let disc = Math.round(sub * ((order.discount || 0) / 100));
        let total = sub + pack - disc;

        const actionBtn = order.status === "Active"
            ? `<button class="btn btn-primary btn-sm btn-tbl-open" data-id="${order.id}" data-type="${order.type}" data-tid="${order.table_id}" style="font-size:11px; padding:5px 12px;">Open Bill</button>`
            : `<div style="display:flex;gap:6px;">
                 <button class="btn btn-secondary btn-sm btn-tbl-reprint" data-id="${order.id}" style="font-size:11px; padding:5px 10px;"><i class="fa-solid fa-print"></i> Reprint</button>
                 <button class="btn btn-purple btn-sm btn-tbl-edit" data-id="${order.id}" style="font-size:11px; padding:5px 10px;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
               </div>`;

        return `
        <tr>
            <td><strong style="color:var(--cyan); font-family:var(--font-mono);">NH-${order.id}</strong></td>
            <td>${order.type}</td>
            <td>${src}</td>
            <td style="font-family:var(--font-mono); font-size:12px;">${order.order_time}</td>
            <td class="amount-cell">Rs. ${total > 0 ? total : '—'}</td>
            <td><span class="badge badge-${order.status.toLowerCase()}">${order.status}</span></td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll(".btn-tbl-open").forEach(btn => {
        btn.addEventListener("click", () => {
            const id  = parseInt(btn.getAttribute("data-id"));
            const typ = btn.getAttribute("data-type");
            const tid = btn.getAttribute("data-tid") !== "null" ? parseInt(btn.getAttribute("data-tid")) : null;
            startBillingSession(id, typ, tid);
        });
    });

    tbody.querySelectorAll(".btn-tbl-reprint").forEach(btn => {
        btn.addEventListener("click", () => triggerReprintFlow(parseInt(btn.getAttribute("data-id"))));
    });

    tbody.querySelectorAll(".btn-tbl-edit").forEach(btn => {
        btn.addEventListener("click", () => openEditOrderModal(parseInt(btn.getAttribute("data-id"))));
    });
}

// Bind filter change
document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("orders-filter-status");
    if (sel) sel.addEventListener("change", renderOrdersListTable);
});

// ─── 9. System Logs ───────────────────────────────────────
function renderSystemLogs() {
    const logs = getSystemLogs();
    const list = document.getElementById("dashboard-logs");
    if (!list) return;

    list.innerHTML = logs.map(l => `
        <div class="history-item">
            <span class="history-time">${l.time}</span>
            <span class="history-text">${l.text}</span>
        </div>`).join("");
}

// ─── 10. Dashboard Quick Actions ──────────────────────────
function setupDashboardActions() {
    document.getElementById("action-dinein-billing")?.addEventListener("click", () => openDineInModal());
    document.getElementById("action-parcel-billing")?.addEventListener("click", () => startNewParcelOrder());
}

function openDineInModal(tableId = null) {
    const tables  = window.DB.getTable("tables");
    const vacant  = tables.filter(t => t.status === "Vacant");
    const select  = document.getElementById("di-table-select");

    if (vacant.length === 0) {
        showToast("All tables are currently occupied!", "error");
        return;
    }

    select.innerHTML = vacant.map(t =>
        `<option value="${t.id}" ${tableId === t.id ? "selected" : ""}>Table ${t.table_number} (${t.capacity} seats)</option>`
    ).join("");

    document.getElementById("modal-dinein").classList.add("active");
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("form-dinein")?.addEventListener("submit", e => {
        e.preventDefault();
        const tableId = parseInt(document.getElementById("di-table-select").value);
        const tables  = window.DB.getTable("tables");
        const orders  = window.DB.getTable("orders");

        const orderId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 10001;
        const timeStr = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});

        orders.push({ id: orderId, table_id: tableId, type: "Dine-In", order_time: timeStr, status: "Active", packing_charge: 0, discount: 0 });
        window.DB.saveTable("orders", orders);

        const tidx = tables.findIndex(t => t.id === tableId);
        if (tidx !== -1) { tables[tidx].status = "Occupied"; window.DB.saveTable("tables", tables); }

        addSystemLog(`Opened Dine-In order for Table ${tables[tidx]?.table_number}`);
        document.getElementById("modal-dinein").classList.remove("active");
        renderAll();
        startBillingSession(orderId, "Dine-In", tableId);
    });
});

function startNewParcelOrder() {
    const orders  = window.DB.getTable("orders");
    const orderId = orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 10001;
    const timeStr = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    const config  = window.Printer.getReceiptConfig();

    orders.push({ id: orderId, table_id: null, type: "Parcel", order_time: timeStr, status: "Active", packing_charge: config.packingCharge || 20, discount: 0 });
    window.DB.saveTable("orders", orders);

    addSystemLog(`Started Parcel order #${orderId}`);
    renderAll();
    startBillingSession(orderId, "Parcel");
}

// ─── 11. Billing Session ──────────────────────────────────
function startBillingSession(orderId, type, tableId = null) {
    activeOrderSession = { id: orderId, type, table_id: tableId };

    const titleEl = document.getElementById("cart-order-title");
    const badge   = document.getElementById("cart-order-type");
    const pGrp    = document.getElementById("cart-packing-group");

    if (type === "Dine-In") {
        const t = window.DB.getTable("tables").find(t => t.id === tableId);
        titleEl.textContent = `Table ${t ? t.table_number : "?"}`;
        badge.textContent   = "Dine-In";
        badge.className     = "badge badge-active";
        pGrp.style.display  = "none";
    } else {
        titleEl.textContent = `Parcel Order #${orderId}`;
        badge.textContent   = "Takeaway";
        badge.className     = "badge badge-completed";
        pGrp.style.display  = "block";
    }

    const order = window.DB.getTable("orders").find(o => o.id === orderId);
    if (order) {
        document.getElementById("cart-discount").value = order.discount || 0;
        document.getElementById("cart-packing").value  = order.packing_charge || 20;
    }

    renderCartItems();
    updateCartLiveTotal();
    switchToTab("billing-console");
}

// ─── 12. Food Menu Rendering ──────────────────────────────
function renderBillingMenu() {
    const menu       = window.DB.getTable("menu_items");
    const catCont    = document.getElementById("billing-menu-categories");
    const categories = ["All", ...new Set(menu.map(i => i.category))];

    catCont.innerHTML = categories.map((c, i) =>
        `<button class="menu-tab-btn ${i===0?"active":""}" data-cat="${c}">${c}</button>`
    ).join("");

    catCont.querySelectorAll(".menu-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            catCont.querySelectorAll(".menu-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            filterMenuCards(btn.getAttribute("data-cat"));
        });
    });

    filterMenuCards("All");

    // Search
    const searchInput = document.getElementById("menu-search");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const q = searchInput.value.toLowerCase().trim();
            document.querySelectorAll(".food-item-card").forEach(card => {
                const name = card.querySelector(".food-item-name")?.textContent.toLowerCase() || "";
                card.style.display = name.includes(q) ? "" : "none";
            });
        });
    }
}

function filterMenuCards(category) {
    const menu     = window.DB.getTable("menu_items");
    const grid     = document.getElementById("billing-menu-grid");
    const filtered = category === "All" ? menu : menu.filter(i => i.category === category);

    grid.innerHTML = filtered.map(item => `
        <div class="food-item-card" data-item-id="${item.id}" title="${item.name} — Rs. ${item.price}">
            <span class="food-item-veg-badge ${item.veg ? "" : "non-veg"}"></span>
            <div class="food-item-name">${item.name}</div>
            <div class="food-item-price">Rs. ${item.price}</div>
        </div>`).join("");

    grid.querySelectorAll(".food-item-card").forEach(card => {
        card.addEventListener("click", () => {
            const id = parseInt(card.getAttribute("data-item-id"));
            addFoodItem(id);
            // Flash animation
            card.style.transform = "scale(0.93)";
            setTimeout(() => card.style.transform = "", 200);
        });
    });
}

function addFoodItem(itemId) {
    if (!activeOrderSession) {
        showToast("Start a table or parcel session first!", "error");
        return;
    }
    const item = window.DB.getTable("menu_items").find(i => i.id === itemId);
    if (!item) return;

    const orderItems = window.DB.getTable("order_items");
    const existing   = orderItems.find(oi => oi.order_id === activeOrderSession.id && oi.item_name === item.name);

    if (existing) {
        existing.quantity += 1;
    } else {
        const nextId = orderItems.length > 0 ? Math.max(...orderItems.map(oi => oi.id)) + 1 : 50001;
        orderItems.push({ id: nextId, order_id: activeOrderSession.id, item_name: item.name, price: item.price, quantity: 1 });
    }

    window.DB.saveTable("order_items", orderItems);
    renderCartItems();
    updateCartLiveTotal();
    renderAll();
}

// ─── 13. Cart ─────────────────────────────────────────────
function renderCartItems() {
    const container = document.getElementById("cart-items-container");
    if (!container) return;

    if (!activeOrderSession) {
        container.innerHTML = `
            <div class="cart-empty-state">
                <i class="fa-solid fa-utensils"></i>
                <p>Select a table on the Operations dashboard or start a Parcel order, then add items here.</p>
            </div>`;
        document.getElementById("cart-live-total").style.display = "none";
        return;
    }

    const items = window.DB.getTable("order_items").filter(i => i.order_id === activeOrderSession.id);

    if (items.length === 0) {
        container.innerHTML = `
            <div class="cart-empty-state">
                <i class="fa-solid fa-bowl-food"></i>
                <p>Order is empty. Click menu cards on the left to add items.</p>
            </div>`;
        document.getElementById("cart-live-total").style.display = "none";
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="cart-item-row" data-item-id="${item.id}">
            <span style="font-weight:600;">${item.item_name}</span>
            <div class="cart-qty-control">
                <button class="cart-qty-btn btn-qty-minus">−</button>
                <span style="font-family:var(--font-mono); font-weight:700; font-size:14px;">${item.quantity}</span>
                <button class="cart-qty-btn btn-qty-plus">+</button>
            </div>
            <span style="font-family:var(--font-mono); font-weight:700; text-align:right; color:var(--cyan);">Rs. ${item.price * item.quantity}</span>
            <button class="cart-item-delete" title="Remove item"><i class="fa-solid fa-trash-can"></i></button>
        </div>`).join("");

    container.querySelectorAll(".cart-item-row").forEach(row => {
        const id = parseInt(row.getAttribute("data-item-id"));
        row.querySelector(".btn-qty-minus").addEventListener("click", () => updateQty(id, -1));
        row.querySelector(".btn-qty-plus").addEventListener("click",  () => updateQty(id, +1));
        row.querySelector(".cart-item-delete").addEventListener("click", () => removeItem(id));
    });

    document.getElementById("cart-live-total").style.display = "grid";
    updateCartLiveTotal();
}

function updateQty(itemId, delta) {
    const orderItems = window.DB.getTable("order_items");
    const idx = orderItems.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    orderItems[idx].quantity += delta;
    if (orderItems[idx].quantity <= 0) orderItems.splice(idx, 1);
    window.DB.saveTable("order_items", orderItems);
    renderCartItems();
    renderAll();
}

function removeItem(itemId) {
    const orderItems = window.DB.getTable("order_items").filter(i => i.id !== itemId);
    window.DB.saveTable("order_items", orderItems);
    renderCartItems();
    renderAll();
}

function reloadActiveSessionCart() {
    if (!activeOrderSession) return;
    const stillActive = window.DB.getTable("orders").find(o => o.id === activeOrderSession.id && o.status === "Active");
    if (!stillActive) activeOrderSession = null;
    renderCartItems();
}

function updateCartLiveTotal() {
    if (!activeOrderSession) return;
    const items = window.DB.getTable("order_items").filter(i => i.order_id === activeOrderSession.id);
    const order = window.DB.getTable("orders").find(o => o.id === activeOrderSession.id);
    if (!order) return;

    let sub  = items.reduce((s, it) => s + it.price * it.quantity, 0);
    let disc = Math.round(sub * ((parseFloat(document.getElementById("cart-discount")?.value) || 0) / 100));
    let pack = activeOrderSession.type === "Parcel" ? (parseFloat(document.getElementById("cart-packing")?.value) || 0) : 0;
    let grand= sub - disc + pack; // No GST

    setEl("lt-subtotal", `Rs. ${sub}`);
    setEl("lt-tax",      `Rs. ${disc > 0 ? "−Rs. " + disc : "—"}`);
    setEl("lt-grand",    `Rs. ${grand}`);
}

// Discount/packing change → update live total
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("cart-discount")?.addEventListener("input", updateCartLiveTotal);
    document.getElementById("cart-packing")?.addEventListener("input", updateCartLiveTotal);
    document.getElementById("cart-clear-session")?.addEventListener("click", () => {
        if (activeOrderSession && confirm("Clear current billing session? (Order data is saved)")) {
            activeOrderSession = null;
            document.getElementById("cart-order-title").textContent = "No Active Session";
            document.getElementById("cart-order-type").textContent  = "—";
            renderCartItems();
        }
    });
});

// ─── 14. Cart Action Buttons ──────────────────────────────
function setupBillingCartActions() {
    // Save order adjustments
    document.getElementById("cart-btn-save")?.addEventListener("click", () => {
        if (!activeOrderSession) return;
        const orders = window.DB.getTable("orders");
        const idx    = orders.findIndex(o => o.id === activeOrderSession.id);
        if (idx === -1) return;
        orders[idx].discount        = parseFloat(document.getElementById("cart-discount").value) || 0;
        orders[idx].packing_charge  = activeOrderSession.type === "Parcel"
            ? parseFloat(document.getElementById("cart-packing").value) || 0
            : 0;
        window.DB.saveTable("orders", orders);
        addSystemLog(`Saved order NH-${activeOrderSession.id}`);
        showToast("Order saved!", "success");
        renderAll();
    });

    // Print KOT
    document.getElementById("cart-btn-kot")?.addEventListener("click", async () => {
        if (!activeOrderSession) return;
        const items = window.DB.getTable("order_items").filter(i => i.order_id === activeOrderSession.id);
        if (items.length === 0) { showToast("Cart is empty!", "error"); return; }

        const order  = window.DB.getTable("orders").find(o => o.id === activeOrderSession.id);
        const table  = order ? window.DB.getTable("tables").find(t => t.id === order.table_id) : null;
        const config = window.Printer.getReceiptConfig();
        try {
            await window.Printer.sendEscPosToPrinter(window.Printer.compileEscPosReceipt(order, items, table, config, true));
            addSystemLog(`KOT printed for NH-${activeOrderSession.id} via Bluetooth`);
            showToast("KOT sent to printer!", "success");
        } catch(err) {
            addSystemLog(`KOT generated locally for NH-${activeOrderSession.id}`);
            showToast("Bluetooth offline — KOT logged locally.", "warn");
        }
    });

    // Checkout
    document.getElementById("cart-btn-checkout")?.addEventListener("click", () => {
        if (!activeOrderSession) return;
        const items = window.DB.getTable("order_items").filter(i => i.order_id === activeOrderSession.id);
        if (items.length === 0) { showToast("Cart is empty! Add items first.", "error"); return; }
        document.getElementById("cart-btn-save")?.click(); // save adjustments first
        openCheckoutBillModal(activeOrderSession.id);
    });
}

// ─── 15. Checkout Modal ───────────────────────────────────
let checkoutOrderId = null;

function openCheckoutBillModal(orderId) {
    checkoutOrderId = orderId;
    isPreviewingKOT = false;
    loadBillSummaryDetails();
    document.getElementById("btn-preview-customer-bill").classList.add("active");
    document.getElementById("btn-preview-kot-bill").classList.remove("active");
    document.getElementById("modal-checkout").classList.add("active");
}

function loadBillSummaryDetails() {
    const order  = window.DB.getTable("orders").find(o => o.id === checkoutOrderId);
    if (!order) return;

    const table  = order.type === "Dine-In" ? window.DB.getTable("tables").find(t => t.id === order.table_id) : null;
    const items  = window.DB.getTable("order_items").filter(i => i.order_id === order.id);
    const config = window.Printer.getReceiptConfig();

    let sub   = items.reduce((s, it) => s + it.price * it.quantity, 0);
    let disc  = Math.round(sub * ((order.discount || 0) / 100));
    let pack  = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
    let grand = sub - disc + pack;  // No GST

    const src = order.type === "Dine-In"
        ? `Table: <strong>${table ? table.table_number : "N/A"}</strong>`
        : "Takeaway / Parcel";

    setEl("co-bill-details", `
        <div style="border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:12px;">
            <div style="font-size:13px; display:flex; flex-direction:column; gap:5px; color:var(--text-2);">
                <span>Reference: <strong style="color:var(--cyan); font-family:var(--font-mono);">NH-${order.id}</strong></span>
                <span>Type: <strong>${order.type}</strong></span>
                <span>${src}</span>
                <span>Time: <strong>${order.order_time}</strong></span>
            </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:7px; font-size:13px; color:var(--text-2);">
            ${items.map(it => `<div style="display:flex; justify-content:space-between;"><span>${it.item_name} ×${it.quantity}</span><span style="font-family:var(--font-mono);">Rs. ${it.price * it.quantity}</span></div>`).join("")}
        </div>
        <div style="border-top:1px dashed var(--border); margin-top:12px; padding-top:10px; display:flex; flex-direction:column; gap:5px; font-size:13px; color:var(--text-2);">
            <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><span>Rs. ${sub}</span></div>
            ${disc > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--red);"><span>Discount (${order.discount}%)</span><span>−Rs. ${disc}</span></div>` : ""}
            ${pack > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Packing</span><span>Rs. ${pack}</span></div>` : ""}
            <div style="display:flex; justify-content:space-between; font-size:18px; font-weight:800; color:var(--cyan); border-top:1px solid var(--border); margin-top:6px; padding-top:8px;">
                <span>Grand Total</span><span>Rs. ${grand}</span>
            </div>
        </div>`);

    setEl("checkout-receipt-preview",
        window.Printer.generateHtmlReceipt(order, items, table, config, isPreviewingKOT));
}

// Preview toggle tabs
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-preview-customer-bill")?.addEventListener("click", () => {
        isPreviewingKOT = false;
        document.getElementById("btn-preview-customer-bill").classList.add("active");
        document.getElementById("btn-preview-kot-bill").classList.remove("active");
        loadBillSummaryDetails();
    });
    document.getElementById("btn-preview-kot-bill")?.addEventListener("click", () => {
        isPreviewingKOT = true;
        document.getElementById("btn-preview-customer-bill").classList.remove("active");
        document.getElementById("btn-preview-kot-bill").classList.add("active");
        loadBillSummaryDetails();
    });

    // Bluetooth print bill
    document.getElementById("co-btn-print-bill-bt")?.addEventListener("click", async () => {
        if (!checkoutOrderId) return;
        const order  = window.DB.getTable("orders").find(o => o.id === checkoutOrderId);
        const table  = order ? window.DB.getTable("tables").find(t => t.id === order.table_id) : null;
        const items  = window.DB.getTable("order_items").filter(i => i.order_id === checkoutOrderId);
        const config = window.Printer.getReceiptConfig();
        try {
            await window.Printer.sendEscPosToPrinter(window.Printer.compileEscPosReceipt(order, items, table, config, false));
            addSystemLog(`Bill NH-${checkoutOrderId} printed via Bluetooth`);
            showToast("Bill sent to printer!", "success");
        } catch(e) { showToast("BT print failed: " + e.message, "error"); }
    });

    // Bluetooth print KOT
    document.getElementById("co-btn-print-kot-bt")?.addEventListener("click", async () => {
        if (!checkoutOrderId) return;
        const order  = window.DB.getTable("orders").find(o => o.id === checkoutOrderId);
        const table  = order ? window.DB.getTable("tables").find(t => t.id === order.table_id) : null;
        const items  = window.DB.getTable("order_items").filter(i => i.order_id === checkoutOrderId);
        const config = window.Printer.getReceiptConfig();
        try {
            await window.Printer.sendEscPosToPrinter(window.Printer.compileEscPosReceipt(order, items, table, config, true));
            showToast("KOT sent to printer!", "success");
        } catch(e) { showToast("BT print failed: " + e.message, "error"); }
    });

    // Browser print
    document.getElementById("co-btn-print-browser")?.addEventListener("click", () => window.print());

    // Complete & vacate
    document.getElementById("co-btn-complete")?.addEventListener("click", () => {
        if (!checkoutOrderId) return;
        const orders = window.DB.getTable("orders");
        const tables = window.DB.getTable("tables");
        const idx    = orders.findIndex(o => o.id === checkoutOrderId);
        if (idx === -1) return;

        const order = orders[idx];
        order.status = "Completed";
        window.DB.saveTable("orders", orders);

        if (order.type === "Dine-In") {
            const tidx = tables.findIndex(t => t.id === order.table_id);
            if (tidx !== -1) { tables[tidx].status = "Vacant"; window.DB.saveTable("tables", tables); }
            addSystemLog(`Table ${tables[tables.findIndex(t => t.id === order.table_id)]?.table_number} vacated.`);
        } else {
            addSystemLog(`Parcel #${order.id} completed.`);
        }

        showToast("Checkout complete! Table vacated.", "success");
        document.getElementById("modal-checkout").classList.remove("active");

        if (activeOrderSession?.id === checkoutOrderId) {
            activeOrderSession = null;
            document.getElementById("cart-order-title").textContent = "No Active Session";
            document.getElementById("cart-order-type").textContent  = "—";
            document.getElementById("cart-live-total").style.display = "none";
        }

        checkoutOrderId = null;
        renderAll();
        switchToTab("dashboard");
    });
});

function triggerReprintFlow(orderId) {
    checkoutOrderId = orderId;
    isPreviewingKOT = false;
    loadBillSummaryDetails();
    document.getElementById("btn-preview-customer-bill").classList.add("active");
    document.getElementById("btn-preview-kot-bill").classList.remove("active");
    document.getElementById("modal-checkout").classList.add("active");
}

// ─── 16. Printer Config ───────────────────────────────────
function setupPrinterConfig() {
    const config = window.Printer.getReceiptConfig();
    const ids = ["cfg-hotel-name","cfg-tagline","cfg-address","cfg-phone","cfg-footer","cfg-paper-width"];
    const keys= ["hotelName","tagline","address","phone","footerMsg","width"];
    ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = config[keys[i]] ?? ""; });

    document.getElementById("btn-save-receipt-config")?.addEventListener("click", () => {
        const newCfg = {};
        ids.forEach((id, i) => { const el = document.getElementById(id); if (el) newCfg[keys[i]] = el.value; });
        newCfg.packingCharge = config.packingCharge;
        window.Printer.saveReceiptConfig(newCfg);
        addSystemLog("Saved receipt config settings.");
        showToast("Receipt settings saved!", "success");
        renderSampleReceipt();
    });

    document.getElementById("btn-connect-printer")?.addEventListener("click", async () => {
        const dot   = document.getElementById("printer-status-dot");
        const label = document.getElementById("printer-status-text");
        try {
            label.textContent = "Connecting…";
            const name = await window.Printer.connectBluetoothPrinter();
            dot.classList.add("connected");
            label.textContent = `${name}`;
            addSystemLog(`Connected Bluetooth printer: ${name}`);
            showToast(`Connected to ${name}!`, "success");
        } catch(e) {
            dot.classList.remove("connected");
            label.textContent = "Printer: Offline";
            showToast("BT pairing failed: " + e.message, "error");
        }
    });

    document.getElementById("btn-test-print")?.addEventListener("click", async () => {
        const dummy = {id:8888, type:"Dine-In", order_time:"12:00", discount:0};
        const items = [{item_name:"Test Item — Printer OK", price:100, quantity:1}];
        const table = {table_number:"T-01"};
        const cfg   = window.Printer.getReceiptConfig();
        try {
            await window.Printer.sendEscPosToPrinter(window.Printer.compileEscPosReceipt(dummy, items, table, cfg, false));
            showToast("Test print sent!", "success");
        } catch(e) { showToast("Printer offline: " + e.message, "error"); }
    });
}

function renderSampleReceipt() {
    const order = {id:5555, type:"Dine-In", order_time:"08:30 PM", discount:10};
    const items = [
        {item_name:"Naidu Special Chicken Biryani", price:280, quantity:2},
        {item_name:"Traditional Veg Meals",         price:150, quantity:1},
        {item_name:"Butter Naan",                   price:40,  quantity:3}
    ];
    const table = {table_number:"T-03"};
    const cfg   = window.Printer.getReceiptConfig();
    setEl("sample-receipt-preview", window.Printer.generateHtmlReceipt(order, items, table, cfg, false));
}

// ─── 17. SQL Console ──────────────────────────────────────
function setupSqlConsole() {
    const editor    = document.getElementById("sql-query-input");
    const templates = document.getElementById("sql-templates");
    const runBtn    = document.getElementById("btn-run-sql");
    const resetBtn  = document.getElementById("btn-db-reset");
    const output    = document.getElementById("sql-output-panel");

    templates?.addEventListener("change", () => { if (templates.value) editor.value = templates.value; });

    runBtn?.addEventListener("click", () => {
        const q = editor.value.trim();
        if (!q) return;

        const result = window.DB.executeSQL(q);
        if (result.success) {
            let html = `<div class="sql-output-status success"><span>✓ ${result.message}</span><span>${result.affectedRows} row(s)</span></div>`;
            if (result.rows?.length > 0) {
                html += `<div class="sql-output-table-container" style="padding:10px; overflow-x:auto;">
                    <table class="sql-output-table">
                        <thead><tr>${result.columns.map(c => `<th>${c}</th>`).join("")}</tr></thead>
                        <tbody>${result.rows.map(row =>
                            `<tr>${result.columns.map(c => `<td>${row[c] !== undefined ? row[c] : "NULL"}</td>`).join("")}</tr>`
                        ).join("")}</tbody>
                    </table></div>`;
            } else if (q.toLowerCase().startsWith("select")) {
                html += `<div style="padding:12px; color:var(--text-3); font-style:italic;">Empty set (0 rows)</div>`;
            } else {
                html += `<div style="padding:12px; color:var(--green);">✓ Database updated successfully.</div>`;
            }
            output.innerHTML = html;
        } else {
            output.innerHTML = `
                <div class="sql-output-status error"><span>✗ ${result.message}</span></div>
                <div style="padding:12px; color:var(--red); font-size:11px;">Valid tables: tables, menu_items, orders, order_items</div>`;
        }
    });

    // Ctrl+Enter to run
    editor?.addEventListener("keydown", e => { if (e.ctrlKey && e.key === "Enter") runBtn?.click(); });

    resetBtn?.addEventListener("click", () => {
        if (confirm("Reset all database tables to default values? Active sales will be cleared.")) {
            window.DB.resetDB();
            addSystemLog("Database reset to default Naidu Hotel values.");
            if (activeOrderSession) activeOrderSession = null;
            renderAll();
            showToast("Database reset complete!", "success");
        }
    });
}

// ─── 18. Utility Helpers ──────────────────────────────────
function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

// Toast Notifications
function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.cssText = `
            position: fixed; bottom: 28px; right: 28px; z-index: 9999;
            display: flex; flex-direction: column; gap: 10px; pointer-events: none;`;
        document.body.appendChild(container);
    }

    const colors = { success: "#10b981", error: "#ef4444", warn: "#f59e0b", info: "#3b82f6" };
    const icons  = { success: "fa-circle-check", error: "fa-circle-xmark", warn: "fa-triangle-exclamation", info: "fa-circle-info" };

    const toast = document.createElement("div");
    toast.style.cssText = `
        background: rgba(10,14,30,0.97); border: 1px solid ${colors[type]}44;
        border-left: 3px solid ${colors[type]}; color: #f0f4ff;
        padding: 13px 18px; border-radius: 10px; font-size: 13px; font-weight: 500;
        font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5); pointer-events: auto;
        animation: toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
        min-width: 240px; max-width: 340px;`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]}" style="color:${colors[type]};"></i> ${message}`;

    // Inject keyframe once
    if (!document.getElementById("toast-kf")) {
        const style = document.createElement("style");
        style.id = "toast-kf";
        style.textContent = `@keyframes toastIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
        @keyframes toastOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(30px)}}`;
        document.head.appendChild(style);
    }

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "toastOut 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

// ─── 19. REPORTS MODULE ───────────────────────────────────

let currentReportType = "orders"; // "orders" | "items"
let reportPrintArea   = null;     // Hidden DOM node for print

// Setup Reports tab — called when tab is opened
function setupReports() {
    // Type switcher
    document.querySelectorAll(".report-type-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".report-type-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentReportType = btn.getAttribute("data-report");
            renderReport();
        });
    });

    // Period picker
    const periodSel = document.getElementById("rpt-period");
    const rangeWrap = document.getElementById("rpt-date-range-wrap");
    if (periodSel) {
        periodSel.addEventListener("change", () => {
            const v = periodSel.value;
            rangeWrap.style.display = v === "custom" ? "flex" : "none";
            renderReport();
        });
    }

    // Custom date inputs
    document.getElementById("rpt-date-from")?.addEventListener("change", renderReport);
    document.getElementById("rpt-date-to")?.addEventListener("change",   renderReport);

    // Export buttons
    document.getElementById("btn-export-pdf")?.addEventListener("click",   exportReportPDF);
    document.getElementById("btn-export-excel")?.addEventListener("click", exportReportExcel);

    renderReport();
}

// ─── Date Helpers ─────────────────────────────────────────
function getDateRange() {
    const period = document.getElementById("rpt-period")?.value || "today";
    const now    = new Date();

    if (period === "today") {
        const d = now.toISOString().split("T")[0];
        updatePeriodLabel(`Today · ${formatDisplayDate(d)}`);
        return { from: d, to: d };
    }

    if (period === "month") {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const from = `${y}-${m}-01`;
        const to   = now.toISOString().split("T")[0];
        updatePeriodLabel(`This Month · ${formatDisplayDate(from)} to ${formatDisplayDate(to)}`);
        return { from, to };
    }

    // Custom
    const from = document.getElementById("rpt-date-from")?.value || now.toISOString().split("T")[0];
    const to   = document.getElementById("rpt-date-to")?.value   || now.toISOString().split("T")[0];
    updatePeriodLabel(`${formatDisplayDate(from)} to ${formatDisplayDate(to)}`);
    return { from, to };
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function updatePeriodLabel(text) {
    const el = document.getElementById("rpt-period-label");
    if (el) el.textContent = text;
}

// Filter orders by date range. Orders only have order_time (HH:MM), no date.
// So we treat all completed orders as "today" for simplicity,
// but store date if available. This works because this is a daily reset POS.
// For monthly filtering we count all completed orders.
function getFilteredOrders(from, to) {
    const orders = window.DB.getTable("orders");
    // We store order_date in orders if we can. Check period:
    const period = document.getElementById("rpt-period")?.value || "today";

    if (period === "today") {
        // All completed orders (POS resets daily → all = today)
        return orders.filter(o => o.status === "Completed");
    } else if (period === "month") {
        return orders.filter(o => o.status === "Completed");
    } else {
        // Custom: if order_date stored use it, else show all
        return orders.filter(o => {
            if (!o.order_date) return o.status === "Completed";
            return o.status === "Completed" && o.order_date >= from && o.order_date <= to;
        });
    }
}

// ─── Main Render Dispatcher ───────────────────────────────
function renderReport() {
    const { from, to } = getDateRange();
    const filtered = getFilteredOrders(from, to);

    if (currentReportType === "orders") {
        renderOrderReport(filtered);
    } else {
        renderItemReport(filtered);
    }
}

// ─── Order Report ─────────────────────────────────────────
function renderOrderReport(orders) {
    const orderItems = window.DB.getTable("order_items");
    const tables     = window.DB.getTable("tables");

    // Summary
    const summaryRow = document.getElementById("rpt-summary-row");
    if (summaryRow) summaryRow.style.display = "grid";

    let totalSales = 0;
    const rows = orders.map(order => {
        const items = orderItems.filter(i => i.order_id === order.id);
        let sub   = items.reduce((s, it) => s + it.price * it.quantity, 0);
        let pack  = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
        let disc  = Math.round(sub * ((order.discount || 0) / 100));
        let total = sub + pack - disc;
        totalSales += total;

        const tbl = order.type === "Dine-In" ? tables.find(t => t.id === order.table_id) : null;
        return { order, total, tbl };
    });

    setEl("rpt-txn-count",  `${orders.length}`);
    setEl("rpt-total-sales", `Rs. ${totalSales.toFixed(0)}`);

    const area = document.getElementById("report-content-area");
    if (!area) return;

    if (rows.length === 0) {
        area.innerHTML = `<div class="report-empty"><i class="fa-solid fa-chart-bar"></i><p>No completed orders found for this period.</p></div>`;
        return;
    }

    area.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="report-order-table">
                <thead>
                    <tr>
                        <th>Bill No</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Table / Source</th>
                        <th>Items</th>
                        <th style="text-align:right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(({ order, total, tbl }) => {
                        const src = order.type === "Dine-In"
                            ? `<i class="fa-solid fa-chair" style="color:var(--cyan);"></i> ${tbl ? tbl.table_number : "N/A"}`
                            : `<i class="fa-solid fa-box-open" style="color:var(--purple);"></i> Parcel`;
                        const itemCount = orderItems.filter(i => i.order_id === order.id).length;
                        return `
                        <tr>
                            <td><strong style="color:var(--cyan); font-family:var(--font-mono);">NH-${order.id}</strong></td>
                            <td style="color:var(--text-3); font-size:12px;">${order.order_date || "Today"} · ${order.order_time}</td>
                            <td>${order.type}</td>
                            <td>${src}</td>
                            <td style="color:var(--text-3);">${itemCount} item${itemCount !== 1 ? "s" : ""}</td>
                            <td style="text-align:right; font-family:var(--font-mono); font-weight:700; color:var(--text-1);">Rs. ${total}</td>
                        </tr>`;
                    }).join("")}
                </tbody>
                <tfoot>
                    <tr style="border-top:2px solid var(--border-glow-c);">
                        <td colspan="5" style="font-weight:700; font-size:14px; padding-top:14px;">TOTAL</td>
                        <td style="text-align:right; font-family:var(--font-mono); font-weight:800; font-size:16px; color:var(--cyan); padding-top:14px;">Rs. ${totalSales.toFixed(0)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ─── Item Report ──────────────────────────────────────────
function renderItemReport(orders) {
    const orderItems = window.DB.getTable("order_items");

    // Summary - item reports hide transaction count, show total amount
    const summaryRow = document.getElementById("rpt-summary-row");
    if (summaryRow) summaryRow.style.display = "none";

    // Aggregate items
    const itemMap = {};
    orders.forEach(order => {
        const items = orderItems.filter(i => i.order_id === order.id);
        items.forEach(item => {
            if (!itemMap[item.item_name]) {
                itemMap[item.item_name] = { qty: 0, amount: 0, price: item.price };
            }
            itemMap[item.item_name].qty    += item.quantity;
            itemMap[item.item_name].amount += item.price * item.quantity;
        });
    });

    const sorted = Object.entries(itemMap).sort((a, b) => b[1].amount - a[1].amount);

    const area = document.getElementById("report-content-area");
    if (!area) return;

    if (sorted.length === 0) {
        area.innerHTML = `<div class="report-empty"><i class="fa-solid fa-bowl-food"></i><p>No item data found for this period.</p></div>`;
        return;
    }

    area.innerHTML = `
        <div class="report-item-list">
            ${sorted.map(([name, data]) => `
            <div class="report-item-row">
                <div>
                    <div class="rpt-item-name">${name}</div>
                    <div style="font-size:11px; color:var(--text-3);">Unit Price: Rs. ${data.price}</div>
                </div>
                <div class="rpt-item-meta">
                    <span class="rpt-item-meta-label">Order Quantity</span>
                    <span class="rpt-item-meta-value">${data.qty}</span>
                </div>
                <div class="rpt-item-meta rpt-item-amount">
                    <span class="rpt-item-meta-label">Order Amount</span>
                    <span class="rpt-item-meta-value">Rs. ${data.amount}</span>
                </div>
            </div>`).join("")}
        </div>

        <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:24px; font-size:13px;">
            <span style="color:var(--text-3);">Total Items Sold: <strong style="color:var(--text-1);">${sorted.reduce((s, [,d]) => s + d.qty, 0)}</strong></span>
            <span style="color:var(--text-3);">Total Revenue: <strong style="color:var(--cyan); font-family:var(--font-mono);">Rs. ${sorted.reduce((s, [,d]) => s + d.amount, 0)}</strong></span>
        </div>`;
}

// ─── PDF Export ───────────────────────────────────────────
function exportReportPDF() {
    const area    = document.getElementById("report-content-area");
    const period  = document.getElementById("rpt-period-label")?.textContent || "";
    const type    = currentReportType === "orders" ? "Order Report" : "Item Report";
    const txns    = document.getElementById("rpt-txn-count")?.textContent   || "";
    const total   = document.getElementById("rpt-total-sales")?.textContent || "";
    if (!area) return;

    // Build a clean print-only div
    const existing = document.getElementById("print-report-area");
    if (existing) existing.remove();

    const printDiv = document.createElement("div");
    printDiv.id    = "print-report-area";
    printDiv.innerHTML = `
        <style>
            #print-report-area {
                font-family: Arial, sans-serif;
                color: #111;
                font-size: 12px;
            }
            #print-report-area h1 { font-size: 20px; margin-bottom: 4px; }
            #print-report-area .meta { color: #555; font-size: 11px; margin-bottom: 16px; }
            #print-report-area .summary-band {
                display: flex; gap: 30px; background: #f5f5f5;
                padding: 12px 16px; border-radius: 6px; margin-bottom: 18px;
                font-weight: bold;
            }
            #print-report-area table {
                width: 100%; border-collapse: collapse; font-size: 12px;
            }
            #print-report-area th {
                background: #222; color: #fff; padding: 8px 10px;
                text-align: left; font-size: 11px; text-transform: uppercase;
            }
            #print-report-area td { padding: 8px 10px; border-bottom: 1px solid #ddd; }
            #print-report-area tfoot td { font-weight: bold; font-size: 14px; background: #f0f8ff; }
            .item-row-p { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #ccc; }
            .item-row-p:last-child { border-bottom: none; }
            .item-name-p { font-weight: bold; font-size: 13px; }
            .item-cols-p { display: flex; gap: 32px; }
            .item-col-p { display: flex; flex-direction: column; }
            .item-col-label { font-size: 10px; color: #777; text-transform: uppercase; }
            .item-col-val   { font-size: 15px; font-weight: bold; }
        </style>

        <h1>Naidu Hotel — ${type}</h1>
        <div class="meta">Period: ${period} &nbsp;|&nbsp; Printed: ${new Date().toLocaleString()}</div>
        ${currentReportType === "orders" ? `
        <div class="summary-band">
            <span>${txns} Transactions</span>
            <span>Total Sale: ${total}</span>
        </div>` : ""}

        ${buildPrintContent()}
    `;

    document.body.appendChild(printDiv);
    window.print();
    setTimeout(() => printDiv.remove(), 1500);
}

function buildPrintContent() {
    const { from, to } = getDateRange();
    const orders     = getFilteredOrders(from, to);
    const orderItems = window.DB.getTable("order_items");
    const tables     = window.DB.getTable("tables");

    if (currentReportType === "orders") {
        let totalSales = 0;
        const rows = orders.map(order => {
            const items = orderItems.filter(i => i.order_id === order.id);
            let sub   = items.reduce((s, it) => s + it.price * it.quantity, 0);
            let pack  = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
            let disc  = Math.round(sub * ((order.discount || 0) / 100));
            let total = sub + pack - disc;
            totalSales += total;
            const tbl = order.type === "Dine-In" ? tables.find(t => t.id === order.table_id) : null;
            return `<tr>
                <td>NH-${order.id}</td>
                <td>${order.order_date || "Today"} ${order.order_time}</td>
                <td>${order.type}</td>
                <td>${order.type === "Dine-In" ? (tbl ? tbl.table_number : "N/A") : "Parcel"}</td>
                <td style="text-align:right;">Rs. ${total}</td>
            </tr>`;
        });
        return `<table>
            <thead><tr><th>Bill No</th><th>Date/Time</th><th>Type</th><th>Source</th><th style="text-align:right;">Total</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
            <tfoot><tr><td colspan="4"><strong>GRAND TOTAL</strong></td><td style="text-align:right;"><strong>Rs. ${totalSales.toFixed(0)}</strong></td></tr></tfoot>
        </table>`;
    } else {
        // Item report
        const itemMap = {};
        orders.forEach(order => {
            orderItems.filter(i => i.order_id === order.id).forEach(item => {
                if (!itemMap[item.item_name]) itemMap[item.item_name] = { qty: 0, amount: 0 };
                itemMap[item.item_name].qty    += item.quantity;
                itemMap[item.item_name].amount += item.price * item.quantity;
            });
        });
        const sorted = Object.entries(itemMap).sort((a, b) => b[1].amount - a[1].amount);
        const totalRev = sorted.reduce((s, [,d]) => s + d.amount, 0);
        return `
            ${sorted.map(([name, data]) => `
            <div class="item-row-p">
                <span class="item-name-p">${name}</span>
                <div class="item-cols-p">
                    <div class="item-col-p">
                        <span class="item-col-label">Qty Sold</span>
                        <span class="item-col-val">${data.qty}</span>
                    </div>
                    <div class="item-col-p">
                        <span class="item-col-label">Amount</span>
                        <span class="item-col-val">Rs. ${data.amount}</span>
                    </div>
                </div>
            </div>`).join("")}
            <div style="margin-top:16px; padding-top:12px; border-top:2px solid #111; font-size:14px; font-weight:bold; display:flex; justify-content:space-between;">
                <span>Total Revenue</span><span>Rs. ${totalRev}</span>
            </div>`;
    }
}

// ─── Excel / XLS Export ───────────────────────────────────
function exportReportExcel() {
    const { from, to } = getDateRange();
    const orders     = getFilteredOrders(from, to);
    const orderItems = window.DB.getTable("order_items");
    const tables     = window.DB.getTable("tables");
    const period     = document.getElementById("rpt-period-label")?.textContent || "report";

    let sheetData = [];

    if (currentReportType === "orders") {
        sheetData.push(["Bill No", "Date", "Time", "Type", "Source", "Subtotal", "Discount", "Packing", "Total"]);
        orders.forEach(order => {
            const items = orderItems.filter(i => i.order_id === order.id);
            let sub   = items.reduce((s, it) => s + it.price * it.quantity, 0);
            let pack  = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
            let disc  = Math.round(sub * ((order.discount || 0) / 100));
            let total = sub + pack - disc;
            const tbl = order.type === "Dine-In" ? tables.find(t => t.id === order.table_id) : null;
            const src = order.type === "Dine-In" ? (tbl ? tbl.table_number : "N/A") : "Parcel";
            sheetData.push([`NH-${order.id}`, order.order_date || "Today", order.order_time, order.type, src, sub, disc, pack, total]);
        });
        // Totals row
        const grandTotal = orders.reduce((sum, order) => {
            const items = orderItems.filter(i => i.order_id === order.id);
            let sub   = items.reduce((s, it) => s + it.price * it.quantity, 0);
            let pack  = order.type === "Parcel" ? (order.packing_charge || 0) : 0;
            let disc  = Math.round(sub * ((order.discount || 0) / 100));
            return sum + sub + pack - disc;
        }, 0);
        sheetData.push(["", "", "", "", "GRAND TOTAL", "", "", "", grandTotal]);
    } else {
        sheetData.push(["Item Name", "Unit Price", "Qty Sold", "Total Amount"]);
        const itemMap = {};
        orders.forEach(order => {
            orderItems.filter(i => i.order_id === order.id).forEach(item => {
                if (!itemMap[item.item_name]) itemMap[item.item_name] = { price: item.price, qty: 0, amount: 0 };
                itemMap[item.item_name].qty    += item.quantity;
                itemMap[item.item_name].amount += item.price * item.quantity;
            });
        });
        const sorted = Object.entries(itemMap).sort((a, b) => b[1].amount - a[1].amount);
        sorted.forEach(([name, data]) => {
            sheetData.push([name, data.price, data.qty, data.amount]);
        });
        sheetData.push(["TOTAL", "", sorted.reduce((s, [,d]) => s + d.qty, 0), sorted.reduce((s, [,d]) => s + d.amount, 0)]);
    }

    // Use SheetJS to create proper .xlsx
    if (typeof XLSX !== "undefined") {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        // Column widths
        ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
        const sheetName = currentReportType === "orders" ? "Order Report" : "Item Report";
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const fileName = `NaiduHotel_${sheetName.replace(" ", "_")}_${new Date().toLocaleDateString("en-IN").replace(/\//g, "-")}.xlsx`;
        XLSX.writeFile(wb, fileName);
        addSystemLog(`Exported ${sheetName} as ${fileName}`);
        showToast("Excel file downloaded!", "success");
    } else {
        // Fallback: CSV download
        const csv = sheetData.map(row => row.map(v => `"${v}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `NaiduHotel_${currentReportType}_report.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("CSV file downloaded!", "success");
    }
}

// --- 20. MENU MANAGER (Catalog CRUD) ----------------------

function openMenuManagerModal() {
    const modal = document.getElementById("modal-menu-manager");
    if (!modal) return;
    renderMenuManagerList();
    resetMenuForm();
    switchMMTab("list");
    modal.classList.add("active");

    // Tab switching
    modal.querySelectorAll(".mm-tab-btn").forEach(btn => {
        btn.onclick = () => switchMMTab(btn.getAttribute("data-mmtab"));
    });

    // Veg / Non-Veg toggle
    modal.querySelectorAll(".veg-toggle-btn").forEach(btn => {
        btn.onclick = () => {
            modal.querySelectorAll(".veg-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        };
    });

    // Save / Add button
    document.getElementById("mm-btn-save-item").onclick = saveMenuItemFromForm;

    // Cancel edit
    document.getElementById("mm-btn-cancel-edit").onclick = () => {
        resetMenuForm();
        switchMMTab("list");
    };

    // Close buttons
    modal.querySelectorAll(".modal-close-btn, .btn-close").forEach(b => {
        b.onclick = () => modal.classList.remove("active");
    });
    modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("active"); }, { once: false });
}

function switchMMTab(tabName) {
    document.querySelectorAll(".mm-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-mmtab") === tabName));
    document.querySelectorAll(".mm-panel").forEach(p => p.classList.toggle("active", p.id === `mm-panel-${tabName}`));
}

function renderMenuManagerList() {
    const items   = window.DB.getTable("menu_items");
    const listDiv = document.getElementById("mm-items-list");
    if (!listDiv) return;

    // Group by category
    const categories = [...new Set(items.map(i => i.category))];

    listDiv.innerHTML = categories.map(cat => {
        const catItems = items.filter(i => i.category === cat);
        return `
        <div style="margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; color:var(--text-3); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--border);">
                <i class="fa-solid fa-tag" style="color:var(--cyan); margin-right:5px;"></i>${cat}
                <span style="margin-left:8px; color:var(--text-3);">(${catItems.length} items)</span>
            </div>
            ${catItems.map(item => `
            <div class="mm-item-row" data-item-id="${item.id}">
                <span class="mm-item-dot ${item.veg ? 'veg' : 'nonveg'}"></span>
                <div class="mm-item-info">
                    <div class="mm-item-name">${item.name}</div>
                    <div class="mm-item-meta">${item.category} &bull; ${item.veg ? 'Veg' : 'Non-Veg'}</div>
                </div>
                <div class="mm-item-price">Rs. ${item.price}</div>
                <div class="mm-item-actions">
                    <button class="btn btn-secondary btn-sm mm-edit-btn" data-id="${item.id}">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn btn-sm mm-del-btn" data-id="${item.id}" style="background:rgba(239,68,68,0.12); color:var(--red); border:1px solid rgba(239,68,68,0.25);">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`).join("")}
        </div>`;
    }).join("");

    // Wire edit buttons
    listDiv.querySelectorAll(".mm-edit-btn").forEach(btn => {
        btn.onclick = () => loadMenuItemIntoForm(parseInt(btn.getAttribute("data-id")));
    });

    // Wire delete buttons
    listDiv.querySelectorAll(".mm-del-btn").forEach(btn => {
        btn.onclick = () => deleteMenuItem(parseInt(btn.getAttribute("data-id")));
    });
}

function loadMenuItemIntoForm(itemId) {
    const item = window.DB.getTable("menu_items").find(i => i.id === itemId);
    if (!item) return;

    document.getElementById("mm-edit-id").value      = item.id;
    document.getElementById("mm-item-name").value    = item.name;
    document.getElementById("mm-item-price").value   = item.price;
    document.getElementById("mm-item-category").value= item.category;

    // Set veg toggle
    document.querySelectorAll(".veg-toggle-btn").forEach(btn => {
        const val = btn.getAttribute("data-val") === "true";
        btn.classList.toggle("active", val === item.veg);
    });

    document.getElementById("mm-save-label").textContent    = "Save Changes";
    document.getElementById("mm-btn-cancel-edit").style.display = "inline-flex";

    switchMMTab("add");
}

function resetMenuForm() {
    document.getElementById("mm-edit-id").value       = "";
    document.getElementById("mm-item-name").value     = "";
    document.getElementById("mm-item-price").value    = "";
    document.getElementById("mm-item-category").value = "";
    document.getElementById("mm-save-label").textContent     = "Add Item";
    document.getElementById("mm-btn-cancel-edit").style.display = "none";

    // Default to Veg
    document.querySelectorAll(".veg-toggle-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === "true");
    });
}

function saveMenuItemFromForm() {
    const name     = document.getElementById("mm-item-name").value.trim();
    const priceStr = document.getElementById("mm-item-price").value.trim();
    const category = document.getElementById("mm-item-category").value.trim();
    const editId   = document.getElementById("mm-edit-id").value;

    if (!name || !priceStr || !category) {
        showToast("Please fill all required fields.", "warn");
        return;
    }

    const price = parseFloat(priceStr);
    if (isNaN(price) || price < 0) {
        showToast("Enter a valid price.", "warn");
        return;
    }

    const isVeg = document.querySelector(".veg-toggle-btn.active")?.getAttribute("data-val") === "true";
    const items = window.DB.getTable("menu_items");

    if (editId) {
        // Edit existing
        const id  = parseInt(editId);
        const idx = items.findIndex(i => i.id === id);
        if (idx !== -1) {
            items[idx] = { ...items[idx], name, price, category, veg: isVeg };
            window.DB.saveTable("menu_items", items);
            showToast(`"${name}" updated!`, "success");
            addSystemLog(`Menu item updated: ${name}`);
        }
    } else {
        // Add new
        const maxId = items.reduce((m, i) => Math.max(m, i.id), 0);
        items.push({ id: maxId + 1, name, price, category, veg: isVeg });
        window.DB.saveTable("menu_items", items);
        showToast(`"${name}" added to menu!`, "success");
        addSystemLog(`New menu item added: ${name}`);
    }

    renderMenuManagerList();
    resetMenuForm();
    switchMMTab("list");
    renderBillingMenu(); // refresh billing panel
}

function deleteMenuItem(itemId) {
    const items = window.DB.getTable("menu_items");
    const item  = items.find(i => i.id === itemId);
    if (!item) return;

    if (!confirm(`Delete "${item.name}" from the menu?`)) return;

    const updated = items.filter(i => i.id !== itemId);
    window.DB.saveTable("menu_items", updated);
    showToast(`"${item.name}" removed from menu.`, "info");
    addSystemLog(`Menu item deleted: ${item.name}`);
    renderMenuManagerList();
    renderBillingMenu();
}

// Wire up the gear icon on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-open-menu-manager")?.addEventListener("click", openMenuManagerModal);
});


// --- 21. EDIT COMPLETED ORDER -----------------------------

let editOrderId = null;
// Temp working copy of order items while editing
let editOrderItems = [];

function openEditOrderModal(orderId) {
    editOrderId    = orderId;
    const order    = window.DB.getTable("orders").find(o => o.id === orderId);
    if (!order) return;

    // Deep-copy current items into working buffer
    editOrderItems = window.DB.getTable("order_items")
        .filter(i => i.order_id === orderId)
        .map(i => ({ ...i }));

    // Set modal title
    const ref = document.getElementById("eo-order-ref");
    if (ref) ref.textContent = `NH-${orderId}`;

    // Populate customer note if stored
    const noteEl = document.getElementById("eo-customer-note");
    if (noteEl) noteEl.value = order.customer_note || "";

    // Populate menu dropdown
    const sel    = document.getElementById("eo-item-select");
    const menu   = window.DB.getTable("menu_items");
    if (sel) {
        sel.innerHTML = menu.map(m =>
            `<option value="${m.id}" data-price="${m.price}">${m.name} � Rs. ${m.price}</option>`
        ).join("");
    }

    renderEditOrderItems();

    // Wire "Add Item" button
    document.getElementById("eo-btn-add-item").onclick = () => {
        const selEl  = document.getElementById("eo-item-select");
        const menuId = parseInt(selEl?.value);
        const qty    = parseInt(document.getElementById("eo-item-qty")?.value) || 1;
        const menuItem = menu.find(m => m.id === menuId);
        if (!menuItem) return;

        // If same item exists, increment qty; else push new row
        const existing = editOrderItems.find(i => i.item_name === menuItem.name);
        if (existing) {
            existing.quantity += qty;
        } else {
            const maxId = editOrderItems.reduce((m, i) => Math.max(m, i.id), 0);
            editOrderItems.push({
                id: maxId + 1,
                order_id: orderId,
                item_name: menuItem.name,
                price: menuItem.price,
                quantity: qty
            });
        }
        renderEditOrderItems();
        showToast(`${menuItem.name} added!`, "success");
    };

    // Wire "Save Changes" button
    document.getElementById("eo-btn-save").onclick = saveEditedOrder;

    // Open modal
    const modal = document.getElementById("modal-edit-order");
    if (modal) {
        modal.classList.add("active");
        modal.querySelectorAll(".modal-close-btn, .btn-close").forEach(b => {
            b.onclick = () => modal.classList.remove("active");
        });
        modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("active"); });
    }
}

function renderEditOrderItems() {
    const list = document.getElementById("eo-items-list");
    if (!list) return;

    if (editOrderItems.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:var(--text-3); padding:20px; font-size:13px;">No items. Add from menu below.</div>`;
        updateEoTotal();
        return;
    }

    list.innerHTML = editOrderItems.map((item, idx) => `
        <div class="eo-item-row" data-idx="${idx}">
            <div class="eo-item-name">${item.item_name}</div>
            <div class="eo-item-price">Rs. ${item.price} each</div>
            <div class="eo-qty-control">
                <button class="eo-qty-btn eo-dec" data-idx="${idx}">&#8722;</button>
                <span class="eo-qty-num">${item.quantity}</span>
                <button class="eo-qty-btn eo-inc" data-idx="${idx}">+</button>
            </div>
            <div style="font-family:var(--font-mono); font-size:14px; font-weight:700; min-width:60px; text-align:right;">
                Rs. ${item.price * item.quantity}
            </div>
            <button class="eo-del-btn" data-idx="${idx}" title="Remove item">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>`).join("");

    // Increment
    list.querySelectorAll(".eo-inc").forEach(btn => {
        btn.onclick = () => {
            const i = parseInt(btn.getAttribute("data-idx"));
            editOrderItems[i].quantity++;
            renderEditOrderItems();
        };
    });

    // Decrement (min 1)
    list.querySelectorAll(".eo-dec").forEach(btn => {
        btn.onclick = () => {
            const i = parseInt(btn.getAttribute("data-idx"));
            if (editOrderItems[i].quantity > 1) {
                editOrderItems[i].quantity--;
            } else {
                editOrderItems.splice(i, 1);
            }
            renderEditOrderItems();
        };
    });

    // Delete row
    list.querySelectorAll(".eo-del-btn").forEach(btn => {
        btn.onclick = () => {
            const i = parseInt(btn.getAttribute("data-idx"));
            const name = editOrderItems[i].item_name;
            editOrderItems.splice(i, 1);
            renderEditOrderItems();
            showToast(`${name} removed.`, "info");
        };
    });

    updateEoTotal();
}

function updateEoTotal() {
    const total = editOrderItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const el = document.getElementById("eo-grand-total");
    if (el) el.textContent = `Rs. ${total}`;
}

function saveEditedOrder() {
    if (!editOrderId) return;

    // Save updated items: remove old, insert new
    const allItems = window.DB.getTable("order_items");
    const others   = allItems.filter(i => i.order_id !== editOrderId);

    // Reassign IDs to be safe
    let maxId = others.reduce((m, i) => Math.max(m, i.id), 0);
    const newItems = editOrderItems.map(item => ({
        ...item,
        id: ++maxId,
        order_id: editOrderId
    }));

    window.DB.saveTable("order_items", [...others, ...newItems]);

    // Save customer note
    const note   = document.getElementById("eo-customer-note")?.value || "";
    const orders = window.DB.getTable("orders");
    const idx    = orders.findIndex(o => o.id === editOrderId);
    if (idx !== -1) {
        orders[idx].customer_note = note;
        window.DB.saveTable("orders", orders);
    }

    addSystemLog(`Order NH-${editOrderId} edited (${newItems.length} items).`);
    showToast(`Order NH-${editOrderId} saved!`, "success");

    // Close modal & refresh
    document.getElementById("modal-edit-order")?.classList.remove("active");
    renderAll();
}
