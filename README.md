# DigitalPlat 域名自动续期

通过 GitHub Actions 定时任务调用 [DigitalPlat API](https://dashboard.digitalplat.org/dashboard/api/docs),在域名到期前自动续期,避免忘记续期导致域名被回收。

**你只需要做一件事:填一个 API Key。** 其余参数(续期窗口 120 天、每次续 1 年、免费域名自动免费续期等)全部内置在代码里。

## 工作原理

1. **定时触发**:GitHub Actions 按 cron 每天运行(默认 UTC 03:17),也可以手动触发。
2. **列出域名**:调用 `GET /api/v1/domains`,拿到账号下所有域名及 `expiry_date`(到期日)、`slot_type`、`status`。
3. **判断到期**:凡是「到期日 − 今天 ≤ 120 天」的域名进入待续期列表(免费域名规则:剩余少于 120 天可免费续期一年)。
4. **自动续期**:调用 `POST /api/v1/domains/{domain}/renew`,续 1 年。
   - 免费域名(`slot_type=free`):支付方式 `free`,自动续且不花钱;若被接口拒绝会回退为不带支付方式再试一次。
   - 其他域名:支付方式 `credits`。
5. **结果反馈**:汇总打印;有任何失败以退出码 1 结束,GitHub Actions 会自动发邮件通知。

## 目录结构

```
DigitalPlat域名自动续期/
├── .github/workflows/renew.yml   # GitHub Actions 定时任务
├── scripts/
│   ├── renew.mjs                 # 主脚本:列出域名并自动续期(零依赖,Node 18+)
│   └── list-domains.mjs          # 辅助:只列出域名与到期状态
├── .env.example                  # 本地运行示例(只需填 key)
└── README.md
```

## 快速开始(部署到 GitHub)

### 1. 获取 API Key

1. 登录 [DigitalPlat Dashboard](https://dashboard.digitalplat.org),进入 **API Keys**(`/dashboard/api/keys`)。
2. 创建 API Key,给它**域名(Domains)相关权限**(Scoped key 可限制产品范围)。
3. 复制生成的 key(`dp_live_...`)。**原始 key 只显示一次**,请立即保存;服务端只存 SHA256 哈希,丢失只能重新创建。

### 2. 推送仓库并配置 Secret

```bash
cd DigitalPlat域名自动续期
git init && git add . && git commit -m "init: digitalplat auto-renew"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 仓库页面 **Settings → Secrets and variables → Actions → New repository secret**:

| Secret 名 | 值 |
|---|---|
| `DIGITALPLAT_API_KEY` | 你的 `dp_live_...` key |

**只有这一个 Secret,没有其它配置。** 之后每天自动运行,失败会自动邮件通知。

### 3. 首次验证(可选但推荐)

仓库 **Actions → digitalplat-renew → Run workflow** 手动触发一次,看日志确认:
- 能正确列出你的域名和到期日;
- 到期窗口内的域名被续期、未到期的显示 `skip`。

若只想预览不真正续期,先本地跑一次 `--dry-run`(见下)。

## 本地运行

```powershell
cd "DigitalPlat域名自动续期"
$env:DIGITALPLAT_API_KEY="dp_live_xxx"          # 唯一要填的东西
node scripts/list-domains.mjs                   # 只看域名列表
node scripts/renew.mjs --dry-run                # 预览:哪些会续期(不发请求)
node scripts/renew.mjs                          # 真实续期
```

## 内置默认配置(一般不用改)

| 项 | 内置默认 | 环境变量覆盖 | 说明 |
|---|---|---|---|
| API 地址 | `https://domain-api.digitalplat.org/api/v1` | `DIGITALPLAT_BASE_URL` | 一般不用改 |
| 续期窗口 | **120 天内** | `RENEW_THRESHOLD_DAYS` | 到期少于 120 天可免费续一年 |
| 每次续期 | **1 年** | `RENEW_YEARS` | — |
| 免费域名支付 | **`free`** | `RENEW_PAYMENT_FREE` | 自动续,不花钱;被拒时回退无 payment 重试 |
| 其他域名支付 | **`credits`** | `RENEW_PAYMENT_PAID` | 统一指定用 `RENEW_PAYMENT_METHOD` |
| 请求间隔 | **300ms** | `RENEW_DELAY_MS` | 每个续期请求之间 |
| 预览模式 | **关**(直接真实续期) | `DRY_RUN=true` 或 `--dry-run` | 只打印不续期 |

> 所有覆盖都是可选的:不设置环境变量,脚本就用内置默认运行。

## 注意事项

- **只续不删**:脚本只读域名列表 + 调用续期,不会做删除、DNS 改写等操作。
- **重复运行安全**:续期成功后服务器会更新 `expiry_date`,下次运行该域名就回到未到期状态,不会反复扣费。
- **失败会通知**:任何续期失败都会使工作流退出码为 1,GitHub 会发通知邮件;届时再看 Actions 日志里失败原因。
- **key 安全**:`DIGITALPLAT_API_KEY` 只放进 GitHub Secrets,绝不提交到仓库,别在 Issue/Commit 里贴出来。

## 参考

- API 文档:`https://dashboard.digitalplat.org/dashboard/api/docs`
- Base URL:`https://domain-api.digitalplat.org/api/v1`,Bearer 认证
- 续期端点:`POST /api/v1/domains/{domain}/renew`(`{ "years": 1, "payment_method": "..." }`)