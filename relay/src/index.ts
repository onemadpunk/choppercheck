import { handle, type Env } from './relay';

declare const caches: { default: { match(key: string): Promise<Response | undefined>; put(key: string, r: Response): Promise<void> } };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { fetch: (input, init) => fetch(input, init), cache: caches.default });
  },
};
