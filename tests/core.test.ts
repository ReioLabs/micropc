import assert from "node:assert/strict";
import test from "node:test";
import { MicroPcError } from "@micropc/core/errors.js";
import { normalizeName, parseComputerRef } from "@micropc/core/names.js";
import { assertTransition } from "@micropc/core/transitions.js";

test("normalizes human names and parses a computer reference", () => {
  assert.equal(normalizeName("My Project"), "my-project");
  assert.deepEqual(parseComputerRef("Home/My Project"), { hostName: "home", computerName: "my-project" });
});

test("rejects invalid lifecycle transitions", () => {
  assert.doesNotThrow(() => assertTransition("running", "sleeping"));
  assert.throws(
    () => assertTransition("sleeping", "sleeping"),
    (error) => error instanceof MicroPcError && error.code === "INVALID_TRANSITION",
  );
});
