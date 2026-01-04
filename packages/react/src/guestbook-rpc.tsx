import { useAtomValue, useAtom } from "@effect-atom/atom-react";
import { GuestbookRpcs } from "@packages/api/guestbook";
import type { AuthPayload } from "@packages/api/shared";
import { RpcClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";

const guestbookClient = RpcClient.makeWithShared<
	typeof GuestbookRpcs,
	typeof api.rpc.guestbook,
	AuthPayload
>(
	GuestbookRpcs,
	api.rpc.guestbook,
	{ url: process.env.NEXT_PUBLIC_CONVEX_URL ?? "" },
	() => ({ privateAccessKey: process.env.PRIVATE_ACCESS_KEY ?? "" }),
);

export const useGuestbookList = () => useAtomValue(guestbookClient.list({}));

export const useGuestbookAdd = () => useAtom(guestbookClient.add);

export { guestbookClient };
