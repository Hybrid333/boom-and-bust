/* ============================================================
   BOOM & BUST — scene.js
   three.js: Spielbrett · Figuren · Würfel · Kamera-Flip · Zoom
   Alle Animationen geben Promises zurück, damit game.js sie awaiten kann.
   ============================================================ */
'use strict';

const Scene = (() => {
  let renderer, scene, camera, canvas, raf = 0, lastT = 0, lastTick = 0, usingFallback = false;
  const clock = { t: 0 };

  /* Brett-Geometrie */
  const H = 17, STEP = 3.4, TW = 3.15, TD = 4.2, CS = 4.2;
  const tokens = [], anims = [];
  let boardGroup, tileMeshes = [], assetGroups = [], diceMeshes = [], centerGroup;
  let pillars = {}, phaseRing, phaseRingMat;

  /* ---------------------------------------------- Kamera-Controller */
  const CAM = { tx: 0, ty: 0, tz: 0, dist: 62, yaw: 0, pitch: 1.12 };
  const CAMT = { tx: 0, ty: 0, tz: 0, dist: 44, yaw: 0, pitch: 0.95, ease: 0.08 };

  function camTo(o, ease) {
    Object.assign(CAMT, o);
    CAMT.ease = ease || 0.09;
  }
  function applyCam() {
    const e = CAMT.ease;
    CAM.tx += (CAMT.tx - CAM.tx) * e;
    CAM.ty += (CAMT.ty - CAM.ty) * e;
    CAM.tz += (CAMT.tz - CAM.tz) * e;
    CAM.dist += (CAMT.dist - CAM.dist) * e;
    CAM.pitch += (CAMT.pitch - CAM.pitch) * e;
    let dy = CAMT.yaw - CAM.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    CAM.yaw += dy * e;
    const r = CAM.dist * Math.cos(CAM.pitch * 0.5 + 0.1);
    camera.position.set(
      CAM.tx + Math.sin(CAM.yaw) * r,
      CAM.ty + CAM.dist * Math.sin(CAM.pitch),
      CAM.tz + Math.cos(CAM.yaw) * r
    );
    camera.lookAt(CAM.tx, CAM.ty + 1.2, CAM.tz);
  }
  function camSettled(tol) {
    tol = tol || 0.6;
    return Math.abs(CAMT.dist - CAM.dist) < tol &&
      Math.abs(CAMT.tx - CAM.tx) < tol && Math.abs(CAMT.tz - CAM.tz) < tol;
  }

  /* ---------------------------------------------- Feldpositionen */
  function tilePos(i) {
    if (i === 0) return [H, H];
    if (i < 10) return [H - i * STEP, H];
    if (i === 10) return [-H, H];
    if (i < 20) return [-H, H - (i - 10) * STEP];
    if (i === 20) return [-H, -H];
    if (i < 30) return [-H + (i - 20) * STEP, -H];
    if (i === 30) return [H, -H];
    return [H, -H + (i - 30) * STEP];
  }
  function tileSide(i) { return i < 10 ? 0 : i < 20 ? 1 : i < 30 ? 2 : 3; }
  function tileRot(i) { return [0, Math.PI / 2, Math.PI, -Math.PI / 2][tileSide(i)]; }
  /* Richtung „nach innen" für Gebäude und Labels */
  function inward(i) { const s = tileSide(i); return [[0, -1], [1, 0], [0, 1], [-1, 0]][s]; }

  /* ---------------------------------------------- Canvas-Texturen */
  function labelTexture(text, sub, icon, css, wide) {
    const W = wide ? 256 : 220, Hc = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = Hc;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, Hc);
    if (icon) { g.font = '78px serif'; g.textAlign = 'center'; g.fillText(icon, W / 2, 92); }
    g.fillStyle = css || '#e9eef5';
    g.font = 'bold 27px "Segoe UI",sans-serif'; g.textAlign = 'center';
    const words = String(text).split(' '); const lines = []; let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 13) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    let y = icon ? 138 : 110;
    for (const l of lines.slice(0, 3)) { g.fillText(l, W / 2, y); y += 31; }
    if (sub) { g.fillStyle = 'rgba(230,240,255,.72)'; g.font = '22px "Segoe UI",sans-serif'; g.fillText(sub, W / 2, y + 8); }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function pipTexture(n, fg, bg) {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    g.fillStyle = fg;
    const P = [[.5, .5]], q = .28, h = .5, e = 1 - q;
    const map = {
      1: [[h, h]], 2: [[q, q], [e, e]], 3: [[q, q], [h, h], [e, e]],
      4: [[q, q], [e, q], [q, e], [e, e]],
      5: [[q, q], [e, q], [h, h], [q, e], [e, e]],
      6: [[q, q], [e, q], [q, h], [e, h], [q, e], [e, e]],
    };
    for (const [x, y] of (map[n] || P)) {
      g.beginPath(); g.arc(x * S, y * S, S * .085, 0, 7); g.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  /* ---------------------------------------------- Figuren bauen */
  function buildAvatar(char) {
    const g = new THREE.Group();
    const cloth = new THREE.MeshLambertMaterial({ color: char.cloth });
    const skin = new THREE.MeshLambertMaterial({ color: char.skin });
    const hair = new THREE.MeshLambertMaterial({ color: char.hair });

    /* Sockel in Spielerfarbe */
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.78, .92, .22, 20),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(char.color) }));
    base.position.y = .11; g.add(base);

    /* Körper */
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.42, .58, 1.15, 16), cloth);
    body.position.y = .8; body.castShadow = true; g.add(body);
    /* Arme */
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .78, 8), cloth);
      arm.position.set(s * .5, .88, 0); arm.rotation.z = s * .35; g.add(arm);
    }
    /* Kopf */
    const head = new THREE.Mesh(new THREE.SphereGeometry(.42, 20, 16), skin);
    head.position.y = 1.72; head.castShadow = true; g.add(head);
    /* Haar */
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(.44, 18, 12, 0, 6.3, 0, 1.15), hair);
    hairM.position.y = 1.75; g.add(hairM);
    /* Augen */
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 8), new THREE.MeshBasicMaterial({ color: 0x1a1a22 }));
      eye.position.set(s * .15, 1.75, .38); g.add(eye);
    }

    /* Charakter-Requisite — jede Figur ist eindeutig erkennbar */
    const prop = new THREE.Group();
    const acc = new THREE.MeshLambertMaterial({ color: new THREE.Color(char.color) });
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f5fa });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a3140 });
    switch (char.id) {
      case 'inventor': {                       // schwebendes Zahnrad
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.36, .1, 8, 14), acc);
        ring.position.set(0, 2.72, 0); ring.rotation.x = Math.PI / 2; prop.add(ring);
        for (let i = 0; i < 6; i++) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(.12, .1, .16), acc);
          const a = i / 6 * 6.283;
          tooth.position.set(Math.cos(a) * .46, 2.72, Math.sin(a) * .46); prop.add(tooth);
        }
        prop.userData.spin = 1.6; break;
      }
      case 'baker': {                          // Kochmütze
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(.34, .3, .42, 14), white);
        hat.position.y = 2.24; prop.add(hat);
        const puff = new THREE.Mesh(new THREE.SphereGeometry(.4, 14, 10), white);
        puff.position.y = 2.5; puff.scale.y = .72; prop.add(puff);
        break;
      }
      case 'coder': {                          // Laptop
        const bot = new THREE.Mesh(new THREE.BoxGeometry(.7, .07, .5), dark);
        bot.position.set(0, 1.05, .52); prop.add(bot);
        const top = new THREE.Mesh(new THREE.BoxGeometry(.7, .5, .06), dark);
        top.position.set(0, 1.28, .32); top.rotation.x = -.35; prop.add(top);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(.6, .4),
          new THREE.MeshBasicMaterial({ color: 0x7ee081 }));
        scr.position.set(0, 1.29, .36); scr.rotation.x = -.35; prop.add(scr);
        break;
      }
      case 'farmer': {                         // Strohhut
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(.78, .82, .07, 18),
          new THREE.MeshLambertMaterial({ color: 0xe0c070 }));
        brim.position.y = 2.06; prop.add(brim);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(.36, .42, .38, 14),
          new THREE.MeshLambertMaterial({ color: 0xe0c070 }));
        crown.position.y = 2.26; prop.add(crown);
        break;
      }
      case 'doctor': {                         // Stethoskop + Kreuz
        const cross1 = new THREE.Mesh(new THREE.BoxGeometry(.44, .14, .08), white);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(.14, .44, .08), white);
        cross1.position.set(0, 1.02, .58); cross2.position.set(0, 1.02, .58);
        prop.add(cross1, cross2);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.3, .05, 6, 16), dark);
        ring.position.set(0, 1.42, .2); ring.rotation.x = .4; prop.add(ring);
        break;
      }
      case 'musician': {                       // Gitarre
        const bodyG = new THREE.Mesh(new THREE.SphereGeometry(.36, 12, 10), acc);
        bodyG.scale.set(1, 1.15, .38); bodyG.position.set(.62, .82, .22);
        bodyG.rotation.z = -.5; prop.add(bodyG);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(.12, .95, .1),
          new THREE.MeshLambertMaterial({ color: 0x8a5a2a }));
        neck.position.set(.98, 1.4, .22); neck.rotation.z = -.5; prop.add(neck);
        break;
      }
      case 'builder': {                        // Bauhelm
        const helm = new THREE.Mesh(new THREE.SphereGeometry(.46, 16, 10, 0, 6.3, 0, 1.3), acc);
        helm.position.y = 1.82; prop.add(helm);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(.56, .58, .06, 16), acc);
        brim.position.y = 1.86; prop.add(brim);
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(.1, .12, .9), acc);
        ridge.position.y = 2.16; prop.add(ridge);
        break;
      }
      case 'eco': {                            // Blatt über dem Kopf
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(.34, 12, 10), acc);
        leaf.scale.set(.45, 1, 1.5); leaf.position.set(0, 2.5, 0); leaf.rotation.z = .5;
        prop.add(leaf);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .5, 6),
          new THREE.MeshLambertMaterial({ color: 0x4a7a3a }));
        stem.position.set(0, 2.2, 0); prop.add(stem);
        prop.userData.spin = .8; break;
      }
    }
    g.add(prop);
    g.userData.prop = prop;
    g.userData.body = body;
    return g;
  }

  /* ---------------------------------------------- Brett bauen */
  function buildBoard() {
    boardGroup = new THREE.Group(); scene.add(boardGroup);

    /* Tischplatte */
    const table = new THREE.Mesh(new THREE.CylinderGeometry(46, 48, 1.4, 48),
      new THREE.MeshLambertMaterial({ color: 0x1b2534 }));
    table.position.y = -1.0; table.receiveShadow = true; boardGroup.add(table);

    /* Brettfläche */
    const plate = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + TD, .55, H * 2 + TD),
      new THREE.MeshLambertMaterial({ color: 0x243349 }));
    plate.position.y = -.28; plate.receiveShadow = true; boardGroup.add(plate);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(H * 2 - TD, .5, H * 2 - TD),
      new THREE.MeshLambertMaterial({ color: 0x16202e }));
    inner.position.y = .04; inner.receiveShadow = true; boardGroup.add(inner);

    /* Felder */
    tileMeshes = []; assetGroups = [];
    for (let i = 0; i < N_TILES; i++) {
      const tile = BOARD[i];
      const [x, z] = tilePos(i);
      const corner = (i % 10 === 0);
      const w = corner ? CS : TW, d = corner ? CS : TD;
      const grp = new THREE.Group();
      grp.position.set(x, 0, z); grp.rotation.y = tileRot(i);
      boardGroup.add(grp);

      const isAsset = tile.type === T.ASSET;
      const col = isAsset ? SECTORS[tile.sector].color : (corner ? 0x35455f : 0x2b3a52);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, .3, d),
        new THREE.MeshLambertMaterial({ color: corner ? 0x3a4c68 : 0x2d3d55 }));
      top.position.y = .18; top.receiveShadow = true; grp.add(top);

      /* Farbband am äußeren Rand — die Sektorfarbe */
      if (isAsset) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w, .34, .72),
          new THREE.MeshLambertMaterial({ color: col }));
        band.position.set(0, .2, -d / 2 + .36); grp.add(band);
      }

      /* Beschriftung */
      const label = isAsset
        ? labelTexture(tx(tile), secName(tile.sector), SECTORS[tile.sector].icon, '#eef3fa')
        : labelTexture(tx(tile), '', tile.icon || '', '#dce6f5', corner);
      const lm = new THREE.Mesh(new THREE.PlaneGeometry(w * .92, d * .78),
        new THREE.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false }));
      lm.rotation.x = -Math.PI / 2; lm.position.set(0, .34, .3);
      grp.add(lm);

      /* Halter für Gebäude */
      const ag = new THREE.Group(); ag.position.y = .33; grp.add(ag);
      assetGroups[i] = ag;
      tileMeshes[i] = grp;
      grp.userData = { i, top, base: 0.18 };
    }

    /* ------- Mitte: das lebende Wirtschafts-Dashboard ------- */
    centerGroup = new THREE.Group(); boardGroup.add(centerGroup);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10, .5, 40),
      new THREE.MeshLambertMaterial({ color: 0x1c2a3d }));
    pad.position.y = .3; pad.receiveShadow = true; centerGroup.add(pad);

    phaseRingMat = new THREE.MeshBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: .85 });
    phaseRing = new THREE.Mesh(new THREE.TorusGeometry(9.9, .3, 10, 64), phaseRingMat);
    phaseRing.rotation.x = Math.PI / 2; phaseRing.position.y = .58; centerGroup.add(phaseRing);

    /* Vier Säulen: Wachstum, Inflation, Zins, Arbeitslosigkeit */
    const defs = [
      { k: 'growth', c: 0x7ee081, x: -4.2, z: -1.6, icon: '📈' },
      { k: 'inflation', c: 0xffb03a, x: -1.4, z: -1.6, icon: '🔥' },
      { k: 'rate', c: 0x5ec8ff, x: 1.4, z: -1.6, icon: '🏛️' },
      { k: 'unemp', c: 0xff6b8a, x: 4.2, z: -1.6, icon: '👷' },
    ];
    pillars = {};
    for (const d of defs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6),
        new THREE.MeshLambertMaterial({ color: d.c }));
      m.position.set(d.x, .55, d.z); m.castShadow = true;
      centerGroup.add(m);
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: labelTexture('', '', d.icon, '#fff'), transparent: true, depthWrite: false }));
      cap.rotation.x = -Math.PI / 2; cap.position.set(d.x, .58, d.z + 1.7);
      centerGroup.add(cap);
      pillars[d.k] = m;
    }

    /* Kein Schriftzug in der Mitte: Die Kamera dreht sich zu jedem Spieler,
       flache Schrift stünde für die halbe Runde auf dem Kopf. Stattdessen
       ein neutraler Ring, der aus jeder Richtung gleich aussieht. */
    const emblem = new THREE.Mesh(new THREE.TorusGeometry(2.6, .16, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: .5 }));
    emblem.rotation.x = Math.PI / 2; emblem.position.set(0, .57, 6.4); centerGroup.add(emblem);

    /* Kartenstapel */
    const deckMat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const mikroDeck = new THREE.Mesh(new THREE.BoxGeometry(3.6, .5, 2.6), deckMat(0x8ee06a));
    mikroDeck.position.set(-4.6, .8, 3.6); mikroDeck.rotation.y = .35; centerGroup.add(mikroDeck);
    const makroDeck = new THREE.Mesh(new THREE.BoxGeometry(3.6, .5, 2.6), deckMat(0x5ec8ff));
    makroDeck.position.set(4.6, .8, 3.6); makroDeck.rotation.y = -.35; centerGroup.add(makroDeck);
    Scene._decks = { mikro: mikroDeck, makro: makroDeck };

    /* Würfel */
    diceMeshes = [];
    for (let d = 0; d < 2; d++) {
      const mats = [1, 6, 2, 5, 3, 4].map(n => new THREE.MeshLambertMaterial({
        map: pipTexture(n, d ? '#1b2a3a' : '#2a1b1b', d ? '#dfe9f5' : '#ffd9d9'),
      }));
      const die = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), mats);
      die.position.set(-2.2 + d * 4.4, 1.5, -5.5); die.castShadow = true;
      die.visible = false;
      centerGroup.add(die);
      diceMeshes.push(die);
    }
  }

  /* Würfel-Endrotation, damit die gewürfelte Zahl auch wirklich oben liegt.
     Materialreihenfolge der BoxGeometry ist [+x, −x, +y, −y, +z, −z],
     bestückt mit den Augenzahlen [1, 6, 2, 5, 3, 4] — gegenüberliegende
     Seiten ergeben also wie beim echten Würfel zusammen 7.
     Die Drehung muss die Fläche mit der Zahl nach +y bringen:
       1 liegt auf +x  → Drehung um z um +90°
       6 liegt auf −x  → Drehung um z um −90°
       2 liegt auf +y  → keine Drehung
       5 liegt auf −y  → Drehung um x um 180°
       3 liegt auf +z  → Drehung um x um −90°
       4 liegt auf −z  → Drehung um x um +90°                              */
  const FACE_ROT = {
    1: [0, 0, Math.PI / 2], 6: [0, 0, -Math.PI / 2], 2: [0, 0, 0],
    5: [Math.PI, 0, 0], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0],
  };

  /* ---------------------------------------------- Figuren-Verwaltung */
  function tokenSlot(idx, k, n) {
    const [x, z] = tilePos(idx);
    const [ix, iz] = inward(idx);
    const cols = Math.min(3, n), row = Math.floor(k / cols), col = k % cols;
    const spread = 0.82;
    const px = (col - (cols - 1) / 2) * spread;
    const pz = row * .78;
    /* entlang der Feldachse verteilen, in Richtung Brettmitte gestaffelt */
    const s = tileSide(idx);
    let ox, oz;
    if (s === 0 || s === 2) { ox = px; oz = -iz * (0.35 + pz) * -1; oz = iz * (0.3 + pz); }
    else { oz = px; ox = ix * (0.3 + pz); }
    return [x + ox, z + oz];
  }

  function layoutTile(idx) {
    const here = tokens.filter(t => t.tileIdx === idx);
    here.forEach((tk, k) => {
      const [x, z] = tokenSlot(idx, k, here.length);
      tk.homeX = x; tk.homeZ = z;
      if (!tk.moving) { tk.obj.position.x = x; tk.obj.position.z = z; }
    });
  }

  /* ---------------------------------------------- Animations-Helfer */
  let SPEED = 1;                       // Animationstempo (1× / 1,5× / 2×)

  /* Eine Animation, die IMMER endet.
     Browser drosseln die Render-Schleife in Hintergrund-Tabs stark. Ohne
     Netz würde ein Promise dann nie auflösen und der Spielzug hinge fest.
     Deshalb bekommt jede Animation zusätzlich eine Uhrzeit-Bremse:
     läuft die Schleife normal, greift sie nie.                            */
  function anim(dur, step, done) {
    const d = Math.max(.03, dur / SPEED);
    return new Promise(res => {
      const a = { t: 0, dur: d, step, closed: false, to: 0 };
      a.fin = () => {
        if (a.closed) return;
        a.closed = true;
        clearTimeout(a.to);
        const i = anims.indexOf(a);
        if (i >= 0) anims.splice(i, 1);
        try { a.step(1, 0); } catch (e) { Scene._lastErr = String(e && e.stack || e); }
        try { if (done) done(); } catch (e) { Scene._lastErr = String(e && e.stack || e); }
        res();
      };
      a.to = setTimeout(a.fin, d * 1000 + 260);
      anims.push(a);
    });
  }
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ---------------------------------------------- Render-Schleife */
  function tick(now) {
    const dt = Math.min(.05, (now - lastT) / 1000 || .016);
    lastT = now; lastTick = now; clock.t += dt;

    /* Animationen — ein Fehler in einem Schritt darf niemals die
       ganze Schleife anhalten, sonst hängt der Spielzug für immer. */
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      if (a.closed) { anims.splice(i, 1); continue; }
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      if (p >= 1) { a.fin(); continue; }
      try { a.step(p, dt); } catch (e) { Scene._lastErr = String(e && e.stack || e); }
    }

    /* Requisiten drehen, Figuren atmen */
    for (const tk of tokens) {
      const pr = tk.obj.userData.prop;
      if (pr && pr.userData.spin) pr.rotation.y += pr.userData.spin * dt;
      if (tk.active) {
        tk.obj.position.y = Math.abs(Math.sin(clock.t * 3.2)) * .26;
        tk.obj.rotation.y += dt * .9;
      } else {
        tk.obj.position.y += (0 - tk.obj.position.y) * .15;
      }
    }

    /* Wirtschafts-Säulen live */
    if (pillars.growth) {
      const set = (m, v) => { const h = Math.max(.35, v); m.scale.y = m.scale.y + (h - m.scale.y) * .07; m.position.y = .3 + m.scale.y / 2; };
      set(pillars.growth, 1 + Math.max(0, Econ.growth) * 1.1);
      set(pillars.inflation, 1 + Math.max(0, Econ.inflation) * .55);
      set(pillars.rate, 1 + Math.max(0, Econ.rate) * .5);
      set(pillars.unemp, 1 + Math.max(0, Econ.unemp - 2) * .5);
      if (phaseRingMat) {
        phaseRingMat.color.set(Econ.phaseColor());
        phaseRingMat.opacity = .6 + Math.sin(clock.t * 2) * .22;
      }
      if (phaseRing) phaseRing.rotation.z += dt * .2;
    }

    applyCam();
    renderer.render(scene, camera);

    /* immer genau EINE laufende rAF-Kette */
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  /* Wachhund: Browser drosseln requestAnimationFrame in Hintergrund-Tabs.
     Ohne Gegenmaßnahme würden dann Animations-Promises nie auflösen und
     der Spielzug bliebe für immer hängen. Läuft die Schleife normal,
     tut der Wachhund nichts.                                            */
  function startLoop() {
    lastTick = performance.now();
    raf = requestAnimationFrame(tick);
    setInterval(() => {
      const now = performance.now();
      if (now - lastTick > 260) { usingFallback = true; tick(now); }
    }, 90);
  }

  /* ============================================================ API */
  return {
    _decks: null,

    setSpeed(v) { SPEED = v; },
    getSpeed() { return SPEED; },
    _lastErr: null,
    stats() {
      return {
        anims: anims.length, lastTick: Math.round(performance.now() - lastTick),
        fallback: usingFallback, tokens: tokens.length, err: Scene._lastErr,
        cam: { d: +CAM.dist.toFixed(1), yaw: +CAM.yaw.toFixed(2) },
        pending: anims.map(a => +(a.t / a.dur).toFixed(2)),
      };
    },

    init(cv) {
      canvas = cv;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0c121c);
      scene.fog = new THREE.Fog(0x0c121c, 70, 150);

      camera = new THREE.PerspectiveCamera(45, 1, .5, 300);

      scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x1a2230, .78));
      const sun = new THREE.DirectionalLight(0xfff2dd, .95);
      sun.position.set(24, 46, 20); sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const S = 40;
      sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
      sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
      sun.shadow.camera.far = 140;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0x88aaff, .3);
      fill.position.set(-30, 20, -25); scene.add(fill);

      buildBoard();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      startLoop();
    },

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    },

    /* ------- Figuren ------- */
    addPlayers(players) {
      for (const tk of tokens) boardGroup.remove(tk.obj);
      tokens.length = 0;
      players.forEach(p => {
        const obj = buildAvatar(p.char);
        obj.scale.setScalar(1.0);
        boardGroup.add(obj);
        const tk = { p, obj, tileIdx: 0, moving: false, active: false, homeX: 0, homeZ: 0 };
        tokens.push(tk);
      });
      layoutTile(0);
      for (const tk of tokens) { tk.obj.position.set(tk.homeX, 0, tk.homeZ); }
    },

    tokenOf(p) { return tokens.find(t => t.p === p); },

    setActive(p) { for (const tk of tokens) tk.active = (tk.p === p); },

    /* ------- Kamera ------- */
    setOverview(fast) {
      camTo({ tx: 0, ty: 0, tz: 0, dist: 44, pitch: .95 }, fast ? .25 : .07);
    },

    /* „Der Bildschirm dreht sich zu dem, der dran ist." */
    flipToSeat(p) {
      const n = Game.players.length;
      const yaw = (p.seat / n) * Math.PI * 2;
      Scene.setActive(p);
      Bus.emit('seat', { p, deg: (p.seat / n) * 360 });
      camTo({ yaw, tx: 0, tz: 0, dist: 46, pitch: .92 }, .085);
      return anim(1.0, () => { });
    },

    focusTile(idx) {
      const [x, z] = tilePos(idx);
      const n = Game.players.length;
      const yaw = Game.seatFlip ? (Game.p().seat / n) * Math.PI * 2 : CAMT.yaw;
      camTo({ tx: x * .72, tz: z * .72, dist: 26, pitch: .62, yaw }, .12);
      return anim(.75, () => { });
    },

    /* ------- Würfeln ------- */
    rollDice(count) {
      count = count || 2;
      const vals = [];
      for (let i = 0; i < count; i++) vals.push(1 + ((Math.random() * 6) | 0));
      const n = Game.players.length;
      const yaw = Game.seatFlip ? (Game.p().seat / n) * Math.PI * 2 : CAMT.yaw;
      camTo({ tx: 0, tz: -3.5, dist: 22, pitch: .55, yaw }, .14);
      Bus.emit('dice', { rolling: true });

      diceMeshes.forEach((d, i) => {
        d.visible = i < count;
        d.position.set(-2.2 + i * 4.4, 8, -5.5);
        d.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      });

      const spins = diceMeshes.map(() => ({
        x: (Math.random() * 8 + 8) * (Math.random() < .5 ? -1 : 1),
        y: (Math.random() * 8 + 8) * (Math.random() < .5 ? -1 : 1),
        z: (Math.random() * 8 + 8) * (Math.random() < .5 ? -1 : 1),
      }));
      const startRot = diceMeshes.map(d => ({ x: d.rotation.x, y: d.rotation.y, z: d.rotation.z }));

      return anim(1.25, (t) => {
        for (let i = 0; i < count; i++) {
          const d = diceMeshes[i];
          /* Hüpfen */
          const bounce = Math.abs(Math.sin(t * Math.PI * 2.4)) * (1 - t) * 5.2;
          d.position.y = 1.0 + bounce;
          if (t < .78) {
            d.rotation.x = startRot[i].x + spins[i].x * t;
            d.rotation.y = startRot[i].y + spins[i].y * t;
            d.rotation.z = startRot[i].z + spins[i].z * t;
          } else {
            /* sanft in die Endlage einrasten */
            const k = (t - .78) / .22;
            const target = FACE_ROT[vals[i]];
            d.rotation.x += (target[0] - d.rotation.x) * (.12 + k * .3);
            d.rotation.y += (0 - d.rotation.y) * (.12 + k * .3);
            d.rotation.z += (target[2] - d.rotation.z) * (.12 + k * .3);
          }
        }
      }, () => {
        for (let i = 0; i < count; i++) {
          const target = FACE_ROT[vals[i]];
          diceMeshes[i].rotation.set(target[0], 0, target[2]);
          diceMeshes[i].position.y = 1.0;
        }
        Bus.emit('dice', { rolling: false, vals });
      }).then(() => new Promise(r => setTimeout(() => r(vals), 420 / SPEED)));
    },

    /* ------- Bewegung ------- */
    async movePlayer(p, path) {
      const tk = this.tokenOf(p);
      if (!tk) return;
      tk.moving = true;
      const n = Game.players.length;
      const yaw = Game.seatFlip ? (p.seat / n) * Math.PI * 2 : CAMT.yaw;
      for (let s = 0; s < path.length; s++) {
        const idx = path[s];
        const from = { x: tk.obj.position.x, z: tk.obj.position.z };
        const [tx0, tz0] = tilePos(idx);
        /* Kamera folgt der Figur */
        camTo({ tx: tx0 * .55, tz: tz0 * .55, dist: 36, pitch: .78, yaw }, .1);
        const dur = Math.max(.18, .34 - path.length * .012);
        await anim(dur, (t) => {
          tk.obj.position.x = from.x + (tx0 - from.x) * t;
          tk.obj.position.z = from.z + (tz0 - from.z) * t;
          tk.obj.position.y = Math.sin(t * Math.PI) * 1.5;
          tk.obj.rotation.y += .22;
        });
        tk.tileIdx = idx;
        Bus.emit('step', { p, idx, left: path.length - s - 1 });
      }
      tk.moving = false;
      tk.obj.position.y = 0;
      layoutTile(tk.tileIdx);
      /* saubere Endposition */
      await anim(.18, (t) => {
        tk.obj.position.x += (tk.homeX - tk.obj.position.x) * .35;
        tk.obj.position.z += (tk.homeZ - tk.obj.position.z) * .35;
      });
      const others = new Set(tokens.map(t => t.tileIdx));
      others.forEach(i => layoutTile(i));
    },

    async teleport(p, idx) {
      const tk = this.tokenOf(p);
      if (!tk) return;
      const from = { x: tk.obj.position.x, z: tk.obj.position.z };
      const [x, z] = tilePos(idx);
      await anim(.6, (t) => {
        tk.obj.position.x = from.x + (x - from.x) * ease(t);
        tk.obj.position.z = from.z + (z - from.z) * ease(t);
        tk.obj.position.y = Math.sin(t * Math.PI) * 7;
        tk.obj.rotation.y += .3;
      });
      tk.tileIdx = idx; tk.obj.position.y = 0;
      layoutTile(idx);
    },

    /* ------- Besitz & Gebäude ------- */
    markAsset(idx, p) {
      const ag = assetGroups[idx];
      if (!ag) return;
      while (ag.children.length) ag.remove(ag.children[0]);
      const flag = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.5, 6),
        new THREE.MeshLambertMaterial({ color: 0xdde6f2 }));
      flag.position.set(-1.05, .75, -1.2); ag.add(flag);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color), side: THREE.DoubleSide }));
      cloth.position.set(-.63, 1.28, -1.2); ag.add(cloth);
      ag.userData.owner = p;
      this.upgradeAsset(idx, Game.assetAt(idx) ? Game.assetAt(idx).level : 0, p, true);
      /* kurzer Aufblitz */
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.9, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .1; ag.add(ring);
      anim(.9, (t) => { ring.scale.setScalar(1 + t * 1.6); ring.material.opacity = .8 * (1 - t); },
        () => ag.remove(ring));
    },

    upgradeAsset(idx, level, p, silent) {
      const ag = assetGroups[idx];
      if (!ag) return;
      /* alte Gebäude entfernen (Fahne behalten) */
      for (let i = ag.children.length - 1; i >= 0; i--) {
        if (ag.children[i].userData.bld) ag.remove(ag.children[i]);
      }
      const col = new THREE.Color(p ? p.color : '#ffffff');
      const tile = BOARD[idx];
      const sc = new THREE.Color(SECTORS[tile.sector] ? SECTORS[tile.sector].color : 0x8899aa);
      for (let b = 0; b < level; b++) {
        const hgt = .5 + b * .42;
        const m = new THREE.Mesh(new THREE.BoxGeometry(.62, hgt, .62),
          new THREE.MeshLambertMaterial({ color: sc.clone().lerp(col, .45) }));
        m.position.set(-.75 + b * .52, hgt / 2, .5);
        m.castShadow = true; m.userData.bld = true;
        ag.add(m);
        if (!silent && b === level - 1) {
          m.scale.y = .05;
          anim(.45, (t) => { m.scale.y = .05 + .95 * ease(t); m.position.y = hgt / 2 * m.scale.y; });
        }
      }
    },

    clearAsset(idx) {
      const ag = assetGroups[idx];
      if (!ag) return;
      while (ag.children.length) ag.remove(ag.children[0]);
    },

    /* ------- Karten-Zoom ------- */
    cardFlash(kind) {
      const deck = Scene._decks ? Scene._decks[kind] : null;
      const n = Game.players.length;
      const yaw = Game.seatFlip ? (Game.p().seat / n) * Math.PI * 2 : CAMT.yaw;
      camTo({ tx: (kind === 'mikro' ? -4.6 : 4.6) * .6, tz: 3.0, dist: 17, pitch: .55, yaw }, .16);
      Bus.emit('cardflash', kind);
      if (deck) {
        const y0 = deck.position.y;
        anim(.55, (t) => { deck.position.y = y0 + Math.sin(t * Math.PI) * 1.6; deck.rotation.z = Math.sin(t * Math.PI * 2) * .25; });
      }
      return anim(.55, () => { });
    },

    /* Kamera-Sicht für das Ende */
    celebrate() {
      camTo({ tx: 0, tz: 0, dist: 44, pitch: .55 }, .05);
      let a = 0;
      const spin = setInterval(() => { a += .06; camTo({ yaw: a }, .12); }, 40);
      setTimeout(() => clearInterval(spin), 12000);
    },
  };
})();
