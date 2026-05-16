import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { DevSyncError, syncCurrentUser } from "@/lib/dev-sync";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const record = await syncCurrentUser();
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof DevSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
