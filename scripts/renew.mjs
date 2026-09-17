#!/usr/bin/env node
// DigitalPlat 域名自动续期(零第三方依赖,Node.js 18+ 自带 fetch)
//
// 用法(只需填 API Key,其余全部内置默认):
//   PowerShell:  $env:DIGITALPLAT_API_KEY="dp_live_xxx"; node scripts/renew.mjs
//   CMD:         SET DIGITALPLAT_API_KEY=dp_live_xxx && node scripts/renew.mjs
//   Linux/macOS: DIGITALPLAT_API_KEY=dp_live_xxx node scripts/renew.mjs
//
// 内置默认规则(开箱即用,也可用环境变量覆盖):
//   - 续期窗口:  到期前 120 天内开始续期(免费域名规则:少于 120 天可免费续期一年)
//   - 每次续期:  1 年
//   - 免费域名:  默认自动续,支付方式 "free"(免费);若被拒则回退为不带支付方式重试一次
//   - 其他域名:  支付方式 "credits"
//   - 真实运行:  默认直接续期;加 --dry-run 参数(或 DRY_RUN=true)只预览不动手
//
// 可选环境变量(全部有内置默认,通常不用设):
//   DIGITALPLAT_BASE_URL    API 地址,默认 https://domain-api.digitalplat.org/api/v1
//   RENEW_THRESHOLD_DAYS    提前续期天数,默认 120
//   RENEW_YEARS             每次续期年数,默认 1
//   RENEW_PAYMENT_METHOD    统一指定支付方式(默认空 = 按域名类型自动选)
//   RENEW_PAYMENT_FREE      免费域名支付方式,默认 free
//   RENEW_PAYMENT_PAID      其他域名支付方式,默认 credits
//   RENEW_DELAY_MS          每个请求间隔毫秒,默认 300
//   DRY_RUN                 true/false 是否只预览
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.DIGITALPLAT_BASE_URL || 'https://domain-api.digitalplat.org/api/v1';
const API_KEY = process.env.DIGITALPLAT_API_KEY || '';
const THRESHOLD_DAYS = Number.parseInt(process.env.RENEW_THRESHOLD_DAYS || '120', 10);
const YEARS = Number.parseInt(process.env.RENEW_YEARS || '1', 10);
// 空 = 按域名类型自动选择(free 域名用 RENEW_PAYMENT_FREE,其余用 RENEW_PAYMENT_PAID)
const PAYMENT_METHOD = process.env.RENEW_PAYMENT_METHOD || '';
const PAYMENT_FREE = process.env.RENEW_PAYMENT_FREE || 'free';
const PAYMENT_PAID = process.env.RENEW_PAYMENT_PAID || 'credits';
const DELAY_MS = Number.parseInt(process.env.RENEW_DELAY_MS || '300', 10);
const DRY_RUN = process.argv.includes('--dry-run') || (process.env.DRY_RUN || '').toLowerCase() === 'true';

/** 计算到期日距今天的天数;无法解析返回 null */
function daysUntil(expiryDate) {
  if (!expiryDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(expiryDate).trim());
  if (!m) return null;
  const exp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((exp - today) / 86400000);
}

/** 封装 DigitalPlat API 调用,返回解析后的 JSON;失败抛错(带状态和响应摘要) */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json).slice(0, 400) : text.slice(0, 400);
    throw new Error(`HTTP ${res.status} ${method} ${path} -> ${detail}`);
  }
  return json;
}

/** 简单对齐表格:headers 为列名数组,rows 为每行的单元格数组 */
function fmtTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const line = (cells) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  const sep = '  ' + widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map((r) => line(r))].join('\n');
}

/** 续期一个域名;free 域名在支付方式被拒时回退为不带支付方式重试一次 */
async function renewDomain(name, isFree) {
  const attempt = async (body) => api(`/domains/${encodeURIComponent(name)}/renew`, { method: 'POST', body });
  const payment = PAYMENT_METHOD || (isFree ? PAYMENT_FREE : PAYMENT_PAID);
  try {
    const r = await attempt({ years: YEARS, payment_method: payment });
    return { ok: true, note: `payment=${payment}`, data: r.data };
  } catch (firstErr) {
    if (isFree && !PAYMENT_METHOD) {
      // 免费域名:可能不接受自定义支付方式,改为不带 payment_method 再试一次
      try {
        const r2 = await attempt({ years: YEARS });
        return { ok: true, note: 'payment=auto(回退无payment)', data: r2.data, retried: true };
      } catch { /* fall through */ }
    }
    return { ok: false, error: firstErr.message };
  }
}

