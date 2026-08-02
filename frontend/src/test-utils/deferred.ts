import { act } from '@testing-library/react';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

export async function resolveDeferred<T>(deferred: Deferred<T>, value?: T) {
  await act(async () => {
    deferred.resolve(value as T);
    await deferred.promise;
  });
}
