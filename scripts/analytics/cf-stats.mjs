/**
 * Analityka odwiedzin landingu Parawan — Cloudflare GraphQL Analytics API.
 *
 * Uruchamiany LOKALNIE, na komputerze właściciela — NIGDY na stronie. Landing nie
 * wykonuje żadnego żądania; dane pochodzą z warstwy CDN (Cloudflare), która i tak widzi
 * ruch jako operator infrastruktury. Dzięki temu obietnica strony „0 żądań / nie zbiera
 * analityki" i licznik #net-count pozostają PRAWDZIWE. Patrz plan i pamięć projektu.
 *
 * Token API — wystarczy uprawnienie „Account Analytics · Read" (sekcja Analytics & Logs
 * przy tworzeniu tokenu). Podaj wtedy Zone ID ręcznie (patrz niżej), bo taki token nie
 * ma prawa listować zon. Alternatywa: token „Zone · Analytics · Read" + „Zone · Read"
 * (wtedy zona wyszukiwana po nazwie, Zone ID niepotrzebny).
 * Gdzie znaleźć Zone ID: dashboard → domena karolwilczynski.com → Overview → prawa
 * kolumna „API" → Zone ID (32 znaki hex).
 *
 * Użycie (Git Bash):
 *   export CLOUDFLARE_API_TOKEN=xxxxx
 *   export CLOUDFLARE_ZONE_ID=xxxxx      # zalecane przy tokenie Account Analytics
 *   node scripts/analytics/cf-stats.mjs --days 7
 * PowerShell:
 *   $env:CLOUDFLARE_API_TOKEN='xxxxx'; $env:CLOUDFLARE_ZONE_ID='xxxxx'
 *   node scripts/analytics/cf-stats.mjs --days 7
 *
 * Flagi:
 *   --days N     okno analizy w dniach (domyślnie 7)
 *   --hours      trend godzinowy zamiast dziennego (dobre dla --days 1..2)
 *   --host NAZWA hostname do filtrowania (domyślnie parawan.karolwilczynski.com)
 *   --zone NAZWA zona nadrzędna, gdy szukamy po nazwie (domyślnie karolwilczynski.com)
 *   --zone-id ID Zone ID wprost (zamiast wyszukiwania; albo env CLOUDFLARE_ZONE_ID)
 *   --top N      ile pozycji w rankingach (domyślnie 10)
 *
 * ZERO zależności (Node 18+: wbudowany fetch), zgodnie z etosem repo.
 */

const API = 'https://api.cloudflare.com/client/v4';
const GQL = 'https://api.cloudflare.com/client/v4/graphql';

// ── argumenty ──
const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DAYS = Math.max(1, Number.parseInt(flag('days', '7'), 10) || 7);
const HOURLY = flag('hours', false) === true;
const HOST = String(flag('host', 'parawan.karolwilczynski.com'));
const ZONE = String(flag('zone', 'karolwilczynski.com'));
const TOP = Math.max(1, Number.parseInt(flag('top', '10'), 10) || 10);

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error(
    'Brak tokenu. Ustaw CLOUDFLARE_API_TOKEN (Zone · Analytics · Read).\n' +
      '  Git Bash:   export CLOUDFLARE_API_TOKEN=xxxxx\n' +
      "  PowerShell: $env:CLOUDFLARE_API_TOKEN='xxxxx'",
  );
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// ── daty (ISO) — bez Date.now w cache-krytycznych miejscach nie dotyczy skryptu CLI ──
function isoRange(days) {
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: now.toISOString() };
}

async function getZoneTag(name) {
  // Preferuj podany Zone ID — wtedy token potrzebuje TYLKO „Account Analytics · Read"
  // (bez prawa do listowania zon). Zone ID: dashboard → domena → Overview → API → Zone ID.
  const given = process.env.CLOUDFLARE_ZONE_ID || flag('zone-id');
  if (given && given !== true) return String(given).trim();
  // Fallback: wyszukaj po nazwie (wymaga dodatkowo uprawnienia „Zone · Read").
  const res = await fetch(`${API}/zones?name=${encodeURIComponent(name)}`, { headers: authHeaders });
  const json = await res.json();
  if (!json.success)
    throw new Error(
      `Nie pobrano zony: ${JSON.stringify(json.errors)}. ` +
        'Podaj Zone ID: --zone-id XXXX albo CLOUDFLARE_ZONE_ID (dashboard → domena → Overview → API → Zone ID).',
    );
  if (!json.result?.length) throw new Error(`Zona „${name}" nie znaleziona na tym koncie.`);
  return json.result[0].id;
}

// Filtr wstawiamy INLINE (bez deklarowania nazwy typu filtra — dokumentacja jej nie
// podaje, a inline nie wymaga jej znać). Zmienne to proste String!.
const gqlVars = (zoneTag, since, until) => ({ zoneTag, since, until, host: HOST });
const FILTER = '{ datetime_geq: $since, datetime_leq: $until, clientRequestHTTPHost: $host }';
const HEAD = 'query($zoneTag: String!, $since: String!, $until: String!, $host: String!)';

