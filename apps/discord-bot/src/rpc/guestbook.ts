import { createRpcClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const guestbookClient = createRpcClient<GuestbookModule>(
	api.rpc.guestbook,
	{ url: CONVEX_URL },
);
