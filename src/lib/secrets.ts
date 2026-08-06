const MASK_CHAR = "\u2022";

export function maskSecret(text: string): string {
  if (text === "") return "";
  if (text.length <= 4) return MASK_CHAR.repeat(text.length);
  return MASK_CHAR.repeat(text.length - 4) + text.slice(-4);
}
