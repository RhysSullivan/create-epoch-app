"use client";

import { Result, useAtom } from "@effect-atom/atom-react";
import { Option } from "effect";
import { Button } from "@packages/ui/components/button";
import { guestbookClient } from "@packages/ui/rpc/guestbook";

const PAGE_SIZE = 3;

const paginatedAtom = guestbookClient.listPaginated.paginated(PAGE_SIZE);

type Entry = {
	_id: string;
	_creationTime: number;
	name: string;
	message: string;
};

export function PaginationDemo() {
	const [pullResult, loadMore] = useAtom(paginatedAtom);

	const items: readonly Entry[] = Result.isSuccess(pullResult)
		? Option.map(Result.value(pullResult), (v) => v.items).pipe(
				Option.getOrElse(() => [] as const),
			)
		: [];

	const done = Result.isSuccess(pullResult)
		? Option.map(Result.value(pullResult), (v) => v.done).pipe(
				Option.getOrElse(() => true),
			)
		: true;

	const isLoading = Result.isWaiting(pullResult);
	const isInitial = Result.isInitial(pullResult);
	const hasMore = !done;

	return (
		<div className="w-full max-w-md rounded-lg border p-6">
			<h2 className="mb-4 text-xl font-semibold">Pagination Demo</h2>
			<p className="text-muted-foreground mb-4 text-sm">
				Infinite scroll pagination using Effect atoms. Click &quot;Load
				More&quot; to fetch the next page.
			</p>

			{isInitial ? (
				<div className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Click the button to start loading entries...
					</p>
					<Button onClick={() => loadMore()} className="w-full">
						Start Loading
					</Button>
				</div>
			) : Result.isFailure(pullResult) ? (
				<p className="text-sm text-red-500">Error loading entries</p>
			) : (
				<div className="space-y-4">
					{items.length === 0 && !isLoading ? (
						<p className="text-muted-foreground text-sm">
							No entries yet. Add some in the guestbook above!
						</p>
					) : (
						<ul className="space-y-3">
							{items.map((entry) => (
								<li key={entry._id} className="border-b pb-2 last:border-b-0">
									<p className="font-medium">{entry.name}</p>
									<p className="text-muted-foreground text-sm">
										{entry.message}
									</p>
								</li>
							))}
						</ul>
					)}

					{hasMore && (
						<Button
							onClick={() => loadMore()}
							disabled={isLoading}
							variant="outline"
							className="w-full"
						>
							{isLoading ? "Loading..." : "Load More"}
						</Button>
					)}

					{!hasMore && items.length > 0 && (
						<p className="text-muted-foreground text-center text-sm">
							No more entries
						</p>
					)}

					<p className="text-muted-foreground text-xs">
						Showing {items.length} entries (page size: {PAGE_SIZE})
					</p>
				</div>
			)}
		</div>
	);
}
