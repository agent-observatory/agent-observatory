import { test } from "node:test";
import assert from "node:assert/strict";
import { launchAgentPlist } from "../src/scheduling.js";

test("launchd plist runs at load and every 30 minutes with escaped paths", () => {
  const plist = launchAgentPlist({
    label: "com.agent-observatory.atlas-collector",
    node: "/opt/node&safe/bin/node",
    script: "/tmp/collector <sync>.js",
    root: "/tmp/atlas",
    log: "/tmp/atlas/collector.log",
    errorLog: "/tmp/atlas/collector-error.log",
  });
  assert.match(plist, /<key>StartInterval<\/key><integer>1800<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /--scheduled/);
  assert.match(plist, /node&amp;safe/);
  assert.match(plist, /collector &lt;sync&gt;\.js/);
});
