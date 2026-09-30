/**
 * 商品分類（顯示用）共用模組
 *
 * 分類清單存在 Firestore 的 settings/categories（{ items: [{ id, name, imageUrl }] }），
 * 由後台「分類管理」新增、改名、排序、刪除。商品用 categoryIds 陣列記錄屬於哪些分類，
 * 一個商品可以同時屬於多個分類（例如「百合」+「稀有品種」）。
 *
 * 注意：商品原本的 category 欄位（bulbs / plants / seeds / other）是「運費類別」，
 * 購物車、結帳、運費設定都靠它計算階梯運費，跟這裡的顯示分類無關，不要混用。
 *
 * 還沒在後台存過分類之前，一律使用下面的 DEFAULT_CATEGORIES。
 * 最近一次讀到的清單會存在瀏覽器 localStorage，讓頁尾、首頁可以先立刻顯示，
 * 不用每一頁都多讀一次資料庫。
 */
(function() {
    const DEFAULT_CATEGORIES = [
        { id: 'bouquet', name: '花束', imageUrl: '' },
        { id: 'flowerbox', name: '花禮盒', imageUrl: '' },
        { id: 'potted', name: '盆花・植栽', imageUrl: '' },
        { id: 'table', name: '桌花', imageUrl: '' },
        { id: 'opening', name: '開幕・祝賀花禮', imageUrl: '' },
        { id: 'festival', name: '節慶花禮', imageUrl: '' },
        { id: 'dried', name: '乾燥花・永生花', imageUrl: '' }
    ];

    // 預設分類額外的比對關鍵字（學名、英文、別名），給後台「依商品名稱自動歸類」用。
    // 後台自己新增的分類只用分類名稱（用 / 拆開）比對
    const EXTRA_KEYWORDS = {
        bouquet: ['Bouquet', '捧花'],
        flowerbox: ['花盒', '禮盒', 'Box'],
        potted: ['盆栽', '蘭花', '多肉'],
        table: ['桌上', '擺飾'],
        opening: ['開幕', '花籃', '祝賀', '喬遷'],
        festival: ['母親節', '情人節', '畢業', '聖誕', '七夕'],
        dried: ['乾燥', '永生', '不凋']
    };

    const CACHE_KEY = 'productCategoriesCache';
    const FOOTER_LIMIT = 6;

    function cloneDefaults() {
        return DEFAULT_CATEGORIES.map(function(item) { return Object.assign({}, item); });
    }

    function normalize(items) {
        if (!Array.isArray(items)) return null;
        const seen = new Set();
        return items
            .filter(function(item) {
                if (!item || typeof item.id !== 'string' || !item.id) return false;
                if (typeof item.name !== 'string' || !item.name.trim()) return false;
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            })
            .map(function(item) {
                return {
                    id: item.id,
                    name: item.name.trim(),
                    imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : ''
                };
            });
    }

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            return raw ? normalize(JSON.parse(raw)) : null;
        } catch (error) {
            return null;
        }
    }

    function writeCache(items) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(items));
        } catch (error) {
            // 無痕模式等情況存不了，沒關係，下次一樣會讀資料庫或用預設值
        }
    }

    // 立刻可用的清單：瀏覽器記住的上一次清單，沒有就用預設值
    function getCached() {
        return readCache() || cloneDefaults();
    }

    // 從 Firestore 讀取最新清單；文件不存在（後台還沒存過）就用預設值，
    // 讀取失敗則退回 getCached()，不讓分類問題影響整個頁面
    async function load() {
        const services = window.firebaseServices;
        if (!services || !services.db || !services.doc || !services.getDoc) {
            return getCached();
        }
        try {
            const snap = await services.getDoc(services.doc(services.db, 'settings', 'categories'));
            const items = snap.exists() ? normalize(snap.data().items) : null;
            const list = items || cloneDefaults();
            writeCache(list);
            renderFooterLinks(list);
            return list;
        } catch (error) {
            console.warn('讀取商品分類失敗，改用先前的分類清單:', error);
            return getCached();
        }
    }

    function productCategoryIds(product) {
        return product && Array.isArray(product.categoryIds) ? product.categoryIds : [];
    }

    function productInCategory(product, categoryId) {
        return productCategoryIds(product).indexOf(categoryId) !== -1;
    }

    function findById(list, categoryId) {
        return (list || []).find(function(item) { return item.id === categoryId; }) || null;
    }

    function keywordsFor(category) {
        const fromName = category.name.split(/[/・]/).map(function(part) { return part.trim(); }).filter(Boolean);
        return fromName.concat(EXTRA_KEYWORDS[category.id] || []);
    }

    // 依商品名稱比對出可能的分類
    function suggestForName(name, list) {
        const lowerName = String(name || '').toLowerCase();
        return (list || []).filter(function(category) {
            return keywordsFor(category).some(function(keyword) {
                return lowerName.indexOf(keyword.toLowerCase()) !== -1;
            });
        }).map(function(category) { return category.id; });
    }

    function categoryUrl(categoryId) {
        return window.SITE_BASE + 'products.html?category=' + encodeURIComponent(categoryId);
    }

    function escapeText(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 頁尾「商品分類」欄：列出前幾個分類，最後固定一個「所有商品」
    function renderFooterLinks(list) {
        const containers = document.querySelectorAll('.footer-category-links');
        if (containers.length === 0) return;
        // 第一個固定是黑貓宅配花束專區（products.html 的 DELIVERY_ZONE_ID，依商品「可黑貓宅配」篩選）
        const links = ['<li><a href="' + categoryUrl('delivery-zone') + '">黑貓宅配花束專區</a></li>'];
        (list || []).slice(0, FOOTER_LIMIT).forEach(function(category) {
            links.push('<li><a href="' + categoryUrl(category.id) + '">' + escapeText(category.name) + '</a></li>');
        });
        links.push('<li><a href="' + window.SITE_BASE + 'products.html">所有花禮 &raquo;</a></li>');
        containers.forEach(function(container) {
            container.innerHTML = links.join('');
        });
    }

    window.ProductCategories = {
        DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
        getCached: getCached,
        load: load,
        productCategoryIds: productCategoryIds,
        productInCategory: productInCategory,
        findById: findById,
        suggestForName: suggestForName,
        categoryUrl: categoryUrl,
        renderFooterLinks: renderFooterLinks
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { renderFooterLinks(getCached()); });
    } else {
        renderFooterLinks(getCached());
    }
})();
