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
| **Alchemy** | On-chain data | Blockchain data reads — balances, token metadata, transaction history, NFT ownership across chains. |
| **Recompute Kit** | Verification | The house verifier — re-derives a claim from the primary artifact at a pinned ref. |
| **Conformance / Verify** | Verification | Grades any MCP against a hash-pinned golden-vector suite — the machine gate as a verb. *(planned)* |
| **Forensics** | Security | Traces fund flows across chains; serves a scam-victim recovery playbook. |
| **Uniswap** | DEX | Direct Uniswap v3 — QuoterV2 price + SwapRouter02 `exactInputSingle` calldata the user's own wallet signs. Every swap recomputable. |
| **0G** | Decentralized storage | Stores/fetches an action's recompute artifacts on 0G Storage — recomputable from a decentralized data layer, not a single server. |
| **ENS** | Identity / naming | The first ENS **write** MCP — check availability + price, register a `.eth` name (commit/reveal), and set records (text / addr / primary). Non-custodial calldata; every action recomputable. Existing ENS MCPs are read-only. |

A machine-readable version is in [`catalog.json`](./catalog.json).

## Verification, lanes & pricing

Every MCP here sits in the **Recomputable** lane — each ships golden vectors, so a call can be re-derived end-to-end from public data, no human in the loop. *Attested* is the exception lane, for a capability that's vouched for but not fully recomputable. Tier tracks **cost-to-run × value-delivered**, not category — it says how to *price*, not what it does.

| MCP | Tier | Pricing model | Grades against |
| --- | --- | --- | --- |
| Recompute Kit | A | Perpetual / free | `recompute-kit/conformance` |
| Conformance / Verify | A | Perpetual / free | `recompute-kit/conformance` |
| Flashbots | A | Perpetual | `execution.v0` |
| Alchemy | B | Term + metered | `data-read.v0` |
| Forensics | B | Term + metered | `data-read.v0` |
| OpenSea | B | Term + metered | `nft-market.v0` |
| 1inch | B | Term + metered | `dex-quote.v0` |
| LI.FI | B | Term (light meter) | `bridge-quote.v0` |
| Symbiosis | B | Term | `bridge-quote.v0` |
| Solana (Jupiter) | B | Term (light meter) | `dex-quote.v0` |
| Uniswap | C | Term + value-priced | `dex-quote.v0` |
| ENS | C | Term + value-priced | `id-write.v0` |
| 0G | C | Term + metered (bytes) | `storage.v0` |

- **Tier A — perpetual / free.** House logic, ~0 cost to run. The Recompute Kit is free on purpose: it's the moat and the message.
- **Tier B — term + metered.** A paid or rate-limited upstream API → renewable access plus honest pass-through of the upstream bill.
- **Tier C — term + value-priced.** A value-moving capability (register an ENS name, move funds, store bytes) → priced on outcome, not cost.

The split baked in: `entitlement = access (term)` vs `credits = variable upstream cost (metered, pool-first then wallet)`. Category conformance suites are being formalized — the model is proven end-to-end on `chronicle_checkpoint_continuity.v0` (below).

## Conformance & the Community lane

Anyone can submit an MCP — and **listing is a recomputable predicate, not a permission.** No committee reviews a submission. The working group ratifies a category's **golden-vector suite** once; after that the gate is machine-only:

1. **Hash-pin the suite.** A category's spec + vectors are content-hashed (SHA-256 over the committed blob bytes). A submission is graded against that exact hash — a mismatch is `unverifiable`, never a silent pass.
2. **Recompute the vectors.** Every vector runs against the submitted MCP; it's conformant *iff* it reproduces every `expected` from the same inputs — not iff it matches some reference implementation.
3. **Auto-record.** Pass + read-only → auto-listed with the green **Recomputable** badge + silver **Community** tag; pass + writes/value → auto-listed with a capability-scope declaration + maintainer bond; not fully recomputable → the amber **Attested** lane. **Premium** (gold) marks an entitlement-gated paid capability.

The run is itself recomputable — anyone re-derives the verdict, so no single runner is the authority. The whole loop is proven end-to-end on **`chronicle_checkpoint_continuity.v0`**: two independently-authored implementations, hash-pinned inputs, reference source kept closed, **20/20** — recorded in [`trustless-ai/recompute-kit`](https://github.com/trustless-ai/recompute-kit/tree/main/conformance) conformance. The `conformance_run` verb (above) is that gate as a callable tool.

## Reference implementations

Actual MCP server code that runs in the kit gateway (self-contained: Hono + ethers, no aggregator):

- [`reference/uniswap.mcp.ts`](./reference/uniswap.mcp.ts) — **Uniswap** direct swaps. `uniswap_quote` (QuoterV2, best fee tier auto-selected) + `uniswap_swap_calldata` (SwapRouter02 `exactInputSingle`). Ethereum + Base, native-ETH aware, RPC failover.
- [`reference/zerog.mcp.ts`](./reference/zerog.mcp.ts) — **0G** decentralized storage. `og_store_artifact` + `og_fetch_artifact` on 0G Storage (`@0gfoundation/0g-storage-ts-sdk`), lazy-loaded so it never blocks startup. Stores an action's recompute artifacts on a decentralized data layer.
- [`reference/ens.mcp.ts`](./reference/ens.mcp.ts) — **ENS** (the first ENS *write* MCP). `ens_check` (availability + price) + `ens_register_commit` / `ens_register` (commit→reveal purchase) + `ens_set_text` / `ens_set_addr` / `ens_set_primary`. Non-custodial calldata; supports ENSIP-25 agent-registration records.

---

## Design notes

- **Non-custodial by default.** Read tools (quotes, stats, routes) run hands-off. Any tool that moves value returns *calldata* — the user's own wallet signs behind an approval card. The gateway holds no key that can spend user funds.
- **Recomputable, not just callable.** The point isn't that an agent has tools — it's that every tool call is committed and re-derivable from public data. An MCP here is a capability you can *audit after the fact*.
- **Per-agent scope.** Tools are assigned per agent, so marketplace/consult consumers only ever reach the surface you intend.

## Contributing

Have an MCP you'd like listed (or want yours to be a recomputable agent capability)? Two paths: open a PR adding it to `catalog.json` + the table above (one-line description + category), or take it through the **Community lane** — submit it against a category's golden-vector suite and let the machine gate list it, no PR and no committee (see *Conformance & the Community lane* above). Read-only tools and non-custodial (calldata-returning) write tools are the best fit.

---

*Maintained alongside [Recomputable Agents](https://github.com/Echo-Merlini/verifiable-agents) · [Vértice Criativo](https://verticecriativo.pt) · Don't trust. Recompute.*
