#!/usr/bin/env bash
# Spaced random swaps across all pairs, from A1 and A2, with >=30s between each
# on-chain swap so the Reactive Network has time to react (no callback bundling).
set -u
SEP=https://ethereum-sepolia-rpc.publicnode.com
ROUTER=0xf13D190e9117920c703d79B5F33732e10049b115
HOOK=0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0
FEE=8388608   # DYNAMIC_FEE_FLAG
SPACING=60
MAXU=$(cast max-uint)
K1=0a5fb498eef8df9f475c2c622ca64ed7323ba323182762d7cda8bdcb57a47650
K2=1a0be90f7a3fa6c155d7f44c9eef69d6203262aa80c1d588d5890b141cb732a6
A1=0x49aBE186a9B24F73E34cCAe3D179299440c352aC
A2=0xcD46C4C833725bC46b8aA4136BCdd35b615b5BC5
N=${1:-60}
GAP=${2:-30}
SKIP_SETUP=${3:-no}   # pass "noset" on chunked re-runs (approvals/mints already done)

# token addresses (lowercased for ordering), decimals, custom flag
addrs=(0x748b5c9623528d346c414f4f236b3b5b5c7683cb 0x912a7fb66391eae95ddee40b664ff497108580cd 0x160fc2d6a542565ba7c2a57e18d6b28f62c8d0c7 0xcbaca08f7eb9eb07537f344ebec7e79302f60823 0x25c4cb25e8bf582577f21bffa17a88b8074ff8ba 0x00a311cd8be35953635b0bc619bdc807782dfc5e 0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357 0x6d906e526a4e2ca02097ba9d0caa3c382f52278e 0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8 0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0)
decs=(18 8 18 18 18 18 18 2 6 6)
custom=(1 1 1 1 1 1 0 0 0 0)
# position/demo pools (custom pairs) — bias half the swaps here for IL graphs
pospairs=("0 1" "2 3" "4 5")

if [ "$SKIP_SETUP" != "noset" ]; then
  echo "=== setup: approvals + A2 stash ==="
  for i in 0 1 2 3 4 5 6 7 8 9; do
    cast send ${addrs[$i]} "approve(address,uint256)" $ROUTER $MAXU --private-key $K1 --rpc-url $SEP >/dev/null 2>&1
  done
  for i in 0 1 2 3 4 5; do
    cast send ${addrs[$i]} "approve(address,uint256)" $ROUTER $MAXU --private-key $K2 --rpc-url $SEP >/dev/null 2>&1
    cast send ${addrs[$i]} "mint(address,uint256)" $A2 100000000000000000000000 --private-key $K2 --rpc-url $SEP >/dev/null 2>&1
  done
fi
echo "=== swapping (N=$N, gap=${GAP}s, skip_setup=$SKIP_SETUP) ==="

for ((n=0; n<N; n++)); do
  if (( RANDOM % 2 == 0 )); then
    p=${pospairs[$((RANDOM%3))]}; i=${p% *}; j=${p#* }
  else
    i=$((RANDOM%10)); j=$((RANDOM%10)); while [ $j -eq $i ]; do j=$((RANDOM%10)); done
  fi
  # sort by address
  if [[ "${addrs[$i]}" < "${addrs[$j]}" ]]; then t0=$i; t1=$j; else t0=$j; t1=$i; fi
  c0=${addrs[$t0]}; c1=${addrs[$t1]}
  zfo=$((RANDOM%2))
  if [ $zfo -eq 1 ]; then ini=$t0; else ini=$t1; fi
  dec=${decs[$ini]}
  amt_h=$(( (RANDOM%6)+1 ))
  amtraw=$(python -c "print($amt_h * 10**$dec)")
  deadline=$(python -c "import time;print(int(time.time())+3600)")
  zfobool=$([ $zfo -eq 1 ] && echo true || echo false)
  # signer: both custom -> sometimes A2, else A1
  if [ ${custom[$t0]} -eq 1 ] && [ ${custom[$t1]} -eq 1 ] && (( RANDOM%2==0 )); then KEY=$K2; SND=$A2; who=A2; else KEY=$K1; SND=$A1; who=A1; fi
  if cast send $ROUTER "swapExactTokensForTokens(uint256,uint256,bool,(address,address,uint24,int24,address),bytes,address,uint256)" $amtraw 0 $zfobool "($c0,$c1,$FEE,$SPACING,$HOOK)" 0x $SND $deadline --private-key $KEY --rpc-url $SEP >/dev/null 2>&1; then
    echo "swap $n OK  $who  ${c0:0:6}/${c1:0:6}  in=${ini} amt=${amt_h} zfo=$zfobool"
  else
    echo "swap $n SKIP $who  ${c0:0:6}/${c1:0:6}"
  fi
  sleep $GAP
done
echo "=== done: $N swaps ==="
