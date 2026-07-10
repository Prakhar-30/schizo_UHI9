/* Rebuilds PITCH_DECK.html: 6 slides in script order, refined (less-brutalist)
   styling, and LIVE animated SVG flow diagrams. Reuses the base64 logos that
   were embedded in the existing deck so nothing visual is lost. */
const fs = require('fs');
const SRC = 'PITCH_DECK.html';
const s = fs.readFileSync(SRC, 'utf8');

const grab = (re) => { const m = s.match(re); if (!m) throw new Error('asset not found: ' + re); return m[1]; };
const mk   = grab(/class="mk"\s+src="(data:image\/png;base64,[^"]+)"/);   // header glyph
const wm   = grab(/class="wm"\s+src="(data:image\/png;base64,[^"]+)"/);   // footer wordmark
const hero = grab(/<img src="(data:image\/png;base64,[^"]+)"/);           // title wordmark
const bg   = grab(/background:url\((data:image\/png;base64,[^)]+)\)/);    // big watermark

// keep a one-time backup of the original hand-built deck
if (!fs.existsSync('PITCH_DECK.original.html')) fs.writeFileSync('PITCH_DECK.original.html', s);

const head = (kicker) =>
  `<div class="fhead"><div class="lhs"><img class="mk" src="${mk}"/><span class="kicker">${kicker}</span></div></div>`;
const foot = (pg) =>
  `<div class="ffoot"><img class="wm" src="${wm}"/><span class="pg">${pg} / 07</span></div>`;

/* ── live diagram 1: deposit → hook → split into FEE-T / IL-T ── */
const splitSVG = `
<svg class="diagram" viewBox="0 0 1080 320" preserveAspectRatio="xMidYMid meet" xmlns:xlink="http://www.w3.org/1999/xlink" role="img">
  <defs>
    <marker id="aB" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#6a6a78"/></marker>
    <marker id="aY" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#c6ff2e"/></marker>
    <marker id="aR" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#ff2e6d"/></marker>
    <path id="pIn"  d="M252 162 L412 162" fill="none"/>
    <path id="pFee" d="M594 148 C 684 104, 694 80, 792 80" fill="none"/>
    <path id="pIl"  d="M594 176 C 684 220, 694 244, 792 244" fill="none"/>
  </defs>
  <rect x="20" y="112" width="226" height="100" rx="14" fill="#121218" stroke="#7c5cff" stroke-width="1.6"/>
  <text x="133" y="152" fill="#f3efe4" font-size="21" font-weight="800" text-anchor="middle">LP POSITION</text>
  <text x="133" y="180" fill="#6a6a78" font-size="13" text-anchor="middle">liquidity in a v4 pool</text>
  <line x1="246" y1="162" x2="416" y2="162" stroke="#6a6a78" stroke-width="1.6" marker-end="url(#aB)"/>
  <text x="331" y="151" fill="#6a6a78" font-size="12" text-anchor="middle">deposit</text>
  <rect x="418" y="122" width="176" height="80" rx="13" fill="#121218" stroke="#f3efe4" stroke-width="1.4"/>
  <text x="506" y="156" fill="#f3efe4" font-size="17" font-weight="800" text-anchor="middle">ILBondHook</text>
  <text x="506" y="180" fill="#6a6a78" font-size="12" text-anchor="middle">splits at deposit</text>
  <path d="M594 148 C 684 104, 694 80, 794 80" fill="none" stroke="#c6ff2e" stroke-width="1.8" marker-end="url(#aY)"/>
  <path d="M594 176 C 684 220, 694 244, 794 244" fill="none" stroke="#ff2e6d" stroke-width="1.8" marker-end="url(#aR)"/>
  <rect class="pulseY" x="802" y="26" width="256" height="106" rx="14" fill="rgba(198,255,46,.06)" stroke="#c6ff2e" stroke-width="1.6"/>
  <text x="822" y="58" fill="#c6ff2e" font-size="19" font-weight="800">FEE-T</text>
  <text x="822" y="84" fill="#d8d3c6" font-size="13">swap fees + upfront premium</text>
  <text x="822" y="105" fill="#d8d3c6" font-size="13">zero price risk</text>
  <text x="822" y="124" fill="#6a6a78" font-size="12">&#8594; for yield seekers</text>
  <rect class="pulseR" x="802" y="190" width="256" height="106" rx="14" fill="rgba(255,46,109,.06)" stroke="#ff2e6d" stroke-width="1.6"/>
  <text x="822" y="222" fill="#ff2e6d" font-size="19" font-weight="800">IL-T</text>
  <text x="822" y="248" fill="#d8d3c6" font-size="13">absorbs the impermanent loss</text>
  <text x="822" y="269" fill="#d8d3c6" font-size="13">earns a premium for holding it</text>
  <text x="822" y="288" fill="#6a6a78" font-size="12">&#8594; for underwriters</text>
  <!-- live flow: one deposit packet, splitting into two -->
  <circle r="5.5" fill="#f3efe4">
    <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.42;1"><mpath xlink:href="#pIn"/></animateMotion>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.05;0.40;0.46;1"/>
  </circle>
  <circle r="5.5" fill="#c6ff2e">
    <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1" keyTimes="0;0.44;1"><mpath xlink:href="#pFee"/></animateMotion>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.44;0.5;0.94;1"/>
  </circle>
  <circle r="5.5" fill="#ff2e6d">
    <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1" keyTimes="0;0.44;1"><mpath xlink:href="#pIl"/></animateMotion>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.44;0.5;0.94;1"/>
  </circle>
</svg>`;

