/**
 * 趋势大盘 —— 客户端数据层。
 *
 * ## 为什么全部在浏览器里跑
 * 榜单数据由**浏览器直接请求上游公开接口**，服务端只发静态页。
 * 代价是跨域能否成功由上游决定，所以每个源都必须实测过（见 docs/trend-sources.md）。
 *
 * ## 三条设计约束
 *  1. **一个面板坏了不拖垮整页**：每个面板各自 fetch、各自渲染、各自显示错误。
 *  2. **不静默失败**：拿不到数据时明确说出是哪个源、什么错误，以及部分成功时的
 *     "已取 N/M 页" —— 这个项目的历史教训是"静默降级"最难查。
 *  3. **不猜数据**：源里没有的字段就不显示；不做单位换算。
 *
 * ## 评测榜为什么这么绕（重要）
 * `datasets-server/rows` 有两条硬约束，实测得来：
 *   · 一页最多 100 条（length=500 → 422）；全量 4576 行 = 46 页；
 *   · 分页是**按 eval_name 字母序**，不是按分数 —— 所以"榜"必须自己取全量再排序。
 * 于是这里并发拉 46 页（分批，避免打爆连接），合并后按 Average 降序。
 * 结果写 sessionStorage（TTL 10 分钟），否则每次进页面都要拉 46 次。
 *
 * ## 为什么手写最小 YAML 解析而不引依赖
 * 本站零外部依赖（这是既有约定，见 README）。Aider 的榜是 YAML，但形态极简单 ——
 * 扁平数组、元素是标量映射、没有嵌套/锚点/多行块。所以解析器只需要认识这一种子集。
 * 若上游改用超出该子集的写法，本面板会**明确报错并只影响自己**，不会静默出错值。
 */

import { icon, injectIcons } from './ui.js';
import { t, tagChips } from './i18n.js';

/**
 * 当前页面的语言。
 *
 * 为什么不从 URL 里现推、而要读 <html lang>：语言在**服务端**就定了（/en/* 是英文），
 * 客户端只需照办。读 lang 保证两边说的是同一件事 —— 若客户端自己推一遍，
 * 一旦规则不同步就会出现"英文页头 + 中文面板"。
 */
export const LOCALE =
  typeof document === 'undefined'
    ? 'zh' // Node（测试/构建脚本）里没有 DOM，按默认语言即可
    : String(document.documentElement.getAttribute('lang') || 'zh').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh';

/** 取当前语言的一条文案（面板全部文案都走这里） */
const L = (key, vars) => t(LOCALE, key, vars);

/* ================================================================== */
/* 小的工具函数                                                        */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

/** 把数字格式化成好读的样子；非数字返回 null（调用方据此不显示） */
export function num(v, digits = 2) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/**
 * 把时间戳格式化成"9月30日 14:30"这种带日期的时刻，用于标注快照的抓取时间。
 * 只标到分钟：榜单是"这一批数据"而不是"这一秒的数据"，更细只会假精确。
 */
export function fmtStamp(ts) {
  return new Date(ts).toLocaleString(LOCALE === 'en' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 大数缩写：12345 → 12.3k */
export function compact(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** 转义：模型名/描述来自上游，直接插进 DOM 会把它们的标记当 HTML 执行 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 带缓存的取 JSON。
 * 为什么不用 fetch 的 cache 选项：那是 HTTP 缓存，受上游响应头支配；
 * 我们要的是"这个页面这次会话里别再重复拉 46 页"，所以自己存。
 *
 * ★ 这一版加了一层捕获：`sessionStorage` 这个**属性访问本身**在部分浏览器里会抛
 * SecurityError（Cookie/站点数据被完全拦掉时，例如"阻止所有 Cookie"的 Chrome、
 * 内嵌 WebView、或某些隐私模式）。原来的写法把这个访问放在 try 外面，
 * 于是一个存储策略就能让整页脚本在求值时死掉 —— 而它只是缓存，不该有这种权力。
 * 存储层整体降级为"永远未命中"（每次直接走网络），其余一切照常。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = 'trend-panel-cache:';
const cacheKey = (k) => `${CACHE_PREFIX}${k}`;

/** 取缓存条目（连写入时刻 t 一起返回，供"抓取于 HH:MM"这类标注用）；过期/异常返回 null */
function readCacheEntry(key, ttl) {
  try {
    const raw = sessionStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttl ? { t, v } : null;
  } catch {
    return null;
  }
}

function readCache(key, ttl) {
  return readCacheEntry(key, ttl)?.v ?? null;
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(cacheKey(key), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* 存不下就算了（配额/隐私模式/存储被禁），不影响本次展示 */
  }
}

/**
 * 清空本页缓存（"刷新数据"按钮用）。返回清掉的条数，便于测试与排错。
 * 只清 sessionStorage 的 10 分钟缓存；localStorage 里的**快照不清** ——
 * 快照是"上游读不动时"的回退物，刷新求的是新数据，不是丢掉唯一的旧数据。
 */
export function clearCache() {
  let n = 0;
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(CACHE_PREFIX)) {
        sessionStorage.removeItem(k);
        n += 1;
      }
    }
  } catch {
    /* 存储不可用时没有缓存可清 —— 面板本来就每次都走网络 */
  }
  return n;
}

/* ── localStorage 快照层：给"上游读不动"时回退，比 sessionStorage 长命 ──
 *
 * 两层存储职责不同：
 *   · sessionStorage 缓存（上面那组）= "这 10 分钟内不重复拉"的**新鲜缓存**，
 *     标签页关了就没关系 —— 丢了就再拉一次；
 *   · localStorage 快照 = "这台浏览器最后一次成功抓取"的**存底**，
 *     跨标签页、关浏览器还在 —— 回退物的价值就在于"还在"。
 *
 * 快照永远带着写入时刻（t），展示时如实标注"抓取于几时"：旧数据标着旧时间，
 * 不冒充新数据。隐私模式/配额满时存不下，就当没有回退物，不影响本次展示。
 */
const SNAP_PREFIX = 'trend-snap:';

/** 读快照（连写入时刻一起返回）；超龄/不存在/存储不可用返回 null */
function readSnapshot(key, maxAgeMs = Number.MAX_SAFE_INTEGER) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < maxAgeMs ? { t, v } : null;
  } catch {
    return null;
  }
}

function writeSnapshot(key, v) {
  try {
    localStorage.setItem(SNAP_PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* 存不下就没有回退物，不影响本次展示 */
  }
}

/**
 * "刷新数据"的**强制重拉**标记（sessionStorage，但不在缓存前缀下、不会被清掉）。
 * 为什么需要它：评测榜对 7 天内的快照直接复用（数据源已归档，快照即全量），
 * 不设标记的话，点"刷新数据"会清掉缓存、然后又被快照挡住 —— 按钮看起来没反应。
 */
const FORCE_KEY = 'trend-force-refetch';

function forceRefetch() {
  try {
    if (sessionStorage.getItem(FORCE_KEY)) {
      sessionStorage.removeItem(FORCE_KEY);
      return true;
    }
  } catch {
    /* 读不了就当没有标记 —— 顶多这次不强制，不会出错 */
  }
  return false;
}

async function cachedJson(key, url, { ttl = CACHE_TTL_MS } = {}) {
  const hit = readCache(key, ttl);
  if (hit !== null) return hit;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const v = await res.json();
  writeCache(key, v);
  return v;
}

/* ================================================================== */
/* 面板骨架                                                            */
/* ================================================================== */

/**
 * 面板容器。
 *
 * 为什么这里要判 `typeof document`：本文件同时被 Node 里的测试 import
 * （测 YAML 解析与分页合并这两段纯逻辑）。顶层直接摸 `document` 会让测试
 * 连模块都加载不了，于是"最容易出错的两段"反而测不到。
 */
const panelsRoot = typeof document === 'undefined' ? null : document.querySelector('#panels');

/**
 * 全部面板的 id —— **页面地址契约**。
 *
 * 每个面板有自己的一页（`trending.html`、`eval.html`…），页面用
 * `<div id="panels" data-board="trending">` 声明自己要跑哪一个。
 * 所以这些 id 同时是三样东西：DOM 契约、页面文件名、导航链接的目标。
 * 改 id = 改地址，必须与发布集合和页头导航一起改（`site.test.js` 盯着）。
 *
 * 真值住在 `./boards.js`（同级文件）：浏览器只能拿到发布集合里的文件，
 * 所以它必须在 `assets/` 下，`trend.js` 才 import 得到。那三个在 Node 下跑的
 * 消费者（构建脚本、站点测试、页头生成器）隔着目录引它没问题，反过来则不然。
 * 这里再导出一次，是为了让测试继续从同一个地方取（也免得 `./trend.js` 的
 * 既有引用者改 import）。
 */
export { BOARD_IDS, BOARD_TAGS } from './boards.js';
import { BOARD_IDS, BOARD_TAGS } from './boards.js';

/**
 * 本页到站点根的相对前缀 —— 标签链接要用（中文页 `tag.html`，英文页 `../tag.html`）。
 * 与 `ui.js` 的回填同一套判断：语言已经是 `LOCALE` 定好的，这里只需要知道层级。
 */
const TAG_PREFIX = LOCALE === 'en' ? '../' : '';

/**
 * 本页要跑哪个面板：`data-board` 指名的那一个；**没写就是全部**。
 *
 * "没写就跑全部"是可贵的兜底：它是本文件在 Node 测试与旧页面下的行为，
 * 也让"忘了写 data-board"退化成"跑得慢一点"而不是"空白页"。
 * 但写了**且名字不认识**就是硬错误 —— 那种情况只会是页面写错或 id 改过，
 * 静默渲染空白页是本站最不想要的那种失败（见 startAll 里的报错）。
 */
const requestedBoard = String(panelsRoot?.dataset?.board || '').trim();
const wantedIds = requestedBoard ? BOARD_IDS.filter((id) => id === requestedBoard) : BOARD_IDS;

/**
 * 单面板页：本页只有一个面板，于是这个面板就是页面的主体 ——
 * 它的标题升级成 `<h1>`（一页一个 h1，且不另写一遍 hero 标题）。
 * 这样"面板叫什么"仍然只有 `i18n.js` 一处来源，22 个页面文件里一个字都不重复。
 */
const SINGLE_BOARD = Boolean(requestedBoard);


/** 加载中的骨架：铺几行灰条，让人知道"这里会有内容"以及大致是表格的形状 */
function skeleton(lines = 5) {
  return `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(lines)}</div>`;
}

/**
 * 建一个面板并返回它的操作柄。
 * 面板先以"加载中"出现，填好后替换 —— 避免整页空白等最慢的那个源。
 */
/**
 * 把一个新建的面板挂进容器 —— **同 id 已存在就原地替换**。
 *
 * ★ 这里曾是一个真实故障：`panel()` 无条件 `appendChild`，于是"切换子榜"
 * （点击 chip 会重新调用 loader）不是切换，而是**又追加一个同 id 的面板**，
 * 旧的那个还在 DOM 里 —— 读者看到的仍是原来的数据，像是"点了没反应"。
 * 页面上不报错，同一页出现两个同 id 元素也不会被浏览器指出。
 *
 * 抽成独立函数是为了能测：它只依赖一个"像 parent 的东西"（`querySelector`
 * / `appendChild` / `replaceWith`），不必造一整个假 DOM。
 */
export function attachPanel(root, el, id) {
  const existing = root.querySelector(`#panel-${id}`);
  // 原地替换而不是"删了再追加"：后者会把面板挪到列表末尾，
  // 多面板页面上会看到顺序莫名其妙地变。
  if (existing) existing.replaceWith(el);
  else root.appendChild(el);
  return el;
}

function panel({ id, iconName, title, hint }) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = `panel-${id}`;
  // 整页只有这一个面板时，它的标题就是页面的标题 —— 用 h1 承担
  // （一页一个 h1；读屏器也能靠它一眼报出"这是什么页"）
  const heading = SINGLE_BOARD ? 'h1' : 'h2';
  // 这个榜的标签（来源 + 分类），点进去按类看别的榜。标签真值见 boards.js。
  const tags = tagChips(BOARD_TAGS[id], TAG_PREFIX);
  el.innerHTML = `
    <header class="panel-head">
      <${heading}><span class="panel-icon">${icon(iconName)}</span>${esc(title)}</${heading}>
      ${hint ? `<p class="panel-hint">${esc(hint)}</p>` : ''}
      ${tags ? `<p class="panel-tags">${tags}</p>` : ''}
    </header>
    <p class="panel-status loading" aria-live="polite">${L('ui.loading')}</p>
    <div class="panel-body">${skeleton()}</div>`;
  attachPanel(panelsRoot, el, id);
  return {
    el,
    status: (text, kind = '') => {
      const p = $('.panel-status', el);
      p.textContent = text;
      // 转圈只在"还在动"的时候出现；拿到结果或报错就停下
      p.className = `panel-status ${kind}${kind ? '' : ' loading'}`;
      p.hidden = !text;
    },
    body: (html) => {
      $('.panel-body', el).innerHTML = html;
    },
  };
}

