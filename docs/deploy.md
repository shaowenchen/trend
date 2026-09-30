# 部署

本站是**一组静态文件**：没有服务端、没有数据库、没有运行时依赖、没有构建工具链。
页面在**构建时**把 `{{BRAND}}` 与 GTM 占位符落成真值，产物复制进 `dist/`，
由 GitHub Pages 原样发出。
榜单数据由访客的浏览器直接请求上游接口取得（见 `docs/trend-sources.md`）；
榜单数据由访客的浏览器直接请求上游接口取得（见 `docs/trend-sources.md`）。

选型与数据源见 `docs/trend-sources.md`。

---

## 首次部署（只做一次）

1. 把仓库推到 GitHub。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
   > 这一步不能省。选错（例如留在默认的 "Deploy from a branch"）时工作流会在
   > `deploy` 步骤报错，而不是静默失败 —— 报错信息里能看到 `pages` 相关字样。
3. 推一次代码（或手动跑一次 `Deploy to GitHub Pages` 工作流）。
4. 站点地址：
   - 仓库名是普通名字（如 `trend`）→ `https://<用户名>.github.io/<仓库>/`
   - 仓库名是 `<用户名>.github.io` → `https://<用户名>.github.io/`

**代码不需要为地址做任何改动。** 页面里的引用全是相对路径，两种挂法都成立。

---

## 工作流做了什么

`.github/workflows/pages.yml`：`npm test` → `npm run build` → 上传 `dist/` → 发布。

三条顺序上的讲究：

- **测试在构建之前**。站点门禁没过时，连发布物都不该产出（`site.test.js` 会检查
  文案键是否存在、页面引用的资源是否真的在发布集合里、脚本有没有 import 到
  集合之外的文件、有没有残留占位符、有没有 `/` 开头的路径、两种语言有没有串页）。
- **发布物是 `dist/`，不是仓库根目录**。所以 `.github/`、`docs/`、`*.test.js`
  都不会被发布 —— 测试文件同住 `assets/`，这一点尤其重要。
- **`dist/` 不入库**（在 `.gitignore` 里）。它由 CI 每次重新生成；入库只会制造
  "仓库里的产物与源码不一致"这种只能靠人记得同步的坏状态。

`build-site.mjs` 的 `SITE_FILES` 是**白名单**：新加一个页面必须在里面登记才会被发布。
用"排除"式规则（复制一切、排除 `*.test.js`）的话，将来多出一个草稿页或隐藏文件
会**静默上线**；白名单的失效方式是"新文件不发布"，看得见。

面板页是"一个面板一页"，所以白名单里那 22 个 `*.html` 与 `trend.js` 里的
`BOARD_IDS` 必须一一对应。`site.test.js` 有一条断言比对两者 ——
加面板时最容易漏的正是这里的登记（页面上看不出来，线上是 404）。

---

## 本地预览

```bash
npm start        # 构建 + 起服务 → http://localhost:8788
```

`scripts/serve.mjs` 是零依赖的静态服务器，刻意模仿 Pages 的目录语义：
目录请求回落到 `index.html`、找不到就给 404。

它**刻意不做**美化 URL（`/eval` → `eval.html`）：Pages 不做这件事，
本地做了就会掩盖"链接写错了但本地能用"的问题。

排错常用：

```bash
npm run build    # 只构建，看发布物清单
ls dist          # 产物
npm run test:live   # 上游数据源体检（联网）：状态码 / CORS / 耗时 / 分页
```

---

## 统计（Google Tag Manager）

容器 ID：**`GTM-MTW4XNQ`**，唯一来源是 `src/site/gtm.js` 的 `GTM_ID`。
四个页面的 `<head>` 里写 `{{GTM}}`、`<body>` 顶部写 `{{GTM_NOSCRIPT}}`，
构建期落成真正的代码片段（位置都是 Google 规定的位置）。

改容器只改那一个常量，改完重新构建即可 —— 页面里没有第二处写着 ID。

排错：

