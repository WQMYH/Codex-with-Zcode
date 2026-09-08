import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = "https://raw.githubusercontent.com/WQMYH/Codex-with-Zcode/main/config.schema.json";

export function configPath() {
  const configured = process.env.ZCODE_OPS_CONFIG;
  if (configured && !isAbsolute(configured)) throw Error("ZCODE_OPS_CONFIG must be an absolute path");
  return configured || join(process.env.CODEX_HOME || join(homedir(), ".codex"), "zcode-ops", "config.json");
}

export function validateSharingLink(value) {
  let url;
  try { url = new URL(value); } catch { throw Error("Invalid ZCode sharing link"); }
  if (url.origin !== "https://zcode.z.ai" || url.pathname !== "/remote/v4" || url.username || url.password ||
      !["sid", "hash", "mid"].every(key => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key))) {
    throw Error("Expected the current official ZCode /remote/v4 sharing link");
  }
  return url;
}

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["$schema", "schemaVersion", "promptOnStartup", "sharingLink", "updatedAt"].includes(key)) ||
      value.schemaVersion !== 1 || typeof value.promptOnStartup !== "boolean" ||
      !(value.sharingLink === null || typeof value.sharingLink === "string")) throw Error("Invalid ZCode Ops config schema");
  if (value.sharingLink !== null) validateSharingLink(value.sharingLink);
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)))) throw Error("Invalid config updatedAt");
  return value;
}

export function readConfig({ optional = false, path = configPath() } = {}) {
  try {
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text) > 16384) throw Error("Config exceeds size limit");
    return validateConfig(JSON.parse(text));
  } catch (error) {
    if (optional && !existsSync(path)) return null;
    throw error instanceof SyntaxError ? Error("ZCode Ops config is not valid JSON") : error;
  }
}

export function writeConfig({ sharingLink = null, promptOnStartup = true }, path = configPath()) {
  if (sharingLink !== null) validateSharingLink(sharingLink);
  if (typeof promptOnStartup !== "boolean") throw Error("promptOnStartup must be boolean");
  const config = { $schema: schema, schemaVersion: 1, promptOnStartup, sharingLink, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
  return config;
}

export function readSharingLink() {
  const config = readConfig();
  if (!config.sharingLink) throw Error("ZCode sharing link is not configured; use zcode_config_prompt");
  return validateSharingLink(config.sharingLink);
}

let dialog;
export function promptForSharingLink() {
  if (process.env.ZCODE_OPS_NO_CONFIG_PROMPT === "1") return Promise.resolve({ saved: false, skipped: true });
  if (dialog) return dialog;
  dialog = new Promise(resolveDialog => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", resolve(root, "scripts", "sharing-link-dialog.ps1")],
      { windowsHide: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", chunk => { if (output.length < 16384) output += chunk; });
    child.on("error", () => resolveDialog({ saved: false, error: "dialog_unavailable" }));
    child.on("exit", code => {
      if (code !== 0 || !output.trim()) return resolveDialog({ saved: false, cancelled: true });
      try {
        const current = readConfig({ optional: true });
        writeConfig({ sharingLink: validateSharingLink(output.trim()).href, promptOnStartup: current?.promptOnStartup ?? true });
        resolveDialog({ saved: true });
      } catch { resolveDialog({ saved: false, error: "invalid_link" }); }
    });
  }).finally(() => { dialog = null; });
  return dialog;
}

let startupPrompt = Promise.resolve();
export function startStartupPrompt() {
  let enabled = true;
  try { enabled = readConfig({ optional: true })?.promptOnStartup !== false; } catch {}
  startupPrompt = enabled ? promptForSharingLink() : Promise.resolve({ saved: false, disabled: true });
  return startupPrompt;
}
export function waitForStartupPrompt() { return startupPrompt; }

export const configTools = [
  { name: "zcode_config_status", description: "Read installed ZCode Ops configuration status without returning the sharing link.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "zcode_config_prompt", description: "Open the local sharing-link input window and save the current ZCode link outside the plugin installation.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "zcode_config_set", description: "Update installed ZCode Ops configuration. Prefer zcode_config_prompt when entering a sharing link so it does not appear in chat.", inputSchema: { type: "object", properties: { sharingLink: { type: "string", minLength: 1, maxLength: 4096 }, promptOnStartup: { type: "boolean" } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "zcode_config_clear", description: "Clear the saved sharing link while preserving the startup prompt preference.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }
];

export async function callConfigTool(name, args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw Error("Invalid config tool arguments");
  if (name === "zcode_config_status") {
    let value;
    try { value = readConfig({ optional: true }); }
    catch (error) { return { configPath: configPath(), configured: false, valid: false, error: error.message }; }
    return { configPath: configPath(), configured: Boolean(value?.sharingLink), valid: value !== null,
      schemaVersion: value?.schemaVersion ?? null, promptOnStartup: value?.promptOnStartup ?? true, updatedAt: value?.updatedAt ?? null };
  }
  if (name === "zcode_config_prompt") return promptForSharingLink();
  const current = readConfig({ optional: true });
  if (name === "zcode_config_clear") {
    const next = writeConfig({ sharingLink: null, promptOnStartup: current?.promptOnStartup ?? true });
    return { saved: true, configured: false, configPath: configPath(), promptOnStartup: next.promptOnStartup, updatedAt: next.updatedAt };
  }
  if (name === "zcode_config_set") {
    if (Object.keys(args).some(key => !["sharingLink", "promptOnStartup"].includes(key)) ||
        (args.sharingLink === undefined && args.promptOnStartup === undefined)) throw Error("Set sharingLink and/or promptOnStartup");
    const next = writeConfig({ sharingLink: args.sharingLink ?? current?.sharingLink ?? null,
      promptOnStartup: args.promptOnStartup ?? current?.promptOnStartup ?? true });
    return { saved: true, configured: Boolean(next.sharingLink), configPath: configPath(), promptOnStartup: next.promptOnStartup, updatedAt: next.updatedAt };
  }
  throw Error("Unknown config tool");
}
