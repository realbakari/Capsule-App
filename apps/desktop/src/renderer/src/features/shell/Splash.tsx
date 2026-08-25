export function Splash({ fading }: { fading: boolean }) {
  return (
    <div className={`splash ${fading ? "fading" : ""}`} data-testid="boot-splash">
      <img className="splash-mark" src="./icon.png" alt="" />
      <p>Starting Capsule</p>
    </div>
  );
}