/* ── live diagram 2: the marking loop (swap → smooth the mark → derive IL on read) ── */
const loopSVG = `
<svg class="diagram" viewBox="0 0 1080 300" preserveAspectRatio="xMidYMid meet" xmlns:xlink="http://www.w3.org/1999/xlink" role="img">
  <defs>
    <marker id="eM" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="#2ef8d8"/></marker>
    <marker id="eV" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="#7c5cff"/></marker>
    <path id="pEvt" d="M422 108 L654 108" fill="none"/>
    <path id="pAsk" d="M658 204 L426 204" fill="none"/>
  </defs>
  <text x="230" y="22" fill="#6a6a78" font-size="11.5" text-anchor="middle" letter-spacing="2">SEPOLIA / UNICHAIN SEPOLIA</text>
  <text x="850" y="22" fill="#6a6a78" font-size="11.5" text-anchor="middle" letter-spacing="2">ANYONE, ANYWHERE</text>
  <rect class="pulseW" x="40" y="40" width="380" height="228" rx="16" fill="#121218" stroke="#f3efe4" stroke-width="1.5"/>
  <text x="62" y="78" fill="#f3efe4" font-size="19" font-weight="800">ILBondHook</text>
  <text x="62" y="99" fill="#6a6a78" font-size="11.5">one v4 hook &#183; the entire protocol</text>
  <g font-size="13" fill="#d8d3c6">
    <text x="62" y="136">&#8226; holds positions, mints FEE-T + IL-T</text>
    <text x="62" y="162">&#8226; afterSwap &#8594; smooths the marking price</text>
    <text x="62" y="188">&#8226; two storage writes, hot path stays cheap</text>
    <text x="62" y="214">&#8226; nothing external to fund or trust</text>
  </g>
  <rect class="pulseM" x="660" y="40" width="380" height="228" rx="16" fill="#121218" stroke="#2ef8d8" stroke-width="1.5"/>
  <text x="682" y="78" fill="#2ef8d8" font-size="19" font-weight="800">Live IL, derived</text>
  <text x="682" y="99" fill="#6a6a78" font-size="11.5">app &#183; indexer &#183; any contract</text>
  <g font-size="13" fill="#d8d3c6">
    <text x="682" y="136">&#8226; calls ilMark(positionId), a free view</text>
    <text x="682" y="162">&#8226; IL = 1 &#8722; 2&#8730;r/(1+r), pure &#38; exact</text>
    <text x="682" y="188">&#8226; entry price vs the smoothed mark</text>
    <text x="682" y="214">&#8226; fresh on every read, never stale</text>
  </g>
  <line x1="420" y1="108" x2="658" y2="108" stroke="#2ef8d8" stroke-width="1.6" stroke-dasharray="5 5" marker-end="url(#eM)"/>
  <text x="539" y="98" fill="#2ef8d8" font-size="11.5" text-anchor="middle">SwapOccurred (price + smoothed mark)</text>
  <line x1="660" y1="204" x2="422" y2="204" stroke="#7c5cff" stroke-width="1.6" stroke-dasharray="5 5" marker-end="url(#eV)"/>
  <text x="541" y="224" fill="#7c5cff" font-size="11.5" text-anchor="middle">ilMark(id) &#8594; live IL, derived in-hook</text>
  <text x="540" y="252" fill="#6a6a78" font-size="10.5" text-anchor="middle">no keeper &#183; no cron &#183; no oracle &#183; re-marks on every swap</text>
  <!-- swap trigger: a tab on the hook's top edge (clear of the bullet text) -->
  <circle cx="98" cy="39" r="6" fill="none" stroke="#ffb020" stroke-width="2">
    <animate attributeName="r" dur="2.4s" repeatCount="indefinite" values="6;19;19" keyTimes="0;0.2;1"/>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0.9;0;0" keyTimes="0;0.2;1"/>
  </circle>
  <rect x="58" y="28" width="80" height="22" rx="6" fill="#0a0a0f" stroke="#ffb020" stroke-width="1.4"/>
  <text x="98" y="43" fill="#ffb020" font-size="11" font-weight="800" text-anchor="middle">SWAP</text>
  <!-- event packet: hook -> readers (first half) -->
  <circle r="6" fill="#2ef8d8">
    <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.5;1"><mpath xlink:href="#pEvt"/></animateMotion>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.06;0.48;0.52;1"/>
  </circle>
  <!-- derive pulse on the reader box at mid-cycle -->
  <circle cx="850" cy="154" r="6" fill="none" stroke="#2ef8d8" stroke-width="2">
    <animate attributeName="r" dur="2.4s" repeatCount="indefinite" values="6;6;58;58" keyTimes="0;0.5;0.7;1"/>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;0.9;0;0" keyTimes="0;0.5;0.7;1"/>
  </circle>
  <!-- read packet: reader -> hook (second half) -->
  <circle r="6" fill="#7c5cff">
    <animateMotion dur="2.4s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1" keyTimes="0;0.55;1"><mpath xlink:href="#pAsk"/></animateMotion>
    <animate attributeName="opacity" dur="2.4s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.55;0.6;0.96;1"/>
  </circle>
</svg>`;

