#!/usr/bin/env bash
# swap-all-pools.sh - guarantees EVERY C(10,2)=45 pool gets MIN..MAX randomized
# swaps, random direction (buy & sell), with larger amounts and >=GAP seconds
# between each on-chain swap so every swap lands as its own mark/data point.
# Progress is appended to scripts/swap-all-pools.log.
#
# usage: ./swap-all-pools.sh [MIN] [MAX] [GAP] [LO] [HI]
#   MIN/MAX = swaps per pool (default 10/15)
#   GAP     = seconds between swaps (default 35)
#   LO/HI   = human-unit amount range (default 10/20)
set -u

SEP=https://ethereum-sepolia-rpc.publicnode.com
ROUTER=0xf13D190e9117920c703d79B5F33732e10049b115
HOOK=0x57696AB5077Aa634c13682C3d3E84287935290c0
FEE=8388608   # DYNAMIC_FEE_FLAG
SPACING=60
MAXU=$(cast max-uint)

# Load signer keys from frontend/.env (gitignored). Never hardcode keys here.
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
K1=${A1_PRIVATE_KEY:?A1_PRIVATE_KEY not set in frontend/.env}
A1=${A1_ADDRESS:?A1_ADDRESS not set in frontend/.env}

MIN=${1:-10}
MAX=${2:-15}
GAP=${3:-35}
LO=${4:-10}
HI=${5:-20}

LOG="$(dirname "$0")/swap-all-pools.log"

# token addresses (checksummed ok; we compare lowercased), decimals, symbols
addrs=(0x748b5C9623528D346C414F4f236B3b5b5c7683cb 0x912A7Fb66391eAe95DDee40B664FF497108580CD 0x160fC2D6a542565ba7C2a57E18d6b28F62C8D0C7 0xCbAcA08f7eB9eB07537F344EbeC7E79302F60823 0x25C4Cb25E8bF582577F21bFFA17A88b8074ff8Ba 0x00A311cd8BE35953635b0Bc619bdC807782dfC5E 0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357 0x6d906e526a4e2Ca02097BA9d0caA3c382F52278E 0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0)
decs=(18 8 18 18 18 18 18 2 6 6)
syms=(WETH WBTC LINK UNI AAVE GHO DAI EURS USDC USDT)

lc() { echo "$1" | tr 'A-F' 'a-f'; }

log() { echo "$1" | tee -a "$LOG"; }

log "=== swap-all-pools start $(date '+%F %T')  min=$MIN max=$MAX gap=${GAP}s amt=${LO}-${HI} ==="

# one-time approvals for A1 on all 10 tokens
log "--- approvals (A1, 10 tokens) ---"
for i in 0 1 2 3 4 5 6 7 8 9; do
  cast send "${addrs[$i]}" "approve(address,uint256)" $ROUTER $MAXU --private-key $K1 --rpc-url $SEP >/dev/null 2>>"$LOG" \
    && log "  approved ${syms[$i]}" || log "  approve ${syms[$i]} FAILED (maybe already set)"
done

total=0; ok=0; skip=0; poolnum=0
for ((i=0; i<10; i++)); do
  for ((j=i+1; j<10; j++)); do
    poolnum=$((poolnum+1))
    # canonical sort by lowercased address -> t0 = currency0
    if [[ "$(lc "${addrs[$i]}")" < "$(lc "${addrs[$j]}")" ]]; then t0=$i; t1=$j; else t0=$j; t1=$i; fi
    c0=${addrs[$t0]}; c1=${addrs[$t1]}
    R=$(( MIN + RANDOM % (MAX - MIN + 1) ))
    log "[pool $poolnum/45] ${syms[$t0]}/${syms[$t1]} -> $R swaps"
    for ((s=0; s<R; s++)); do
      zfo=$(( RANDOM % 2 ))                       # 1 = token0->token1, 0 = token1->token0
      if [ $zfo -eq 1 ]; then ini=$t0; zfobool=true; else ini=$t1; zfobool=false; fi
      dec=${decs[$ini]}
      amt_h=$(( LO + RANDOM % (HI - LO + 1) ))
      amtraw=$(python -c "print($amt_h * 10**$dec)")
      deadline=$(python -c "import time;print(int(time.time())+3600)")
      total=$((total+1))
      if cast send $ROUTER "swapExactTokensForTokens(uint256,uint256,bool,(address,address,uint24,int24,address),bytes,address,uint256)" \
           $amtraw 0 $zfobool "($c0,$c1,$FEE,$SPACING,$HOOK)" 0x $A1 $deadline \
           --private-key $K1 --rpc-url $SEP >/dev/null 2>>"$LOG"; then
        ok=$((ok+1))
        log "  swap $total OK   ${syms[$t0]}/${syms[$t1]}  in=${syms[$ini]} amt=${amt_h} zfo=$zfobool  (pool $poolnum, $((s+1))/$R)"
      else
        skip=$((skip+1))
        log "  swap $total SKIP ${syms[$t0]}/${syms[$t1]}  in=${syms[$ini]} amt=${amt_h} zfo=$zfobool"
      fi
      sleep $GAP
    done
  done
done

log "=== done $(date '+%F %T'): total=$total ok=$ok skip=$skip across 45 pools ==="
