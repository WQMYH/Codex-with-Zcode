import { withRemote } from "./remote-client.mjs";

const text = { type: "string", minLength: 1 };
const target = { taskId: text, workspace: text };
export const remoteTools = [
  ["zcode_remote_tasks", "List real desktop tasks and native run status. Excludes archived tasks by default. Each call is a fresh snapshot; no background monitor is started.", {
    workspace: text, includeArchived: { type: "boolean" }, status: text, limit: { type: "integer", minimum: 1, maximum: 500 }
  }, [], true],
  ["zcode_remote_read", "Read an existing desktop task's conversation, native status, and pending user-input counts. Returned history may be partial; completed means a turn ended, not task acceptance.", {
    ...target, messageLimit: { type: "integer", minimum: 1, maximum: 500 }
  }, ["taskId"], true],
  ["zcode_remote_models", "Read an existing desktop task's current model, thought level, and model options.", target, ["taskId"], true],
  ["zcode_remote_set_model", "Switch an existing idle desktop task to one of its advertised model options. Use zcode_remote_models first; never switch a running turn.", {
    ...target, model: text
  }, ["taskId", "model"], false],
  ["zcode_remote_send", "Send a user-authorized message to an existing local desktop task using its current runtime and settings. Does not create tasks or change models/permissions. A failed or timed-out send may have been delivered: read the task before retrying.", {
    ...target, prompt: { type: "string", minLength: 1, maxLength: 32000 }
  }, ["taskId", "prompt"], false]
].map(([name, description, properties, required, readOnlyHint]) => ({
  name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: true }
}));

