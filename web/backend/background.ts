// The check jobs.ts describes, run by the iPhone app while Kav is in the background: iOS wakes the app now
// and then (Background App Refresh), and the app runs this file in JavaScriptCore, outside the web view,
// which iOS keeps asleep. It has its own Moovit user, kept apart from the app's, so the two never trip over
// each other's tokens. Built on its own into kav-bg.js (vite.background.config.ts).
import { toBase64, fromBase64 } from "./bg-env.ts";
import * as M from "./moovit.ts";
import * as St from "./state.ts";
import { setPlatform } from "./platform.ts";
import { parseJobs, runJobs } from "./jobs.ts";

declare const __kavRequest: (method: string, url: string, headers: string, body: string | null, timeoutMs: number,
  done: (status: number, headers: string, body: string, error: string | null) => void) => void;

// In: { jobs, state } as JSON texts. Out, through done: { jobs, state, notices, cancel } as one JSON text.
(globalThis as any).kavBackground = (input: string, done: (output: string) => void) => {
  const { jobs: jobsText, state } = JSON.parse(input) as { jobs: string | null; state: string | null };
  let saved = state;
  setPlatform({
    request: (method, url, headers, body, timeoutMs = 25000) => new Promise((resolve, reject) => {
      // iOS gives a background check about half a minute.
      __kavRequest(method, url, JSON.stringify(headers), body ? toBase64(body) : null, Math.min(timeoutMs, 12000), (status, h, b, error) => {
        if (error != null) return reject(new Error(error));
        resolve({ code: status, headers: JSON.parse(h), body: fromBase64(b) });
      });
    }),
    load: () => saved,
    save: text => { saved = text; },
  });
  St.initState();
  const jobs = parseJobs(jobsText);
  M.settings.hebrew = jobs.hebrew;
  runJobs(jobs, {
    arrivals: async ids => (await M.stopArrivals(await St.browse(), ids)).arrivals,
    alerts: async group => M.serviceAlerts(await St.browse(), [group]),
  }).then(
    r => {
      St.persist(true);
      done(JSON.stringify({ jobs: JSON.stringify(r.jobs), state: saved, notices: r.notices, cancel: r.cancel }));
    },
    e => { console.log("Kav background: " + (e as Error)?.message); done(JSON.stringify({ jobs: null, state: saved, notices: [], cancel: [] })); },
  );
};
