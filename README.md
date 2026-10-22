# Mes Fleurs 芳澤秀花藝設計

花蓮吉安花店的花禮預訂網站：GitHub Pages 靜態網站 + Firebase（Auth / Firestore / Storage / Cloud Functions），
Firebase 專案 `mesfleurs-f963d`。程式架構複製自 BulbMarket（flowerbulb.tw），改為花禮預訂制。

## 預訂規則（後台「訂購設定」可調整）

- 花蓮沒有花市，花材需 5～7 天叫貨：取花日最早為「今天 + 最少提前天數」（預設 5 天）
- 每週固定公休日（預設週日）與後台設定的休假日期，不能選為取花日
- 可「暫停接單」並在全站上方顯示公告
- 結帳必須勾選同意：花材短缺或狀態不佳時，店家以電話聯繫並替換同等級花材
- 寄送方式：黑貓宅急便冷藏宅配（顧客選希望到貨日，前一天出貨，會避開前一天公休）或到店自取；運費在「訂購設定」設定
- 只有後台「商品管理」勾選「可黑貓宅配」的花禮（花束）能宅配，會列在「黑貓宅配花束專區」（`products.html?category=delivery-zone`）；盆栽、桌花等不勾，購物車裡只要有一項不能宅配，整筆訂單就只能到店自取（前台與 `createOrder` 都會檢查）
- 付款：銀行轉帳（戶名林瑞岳，中華郵政 700 / 009-119-1-126-206-4），訂單成立後才顯示並寄 Email。帳戶寫死在 `js/ordering.js` 的 `BANK_ACCOUNT` 與 `functions/site.js` 的 `BANK_ACCOUNT`，後台只能查看，修改時兩邊一起改並重新部署 Functions
- 付款頁 `pay.html?id=訂單ID`（多筆：`?ids=A,B`）：應付金額、匯款帳號、回報匯款表單，不用登入。訂單成立通知信、訂單完成頁、訂單記錄、未付款提醒都連到這裡。回報匯款走 Cloud Function `appendOrderNote`（只會往後接備註，不會改成已付款，一律由管理員對帳後在後台改狀態）
- 訂單狀態（`js/order-status.js`）：未付款 → 訂單確認 → 已付款 → 確認收款備花中 → 已出貨・可取花 → 已完成 → 已取消
- 「加入會員」頁 `membership.html`：文章在後台「內容管理 → 加入會員」編輯（`settings/membership`）

設定存在 Firestore `settings/ordering`，規則邏輯在 `js/ordering.js`。

## 第一次上線設定

1. **Firebase Console**
   - Authentication → 登入方式：啟用 Google、電話；授權網域加入正式網域與 `yanisstudio.github.io`
   - Firestore、Storage：建立資料庫後部署規則 `firebase deploy --only firestore:rules,storage`
     （或把 `firestore.rules`、`storage.rules` 內容貼到 Console 的規則頁）
2. **GitHub repo Secrets**：新增 `FIREBASE_SERVICE_ACCOUNT`（服務帳戶金鑰 JSON 全文），
   然後到 Actions 執行「設定管理員權限」把店家的 Google 帳號設為管理員（登出再登入後生效）。
   GitHub 上只剩「設定管理員權限」「會員資料同步」兩個流程，都用 `npm ci --ignore-scripts` 依 package-lock.json 安裝固定版本
   （要升級 firebase-admin：在 `scripts/<流程>/` 改 package.json 後執行 `npm install --package-lock-only`，一起提交）
3. **Cloud Functions（建立訂單、回報匯款、訂單通知信、新訂單通知管理員）**：需要 Blaze 方案、執行環境 Node.js 24。`firebase functions:secrets:set BREVO_API_KEY`，
   `firebase deploy --only functions`，部署時輸入 `SENDER_EMAIL`（Brevo 已驗證的寄件信箱）
   - 訂單一律由 `createOrder`（`functions/create-order.js`，台灣機房 asia-east1）建立：價格、運費、日期、庫存都在伺服器端計算與檢查，
     Firestore 規則禁止網頁端直接寫入訂單與庫存。預訂規則在前台 `js/ordering.js` 與伺服器 `functions/ordering.js` 各有一份，修改時兩邊要一起改
   - 更新時 **順序不能顛倒**：先 `firebase deploy --only functions`，確認成功後 push 網站，最後才 `firebase deploy --only firestore:rules`
     （新規則禁止網頁端直接改訂單，回報匯款要先有 `appendOrderNote`；先發規則的話顧客會無法回報匯款）
   - `createOrder` 有下單頻率限制（同一個帳號／IP 10 分鐘內最多 5 筆，IP 取 X-Forwarded-For 的最後一段，前面的可以偽造），計數存在 `rateLimits`，不要為它開規則
   - 商品排程上下架：`productScheduler`（`functions/product-scheduler.js`），Cloud Scheduler **每分鐘**檢查一次（台北時間）。
     以前放在 GitHub Actions，但 GitHub 的排程常常晚好幾個小時才跑。
     查狀態：`gcloud scheduler jobs describe firebase-schedule-productScheduler-asia-east1 --location asia-east1 --project mesfleurs-f963d`（`describe` 換成 `run` 可以手動跑一次）
   - 新訂單通知管理員（`functions/notify-admin.js`）：預設寄到 `SENDER_EMAIL`，要寄給其他信箱就填 `ADMIN_ORDER_NOTIFY_EMAILS` 再重新部署
   - 信件裡的「前往付款」「到後台查看」連結用 `functions/site.js` 的 `SITE_URL`，買網域之後要一起改
   - **Brevo 一定要關掉 IP 白名單**（Brevo → Security → Authorised IPs）：Cloud Functions 沒有固定 IP，開著的話所有通知信都會被擋（401 unrecognised IP address），而且網站上完全看不出來。
     上線後下第一筆訂單，用 `gcloud logging read` 查 log 有沒有「已寄出」
4. **測試**：見 `tests/README.md`（一致性檢查、單元測試、Firestore 規則權限矩陣、全站頁面巡檢）
5. **網域**：還沒買網域前可用 GitHub Pages 預設網址 https://yanisstudio.github.io/mesfleurs/ 預覽（全站用相對路徑，放在子資料夾也能正常運作）。
   買好網域後在 repo 的 Settings → Pages 填入 Custom domain，並新增 `sitemap.xml`、在 `robots.txt` 加上 Sitemap
6. 後台「商品管理」上架花禮（可以寄的花束記得勾「可黑貓宅配」）；「內容管理」上傳首頁輪播圖片
