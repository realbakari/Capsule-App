import { useEffect, useRef, useState } from "react";
import type { AttentionState, PetVoiceStatus } from "@capsule/shared";
import { petCommand, type PetCommand } from "./behavior";

export function PetVoiceControls({ onCommand, state, available }: { onCommand: (command: PetCommand) => void; state: AttentionState | "idle"; available: boolean }) {
  const api = window.capsule;
  const [status, setStatus] = useState<PetVoiceStatus>();
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "finishing" | "speaking">("idle");
  const [feedback, setFeedback] = useState("");
  const [announcements, setAnnouncements] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const previous = useRef(state);
  const lastSpoken = useRef(0);
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;

  useEffect(() => {
    let alive = true;
    void api.getPetVoiceStatus().then(value => { if (alive) setStatus(value); }).catch(() => { if (alive) setFeedback("Voice is unavailable. Reopen the companion to retry."); });
    const off = api.on("petVoice", payload => {
      if (payload && typeof payload === "object" && "phase" in payload && payload.phase === "listening" && busy.current) setPhase(current => current === "starting" ? "listening" : current);
    });
    const cancel = () => { generation.current++; busy.current = false; setPhase("idle"); void api.cancelPetVoice().catch(() => {}); };
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { alive = false; off(); document.removeEventListener("visibilitychange", hidden); generation.current++; busy.current = false; void api.cancelPetVoice().catch(() => {}); };
  }, [api]);

  async function speak() {
    if (busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setPhase("speaking"); setFeedback("");
    try { await api.speakPetStatus(); }
    catch { if (generation.current === request) setFeedback("Could not read status. Try again."); }
    finally { if (generation.current === request) { busy.current = false; setPhase("idle"); } }
  }
  const speakRef = useRef(speak);
  speakRef.current = speak;
  useEffect(() => {
    const changed = previous.current !== state;
    previous.current = state;
    if (changed && available && announcements && status?.outputAvailable && state !== "idle" && !document.hidden && !busy.current && Date.now() - lastSpoken.current >= 15_000) {
      lastSpoken.current = Date.now();
      void speakRef.current();
    }
  }, [state, available, announcements, status]);

  async function listen() {
    if (busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setPhase("starting"); setFeedback("Allow microphone and speech access if macOS asks.");
    try {
      const text = await api.listenPetCommand();
      if (generation.current !== request || text === undefined) return;
      const command = petCommand(text);
      if (!command) setFeedback(text ? "Try “dance”, “show my tasks”, or “read status”." : "No command heard. Try again.");
      else {
        setFeedback("Command received.");
        if (command.kind === "status") { busy.current = false; await speak(); }
        else commandRef.current(command);
      }
    } catch (error) {
      if (generation.current === request) setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Voice input failed. Try again.");
    } finally { if (generation.current === request) { busy.current = false; setPhase("idle"); } }
  }

  function stop() {
    generation.current++; busy.current = false; setPhase("idle"); setFeedback("Stopped.");
    void api.cancelPetVoice().catch(() => setFeedback("Could not stop voice. Close the companion."));
  }

  return <details className="pet-voice" onToggle={event => { if (!event.currentTarget.open && busy.current) stop(); }}>
    <summary>Voice{phase === "listening" ? " · Microphone on" : phase === "speaking" ? " · Speaking" : ""}</summary>
    <p>Press Talk for one English command. Listening stops after 10 seconds. Audio stays on this device.</p>
    {!status ? <p>{feedback || "Checking voice…"}</p> : <>
      {status.detail ? <p>{status.detail}</p> : null}
      <div className="pet-tray-controls">
        <button type="button" disabled={!status.inputAvailable || phase === "speaking" || phase === "starting" || phase === "finishing"} onClick={() => {
          if (phase === "listening") { setPhase("finishing"); void api.finishPetCommand().catch(() => setFeedback("Could not finish the command. Press Stop.")); }
          else void listen();
        }}>{phase === "starting" ? "Starting…" : phase === "listening" ? "Finish command" : phase === "finishing" ? "Processing…" : "Talk"}</button>
        <button type="button" disabled={!available || !status.outputAvailable || phase !== "idle"} onClick={() => void speak()}>Read status</button>
        {phase !== "idle" ? <button type="button" onClick={stop}>Stop</button> : null}
      </div>
      <label><input type="checkbox" checked={announcements} disabled={!status.outputAvailable} onChange={event => setAnnouncements(event.target.checked)} /> Speak status changes while this tray is open</label>
      <p role="status">{phase === "listening" ? "Microphone on · Listening…" : phase === "speaking" ? "Reading workspace status…" : feedback}</p>
    </>}
  </details>;
}
