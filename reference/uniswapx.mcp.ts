import { Hono } from "hono";
import { DutchOrderBuilder } from "@uniswap/uniswapx-sdk";
import { BigNumber } from "@ethersproject/bignumber";

// UniswapX MCP — the agent signs a UniswapX *intent* (an off-chain, gasless, signature-based
// Dutch-auction order via Permit2), non-custodially: the user's own wallet signs the EIP-712 order,
// fillers execute it on-chain. Two lanes, honestly split:
//   • uniswapx_build_order — build a LIVE order (deadline/decay/nonce from now) → non-deterministic → ATTESTED
//   • uniswapx_order_hash   — the order hash of an EXPLICIT order struct → deterministic EIP-712 hash → RECOMPUTABLE
// The order is a signed, hashable intent: recompute the order hash + verify the signature + check the
// Dutch decay BEFORE a filler touches it. Don't trust the agent's order — recompute it.

export const uniswapxRoutes = new Hono();

const bn = (s: any) => BigNumber.from(String(s));

// Build an ExclusiveDutchOrder from explicit fields (no "now" — fully deterministic).
function buildOrder(a: any) {
  const chainId = Number(a.chainId ?? 1);
  const b = new DutchOrderBuilder(chainId);
  b.deadline(Number(a.deadline))
    .decayStartTime(Number(a.decayStartTime))
    .decayEndTime(Number(a.decayEndTime))
    .nonce(bn(a.nonce))
    .swapper(String(a.swapper))
    .input({ token: String(a.inputToken), startAmount: bn(a.inputStartAmount ?? a.inputAmount), endAmount: bn(a.inputEndAmount ?? a.inputAmount) })
    .output({ token: String(a.outputToken), startAmount: bn(a.outputStartAmount), endAmount: bn(a.outputEndAmount), recipient: String(a.recipient ?? a.swapper) });
  if (a.exclusiveFiller) b.exclusiveFiller(String(a.exclusiveFiller), bn(a.exclusivityOverrideBps ?? 0));
  return b.build();
}

const TOOLS = [
  {
    name: "uniswapx_build_order",
    description: "Build a UniswapX Dutch-auction order (a gasless, signature-based swap INTENT) for the user to sign. Non-custodial: returns the EIP-712 typed data the user's OWN wallet signs (via sign_typed_data), plus the order hash and the reactor. The signed order is then broadcast to fillers who execute it on-chain. Uses the current time for the decay window/deadline. Live (nonce/deadline from now) → attested.",
    inputSchema: {
      type: "object",
      properties: {
        chainId:          { type: "number", description: "Chain id (1 = Ethereum mainnet)." },
        swapper:          { type: "string", description: "The user's address (signs the order, non-custodial)." },
        inputToken:       { type: "string", description: "Token the user sells (address)." },
        inputAmount:      { type: "string", description: "Exact input amount, wei." },
        outputToken:      { type: "string", description: "Token the user buys (address)." },
        outputStartAmount:{ type: "string", description: "Output at auction start (best price for the user), wei." },
        outputEndAmount:  { type: "string", description: "Minimum acceptable output at auction end, wei." },
        durationSecs:     { type: "number", description: "Auction decay window in seconds (default 120)." },
      },
      required: ["swapper", "inputToken", "inputAmount", "outputToken", "outputStartAmount", "outputEndAmount"],
    },
  },
  {
    name: "uniswapx_order_hash",
    description: "Compute the EIP-712 order hash of an EXPLICIT UniswapX Dutch order (all fields fixed: deadline, decayStartTime, decayEndTime, nonce, amounts). Deterministic — the same order struct always hashes to the same value, so anyone can independently recompute it. Read-only, no network. Use to verify what uniswapx_build_order produced, or to check a signed order's hash before a filler fills it.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number" }, swapper: { type: "string" }, nonce: { type: "string" },
        deadline: { type: "number" }, decayStartTime: { type: "number" }, decayEndTime: { type: "number" },
        inputToken: { type: "string" }, inputStartAmount: { type: "string" }, inputEndAmount: { type: "string" },
        outputToken: { type: "string" }, outputStartAmount: { type: "string" }, outputEndAmount: { type: "string" },
        recipient: { type: "string" },
      },
      required: ["swapper", "nonce", "deadline", "decayStartTime", "decayEndTime",
                 "inputToken", "inputStartAmount", "inputEndAmount", "outputToken", "outputStartAmount", "outputEndAmount"],
    },
  },
];

function buildLive(a: any): string {
  const now = Math.floor(Date.now() / 1000);
  const dur = Number(a.durationSecs ?? 120);
  // Permit2 uses unordered nonces — a large pseudo-random one is fine for an intent.
  const nonce = BigNumber.from(now).mul(1_000_000).add(Math.floor(Math.random() * 1_000_000)).toString();
  const fields = {
    chainId: a.chainId ?? 1, swapper: a.swapper, nonce,
    deadline: now + dur + 60, decayStartTime: now, decayEndTime: now + dur,
    inputToken: a.inputToken, inputStartAmount: a.inputAmount, inputEndAmount: a.inputAmount,
    outputToken: a.outputToken, outputStartAmount: a.outputStartAmount, outputEndAmount: a.outputEndAmount,
    recipient: a.recipient ?? a.swapper,
  };
  const order = buildOrder(fields);
  const pd = order.permitData();
  return JSON.stringify({
    protocol: "UniswapX (ExclusiveDutchOrder)",
    orderHash: order.hash(),
    chainId: fields.chainId,
    reactor: order.info.reactor,
    order: fields,
    eip712: { domain: pd.domain, types: pd.types, values: pd.values },
    serialized: order.serialize(),
    note: "Non-custodial INTENT. Sign the eip712 payload with sign_typed_data (the user's own wallet), then broadcast the signed order to fillers. Verify: uniswapx_order_hash on these exact fields reproduces orderHash, and the signature recovers to the swapper.",
  });
}

function orderHash(a: any): string {
  const order = buildOrder(a);
  return JSON.stringify({
    protocol: "UniswapX (ExclusiveDutchOrder)",
    orderHash: order.hash(),
    chainId: Number(a.chainId ?? 1),
    note: "Deterministic EIP-712 order hash — byte-reproducible from the explicit order struct. Independently recomputable.",
  });
}

// ─── MCP endpoint (JSON-RPC) ──────────────────────────────────────────────────
uniswapxRoutes.post("/", async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const { method, params, id } = body;
  if (method === "tools/list") return c.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const name = params?.name as string;
    const args = params?.arguments ?? {};
    try {
      let text: string;
      if      (name === "uniswapx_build_order") text = buildLive(args);
      else if (name === "uniswapx_order_hash")  text = orderHash(args);
      else return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e?.message ?? String(e) }) }] } });
    }
  }
  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

uniswapxRoutes.get("/health", (c) =>
  c.json({ ok: true, tools: TOOLS.map(t => t.name), protocol: "UniswapX · ExclusiveDutchOrder" })
);
