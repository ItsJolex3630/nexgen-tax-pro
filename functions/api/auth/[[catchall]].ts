import { createAuth } from "../../auth";
import type { Env } from "../../db";

export const onRequest = async (context: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}) => {
  const auth = createAuth(context.env, context.request, context.waitUntil);
  return auth.handler(context.request);
};
