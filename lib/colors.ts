// Each course is a "space" with its own colour, like Arc's spaces.
const PALETTE = ["#5b4cf5", "#e85dc0", "#ff8a3d", "#1f9d8a", "#3b82f6", "#d946ef", "#eab308", "#ef4444"];

export function courseColor(code: string): string {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
