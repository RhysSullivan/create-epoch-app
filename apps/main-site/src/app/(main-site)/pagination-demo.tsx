"use client";

import { Result } from "@effect-atom/atom";
import { usePaginatedGuestbook } from "@packages/react/guestbook-rpc";
import { Button } from "@packages/ui/components/button";
import { Cause } from "effect";

export function PaginationDemo() {
	const [result, loadMore] = usePaginatedGuestbook();

	return (
		<div className="w-full max-w-md space-y-6">
			<div className="rounded-lg border bg-card p-6">
				<h2 className="mb-4 text-xl font-semibold">
					Paginated Guestbook (Effect Atom + Convex)
				</h2>

				{Result.isInitial(result) && (
					<div className="flex items-center gap-2 text-muted-foreground">
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
						Loading first page...
					</div>
				)}

				{Result.isFailure(result) && (
					<div className="rounded bg-destructive/10 p-3 text-sm text-destructive">
						Error: {Cause.pretty(result.cause)}
					</div>
				)}

				{Result.isSuccess(result) && (
					<>
						<div className="mb-4 text-sm text-muted-foreground">
							Loaded {result.value.items.length} entries
							{result.value.done && " (all loaded)"}
						</div>

						{result.value.items.length === 0 ? (
							<p className="text-muted-foreground">
								No messages yet. Add some via the guestbook above!
							</p>
						) : (
							<ul className="space-y-3">
								{result.value.items.map((entry) => (
									<li key={entry._id} className="rounded-md bg-muted/50 p-3">
										<p className="font-medium">{entry.name}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											{entry.message}
										</p>
										<p className="mt-1 text-xs text-muted-foreground/60">
											{new Date(entry._creationTime).toLocaleString()}
										</p>
									</li>
								))}
							</ul>
						)}

						{!result.value.done && (
							<Button
								onClick={() => loadMore()}
								className="mt-4 w-full"
								disabled={Result.isWaiting(result)}
							>
								{Result.isWaiting(result) ? (
									<>
										<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
										Loading more...
									</>
								) : (
									"Load More"
								)}
							</Button>
						)}

						{result.value.done && result.value.items.length > 0 && (
							<p className="mt-4 text-center text-sm text-muted-foreground">
								All entries loaded
							</p>
						)}
					</>
				)}
			</div>

			<div className="rounded-lg border bg-muted/30 p-4 text-sm">
				<h3 className="font-medium">How it works:</h3>
				<ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
					<li>
						Uses <code className="text-foreground">Atom.pull</code> with Effect
						Streams
					</li>
					<li>
						<code className="text-foreground">Stream.paginateChunkEffect</code>{" "}
						fetches pages on demand
					</li>
					<li>Items accumulate automatically between pulls</li>
					<li>Cursor-based pagination from Convex</li>
				</ul>
			</div>
		</div>
	);
}