/** 把一组行的渲染包成表格（列少、行多，表格最省事也最可读） */
export function table(cols, rows, sort = null) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  // 每列可以带 `num`（右对齐、等宽数字）与 `cls`（例如 col-2：窄屏收起）。
  // 表头也支持 `html`，用于放图标（纯文本的 label 会被读屏器念出来）。
  const clsOf = (c) => [c.num ? 'num' : '', c.cls || ''].filter(Boolean).join(' ');
  const head = cols
    .map((c, i) => {
      // `sortable: false` 的列不参与排序（例如纯图标列）
      const sortable = c.sortable !== false;
      const active = sort && sort.index === i;
      const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const k = [clsOf(c), sortable ? 'sortable' : '', active ? 'sorted' : ''].filter(Boolean).join(' ');
      const inner = c.html ?? esc(c.label);
      const attrs = sortable ? ` data-sort="${i}" role="button" tabindex="0" title="${L('ui.sortHint')}"` : '';
      // 排序状态用 aria-sort 播报给读屏器（视觉箭头它们看不到）
      const aria = active ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      return `<th${k ? ` class="${k}"` : ''}${attrs}${aria}>${inner}${arrow}</th>`;
    })
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const k = clsOf(c);
            return `<td${k ? ` class="${k}"` : ''}>${c.cell(r)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ================================================================== */
/* 卡片 + 详情层                                                        */
/* ================================================================== */

/**
 * 卡片：一屏只放前 N 个（默认 10），点进去看详情。
 *
 * 为什么卡片和表格都要有（而不是互相取代）：
 *   · 卡片回答"现在最靠前的是谁" —— 数字大、标题大，扫一眼就够，适合手机；
 *   · 表格回答"第 47 名是谁 / 按成本排一下" —— 需要筛选、排序、看全量。
 * 两者解决的不是同一个问题，所以卡片在上、表格在下（表格可折叠）。
 */
/**
 * 卡片栅格。
 *
 * ## ★ value / meta 是**可选**的，判空必须在调用之前
 * 早先这里写的是 `cfg.value(r) ? … : ''` ——看着像判空，其实**先调了再判**：
 * `meta` 没给的榜单会在这里直接抛 `cfg.meta is not a function`，整块面板变成
 * "读取失败"。而 `mountBoard` 的详情路径用的是 `cfg.card.meta ? … : ''`
 * （先判存在再调），两处语义不一致，于是"省略 meta"在详情里没事、在卡片上崩。
 * 现在两边一致：**先判函数是否存在，再调**。
 *
 * `title` 仍是必需的 —— 没有标题的卡片没有意义，缺了就该在开发时炸，
 * 而不是渲染一张空卡。
 */
export function cardGrid(rows, cfg) {
  if (!rows.length) return `<p class="empty">${L('ui.noData')}</p>`;
  const cards = rows
    .map((r, i) => {
      const value = cfg.value ? cfg.value(r) : '';
      const meta = cfg.meta ? cfg.meta(r) : '';
      return (
        `<button class="card" type="button" data-card="${i}">` +
        `<span class="card-rank">${rankBadge(r.__rank ?? i + 1)}</span>` +
        `<span class="card-main">` +
        `<span class="card-title">${cfg.title(r)}</span>` +
        (value ? `<span class="card-value">${value}</span>` : '') +
        `</span>` +
        (meta ? `<span class="card-meta">${meta}</span>` : '') +
        `</button>`
      );
    })
    .join('');
  return `<div class="cards">${cards}</div>`;
}

/**
 * 详情层：用**原生 `<dialog>`**。
 *
 * 为什么不用自己拼的浮层：原生 dialog 自带三件很难做对的事 ——
 * Esc 关闭、焦点陷阱（Tab 不会跑到背后的页面）、以及 inert 背景
 * （读屏器不会念到背后的内容）。自己实现这三件，通常只做对第一件。
 */
export function openDetail({ title, meta = '', body = '', link = null, linkLabel = '' }) {
  let dlg = document.getElementById('detail');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'detail';
    dlg.className = 'detail';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML =
    '<form method="dialog" class="detail-close-wrap">' +
    `<button class="icon-btn detail-close" type="submit" aria-label="${L('ui.close')}">` +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg></button></form>' +
    `<h2>${title}</h2>` +
    (meta ? `<p class="detail-meta">${meta}</p>` : '') +
    `<div class="detail-body">${body}</div>` +
    (link ? `<p class="detail-link"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel || link)} ↗</a></p>` : '');

  // showModal 在极老的浏览器上没有 —— 那种情况下退化成"直接新窗口打开链接"，
  // 总比点了没反应好
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else if (link) window.open(link, '_blank', 'noopener');
}

/** 详情里的一行"标签 / 值" */
export function detailRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

/**
 * 把 cols 定义的列转成"详情表"用的一行行。
 * 复用它，是为了详情里的字段与表格里的列**永远一致** ——
 * 否则加了一列却忘了加进详情（或反过来），是最容易发生的漂移。
 */
export function detailFromCols(cols, row) {
  return cols
    .filter((c) => c.label !== '#')
    .map((c) => detailRow(c.label, c.cell(row)))
    .join('');
}

/**
 * 从一行里取用于比较的值。
 * 优先 `col.value(row)`（渲染之外单独给一个取值函数，避免为了排序去解析 HTML），
 * 没有就用 `row[col.field]`。
 */
function cellValue(col, row) {
  return col.value ? col.value(row) : row[col.field];
}

/**
 * 对一批行做「分组过滤 → 文本搜索 → 排序」。
 *
 * 抽成一份纯函数的原因：11 个面板都要这三件事，而数据形态各不相同
 * （模型/应用/数据集/论文/仓库/成绩）。写成一份，规则才不会每个面板一个样 ——
 * 尤其是下面「空值恒排最后」这条，逐处手写必然会有几处漏掉。
 *
 * ★ 空值恒排在最后（无论升序降序）：否则一升序，"缺数据的"会全聚到榜首，
 * 读者看到的就是一个由空值组成的假榜。
 */
export function applyBoardState(rows, cols, state, { searchFields = [], groupField = null } = {}) {
  let out = Array.isArray(rows) ? rows : [];

  if (groupField && state.group && state.group !== '*') {
    out = out.filter((r) => String(r?.[groupField] ?? '') === state.group);
  }

  const q = String(state.q || '').trim().toLowerCase();
  if (q) {
    const fields = searchFields.length ? searchFields : ['id', 'name', 'model', 'title', 'full_name'];
    out = out.filter((r) => fields.some((f) => String(r?.[f] ?? '').toLowerCase().includes(q)));
  }

  if (state.sort && cols[state.sort.index]) {
    const col = cols[state.sort.index];
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = cellValue(col, a);
      const vb = cellValue(col, b);
      const ea = va === null || va === undefined || va === '';
      const eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1; // 空的恒在最后
      if (eb) return -1;
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }
  return out;
}

/** 过滤控件的 HTML：搜索框 + 可选的分组下拉 */
export function controlsHtml({ q = '', placeholder = L('ui.search'), groups = null, groupLabel = L('ui.allGroups'), group = '*' } = {}) {
  const sel = groups
    ? `<select data-group aria-label="${esc(groupLabel)}"><option value="*">${esc(groupLabel)}</option>` +
      groups
        .map((g) => `<option value="${esc(g.value)}"${g.value === group ? ' selected' : ''}>${esc(g.label)} (${g.count})</option>`)
        .join('') +
      '</select>'
    : '';
  return (
    `<div class="controls">` +
    `<input type="search" data-q value="${esc(q)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">` +
    sel +
    '</div>'
  );
}

/** 从数据里算出分组下拉的选项（按出现次数降序） */
export function groupOptions(rows, field, labelOf = (v) => v) {
  const m = new Map();
  for (const r of rows) {
    const v = String(r?.[field] ?? '').trim();
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, label: labelOf(value) }));
}

/**
 * 挂一个可过滤/可排序的榜到面板上。
 *
 * 状态（搜索词、分组、排序）留在闭包里；每次变化只重画面板 body，
 * 并**重新绑定**事件 —— 因为 DOM 被整块替换了。这是本站统一的榜渲染入口。
 */
function mountBoard(p, cfg) {
  const state = { q: '', group: '*', sort: cfg.defaultSort || null };
  const baseRows = cfg.rows;

  const draw = () => {
    let rows = applyBoardState(baseRows, cfg.cols, state, cfg);
    // transform 在"过滤 + 排序"**之后**套 —— 名次徽章必须按当前显示顺序重算，
    // 否则筛掉一半后序号还停在原始位置上（1,3,7,…）
    if (cfg.transform) rows = cfg.transform(rows);
    const shown = cfg.limit ? rows.slice(0, cfg.limit) : rows;
    const groups = cfg.groupField ? groupOptions(baseRows, cfg.groupField) : null;
    const total = baseRows.length;
    const base = rows.length !== total ? L('ui.countFiltered', { n: rows.length, total }) : L('ui.count', { n: total });
    const note = cfg.note ? `${base} · ${cfg.note}` : base;
    const limit = cfg.cardLimit ?? 10;

    // ── 卡片区：只放前 N 个，点进去看详情 ──
    // 卡片在**过滤/排序之后**取，所以搜索"gemini"时看到的就是命中的那几个。
    const cards = cfg.card ? cardGrid(shown.slice(0, limit), cfg.card) : '';
    const moreCount = rows.length - Math.min(rows.length, limit);
    const cardsHtml = cards
      ? cards +
        (moreCount > 0
          ? `<p class="cards-more">${L('ui.moreInList', { n: moreCount })}</p>`
          : '')
      : '';

    // ── 完整列表：放在折叠区里 ──
    // 为什么表格不删：卡片回答"最靠前的是谁"，表格回答"第 47 名是谁 / 按成本排一下"。
    // 两者不是同一个问题，所以保留，但收起来不占首屏。
    const listHtml = cfg.table === false
      ? ''
      : `<details class="more"${state.open ? ' open' : ''}>` +
        `<summary>${L('ui.fullList', { n: rows.length })}</summary>` +
        controlsHtml({
          q: state.q,
          groups,
          group: state.group,
          placeholder: cfg.placeholder || L('ui.search'),
          groupLabel: cfg.groupLabel || L('ui.allGroups'),
        }) +
        `<p class="board-count">${esc(note)}</p>` +
        table(cfg.cols, shown, state.sort) +
        '</details>';

    p.body((cfg.beforeControls ? cfg.beforeControls() : '') + cardsHtml + listHtml);

    // 卡片点击 → 详情层
    const rowsForCards = shown.slice(0, limit);
    for (const el of p.el.querySelectorAll('[data-card]')) {
      el.addEventListener('click', () => {
        const row = rowsForCards[Number(el.getAttribute('data-card'))];
        if (!row) return;
        openDetail({
          title: cfg.card.title(row),
          meta: cfg.card.meta ? cfg.card.meta(row) : '',
          body: `<dl class="detail-list">${detailFromCols(cfg.cols, row)}</dl>`,
          link: cfg.card.link ? cfg.card.link(row) : null,
          linkLabel: L('ui.openSource'),
        });
      });
    }

    // 折叠区的开合状态记住，重画（比如搜索）时不要把用户的展开动作弹回去
    const det = p.el.querySelector('details.more');
    if (det) det.addEventListener('toggle', () => { state.open = det.open; });
    // 重新绑定（DOM 已换）
    const q = p.el.querySelector('[data-q]');
    if (q) {
      q.addEventListener('input', () => {
        state.q = q.value;
        const pos = q.selectionStart;
        draw();
        // 保持焦点与光标位置，否则每敲一个字都会掉焦点
        const nq = p.el.querySelector('[data-q]');
        if (nq) {
          nq.focus();
          try { nq.setSelectionRange(pos, pos); } catch { /* 该类型不支持就算了 */ }
        }
      });
    }
    const g = p.el.querySelector('[data-group]');
    if (g) g.addEventListener('change', () => { state.group = g.value; draw(); });
    for (const th of p.el.querySelectorAll('th[data-sort]')) {
      const idx = Number(th.getAttribute('data-sort'));
      const toggle = () => {
        const cur = state.sort;
        // 同一列再点一次 → 反向；换一列 → 从降序开始（榜最常要看的是"最大的"）
        state.sort = cur && cur.index === idx
          ? { index: idx, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
          : { index: idx, dir: 'desc' };
        draw();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
  };

  draw();
}

/**
 * 名次徽章。前三名用奖牌色 —— 这是"榜"最需要的信息，不该让人自己数序号。
 * 颜色之外还有数字本身，所以不依赖颜色单独传达信息（色盲可用）。
 */
export function rankBadge(n) {
  const cls = n <= 3 ? ` r${n}` : '';
  return `<span class="rank${cls}">${n}</span>`;
}

/**
 * 迷你条形图：宽度相对**当前这一批行里的最大值**。
 * 它表达的是"相对高低"，不是绝对刻度 —— 同一张表内可比，跨表不可比。
 * 这对"一眼看出差距"够用，而且不需要坐标轴。
 */
export function bar(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return '';
  const pct = Math.max(2, Math.min(100, (v / m) * 100)); // 最小 2%：0 分也要看得见那一条
  return `<span class="bar" aria-hidden="true"><i style="--w:${pct.toFixed(1)}%"></i></span>`;
}

/** 模型名 → HuggingFace 页面链接（模型名是 [org/name] 形态） */
const hfLink = (id) => `<a href="https://huggingface.co/${encodeURI(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`;

/* ================================================================== */
/* 面板 1-3：HuggingFace 模型榜（趋势 / 喜欢 / 下载）                  */
/* ================================================================== */

const HF_MODELS = 'https://huggingface.co/api/models';