async function main() {
  if (!API_KEY.startsWith('dp_')) {
    console.error('[renew] 缺少有效的 DIGITALPLAT_API_KEY(应以 dp_live_ 或 dp_test_ 开头)');
    console.error('       示例: $env:DIGITALPLAT_API_KEY="dp_live_xxx"; node scripts/renew.mjs');
    process.exit(2);
  }

  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  console.log(`[renew] DigitalPlat 域名每日检查 (${ts})`);
  console.log(`[renew] 规则: 到期前 ${THRESHOLD_DAYS} 天内进入续期窗口,每次续 ${YEARS} 年,免费域名自动续`);

  // 1) 列出所有域名(兼容 data 为数组,或 data 内嵌 domains/items)
  let domains = [];
  try {
    const r = await api('/domains');
    if (Array.isArray(r?.data)) domains = r.data;
    else if (Array.isArray(r?.data?.domains)) domains = r.data.domains;
    else if (Array.isArray(r?.data?.items)) domains = r.data.items;
  } catch (e) {
    console.error(`[renew] 获取域名列表失败: ${e.message}`);
    process.exit(1);
  }
  console.log(`[renew] 共 ${domains.length} 个域名\n`);

  // 2) 生成检查表(域名/状态/到期时间/剩余天数)
  const rows = domains.map((d) => {
    const name = d.name ?? d.domain ?? d.hostname ?? String(d.id ?? '?');
    const expiry = d.expiry_date ?? '永久';
    const days = daysUntil(d.expiry_date);
    let status;
    if (days === null) status = '永久有效';
    else if (days <= THRESHOLD_DAYS) status = '窗口内';
    else status = '窗口外';
    return { name, expiry, days, status, raw: d };
  });
  // 先打一行字段名便于确认接口结构(字段确认后可以删除)
  for (const r of rows) console.log(`[debug] 字段: ${Object.keys(r.raw).join(', ')}`);
  console.log(fmtTable(['域名', '状态', '到期时间', '剩余天数'], rows.map((r) => [r.name, r.status, r.expiry, r.days === null ? '永久' : `${r.days}天`])));
  console.log('');

  // 3) 自动续期明细:只处理窗口内的域名
  const due = rows.filter((r) => r.status === '窗口内');
  console.log(`[renew] 自动续期明细(${due.length} 个进入续期窗口):`);
  const results = [];
  let failures = 0;
  for (const r of due) {
    const d = r.raw;
    const slot = d.slot_type || d.lifecycle_type || 'unknown';
    const isFree = slot === 'free';
    if (DRY_RUN) {
      console.log(`  [DRY-RUN] ${r.name} 剩余 ${r.days} 天,将续期 ${YEARS} 年`);
      results.push({ name: r.name, action: 'dry-run-将续期' });
      continue;
    }
    const outcome = await renewDomain(r.name, isFree);
    if (outcome.ok) {
      console.log(`  ✔ ${r.name} 续期成功${outcome.note ? `(${outcome.note})` : ''}`);
      results.push({ name: r.name, action: 'renewed' });
    } else {
      failures += 1;
      console.error(`  ✘ ${r.name} 续期失败: ${outcome.error}`);
      results.push({ name: r.name, action: 'failed', error: outcome.error });
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }
  if (due.length === 0) console.log('  (暂无到期域名,全部在窗口外或永久有效)');

  // 4) 汇总
  const renewed = results.filter((x) => x.action === 'renewed').length;
  const will = results.filter((x) => x.action === 'dry-run-将续期').length;
  console.log(`\n[renew] 完成: 窗口内 ${due.length} 个,续期 ${renewed} 个${DRY_RUN ? `(DRY-RUN 将续 ${will} 个)` : ''},失败 ${failures} 个`);
  if (failures > 0) {
    console.error('[renew] 存在失败项,退出码 1(便于 GitHub Actions 邮件通知)');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
