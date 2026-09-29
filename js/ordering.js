/**
 * 花禮預訂規則（共用）
 *
 * 花蓮沒有花市，花材要 5～7 天叫貨準備，所以所有花禮都是「預訂制」：
 *   - 取花日最早只能選「今天 + 最少提前天數」（預設 5 天）之後
 *   - 門市公休日（每週固定 + 後台設定的特定休假日期）不能選為取花日
 *   - 後台可以「暫停接單」並在全站顯示公告（例如休假、節日訂單已滿）
 *   - 花材短缺或狀態不佳時會電話聯繫替換，結帳時顧客必須勾選同意
 *
 * 設定存在 Firestore 的 settings/ordering（settings 底下訪客可讀、管理員可寫），
 * 由後台「訂購設定」（admin/ordering.html）編輯。文件不存在時使用 DEFAULTS。
 */
(function() {
    const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

    const DEFAULTS = {
        acceptingOrders: true,
        pauseMessage: '',
        announcement: '',
        minLeadDays: 5,
        maxAdvanceDays: 60,
        weeklyClosedDays: [0],
        closedDates: [],
        pickupTimeSlots: ['10:00-12:00', '12:00-14:00', '14:00-16:00', '16:00-18:00'],
        delivery: { enabled: false, fee: 0, freeThreshold: 0, note: '' },
        bank: { accountName: '', bankName: '', accountNumber: '' }
    };

    const DEFAULT_PAUSE_MESSAGE = '目前暫停接受線上預訂，造成不便敬請見諒。';

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function toInt(value, fallback, min, max) {
        const n = parseInt(value, 10);
        if (isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    }

    function isDateString(value) {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    function normalize(data) {
        const d = data || {};
        const settings = clone(DEFAULTS);
        settings.acceptingOrders = d.acceptingOrders !== false;
        settings.pauseMessage = typeof d.pauseMessage === 'string' ? d.pauseMessage.trim() : '';
        settings.announcement = typeof d.announcement === 'string' ? d.announcement.trim() : '';
        settings.minLeadDays = toInt(d.minLeadDays, DEFAULTS.minLeadDays, 0, 60);
        settings.maxAdvanceDays = Math.max(settings.minLeadDays, toInt(d.maxAdvanceDays, DEFAULTS.maxAdvanceDays, 1, 365));
        if (Array.isArray(d.weeklyClosedDays)) {
            settings.weeklyClosedDays = d.weeklyClosedDays
                .map(Number)
                .filter(function(n, i, all) { return n >= 0 && n <= 6 && all.indexOf(n) === i; });
        }
        if (Array.isArray(d.closedDates)) {
            settings.closedDates = d.closedDates
                .filter(function(r) { return r && isDateString(r.start); })
                .map(function(r) {
                    const end = isDateString(r.end) && r.end >= r.start ? r.end : r.start;
                    return { start: r.start, end: end, note: typeof r.note === 'string' ? r.note.trim() : '' };
                })
                .sort(function(a, b) { return a.start < b.start ? -1 : 1; });
        }
        if (Array.isArray(d.pickupTimeSlots)) {
            const slots = d.pickupTimeSlots
                .map(function(s) { return String(s || '').trim(); })
                .filter(Boolean);
            if (slots.length > 0) settings.pickupTimeSlots = slots;
        }
        if (d.delivery && typeof d.delivery === 'object') {
            settings.delivery = {
                enabled: d.delivery.enabled === true,
                fee: toInt(d.delivery.fee, 0, 0, 100000),
                freeThreshold: toInt(d.delivery.freeThreshold, 0, 0, 10000000),
                note: typeof d.delivery.note === 'string' ? d.delivery.note.trim() : ''
            };
        }
        if (d.bank && typeof d.bank === 'object') {
            settings.bank = {
                accountName: String(d.bank.accountName || '').trim(),
                bankName: String(d.bank.bankName || '').trim(),
                accountNumber: String(d.bank.accountNumber || '').trim()
            };
        }
        return settings;
    }

    let loadPromise = null;

    /**
     * 讀取設定（同一頁只讀一次）。讀取失敗會 throw，讓結帳頁可以擋下送出；
     * 只是顯示公告的地方請自行 catch。
     */
    function load(options) {
        if (loadPromise && !(options && options.force)) return loadPromise;
        const services = window.firebaseServices;
        if (!services || !services.db || !services.doc || !services.getDoc) {
            return Promise.reject(new Error('Firebase 服務未初始化'));
        }
        loadPromise = services.getDoc(services.doc(services.db, 'settings', 'ordering'))
            .then(function(snap) { return normalize(snap.exists() ? snap.data() : null); })
            .catch(function(error) {
                loadPromise = null;
                throw error;
            });
        return loadPromise;
    }

    // ---------- 日期工具（一律用本地時區的 YYYY-MM-DD） ----------

    function toDateString(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function parseDate(value) {
        const parts = value.split('-').map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function addDays(date, days) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        d.setDate(d.getDate() + days);
        return d;
    }

    // 例：10/05（六）
    function formatDate(value) {
        if (!isDateString(value)) return value || '';
        const d = parseDate(value);
        return (d.getMonth() + 1) + '/' + String(d.getDate()).padStart(2, '0') + '（' + WEEKDAY_NAMES[d.getDay()] + '）';
    }

    // 例：2026/10/05（六）
    function formatFullDate(value) {
        if (!isDateString(value)) return value || '';
        return value.slice(0, 4) + '/' + formatDate(value);
    }

    function closureFor(settings, value) {
        return settings.closedDates.find(function(r) { return value >= r.start && value <= r.end; }) || null;
    }

    function isClosed(settings, value) {
        return settings.weeklyClosedDays.indexOf(parseDate(value).getDay()) !== -1 || !!closureFor(settings, value);
    }

    function earliestDate(settings, today) {
        return toDateString(addDays(today || new Date(), settings.minLeadDays));
    }

    /**
     * 可以選的取花日期清單 [{ value: 'YYYY-MM-DD', label: '10/05（六）' }]
     */
    function availableDates(settings, today) {
        const base = today || new Date();
        const list = [];
        for (let offset = settings.minLeadDays; offset <= settings.maxAdvanceDays; offset++) {
            const value = toDateString(addDays(base, offset));
            if (!isClosed(settings, value)) list.push({ value: value, label: formatDate(value) });
        }
        return list;
    }

    /**
     * 檢查取花日期是否還能接受（結帳送出前再檢查一次，避免頁面開太久跨日）
     * @returns {string} 空字串代表 OK，否則是錯誤訊息
     */
    function validatePickupDate(settings, value, today) {
        if (!isDateString(value)) return '請選擇取花日期';
        if (value < earliestDate(settings, today)) {
            return '花禮需要提前 ' + settings.minLeadDays + ' 天預訂，最早可選 ' + formatFullDate(earliestDate(settings, today));
        }
        const last = toDateString(addDays(today || new Date(), settings.maxAdvanceDays));
        if (value > last) return '目前只開放預訂到 ' + formatFullDate(last);
        if (isClosed(settings, value)) return formatFullDate(value) + ' 門市公休，請改選其他日期';
        return '';
    }

    function weeklyClosedText(settings) {
        if (settings.weeklyClosedDays.length === 0) return '';
        return settings.weeklyClosedDays.slice().sort()
            .map(function(n) { return '週' + WEEKDAY_NAMES[n]; }).join('、') + '公休';
    }

    // 今天之後還沒結束的特定休假
    function upcomingClosures(settings, today) {
        const todayStr = toDateString(today || new Date());
        return settings.closedDates.filter(function(r) { return r.end >= todayStr; });
    }

    function closureText(range) {
        const dates = range.start === range.end
            ? formatFullDate(range.start)
            : formatFullDate(range.start) + ' ～ ' + formatDate(range.end);
        return dates + (range.note ? '　' + range.note : '');
    }

    function pauseMessage(settings) {
        return settings.pauseMessage || DEFAULT_PAUSE_MESSAGE;
    }

    // ---------- 全站公告列 ----------

    function escapeText(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * 在頁首上方顯示公告：暫停接單訊息、後台自訂公告。
     * 只在前台頁面（body 沒有 admin-page class）且有內容時顯示。
     */
    function renderAnnouncementBar(settings) {
        const messages = [];
        if (!settings.acceptingOrders) messages.push({ type: 'pause', text: pauseMessage(settings) });
        if (settings.announcement) messages.push({ type: 'info', text: settings.announcement });

        let bar = document.getElementById('site-announcement');
        if (messages.length === 0) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'site-announcement';
            bar.className = 'site-announcement';
            bar.setAttribute('role', 'status');
            document.body.insertBefore(bar, document.body.firstChild);
        }
        bar.innerHTML = messages.map(function(m) {
            const icon = m.type === 'pause' ? 'fa-store-slash' : 'fa-bullhorn';
            return '<p class="' + m.type + '"><i class="fas ' + icon + '"></i> ' + escapeText(m.text).replace(/\n/g, '<br>') + '</p>';
        }).join('');
    }

    window.OrderingRules = {
        DEFAULTS: DEFAULTS,
        WEEKDAY_NAMES: WEEKDAY_NAMES,
        normalize: normalize,
        load: load,
        toDateString: toDateString,
        formatDate: formatDate,
        formatFullDate: formatFullDate,
        isClosed: isClosed,
        closureFor: closureFor,
        earliestDate: earliestDate,
        availableDates: availableDates,
        validatePickupDate: validatePickupDate,
        weeklyClosedText: weeklyClosedText,
        upcomingClosures: upcomingClosures,
        closureText: closureText,
        pauseMessage: pauseMessage,
        renderAnnouncementBar: renderAnnouncementBar
    };

    // 頁面上寫死的預設文字（例如預訂須知裡的「5 天」、「週日公休」）換成後台目前的設定
    function fillRuleTexts(settings) {
        document.querySelectorAll('.lead-days').forEach(function(el) {
            el.textContent = settings.minLeadDays;
        });
        document.querySelectorAll('.weekly-closed-text').forEach(function(el) {
            const names = settings.weeklyClosedDays.slice().sort().map(function(n) { return '週' + WEEKDAY_NAMES[n]; });
            el.textContent = names.length > 0 ? names.join('、') : '';
        });
    }
    window.OrderingRules.fillRuleTexts = fillRuleTexts;

    // 前台頁面自動顯示公告（等 DOMContentLoaded：Firebase 模組那時已經初始化好）
    function autoAnnounce() {
        if (document.body.classList.contains('no-announcement')) return;
        load().then(function(settings) {
            renderAnnouncementBar(settings);
            fillRuleTexts(settings);
        }).catch(function(error) {
            console.warn('讀取訂購設定失敗（公告列略過）:', error);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoAnnounce);
    } else {
        autoAnnounce();
    }
})();
