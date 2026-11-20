// Reports OpenCode's status to herdr-core (the Herdr desktop app's terminals)
// with OSC 7501, so OpenCode sessions show in the app's Agents list.
//
// herdr's own herdr-agent-state.js / herdr-tui-session.js only talk to the
// herdr TUI (HERDR_SOCKET_PATH / HERDR_PANE_ID); terminals started by
// herdr-core only have HC_TERMINAL_ID, and herdr-core learns an agent's
// status from what the program writes to its terminal:
//   ESC ] 7501 ; state=<idle|working|done|blocked|error>:app=opencode[:kind=permission|question] BEL
// Not managed by herdr: safe to edit, delete it to turn this off.

import fs from "node:fs";

const APP = "opencode";
const PAUSE = new Set(["serve", "web"]); // headless servers: no terminal of their own

let tty = null;
let last = "";

function write(state, kind) {
  const payload = `state=${state}:app=${APP}${kind ? `:kind=${kind}` : ""}`;
  if (payload === last) return;
  last = payload;
  try {
    if (tty === null) {
      try { tty = fs.openSync("/dev/tty", "w"); } catch { tty = 1; }
    }
    fs.writeSync(tty, `\x1b]7501;${payload}\x07`);
  } catch {
    // no terminal to tell
  }
}

const BUSY = new Set(["active", "busy", "pending", "retry", "running", "streaming", "working"]);

export const HcAgentStatusPlugin = async () => {
  if (!process.env.HC_TERMINAL_ID || PAUSE.has(process.argv[2])) return {};

  const children = new Set(); // sub-agent sessions: only their questions count
  let working = false;
  const busy = () => { working = true; write("working"); };
  const settle = () => { write(working ? "done" : "idle"); working = false; };

  write("idle");

  return {
    "chat.message": async ({ sessionID }) => {
      if (!children.has(sessionID)) busy();
    },
    event: async ({ event }) => {
      const type = event?.type;
      const props = event?.properties ?? {};
      const info = props.info;
      if (info?.id && info.parentID) children.add(info.id);
      const child = children.has(props.sessionID);

      switch (type) {
        case "permission.asked":
        case "permission.updated":
          return write("blocked", "permission");
        case "question.asked":
          return write("blocked", "question");
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          return busy();
      }
      if (child) return;
      switch (type) {
        case "session.status": {
          const kind = String(typeof props.status === "string" ? props.status : props.status?.type ?? "").toLowerCase();
          if (kind === "idle") settle();
          else if (BUSY.has(kind)) busy();
          return;
        }
        case "tool.execute.before":
        case "tool.execute.after":
        case "session.compacted":
          return busy();
        case "session.idle":
          return settle();
        case "session.error":
          return props.error?.name === "MessageAbortedError" ? write("idle") : write("error");
      }
    },
  };
};

export default {
  id: "hc.agent-status",
  server: HcAgentStatusPlugin,
};
