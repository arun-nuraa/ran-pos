# Naidu Hotel - Food Restaurant Billing POS (Study Guide)

Welcome to **Naidu Hotel**—a traditional South Indian food restaurant billing and order management console. This codebase has been rebuilt using Vanilla HTML, CSS, and JS (ES5/ES6) with global workspaces (`window.DB` and `window.Printer`) to run **CORS-free** directly on double-clicking [index.html](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/index.html).

---

## 📂 File Architecture

- **[index.html](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/index.html)**: Defines the operations screen, 8 dining tables layout, food menu selection cart, receipt dialogs, and the SQL console.
- **[styles.css](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/styles.css)**: Implements an **Antigravity-inspired** dark glassmorphism design with neon borders, active glowing indicators, and printable thermal receipt formatting.
- **[db.js](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/db.js)**: Holds the restaurant tables, menus, orders, and details in `localStorage`. Features the educational SQL query processor.
- **[printer.js](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/printer.js)**: Integrates Web Bluetooth printing. Compiles ESC/POS command buffers for both **Kitchen Order Tickets (KOT)** and **Final Bills**.
- **[app.js](file:///C:/Users/ASUS/.gemini/antigravity/scratch/hotel-billing-system/app.js)**: Manages table sessions, takeaway parcel creations, checkout grand totals (Subtotal + GST + Packing Fee - Discount), KOT prints, and UI sync.

---

## 💾 Database Schema

The mock restaurant database contains 4 key tables:

### 1. `tables`
Exactly 8 dining tables mapping:
| Column | Type | Description |
|---|---|---|
| `id` | `INT (PK)` | Unique code (1 to 8) |
| `table_number` | `VARCHAR(10)` | Table name display (T-01 to T-08) |
| `capacity` | `INT` | Max dining seats (2, 4, 6, or 8) |
| `status` | `VARCHAR(20)` | Status (Vacant, Occupied, Billing) |

### 2. `menu_items`
Naidu Hotel South Indian specialty food menu catalog:
| Column | Type | Description |
|---|---|---|
| `id` | `INT (PK)` | Item code (e.g. 101, 102) |
| `name` | `VARCHAR(100)` | Food name (Biryani, Meals, Parotta, etc.) |
| `price` | `DECIMAL` | Price in Rs. |
| `category` | `VARCHAR(50)` | Category (Biryani, Meals, Starters, Breads, Drinks) |
| `veg` | `BOOLEAN` | true if vegetarian, false if non-vegetarian |

### 3. `orders`
Dining sessions and Parcel takeaways:
| Column | Type | Description |
|---|---|---|
| `id` | `INT (PK)` | Unique order ID |
| `table_id` | `INT (FK) NULL` | Reference to `tables.id` (NULL for Takeaway Parcels) |
| `type` | `VARCHAR(20)` | Session type (Dine-In, Parcel) |
| `order_time` | `TIME` | Time order was opened |
| `status` | `VARCHAR(20)` | Session status (Active, Completed) |
| `packing_charge` | `DECIMAL` | Flat fee for parcels (Rs. 20) |
| `discount` | `DECIMAL` | Percentage discount applied |

### 4. `order_items`
Specific items charged in a transaction:
| Column | Type | Description |
|---|---|---|
| `id` | `INT (PK)` | Unique row ID |
| `order_id` | `INT (FK)` | Links to `orders.id` |
| `item_name` | `VARCHAR(100)` | Name of menu item |
| `price` | `DECIMAL` | Unit price at time of order |
| `quantity` | `INT` | Quantity ordered |

---

## 🎓 Restaurant SQL Console Playground

Type these practice queries inside the **SQL Console** tab. Since queries run locally and mutate states, running an `UPDATE` will change the dining table color indicator immediately!

### Practice Queries:

1. **Find all empty tables where customers can sit:**
   ```sql
   SELECT * FROM tables WHERE status = 'Vacant';
   ```

2. **List all Non-Veg Biryanis on the menu:**
   ```sql
   SELECT name, price FROM menu_items WHERE category = 'Biryani' AND veg = 0;
   ```

3. **Check all active parcel takeaway orders:**
   ```sql
   SELECT id, order_time, packing_charge FROM orders WHERE type = 'Parcel' AND status = 'Active';
   ```

4. **Change Table 3 back to Vacant after housekeeping cleans it:**
   ```sql
   UPDATE tables SET status = 'Vacant' WHERE id = 3;
   ```

5. **Manually mark Table 5 as Billing pending:**
   ```sql
   UPDATE tables SET status = 'Billing' WHERE id = 5;
   ```

6. **Find menu items cheaper than Rs. 100:**
   ```sql
   SELECT name, price FROM menu_items WHERE price < 100;
   ```

---

## 🖨️ KOT vs. Customer Bill printing

In restaurant environments, printing works in two modes using Bluetooth thermal ESC/POS byte buffers:

1. **Kitchen Order Ticket (KOT):** 
   - Uses `[0x1B, 0x61, 0x01]` (Align center) and `[0x1D, 0x21, 0x11]` (Double font size) to header `KITCHEN ORDER`.
   - Lists only **Quantities and Item Names** (e.g. `2x Mutton Dum Biryani`). It hides price columns entirely so the chef knows what to cook without financial details.
2. **Customer Bill:**
   - Resets font sizes. Prints Naidu Hotel headers, address, GSTIN, and phone.
   - Lists quantities, item unit prices, and subtotal columns.
   - Appends packaging charges (flat Rs. 20 for parcels) and calculates 5% GST tax.
   - Triggers paper cutter command `[0x1D, 0x56, 0x41, 0x03]` at the end.
