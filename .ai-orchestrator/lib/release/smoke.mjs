// Smoke test after a deploy (release-workflow spec 2.9): calls each path of deploy.yaml's smoke checks on the new
// container, through the network inside the VPS, and checks the status and a piece of text. Rounds repeat until one is
// green; after 60 seconds without one the deploy fails. The request, the clock and the pause are parameters, so tests
// run without network or waiting.
import { request as httpGet } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';

const LIMIT = 1024 * 1024; // the most of an answer kept to look for the text

// checks: { app, path, expect_status, expect_text } entries; targets: { [app]: { origin, host } }, where the new
// container answers and the Host header its app expects. Returns { ok, failures }, each failure { app, path, problem }
// from the last round.
export async function smoke({ checks, targets, request = httpRequest, now = Date.now, sleep = pause, timeout = 60_000, interval = 2_000 }) {
  const start = now();
  for (;;) {
    const failures = [];
    for (const check of checks) {
      const problem = await probe(check, targets[check.app], request);
      if (problem) failures.push({ app: check.app, path: check.path, problem });
    }
    if (failures.length === 0) return { ok: true, failures };
    const left = timeout - (now() - start);
    if (left <= 0) return { ok: false, failures };
    await sleep(Math.min(interval, left));
  }
}

async function probe({ path, expect_status: status, expect_text: text }, { origin, host }, request) {
  let answer;
  try {
    answer = await request({ url: `${origin}${path}`, host });
  } catch (error) {
    return `no answer: ${error.message}`;
  }
  if (answer.status !== status) return `status ${answer.status}, expected ${status}`;
  if (!answer.text.includes(text)) return `the answer has no "${text}"`;
  return null;
}

// GET `url` over plain HTTP with the Host header `host`, which fetch does not let a caller set. Resolves to
// { status, text } with at most the first megabyte of the body; rejects when the app does not answer within `timeout`.
export function httpRequest({ url, host, timeout = 5_000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'http:') {
      reject(new Error(`${url}: only http: inside the VPS`));
      return;
    }
    const req = httpGet(target, { method: 'GET', headers: { host }, timeout }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (size < LIMIT) chunks.push(chunk);
        size += chunk.length;
      });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).subarray(0, LIMIT).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`no answer within ${timeout} ms`)));
    req.on('error', reject);
    req.end();
  });
}
