// 呼叫 Brevo 交易型 Email API 寄信的共用函式。
// API Key 由呼叫端（index.js）從 Secret Manager 取出後傳進來，
// 這個檔案本身不碰任何機密資料。

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
// 寄件人信箱由 index.js 傳進來（部署時設定的 SENDER_EMAIL 參數，必須是 Brevo 已驗證的寄件人）
const SENDER_NAME = "Mes Fleurs 芳澤秀花藝設計";

/**
 * @param {object} params
 * @param {string} params.apiKey Brevo API key
 * @param {string} params.toEmail 收件人信箱
 * @param {string} [params.toName] 收件人姓名
 * @param {string} params.subject 信件主旨
 * @param {string} params.html 信件內容（HTML）
 */
async function sendEmail({ apiKey, senderEmail, toEmail, toName, subject, html }) {
    const response = await fetch(BREVO_API_URL, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": apiKey
        },
        body: JSON.stringify({
            sender: { name: SENDER_NAME, email: senderEmail },
            to: [{ email: toEmail, name: toName || toEmail }],
            subject,
            htmlContent: html
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Brevo API 回應 ${response.status}：${errorBody}`);
    }

    return response.json();
}

module.exports = { sendEmail };
