import * as Context from "effect/Context";

export type FunctionType = "query" | "mutation" | "action";

export const ConvexFunctionType = Context.GenericTag<FunctionType>(
	"@confect/ConvexFunctionType",
);

export type ConvexFunctionType = FunctionType;
