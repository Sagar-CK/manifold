import type { NavigateFunction } from "react-router-dom";

export function navigateToSearch(
  navigate: NavigateFunction,
  fallback: string = "/",
): void {
  navigate(fallback);
}
