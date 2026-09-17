#!/usr/bin/env node
// 辅助工具:列出账号下所有域名及其到期状态,不做任何修改。
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
const domains = Array.isArray(json?.data) ? json.data : [];
console.log(`共 ${domains.length} 个域名:\n`);
for (const d of domains) {
  console.log(
    `  ${d.name.padEnd(30)} status=${(d.status || '-').padEnd(8)} slot=${(d.slot_type || '-').padEnd(14)} expiry=${d.expiry_date || '-'}`
  );
}