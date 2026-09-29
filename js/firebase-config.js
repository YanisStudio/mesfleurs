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
