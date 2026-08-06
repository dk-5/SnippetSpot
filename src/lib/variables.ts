export interface VariableContext {
  date?: Date;
  clipboard?: string;
  env?: Record<string, string>;
}

const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`;
}

export function expandVariables(text: string, ctx?: VariableContext): string {
  return text.replace(PLACEHOLDER_RE, (match, inner: string) => {
    const body = inner.trim();

    if (body === "date") {
      const d = ctx?.date ?? new Date();
      return formatDate(d);
    }

    if (body === "time") {
      const d = ctx?.date ?? new Date();
      return formatTime(d);
    }

    if (body === "datetime") {
      const d = ctx?.date ?? new Date();
      return formatDateTime(d);
    }

    if (body === "clipboard") {
      return ctx?.clipboard ?? match;
    }

    if (body.startsWith("env:")) {
      const expr = body.slice(4);
      const colonIdx = expr.indexOf(":");
      const name = (colonIdx === -1 ? expr : expr.slice(0, colonIdx)).trim();
      const fallback = colonIdx === -1 ? undefined : expr.slice(colonIdx + 1).trim();

      if (name === "") {
        return match;
      }

      const env = ctx?.env;
      if (env === undefined) {
        return fallback === undefined ? match : fallback;
      }

      const value = env[name];
      if (value === undefined) {
        return fallback === undefined ? "" : fallback;
      }
      return value;
    }

    return match;
  });
}
