// Extra toolbar buttons: Automations toggles a side pane of the shown tab;
// Git ▾ groups the git tools (the graph as a side pane, gitview in the
// Changes panel or in its own tab); Popups ▾ opens the popup mods (Threads, Recap).
import { View, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, run, focused, panes, layout, openOverlay, closeOverlay } from "herdr";

const AUTOMATIONS = { id: "automations", label: "Automations", mod: "automations", icon: "mods/automations/automations.svg" };
const GRAPH = { mod: "git-graph", folder: true };
const GIT_ICON = "mods/git-graph/icons/graph.svg";
const GITVIEW_ICON = "mods/gitview/icons/diff.svg";
const POPUPS = [
  { label: "Threads", mod: "atuin-threads", icon: "mods/atuin-threads/threads.svg" },
  { label: "Recap", mod: "recap", icon: "mods/recap/icons/tasks.svg" },
];
const ITEM = 26, GAP = 2, PAD = 6;
const menuHeight = (n) => PAD * 2 + n * ITEM + (n - 1) * GAP;

// Toggle: close this mod's pane in the shown tab if there is one, else split one to the right.
function toggle(p) {
  const f = focused();
  const open = panes().find((x) => x.mod === p.mod && x.tab === f?.tab);
  if (open) return run("pane.close", { pane: open.pane });
  const spec = { direction: "right", mod: p.mod };
  if (p.folder && f?.cwd) spec.props = { folder: f.cwd };
  run("pane.split", spec);
}

// Whether the layout's Changes panel is showing gitview: every node on the
// way to the gitview block shown, and each stack on it on that child.
function gitviewPanelShown() {
  const walk = (n) => {
    if (!n || n.hidden) return false;
    if (n.type === "block") return n.content?.mod === "gitview";
    const kids = n.children ?? [];
    if (n.type === "stack") return walk(kids.find((c) => c.id === n.active));
    return kids.some(walk);
  };
  return walk(layout());
}

function inTab(mods) {
  const f = focused();
  return panes().some((x) => x.tab === f?.tab && mods.includes(x.mod));
}

function button(t, id, label, icon, on, onClick) {
  return h_flex().id(id).h(ITEM).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
    .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(onClick)
    .child(svg(icon).size(14))
    .child(label);
}

function menu(t, items) {
  const { overlay } = props();
  return v_flex().size_full().p(PAD).gap(GAP).bg(t.popover)
    .children(items.map((it) => button(t, it.id, it.label, it.icon, it.on ?? false, () => {
      closeOverlay(overlay);
      it.act();
    }).w_full()));
}

function gitItems() {
  return [
    { id: "git-graph", label: "Graph", icon: GIT_ICON, on: inTab([GRAPH.mod]), act: () => toggle(GRAPH) },
    { id: "git-gitview-panel", label: "Gitview: panel", icon: GITVIEW_ICON, on: gitviewPanelShown(), act: () => run("mod.open", { name: "gitview-sidebar" }) },
    { id: "git-gitview-tab", label: "Gitview: tab", icon: GITVIEW_ICON, on: inTab(["gitview", "gitview-diff"]) && !gitviewPanelShown(), act: () => run("mod.open", { name: "gitview-tab" }) },
  ];
}

function popupItems() {
  return POPUPS.map((p) => ({ id: `pop-${p.mod}`, label: p.label, icon: p.icon, act: () => run("mod.open", { name: p.mod }) }));
}

function openMenu(kind, n) {
  openOverlay({ mod: "toolbar-extras", props: { menu: kind }, kind: "popup", width: 190, height: menuHeight(n), at: "pointer" });
}

export default class Extras extends View {
  render() {
    const t = theme();
    const kind = props()?.menu;
    if (kind === "git") return menu(t, gitItems());
    if (kind) return menu(t, popupItems());
    const gitOn = inTab([GRAPH.mod, "gitview", "gitview-diff"]) || gitviewPanelShown();
    return h_flex().size_full().pr(10).gap(2).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(button(t, `x-${AUTOMATIONS.id}`, AUTOMATIONS.label, AUTOMATIONS.icon, inTab([AUTOMATIONS.mod]), () => toggle(AUTOMATIONS)))
      .child(button(t, "x-git", "Git ▾", GIT_ICON, gitOn, () => openMenu("git", 3)))
      .child(button(t, "x-popups", "Popups ▾", "mods/atuin-threads/threads.svg", false, () => openMenu("popups", POPUPS.length)));
  }
}