export function normalizeTask(t) {
  const rawStatus = t.displayStatus ?? null;
  const statuses = { running: "running", completed: "completed", error: "failed", idle: "idle",
    interrupted: "interrupted", cancelled: "cancelled", compacting: "compacting",
    waiting_permission: "waiting_permission", waiting_input: "waiting_input" };
  const status = Object.hasOwn(statuses, rawStatus) ? statuses[rawStatus] : "unknown";
  return { taskId: t.taskId, title: t.title, workspace: t.workspacePath, workspaceKind: t.workspaceKind,
    rawStatus, status, archived: t.archived === true, pinned: t.pinned === true, updatedAt: t.updatedAt,
    turnEnded: ["completed", "failed", "cancelled", "interrupted"].includes(status) };
}
export function validateRemoteArgs(name, args) {
  const tool = remoteTools.find(t => t.name === name);
  if (!tool || !args || typeof args !== "object" || Array.isArray(args)) throw Error("Invalid remote tool arguments");
  const schema = tool.inputSchema;
  for (const key of schema.required) if (!(key in args)) throw Error(`Missing ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key];
    if (!rule) throw Error(`Unexpected argument ${key}`);
    if (rule.type === "string" && (typeof value !== "string" || !value.trim() || value.length > (rule.maxLength || 4096))) throw Error(`Invalid ${key}`);
    if (rule.type === "boolean" && typeof value !== "boolean") throw Error(`Invalid ${key}`);
    if (rule.type === "integer" && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw Error(`Invalid ${key}`);
  }
  if (args.taskId && !/^sess_[a-zA-Z0-9-]+$/.test(args.taskId)) throw Error("Expected a native sess_ task ID");
}

function modelState(configOptions) {
  const options = Array.isArray(configOptions) ? configOptions : configOptions?.configOptions;
  const config = options?.find(option => option.id === "model" || option.category === "model");
  if (!config || !Array.isArray(config.options)) throw Error("ZCode did not return model options for this task");
  const thought = options.find(option => option.id === "thoughtLevel" || option.category === "thought_level");
  return {
    currentModel: config.currentValue ?? null,
    thoughtLevel: thought?.currentValue ?? null,
    configId: config.id,
    models: config.options.map(option => ({ value: option.value, name: option.name,
      providerName: option.modelProviderName ?? null, thoughtLevels: option.modelThoughtLevels ?? [],
      defaultThoughtLevel: option.modelDefaultThoughtLevel ?? null }))
  };
}

async function openWorkspace(client, task, tasks) {
  let failure;
  for (const anchor of [task, ...tasks.filter(candidate => candidate.taskId !== task.taskId && candidate.workspacePath === task.workspacePath && candidate.workspaceKind === task.workspaceKind && !candidate.archived)]) {
    try { await client.open(anchor); return; } catch (error) { failure = error; }
  }
  throw failure ?? Error("No task can attach this workspace bridge");
}

export async function callRemoteTool(name, args = {}, connect = withRemote) {
  validateRemoteArgs(name, args);
  return connect(async client => {
    const list = await client.list();
    const base = { source: "zcode_desktop_remote", queriedAt: new Date().toISOString() };
    if (name === "zcode_remote_tasks") {
      const tasks = list.tasks.map(normalizeTask).filter(t => (args.includeArchived || !t.archived) &&
        (!args.workspace || t.workspace === args.workspace) && (!args.status || t.status === args.status));
      const summary = {};
      for (const t of tasks) summary[t.status] = (summary[t.status] || 0) + 1;
      const limit = args.limit ?? 100;
      return { ...base, total: tasks.length, summary, truncated: tasks.length > limit,
        workspaces: list.workspaces.map(w => ({ label: w.label, path: w.workspacePath, kind: w.kind })), tasks: tasks.slice(0, limit) };
    }
    const task = list.tasks.find(t => t.taskId === args.taskId && (!args.workspace || t.workspacePath === args.workspace));
    if (!task) throw Error("Task not found in the current desktop window/workspace");
    if (["zcode_remote_send", "zcode_remote_set_model"].includes(name) && task.archived) throw Error("Unarchive the task in ZCode before changing it");
    if (name === "zcode_remote_set_model" && task.displayStatus === "running") throw Error("Wait for or stop the running turn before switching its model");
    await openWorkspace(client, task, list.tasks);
    if (name === "zcode_remote_models" || name === "zcode_remote_set_model") {
      let before, optionsSourceTaskId = task.taskId, unavailableCurrentModel = false, failure;
      try { before = modelState(await client.configOptions(task.taskId)); }
      catch (error) {
        failure = error;
        for (const sibling of list.tasks.filter(candidate => candidate.taskId !== task.taskId && candidate.workspacePath === task.workspacePath && !candidate.archived)) {
          try {
            before = { ...modelState(await client.configOptions(sibling.taskId)), currentModel: null, thoughtLevel: null };
            optionsSourceTaskId = sibling.taskId; unavailableCurrentModel = true; break;
          } catch {}
        }
      }
      if (!before) throw failure;
      if (name === "zcode_remote_models") return { ...base, task: normalizeTask(task), ...before, optionsSourceTaskId, unavailableCurrentModel };
      const matches = before.models.filter(model => model.value === args.model || model.name === args.model);
      if (matches.length !== 1) throw Error(matches.length ? "Model name is ambiguous; use its full value" : "Model is not advertised for this task");
      const selected = matches[0];
      if (before.currentModel === selected.value) return { ...base, task: normalizeTask(task), changed: false, currentModel: selected.value };
      try { await client.setModel(task.taskId, before.configId, selected.value); }
      catch (error) {
        if (!/Session is not active/i.test(String(error?.message))) throw error;
        await client.resume(task, selected.value, selected.defaultThoughtLevel ?? selected.thoughtLevels.at(-1) ?? "max");
      }
      const after = modelState(await client.configOptions(task.taskId));
      if (after.currentModel !== selected.value) throw Error("ZCode did not confirm the requested model switch");
      return { ...base, task: normalizeTask(task), changed: true, previousModel: before.currentModel, currentModel: after.currentModel,
        optionsSourceTaskId, recoveredUnavailableModel: unavailableCurrentModel };
    }
    if (name === "zcode_remote_read") {
      const snapshot = await client.snapshot(task.taskId, args.messageLimit ?? 100);
      if (!Array.isArray(snapshot?.messages)) throw Error("Unsupported ZCode conversation schema");
      let budget = 24000, truncated = false;
      const messages = snapshot.messages.map(m => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? m.parts ?? "");
        return { id: m.id, role: m.role, timestamp: m.timestamp, content };
      }).reverse().map(m => {
        const content = m.content.slice(0, budget); budget -= content.length;
        if (content.length !== m.content.length) truncated = true;
        return { ...m, content, truncated: content.length !== m.content.length };
      }).reverse();
      const runtime = snapshot.runtime ?? {};
      return { ...base, task: normalizeTask(task),
        pendingPermissions: runtime.pendingPermissions?.length ?? 0, pendingQuestions: runtime.pendingElicitations?.length ?? 0,
        pendingCommands: runtime.pendingCommands?.length ?? 0, history: snapshot.history ?? null,
        messageCount: messages.length, outputTruncated: truncated, messages };
    }
    try {
      const sent = await client.send(task.taskId, args.prompt);
      if (sent.result?.isError || sent.result?.error || sent.result?.accepted === false) throw Error("Desktop rejected prompt");
      return { ...base, task: normalizeTask(task), delivery: "acknowledged", request: sent.request,
        note: "Desktop acknowledged the send. Read this task for the agent reply; this is not completion." };
    } catch {
      throw Error("Send was not confirmed; delivery is unknown. Read this task before retrying. No automatic retry was made.");
    }
  });
}
