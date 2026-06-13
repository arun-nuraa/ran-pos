// db.js - Mock SQL Database Service for Naidu Hotel Restaurant Billing
// Stores data in LocalStorage and implements a lightweight SQL parser.

const DEFAULT_TABLES = [
    { id: 1, table_number: "T-01", capacity: 2, status: "Vacant" },
    { id: 2, table_number: "T-02", capacity: 2, status: "Occupied" },
    { id: 3, table_number: "T-03", capacity: 4, status: "Vacant" },
    { id: 4, table_number: "T-04", capacity: 4, status: "Occupied" },
    { id: 5, table_number: "T-05", capacity: 4, status: "Billing" },
    { id: 6, table_number: "T-06", capacity: 6, status: "Vacant" },
    { id: 7, table_number: "T-07", capacity: 6, status: "Vacant" },
    { id: 8, table_number: "T-08", capacity: 8, status: "Vacant" }
];

const DEFAULT_MENU = [
    { id: 101, name: "Naidu Special Chicken Biryani", price: 280, category: "Biryani", veg: false },
    { id: 102, name: "Mutton Dum Biryani", price: 360, category: "Biryani", veg: false },
    { id: 103, name: "Traditional Veg Meals", price: 150, category: "Meals", veg: true },
    { id: 104, name: "Andhra Chicken Fry", price: 220, category: "Starters", veg: false },
    { id: 105, name: "Gobi Manchurian", price: 160, category: "Starters", veg: true },
    { id: 106, name: "Kerala Parotta", price: 40, category: "Breads", veg: true },
    { id: 107, name: "Butter Naan", price: 60, category: "Breads", veg: true },
    { id: 108, name: "Cold Soft Drink", price: 40, category: "Drinks", veg: true },
    { id: 109, name: "Special Filter Coffee", price: 30, category: "Drinks", veg: true }
];

const DEFAULT_ORDERS = [
    { id: 10001, table_id: 2, type: "Dine-In", order_time: "17:15", status: "Active", packing_charge: 0, discount: 0 },
    { id: 10002, table_id: 4, type: "Dine-In", order_time: "17:30", status: "Active", packing_charge: 0, discount: 0 },
    { id: 10003, table_id: 5, type: "Dine-In", order_time: "16:45", status: "Active", packing_charge: 0, discount: 10 },
    // A sample active parcel order (table_id: null)
    { id: 10004, table_id: null, type: "Parcel", order_time: "17:35", status: "Active", packing_charge: 30, discount: 0 }
];

const DEFAULT_ORDER_ITEMS = [
    { id: 50001, order_id: 10001, item_name: "Naidu Special Chicken Biryani", price: 280, quantity: 2 },
    { id: 50002, order_id: 10001, item_name: "Kerala Parotta", price: 40, quantity: 4 },
    { id: 50003, order_id: 10001, item_name: "Cold Soft Drink", price: 40, quantity: 2 },
    { id: 50004, order_id: 10002, item_name: "Mutton Dum Biryani", price: 360, quantity: 1 },
    { id: 50005, order_id: 10002, item_name: "Andhra Chicken Fry", price: 220, quantity: 1 },
    { id: 50006, order_id: 10003, item_name: "Traditional Veg Meals", price: 150, quantity: 3 },
    { id: 50007, order_id: 10003, item_name: "Special Filter Coffee", price: 30, quantity: 3 },
    { id: 50008, order_id: 10004, item_name: "Naidu Special Chicken Biryani", price: 280, quantity: 3 }
];

// Initialize database
function initDB() {
    if (!localStorage.getItem("nh_tables")) {
        localStorage.setItem("nh_tables", JSON.stringify(DEFAULT_TABLES));
        localStorage.setItem("nh_menu_items", JSON.stringify(DEFAULT_MENU));
        localStorage.setItem("nh_orders", JSON.stringify(DEFAULT_ORDERS));
        localStorage.setItem("nh_order_items", JSON.stringify(DEFAULT_ORDER_ITEMS));
        console.log("Naidu Hotel Mock Database Initialized.");
    }
}

// Low-level storage getters and setters
function getTable(tableName) {
    const data = localStorage.getItem(`nh_${tableName}`);
    return data ? JSON.parse(data) : [];
}

function saveTable(tableName, data) {
    localStorage.setItem(`nh_${tableName}`, JSON.stringify(data));
}

// Reset Database
function resetDB() {
    localStorage.removeItem("nh_tables");
    localStorage.removeItem("nh_menu_items");
    localStorage.removeItem("nh_orders");
    localStorage.removeItem("nh_order_items");
    initDB();
}

