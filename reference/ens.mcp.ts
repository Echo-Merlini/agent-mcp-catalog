import { Hono } from "hono";
import { ethers } from "ethers";

// ENS MCP — the first ENS *write* MCP: register .eth names and manage records
// DIRECTLY against the ENS protocol, non-custodially. Read tools (availability,
// price) run hands-off; every write returns ready-to-sign calldata the user's OWN
// wallet signs (via send_transaction) — nothing custodial. Every action then flows
// through the attestation pipeline, so a registration or record change is
// recomputable. Existing ENS MCPs are read-only; this one acts. Don't trust. Recompute.

export const ensRoutes = new Hono();

// Mainnet ENS deployment.
const CONTROLLER = "0x253553366Da8546fC250F225fe3d25d0C782303b"; // ETHRegistrarController
const RESOLVER   = "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"; // PublicResolver
const REVERSE    = "0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb"; // ReverseRegistrar
const RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
];
const YEAR = 31536000;

const CONTROLLER_ABI = [
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (tuple(uint256 base, uint256 premium))",
  "function makeCommitment(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) view returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable",
  "function minCommitmentAge() view returns (uint256)",
];
const RESOLVER_ABI = [
  "function setText(bytes32 node, string key, string value)",
  "function setAddr(bytes32 node, address a)",
];
const REVERSE_ABI = ["function setName(string name) returns (bytes32)"];

async function withProvider<T>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
  let last: any;
  for (const url of RPCS) {
    try { return await fn(new ethers.JsonRpcProvider(url, 1, { staticNetwork: true })); }
    catch (e) { last = e; }
  }
  throw new Error(`All RPCs failed: ${last?.message ?? last}`);
}

// "alice" or "alice.eth" → { label:"alice", full:"alice.eth" }. Rejects subnames/dots.
function parseName(input: string): { label: string; full: string } {
  const label = String(input || "").trim().toLowerCase().replace(/\.eth$/, "");
  if (!label || label.includes(".")) throw new Error(`Pass a single .eth label (e.g. "alice"), not "${input}".`);
  return { label, full: `${label}.eth` };
}

const eth = (wei: bigint) => `${Number(ethers.formatEther(wei)).toFixed(5).replace(/\.?0+$/, "")} ETH`;

const CTRL = () => new ethers.Interface(CONTROLLER_ABI);
const RES  = () => new ethers.Interface(RESOLVER_ABI);
const REV  = () => new ethers.Interface(REVERSE_ABI);

async function priceWei(label: string, duration: number): Promise<bigint> {
  return withProvider(async (p) => {
    const c = new ethers.Contract(CONTROLLER, CONTROLLER_ABI, p);
    const pr: any = await c.rentPrice(label, duration);
    return BigInt(pr.base ?? pr[0]) + BigInt(pr.premium ?? pr[1]);
  });
}

