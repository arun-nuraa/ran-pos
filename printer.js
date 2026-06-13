// printer.js - Bluetooth ESC/POS Thermal Printing and Receipt/KOT Simulator for Naidu Hotel

const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_WRITE_CHAR_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

let bluetoothDevice = null;
let printCharacteristic = null;

const DEFAULT_RECEIPT_CONFIG = {
    hotelName: "NAIDU HOTEL",
    tagline: "Traditional South Indian Restaurant",
    address: "Opp. Railway Station, Main Road, Kadapa",
    phone: "+91 8562 245678",
    footerMsg: "Taste of Tradition. Thank you, Visit Again!",
    width: "80mm",
    packingCharge: 20 // Flat Rs. 20 for parcel packaging
};

function getReceiptConfig() {
    const saved = localStorage.getItem("nh_receipt_config");
    return saved ? JSON.parse(saved) : DEFAULT_RECEIPT_CONFIG;
}

function saveReceiptConfig(config) {
    localStorage.setItem("nh_receipt_config", JSON.stringify(config));
}

// Connect to Bluetooth Printer
async function connectBluetoothPrinter() {
    if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth API is not supported in this browser.");
    }

    try {
        console.log("Requesting Bluetooth device...");
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [PRINTER_SERVICE_UUID] },
                { namePrefix: 'XP-' },
                { namePrefix: 'PT-' },
                { namePrefix: 'RP-' }
            ],
            optionalServices: [PRINTER_SERVICE_UUID]
        });

        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
        printCharacteristic = await service.getCharacteristic(PRINTER_WRITE_CHAR_UUID);
        
        return bluetoothDevice.name;
    } catch (error) {
        console.error("Bluetooth connection failed:", error);
        throw error;
    }
}

