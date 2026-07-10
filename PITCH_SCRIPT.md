# schizō: Demo Day Script (5:00)

**Theme:** Impermanent loss, hedged. *LP fees, without the loss.*
**Setup before you start:** app open in one tab (logged in, two wallets ready), deck in another, fullscreen the deck (press **F**). Navigate with the right arrow. Each slide stages itself and the flow diagrams animate live, so pause a beat on slides 3 and 4 to let them play.

The deck is 7 slides, one per beat below. Slides 3, 4 and 5 carry the live flow diagrams (the split, then the message sequence, then the marking loop). Let the diagrams and the demo do the talking.

---

## SLIDE 1: TITLE  ·  0:00 – 0:25

> "Hi, I'm Prakhar, and this is **schizō**.
> One line: **LP fees, without the loss.**
> Impermanent loss is the single biggest reason capital doesn't stay in AMMs. Everyone so far has tried to *shrink* it. We did something different. We made it **hedgeable**."

*(Beat. Advance.)*

---

## SLIDE 2: THE PROBLEM  ·  0:25 – 1:05

> "Here's the thing nobody says out loud: **every LP position is two trades stapled together.**
> One side is **fee income**, steady, grows with volume. A DAO treasury or a stablecoin desk would love that yield.
> The other side is **impermanent loss**, pure price risk. A market-making desk that's long volatility elsewhere would happily hold that at the right price, because it offsets their book.
> But Uniswap forces both into one token. So the treasury sits out, too risky. And the desk sits out, wrong instrument. **The liquidity that should exist never shows up.**"

---

## SLIDE 3: THE SPLIT (live diagram)  ·  1:05 – 1:50

*(Let the split animation run: deposit flows in, splits into two tokens.)*

> "schizō splits the position at the moment of deposit. You put in **real v4 liquidity**, and you get back two transferable tokens.
> **FEE-T** holds the swap fees plus an upfront premium. **Zero price risk.** That's the hedged LP.
> **IL-T** carries the impermanent loss, and collects a premium for taking it. That's the underwriter.
> Bond markets did this when they stripped principal from coupon. Pendle did it for yield. We did it for impermanent loss: it stops being a tax everyone eats and becomes **a hedge one side buys and a premium the other side earns.**"

---

## SLIDE 4: THE SEQUENCE (live diagram)  ·  1:45 – 2:20

*(The sequence animates the actual messages, top to bottom, on a loop. Keep this one tight.)*

> "Concretely, here's the handshake. The **LP deposits** and gets FEE-T plus IL-T. A **counterparty takes the IL-T** leg, paying the premium, and the LP is hedged from that moment.
> Then, message by message: every swap nudges the hook's **smoothed marking price** for that pool, and every position's IL **derives from its own pool's mark**, so a WBTC pool never mismarks a LINK pool. Every swap, no one in the middle, nothing in between."

---

## SLIDE 5: HOW IT WORKS (live diagram)  ·  2:20 – 3:00

*(Now the architecture view: the same loop, zoomed out. Swap moves the mark, reads derive the IL.)*

> "Zoom out, and that's the whole system: **one contract.**
> Our **Uniswap v4 hook** settles everything, and on every swap it does exactly two cheap storage writes: it updates the volatility fee, and it nudges a **smoothed marking price**. No heavy math on the hot path.
> The impermanent loss itself is **never stored anywhere**. It's derived, on demand, by a pure function anyone can call: entry price versus the smoothed mark.
> That's why it can't be gamed: the marking price is smoothed, so one swap can't set it, and there's no stored mark to poison and no settlement transaction to front-run.
> And here's the insight: a hook already sees **every price change**, because every price change *is* a swap through it. The hook is its own oracle. **No keeper, no cron, no other network.** The loop runs by itself."

---

## SLIDE 6: LIVE DEMO  ·  3:00 – 4:35

*(Switch to the app. Narrate as you click. If anything stalls, the slide's stats stay on screen as a backdrop.)*

> "Let me show you it actually running, live on two testnets.
> **1.** I deposit into a pool, and I'm minted **FEE-T and IL-T** against real liquidity. Notice the premium: I didn't type it. The protocol quoted it from this pool's live volatility.
> **2.** My second wallet **takes the IL-T** leg, paying the premium. Bilateral. From this second, wallet one is a hedged LP.
> **3.** Now watch this. I do a **swap**... and every IL gauge **moves.** The hook just re-priced every open position off its own pool. No bot. No button. **The swap did it.**
> **4.** And the fee is **dynamic**: it climbs with realized volatility, exactly when IL risk is highest. The hedged leg earns the most when the risk leg matters the most."

*(Return to the deck, Slide 7.)*

---

## SLIDE 7: CLOSE  ·  4:35 – 5:00

> "This isn't a mockup. It's **live on two chains**, 45-plus dynamic-fee pools, **72 passing tests** including fuzz and invariant suites, with real fee routing: the yield leg earns actual swap fees, the risk leg holds the actual principal.
> From here: streaming premiums, tranched risk, cross-pool netting.
> The headline: schizō turns impermanent loss from a **tax** into a **hedge**. Thank you."

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
- **"Who buys IL-T?"** Underwriters: desks with long-gamma options books (IL-T's short-gamma payoff offsets their theta bill), funds that expect range-bound markets and want the premium, and anyone with opposite AMM exposure who needs a direct hedge.
- **"Isn't the buyer just speculating?"** No more than an insurance company is. They're paid a volatility-linked premium to warehouse a risk someone else needs gone. That's underwriting, and it's the oldest profitable trade in finance.
- **"Can the mark be manipulated?"** No single transaction can move it. The marking price is an EWMA, so one swap shifts it only fractionally, and the IL is derived at read time, so there is no stored mark to poison. An attacker must hold a skewed price across many swaps against arbitrage.
- **"Why not a keeper or an oracle?"** Nothing needs to run. The hook sees every swap, so it smooths the price right there, and IL derives from it on demand. Zero liveness assumptions, zero trust, zero funding.
- **"Is the IL math safe?"** Fixed-point `1 − 2√r/(1+r)`, overflow-guarded across the full sqrt-price range, fuzzed in the 72-test suite. The hook enforces full-range deposits so the closed-form mark is exact for every position.
- **"Multi-pool correctness?"** Each position derives its mark from its *own* pool's smoothed price. A WBTC/WETH swap never mismarks a LINK/UNI position.
