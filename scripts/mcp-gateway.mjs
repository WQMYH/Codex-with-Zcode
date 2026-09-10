import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { publicTools, callPublicTool } from "./tools.mjs";

const version = JSON.parse(readFileSync(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8")).version;
const output = message => process.stdout.write(JSON.stringify(message) + "\n");
const failure = (id, code, message) => output({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const { id, method, params = {} } = message;
  if (method === "notifications/initialized") return;
  if (method === "initialize") return output({ jsonrpc: "2.0", id, result: {
    protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
    capabilities: { tools: { listChanged: false } }, serverInfo: { name: "zcode-ops", version }
  } });
  if (method === "ping") return output({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return output({ jsonrpc: "2.0", id, result: { tools: publicTools } });
  if (method !== "tools/call") return failure(id, -32601, "Unsupported method");
  if (!publicTools.some(t => t.name === params.name)) return failure(id, -32601, "Tool removed or unknown; use tasks/read/send and the advertised controls. No action performed.");
  try { output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await callPublicTool(params.name, params.arguments)) }] } }); }
  catch (error) { failure(id, -32602, error.message); }
}
createInterface({ input: process.stdin }).on("line", line => {
  let message; try { message = JSON.parse(line); } catch { failure(null, -32700, "Invalid JSON-RPC"); return; }
  void handle(message).catch(() => failure(message?.id, -32603, "Request failed"));
});