// Compile Receipt Data into ESC/POS Binary Commands
function compileEscPosReceipt(order, orderItems, table, config, isKOT = false) {
    const encoder = new TextEncoder();
    const esc = [0x1B];
    const gs = [0x1D];
    
    let buffer = [];

    // Initialize Printer
    buffer.push(...esc, 0x40);

    // KOT printing
    if (isKOT) {
        // Center alignment
        buffer.push(...esc, 0x61, 0x01);
        
        // Double size bold header
        buffer.push(...gs, 0x21, 0x11);
        buffer.push(...encoder.encode("KITCHEN ORDER TICKET\n"));
        buffer.push(...gs, 0x21, 0x00);
        buffer.push(...esc, 0x45, 0x01); // Bold On
        
        const sourceLabel = order.type === "Dine-In" ? `TABLE: ${table ? table.table_number : 'N/A'}` : "PARCEL ORDER";
        buffer.push(...encoder.encode(`${sourceLabel}\n`));
        buffer.push(...esc, 0x45, 0x00); // Bold Off

        // Divider
        const widthCharCount = config.width === "58mm" ? 32 : 48;
        const divider = "-".repeat(widthCharCount) + "\n";
        buffer.push(...encoder.encode(divider));

        // Align Left
        buffer.push(...esc, 0x61, 0x00);
        buffer.push(...encoder.encode(`Token No : KOT-${order.id}\n`));
        buffer.push(...encoder.encode(`Time     : ${order.order_time}\n`));
        buffer.push(...encoder.encode(divider));

        // Items only (qty and name)
        orderItems.forEach(item => {
            buffer.push(...encoder.encode(`${item.quantity} x ${item.item_name}\n`));
        });

        buffer.push(...encoder.encode(divider));
        buffer.push(...encoder.encode("\n\n\n"));
        buffer.push(...gs, 0x56, 0x41, 0x03); // Cut

        return new Uint8Array(buffer);
    }

    // Customer final bill printing
    // Center alignment
    buffer.push(...esc, 0x61, 0x01);

    // Double size Hotel Name
    buffer.push(...gs, 0x21, 0x11);
    buffer.push(...encoder.encode(`${config.hotelName}\n`));

    // Reset size & subhead
    buffer.push(...gs, 0x21, 0x00);
    buffer.push(...esc, 0x45, 0x01);
    buffer.push(...encoder.encode(`${config.tagline}\n`));
    buffer.push(...encoder.encode(`${config.address}\n`));
    buffer.push(...encoder.encode(`Phone: ${config.phone}\n`));
    buffer.push(...esc, 0x45, 0x00); // Bold Off

    const widthCharCount = config.width === "58mm" ? 32 : 48;
    const divider = "-".repeat(widthCharCount) + "\n";
    buffer.push(...encoder.encode(divider));

    // Align Left
    buffer.push(...esc, 0x61, 0x00);
    
    // Header Info
    buffer.push(...encoder.encode(`Bill No  : NH-${order.id}\n`));
    buffer.push(...encoder.encode(`OrderType: ${order.type}\n`));
    if (order.type === "Dine-In") {
        buffer.push(...encoder.encode(`Table No : ${table ? table.table_number : 'N/A'}\n`));
    }
    buffer.push(...encoder.encode(`Time     : ${order.order_time}\n`));
    buffer.push(...encoder.encode(divider));

    // Items header columns
    buffer.push(...esc, 0x45, 0x01); // Bold On
    if (config.width === "58mm") {
        // 32 chars: Item(14) Qty(4) Price(6) Total(8)
        buffer.push(...encoder.encode("Item           Qty  Price  Total\n"));
    } else {
        // 48 chars: Item(22) Qty(6) Price(10) Total(10)
        buffer.push(...encoder.encode("Item                   Qty     Price     Total\n"));
    }
    buffer.push(...esc, 0x45, 0x00); // Bold Off
    buffer.push(...encoder.encode(divider));

    let subtotal = 0;
    orderItems.forEach(item => {
        const total = item.price * item.quantity;
        subtotal += total;
        
        const truncatedName = item.item_name.substring(0, config.width === "58mm" ? 14 : 22);
        if (config.width === "58mm") {
            buffer.push(...encoder.encode(formatReceiptLine(truncatedName, item.quantity.toString(), item.price, total, 58)));
        } else {
            buffer.push(...encoder.encode(formatReceiptLine(truncatedName, item.quantity.toString(), item.price, total, 80)));
        }
    });

    buffer.push(...encoder.encode(divider));

    // Align Right
    buffer.push(...esc, 0x61, 0x02);

    let packing  = order.type === "Parcel" ? (config.packingCharge || 0) : 0;
    let discount = Math.round(subtotal * ((order.discount || 0) / 100));
    let grandTotal = subtotal + packing - discount;

    buffer.push(...encoder.encode(`Subtotal: Rs. ${subtotal.toFixed(2)}\n`));
    if (discount > 0) {
        buffer.push(...encoder.encode(`Discount (${order.discount}%): -Rs. ${discount.toFixed(2)}\n`));
    }
    if (packing > 0) {
        buffer.push(...encoder.encode(`Packing Charge: Rs. ${packing.toFixed(2)}\n`));
    }
    buffer.push(...esc, 0x45, 0x01); // Bold On
    buffer.push(...encoder.encode(`Grand Total: Rs. ${grandTotal.toFixed(2)}\n`));
    buffer.push(...esc, 0x45, 0x00); // Bold Off
    buffer.push(...encoder.encode(divider));

    // Center alignment footer
    buffer.push(...esc, 0x61, 0x01);
    buffer.push(...encoder.encode(`${config.footerMsg}\n\n\n`));

    // Paper Cut
    buffer.push(...gs, 0x56, 0x41, 0x03);

    return new Uint8Array(buffer);
}

function formatReceiptLine(itemName, qty, price, total, paperWidth) {
    const formattedPrice = Number(price).toFixed(0);
    const formattedTotal = Number(total).toFixed(0);

    if (paperWidth === 58) {
        const part1 = itemName.padEnd(14, " ");
        const part2 = qty.padStart(4, " ");
        const part3 = formattedPrice.padStart(6, " ");
        const part4 = formattedTotal.padStart(8, " ");
        return `${part1}${part2}${part3}${part4}\n`;
    } else {
        const part1 = itemName.padEnd(22, " ");
        const part2 = qty.padStart(6, " ");
        const part3 = formattedPrice.padStart(10, " ");
        const part4 = formattedTotal.padStart(10, " ");
        return `${part1}  ${part2}  ${part3}  ${part4}\n`;
    }
}

// Send ESC/POS to Printer
async function sendEscPosToPrinter(byteArray) {
    if (!printCharacteristic) {
        throw new Error("No Bluetooth printer connected.");
    }

    try {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < byteArray.length; i += CHUNK_SIZE) {
            const chunk = byteArray.slice(i, i + CHUNK_SIZE);
            await printCharacteristic.writeValue(chunk);
        }
        return true;
    } catch (error) {
        console.error("Bluetooth printer write error:", error);
        throw error;
    }
}

