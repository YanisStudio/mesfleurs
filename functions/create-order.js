// 建立訂單（結帳頁 payment.html 呼叫的 Callable Function）
//
// 訂單一律由這裡建立：價格、小計、運費、總額都用 Firestore 上的商品資料與
// 「訂購設定」在伺服器端計算，不相信瀏覽器送來的金額；暫停接單、寄送方式、
// 取花日期、時段也在這裡再檢查一次。Firestore 規則禁止顧客直接寫入 orders、
// 直接改商品庫存，所以繞過網站自己送一筆低價訂單的做法行不通。
//
// 建立訂單後，index.js 的 sendOrderConfirmationEmail 會照常寄出訂單成立通知信。

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const OrderingRules = require("./ordering");

const MAX_ITEMS = 30;
const MAX_QUANTITY = 99;
const ORDER_NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 下單頻率限制：同一個身分在時間窗內最多能成立幾筆訂單。
//
// 這支函式可以被匿名呼叫（訪客結帳本來就不需要登入），所以不加限制的話，
// 寫個腳本重複呼叫就能把庫存全部扣光——金額改不了（伺服器重算），但真正想買的人
// 看到的全是「無庫存」。這不是假設，用 curl 不帶任何登入就打得到。
//
// 數字放寬一點：真實顧客很少在 10 分鐘內成立超過 5 筆訂單，而攻擊者要刷光庫存
// 需要的次數遠高於此。寧可寬鬆也不要擋到真的要買的人。
const RATE_LIMIT_MAX_ORDERS = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// 字串欄位：去頭尾空白並限制長度；required 時空字串直接擋下
function textField(value, label, maxLength, required) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new HttpsError("invalid-argument", `請填寫${label}`);
    if (text.length > maxLength) throw new HttpsError("invalid-argument", `${label}最多 ${maxLength} 個字`);
    return text;
}

// 訂單編號：MF + 台灣日期 + 4 碼隨機英數（跟舊版前台產生的格式一樣）
function generateOrderNumber() {
    let random = "";
    crypto.randomBytes(4).forEach((b) => { random += ORDER_NUMBER_CHARS[b % ORDER_NUMBER_CHARS.length]; });
    return `MF${OrderingRules.todayInTaipei().replace(/-/g, "")}-${random}`;
}

// 頻率限制的識別鍵：登入的人用 uid，訪客用來源 IP。
//
// 不存原始 IP：只存雜湊值，比對得出「是不是同一個來源」就夠了，不需要知道是誰。
//
// 真實來源要取 x-forwarded-for 的「最後一段」：Google 會把連線進來的 IP 接在最後面，
// 前面的內容是發送端自己帶的，可以隨便填。2026-10 實測（部署暫時的探測程式）：
//   不帶標頭      → "真實IP"
//   帶 "1.2.3.4" → "1.2.3.4,真實IP"（rawRequest.ip 也會變成 1.2.3.4）
// 以前取第一段，用程式每次帶不同的值就能繞過「10 分鐘 5 筆」的限制
function rateLimitKey(request) {
    if (request.auth?.uid) return "uid_" + request.auth.uid;
    const raw = request.rawRequest || {};
    const forwarded = String(raw.headers?.["x-forwarded-for"] || "");
    const ip = forwarded.split(",").pop().trim() || "unknown";
    return "ip_" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// 檢查並累加計數。回傳要寫回去的新狀態，由呼叫端在 transaction 裡一起寫，
// 確保同時湧入的請求不會各自讀到舊的計數而一起放行
function checkRateLimit(snapshot, now) {
    const data = snapshot.exists ? snapshot.data() : null;
    const windowStart = data && typeof data.windowStart === "number" ? data.windowStart : 0;
    const withinWindow = now - windowStart < RATE_LIMIT_WINDOW_MS;
    const count = withinWindow && typeof data.count === "number" ? data.count : 0;

    if (count >= RATE_LIMIT_MAX_ORDERS) {
        const waitMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 60000));
        throw new HttpsError(
            "resource-exhausted",
            `短時間內下單次數過多，請於 ${waitMinutes} 分鐘後再試。如果這是誤判，請透過聯絡我們告知。`
        );
    }

    return {
        windowStart: withinWindow ? windowStart : now,
        count: count + 1,
        updatedAt: now
    };
}

