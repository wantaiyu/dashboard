#!/usr/bin/env node
// 辅助工具:打印接口完整原始响应 + 域名检查表格(不修改任何数据)。
// 用法:  DIGITALPLAT_API_KEY=dp_live_xxx node scripts/list-domains.mjs
const BASE_URL = process.env.DIGITALPLAT_BASE_URL || 'https://domain-api.digitalplat.org/api/v1';
const API_KEY = process.env.DIGITALPLAT_API_KEY || '';

if (!API_KEY.startsWith('dp_')) {
  console.error('缺少 DIGITALPLAT_API_KEY(应以 dp_live_ 或 dp_test_ 开头)');
  process.exit(2);
}

const r = await fetch(`${BASE_URL}/domains`, {
  headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(30_000),
});
const text = await r.text();
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
const json = JSON.parse(text);

console.log('=== 完整原始响应 ===');
console.log(JSON.stringify(json, null, 2));
console.log('=== 解析列表 ===');

// 兼容 data 是数组,或 data 里再包一层 domains/items 的情况
let domains = [];
if (Array.isArray(json?.data)) domains = json.data;
else if (Array.isArray(json?.data?.domains)) domains = json.data.domains;
else if (Array.isArray(json?.data?.items)) domains = json.data.items;

function fmtTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  const sep = '  ' + widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map((r) => line(r))].join('\n');
}

const THRESHOLD_DAYS = Number.parseInt(process.env.RENEW_THRESHOLD_DAYS || '120', 10);
function daysUntil(expiryDate) {
  if (!expiryDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expiryDate).trim());
  if (!m) return null;
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((exp - today) / 86400000);
}

console.log(`共 ${domains.length} 个域名:\n`);
const rows = domains.map((d) => {
  const name = d.name ?? d.domain ?? d.hostname ?? String(d.id ?? '?');
  const expiry = d.expiry_date ?? '永久';
  const days = daysUntil(d.expiry_date);
  const status = days === null ? '永久有效' : days <= THRESHOLD_DAYS ? '窗口内' : '窗口外';
  return [name, status, expiry, days === null ? '永久' : `${days}天`];
});
console.log(fmtTable(['域名', '状态', '到期时间', '剩余天数'], rows));
console.log('\n(字段: ' + (domains[0] ? Object.keys(domains[0]).join(', ') : '无') + ')');
