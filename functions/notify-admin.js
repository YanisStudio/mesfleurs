// 有新訂單時寄通知信給管理員（跟寄給顧客的「訂單成立通知信」分開，
// 其中一封寄失敗不會影響另一封）。
//
// 收件人：ADMIN_ORDER_NOTIFY_EMAILS 有填就寄給那些信箱；沒填就寄給寄件人信箱
//（部署時設定的 SENDER_EMAIL，也就是店家自己的信箱）。
// 要增減收件人，改下面的清單再重新部署 functions 即可：
//   firebase deploy --only functions:notifyAdminNewOrder

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { sendEmail } = require("./brevo");
const { ADMIN_ORDER_URL } = require("./site");

// 例：["owner@gmail.com", "staff@gmail.com"]；留空 = 寄給 SENDER_EMAIL
const ADMIN_ORDER_NOTIFY_EMAILS = [];

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const SENDER_EMAIL = defineString("SENDER_EMAIL");

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCurrency(amount) {
    return `NT$ ${Number(amount || 0).toLocaleString("zh-TW")}`;
}

// 訂單時間用台灣時區顯示（Cloud Functions 主機是 UTC），格式固定為 YYYY/MM/DD HH:mm。
// 自己組字串而不是直接用 format()：不同 Node 版本的語系資料，日期和時間中間
// 可能是特殊空白（例如 U+2009），結果不穩定
function formatTaipeiTime(timestamp) {
    const date = timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date();
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Taipei",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date).forEach((part) => { parts[part.type] = part.value; });
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

// 2026-10-05 → 2026/10/05（一）
function formatPickupDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "";
    const [y, m, d] = value.split("-").map(Number);
    return `${value.replace(/-/g, "/")}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
}

const SHIPPING_TEXT = { delivery: "黑貓冷藏宅配", pickup: "到店自取" };
const PAYMENT_TEXT = { transfer: "銀行轉帳" };

function buildAdminOrderEmail(order, orderId) {
    const customer = order.customer || {};
    const fulfillment = order.fulfillment || {};
    const isDelivery = order.shipping === "delivery";
    const items = Array.isArray(order.items) ? order.items : [];
    const row = (label, value) =>
        `<tr><td style="padding:4px 8px;color:#777;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 8px;">${value}</td></tr>`;
    const itemRows = items.map((item) => `
        <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(item.name)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">x${escapeHtml(item.quantity)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(Number(item.price) * Number(item.quantity))}</td>
        </tr>`).join("");
    const multiline = (text) => escapeHtml(text).replace(/\n/g, "<br>");

    const subject = `【新訂單】${order.orderNumber || orderId}｜${customer.name || "顧客"}｜${formatCurrency(order.total)}`;
    const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#333;">
            <h2 style="color:#8a6526;margin-bottom:4px;">有一筆新的花禮預訂</h2>
            <p style="margin-top:0;color:#777;">${escapeHtml(formatTaipeiTime(order.orderDate))}</p>
            <table style="border-collapse:collapse;margin:8px 0;">
                ${row("訂單編號", `<b>${escapeHtml(order.orderNumber || orderId)}</b>`)}
                ${row("顧客", escapeHtml(customer.name))}
                ${row("電話", escapeHtml(customer.phone))}
                ${row("Email", escapeHtml(customer.email) || "（未填）")}
                ${row("會員", order.userId ? "是" : "否（訪客結帳）")}
                ${row("寄送方式", escapeHtml(SHIPPING_TEXT[order.shipping] || order.shipping))}
                ${row(isDelivery ? "希望到貨" : "取花時間", `<b>${escapeHtml(formatPickupDate(order.pickupDate))} ${escapeHtml(order.pickupTimeSlot)}</b>`)}
                ${isDelivery ? row("地址", escapeHtml(customer.address)) : ""}
                ${isDelivery && fulfillment.recipientName ? row("收花人", `${escapeHtml(fulfillment.recipientName)} ${escapeHtml(fulfillment.recipientPhone)}`) : ""}
                ${row("付款", escapeHtml(PAYMENT_TEXT[order.payment] || order.payment))}
            </table>
            <table style="width:100%;border-collapse:collapse;margin:12px 0;">
                <thead>
                    <tr style="background:#f5f5f5;">
                        <th style="padding:6px 8px;text-align:left;">花禮</th>
                        <th style="padding:6px 8px;text-align:center;">數量</th>
                        <th style="padding:6px 8px;text-align:right;">小計</th>
                    </tr>
                </thead>
                <tbody>${itemRows}</tbody>
            </table>
            <p style="margin:4px 0;">商品小計：${formatCurrency(order.subtotal)}</p>
            <p style="margin:4px 0;">運費：${formatCurrency(order.shippingFee)}</p>
            <p style="margin:4px 0;font-size:1.1em;"><b>訂單總額：${formatCurrency(order.total)}</b></p>
            ${order.cardMessage ? `<div style="background:#f8f1e3;padding:10px 12px;border-radius:6px;margin:12px 0;"><b>卡片內容：</b><br>${multiline(order.cardMessage)}</div>` : ""}
            ${order.notes ? `<div style="background:#fff8e1;padding:10px 12px;border-radius:6px;margin:12px 0;"><b>其他需求：</b><br>${multiline(order.notes)}</div>` : ""}
            <p style="margin-top:20px;">
                <a href="${ADMIN_ORDER_URL}${encodeURIComponent(orderId)}"
                   style="display:inline-block;background:#8a6526;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">到後台查看這筆訂單</a>
            </p>
            <p style="color:#999;font-size:0.85em;">這是網站自動寄出的管理員通知。</p>
        </div>`;
    return { subject, html };
}

function recipients(senderEmail) {
    if (ADMIN_ORDER_NOTIFY_EMAILS.length > 0) return ADMIN_ORDER_NOTIFY_EMAILS;
    return senderEmail ? [senderEmail] : [];
}

exports.notifyAdminNewOrder = onDocumentCreated(
    { document: "orders/{orderId}", secrets: [BREVO_API_KEY] },
    async (event) => {
        const order = event.data?.data();
        const orderId = event.params.orderId;
        if (!order) return;

        const senderEmail = SENDER_EMAIL.value();
        const { subject, html } = buildAdminOrderEmail(order, orderId);
        // 一位收件人寄失敗不影響其他人；錯誤只記 log，不丟出去（不讓 Cloud Functions 重試，避免重複寄信）
        for (const toEmail of recipients(senderEmail)) {
            try {
                await sendEmail({ apiKey: BREVO_API_KEY.value(), senderEmail, toEmail, subject, html });
                logger.info("新訂單管理員通知信已寄出", { orderId, toEmail });
            } catch (error) {
                logger.error("新訂單管理員通知信寄送失敗", { orderId, toEmail, error: error.message });
            }
        }
    }
);

exports._internal = { buildAdminOrderEmail, recipients, ADMIN_ORDER_NOTIFY_EMAILS };
