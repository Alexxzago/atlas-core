import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryLifecyclePolicy, ProviderDeliveryDomainError } from "../transport/domain/providerDelivery.js";

test("EPIC-020 delivery lifecycle permits forward transitions, equal-state no-ops, and rejects regressions", () => {
  const policy = new DeliveryLifecyclePolicy();
  assert.equal(policy.transition("accepted", "delivered"), "apply");
  assert.equal(policy.transition("delivered", "read"), "apply");
  assert.equal(policy.transition("read", "read"), "noop");
  assert.equal(policy.transition("uncertain", "accepted"), "apply");
  assert.throws(() => policy.transition("read", "accepted"), ProviderDeliveryDomainError);
  assert.throws(() => policy.transition("permanent_failure", "delivered"), ProviderDeliveryDomainError);
});
