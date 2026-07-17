import { Hono } from "hono";
import { ethers } from "ethers";

// Uniswap MCP — swaps built DIRECTLY against the Uniswap protocol (QuoterV2 for
// pricing, SwapRouter02 for calldata), NOT via a third-party aggregator. Read-only
// quote + non-custodial swap: the tool returns exactInputSingle calldata that the
// user's own wallet signs via send_transaction. Every call flows through the
// attestation pipeline, so the swap is recomputable. Don't trust. Recompute.

export const uniswapRoutes = new Hono();

// ─── Per-chain Uniswap v3 deployments ─────────────────────────────────────────
type ChainCfg = {
  router: string;   // SwapRouter02
  quoter: string;   // QuoterV2
  weth: string;     // wrapped native
  rpcs: string[];   // fallback RPC endpoints
  tokens: Record<string, { address: string; decimals: number }>;
};

const CHAINS: Record<number, ChainCfg> = {
  1: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    weth:   "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
    ],
    tokens: {
      WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      DAI:  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
    },
  },
  8453: {
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    weth:   "0x4200000000000000000000000000000000000006",
    rpcs: [
      "https://base-rpc.publicnode.com",
      "https://mainnet.base.org",
      "https://rpc.ankr.com/base",
    ],
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      DAI:  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
    },
  },
};

const NATIVE = new Set([
  "eth", "native",
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);
const FEE_TIERS = [100, 500, 3000, 10000];

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];
const ERC20_ABI = ["function decimals() view returns (uint8)"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function withProvider<T>(chainId: number, fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`Unsupported chain ${chainId}. Supported: ${Object.keys(CHAINS).join(", ")}`);
  let lastErr: any;
  for (const url of cfg.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
      return await fn(p);
    } catch (e) { lastErr = e; }
  }
  throw new Error(`All RPCs failed for chain ${chainId}: ${lastErr?.message ?? lastErr}`);
}

async function resolveToken(
  chainId: number,
  token: string,
): Promise<{ address: string; decimals: number; isNative: boolean }> {
  const cfg = CHAINS[chainId];
  const t = token.trim();
  if (NATIVE.has(t.toLowerCase())) return { address: cfg.weth, decimals: 18, isNative: true };
  // Known symbol?
  const sym = cfg.tokens[t.toUpperCase()];
  if (sym) return { address: sym.address, decimals: sym.decimals, isNative: false };
  // Raw address → look up decimals on-chain.
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) {
    const decimals = await withProvider(chainId, async (p) => {
      try { return Number(await new ethers.Contract(t, ERC20_ABI, p).decimals()); }
      catch { return 18; }
    });
    return { address: ethers.getAddress(t), decimals, isNative: false };
  }
  throw new Error(`Could not resolve token "${token}" on chain ${chainId}. Pass a known symbol (${Object.keys(cfg.tokens).join(", ")}) or a contract address.`);
}

type BestQuote = { amountOut: bigint; fee: number };

async function bestQuote(chainId: number, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<BestQuote> {
  const cfg = CHAINS[chainId];
  return withProvider(chainId, async (p) => {
    const quoter = new ethers.Contract(cfg.quoter, QUOTER_ABI, p);
    let best: BestQuote | null = null;
    for (const fee of FEE_TIERS) {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
        });
        if (amountOut > 0n && (!best || amountOut > best.amountOut)) best = { amountOut, fee };
      } catch { /* no pool at this fee tier */ }
    }
    if (!best) throw new Error("No Uniswap v3 pool found for this pair on any fee tier.");
    return best;
  });
}

