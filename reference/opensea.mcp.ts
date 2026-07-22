import { Hono } from "hono";
import { ethers } from "ethers";

export const openseaRoutes = new Hono();

const BASE      = "https://api.opensea.io/api/v2";
const API_KEY   = process.env.OPENSEA_API_KEY || "";

// OpenSea chain slug ↔ chainId mapping
const CHAIN_SLUGS: Record<string, number> = {
  ethereum: 1, matic: 137, base: 8453, arbitrum: 42161,
  optimism: 10, avalanche: 43114, bsc: 56, blast: 81457,
  zora: 7777777, klaytn: 8217,
};
const CHAIN_IDS: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_SLUGS).map(([k, v]) => [v, k])
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "opensea_get_nft",
    description: "Get metadata, traits, owner, and best listing price for a specific NFT from OpenSea. Supports Ethereum, Base, Polygon, and other chains.",
    inputSchema: {
      type: "object",
      properties: {
        chain:    { type: "string", description: "Chain slug: ethereum, base, matic, arbitrum, optimism, avalanche, bsc, blast, zora" },
        contract: { type: "string", description: "NFT contract address (0x...)" },
        token_id: { type: "string", description: "Token ID as a string" },
      },
      required: ["chain", "contract", "token_id"],
    },
  },
  {
    name: "opensea_get_collection_stats",
    description: "Get OpenSea collection statistics: floor price, total volume, sales count, number of owners. Pass the collection slug (e.g. 'boredapeyachtclub', 'azuki').",
    inputSchema: {
      type: "object",
      properties: {
        collection_slug: { type: "string", description: "OpenSea collection slug (the URL-friendly name, e.g. 'boredapeyachtclub')" },
      },
      required: ["collection_slug"],
    },
  },
  {
    name: "opensea_get_listings",
    description: "Get the cheapest active listings for an NFT collection on OpenSea. Returns order hashes, prices, and token IDs needed to call opensea_buy_nft.",
    inputSchema: {
      type: "object",
      properties: {
        collection_slug: { type: "string", description: "OpenSea collection slug" },
        limit:           { type: "number", description: "Number of listings to return (max 100, default 5)" },
      },
      required: ["collection_slug"],
    },
  },
  {
    name: "opensea_buy_nft",
    description: "Get the ready-to-sign Seaport transaction calldata to buy a specific NFT listing on OpenSea. Call opensea_get_listings first to get the order_hash and protocol_address. Returns swapTx for use with send_transaction.",
    inputSchema: {
      type: "object",
      properties: {
        order_hash:       { type: "string", description: "Listing order hash (0x...) from opensea_get_listings" },
        chain:            { type: "string", description: "Chain slug where the NFT is listed (e.g. ethereum, base)" },
        protocol_address: { type: "string", description: "Seaport contract address from the listing" },
        buyer_address:    { type: "string", description: "Buyer wallet address (0x...) — must be the connected wallet" },
      },
      required: ["order_hash", "chain", "protocol_address", "buyer_address"],
    },
  },
  {
    name: "opensea_encode_fulfillment",
    description: "Encode Seaport fulfillBasicOrder calldata from EXPLICIT order parameters — the `fulfillment_data.transaction.function` + `input_data.parameters` shape OpenSea returns. No live order fetch, no network. Deterministic and independently recomputable (byte-identical ABI encoding, graded by nft-fulfill.v0). Use to verify what opensea_buy_nft builds from a given order.",
    inputSchema: {
      type: "object",
      properties: {
        function: { type: "string", description: "The Seaport function signature, e.g. fulfillBasicOrder_efficient_6GL6yc((address,uint256,uint256,address,address,address,uint256,uint256,uint8,uint256,uint256,bytes32,uint256,bytes32,bytes32,uint256,(uint256,address)[],bytes))" },
        parameters: { type: "object", description: "BasicOrderParameters as OpenSea's named fields: considerationToken/Identifier/Amount, offerer, zone, offerToken/Identifier/Amount, basicOrderType, startTime, endTime, zoneHash, salt, offererConduitKey, fulfillerConduitKey, totalOriginalAdditionalRecipients, additionalRecipients[], signature." },
      },
      required: ["function", "parameters"],
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function osHeaders(): Record<string, string> {
  return { "x-api-key": API_KEY, Accept: "application/json" };
}

async function osFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: osHeaders(), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { error: text.slice(0, 200) } }; }
}

