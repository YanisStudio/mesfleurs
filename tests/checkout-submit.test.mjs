// 結帳頁「提交訂單」與訂單完成頁（Mes Fleurs 版）
// - 必填欄位沒填：標出是哪一欄（reportValidity），不送出、不碰網路
// - 送出中蓋一層轉圈圈（建立訂單的伺服器第一次啟動要好幾秒，以前只有按鈕文字變，顧客以為當掉）
// - 送出中離開頁面會先詢問；成功後不再詢問、按鈕維持停用；失敗時收起轉圈圈、按鈕恢復
// - 送出前重新讀「訂購設定」：讀不到、剛好暫停接單時不送出，並告訴顧客原因
// - 訂單完成頁：金額有 NT$；付款頁連結帶訂單 ID；沒留 Email 的人不能跟他說「連結已寄到您的信箱」
// 庫存、價格、日期一律由伺服器 createOrder 再檢查一次，所以這裡不測前台的庫存檢查
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ROSE = { name: '玫瑰花束', price: 1200, stock: 10, status: 'active', category: 'bulbs' };

function fakeServices(products) {
    const state = { failSettingsReads: false, ordering: null, calls: [], pending: null };
    const snap = (data) => ({ exists: () => !!data, data: () => data });
    const services = {
        db: {}, auth: { currentUser: null },
        collection: (db, name) => ({ name }), doc: (db, col, id) => ({ col, id }),
        query: () => ({}), where: () => ({}), orderBy: () => ({}),
        onAuthStateChanged: (a, cb) => { setTimeout(() => cb(null), 0); return () => {}; },
        getDoc: async (ref) => {
            if (ref.col === 'products') return snap(products[ref.id]);
            if (ref.col === 'settings' && ref.id === 'ordering') {
                if (state.failSettingsReads) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
                return snap(state.ordering);
            }
            return snap(null);
        },
        getDocsFromServer: async () => ({ forEach: () => {} }),
        // 每次呼叫都回傳一個由測試控制何時完成的 promise
        createOrder: (req) => {
            state.calls.push(req);
            return new Promise((resolve, reject) => { state.pending = { resolve, reject }; });
        },
    };
    return { state, services };
}

function loadPayment(products, cartItems) {
    const html = read('payment.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    // 不轉送 jsdom 自己的錯誤（例如「Not implemented: navigation」——成功後會跳到下一頁）
    const dom = new JSDOM(body, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://yanisstudio.github.io/mesfleurs/payment.html', virtualConsole: new VirtualConsole() });
    const { window } = dom;
    window.console.log = () => {};
    window.console.error = () => {};
    window.console.warn = () => {};
    const alerts = [];
    window.alert = (m) => alerts.push(m);
    window.localStorage.setItem('cart', JSON.stringify(cartItems));
    const fake = fakeServices(products);
    window.firebaseServices = fake.services;
    window.eval(read('js/common.js'));
    window.eval(read('js/tw-districts.js'));
    window.eval(read('js/ordering.js'));
    window.initCommonFeatures = () => {};
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const $ = (id) => window.document.getElementById(id);
    // 到店自取：姓名、手機、Email、第一個可選的日期與時段、勾選花材替換同意
    const fill = () => {
        $('name').value = '王小明';
        $('phone').value = '0912345678';
        $('email').value = 'a@example.com';
        window.document.querySelector('input[name="shipping"][value="pickup"]').click();
        $('pickup-date').selectedIndex = 1;
        $('pickup-time').selectedIndex = 1;
        $('substitution-consent').checked = true;
    };
    const overlay = () => $('checkout-loading-overlay').style.display;
    const leaveBlocked = () => {
        const e = new window.Event('beforeunload', { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
    };
    return { window, $, fake, alerts, toasts, fill, overlay, leaveBlocked };
}

let pass = 0, fail = 0;
async function t(name, fn) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const CART = [{ id: 'p1', name: '玫瑰花束', price: 1200, quantity: 2 }];

console.log('結帳頁：提交訂單');

await t('必填欄位沒填：標出是哪一欄，不送出', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    let reported = 0;
    page.$('checkout-form').reportValidity = () => { reported++; return false; };
    page.$('submit-order').click();
    await wait(20);
    assert.strictEqual(reported, 1, '沒有呼叫 reportValidity');
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.notStrictEqual(page.overlay(), 'flex', '沒填完不應該蓋轉圈圈');
});

await t('送出中：轉圈圈畫面＋兩顆按鈕停用；離開頁面會先詢問', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    assert.strictEqual(page.fake.state.calls.length, 1, '沒有送出 createOrder：' + page.alerts.join(' | '));
    assert.strictEqual(page.overlay(), 'flex', '沒有顯示轉圈圈');
    assert.strictEqual(page.$('checkout-loading-text').textContent, '正在建立訂單');
    assert.ok(/不要關閉/.test(page.$('checkout-loading-subtext').textContent));
    assert.ok(page.$('submit-order').disabled && page.$('mobile-submit-order').disabled, '按鈕沒有停用');
    assert.ok(page.leaveBlocked(), '送出中離開頁面應該先詢問');
    const req = page.fake.state.calls[0];
    assert.strictEqual(req.method, 'pickup');
    assert.strictEqual(req.substitutionConsent, true);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(req.pickupDate), '沒有帶取花日期');
});

await t('成功：收起轉圈圈、按鈕維持停用、不再擋離開；成功視窗金額有 NT$、有手動跳轉連結；記錄有沒有留 Email', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    page.fake.state.pending.resolve({ data: { orderId: 'o1', orderNumber: 'MF20261022-TEST', total: 2400, itemCount: 1 } });
    await wait(30);
    assert.notStrictEqual(page.overlay(), 'flex', '轉圈圈沒有收起來');
    assert.ok(page.$('submit-order').disabled, '成功後按鈕不能再按');
    assert.ok(!page.leaveBlocked(), '成功後不應該再擋離開');
    const modal = page.window.document.querySelector('.order-success-modal');
    assert.ok(modal && /NT\$ 2400/.test(modal.textContent), '成功視窗金額要有 NT$');
    assert.strictEqual(modal.querySelector('.redirect-link').getAttribute('href'), 'order-success.html?payment=transfer');
    const last = JSON.parse(page.window.sessionStorage.getItem('lastOrder'));
    assert.strictEqual(last.hasEmail, true);
    assert.strictEqual(last.items, 2, '件數是總份數');
    assert.strictEqual(page.window.localStorage.getItem('cart'), null, '購物車要清空');
});

