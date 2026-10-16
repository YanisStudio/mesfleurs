// 訂單成立通知信的付款區塊（functions/index.js）：要有匯款帳號、應付金額、付款頁連結。
// 用假的 firebase-functions 載入真實程式碼，不會真的寄信。
// 執行：cd functions && node ../tests/order-email-payment.test.cjs
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const FN_DIR = path.join(__dirname, '..', 'functions');
function stub(id, exports) {
    const resolved = require.resolve(id, { paths: [FN_DIR] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const passthrough = (opts, handler) => handler;
stub('firebase-functions/v2/firestore', { onDocumentCreated: passthrough, onDocumentUpdated: passthrough });
stub('firebase-functions/v2/https', { onCall: passthrough, HttpsError: class extends Error {} });
stub('firebase-functions/params', { defineSecret: () => ({ value: () => 'KEY' }), defineString: () => ({ value: () => 'shop@example.com' }) });
stub('firebase-functions/logger', { info() {}, warn() {}, error() {} });
stub('firebase-admin/app', { initializeApp() {} });
stub('firebase-admin/firestore', { getFirestore() {}, FieldValue: {} });

const { _emailInternal } = require(path.join(FN_DIR, 'index.js'));
const { buildOrderConfirmationEmail, BANK_ACCOUNT } = _emailInternal;
const { PAY_URL } = require(path.join(FN_DIR, 'site.js'));

const order = (shipping) => ({
    orderNumber: 'MF20261015-TEST', payment: 'transfer', shipping, total: 2600, subtotal: 2400, shippingFee: shipping === 'delivery' ? 200 : 0,
    pickupDate: '2026-10-20', pickupTimeSlot: shipping === 'delivery' ? '13時前' : '10:00-12:00',
    customer: { name: '王<b>小明</b>', email: 'a@example.com', address: '花蓮縣吉安鄉' },
    items: [{ name: '玫瑰花束', price: 1200, quantity: 2 }],
});

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

for (const shipping of ['delivery', 'pickup']) {
    const { subject, bodyHtml } = buildOrderConfirmationEmail(order(shipping), 'ORDER123');
    t(`${shipping}：信裡有匯款帳號、應付金額`, () => {
        [BANK_ACCOUNT.accountNumber, BANK_ACCOUNT.accountName, BANK_ACCOUNT.bankName, 'NT$ 2,600']
            .forEach((s) => assert.ok(bodyHtml.includes(s), '缺少 ' + s));
    });
    t(`${shipping}：有連到這筆訂單付款頁的按鈕`, () => {
        assert.ok(bodyHtml.includes(`href="${PAY_URL}ORDER123"`), '沒有付款頁連結');
        assert.ok(bodyHtml.includes('前往付款'), '沒有按鈕文字');
    });
    t(`${shipping}：有取花／到貨時間與花材替換說明，主旨是 Mes Fleurs`, () => {
        assert.ok(bodyHtml.includes('2026/10/20'), '缺少日期');
        assert.ok(bodyHtml.includes(shipping === 'delivery' ? '黑貓冷藏宅配' : '到店自取'));
        assert.ok(bodyHtml.includes('替換為同等級'));
        assert.ok(subject.includes('Mes Fleurs') && subject.includes('MF20261015-TEST'));
        assert.ok(!/ATM|球根/.test(bodyHtml + subject));
    });
}

t('顧客姓名有跳脫', () => {
    const { bodyHtml } = buildOrderConfirmationEmail(order('pickup'), 'X');
    assert.ok(!bodyHtml.includes('<b>小明</b>') && bodyHtml.includes('&lt;b&gt;'));
});

t('網站的匯款帳號（js/ordering.js 的 BANK_ACCOUNT）跟信裡的一致', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ordering.js'), 'utf8');
    for (const key of ['accountName', 'bankName', 'accountNumber']) {
        assert.ok(src.includes(`${key}: '${BANK_ACCOUNT[key]}'`), `${key} 不一致`);
    }
});

t('付款頁與訂單完成頁用 js/bank-info.js 顯示帳號，不自己寫死', () => {
    for (const page of ['order-success.html', 'pay.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
        assert.ok(html.includes('js/bank-info.js'), page + ' 沒有載入 js/bank-info.js');
        assert.ok(!html.includes(BANK_ACCOUNT.accountNumber), page + ' 不應該寫死帳號');
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
