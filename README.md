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
| **ENS** | Identity / naming | **4 recomputable** / 3 attested | `ens_set_addr` · `ens_set_text` · `ens_set_primary` (`ens_write.v0`) + `ens_set_contenthash` (`id-write.v0`, ENSIP-7). Registration/availability are attested. |
| **0G** | Decentralized storage | **1 recomputable** / 2 attested | `og_root` graded against `storage-root.v0` (pure flow-merkle, no upload). `og_store` is the live upload (attested action); `og_fetch` a content read. |
| **Uniswap** | DEX | **1 recomputable** / 2 attested | `uniswap_encode_swap` (pure encoder, explicit minOut) graded against `dex-calldata.v0`. `uniswap_quote` + `uniswap_swap_calldata` are live QuoterV2 reads (attested). |
| **OpenSea** | NFT market | **1 recomputable** / 4 attested | `opensea_encode_fulfillment` (pure Seaport encoder, explicit order) graded against `nft-fulfill.v0`. Reads + the live-order `opensea_buy_nft` are attested. |
| **UniswapX** | DEX / intents | **1 recomputable** / 1 attested | `uniswapx_order_hash` — the EIP-712 hash of an explicit Dutch order is deterministic/byte-reproducible (recomputable). `uniswapx_build_order` builds a live signable intent (attested). Non-custodial: the user signs; fillers execute. |
| **The Graph** | Indexed blockchain data | **1 recomputable** / 1 attested | `graph_query_at_block` graded against `graph-query.v0` — a subgraph read pinned to a finalized block is byte-reproducible across indexers. `graph_query` (latest block) is a live read (attested). |
| **LI.FI** | Cross-chain | 0 / 3 | Routes depend on live cross-chain liquidity — attested by nature. |
| **Flashbots** | MEV / execution | 0 / 4 | Private submit / simulate / status — execution-bound, attested by nature. |
| **Alchemy** | On-chain data | 0 / ~97 | Live multi-chain reads; `tools/list` isn't in the standard shape, so it's graded at MCP level (attested). |
| **Recompute Kit** | Verification | *verifier* | Not graded — it **is** the recomputer that produces every lane above. |
| **Conformance / Verify** | Verification | *verifier* | The gate as a callable verb + the self-service introspect endpoint. **Live** (this is what built this table). |

## Verification lanes today

Honest snapshot — this is what actually has a recipe **right now**, not a vision:

- **Recomputable (live):**
  - the three ENS record-setters, against **`ens_write.v0`** — 5 hash-pinned vectors, `expected` independently derived from EIP-137 namehash + the public resolver ABI (no live read);
  - ENS **`ens_set_contenthash`**, against **`id-write.v0`** — the ENSIP-7 CID→contenthash encoding reimplemented as a *second, independent* Python encoder (not the `@ensdomains/content-hash` JS lib the MCP uses), cross-checked against that library's own golden vectors **and** the live MCP;
  - 0G's **`og_root`**, against **`storage-root.v0`** — the 0G flow-merkle root reimplemented as a *second, independent* Python implementation (not the SDK compared to itself), cross-checked against the 0G SDK's own golden vectors **and** the live MCP;
  - Uniswap's **`uniswap_encode_swap`**, against **`dex-calldata.v0`** — a *pure encoder* (explicit `amountOutMinimum`, no live quote), whose `exactInputSingle` calldata is plain ABI, so `cast` is the independent reference;
  - UniswapX's **`uniswapx_order_hash`**, against **`uniswapx-order.v0`** — a UniswapX Dutch order is a signed EIP-712 *intent*; its order hash is a deterministic function of the explicit order struct, so anyone recomputes it byte-for-byte before a filler fills it (the signature recovers to the swapper, same as our L4 check);
  - OpenSea's **`opensea_encode_fulfillment`**, against **`nft-fulfill.v0`** — a *pure encoder* from explicit Seaport `BasicOrderParameters`, validated byte-for-byte (1674 chars) against a real `fulfillment_data` payload and the live `opensea_buy_nft`;
  - The Graph's **`graph_query_at_block`**, against **`graph-query.v0`** — a subgraph read *pinned to a finalized block* is byte-reproducible across indexers, so the kit re-runs the identical pinned query independently and compares the canonical JSON byte-for-byte (golden sample: the Uniswap v3 USDC/WETH pool TVL at block 20000000). Live (latest-block) reads have no recipe → Attested.

  Grade any of them yourself: point the conformance page at `https://gateway.ensub.org/mcp/ens`, `/mcp/zerog`, `/mcp/uniswap`, or `/mcp/opensea`.
