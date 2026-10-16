// 寄信用到的網站資訊（index.js 的顧客通知信、notify-admin.js 的管理員通知信共用）

// 網站網址（結尾有 /）。信裡的「前往付款」「到後台查看這筆訂單」連結用這個組出來。
// 買好網域、在 GitHub Pages 設定 Custom domain 之後，改成 https://網域/ 並重新部署 functions
const SITE_URL = "https://yanisstudio.github.io/mesfleurs/";

// 付款頁：打開就看得到應付金額、匯款帳號，並可直接回報匯款（不用登入）
const PAY_URL = SITE_URL + "pay.html?id=";

// 後台訂單管理頁支援 ?id=訂單ID，打開後會直接選到這筆訂單
const ADMIN_ORDER_URL = SITE_URL + "admin/orders.html?id=";

// 匯款帳戶：店家指定寫死，跟前台 js/ordering.js 的 BANK_ACCOUNT 一致，修改時兩邊一起改
const BANK_ACCOUNT = { accountName: "林瑞岳", bankName: "中華郵政（銀行代碼 700）", accountNumber: "009-119-1-126-206-4" };

module.exports = { SITE_URL, PAY_URL, ADMIN_ORDER_URL, BANK_ACCOUNT };