// Interactive SQL Engine for Student Learning
function executeSQL(sqlStr) {
    const cleanSql = sqlStr.trim().replace(/\s+/g, ' ');
    const lowerCleanSql = cleanSql.toLowerCase();

    try {
        // 1. SELECT Query
        if (lowerCleanSql.startsWith("select")) {
            const selectMatch = cleanSql.match(/select\s+(.+?)\s+from\s+([a-zA-Z_0-9]+)(?:\s+where\s+(.+))?/i);
            if (!selectMatch) {
                throw new Error("Syntax Error: Supported format: SELECT columns FROM table [WHERE col = val]");
            }

            const colPart = selectMatch[1].trim();
            const tableName = selectMatch[2].trim().toLowerCase();
            const wherePart = selectMatch[3] ? selectMatch[3].trim() : null;

            const table = getTable(tableName);
            if (!table || table.length === 0 && !localStorage.getItem(`nh_${tableName}`)) {
                throw new Error(`Table '${tableName}' not found. Available tables: tables, menu_items, orders, order_items`);
            }

            let filteredRows = [...table];
            if (wherePart) {
                filteredRows = applyWhereFilter(filteredRows, wherePart);
            }

            let finalRows = [];
            let columns = [];
            if (colPart === "*") {
                if (filteredRows.length > 0) {
                    columns = Object.keys(filteredRows[0]);
                } else {
                    columns = getTableSchemaColumns(tableName);
                }
                finalRows = filteredRows;
            } else {
                columns = colPart.split(",").map(c => c.trim());
                finalRows = filteredRows.map(row => {
                    let newRow = {};
                    columns.forEach(col => {
                        newRow[col] = row[col] !== undefined ? row[col] : null;
                    });
                    return newRow;
                });
            }

            return {
                success: true,
                columns: columns,
                rows: finalRows,
                affectedRows: 0,
                message: `SELECT returned ${finalRows.length} rows.`
            };
        }

        // 2. UPDATE Query
        if (lowerCleanSql.startsWith("update")) {
            const updateMatch = cleanSql.match(/update\s+([a-zA-Z_0-9]+)\s+set\s+(.+?)(?:\s+where\s+(.+))?/i);
            if (!updateMatch) {
                throw new Error("Syntax Error: Supported format: UPDATE table SET col1 = val1, col2 = val2 WHERE condition");
            }

            const tableName = updateMatch[1].trim().toLowerCase();
            const setPart = updateMatch[2].trim();
            const wherePart = updateMatch[3] ? updateMatch[3].trim() : null;

            const table = getTable(tableName);
            if (!table || table.length === 0 && !localStorage.getItem(`nh_${tableName}`)) {
                throw new Error(`Table '${tableName}' not found.`);
            }

            const assignments = {};
            const setTerms = setPart.split(/,(?=(?:[^']*'[^']*')*[^']*$)/);
            setTerms.forEach(term => {
                const parts = term.split("=");
                if (parts.length !== 2) throw new Error(`Invalid SET assignment: ${term}`);
                const col = parts[0].trim();
                let val = parts[1].trim();
                if (val.startsWith("'") && val.endsWith("'")) {
                    val = val.substring(1, val.length - 1);
                } else if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.substring(1, val.length - 1);
                } else {
                    val = isNaN(val) ? val : Number(val);
                }
                assignments[col] = val;
            });

            let affectedCount = 0;
            const updatedTable = table.map(row => {
                let matches = true;
                if (wherePart) {
                    matches = checkRowMatchesWhere(row, wherePart);
                }
                if (matches) {
                    affectedCount++;
                    return { ...row, ...assignments };
                }
                return row;
            });

            saveTable(tableName, updatedTable);
            window.dispatchEvent(new CustomEvent("db-updated", { detail: { table: tableName } }));

            return {
                success: true,
                columns: [],
                rows: [],
                affectedRows: affectedCount,
                message: `Query OK, ${affectedCount} rows affected.`
            };
        }

        // 3. INSERT Query
        if (lowerCleanSql.startsWith("insert")) {
            const insertMatch = cleanSql.match(/insert\s+into\s+([a-zA-Z_0-9]+)\s*\((.+?)\)\s*values\s*\((.+?)\)/i);
            if (!insertMatch) {
                throw new Error("Syntax Error: Supported format: INSERT INTO table (col1, col2) VALUES (val1, val2)");
            }

            const tableName = insertMatch[1].trim().toLowerCase();
            const colsList = insertMatch[2].split(",").map(c => c.trim());
            const valsListRaw = insertMatch[3].split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map(v => v.trim());

            if (colsList.length !== valsListRaw.length) {
                throw new Error("Column count does not match value count.");
            }

            const table = getTable(tableName);
            if (!table || table.length === 0 && !localStorage.getItem(`nh_${tableName}`)) {
                throw new Error(`Table '${tableName}' not found.`);
            }

            const newRow = {};
            let maxId = 0;
            table.forEach(r => { if (r.id && r.id > maxId) maxId = r.id; });
            newRow.id = maxId + 1;

            colsList.forEach((col, index) => {
                let val = valsListRaw[index];
                if (val.startsWith("'") && val.endsWith("'")) {
                    val = val.substring(1, val.length - 1);
                } else if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.substring(1, val.length - 1);
                } else {
                    val = isNaN(val) ? val : Number(val);
                }
                newRow[col] = val;
            });

            table.push(newRow);
            saveTable(tableName, table);
            window.dispatchEvent(new CustomEvent("db-updated", { detail: { table: tableName } }));

            return {
                success: true,
                columns: [],
                rows: [],
                affectedRows: 1,
                message: `Query OK, 1 row affected (ID: ${newRow.id}).`
            };
        }

        // 4. DELETE Query
        if (lowerCleanSql.startsWith("delete")) {
            const deleteMatch = cleanSql.match(/delete\s+from\s+([a-zA-Z_0-9]+)(?:\s+where\s+(.+))?/i);
            if (!deleteMatch) {
                throw new Error("Syntax Error: Supported format: DELETE FROM table WHERE condition");
            }

            const tableName = deleteMatch[1].trim().toLowerCase();
            const wherePart = deleteMatch[2] ? deleteMatch[2].trim() : null;

            const table = getTable(tableName);
            if (!table || table.length === 0 && !localStorage.getItem(`nh_${tableName}`)) {
                throw new Error(`Table '${tableName}' not found.`);
            }

            let initialCount = table.length;
            let finalTable = [];
            if (wherePart) {
                finalTable = table.filter(row => !checkRowMatchesWhere(row, wherePart));
            } else {
                finalTable = [];
            }

            let affectedCount = initialCount - finalTable.length;
            saveTable(tableName, finalTable);
            window.dispatchEvent(new CustomEvent("db-updated", { detail: { table: tableName } }));

            return {
                success: true,
                columns: [],
                rows: [],
                affectedRows: affectedCount,
                message: `Query OK, ${affectedCount} rows affected.`
            };
        }

        throw new Error("Unsupported SQL statement. Use SELECT, INSERT, UPDATE, or DELETE.");
    } catch (e) {
        return {
            success: false,
            columns: [],
            rows: [],
            affectedRows: 0,
            message: `SQL Error: ${e.message}`
        };
    }
}

// SQL Parser Helper functions
function applyWhereFilter(rows, whereStr) {
    return rows.filter(row => checkRowMatchesWhere(row, whereStr));
}

function checkRowMatchesWhere(row, whereStr) {
    const matches = whereStr.match(/([a-zA-Z_0-9]+)\s*(=|!=|>|<|like)\s*(.+)/i);
    if (!matches) return true;
    const col = matches[1].trim();
    const op = matches[2].trim().toLowerCase();
    let val = matches[3].trim();

    if (val.startsWith("'") && val.endsWith("'")) {
        val = val.substring(1, val.length - 1);
    } else if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
    } else {
        val = isNaN(val) ? val : Number(val);
    }

    const rowVal = row[col];
    if (rowVal === undefined) return false;

    if (op === "=") return rowVal == val;
    if (op === "!=") return rowVal != val;
    if (op === ">") return rowVal > val;
    if (op === "<") return rowVal < val;
    if (op === "like") {
        const regexStr = String(val).replace(/%/g, ".*");
        const regex = new RegExp(`^${regexStr}$`, "i");
        return regex.test(String(rowVal));
    }
    return false;
}

function getTableSchemaColumns(tableName) {
    const schemas = {
        tables: ["id", "table_number", "capacity", "status"],
        menu_items: ["id", "name", "price", "category", "veg"],
        orders: ["id", "table_id", "type", "order_time", "status", "packing_charge", "discount"],
        order_items: ["id", "order_id", "item_name", "price", "quantity"]
    };
    return schemas[tableName] || [];
}

// EXPORT TO GLOBAL WINDOW OBJECT FOR CORS-FREE RUNS
window.DB = {
    initDB,
    getTable,
    saveTable,
    resetDB,
    executeSQL
};
