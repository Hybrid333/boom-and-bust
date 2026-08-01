/* ============================================================
   BOOM & BUST — game.js
   Spielzustand · Spieler · Zugablauf · Regeln · Karteneffekte
   Rendering (scene.js) und Bedienung (ui.js) hängen sich per Bus an.
   ============================================================ */
'use strict';

/* ------------------------------------------------------------ Mini-Eventbus */
const Bus = {
  h: {},
  on(k, f) { (this.h[k] = this.h[k] || []).push(f); },
  emit(k, p) { (this.h[k] || []).forEach(f => { try { f(p); } catch (e) { console.error(k, e); } }); },
};

/* ------------------------------------------------------------ Spieler */
class Player {
  constructor(idx, name, char, seat) {
    this.idx = idx; this.name = name; this.char = char; this.seat = seat;
    this.icon = char.icon; this.color = char.color;
    this.pos = 0; this.laps = 0;
    this.cash = char.cash; this.debt = char.debt || 0; this.savings = 0;
    this.salary = char.salary; this.edu = char.edu; this.joy = char.joy;
    this.comm = 0; this.kids = 0;
    this.stocks = {};                    // sector -> Stückzahl
    this.traits = char.traits || {};
    this.flags = {};                     // insured, stock, …
    this.redTape = 0;                    // Runden in der Behörde
    this.jobless = 0;                    // Runden ohne Job
    this.stats = { rentPaid: 0, rentEarned: 0, invested: 0, taxPaid: 0, interest: 0, bought: 0 };
  }

  assets() { return Game.assetList().filter(a => a.owner === this.idx); }

  assetValue() {
    let v = 0;
    for (const a of this.assets()) {
      const tile = BOARD[a.idx];
      v += tile.price * Econ.priceLevel * (1 + 0.45 * a.level) * (0.7 + 0.3 * Econ.sector[tile.sector]);
    }
    return Math.round(v);
  }

  stockValue() {
    let v = 0;
    for (const k in this.stocks) v += this.stocks[k] * Econ.stockPrice(k);
    return Math.round(v);
  }

  netWorth() { return Math.round(this.cash + this.savings + this.assetValue() + this.stockValue() - this.debt); }

  /* Lebenspunkte: Geld ist nur EIN Teil davon.
     Genau das macht dieses Spiel familientauglich — reich allein gewinnt nicht. */
  lifeScore() {
    return Math.round(
      this.netWorth() / 120 +
      this.edu * 30 +
      this.joy * 12 +
      this.comm * 7 +
      this.kids * 25
    );
  }

  scoreParts() {
    return [
      { k: 'netWorth', v: Math.round(this.netWorth() / 120), raw: eur(this.netWorth()) },
      { k: 'edu',      v: this.edu * 30, raw: this.edu },
      { k: 'joy',      v: this.joy * 12, raw: this.joy },
      { k: 'comm',     v: this.comm * 7, raw: this.comm },
      { k: 'kids',     v: this.kids * 25, raw: this.kids },
    ];
  }
}

