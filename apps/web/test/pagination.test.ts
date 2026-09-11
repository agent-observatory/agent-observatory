import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionPage, sessionPagination } from "../lib/pagination";

test("session pagination defaults and accepts only supported page sizes", () => {
  assert.deepEqual(sessionPage("https://atlas.test/api/sessions"), {
    page: 1,
    pageSize: 20,
    q: "",
  });
  assert.deepEqual(
    sessionPage(
      "https://atlas.test/api/sessions?page=3&pageSize=50&q=%20hello%20",
    ),
    { page: 3, pageSize: 50, q: "hello" },
  );
  assert.deepEqual(
    sessionPage("https://atlas.test/api/sessions?page=-1&pageSize=25"),
    { page: 1, pageSize: 20, q: "" },
  );
});

test("session pagination clamps unsafe and overshoot pages", () => {
  assert.equal(
    sessionPage("https://atlas.test/api/sessions?page=999999999").page,
    1_000_000,
  );
  assert.deepEqual(sessionPagination(99, 20, 41), {
    page: 3,
    pageSize: 20,
    total: 41,
    totalPages: 3,
  });
  assert.deepEqual(sessionPagination(5, 20, 0), {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
});
