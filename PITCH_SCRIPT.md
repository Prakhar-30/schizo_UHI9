# schizō — Demo Day Script (5:00)

**Theme:** Impermanent loss, unbundled — *LP fees, without the loss.*
**Setup before you start:** app open in one tab (logged in, two wallets ready), deck in another, fullscreen the deck (press **F**). Navigate with **→**. Each slide stages itself + the flow diagrams animate live, so pause a beat on slides 3 and 4 to let them play.

The deck is 7 slides — one per beat below. Slides 3, 4 and 5 carry the live flow diagrams (the split, then the message sequence, then the reactive loop); pause a beat on each to let them play. Let the diagrams and the demo do the talking.

---

## SLIDE 1 — TITLE  ·  0:00 – 0:25

> "Hi, I'm Prakhar — this is **schizō**.
> One line: **LP fees, without the loss.**
> Impermanent loss is the single biggest reason capital doesn't stay in AMMs. Everyone so far has tried to *shrink* it. We did something different — we made it **sellable**."

*(Beat. Advance.)*

---

## SLIDE 2 — THE PROBLEM  ·  0:25 – 1:05

> "Here's the thing nobody says out loud: **every LP position is two trades stapled together.**
> One side is **fee income** — steady, grows with volume. A DAO treasury or a stablecoin desk would love that yield.
> The other side is **impermanent loss** — pure price risk. That's exactly what a volatility trader *wants*.
> But Uniswap forces both into one token. So the treasury sits out — too risky. And the trader sits out — too much babysitting. **The liquidity that should exist never shows up.**"

---

## SLIDE 3 — THE SPLIT (live diagram)  ·  1:05 – 1:50

*(Let the split animation run — deposit flows in, splits into two tokens.)*

> "schizō splits the position at the moment of deposit. You put in **real v4 liquidity**, and you get back two transferable tokens.
> **FEE-T** holds the swap fees plus an upfront premium — **zero price risk.** That's for the yield seekers.
> **IL-T** carries the impermanent loss, and pays a premium to take it. That's for the volatility traders.
> So impermanent loss stops being a tax everyone eats. It becomes a **priced, tradable instrument.** This is the difference between tranching a bond and inventing the credit-default swap."

---

## SLIDE 4 — THE SEQUENCE (live diagram)  ·  1:45 – 2:20

*(The sequence animates the actual messages, top to bottom, on a loop. Keep this one tight.)*

> "Concretely, here's the handshake. The **LP deposits** and gets FEE-T plus IL-T. A **buyer takes the IL-T** leg, paying the premium.
> Then, message by message: every swap emits `SwapOccurred`, the RSC asks for the position data, the hook hands back a **per-position price bundle** — so a WBTC pool never mismarks a LINK pool — and the RSC **settles the new IL mark** on-chain. Every swap, no one in the middle."

---

## SLIDE 5 — HOW IT WORKS (live diagram)  ·  2:20 – 3:00

*(Now the architecture view — the same loop, zoomed out: swap → event crosses to Reactive → compute → mark settles back.)*

> "Zoom out, and that's the whole system: **two contracts, two chains, one event loop.**
> Our **Uniswap v4 hook** settles everything and — on every swap — emits the live price. It stays cheap; no heavy math on the hot path.
> That event fires a **Reactive Smart Contract** that pulls every position, computes the impermanent loss in the ReactVM, and writes the mark **back on-chain.**
> And this is *why* it needs Reactive: IL only changes when price changes, and price only changes on a swap — so the mark must update on **every swap**, trustlessly, with **no keeper and no cron.** The swap event *is* the trigger. The loop runs by itself."

---

## SLIDE 6 — LIVE DEMO  ·  3:00 – 4:35

*(Switch to the app. Narrate as you click. If anything stalls, the slide's stats stay on screen as a backdrop.)*

> "Let me show you it actually running — live on two testnets.
> **1.** I deposit into a pool — and I'm minted **FEE-T and IL-T** against real liquidity.
> **2.** My second wallet **buys the IL-T** leg, paying the premium — bilaterally, no insurance pool.
> **3.** Now watch this — I do a **swap**… and the on-chain **mark counter ticks up.** The RSC just re-marked every open position to its own pool's price. No bot. No button. **The swap did it.**
> **4.** And the fee is **dynamic** — it climbs with realized volatility, exactly when IL risk is highest."

*(Return to the deck → Slide 7.)*

---

## SLIDE 7 — CLOSE  ·  4:35 – 5:00

> "This isn't a mockup. It's **live on two chains**, 45-plus dynamic-fee pools, **74 passing tests** including fuzz and invariant suites.
> From here: tranche IL-T into senior and junior legs, price premiums straight off volatility, even dated **IL futures.**
> The headline: schizō turns impermanent loss from a **tax** into an **asset class.** Thank you."

---

### Timing cheat-sheet
| Slide | Beat | Out by |
|------|------|--------|
| 1 | Hook | 0:25 |
| 2 | Problem | 1:05 |
| 3 | The split | 1:45 |
| 4 | The sequence | 2:20 |
| 5 | How it works | 3:00 |
| 6 | **Live demo** | 4:35 |
| 7 | Close | 5:00 |

### Q&A one-liners (if asked)
- **"Who buys IL-T?"** Vol traders and hedgers — it's a cheap, capital-efficient, leveraged bet on divergence; or a direct hedge for anyone with offsetting AMM exposure.
- **"Why not just use a keeper?"** A keeper burns gas on a timer and must be trusted. Reactive fires on the swap event itself — the exact, and only, moment IL changes.
- **"Is the IL math safe?"** Fixed-point `1 − 2√r/(1+r)`, overflow-guarded across the full sqrt-price range, fuzzed in the 74-test suite.
- **"Multi-pool correctness?"** Each position is marked against its *own* pool's live price, carried per-position in the bundle — a WBTC/WETH swap never mismarks a LINK/UNI position.
