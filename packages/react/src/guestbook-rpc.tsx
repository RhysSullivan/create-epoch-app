import { GuestbookRpcs } from "@packages/api/guestbook";
import type { AuthPayload } from "@packages/api/shared";
import { RpcClient, useQuery, useMutation } from "@packages/confect/rpc";
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

export const useGuestbookList = () => useQuery(guestbookClient.list({}));

export const useGuestbookAdd = () => useMutation(guestbookClient.add);

export { guestbookClient };
