import { Hono } from "hono";
import { ethers } from "ethers";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

// 0G MCP — stores/fetches an agent action's RECOMPUTE ARTIFACTS (the raw input,
// output, or manifest blobs anyone re-derives the result from) on 0G decentralized
// Storage, alongside IPFS. Makes an action recomputable from a decentralized data
// layer, not a single pinning service. The SDK is loaded via a LAZY dynamic import
// so a missing key or SDK issue never blocks gateway startup — only the tool errors.
// Don't trust. Recompute.

export const zerogRoutes = new Hono();

const RPC     = process.env.ZEROG_RPC     || "https://evmrpc-testnet.0g.ai";
const INDEXER = process.env.ZEROG_INDEXER || "https://indexer-storage-testnet-turbo.0g.ai";
const pk = () => process.env.ZEROG_PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY || "";

const TOOLS = [
  {
    name: "og_store_artifact",
    description: "Store a recompute artifact — any text an agent action is recomputed from (the raw input, the output, or the manifest, e.g. a JSON attestation record) — on 0G decentralized Storage. Returns a content-addressed rootHash: the permanent, verifiable handle anyone can fetch it back by. Use to make an action's evidence recomputable from decentralized storage rather than a single server.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The artifact content to store (UTF-8 text, e.g. a JSON attestation record)." },
        label:   { type: "string", description: "Optional short label for the artifact (metadata only)." },
      },
      required: ["content"],
    },
  },
  {
    name: "og_root",
    description: "Compute the 0G Storage rootHash for content WITHOUT uploading — the pure content-addressed flow-merkle root. Read-only, no gas, no network write: the deterministic derivation anyone can independently recompute from the bytes (256-byte chunks, keccak256 leaves, 0G flow-merkle). Use to verify what og_store_artifact WILL return, or to check a stored artifact's handle offline.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The artifact content (UTF-8 text) to compute the 0G root of." },
      },
      required: ["content"],
    },
  },
  {
    name: "og_fetch_artifact",
    description: "Fetch an artifact back from 0G Storage by its rootHash and return its content — so anyone can independently retrieve the exact bytes an agent action was recomputed from.",
    inputSchema: {
      type: "object",
      properties: {
        rootHash: { type: "string", description: "The 0G Storage root hash (0x...) returned by og_store_artifact." },
      },
      required: ["rootHash"],
    },
  },
];

// Read-only root computation: same 0G flow-merkle the store path uses (ZgFile.merkleTree),
// but NO upload — deterministic, gas-free, independently recomputable from the bytes.
async function root(args: any): Promise<string> {
  const content = String(args?.content ?? "");
  if (!content) return JSON.stringify({ error: "content is required" });
  const { ZgFile } = await import("@0gfoundation/0g-storage-ts-sdk");
  const tmp = path.join(os.tmpdir(), `ogr-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    const file = await ZgFile.fromFilePath(tmp);
    const [tree, treeErr] = await file.merkleTree();
    await file.close();
    if (treeErr) return JSON.stringify({ error: `0G merkleTree failed: ${treeErr}` });
    return JSON.stringify({
      rootHash: tree?.rootHash(),
      bytes: Buffer.byteLength(content, "utf8"),
      network: "0G Galileo Storage",
      note: "Pure content-addressed root (no upload). Independently recomputable: 256-byte chunks, keccak256 leaves, 0G flow-merkle.",
    });
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? String(e) });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function store(args: any): Promise<string> {
  const key = pk();
  if (!key) return JSON.stringify({ error: "0G signer not configured (ZEROG_PRIVATE_KEY / GATEWAY_PRIVATE_KEY)." });
  const content = String(args?.content ?? "");
  if (!content) return JSON.stringify({ error: "content is required" });

  const { Indexer, ZgFile } = await import("@0gfoundation/0g-storage-ts-sdk");
  const tmp = path.join(os.tmpdir(), `og-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const signer   = new ethers.Wallet(key, provider);
    const file     = await ZgFile.fromFilePath(tmp);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) { await file.close(); return JSON.stringify({ error: `0G merkleTree failed: ${treeErr}` }); }
    const rootHash = tree?.rootHash();
    const indexer  = new Indexer(INDEXER);
    const res: any = await indexer.upload(file, RPC, signer);
    await file.close();
    const upErr = Array.isArray(res) ? res[1] : null;
    const tx    = Array.isArray(res) ? res[0] : res;
    if (upErr) return JSON.stringify({ error: `0G upload failed: ${upErr?.message ?? upErr}`, rootHash });
    return JSON.stringify({
      stored: true,
      network: "0G Galileo Storage",
      rootHash,
      bytes: Buffer.byteLength(content, "utf8"),
      label: args?.label ?? undefined,
      tx: typeof tx === "string" ? tx : (tx?.txHash ?? tx?.hash ?? undefined),
      note: "Permanent decentralized handle. Fetch it back with og_fetch_artifact(rootHash). The artifact is now recomputable from 0G Storage, not a single server.",
    });
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? String(e) });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function fetchArtifact(args: any): Promise<string> {
  const rootHash = String(args?.rootHash ?? "");
  if (!rootHash) return JSON.stringify({ error: "rootHash is required" });

  const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const out = path.join(os.tmpdir(), `og-dl-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    const indexer = new Indexer(INDEXER);
    const err: any = await indexer.download(rootHash, out, true);
    if (err) return JSON.stringify({ error: `0G download failed: ${err?.message ?? err}` });
    const content = fs.readFileSync(out, "utf8");
    return JSON.stringify({
      fetched: true, rootHash,
      bytes: Buffer.byteLength(content, "utf8"),
      content: content.length > 4000 ? content.slice(0, 4000) + "…(truncated)" : content,
    });
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? String(e) });
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}

// ─── MCP endpoint (JSON-RPC) ──────────────────────────────────────────────────

zerogRoutes.post("/", async (c) => {
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
      if      (name === "og_store_artifact") text = await store(args);
      else if (name === "og_root")           text = await root(args);
      else if (name === "og_fetch_artifact") text = await fetchArtifact(args);
      else return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e?.message ?? String(e) }) }] } });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

zerogRoutes.get("/health", (c) =>
  c.json({ ok: true, tools: TOOLS.map(t => t.name), network: "0G Galileo", rpc: RPC, signerConfigured: !!pk() })
);
