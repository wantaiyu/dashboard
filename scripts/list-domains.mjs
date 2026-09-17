#!/usr/bin/env node
// 辅助工具:列出账号下所有域名及其到期状态,并打印接口的完整原始响应(便于排查字段差异)。
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

console.log(`共 ${domains.length} 个域名:\n`);
for (const d of domains) {
  // 兼容不同字段名:name / domain / hostname
  const name = d.name ?? d.domain ?? d.hostname ?? d.id ?? '?';
  console.log(
    `  ${String(name).padEnd(30)} status=${String(d.status ?? '-').padEnd(8)} ` +
    `slot=${String(d.slot_type ?? '-').padEnd(14)} expiry=${d.expiry_date ?? '-'}`
  );
  console.log(`     字段: ${Object.keys(d).join(', ')}`);
}
