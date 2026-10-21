import { createAuth } from "../../auth";
import type { Env } from "../../db";

export const onRequest = async (context: { request: Request; env: Env }) => {
  const auth = createAuth(context.env);
  return auth.handler(context.request);
};