/* ── live diagram 3: the exact message sequence (deposit, buy, then the loop) ── */
const Tseq = 7;
const lifelines = [
  { x:130, w:122, name:'LP',         stroke:'#c6ff2e', sub:'liquidity provider' },
  { x:380, w:122, name:'Buyer',      stroke:'#ff2e6d', sub:'IL-T underwriter' },
  { x:650, w:188, name:'ILBondHook', stroke:'#f3efe4', sub:'Uniswap v4 · the whole system' },
  { x:940, w:188, name:'Anyone',     stroke:'#2ef8d8', sub:'app · indexer · contract' },
];
const seqMsgs = [
  { x1:130, x2:646, y:96,  c:'#cfcabb', dot:'#f3efe4', a:.03, b:.14, lab:'depositILBond()  →  mint FEE-T + IL-T' },
  { x1:380, x2:646, y:142, c:'#cfcabb', dot:'#f3efe4', a:.17, b:.28, lab:'buyILBond() + premium' },
  { x1:654, x2:936, y:262, c:'#2ef8d8', dot:'#2ef8d8', a:.38, b:.50, lab:'SwapOccurred  (price + smoothed mark)' },
  { x1:936, x2:654, y:312, c:'#9a95a8', dot:'#cfcabb', a:.52, b:.63, lab:'ilMark(positionId)  [free view call]' },
  { x1:654, x2:936, y:362, c:'#7c5cff', dot:'#7c5cff', a:.65, b:.78, lab:'live IL = 1 − 2√r/(1+r)  derived in-hook' },
];
const mkOf = (c) => c === '#2ef8d8' ? 'smMint' : c === '#7c5cff' ? 'smVolt' : 'smGrey';
const seqDot = (i, m) => {
  const a2 = (m.a + 0.008).toFixed(3), b2 = (m.b + 0.008).toFixed(3);
  return `<circle r="5.5" fill="${m.dot}">
    <animateMotion dur="${Tseq}s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes="0;${m.a};${m.b};1"><mpath xlink:href="#sq${i}"/></animateMotion>
    <animate attributeName="opacity" dur="${Tseq}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${m.a};${a2};${m.b};${b2};1"/>
  </circle>`;
};
const sequenceSVG = `
<svg class="diagram" viewBox="0 0 1080 462" preserveAspectRatio="xMidYMid meet" xmlns:xlink="http://www.w3.org/1999/xlink" role="img">
  <defs>
    <marker id="smGrey" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#9a95a8"/></marker>
    <marker id="smMint" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#2ef8d8"/></marker>
    <marker id="smVolt" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#7c5cff"/></marker>
    ${seqMsgs.map((m,i)=>`<path id="sq${i}" d="M${m.x1} ${m.y} L${m.x2} ${m.y}" fill="none"/>`).join('\n    ')}
  </defs>
  ${lifelines.map(l=>`<line x1="${l.x}" y1="72" x2="${l.x}" y2="442" stroke="#26262f" stroke-width="1.2" stroke-dasharray="3 6"/>`).join('\n  ')}
  ${lifelines.map(l=>`<g text-anchor="middle">
    <rect x="${l.x-l.w/2}" y="6" width="${l.w}" height="40" rx="9" fill="#121218" stroke="${l.stroke}" stroke-width="1.4"/>
    <text x="${l.x}" y="31" fill="${l.stroke}" font-size="14" font-weight="800">${l.name}</text>
    <text x="${l.x}" y="60" fill="#6a6a78" font-size="10.5">${l.sub}</text>
  </g>`).join('\n  ')}
  <rect x="74" y="228" width="972" height="216" rx="12" fill="rgba(46,248,216,.03)" stroke="#2ef8d8" stroke-width="1" stroke-dasharray="4 4"/>
  <text x="92" y="248" fill="#2ef8d8" font-size="11" font-weight="700">loop &#183; every swap &#183; autonomous &#183; no keeper, no cron</text>
  ${seqMsgs.map(m=>`<line x1="${m.x1}" y1="${m.y}" x2="${m.x2}" y2="${m.y}" stroke="${m.c}" stroke-width="1.6" marker-end="url(#${mkOf(m.c)})"/>
  <text x="${(m.x1+m.x2)/2}" y="${m.y-9}" fill="${m.c}" font-size="11.5" text-anchor="middle">${m.lab}</text>`).join('\n  ')}
  <circle cx="650" cy="284" r="6" fill="none" stroke="#ffb020" stroke-width="2">
    <animate attributeName="r" dur="${Tseq}s" repeatCount="indefinite" values="6;6;22;22;6" keyTimes="0;0.32;0.4;0.42;1"/>
    <animate attributeName="opacity" dur="${Tseq}s" repeatCount="indefinite" values="0;0;0.9;0;0" keyTimes="0;0.32;0.4;0.42;1"/>
  </circle>
  ${seqMsgs.map((m,i)=>seqDot(i,m)).join('\n  ')}
</svg>`;

