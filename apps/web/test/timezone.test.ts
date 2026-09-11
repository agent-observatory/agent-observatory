import test from "node:test";
import assert from "node:assert/strict";
import { displayDate, validTimezone, timezoneFrom } from "../lib/timezone";

test("time zone validates IANA identifiers and preserves device default", () => {
  assert.equal(validTimezone("Asia/Seoul"), true);
  assert.equal(validTimezone("UTC"), true);
  assert.equal(validTimezone("not/a-zone"), false);
  assert.equal(timezoneFrom("broken"), "system");
});
test("time zone formatting handles date boundaries and daylight saving", () => {
  assert.equal(
    displayDate("2026-01-01T00:30:00Z", "en", "America/Los_Angeles", "date"),
    "2025-12-31",
  );
  assert.equal(
    displayDate("2026-01-01T00:30:00Z", "en", "Asia/Seoul", "date"),
    "2026-01-01",
  );
  assert.equal(
    displayDate("2026-03-08T09:30:00Z", "en", "America/Los_Angeles", "time"),
    "01:30:00",
  );
  assert.equal(
    displayDate("2026-03-08T10:30:00Z", "en", "America/Los_Angeles", "time"),
    "03:30:00",
  );
});
