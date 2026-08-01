/* ============================================================
   BOOM & BUST — ui.js
   Startbildschirm · HUD · Dialoge · Auktion · Wahl · Auswertung
   ============================================================ */
'use strict';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(1) + ' %';

const UI = {
  cfg: { players: [], maxRounds: 12, familyMode: true, seatFlip: true, tableMode: false, auctions: true },
  logLines: [],

  /* ============================================================ START */
  initSetup() {
    const n = 3;
    this.cfg.players = [];
    for (let i = 0; i < n; i++) this.addSetupPlayer();
    this.renderSetup();

    $('#addP').onclick = () => { if (this.cfg.players.length < 8) { this.addSetupPlayer(); this.renderSetup(); } };
    $('#startBtn').onclick = () => this.launch();
    $('#langBtn').onclick = () => {
      LANG = LANG === 'de' ? 'en' : 'de';
      $('#langBtn').textContent = LANG === 'de' ? '🇩🇪 DE' : '🇬🇧 EN';
      this.renderSetup(); this.applyStaticText();
    };
    document.querySelectorAll('#lenRow .seg').forEach(b => b.onclick = () => {
      document.querySelectorAll('#lenRow .seg').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); this.cfg.maxRounds = +b.dataset.r;
    });
    $('#optFamily').onchange = e => this.cfg.familyMode = e.target.checked;
    $('#optSeat').onchange = e => this.cfg.seatFlip = e.target.checked;
    $('#optTable').onchange = e => this.cfg.tableMode = e.target.checked;
    $('#optAuction').onchange = e => this.cfg.auctions = e.target.checked;
    this.applyStaticText();
  },

  addSetupPlayer() {
    const used = this.cfg.players.map(p => p.charId);
    const free = CHARACTERS.find(c => !used.includes(c.id)) || CHARACTERS[0];
    const i = this.cfg.players.length;
    const defNames = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Finn', 'Greta', 'Hugo'];
    this.cfg.players.push({ name: defNames[i] || ('P' + (i + 1)), charId: free.id });
  },

  renderSetup() {
    const wrap = $('#pRows'); wrap.innerHTML = '';
    this.cfg.players.forEach((p, i) => {
      const c = CHARACTERS.find(x => x.id === p.charId);
      const row = el('div', 'prow');
      row.style.borderColor = c.color;
      row.innerHTML = `
        <div class="pnum" style="background:${c.color}">${i + 1}</div>
        <input class="pname" value="${p.name.replace(/"/g, '&quot;')}" maxlength="12">
        <div class="charpick">
          <button class="arw" data-d="-1">◀</button>
          <div class="charbox">
            <div class="cicon">${c.icon}</div>
            <div class="cinfo">
              <b style="color:${c.color}">${tx(c)}</b>
              <span>💰 ${eur(c.cash)} · 💼 ${eur(c.salary)} · 🎓 ${c.edu}${c.debt ? ' · 🔻 ' + eur(c.debt) : ''}</span>
              <em class="perk">✔ ${tx(c.perk)}</em>
              <em class="flaw">✖ ${tx(c.flaw)}</em>
            </div>
          </div>
          <button class="arw" data-d="1">▶</button>
        </div>
        <button class="rm" title="remove">✕</button>`;
      row.querySelector('.pname').oninput = e => p.name = e.target.value || ('P' + (i + 1));
      row.querySelectorAll('.arw').forEach(b => b.onclick = () => {
        const d = +b.dataset.d;
        let k = CHARACTERS.findIndex(x => x.id === p.charId);
        for (let s = 0; s < 8; s++) {
          k = (k + d + 8) % 8;
          const cand = CHARACTERS[k];
          if (!this.cfg.players.some(q => q !== p && q.charId === cand.id)) { p.charId = cand.id; break; }
        }
        this.renderSetup();
      });
      row.querySelector('.rm').onclick = () => {
        if (this.cfg.players.length <= 2) return;
        this.cfg.players.splice(i, 1); this.renderSetup();
      };
      row.querySelector('.rm').style.visibility = this.cfg.players.length > 2 ? 'visible' : 'hidden';
      wrap.appendChild(row);
    });
    $('#addP').style.display = this.cfg.players.length < 8 ? '' : 'none';
    $('#pCount').textContent = this.cfg.players.length;
  },

  applyStaticText() {
    const set = (sel, key) => { const e = $(sel); if (e) e.textContent = t(key); };
    set('#sTitle', 'title'); set('#sSub', 'subtitle');
    set('#addP', 'addPlayer'); set('#startBtn', 'start');
    set('#lblLen', 'length'); set('#lblFamily', 'family'); set('#hintFamily', 'familyHint');
    set('#lblSeat', 'seatFlip'); set('#hintSeat', 'seatHint');
    $('#segShort').textContent = t('short'); $('#segNorm').textContent = t('normal'); $('#segLong').textContent = t('long');
    $('#lblPlayers').textContent = t('players');
    $('#lblTable').textContent = LANG === 'de' ? 'Tisch-Modus (Oberfläche mitdrehen)' : 'Table mode (rotate the interface too)';
    $('#lblAuc').textContent = LANG === 'de' ? 'Auktionen' : 'Auctions';
    $('#hintAuc').textContent = LANG === 'de' ? 'Verzicht = alle dürfen bieten' : 'Declining lets everyone bid';
    $('#btnRoll').textContent = '🎲 ' + t('roll');
    $('#btnEnd').textContent = t('endTurn') + ' ▶';
  },

  launch() {
    $('#setup').classList.add('hide');
    setTimeout(() => { $('#setup').style.display = 'none'; }, 420);
    Scene.init($('#c'));
    /* Zuerst binden — Game.start() feuert sofort den ersten Zug. */
    this.bind();
    Bus.on('start', g => { Scene.addPlayers(g.players); Scene.setOverview(); });
    Game.start({ ...this.cfg });
    this.renderAll();
  },

  /* Schnellstart für Demos und Tests: ?demo=6 */
  demo(n) {
    const names = ['Anna', 'Ben', 'Clara', 'David', 'Emma', 'Finn', 'Greta', 'Hugo'];
    this.cfg.players = [];
    for (let i = 0; i < n; i++) this.cfg.players.push({ name: names[i], charId: CHARACTERS[i].id });
    this.launch();
  },

  /* ============================================================ DEMO-BOT
     Spielt selbständig mit einfachen, aber vernünftigen Faustregeln.
     Gedacht zum Zuschauen und Regeln-Lernen — und zum Testen der Balance. */
  botOn: false,
  toggleBot() {
    this.botOn = !this.botOn;
    const b = $('#btnBot');
    if (b) { b.textContent = this.botOn ? '⏸️' : '🤖'; b.title = this.botOn ? 'Demo stoppen' : 'Demo ansehen'; }
    if (this.botOn && !this._bot) this._bot = setInterval(() => this.botStep(), 420);
    if (!this.botOn && this._bot) { clearInterval(this._bot); this._bot = null; }
  },

  botStep() {
    if (!this.botOn || Game.over) return;
    const p = Game.p(), m = $('#modal');
    if (m.classList.contains('show')) {
      const cards = [...m.querySelectorAll('.polcard')];
      if (cards.length) { cards[(Math.random() * cards.length) | 0].click(); return; }
      const btns = [...m.querySelectorAll('.mbtns button:not([disabled])')];
      if (!btns.length) return;
      const by = id => btns.find(b => b.dataset.id === id);
      const cash = p.cash;
      /* Kaufen, wenn danach noch ein Polster bleibt */
      const buy = by('buy');
      if (buy && cash > 1400) { buy.click(); return; }
      /* Ausbauen nur bei guter Rendite (steht im Dialogtext) */
      const up = by('up');
      if (up && cash > 2000 && /(\d+)\s?%\s?(pro Jahr|per year)/.test(m.textContent)) {
        const r = +/(\d+)\s?%\s?(?:pro Jahr|per year)/.exec(m.textContent)[1];
        if (r >= 16) { up.click(); return; }
      }
      /* Bieten, solange es günstig bleibt */
      const bid = by('bid');
      if (bid && cash > 1600 && Math.random() < .55) { bid.click(); return; }
      /* Sonst: erste Wahlmöglichkeit, sonst Abschluss */
      const num = btns.find(b => /^\d$/.test(b.dataset.id));
      if (num) { (Math.random() < .6 ? num : btns[Math.min(1, btns.length - 1)]).click(); return; }
      (by('ok') || by('pass') || btns[btns.length - 1]).click();
      return;
    }
    const roll = $('#btnRoll'), end = $('#btnEnd');
    if (!end.disabled && Math.random() < .18) {
      /* gelegentlich investieren statt nur würfeln */
      if (p.cash > 3000 && Math.random() < .5) { Game.donate(p, 250); this.renderAll(); return; }
    }
    if (!roll.disabled) roll.click();
    else if (!end.disabled) end.click();
  },

  /* ============================================================ HUD */
  bind() {
    Bus.on('turn', p => this.onTurn(p));
    Bus.on('update', () => this.renderAll());
    Bus.on('macro', () => this.renderEcon());
    Bus.on('log', m => this.pushLog(m));
    Bus.on('learn', m => this.pushLog(m, true));
    Bus.on('canRoll', v => { $('#btnRoll').disabled = !v; if (v) $('#btnRoll').classList.add('pulse'); else $('#btnRoll').classList.remove('pulse'); });
    Bus.on('canEnd', v => { $('#btnEnd').disabled = !v; if (v) $('#btnEnd').classList.add('pulse'); else $('#btnEnd').classList.remove('pulse'); });
    Bus.on('dice', d => this.renderDice(d));
    Bus.on('cardflash', k => this.cardFx(k));
    Bus.on('seat', s => this.applySeat(s));
    Bus.on('income', d => {
      this.renderPlayers();
      const card = $('#plist').children[d.p.idx];
      if (!card) return;
      const f = el('div', 'flyup', (d.net >= 0 ? '+' : '') + eur(d.net));
      card.appendChild(f);
      setTimeout(() => f.remove(), 1500);
    });

    $('#btnRoll').onclick = () => Game.roll();
    $('#btnEnd').onclick = () => Game.endTurn();
    $('#btnPort').onclick = () => this.portfolio(Game.p());
    $('#btnBank').onclick = () => this.bankPanel(Game.p());
    $('#btnStock').onclick = () => this.stockPanel(Game.p());
    $('#btnGive').onclick = () => this.donatePanel(Game.p());
    $('#btnBot').onclick = () => this.toggleBot();
    $('#btnHelp').onclick = () => this.help();
    const speeds = [1, 1.5, 2, 3];
    $('#btnSpeed').onclick = () => {
      const i = (speeds.indexOf(Scene.getSpeed()) + 1) % speeds.length;
      Scene.setSpeed(speeds[i]);
      $('#btnSpeed').textContent = '⏩' + speeds[i] + '×';
    };
    $('#logTab').onclick = () => $('#logPanel').classList.toggle('open');
    $('#hud').classList.remove('hide');
  },

  onTurn(p) {
    const b = $('#turnBanner');
    b.innerHTML = `<span class="ticon">${p.icon}</span><b style="color:${p.color}">${p.name}</b> <span class="dim">${t('yourTurn')}</span>`;
    b.style.setProperty('--pc', p.color);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    document.body.style.setProperty('--turncol', p.color);
    $('#dice').innerHTML = '';
    this.renderAll();
  },

  applySeat(s) {
    if (!UI.cfg.tableMode) { $('#hud').style.transform = ''; return; }
    const snap = Math.round(s.deg / 90) * 90;
    $('#hud').style.transform = `rotate(${snap}deg)`;
  },

  renderAll() { this.renderEcon(); this.renderPlayers(); },

  renderEcon() {
    const E = Econ;
    const cell = (icon, label, val, col, hint) =>
      `<div class="ecell" title="${hint || ''}"><span class="ei">${icon}</span>
        <span class="el">${label}</span><b style="color:${col || '#e9eef5'}">${val}</b></div>`;
    const growthCol = E.growth >= 1.5 ? '#7ee081' : E.growth < 0 ? '#ff6b6b' : '#ffd166';
    const infCol = E.inflation > 5 ? '#ff6b6b' : E.inflation > 3 ? '#ffb03a' : '#7ee081';
    $('#econbar').innerHTML =
      `<div class="phasebox" style="--pc:${E.phaseColor()}">
         <span class="pi">${E.phaseIcon()}</span>
         <div><b>${t(E.phase)}</b><small>${tx(E.mood())}</small></div>
       </div>` +
      cell('📈', t('growth'), pct(E.growth), growthCol) +
      cell('🔥', t('inflation'), pct(E.inflation), infCol) +
      cell('🏛️', t('rate'), E.rate.toFixed(1) + ' %', '#5ec8ff') +
      cell('👷', t('unemp'), E.unemp.toFixed(1) + ' %', E.unemp > 8 ? '#ff6b6b' : '#e9eef5') +
      cell('📊', t('market'), Math.round(E.market), E.market >= 100 ? '#7ee081' : '#ff8a5c') +
      cell('🧾', t('tax'), E.tax + ' %') +
      cell('🏛', t('fund'), eur(E.fund), '#ffd166') +
      `<div class="ecell round"><span class="el">${t('year')} ${Game.year} · Q${Game.quarter}</span>
        <b>${t('round')} ${Game.round}/${Game.maxRounds}</b></div>`;
    /* Sektorleiste */
    $('#sectorbar').innerHTML = SECTOR_KEYS.map(k => {
      const h = Econ.sector[k], w = Math.round(Math.min(100, h / 2.2 * 100));
      const c = h > 1.15 ? '#7ee081' : h < .85 ? '#ff6b6b' : '#ffd166';
      return `<div class="sbar" title="${secName(k)} — ${(h * 100).toFixed(0)} %">
        <span>${SECTORS[k].icon}</span>
        <div class="strack"><i style="width:${w}%;background:${c}"></i></div></div>`;
    }).join('');
  },

  renderPlayers() {
    const wrap = $('#plist'); wrap.innerHTML = '';
    const maxScore = Math.max(1, ...Game.players.map(p => p.lifeScore()));
    Game.players.forEach(p => {
      const act = p === Game.p();
      const c = el('div', 'pcard' + (act ? ' active' : ''));
      c.style.setProperty('--pc', p.color);
      const mono = Game.monopolies(p);
      c.innerHTML = `
        <div class="ptop"><span class="pic">${p.icon}</span>
          <b>${p.name}</b>
          ${p.redTape ? '<span class="tagx">📋</span>' : ''}
          ${mono.length ? `<span class="tagx" title="${t('monopoly')}">👑</span>` : ''}
          <span class="score">${p.lifeScore()}</span></div>
        <div class="pbar"><i style="width:${Math.round(p.lifeScore() / maxScore * 100)}%"></i></div>
        <div class="pstats">
          <span title="${t('cash')}">💵 ${eur(p.cash)}</span>
          ${p.debt > 0 ? `<span class="bad" title="${t('debt')}">🔻 ${eur(p.debt)}</span>` : ''}
          ${p.savings > 0 ? `<span title="${t('save')}">🏦 ${eur(p.savings)}</span>` : ''}
          <span title="${t('salary')}">💼 ${eur(p.salary)}</span>
          <span title="${t('edu')}">🎓 ${p.edu}</span>
          <span title="${t('joy')}">😊 ${p.joy}</span>
          <span title="${t('comm')}">🤝 ${p.comm}</span>
          ${p.kids ? `<span title="${t('kids')}">🧒 ${p.kids}</span>` : ''}
          <span title="${t('portfolio')}">🏢 ${p.assets().length}</span>
        </div>`;
      c.onclick = () => this.portfolio(p);
      wrap.appendChild(c);
    });
  },

  renderDice(d) {
    const box = $('#dice');
    if (d.rolling) { box.innerHTML = `<div class="die spin">🎲</div><div class="die spin">🎲</div>`; return; }
    if (!d.vals) return;
    const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    box.innerHTML = d.vals.map(v => `<div class="die">${faces[v]}</div>`).join('') +
      (d.vals.length > 1 ? `<div class="dsum">= ${d.vals[0] + d.vals[1]}${d.vals[0] === d.vals[1] ? ' ⭐' : ''}</div>` : '');
  },

  pushLog(m, learn) {
    this.logLines.unshift({ ...m, learn });
    if (this.logLines.length > 60) this.logLines.pop();
    $('#logBody').innerHTML = this.logLines.map(l =>
      `<div class="lline${l.learn ? ' learn' : ''}"><span>${l.icon}</span><p>${l.txt}</p></div>`).join('');
    if (learn) {
      const t2 = $('#toast');
      t2.innerHTML = `<span>${m.icon}</span><p>${m.txt}</p>`;
      t2.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(() => t2.classList.remove('show'), 6500);
    }
  },

  cardFx(kind) {
    const f = $('#cardFx');
    f.className = 'cardfx ' + kind + ' go';
    f.innerHTML = kind === 'mikro'
      ? `<span>🎲</span><b>${LANG === 'de' ? 'ALLTAG' : 'EVERYDAY'}</b><small>${LANG === 'de' ? 'Mikroökonomie' : 'Microeconomics'}</small>`
      : `<span>🌍</span><b>${LANG === 'de' ? 'WELTLAGE' : 'WORLD NEWS'}</b><small>${LANG === 'de' ? 'Makroökonomie' : 'Macroeconomics'}</small>`;
    setTimeout(() => f.classList.remove('go'), 900);
  },

  /* ============================================================ DIALOG */
  modal(spec) {
    return new Promise(resolve => {
      const ov = $('#modal'), card = $('#modalCard');
      card.style.setProperty('--mc', spec.color || '#5ec8ff');
      let h = '';
      h += `<div class="mhead"><span class="micon">${spec.icon || '•'}</span>
              <div><h2>${tx(spec.title)}</h2>${spec.sub ? `<h4>${tx(spec.sub)}</h4>` : ''}</div></div>`;
      if (spec.big) h += `<div class="mbig">${spec.big}</div>`;
      if (spec.body) h += `<p class="mbody">${tx(spec.body)}</p>`;
      if (spec.list && spec.list.length) h += `<ul class="mlist">${spec.list.map(x => `<li>${tx(x)}</li>`).join('')}</ul>`;
      if (spec.html) h += spec.html;
      if (spec.tip) h += `<div class="mtip"><b>💡 ${t('tip')}</b><span>${tx(spec.tip)}</span></div>`;
      h += `<div class="mbtns">${(spec.buttons || [{ id: 'ok', label: STR.ok, primary: true }])
        .map(b => `<button data-id="${b.id}" class="btn${b.primary ? ' primary' : ''}"${b.disabled ? ' disabled' : ''}>${tx(b.label)}</button>`).join('')}</div>`;
      card.innerHTML = h;
      card.className = 'mcard ' + (spec.kind || '');
      ov.classList.add('show');
      let done = false;
      const finish = (id) => {
        if (done) return; done = true;
        ov.classList.remove('show');
        this._resolve = null;
        if (spec.onClose) spec.onClose();
        resolve(id);
      };
      /* Auch klickbare Karten (Wahl, Auswahl) können auflösen */
      this._resolve = finish;
      card.querySelectorAll('.mbtns button').forEach(b => b.onclick = () => finish(b.dataset.id));
      if (spec.after) spec.after(card);
    });
  },

  /* Von Karten-Klicks innerhalb eines Dialogs aufgerufen */
  resolveModal(id) { if (this._resolve) this._resolve(id); },

  /* ============================================================ BESITZ */
  async assetPanel(p, idx) {
    const tile = BOARD[idx], a = Game.assetAt(idx);
    const roi = Econ.upgradeROI(a, tile, p, Game);
    const rentNow = Econ.rentOf(tile, a, p, Game);
    const inSec = Game.ownedInSector(tile.sector);
    const list = [
      { de: `Stufe: ${tx(UPGRADE_NAME[a.level])} (${a.level}/4)`, en: `Level: ${tx(UPGRADE_NAME[a.level])} (${a.level}/4)` },
      { de: `Miete jetzt: <b>${eur(rentNow)}</b>`, en: `Rent now: <b>${eur(rentNow)}</b>` },
      { de: `Sektorlage: ×${Econ.sector[tile.sector].toFixed(2)} · Wettbewerb: ${inSec} Betriebe`,
        en: `Sector health: ×${Econ.sector[tile.sector].toFixed(2)} · competition: ${inSec} businesses` },
    ];
    if (roi) {
      list.push({
        de: `Ausbau auf ${tx(UPGRADE_NAME[a.level + 1])}: ${eur(roi.cost)} → Miete +${eur(roi.gain)}`,
        en: `Upgrade to ${tx(UPGRADE_NAME[a.level + 1])}: ${eur(roi.cost)} → rent +${eur(roi.gain)}`,
      });
      const col = roi.pct > 18 ? '#7ee081' : roi.pct > 10 ? '#ffd166' : '#ff8a5c';
      list.push({
        de: `<b style="color:${col}">${t('roi')}: ${roi.pct.toFixed(0)} % pro Jahr</b>`,
        en: `<b style="color:${col}">${t('roi')}: ${roi.pct.toFixed(0)}% per year</b>`,
      });
    }
    const btns = [];
    if (roi) btns.push({ id: 'up', label: { de: `${t('upgrade')} (${eur(roi.cost)})`, en: `${t('upgrade')} (${eur(roi.cost)})` }, primary: true, disabled: p.cash < roi.cost });
    btns.push({ id: 'sell', label: { de: t('sell'), en: t('sell') } });
    btns.push({ id: 'ok', label: STR.close });
    const res = await this.modal({
      icon: SECTORS[tile.sector].icon, color: SECTORS[tile.sector].css,
      title: tile, sub: { de: secName(tile.sector), en: secName(tile.sector) },
      list, kind: 'own',
      tip: a.level >= 2
        ? { de: 'Jede weitere Stufe kostet mehr und bringt anteilig weniger — irgendwann lohnt ein zweiter Betrieb mehr als der fünfte Ausbau.',
            en: 'Each further level costs more and adds proportionally less — at some point a second business beats a fifth upgrade.' }
        : { de: 'Ausbauen erhöht die Miete. Vergleiche die Rendite immer mit dem Zinssatz deines Kredits!',
            en: 'Upgrading raises rent. Always compare the return with the interest rate on your loan!' },
      buttons: btns,
    });
    if (res === 'up') { Game.upgradeAsset(p, idx); return this.assetPanel(p, idx); }
    if (res === 'sell') {
      const conf = await this.modal({
        icon: '💸', title: { de: 'Wirklich verkaufen?', en: 'Really sell?' },
        body: Econ.phase === 'RECESSION'
          ? { de: 'In der Rezession bekommst du nur etwa die Hälfte des Werts.', en: 'In a recession you only get about half the value.' }
          : { de: 'Du bekommst weniger als den Marktwert — Verkaufen kostet immer etwas.', en: 'You get less than market value — selling always costs something.' },
        buttons: [{ id: 'y', label: { de: 'Verkaufen', en: 'Sell' }, primary: true }, { id: 'n', label: STR.close }],
      });
      if (conf === 'y') Game.sellAsset(p, idx);
    }
  },

  async portfolio(p) {
    const as = p.assets();
    const rows = as.map(a => {
      const tile = BOARD[a.idx];
      return `<tr><td>${SECTORS[tile.sector].icon} ${tx(tile)}</td>
        <td>${tx(UPGRADE_NAME[a.level])}</td>
        <td class="r">${eur(Econ.rentOf(tile, a, p, Game))}</td>
        <td class="r"><button class="mini" data-i="${a.idx}">${t('upgrade')}</button></td></tr>`;
    }).join('');
    const stockRows = Object.keys(p.stocks).filter(k => p.stocks[k] > 0).map(k =>
      `<tr><td>${SECTORS[k].icon} ${secName(k)}</td><td>${p.stocks[k]} ×</td>
        <td class="r">${eur(Econ.stockPrice(k) * p.stocks[k])}</td><td></td></tr>`).join('');
    const parts = p.scoreParts().map(s =>
      `<li>${t(s.k)}: <b>${s.v}</b> <small>(${s.raw})</small></li>`).join('');
    await this.modal({
      icon: p.icon, color: p.color, title: { de: p.name, en: p.name },
      sub: { de: tx(p.char), en: tx(p.char) },
      html: `<div class="pf">
        <div class="pfcol"><h5>${t('portfolio')} (${as.length})</h5>
          <table class="tbl">${rows || `<tr><td class="dim">—</td></tr>`}</table>
          ${stockRows ? `<h5>${t('stocks')}</h5><table class="tbl">${stockRows}</table>` : ''}</div>
        <div class="pfcol"><h5>${t('lifeScore')}: ${p.lifeScore()}</h5>
          <ul class="sl">${parts}</ul>
          <h5>${t('netWorth')}</h5>
          <ul class="sl">
            <li>${t('cash')}: <b>${eur(p.cash)}</b></li>
            <li>${t('save')}: <b>${eur(p.savings)}</b></li>
            <li>${t('portfolio')}: <b>${eur(p.assetValue())}</b></li>
            <li>${t('stocks')}: <b>${eur(p.stockValue())}</b></li>
            <li class="bad">${t('debt')}: <b>−${eur(p.debt)}</b></li>
          </ul></div></div>`,
      tip: { de: 'Vermögen ist nur ein Teil der Lebenspunkte. Bildung, Freude und Gemeinwohl zählen genauso.',
             en: 'Net worth is only part of your life score. Education, joy and community count just as much.' },
      buttons: [{ id: 'ok', label: STR.close, primary: true }],
      after: (card) => {
        card.querySelectorAll('.mini').forEach(b => b.onclick = async () => {
          $('#modal').classList.remove('show');
          await this.assetPanel(p, +b.dataset.i);
        });
      },
    });
  },

  /* ============================================================ BANK */
  async bankPanel(p) {
    const rate = Econ.loanRate(p), sRate = Econ.savingsRate(), max = Econ.maxLoan(p);
    const res = await this.modal({
      icon: '🏦', color: '#ffd166', title: { de: 'Bank', en: 'Bank' },
      list: [
        { de: `Kreditzins für dich: <b>${rate} %</b> pro Jahr`, en: `Your loan rate: <b>${rate}%</b> per year` },
        { de: `Sparzins: <b>${sRate} %</b>`, en: `Savings rate: <b>${sRate}%</b>` },
        { de: `Freier Kreditrahmen: ${eur(max)}`, en: `Available credit: ${eur(max)}` },
        { de: `Deine Schulden: ${eur(p.debt)} · Erspartes: ${eur(p.savings)}`, en: `Your debt: ${eur(p.debt)} · savings: ${eur(p.savings)}` },
      ],
      tip: { de: `Der Leitzins der Zentralbank liegt bei ${Econ.rate.toFixed(1)} %. Deshalb kostet dein Kredit ${rate} % — Makro landet direkt auf deinem Konto.`,
             en: `The central bank rate is ${Econ.rate.toFixed(1)}%. That is why your loan costs ${rate}% — macro lands straight in your account.` },
      buttons: [
        { id: 'loan', label: { de: `${t('loan')} +${eur(Math.min(max, 1000))}`, en: `${t('loan')} +${eur(Math.min(max, 1000))}` }, primary: true, disabled: max < 100 },
        { id: 'repay', label: { de: `${t('repay')} ${eur(Math.min(p.cash, p.debt, 1000))}`, en: `${t('repay')} ${eur(Math.min(p.cash, p.debt, 1000))}` }, disabled: p.debt <= 0 || p.cash <= 0 },
        { id: 'save', label: { de: `${t('save')} ${eur(Math.min(p.cash, 1000))}`, en: `${t('save')} ${eur(Math.min(p.cash, 1000))}` }, disabled: p.cash < 100 },
        { id: 'wd', label: { de: `Abheben ${eur(Math.min(p.savings, 1000))}`, en: `Withdraw ${eur(Math.min(p.savings, 1000))}` }, disabled: p.savings <= 0 },
        { id: 'ok', label: STR.close },
      ],
    });
    if (res === 'loan') { Game.takeLoan(p, Math.min(max, 1000)); return this.bankPanel(p); }
    if (res === 'repay') { Game.repay(p, Math.min(p.cash, p.debt, 1000)); return this.bankPanel(p); }
    if (res === 'save') { Game.deposit(p, Math.min(p.cash, 1000)); return this.bankPanel(p); }
    if (res === 'wd') { Game.withdraw(p, Math.min(p.savings, 1000)); return this.bankPanel(p); }
  },

  /* ============================================================ SPENDEN */
  async donatePanel(p) {
    const step = Math.round(250 * Econ.priceLevel / 10) * 10;
    const opts = [1, 2, 4].map(k => step * k);
    const res = await this.modal({
      icon: '🤝', color: '#7ee081', title: { de: 'Gemeinwohl stärken', en: 'Strengthen the community' },
      body: { de: `Du kannst Geld in den Gemeinschaftstopf geben. Das kostet Vermögen, bringt dir Lebenspunkte — und finanziert Krisenhilfe für alle.`,
              en: `You can put money into the common fund. It costs net worth, earns you life points — and funds crisis aid for everyone.` },
      list: [
        { de: `Im Topf: <b>${eur(Econ.fund)}</b>`, en: `In the fund: <b>${eur(Econ.fund)}</b>` },
        { de: `Dein Bargeld: ${eur(p.cash)} · dein Gemeinwohl: ${p.comm}`, en: `Your cash: ${eur(p.cash)} · your community: ${p.comm}` },
        { de: `Je ${eur(step)} gibt es +1 Gemeinwohl (7 Lebenspunkte) und +1 Freude.`, en: `Every ${eur(step)} gives +1 community (7 life points) and +1 joy.` },
      ],
      tip: { de: 'Wer nichts gibt, profitiert trotzdem vom Topf. Deshalb sind freiwillige Beiträge fast immer zu niedrig — und deshalb gibt es Steuern.',
             en: 'Those who give nothing still benefit from the fund. That is why voluntary contributions are almost always too low — and why taxes exist.' },
      buttons: [
        ...opts.map((a, i) => ({ id: 'd' + i, label: { de: `${eur(a)} spenden`, en: `Donate ${eur(a)}` }, primary: i === 0, disabled: p.cash < a })),
        { id: 'ok', label: STR.close },
      ],
    });
    if (res && res[0] === 'd') { Game.donate(p, opts[+res[1]]); return this.donatePanel(p); }
  },

  /* ============================================================ BÖRSE */
  async stockPanel(p) {
    const held = Object.keys(p.stocks).filter(k => p.stocks[k] > 0).length;
    const rows = SECTOR_KEYS.map(k => {
      const pr = Econ.stockPrice(k), have = p.stocks[k] || 0;
      const trend = Econ.sector[k] > 1.1 ? '📈' : Econ.sector[k] < .9 ? '📉' : '▬';
      return `<tr><td>${SECTORS[k].icon} ${secName(k)}</td>
        <td>${trend} <b>${eur(pr)}</b></td>
        <td>${have} ×</td>
        <td class="r">
          <button class="mini buy" data-k="${k}" ${p.cash < pr ? 'disabled' : ''}>+1</button>
          <button class="mini buy5" data-k="${k}" ${p.cash < pr * 5 ? 'disabled' : ''}>+5</button>
          <button class="mini sell" data-k="${k}" ${!have ? 'disabled' : ''}>−1</button></td></tr>`;
    }).join('');
    await this.modal({
      icon: '📈', color: '#5ec8ff', title: { de: 'Börse', en: 'Stock Exchange' },
      sub: { de: `Index ${Math.round(Econ.market)} · ${t(Econ.phase)}`, en: `Index ${Math.round(Econ.market)} · ${t(Econ.phase)}` },
      html: `<table class="tbl stk">${rows}</table>
        <p class="dim sm">${LANG === 'de'
          ? `Depot-Wert: <b>${eur(p.stockValue())}</b> · Sektoren: ${held}/8${held >= 4 ? ' ✅ gut gestreut' : ''}`
          : `Portfolio value: <b>${eur(p.stockValue())}</b> · sectors: ${held}/8${held >= 4 ? ' ✅ well diversified' : ''}`}</p>`,
      tip: held >= 4
        ? { de: 'Gut gestreut! Ein Schock in einer Branche kann dich jetzt nicht mehr umwerfen.',
            en: 'Well diversified! A shock in one industry can no longer knock you over.' }
        : { de: 'Alles auf eine Branche zu setzen fühlt sich klug an, bis genau diese Branche eine schlechte Karte zieht.',
            en: 'Betting everything on one industry feels smart until exactly that industry draws a bad card.' },
      buttons: [{ id: 'ok', label: STR.close, primary: true }],
      after: (card) => {
        const refresh = () => { $('#modal').classList.remove('show'); this.stockPanel(p); };
        card.querySelectorAll('.buy').forEach(b => b.onclick = () => { Game.buyStock(p, b.dataset.k, 1); refresh(); });
        card.querySelectorAll('.buy5').forEach(b => b.onclick = () => { Game.buyStock(p, b.dataset.k, 5); refresh(); });
        card.querySelectorAll('.sell').forEach(b => b.onclick = () => { Game.sellStock(p, b.dataset.k, 1); refresh(); });
      },
    });
  },

  /* ============================================================ AUKTION */
  async auction(idx, bidders) {
    const tile = BOARD[idx];
    const market = Econ.priceOf(tile, null);
    let ask = Math.max(50, Math.round(market * 0.45 / 10) * 10);
    const inc = () => Math.max(50, Math.round(ask * 0.12 / 10) * 10);
    let leader = null, price = 0;
    const out = new Set();
    let ptr = 0, guard = 0;

    while (guard++ < 400) {
      const active = bidders.filter(b => !out.has(b.idx));
      if (!active.length) break;
      if (leader && active.length === 1 && active[0] === leader) break;
      if (active.every(b => b.cash < ask) && leader) break;
      if (active.every(b => b.cash < ask) && !leader) break;

      let b = null, tries = 0;
      while (tries++ < bidders.length * 2) {
        const c = bidders[ptr % bidders.length]; ptr++;
        if (!out.has(c.idx)) { b = c; break; }
      }
      if (!b) break;
      if (b === leader) continue;

      const can = b.cash >= ask;
      const res = await this.modal({
        icon: '🔨', color: '#ffd166', kind: 'auc',
        title: { de: `${t('auction')}: ${tx(tile)}`, en: `${t('auction')}: ${tx(tile)}` },
        sub: { de: `${secName(tile.sector)} · Marktwert ca. ${eur(market)}`, en: `${secName(tile.sector)} · market value approx. ${eur(market)}` },
        big: `<span style="color:${b.color}">${b.icon} ${b.name}</span>`,
        list: [
          leader ? { de: `Höchstgebot: ${eur(price)} von ${leader.name}`, en: `Highest bid: ${eur(price)} by ${leader.name}` }
                 : { de: 'Noch kein Gebot.', en: 'No bid yet.' },
          { de: `Dein Gebot wäre: <b>${eur(ask)}</b>`, en: `Your bid would be: <b>${eur(ask)}</b>` },
          { de: `Dein Bargeld: ${eur(b.cash)}`, en: `Your cash: ${eur(b.cash)}` },
          { de: `Miete auf Stufe 0: ${eur(Econ.rentOf(tile, { level: 0 }, b, Game))}`, en: `Rent at level 0: ${eur(Econ.rentOf(tile, { level: 0 }, b, Game))}` },
        ],
        tip: { de: 'Bietet nie mehr, als der Betrieb euch wert ist. Wer eine Auktion um jeden Preis gewinnt, hat meistens zu viel bezahlt.',
               en: 'Never bid more than it is worth to you. Winning an auction at any price usually means overpaying.' },
        buttons: [
          { id: 'bid', label: { de: `Bieten ${eur(ask)}`, en: `Bid ${eur(ask)}` }, primary: true, disabled: !can },
          { id: 'pass', label: { de: 'Aussteigen', en: 'Drop out' } },
        ],
      });
      if (res === 'bid') { leader = b; price = ask; ask = ask + inc(); }
      else out.add(b.idx);
    }
    if (leader) return { winner: leader.idx, price };
    return null;
  },

  /* ============================================================ WAHL */
  async election(opts, players) {
    await this.modal({
      icon: '🗳️', color: '#ffd166', kind: 'vote',
      title: { de: `${t('election')} — Jahr ${Game.year}`, en: `${t('election')} — Year ${Game.year}` },
      body: { de: 'Alle stimmen ab, was in den nächsten Jahren gilt. Die Mehrheit entscheidet — für alle.',
              en: 'Everyone votes on the rules for the coming years. The majority decides — for everyone.' },
      tip: { de: 'Politik ist kein Nebenschauplatz: Steuern, Zinsen und Investitionen verändern das Spielfeld für alle gleichzeitig.',
             en: 'Policy is not a side show: taxes, rates and investment change the board for everyone at once.' },
      buttons: [{ id: 'ok', label: { de: 'Abstimmung starten', en: 'Start the vote' }, primary: true }],
    });
    const votes = opts.map(() => 0);
    for (const p of players) {
      const pick = await this.modal({
        icon: p.icon, color: p.color, kind: 'vote',
        title: { de: `${p.name} stimmt ab`, en: `${p.name} votes` },
        body: { de: 'Wähle eine Maßnahme — sie gilt danach für alle.', en: 'Pick a measure — it then applies to everyone.' },
        html: `<div class="polgrid">${opts.map((o, i) =>
          `<div class="polcard" data-i="${i}"><span>${o.icon}</span><b>${tx(o)}</b><p>${tx(o.desc)}</p>
            <em>💡 ${tx(o.tip)}</em></div>`).join('')}</div>`,
        buttons: [],
        after: (card) => {
          card.querySelectorAll('.polcard').forEach(c =>
            c.onclick = () => this.resolveModal(c.dataset.i));
        },
      });
      votes[+pick] = (votes[+pick] || 0) + 1;
    }
    let best = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
    const tied = votes.map((v, i) => ({ v, i })).filter(x => x.v === votes[best]);
    const winner = tied[(Math.random() * tied.length) | 0].i;
    const o = opts[winner];
    await this.modal({
      icon: o.icon, color: '#7ee081', kind: 'vote',
      title: { de: `Angenommen: ${tx(o)}`, en: `Adopted: ${tx(o)}` },
      body: o.desc,
      list: opts.map((x, i) => ({ de: `${x.icon} ${tx(x)}: ${votes[i]} Stimme(n)`, en: `${x.icon} ${tx(x)}: ${votes[i]} vote(s)` })),
      tip: o.tip,
      buttons: [{ id: 'ok', label: STR.ok, primary: true }],
    });
    return { winner };
  },

  /* ============================================================ JAHRESBERICHT */
  async yearReport(phaseChanged) {
    const E = Econ;
    const h = E.history.slice(-14);
    const spark = (key, col, scale) => {
      const w = 260, ht = 42;
      const vals = h.map(x => x[key]);
      const mn = Math.min(0, ...vals), mx = Math.max(1, ...vals);
      const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${ht - ((v - mn) / (mx - mn || 1)) * ht}`).join(' ');
      return `<svg viewBox="0 0 ${w} ${ht}" class="spark"><polyline points="${pts}" style="stroke:${col}"/></svg>`;
    };
    await this.modal({
      icon: E.phaseIcon(), color: E.phaseColor(), kind: 'year',
      title: { de: `Jahresbericht — Jahr ${Game.year - 1} abgeschlossen`, en: `Annual report — year ${Game.year - 1} closed` },
      sub: { de: `Neue Lage: ${t(E.phase)}`, en: `New situation: ${t(E.phase)}` },
      body: E.mood(),
      html: `<div class="yr">
        <div><b>${t('growth')}</b> <span style="color:${E.growth >= 0 ? '#7ee081' : '#ff6b6b'}">${pct(E.growth)}</span>${spark('g', '#7ee081')}</div>
        <div><b>${t('inflation')}</b> <span style="color:#ffb03a">${pct(E.inflation)}</span>${spark('i', '#ffb03a')}</div>
        <div><b>${t('rate')}</b> <span style="color:#5ec8ff">${E.rate.toFixed(1)} %</span>${spark('r', '#5ec8ff')}</div>
        <div><b>${t('market')}</b> <span style="color:#d58cff">${Math.round(E.market)}</span>${spark('m', '#d58cff')}</div>
      </div>
      <p class="dim sm">${LANG === 'de'
        ? `Preisniveau: ×${E.priceLevel.toFixed(2)} — alles kostet jetzt ${Math.round((E.priceLevel - 1) * 100)} % mehr als zu Spielbeginn. Gehälter steigen nur, wenn ihr sie erhöht.`
        : `Price level: ×${E.priceLevel.toFixed(2)} — everything now costs ${Math.round((E.priceLevel - 1) * 100)}% more than at the start. Salaries only rise if you raise them.`}</p>`,
      tip: phaseChanged
        ? { de: 'Die Konjunktur hat gedreht. Rezessionen sind die beste Kaufgelegenheit — wenn man dann noch Geld hat.',
            en: 'The cycle has turned. Recessions are the best buying opportunity — if you still have cash then.' }
        : { de: 'Wachstum, Inflation, Zins und Arbeitslosigkeit hängen zusammen. Kein Wert lässt sich einzeln steuern.',
            en: 'Growth, inflation, rates and unemployment are linked. No single number can be steered alone.' },
      buttons: [{ id: 'ok', label: STR.ok, primary: true }],
    });
  },

  /* ============================================================ ENDE */
  async gameOver(rank) {
    Scene.celebrate();
    const w = rank[0];
    const rows = rank.map((p, i) => {
      const parts = p.scoreParts();
      return `<tr class="${i === 0 ? 'win' : ''}">
        <td>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</td>
        <td><span style="color:${p.color}">${p.icon} ${p.name}</span><small>${tx(p.char)}</small></td>
        ${parts.map(s => `<td class="r">${s.v}</td>`).join('')}
        <td class="r tot">${p.lifeScore()}</td></tr>`;
    }).join('');
    const bestLearn = Game.learn.slice(-8).reverse();
    await this.modal({
      icon: '🏆', color: w.color, kind: 'over',
      title: { de: `${t('winner')}: ${w.name}!`, en: `${t('winner')}: ${w.name}!` },
      sub: { de: `${tx(w.char)} · ${w.lifeScore()} ${t('lifeScore')}`, en: `${tx(w.char)} · ${w.lifeScore()} ${t('lifeScore')}` },
      html: `<table class="tbl rank">
        <tr><th></th><th>${t('players')}</th><th class="r">💰</th><th class="r">🎓</th><th class="r">😊</th><th class="r">🤝</th><th class="r">🧒</th><th class="r">Σ</th></tr>
        ${rows}</table>
        <h5>${LANG === 'de' ? 'Was ihr in diesem Spiel gelernt habt' : 'What you learned this game'}</h5>
        <ul class="sl learnlist">${bestLearn.map(l => `<li>${l.icon} ${l.txt}</li>`).join('')}</ul>`,
      tip: { de: 'Wer am meisten Geld hat, gewinnt hier nicht automatisch. Wirtschaft ist ein Mittel — Lebensqualität ist das Ziel.',
             en: 'The player with the most money does not automatically win here. The economy is a means — quality of life is the goal.' },
      buttons: [{ id: 'again', label: STR.again, primary: true }],
    });
    location.reload();
  },

  /* ============================================================ HILFE */
  async help() {
    await this.modal({
      icon: '❓', color: '#5ec8ff', title: { de: 'Wie funktioniert BOOM & BUST?', en: 'How does BOOM & BUST work?' },
      html: LANG === 'de' ? `
        <div class="helpgrid">
          <div><h5>🎲 Der Zug</h5><p>Würfeln, ziehen, Feld auflösen. Bei einem Pasch darfst du nochmal — dreimal hintereinander schickt dich aber zur Behörde.</p></div>
          <div><h5>🏢 Betriebe</h5><p>Kaufen, ausbauen, Miete kassieren. Achte auf die <b>Rendite-Anzeige</b>: Jede Ausbaustufe bringt anteilig weniger.</p></div>
          <div><h5>📊 Makro</h5><p>Oben läuft die echte Wirtschaft: Wachstum, Inflation, Leitzins, Arbeitslosigkeit. Sie beeinflusst jede Miete und jeden Kredit.</p></div>
          <div><h5>🏦 Bank</h5><p>Kredite kosten Leitzins + 3 %. Steigt der Leitzins, werden deine alten Schulden teurer. Sparen bringt Zinsen.</p></div>
          <div><h5>📈 Börse</h5><p>Aktien in 8 Sektoren. Ab 4 Sektoren bist du gestreut — ein einzelner Schock haut dich dann nicht mehr um.</p></div>
          <div><h5>🗳️ Wahlen</h5><p>Jedes Jahr stimmen alle über die Wirtschaftspolitik ab. Die Mehrheit entscheidet — auch für die Verlierer.</p></div>
          <div><h5>🏆 Gewinnen</h5><p>Nicht das meiste Geld gewinnt, sondern die meisten <b>Lebenspunkte</b>: Vermögen + Bildung + Freude + Gemeinwohl + Kinder.</p></div>
          <div><h5>🔄 Sitzplatz</h5><p>Die Kamera dreht sich zu dem, der dran ist. Im Tisch-Modus dreht sich sogar die Oberfläche mit.</p></div>
        </div>` : `
        <div class="helpgrid">
          <div><h5>🎲 A turn</h5><p>Roll, move, resolve the tile. A double lets you roll again — three in a row sends you to red tape.</p></div>
          <div><h5>🏢 Businesses</h5><p>Buy, upgrade, collect rent. Watch the <b>return figure</b>: every upgrade level adds proportionally less.</p></div>
          <div><h5>📊 Macro</h5><p>The real economy runs along the top: growth, inflation, policy rate, unemployment. It moves every rent and every loan.</p></div>
          <div><h5>🏦 Bank</h5><p>Loans cost the policy rate + 3 %. When the rate rises, your old debt gets more expensive. Savings earn interest.</p></div>
          <div><h5>📈 Market</h5><p>Shares in 8 sectors. From 4 sectors you are diversified — one shock can no longer knock you over.</p></div>
          <div><h5>🗳️ Elections</h5><p>Every year everyone votes on economic policy. The majority decides — for the losers too.</p></div>
          <div><h5>🏆 Winning</h5><p>Most money does not win. Most <b>life points</b> wins: net worth + education + joy + community + children.</p></div>
          <div><h5>🔄 Seat view</h5><p>The camera turns to whoever is up. In table mode the interface rotates as well.</p></div>
        </div>`,
      buttons: [{ id: 'ok', label: STR.close, primary: true }],
    });
  },
};