const fmt = (v: bigint, decimals: number, sig = 6) => {
  const s = ethers.formatUnits(v, decimals);
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(sig).replace(/\.?0+$/, "") : s;
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "uniswap_quote",
    description: "Get a read-only Uniswap v3 price quote (best fee tier auto-selected via QuoterV2), directly from the Uniswap protocol — no aggregator. Use for 'how much X for Y on Uniswap'. Does NOT prepare a transaction.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number", description: "Chain ID: 1 = Ethereum, 8453 = Base" },
        tokenIn: { type: "string", description: "Input token: a symbol (ETH, WETH, USDC, USDT, DAI, WBTC) or contract address. Use ETH for native." },
        tokenOut: { type: "string", description: "Output token: a symbol or contract address." },
        amountIn: { type: "string", description: "Human amount of tokenIn to swap, e.g. '0.1' for 0.1 ETH or '250' for 250 USDC." },
      },
      required: ["chainId", "tokenIn", "tokenOut", "amountIn"],
    },
  },
  {
    name: "uniswap_swap_calldata",
    description: "Build ready-to-sign Uniswap v3 swap calldata (exactInputSingle on SwapRouter02) directly against the Uniswap protocol. Returns swapTx {to,data,value,chainId} — pass it to send_transaction so the user's OWN wallet signs (non-custodial). For native ETH input the value is set automatically. For ERC-20 input, the router must be approved for amountIn first.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number", description: "Chain ID: 1 = Ethereum, 8453 = Base" },
        tokenIn: { type: "string", description: "Input token symbol or address. Use ETH for native (value is set automatically)." },
        tokenOut: { type: "string", description: "Output token symbol or address. Native ETH output is not supported — use WETH." },
        amountIn: { type: "string", description: "Human amount of tokenIn, e.g. '0.1' for 0.1 ETH." },
        recipient: { type: "string", description: "The user's wallet address (0x...) — receives tokenOut and signs the tx." },
        slippage: { type: "number", description: "Max slippage as a decimal (0.005 = 0.5%). Default 0.005." },
      },
      required: ["chainId", "tokenIn", "tokenOut", "amountIn", "recipient"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function quote(args: any): Promise<string> {
  const chainId = Number(args.chainId);
  const tin = await resolveToken(chainId, String(args.tokenIn));
  const tout = await resolveToken(chainId, String(args.tokenOut));
  if (tout.isNative) return JSON.stringify({ error: "Native ETH output not supported — quote against WETH." });
  const amountIn = ethers.parseUnits(String(args.amountIn), tin.decimals);
  const best = await bestQuote(chainId, tin.address, tout.address, amountIn);
  const feePct = (best.fee / 10000).toString();
  return JSON.stringify({
    venue: "Uniswap v3",
    chainId,
    in:  `${args.amountIn} ${String(args.tokenIn).toUpperCase()}`,
    out: `${fmt(best.amountOut, tout.decimals)} ${String(args.tokenOut).toUpperCase()}`,
    feeTier: `${feePct}%`,
    note: "Read-only quote from Uniswap QuoterV2. To execute, use uniswap_swap_calldata then send_transaction.",
  });
}

async function swapCalldata(args: any): Promise<string> {
  const chainId = Number(args.chainId);
  const cfg = CHAINS[chainId];
  if (!cfg) return JSON.stringify({ error: `Unsupported chain ${chainId}. Supported: ${Object.keys(CHAINS).join(", ")}` });
  const tin = await resolveToken(chainId, String(args.tokenIn));
  const tout = await resolveToken(chainId, String(args.tokenOut));
  if (tout.isNative) return JSON.stringify({ error: "Native ETH output not supported — swap to WETH instead." });

  const recipient = ethers.getAddress(String(args.recipient));
  const amountIn = ethers.parseUnits(String(args.amountIn), tin.decimals);
  const slippage = typeof args.slippage === "number" ? args.slippage : 0.005;

  const best = await bestQuote(chainId, tin.address, tout.address, amountIn);
  const minOut = (best.amountOut * BigInt(Math.floor((1 - slippage) * 1_000_000))) / 1_000_000n;

  const iface = new ethers.Interface(ROUTER_ABI);
  const data = iface.encodeFunctionData("exactInputSingle", [{
    tokenIn: tin.address,
    tokenOut: tout.address,
    fee: best.fee,
    recipient,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }]);

  return JSON.stringify({
    swapTx: {
      to: cfg.router,
      data,
      value: tin.isNative ? amountIn.toString() : "0",
      chainId,
      txParams: { gasLimit: 300000 },
    },
    quote: {
      venue: "Uniswap v3",
      in:  `${args.amountIn} ${String(args.tokenIn).toUpperCase()}`,
      out: `~${fmt(best.amountOut, tout.decimals)} ${String(args.tokenOut).toUpperCase()}`,
      minReceived: `${fmt(minOut, tout.decimals)} ${String(args.tokenOut).toUpperCase()}`,
      feeTier: `${best.fee / 10000}%`,
    },
    ...(tin.isNative ? {} : { approvalNote: `ERC-20 input: the user must approve ${cfg.router} to spend ${args.amountIn} ${String(args.tokenIn).toUpperCase()} before this swap.` }),
  });
}

// ─── MCP endpoint (JSON-RPC) ──────────────────────────────────────────────────

uniswapRoutes.post("/", async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const { method, params, id } = body;

  if (method === "tools/list") {
    return c.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (method === "tools/call") {
    const name = params?.name as string;
    const args = params?.arguments ?? {};
    try {
      let text: string;
      if      (name === "uniswap_quote")          text = await quote(args);
      else if (name === "uniswap_swap_calldata")  text = await swapCalldata(args);
      else return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e?.message ?? String(e) }) }] } });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

uniswapRoutes.get("/health", (c) =>
  c.json({ ok: true, tools: TOOLS.map(t => t.name), chains: Object.keys(CHAINS).map(Number) })
);
