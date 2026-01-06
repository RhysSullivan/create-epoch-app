import { Result } from "@effect-atom/atom";
import { RpcModuleClient } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookEndpoints } from "@packages/database/convex/rpc/guestbook";
import {
	ActionRow,
	Button,
	Container,
	TextDisplay,
	useAtomSet,
	useAtomValue,
} from "@packages/reacord";
import { Cause } from "effect";
import { useState } from "react";

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
	throw new Error(
		"CONVEX_URL or NEXT_PUBLIC_CONVEX_URL environment variable is required",
	);
}
const PRIVATE_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "test-key";

type SharedPayload = { privateAccessKey: string };

const guestbookClient = RpcModuleClient.makeClientWithShared<
	GuestbookEndpoints,
	SharedPayload
>(api.rpc.guestbook, { url: CONVEX_URL }, () => ({
	privateAccessKey: PRIVATE_ACCESS_KEY,
}));

const listAtom = guestbookClient.list.subscription({});

export function GuestbookCommand() {
	const result = useAtomValue(listAtom);
	const addEntry = useAtomSet(guestbookClient.add.mutate);
	const [isAdding, setIsAdding] = useState(false);

	const handleAdd = async () => {
		setIsAdding(true);
		try {
			await addEntry({
				name: "Discord User",
				message: `Signed from Discord at ${new Date().toLocaleString()}`,
			});
		} finally {
			setIsAdding(false);
		}
	};

	if (Result.isInitial(result)) {
		return (
			<Container>
				<TextDisplay>Loading guestbook...</TextDisplay>
			</Container>
		);
	}

	if (Result.isFailure(result)) {
		return (
			<Container>
				<TextDisplay>Error: {Cause.pretty(result.cause)}</TextDisplay>
			</Container>
		);
	}

	const entries = result.value;

	return (
		<Container>
			<TextDisplay>
				**Guestbook** ({entries.length} messages)
				{"\n\n"}
				{entries.length === 0
					? "_No messages yet. Be the first to sign!_"
					: entries
							.slice(0, 5)
							.map((e) => `**${e.name}**: ${e.message}`)
							.join("\n")}
				{entries.length > 5 && `\n\n_...and ${entries.length - 5} more_`}
			</TextDisplay>
			<ActionRow>
				<Button
					style="primary"
					disabled={isAdding}
					label={isAdding ? "Signing..." : "Sign Guestbook"}
					onClick={handleAdd}
				/>
			</ActionRow>
		</Container>
	);
}