// HTML Receipt/KOT Visualizer
function generateHtmlReceipt(order, orderItems, table, config, isKOT = false) {
    if (isKOT) {
        let itemsHtml = orderItems.map(item => `
            <div style="font-size: 14px; margin-bottom: 6px;">
                <strong>${item.quantity}</strong> x ${item.item_name}
            </div>
        `).join("");

        return `
            <div class="thermal-receipt paper-${config.width === '58mm' ? '58' : '80'}" style="border-top:6px solid #e11d48;">
                <div class="receipt-header text-center">
                    <h2 style="color:#e11d48; letter-spacing: 1px;">KITCHEN ORDER</h2>
                    <p style="font-size: 13px; font-weight: 700;">
                        ${order.type === 'Dine-In' ? `TABLE: ${table ? table.table_number : 'N/A'}` : 'PARCEL / TAKEAWAY'}
                    </p>
                </div>
                <hr class="receipt-divider">
                <div class="receipt-info" style="font-size: 12px;">
                    <div><strong>KOT Token:</strong> KOT-${order.id}</div>
                    <div><strong>Order Type:</strong> ${order.type}</div>
                    <div><strong>Time:</strong> ${order.order_time}</div>
                </div>
                <hr class="receipt-divider">
                <div class="receipt-items" style="padding: 10px 0;">
                    ${itemsHtml}
                </div>
                <hr class="receipt-divider">
                <div class="receipt-footer text-center" style="font-size: 9px; color: #666;">
                    *KOT Copy - Kitchen Output only*
                </div>
            </div>
        `;
    }

    let subtotal = 0;
    let itemsHtml = `
        <div class="receipt-item-row header">
            <span>Item</span>
            <span class="text-center">Qty</span>
            <span class="text-right">Price</span>
            <span class="text-right">Total</span>
        </div>
        <hr class="receipt-divider">
    `;

    orderItems.forEach(item => {
        const total = item.price * item.quantity;
        subtotal += total;
        itemsHtml += `
            <div class="receipt-item-row">
                <span>${item.item_name}</span>
                <span class="text-center">${item.quantity}</span>
                <span class="text-right">${item.price}</span>
                <span class="text-right">${total}</span>
            </div>
        `;
    });

    let packing  = order.type === "Parcel" ? (config.packingCharge || 0) : 0;
    let discount = Math.round(subtotal * ((order.discount || 0) / 100));
    let grandTotal = subtotal + packing - discount;

    return `
        <div class="thermal-receipt paper-${config.width === '58mm' ? '58' : '80'}">
            <div class="receipt-header text-center">
                <h2>${config.hotelName}</h2>
                <p style="font-size: 10px; font-weight: 600; color:#444;">${config.tagline}</p>
                <p>${config.address}</p>
                <p>Phone: ${config.phone}</p>
            </div>
            <hr class="receipt-divider">
            <div class="receipt-info">
                <div><strong>Bill No:</strong> NH-${order.id}</div>
                <div><strong>Order Type:</strong> ${order.type}</div>
                ${order.type === 'Dine-In' ? `<div><strong>Table Number:</strong> ${table ? table.table_number : 'N/A'}</div>` : ''}
                <div><strong>Order Time:</strong> ${order.order_time}</div>
            </div>
            <hr class="receipt-divider">
            <div class="receipt-items">
                ${itemsHtml}
            </div>
            <hr class="receipt-divider">
            <div class="receipt-summary text-right">
                <div><span>Subtotal:</span> <strong>Rs. ${subtotal.toFixed(2)}</strong></div>
                ${discount > 0 ? `<div><span>Discount (${order.discount}%):</span> <strong>-Rs. ${discount.toFixed(2)}</strong></div>` : ''}
                ${packing > 0 ? `<div><span>Packing Charge:</span> <strong>Rs. ${packing.toFixed(2)}</strong></div>` : ''}
                <hr class="receipt-divider sub-divider">
                <div class="grand-total"><span>Grand Total:</span> <strong>Rs. ${grandTotal.toFixed(2)}</strong></div>
            </div>
            <hr class="receipt-divider">
            <div class="receipt-footer text-center">
                <p>${config.footerMsg}</p>
                <p class="barcode">*NH-${order.id}*</p>
                <p class="timestamp">Printed: ${new Date().toLocaleString()}</p>
            </div>
        </div>
    `;
}

// EXPORT TO GLOBAL WINDOW OBJECT FOR CORS-FREE RUNS
window.Printer = {
    getReceiptConfig,
    saveReceiptConfig,
    connectBluetoothPrinter,
    compileEscPosReceipt,
    sendEscPosToPrinter,
    generateHtmlReceipt
};
