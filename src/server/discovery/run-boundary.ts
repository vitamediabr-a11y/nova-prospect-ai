export type DiscoveryRunFailure = {
  code: "DISCOVERY_UNEXPECTED_ERROR";
  message: string;
};

export async function executeDiscoveryRunBoundary<T>(input: {
  execute: () => Promise<T>;
  markFailed: (failure: DiscoveryRunFailure) => Promise<void>;
}): Promise<{ ok: true; value: T } | { ok: false; failure: DiscoveryRunFailure }> {
  try {
    return { ok: true, value: await input.execute() };
  } catch {
    const failure: DiscoveryRunFailure = {
      code: "DISCOVERY_UNEXPECTED_ERROR",
      message: "A execução da busca foi interrompida por um erro interno.",
    };
    try {
      await input.markFailed(failure);
    } catch {
      // Best effort only. A killed runtime may not be able to persist the transition.
    }
    return { ok: false, failure };
  }
}
