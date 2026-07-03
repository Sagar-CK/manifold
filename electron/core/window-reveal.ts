/**
 * Fire `reveal` once on whichever of the given subscribers runs first.
 * Mirrors the pattern used by pingdotgg/t3code: `ready-to-show` avoids a
 * blank flash, but on Linux/Wayland with `show: false`, `ready-to-show` can
 * deadlock unless `show()` runs — subscribing to `did-finish-load` as well
 * keeps reveal reliable.
 */
export type RevealSubscription = (listener: () => void) => void;

export function bindFirstRevealTrigger(
  subscribers: readonly RevealSubscription[],
  reveal: () => void,
): void {
  let revealed = false;
  const fire = () => {
    if (revealed) return;
    revealed = true;
    reveal();
  };
  for (const subscribe of subscribers) {
    subscribe(fire);
  }
}
