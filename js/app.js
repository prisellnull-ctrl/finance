/* ЛИМИТ — персональный дневной лимит и распределение поступлений */
(() => {
  "use strict";

  const KEY = "limit.pwa.v1";
  const SESSION_PIN = "limit.pwa.unlocked";

  const INCOME = {
    salary: { id: "salary", label: "Зарплата", rank: 1 },
    advance: { id: "advance", label: "Аванс", rank: 2 },
    extra: { id: "extra", label: "Доп. доход", rank: 3 },
  };

  const DEFAULT_CATS = [
    "Покупки в магазине",
    "Перекусы",
    "Напитки",
    "Еда в столовой",
    "Ресторан",
    "Транспорт",
    "Аптека",
    "Связь",
    "Прочее",
  ];

  const DEFAULT_PRODUCTS = [
    "Выпечка",
    "Молочные",
    "Мясо и рыба",
    "Овощи и фрукты",
    "Бакалея",
    "Сладости",
    "Напитки",
    "Готовая еда",
    "Бытовое",
    "Прочее",
  ];

  const INTERVALS = [
    { id: "monthly", label: "Ежемесячно", div: 1 },
    { id: "quarterly", label: "Раз в квартал", div: 3 },
    { id: "semiannual", label: "Раз в полгода", div: 6 },
    { id: "yearly", label: "Раз в год", div: 12 },
  ];

  /* ---------- utils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m = 1-12
  const parseISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (iso, n) => {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const monthKey = (iso = todayISO()) => iso.slice(0, 7);
  const fmt = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  };
  const money = (n) => `${fmt(n)} ₽`;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const MON = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

  function debounceClick(fn, ms = 350) {
    let lock = false;
    return (...args) => {
      if (lock) return;
      lock = true;
      try { fn(...args); } finally { setTimeout(() => (lock = false), ms); }
    };
  }

  /* ---------- state ---------- */
  function blank() {
    const t = todayISO();
    const [y, m] = t.split("-").map(Number);
    return {
      settings: {
        dailyLimit: 500,
        pin: "",
        categories: [...DEFAULT_CATS],
        productCategories: [...DEFAULT_PRODUCTS],
        onboarded: false,
      },
      daily: {
        date: t,
        limitToday: 500,
        spentToday: 0,
      },
      month: {
        key: monthKey(t),
        allocated: 500 * daysInMonth(y, m),
        pool: 0,
      },
      unallocated: 0,
      otherPool: 0,
      transactions: [],
      allocations: [],
      dailyLog: {}, // iso -> {limit, spent}
      cards: {
        must: [],
        piggy: [],
        debt: [],
      },
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = JSON.parse(raw);
      const b = blank();
      const merged = {
        ...b,
        ...s,
        settings: { ...b.settings, ...(s.settings || {}) },
        daily: { ...b.daily, ...(s.daily || {}) },
        month: { ...b.month, ...(s.month || {}) },
        cards: {
          must: s.cards?.must || [],
          piggy: s.cards?.piggy || [],
          debt: s.cards?.debt || [],
        },
      };
      if (!merged.settings.productCategories?.length) {
        merged.settings.productCategories = [...DEFAULT_PRODUCTS];
      }
      if (!merged.settings.categories?.length) {
        merged.settings.categories = [...DEFAULT_CATS];
      }
      if (merged.otherPool == null) merged.otherPool = 0;
      (merged.cards.piggy || []).forEach((c) => {
        if (c.priority == null) c.priority = 3;
      });
      return merged;
    } catch {
      return blank();
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /* ---------- engine ---------- */
  function rollCalendar() {
    const today = todayISO();
    const [y, m] = today.split("-").map(Number);
    const mk = monthKey(today);
    if (state.month.key !== mk) {
      state.month = {
        key: mk,
        allocated: (state.settings.dailyLimit || 0) * daysInMonth(y, m),
        pool: state.month.pool || 0,
      };
    }
    if (!state.daily?.date) {
      state.daily = { date: today, limitToday: state.settings.dailyLimit, spentToday: 0 };
    }
    let guard = 0;
    while (state.daily.date < today && guard++ < 400) {
      state.dailyLog[state.daily.date] = {
        limit: state.daily.limitToday,
        spent: state.daily.spentToday,
      };
      const unused = state.daily.limitToday - state.daily.spentToday;
      const next = addDays(state.daily.date, 1);
      state.daily = {
        date: next,
        limitToday: state.settings.dailyLimit + unused,
        spentToday: 0,
      };
    }
    if (!state.dailyLog[today]) {
      state.dailyLog[today] = { limit: state.daily.limitToday, spent: state.daily.spentToday };
    }
    save();
  }

  function debtNeed() {
    return state.cards.debt.reduce((s, c) => {
      if (c.totalDebt && c.totalDebt > 0) {
        const left = Math.max(0, c.totalDebt - (c.paid || 0));
        return s + left;
      }
      return s + Math.max(0, Number(c.monthlyPayment) || 0);
    }, 0);
  }

  function periodAmount(card) {
    const iv = INTERVALS.find((i) => i.id === card.interval) || INTERVALS[0];
    if (card.mode === "percent") return null;
    return (Number(card.target) || 0) / iv.div;
  }

  function distribute(amount, kind, incomeId) {
    const report = {
      incomeId,
      kind,
      source: amount,
      at: new Date().toISOString(),
      date: todayISO(),
      home: 0,
      debt: 0,
      must: [],
      piggy: [],
      leftover: 0,
    };
    let rest = amount;

    if (kind === "salary") {
      const [y, m] = todayISO().split("-").map(Number);
      const need = (state.settings.dailyLimit || 0) * daysInMonth(y, m);
      const toHome = Math.min(rest, need);
      state.month.allocated = need;
      state.month.pool += toHome;
      state.month.key = monthKey();
      report.home = toHome;
      rest -= toHome;
    }

    const debts = state.cards.debt;
    if (debts.length && rest > 0) {
      const half = rest * 0.5;
      const need = debtNeed();
      const toDebt = Math.min(half, need, rest);
      if (toDebt > 0) {
        state.otherPool = (state.otherPool || 0) + toDebt;
        report.debt = toDebt;
        rest -= toDebt;
      }
    }

    if (kind === "salary" && rest > 0) {
      const vis = state.cards.must.filter((c) => c.visible !== false);
      if (vis.length) {
        const wants = vis.map((c) => {
          if (c.mode === "percent") return { c, want: rest * ((Number(c.percent) || 0) / 100) };
          return { c, want: Math.max(0, periodAmount(c) || 0) };
        });
        const sumW = wants.reduce((s, w) => s + w.want, 0);
        let used = 0;
        if (sumW > 0) {
          const scale = sumW > rest ? rest / sumW : 1;
          wants.forEach((w) => {
            const give = Math.round(w.want * scale * 100) / 100;
            if (give > 0) {
              w.c.balance = (w.c.balance || 0) + give;
              report.must.push({ id: w.c.id, name: w.c.name, amount: give });
              used += give;
            }
          });
        }
        rest -= used;
      }
    }

    if (rest > 0) {
      const vis = state.cards.piggy.filter((c) => c.visible !== false);
      if (vis.length) {
        const ranked = vis.map((c) => ({
          c,
          p: clamp(Number(c.priority) || 3, 1, 5),
        })).sort((a, b) => b.p - a.p);
        const sumP = ranked.reduce((s, x) => s + x.p, 0) || ranked.length;
        let used = 0;
        ranked.forEach((x, i) => {
          const give = i === ranked.length - 1
            ? Math.round((rest - used) * 100) / 100
            : Math.round(((rest * x.p) / sumP) * 100) / 100;
          if (give > 0) {
            x.c.balance = (x.c.balance || 0) + give;
            report.piggy.push({ id: x.c.id, name: x.c.name, amount: give });
            used += give;
          }
        });
        rest -= used;
      }
    }

    if (rest > 0.009) {
      state.unallocated = (state.unallocated || 0) + rest;
      report.leftover = rest;
    }
    state.allocations.unshift(report);
    save();
    return report;
  }

  function addIncome({ amount, kind, title }) {
    amount = Number(amount) || 0;
    if (amount <= 0) return;
    const tx = {
      id: uid(),
      type: "income",
      amount,
      kind,
      title: title || INCOME[kind]?.label || "Поступление",
      date: todayISO(),
      ts: Date.now(),
    };
    state.transactions.unshift(tx);
    distribute(amount, kind, tx.id);
    save();
    return tx;
  }

  function addExpense({ items, category, title }) {
    const list = (items || []).filter((i) => i.name && Number(i.amount) > 0);
    if (!list.length) return;
    const amount = list.reduce((s, i) => s + Number(i.amount), 0);
    const tx = {
      id: uid(),
      type: "expense",
      amount,
      category: category || list[0].category || "Прочее",
      title: title || category || list[0].name,
      items: list,
      date: todayISO(),
      ts: Date.now(),
    };
    state.transactions.unshift(tx);
    state.daily.spentToday += amount;
    state.month.pool -= amount;
    state.dailyLog[todayISO()] = {
      limit: state.daily.limitToday,
      spent: state.daily.spentToday,
    };
    save();
    return tx;
  }

  function removeTx(id) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tx = state.transactions[i];
    if (tx.type === "expense" && tx.date === state.daily.date) {
      state.daily.spentToday = Math.max(0, state.daily.spentToday - tx.amount);
      state.month.pool += tx.amount;
      state.dailyLog[tx.date] = { limit: state.daily.limitToday, spent: state.daily.spentToday };
    } else if (tx.type === "expense") {
      state.month.pool += tx.amount;
      if (state.dailyLog[tx.date]) {
        state.dailyLog[tx.date].spent = Math.max(0, state.dailyLog[tx.date].spent - tx.amount);
      }
    }
    // income reversal is approximate: we do not unwind card balances automatically
    state.transactions.splice(i, 1);
    save();
  }

  function transfer(tab, fromId, toId, amount) {
    amount = Number(amount) || 0;
    if (amount <= 0 || fromId === toId) return false;
    const list = state.cards[tab];
    const b = toId === "__pool__" ? null : list.find((c) => c.id === toId);
    if (fromId === "__pool__") {
      if (tab !== "debt" || (state.otherPool || 0) < amount || !b) return false;
      state.otherPool -= amount;
      b.balance = (b.balance || 0) + amount;
      b.paid = (b.paid || 0) + amount;
      save();
      return true;
    }
    const a = list.find((c) => c.id === fromId);
    if (!a || (a.balance || 0) < amount) return false;
    a.balance -= amount;
    if (toId === "__pool__" && tab === "debt") {
      state.otherPool = (state.otherPool || 0) + amount;
      a.paid = Math.max(0, (a.paid || 0) - amount);
    } else if (b) {
      b.balance = (b.balance || 0) + amount;
    } else {
      a.balance += amount;
      return false;
    }
    save();
    return true;
  }

  function removeCard(tab, id) {
    state.cards[tab] = state.cards[tab].filter((c) => c.id !== id);
    save();
  }

  /* ---------- ui helpers ---------- */
  let currentTab = "home";
  let overlayMode = null;

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  function closeOverlay() {
    overlayMode = null;
    const ov = $("#overlay");
    ov.classList.remove("show");
    setTimeout(() => { if (!ov.classList.contains("show")) ov.innerHTML = ""; }, 220);
  }

  function openOverlay(html) {
    const ov = $("#overlay");
    ov.innerHTML = html;
    requestAnimationFrame(() => ov.classList.add("show"));
    ov.onclick = (e) => { if (e.target === ov) closeOverlay(); };
  }

  function confirmDlg(title, text, onYes, yesLabel) {
    openOverlay(`
      <div class="confirm-box">
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <div class="row-btns">
          <button class="btn btn-ghost" id="cNo">Отмена</button>
          <button class="btn btn-danger" id="cYes">${esc(yesLabel || "Удалить")}</button>
        </div>
      </div>`);
    $("#cNo").onclick = closeOverlay;
    $("#cYes").onclick = debounceClick(() => { onYes(); closeOverlay(); });
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fileToData(file, cb) {
    if (!file) return cb("");
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      const max = 320;
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = h * (max / w); w = max; }
      else if (h > max) { w = w * (max / h); h = max; }
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cb(c.toDataURL("image/jpeg", 0.72));
    };
    img.src = url;
  }

  /* ---------- swipe ---------- */
  function bindSwipe(root, onDelete) {
    $$(".row-swipe", root).forEach((row) => {
      const inner = row.querySelector(".swipe-inner");
      if (!inner) return;
      let x0 = 0, dx = 0, active = false;
      const max = -92;
      const start = (x) => { active = true; x0 = x; dx = 0; inner.style.transition = "none"; };
      const move = (x) => {
        if (!active) return;
        dx = Math.min(0, x - x0);
        inner.style.transform = `translateX(${dx}px)`;
      };
      const end = () => {
        if (!active) return;
        active = false;
        inner.style.transition = "transform .18s ease";
        if (dx < -64) {
          inner.style.transform = `translateX(${max}px)`;
          const id = row.dataset.id;
          const tab = row.dataset.tab;
          setTimeout(() => {
            confirmDlg("Удалить запись?", "Действие нельзя отменить.", () => {
              onDelete(id, tab);
              render();
            });
            inner.style.transform = "translateX(0)";
          }, 80);
        } else {
          inner.style.transform = "translateX(0)";
        }
      };
      row.addEventListener("touchstart", (e) => start(e.changedTouches[0].clientX), { passive: true });
      row.addEventListener("touchmove", (e) => move(e.changedTouches[0].clientX), { passive: true });
      row.addEventListener("touchend", end);
      row.addEventListener("mousedown", (e) => start(e.clientX));
      window.addEventListener("mousemove", (e) => active && move(e.clientX));
      window.addEventListener("mouseup", end);
    });
  }

  /* ---------- render views ---------- */
  function headerDate() {
    const d = new Date();
    $("#hdrDate").textContent = `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  }

  function remainToday() {
    return state.daily.limitToday - state.daily.spentToday;
  }

  function renderHome() {
    const rem = remainToday();
    const lim = state.daily.limitToday || 1;
    const pct = clamp((state.daily.spentToday / lim) * 100, 0, 160);
    const over = rem < 0;
    const [y, m] = todayISO().split("-").map(Number);
    const dim = daysInMonth(y, m);
    const days = [];
    for (let d = 1; d <= dim; d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      const log = state.dailyLog[iso];
      const isToday = iso === todayISO();
      const future = iso > todayISO();
      let cls = "day-cell";
      if (isToday) cls += " today";
      if (future) cls += " future";
      if (log && log.spent > log.limit) cls += " over";
      else if (log && log.spent > 0 && log.spent <= log.limit) cls += " ok";
      const spent = isToday ? state.daily.spentToday : (log?.spent ?? "");
      days.push(`<div class="${cls}" data-day="${iso}">
        <div class="dn">${WD[new Date(y, m - 1, d).getDay()]}</div>
        <div class="dd">${d}</div>
        <div class="ds">${future ? "—" : (spent === "" ? "0" : fmt(spent))}</div>
      </div>`);
    }

    const txs = state.transactions.slice(0, 40);
    const hist = txs.length
      ? txs.map(txRow).join("")
      : `<div class="empty">История пуста. Добавьте пополнение или трату.</div>`;

    $("#view-home").innerHTML = `
      <div class="hero">
        <div class="hero-label">${over ? "Перерасход сегодня" : "Осталось сегодня"}</div>
        <div class="hero-amount">${fmt(Math.abs(rem))}<span class="cur">₽</span></div>
        <div class="hero-sub">
          <span>Лимит дня ${fmt(state.daily.limitToday)} ₽</span>
          <span>потрачено ${fmt(state.daily.spentToday)} ₽</span>
        </div>
        <div class="meter ${over ? "over" : ""}"><span style="width:${Math.min(pct,100)}%"></span></div>
      </div>
      <div class="month-row">
        <div class="stat-chip">
          <div class="k">Пул месяца</div>
          <div class="v ${state.month.pool < 0 ? "neg" : ""}">${fmt(state.month.pool)} ₽</div>
        </div>
        <div class="stat-chip">
          <div class="k">Нераспределено</div>
          <div class="v">${fmt(state.unallocated || 0)} ₽</div>
        </div>
      </div>
      <div class="days-wrap">
        <div class="days-label">Дни месяца</div>
        <div class="days" id="daysStrip">${days.join("")}</div>
      </div>
      <div class="actions">
        <button class="btn btn-gold" id="btnIn">+ Пополнение</button>
        <button class="btn btn-ghost" id="btnOut">− Трата</button>
      </div>
      <div class="section-h"><h2>История</h2><span>${state.transactions.length}</span></div>
      <div class="history">${hist}</div>
    `;
    const strip = $("#daysStrip");
    const todayCell = strip?.querySelector(".today");
    if (todayCell) todayCell.scrollIntoView({ inline: "center", block: "nearest" });
    $("#btnIn").onclick = debounceClick(() => sheetIncome());
    $("#btnOut").onclick = debounceClick(() => sheetExpense());
    bindSwipe($("#view-home"), (id) => removeTx(id));
  }

  function txRow(tx) {
    const isIn = tx.type === "income";
    const kind = isIn ? (INCOME[tx.kind]?.label || "") : "";
    const sub = isIn
      ? `${tx.date}${kind ? " · " + kind : ""}`
      : `${tx.date} · ${tx.category || ""}${tx.items?.length ? " · " + tx.items.map((i) => i.name).filter(Boolean).slice(0, 2).join(", ") : ""}${tx.items?.length > 2 ? "…" : ""}`;
    return `<div class="row-swipe" data-id="${tx.id}">
      <div class="behind">Удалить</div>
      <div class="hist-item swipe-inner">
        <div class="hist-ico">${isIn ? "↑" : "↓"}</div>
        <div>
          <div class="t1">${esc(tx.title)}${kind && isIn ? `<span class="badge">${esc(kind)}</span>` : ""}</div>
          <div class="t2">${esc(sub)}</div>
        </div>
        <div class="amt ${isIn ? "plus" : "minus"}">${isIn ? "+" : "−"}${fmt(tx.amount)} ₽</div>
      </div>
    </div>`;
  }

  function cardBlock(c, tab) {
    const hide = c.visible === false;
    const img = c.image
      ? `<div class="card-img"><img src="${c.image}" alt=""></div>`
      : `<div class="card-img">${tab === "debt" ? "◈" : tab === "piggy" ? "✦" : "▣"}</div>`;
    let meta = "";
    if (tab === "must") {
      meta = c.mode === "percent"
        ? `${c.percent || 0}% от поступления · ${labelInterval(c.interval)}`
        : `${fmt(c.target || 0)} ₽ · ${labelInterval(c.interval)}`;
    } else if (tab === "piggy") {
      meta = `приоритет ${c.priority || 3}`;
    } else {
      const left = c.totalDebt ? Math.max(0, c.totalDebt - (c.paid || 0)) : null;
      meta = [
        c.kind === "card" ? "Кредитка" : "Кредит",
        c.monthlyPayment ? `платёж ${fmt(c.monthlyPayment)} ₽` : null,
        left != null ? `остаток ${fmt(left)} ₽` : null,
      ].filter(Boolean).join(" · ");
    }
    return `<div class="row-swipe" data-id="${c.id}" data-tab="${tab}">
      <div class="behind">Удалить</div>
      <article class="card swipe-inner" data-open="${tab}:${c.id}">
        ${img}
        <div class="card-body">
          <div class="name">${esc(c.name)} ${hide ? `<span class="ghost-tag">скрыта</span>` : ""}
            ${tab === "debt" || tab === "piggy" ? `<span class="prio">P${c.priority || 3}</span>` : ""}</div>
          <div class="meta">${esc(meta)}</div>
          <div class="bal">${fmt(c.balance || 0)} ₽</div>
        </div>
      </article>
    </div>`;
  }

  function labelInterval(id) {
    return (INTERVALS.find((i) => i.id === id) || INTERVALS[0]).label;
  }

  function renderMust() {
    const list = state.cards.must;
    $("#view-must").innerHTML = `
      <div class="section-h"><h2>Обязательные накопления</h2><span>${list.length}</span></div>
      ${list.length ? list.map((c) => cardBlock(c, "must")).join("") : `<div class="empty">Нет карточек. Добавьте цель накопления.</div>`}
      <button class="add-card" id="addMust">+ Добавить карточку</button>
    `;
    $("#addMust").onclick = debounceClick(() => sheetCard("must"));
    bindCardClicks("must");
  }

  function renderPiggy() {
    const list = state.cards.piggy;
    $("#view-piggy").innerHTML = `
      <div class="section-h"><h2>Копилка</h2><span>${list.length}</span></div>
      ${list.length ? list.map((c) => cardBlock(c, "piggy")).join("") : `<div class="empty">Копилка пуста. Добавьте категорию накоплений.</div>`}
      <button class="add-card" id="addPig">+ Добавить карточку</button>
    `;
    $("#addPig").onclick = debounceClick(() => sheetCard("piggy"));
    bindCardClicks("piggy");
  }

  function renderOther() {
    const list = [...state.cards.debt].sort((a, b) => (a.priority || 5) - (b.priority || 5));
    const need = debtNeed();
    const paid = state.cards.debt.reduce((s, c) => s + (c.paid || 0), 0);
    const total = state.cards.debt.reduce((s, c) => s + (Number(c.totalDebt) || Number(c.monthlyPayment) || 0), 0);
    const load = total > 0 ? clamp((need / total) * 100, 0, 100) : (need > 0 ? 50 : 0);
    $("#view-other").innerHTML = `
      <div class="debt-scale">
        <div class="top"><span>Баланс вкладки</span><span>${fmt(state.otherPool || 0)} ₽</span></div>
        <div class="top" style="margin-top:8px"><span>Долговая нагрузка</span><span>${fmt(need)} ₽</span></div>
        <div class="scale-track"><i style="width:${load}%"></i></div>
        <div class="top" style="margin-top:8px"><span>Разнесено по карточкам</span><span>${fmt(paid)} ₽</span></div>
      </div>
      <div class="section-h"><h2>Обязательства</h2><span>${list.length}</span></div>
      ${list.length ? list.map((c) => cardBlock(c, "debt")).join("") : `<div class="empty">Нет обязательств.</div>`}
      <button class="add-card" id="addDebt">+ Добавить карточку</button>
    `;
    $("#addDebt").onclick = debounceClick(() => sheetCard("debt"));
    bindCardClicks("debt");
  }

  function bindCardClicks(tab) {
    bindSwipe($("#view-" + (tab === "must" ? "must" : tab === "piggy" ? "piggy" : "other")), (id, t) => {
      removeCard(t || tab, id);
    });
    $$(`#view-${tab === "debt" ? "other" : tab} [data-open]`).forEach((el) => {
      el.onclick = debounceClick(() => {
        const [t, id] = el.dataset.open.split(":");
        sheetCardAction(t, id);
      });
    });
  }

  function renderStats() {
    const [y, m] = todayISO().split("-").map(Number);
    const dim = daysInMonth(y, m);
    const spentByDay = [];
    let monthSpent = 0;
    for (let d = 1; d <= dim; d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      const s = iso === todayISO() ? state.daily.spentToday : (state.dailyLog[iso]?.spent || 0);
      spentByDay.push({ d, s, iso });
      if (iso <= todayISO()) monthSpent += s;
    }
    const maxS = Math.max(state.settings.dailyLimit, ...spentByDay.map((x) => x.s), 1);
    const bars = spentByDay.map((x) => {
      const h = (x.s / maxS) * 100;
      const over = x.s > state.settings.dailyLimit;
      const cls = `bar${over ? " over" : ""}${x.iso === todayISO() ? " today" : ""}`;
      return `<div class="${cls}" title="${x.d}: ${fmt(x.s)}"><i style="height:${h}%"></i></div>`;
    }).join("");

    const groups = {};
    state.transactions.filter((t) => t.type === "expense" && t.date.startsWith(monthKey())).forEach((t) => {
      const op = t.category || "Прочее";
      if (!groups[op]) groups[op] = { total: 0, products: {} };
      groups[op].total += t.amount;
      (t.items && t.items.length ? t.items : [{ amount: t.amount, product: "Прочее" }]).forEach((it) => {
        const p = it.product || "Прочее";
        groups[op].products[p] = (groups[op].products[p] || 0) + Number(it.amount || 0);
      });
    });
    const catSum = Object.values(groups).reduce((s, g) => s + g.total, 0) || 1;
    const catHtml = Object.keys(groups).length
      ? Object.entries(groups).sort((a, b) => b[1].total - a[1].total).map(([n, g]) => {
          const prods = Object.entries(g.products).sort((a, b) => b[1] - a[1]);
          return `<div class="alloc-group">
            <div class="alloc-row"><span>${esc(n)}</span><span>${fmt(g.total)} ₽</span></div>
            <div class="cat-bar"><i style="width:${(g.total / catSum) * 100}%"></i></div>
            ${prods.map(([p, v]) => `<div class="alloc-sub"><span>${esc(p)}</span><span>${fmt(v)} ₽</span></div>`).join("")}
          </div>`;
        }).join("")
      : `<div class="empty">Нет трат за месяц.</div>`;

    const monthAlloc = state.allocations.filter((a) => (a.date || "").startsWith(monthKey()));
    const sum = (k) => monthAlloc.reduce((s, a) => s + (a[k] || 0), 0);
    const mustSum = monthAlloc.reduce((s, a) => s + a.must.reduce((x, m) => x + m.amount, 0), 0);
    const pigSum = monthAlloc.reduce((s, a) => s + a.piggy.reduce((x, m) => x + m.amount, 0), 0);

    const byCard = {};
    monthAlloc.forEach((a) => {
      a.must.forEach((m) => { byCard[m.name] = (byCard[m.name] || 0) + m.amount; });
      a.piggy.forEach((m) => { byCard["Копилка · " + m.name] = (byCard["Копилка · " + m.name] || 0) + m.amount; });
    });
    const cardRows = Object.entries(byCard)
      .map(([n, v]) => `<div class="alloc-row"><span>${esc(n)}</span><span>${fmt(v)} ₽</span></div>`)
      .join("") || `<div class="empty">Распределений ещё не было.</div>`;

    $("#view-stats").innerHTML = `
      <div class="chart-card">
        <div class="hero-label">Расход лимита по дням</div>
        <div class="bars">${bars}</div>
        <div class="legend">
          <span><i class="dot" style="background:var(--gold)"></i>в лимите</span>
          <span><i class="dot" style="background:var(--terra)"></i>перерасход</span>
        </div>
      </div>
      <div class="month-row">
        <div class="stat-chip"><div class="k">Трат за месяц</div><div class="v">${fmt(monthSpent)} ₽</div></div>
        <div class="stat-chip"><div class="k">База дня</div><div class="v">${fmt(state.settings.dailyLimit)} ₽</div></div>
      </div>
      <div class="chart-card">
        <div class="hero-label">Куда ушли поступления</div>
        <div class="alloc-row"><span>Дневной пул</span><span>${fmt(sum("home"))} ₽</span></div>
        <div class="alloc-row"><span>Прочее</span><span>${fmt(sum("debt"))} ₽</span></div>
        <div class="alloc-row"><span>Обязательно</span><span>${fmt(mustSum)} ₽</span></div>
        <div class="alloc-row"><span>Копилка</span><span>${fmt(pigSum)} ₽</span></div>
        <div class="alloc-row"><span>Остаток</span><span>${fmt(sum("leftover"))} ₽</span></div>
      </div>
      <div class="chart-card">
        <div class="hero-label">На карточки</div>
        ${cardRows}
      </div>
      <div class="chart-card">
        <div class="hero-label">Траты по местам и товарам</div>
        ${catHtml}
      </div>
    `;
  }

  function render() {
    headerDate();
    rollCalendar();
    renderHome();
    renderMust();
    renderPiggy();
    renderOther();
    renderStats();
  }

  /* ---------- sheets ---------- */
  function sheetIncome() {
    overlayMode = "income";
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>Пополнение</h3>
        <div class="field"><label>Сумма</label><input id="inAmt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" /></div>
        <div class="field"><label>Тип важности</label>
          <div class="seg" id="inKind">
            <button data-k="salary" class="on">Зарплата</button>
            <button data-k="advance">Аванс</button>
            <button data-k="extra">Доп. доход</button>
          </div>
        </div>
        <div class="field"><label>Комментарий</label><input id="inTitle" placeholder="необязательно" /></div>
        <button class="btn btn-gold btn-block" id="inSave">Зачислить и распределить</button>
      </div>`);
    let kind = "salary";
    $$("#inKind button").forEach((b) => {
      b.onclick = () => {
        $$("#inKind button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        kind = b.dataset.k;
      };
    });
    $("#inSave").onclick = debounceClick(() => {
      const amount = Number($("#inAmt").value);
      if (!amount || amount <= 0) return toast("Укажите сумму");
      addIncome({ amount, kind, title: $("#inTitle").value.trim() });
      closeOverlay();
      render();
      toast("Поступление распределено");
    });
  }

  function sheetExpense() {
    overlayMode = "expense";
    const opOpts = (state.settings.categories || DEFAULT_CATS).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const prOpts = (state.settings.productCategories || DEFAULT_PRODUCTS).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>Трата</h3>
        <div class="field"><label>Где потрачено</label>
          <select id="exCat">${opOpts}</select>
        </div>
        <div class="field"><label>Товары</label>
          <div class="items" id="exItems"></div>
          <button class="add-card" id="exAdd" style="margin-top:8px">+ Товар</button>
        </div>
        <button class="btn btn-gold btn-block" id="exSave">Списать</button>
      </div>`);
    const box = $("#exItems");
    const addRow = (name = "", product = (state.settings.productCategories || DEFAULT_PRODUCTS)[0], amt = "") => {
      const row = document.createElement("div");
      row.className = "item-row item-row-prod";
      row.innerHTML = `
        <input class="nm" placeholder="Название товара" value="${esc(name)}" />
        <select class="ct">${prOpts}</select>
        <input class="am" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Сумма" value="${esc(amt)}" />
        <button class="x" type="button">×</button>`;
      row.querySelector(".ct").value = product;
      row.querySelector(".x").onclick = () => {
        if (box.children.length > 1) row.remove();
      };
      box.appendChild(row);
    };
    addRow();
    $("#exAdd").onclick = () => addRow();
    $("#exSave").onclick = debounceClick(() => {
      const items = $$(".item-row", box).map((r) => ({
        name: r.querySelector(".nm").value.trim(),
        amount: Number(r.querySelector(".am").value),
        product: r.querySelector(".ct").value,
      }));
      if (!items.some((i) => i.name && i.amount > 0)) return toast("Нужно название и сумма");
      if (items.some((i) => i.amount > 0 && !i.name)) return toast("Название товара обязательно");
      addExpense({ items, category: $("#exCat").value, title: $("#exCat").value });
      closeOverlay();
      render();
      toast("Трата записана");
    });
  }

  function sheetCard(tab, existing) {
    const isEdit = !!existing;
    const c = existing || { name: "", visible: true, mode: "amount", target: "", percent: "", interval: "monthly", priority: 3, kind: "credit", monthlyPayment: "", totalDebt: "" };
    const title = isEdit ? "Карточка" : (tab === "must" ? "Новое обязательное" : tab === "piggy" ? "Новая копилка" : "Новое обязательство");
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>${title}</h3>
        <div class="field"><label>Название</label><input id="cName" value="${esc(c.name)}" placeholder="Название" /></div>
        <div class="field"><label>Картинка</label><input id="cImg" type="file" accept="image/*" /></div>
        ${tab === "must" ? `
          <div class="field"><label>Тип накопления</label>
            <div class="seg" id="cMode">
              <button data-m="amount" class="${c.mode !== "percent" ? "on" : ""}">Сумма</button>
              <button data-m="percent" class="${c.mode === "percent" ? "on" : ""}">Процент</button>
            </div>
          </div>
          <div class="field" id="fAmt"><label>Сумма накопления</label><input id="cTarget" type="number" value="${esc(c.target || "")}" placeholder="0" /></div>
          <div class="field" id="fPct"><label>Процент от поступления</label><input id="cPct" type="number" value="${esc(c.percent || "")}" min="0" max="100" /></div>
          <div class="field"><label>Промежуток</label>
            <select id="cInt">${INTERVALS.map((i) => `<option value="${i.id}" ${c.interval===i.id?"selected":""}>${i.label}</option>`).join("")}</select>
          </div>` : ""}
        ${tab === "piggy" ? `
          <div class="field"><label>Приоритет накопления</label>
            <div class="prio-seg" id="cPrio">${[1,2,3,4,5].map((n) => `<button data-p="${n}" class="${(c.priority||3)===n?"on":""}">${n}</button>`).join("")}</div>
          </div>` : ""}
        ${tab === "debt" ? `
          <div class="field"><label>Категория</label>
            <div class="seg" id="cKind">
              <button data-k="credit" class="${c.kind !== "card" ? "on" : ""}">Кредит</button>
              <button data-k="card" class="${c.kind === "card" ? "on" : ""}">Кредитка</button>
            </div>
          </div>
          <div class="field"><label>Ежемесячный платёж</label><input id="cPay" type="number" value="${esc(c.monthlyPayment || "")}" /></div>
          <div class="field"><label>Фиксированная сумма долга</label><input id="cDebt" type="number" value="${esc(c.totalDebt || "")}" /></div>
          <div class="field"><label>Приоритет</label>
            <div class="prio-seg" id="cPrio">${[1,2,3,4,5].map((n) => `<button data-p="${n}" class="${(c.priority||3)===n?"on":""}">${n}</button>`).join("")}</div>
          </div>` : ""}
        ${tab !== "debt" ? `
          <div class="toggle">Невидимый режим (не участвует в распределении)
            <button class="switch ${c.visible === false ? "on" : ""}" id="cVis"><i></i></button>
          </div>` : ""}
        <button class="btn btn-gold btn-block" id="cSave">${isEdit ? "Сохранить" : "Создать"}</button>
      </div>`);

    let mode = c.mode || "amount";
    let kind = c.kind || "credit";
    let prio = c.priority || 3;
    let hidden = c.visible === false;
    let image = c.image || "";

    const syncMode = () => {
      const fa = $("#fAmt"), fp = $("#fPct");
      if (fa && fp) {
        fa.style.display = mode === "amount" ? "" : "none";
        fp.style.display = mode === "percent" ? "" : "none";
      }
    };
    syncMode();
    $$("#cMode button").forEach((b) => b.onclick = () => {
      $$("#cMode button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); mode = b.dataset.m; syncMode();
    });
    $$("#cKind button").forEach((b) => b.onclick = () => {
      $$("#cKind button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); kind = b.dataset.k;
    });
    $$("#cPrio button").forEach((b) => b.onclick = () => {
      $$("#cPrio button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on"); prio = Number(b.dataset.p);
    });
    $("#cVis")?.addEventListener("click", () => {
      hidden = !hidden;
      $("#cVis").classList.toggle("on", hidden);
    });
    $("#cImg").onchange = () => fileToData($("#cImg").files[0], (d) => { image = d; });

    $("#cSave").onclick = debounceClick(() => {
      const name = $("#cName").value.trim();
      if (!name) return toast("Укажите название");
      const card = existing || { id: uid(), balance: 0 };
      card.name = name;
      if (image) card.image = image;
      if (tab !== "debt") card.visible = !hidden;
      if (tab === "must") {
        card.mode = mode;
        card.target = Number($("#cTarget")?.value) || 0;
        card.percent = Number($("#cPct")?.value) || 0;
        card.interval = $("#cInt").value;
      }
      if (tab === "piggy") card.priority = prio;
      if (tab === "debt") {
        card.kind = kind;
        card.monthlyPayment = Number($("#cPay").value) || 0;
        card.totalDebt = Number($("#cDebt").value) || 0;
        card.priority = prio;
        card.paid = card.paid || 0;
      }
      if (!existing) state.cards[tab].push(card);
      save();
      closeOverlay();
      render();
    });
  }

  function sheetCardAction(tab, id) {
    const list = state.cards[tab];
    const card = list.find((c) => c.id === id);
    if (!card) return;
    const others = list.filter((c) => c.id !== id);
    const poolOpt = tab === "debt"
      ? `<option value="__pool__">Баланс вкладки · ${fmt(state.otherPool || 0)} ₽</option>`
      : "";
    const sources = poolOpt + others.map((o) => `<option value="${o.id}">${esc(o.name)} · ${fmt(o.balance||0)} ₽</option>`).join("");
    const canMove = tab === "debt" || others.length;
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>${esc(card.name)}</h3>
        <p style="color:var(--text-dim);margin-bottom:14px">Баланс карточки ${fmt(card.balance || 0)} ₽</p>
        ${canMove ? `
          <div class="field"><label>Откуда перебросить</label>
            <select id="trFrom">${sources}</select>
          </div>
          <div class="field"><label>Сумма</label><input id="trAmt" type="number" inputmode="decimal" /></div>
          <button class="btn btn-gold btn-block" id="trGo">На эту карточку</button>
          ${tab === "debt" && (card.balance || 0) > 0 ? `<button class="btn btn-ghost btn-block" id="trBack" style="margin-top:8px">Вернуть на баланс вкладки</button>` : ""}
        ` : `<div class="empty">Нет источников для перевода</div>`}
        <button class="btn btn-ghost btn-block" id="trEdit" style="margin-top:8px">Изменить карточку</button>
      </div>`);
    $("#trGo")?.addEventListener("click", debounceClick(() => {
      const ok = transfer(tab, $("#trFrom").value, id, Number($("#trAmt").value));
      if (!ok) return toast("Недостаточно средств или неверная сумма");
      closeOverlay();
      render();
      toast("Сумма переведена");
    }));
    $("#trBack")?.addEventListener("click", debounceClick(() => {
      const amt = Number($("#trAmt").value) || card.balance || 0;
      const ok = transfer(tab, id, "__pool__", amt);
      if (!ok) return toast("Недостаточно средств на карточке");
      closeOverlay();
      render();
      toast("Вернули на баланс вкладки");
    }));
    $("#trEdit").onclick = () => sheetCard(tab, card);
  }

  function sheetSettings() {
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>Настройки</h3>
        <div class="field"><label>Дневной лимит, ₽</label><input id="sLim" type="number" value="${state.settings.dailyLimit}" /></div>
        <div class="field"><label>PIN вкладки «Прочее» (4 цифры, пусто — без пароля)</label>
          <input id="sPin" inputmode="numeric" maxlength="4" placeholder="${state.settings.pin ? "••••" : "не задан"}" />
        </div>
        <div class="field"><label>Категории трат (где потрачено)</label>
          <div class="items" id="sCats"></div>
          <button class="add-card" id="sAddCat" style="margin-top:8px">+ Категория трат</button>
        </div>
        <div class="field"><label>Категории товаров</label>
          <div class="items" id="sProds"></div>
          <button class="add-card" id="sAddProd" style="margin-top:8px">+ Категория товара</button>
        </div>
        <button class="btn btn-gold btn-block" id="sSave">Сохранить</button>
        <div class="row-btns" style="margin-top:8px">
          <button class="btn btn-ghost" id="sExport">Выгрузить JSON</button>
          <button class="btn btn-ghost" id="sImport">Загрузить JSON</button>
        </div>
        <input id="sImportFile" type="file" accept="application/json,.json" class="hidden" />
        <button class="btn btn-ghost btn-block" id="sReset" style="margin-top:8px">Сбросить всё</button>
      </div>`);
    const bindList = (box, values) => {
      const add = (v = "") => {
        const r = document.createElement("div");
        r.className = "item-row";
        r.style.gridTemplateColumns = "1fr 36px";
        r.innerHTML = `<input class="nm" value="${esc(v)}" /><button class="x">×</button>`;
        r.querySelector(".x").onclick = () => r.remove();
        box.appendChild(r);
      };
      values.forEach(add);
      return add;
    };
    const addCat = bindList($("#sCats"), state.settings.categories || DEFAULT_CATS);
    const addProd = bindList($("#sProds"), state.settings.productCategories || DEFAULT_PRODUCTS);
    $("#sAddCat").onclick = () => addCat("");
    $("#sAddProd").onclick = () => addProd("");
    $("#sSave").onclick = debounceClick(() => {
      const lim = Number($("#sLim").value);
      if (!lim || lim < 0) return toast("Лимит должен быть больше 0");
      const pin = $("#sPin").value.trim();
      if (pin && !/^\d{4}$/.test(pin)) return toast("PIN — ровно 4 цифры");
      state.settings.dailyLimit = lim;
      if (pin) state.settings.pin = pin;
      if (!pin && !$("#sPin").placeholder.includes("•") === false) { /* keep old if placeholder */ }
      if (pin === "" && !state.settings.pin) state.settings.pin = "";
      if (pin) {
        state.settings.pin = pin;
        sessionStorage.removeItem(SESSION_PIN);
      }
      const cats = $$("#sCats .nm").map((i) => i.value.trim()).filter(Boolean);
      const prods = $$("#sProds .nm").map((i) => i.value.trim()).filter(Boolean);
      if (cats.length) state.settings.categories = cats;
      if (prods.length) state.settings.productCategories = prods;
      const oldBase = Number($("#sLim").getAttribute("value")) || state.settings.dailyLimit;
      const carry = state.daily.limitToday - oldBase;
      state.daily.limitToday = lim + carry;
      save();
      closeOverlay();
      render();
      toast("Настройки сохранены");
    });
    $("#sReset").onclick = () => confirmDlg("Сбросить данные?", "Все записи и карточки будут удалены.", () => {
      state = blank();
      save();
      closeOverlay();
      render();
    });
    $("#sExport").onclick = debounceClick(exportBackup);
    $("#sImport").onclick = () => $("#sImportFile").click();
    $("#sImportFile").onchange = () => {
      const file = $("#sImportFile").files && $("#sImportFile").files[0];
      $("#sImportFile").value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || typeof data !== "object" || !data.settings) {
            toast("Это не резервная копия ЛИМИТ");
            return;
          }
          confirmDlg("Загрузить копию?", "Текущие данные будут заменены файлом.", () => {
            applyBackup(data);
            closeOverlay();
            render();
            toast("Данные восстановлены");
          }, "Загрузить");
        } catch {
          toast("Файл повреждён или это не JSON");
        }
      };
      reader.readAsText(file, "utf-8");
    };
  }

  function exportBackup() {
    const payload = {
      app: "ЛИМИТ",
      version: 2,
      exportedAt: new Date().toISOString(),
      data: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `limit-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast("Файл копии скачан");
  }

  function applyBackup(payload) {
    const raw = payload.data && payload.data.settings ? payload.data : payload;
    const b = blank();
    state = {
      ...b,
      ...raw,
      settings: { ...b.settings, ...(raw.settings || {}) },
      daily: { ...b.daily, ...(raw.daily || {}) },
      month: { ...b.month, ...(raw.month || {}) },
      cards: {
        must: raw.cards?.must || [],
        piggy: raw.cards?.piggy || [],
        debt: raw.cards?.debt || [],
      },
      transactions: raw.transactions || [],
      allocations: raw.allocations || [],
      dailyLog: raw.dailyLog || {},
      unallocated: raw.unallocated || 0,
      otherPool: raw.otherPool || 0,
    };
    if (!state.settings.productCategories?.length) {
      state.settings.productCategories = [...DEFAULT_PRODUCTS];
    }
    save();
    rollCalendar();
  }

  /* ---------- pin ---------- */
  function askPin(onOk) {
    let buf = "";
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <div class="pin-box">
          <h3>Код доступа</h3>
          <p style="color:var(--text-dim);font-size:13px">Вкладка «Прочее»</p>
          <div class="pin-dots">${"<i></i>".repeat(4)}</div>
          <div class="pad">
            ${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((n) => `<button data-n="${n}">${n}</button>`).join("")}
          </div>
        </div>
      </div>`);
    const dots = $$(".pin-dots i");
    const draw = () => dots.forEach((d, i) => d.classList.toggle("on", i < buf.length));
    $$(".pad button").forEach((b) => {
      b.onclick = () => {
        const n = b.dataset.n;
        if (n === "") return;
        if (n === "⌫") buf = buf.slice(0, -1);
        else if (buf.length < 4) buf += n;
        draw();
        if (buf.length === 4) {
          if (buf === state.settings.pin) {
            closeOverlay();
            onOk();
          } else {
            buf = "";
            draw();
            toast("Неверный код");
          }
        }
      };
    });
  }

  /* ---------- nav ---------- */
  function applyTab(name) {
    currentTab = name;
    $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    if (name === "stats") renderStats();
  }

  function showTab(name) {
    if (name === "other" && name !== currentTab && state.settings.pin) {
      askPin(() => applyTab("other"));
      return;
    }
    applyTab(name);
  }

  /* ---------- first run ---------- */
  function onboard() {
    if (state.settings.onboarded) return;
    openOverlay(`
      <div class="sheet">
        <div class="grab"></div>
        <h3>Дневной лимит</h3>
        <p style="color:var(--text-dim);font-size:14px;margin-bottom:14px">Сколько можно тратить в день. При зарплате эта сумма умножается на число дней месяца и резервируется на Главной.</p>
        <div class="field"><label>Лимит, ₽</label><input id="obLim" type="number" value="500" /></div>
        <div class="field"><label>PIN для вкладки «Прочее» (необязательно)</label><input id="obPin" inputmode="numeric" maxlength="4" placeholder="4 цифры" /></div>
        <button class="btn btn-gold btn-block" id="obGo">Начать</button>
      </div>`);
    $("#obGo").onclick = debounceClick(() => {
      const lim = Number($("#obLim").value) || 500;
      const pin = $("#obPin").value.trim();
      if (pin && !/^\d{4}$/.test(pin)) return toast("PIN — 4 цифры");
      state.settings.dailyLimit = lim;
      state.settings.pin = pin || "";
      state.settings.onboarded = true;
      state.daily.limitToday = lim;
      const [y, m] = todayISO().split("-").map(Number);
      state.month.allocated = lim * daysInMonth(y, m);
      save();
      closeOverlay();
      render();
    });
  }

  /* ---------- boot ---------- */
  function preventZoom() {
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    let last = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - last < 280) e.preventDefault();
      last = now;
    }, { passive: false });
  }

  $$(".tab").forEach((t) => {
    t.addEventListener("click", debounceClick(() => showTab(t.dataset.tab)));
  });
  $("#btnSettings").onclick = debounceClick(sheetSettings);

  preventZoom();
  rollCalendar();
  render();
  onboard();
})();