// 同一個商品在購物車出現多次時合併數量；數量必須是 1～99 的整數
function mergeRequestedItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new HttpsError("invalid-argument", "購物車是空的");
    }
    const merged = new Map();
    rawItems.forEach((item) => {
        const id = typeof item?.id === "string" ? item.id : "";
        const quantity = Number(item?.quantity);
        if (!id || id.includes("/") || !Number.isInteger(quantity) || quantity < 1) {
            throw new HttpsError("invalid-argument", "購物車資料有誤，請回到購物車重新確認");
        }
        const existing = merged.get(id);
        merged.set(id, {
            id,
            quantity: (existing ? existing.quantity : 0) + quantity,
            // 顧客在畫面上看到的單價，只用來判斷「價格是否已更新」，不會拿來計算金額
            expectedPrice: existing ? existing.expectedPrice : Number(item.price)
        });
    });
    const items = [...merged.values()];
    if (items.length > MAX_ITEMS) throw new HttpsError("invalid-argument", `一次最多預訂 ${MAX_ITEMS} 種花禮`);
    if (items.some((item) => item.quantity > MAX_QUANTITY)) {
        throw new HttpsError("invalid-argument", `單一花禮一次最多預訂 ${MAX_QUANTITY} 份`);
    }
    return items;
}

// 顧客填的資料（不含金額，金額在 transaction 裡依商品資料計算）
function parseCustomerInput(data) {
    if (data.substitutionConsent !== true) {
        throw new HttpsError("invalid-argument", "請勾選同意花材替換說明");
    }
    const name = textField(data.customer?.name, "姓名", 50, true);
    const phone = textField(data.customer?.phone, "手機號碼", 20, true).replace(/[\s-]/g, "");
    if (!/^09\d{8}$/.test(phone)) {
        throw new HttpsError("invalid-argument", "請輸入正確的手機號碼（09 開頭共 10 碼），花材需要替換時我們會用這支電話聯繫您");
    }
    const email = textField(data.customer?.email, "電子郵件", 100, true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpsError("invalid-argument", "請輸入正確的電子郵件");
    }
    const method = data.method === "delivery" || data.method === "pickup" ? data.method : null;
    if (!method) throw new HttpsError("invalid-argument", "請選擇寄送方式");

    let address = "";
    let recipientName = "";
    let recipientPhone = "";
    if (method === "delivery") {
        const city = textField(data.address?.city, "縣市", 10, true);
        const district = textField(data.address?.district, "鄉鎮市區", 10, true);
        const detail = textField(data.address?.detail, "詳細地址", 100, true);
        address = city + district + detail;
        recipientName = textField(data.recipientName, "收花人姓名", 50, false);
        recipientPhone = textField(data.recipientPhone, "收花人電話", 20, false);
    }

    return {
        customer: { name, phone, email, address },
        method,
        recipientName,
        recipientPhone,
        pickupDate: typeof data.pickupDate === "string" ? data.pickupDate : "",
        pickupTimeSlot: typeof data.pickupTimeSlot === "string" ? data.pickupTimeSlot : "",
        cardMessage: textField(data.cardMessage, "卡片內容", 200, false),
        notes: textField(data.notes, "其他需求", 1000, false)
    };
}

// 暫停接單、寄送方式、日期、時段
function checkOrderingRules(settings, input) {
    if (!settings.acceptingOrders) {
        throw new HttpsError("failed-precondition", OrderingRules.pauseMessage(settings));
    }
    if (input.method === "delivery" && !settings.delivery.enabled) {
        throw new HttpsError("failed-precondition", "目前暫停宅配，請改選到店自取");
    }
    const dateError = OrderingRules.validatePickupDate(settings, input.pickupDate, input.method);
    if (dateError) throw new HttpsError("failed-precondition", dateError);
    const slots = input.method === "delivery" ? settings.delivery.timeSlots : settings.pickupTimeSlots;
    if (slots.indexOf(input.pickupTimeSlot) === -1) {
        throw new HttpsError("failed-precondition", input.method === "delivery" ? "請選擇到貨時段" : "請選擇取花時段");
    }
}

