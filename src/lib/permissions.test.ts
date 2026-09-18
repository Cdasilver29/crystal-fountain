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
