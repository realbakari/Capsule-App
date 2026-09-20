import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { PRESET_HARNESSES } from "@capsule/shared";
import { OpenClawAdapter } from "@capsule/openclaw";
import { CapsuleEngine } from "./engine.js";

it.each(["grok", "claude", "codex"] as const)("resumes the local %s identity after reopening and changing the default route", async (harnessId) => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule direct restore-"));
  const agent = path.join(directory, "agent.mjs");
  writeFileSync(agent, `import readline from 'node:readline';
    const send = message => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...message})+'\\n');
    let resumed = false;
    readline.createInterface({input:process.stdin}).on('line', line => {
      const message = JSON.parse(line);
      if(message.method === 'initialize') send({id:message.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}}}}});
      if(message.method === 'session/new') send({id:message.id,result:{sessionId:'native-fixture'}});
      if(message.method === 'session/resume') {
        if(message.params.sessionId !== 'native-fixture' || message.params.cwd !== ${JSON.stringify(directory)}) throw new Error('Wrong identity');
        resumed = true; send({id:message.id,result:{}});
      }
      if(message.method === 'session/prompt') {
        send({method:'session/update',params:{sessionId:'native-fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:resumed?'Resumed answer':'First answer'}}}});
        send({id:message.id,result:{stopReason:'end_turn'}});
      }
    });`);
  const preset = PRESET_HARNESSES.find((item) => item.id === harnessId)!;
  const commandKey = harnessId === "grok" ? "acpxCommand" : "directCommand";
  const originalCommand = preset[commandKey];
  preset[commandKey] = { command: process.execPath, args: [agent] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockImplementation((names) => names.includes(process.execPath) ? process.execPath : undefined);
  const gateway = vi.spyOn(OpenClawAdapter.prototype, "connect").mockRejectedValue(new Error("No Gateway in this fixture"));
  const gatewaySession = vi.spyOn(OpenClawAdapter.prototype, "createSession").mockRejectedValue(new Error("No Gateway session in this fixture"));
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    const project = engine.createProject({ name: "Restore fixture", workingDirectory: directory });
    const thread = await engine.createSession({ projectId: project.id, agentId: harnessId, mode: "chat" });
    const initial = await engine.sendMessage({ sessionId: thread.id, agentId: harnessId, content: "First", mode: "chat" });
    const identity = initial.session.directSession;
    expect(identity).toMatchObject({ sessionId: "native-fixture", cwd: directory, harnessId });
    await vi.waitFor(() => expect(engine.getRun(initial.run.id)?.status).toBe("completed"));
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    await engine.updateSettings({ runtimeMode: "openclaw" }); // Existing direct threads must not be rerouted.
    const recovered = engine.listSessions().find((item) => item.id === thread.id)!;
    expect(recovered.openclawSessionKey).toBeFalsy();
    expect(recovered.directSession).toEqual(identity);
    const next = await engine.sendMessage({ sessionId: recovered.id, agentId: harnessId, content: "Continue", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    const answers = engine.listMessages(recovered.id).filter((message) => message.role === "assistant").map((message) => message.content);
    expect(answers).toEqual(["First answer", "Resumed answer"]);
    expect(engine.listSessions().find((item) => item.id === recovered.id)?.openclawSessionKey).toMatch(new RegExp(`^direct:acp:${harnessId}:`));
    expect(gateway).not.toHaveBeenCalled();
    expect(gatewaySession).not.toHaveBeenCalled();
  } finally {
    await engine.stop();
    preset[commandKey] = originalCommand;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
