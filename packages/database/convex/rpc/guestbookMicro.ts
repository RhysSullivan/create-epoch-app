import {
	createMicroRpcFactory,
	makeMicroRpcModule,
	TaggedError,
	MicroMiddleware,
	MicroQueryCtx,
	MicroMutationCtx,
	v,
	Micro,
	Context,
} from "@packages/confect/rpc";

const VALID_ACCESS_KEY = process.env.PRIVATE_ACCESS_KEY ?? "test-key";

export const MicroValidationError = TaggedError("MicroValidationError", {
	message: v.string(),
});

export const MicroAuthenticationError = TaggedError(
	"MicroAuthenticationError",
	{
		message: v.string(),
	},
);

export class AuthenticatedUserMicro extends Context.Tag(
	"AuthenticatedUserMicro",
)<AuthenticatedUserMicro, { id: string; email: string }>() {}

const AuthMiddlewareMicro = MicroMiddleware.Tag("AuthMiddlewareMicro", {
	provides: AuthenticatedUserMicro,
	failure: {} as InstanceType<typeof MicroAuthenticationError>,
});

const factory = createMicroRpcFactory({
	baseArgs: {
		privateAccessKey: v.string(),
	},
	middlewares: [
		{
			tag: AuthMiddlewareMicro,
			impl: AuthMiddlewareMicro.of(({ payload }) => {
				const token = (payload as { privateAccessKey?: string })
					?.privateAccessKey;
				if (!token) {
					return Micro.fail(
						new MicroAuthenticationError({
							message: "Missing authentication token",
						}),
					);
				}
				if (token !== VALID_ACCESS_KEY) {
					return Micro.fail(
						new MicroAuthenticationError({ message: "Invalid access key" }),
					);
				}
				return Micro.succeed({ id: "system", email: "system@example.com" });
			}),
		},
	],
});

const getSomeSecretData = Micro.gen(function* () {
	const user = yield* Micro.service(AuthenticatedUserMicro);
	return `secret data for ${user.id}`;
});

export const guestbookMicroModule = makeMicroRpcModule({
	listMicro: factory.query({}, () =>
		Micro.gen(function* () {
			const ctx = yield* Micro.service(MicroQueryCtx);
			const entries = yield* Micro.promise(() =>
				ctx.db.query("guestbook").order("desc").take(50),
			);
			return entries.map((e) => ({
				_id: e._id as string,
				_creationTime: e._creationTime as number,
				name: e.name as string,
				message: e.message as string,
			}));
		}),
	),

	addMicro: factory.mutation(
		{
			name: v.string(),
			message: v.string(),
		},
		(args) =>
			Micro.gen(function* () {
				const ctx = yield* Micro.service(MicroMutationCtx);
				const name = args.name.trim().slice(0, 50);
				const message = args.message.trim().slice(0, 500);

				yield* getSomeSecretData;

				if (name.length === 0 || message.length === 0) {
					return yield* Micro.fail(
						new MicroValidationError({
							message: "Name and message are required",
						}),
					);
				}

				const id = yield* Micro.promise(() =>
					ctx.db.insert("guestbook", { name, message }),
				);
				return id as string;
			}),
	),

	listPaginatedMicro: factory.query(
		{
			cursor: v.union(v.string(), v.null()),
			numItems: v.number(),
		},
		(args) =>
			Micro.gen(function* () {
				const ctx = yield* Micro.service(MicroQueryCtx);
				const result = yield* Micro.promise(() =>
					ctx.db.query("guestbook").order("desc").paginate({
						cursor: args.cursor,
						numItems: args.numItems,
					}),
				);
				return {
					page: result.page.map((e) => ({
						_id: e._id as string,
						_creationTime: e._creationTime as number,
						name: e.name as string,
						message: e.message as string,
					})),
					isDone: result.isDone,
					continueCursor: result.continueCursor,
				};
			}),
	),
});

export const { listMicro, addMicro, listPaginatedMicro } =
	guestbookMicroModule.handlers;

export type GuestbookMicroEndpoints =
	typeof guestbookMicroModule._def.endpoints;
export type GuestbookMicroModule = typeof guestbookMicroModule;
