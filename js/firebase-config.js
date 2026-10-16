/**
 * 共用 Firebase 專案設定（Mes Fleurs 芳澤秀花藝設計：mesfleurs-f963d）
 * 由各頁面在載入 Firebase SDK 的 <script type="module"> 之前引入，
 * 避免設定值重複貼在每個檔案裡。
 */
window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyCsM88x2kFPmgP7iCv7ztQCyt19OikszGw",
    authDomain: "mesfleurs-f963d.firebaseapp.com",
    projectId: "mesfleurs-f963d",
    storageBucket: "mesfleurs-f963d.firebasestorage.app",
    messagingSenderId: "591988230059",
    appId: "1:591988230059:web:940f9034461d29bc4b34ee",
    measurementId: "G-5WHE02S3M1"
};

/**
 * 網站根目錄網址（結尾有 /）。
 * 用正式網域時是 https://網域/；用 GitHub Pages 預設網址時是 https://yanisstudio.github.io/mesfleurs/。
 * 由這個檔案自己的位置推算（它一定在 js/ 底下），給首頁與後台共用的 JS 組連結、圖片網址用，
 * 這樣網站放在網域根目錄或子資料夾都能正常運作。HTML 裡的連結一律用相對路徑。
 */
window.SITE_BASE = (function() {
    const script = document.currentScript;
    return script && script.src ? script.src.replace(/js\/firebase-config\.js(\?.*)?$/, '') : '/';
})();

/**
 * Firestore 設定，所有頁面的 initializeFirestore() 以及重建連線
 *（common.js / admin-common.js 的 resetFirestoreConnection）都用這一份。
 *
 * 全站使用 Firestore Lite（firebase-firestore-lite.js），不是完整版 SDK。
 * 完整版靠一條長時間掛著的連線（WebChannel）收資料，在較慢的網路下這條連線
 * 第一次建立時常常卡住，一卡就是 SDK 的 10 秒逾時起跳，重建之後也常常再卡一次。
 * 實測（全新瀏覽器冷開首頁、模擬 150ms 延遲，各 8 次）：
 *   完整版：卡住 5/8，卡住時 55 秒～超過 60 秒才出現商品
 *   Lite  ：卡住 0/8，每次 3.1～3.3 秒出現商品
 * Lite 每次讀寫都是一般的 HTTPS 請求，沒有長連線可以卡住。本站全部都是一次性讀寫，
 * 沒有用即時監聽（onSnapshot）或離線快取，所以 Lite 的限制不影響功能。
 *
 * 換回完整版之前，請先用 tests/coldstart-compare.mjs 重跑比較。
 * 注意：頁面跟 js/admin-common.js 一定要用同一種（都是 Lite），
 * 混用時 getFirestore() 拿不到對方建立的實例，函式也不能跨版本混用。
 */
window.FIRESTORE_SETTINGS = {};
