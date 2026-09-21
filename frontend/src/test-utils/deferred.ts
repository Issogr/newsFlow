import { act } from '@testing-library/react';

export const createDeferred = <T = void>() => Promise.withResolvers<T>();

export async function resolveDeferred<T>(deferred: PromiseWithResolvers<T>, value?: T) {
  await act(async () => {
    deferred.resolve(value as T);
    await deferred.promise;
  });
}
