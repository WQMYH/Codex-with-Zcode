// Explicit one-shot MCP diagnostic, usable before a new Codex task loads updated tools.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { remoteTools } from "./remote-tools.mjs";

const [name, json = "{}"] = process.argv.slice(2);
if (!remoteTools.some(t => t.name === name)) throw Error("Use zcode_remote_tasks, zcode_remote_read or zcode_remote_send, followed by JSON arguments");
const args = JSON.parse(json);
const child = spawn(process.execPath, [fileURLToPath(new URL("./mcp-gateway.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const timer = setTimeout(() => { console.error("MCP diagnostic timed out; if sending, inspect the task before retrying"); child.kill(); process.exitCode = 1; }, 90000);
child.on("error", () => { clearTimeout(timer); console.error("Cannot start gateway"); process.exitCode = 1; });
child.on("exit", () => clearTimeout(timer));
createInterface({ input: child.stdout }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === 1) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) + "\n");
  } else if (message.id === 2) {
    if (message.error) { console.error(message.error.message); process.exitCode = 1; }
    else console.log(message.result.content[0].text);
    child.stdin.end(); clearTimeout(timer);
  }
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "remote-diagnostic", version: "1" } } }) + "\n");
