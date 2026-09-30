# Mes Fleurs 芳澤秀花藝設計

花蓮吉安花店的花禮預訂網站：GitHub Pages 靜態網站 + Firebase（Auth / Firestore / Storage / Cloud Functions），
Firebase 專案 `mesfleurs-f963d`。程式架構複製自 BulbMarket（flowerbulb.tw），改為花禮預訂制。

## 預訂規則（後台「訂購設定」可調整）

- 花蓮沒有花市，花材需 5～7 天叫貨：取花日最早為「今天 + 最少提前天數」（預設 5 天）
- 每週固定公休日（預設週日）與後台設定的休假日期，不能選為取花日
- 可「暫停接單」並在全站上方顯示公告
- 結帳必須勾選同意：花材短缺或狀態不佳時，店家以電話聯繫並替換同等級花材
- 寄送方式：黑貓宅急便冷藏宅配（顧客選希望到貨日，前一天出貨，會避開前一天公休）或門市自取；運費在「訂購設定」設定
- 付款：銀行轉帳（中華郵政 700 / 009-119-1-126-206-4），訂單成立後才顯示並寄 Email；可在「訂購設定」修改

設定存在 Firestore `settings/ordering`，規則邏輯在 `js/ordering.js`。

## 第一次上線設定

1. **Firebase Console**
   - Authentication → 登入方式：啟用 Google、電話；授權網域加入正式網域與 `yanisstudio.github.io`
   - Firestore、Storage：建立資料庫後部署規則 `firebase deploy --only firestore:rules,storage`
     （或把 `firestore.rules`、`storage.rules` 內容貼到 Console 的規則頁）
2. **GitHub repo Secrets**：新增 `FIREBASE_SERVICE_ACCOUNT`（服務帳戶金鑰 JSON 全文），
   然後到 Actions 執行「設定管理員權限」把店家的 Google 帳號設為管理員（登出再登入後生效）
3. **Cloud Functions（建立訂單＋訂單通知信）**：需要 Blaze 方案。`firebase functions:secrets:set BREVO_API_KEY`，
   `firebase deploy --only functions`，部署時輸入 `SENDER_EMAIL`（Brevo 已驗證的寄件信箱）
   - 訂單一律由 `createOrder`（`functions/create-order.js`，台灣機房 asia-east1）建立：價格、運費、日期、庫存都在伺服器端計算與檢查，
     Firestore 規則禁止網頁端直接寫入訂單與庫存。預訂規則在前台 `js/ordering.js` 與伺服器 `functions/ordering.js` 各有一份，修改時兩邊要一起改
   - 更新時 **Functions、Firestore 規則、網站要同時上線**：先 `firebase deploy --only functions`，確認成功後 push 網站，再 `firebase deploy --only firestore:rules`
4. **網域**：還沒買網域前可用 GitHub Pages 預設網址 https://yanisstudio.github.io/mesfleurs/ 預覽（全站用相對路徑，放在子資料夾也能正常運作）。
   買好網域後在 repo 的 Settings → Pages 填入 Custom domain，並新增 `sitemap.xml`、在 `robots.txt` 加上 Sitemap
5. 後台「訂購設定」填寫匯款帳戶；「商品管理」上架花禮；「內容管理」上傳首頁輪播圖片