const slides = [
/* 1 TITLE */
`<section class="slide active">
  <div class="frame">
    ${head('UHI9 &#183; Theme: Impermanent Loss')}
    <div class="fbody" style="justify-content:center; gap:1.4rem">
      <img src="${hero}" style="height:clamp(56px,9vh,104px); width:auto"/>
      <h1>LP fees. Without the <span class="risk" style="position:relative">loss<svg width="100%" height="11" viewBox="0 0 200 11" preserveAspectRatio="none" style="position:absolute;left:0;bottom:-.16em"><path d="M2 7 Q 60 2 110 6 T 198 5" stroke="#ff2e6d" stroke-width="3" fill="none"/></svg></span>.</h1>
      <p class="lead" style="font-size:1.25rem">Impermanent loss, hedged. An underwriter gets paid to take it. You keep the yield.</p>
      <div class="row" style="gap:.6rem; flex-wrap:wrap">
        <span class="chip volt"><span class="dot"></span> Uniswap v4 Hook</span>
        <span class="chip mint"><span class="dot"></span> Self-marking &#183; zero dependencies</span>
      </div>
    </div>
    ${foot('01')}
  </div>
</section>`,

/* 2 PROBLEM */
`<section class="slide">
  <div class="frame">
    ${head('the problem')}
    <div class="fbody">
      <h2>Every LP position is two trades stapled together.</h2>
      <div class="grid2">
        <div class="card"><span class="legtag fee">FEE-T side</span><p style="margin-top:.7rem;color:var(--soft)">Swap fees: steady, grows with volume. The yield a DAO treasury or stablecoin desk actually wants.</p></div>
        <div class="card"><span class="legtag il">IL-T side</span><p style="margin-top:.7rem;color:var(--soft)">Impermanent loss: the bill when price moves. A risk a long-vol desk would underwrite for the right premium, because it offsets their book.</p></div>
      </div>
      <p class="lead">Sold as one bundle. The treasury that wants yield is forced to hold the price risk, so it stays out. The desk that would underwrite the risk won't babysit an LP, so it stays out too. <b>The liquidity that should exist never shows up.</b></p>
    </div>
    ${foot('02')}
  </div>
</section>`,

/* 3 SPLIT (live) */
`<section class="slide">
  <div class="frame">
    ${head('the split &#183; live')}
    <div class="fbody" style="gap:.7rem">
      <h2>One deposit splits into two tradable claims.</h2>
      <div class="diagwrap">${splitSVG}</div>
      <p class="lead">Both legs are transferable. Hold both = a normal LP. Sell IL-T = a hedged LP: yield with the risk genuinely gone. IL becomes a hedge one side buys and a premium the other side earns.</p>
    </div>
    ${foot('03')}
  </div>
</section>`,

/* 4 SEQUENCE (live) */
`<section class="slide">
  <div class="frame">
    ${head('the message flow &#183; live')}
    <div class="fbody" style="gap:.5rem; justify-content:flex-start; padding-top:14px">
      <h2>The exact handshake: deposit, hedge, then the loop.</h2>
      <div class="diagwrap">${sequenceSVG}</div>
    </div>
    ${foot('04')}
  </div>
</section>`,

/* 5 HOW IT WORKS (live) */
`<section class="slide">
  <div class="frame">
    ${head('how it works &#183; the marking loop')}
    <div class="fbody" style="gap:.7rem">
      <h2>One contract. The hook is its own oracle.</h2>
      <div class="diagwrap">${loopSVG}</div>
      <p class="lead">IL only changes on a swap, and every swap goes through the hook, so the mark moves on <b>every swap</b> and the IL is derived fresh on <b>every read</b>. The marking price is smoothed and never stored, so no single trade can game it. No keeper, no cron, no oracle.</p>
    </div>
    ${foot('05')}
  </div>
</section>`,

/* 6 LIVE DEMO */
`<section class="slide">
  <div class="frame">
    ${head('live demo')}
    <div class="fbody">
      <h2>A live system on two chains. Let's run it.</h2>
      <div class="grid3" style="margin-top:.3rem">
        <div class="card" style="text-align:center"><div class="big-num volt">2</div><p class="mute" style="margin-top:.4rem">independent chains<br>Sepolia &#183; Unichain Sepolia</p></div>
        <div class="card" style="text-align:center"><div class="big-num yield">45 + 3</div><p class="mute" style="margin-top:.4rem">live dynamic-fee pools</p></div>
        <div class="card" style="text-align:center"><div class="big-num mint">72</div><p class="mute" style="margin-top:.4rem">passing tests<br>unit &#183; fuzz &#183; invariant</p></div>
      </div>
      <ul class="clean" style="margin-top:.7rem">
        <li>Mint FEE-T + IL-T from real v4 liquidity; hedge bilaterally, no insurance pool</li>
        <li>Do a swap: every IL gauge moves as the hook re-prices every position off its own pool</li>
        <li>Dynamic fee climbs with realized volatility, exactly when IL risk is highest</li>
      </ul>
    </div>
    ${foot('06')}
  </div>
</section>`,

/* 7 CLOSE */
`<section class="slide">
  <div class="frame">
    ${head('where it goes')}
    <div class="fbody" style="gap:1.1rem">
      <h2 style="max-width:26ch">IL stops being a tax. It becomes a hedge.</h2>
      <div class="grid3">
        <div class="card"><div class="kicker yield">Tranche IL-T</div><p class="mute" style="margin-top:.5rem">Senior eats the first 5%, junior the rest: two risk-adjusted premiums.</p></div>
        <div class="card"><div class="kicker volt">Cross-pool netting</div><p class="mute" style="margin-top:.5rem">One IL-T hedges a book's net exposure; the hook already marks every pool.</p></div>
        <div class="card"><div class="kicker mint">Dated hedges</div><p class="mute" style="margin-top:.5rem">An IL-T with an expiry and a strike: term protection through a catalyst.</p></div>
      </div>
      <div class="row" style="margin-top:.2rem; gap:.8rem; align-items:center">
        <img class="mk" src="${mk}" style="height:34px"/>
        <img src="${hero}" style="height:30px; width:auto"/>
        <span class="mute" style="font-family:var(--mono); font-size:.72rem; letter-spacing:.12em">schizo-il-bond.vercel.app</span>
      </div>
    </div>
    ${foot('07')}
  </div>
</section>`
];

