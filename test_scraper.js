// test_scraper.js
// Manual verification harness. Run against the real live store.
//
// Usage:
//   node test_scraper.js search "boot"
//   node test_scraper.js product 876
//   node test_scraper.js price 876
//   node test_scraper.js stress 876 20        (runs price scrape 20x back-to-back,
//                                               prints a pass/fail summary -- this
//                                               is your "many unattended runs" check)

const { searchCatalog, getProduct, scrapePrice } = require('./scraper.js');

function printLog(log) {
  for (const entry of log) {
    const err = entry.error ? ` — ${entry.error}` : '';
    console.log(`    attempt ${entry.attempt} [${entry.status}] ${entry.durationMs}ms${err}`);
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (cmd === 'search') {
    const query = args[0];
    if (!query) return console.error('usage: node test_scraper.js search "<query>"');
    console.log(`Searching catalog for "${query}"...`);
    const t0 = Date.now();
    const results = await searchCatalog(query);
    console.log(`Found ${results.length} match(es) in ${Date.now() - t0}ms:`);
    for (const r of results.slice(0, 20)) {
      console.log(`  #${r.id}  ${r.name}  (${r.brand}, ${r.category}, SKU ${r.sku})`);
    }
    if (results.length > 20) console.log(`  ...and ${results.length - 20} more`);
    return;
  }

  if (cmd === 'product') {
    const id = args[0];
    if (!id) return console.error('usage: node test_scraper.js product <id>');
    const product = await getProduct(id);
    console.log(JSON.stringify(product, null, 2));
    return;
  }

  if (cmd === 'price') {
    const id = args[0];
    if (!id) return console.error('usage: node test_scraper.js price <id>');
    console.log(`Scraping price for product #${id}...`);
    const result = await scrapePrice(id);
    printLog(result.log);
    if (result.ok) {
      console.log('\n✅ SUCCESS');
      console.log(JSON.stringify(result.quote, null, 2));
    } else {
      console.log('\n❌ FAILED after all retries');
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'stress') {
    const id = args[0];
    const runs = Number(args[1]) || 10;
    if (!id) return console.error('usage: node test_scraper.js stress <id> [runs]');
    console.log(`Running ${runs} back-to-back price scrapes for product #${id}...\n`);
    let successes = 0;
    let totalAttempts = 0;
    for (let i = 1; i <= runs; i++) {
      process.stdout.write(`Run ${i}/${runs}: `);
      const result = await scrapePrice(id);
      totalAttempts += result.log.length;
      if (result.ok) {
        successes++;
        console.log(`ok (price ${result.quote.shown} ${result.quote.currency}, stock ${result.quote.stock}, ${result.log.length} attempt(s))`);
      } else {
        console.log(`FAILED (${result.log.length} attempts) — ${result.log[result.log.length - 1].error}`);
      }
    }
    console.log(`\n${successes}/${runs} runs succeeded. Average attempts per run: ${(totalAttempts / runs).toFixed(2)}`);
    if (successes < runs) process.exitCode = 1;
    return;
  }

  console.log(`Unknown or missing command.

Usage:
  node test_scraper.js search "<query>"
  node test_scraper.js product <id>
  node test_scraper.js price <id>
  node test_scraper.js stress <id> [runs]`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});