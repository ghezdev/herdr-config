// Search by file name and by content for my-files, run with find + grep on the panel's machine.
import { exec } from "herdr";

export const MAX_LINES = 2000, MAX_NAMES = 200, PER_FILE = 200, LIST_LIMIT = 50000;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A global RegExp for the query, as the toggles say; throws on an invalid regular expression. */
export function matcher(query, o) {
  let source = o.regex ? query : escape(query);
  if (o.word) source = `\\b(?:${source})\\b`;
  return new RegExp(source, o.case ? "g" : "gi");
}

/** [start, end) ranges of every match of re in text. */
export function ranges(text, re) {
  const out = [];
  if (!re) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) && out.length < 500) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** "node_modules, *.lock, src/gen/**" -> cleaned patterns. */
export function patterns(text) {
  return String(text ?? "").split(",").map(p => p.trim().replace(/^\.\//, "").replace(/^(\*\*\/)+/, "").replace(/(\/\*\*)+$/, "").replace(/\/+$/, "")).filter(Boolean);
}

function globBody(glob) {
  let s = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { s += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") s += "[^/]*";
    else if (c === "?") s += "[^/]";
    else s += escape(c);
  }
  return s;
}

/** True when a relative path falls under one of the exclusions. */
function excludedBy(list) {
  const named = list.filter(p => !p.includes("/")).map(p => new RegExp(`^${globBody(p)}$`));
  const pathed = list.filter(p => p.includes("/")).map(p => new RegExp(`^${globBody(p)}(/|$)`));
  return path => {
    if (pathed.some(re => re.test(path))) return true;
    return named.length > 0 && path.split("/").some(part => named.some(re => re.test(part)));
  };
}

const PIPE = 'cd "$1" || exit 2; limit=$2; shift 2; "$@" 2>/dev/null | head -n "$limit" | cut -b 1-600';

async function run(root, on, limit, argv) {
  const r = await exec("sh", ["-c", PIPE, "search", root, String(limit), ...argv], { on });
  if (r.code === 2) throw new Error("Cannot open this folder");
  return r.stdout;
}

/**
 * Searches root for query. Resolves with
 * { names: [path], files: [{ path, lines: [{ n, text }] }], lineCount, namesLimited, linesLimited }.
 */
export async function search(root, on, query, o, excludeText) {
  const list = patterns(excludeText), excluded = excludedBy(list);
  const re = matcher(query, o), test = new RegExp(re.source, re.flags.replace("g", ""));

  const named = list.filter(p => !p.includes("/"));
  const findArgs = ["find", "."];
  if (named.length) {
    findArgs.push("(");
    named.forEach((p, i) => { if (i) findArgs.push("-o"); findArgs.push("-name", p); });
    findArgs.push(")", "-prune", "-o");
  }
  findArgs.push("-type", "f", "-print");

  const grepArgs = ["grep", "-r", "-n", "-I", "-H", "-Z", "--color=never", "-m", String(PER_FILE)];
  if (!o.case) grepArgs.push("-i");
  if (o.word) grepArgs.push("-w");
  grepArgs.push(o.regex ? "-E" : "-F");
  for (const p of named) grepArgs.push(`--exclude=${p}`, `--exclude-dir=${p}`);
  grepArgs.push("-e", query, "--", ".");

  const [found, grepped] = await Promise.all([run(root, on, LIST_LIMIT, findArgs), run(root, on, MAX_LINES, grepArgs)]);

  const names = [];
  let namesLimited = false;
  for (const line of found.split("\n")) {
    if (!line) continue;
    const path = line.replace(/^\.\//, "");
    if (excluded(path) || !test.test(path.split("/").pop())) continue;
    if (names.length >= MAX_NAMES) { namesLimited = true; break; }
    names.push(path);
  }

  const files = [], byPath = new Map();
  let lineCount = 0;
  const out = grepped.split("\n");
  for (const line of out) {
    const cut = line.indexOf("\0");
    if (cut < 0) continue;
    const path = line.slice(0, cut).replace(/^\.\//, ""), m = /^(\d+):([\s\S]*)$/.exec(line.slice(cut + 1));
    if (!m || excluded(path)) continue;
    let file = byPath.get(path);
    if (!file) { file = { path, lines: [] }; byPath.set(path, file); files.push(file); }
    file.lines.push({ n: Number(m[1]), text: m[2].replace(/�+$/, "") });
    lineCount++;
  }
  return { names, files, lineCount, namesLimited, linesLimited: out.filter(Boolean).length >= MAX_LINES };
}
