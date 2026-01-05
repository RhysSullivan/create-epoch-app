import { GuestbookRpcs, ValidationError } from "@packages/api/guestbook";
import { toModuleQuery, toModuleMutation } from "@packages/confect/convex";
import { Effect } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import * as GuestbookApi from "@packages/api/guestbook";

export const list = toModuleQuery(confectSchema, GuestbookApi.list, () =>
	Effect.gen(function* () {
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

export const add = toModuleMutation(confectSchema, GuestbookApi.add, (args) =>
	Effect.gen(function* () {
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
