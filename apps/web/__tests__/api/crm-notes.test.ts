import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import {
  GET as listNotes,
  POST as addNote,
  PATCH as editNote,
  DELETE as deleteNote,
} from "@/app/api/crm/[entityType]/[id]/notes/route";

let A: CrmTestSetup;
let B: CrmTestSetup;

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

const owner = (t: CrmTestSetup) =>
  authMock.mockResolvedValue({ userId: t.owner.authProviderId, orgId: t.clerkOrgId });
const member = (t: CrmTestSetup) =>
  authMock.mockResolvedValue({ userId: t.member.authProviderId, orgId: t.clerkOrgId });

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const notesParams = (id: string) =>
  ({ params: Promise.resolve({ entityType: "accounts", id }) });

async function makeAccount(t: CrmTestSetup, name: string): Promise<string> {
  owner(t);
  const res = await createRecord(jsonReq({ data: { name, status: "Active" } }), {
    params: Promise.resolve({ entityType: "accounts" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

describe("Record notes & attachments API", () => {
  test("add note + link + attachment, list newest-first, edit, delete", async () => {
    const acc = await makeAccount(A, "Notes Co");
    owner(A);

    // Note
    let res = await addNote(
      jsonReq({ type: "note", name: "Kickoff", body: "Met the team" }),
      notesParams(acc)
    );
    expect(res.status).toBe(200);
    // Link
    res = await addNote(
      jsonReq({ type: "link", name: "Brief", url: "https://example.com/brief" }),
      notesParams(acc)
    );
    expect(res.status).toBe(200);
    // Attachment (data URL)
    res = await addNote(
      jsonReq({
        type: "attachment",
        name: "Logo",
        url: "data:image/png;base64,AAAA",
        fileName: "logo.png",
        fileSize: 1234,
      }),
      notesParams(acc)
    );
    expect(res.status).toBe(200);
    const after = (await res.json()).items as { id: string; type: string; addedByName: string }[];
    expect(after).toHaveLength(3);
    expect(after.every((i) => typeof i.addedByName === "string")).toBe(true);

    // List (GET) returns all three.
    const listRes = await listNotes(new NextRequest("http://localhost"), notesParams(acc));
    expect(listRes.status).toBe(200);
    const items = (await listRes.json()).items as { id: string; type: string; name: string }[];
    expect(items.map((i) => i.type).sort()).toEqual(["attachment", "link", "note"]);

    // Edit the note's body.
    const noteId = items.find((i) => i.type === "note")!.id;
    const editRes = await editNote(
      jsonReq({ id: noteId, name: "Kickoff call", body: "Updated" }),
      notesParams(acc)
    );
    expect(editRes.status).toBe(200);
    const edited = (await editRes.json()).items as { id: string; name: string; body?: string }[];
    expect(edited.find((i) => i.id === noteId)?.name).toBe("Kickoff call");

    // Delete the link.
    const linkId = items.find((i) => i.type === "link")!.id;
    const delReq = new NextRequest(`http://localhost?id=${linkId}`, { method: "DELETE" });
    const delRes = await deleteNote(delReq, notesParams(acc));
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()).items as unknown[]).length).toBe(2);
  });

  test("rejects an invalid link URL (422) and an oversized attachment (413)", async () => {
    const acc = await makeAccount(A, "Validation Co");
    owner(A);
    const bad = await addNote(
      jsonReq({ type: "link", name: "Bad", url: "not-a-url" }),
      notesParams(acc)
    );
    expect(bad.status).toBe(422);
    const huge = await addNote(
      jsonReq({ type: "attachment", name: "Big", url: "data:image/png;base64," + "A".repeat(800_000) }),
      notesParams(acc)
    );
    expect(huge.status).toBe(413);
  });

  test("a member (no account.update, not owner) cannot add notes (403)", async () => {
    const acc = await makeAccount(A, "Locked Co");
    member(A);
    const res = await addNote(jsonReq({ type: "note", name: "Nope" }), notesParams(acc));
    expect(res.status).toBe(403);
  });

  test("tenant B cannot read tenant A's record notes (404)", async () => {
    const acc = await makeAccount(A, "Private Co");
    owner(A);
    await addNote(jsonReq({ type: "note", name: "Secret" }), notesParams(acc));
    member(B); // any B user
    owner(B);
    const res = await listNotes(new NextRequest("http://localhost"), notesParams(acc));
    expect(res.status).toBe(404);
  });
});