// Encode Seaport fulfillBasicOrder calldata from OpenSea's named parameters
function encodeBasicOrderCalldata(fn: string, params: Record<string, any>): string {
  const iface = new ethers.Interface([`function ${fn}`]);
  const fnName = fn.split("(")[0];
  const args = [
    params.considerationToken,
    params.considerationIdentifier,
    params.considerationAmount,
    params.offerer,
    params.zone,
    params.offerToken,
    params.offerIdentifier,
    params.offerAmount,
    params.basicOrderType,
    params.startTime,
    params.endTime,
    params.zoneHash,
    params.salt,
    params.offererConduitKey,
    params.fulfillerConduitKey,
    params.totalOriginalAdditionalRecipients,
    (params.additionalRecipients ?? []).map((r: any) => [r.amount, r.recipient]),
    params.signature,
  ];
  return iface.encodeFunctionData(fnName, [args]);
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function getNft(args: { chain: string; contract: string; token_id: string }): Promise<string> {
  const r = await osFetch(`${BASE}/chain/${args.chain}/contract/${args.contract}/nfts/${args.token_id}`);
  if (!r.ok) return JSON.stringify({ error: r.data?.errors?.[0] ?? r.data?.detail ?? `OpenSea error ${r.status}` });
  const n = r.data.nft;

  // Also try to get best listing price
  const lr = await osFetch(
    `${BASE}/chain/${args.chain}/contract/${args.contract}/nfts/${args.token_id}/best_listing`
  );
  const listing = lr.ok ? lr.data : null;
  const price = listing?.price?.current;

  return JSON.stringify({
    name:        n.name || `#${n.identifier}`,
    identifier:  n.identifier,
    collection:  n.collection,
    contract:    n.contract,
    chain:       args.chain,
    chainId:     CHAIN_SLUGS[args.chain],
    token_standard: n.token_standard,
    image_url:   n.display_image_url ?? n.image_url,
    opensea_url: n.opensea_url,
    traits:      n.traits?.map((t: any) => ({ type: t.trait_type, value: t.value })),
    listing: listing ? {
      order_hash:       listing.order_hash,
      protocol_address: listing.protocol_address,
      price_eth:        price ? (Number(price.value) / 10 ** price.decimals).toFixed(4) : null,
      price_wei:        price?.value,
      currency:         price?.currency,
    } : null,
  });
}

async function getCollectionStats(args: { collection_slug: string }): Promise<string> {
  const [cr, sr] = await Promise.all([
    osFetch(`${BASE}/collections/${args.collection_slug}`),
    osFetch(`${BASE}/collections/${args.collection_slug}/stats`),
  ]);
  if (!cr.ok) return JSON.stringify({ error: cr.data?.errors?.[0] ?? cr.data?.detail ?? `OpenSea error ${cr.status}` });

  const col  = cr.data;
  const stat = sr.ok ? sr.data : {};

  return JSON.stringify({
    name:            col.name,
    slug:            col.collection,
    description:     col.description?.slice(0, 200),
    image_url:       col.image_url,
    opensea_url:     `https://opensea.io/collection/${col.collection}`,
    total_supply:    col.total_supply,
    floor_price:     stat.total?.floor_price,
    floor_currency:  stat.total?.floor_price_symbol,
    total_volume:    stat.total?.volume,
    total_sales:     stat.total?.sales,
    num_owners:      stat.total?.num_owners,
    royalty_bps:     col.fees?.[0]?.fee ? Math.round(col.fees[0].fee * 100) : null,
    intervals: {
      "1d":  { volume: stat.intervals?.[0]?.volume, sales: stat.intervals?.[0]?.sales },
      "7d":  { volume: stat.intervals?.[1]?.volume, sales: stat.intervals?.[1]?.sales },
      "30d": { volume: stat.intervals?.[2]?.volume, sales: stat.intervals?.[2]?.sales },
    },
  });
}

async function getListings(args: { collection_slug: string; limit?: number }): Promise<string> {
  const limit = Math.min(args.limit ?? 5, 100);
  const r = await osFetch(`${BASE}/listings/collection/${args.collection_slug}/best?limit=${limit}`);
  if (!r.ok) return JSON.stringify({ error: r.data?.errors?.[0] ?? r.data?.detail ?? `OpenSea error ${r.status}` });

  const listings = (r.data.listings ?? []).map((l: any) => {
    const price = l.price?.current;
    return {
      order_hash:       l.order_hash,
      chain:            l.chain,
      protocol_address: l.protocol_address,
      token_id:         l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria,
      contract:         l.protocol_data?.parameters?.offer?.[0]?.token,
      price_eth:        price ? (Number(price.value) / 10 ** price.decimals).toFixed(4) : null,
      price_wei:        price?.value,
      currency:         price?.currency,
      expiry:           new Date(Number(l.protocol_data?.parameters?.endTime ?? 0) * 1000).toISOString(),
      type:             l.type,
      // Enriched below from the NFT endpoint so suggestion cards have media.
      name:             null as string | null,
      collection:       args.collection_slug as string | null,
      image_url:        null as string | null,
      traits:           undefined as { type: string; value: any }[] | undefined,
    };
  });

  // Enrich each listing (bounded by limit) with image/name/traits so the client
  // can render gallery cards from a single tool call. Best-effort: a failed
  // lookup leaves the placeholder nulls and never breaks the listing result.
  await Promise.all(listings.map(async (l: any) => {
    if (!l.contract || l.token_id == null) return;
    const nr = await osFetch(`${BASE}/chain/${l.chain ?? "ethereum"}/contract/${l.contract}/nfts/${l.token_id}`);
    if (!nr.ok) return;
    const n = nr.data?.nft;
    if (!n) return;
    l.name      = n.name || `#${n.identifier ?? l.token_id}`;
    l.image_url = n.display_image_url ?? n.image_url ?? null;
    l.traits    = n.traits?.map((t: any) => ({ type: t.trait_type, value: t.value }));
  }));

  // Fallback: tokens OpenSea has no media for (sparse/old collections) get the
  // collection logo so cards are never blank. Fetched once, only if needed.
  if (listings.some((l: any) => !l.image_url)) {
    const cr = await osFetch(`${BASE}/collections/${args.collection_slug}`);
    const collImg = cr.ok ? (cr.data?.image_url ?? null) : null;
    if (collImg) for (const l of listings) if (!l.image_url) l.image_url = collImg;
  }

  return JSON.stringify({ listings, count: listings.length });
}

// Pure, deterministic encoder: the same Seaport calldata buyNft builds, but from EXPLICIT order
// parameters (no live OpenSea fetch). Recomputable byte-for-byte — cast reproduces it from the ABI.
async function encodeFulfillment(args: { function?: string; parameters?: Record<string, any> }): Promise<string> {
  const fn = String(args?.function ?? "");
  const params = args?.parameters;
  if (!fn || !params || typeof params !== "object") {
    return JSON.stringify({ error: "function (Seaport signature) and parameters (BasicOrderParameters) are required" });
  }
  try {
    const data = encodeBasicOrderCalldata(fn, params);
    return JSON.stringify({
      swapTx: { data, encoding: fn.split("(")[0] },
      note: "Deterministic Seaport fulfillBasicOrder calldata from explicit parameters — recomputable byte-for-byte (nft-fulfill.v0). No live order fetch.",
    });
  } catch (e: any) {
    return JSON.stringify({ error: `encode failed: ${e?.message ?? e}` });
  }
}

async function buyNft(args: {
  order_hash: string;
  chain: string;
  protocol_address: string;
  buyer_address: string;
}): Promise<string> {
  const res = await fetch(`${BASE}/listings/fulfillment_data`, {
    method:  "POST",
    headers: { ...osHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      listing:   { hash: args.order_hash, chain: args.chain, protocol_address: args.protocol_address },
      fulfiller: { address: args.buyer_address },
    }),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let d: any;
  try { d = JSON.parse(text); } catch { return JSON.stringify({ error: `OpenSea returned non-JSON: ${text.slice(0, 200)}` }); }
  if (!res.ok) return JSON.stringify({ error: d?.errors?.[0] ?? d?.detail ?? `OpenSea error ${res.status}` });

  const tx = d.fulfillment_data?.transaction;
  if (!tx) return JSON.stringify({ error: "No transaction data returned" });

  let calldata: string;
  try {
    calldata = encodeBasicOrderCalldata(tx.function, tx.input_data.parameters);
  } catch (e: any) {
    return JSON.stringify({ error: `Failed to encode calldata: ${e.message}` });
  }

  const valueWei = String(tx.value ?? "0");
  const chainId  = typeof tx.chain === "number" ? tx.chain : (CHAIN_SLUGS[args.chain] ?? 1);

  return JSON.stringify({
    swapTx: {
      to:      tx.to,
      data:    calldata,
      value:   valueWei,
      chainId,
      txParams: { gasLimit: 200000 },
      // Refresh params: the gateway re-runs this tool server-side at signing time and
      // rebuilds the exact calldata — so a mis-copied `data` (Seaport calldata is ~900
      // bytes, too long for the model to reproduce) can't cause InvalidBasicOrderParameterEncoding.
      refreshMcp:  "opensea",
      refreshTool: "opensea_buy_nft",
      refreshArgs: JSON.stringify({
        order_hash:       args.order_hash,
        chain:            args.chain,
        protocol_address: args.protocol_address,
        buyer_address:    args.buyer_address,
      }),
    },
    _instructions: "Call send_transaction with cardType=\"nft_buy\" and pass ALL of these swapTx fields — especially refreshMcp, refreshTool and refreshArgs verbatim. The gateway rebuilds the exact calldata from those at signing time, so you do NOT need to reproduce `data` perfectly.",
    summary: {
      protocol: d.protocol,
      price_eth: (Number(valueWei) / 1e18).toFixed(4),
      to_contract: tx.to,
    },
  });
}

// ─── MCP endpoint ─────────────────────────────────────────────────────────────

openseaRoutes.post("/", async (c) => {
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
      if      (name === "opensea_get_nft")              text = await getNft(args);
      else if (name === "opensea_get_collection_stats") text = await getCollectionStats(args);
      else if (name === "opensea_get_listings")         text = await getListings(args);
      else if (name === "opensea_buy_nft")              text = await buyNft(args);
      else if (name === "opensea_encode_fulfillment")   text = await encodeFulfillment(args);
      else return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] } });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

openseaRoutes.get("/health", (c) =>
  c.json({ ok: true, tools: TOOLS.map(t => t.name), api_key_set: !!API_KEY })
);
