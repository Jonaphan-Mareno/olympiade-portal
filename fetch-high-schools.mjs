#!/usr/bin/env node
/**
 * Walks the complete South African high-school directory from
 * api.labs.org.za into src/data/south-african-high-schools.json.
 *
 * The API is rate limited to ~20 requests per minute and caps the page
 * size, so the directory must be fetched page by page. This script sends
 * bursts of 19 requests and then sleeps for ~1 minute before continuing.
 *
 * Progress is checkpointed to src/data/.high-schools.partial.json after
 * every page, so an interrupted walk can be resumed by simply re-running
 * the script instead of starting over.
 *
 * Usage: npm run fetch:schools
 */
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const BASE_URL = (
  process.env.HIGH_SCHOOLS_API_BASE_URL || 'https://api.labs.org.za'
).replace(/\/+$/, '');
const TOKEN = process.env.HIGH_SCHOOLS_API_TOKEN;

const OUT_FILE = path.join(
  process.cwd(),
  'src',
  'data',
  'south-african-high-schools.json'
);
const CHECKPOINT_FILE = path.join(
  process.cwd(),
  'src',
  'data',
  '.high-schools.partial.json'
);

// The API allows ~20 requests per minute: stop one short of the limit and
// sleep a full minute before the next burst.
const REQUESTS_PER_BURST = 19;
const BURST_PAUSE_MS = 61_000;
const RETRY_PAUSE_MS = 65_000;
const MAX_RETRIES = 5;
// Ask for more per page than we expect to get; the response's meta.per_page
// tells us what the API actually honours, so the walk adapts automatically.
const WANTED_PER_PAGE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload));
}

// Keep the JSON snapshot lean: only the fields the school picker needs.
function trimRecord(record) {
  return {
    id: record.id ?? null,
    natEmis: record.nat_emis ?? null,
    name:
      typeof record.name === 'string'
        ? record.name.replace(/\s+/g, ' ').trim()
        : '',
    province: record.province ?? null,
    town: record.town ?? null,
    phase: record.phase ?? null,
  };
}

async function fetchPage(page, perPage) {
  const url = `${BASE_URL}/v1/data/high-schools?page=${page}&per_page=${perPage}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || res.status >= 500) {
        console.warn(
          `  page ${page}: HTTP ${res.status} — backing off ${RETRY_PAUSE_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`
        );
        await sleep(RETRY_PAUSE_MS);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(
        `  page ${page}: ${err.message} — retrying in ${RETRY_PAUSE_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`
      );
      await sleep(RETRY_PAUSE_MS);
    }
  }

  throw new Error(`page ${page}: exhausted all retries`);
}

async function main() {
  if (!TOKEN) {
    console.error(
      'HIGH_SCHOOLS_API_TOKEN is not set. Add it to .env.local first.'
    );
    process.exit(1);
  }

  let schools = [];
  let page = 1;
  let perPage = WANTED_PER_PAGE;
  let total = null;

  if (fs.existsSync(CHECKPOINT_FILE)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    schools = checkpoint.schools ?? [];
    page = checkpoint.nextPage ?? 1;
    perPage = checkpoint.perPage ?? WANTED_PER_PAGE;
    total = checkpoint.total ?? null;
    console.log(
      `Resuming checkpoint: page ${page}, ${schools.length} schools already collected.`
    );
  } else {
    console.log(
      `Starting a fresh walk of ${BASE_URL}/v1/data/high-schools...`
    );
  }

  // Records with a proper id are deduped; pages may overlap if the dataset
  // shifts mid-walk.
  const seen = new Set(schools.map((s) => s.id).filter((id) => id != null));
  let requestsInBurst = 0;

  while (true) {
    const payload = await fetchPage(page, perPage);
    requestsInBurst++;

    const data = Array.isArray(payload?.data) ? payload.data : [];
    const meta = payload?.meta ?? {};
    if (total == null && meta.total != null) total = meta.total;
    if (meta.per_page != null) perPage = meta.per_page;

    const lastPage = total != null ? Math.ceil(total / perPage) : null;

    let added = 0;
    for (const record of data) {
      const trimmed = trimRecord(record);
      if (!trimmed.name) continue;
      if (trimmed.id != null && seen.has(trimmed.id)) continue;
      if (trimmed.id != null) seen.add(trimmed.id);
      schools.push(trimmed);
      added++;
    }

    writeJson(CHECKPOINT_FILE, {
      startedAt: new Date().toISOString(),
      total,
      perPage,
      nextPage: page + 1,
      schools,
    });

    console.log(
      `[page ${page}${lastPage ? `/${lastPage}` : ''}] +${added} schools (collected ${schools.length}${total ? `/${total}` : ''})`
    );

    if (data.length === 0) break; // walked past the end
    if (lastPage != null && page >= lastPage) break;
    page++;

    if (requestsInBurst >= REQUESTS_PER_BURST) {
      console.log(
        `  ${REQUESTS_PER_BURST} requests sent — pausing ${BURST_PAUSE_MS / 1000}s for the API rate limit...`
      );
      await sleep(BURST_PAUSE_MS);
      requestsInBurst = 0;
    }
  }

  if (total != null && schools.length !== total) {
    console.warn(
      `Note: collected ${schools.length} unique schools, API reports total ${total}.`
    );
  }

  schools.sort((a, b) => a.name.localeCompare(b.name));

  writeJson(OUT_FILE, {
    source: 'api.labs.org.za/v1/data/high-schools',
    fetchedAt: new Date().toISOString(),
    total: schools.length,
    schools,
  });
  fs.rmSync(CHECKPOINT_FILE, { force: true });

  console.log(
    `\nDone: ${schools.length} schools written to ${path.relative(process.cwd(), OUT_FILE)}`
  );
}

main().catch((err) => {
  console.error('Walk failed:', err);
  process.exit(1);
});
