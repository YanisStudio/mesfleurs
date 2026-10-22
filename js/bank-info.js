/**
 * 銀行轉帳的收款帳戶區塊（付款頁 pay.html、訂單完成頁 order-success.html 共用）。
 *
 * 帳戶本身寫死在 js/ordering.js 的 BANK_ACCOUNT（跟 functions/site.js 的 BANK_ACCOUNT 一致），
 * 這裡只負責顯示，所以頁面要先載入 js/ordering.js。
 */
(function() {
    function info() {
        return window.OrderingRules.BANK_ACCOUNT;
    }

    function escape(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * 匯款帳戶資訊區塊（含「複製帳號」按鈕）。
     * @param {number} [amount] 應付金額，有給才顯示
     */
    function html(amount) {
        const bank = info();
        return `
            <div class="bank-transfer-box">
                ${typeof amount === 'number' ? `<p class="bank-transfer-amount">應付金額：<strong>NT$ ${escape(amount.toLocaleString('zh-TW'))}</strong></p>` : ''}
                <dl>
                    <dt>銀行</dt><dd>${escape(bank.bankName)}</dd>
                    <dt>帳號</dt><dd><span class="bank-transfer-account">${escape(bank.accountNumber)}</span>
                        <button type="button" class="bank-transfer-copy" data-copy="${escape(bank.accountNumber.replace(/-/g, ''))}">複製帳號</button></dd>
                    <dt>戶名</dt><dd>${escape(bank.accountName)}</dd>
                </dl>
            </div>
        `;
    }

    // 「複製帳號」：用事件代理，任何時候插入的區塊都能用
    document.addEventListener('click', function(event) {
        const button = event.target.closest && event.target.closest('.bank-transfer-copy');
        if (!button) return;
        const text = button.dataset.copy;
        const done = function() {
            button.textContent = '已複製';
            setTimeout(function() { button.textContent = '複製帳號'; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function() { window.prompt('請複製帳號：', text); });
        } else {
            window.prompt('請複製帳號：', text);
        }
    });

    // 共用樣式，只注入一次
    if (!document.getElementById('bank-transfer-styles')) {
        const style = document.createElement('style');
        style.id = 'bank-transfer-styles';
        style.textContent = `
            .bank-transfer-box { background: #faf5ea; border: 1px solid #e6d5b0; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
            .bank-transfer-box dl { display: grid; grid-template-columns: auto 1fr; gap: .45rem 1rem; margin: 0; align-items: center; }
            .bank-transfer-box dt { color: #7a6a4f; }
            .bank-transfer-box dd { margin: 0; font-weight: 600; color: #2b2418; }
            .bank-transfer-account { font-size: 1.15em; letter-spacing: .03em; white-space: nowrap; }
            .bank-transfer-amount { margin: 0 0 .75rem; font-size: 1.05em; }
            .bank-transfer-amount strong { color: #c0392b; font-size: 1.2em; }
            .bank-transfer-copy { margin-left: .5rem; padding: .2rem .7rem; border: 1px solid #8a6526; background: #fff; color: #8a6526; border-radius: 999px; cursor: pointer; font-size: .85em; }
            .bank-transfer-copy:hover { background: #8a6526; color: #fff; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    window.BankTransferInfo = { get info() { return info(); }, html: html };
})();
