import { useAtom, useAtomValue } from "@effect-atom/atom-react";
import { RpcModuleClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookEndpoints } from "@packages/database/convex/rpc/guestbook";

const CONVEX_URL =
	typeof process !== "undefined"
		? (process.env.NEXT_PUBLIC_CONVEX_URL ?? "")
		: "";
const PRIVATE_ACCESS_KEY =
	typeof process !== "undefined"
		? (process.env.PRIVATE_ACCESS_KEY ?? "test-key")
		: "test-key";

type SharedPayload = { privateAccessKey: string };

const client = RpcModuleClient.makeClientWithShared<
	GuestbookEndpoints,
	SharedPayload
>(api.rpc.guestbook, { url: CONVEX_URL }, () => ({
	privateAccessKey: PRIVATE_ACCESS_KEY,
}));

export const useGuestbookList = () => useAtomValue(client.list.query({}));

export const useGuestbookSubscription = () =>
	useAtomValue(client.list.subscription({}));

export const useGuestbookAdd = () => useAtom(client.add.mutate);

export { client as guestbookClient };
