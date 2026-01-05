import * as Guestbook from "@packages/api/guestbook";
import { ValidationError } from "@packages/api/guestbook";
import { Effect } from "effect";

import { ConfectMutationCtx, ConfectQueryCtx } from "../confect";
import { rpcQuery, rpcMutation, AuthenticatedUser } from "./_factory";

export const list = rpcQuery(Guestbook.list, () =>
	Effect.gen(function* () {
		const user = yield* AuthenticatedUser;
		const ctx = yield* ConfectQueryCtx;
		const entries = yield* ctx.db.query("guestbook").order("desc").take(50);
		return entries.map((e) => ({
			_id: e._id,
			_creationTime: e._creationTime,
			name: e.name,
			message: e.message,
		}));
	}),
);

export const add = rpcMutation(Guestbook.add, (args) =>
	Effect.gen(function* () {
		const user = yield* AuthenticatedUser;
		const ctx = yield* ConfectMutationCtx;
		const name = args.name.trim().slice(0, 50);
		const message = args.message.trim().slice(0, 500);

		if (name.length === 0 || message.length === 0) {
			yield* new ValidationError({
				message: "Name and message are required",
			});
		}

		const id = yield* ctx.db
			.insert("guestbook", { name, message })
			.pipe(Effect.orDie);
		return id;
	}),
);