exports.createOrder = onCall({ region: "asia-east1" }, async (request) => {
    const data = request.data || {};
    const db = getFirestore();

    const input = parseCustomerInput(data);
    const requestedItems = mergeRequestedItems(data.items);

    const settingsSnap = await db.doc("settings/ordering").get();
    const settings = OrderingRules.normalize(settingsSnap.exists ? settingsSnap.data() : null);
    checkOrderingRules(settings, input);

    const orderRef = db.collection("orders").doc();
    const orderNumber = generateOrderNumber();
    const userId = request.auth?.uid || null;
    const limitRef = db.collection("rateLimits").doc(rateLimitKey(request));

    // 讀商品、算金額、建訂單、扣庫存、累加下單次數都放在同一個 transaction：
    // 避免同時下單超賣，也避免同時湧入的請求各自讀到舊的下單次數而一起被放行
    const total = await db.runTransaction(async (transaction) => {
        // transaction 要求所有讀取都在寫入之前。頻率限制另外用 get() 讀，
        // 不併進下面的 getAll()，否則 snaps 的索引會跟 requestedItems 對不上
        const limitSnap = await transaction.get(limitRef);
        const nextLimitState = checkRateLimit(limitSnap, Date.now());

        const productRefs = requestedItems.map((item) => db.collection("products").doc(item.id));
        const snaps = await transaction.getAll(...productRefs);

        const problems = [];
        const priceChanges = [];
        const items = [];
        snaps.forEach((snap, index) => {
            const requested = requestedItems[index];
            const product = snap.exists ? snap.data() : null;
            if (!product || product.status !== "active") {
                problems.push(`${product?.name || "部分花禮"}（已下架）`);
                return;
            }
            const stock = Number(product.stock) || 0;
            const price = Number(product.price) || 0;
            const productName = product.name || "花禮";
            if (stock < requested.quantity) problems.push(`${productName}（剩 ${stock} 份）`);
            if (requested.expectedPrice !== price) {
                priceChanges.push(`${productName}：NT$ ${requested.expectedPrice} → NT$ ${price}`);
            }
            items.push({ id: requested.id, name: productName, price, quantity: requested.quantity });
        });
        if (problems.length > 0) {
            throw new HttpsError("failed-precondition", `以下花禮已額滿或下架：${problems.join("、")}，請返回購物車調整`);
        }
        // 只有後台勾選「可黑貓宅配」的花禮（花束）能宅配，盆栽、桌花等限到店自取
        if (input.method === "delivery") {
            const notDeliverable = snaps
                .filter((snap) => snap.data().deliverable !== true)
                .map((snap) => snap.data().name || "花禮");
            if (notDeliverable.length > 0) {
                throw new HttpsError("failed-precondition", `「${notDeliverable.join("」、「")}」無法宅配，這筆訂單請改選到店自取`);
            }
        }
        if (priceChanges.length > 0) {
            throw new HttpsError("failed-precondition", `以下花禮價格已更新：${priceChanges.join("、")}。請返回購物車確認最新金額後再送出`);
        }

        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const shippingFee = input.method === "delivery" ? OrderingRules.deliveryFee(settings, subtotal) : 0;
        const orderData = {
            customer: input.customer,
            shipping: input.method,
            shippingFee,
            fulfillment: {
                method: input.method,
                date: input.pickupDate,
                timeSlot: input.pickupTimeSlot,
                recipientName: input.recipientName,
                recipientPhone: input.recipientPhone
            },
            // 另外存一份在最上層，方便後台依取花日期排序、篩選
            pickupDate: input.pickupDate,
            pickupTimeSlot: input.pickupTimeSlot,
            cardMessage: input.cardMessage,
            substitutionConsent: true,
            payment: "transfer",
            items,
            subtotal,
            total: subtotal + shippingFee,
            notes: input.notes,
            orderDate: FieldValue.serverTimestamp(),
            status: "pending",
            orderNumber,
            paymentConfirmed: false
        };
        if (userId) orderData.userId = userId;

        transaction.set(orderRef, orderData);
        productRefs.forEach((ref, index) => {
            transaction.update(ref, {
                stock: FieldValue.increment(-items[index].quantity),
                lastUpdated: FieldValue.serverTimestamp()
            });
        });
        // 訂單真的建立了才累加次數：驗證失敗（商品下架、價格變動）的請求不算，
        // 不然顧客修正購物車重試幾次就會被自己擋住
        transaction.set(limitRef, nextLimitState);
        return orderData.total;
    });

    logger.info("訂單已建立", { orderId: orderRef.id, orderNumber, total });
    return { orderId: orderRef.id, orderNumber, total, itemCount: requestedItems.length };
});

// 給測試用：純函式
exports._internal = { mergeRequestedItems, parseCustomerInput, checkRateLimit, rateLimitKey, RATE_LIMIT_MAX_ORDERS, RATE_LIMIT_WINDOW_MS };
