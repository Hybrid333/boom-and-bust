/* ============================================================
   BOOM & BUST — econ.js
   Die Wirtschafts-Simulation.
   MAKRO: Konjunkturzyklus, Zentralbank, Inflation, Arbeitslosigkeit,
          Aktienindex, Staatshaushalt.
   MIKRO: Preise, Mieten, Wettbewerb, Monopol, abnehmender Grenzertrag.
   Beide Ebenen hängen zusammen — genau das ist die Lektion.
   ============================================================ */
'use strict';

const PHASE_RENT = { BOOM: 1.25, PEAK: 1.12, RECESSION: 0.68, RECOVERY: 1.00 };
const PHASE_ICON = { BOOM: '📈', PEAK: '🔥', RECESSION: '📉', RECOVERY: '🌤️' };
const PHASE_CSS  = { BOOM: '#7ee081', PEAK: '#ffb03a', RECESSION: '#ff6b6b', RECOVERY: '#5ec8ff' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd   = (a, b) => a + Math.random() * (b - a);
const eur   = n => (n < 0 ? '−' : '') + '€' + Math.abs(Math.round(n)).toLocaleString('de-DE');

const Econ = {
  /* ------------------------------------------------ Zustand */
  phase: 'RECOVERY',
  growth: 1.4,          // reales Wachstum in % pro Jahr
  inflation: 2.0,       // % pro Jahr
  rate: 2.5,            // Leitzins der Zentralbank in %
  unemp: 5.0,           // Arbeitslosenquote in %
  market: 100,          // Aktienindex
  priceLevel: 1.00,     // Preisniveau — multipliziert Preise UND Gehälter
  tax: 20,              // Steuersatz in %
  fund: 0,              // Gemeinschaftstopf (Staatskasse)
  sector: {},           // Sektor-Gesundheit, Startwert 1.0
  stockBase: {},        // Aktien-Basiskurs je Sektor
  yearSpend: 0,         // aggregierte Investitionen dieses Jahr
  history: [],          // für die Konjunkturkurve im HUD
  climateShield: false,
  antitrust: false,

  init() {
    this.phase = 'RECOVERY'; this.growth = 1.4; this.inflation = 2.0;
    this.rate = 2.5; this.unemp = 5.0; this.market = 100; this.priceLevel = 1.00;
    this.tax = 20; this.fund = 0; this.yearSpend = 0; this.history = [];
    this.climateShield = false; this.antitrust = false;
    this.sector = {}; this.stockBase = {};
    for (const k of SECTOR_KEYS) { this.sector[k] = 1.0; this.stockBase[k] = 100; }
    this.snap();
  },

  snap() {
    this.history.push({ g: this.growth, i: this.inflation, r: this.rate, m: this.market, p: this.phase });
    if (this.history.length > 40) this.history.shift();
  },

  /* ------------------------------------------------ MAKRO: Jahreswechsel
     Reihenfolge ist bewusst wie in der Realität:
     1. Nachfrage der Spieler treibt das Wachstum
     2. Wachstum senkt die Arbeitslosigkeit  (Okun)
     3. Niedrige Arbeitslosigkeit treibt die Inflation  (Phillips)
     4. Die Zentralbank reagiert mit dem Zins  (Taylor)
     5. Der Zins bremst im nächsten Jahr das Wachstum                   */
  tickYear(nPlayers, log) {
    const before = { g: this.growth, i: this.inflation, r: this.rate, u: this.unemp, p: this.phase };

    /* 1 — Nachfrageimpuls aus den Investitionen der Spieler */
    const perHead = this.yearSpend / Math.max(1, nPlayers);
    const impulse = clamp(perHead / 900, 0, 2.2);
    const rateDrag = (this.rate - 2.5) * 0.28;          // teures Geld bremst
    this.growth = clamp(this.growth * 0.45 + impulse - rateDrag - 0.15 + rnd(-0.45, 0.45), -3.5, 5.0);
    this.yearSpend = 0;

    /* 2 — Okun: Wachstum schafft Arbeitsplätze */
    this.unemp = clamp(this.unemp + (1.6 - this.growth) * 0.55 + rnd(-0.25, 0.25), 2.0, 16.0);

    /* 3 — Phillips: knappe Arbeit treibt Löhne und Preise */
    this.inflation = clamp(this.inflation * 0.55 + (5.0 - this.unemp) * 0.55 + this.growth * 0.30 + rnd(-0.4, 0.4), -2.0, 12.0);

    /* 4 — Taylor-Regel: die Zentralbank steuert gegen */
    const target = 1.0 + 1.4 * (this.inflation - 2.0) - 0.45 * (this.unemp - 5.0);
    this.rate = clamp(this.rate * 0.4 + target * 0.6, 0, 14);

    /* 5 — Preisniveau und Aktienmarkt fortschreiben */
    this.priceLevel *= (1 + this.inflation / 100);
    const mkt = this.growth * 0.035 - (this.rate - 2.5) * 0.014 + rnd(-0.06, 0.07);
    this.market = clamp(this.market * (1 + mkt), 25, 600);

    /* Sektoren kehren langsam zum Normalwert zurück (Mean Reversion) */
    for (const k of SECTOR_KEYS) {
      this.sector[k] = clamp(this.sector[k] * 0.82 + 0.18 + rnd(-0.05, 0.05), 0.35, 2.2);
      this.stockBase[k] = clamp(this.stockBase[k] * 0.9 + 10 + rnd(-4, 4), 25, 400);
    }

    /* Konjunkturphase bestimmen */
    const prev = this.phase;
    if (this.growth < 0)                              this.phase = 'RECESSION';
    else if (this.growth > 2.0 && this.inflation > 4.5) this.phase = 'PEAK';
    else if (this.growth > 1.5)                       this.phase = 'BOOM';
    else                                              this.phase = 'RECOVERY';

    this.snap();

    if (log) {
      const d = (a, b, u) => `${a > b ? '▲' : a < b ? '▼' : '▬'} ${a.toFixed(1)}${u}`;
      log({
        de: `Konjunktur: ${t(this.phase)}. Wachstum ${d(this.growth, before.g, ' %')}, ` +
            `Inflation ${d(this.inflation, before.i, ' %')}, Leitzins ${d(this.rate, before.r, ' %')}, ` +
            `Arbeitslosigkeit ${d(this.unemp, before.u, ' %')}.`,
        en: `Cycle: ${t(this.phase)}. Growth ${d(this.growth, before.g, '%')}, ` +
            `inflation ${d(this.inflation, before.i, '%')}, policy rate ${d(this.rate, before.r, '%')}, ` +
            `unemployment ${d(this.unemp, before.u, '%')}.`,
      }, prev !== this.phase ? PHASE_ICON[this.phase] : '📊');
    }
    return prev !== this.phase;
  },

  /* ------------------------------------------------ MIKRO: Kaufpreis
     Preisniveau (Makro!) × Charakter-Rabatt (Mikro!) × Sektorlage       */
  priceOf(tile, player) {
    let p = tile.price * this.priceLevel;
    p *= 0.75 + 0.25 * this.sector[tile.sector];        // gefragte Sektoren sind teurer
    if (player && player.traits.discount && player.traits.discount[tile.sector]) {
      p *= (1 - player.traits.discount[tile.sector]);
    }
    return Math.round(p / 10) * 10;
  },

  /* Ausbaukosten — steigen pro Stufe stärker als die Miete.
     Genau daran sieht man den abnehmenden Grenzertrag.                 */
  upgradeCost(asset, tile, player) {
    if (asset.level >= 4) return null;
    let c = tile.price * UPGRADE_COST[asset.level] * this.priceLevel;
    if (player && player.traits.buildDiscount) c *= (1 - player.traits.buildDiscount);
    return Math.round(c / 10) * 10;
  },

  /* Rendite eines Ausbaus in % — wird im UI angezeigt, damit Kinder
     sehen, dass jede weitere Stufe weniger bringt.                     */
  upgradeROI(asset, tile, player, game) {
    const cost = this.upgradeCost(asset, tile, player);
    if (!cost) return null;
    const now = this.rentOf(tile, asset, player, game);
    const next = this.rentOf(tile, { ...asset, level: asset.level + 1 }, player, game);
    return { cost, gain: next - now, pct: ((next - now) * 4 / cost) * 100 };   // 4 Mieten ≈ 1 Jahr
  },

  /* ------------------------------------------------ MIKRO: Miete
     Hier stecken alle Lektionen gleichzeitig drin.                      */
  rentOf(tile, asset, owner, game) {
    let r = tile.rent * UPGRADE_RENT[asset.level];

    /* Sektorlage (von Makro-Karten und Konjunktur getrieben) */
    r *= this.sector[tile.sector];

    /* Konjunkturphase — Rezession trifft die Mieten hart */
    let ph = PHASE_RENT[this.phase];
    if (owner && owner.traits.recessionProof && owner.traits.recessionProof.includes(tile.sector)) {
      ph = Math.max(ph, 1.0);
    }
    r *= ph;

    /* WETTBEWERB: je mehr Betriebe im Sektor bespielt werden,
       desto mehr Angebot — und desto weniger kann jeder verlangen. */
    const inSector = game ? game.ownedInSector(tile.sector) : 1;
    r *= 1 / (1 + 0.09 * Math.max(0, inSector - 1));

    /* MONOPOL: wem der ganze Sektor gehört, der setzt den Preis. */
    if (game && owner && game.ownsWholeSector(owner, tile.sector)) r *= 1.55;

    /* Charakter-Eigenheiten */
    if (owner) {
      if (owner.traits.boomBonus && this.phase === 'BOOM' && owner.traits.boomBonus.includes(tile.sector)) r *= 1.25;
      if (owner.traits.rentMalus && owner.traits.rentMalus[tile.sector]) r *= (1 - owner.traits.rentMalus[tile.sector]);
    }

    /* Alles in Preisen von heute */
    r *= this.priceLevel;
    return Math.max(1, Math.round(r));
  },

  /* ------------------------------------------------ Börse */
  stockPrice(sector) {
    return Math.max(5, Math.round(this.stockBase[sector] * this.sector[sector] * (this.market / 100)));
  },

  /* Kreditzins für einen Spieler: Leitzins + Risikoaufschlag */
  loanRate(player) {
    let r = this.rate + 3.0;
    if (player && player.traits.extraInterest) r += player.traits.extraInterest;
    if (player && player.debt > player.salary * 8) r += 2;   // hohe Verschuldung = teurer
    return Math.round(r * 10) / 10;
  },
  savingsRate() { return Math.max(0, Math.round((this.rate - 0.5) * 10) / 10); },

  /* Kreditrahmen — orientiert sich am Einkommen, nicht am Wunsch */
  maxLoan(player) {
    return Math.max(0, Math.round((player.salary * 6 + player.netWorth() * 0.3 - player.debt) / 100) * 100);
  },

  /* ------------------------------------------------ Effekte von Karten */
  hitSector(key, delta) { this.sector[key] = clamp(this.sector[key] * (1 + delta), 0.3, 2.4); },
  hitAllSectors(delta) { for (const k of SECTOR_KEYS) this.hitSector(k, delta); },
  hitStock(key, delta) { this.stockBase[key] = clamp(this.stockBase[key] * (1 + delta), 20, 450); },
  hitMarket(delta) { this.market = clamp(this.market * (1 + delta), 25, 600); },

  phaseColor() { return PHASE_CSS[this.phase]; },
  phaseIcon() { return PHASE_ICON[this.phase]; },

  /* Kurzer Klartext für das HUD — die Lage in einem Satz */
  mood() {
    switch (this.phase) {
      case 'BOOM':      return { de: 'Es läuft. Mieten und Aktien steigen — aber die Preise auch.',
                                 en: 'Things are humming. Rents and shares rise — so do prices.' };
      case 'PEAK':      return { de: 'Überhitzt! Die Zentralbank erhöht den Zins. Schulden werden gefährlich.',
                                 en: 'Overheating! The central bank is raising rates. Debt gets dangerous.' };
      case 'RECESSION': return { de: 'Rezession. Mieten brechen ein, Jobs wackeln — aber alles ist billig zu haben.',
                                 en: 'Recession. Rents collapse, jobs wobble — but everything is cheap to buy.' };
      default:          return { de: 'Erholung. Günstige Kredite, vorsichtiger Aufschwung. Gute Zeit zum Investieren.',
                                 en: 'Recovery. Cheap credit, careful upswing. A good time to invest.' };
    }
  },
};