/* ------------------------------------------------------------ Spiel */
const Game = {
  players: [], cur: 0, round: 1, maxRounds: 12, quarter: 1, year: 1,
  assets: {},                 // tileIdx -> { idx, owner, level }
  mikroDeck: [], makroDeck: [],
  familyMode: true, seatFlip: true, auctions: true,
  busy: false, started: false, over: false,
  lastDice: [1, 1], doublesRun: 0,
  learn: [],                  // Lern-Log

  /* ---------------------------------------------- Setup */
  start(cfg) {
    Econ.init();
    this.players = cfg.players.map((p, i) =>
      new Player(i, p.name, CHARACTERS.find(c => c.id === p.charId), i));
    this.cur = 0; this.round = 1; this.quarter = 1; this.year = 1;
    this.maxRounds = cfg.maxRounds || 12;
    this.familyMode = cfg.familyMode !== false;
    this.seatFlip = cfg.seatFlip !== false;
    this.auctions = cfg.auctions !== false;
    this.assets = {}; this.learn = [];
    this.over = false; this.started = true; this.busy = false;
    this.mikroDeck = this.shuffle(MIKRO.map((_, i) => i));
    this.makroDeck = this.shuffle(MAKRO.map((_, i) => i));
    Econ.fund = 500 * this.players.length;
    Bus.emit('start', this);
    this.beginTurn();
  },

  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; },

  p() { return this.players[this.cur]; },
  assetList() { return Object.values(this.assets); },
  assetAt(i) { return this.assets[i] || null; },

  /* Angebot im Sektor: wie viele Betriebe sind überhaupt in Betrieb?
     Mehr Angebot → jeder Einzelne kann weniger Miete verlangen.        */
  ownedInSector(sec) {
    let n = 0;
    for (const a of this.assetList()) if (BOARD[a.idx].sector === sec) n++;
    return n;
  },
  sectorTiles(sec) { return BOARD.map((t, i) => ({ t, i })).filter(x => x.t.type === T.ASSET && x.t.sector === sec); },
  ownsWholeSector(pl, sec) {
    const tiles = this.sectorTiles(sec);
    return tiles.every(x => this.assets[x.i] && this.assets[x.i].owner === pl.idx);
  },
  monopolies(pl) { return SECTOR_KEYS.filter(s => this.ownsWholeSector(pl, s)); },

  /* ---------------------------------------------- Lern-Log */
  teach(obj, icon) {
    const txt = tx(obj);
    this.learn.push({ txt, icon: icon || '💡', round: this.round });
    Bus.emit('learn', { txt, icon: icon || '💡' });
  },
  say(obj, icon) { Bus.emit('log', { txt: tx(obj), icon: icon || '•' }); },

  /* ============================================================ ZUGABLAUF */
  async beginTurn() {
    if (this.over) return;
    const p = this.p();
    this.doublesRun = 0;
    Bus.emit('turn', p);
    if (this.seatFlip) await Scene.flipToSeat(p);
    /* Charakter-Einkommen und Dauerwirkungen */
    if (p.traits.communityPerRound) p.comm += p.traits.communityPerRound;
    if (p.traits.patent && this.round % 4 === 0) {
      p.cash += p.traits.patent;
      this.say({ de: `${p.name} erhält ${eur(p.traits.patent)} Patenteinnahmen.`,
                 en: `${p.name} receives ${eur(p.traits.patent)} in patent income.` }, '🔬');
    }
    this.quarterlyIncome(p);
    if (p.redTape > 0) { await this.redTapeTurn(p); return; }
    Bus.emit('canRoll', true);
  },

  /* Quartalslohn — jede Runde, ohne Dialog.
     Dadurch lohnt sich Bildung wirklich: +12 % Gehalt wirken 12 Runden lang. */
  quarterlyIncome(p) {
    const gross = Math.round(p.salary * Econ.priceLevel);
    const taxAmt = Math.round(gross * Econ.tax / 100);
    const kidCost = Math.round(p.kids * 70 * Econ.priceLevel);
    const net = gross - taxAmt - kidCost;
    p.cash += net; p.stats.taxPaid += taxAmt; Econ.fund += taxAmt;
    Econ.yearSpend += net * 0.35;                  // Konsum ist Nachfrage
    this.say({
      de: `Quartalslohn ${p.name}: ${eur(gross)} brutto − ${eur(taxAmt)} Steuer${kidCost ? ' − ' + eur(kidCost) + ' Kinder' : ''} = ${eur(net)}`,
      en: `Quarterly pay ${p.name}: ${eur(gross)} gross − ${eur(taxAmt)} tax${kidCost ? ' − ' + eur(kidCost) + ' children' : ''} = ${eur(net)}`,
    }, '💼');
    Bus.emit('income', { p, net });
  },

  async redTapeTurn(p) {
    const fee = Math.round(150 * Econ.priceLevel);
    const res = await UI.modal({
      icon: '📋', title: { de: 'In der Behörde festgesteckt', en: 'Stuck in red tape' },
      body: { de: `${p.name} wartet noch auf einen Stempel. Gebühr zahlen und sofort weiter — oder auf einen Pasch hoffen.`,
              en: `${p.name} is still waiting for a stamp. Pay the fee and move on — or hope for a double.` },
      tip: { de: 'Transaktionskosten: Zeit und Bürokratie sind ein echter Preis, auch wenn keine Rechnung kommt.',
             en: 'Transaction costs: time and bureaucracy are a real price, even without an invoice.' },
      buttons: [
        { id: 'pay', label: { de: `Gebühr zahlen (${eur(fee)})`, en: `Pay fee (${eur(fee)})` }, primary: true, disabled: p.cash < fee },
        { id: 'roll', label: { de: 'Auf Pasch würfeln', en: 'Roll for a double' } },
      ],
    });
    if (res === 'pay') { p.cash -= fee; p.redTape = 0; Bus.emit('canRoll', true); return; }
    const d = await Scene.rollDice();
    this.lastDice = d;
    if (d[0] === d[1]) {
      p.redTape = 0;
      this.say({ de: `Pasch! ${p.name} ist frei.`, en: `Double! ${p.name} is free.` }, '🎲');
      await this.doMove(d[0] + d[1]);
    } else {
      p.redTape--;
      if (p.redTape <= 0) { p.cash -= fee; p.redTape = 0;
        this.say({ de: `${p.name} muss die Gebühr doch zahlen.`, en: `${p.name} has to pay the fee after all.` }, '📋'); }
      await this.endTurn();
    }
  },

  async roll() {
    if (this.busy || this.over) return;
    this.busy = true; Bus.emit('canRoll', false);
    const d = await Scene.rollDice();
    this.lastDice = d;
    const sum = d[0] + d[1];
    if (d[0] === d[1]) {
      this.doublesRun++;
      if (this.doublesRun >= 3) {
        this.say({ de: `Dritter Pasch — ${this.p().name} muss zur Behörde.`, en: `Third double — ${this.p().name} goes to red tape.` }, '📋');
        await this.sendToRedTape(this.p());
        this.busy = false; await this.endTurn(); return;
      }
    }
    await this.doMove(sum);
    this.busy = false;
  },

  async doMove(steps) {
    const p = this.p();
    const path = [];
    for (let i = 1; i <= steps; i++) path.push((p.pos + i) % N_TILES);
    await Scene.movePlayer(p, path);
    /* Über START gekommen? */
    if (p.pos + steps >= N_TILES) { p.pos = (p.pos + steps) % N_TILES; await this.payday(p); }
    else p.pos = p.pos + steps;
    await this.landOn(p, p.pos);
  },

  /* ---------------------------------------------- Neujahr (START passiert)
     Die persönliche Jahresabrechnung: Bonus, Zinsen, Jobrisiko.
     Der laufende Lohn kommt jede Runde (siehe quarterlyIncome).        */
  async payday(p) {
    p.laps++;
    const bonus = Math.round(p.salary * 1.5 * Econ.priceLevel);
    const taxAmt = Math.round(bonus * Econ.tax / 100);
    let net = bonus - taxAmt;

    /* Kreditzinsen — hier merkt man den Leitzins am eigenen Konto */
    let interest = 0;
    if (p.debt > 0) { interest = Math.round(p.debt * Econ.loanRate(p) / 100); p.debt += interest; p.stats.interest += interest; }
    /* Sparzinsen */
    let sInt = 0;
    if (p.savings > 0) { sInt = Math.round(p.savings * Econ.savingsRate() / 100); p.savings += sInt; }

    /* Arbeitslosigkeit — in der Rezession wackeln Jobs */
    let lost = false;
    const risk = (p.traits.layoffRisk === undefined ? 1 : p.traits.layoffRisk);
    if (risk > 0 && Econ.phase === 'RECESSION' && !this.familyMode) {
      if (Math.random() < (Econ.unemp / 100) * risk) lost = true;
    } else if (risk > 0 && Econ.phase === 'RECESSION' && this.familyMode) {
      if (Math.random() < (Econ.unemp / 200) * risk) lost = true;
    }

    p.cash += net; p.stats.taxPaid += taxAmt; Econ.fund += taxAmt;

    const lines = [
      { de: `Jahresbonus (1,5 Gehälter): ${eur(bonus)}`, en: `Annual bonus (1.5 salaries): ${eur(bonus)}` },
      { de: `Steuern (${Econ.tax} %): −${eur(taxAmt)} → Gemeinschaftstopf`, en: `Tax (${Econ.tax}%): −${eur(taxAmt)} → common fund` },
    ];
    if (interest) lines.push({ de: `Kreditzinsen (${Econ.loanRate(p)} %): −${eur(interest)} auf die Schulden`, en: `Loan interest (${Econ.loanRate(p)}%): −${eur(interest)} added to debt` });
    if (sInt) lines.push({ de: `Sparzinsen: +${eur(sInt)}`, en: `Savings interest: +${eur(sInt)}` });
    lines.push({ de: `Ausgezahlt: ${eur(net)}`, en: `Paid out: ${eur(net)}` });

    /* Kinder kosten laufend Geld — und geben jedes Jahr etwas zurück. */
    if (p.kids > 0) {
      p.joy += p.kids;
      lines.push({ de: `Ein Jahr mit ${p.kids} Kind(ern): +${p.kids} Freude`, en: `A year with ${p.kids} child(ren): +${p.kids} joy` });
    }

    if (lost) { p.jobless = 2; const old = p.salary; p.salary = Math.round(p.salary * 0.35); p.joy = Math.max(0, p.joy - 2);
      lines.push({ de: `⚠️ Jobverlust! Gehalt fällt von ${eur(old)} auf ${eur(p.salary)} (Arbeitslosengeld).`,
                   en: `⚠️ Job lost! Salary drops from ${eur(old)} to ${eur(p.salary)} (benefits).` }); }
    else if (p.jobless > 0) { p.jobless--; if (p.jobless === 0) { p.salary = Math.round(p.salary / 0.35 * 0.9); p.joy += 1;
      lines.push({ de: `Neuer Job gefunden! Gehalt: ${eur(p.salary)}`, en: `Found a new job! Salary: ${eur(p.salary)}` }); } }

    await UI.modal({
      icon: '🎉', color: '#ffd166',
      title: { de: `Neujahr — Jahresabrechnung für ${p.name}`, en: `New Year — annual settlement for ${p.name}` },
      sub: { de: `${p.laps}. Runde ums Brett`, en: `Lap ${p.laps} around the board` },
      list: lines,
      tip: { de: `Dein Gehalt wächst nicht automatisch mit den Preisen. Bei ${Econ.inflation.toFixed(1)} % Inflation verlierst du jedes Jahr Kaufkraft, wenn du sie nicht ausgleichst — zum Beispiel mit Bildung.`,
             en: `Your salary does not rise with prices automatically. At ${Econ.inflation.toFixed(1)}% inflation you lose purchasing power every year unless you offset it — for example with education.` },
      buttons: [{ id: 'ok', label: STR.ok, primary: true }],
    });
    this.checkBroke(p);
  },

  /* ---------------------------------------------- Feld auflösen */
  async landOn(p, idx) {
    const tile = BOARD[idx];
    await Scene.focusTile(idx);
    switch (tile.type) {
      case T.ASSET:   await this.tileAsset(p, idx, tile); break;
      case T.MIKRO:   await this.cardMikro(p); break;
      case T.MAKRO:   await this.cardMakro(p); break;
      case T.BOERSE:  await UI.stockPanel(p); break;
      case T.BANK:    await UI.bankPanel(p); break;
      case T.EDU:     await this.tileEdu(p); break;
      case T.TAX:     await this.tileTax(p); break;
      case T.MARKET:  await this.tileMarket(p); break;
      case T.GOTO_REDTAPE: await this.sendToRedTape(p); break;
      case T.REDTAPE: this.say({ de: `${p.name} schaut nur kurz vorbei.`, en: `${p.name} is just visiting.` }, '📋'); break;
      case T.START:   break;
    }
    if (this.lastDice[0] === this.lastDice[1] && this.doublesRun > 0 && this.doublesRun < 3 && p.redTape === 0) {
      this.say({ de: 'Pasch — nochmal würfeln!', en: 'Double — roll again!' }, '🎲');
      Bus.emit('canRoll', true);
    } else Bus.emit('canEnd', true);
    Bus.emit('update');
  },

  async sendToRedTape(p) {
    p.redTape = 2;
    await Scene.teleport(p, IDX_REDTAPE);
    p.pos = IDX_REDTAPE;
    this.teach({ de: 'Bürokratie kostet Zeit — und Zeit ist der knappste Rohstoff überhaupt.',
                 en: 'Bureaucracy costs time — and time is the scarcest resource there is.' }, '📋');
  },

  /* ---------------------------------------------- Betriebs-Feld */
  async tileAsset(p, idx, tile) {
    const a = this.assetAt(idx);

    /* --- Fremder Besitz: Miete zahlen */
    if (a && a.owner !== p.idx) {
      const owner = this.players[a.owner];
      const rent = Econ.rentOf(tile, a, owner, this);
      const inSec = this.ownedInSector(tile.sector);
      const mono = this.ownsWholeSector(owner, tile.sector);
      p.cash -= rent; owner.cash += rent;
      p.stats.rentPaid += rent; owner.stats.rentEarned += rent;
      const notes = [];
      notes.push({ de: `Grundmiete Stufe ${a.level} (${tx(UPGRADE_NAME[a.level])}): ${eur(tile.rent * UPGRADE_RENT[a.level])}`,
                   en: `Base rent level ${a.level} (${tx(UPGRADE_NAME[a.level])}): ${eur(tile.rent * UPGRADE_RENT[a.level])}` });
      notes.push({ de: `Sektorlage ${secName(tile.sector)}: ×${Econ.sector[tile.sector].toFixed(2)}`,
                   en: `Sector health ${secName(tile.sector)}: ×${Econ.sector[tile.sector].toFixed(2)}` });
      notes.push({ de: `Konjunktur (${t(Econ.phase)}): ×${PHASE_RENT[Econ.phase].toFixed(2)}`,
                   en: `Cycle (${t(Econ.phase)}): ×${PHASE_RENT[Econ.phase].toFixed(2)}` });
      if (inSec > 1) notes.push({ de: `Wettbewerb: ${inSec} Betriebe im Sektor → ×${(1 / (1 + 0.09 * (inSec - 1))).toFixed(2)}`,
                                  en: `Competition: ${inSec} businesses in sector → ×${(1 / (1 + 0.09 * (inSec - 1))).toFixed(2)}` });
      if (mono) notes.push({ de: `Monopol auf ${secName(tile.sector)}: ×1,55`, en: `Monopoly on ${secName(tile.sector)}: ×1.55` });
      notes.push({ de: `Preisniveau: ×${Econ.priceLevel.toFixed(2)}`, en: `Price level: ×${Econ.priceLevel.toFixed(2)}` });

      await UI.modal({
        icon: SECTORS[tile.sector].icon, color: SECTORS[tile.sector].css,
        title: { de: `Miete an ${owner.name}`, en: `Rent to ${owner.name}` },
        big: eur(rent),
        body: { de: `${tx(tile)} gehört ${owner.name}.`, en: `${tx(tile)} belongs to ${owner.name}.` },
        list: notes,
        tip: mono
          ? { de: 'Ein Monopol kann Preise setzen statt sie zu finden. Deshalb überwachen Kartellbehörden ganze Branchen.',
              en: 'A monopolist sets prices instead of finding them. That is why antitrust authorities watch whole industries.' }
          : (inSec > 2
            ? { de: 'Mehr Anbieter = mehr Angebot = niedrigere Preise. Wettbewerb schützt die Kundschaft.',
                en: 'More suppliers = more supply = lower prices. Competition protects customers.' }
            : { de: 'Miete ist Einkommen ohne Arbeit — deshalb sind Besitzverhältnisse so wichtig für Ungleichheit.',
                en: 'Rent is income without work — which is why ownership matters so much for inequality.' }),
        buttons: [{ id: 'ok', label: STR.ok, primary: true }],
      });
      this.checkBroke(p);
      return;
    }

    /* --- Eigener Besitz: ausbauen */
    if (a && a.owner === p.idx) { await UI.assetPanel(p, idx, true); return; }

    /* --- Frei: kaufen oder versteigern */
    const price = Econ.priceOf(tile, p);
    const rent = Econ.rentOf(tile, { level: 0 }, p, this);
    const res = await UI.modal({
      icon: SECTORS[tile.sector].icon, color: SECTORS[tile.sector].css,
      title: tile, sub: { de: secName(tile.sector), en: secName(tile.sector) },
      list: [
        { de: `Kaufpreis: ${eur(price)}`, en: `Price: ${eur(price)}` },
        { de: `Miete jetzt: ${eur(rent)} pro Besuch`, en: `Rent now: ${eur(rent)} per visit` },
        { de: `Sektorlage: ×${Econ.sector[tile.sector].toFixed(2)}`, en: `Sector health: ×${Econ.sector[tile.sector].toFixed(2)}` },
        { de: `Dein Bargeld: ${eur(p.cash)}`, en: `Your cash: ${eur(p.cash)}` },
      ],
      tip: { de: `Faustregel: Der Betrieb hat sich nach etwa ${Math.max(1, Math.round(price / Math.max(1, rent)))} Besuchen bezahlt gemacht — wenn die Konjunktur mitspielt.`,
             en: `Rule of thumb: this pays for itself after about ${Math.max(1, Math.round(price / Math.max(1, rent)))} visits — if the economy plays along.` },
      buttons: [
        { id: 'buy', label: { de: `Kaufen (${eur(price)})`, en: `Buy (${eur(price)})` }, primary: true, disabled: p.cash < price },
        { id: 'pass', label: this.auctions ? { de: 'Passen → Auktion', en: 'Pass → auction' } : STR.pass },
      ],
    });
    if (res === 'buy') this.buyAsset(p, idx, price);
    else if (this.auctions && this.players.length > 1) await this.runAuction(idx, p.idx);
  },

  buyAsset(p, idx, price) {
    const tile = BOARD[idx];
    p.cash -= price; p.stats.invested += price; p.stats.bought++;
    Econ.yearSpend += price;                       // MIKRO wird zu MAKRO: Ausgaben = Nachfrage
    this.assets[idx] = { idx, owner: p.idx, level: 0 };
    Scene.markAsset(idx, p);
    this.say({ de: `${p.name} kauft ${tx(tile)} für ${eur(price)}.`, en: `${p.name} buys ${tx(tile)} for ${eur(price)}.` }, '🤝');
    if (this.ownsWholeSector(p, tile.sector)) {
      this.teach({ de: `${p.name} kontrolliert jetzt den ganzen Sektor ${secName(tile.sector)} — Miete ×1,55. Das ist ein Monopol.`,
                   en: `${p.name} now controls the entire ${secName(tile.sector)} sector — rent ×1.55. That is a monopoly.` }, '👑');
    }
    Bus.emit('update');
  },

  /* ---------------------------------------------- Auktion */
  async runAuction(idx, skipIdx) {
    const tile = BOARD[idx];
    const bidders = this.players.filter(x => x.idx !== skipIdx && x.cash > 0);
    if (!bidders.length) return;
    const res = await UI.auction(idx, bidders);
    if (res && res.winner != null) {
      const w = this.players[res.winner];
      w.cash -= res.price; w.stats.invested += res.price; w.stats.bought++;
      Econ.yearSpend += res.price;
      this.assets[idx] = { idx, owner: w.idx, level: 0 };
      Scene.markAsset(idx, w);
      this.say({ de: `${w.name} ersteigert ${tx(tile)} für ${eur(res.price)}.`, en: `${w.name} wins ${tx(tile)} for ${eur(res.price)}.` }, '🔨');
      this.teach({ de: 'In einer Auktion entsteht der Preis erst durch die Bieter. So findet ein Markt heraus, was etwas wirklich wert ist.',
                   en: 'In an auction the price is created by the bidders. That is how a market discovers what something is really worth.' }, '🔨');
    } else {
      this.say({ de: `Niemand bietet auf ${tx(tile)}.`, en: `Nobody bids on ${tx(tile)}.` }, '🔨');
    }
    Bus.emit('update');
  },

  upgradeAsset(p, idx) {
    const a = this.assetAt(idx), tile = BOARD[idx];
    if (!a || a.owner !== p.idx || a.level >= 4) return false;
    const cost = Econ.upgradeCost(a, tile, p);
    if (p.cash < cost) return false;
    p.cash -= cost; p.stats.invested += cost; Econ.yearSpend += cost;
    a.level++;
    Scene.upgradeAsset(idx, a.level, p);
    this.say({ de: `${p.name} baut ${tx(tile)} zu „${tx(UPGRADE_NAME[a.level])}" aus (${eur(cost)}).`,
               en: `${p.name} upgrades ${tx(tile)} to "${tx(UPGRADE_NAME[a.level])}" (${eur(cost)}).` }, '🏗️');
    if (a.level === 2) this.teach({ de: 'Achte auf die Rendite-Anzeige: Jede weitere Ausbaustufe kostet mehr und bringt anteilig weniger. Das nennt man abnehmenden Grenzertrag.',
                                    en: 'Watch the return figure: each further upgrade costs more and adds proportionally less. That is diminishing marginal returns.' }, '📉');
    Bus.emit('update');
    return true;
  },

  sellAsset(p, idx) {
    const a = this.assetAt(idx), tile = BOARD[idx];
    if (!a || a.owner !== p.idx) return 0;
    /* Notverkauf: in der Rezession bekommt man weniger — Liquidität hat einen Preis */
    const base = tile.price * Econ.priceLevel * (1 + 0.45 * a.level);
    const factor = Econ.phase === 'RECESSION' ? 0.55 : Econ.phase === 'BOOM' ? 0.85 : 0.70;
    const got = Math.round(base * factor * (0.7 + 0.3 * Econ.sector[tile.sector]));
    p.cash += got; delete this.assets[idx]; Scene.clearAsset(idx);
    this.say({ de: `${p.name} verkauft ${tx(tile)} für ${eur(got)}.`, en: `${p.name} sells ${tx(tile)} for ${eur(got)}.` }, '💸');
    if (Econ.phase === 'RECESSION') this.teach({ de: 'Wer in der Krise verkaufen MUSS, verkauft immer zu schlecht. Deshalb ist ein Notgroschen so wertvoll.',
                                                 en: 'Anyone forced to sell in a crisis sells badly. That is why an emergency fund is so valuable.' }, '⚠️');
    Bus.emit('update');
    return got;
  },

  /* ---------------------------------------------- Bank */
  takeLoan(p, amt) {
    amt = Math.min(amt, Econ.maxLoan(p));
    if (amt <= 0) return false;
    p.cash += amt; p.debt += amt;
    this.say({ de: `${p.name} nimmt ${eur(amt)} Kredit zu ${Econ.loanRate(p)} %.`, en: `${p.name} borrows ${eur(amt)} at ${Econ.loanRate(p)}%.` }, '🏦');
    this.teach({ de: `Ein Kredit zieht Kaufkraft aus der Zukunft in die Gegenwart. Bei ${Econ.loanRate(p)} % zahlst du sie mit Aufschlag zurück.`,
                 en: `A loan pulls purchasing power from the future into the present. At ${Econ.loanRate(p)}% you repay it with a premium.` }, '🏦');
    Bus.emit('update'); return true;
  },
  repay(p, amt) { amt = Math.min(amt, p.cash, p.debt); if (amt <= 0) return false; p.cash -= amt; p.debt -= amt; Bus.emit('update'); return true; },
  deposit(p, amt) { amt = Math.min(amt, p.cash); if (amt <= 0) return false; p.cash -= amt; p.savings += amt; Bus.emit('update'); return true; },
  withdraw(p, amt) { amt = Math.min(amt, p.savings); if (amt <= 0) return false; p.savings -= amt; p.cash += amt; Bus.emit('update'); return true; },

  /* ---------------------------------------------- Gemeinwohl
     Geld in den Gemeinschaftstopf geben. Kostet Vermögen, bringt
     Lebenspunkte — und finanziert Krisenhilfe für ALLE, auch für die,
     die nichts geben. Das ist das Trittbrettfahrer-Problem zum Anfassen. */
  donate(p, amt) {
    amt = Math.min(amt, p.cash);
    if (amt < 50) return 0;
    const gained = Math.max(1, Math.round(amt / (250 * Econ.priceLevel)));
    p.cash -= amt; Econ.fund += amt; p.comm += gained; p.joy += 1;
    Econ.yearSpend += amt * 0.5;
    this.say({ de: `${p.name} spendet ${eur(amt)} → +${gained} Gemeinwohl.`,
               en: `${p.name} donates ${eur(amt)} → +${gained} community.` }, '🤝');
    if (!p.flags.taughtGive) {
      p.flags.taughtGive = true;
      this.teach({ de: 'Öffentliche Güter nutzen allen — auch denen, die nichts beitragen. Genau deshalb finanziert man sie gemeinsam und nicht freiwillig.',
                   en: 'Public goods benefit everyone — including those who contribute nothing. That is exactly why they are funded collectively rather than voluntarily.' }, '🤝');
    }
    Bus.emit('update');
    return gained;
  },

  /* ---------------------------------------------- Börse */
  buyStock(p, sec, n) {
    const price = Econ.stockPrice(sec), cost = price * n;
    if (cost > p.cash || n <= 0) return false;
    p.cash -= cost; p.stocks[sec] = (p.stocks[sec] || 0) + n;
    Econ.yearSpend += cost * 0.4;
    const held = Object.keys(p.stocks).filter(k => p.stocks[k] > 0).length;
    if (held === 4) this.teach({ de: 'Vier Sektoren im Depot: Du bist jetzt breit gestreut. Ein Schock in einer Branche kann dich nicht mehr umwerfen.',
                                 en: 'Four sectors in your portfolio: you are now diversified. A shock in one industry can no longer knock you over.' }, '📈');
    Bus.emit('update'); return true;
  },
  sellStock(p, sec, n) {
    n = Math.min(n, p.stocks[sec] || 0); if (n <= 0) return false;
    p.cash += Econ.stockPrice(sec) * n; p.stocks[sec] -= n;
    Bus.emit('update'); return true;
  },

  /* ---------------------------------------------- Sonderfelder */
  async tileEdu(p) {
    const cost = Math.round(300 * Econ.priceLevel * (1 + p.edu * 0.35));
    const res = await UI.modal({
      icon: '🎓', color: '#5ec8ff', title: { de: 'Volkshochschule', en: 'Community College' },
      body: { de: `Ein Kurs hebt deine Bildung von ${p.edu} auf ${p.edu + 1} und dein Gehalt dauerhaft um 12 %.`,
              en: `A course lifts your education from ${p.edu} to ${p.edu + 1} and your salary permanently by 12%.` },
      list: [
        { de: `Kosten: ${eur(cost)}`, en: `Cost: ${eur(cost)}` },
        { de: `Gehalt danach: ${eur(Math.round(p.salary * 1.12))}`, en: `Salary after: ${eur(Math.round(p.salary * 1.12))}` },
        { de: `Bezahlt sich nach ${Math.ceil(cost / (p.salary * 0.12))} Zahltagen`, en: `Pays for itself after ${Math.ceil(cost / (p.salary * 0.12))} paydays` },
      ],
      tip: { de: 'Bildung ist die einzige Investition, die dir niemand wegnehmen kann — und sie wirkt jede Runde.',
             en: 'Education is the one investment nobody can take from you — and it pays every single round.' },
      buttons: [
        { id: 'buy', label: { de: `Kurs belegen (${eur(cost)})`, en: `Take the course (${eur(cost)})` }, primary: true, disabled: p.cash < cost },
        { id: 'no', label: STR.pass },
      ],
    });
    if (res === 'buy') { p.cash -= cost; p.edu++; p.salary = Math.round(p.salary * 1.12); Econ.yearSpend += cost * 0.5; Bus.emit('update'); }
  },

  async tileTax(p) {
    const wealth = p.netWorth();
    const amt = Math.max(0, Math.round(wealth * 0.04 + p.cash * 0.03));
    p.cash -= amt; Econ.fund += amt; p.stats.taxPaid += amt;
    await UI.modal({
      icon: '🧾', color: '#ffb03a', title: { de: 'Finanzamt', en: 'Tax Office' },
      big: eur(-amt),
      body: { de: `Vermögensabgabe: 4 % auf ${eur(wealth)} Vermögen plus 3 % auf dein Bargeld.`,
              en: `Wealth levy: 4% on ${eur(wealth)} of net worth plus 3% on your cash.` },
      list: [{ de: `Geht in den Gemeinschaftstopf (jetzt ${eur(Econ.fund)})`, en: `Goes into the common fund (now ${eur(Econ.fund)})` }],
      tip: { de: 'Aus diesem Topf werden Krisenhilfen und öffentliche Güter bezahlt. Steuern sind kein verlorenes Geld — sie sind gemeinsamer Einkauf.',
             en: 'This fund pays for crisis aid and public goods. Tax is not lost money — it is shared purchasing.' },
      buttons: [{ id: 'ok', label: STR.ok, primary: true }],
    });
    this.checkBroke(p);
  },

  async tileMarket(p) {
    const free = BOARD.map((t, i) => ({ t, i })).filter(x => x.t.type === T.ASSET && !this.assets[x.i]);
    if (!free.length) {
      const bonus = Math.round(Econ.fund * 0.25);
      Econ.fund -= bonus; p.cash += bonus;
      await UI.modal({ icon: '🔨', title: { de: 'Marktplatz', en: 'Marketplace' }, big: eur(bonus),
        body: { de: 'Nichts mehr zu versteigern — der Gemeinschaftstopf schüttet aus.', en: 'Nothing left to auction — the common fund pays out.' },
        buttons: [{ id: 'ok', label: STR.ok, primary: true }] });
      return;
    }
    const pick = free[(Math.random() * free.length) | 0];
    await UI.modal({
      icon: '🔨', color: '#ffd166', title: { de: 'Marktplatz — Zwangsversteigerung', en: 'Marketplace — Public Auction' },
      body: { de: `${tx(pick.t)} kommt unter den Hammer. Alle dürfen mitbieten!`, en: `${tx(pick.t)} goes under the hammer. Everyone may bid!` },
      tip: { de: 'Nur wer den Wert kennt, bietet richtig. Zu viel bieten heißt: gewinnen und trotzdem verlieren.',
             en: 'Only those who know the value bid well. Overbidding means winning and still losing.' },
      buttons: [{ id: 'ok', label: { de: 'Auktion starten', en: 'Start auction' }, primary: true }],
    });
    await this.runAuction(pick.i, -1);
  },

  /* ---------------------------------------------- Karten */
  drawMikro() { if (!this.mikroDeck.length) this.mikroDeck = this.shuffle(MIKRO.map((_, i) => i)); return MIKRO[this.mikroDeck.pop()]; },
  drawMakro() { if (!this.makroDeck.length) this.makroDeck = this.shuffle(MAKRO.map((_, i) => i)); return MAKRO[this.makroDeck.pop()]; },

  async cardMikro(p) {
    const c = this.drawMikro();
    await Scene.cardFlash('mikro');
    if (c.choices) {
      const res = await UI.modal({
        icon: '🎲', color: '#8ee06a', kind: 'mikro',
        title: { de: 'Alltag', en: 'Everyday Life' }, body: c, tip: c.tip,
        buttons: c.choices.map((ch, i) => ({ id: String(i), label: ch, primary: i === 0 })),
      });
      const ch = c.choices[+res] || c.choices[0];
      await this.applyPersonal(ch.eff, p, ch);
    } else {
      const pre = await this.previewPersonal(c.eff, p);
      await UI.modal({ icon: '🎲', color: '#8ee06a', kind: 'mikro', title: { de: 'Alltag', en: 'Everyday Life' },
        body: c, list: pre, tip: c.tip, buttons: [{ id: 'ok', label: STR.ok, primary: true }] });
      await this.applyPersonal(c.eff, p, c);
    }
    if (c.tip) this.teach(c.tip, '💡');
    Bus.emit('update');
  },

  async cardMakro(p) {
    const c = this.drawMakro();
    await Scene.cardFlash('makro');
    /* Charakter-Schutzschilde */
    let neutral = false;
    if (c.climate && (Econ.climateShield || p.traits.climateImmune)) neutral = true;
    const extra = [];
    if (c.weather && p.traits.weatherX2) extra.push({ de: `${p.name} ist Landwirt — Wetterkarten wirken doppelt.`, en: `${p.name} is a farmer — weather cards hit twice.` });
    if (neutral) extra.push({ de: 'Die Klimavorsorge greift — kein Schaden.', en: 'Climate protection kicks in — no damage.' });

    await UI.modal({
      icon: c.icon || '🌍', color: '#5ec8ff', kind: 'makro',
      title: c, body: c.text, list: extra, tip: c.tip,
      buttons: [{ id: 'ok', label: STR.ok, primary: true }],
    });
    if (!neutral) this.applyMacro(c.eff, p, c);
    this.teach(c.tip, c.icon || '🌍');
    Bus.emit('macro');
    Bus.emit('update');
  },

  /* ---------------------------------------------- Effekt-Motor (persönlich) */
  async previewPersonal(eff, p) {
    if (!eff) return [];
    const l = [];
    if (eff.cash) l.push({ de: `${eff.cash > 0 ? '+' : '−'}${eur(Math.abs(eff.cash * Econ.priceLevel))}`, en: `${eff.cash > 0 ? '+' : '−'}${eur(Math.abs(eff.cash * Econ.priceLevel))}` });
    if (eff.joy) l.push({ de: `Freude ${eff.joy > 0 ? '+' : ''}${eff.joy}`, en: `Joy ${eff.joy > 0 ? '+' : ''}${eff.joy}` });
    if (eff.edu) l.push({ de: `Bildung +${eff.edu}`, en: `Education +${eff.edu}` });
    if (eff.comm) l.push({ de: `Gemeinwohl +${eff.comm}`, en: `Community +${eff.comm}` });
    if (eff.kids) l.push({ de: `Kinder +${eff.kids}`, en: `Children +${eff.kids}` });
    if (eff.insurable && p.flags.insured) l.push({ de: 'Deine Versicherung übernimmt das!', en: 'Your insurance covers this!' });
    return l;
  },

  async applyPersonal(eff, p) {
    if (!eff) return;
    let cash = eff.cash || 0;
    if (cash < 0 && eff.insurable && p.flags.insured) {
      cash = 0;
      this.say({ de: 'Die Versicherung zahlt.', en: 'Insurance pays.' }, '🛡️');
    }
    if (cash) { p.cash += Math.round(cash * Econ.priceLevel); if (cash < 0) Econ.yearSpend += Math.abs(cash) * 0.3; }
    if (eff.joy) p.joy = Math.max(0, p.joy + eff.joy);
    if (eff.edu) p.edu += eff.edu;
    if (eff.comm) p.comm += eff.comm;
    if (eff.kids) p.kids += eff.kids;
    if (eff.salaryPct) p.salary = Math.round(p.salary * (1 + eff.salaryPct / 100));
    if (eff.save) { const s = Math.min(p.cash, Math.round(eff.save * Econ.priceLevel)); p.cash -= s; p.savings += s; }
    if (eff.flag) p.flags[eff.flag] = true;
    if (eff.roll) {
      const d = await Scene.rollDice(1);
      const val = d[0];
      const win = val >= eff.roll.need;
      await UI.modal({
        icon: win ? '🎉' : '😬', title: { de: `Gewürfelt: ${val}`, en: `Rolled: ${val}` },
        body: win ? { de: 'Geschafft!', en: 'Success!' } : { de: 'Diesmal nicht.', en: 'Not this time.' },
        buttons: [{ id: 'ok', label: STR.ok, primary: true }],
      });
      await this.applyPersonal(win ? eff.roll.win : eff.roll.lose, p);
    }
    this.checkBroke(p);
  },

  /* ---------------------------------------------- Effekt-Motor (Makro) */
  applyMacro(eff, drawer) {
    if (!eff) return;
    if (eff.sector) for (const k in eff.sector) Econ.hitSector(k, eff.sector[k]);
    if (eff.allSectors) Econ.hitAllSectors(eff.allSectors);
    if (eff.stock) for (const k in eff.stock) Econ.hitStock(k, eff.stock[k]);
    if (eff.market) Econ.hitMarket(eff.market);
    if (eff.inflation) Econ.inflation = clamp(Econ.inflation + eff.inflation, -2, 14);
    if (eff.rate) Econ.rate = clamp(Econ.rate + eff.rate, 0, 15);
    if (eff.growth) Econ.growth = clamp(Econ.growth + eff.growth, -4, 6);
    if (eff.tax) Econ.tax = clamp(Econ.tax + eff.tax, 5, 55);
    if (eff.fund) Econ.fund = Math.max(0, Math.round(Econ.fund * (1 + eff.fund / 100)));
    if (eff.flagGlobal) Econ[eff.flagGlobal] = true;

    for (const p of this.players) {
      if (eff.all) {
        let e = { ...eff.all };
        if (e.cash && drawer && drawer.weather && p.traits.weatherX2) e.cash *= 2;
        if (e.cash) p.cash += Math.round(e.cash * Econ.priceLevel);
        if (e.joy) p.joy = Math.max(0, p.joy + e.joy);
        if (e.edu) p.edu += e.edu;
        if (e.salaryPct) p.salary = Math.round(p.salary * (1 + e.salaryPct / 100));
      }
      if (eff.ifAssets && p.assets().length >= eff.ifAssets.min) p.cash += Math.round(eff.ifAssets.cash * Econ.priceLevel);
      if (eff.ifEdu && p.edu >= eff.ifEdu.min && eff.ifEdu.salaryPct) p.salary = Math.round(p.salary * (1 + eff.ifEdu.salaryPct / 100));
      if (eff.ifNoSector) {
        const has = p.assets().some(a => BOARD[a.idx].sector === eff.ifNoSector.sector);
        if (!has) {
          const amt = Math.round(eff.ifNoSector.cash * Econ.priceLevel);
          p.cash += amt;
          if (eff.ifNoSector.toFund) Econ.fund += Math.abs(amt);
        }
      }
      if (eff.nonMonopolists && this.monopolies(p).length === 0) p.cash += Math.round(eff.nonMonopolists.cash * Econ.priceLevel);
    }
    if (eff.poorest) {
      const sorted = [...this.players].sort((a, b) => a.netWorth() - b.netWorth()).slice(0, eff.poorest.n);
      for (const q of sorted) q.cash += Math.round(eff.poorest.cash * Econ.priceLevel);
    }
    for (const p of this.players) this.checkBroke(p);
  },

  /* ---------------------------------------------- Pleite-Schutz */
  checkBroke(p) {
    if (p.cash >= 0) return;
    const need = -p.cash;
    if (p.savings > 0) { const take = Math.min(p.savings, need); p.savings -= take; p.cash += take; }
    if (p.cash >= 0) return;
    /* Notkredit statt Ausscheiden — niemand fliegt raus.
       Aber der Zins tut weh: genau so entsteht eine Schuldenspirale. */
    const gap = Math.ceil((-p.cash) / 100) * 100;
    p.cash += gap; p.debt += Math.round(gap * 1.1);
    this.say({ de: `${p.name} braucht einen Notkredit über ${eur(gap)} (mit 10 % Aufschlag).`,
               en: `${p.name} needs an emergency loan of ${eur(gap)} (10% premium).` }, '⚠️');
    if (!p.flags.taughtDebt) {
      p.flags.taughtDebt = true;
      this.teach({ de: 'Schuldenspirale: Wer im Minus ist, zahlt Zinsen — und rutscht dadurch weiter ins Minus. Deshalb hilft ein Puffer mehr als jede Rendite.',
                   en: 'Debt spiral: being in the red means paying interest — which pushes you further into the red. A buffer helps more than any return.' }, '⚠️');
    }
  },

  /* ---------------------------------------------- Zug beenden / Runde */
  async endTurn() {
    if (this.over) return;
    Bus.emit('canRoll', false); Bus.emit('canEnd', false);
    this.cur++;
    if (this.cur >= this.players.length) {
      this.cur = 0;
      await this.endRound();
      if (this.over) return;
    }
    Bus.emit('update');
    this.beginTurn();
  },

  async endRound() {
    this.round++;
    this.quarter++;
    if (this.quarter > 4) {
      this.quarter = 1; this.year++;
      const changed = Econ.tickYear(this.players.length, (o, i) => this.teach(o, i));
      await UI.yearReport(changed);
      Bus.emit('macro');
      if (Econ.antitrust) {
        for (const p of this.players) {
          const m = this.monopolies(p);
          if (m.length) { const fine = 400 * m.length; p.cash -= fine; Econ.fund += fine;
            this.say({ de: `Kartellstrafe für ${p.name}: ${eur(fine)}`, en: `Antitrust fine for ${p.name}: ${eur(fine)}` }, '⚖️'); }
        }
      }
      await this.election();
    }
    if (this.round > this.maxRounds) { await this.finish(); return; }
    Bus.emit('round', this.round);
  },

  /* ---------------------------------------------- Wahl */
  async election() {
    const opts = this.shuffle([...POLICIES]).slice(0, 3);
    const res = await UI.election(opts, this.players);
    if (!res) return;
    const pol = opts[res.winner];
    this.applyMacro(pol.eff);
    if (pol.eff.all) { /* bereits in applyMacro */ }
    this.say({ de: `Beschlossen: ${tx(pol)}`, en: `Adopted: ${tx(pol)}` }, pol.icon);
    this.teach(pol.tip, pol.icon);
    Bus.emit('update');
  },

  /* ---------------------------------------------- Ende */
  async finish() {
    this.over = true;
    const rank = [...this.players].sort((a, b) => b.lifeScore() - a.lifeScore());
    Bus.emit('over', rank);
    await UI.gameOver(rank);
  },
};
