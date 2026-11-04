export function jsonLines(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // Not a complete JSON line. Parsers fail closed on what is missing.
    }
  }
  return lines;
}

/** Tool names are repeated in status, so anything unusual becomes a label. */
export function safeToolName(name) {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(String(name)) ? name : "unknown";
}
