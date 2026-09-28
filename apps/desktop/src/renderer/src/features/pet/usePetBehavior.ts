import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionState } from "./CapsuleMascot";
import { IDLE_BEATS, REST_AFTER, shouldCelebrate, type PetReaction } from "./behavior";

export function usePetBehavior({ state, available, autonomous, motionPaused, hidden, open, react }: {
  state: CompanionState; available: boolean; autonomous: boolean; motionPaused: boolean;
  hidden: boolean; open: boolean; react: (kind: PetReaction) => void;
}) {
  const [resting, setResting] = useState(false);
  const [activity, setActivity] = useState(0);
  const restingRef = useRef(false);
  const wake = useCallback(() => { restingRef.current = false; setResting(false); setActivity(value => value + 1); }, []);
  const previous = useRef<CompanionState | undefined>(undefined);
  useEffect(() => {
    if (available && autonomous && !motionPaused && !hidden && !open && shouldCelebrate(previous.current === "idle" ? undefined : previous.current, state === "idle" ? undefined : state)) react("dance");
    previous.current = state;
  }, [state, available, autonomous, motionPaused, hidden, open, react]);
  useEffect(() => {
    setResting(false);
    restingRef.current = false;
    if (!available || !autonomous || motionPaused || hidden || open || state !== "idle") return;
    const timers = IDLE_BEATS.map(beat => setTimeout(() => { if (!restingRef.current) react(beat.reaction); }, beat.after));
    timers.push(setTimeout(() => { restingRef.current = true; setResting(true); }, REST_AFTER));
    return () => timers.forEach(clearTimeout);
  }, [state, available, autonomous, motionPaused, hidden, open, activity, react]);
  return { resting: resting && state === "idle" && available, wake, rest: () => { if (state === "idle") { restingRef.current = true; setResting(true); } } };
}
