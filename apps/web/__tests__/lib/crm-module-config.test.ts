import { describe, expect, test } from "vitest";
import {
  readCrmModuleConfig,
  isCrmEntityEnabled,
  DEFAULT_CRM_MODULE_TOGGLES,
} from "@/lib/crm/module-config";

const settingsFor = (crm: Record<string, unknown>) => ({ modules: { crm } });
const togglesObj: Record<string, unknown> = { ...DEFAULT_CRM_MODULE_TOGGLES };

describe("readCrmModuleConfig — defaults", () => {
  test("absent key → media-first default profile", () => {
    for (const settings of [undefined, null, {}, { modules: {} }]) {
      const c = readCrmModuleConfig(settings);
      expect(c.leads).toBe(true);
      expect(c.campaigns).toBe(true);
      expect(c.opportunities).toBe(false);
      expect(c.convertTarget).toBe("campaign");
    }
  });

  test("default profile is exported and self-consistent", () => {
    const c = readCrmModuleConfig(settingsFor(togglesObj));
    expect(c.campaigns).toBe(true);
    expect(c.opportunities).toBe(false);
    expect(c.showPipeline).toBe(true);
    expect(c.effectiveConvertTarget).toBe("campaign");
  });
});

describe("readCrmModuleConfig — showPipeline/showDashboard", () => {
  test.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    "campaigns=%s opportunities=%s → showPipeline=%s",
    (campaigns, opportunities, expected) => {
      const c = readCrmModuleConfig(settingsFor({ campaigns, opportunities }));
      expect(c.showPipeline).toBe(expected);
      expect(c.showDashboard).toBe(expected);
    }
  );
});

describe("readCrmModuleConfig — effectiveConvertTarget", () => {
  test("both on → honours the admin convertTarget", () => {
    expect(
      readCrmModuleConfig(
        settingsFor({ campaigns: true, opportunities: true, convertTarget: "campaign" })
      ).effectiveConvertTarget
    ).toBe("campaign");
    expect(
      readCrmModuleConfig(
        settingsFor({ campaigns: true, opportunities: true, convertTarget: "opportunity" })
      ).effectiveConvertTarget
    ).toBe("opportunity");
  });

  test("exactly one on → forced to that entity (convertTarget ignored)", () => {
    expect(
      readCrmModuleConfig(
        settingsFor({ campaigns: true, opportunities: false, convertTarget: "opportunity" })
      ).effectiveConvertTarget
    ).toBe("campaign");
    expect(
      readCrmModuleConfig(
        settingsFor({ campaigns: false, opportunities: true, convertTarget: "campaign" })
      ).effectiveConvertTarget
    ).toBe("opportunity");
  });

  test("neither on → null (Account + Contact only)", () => {
    expect(
      readCrmModuleConfig(
        settingsFor({ campaigns: false, opportunities: false })
      ).effectiveConvertTarget
    ).toBeNull();
  });
});

describe("isCrmEntityEnabled", () => {
  test("account + contact always enabled regardless of toggles", () => {
    const c = readCrmModuleConfig(
      settingsFor({ leads: false, campaigns: false, opportunities: false })
    );
    expect(isCrmEntityEnabled(c, "account")).toBe(true);
    expect(isCrmEntityEnabled(c, "contact")).toBe(true);
  });

  test("lead/campaign/opportunity follow their toggles", () => {
    const c = readCrmModuleConfig(
      settingsFor({ leads: true, campaigns: true, opportunities: false })
    );
    expect(isCrmEntityEnabled(c, "lead")).toBe(true);
    expect(isCrmEntityEnabled(c, "campaign")).toBe(true);
    expect(isCrmEntityEnabled(c, "opportunity")).toBe(false);
    expect(isCrmEntityEnabled(c, "bogus")).toBe(false);
  });
});
