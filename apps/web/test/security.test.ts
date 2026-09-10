import { test } from "node:test";
import assert from "node:assert/strict";
import { publicAddress } from "../lib/provider";
test("private, mapped private, loopback and metadata addresses rejected", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("1.1.1.1"), true);
});
