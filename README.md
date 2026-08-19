# Torn Abroad Stock Logger

Logs stock/price data for 15 chosen abroad items every minute, sourced from
YATA's public crowd-sourced foreign-stock export (Torn's own API doesn't
expose this data at all — see chat explanation).

## 1. Install Wrangler (Cloudflare's CLI)

```bash
npm install -g wrangler
wrangler login
```

## 2. Create the D1 database

```bash
wrangler d1 create torn-abroad-stock-db
```

This prints a `database_id`. Paste it into `wrangler.toml` in place of
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

## 3. Apply the schema

```bash
wrangler d1 execute torn-abroad-stock-db --remote --file=./schema.sql
```

## 4. Deploy

```bash
wrangler deploy
```

That's it — no API key/secret needed for this version, since YATA's export
endpoint is public. The cron trigger (every 1 minute) is defined in
`wrangler.toml` and starts running automatically after deploy.

## 5. Check it's working

```bash
curl https://<your-worker-subdomain>.workers.dev/poll
curl "https://<your-worker-subdomain>.workers.dev/data?limit=20"
```

`/poll` triggers an immediate manual check and reports how many new rows
were inserted. `/data` lets you browse logged rows, optionally filtered by
item name, e.g. `?item=Insulin`.

## Querying your data later

Once you've got history, you can run SQL directly against D1, e.g.:

```bash
wrangler d1 execute torn-abroad-stock-db --remote --command \
  "SELECT item_name, country, quantity, cost, source_update, fetched_at
   FROM stock_log WHERE item_name = 'Bear Gall' ORDER BY fetched_at DESC LIMIT 50"
```

Or export the whole table to CSV for analysis in a spreadsheet/notebook:

```bash
wrangler d1 execute torn-abroad-stock-db --remote --command \
  "SELECT * FROM stock_log" --json > stock_log.json
```

## On data freshness

Every row stores two timestamps:

- `source_update` — when YATA says that country's data was last refreshed
  by a real traveler
- `fetched_at` — when this worker actually saw and logged it

The worker checks every 60 seconds, so you'll never wait more than ~60s to
*see* new data once it exists — but the data itself is only as fresh as the
last player who visited that country and reported. Some countries update
often; others can go much longer between real reports. Use
`fetched_at - source_update` per row if you need to filter out stale reads
in your analysis.
