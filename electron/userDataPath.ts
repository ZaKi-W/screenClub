import path from "node:path";
import { app } from "electron";

// Product renaming changes Electron's default userData directory. Keep the
// historical technical path so ScreenClub upgrades in place with recordings,
// projects, shortcuts, provider keys and permissions intact.
app.setPath("userData", path.join(app.getPath("appData"), "Openscreen"));
