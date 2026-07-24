import { Hono } from "hono";

// The Graph MCP — queries live blockchain data via The Graph's decentralized network (subgraphs).
// Two lanes, honestly split:
//   • graph_query           — a query at the LATEST block → live data, non-deterministic → ATTESTED
//   • graph_query_at_block  — a query PINNED to a finalized block → byte-reproducible → RECOMPUTABLE
// A subgraph's indexed data at a fixed block is deterministic: any indexer serving that deployment
// returns identical bytes for that block, so recompute-kit can re-run the pinned query independently
// and match it byte-for-byte. That's the recomputable lane — a Graph query anyone can verify, not
// trust. Don't trust. Recompute.
//
// Needs THEGRAPH_API_KEY (free at thegraph.com/studio). Missing key → the tool errors, never blocks
// gateway startup.

export const thegraphRoutes = new Hono();

const KEY = () => process.env.THEGRAPH_API_KEY || "";
const GATEWAY = "https://gateway.thegraph.com/api";

// Default featured subgraph: Uniswap v3 (mainnet). Callers can pass any subgraph id.
const DEFAULT_SUBGRAPH = process.env.THEGRAPH_DEFAULT_SUBGRAPH || "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";

const TOOLS = [
  {
    name: "graph_query",
    description: "Query live blockchain data via a subgraph on The Graph's decentralized network (GraphQL). Returns the latest indexed data. Live and non-deterministic — the evidence for a live query is the action-recompute (WYRIWE), not a golden-vector reproduction. Use for current on-chain state (pool prices, balances, recent swaps).",
    inputSchema: {
      type: "object",
      properties: {
        query:      { type: "string", description: "The GraphQL query string." },
        subgraphId: { type: "string", description: "Subgraph deployment id (defaults to the Uniswap v3 mainnet subgraph)." },
        variables:  { type: "object", description: "Optional GraphQL variables." },
      },
      required: ["query"],
    },
  },
  {
    name: "graph_query_at_block",
    description: "Query a subgraph PINNED to a specific finalized block — a byte-REPRODUCIBLE read. The query should reference the $block variable (e.g. `pool(id:$id, block:{number:$block})`); the block is supplied here. Because a subgraph's indexed data at a fixed block is deterministic, anyone can re-run this exact query at this exact block and get identical bytes — the recomputable lane. Returns { data, block, subgraphId }.",
    inputSchema: {
      type: "object",
      properties: {
        query:      { type: "string", description: "GraphQL query referencing the $block variable for pinning." },
        block:      { type: "integer", description: "The finalized block number to pin the read to." },
        subgraphId: { type: "string", description: "Subgraph deployment id (defaults to the Uniswap v3 mainnet subgraph)." },
        variables:  { type: "object", description: "Optional additional GraphQL variables (merged with { block })." },
      },
      required: ["query", "block"],
    },
  },
];

async function runQuery(subgraphId: string, query: string, variables: any): Promise<any> {
  const key = KEY();
  if (!key) return { error: "The Graph not configured (THEGRAPH_API_KEY)." };
  const url = `${GATEWAY}/${key}/subgraphs/id/${subgraphId}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await r.json();
    if (j.errors) return { error: "GraphQL errors", errors: j.errors };
    return { data: j.data };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

async function query(args: any): Promise<string> {
  const subgraphId = String(args?.subgraphId || DEFAULT_SUBGRAPH);
  const res = await runQuery(subgraphId, String(args?.query ?? ""), args?.variables);
  return JSON.stringify({ subgraphId, network: "The Graph · decentralized network", ...res });
}

async function queryAtBlock(args: any): Promise<string> {
  const subgraphId = String(args?.subgraphId || DEFAULT_SUBGRAPH);
  const block = Number(args?.block);
  if (!Number.isInteger(block) || block <= 0) return JSON.stringify({ error: "block must be a positive integer" });
  const variables = { ...(args?.variables ?? {}), block };
  const res = await runQuery(subgraphId, String(args?.query ?? ""), variables);
  return JSON.stringify({
    subgraphId, block, network: "The Graph · decentralized network",
    note: "Pinned to a finalized block — byte-reproducible: re-run this exact query at this block for identical data. Independently recomputable.",
    ...res,
  });
}

// ─── MCP endpoint (JSON-RPC) ──────────────────────────────────────────────────

thegraphRoutes.post("/", async (c) => {
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
      if      (name === "graph_query")          text = await query(args);
      else if (name === "graph_query_at_block") text = await queryAtBlock(args);
      else return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e?.message ?? String(e) }) }] } });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

thegraphRoutes.get("/health", (c) =>
  c.json({ ok: true, tools: TOOLS.map(t => t.name), network: "The Graph decentralized network", keyConfigured: !!KEY() })
);
