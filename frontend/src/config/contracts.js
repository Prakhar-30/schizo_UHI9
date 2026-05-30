import { parseAbi } from 'viem'

// ─────────────────────────────────────────────────────────────────────────────
//  DEPLOYED ADDRESSES  (validated run — 2026-05-27)
// ─────────────────────────────────────────────────────────────────────────────

export const SEPOLIA_CHAIN_ID = 11155111
export const LASNA_CHAIN_ID = 5318007

export const ADDR = {
  // Sepolia
  hook: '0x55f571E0DC76De9154DeA40B4749a6449CF510C0',
  token0: '0x1E0a671C889e49fA2Ecf2F07E3930cd9B11E3591', // ALPHA
  token1: '0x9a731FC6652C8cc101ABcB0717d808ab09397aB9', // BETA
  poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  stateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
  swapRouter: '0xf13D190e9117920c703d79B5F33732e10049b115',
  positionManager: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  callbackProxy: '0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA',
  // Lasna
  reactive: '0xe560786b23fd0408E8f42a6799630294F87203d9',
}

export const TOKENS = {
  token0: { address: ADDR.token0, symbol: 'ALPHA', name: 'IL Bond ALPHA', decimals: 18 },
  token1: { address: ADDR.token1, symbol: 'BETA', name: 'IL Bond BETA', decimals: 18 },
}

// ─────────────────────────────────────────────────────────────────────────────
//  POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const DYNAMIC_FEE_FLAG = 0x800000 // 8388608 — LPFeeLibrary.DYNAMIC_FEE_FLAG
export const BASE_FEE_BPS = 30 // 3000 pips = 0.30%
export const TICK_SPACING = 60
// TickMath.minUsableTick(60) / maxUsableTick(60)
export const TICK_LOWER = -887220
export const TICK_UPPER = 887220
// Constants.SQRT_PRICE_1_1
export const SQRT_PRICE_1_1 = 79228162514264337593543950336n

// ─────────────────────────────────────────────────────────────────────────────
//  EXPLORERS
// ─────────────────────────────────────────────────────────────────────────────

export const EXPLORER = {
  sepolia: 'https://sepolia.etherscan.io',
  reactscan: 'https://lasna.reactscan.net/address/0x49abe186a9b24f73e34ccae3d179299440c352ac/contract/',
}
export const sepoliaTx = (h) => `${EXPLORER.sepolia}/tx/${h}`
export const sepoliaAddr = (a) => `${EXPLORER.sepolia}/address/${a}`
export const reactscanAddr = (a) => `${EXPLORER.reactscan}${a}`

// ─────────────────────────────────────────────────────────────────────────────
//  ABIs  (human-readable → parsed)
// ─────────────────────────────────────────────────────────────────────────────

export const HOOK_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  // writes
  'function depositILBond(PoolKey key, int24 tickLower, int24 tickUpper, uint128 liquidityAmount, uint256 amount0Max, uint256 amount1Max, uint256 askPremium) returns (uint256 positionId)',
  'function buyILBond(uint256 positionId)',
  'function transferFeeToken(uint256 positionId, address to)',
  'function transferILToken(uint256 positionId, address to)',
  'function exitPosition(uint256 positionId)',
  'function withdraw(address currency)',
  // reads
  'function getPosition(uint256 positionId) view returns (address lp, address feeHolder, address ilHolder, bool active, bool ilBondSold, uint128 liquidity, uint160 entrySqrtPriceX96, int256 ilMarkBps, uint256 markValue, uint256 askPremium)',
  'function getRange(uint256 positionId) view returns (int24 tickLower, int24 tickUpper)',
  'function activePositionCount() view returns (uint256)',
  'function getWithdrawable(address user) view returns (uint256 amount0, uint256 amount1)',
  'function nextPositionId() view returns (uint256)',
  'function bundleCounter() view returns (uint256)',
  'function BASE_FEE() view returns (uint24)',
  // events
  'event SwapOccurred(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity)',
  'event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 entrySqrtPriceX96)',
  'event PositionExited(uint256 indexed positionId)',
  'event ILBondSold(uint256 indexed positionId, address indexed buyer, uint256 premium)',
  'event ILMarkUpdated(uint256 indexed positionId, int256 ilBps, uint256 markValue)',
  'event FeeTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
  'event ILTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
  'event ILBondDataBundle(uint256 indexed bundleId, bytes data)',
  'event CycleCompleted(uint256 timestamp, uint256 positionsChecked)',
])

export const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
])

export const PERMIT2_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
])

// hookmate IUniswapV4Router04 — return omitted so viem never decodes it.
export const SWAP_ROUTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, bool zeroForOne, PoolKey key, bytes hookData, address receiver, uint256 deadline) payable',
])

export const REACTIVE_ABI = parseAbi([
  'function activeCount() view returns (uint256)',
  'function owner() view returns (address)',
])

// Uniswap v4 StateView — read pool slot0 without touching event logs.
export const STATEVIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])
