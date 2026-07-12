# Market Watchlist

Track extra **stocks** and **crypto** on the Crucix dashboard. Watchlist symbols get:

- **TRACKED** price tiles with 5-day sparklines in the Macro + Markets panel
- **Market Intelligence** headlines (GDELT, symbol-scoped) in the panel below
- Optional **LLM synthesis** when `LLM_PROVIDER` is configured

Core macro tiles (S&P, BTC, WTI, Gold, etc.) stay fixed. News and extra fetches run **only** for symbols you add.

---

## Default Market Intelligence symbols

These are **always** monitored for news (no need to add via + Track):

| Symbol | Name |
|--------|------|
| BTC-USD | Bitcoin |
| XRP-USD | XRP |
| XLM-USD | Stellar |
| ETH-USD | Ethereum |
| GC=F | Gold |
| SI=F | Silver |

User-added symbols are merged on top. Duplicates of the defaults are rejected in + Track.

Override the list in `crucix.config.mjs` → `marketIntelDefaults`.

---

## Add symbols from the dashboard

1. Open the dashboard → **Macro + Markets** panel → **+ Track**
2. Enter a symbol (`AAPL`, `NVDA`, `BTC`, `SOL`, …)
3. Choose **Stock** or **Crypto** (crypto tickers auto-normalize to Yahoo format, e.g. `BTC` → `BTC-USD`)
4. Optional: display name and **news aliases** (e.g. `Apple, Apple Inc`) to improve headline matching
5. **Test symbol** → **Save**

Stored in `runs/config/market-watchlist.json` (override with `MARKET_WATCHLIST_USER_FILE` in `.env`).

When `ADMIN_TOKEN` is set, paste it in the modal before save/delete (same as the Sources UI).

---

## Symbol format

| You enter | Yahoo symbol | Notes |
|-----------|--------------|-------|
| `AAPL` | `AAPL` | US equities |
| `NVDA` | `NVDA` | |
| `BTC` | `BTC-USD` | Crypto auto-suffix |
| `ETH` | `ETH-USD` | |
| `SOL` | `SOL-USD` | Set type to Crypto |

Max **20** symbols per watchlist.

---

## Market Intelligence

Each sweep (when the watchlist is non-empty):

1. **Yahoo Finance** fetches live quotes for watchlist symbols (in addition to core macro symbols)
2. **GDELT** runs batched news queries built from your symbols + aliases
3. Headlines are **post-filtered** so generic “markets rally” noise is dropped
4. If LLM is enabled, a separate **Market Intelligence** prompt synthesizes 2–4 brief items from watchlist prices + headlines only

Geopolitical **Intelligence Analysis** and the main **Live News Ticker** are unchanged.

---

## Config (`crucix.config.mjs`)

```js
marketIntel: {
  enabled: true,
  maxHeadlinesPerSymbol: 8,
  maxHeadlinesTotal: 40,
  maxInputChars: 6000,
  gdeltTimespan: '48h',
}
```

---

## API

| Method | Route | Auth |
|--------|-------|------|
| GET | `/api/config/market-watchlist` | public |
| POST | `/api/config/market-watchlist/test` | admin |
| POST | `/api/config/market-watchlist` | admin |
| PUT | `/api/config/market-watchlist/:id` | admin |
| DELETE | `/api/config/market-watchlist/:id` | admin |

Dashboard data: `D.markets.tracked`, `D.marketNews`, `D.marketIntel`.