async function gql(query, variables) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(json.errors, null, 2)}`);
  return json.data;
}

/** Jak gql, ale nie wywala całości — zwraca [] i ostrzega, gdy dany wymiar nie istnieje. */
async function gqlSafe(query, variables, label) {
  try {
    const data = await gql(query, variables);
    return data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
  } catch (e) {
    console.warn(`  (pominięto „${label}": ${e.message.split('\n')[0]})`);
    return [];
  }
}

// ── zapytania ──
const Q_SUMMARY = `
${HEAD} {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    httpRequestsAdaptiveGroups(limit: 1, filter: ${FILTER}) {
      count
      sum { visits }
    }
  } }
}`;

const Q_TREND = `
${HEAD} {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    httpRequestsAdaptiveGroups(limit: 200, filter: ${FILTER}, orderBy: [${HOURLY ? 'datetimeHour_ASC' : 'date_ASC'}]) {
      count
      sum { visits }
      dimensions { ${HOURLY ? 'datetimeHour' : 'date'} }
    }
  } }
}`;

const Q_DIM = (dim) => `
${HEAD} {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    httpRequestsAdaptiveGroups(limit: 100, filter: ${FILTER}, orderBy: [sum_visits_DESC]) {
      count
      sum { visits }
      dimensions { ${dim} }
    }
  } }
}`;

// ── formatowanie ──
const num = (n) => (n ?? 0).toLocaleString('pl-PL');
const bar = (v, max, width = 28) => '█'.repeat(Math.max(0, Math.round((v / (max || 1)) * width)));

function printRanking(title, rows, keyDim, { limit = TOP } = {}) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log('  (brak danych)');
    return;
  }
  const items = rows
    .map((r) => ({ label: r.dimensions[keyDim] ?? '—', visits: r.sum?.visits ?? 0, count: r.count ?? 0 }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit);
  const max = Math.max(...items.map((i) => i.visits));
  const wLabel = Math.min(28, Math.max(...items.map((i) => String(i.label).length)));
  for (const it of items) {
    console.log(
      `  ${String(it.label).padEnd(wLabel)}  ${String(num(it.visits)).padStart(7)}  ${bar(it.visits, max)}`,
    );
  }
}

// ── main ──
try {
  const { since, until } = isoRange(DAYS);
  const zoneTag = await getZoneTag(ZONE);
  const vars = gqlVars(zoneTag, since, until);

  const okno = HOURLY ? `${DAYS} dni (widok godzinowy)` : `${DAYS} dni`;
  console.log(`\n═══ Parawan — ruch na ${HOST} ═══`);
  console.log(`Okno: ostatnie ${okno}   (${since.slice(0, 16)} → ${until.slice(0, 16)} UTC)`);

  // 1) podsumowanie
  const sum = (await gql(Q_SUMMARY, vars)).viewer.zones[0]?.httpRequestsAdaptiveGroups[0];
  const totalVisits = sum?.sum?.visits ?? 0;
  const totalReq = sum?.count ?? 0;
  console.log(`\n  Odwiedziny (visits):  ${num(totalVisits)}`);
  console.log(`  Żądania (requests):   ${num(totalReq)}`);

  // 2) trend
  const trend = await gqlSafe(Q_TREND, vars, 'trend');
  console.log(`\n${HOURLY ? 'Ruch per godzina' : 'Ruch per dzień'} (visits):`);
  if (!trend.length) console.log('  (brak danych)');
  else {
    const key = HOURLY ? 'datetimeHour' : 'date';
    const max = Math.max(...trend.map((r) => r.sum?.visits ?? 0));
    for (const r of trend) {
      const label = HOURLY ? r.dimensions[key].slice(5, 16).replace('T', ' ') : r.dimensions[key];
      console.log(`  ${label}  ${String(num(r.sum?.visits ?? 0)).padStart(6)}  ${bar(r.sum?.visits ?? 0, max)}`);
    }
  }

  // 3) kraje, 4) boty (każde odporne na brak wymiaru w schemacie)
  const [kraje, boty] = await Promise.all([
    gqlSafe(Q_DIM('clientCountryName'), vars, 'kraje'),
    gqlSafe(Q_DIM('botClass'), vars, 'boty'),
  ]);
  printRanking('Top kraje (visits):', kraje, 'clientCountryName');
  printRanking('Ludzie vs boty (visits):', boty, 'botClass', { limit: 6 });

  console.log('\n(Źródło: Cloudflare GraphQL — dane agregowane z warstwy CDN. Strona niczego nie wysyła.)\n');
} catch (err) {
  console.error(`\nBłąd: ${err.message}`);
  process.exitCode = 1; // nie process.exit() — pozwól libuv domknąć fetch (unika asercji na Windows)
}
