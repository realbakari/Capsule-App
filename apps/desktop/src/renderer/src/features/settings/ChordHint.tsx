import { chordSymbols } from "../../lib/keybindings";
import { useWorkspace } from "../../lib/workspace";
import "./keybindings.css";

/** While Capsule waits for the second key of a sequence, a quiet note says so near the bottom of the window. */
export function ChordHint() {
  const { keyChordPending } = useWorkspace();
  if (!keyChordPending) return null;
  return (
    <div className="chord-hint" role="status" aria-live="polite">
      <span className="shortcut-chord">{chordSymbols(keyChordPending).map((symbol, index) => <kbd key={index}>{symbol}</kbd>)}</span>
      <span>… waiting for the next key</span>
    </div>
  );
}