const TOOLS = [
  {
    name: "ens_check",
    description: "Check whether a .eth name is available to register and its annual price, directly from the ENS ETHRegistrarController. Read-only. Use before registering.",
    inputSchema: { type: "object", properties: {
      name:  { type: "string", description: 'The .eth name/label, e.g. "alice" or "alice.eth".' },
      years: { type: "number", description: "Registration length in years (default 1)." },
    }, required: ["name"] },
  },
  {
    name: "ens_register_commit",
    description: "STEP 1 of registering a .eth name (ENS uses a commit→wait→register scheme to stop front-running). Returns commitTx calldata to sign via send_transaction, PLUS a `secret` and the exact params. After signing, WAIT ~60 seconds, then call ens_register with the SAME name, owner, years and secret.",
    inputSchema: { type: "object", properties: {
      name:  { type: "string", description: 'The .eth label to register, e.g. "alice".' },
      owner: { type: "string", description: "The user's wallet address (0x...) — will own the name and sign both txs." },
      years: { type: "number", description: "Registration length in years (default 1)." },
    }, required: ["name", "owner"] },
  },
  {
    name: "ens_register",
    description: "STEP 2 of registering a .eth name — call ~60s after ens_register_commit with the SAME name, owner, years and the secret it returned. Returns registerTx calldata (with the ETH value) to sign via send_transaction. The user's wallet pays and receives the name.",
    inputSchema: { type: "object", properties: {
      name:   { type: "string", description: "Same .eth label used in ens_register_commit." },
      owner:  { type: "string", description: "Same owner wallet address (0x...)." },
      years:  { type: "number", description: "Same registration length in years (default 1)." },
      secret: { type: "string", description: "The 0x... secret returned by ens_register_commit." },
    }, required: ["name", "owner", "secret"] },
  },
  {
    name: "ens_set_text",
    description: "Set a text record on a .eth name you own (e.g. url, com.twitter, avatar, description, or an ENSIP-25 agent-registration record). Returns setText calldata to sign via send_transaction. Non-custodial.",
    inputSchema: { type: "object", properties: {
      name:  { type: "string", description: 'The .eth name you own, e.g. "alice.eth".' },
      key:   { type: "string", description: 'Record key, e.g. "url", "com.twitter", "avatar", "description".' },
      value: { type: "string", description: "Record value." },
    }, required: ["name", "key", "value"] },
  },
  {
    name: "ens_set_addr",
    description: "Set the ETH address a .eth name resolves to. Returns setAddr calldata to sign via send_transaction. Non-custodial.",
    inputSchema: { type: "object", properties: {
      name:    { type: "string", description: 'The .eth name you own, e.g. "alice.eth".' },
      address: { type: "string", description: "The address (0x...) the name should resolve to." },
    }, required: ["name", "address"] },
  },
  {
    name: "ens_set_primary",
    description: "Set a .eth name as the caller's primary (reverse) record, so their address resolves back to this name. Returns Reverse Registrar setName calldata to sign via send_transaction.",
    inputSchema: { type: "object", properties: {
      name: { type: "string", description: 'The .eth name to set as primary, e.g. "alice.eth".' },
    }, required: ["name"] },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function check(args: any): Promise<string> {
  const { label, full } = parseName(args.name);
  const years = Math.max(1, Number(args.years ?? 1));
  const duration = years * YEAR;
  return withProvider(async (p) => {
    const c = new ethers.Contract(CONTROLLER, CONTROLLER_ABI, p);
    const available: boolean = await c.available(label);
    if (!available) return JSON.stringify({ name: full, available: false, note: "Already registered — try a different name or check its records." });
    const wei = await priceWei(label, duration);
    return JSON.stringify({ name: full, available: true, years, price: eth(wei), note: "Available. To buy it: ens_register_commit → wait ~60s → ens_register." });
  });
}

async function registerCommit(args: any): Promise<string> {
  const { label, full } = parseName(args.name);
  const owner = ethers.getAddress(String(args.owner));
  const years = Math.max(1, Number(args.years ?? 1));
  const duration = years * YEAR;
  const secret = ethers.hexlify(ethers.randomBytes(32));
  return withProvider(async (p) => {
    const c = new ethers.Contract(CONTROLLER, CONTROLLER_ABI, p);
    if (!(await c.available(label))) return JSON.stringify({ error: `${full} is not available.` });
    const commitment: string = await c.makeCommitment(label, owner, duration, secret, RESOLVER, [], false, 0);
    let wait = 60; try { wait = Number(await c.minCommitmentAge()); } catch {}
    const wei = await priceWei(label, duration);
    const data = CTRL().encodeFunctionData("commit", [commitment]);
    return JSON.stringify({
      step: "1/2 commit",
      commitTx: { to: CONTROLLER, data, value: "0", chainId: 1, description: `Commit to register ${full}` },
      secret, name: label, owner, years,
      price: eth(wei),
      waitSeconds: wait,
      note: `Sign commitTx via send_transaction. Then WAIT ${wait}s and call ens_register with name="${label}", owner, years=${years}, secret. Keep the secret exactly.`,
    });
  });
}

async function register(args: any): Promise<string> {
  const { label, full } = parseName(args.name);
  const owner = ethers.getAddress(String(args.owner));
  const years = Math.max(1, Number(args.years ?? 1));
  const duration = years * YEAR;
  const secret = String(args.secret);
  if (!/^0x[a-fA-F0-9]{64}$/.test(secret)) return JSON.stringify({ error: "Invalid secret — use the 0x… value from ens_register_commit." });
  const wei = await priceWei(label, duration);
  const value = (wei * 105n) / 100n; // +5% buffer; controller refunds the excess
  const data = CTRL().encodeFunctionData("register", [label, owner, duration, secret, RESOLVER, [], false, 0]);
  return JSON.stringify({
    step: "2/2 register",
    registerTx: { to: CONTROLLER, data, value: value.toString(), chainId: 1, description: `Register ${full} for ${years} year(s)` },
    name: full, owner, years,
    price: eth(wei),
    note: "Sign registerTx via send_transaction. The wallet pays the price (+5% buffer, excess refunded) and receives the name. If it reverts, the 60s commitment window may not have elapsed — wait and retry.",
  });
}

async function setText(args: any): Promise<string> {
  const { full } = parseName(args.name);
  const node = ethers.namehash(full);
  const data = RES().encodeFunctionData("setText", [node, String(args.key), String(args.value)]);
  return JSON.stringify({ setTextTx: { to: RESOLVER, data, value: "0", chainId: 1, description: `Set ${args.key} on ${full}` }, name: full, key: args.key, note: "Sign via send_transaction (you must own/manage the name)." });
}

async function setAddr(args: any): Promise<string> {
  const { full } = parseName(args.name);
  const addr = ethers.getAddress(String(args.address));
  const node = ethers.namehash(full);
  const data = RES().encodeFunctionData("setAddr", [node, addr]);
  return JSON.stringify({ setAddrTx: { to: RESOLVER, data, value: "0", chainId: 1, description: `Point ${full} → ${addr}` }, name: full, note: "Sign via send_transaction (you must own/manage the name)." });
}

async function setPrimary(args: any): Promise<string> {
  const { full } = parseName(args.name);
  const data = REV().encodeFunctionData("setName", [full]);
  return JSON.stringify({ setPrimaryTx: { to: REVERSE, data, value: "0", chainId: 1, description: `Set ${full} as your primary ENS name` }, name: full, note: "Sign via send_transaction. Your address will resolve back to this name." });
}

// ─── MCP endpoint ─────────────────────────────────────────────────────────────

ensRoutes.post("/", async (c) => {
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
      switch (name) {
        case "ens_check":            text = await check(args); break;
        case "ens_register_commit":  text = await registerCommit(args); break;
        case "ens_register":         text = await register(args); break;
        case "ens_set_text":         text = await setText(args); break;
        case "ens_set_addr":         text = await setAddr(args); break;
        case "ens_set_primary":      text = await setPrimary(args); break;
        default: return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      }
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e: any) {
      return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: e?.message ?? String(e) }) }] } });
    }
  }

  return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

ensRoutes.get("/health", (c) => c.json({ ok: true, tools: TOOLS.map(t => t.name), chain: 1 }));
