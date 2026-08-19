/**
 * Torn abroad-stock logger.
 *
 * Polls YATA's public crowd-sourced foreign-stock export every minute and
 * writes any genuinely new data points (deduped by item + country + the
 * source's own "last updated" timestamp) into D1.
 *
 * NOTE ON FRESHNESS: Torn's own API does not expose foreign stock at all —
 * this data is community-reported (players traveling abroad share what they
 * see). Polling every minute guarantees WE check often enough, but it can't
 * guarantee the underlying data itself is under 90s old — that depends on
 * how recently someone actually visited that country. Every row we store
 * includes `source_update` (YATA's own timestamp for that country) and
 * `fetched_at` (when we saw it), so you can always compute real staleness
 * per row instead of assuming it's fresh.
 */

const YATA_EXPORT_URL = "https://yata.yt/api/v1/travel/export/";

// The 15 items you want to track. Matching is case-insensitive against
// YATA's `name` field, so this doesn't depend on knowing numeric item IDs.
const TARGET_ITEMS = [
  "Insulin",
  "Bear Gall",
  "Turtle Shell",
  "Shark Fin",
  "Ship in a Bottle",
  "Patagonian Fossil",
  "Tear Gas",
  "Neumune Tablet",
  "Pangolin Scales",
  "Tiger Bone Powder",
  "Ambergris Lump",
  "Natural Pearls",
  "Raw Ivory",
  "Uncut Diamonds",
  "Smoke Grenade",
].map((name) => name.toLowerCase());

// Converts an array of row objects into a CSV string.
// Wraps any value containing a comma, quote, or newline in quotes and
// escapes internal quotes by doubling them, per standard CSV rules.
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    const str = String(val ?? "");
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

async function pollAndStore(env) {
  const res = await fetch(YATA_EXPORT_URL, {
    headers: { "User-Agent": "torn-abroad-stock-logger (personal use)" },
  });

  if (!res.ok) {
    console.error(`YATA export fetch failed: ${res.status} ${res.statusText}`);
    return { inserted: 0, checked: 0, error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  const stocksByCountry = data.stocks || {};
  const fetchedAt = Math.floor(Date.now() / 1000);

  const rows = [];
  for (const [countryCode, countryData] of Object.entries(stocksByCountry)) {
    const sourceUpdate = countryData.update ?? data.timestamp ?? fetchedAt;
    const items = countryData.stocks || [];
    for (const item of items) {
      if (!item?.name) continue;
      if (!TARGET_ITEMS.includes(item.name.toLowerCase())) continue;
      rows.push({
        item_id: item.id,
        item_name: item.name,
        country: countryCode,
        quantity: item.quantity,
        cost: item.cost,
        source_update: sourceUpdate,
        fetched_at: fetchedAt,
      });
    }
  }

  let inserted = 0;
  for (const row of rows) {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO stock_log
        (item_id, item_name, country, quantity, cost, source_update, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.item_id,
        row.item_name,
        row.country,
        row.quantity,
        row.cost,
        row.source_update,
        row.fetched_at
      )
      .run();
    if (result.meta.changes > 0) inserted++;
  }

  return { inserted, checked: rows.length };
}

export default {
  // Runs on the cron schedule defined in wrangler.toml.
  async scheduled(event, env, ctx) {
    const summary = await pollAndStore(env);
    console.log(
      `[torn-abroad-stock] checked=${summary.checked} inserted=${summary.inserted}`
    );
  },

  // Lets you trigger a poll manually and view/export logged data from a browser.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/poll") {
      const summary = await pollAndStore(env);
      return Response.json(summary);
    }

    if (url.pathname === "/data") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 5000);
      const item = url.searchParams.get("item"); // optional filter
      let query = `SELECT * FROM stock_log`;
      const binds = [];
      if (item) {
        query += ` WHERE item_name = ?`;
        binds.push(item);
      }
      query += ` ORDER BY fetched_at DESC LIMIT ?`;
      binds.push(limit);
      const { results } = await env.DB.prepare(query)
        .bind(...binds)
        .all();

      const format = (url.searchParams.get("format") || "json").toLowerCase();
      if (format === "csv") {
        const csv = toCsv(results);
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="stock_log.csv"',
          },
        });
      }

      return Response.json(results);
    }

    return new Response(
      "Torn abroad stock logger.\nGET /poll to trigger a manual check.\nGET /data?item=Insulin&limit=100&format=csv to view/download logged rows (format=json or csv, default json).",
      { headers: { "content-type": "text/plain" } }
    );
  },
};