/** 三个排行共用一套渲染，只有 sort 与那"一列关键数字"不同 */
function modelBoardCols(metric) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
    { label: L('col.model'), field: 'id', cell: (r) => hfLink(r.id) },
    {
      label: L('col.task'),
      field: 'pipeline_tag',
      cls: 'col-2',
      cell: (r) => (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : ''),
    },
    {
      // 表头用图标 + 视觉隐藏的文字：图标省地方，文字让读屏器念得出来
      html: `${icon(metric.icon)}<span class="sr-only">${esc(metric.label)}</span>`,
      num: true,
      field: metric.field,
      cell: (r) => `${bar(r[metric.field], metric.max)}${compact(r[metric.field]) ?? '—'}`,
    },
    {
      html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'likes',
      cell: (r) => compact(r.likes) ?? '—',
    },
    {
      html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`,
      num: true,
      cls: 'col-2',
      field: 'downloads',
      cell: (r) => compact(r.downloads) ?? '—',
    },
  ];
}

/** 名次徽章要在**过滤/排序之后**重算，否则筛掉一半后序号还是原始的 */
function withRank(rows) {
  return rows.map((r, i) => ({ ...r, __rank: i + 1 }));
}

async function loadModelBoard({ id, iconName, title, sort, metric, hint }) {
  const p = panel({
    id,
    iconName,
    title,
    hint,
  });
  try {
    const url = `${HF_MODELS}?sort=${sort}&direction=-1&limit=50`;
    const data = await cachedJson(`hf-${sort}`, url);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    p.status('', 'ok');
    const max = Math.max(...data.map((r) => Number(r[metric.field]) || 0), 0);
    mountBoard(p, {
      rows: data,
      cols: modelBoardCols({ ...metric, max }),
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'pipeline_tag',
      groupLabel: L('ui.allTasks'),
      placeholder: L('ui.searchModels'),
      // 行本身要带序号：重排后序号得跟着走
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r[metric.field]) ?? '—'}</span> <span class="v-unit">${esc(metric.label)}</span>`,
        meta: (r) =>
          (r.pipeline_tag ? `<span class="tag">${esc(r.pipeline_tag)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 4：HuggingFace 开源模型评测榜                                   */
/* ================================================================== */

const EVAL_DS = 'open-llm-leaderboard%2Fcontents';
const EVAL_ENDPOINT = 'https://datasets-server.huggingface.co/rows';
const EVAL_PAGE = 100;
const EVAL_TOP = 50;

/**
 * 取数节奏 —— **降并发 + 错峰 + 分级退避**，参数全部来自 2026-09-30 的实测校准：
 *
 * datasets-server 对匿名 IP 是"突发容量 + 慢回填"的令牌桶：
 *   · 桶满时 46 页 8 并发连发也能全 200（实测 11.9s）；
 *   · 桶被前面的请求耗过后，429 `Too Many Requests` 会持续 **约 60–70 秒**才回填
 *     （实测：46 连发后每 10s 探测一次，+10s…+60s 全 429，+70s 恢复 200）；
 *   · 旧实现 8 并发 + 失败后**立刻原样重发**，在半空的桶上就是连环 429：
 *     线上真实出现过 13/46 页失败（71% 覆盖）和"第一页都没拿到"两种残局。
 *
 * 所以策略是：3 并发 + 批间 700ms（持续 ~1.2 请求/秒，桶满时 ~35s 拉完全量）；
 * 普通失败短退避（800ms 起指数放大）；**429 单独长退避**（25s×次数，封顶 60s ——
 * 等的是桶回填，不是网络恢复，短退避只会再撞一次）。
 * `live-check.mjs` 复用这一份策略，体检跑的就是访客的真实节奏。
 */
export const EVAL_FETCH = {
  batch: 3, // 每批并发页数
  batchGapMs: 700, // 批与批之间停一拍：限流按"每秒请求数"计，无缝连发等于没降并发
  attempts: 3, // 单页尝试次数（含首次）
  firstAttempts: 5, // 第一页决定总页数与整块面板的去留，多给两次机会
  backoffMs: 800, // 普通失败（网络抖动/5xx）的退避基数：800ms → 1.6s → 3.2s…封顶 5s
  rateLimitUnitMs: 25000, // 429 的退避单位：25s×次数，封顶 60s（等桶回填，见 evalRetryWaitMs）
};

/** 评测榜快照的"直用窗口"：数据源 2025-03 已归档，快照就是最新全量，
 *  7 天内的快照直接用、不再打上游 46 个请求（见 loadEvalBoard）。 */
const EVAL_SNAPSHOT_MS = 7 * 24 * 60 * 60 * 1000;

const evalRowsUrl = (offset) =>
  `${EVAL_ENDPOINT}?dataset=${EVAL_DS}&config=default&split=train&offset=${offset}&length=${EVAL_PAGE}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 第 n 次失败后等多久再试（普通失败）：基数按 2 的幂放大，封顶 5s。纯函数，测试盯着它 */
export function evalBackoffMs(attempt, base = EVAL_FETCH.backoffMs) {
  return Math.min(base * 2 ** (attempt - 1), 5000);
}

/**
 * 第 n 次失败后等多久再试（**分失败类型**）：
 *   · 上游 429 带 Retry-After → 听上游的（它说的比自家猜的准）；
 *   · 429 没说 → `rateLimitUnitMs` × 尝试次数，封顶 60s。**不是网络问题，
 *     是桶要回填**：实测耗尽的桶约 60–70s 才恢复，秒级重试只会连环再撞；
 *   · 其它失败（网络抖动 / 5xx / 解析异常）→ 短退避（evalBackoffMs）就够。
 * 纯函数；`pacing` 参数给测试注入零等待用，浏览器永远用 EVAL_FETCH 默认值。
 */
export function evalRetryWaitMs(status, retryAfterMs, attempt, pacing = EVAL_FETCH) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  if (status === 429) return Math.min((pacing.rateLimitUnitMs ?? 0) * attempt, 60000);
  return evalBackoffMs(attempt, pacing.backoffMs);
}

/** 一个原始行 → 我们展示需要的字段；分数缺失的行返回 null（不让空值参与排序） */
export function normalizeEval(row) {
  const model = String(row.fullname || '').trim();
  if (!model) return null;
  const score = parseFloat(row['Average ⬆️']);
  if (!Number.isFinite(score)) return null;
  const f = (k) => {
    const v = parseFloat(row[k]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    model,
    score,
    ifeval: f('IFEval'),
    bbh: f('BBH'),
    math: f('MATH Lvl 5'),
    gpqa: f('GPQA'),
    mmlupro: f('MMLU-PRO'),
    params: f('#Params (B)'),
  };
}

/** 取一页原始成绩；重试耗尽仍失败返回 null（单页失败不该让整个榜消失） */
async function fetchEvalPage(offset, attempts = EVAL_FETCH.attempts, pacing = EVAL_FETCH) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status = null; // 本轮失败的 HTTP 状态（网络层错误时是 null）
    let retryAfterMs = null; // 上游 429 时会明确说"多久再来"
    try {
      const res = await fetch(evalRowsUrl(offset), { headers: { accept: 'application/json' } });
      status = res.status;
      if (!res.ok) {
        const ra = Number(res.headers?.get?.('retry-after'));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 60000);
        throw new Error(`HTTP ${res.status}`);
      }
      const j = await res.json();
      if (!Array.isArray(j?.rows)) throw new Error(L('err.noRows'));
      return j;
    } catch (e) {
      // 退避时长按失败类型分（见 evalRetryWaitMs）：429 等桶回填，其它等网络缓过来。
      // 旧实现是失败后立刻原样重发 —— 对 429 恰好是再撞一次限流
      if (attempt === attempts) return null;
      await sleep(evalRetryWaitMs(status, retryAfterMs, attempt, pacing));
    }
  }
  return null; // 循环正常走不出这里；这行写给读代码的人
}

/**
 * 拉全量（第一页探总数 → 分批限速取余下页）。
 *
 * 为什么必须先拉第一页：**页数只能在拿到 `num_rows_total` 之后才知道**
 * （46 页这个数字不是写死的，上游加模型时会变）。第一页失败就直接报错 ——
 * 没有总数就无法判断"取了多少比例"，与其显示一个残榜不如明说拿不到。
 *
 * `policy` 参数是给测试与 `live-check.mjs` 用的（传零延迟跑得快）；
 * 浏览器里永远用上面那份 EVAL_FETCH 默认值。
 */
export async function fetchAllEvalPages(onProgress, policy = EVAL_FETCH) {
  const first = await fetchEvalPage(0, policy.firstAttempts, policy);
  if (!first) throw new Error(L('err.evalFirst'));

  const total = Number.isFinite(first.num_rows_total) ? first.num_rows_total : null;
  const pageCount = total ? Math.ceil(total / EVAL_PAGE) : 1;
  const rows = [...first.rows.map((x) => x.row)];
  let failed = 0;

  const rest = [];
  for (let o = EVAL_PAGE; o < pageCount * EVAL_PAGE; o += EVAL_PAGE) rest.push(o);

  onProgress?.({ done: 1, total: pageCount, got: rows.length, failed });

  for (let i = 0; i < rest.length; i += policy.batch) {
    // 批间错峰：限流按"每秒请求数"计，一批接一批无缝连发就等于没降并发
    if (i > 0) await sleep(policy.batchGapMs);
    const batch = rest.slice(i, i + policy.batch);
    const results = await Promise.all(batch.map((o) => fetchEvalPage(o, policy.attempts, policy)));
    for (const r of results) {
      if (r) rows.push(...r.rows.map((x) => x.row));
      else failed += 1;
    }
    onProgress?.({ done: 1 + Math.min(i + policy.batch, rest.length), total: pageCount, got: rows.length, failed });
  }
  return { rows, failed, total, pageCount };
}

function evalBoardCols(max) {
  return [
    { label: '#', sortable: false, cell: (r) => rankBadge(r.rank) },
    { label: L('col.model'), field: 'model', cell: (r) => hfLink(r.model) },
    { label: L('col.avg'), num: true, field: 'score', cell: (r) => `${bar(r.score, max)}${num(r.score, 1) ?? '—'}` },
    // 以下几列在窄屏收起（site.css 的 .col-2）：手机上横向滚 9 列很难用，
    // 优先保证"哪个模型、多少分"这两件事可读
    { label: L('col.params'), num: true, cls: 'col-2', field: 'params', cell: (r) => num(r.params, 1) ?? '—' },
    { label: 'IFEval', num: true, cls: 'col-2', field: 'ifeval', cell: (r) => num(r.ifeval, 1) ?? '—' },
    { label: 'BBH', num: true, cls: 'col-2', field: 'bbh', cell: (r) => num(r.bbh, 1) ?? '—' },
    { label: 'MATH', num: true, cls: 'col-2', field: 'math', cell: (r) => num(r.math, 1) ?? '—' },
    { label: 'GPQA', num: true, cls: 'col-2', field: 'gpqa', cell: (r) => num(r.gpqa, 1) ?? '—' },
    { label: 'MMLU-PRO', num: true, cls: 'col-2', field: 'mmlupro', cell: (r) => num(r.mmlupro, 1) ?? '—' },
  ];
}

/** 评测榜：每次都要按当前顺序重排名次 */
function rankEvalRows(rows) {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 评测榜的挂载：limit 用 EVAL_TOP，并把"覆盖多少页"这类口径放进说明 */
function mountEvalBoard(p, models, note) {
  mountBoard(p, {
    rows: models,
    cols: evalBoardCols(Math.max(...models.map((r) => r.score), 0)),
    defaultSort: { index: 2, dir: 'desc' },
    limit: EVAL_TOP,
    searchFields: ['model'],
    placeholder: L('ui.searchModels'),
    transform: rankEvalRows,
    note,
    card: {
      title: (r) => esc(r.model),
      value: (r) => `<span class="v-num">${num(r.score, 1)}</span> <span class="v-unit">${L('col.avg')}</span>`,
      meta: (r) =>
        (r.params ? `<span class="tag">${num(r.params, 1)}B</span>` : '') +
        `<span class="tag">IFEval ${num(r.ifeval, 1) ?? '—'}</span>` +
        `<span class="tag">MMLU-PRO ${num(r.mmlupro, 1) ?? '—'}</span>`,
      link: (r) => `https://huggingface.co/${encodeURI(r.model)}`,
    },
  });
}

async function loadEvalBoard() {
  const p = panel({
    id: 'eval',
    iconName: 'trophy',
    title: L('p.eval.title'),
    hint: L('p.eval.hint'),
  });
  // 走 readCacheEntry()/readSnapshot() 而不是直接碰存储：存储被禁用时要降级成
  // "没有缓存"，而不是让整块面板崩掉（它只是缓存，不该有这种权力）
  const cached = readCacheEntry('eval-board', CACHE_TTL_MS);
  if (cached && Array.isArray(cached.v) && cached.v.length) {
    p.status('', 'ok');
    mountEvalBoard(p, cached.v, L('ui.cached', { n: cached.v.length, time: fmtStamp(cached.t) }));
    return;
  }

  // 7 天内的快照直接用（除非"刷新数据"点了强制重拉）：数据源 2025-03 已归档，
  // 快照就是最新全量 —— 与其每次进页面都打上游 46 个限流敏感的请求，
  // 不如把"每台浏览器每 7 天拉一次全量"作为常态。时刻照实标注。
  const forced = forceRefetch();
  const snap = readSnapshot('eval-board', EVAL_SNAPSHOT_MS);
  if (!forced && snap && Array.isArray(snap.v) && snap.v.length) {
    p.status('', 'ok');
    mountEvalBoard(p, snap.v, L('st.evalSnap', { time: fmtStamp(snap.t) }));
    return;
  }

  p.status(L('st.fetchingPages'));
  const seen = new Map(); // 以模型名去重：同一模型可能有多个精度版本，保留分高的那个
  let lastStatus = '';
  try {
    const { rows, failed, pageCount } = await fetchAllEvalPages(({ done, total, got, failed }) => {
      const s = failed
        ? L('st.progressFailed', { got, done, total, failed })
        : L('st.progress', { got, done, total });
      if (s !== lastStatus) {
        lastStatus = s;
        p.status(s);
      }
    });

    for (const row of rows) {
      const m = normalizeEval(row);
      if (!m) continue;
      const prev = seen.get(m.model);
      if (!prev || m.score > prev.score) seen.set(m.model, m);
    }
    const models = [...seen.values()];
    if (!models.length) throw new Error(L('err.noBoard'));

    // 只有**零缺页**的完整结果才进 10 分钟缓存；部分成功不进 ——
    // 否则一次 71% 覆盖会在缓存期内被当成完整榜反复展示
    if (!failed) writeCache('eval-board', models);
    // 快照（localStorage）无论完整与否都写：它只当回退物与 7 天直用窗口的来源
    writeSnapshot('eval-board', models);

    p.status('', failed ? 'warn' : 'ok');
    mountEvalBoard(
      p,
      models,
      failed
        ? L('st.evalDonePartial', { n: models.length, pages: pageCount, failed, time: fmtStamp(Date.now()) })
        : L('st.evalDone', { n: models.length, pages: pageCount, time: fmtStamp(Date.now()) })
    );
  } catch (e) {
    // 全量都没拿到：回退"最近一次成功抓取"的快照（可能早已过 7 天，仍如实标时刻），
    // 而不是给一个空面板加一句干巴巴的报错 —— 不编数据，但也不让读者白来一趟
    const last = readSnapshot('eval-board');
    if (last && Array.isArray(last.v) && last.v.length) {
      p.status('', 'warn');
      mountEvalBoard(p, last.v, L('st.evalStale', { msg: e.message, time: fmtStamp(last.t), n: last.v.length }));
      return;
    }
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 5：Aider 编程能力榜（YAML 子集）                                */
/* ================================================================== */

const AIDER_URL =
  'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml';

/**
 * 最小 YAML 子集解析器。
 *
 * 只认识这一种形态（Aider 榜单的实际写法）：
 *   - dirname: xxx
 *     model: Gemini 2.0 Pro
 *     pass_rate_2: 35.6
 *     date: 2025-02-25
 * 即：**扁平的数组，元素是"键: 标量值"**。不支持嵌套、锚点、多行块、行内数组。
 *
 * ## 遇到嵌套必须抛错，而不是继续解析（这条有测试盯着）
 * 一个嵌套映射（`- a:` 换行后跟更深缩进的 `b: 1`）在 YAML 里表示 `{a: {b: 1}}`，
 * 但按本解析器"逐行取 key: value"的写法会**静默拍平**成 `{a: null, b: 1}` ——
 * 键还在、值却挂错了地方，页面上看不出异常。所以这里显式比较缩进：
 * 续行的键缩进若比本元素的键缩进更深，就判定为嵌套并抛错。
 * 宁可这个面板报"上游格式变了"，也不要显示一个悄悄错位的值。
 */
export function parseFlatYamlList(text) {
  const items = [];
  let cur = null;
  let keyIndent = null; // 本元素里键的缩进列（用于识别嵌套）
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw) || /^---\s*$/.test(raw)) continue;

    // 顶层数组元素：以 "- " 开头（"-" 后可以是键、也可以是空）
    const newItem = /^(\s*)-\s*(.*)$/.exec(raw);
    if (newItem) {
      cur = {};
      items.push(cur);
      const indentAfterDash = newItem[1].length + 2; // "- " 占两列
      keyIndent = indentAfterDash;
      const rest = newItem[2].trim();
      if (rest) {
        const kv = /^([^:]+):\s*(.*)$/.exec(rest);
        if (!kv) throw new Error(L('err.yamlNotKV', { line: i + 1, text: raw.trim() }));
        // "- key:" 后面什么都没有 = 值在更深缩进的下一行（嵌套）→ 直接判错
        if (kv[2].trim() === '') {
          throw new Error(L('err.yamlNested', { line: i + 1, key: kv[1].trim() }));
        }
        cur[kv[1].trim()] = scalar(kv[2]);
      }
      continue;
    }

    const kv = /^(\s+)([^:]+):\s*(.*)$/.exec(raw);
    if (kv && cur) {
      // 缩进比本元素的键更深 → 这是嵌套，不是兄弟键
      if (keyIndent !== null && kv[1].length > keyIndent) {
        throw new Error(L('err.yamlIndent', { line: i + 1 }));
      }
      if (kv[3].trim() === '') {
        throw new Error(L('err.yamlNested', { line: i + 1, key: kv[2].trim() }));
      }
      cur[kv[2].trim()] = scalar(kv[3]);
      continue;
    }
    throw new Error(L('err.yamlSubset', { line: i + 1, text: raw.trim().slice(0, 60) }));
  }
  return items;
}

