# Agent MCP Catalog

**A catalog of MCP servers compatible with [Recomputable Agents](https://github.com/Echo-Merlini/verifiable-agents) and the on-chain agent kit.**

> Every tool an agent calls through these MCPs is **attested and recomputable** — anyone can re-derive that the agent did exactly what it reported. *Don't trust. Recompute.*

Agents in the kit are model-agnostic and tool-agnostic: capabilities are **[MCP](https://modelcontextprotocol.io) servers** you plug in per-agent from the gateway admin. This repo is the running list of what's known to work, so a new integrator (or a sponsor) can see at a glance how to make their tool a *verifiable* agent capability.

---

## How to add an MCP to an agent

The kit doesn't hard-code tools — you connect MCP servers at runtime and scope them per agent:

1. **Gateway admin → `/admin/mcps` → Add MCP server** — give it a name, its endpoint URL, and any auth header. This is a pure connection point; no code change.
2. **Assign it to an agent** — each agent gets its own tool scope, so a consult/A2A consumer only ever sees the tools you exposed.
3. **That's it.** The agent can now call the tool — and because every call flows through the attestation pipeline (WYRIWE input-provenance in → Observation-Commitment out), the action is **recomputable on `/verify`**. Adding a tool doesn't just extend the agent; it extends what can be *proven*.

---

## Catalog

| MCP | Category | What it does |
| --- | --- | --- |
| **OpenSea** | NFT market | Collection stats, floor prices, live listings; prepares buy calldata for real NFTs. |
| **LI.FI** | Cross-chain | Best bridge-and-swap route across 30+ chains; returns a ready-to-sign quote. |
| **Symbiosis** | Cross-chain | Read-only quotes + calldata to move value between chains in one step. |
| **1inch** | DEX aggregator | Best swap price across dozens of liquidity sources; limit orders, portfolio data. |
| **Flashbots** | MEV / execution | Private-mempool submission, bundle simulation, block/base-fee reads; anti-sandwich. |
| **Solana (Jupiter)** | Multichain DeFi | Token price, market cap, liquidity and swap routes across every Solana DEX. |
| **Recompute Kit** | Verification | The house verifier — re-derives a claim from the primary artifact at a pinned ref. |
| **Forensics** | Security | Traces fund flows across chains; serves a scam-victim recovery playbook. |
| **Uniswap** | DEX | Direct Uniswap v3 — QuoterV2 price + SwapRouter02 `exactInputSingle` calldata the user's own wallet signs. Every swap recomputable. |
| **0G** | Decentralized storage | Stores/fetches an action's recompute artifacts on 0G Storage — recomputable from a decentralized data layer, not a single server. |

A machine-readable version is in [`catalog.json`](./catalog.json).

## Reference implementations

Actual MCP server code that runs in the kit gateway (self-contained: Hono + ethers, no aggregator):

- [`reference/uniswap.mcp.ts`](./reference/uniswap.mcp.ts) — **Uniswap** direct swaps. `uniswap_quote` (QuoterV2, best fee tier auto-selected) + `uniswap_swap_calldata` (SwapRouter02 `exactInputSingle`). Ethereum + Base, native-ETH aware, RPC failover.
- [`reference/zerog.mcp.ts`](./reference/zerog.mcp.ts) — **0G** decentralized storage. `og_store_artifact` + `og_fetch_artifact` on 0G Storage (`@0gfoundation/0g-storage-ts-sdk`), lazy-loaded so it never blocks startup. Stores an action's recompute artifacts on a decentralized data layer.

---

## Design notes

- **Non-custodial by default.** Read tools (quotes, stats, routes) run hands-off. Any tool that moves value returns *calldata* — the user's own wallet signs behind an approval card. The gateway holds no key that can spend user funds.
- **Recomputable, not just callable.** The point isn't that an agent has tools — it's that every tool call is committed and re-derivable from public data. An MCP here is a capability you can *audit after the fact*.
- **Per-agent scope.** Tools are assigned per agent, so marketplace/consult consumers only ever reach the surface you intend.

## Contributing

Have an MCP you'd like listed (or want yours to be a recomputable agent capability)? Open a PR adding it to `catalog.json` + the table above, with a one-line description and its category. Read-only tools and non-custodial (calldata-returning) write tools are the best fit.

---

*Maintained alongside [Recomputable Agents](https://github.com/Echo-Merlini/verifiable-agents) · [Vértice Criativo](https://verticecriativo.pt) · Don't trust. Recompute.*
