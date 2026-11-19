// A lazy file browser for the focused pane's folder, with bounded read-only previews,
// plus a VS Code-style search by file name and content (see search.js).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, shared, setShared } from "herdr";
import { search, matcher, ranges, MAX_LINES, MAX_NAMES } from "./search.js";

const EXCLUDE_KEY = "my-files.exclude", OPTIONS_KEY = "my-files.options";
const detab = s => s.replace(/\t/g, "    ");

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.seq = 0; this.results = null; this.searching = false; this.searchError = null; this.view = null;
    this.options = { case: false, word: false, regex: false, ...(shared(OPTIONS_KEY) ?? {}) };
    this.showExclude = false;
    this.scroll = VirtualListScrollHandle.new();
    this.query = InputState.new({ placeholder: "Buscar por nombre o contenido…" });
    this.query.on("change", (_e, cx) => this.schedule(cx));
    this.query.on("submit", (_e, cx) => this.schedule(cx, 0));
    this.exclude = InputState.new({ placeholder: "ej: node_modules, .git, *.lock", value: String(shared(EXCLUDE_KEY) ?? "") });
    this.exclude.on("change", (_e, cx) => { setShared(EXCLUDE_KEY, this.exclude.value()); this.schedule(cx); });
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  // ---- search ----

  schedule(cx, delay = 300) {
    const seq = ++this.seq;
    if (!this.query.value()) { this.results = null; this.searching = false; this.searchError = null; this.view = null; cx.notify(); return; }
    this.searching = true; cx.notify();
    cx.timer.after(delay, cx => { if (seq === this.seq) this.runSearch(seq, cx); });
  }

  runSearch(seq, cx) {
    const q = this.query.value(), o = { ...this.options }, context = this.context, root = this.root, on = this.on;
    if (!q || !root) { this.searching = false; cx.notify(); return; }
    if (!on && window()?.platform === "windows") { this.searching = false; this.searchError = "La búsqueda no está disponible en Windows"; cx.notify(); return; }
    try { matcher(q, o); } catch { this.searching = false; this.results = null; this.searchError = "Expresión regular inválida"; cx.notify(); return; }
    cx.spawn(async cx => {
      try {
        const r = await search(root, on, q, o, this.exclude.value());
        if (seq !== this.seq || this.context !== context) return;
        this.results = { ...r, query: q, options: o }; this.searchError = null;
      } catch (e) {
        if (seq === this.seq) { this.results = null; this.searchError = /time|30/i.test(String(e)) ? "La búsqueda tardó demasiado: probá excluir carpetas grandes" : String(e); }
      } finally { if (seq === this.seq) { this.searching = false; cx.notify(); } }
    });
  }

  toggleOption(name, cx) {
    this.options = { ...this.options, [name]: !this.options[name] };
    setShared(OPTIONS_KEY, this.options);
    this.schedule(cx, 0);
  }

  openView(path, line, cx) {
    const context = this.context, root = this.root, on = this.on, r = this.results;
    let re = null;
    try { re = r ? matcher(r.query, r.options) : null; } catch {}
    this.view = { path, line, lines: null, error: null, re, width: 300 };
    cx.notify();
    cx.spawn(async cx => {
      const view = this.view;
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.view !== view || !this.current(context)) return;
        if (text === null) view.error = "Este archivo ya no está disponible";
        else if (text.includes("\0")) view.error = "Archivo binario · sin vista previa";
        else {
          view.lines = text.split("\n").map(l => { const d = detab(l.replace(/\r$/, "")); return d.length > 2000 ? d.slice(0, 2000) + " …" : d; });
          view.width = Math.max(300, ...view.lines.map(l => l.length * 7.3 + 70));
          view.scrollTo = line ? Math.max(0, line - 1) : 0;
        }
      } catch { if (this.view === view) view.error = "No se puede abrir este archivo (binario, muy grande o ilegible)"; }
      finally { cx.notify(); }
    });
  }

  // Text with every match highlighted; `strong` for the line the search pointed at.
  marked(text, re, t, strong) {
    const parts = [], rs = ranges(text, re);
    let at = 0;
    for (const [a, b] of rs) {
      if (a > at) parts.push(div().flex_none().whitespace_nowrap().child(text.slice(at, a)));
      parts.push(div().flex_none().whitespace_nowrap().rounded(3).bg(t.ansi3 + (strong ? "88" : "44")).text_color(t.foreground).child(text.slice(a, b)));
      at = b;
    }
    if (at < text.length || !parts.length) parts.push(div().flex_none().whitespace_nowrap().child(text.slice(at) || " "));
    return parts;
  }

  snippet(text, re) {
    let s = detab(text), lead = s.length - s.trimStart().length;
    s = s.slice(lead);
    const first = ranges(s, re)[0];
    if (first && first[0] > 40) s = "…" + s.slice(first[0] - 25);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  }

  toggleButton(id, label, on, cx, t, onClick) {
    return div().id(id).h(24).min_w(26).px(5).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_size(11.5).font_semibold()
      .when(on, el => el.bg(t.accent + "33").text_color(t.accent)).when(!on, el => el.text_color(t.dim).hover(s => s.bg(t.hover)))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  searchBar(t) {
    const excl = String(this.exclude.value() ?? "").trim();
    return v_flex().flex_none().px(8).pt(8).pb(6).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().h(30).gap(4).px(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.surface ?? t.background)
        .child(Input.new(this.query).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
        .child(this.toggleButton("fs-case", "Aa", this.options.case, null, t, cx => this.toggleOption("case", cx)))
        .child(this.toggleButton("fs-word", "ab", this.options.word, null, t, cx => this.toggleOption("word", cx)))
        .child(this.toggleButton("fs-regex", ".*", this.options.regex, null, t, cx => this.toggleOption("regex", cx)))
        .child(this.toggleButton("fs-more", excl ? "⋯•" : "⋯", this.showExclude, null, t, cx => { this.showExclude = !this.showExclude; cx.notify(); })))
      .when(this.showExclude, el => el.child(v_flex().gap(3)
        .child(div().px(2).text_size(11).text_color(t.dim).child("Archivos a excluir (separados por coma)"))
        .child(h_flex().h(28).px(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.surface ?? t.background)
          .child(Input.new(this.exclude).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground)))));
  }

  // Flat rows for the results list, built once per search; rendering only draws the visible ones.
  resultModel() {
    const r = this.results;
    if (!r || r.model) return r?.model;
    let re = null;
    try { re = matcher(r.query, r.options); } catch {}
    const rows = [];
    if (r.names.length) {
      rows.push({ kind: "h", key: "h-names", text: `ARCHIVOS CON ESE NOMBRE · ${r.names.length}${r.namesLimited ? "+" : ""}` });
      for (const p of r.names) rows.push({ kind: "f", key: `n-${p}`, path: p, line: null });
    }
    if (r.files.length) {
      rows.push({ kind: "h", key: "h-lines", text: `CONTIENEN EL TEXTO · ${r.lineCount}${r.linesLimited ? "+" : ""} en ${r.files.length} archivos` });
      for (const f of r.files) {
        rows.push({ kind: "f", key: `f-${f.path}`, path: f.path, line: f.lines[0].n, count: f.lines.length });
        for (const l of f.lines) { const text = this.snippet(l.text, re); rows.push({ kind: "l", key: `l-${f.path}:${l.n}`, path: f.path, line: l.n, text, ranges: ranges(text, re) }); }
      }
    }
    if (!rows.length) rows.push({ kind: "m", key: "none", text: "Sin resultados" });
    if (r.namesLimited || r.linesLimited) rows.push({ kind: "m", key: "limit", text: `Se muestran hasta ${MAX_NAMES} nombres y ${MAX_LINES} líneas. Afiná la búsqueda o excluí carpetas.` });
    r.model = rows; r.sizes = rows.map(row => row.kind === "h" ? 30 : row.kind === "f" ? 26 : row.kind === "l" ? 22 : 40);
    return rows;
  }

  resultRow(row, t, font) {
    if (row.kind === "h") return div().w_full().h(30).flex_none().px(6).pt(10).text_size(11).font_semibold().text_color(t.dim).truncate().child(row.text);
    if (row.kind === "m") return div().w_full().h(40).flex_none().p(8).text_size(11.5).text_color(t.dim).child(row.text);
    if (row.kind === "f") {
      const parts = row.path.split("/"), name = parts.pop();
      return h_flex().w_full().h(26).flex_none().px(6).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .child(svg("mods/my-files/file.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().max_w(200).truncate().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parts.join("/")))
        .when(row.count != null, el => el.child(div().flex_none().px(6).rounded(8).bg(t.hover).text_size(10.5).text_color(t.muted).child(String(row.count))));
    }
    const parts = [];
    let at = 0;
    for (const [a, b] of row.ranges) {
      if (a > at) parts.push(div().flex_none().whitespace_nowrap().child(row.text.slice(at, a)));
      parts.push(div().flex_none().whitespace_nowrap().rounded(3).bg(t.ansi3 + "55").text_color(t.foreground).child(row.text.slice(a, b)));
      at = b;
    }
    if (at < row.text.length || !parts.length) parts.push(div().flex_none().whitespace_nowrap().child(row.text.slice(at) || " "));
    return h_flex().w_full().h(22).flex_none().pl(28).pr(6).gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover)).overflow_hidden()
      .child(div().flex_none().w(34).text_right().text_size(11).text_color(t.dim).child(String(row.line)))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(12).font_family(font).children(parts));
  }

  resultsList(t) {
    const rows = this.resultModel(), font = settings().font_family ?? "JetBrains Mono";
    const byKey = this.results.byKey ??= new Map(rows.map(r => [r.key, r]));
    return div().flex_1().min_h(0).relative()
      .child(div().id("fs-results-box").size_full().px(6).child(div().w_full().h_full().child(v_virtual_list("fs-results", rows.length, this.results.sizes, i => rows[i].key,
        range => rows.slice(range.start, range.end).map(row => this.resultRow(row, t, font))).size_full()
        .on_item_click((k, cx) => { const row = byKey.get(k); if (row?.path) this.openView(row.path, row.line, cx); }))))
      .child(Scrollbar.vertical("fs-results").viewport_from_layout().absolute().inset_0());
  }

  viewer(t) {
    const v = this.view;
    if (!v.lines) return div().p(12).text_color(t.dim).child(v.error || "Cargando archivo…");
    if (v.scrollTo != null) { this.scroll.scroll_to_item(v.scrollTo, "center"); v.scrollTo = null; }
    const font = settings().font_family ?? "JetBrains Mono";
    return div().flex_1().min_h(0).relative().font_family(font).text_size(12)
      .child(div().id("fs-view-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(v.width).h_full().child(v_virtual_list("fs-view", v.lines.length, 20, i => String(i),
          range => v.lines.slice(range.start, range.end).map((text, k) => {
            const n = range.start + k + 1, here = n === v.line;
            return h_flex().w_full().h(20).flex_none().gap(12).when(here, el => el.bg(t.accent + "26"))
              .child(div().w(44).flex_none().text_right().text_color(here ? t.foreground : t.dim).child(String(n)))
              .child(h_flex().flex_none().children(this.marked(text, v.re, t, here)));
          })).track_scroll(this.scroll).size_full())))
      .child(Scrollbar.vertical("fs-view").viewport_from_layout().absolute().inset_0());
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.view = null;
      if (saved?.file) this.show(saved.file, cx);
      if (cx && this.query?.value()) this.schedule(cx, 0);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), searching = Boolean(this.query.value());
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.view || (this.file && !searching)), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { if (this.view) this.view = null; else this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(this.view ? `${this.view.path}${this.view.line ? ` · línea ${this.view.line}` : ""}` : this.file && !searching ? this.file : this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.view && !(this.file && !searching), el => el.child(this.searchBar(t)))
      .when(Boolean(this.view), el => el.child(this.viewer(t)))
      .when(!this.view && searching, el => el
        .when(Boolean(this.searchError), el => el.child(div().p(10).text_size(12).text_color(t.ansi1).child(this.searchError)))
        .when(!this.searchError && this.searching, el => el.child(div().px(14).py(4).text_size(11).text_color(t.dim).child(this.results ? "Actualizando…" : "Buscando…")))
        .when(!this.searchError && Boolean(this.results), el => el.child(this.resultsList(t))))
      .when(!this.view && !searching && !this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(!this.view && !searching && Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