/** 标量转换：去掉引号、识别数字/布尔/null。**不做**日期解析（保持原样字符串） */
function scalar(s) {
  let v = String(s ?? '').trim();
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

/**
 * Aider 的榜每个模型有**多行**（同一模型的不同尝试/日期各一行），
 * 取每个模型的最高 pass_rate_2 作为它的成绩。
 */
export function bestAiderRows(entries) {
  const best = new Map();
  for (const e of entries) {
    const model = String(e.model || '').trim();
    const rate = parseFloat(e.pass_rate_2);
    if (!model || !Number.isFinite(rate)) continue;
    const prev = best.get(model);
    if (!prev || rate > prev.rate) best.set(model, { model, rate, date: e.date ?? null });
  }
  return [...best.values()].sort((a, b) => b.rate - a.rate);
}

async function loadAiderBoard() {
  const p = panel({
    id: 'aider',
    iconName: 'code',
    title: L('p.aider.title'),
    hint: L('p.aider.hint'),
  });
  try {
    const res = await fetch(AIDER_URL, { headers: { accept: 'text/plain' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = bestAiderRows(parseFlatYamlList(await res.text()));
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.rate'), num: true, field: 'rate', cell: (r) => `${num(r.rate, 1)}%` },
        { label: L('col.date'), field: 'date', cell: (r) => esc(r.date ?? '—') },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['model'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.rate, 1)}%</span> <span class="v-unit">${L('col.rate')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
      },
    });
  } catch (e) {
    p.status(
      L('st.failed', { msg: e.message }) + (/YAML|行|Line/.test(e.message) ? L('err.yamlChanged') : L('st.rateLimited')),
      'err'
    );
    p.body('');
  }
}

/* ================================================================== */
/* 面板 6：HF Spaces 趋势（AI 应用榜）                                   */
/* ================================================================== */

async function loadSpaces() {
  const p = panel({
    id: 'spaces',
    iconName: 'cube',
    title: L('p.spaces.title'),
    hint: L('p.spaces.hint'),
  });
  try {
    const data = await cachedJson('hf-spaces', `${HF_MODELS.replace('/models', '/spaces')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.app'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/spaces/') },
        { label: L('col.sdk'), field: 'sdk', cls: 'col-2', cell: (r) => (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['id'],
      groupField: 'sdk',
      groupLabel: L('ui.allSdks'),
      placeholder: L('ui.searchApps'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          (r.sdk ? `<span class="tag">${esc(r.sdk)}</span>` : '') +
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/spaces/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 7：HF 数据集趋势                                                 */
/* ================================================================== */

async function loadDatasets() {
  const p = panel({
    id: 'datasets',
    iconName: 'layers',
    title: L('p.datasets.title'),
    hint: L('p.spaces.hint'),
  });
  try {
    const data = await cachedJson('hf-datasets', `${HF_MODELS.replace('/models', '/datasets')}?sort=trendingScore&direction=-1&limit=50`);
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const max = Math.max(...data.map((r) => Number(r.trendingScore) || 0), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows: data,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.dataset'), field: 'id', cell: (r) => hfLink(r.id).replace('huggingface.co/', 'huggingface.co/datasets/') },
        {
          html: `${icon('trending')}<span class="sr-only">${L('col.trending')}</span>`,
          num: true,
          field: 'trendingScore',
          cell: (r) => `${bar(r.trendingScore, max)}${compact(r.trendingScore) ?? '—'}`,
        },
        { html: `${icon('heart')}<span class="sr-only">${L('col.likes')}</span>`, num: true, cls: 'col-2', field: 'likes', cell: (r) => compact(r.likes) ?? '—' },
        { html: `${icon('download')}<span class="sr-only">${L('col.downloads')}</span>`, num: true, cls: 'col-2', field: 'downloads', cell: (r) => compact(r.downloads) ?? '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['id'],
      placeholder: L('ui.searchDatasets'),
      transform: withRank,
      card: {
        title: (r) => esc(r.id),
        value: (r) => `<span class="v-num">${compact(r.trendingScore) ?? '—'}</span> <span class="v-unit">${L('col.trending')}</span>`,
        meta: (r) =>
          `<span class="tag">${icon('heart')}${compact(r.likes) ?? '0'}</span>` +
          `<span class="tag">${icon('download')}${compact(r.downloads) ?? '0'}</span>`,
        link: (r) => `https://huggingface.co/datasets/${encodeURI(r.id)}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 8：HF 每日论文（热榜）                                           */
/* ================================================================== */

/** 论文条目 → 展示需要的字段。upvotes 是"热度"信号，缺了就不排它。 */
export function normalizePaper(entry) {
  const p = entry?.paper || {};
  const title = String(p.title || entry?.title || '').trim();
  if (!title) return null;
  const votes = Number(p.upvotes);
  return {
    id: p.id ?? null,
    title,
    votes: Number.isFinite(votes) ? votes : 0,
    date: String(p.publishedAt || entry?.publishedAt || '').slice(0, 10),
    summary: String(p.summary || entry?.summary || '').trim(),
  };
}

export function rankPapers(entries) {
  const seen = new Map();
  for (const e of entries) {
    const r = normalizePaper(e);
    if (!r) continue;
    if (!seen.has(r.title)) seen.set(r.title, r);
  }
  return [...seen.values()].sort((a, b) => b.votes - a.votes);
}

async function loadPapers() {
  const p = panel({
    id: 'papers',
    iconName: 'file',
    title: L('p.papers.title'),
    hint: L('p.papers.hint'),
  });
  try {
    const data = await cachedJson('hf-papers', 'https://huggingface.co/api/daily_papers?limit=50');
    if (!Array.isArray(data)) throw new Error(L('err.notArray'));
    const rows = rankPapers(data);
    if (!rows.length) throw new Error(L('err.noPapers'));
    const max = Math.max(...rows.map((r) => r.votes), 0);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.paper'),
          field: 'title',
          cell: (r) =>
            `<a href="https://huggingface.co/papers/${encodeURIComponent(r.id || '')}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`,
        },
        { label: L('col.date'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
        {
          html: `${icon('heart')}<span class="sr-only">${L('col.votes')}</span>`,
          num: true,
          field: 'votes',
          cell: (r) => `${bar(r.votes, max)}${compact(r.votes) ?? '0'}`,
        },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 30,
      searchFields: ['title'],
      placeholder: L('ui.searchPapers'),
      transform: withRank,
      card: {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.votes) ?? '0'}</span> <span class="v-unit">${L('col.votes')}</span>`,
        meta: (r) => (r.date ? `<span class="tag">${esc(r.date)}</span>` : ''),
        link: (r) => `https://huggingface.co/papers/${encodeURIComponent(r.id || '')}`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9：GitHub 高星 AI 项目（可按时间段 / 语言切换）                   */
/* ================================================================== */

const GH_QUERIES = {
  week: { labelKey: 'col.weekStars', q: 'topic:llm created:>@WEEK@' },
  month: { labelKey: 'col.monthStars', q: 'topic:llm created:>@MONTH@' },
  stars: { labelKey: 'col.totalStars', q: 'topic:llm stars:>1000' },
};

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/**
 * 只留真正的 AI 仓库并排序。
 * 为什么不用 GitHub 返回的顺序：它的 `sort=stars` 对"本周新增"没有意义
 * （按总星标排，永远是那几个大仓库），而热门榜要看的是**当期**增量。
 * 所以按当期索引排序，并把当期增量与总星标分开显示。
 */
export function rankRepos(items, metricKey) {
  const rows = (items || [])
    .filter((r) => r && typeof r.full_name === 'string')
    .map((r) => ({
      full_name: r.full_name,
      html_url: r.html_url,
      description: String(r.description || '').trim(),
      stars: Number(r.stargazers_count) || 0,
      gained: Number(r[metricKey]) || 0, // 本期新增星标（GitHub 只在带日期条件的搜索里给）
      lang: r.language || null,
      created: String(r.created_at || '').slice(0, 10),
    }));
  // 有当期增量就按增量排，否则退回总星标
  const useGained = rows.some((r) => r.gained > 0);
  return rows.sort((a, b) => (useGained ? b.gained - a.gained : b.stars - a.stars));
}

async function loadRepos(range = 'week') {
  const p = panel({
    id: 'repos',
    iconName: 'star',
    title: L('p.repos.title'),
    hint: L('p.repos.hint'),
  });
  try {
    const q = GH_QUERIES[range].q.replace('@WEEK@', isoDaysAgo(7)).replace('@MONTH@', isoDaysAgo(30));
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
    const data = await cachedJson(`gh-${range}`, url);
    if (!Array.isArray(data?.items)) throw new Error(L('err.noItems'));
    const rows = rankRepos(data.items, 'stargazers_count');
    if (!rows.length) throw new Error(L('err.noRepos'));
    p.status('', 'ok');

    // 时间段切换放在过滤控件之上；切换时只重画这个面板（不重建，避免整列跳动）
    const switchHtml = Object.entries(GH_QUERIES)
      .map(([k, v]) => `<button class="chip${k === range ? ' on' : ''}" data-range="${k}" type="button">${esc(L(v.labelKey))}</button>`)
      .join('');

    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.repo'), field: 'full_name', cell: (r) => `<a href="${esc(r.html_url)}" target="_blank" rel="noopener noreferrer">${esc(r.full_name)}</a>` },
        { label: L('col.lang'), cls: 'col-2', field: 'lang', cell: (r) => (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') },
        { html: `${icon('star')}<span class="sr-only">${L('col.stars')}</span>`, num: true, field: 'stars', cell: (r) => compact(r.stars) ?? '—' },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      searchFields: ['full_name', 'description'],
      groupField: 'lang',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchRepos'),
      transform: withRank,
      card: {
        title: (r) => esc(r.full_name),
        value: (r) => `<span class="v-num">${compact(r.stars) ?? '—'}</span> <span class="v-unit">${L('col.stars')}</span>`,
        meta: (r) =>
          (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') +
          `<span class="tag">${esc(r.created)}</span>`,
        link: (r) => r.html_url,
      },
      beforeControls: () => `<div class="chips" data-chips>${switchHtml}</div>`,
    });

    // 绑定时间段切换（mountBoard 每次重画都会换 DOM，所以在这里绑会随重画失效，
    // 因此挂到面板元素上用事件委托 —— 只绑一次即可）
    p.el.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-range]');
      if (btn) loadRepos(btn.getAttribute('data-range'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }) + L('st.ghLimit'), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 9.5：GitHub Trending 每日榜（构建期快照，AI 关键词过滤）         */
/* ================================================================== */

/**
 * 快照地址：相对**本模块**（import.meta.url）而不是页面解析 —— 中文页在 `/`、
 * 英文页在 `/en/`，同一个相对路径在两边会解析到不同目录；钉在脚本自身上，
 * 两种页面取到的都是 `assets/data/gh-trending.json`。
 *
 * 为什么是快照而不是浏览器直连：github.com 的页面响应**不带 CORS**
 * （2026-09-30 实测），浏览器直连必被拦；页面是 650KB 的 HTML 也不适合每次
 * 进页面都拖一遍。快照由 `scripts/fetch-gh-trending.mjs` 在**构建期**生成
 * （GitHub Actions 每日跑），抓取失败就不提交、旧快照原样保留 ——
 * 页面上继续显示旧快照与它的抓取时刻，绝不拿残缺数据顶上。
 */
const GH_TRENDING_SNAP_URL = new URL('./data/gh-trending.json', import.meta.url).href;

/** 极小的 HTML 实体还原（解析描述里的 &amp; 这类用，五样够覆盖 GitHub 的输出） */
function unescapeHtml(s) {
  return String(s)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

/** "1,281" → 1281；"abc"/缺失 → null（空值恒排最后，不冒充 0 星） */
const intOrNull = (s) => {
  const n = parseInt(String(s ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * 解析 github.com/trending 的 HTML → 结构化条目。
 * 页面与 CI 抓取脚本用的是**同一份**实现（脚本 import 这里的导出），
 * 字段对不上只会在一处修。依赖的标记都取自 2026-09-30 的真实页面；
 * GitHub 改版时这里解析出的条目会骤减，抓取脚本按"少于 5 条"拒绝提交 ——
 * 坏快照进不了仓库，门禁在 CI 侧而不是靠人眼。
 */
export function parseGhTrending(html) {
  const out = [];
  const articles = String(html || '').match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  for (const a of articles) {
    // 仓库：h2 里的链接（article 里第一个 <a> 是"登录加星"按钮，指到 /login，不能要）
    const repo = /<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/.exec(a)?.[1];
    if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) continue;
    out.push({
      repo,
      desc: unescapeHtml(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/.exec(a)?.[1] ?? '').trim(),
      lang: /itemprop="programmingLanguage">([^<]+)</.exec(a)?.[1]?.trim() || '',
      stars: intOrNull(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/.exec(a)?.[1]),
      forks: intOrNull(/\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/.exec(a)?.[1]),
      starsToday: intOrNull(/([\d,]+)\s+stars today/.exec(a)?.[1]),
    });
  }
  return out;
}

/**
 * AI 关键词 —— 判断一个 trending 仓库是否与 AI 相关。**词边界**匹配：
 * "storage" 里的 rag、"detail" 里的 ai、"html" 里的 ml 都不该命中。
 * 取舍是**宁缺勿滥**：模糊的词（smart / data / app）不进清单 ——
 * 把无关仓库拉进"仅 AI"视图，比漏掉一个边缘仓库更伤这个榜的可信度。
 */
const AI_KEYWORDS = [
  'ai', 'agi', 'llm', 'llms', 'gpt', 'chatgpt', 'claude', 'gemini', 'deepseek',
  'qwen', 'mistral', 'llama', 'kimi', 'doubao', 'openai', 'anthropic', 'copilot',
  'genai', 'generative ai', 'agent', 'agents', 'agentic', 'mcp', 'autogen',
  'crewai', 'langchain', 'langgraph', 'llamaindex', 'rag', 'embedding', 'embeddings',
  'vector database', 'transformer', 'transformers', 'diffusion', 'stable diffusion',
  'comfyui', 'midjourney', 'sdxl', 'vllm', 'ollama', 'llama.cpp', 'gguf',
  'lora', 'fine-tuning', 'finetuning', 'fine-tune', 'whisper', 'tts', 'asr',
  'speech recognition', 'voice cloning', 'text-to-speech', 'text to speech',
  'speech to text', 'ocr', 'nlp', 'machine learning', 'deep learning',
  'neural network', 'neural networks', 'yolo', 'multimodal', 'text-to-image',
  'text to image', 'image generation', 'video generation', 'chatbot', 'chatbots',
  'inference', 'tokenizer', 'quantization', 'mlops', 'semantic search',
  'knowledge graph', 'large language model',
];
const AI_RE = new RegExp(`(?:^|[^a-z0-9])(?:${AI_KEYWORDS.join('|')})(?:[^a-z0-9]|$)`, 'i');

/** 一个 trending 条目是否 AI 相关：仓库名 + 描述一起看（词边界，大小写不敏感） */
export function isAiRepo(entry) {
  return AI_RE.test(`${entry?.repo ?? ''} ${entry?.desc ?? ''}`);
}

/** 快照 JSON → 面板行（数字归一、AI 标记、空仓库名剔除） */
export function flattenGhTrending(snap) {
  const entries = Array.isArray(snap?.entries) ? snap.entries : [];
  const rows = [];
  for (const e of entries) {
    const repo = String(e?.repo || '').trim();
    if (!repo) continue;
    rows.push({
      repo,
      desc: String(e?.desc || '').trim(),
      lang: String(e?.lang || '').trim(),
      // 快照是 CI 用 parseGhTrending 生成的（数字），这里仍走 intOrNull：
      // 手工修过/旧版快照里的 "12,682" 字符串也能归一，坏值一律 null 不冒充 0
      stars: intOrNull(e?.stars),
      forks: intOrNull(e?.forks),
      starsToday: intOrNull(e?.starsToday),
      ai: isAiRepo(e),
    });
  }
  return rows;
}

/** 面板：GitHub Trending 每日榜（默认只看 AI 相关，可切全部仓库） */
async function loadGhTrending(view = 'ai') {
  const p = panel({
    id: 'ghTrending',
    iconName: 'trending',
    title: L('p.ghTrending.title'),
    hint: L('p.ghTrending.hint'),
  });
  try {
    // 快照很小（几十 KB），10 分钟内的会话缓存足够 —— 数据本来就是每日一更
    const snap = await cachedJson('gh-trending', GH_TRENDING_SNAP_URL);
    const fetchedAt = Date.parse(snap?.fetchedAt);
    const all = flattenGhTrending(snap);
    if (!all.length) throw new Error(L('err.noRepos'));
    const rows = view === 'ai' ? all.filter((r) => r.ai) : all;
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.repo'),
          field: 'repo',
          cell: (r) => `<a href="https://github.com/${encodeURI(r.repo)}" target="_blank" rel="noopener noreferrer">${esc(r.repo)}</a>`,
        },
        { label: L('col.starsToday'), num: true, field: 'starsToday', cell: (r) => compact(r.starsToday) ?? '—' },
        { label: L('col.stars'), num: true, cls: 'col-2', field: 'stars', cell: (r) => compact(r.stars) ?? '—' },
        { label: L('col.lang'), cls: 'col-2', field: 'lang', cell: (r) => (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '—') },
        { label: L('col.desc'), field: 'desc', cell: (r) => esc(r.desc) || '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['repo', 'desc', 'lang'],
      groupField: 'lang',
      groupLabel: L('ui.allLangs'),
      placeholder: L('ui.searchRepos'),
      transform: withRank,
      beforeControls: () => subBoardChips({ ai: 'p.ghTrending.ai', all: 'p.ghTrending.all' }, view, 'ghtrend'),
      // 快照声明：这是构建期抓的、什么时候抓的 —— 每榜都要能回答这两句
      note: L('st.ghSnap', { time: fmtStamp(Number.isFinite(fetchedAt) ? fetchedAt : Date.now()) }),
      card: {
        title: (r) => esc(r.repo),
        value: (r) => `<span class="v-num">+${compact(r.starsToday) ?? '—'}</span> <span class="v-unit">${L('col.starsToday')}</span>`,
        meta: (r) =>
          (r.lang ? `<span class="tag">${esc(r.lang)}</span>` : '') +
          `<span class="tag">${icon('star')}${compact(r.stars) ?? '—'}</span>`,
        link: (r) => `https://github.com/${r.repo}`,
      },
    });
    // 子视图切换（事件委托：mountBoard 每次重画都换 DOM，绑在面板元素上只绑一次）
    p.el.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-ghtrend]');
      if (b) loadGhTrending(b.getAttribute('data-ghtrend'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板 10：最新发布的模型（models.dev，体积大 → 点击才加载）             */
/* ================================================================== */

const MODELS_DEV_URL = 'https://models.dev/api.json';

/**
 * 把 models.dev 的 `provider → models` 嵌套结构摊平成模型数组。
 *
 * 为什么这个源值得单独处理：它是**唯一**带 `release_date` 的源，
 * 所以能做"最新发布"这种别处拿不到的榜。代价是体积 4.8MB，
 * 所以做成点击加载而不是进页面就拉。
 */
export function flattenModelsDev(json) {
  const out = [];
  for (const [pid, prov] of Object.entries(json || {})) {
    for (const [mid, m] of Object.entries(prov?.models || {})) {
      if (!m || !m.id) continue;
      out.push({
        id: m.id,
        name: String(m.name || m.id),
        provider: String(prov.name || pid),
        release: String(m.release_date || ''),
        context: Number(m.limit?.context) || null,
        costIn: Number(m.cost?.input ?? NaN),
        costOut: Number(m.cost?.output ?? NaN),
        reasoning: Boolean(m.reasoning),
        openWeights: Boolean(m.open_weights),
      });
    }
  }
  // 按发布日期降序；没有日期的排在最后（而不是被当成 1970 年排到开头）
  return out.sort((a, b) => {
    if (!a.release && !b.release) return a.name.localeCompare(b.name);
    if (!a.release) return 1;
    if (!b.release) return -1;
    return b.release.localeCompare(a.release);
  });
}

/** 价格格式化：$/百万 token，两位有效数字就够，不堆小数 */
export function fmtCost(v) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return L('ui.free');
  return `$${v < 1 ? v.toFixed(2) : v.toFixed(1)}`;
}

async function loadNewModels() {
  const p = panel({
    id: 'newmodels',
    iconName: 'box',
    title: L('p.newmodels.title'),
    hint: L('p.newmodels.hint'),
  });
  // ★ 进页面就拉（4.8MB）—— 与 SWE-bench 同理：这一页只有这一张榜，
  // 多一次点击只是多一步。
  p.status(L('st.loadingBig', { size: '4.8MB' }), 'loading');
  p.body(skeleton(6));
  {
    try {
      const json = await cachedJson('models-dev', MODELS_DEV_URL);
      const rows = flattenModelsDev(json);
      if (!rows.length) throw new Error(L('err.noModels'));
      // 只显示带发布日期的（"最新发布"这个榜的意义所在）
      const dated = rows.filter((r) => r.release);
      p.status('', 'ok');
      mountBoard(p, {
        rows: dated,
        cols: [
          { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
          { label: L('col.model'), field: 'name', cell: (r) => esc(r.name) },
          { label: L('col.provider'), cls: 'col-2', field: 'provider', cell: (r) => `<span class="tag">${esc(r.provider)}</span>` },
          { label: L('col.release'), field: 'release', cell: (r) => esc(r.release) },
          { label: L('col.context'), num: true, cls: 'col-2', field: 'context', cell: (r) => compact(r.context) ?? '—' },
          // 价格排序要把"没价格"的排最后：applyBoardState 已经这么做了（空值恒最后）
          { label: L('col.priceIn'), num: true, cls: 'col-2', field: 'costIn', cell: (r) => fmtCost(r.costIn) },
          { label: L('col.priceOut'), num: true, cls: 'col-2', field: 'costOut', cell: (r) => fmtCost(r.costOut) },
        ],
        defaultSort: { index: 3, dir: 'desc' },
        limit: 40,
        searchFields: ['name', 'provider'],
        groupField: 'provider',
        groupLabel: L('ui.allProviders'),
        placeholder: L('ui.searchModelsProviders'),
        transform: withRank,
        note: L('st.dated', { total: rows.length, dated: dated.length }),
        card: {
          title: (r) => esc(r.name),
          value: (r) => `<span class="v-num">${esc(r.release)}</span> <span class="v-unit">${L('col.release')}</span>`,
          meta: (r) =>
            `<span class="tag">${esc(r.provider)}</span>` +
            `<span class="tag">${compact(r.context) ?? '—'} ${L('col.context')}</span>` +
            `<span class="tag">${L('col.priceIn')} ${fmtCost(r.costIn)}</span>`,
        },
      });
    } catch (e) {
      p.status(L('st.failed', { msg: e.message }) + L('st.retryRefresh'), 'err');
      p.body('');
    }
  }
}

/* ================================================================== */
/* 面板 11：SWE-bench（真实代码修复能力）                                */
/* ================================================================== */

/**
 * 数据在 `swe-bench.github.io` 仓库的 `data/leaderboards.json`（经 raw.githubusercontent，
 * CORS `*`）。这个文件 **4MB**，而且它把每个提交的**逐题明细**都塞在同一个文件里
 * （`resolved_instances` / `costs_to_complete` 等长数组）—— 我们只用到汇总字段。
 * 所以处理方式与 models.dev 一样：**点击才加载**，并且只取需要的字段。
 *
 * ★ 量纲坑（已实测确认）：`resolved` 是**已经在 0–100 的百分数**（Verified 子榜最大 79.2，
 * 若按 0–1 比例解释则不可能超过 1）。所以展示时**直接用，不要再 ×100**。
 * 这个坑有测试盯着：见 trend.test.js 的「SWE-bench 的 resolved 不乘 100」。
 */

const SWE_BENCH_URL =
  'https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/master/data/leaderboards.json';

/** 想要哪个子榜（4MB 里只有 5 个，取名字最直白的那个） */
export const DEFAULT_SWE_BOARD = 'Verified';

/**
 * 从一个子榜里取出排在前面的一批。
 *
 * 去重规则：同一个模型可能**多次提交**（不同日期/不同 agent），榜单站的原始列表是按
 * 提交时间排的，会出现同一个模型占好几行。这里按"模型名"取**最高分**那一次，
 * 因为读者要看的是"这个模型能做到多少"，不是"谁什么时候又交了一次"。
 */
/** 数据里实际有哪些子榜（用于界面上的切换项，顺序按数据本身） */
export function sweBoardNames(boards) {
  return (boards || []).map((b) => String(b?.name || '')).filter(Boolean);
}

export function rankSweBench(boards, boardName = DEFAULT_SWE_BOARD) {
  const board = (boards || []).find((b) => b?.name === boardName) || (boards || [])[0];
  if (!board || !Array.isArray(board.results)) return [];
  const best = new Map();
  for (const r of board.results) {
    // ★ 必须先挡掉 null/undefined/空串再 Number()：
    // `Number(null)` 是 0 且 `Number.isFinite(0)` 为真 —— 直接用 Number 判断会把
    // "没有成绩"的条目当成 **0 分**混进榜里（实测官方数据里确实有 resolved:null 的条目）。
    const raw = r?.resolved;
    if (raw === null || raw === undefined || raw === '') continue;
    const score = Number(raw);
    if (!Number.isFinite(score)) continue; // 非数字同样丢，不参与排名
    const model = String(r.model_display || r.agent || '').trim();
    if (!model) continue;
    const row = {
      model,
      // resolved 已是百分数（0–100），**不做任何换算**
      score,
      date: String(r.date || '').slice(0, 10),
      // 同一个坑：Number(null) === 0，所以要先挡 null/空串
      cost: r.cost === null || r.cost === undefined || r.cost === '' ? null : Number(r.cost),
      org: String(r.model_org || r.agent_org || '').trim(),
    };
    const prev = best.get(model);
    if (!prev || row.score > prev.score) best.set(model, row);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

async function loadSweBench(boardName = DEFAULT_SWE_BOARD) {
  const p = panel({
    id: 'swebench',
    iconName: 'code',
    title: L('p.swebench.title'),
    hint: L('p.swebench.hint'),
  });

  // ★ 进页面就拉（4MB）。曾经是"点击才加载"，但那个按钮是**多余的仪式** ——
  // 这一页只有这一张榜，读者既然点进来了就是要看它，多一次点击只是多一步。
  // 代价是首屏要等 4MB（约 1–2 秒），所以状态行明说在拉什么、多大。

  // 已加载：给子榜切换（5 个子榜）并渲染
  const render = (boards, current) => {
    const names = sweBoardNames(boards);
    const chips = names
      .map((n) => `<button class="chip${n === current ? ' on' : ''}" data-board="${esc(n)}" type="button">${esc(n)}</button>`)
      .join('');
    const rows = rankSweBench(boards, current);
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'model', cell: (r) => esc(r.model) },
        { label: L('col.org'), cls: 'col-2', field: 'org', cell: (r) => (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') },
        // resolved 已是 0–100 的百分数，**不乘 100**
        { label: L('col.score'), num: true, field: 'score', cell: (r) => `${bar(r.score, rows[0].score)}${num(r.score, 1)}%` },
        { label: L('col.cost'), num: true, cls: 'col-2', field: 'cost', cell: (r) => (Number.isFinite(r.cost) ? `$${num(r.cost, 0)}` : '—') },
        { label: L('col.submitted'), cls: 'col-2', field: 'date', cell: (r) => esc(r.date || '—') },
      ],
      defaultSort: { index: 3, dir: 'desc' },
      limit: 40,
      searchFields: ['model', 'org'],
      groupField: 'org',
      groupLabel: L('ui.allOrgs'),
      placeholder: L('ui.searchModelsOrgs'),
      transform: withRank,
      beforeControls: () => `<div class="chips" data-boards>${chips}</div>`,
      note: L('st.board', { name: current }),
      card: {
        title: (r) => esc(r.model),
        value: (r) => `<span class="v-num">${num(r.score, 1)}%</span> <span class="v-unit">${L('col.score')}</span>`,
        meta: (r) =>
          (r.org ? `<span class="tag">${esc(r.org)}</span>` : '') +
          (r.date ? `<span class="tag">${esc(r.date)}</span>` : '') +
          (Number.isFinite(r.cost) ? `<span class="tag">$${num(r.cost, 0)}</span>` : ''),
      },
    });
    // 事件委托：重画会换掉 DOM，挂面板上只绑一次
    p.el.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-board]');
      if (btn) render(boards, btn.getAttribute('data-board'));
    });
  };

  const run = async (which) => {
    p.status(L('st.loadingBig', { size: '4MB' }), 'loading');
    p.body(skeleton(6));
    try {
      const json = await cachedJson('swe-bench', SWE_BENCH_URL);
      const boards = json?.leaderboards;
      if (!Array.isArray(boards)) throw new Error(L('err.noBoards'));
      if (!rankSweBench(boards, which).length) throw new Error(L('err.noBoardRows', { name: which }));
      render(boards, which);
    } catch (e) {
      // 没有"重试按钮"了：重试的路是页面底部的「刷新数据」（它清缓存后重画）
      p.status(L('st.failed', { msg: e.message }) + L('st.retryRefresh'), 'err');
      p.body('');
    }
  };

  run(boardName);
}

/* ================================================================== */
/* 面板：OpenRouter 模型用量榜                                          */
/* ================================================================== */

const OPENROUTER_RANKINGS_URL = 'https://openrouter.ai/api/frontend/v1/rankings/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * OpenRouter 的用量榜 —— **数据形状与口径**（2026-09-30 实测，见 docs/trend-sources.md）
 *
 * 接口给的是**按天的原始用量**：`{data: [{date, model_permaslug, variant,
 * total_prompt_tokens, total_completion_tokens, count, ...}]}`，
 * 7 天窗口、约 600 行。字段含义（不猜，都是实测确认的）：
 *
 *   · `model_permaslug` 才是**模型身份**；同一模型的 `standard` / `batch` / `free`
 *     是**三行**，把它们当三个模型排是错的（榜单上会出现 "(batch)" 这种条目）。
 *     所以下面按 model_permaslug 合并 —— 合并后也就自然没有了名字带 "(batch)" 的问题。
 *   · `rankingMetricValue` 恰好等于 `total_prompt_tokens + total_completion_tokens`
 *     （602/602 行相等，实测）。口径就是**按天 token 用量**，不是"请求数"、
 *     也不是 OpenRouter 榜单页那个"share"百分比。
 *   · 接口**不带模型显示名**，名字要另外取（见 openrouterNames）。
 *
 * 取最新一天的快照：`date` 是日粒度，同一天出现多次才是"一天内的多个样本"，
 * 目前每个模型每天恰好一行，所以"同一天取最大"是安全的。
 */
export function openrouterBoard(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error(L('err.noBoard'));

  const latest = list.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '');
  const byModel = new Map();
  for (const r of list) {
    if (String(r.date) !== latest) continue; // 只要最新一天
    const key = String(r.model_permaslug || r.variant_permaslug || '').trim();
    if (!key) continue; // 实测有 1 行空 slug（不是模型，是"未归属"的合计）
    const tokens = Number(r.rankingMetricValue ?? 0) || 0;
    const reqs = Number(r.count ?? 0) || 0;
    const cur = byModel.get(key) || { key, tokens: 0, requests: 0 };
    // 同一模型的多个变体（standard/batch/free）在这里相加 —— 合并的正是那三行
    cur.tokens += tokens;
    cur.requests += reqs;
    byModel.set(key, cur);
  }

  const out = [...byModel.values()];
  if (!out.length) throw new Error(L('err.noBoard'));
  const sum = out.reduce((a, r) => a + r.tokens, 0) || 1;
  for (const r of out) r.share = (r.tokens / sum) * 100;
  // 降序：榜的第一屏就该是最高的那些
  out.sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  return { rows: out, date: latest, total: sum };
}

/**
 * 用量行的名字 —— 与 `/api/v1/models` 的连接。
 *
 * 为什么不直接显示 slug：榜上出现 `typesafe/jev-1.13-20260917` 这种事很常见，
 * 而清单里给的是 `Typesafe: Jev 1.13`。
 *
 * 匹配三级（实测覆盖率见 docs/trend-sources.md）：
 *   1. `id` 精确相等；
 *   2. `canonical_slug` 精确相等；
 *   3. 把用量行的日期后缀（`-20260910`）去掉后与 canonical_slug 去后缀相等。
 *
 * **返回 null 就是真的没有**，调用方回落到 slug —— 不编一个名字出来。
 * 清单只有 464 个模型（OpenRouter 的对话模型目录），而用量里含音频/视频/
 * embedding 等**不在该目录里**的模型，所以必然有一小部分解析不到。
 */
export function openrouterNames(models) {
  const byId = new Map();
  const byCanon = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    if (!m?.id) continue;
    byId.set(String(m.id), m);
    if (m.canonical_slug) byCanon.set(String(m.canonical_slug), m);
  }
  const stripDate = (s) => String(s).replace(/-\d{8}$/, '');
  const cache = new Map();
  return (slug) => {
    if (cache.has(slug)) return cache.get(slug);
    const name =
      byId.get(slug)?.name ??
      byCanon.get(slug)?.name ??
      // 去日期后缀再匹配一次；`(batch)` 那条不优先取，优先要基座名
      (() => {
        const want = stripDate(slug);
        let hit = null;
        for (const [k, m] of byCanon) {
          if (stripDate(k) === want) {
            if (!/\(batch\)/i.test(m.name)) return m.name;
            hit = hit || m.name;
          }
        }
        return hit;
      })() ??
      null;
    cache.set(slug, name);
    return name;
  };
}

/** 用量行的显示名：优先清单里的名字，取不到就回落成 slug 的主人/模型两段 */
export function openrouterLabel(slug, nameOf) {
  const name = nameOf?.(slug);
  if (name) return name;
  // 回落：`vendor/model-20260910` → 去掉厂商前缀与日期，剩下的当名字
  const tail = String(slug).split('/').slice(1).join('/') || String(slug);
  return tail.replace(/-\d{8}$/, '');
}

async function loadOpenRouter() {
  const p = panel({
    id: 'openrouter',
    iconName: 'bolt',
    title: L('p.openrouter.title'),
    hint: L('p.openrouter.hint'),
  });
  p.status(L('st.loadingBig', { size: '420KB + 760KB' }), 'loading');
  try {
    // 两份数据：用量榜（主数据）+ 模型清单（只为了名字）
    const [rankings, models] = await Promise.all([
      cachedJson('openrouter-rankings', OPENROUTER_RANKINGS_URL),
      cachedJson('openrouter-models', OPENROUTER_MODELS_URL),
    ]);
    const nameOf = openrouterNames(models?.data);
    const { rows, date, total } = openrouterBoard(rankings?.data);
    const day = date.slice(0, 10); // '2026-09-29 00:00:00' → '2026-09-29'

    const withNames = rows.map((r) => ({
      ...r,
      label: openrouterLabel(r.key, nameOf),
      named: Boolean(nameOf(r.key)),
    }));

    p.status('', 'ok');
    mountBoard(p, {
      rows: withNames,
      // 数据每天更新，说明里带上日期与总量：读者要能判断"这是哪一天的榜"
      note: L('st.orWindow', { date: day, n: rows.length }),
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.model'),
          field: 'label',
          cell: (r) =>
            // 点名字去 OpenRouter 上的模型页；取不到名字的那几个用 slug 当链接文字
            `<a href="https://openrouter.ai/${encodeURI(r.key)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`,
        },
        {
          label: L('col.orTokens'),
          num: true,
          field: 'tokens',
          cell: (r) => `${bar(r.tokens, withNames[0]?.tokens)}${compact(r.tokens) ?? '—'}`,
        },
        {
          label: L('col.orShare'),
          num: true,
          cls: 'col-2',
          field: 'share',
          cell: (r) => `${num(r.share, 1)}%`,
        },
        {
          label: L('col.orRequests'),
          num: true,
          cls: 'col-2',
          field: 'requests',
          cell: (r) => compact(r.requests) ?? '—',
        },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['label', 'key'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      card: {
        title: (r) => esc(r.label),
        value: (r) =>
          `<span class="v-num">${num(r.share, 1)}%</span> <span class="v-unit">${L('col.orShare')}</span>`,
        meta: (r) =>
          `<span class="tag">${compact(r.tokens) ?? '—'} tokens</span>` +
          `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orRequests')}</span>` +
          // 取不到清单名字的标一个 slug 标签：既不藏起来，也不假称它有名字
          (r.named ? '' : `<span class="tag">${L('ui.orSlugOnly')}</span>`),
        link: (r) => `https://openrouter.ai/${encodeURI(r.key)}`,
      },
    });
    // 总量放在面板状态行里：它是"这是全站的盘"这个事实的一半
    p.status(L('st.orTotal', { total: compact(total) ?? '—', date: day }), 'ok');
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板：OpenRouter 的四张榜（上升 / 机构 / 性能 / 应用）              */
/* ================================================================== */

const OR_API = 'https://openrouter.ai/api/frontend/v1';

/**
 * `climbing` / `breakouts` 的 `changePercent` **单位不一样**（实测，必须分开处理）
 *
 * 同一个响应里：`climbing` 给的是**百分数**（359.85 = +359.85%），
 * `breakouts` 给的是**比率**（3.57 = +357%）。看着数值差不多，乘 100 之后就差
 * 两个数量级 —— 混在一起排，突破榜会整条被排到上升榜末尾，而页面上不会报错，
 * 只会看起来"突破榜怎么都这么小"。
 *
 * 所以每个子榜自带单位标记：`kind` 只有 `climbing` 是百分数，其余按比率算。
 * 需要证据时看两榜的分布：climbing 几十~几百、breakouts 0.0x~3.5，量级分得很开。
 */
export function growthPct(v, kind) {
  // ★ 先挡空值再 Number()：`Number(null)` 与 `Number('')` 都是 **0**（有限数），
  // 直接转会把"上游没给增幅"变成"增幅 0%"，于是这种行会混进榜里假装有数据。
  // 合法结果是 0（真的没涨），但那是**上游给了 0**，不是"没给"。
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return kind === 'climbing' ? n : n * 100;
}

/** 上升榜的行：climbing / breakouts 共用，唯一的差别就是 changePercent 的单位 */
export function rankClimbing(list, kind) {
  const rows = (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.variantPermaslug || ''),
      tokens: Number(r.weeklyTokens) || 0,
      prev: Number(r.prevWeeklyTokens) || 0,
      // 单位换算在这里一次性做掉，下游只管 %（见 growthPct 的说明）
      growth: growthPct(r.changePercent, kind),
    }))
    .filter((r) => r.slug && r.growth !== null && r.tokens > 0);
  // 按增幅降序 —— 上游给的这个数组**不是**按增幅排的（实测 breakouts 是乱的）
  rows.sort((a, b) => b.growth - a.growth || b.tokens - a.tokens);
  return rows;
}

/**
 * 厂商（机构）份额。
 * `share` 上游给的是 0~1 的比例（0.2272 = 22.7%），`changePercent` 是**比率**
 * （0.0289 = +2.9%，注意不是 289%）—— 与 climbing 的单位又不同，实测确认。
 */
export function rankAuthors(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      author: String(a.author || ''),
      tokens: Number(a.weeklyTokens) || 0,
      share: Number(a.share) * 100,
      growth: Number(a.changePercent) * 100,
    }))
    .filter((a) => a.author)
    .sort((a, b) => b.tokens - a.tokens);
}

/** 性能榜：延迟与吞吐两个视角，各自按"越小/越大越好"降序 */
export function rankPerformance(list, view) {
  const rows = (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.slug || r.id || ''),
      name: String(r.name || ''),
      author: String(r.author || ''),
      requests: Number(r.request_count) || 0,
      latency: Number.isFinite(r.p50_latency) ? Number(r.p50_latency) : null,
      throughput: Number.isFinite(r.p50_throughput) ? Number(r.p50_throughput) : null,
      provider: view === 'throughput' ? r.best_throughput_provider : r.best_latency_provider,
      price: view === 'throughput' ? r.best_throughput_price : r.best_latency_price,
      providers: Number(r.provider_count) || 0,
    }))
    .filter((r) => r.slug);
  // 延迟：快在前（升序）；吞吐：快在前（降序）。缺值的行丢给调用方按"空值最后"处理
  if (view === 'throughput') rows.sort((a, b) => (b.throughput ?? -1) - (a.throughput ?? -1));
  else rows.sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity));
  return rows;
}

