// 商品頁篩選：
// - 價格「$3,000 以上」（值是 3000+）這種「N 以上」的選項以前會整個略過、照樣列出所有商品
// - 分類／價格／排序選完就直接套用，不用再按「套用篩選」
// - 手機一排兩個（分頁時「一整列」的判斷要跟 CSS 一致）
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const html = read('products.html');
const fnSrc = (name) => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

const w = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' }).window;
w.eval(fnSrc('filterByPrice'));
const prices = [600, 999, 1000, 1500, 2000, 2800, 3000, 4200];
const products = prices.map((price) => ({ price }));
const pick = (range) => [...w.filterByPrice(products, range)].map((p) => p.price);

let pass = 0, fail = 0;
const t = (name, fn) => {
    try { fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

t('$3,000 以上（3000+）只留 3000 元以上的商品', () => assert.deepStrictEqual(pick('3000+'), [3000, 4200]));
t('$1,000 以下', () => assert.deepStrictEqual(pick('0-1000'), [600, 999, 1000]));
t('$1,000 - $2,000', () => assert.deepStrictEqual(pick('1000-2000'), [1000, 1500, 2000]));
t('$2,000 - $3,000', () => assert.deepStrictEqual(pick('2000-3000'), [2000, 2800, 3000]));
t('所有價格', () => assert.deepStrictEqual(pick('all'), prices));

t('篩選選單的每個價格選項都有被正確處理（不會又出現略過的值）', () => {
    const values = [...html.matchAll(/<select id="price-filter">([\s\S]*?)<\/select>/g)][0][1]
        .match(/value="([^"]+)"/g).map((v) => v.slice(7, -1)).filter((v) => v !== 'all');
    values.forEach((v) => assert.ok(pick(v).length < prices.length, `${v} 沒有篩掉任何商品`));
});

t('選完就套用：分類／價格／排序綁 change，不再有「套用篩選」按鈕', () => {
    assert.ok(!html.includes('id="filter-button"'), '還有套用篩選按鈕');
    const init = fnSrc('initFilters');
    ['category-filter', 'price-filter', 'sort-filter'].forEach((id) => assert.ok(init.includes(id), id));
    assert.ok(init.includes("addEventListener('change', applyFilters)"));
});

t('手機一排兩個：分頁判斷的欄數跟 CSS 一致', () => {
    assert.ok(/return 2; \/\/ 手機一排兩個/.test(fnSrc('getGridColumns')));
    const css = read('css/storefront.css');
    assert.ok(/\.products-display \.product-grid \{\s*grid-template-columns: repeat\(2,/.test(css), 'CSS 不是兩欄');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
