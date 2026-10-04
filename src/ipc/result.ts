import type { AppError } from "./bindings";

/** A command failed in the core. `error.kind` says how; the message is safe to show. */
export class IpcError extends Error {
  override name = "IpcError";

  constructor(readonly error: AppError) {
    super(error.message);
  }
}

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Resolves with a command's data, or throws its error as an `IpcError`. */
export async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (settled.status === "error") {
    throw new IpcError(settled.error);
  }
  return settled.data;
}
