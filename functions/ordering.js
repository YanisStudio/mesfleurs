// 花禮預訂規則（伺服器版）
//
// 跟前台 js/ordering.js 是同一套規則（預設值、normalize、可選日期），
// 建立訂單的 Cloud Function（index.js 的 createOrder）用它在伺服器端再檢查一次，
// 不相信瀏覽器送來的日期、時段與運費。修改規則時兩邊要一起改。
//
// 日期一律用台灣時區（Asia/Taipei）計算「今天」，不受 Cloud Functions 主機時區影響。

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

const DEFAULTS = {
    acceptingOrders: true,
    pauseMessage: "",
    minLeadDays: 5,
    maxAdvanceDays: 60,
    weeklyClosedDays: [0],
    closedDates: [],
    pickupTimeSlots: ["10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00"],
    delivery: {
        enabled: true,
        fee: 0,
        freeThreshold: 0,
        timeSlots: ["不指定", "13時前", "14-18時"]
    }
};

const DEFAULT_PAUSE_MESSAGE = "目前暫停接受線上預訂，造成不便敬請見諒。";

function toInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function isDateString(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanSlots(list) {
    return Array.isArray(list) ? list.map((s) => String(s || "").trim()).filter(Boolean) : [];
}

function normalize(data) {
    const d = data || {};
    const settings = JSON.parse(JSON.stringify(DEFAULTS));
    settings.acceptingOrders = d.acceptingOrders !== false;
    settings.pauseMessage = typeof d.pauseMessage === "string" ? d.pauseMessage.trim() : "";
    settings.minLeadDays = toInt(d.minLeadDays, DEFAULTS.minLeadDays, 0, 60);
    settings.maxAdvanceDays = Math.max(settings.minLeadDays, toInt(d.maxAdvanceDays, DEFAULTS.maxAdvanceDays, 1, 365));
    if (Array.isArray(d.weeklyClosedDays)) {
        settings.weeklyClosedDays = d.weeklyClosedDays
            .map(Number)
            .filter((n, i, all) => n >= 0 && n <= 6 && all.indexOf(n) === i);
    }
    if (Array.isArray(d.closedDates)) {
        settings.closedDates = d.closedDates
            .filter((r) => r && isDateString(r.start))
            .map((r) => ({ start: r.start, end: isDateString(r.end) && r.end >= r.start ? r.end : r.start }));
    }
    const pickupSlots = cleanSlots(d.pickupTimeSlots);
    if (pickupSlots.length > 0) settings.pickupTimeSlots = pickupSlots;
    if (d.delivery && typeof d.delivery === "object") {
        const slots = cleanSlots(d.delivery.timeSlots);
        settings.delivery = {
            enabled: d.delivery.enabled !== false,
            fee: toInt(d.delivery.fee, 0, 0, 100000),
            freeThreshold: toInt(d.delivery.freeThreshold, 0, 0, 10000000),
            timeSlots: slots.length > 0 ? slots : DEFAULTS.delivery.timeSlots.slice()
        };
    }
    return settings;
}

// ---------- 日期工具：用 UTC 的 Date 物件當作「純日期」計算，避免時區位移 ----------

function todayInTaipei() {
    // en-CA 的格式剛好是 YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function parseDate(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(date) {
    return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
    const d = parseDate(value);
    d.setUTCDate(d.getUTCDate() + days);
    return toDateString(d);
}

// 2026-10-05 → 2026/10/05（一）
function formatFullDate(value) {
    if (!isDateString(value)) return value || "";
    return `${value.replace(/-/g, "/")}（${WEEKDAY_NAMES[parseDate(value).getUTCDay()]}）`;
}

function isClosed(settings, value) {
    if (settings.weeklyClosedDays.indexOf(parseDate(value).getUTCDay()) !== -1) return true;
    return settings.closedDates.some((r) => value >= r.start && value <= r.end);
}

// 到店自取：當天要營業；宅配：顧客選的是到貨日，店家前一天出貨，所以前一天要營業
function isDateOpenFor(settings, value, method) {
    if (method === "delivery") return !isClosed(settings, addDays(value, -1));
    return !isClosed(settings, value);
}

/**
 * @returns {string} 空字串代表 OK，否則是錯誤訊息（文案跟前台 validatePickupDate 一致）
 */
function validatePickupDate(settings, value, method) {
    if (!isDateString(value)) return method === "delivery" ? "請選擇到貨日期" : "請選擇取花日期";
    const today = todayInTaipei();
    const earliest = addDays(today, settings.minLeadDays);
    if (value < earliest) {
        return `花禮需要提前 ${settings.minLeadDays} 天預訂，最早可選 ${formatFullDate(earliest)}`;
    }
    const last = addDays(today, settings.maxAdvanceDays);
    if (value > last) return `目前只開放預訂到 ${formatFullDate(last)}`;
    if (!isDateOpenFor(settings, value, method)) {
        return method === "delivery"
            ? `${formatFullDate(value)} 的前一天公休無法出貨，請改選其他日期`
            : `${formatFullDate(value)} 公休，請改選其他日期`;
    }
    return "";
}

function pauseMessage(settings) {
    return settings.pauseMessage || DEFAULT_PAUSE_MESSAGE;
}

function deliveryFee(settings, subtotal) {
    const d = settings.delivery;
    if (!d.enabled) return 0;
    if (d.freeThreshold > 0 && subtotal >= d.freeThreshold) return 0;
    return d.fee;
}

module.exports = {
    normalize,
    todayInTaipei,
    validatePickupDate,
    pauseMessage,
    deliveryFee
};
