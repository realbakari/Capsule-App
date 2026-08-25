export function Splash({ fading }: { fading: boolean }) {
  return (
    <div className={`splash ${fading ? "fading" : ""}`} data-testid="boot-splash">
      <div className="splash-mark" />
      <p>Starting Capsule</p>
    </div>
  );
}
