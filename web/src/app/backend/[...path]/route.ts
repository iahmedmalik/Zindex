import { forward } from "@/lib/proxy";

// Never cached, and long enough for a sleeping free server to wake.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = (req: Request) => forward(req, "/backend");
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD };
