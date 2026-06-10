import { handleRequest } from "../src/index.mjs";

export default async function handler(request, response) {
  return handleRequest(request, response);
}
