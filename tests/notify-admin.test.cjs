// 新訂單管理員通知信（functions/notify-admin.js）
// 用假的 firebase-functions 與假的 Brevo 驅動真實程式碼，不會真的寄信。
// 執行：cd functions && node ../tests/notify-admin.test.cjs
const path = require('path');
const assert = require('assert');

const FN_DIR = path.join(__dirname, '..', 'functions');
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const logs = [];
stub('firebase-functions/v2/firestore', { onDocumentCreated: (opts, handler) => Object.assign(handler, { opts }) });
stub('firebase-functions/params', {
    defineSecret: (name) => ({ name, value: () => 'FAKE-KEY' }),
    defineString: (name) => ({ name, value: () => (name === 'SENDER_EMAIL' ? 'shop@example.com' : '') })
});
stub('firebase-functions/logger', {
    info: (m, d) => logs.push(['info', m, d]), warn() {}, error: (m, d) => logs.push(['error', m, d])
});
const sent = [];
let failBrevo = false;
stub(path.join(FN_DIR, 'brevo.js'), {
    sendEmail: async (args) => {
        if (failBrevo) throw new Error('Brevo API 回應 401');
        sent.push(args);
        return {};
    }
});

const { notifyAdminNewOrder, _internal } = require(path.join(FN_DIR, 'notify-admin.js'));
const { SITE_URL } = require(path.join(FN_DIR, 'site.js'));

const ORDER = {
    orderNumber: 'MF20261014-TEST',
    customer: { name: '王<b>小明</b>', phone: '0912345678', email: 'a@example.com', address: '花蓮縣吉安鄉建國路一段1號' },
    shipping: 'delivery', payment: 'transfer',
    fulfillment: { method: 'delivery', date: '2026-10-20', timeSlot: '13時前', recipientName: '陳小花', recipientPhone: '0987654321' },
    pickupDate: '2026-10-20', pickupTimeSlot: '13時前',
    cardMessage: '生日快樂\n天天開心',
    items: [{ id: 'p1', name: '玫瑰花束', price: 1200, quantity: 2 }, { id: 'p2', name: '桌花', price: 800, quantity: 1 }],
    subtotal: 3200, shippingFee: 200, total: 3400, notes: '請幫我\n包裝好一點',
    orderDate: { toDate: () => new Date(Date.UTC(2026, 9, 14, 2, 30)) },
};
const event = (data) => ({ data: { data: () => data }, params: { orderId: 'ORDER123' } });

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

(async () => {
    await t('監聽的是新建立的訂單，並帶上 Brevo 金鑰', async () => {
        assert.strictEqual(notifyAdminNewOrder.opts.document, 'orders/{orderId}');
        assert.ok(notifyAdminNewOrder.opts.secrets.some((s) => s.name === 'BREVO_API_KEY'));
    });

    await t('沒設定收件人清單時寄給店家的寄件人信箱（SENDER_EMAIL），主旨有訂單編號、顧客、金額', async () => {
        sent.length = 0;
        await notifyAdminNewOrder(event(ORDER));
        assert.deepStrictEqual(sent.map((s) => s.toEmail), ['shop@example.com']);
        assert.strictEqual(sent[0].senderEmail, 'shop@example.com', '寄件人要用 SENDER_EMAIL（Brevo 已驗證的寄件人）');
        assert.ok(sent[0].subject.includes('MF20261014-TEST'), sent[0].subject);
        assert.ok(sent[0].subject.includes('NT$ 3,400'), sent[0].subject);
        assert.strictEqual(sent[0].apiKey, 'FAKE-KEY');
    });

    await t('有設定收件人清單就寄給清單裡的信箱', async () => {
        assert.deepStrictEqual(_internal.recipients('shop@example.com'), _internal.ADMIN_ORDER_NOTIFY_EMAILS.length ? _internal.ADMIN_ORDER_NOTIFY_EMAILS : ['shop@example.com']);
        assert.deepStrictEqual(_internal.recipients(''), _internal.ADMIN_ORDER_NOTIFY_EMAILS);
    });

    await t('內容有花禮明細、運費、總額、到貨時間、收花人、卡片、備註、台灣時間，以及直接打開這筆訂單的後台連結', async () => {
        const { html } = _internal.buildAdminOrderEmail(ORDER, 'ORDER123');
        ['玫瑰花束', '桌花', 'NT$ 2,400', 'NT$ 200', 'NT$ 3,400', '0912345678', '花蓮縣吉安鄉建國路一段1號',
            '銀行轉帳', '黑貓冷藏宅配', '2026/10/20（二）', '13時前', '陳小花', '0987654321', '包裝好一點']
            .forEach((s) => assert.ok(html.includes(s), '缺少 ' + s));
        assert.ok(html.includes('2026/10/14 10:30'), '時間不是台灣時區');
        assert.ok(html.includes(SITE_URL + 'admin/orders.html?id=ORDER123'), '缺少後台連結');
        assert.ok(html.includes('請幫我<br>包裝好一點'), '備註換行沒有保留');
        assert.ok(html.includes('生日快樂<br>天天開心'), '卡片換行沒有保留');
    });

    await t('到店自取的訂單顯示取花時間，不顯示地址', async () => {
        const pickup = { ...ORDER, shipping: 'pickup', fulfillment: { method: 'pickup' }, pickupTimeSlot: '10:00-12:00', customer: { ...ORDER.customer, address: '' } };
        const { html } = _internal.buildAdminOrderEmail(pickup, 'ORDER123');
        assert.ok(html.includes('到店自取') && html.includes('取花時間') && html.includes('10:00-12:00'));
        assert.ok(!html.includes('>地址<'), '到店自取不該有地址欄');
    });

    await t('顧客填的內容會被跳脫，不能在信裡插入 HTML', async () => {
        const { html } = _internal.buildAdminOrderEmail(ORDER, 'ORDER123');
        assert.ok(!html.includes('<b>小明</b>'), '姓名沒有跳脫');
        assert.ok(html.includes('王&lt;b&gt;小明&lt;/b&gt;'));
    });

    await t('寄信失敗只記錄錯誤、不丟出例外（不讓 Cloud Functions 重試造成重複寄信）', async () => {
        failBrevo = true;
        logs.length = 0;
        await notifyAdminNewOrder(event(ORDER));
        failBrevo = false;
        assert.ok(logs.some(([level, m]) => level === 'error' && /寄送失敗/.test(m)), '沒有記錄錯誤');
    });

    await t('資料是空的就不寄', async () => {
        sent.length = 0;
        await notifyAdminNewOrder(event(undefined));
        assert.strictEqual(sent.length, 0);
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
