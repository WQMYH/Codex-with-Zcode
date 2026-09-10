import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowed = new Set(["SessionStart", "UserPromptSubmit", "Stop"]);

export function recordProbe(input, { env = process.env, now = () => new Date() } = {}) {
  const root = env.ZCODE_PLUGIN_DATA?.trim();
  if (!root) throw Error("ZCODE_PLUGIN_DATA is required");
  if (!input || !allowed.has(input.hook_event_name) || typeof input.session_id !== "string" || !/^sess_[A-Za-z0-9-]+$/.test(input.session_id)) throw Error("Invalid Hook input");
  const path = join(resolve(root), "hook-events.json");
  mkdirSync(resolve(root), { recursive: true });
  let current = { version: 1, events: [] };
  try { current = JSON.parse(readFileSync(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (current.version !== 1 || !Array.isArray(current.events)) throw Error("Unsupported Hook probe data");
  const event = { event: input.hook_event_name, sessionId: input.session_id,
    source: input.hook_event_name === "SessionStart" && typeof input.source === "string" ? input.source.slice(0, 32) : null,
    timestamp: now().toISOString() };
  // ponytail: one bounded file is enough; add locking only if concurrent Hook loss is observed.
  current.events = [...current.events, event].slice(-200);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(current, null, 2), { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
  return event;
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 65536) throw Error("Hook input too large");
  }
  recordProbe(JSON.parse(raw));
}

const canonical = value => resolve(value).toLowerCase();
if (canonical(fileURLToPath(import.meta.url)) === canonical(process.argv[1] ?? "")) main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