- **Attested:** every other live tool. A real capability that flows through the attestation pipeline, but with no independent recipe, so it honestly lists Attested rather than pretending. (Includes `og_store_artifact` — a live upload is an *action*, not a pure derivation; its returned root still equals `storage-root.v0` and is checkable offline with `og_root`.)
- **Candidate (roadmap):** *empty* — every recomputable-in-principle tool now has a shipped recipe. What stays Attested (LI.FI routes, Flashbots submits, Alchemy reads) is Attested *by nature*: its output depends on live state no one can reproduce offline, so there's no derivation to recompute.

**The three patterns, all shipped:**

| Pattern | When it applies | Shipped recipes |
| --- | --- | --- |
| **Custom encoding** → from-spec impl validated vs published golden vectors | non-ABI (a merkle root, a multicodec CID) | `og_root`/`storage-root.v0` (0G) · `ens_set_contenthash`/`id-write.v0` (ENSIP-7) |
| **Plain ABI** → `cast` is the independent reference for free | standard calldata | the three ENS setters/`ens_write.v0` |
| **Mixed deterministic + live** → expose a pure read-only variant, then it's plain ABI | a live value in the output | `uniswap_encode_swap`/`dex-calldata.v0` · `opensea_encode_fulfillment`/`nft-fulfill.v0` |

The registry is the moat: three encoding families, seven suites, each MCP honest about its recomputable slice vs its attested action — all graded by the same machine gate.

Live-routing, execution, and data-read tools (LI.FI routes, Flashbots submits, Alchemy reads) stay Attested by nature — their output depends on state no one can reproduce offline.

## The suites that exist

Seven golden-vector suites are real today. Each is content-hashed (SHA-256 over the committed blob bytes); a submission is graded against the hash, and a mismatch is `unverifiable`, never a silent pass.

| Suite | Vectors | `vectorsSha256` | Lane |
| --- | --- | --- | --- |
| `ens_write.v0` | 5 | `f4fec32a…333a7` | recomputable |
| `id-write.v0` | 4 | `2724a06d…6c9f` | recomputable |
| `dex-calldata.v0` | 3 | `0f88616f…e282` | recomputable |
| `nft-fulfill.v0` | 2 | `41d91048…ffce` | recomputable |
| `storage-root.v0` | 5 | `5b482eee…8515` | recomputable |
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
- [`reference/uniswap.mcp.ts`](./reference/uniswap.mcp.ts) — **Uniswap** direct swaps. `uniswap_quote` (QuoterV2) + `uniswap_swap_calldata` (live quote → swap) + `uniswap_encode_swap` (pure `exactInputSingle` encoder, explicit minOut — the recomputable one). Ethereum + Base, RPC failover.
- [`reference/opensea.mcp.ts`](./reference/opensea.mcp.ts) — **OpenSea** NFT market. `opensea_get_*` reads + `opensea_buy_nft` (live order → Seaport calldata) + `opensea_encode_fulfillment` (pure `fulfillBasicOrder` encoder from explicit params — the recomputable one).
- [`reference/zerog.mcp.ts`](./reference/zerog.mcp.ts) — **0G** decentralized storage. `og_root` (pure flow-merkle root, no upload — the recomputable one) + `og_store_artifact` + `og_fetch_artifact` on 0G Storage, lazy-loaded so it never blocks startup.

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
