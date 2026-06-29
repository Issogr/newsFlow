import { act } from '@testing-library/react';

export function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

export async function resolveDeferred(deferred, value) {
  await act(async () => {
    deferred.resolve(value);
    await deferred.promise;
  });
}
