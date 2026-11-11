// Modified from Herdr's shipped `tabs` mod (0.1.12, Apache License 2.0, see LICENSE in this folder):
// an unnamed tab shows its agent's session name (or its space's name), and the bar sits flush in the head row.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const FOCUS = "#f9d544";
const DISPLAY = "Galmuri14";
const BODY = "Galmuri11";
const LINE = "#483e74";
const SURFACE = "#251b47";
const BG = "#191035";
const FOCUS_WATCH_MS = 100;

// A tab-bar key: ←→ move to the neighbouring tab and wrap; ↩ and Space select the tab shown.
export function tabsKey(key, at, count) {
  if (!(count > 0)) return null;
  if (key === "right") return { at: (at + 1) % count, select: false };
  if (key === "left") return { at: (at - 1 + count) % count, select: false };
  if (key === "enter" || key === "space") return { at: Math.min(at, count - 1), select: true };
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.at = 0;
    this.keyboard = false;
    this.handle = cx.focus_handle();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // A ring comes from is_focused(), and the shell redraws only on notify or reload.
    cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
  }

  focusKey() {
    return `${this.keyboard ? 1 : 0}|${this.handle?.is_focused?.() ? 1 : 0}`;
  }

  // Only the keyboard draws the tab's ring: a click focuses the bar too.
  watchFocus(cx) {
    const key = this.focusKey();
    if (key === this.drawnFocus) return;
    this.drawnFocus = key;
    cx.notify();
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    this.at = Math.min(Math.max(this.at ?? 0, 0), Math.max(0, shown.length - 1));
    this.drawnFocus = this.focusKey();
    const focusedAt = (index) => this.keyboard && index === this.at && Boolean(this.handle?.is_focused?.());
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(0).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      // An unnamed tab shows its agent's session name (the terminal title Claude Code sets),
      // else its space's name, not its position.
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id && p.focused);
      const live = (lead?.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const telling = live && !/^[~/]/.test(live) && !live.includes("@") && live !== program?.name;
      const name = !c.named ? (telling ? live : space?.name || c.name) : /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(28).px(8).gap(6).rounded(0).items_center().flex_none().text_size(12).font_family(BODY)
        .border(2).border_color(c.active ? FOCUS : LINE).bg(c.active ? SURFACE : BG).text_color(c.active ? t.foreground : t.muted)
        .when(focusedAt(i), el => el.border(2).border_color(FOCUS))
        .role("tab").aria_selected(Boolean(c.active))
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.keyboard = false; this.at = i; this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().flex_none().text_size(11).font_family(DISPLAY).text_color(FOCUS).child(`1-${i + 1}`))
        .child(div().w(170).flex_none().truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), w = window();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    const notice = shared("arcade-cards.notice");
    // A scan error or a notice comes from the cards strip; its Retry or Undo asks back over the pair of keys.
    const noticePill = () => {
      const err = notice.tone === "err";
      const action = notice.action;
      return h_flex().id("cc-notice").h(28).flex_none().max_w(360).min_w(0).pl(8).pr(action ? 4 : 8).gap(8).rounded(0).items_center()
        .bg(err ? "#670242" : SURFACE).border(2).border_color(err ? "#ff41b4" : LINE)
        .child(div().min_w(0).truncate().text_size(12).font_family(BODY).text_color(err ? "#f1f0ff" : "#d0cdea").child(notice.text))
        .when(Boolean(action), (el) => el.child(h_flex().id("cc-notice-act").h(20).flex_none().px(8).rounded(0).items_center().cursor_pointer()
          .bg(BG).border(2).border_color(LINE).hover((s) => s.bg(SURFACE))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => setShared("arcade-cards.notice-act", {
            token: `${Date.now()}-${Math.random()}`, act: notice.tone === "err" ? "retry" : "undo",
          }))
          .child(div().text_size(11).font_family(DISPLAY).text_color(FOCUS).child(action))));
    };
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(4).flex_none().items_center().rounded(0)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).gap(2).items_center()
      .track_focus(this.handle).tab_index(0)
      .on_mouse_down("left", () => { this.keyboard = false; })
      .on_key_down((event, cx) => {
        const next = tabsKey(event.key, this.at, shown.length);
        if (!next) return;
        this.keyboard = true;
        this.at = next.at;
        if (next.select) run("tab.select", { id: shown[this.at].id });
        cx.stop_propagation();
        cx.notify();
      })
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(2).overflow_x_scrollbar().children(shown.map(item)))
      .when(Boolean(notice?.text), (el) => el.child(noticePill()))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/arcade-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/arcade-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/arcade-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
