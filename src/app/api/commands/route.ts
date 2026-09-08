import { getPrincipal } from "@/server/auth";
import { transact } from "@/server/store";
import { executeCommand } from "@/server/commands";
import { DomainError } from "@/server/domain";
import { errorResponse, sameOrigin } from "@/server/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const text = await request.text();
    if (text.length > 1_000_000)
      throw new DomainError(413, "Request is too large");
    let command;
    try {
      command = JSON.parse(text);
    } catch {
      throw new DomainError(422, "Request must be valid JSON.");
    }
    if (!command || typeof command.type !== "string")
      throw new DomainError(422, "Operation type is required.");
    const actor = await getPrincipal(request);
    const result = await transact((state) => {
      const currentActor = state.users.find((user) => user.id === actor.id);
      if (!currentActor?.active)
        throw new DomainError(
          403,
          "Your account is inactive or no longer provisioned.",
        );
      return executeCommand(state, currentActor, command);
    });
    return Response.json({ result });
  } catch (e) {
    return errorResponse(e);
  }
}