/**
 * Artificial Analysis 的评测分（三张子榜：intelligence / coding / agentic）。
 *
 * ★ 用 `score` 排，**不用** `percentilesBySlug` —— 后者是"百分位"，看着像分
 * 但语义完全不同（同一个模型在两处的数不一样），混用会得到一个说不清是什么的榜。
 */
export function rankAa(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      slug: String(r.permaslug || r.uid || ''),
      // aa_name 是 Artificial Analysis 那边的完整名（带括号后缀），太啰嗦；
      // heuristic_openrouter_slug 是它猜的 OpenRouter 标识，优先用它做显示名
      name: String(r.aa_name || r.heuristic_openrouter_slug || r.permaslug || ''),
      score: Number(r.score),
    }))
    .filter((r) => r.slug && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score);
}

/** 应用榜：day / week 两个窗口，按 token 用量排序 */
export function rankApps(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      title: String(r.app?.title || ''),
      slug: String(r.app?.slug || ''),
      url: r.app?.origin_url || r.app?.main_url || '',
      source: r.app?.source_code_url || '',
      categories: Array.isArray(r.app?.categories) ? r.app.categories.join(' · ') : '',
      tokens: Number(r.total_tokens) || 0,
      requests: Number(r.total_requests) || 0,
    }))
    .filter((r) => r.title)
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * 多模态用量榜：图像 / 视频 / 语音三个端点。
 *
 * ★ 形状**不完全一样**（实测确认）：三个都是 `{x, ys}` 的时间序列，
 * 但 `video-output-hours` 与 `stt-transcript-characters` **多套一层** ——
 * 是 `{data:{data:[…]}}` 而不是 `{data:[…]}`。按同一种形状解析的话，
 * 后两个只会得到一行（把 `data` 当成模型映射，取到 `cachedAt` 这种键），
 * 页面上表现为"只有一个模型的榜"，不报错。
 *
 * 取**最后一个点**作为当前值；`Others` 是上游的合计桶（不是模型），排除。
 */
