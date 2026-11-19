// Extra toolbar buttons: Automations, Git graph and Reviewer toggle as side panes of the
// shown tab; Popups opens a small menu with the popup mods (Threads, Recap).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, run, focused, panes, openOverlay, closeOverlay } from "herdr";

const PANELS = [
  { id: "automations", label: "Automations", mod: "automations", icon: "mods/automations/automations.svg" },
  { id: "git", label: "Git", mod: "git-graph", icon: "mods/git-graph/icons/graph.svg", folder: true },
  { id: "review", label: "Review", mod: "reviewer", icon: "mods/reviewer/changes.svg" },
];
const POPUPS = [
  { label: "Threads", mod: "atuin-threads", icon: "mods/atuin-threads/threads.svg" },
  { label: "Recap", mod: "recap", icon: "mods/recap/icons/tasks.svg" },
];

// Toggle: close this mod's pane in the shown tab if there is one, else split one to the right.
function toggle(p) {
  const f = focused();
  const open = panes().find((x) => x.mod === p.mod && x.tab === f?.tab);
  if (open) return run("pane.close", { pane: open.pane });
  const spec = { direction: "right", mod: p.mod };
  if (p.folder && f?.cwd) spec.props = { folder: f.cwd };
  run("pane.split", spec);
}

function button(t, id, label, icon, on, onClick) {
  return h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
    .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(onClick)
    .child(svg(icon).size(14))
    .child(label);
}

export default class Extras extends View {
  render() {
    const t = theme();
    if (props()?.menu) {
      const { overlay } = props();
      return v_flex().size_full().p(6).gap(2).bg(t.popover)
        .children(POPUPS.map((p) => button(t, `pop-${p.mod}`, p.label, p.icon, false, () => {
          closeOverlay(overlay);
          run("mod.open", { name: p.mod });
        }).w_full()));
    }
    const f = focused();
    const here = panes().filter((x) => x.tab === f?.tab).map((x) => x.mod);
    return h_flex().size_full().pr(10).gap(2).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .children(PANELS.map((p) => button(t, `x-${p.id}`, p.label, p.icon, here.includes(p.mod), () => toggle(p))))
      .child(button(t, "x-popups", "Popups ▾", "mods/atuin-threads/threads.svg", false, () =>
        openOverlay({ mod: "toolbar-extras", props: { menu: true }, kind: "popup", width: 190, height: 84, at: "pointer" })));
  }
}
