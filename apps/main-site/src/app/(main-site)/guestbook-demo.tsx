"use client";

import { Result } from "@effect-atom/atom";
import { useAtom } from "@effect-atom/atom-react";
import {
	guestbookClient,
	useGuestbookSubscription,
} from "@packages/react/guestbook-rpc";
import { Button } from "@packages/ui/components/button";
import { Input } from "@packages/ui/components/input";
import { Cause, Exit } from "effect";
import { useState } from "react";

export function GuestbookDemo() {
	const result = useGuestbookSubscription();
	const [addResult, addEntry] = useAtom(guestbookClient.add.mutate, {
		mode: "promiseExit",
	});
	const [name, setName] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState<string | null>(null);

	const isSubmitting = Result.isWaiting(addResult);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !message.trim() || isSubmitting) return;

		setError(null);

		const exit = await addEntry({
			name: name.trim(),
			message: message.trim(),
		});

		if (Exit.isSuccess(exit)) {
			setName("");
			setMessage("");
		} else {
			setError(Cause.pretty(exit.cause));
		}
	};

	return (
		<div className="w-full max-w-md space-y-6">
			<div className="rounded-lg border bg-card p-6">
				<h2 className="mb-4 text-xl font-semibold">Guestbook</h2>
				<form onSubmit={handleSubmit} className="space-y-3">
					<Input
						placeholder="Your name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={50}
						disabled={isSubmitting}
					/>
					<Input
						placeholder="Leave a message..."
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						maxLength={500}
						disabled={isSubmitting}
					/>
					<Button
						type="submit"
						className="w-full"
						disabled={!name.trim() || !message.trim() || isSubmitting}
					>
						{isSubmitting ? "Signing..." : "Sign Guestbook"}
					</Button>
				</form>

				{error && (
					<div className="mt-3 rounded bg-destructive/10 p-3 text-sm text-destructive">
						Error: {error}
					</div>
				)}
			</div>

			<div className="rounded-lg border bg-card p-6">
				<h3 className="mb-4 font-medium">Messages</h3>

				{Result.builder(result)
					.onInitial(() => (
						<div className="flex items-center gap-2 text-muted-foreground">
							<div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
							Loading...
						</div>
					))
					.onFailure((cause) => (
						<div className="rounded bg-destructive/10 p-3 text-sm text-destructive">
							Error: {Cause.pretty(cause)}
						</div>
					))
					.onSuccess((entries) =>
						entries.length === 0 ? (
							<p className="text-muted-foreground">
								No messages yet. Be the first to sign!
							</p>
						) : (
							<ul className="space-y-3">
								{entries.map((entry) => (
									<li key={entry._id} className="rounded-md bg-muted/50 p-3">
										<p className="font-medium">{entry.name}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											{entry.message}
										</p>
									</li>
								))}
							</ul>
						),
					)
					.render()}
			</div>
		</div>
	);
}
