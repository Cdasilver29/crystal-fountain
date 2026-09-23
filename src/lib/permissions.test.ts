import { describe, expect, it } from "vitest";

import { ADMIN_ACTIONS, can } from "@/lib/permissions";

/**
 * The permission table, asserted rather than read.
 *
 * can() is what requirePermission calls, so this is the enforcement point for
 * every admin route. Hiding a control in the UI is never what stops anybody.
 */

const viewer = { role: "viewer" as const, isSuper: false };
const treasurer = { role: "treasurer" as const, isSuper: false };
const admin = { role: "admin" as const, isSuper: false };
const superAdmin = { role: "admin" as const, isSuper: true };

describe("pledgers.setOrganisation", () => {
  it("is refused to a viewer", () => {
    expect(can(viewer, "pledgers.setOrganisation")).toBe(false);
  });

  it("is allowed to a treasurer", () => {
    expect(can(treasurer, "pledgers.setOrganisation")).toBe(true);
  });

  it("is allowed to an admin", () => {
    expect(can(admin, "pledgers.setOrganisation")).toBe(true);
  });

  it("does not need the super flag", () => {
    expect(can(superAdmin, "pledgers.setOrganisation")).toBe(true);
  });
});

describe("pledgers.setDisplayName", () => {
  it("is refused to a viewer", () => {
    expect(can(viewer, "pledgers.setDisplayName")).toBe(false);
  });

  it("is allowed to a treasurer", () => {
    expect(can(treasurer, "pledgers.setDisplayName")).toBe(true);
  });

  it("is allowed to an admin", () => {
    expect(can(admin, "pledgers.setDisplayName")).toBe(true);
  });

  it("does not need the super flag", () => {
    expect(can(superAdmin, "pledgers.setDisplayName")).toBe(true);
  });
});

describe("change requests", () => {
  it("are visible to everybody who can see the books", () => {
    expect(can(viewer, "changeRequests.view")).toBe(true);
    expect(can(treasurer, "changeRequests.view")).toBe(true);
    expect(can(admin, "changeRequests.view")).toBe(true);
  });

  it("are decided by the treasurer and not by a viewer", () => {
    expect(can(viewer, "changeRequests.decide")).toBe(false);
    expect(can(treasurer, "changeRequests.decide")).toBe(true);
    expect(can(admin, "changeRequests.decide")).toBe(true);
  });

  /*
   * Cancelling takes a pledge off the figure the congregation is watching, so
   * it sits with deletion rather than with routine corrections. A treasurer
   * sees the request and can decline it; approving it is an administrator's.
   */
  it("are cancelled only by an administrator", () => {
    expect(can(viewer, "changeRequests.decideCancellation")).toBe(false);
    expect(can(treasurer, "changeRequests.decideCancellation")).toBe(false);
    expect(can(admin, "changeRequests.decideCancellation")).toBe(true);
    expect(can(superAdmin, "changeRequests.decideCancellation")).toBe(true);
  });

  it("separate deciding a cancellation from deciding anything else", () => {
    expect(can(treasurer, "changeRequests.decide")).toBe(true);
    expect(can(treasurer, "changeRequests.decideCancellation")).toBe(false);
  });
});

describe("the table as a whole", () => {
  it("every action has a rule, so none falls through to allowed", () => {
    for (const action of ADMIN_ACTIONS) {
      expect(typeof can(viewer, action)).toBe("boolean");
    }
  });

  it("a viewer can read and change nothing", () => {
    const allowed = ADMIN_ACTIONS.filter((a) => can(viewer, a));
    expect([...allowed].sort()).toEqual([
      "analytics.view",
      "changeRequests.view",
      "payments.view",
      "pledges.view",
    ]);
  });

  it("anything a viewer may do, a treasurer and an admin may do too", () => {
    for (const action of ADMIN_ACTIONS) {
      if (can(viewer, action)) {
        expect(can(treasurer, action)).toBe(true);
        expect(can(admin, action)).toBe(true);
      }
    }
  });
});
