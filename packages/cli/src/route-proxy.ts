import { connect, createServer } from "node:net";
import { invariant } from "@micropc/core/errors.js";
import { numberFlag, parseArgs } from "./args.js";

export async function runRouteProxy(tokens: string[]): Promise<void> {
  const args = parseArgs(tokens);
  const listen = numberFlag(args, "listen");
  const target = numberFlag(args, "target");
  invariant(listen && target, "ROUTE_ARGUMENT_REQUIRED", "route-proxy requires --listen and --target");
  const server = createServer((incoming) => {
    const outgoing = connect(target, "127.0.0.1");
    incoming.pipe(outgoing).pipe(incoming);
    outgoing.on("error", () => incoming.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen, "127.0.0.1", resolve);
  });
}
