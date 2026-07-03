import type { CSSProperties } from "react";

export function tagPillStyle(color: string): CSSProperties {
  return { "--tag-color": color } as CSSProperties;
}
