# Agent MCP Catalog

**A catalog of MCP servers you can plug into a [Recomputable Agent](https://github.com/Echo-Merlini/verifiable-agents), each graded by the live conformance gate.**

> A tool is **Recomputable** only when a hash-pinned golden-vector suite can re-derive its output from public rules. Everything else is honestly **Attested** — vouched for, but not yet recomputable. No overclaiming. *Don't trust. Recompute.*

Agents in the kit are model- and tool-agnostic: capabilities are **[MCP](https://modelcontextprotocol.io) servers** you plug in per-agent from the gateway admin. This repo is the running list of what's live, **with each tool's real verification lane derived from the gate itself** — not asserted. Drop any endpoint into the [conformance page](https://demo.verticecriativo.pt/conformance) and it re-derives these lanes in front of you.

The machine-readable source of truth is [`catalog.json`](./catalog.json). The lanes below were derived from a live `POST /conformance/introspect` sweep (2026-07-22).

---

## How to add an MCP to an agent

The kit doesn't hard-code tools — you connect MCP servers at runtime and scope them per agent:

1. **Gateway admin → `/admin/mcps` → Add MCP server** — give it a name, its **public https** endpoint URL, and any auth header. A pure connection point; no code change. *(Use the public `gateway.ensub.org/mcp/…` URL, not an internal `localhost` one — the conformance gate's SSRF guard blocks non-public hosts.)*
2. **Assign it to an agent** — each agent gets its own tool scope, so a consult/A2A consumer only ever sees the tools you exposed.
3. **That's it.** Every call flows through the attestation pipeline (WYRIWE input-provenance in → Observation-Commitment out), so the action is recomputable on `/verify`. Tools that also match a recipe in the registry grade **Recomputable** on the conformance page; the rest list **Attested**.

---

## Catalog — live lanes

Lanes are `recomputable / attested`, straight from the gate. **Recomputable** means a golden-vector suite re-derives the output from public rules; **candidate** means the output is deterministic so a recipe is *feasible but not built yet* (still Attested today, on the roadmap).

| MCP | Category | Lanes (live) | Notes |
| --- | --- | --- | --- |
| **ENS** | Identity / naming | **3 recomputable** / 4 attested | `ens_set_addr` · `ens_set_text` · `ens_set_primary` graded against `ens_write.v0`. Registration + `set_contenthash` (candidate) are attested. |
| **Uniswap** | DEX | 0 / 2 | `uniswap_swap_calldata` is a **candidate** (deterministic `exactInputSingle` calldata); `uniswap_quote` is a live pool read. |
| **0G** | Decentralized storage | 0 / 2 | `og_store_artifact` is a **candidate** (rootHash = merkle over content); `og_fetch` is a content-addressed read. |
| **OpenSea** | NFT market | 0 / 4 | `opensea_buy_nft` is a **candidate** (deterministic Seaport calldata); reads are live market data. |
| **LI.FI** | Cross-chain | 0 / 3 | Routes depend on live cross-chain liquidity — attested by nature. |
| **Flashbots** | MEV / execution | 0 / 4 | Private submit / simulate / status — execution-bound, attested by nature. |
| **Alchemy** | On-chain data | 0 / ~97 | Live multi-chain reads; `tools/list` isn't in the standard shape, so it's graded at MCP level (attested). |
| **Recompute Kit** | Verification | *verifier* | Not graded — it **is** the recomputer that produces every lane above. |
| **Conformance / Verify** | Verification | *verifier* | The gate as a callable verb + the self-service introspect endpoint. **Live** (this is what built this table). |

## Verification lanes today

Honest snapshot — this is what actually has a recipe **right now**, not a vision:

- **Recomputable (live):** the three ENS record-setters, against **`ens_write.v0`** — 5 hash-pinned vectors, `expected` independently derived from EIP-137 namehash + the public resolver ABI (no live read). Grade it yourself: point the conformance page at `https://gateway.ensub.org/mcp/ens`.
- **Attested:** every other live tool. A real capability that flows through the attestation pipeline, but with no independent recipe, so it honestly lists Attested rather than pretending.
- **Candidate (roadmap):** attested tools whose output *is* deterministic, so a recipe is feasible. Each one shipped flips a tool from Attested → Recomputable — **the recipe registry is the moat.**

| Candidate tool | MCP | Planned suite | Why it's recomputable-in-principle |
| --- | --- | --- | --- |
| `og_store_artifact` | 0G | `storage-root.v0` | rootHash is a merkle over the content bytes |
| `uniswap_swap_calldata` | Uniswap | `dex-calldata.v0` | `exactInputSingle` calldata is deterministic ABI-encoding at fixed params/minOut |
| `ens_set_contenthash` | ENS | `id-write.v0` | CID → ENSIP-7 contenthash byte-encoding is deterministic |
| `opensea_buy_nft` | OpenSea | `nft-fulfill.v0` | Seaport fulfillment calldata is deterministic given a specific order |

Live-routing, execution, and data-read tools (LI.FI routes, Flashbots submits, Alchemy reads) stay Attested by nature — their output depends on state no one can reproduce offline.

## The suites that exist

Only three golden-vector suites are real today. Each is content-hashed (SHA-256 over the committed blob bytes); a submission is graded against the hash, and a mismatch is `unverifiable`, never a silent pass.

| Suite | Vectors | `vectorsSha256` | Lane |
| --- | --- | --- | --- |
| `ens_write.v0` | 5 | `f4fec32a…333a7` | recomputable |
| `chronicle_checkpoint_continuity.v0` | 20 | `c369bd39…def93` | recomputable |
| `communication_chain.v0` | 5 | `d9d63cc8…ec6e` | recomputable |

## Conformance & the Community lane

Anyone can submit an MCP — and **listing is a recomputable predicate, not a permission.** No committee reviews a submission. The working group ratifies a category's **golden-vector suite** once; after that the gate is machine-only:

1. **Hash-pin the suite.** A category's spec + vectors are content-hashed. A submission is graded against that exact hash — a mismatch is `unverifiable`, never a silent pass.
2. **Recompute the vectors.** Every vector runs against the submitted MCP; it's conformant *iff* it reproduces every `expected` from the same inputs — not iff it matches some reference implementation.
3. **Auto-record.** Pass → auto-listed with the green **Recomputable** badge; no recipe → the amber **Attested** lane. **Premium** (gold) marks an entitlement-gated paid capability.

The run is itself recomputable — anyone re-derives the verdict + a portable `receiptos.evidence_capsule.v0` receipt, so no single runner is the authority. Proven end-to-end on **`chronicle_checkpoint_continuity.v0`**: two independently-authored implementations, hash-pinned inputs, reference source kept closed, **20/20** — recorded in [`trustless-ai/recompute-kit`](https://github.com/trustless-ai/recompute-kit/tree/main/conformance).

## Reference implementations

Actual MCP server code that runs in the kit gateway (self-contained: Hono + ethers, no aggregator):

- [`reference/ens.mcp.ts`](./reference/ens.mcp.ts) — **ENS** (the first ENS *write* MCP). `ens_check` + `ens_register_commit` / `ens_register` + `ens_set_text` / `ens_set_addr` / `ens_set_primary`. The three setters are the recomputable core.
- [`reference/uniswap.mcp.ts`](./reference/uniswap.mcp.ts) — **Uniswap** direct swaps. `uniswap_quote` (QuoterV2) + `uniswap_swap_calldata` (SwapRouter02 `exactInputSingle`). Ethereum + Base, RPC failover.
- [`reference/zerog.mcp.ts`](./reference/zerog.mcp.ts) — **0G** decentralized storage. `og_store_artifact` + `og_fetch_artifact` on 0G Storage, lazy-loaded so it never blocks startup.

---

## Design notes

- **Non-custodial by default.** Read tools run hands-off. Any tool that moves value returns *calldata* — the user's own wallet signs behind an approval card. The gateway holds no key that can spend user funds.
- **Recomputable, not just callable.** The point isn't that an agent has tools — it's that a tool call is committed and, where a recipe exists, re-derivable from public data.
- **Honest lanes.** A tool is only ever labelled Recomputable when the gate actually reproduces it. Attested is not a lesser badge — it's the truthful one when no recipe exists yet.
- **Per-agent scope.** Tools are assigned per agent, so marketplace/consult consumers only ever reach the surface you intend.

## Contributing

Have an MCP you'd like listed? Two paths: open a PR adding it to `catalog.json` (with its real endpoint and honest lanes), or take it through the **Community lane** — submit it against a category's golden-vector suite and let the machine gate list it, no PR and no committee. Want an Attested tool to become Recomputable? Contribute the recipe for one of the **candidates** above.

---

*Maintained alongside [Recomputable Agents](https://github.com/Echo-Merlini/verifiable-agents) · [Vértice Criativo](https://verticecriativo.pt) · Don't trust. Recompute.*