export function flattenMedia(json, { exclude = ['Others'] } = {}) {
  const series = Array.isArray(json?.data) ? json.data : json?.data?.data;
  const last = Array.isArray(series) && series.length ? series[series.length - 1] : null;
  const rows = [];
  for (const [slug, v] of Object.entries(last?.ys || {})) {
    if (!slug || exclude.includes(slug)) continue;
    const value = Number(v) || 0;
    if (value > 0) rows.push({ slug, value, at: String(last.x || '') });
  }
  return rows.sort((a, b) => b.value - a.value);
}

/** 取名字的小工具：OpenRouter 的四张榜都要显示名，走同一个连接 */
function orNameOf(models) {
  return openrouterNames(models?.data);
}

/** 子榜切换片（与 GitHub 时间段的写法一致：按钮 + 事件委托） */
function subBoardChips(views, current, attr) {
  return (
    `<div class="chips" data-chips>` +
    Object.entries(views)
      .map(
        ([k, v]) =>
          `<button class="chip${k === current ? ' on' : ''}" data-${attr}="${k}" type="button">${esc(L(v))}</button>`
      )
      .join('') +
    '</div>'
  );
}

/** 面板：OpenRouter 上升榜（climbing / breakouts 两个子榜） */
async function loadOrTrends(view = 'climbing') {
  const p = panel({ id: 'orTrends', iconName: 'trending', title: L('p.orTrends.title'), hint: L('p.orTrends.hint') });
  try {
    const [disc, models] = await Promise.all([
      cachedJson('or-discovery', `${OR_API}/rankings/discovery`),
      cachedJson('openrouter-models', OPENROUTER_MODELS_URL),
    ]);
    const nameOf = orNameOf(models);
    const rows = rankClimbing(disc?.data?.[view], view).map((r) => ({
      ...r,
      label: openrouterLabel(r.slug, nameOf),
      named: Boolean(nameOf(r.slug)),
    }));
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.model'),
          field: 'label',
          cell: (r) => `<a href="https://openrouter.ai/${encodeURI(r.slug)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a>`,
        },
        {
          label: L('col.orGrowth'),
          num: true,
          field: 'growth',
          cell: (r) => `<span class="v-num">+${num(r.growth, r.growth >= 10 ? 0 : 1)}%</span>`,
        },
        { label: L('col.orWeekTokens'), num: true, cls: 'col-2', field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        { label: L('col.orPrevWeek'), num: true, cls: 'col-2', field: 'prev', cell: (r) => compact(r.prev) ?? '—' },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['label', 'slug'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () => subBoardChips({ climbing: 'p.orTrends.climbing', breakouts: 'p.orTrends.breakouts' }, view, 'trend'),
      card: {
        title: (r) => esc(r.label),
        value: (r) => `<span class="v-num">+${num(r.growth, r.growth >= 10 ? 0 : 1)}%</span> <span class="v-unit">${L('col.orGrowth')}</span>`,
        meta: (r) => `<span class="tag">${compact(r.tokens) ?? '—'} ${L('col.orWeekTokens')}</span>`,
        link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
      },
    });
    p.el.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-trend]');
      if (b) loadOrTrends(b.getAttribute('data-trend'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 机构份额 */
async function loadOrAuthors() {
  const p = panel({ id: 'orAuthors', iconName: 'database', title: L('p.orAuthors.title'), hint: L('p.orAuthors.hint') });
  try {
    const disc = await cachedJson('or-discovery', `${OR_API}/rankings/discovery`);
    const rows = rankAuthors(disc?.data?.authors);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.org'), field: 'author', cell: (r) => esc(r.author) },
        { label: L('col.orShare'), num: true, field: 'share', cell: (r) => `${num(r.share, 1)}%` },
        { label: L('col.orWeekTokens'), num: true, field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        {
          label: L('col.orGrowth'),
          num: true,
          cls: 'col-2',
          field: 'growth',
          cell: (r) => (r.growth === null ? '—' : `${r.growth > 0 ? '+' : ''}${num(r.growth, 1)}%`),
        },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['author'],
      placeholder: L('ui.search'),
      transform: withRank,
      card: {
        title: (r) => esc(r.author),
        value: (r) => `<span class="v-num">${num(r.share, 1)}%</span> <span class="v-unit">${L('col.orShare')}</span>`,
        meta: (r) =>
          `<span class="tag">${compact(r.tokens) ?? '—'} ${L('col.orWeekTokens')}</span>` +
          `<span class="tag">${r.growth > 0 ? '+' : ''}${num(r.growth, 1)}%</span>`,
      },
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 性能榜（延迟 / 吞吐两个子榜） */
async function loadOrPerformance(view = 'latency') {
  const p = panel({ id: 'orPerf', iconName: 'bolt', title: L('p.orPerf.title'), hint: L('p.orPerf.hint') });
  try {
    const data = await cachedJson('or-performance', `${OR_API}/rankings/performance`);
    const rows = rankPerformance(data?.data, view);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    const field = view === 'throughput' ? 'throughput' : 'latency';
    const unit = view === 'throughput' ? 'tok/s' : 'ms';
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'name', cell: (r) => esc(r.name || r.slug) },
        { label: L('col.org'), cls: 'col-2', field: 'author', cell: (r) => (r.author ? `<span class="tag">${esc(r.author)}</span>` : '') },
        {
          label: view === 'throughput' ? L('col.orThroughput') : L('col.orLatency'),
          num: true,
          field,
          cell: (r) => (r[field] === null ? '—' : `${num(r[field], 0)} ${unit}`),
        },
        { label: L('col.orReqCount'), num: true, cls: 'col-2', field: 'requests', cell: (r) => compact(r.requests) ?? '—' },
        { label: L('col.orProvider'), cls: 'col-2', field: 'provider', cell: (r) => (r.provider ? `<span class="tag">${esc(r.provider)}</span>` : '') },
      ],
      defaultSort: { index: 3, dir: view === 'throughput' ? 'desc' : 'asc' },
      searchFields: ['name', 'slug', 'author'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () => subBoardChips({ latency: 'p.orPerf.latency', throughput: 'p.orPerf.throughput' }, view, 'perf'),
      card: {
        title: (r) => esc(r.name || r.slug),
        value: (r) =>
          r[field] === null
            ? '—'
            : `<span class="v-num">${num(r[field], 0)}</span> <span class="v-unit">${unit}</span>`,
        meta: (r) =>
          (r.provider ? `<span class="tag">${esc(r.provider)}</span>` : '') +
          `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orReqCount')}</span>`,
      },
    });
    p.el.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-perf]');
      if (b) loadOrPerformance(b.getAttribute('data-perf'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：Artificial Analysis 三张评测榜（与 HF 评测榜不同来源，可并列看） */
async function loadOrBenchmarks(view = 'intelligence') {
  const p = panel({ id: 'aaBench', iconName: 'trophy', title: L('p.aaBench.title'), hint: L('p.aaBench.hint') });
  try {
    const data = await cachedJson('or-benchmarks', `${OR_API}/rankings/benchmarks`);
    const rows = rankAa(data?.data?.aaData?.[view]);
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols: [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'name', cell: (r) => esc(r.name) },
        { label: L('col.score'), num: true, field: 'score', cell: (r) => num(r.score, 1) },
      ],
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: ['name', 'slug'],
      placeholder: L('ui.searchModels'),
      transform: withRank,
      beforeControls: () =>
        subBoardChips(
          { intelligence: 'p.aaBench.intelligence', coding: 'p.aaBench.coding', agentic: 'p.aaBench.agentic' },
          view,
          'aa'
        ),
      card: {
        title: (r) => esc(r.name),
        value: (r) => `<span class="v-num">${num(r.score, 1)}</span> <span class="v-unit">${L('col.score')}</span>`,
        // 这一榜只有"名字 + 分数"两个字段（AA 的原始数据里没有机构/日期），
        // 所以没有可当标签的东西 —— 显式给空串，而不是省略（见 cardGrid 的说明）
        meta: () => '',
        link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
      },
    });
    p.el.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-aa]');
      if (b) loadOrBenchmarks(b.getAttribute('data-aa'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 面板：OpenRouter 模型库（全量目录：价格 / 上下文 / 模态 / 上线时间）  */
/* ================================================================== */

/**
 * `/api/v1/models`（~762KB、约 460 个模型）→ 面板行。
 * 价格从"每 token 美元"（字符串）换算成"每百万 token 美元"（数字）：
 * `"0.000002"` → 2（fmtCost 显示成 `$2`，0 显示成"免费"）。
 * 缺失字段一律 null —— 空值恒排最后，不冒充 0 分 / 0 价 / 0 上下文。
 */
export function flattenOrCatalog(json) {
  const perM = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n * 1e6 : null;
  };
  const out = [];
  for (const m of json?.data || []) {
    if (!m?.id) continue;
    out.push({
      id: String(m.id),
      name: String(m.name || m.id),
      vendor: String(m.id).split('/')[0] || '',
      release: Number.isFinite(Number(m.created)) ? new Date(m.created * 1000).toISOString().slice(0, 10) : '',
      context: Number(m.context_length) || null,
      costIn: perM(m.pricing?.prompt),
      costOut: perM(m.pricing?.completion),
      modality: String(m.architecture?.modality || ''),
      slug: String(m.canonical_slug || m.id),
    });
  }
  // 上线日期降序，没日期的排最后（与 flattenModelsDev 同一约定：不把缺日期当 1970）
  return out.sort((a, b) => {
    if (!a.release && !b.release) return a.name.localeCompare(b.name);
    if (!a.release) return 1;
    if (!b.release) return -1;
    return b.release.localeCompare(a.release);
  });
}

/** 模型库的挂载：新鲜数据与回退快照共用一份配置，只差那行"快照声明" */
function mountOrCatalog(p, rows, note) {
  mountBoard(p, {
    rows,
    cols: [
      { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
      {
        label: L('col.model'),
        field: 'name',
        cell: (r) => `<a href="https://openrouter.ai/${encodeURI(r.slug)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`,
      },
      { label: L('col.provider'), cls: 'col-2', field: 'vendor', cell: (r) => `<span class="tag">${esc(r.vendor)}</span>` },
      { label: L('col.release'), field: 'release', cell: (r) => esc(r.release) || '—' },
      { label: L('col.context'), num: true, cls: 'col-2', field: 'context', cell: (r) => compact(r.context) ?? '—' },
      { label: L('col.priceIn'), num: true, cls: 'col-2', field: 'costIn', cell: (r) => fmtCost(r.costIn) },
      { label: L('col.priceOut'), num: true, cls: 'col-2', field: 'costOut', cell: (r) => fmtCost(r.costOut) },
      { label: L('col.modality'), cls: 'col-2', field: 'modality', cell: (r) => esc(r.modality) || '—' },
    ],
    defaultSort: { index: 3, dir: 'desc' },
    limit: 60,
    searchFields: ['name', 'id', 'vendor'],
    groupField: 'vendor',
    groupLabel: L('ui.allProviders'),
    placeholder: L('ui.searchModelsProviders'),
    transform: withRank,
    note,
    card: {
      title: (r) => esc(r.name),
      value: (r) => `<span class="v-num">${esc(r.release) || '—'}</span> <span class="v-unit">${L('col.release')}</span>`,
      meta: (r) =>
        `<span class="tag">${esc(r.vendor)}</span>` +
        `<span class="tag">${compact(r.context) ?? '—'} ${L('col.context')}</span>` +
        `<span class="tag">${L('col.priceIn')} ${fmtCost(r.costIn)}</span>`,
      link: (r) => `https://openrouter.ai/${encodeURI(r.slug)}`,
    },
  });
}

/**
 * 面板：OpenRouter 模型库。与"用量榜"互补 —— 那边回答"谁在被用"，
 * 这边回答"有什么可用的、多少钱"。浏览器直连（CORS `*`，实测 2026-09-30），
 * 762KB 与 models.dev（4.8MB）/ SWE-bench（4MB）同属"进页面就拉"的量级。
 */
async function loadOrCatalog() {
  const p = panel({
    id: 'orCatalog',
    iconName: 'database',
    title: L('p.orCatalog.title'),
    hint: L('p.orCatalog.hint'),
  });
  p.status(L('st.loadingBig', { size: '0.76MB' }), 'loading');
  p.body(skeleton(6));
  try {
    // 与其它 OpenRouter 面板共用同一个缓存键：同一标签页里逛完整组只拉一次
    const json = await cachedJson('openrouter-models', OPENROUTER_MODELS_URL);
    const rows = flattenOrCatalog(json);
    if (!rows.length) throw new Error(L('err.noModels'));
    writeSnapshot('or-catalog', rows);
    // 抓取时刻：缓存条目自带写入时间 t —— 命中缓存时是当初拉取的时刻，
    // 未命中则是刚才（cachedJson 刚写进去），两种情况下它都是真话
    const entry = readCacheEntry('openrouter-models', CACHE_TTL_MS);
    p.status('', 'ok');
    mountOrCatalog(p, rows, L('st.orCatDone', { time: fmtStamp(entry?.t ?? Date.now()) }));
  } catch (e) {
    // 上游读不动：回退本浏览器最后一次成功抓取的快照（照实标时刻，不装新数据）
    const snap = readSnapshot('or-catalog');
    if (snap && Array.isArray(snap.v) && snap.v.length) {
      p.status('', 'warn');
      mountOrCatalog(p, snap.v, L('st.staleSnap', { msg: e.message, time: fmtStamp(snap.t) }));
      return;
    }
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/** 面板：OpenRouter 应用榜 + 多模态用量（三个子榜） */
async function loadOrApps(view = 'day') {
  const p = panel({ id: 'orApps', iconName: 'cube', title: L('p.orApps.title'), hint: L('p.orApps.hint') });
  const views = { day: 'p.orApps.day', week: 'p.orApps.week', image: 'p.orApps.image', video: 'p.orApps.video', audio: 'p.orApps.audio' };
  try {
    const isMedia = view === 'image' || view === 'video' || view === 'audio';
    const url = isMedia
      ? `${OR_API}/rankings/${view === 'image' ? 'image-output' : view === 'video' ? 'video-output-hours' : 'stt-transcript-characters'}`
      : `${OR_API}/rankings/apps`;
    const [raw, models] = await Promise.all([cachedJson(`or-${view}`, url), cachedJson('openrouter-models', OPENROUTER_MODELS_URL)]);
    const nameOf = orNameOf(models);
    // 单位三者不同：图像按张、视频按**小时**（上游给的就是小时）、语音按字符
    const mediaUnit = view === 'image' ? L('ui.orImages') : view === 'video' ? L('ui.orHours') : L('ui.orChars');

    let rows;
    let cols;
    let card;
    if (isMedia) {
      rows = flattenMedia(raw).map((r) => ({
        ...r,
        label: openrouterLabel(r.slug, nameOf),
      }));
      cols = [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        { label: L('col.model'), field: 'label', cell: (r) => esc(r.label) },
        { label: mediaUnit, num: true, field: 'value', cell: (r) => num(r.value, 0) },
      ];
      card = {
        title: (r) => esc(r.label),
        value: (r) => `<span class="v-num">${num(r.value, 0)}</span> <span class="v-unit">${mediaUnit}</span>`,
      };
    } else {
      rows = rankApps(raw?.data?.[view]);
      cols = [
        { label: '#', sortable: false, cell: (r) => rankBadge(r.__rank) },
        {
          label: L('col.app'),
          field: 'title',
          cell: (r) => (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title)),
        },
        { label: L('col.orTokens'), num: true, field: 'tokens', cell: (r) => compact(r.tokens) ?? '—' },
        { label: L('col.orRequests'), num: true, cls: 'col-2', field: 'requests', cell: (r) => compact(r.requests) ?? '—' },
        { label: L('col.task'), cls: 'col-2', field: 'categories', cell: (r) => (r.categories ? `<span class="tag">${esc(r.categories)}</span>` : '') },
      ];
      card = {
        title: (r) => esc(r.title),
        value: (r) => `<span class="v-num">${compact(r.tokens) ?? '—'}</span> <span class="v-unit">${L('col.orTokens')}</span>`,
        meta: (r) => `<span class="tag">${compact(r.requests) ?? '—'} ${L('col.orRequests')}</span>`,
        link: (r) => r.url,
      };
    }
    if (!rows.length) throw new Error(L('err.noBoard'));
    p.status('', 'ok');
    mountBoard(p, {
      rows,
      cols,
      defaultSort: { index: 2, dir: 'desc' },
      searchFields: isMedia ? ['label', 'slug'] : ['title', 'categories'],
      placeholder: isMedia ? L('ui.searchModels') : L('ui.searchApps'),
      transform: withRank,
      beforeControls: () => subBoardChips(views, view, 'app'),
      card,
    });
    p.el.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-app]');
      if (b) loadOrApps(b.getAttribute('data-app'));
    });
  } catch (e) {
    p.status(L('st.failed', { msg: e.message }), 'err');
    p.body('');
  }
}

/* ================================================================== */
/* 启动                                                                */
/* ================================================================== */

/**
 * 面板注册表 —— 键就是 `BOARD_IDS` 里的 id，值是一个启动函数。
 *
 * 用**映射**而不是数组：面板页靠 id 指名要跑哪一个，数组就只能按下标取，
 * 而"第 5 个"这种说法一旦有人调整顺序就会静默错位（跑出别的面板，页面不报错）。
 */
const BOARD_LOADERS = {
  trending: () =>
    loadModelBoard({
      id: 'trending',
      iconName: 'trending',
      title: L('p.trending.title'),
      sort: 'trendingScore',
      metric: { label: L('col.trending'), field: 'trendingScore', icon: 'trending' },
      hint: L('p.trending.hint'),
    }),
  liked: () =>
    loadModelBoard({
      id: 'liked',
      iconName: 'heart',
      title: L('p.liked.title'),
      sort: 'likes',
      metric: { label: L('col.likes'), field: 'likes', icon: 'heart' },
      hint: L('p.liked.hint'),
    }),
  downloaded: () =>
    loadModelBoard({
      id: 'downloaded',
      iconName: 'download',
      title: L('p.downloaded.title'),
      sort: 'downloads',
      metric: { label: L('col.downloads'), field: 'downloads', icon: 'download' },
      hint: L('p.downloaded.hint'),
    }),
  eval: () => loadEvalBoard(),
  aider: () => loadAiderBoard(),
  spaces: () => loadSpaces(),
  datasets: () => loadDatasets(),
  papers: () => loadPapers(),
  repos: () => loadRepos('week'),
  ghTrending: () => loadGhTrending('ai'),
  newmodels: () => loadNewModels(),
  openrouter: () => loadOpenRouter(),
  orCatalog: () => loadOrCatalog(),
  orTrends: () => loadOrTrends(),
  orAuthors: () => loadOrAuthors(),
  orPerf: () => loadOrPerformance(),
  aaBench: () => loadOrBenchmarks(),
  orApps: () => loadOrApps(),
  swebench: () => loadSweBench(),
};

/**
 * 清掉本页的缓存并重画全部面板。
 *
 * 为什么要"清缓存"而不是直接 location.reload()：
 * 缓存是 sessionStorage 里的，刷新页面并不会丢掉它 —— 用户点"刷新数据"
 * 却看到一模一样的内容（因为读的还是 10 分钟内的缓存），
 * 会以为按钮坏了。所以必须显式清掉再拉。
 *
 * localStorage 的快照**不清**（它是上游挂掉时的回退物），但要立一个
 * **强制重拉**标记：评测榜对 7 天内快照直接复用，不设标记的话按钮对它无效。
 */
function reloadAll() {
  clearCache();
  try {
    sessionStorage.setItem(FORCE_KEY, '1');
  } catch {
    /* 存不进就算了：顶多评测榜这次仍用快照，不是错误 */
  }
  panelsRoot.innerHTML = '';
  startAll();
}

/** 逐个启动面板（不 await 彼此）：最慢的源不该挡住最快的源 */
function startAll() {
  // 页面指名的 panel 不存在 → 明着报，不要渲染一个空白页。
  // 走到这里只会是页面写错 id 或 id 改过（`SITE_FILES` / 导航 / data-board 三处要一起改）
  if (!wantedIds.length) {
    panelsRoot.innerHTML =
      `<section class="panel"><p class="panel-status err">` +
      `${esc(L('err.unknownBoard', { id: requestedBoard }))}</p></section>`;
    return;
  }
  for (const id of wantedIds) {
    Promise.resolve()
      .then(() => BOARD_LOADERS[id]())
      .catch((e) => {
        // 兜底：面板构造本身出错也要看得见，不能静默消失
        const el = document.createElement('section');
        el.className = 'panel';
        el.innerHTML = `<p class="panel-status err">${L('err.init', { msg: esc(e.message) })}</p>`;
        panelsRoot.appendChild(el);
      });
  }
}

if (panelsRoot) {
  startAll();
  if (SINGLE_BOARD) buildBoardNav();
}

/**
 * 单面板页的页脚：其余面板的链接 + 「刷新数据」按钮。
 *
 * 两样都**由脚本生成**而不是写进 22 个页面文件：面板名与"刷新"的文案
 * 都来自 `i18n.js`（页面骨架的文案不进字典，所以只能由脚本取），
 * 而且链接的 href 与 `BOARD_IDS` 天然同源 —— 抄进 22 份就迟早抄错。
 *
 * 刷新按钮原来长在大盘页的 hero 里，那页被拆掉后它没地方待了。
 * 放在这里而不是页面骨架里，是因为它依赖本模块的 `reloadAll`。
 */
function buildBoardNav() {
  const current = BOARD_IDS.indexOf(requestedBoard);
  const links = BOARD_IDS.map((id) => {
    const label = esc(L(`p.${id}.title`));
    return id === requestedBoard
      ? `<a href="${id}.html" aria-current="page">${label}</a>`
      : `<a href="${id}.html">${label}</a>`;
  }).join('');

  const nav = document.createElement('nav');
  nav.className = 'board-links';
  nav.setAttribute('aria-label', L('ui.boardNav'));
  nav.innerHTML = `${links}
    <div class="board-tags">
      <span class="muted">${esc(L('ui.boardTags'))}</span>
      ${tagChips(BOARD_TAGS[requestedBoard], TAG_PREFIX)}
    </div>
    <div class="board-actions">
      <button class="btn-sm" type="button" id="refresh">
        <span class="ic" data-icon="refresh"></span>${esc(L('ui.refresh'))}
      </button>
      <span class="muted" id="refresh-hint"></span>
    </div>`;
  // 插在 #panels 之后（面板还在加载时它就在了 —— 导航不该等数据）
  panelsRoot.after(nav);

  const refreshBtn = nav.querySelector('#refresh');
  refreshBtn.addEventListener('click', () => {
    const hint = nav.querySelector('#refresh-hint');
    refreshBtn.disabled = true;
    hint.textContent = L('hero.refreshing');
    reloadAll();
    // 评测榜要拉 46 页、约 8 秒，按钮禁用久一点，避免连点
    setTimeout(() => {
      refreshBtn.disabled = false;
      hint.textContent = L('hero.refreshed');
    }, 1200);
  });

  // 图标由 ui.js 按 [data-icon] 回填；这一段是后插进来的，这里补一次
  injectIcons(nav);
}
