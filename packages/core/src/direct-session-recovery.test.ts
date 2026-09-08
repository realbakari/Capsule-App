import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { PRESET_HARNESSES, type CapsuleSettings } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it("resumes the native identity after reopening the database and changing the default route", async () => {
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
  const preset = PRESET_HARNESSES.find((item) => item.id === "grok")!;
  const originalCommand = preset.acpxCommand;
  preset.acpxCommand = { command: "node", args: [agent] };
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(undefined);
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false };
  let engine = new CapsuleEngine(options);
  const selectRealClient = () => {
    const internal = engine as unknown as { usingMock: boolean; settings: CapsuleSettings; bindAcpReplies(): void };
    internal.usingMock = false;
    internal.settings.runtimeMode = "direct";
    internal.bindAcpReplies();
    return internal;
  };
  try {
    await engine.start();
    selectRealClient();
    const project = engine.createProject({ name: "Restore fixture", workingDirectory: directory });
    const first = await engine.spawnHarness({ projectId: project.id, harnessId: "grok" });
    expect(first.session.directSession).toMatchObject({ sessionId: "native-fixture", cwd: directory, harnessId: "grok" });
    const initial = await engine.sendMessage({ sessionId: first.session.id, agentId: "grok", content: "First", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(initial.run.id)?.status).toBe("completed"));
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    const internal = selectRealClient();
    internal.settings.runtimeMode = "openclaw"; // Existing direct threads must not be rerouted.
    const recovered = engine.listSessions().find((item) => item.id === first.session.id)!;
    expect(recovered.openclawSessionKey).toBeFalsy();
    expect(recovered.directSession).toEqual(first.session.directSession);
    const next = await engine.sendMessage({ sessionId: recovered.id, agentId: "grok", content: "Continue", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    const answers = engine.listMessages(recovered.id).filter((message) => message.role === "assistant").map((message) => message.content);
    expect(answers).toEqual(["First answer", "Resumed answer"]);
    expect(engine.listSessions().find((item) => item.id === recovered.id)?.openclawSessionKey).toMatch(/^direct:acp:grok:/);
  } finally {
    await engine.stop();
    preset.acpxCommand = originalCommand;
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  }
});