| 现象 | 多半是 |
|---|---|
| 页面源码里直接看到 `{{GTM}}` | 源码页被当成产物发布了，或者该页漏了占位符登记。`npm test` 会拦住 |
| GTM 预览模式里看不到本站 | 容器 ID 写错（构建期会因形状不合规直接失败）；或页面里没有容器脚本 |
| 实时报告里只有一部分页面有流量 | 某个页面漏了 `{{GTM}}`。四个页面都应当有 |
| 统计全零但页面正常 | 容器里没有配置标签，或访客浏览器拦了 `googletagmanager.com` |

> 当前是**直接加载**（无同意横幅）：访客一进站就会加载容器，因此容器里的
> GA4/Ads 标签在未同意前就会写入 `_ga` / `_gcl` 这类 cookie。
> 要改成"先同意后加载"，把容器脚本的注入从构建期挪到运行期即可
> （`src/site/gtm.js` 底部有说明），页面结构不用动。

---

## 排错

| 现象 | 多半是 |
|---|---|
| 页面白屏、没有任何样式 | 页面里出现了 `/` 开头的资源引用（子路径部署下指到了域名根）。`npm test` 会拦住 |
| 榜单页没有样式但**面板也全空**，控制台报 `/src/site/xxx.js` 404 | 客户端脚本 import 了发布集合之外的文件（历史上 `trend.js` 引过 `src/site/boards.js`）。模块加载失败会**整条不执行**，所以不只是少一个文件。`npm test` 与构建都会拦住（`findMissingImports`） |
| 页面上直接显示 `{{BRAND}}` | 源码页被当成产物发布了 —— 检查工作流是否**先构建**再上传 `dist/` |
| 某个地址 404 | Pages 没有 rewrite。链接必须写成 `eval.html` 全名，不能写 `/eval` |
| 中文页里出现英文面板 | 该页的 `<html lang>` 不对。面板文案按 `lang` 取字典 |
| 面板显示 `err.xxx` 这样的字符串 | 字典缺键（`t()` 缺键时返回键名）。`npm test` 会拦住 |
| 面板显示"读取失败"，其余面板正常 | 只有那个源挂了或被 CORS 拦了 —— 这是**刻意**的设计。用 `npm run test:live` 确认是不是上游的问题 |
| 工作流在 deploy 步骤报错 | Settings → Pages → Source 没选 "GitHub Actions" |
| 换了部署但页面还是旧的 | Pages 会给 HTML/资源加缓存。硬刷新（`Cmd/Ctrl+Shift+R`）或换无痕窗口确认；**不要**因此去改构建 |

### 站根绝对路径是本站的头号故障源

两处解析链都要盯，缺一处就会漏（第二处曾经漏过一次，见上表第二行）：

| 链条 | 由谁发现 | 写错的样子 |
|---|---|---|
| HTML 的 `href` / `src` | `findMissingAssets` | `href="/site.css"` → 子路径部署下白屏 |
| ES module 的 `import` / `export … from` | `findMissingImports` | `import … from '../../../src/site/boards.js'` → 越出站点根，浏览器 404 |

两条都在**构建期**跑（`npm run build` 就会失败），`npm test` 里也各有一条断言。
凡是浏览器要取的文件，都必须落在发布集合里、且用**相对本文件**的路径引用；
只有 Node 侧（构建脚本、测试）可以直接按文件系统路径 import 仓库里的任何文件 ——
这也正是"本地怎么跑都成功、线上白屏"的来源。

---

## 从"有服务端"改回这条路时

本站的前身跑在 Vercel 上，有一个 Node 函数在**响应时**读页面、落占位符、
注入统计与 canonical，再返回。纯静态版把这一层整个去掉了：

- 去掉的东西：服务端本身、广告（AdSense 与它的 ads.txt、同意横幅）、
  canonical 与站长验证注入、systemd / Railway / Vercel 的部署配置。
- 从"响应时"**前移**到"构建时"的东西：占位符替换（品牌名、GTM 片段）。
- 新增的东西：`scripts/build-site.mjs`（构建 + 校验）、`scripts/serve.mjs`（本地预览）、
  `web/public/assets/site.test.js`（站点门禁）、`.github/workflows/pages.yml`。

改回"有服务端"那条路时，要记得本站新增的门禁（无绝对路径、构建期落占位符）
在那种架构下需要重新设计，不能照搬 —— 那时页面里会有运行时注入的标记，
而现在的断言要求它们在**发布物**里必须是已落值的真值。
