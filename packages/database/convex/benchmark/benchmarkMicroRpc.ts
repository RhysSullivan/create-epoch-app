import {
	createMicroRpcFactory,
	Micro,
	MicroMutationCtx,
	MicroQueryCtx,
	makeMicroRpcModule,
	v,
} from "@packages/confect/rpc/micro";

const microRpc = createMicroRpcFactory();

const guestbookModule = makeMicroRpcModule({
	list: microRpc.query(
		{
			_cacheKey: v.optional(v.string()),
		},
		(_args) =>
			Micro.gen(function* () {
				const ctx = yield* Micro.service(MicroQueryCtx);
				const entries = yield* Micro.promise(() =>
					ctx.db.query("guestbook").order("desc").take(10),
				);
				return entries.map((e) => ({
					_id: e._id as string,
					_creationTime: e._creationTime as number,
					name: e.name as string,
					message: e.message as string,
				}));
			}),
	),

	create: microRpc.mutation(
		{
			name: v.string(),
			message: v.string(),
		},
		(args) =>
			Micro.gen(function* () {
				const ctx = yield* Micro.service(MicroMutationCtx);
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);
				const id = yield* Micro.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id;
			}),
	),
});

export const list = guestbookModule.handlers.list;
export const create = guestbookModule.handlers.create;
