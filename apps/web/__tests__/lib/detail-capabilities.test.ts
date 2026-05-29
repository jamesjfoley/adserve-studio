import { describe, expect, test } from "vitest";
import { computeRecordCapabilities } from "@/lib/crm/detail-capabilities";

const USER = "user-1";

describe("computeRecordCapabilities", () => {
  test("grants edit/archive via explicit permission", () => {
    const caps = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(["account.update", "account.delete"]),
      userId: USER,
      ownedBy: null,
    });
    expect(caps.canEdit).toBe(true);
    expect(caps.canArchive).toBe(true);
  });

  test("owner override grants edit/archive without the permission", () => {
    const caps = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(), // no account.update / account.delete
      userId: USER,
      ownedBy: USER,
    });
    expect(caps.canEdit).toBe(true);
    expect(caps.canArchive).toBe(true);
  });

  test("null ownedBy never grants via ownership", () => {
    const caps = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(),
      userId: USER,
      ownedBy: null,
    });
    expect(caps.canEdit).toBe(false);
    expect(caps.canArchive).toBe(false);
  });

  test("a different owner does not grant", () => {
    const caps = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(),
      userId: USER,
      ownedBy: "someone-else",
    });
    expect(caps.canEdit).toBe(false);
  });

  test("convert is lead-only and strictly permission-gated (no owner override)", () => {
    expect(
      computeRecordCapabilities({
        slug: "lead",
        permissions: new Set(["lead.convert"]),
        userId: USER,
        ownedBy: null,
      }).canConvert
    ).toBe(true);

    // Owner of a lead without lead.convert cannot convert.
    expect(
      computeRecordCapabilities({
        slug: "lead",
        permissions: new Set(),
        userId: USER,
        ownedBy: USER,
      }).canConvert
    ).toBe(false);

    // Non-lead entity never converts even with the permission present.
    expect(
      computeRecordCapabilities({
        slug: "account",
        permissions: new Set(["lead.convert"]),
        userId: USER,
        ownedBy: USER,
      }).canConvert
    ).toBe(false);
  });

  test("activity capabilities follow their own permissions", () => {
    const caps = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(["activity.create", "activity.read"]),
      userId: USER,
      ownedBy: null,
    });
    expect(caps.canLogActivity).toBe(true);
    expect(caps.canViewActivities).toBe(true);

    const none = computeRecordCapabilities({
      slug: "account",
      permissions: new Set(),
      userId: USER,
      ownedBy: null,
    });
    expect(none.canLogActivity).toBe(false);
    expect(none.canViewActivities).toBe(false);
  });
});