const css = `
  :root{
    --ink:#0a0a0f; --card:#121218; --line:#23232c; --line2:#2e2e38;
    --bone:#f3efe4; --mute:#6a6a78; --soft:#cfcabb;
    --volt:#7c5cff; --yield:#c6ff2e; --risk:#ff2e6d; --mint:#2ef8d8; --amber:#ffb020;
    --sans:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    --mono:ui-monospace,'JetBrains Mono','SFMono-Regular',Menlo,monospace;
    --rad:14px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:
      linear-gradient(rgba(255,255,255,.013) 1px, transparent 1px) 0 0/44px 44px,
      linear-gradient(90deg, rgba(255,255,255,.013) 1px, transparent 1px) 0 0/44px 44px,
      #060608;
    color:var(--bone); font-family:var(--sans); overflow:hidden; -webkit-font-smoothing:antialiased;
    animation:bgdrift 140s linear infinite;
  }
  @keyframes bgdrift{to{background-position:44px 44px,44px 44px,0 0}}

  .deck{position:fixed; inset:0}
  .slide{position:absolute; inset:0; display:none; align-items:center; justify-content:center; padding:3vh 3vw}
  .slide.active{display:flex}
  .frame{
    width:min(1180px,94vw); height:min(648px,90vh);
    display:flex; flex-direction:column;
    background:
      radial-gradient(700px 460px at 92% -12%, rgba(124,92,255,.10), transparent 60%),
      radial-gradient(640px 460px at -8% 112%, rgba(255,46,109,.08), transparent 60%),
      linear-gradient(to right, rgba(255,255,255,.028) 1px, transparent 1px) 0 0/54px 54px,
      linear-gradient(to bottom, rgba(255,255,255,.028) 1px, transparent 1px) 0 0/54px 54px,
      var(--ink);
    border:1px solid var(--line2); border-radius:var(--rad);
    padding:34px 46px 22px; position:relative; overflow:hidden;
    box-shadow:0 30px 80px -42px rgba(0,0,0,.92);
  }
  /* refined thin accent strip across the top of every frame */
  .frame::before{
    content:''; position:absolute; top:0; left:0; right:0; height:3px; z-index:3; opacity:.9;
    background:linear-gradient(90deg,var(--volt) 0,var(--mint) 40%,var(--yield) 68%,var(--risk) 100%);
  }
  .frame::after{
    content:''; position:absolute; right:-90px; bottom:-110px;
    width:460px; height:460px; background:url(${bg}) center/contain no-repeat;
    opacity:.05; pointer-events:none; z-index:0;
  }
  .fhead,.fbody,.ffoot{position:relative; z-index:1}
  .frame img{align-self:center; flex:none}

  .fhead{display:flex; align-items:center; justify-content:space-between; gap:1rem; padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,.07)}
  .fhead .lhs{display:flex; align-items:center; gap:.6rem}
  .fhead img.mk{height:26px; width:auto; display:block}
  .fbody{flex:1; min-height:0; display:flex; flex-direction:column; justify-content:center; gap:1rem; padding:22px 2px}
  .ffoot{display:flex; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid rgba(255,255,255,.07)}
  .ffoot img.wm{height:15px; width:auto; opacity:.8}
  .ffoot .pg{font-family:var(--mono); font-size:.66rem; letter-spacing:.2em; color:var(--mute)}

  .kicker{font-family:var(--mono); font-size:.7rem; letter-spacing:.32em; text-transform:uppercase; color:var(--mute); font-weight:700}
  h1{font-size:clamp(2.5rem,5.7vw,4.6rem); font-weight:900; line-height:.96; letter-spacing:-.03em; text-wrap:balance}
  h2{font-size:clamp(1.5rem,3vw,2.45rem); font-weight:900; line-height:1.03; letter-spacing:-.022em; text-wrap:balance}
  .lead{font-size:clamp(.95rem,1.3vw,1.18rem); color:var(--soft); max-width:64ch; line-height:1.5}
  .mute{color:var(--mute)} .soft{color:var(--soft)}
  .volt{color:var(--volt)} .yield{color:var(--yield)} .risk{color:var(--risk)} .mint{color:var(--mint)} .amber{color:var(--amber)}
  b{color:var(--bone); font-weight:700}

  .chip{display:inline-flex; align-items:center; gap:.5em; font-family:var(--mono); font-size:.68rem; letter-spacing:.12em;
    text-transform:uppercase; font-weight:700; padding:.38em .72em; border-radius:.55em; border:1.5px solid}
  .chip.volt{border-color:rgba(124,92,255,.5); color:var(--volt)} .chip.mint{border-color:rgba(46,248,216,.5); color:var(--mint)}
  .chip.risk{border-color:rgba(255,46,109,.5); color:var(--risk)} .chip.line{border-color:var(--line); color:var(--mute)}
  .dot{width:.5em;height:.5em;border-radius:50%;background:currentColor}

  .card{background:rgba(18,18,24,.7); border:1px solid var(--line2); border-radius:var(--rad); padding:1.05rem 1.15rem}
  .grid2{display:grid; grid-template-columns:1fr 1fr; gap:.9rem}
  .grid3{display:grid; grid-template-columns:repeat(3,1fr); gap:.9rem}
  .row{display:flex; gap:.9rem; align-items:center}
  .legtag{display:inline-flex;align-items:center;gap:.4em;font-family:var(--mono);font-weight:700;font-size:.72rem;padding:.3em .6em;border-radius:.45em;border:1.5px solid}
  .legtag.fee{border-color:rgba(198,255,46,.6);color:var(--yield);background:rgba(198,255,46,.06)}
  .legtag.il{border-color:rgba(255,46,109,.6);color:var(--risk);background:rgba(255,46,109,.06)}
  .big-num{font-family:var(--mono);font-weight:800;font-size:clamp(1.6rem,2.7vw,2.5rem);line-height:1}
  ul.clean{list-style:none; display:flex; flex-direction:column; gap:.55rem}
  ul.clean li{display:flex; gap:.6rem; align-items:flex-start; font-size:.98rem; color:var(--soft); line-height:1.4}
  ul.clean li::before{content:'\\25C9'; color:var(--mint); font-size:.72rem; margin-top:.3em}
  .diagram{width:100%; height:100%; max-height:100%; display:block; margin:auto}
  .diagwrap{flex:1; min-height:0; display:flex; align-items:center; justify-content:center}
  svg text{font-family:var(--mono)}
  /* gentle breathing on the diagram destination boxes */
  @keyframes glowY{0%,100%{stroke-opacity:.55}50%{stroke-opacity:1}}
  .pulseY{animation:glowY 2.4s ease-in-out infinite}
  .pulseR{animation:glowY 2.4s ease-in-out .15s infinite}
  .pulseM{animation:glowY 2.4s ease-in-out 1.2s infinite}
  .pulseW{animation:glowY 2.4s ease-in-out infinite}

  /* entrance choreography */
  @keyframes rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
  @keyframes fadeDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
  @keyframes popFoot{from{opacity:0}to{opacity:1}}
  @keyframes glyph{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
  @keyframes wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .slide.active .fhead{animation:fadeDown .5s ease backwards}
  .slide.active .ffoot{animation:popFoot .6s ease .4s backwards}
  .slide.active .frame::before{transform-origin:left;animation:wipe .55s cubic-bezier(.2,.72,.2,1) backwards}
  .slide.active .fbody > *{animation:rise .6s cubic-bezier(.2,.72,.2,1) backwards}
  .slide.active .fbody > *:nth-child(1){animation-delay:.10s}
  .slide.active .fbody > *:nth-child(2){animation-delay:.19s}
  .slide.active .fbody > *:nth-child(3){animation-delay:.28s}
  .slide.active .fbody > *:nth-child(4){animation-delay:.37s}
  .slide.active .diagram{animation:glyph .65s ease .26s backwards}

  .bar{position:fixed;top:0;left:0;height:3px;width:0;z-index:8;background:linear-gradient(90deg,var(--volt),var(--mint));box-shadow:0 0 12px rgba(124,92,255,.55);transition:width .45s cubic-bezier(.2,.72,.2,1)}
  .hint{position:fixed;top:1.6vh;right:2vw;font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:#34343e;z-index:5}
  .dots{position:fixed;bottom:1.4vh;left:50%;transform:translateX(-50%);display:flex;gap:.45rem;z-index:5}
  .dots i{width:7px;height:7px;border-radius:50%;background:#26262f;cursor:pointer;transition:.2s}
  .dots i.on{background:var(--volt);width:20px;border-radius:4px}

  @page{size:1280px 720px; margin:0}
  @media print{
    html,body{height:auto;overflow:visible;background:#060608}
    .deck{position:static}
    .slide{position:relative; display:flex !important; height:720px; width:1280px; page-break-after:always; padding:28px}
    .frame{width:1224px; height:664px; box-shadow:none}
    .hint,.dots,.bar{display:none}
    *{animation:none !important}
  }
  @media (prefers-reduced-motion:reduce){.deck *{animation:none !important}}
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>schizo · pitch deck</title>
<style>${css}</style>
</head>
<body>
<div class="deck" id="deck">

${slides.join('\n\n')}

</div>

<div class="bar" id="bar"></div>
<div class="hint">← → navigate · F fullscreen · P print/pdf</div>
<div class="dots" id="dots"></div>

<script>
  const slides=[...document.querySelectorAll('.slide')];
  const dotsWrap=document.getElementById('dots');
  let i=0;
  slides.forEach((_,n)=>{const d=document.createElement('i');d.onclick=(e)=>{e.stopPropagation();go(n)};dotsWrap.appendChild(d)});
  const dots=[...dotsWrap.children];
  const bar=document.getElementById('bar');
  function go(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle('active',k===i));dots.forEach((d,k)=>d.classList.toggle('on',k===i));bar.style.width=(slides.length<2?100:(i/(slides.length-1))*100)+'%';}
  document.addEventListener('keydown',e=>{
    if(['ArrowRight',' ','PageDown'].includes(e.key))go(i+1);
    else if(['ArrowLeft','PageUp'].includes(e.key))go(i-1);
    else if(e.key==='Home')go(0); else if(e.key==='End')go(slides.length-1);
    else if(e.key.toLowerCase()==='f'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}
    else if(e.key.toLowerCase()==='p')window.print();
  });
  document.getElementById('deck').addEventListener('click',e=>{go(e.clientX>innerWidth/2?i+1:i-1)});
  go(0);
</script>
</body>
</html>`;

fs.writeFileSync(SRC, html);
console.log('Wrote', SRC, '(' + (html.length/1024).toFixed(0) + ' KB, ' + slides.length + ' slides). Backup: PITCH_DECK.original.html');
