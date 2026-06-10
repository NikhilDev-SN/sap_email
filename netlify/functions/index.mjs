import serverless from "serverless-http";
import { handleRequest } from "../../src/index.mjs";

export const handler = serverless(handleRequest);