await t('伺服器擋下（例如已額滿）：收起轉圈圈、按鈕恢復、顯示原因', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    page.fill();
    page.$('submit-order').click();
    await wait(30);
    const e = new Error('以下花禮已額滿或下架：玫瑰花束（剩 1 份），請返回購物車調整'); e.code = 'functions/failed-precondition';
    page.fake.state.pending.reject(e);
    await wait(60);
    assert.notStrictEqual(page.overlay(), 'flex');
    assert.ok(!page.$('submit-order').disabled, '按鈕沒有恢復');
    assert.ok(!page.leaveBlocked());
    assert.ok(page.alerts.some((m) => m.includes('剩 1 份')), page.alerts.join(' | '));
    assert.ok(page.window.localStorage.getItem('cart'), '失敗時不能清空購物車');
});

await t('送出時讀不到訂購設定：不送出，說是網路問題，按鈕恢復', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    page.fill();
    page.fake.state.failSettingsReads = true;
    page.$('submit-order').click();
    await wait(60);
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.ok(page.alerts.some((m) => /網路/.test(m)), page.alerts.join(' | '));
    assert.notStrictEqual(page.overlay(), 'flex');
    assert.ok(!page.$('submit-order').disabled);
});

await t('頁面開著時店家剛好暫停接單：不送出，顯示暫停公告', async () => {
    const page = loadPayment({ p1: ROSE }, CART);
    await wait(200);
    page.fill();
    page.fake.state.ordering = { acceptingOrders: false, pauseMessage: '中秋連假暫停接單' };
    page.$('submit-order').click();
    await wait(60);
    assert.strictEqual(page.fake.state.calls.length, 0);
    assert.ok(page.alerts.includes('中秋連假暫停接單'), page.alerts.join(' | '));
    assert.notStrictEqual(page.overlay(), 'flex');
});

console.log('\n訂單完成頁');

function loadSuccess(lastOrder, query = '?payment=transfer') {
    const html = read('order-success.html');
    const body = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' + html.slice(html.indexOf('<body>'));
    const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://yanisstudio.github.io/mesfleurs/order-success.html' + query, virtualConsole: new VirtualConsole() });
    const { window } = dom;
    window.sessionStorage.setItem('lastOrder', JSON.stringify(lastOrder));
    window.firebaseServices = { auth: { currentUser: null }, onAuthStateChanged: (a, cb) => { setTimeout(() => cb(null), 0); return () => {}; } };
    window.eval(read('js/common.js'));
    window.eval(read('js/ordering.js'));
    window.eval(read('js/bank-info.js'));
    window.initCommonFeatures = () => {};
    window.updateCartCount = () => {};
    window.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
    if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return { $: (id) => window.document.getElementById(id), document: window.document };
}

const ORDER = { id: 'o1', orderNumber: 'MF20261022-TEST', total: 880, items: 2, customerName: '王小明', customerPhone: '0912345678', orderDate: '2026-10-22', method: 'pickup', pickupDate: '2026-10-28', pickupTimeSlot: '10:00-12:00' };

await t('訂單總額有 NT$，付款頁連結帶訂單 ID，顯示取花時間與匯款帳號', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: true });
    await wait(20);
    assert.strictEqual(page.$('order-total').textContent, 'NT$ 880');
    assert.strictEqual(page.$('transfer-pay-link').getAttribute('href'), 'pay.html?id=o1');
    assert.ok(/2026\/10\/28/.test(page.$('pickup-info').textContent) && /到店自取/.test(page.$('pickup-info').textContent));
    assert.ok(/009-119-1-126-206-4/.test(page.$('transfer-bank').textContent), '沒有匯款帳號');
});

await t('有留 Email：說明付款連結已寄到信箱', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: true });
    await wait(20);
    assert.ok(/已經寄到您的信箱/.test(page.document.querySelector('#transfer-notice .important-note').textContent));
});

await t('沒留 Email：提醒把付款頁存起來，不說「已寄到信箱」', async () => {
    const page = loadSuccess({ ...ORDER, hasEmail: false });
    await wait(20);
    const note = page.document.querySelector('#transfer-notice .important-note').textContent;
    assert.ok(/沒有留 Email/.test(note) && /加入書籤/.test(note), note);
    assert.ok(!/已經寄到您的信箱/.test(note));
});

await t('舊版結帳頁的資料（沒有 hasEmail）：維持原本說明', async () => {
    const page = loadSuccess({ ...ORDER });
    await wait(20);
    assert.ok(/已經寄到您的信箱/.test(page.document.querySelector('#transfer-notice .important-note').textContent));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
