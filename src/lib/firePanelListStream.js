import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { LIST_COMMAND_TIMEOUT_MS } from "@/lib/firePanelMonitor";

/**
 * Stream a panel list command (list f/t/s) and receive partial telnet output as it arrives.
 * Falls back to the regular command endpoint when streaming is unavailable.
 *
 * Pass expectedCount (from totalFire / totalTrouble / totalSupervisory) so the
 * worker keeps waiting until that many list messages arrive.
 */
export async function streamFirePanelListCommand(
  command,
  timeoutMs = LIST_COMMAND_TIMEOUT_MS,
  onChunk,
  options = {},
) {
  const expectedCount = Number.isFinite(options.expectedCount)
    ? Number(options.expectedCount)
    : undefined;

  try {
    const res = await apiFetch("/api/telnet/fire-panel/command/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeoutMs, expectedCount }),
    });

    if (res.status === 404) {
      return await fetchFirePanelListCommandOnce(
        command,
        timeoutMs,
        onChunk,
        expectedCount,
      );
    }

    if (!res.ok) {
      const data = await parseApiJsonResponse(res);
      throw new Error(data?.error || "Stream command failed");
    }

    if (!res.body) {
      return await fetchFirePanelListCommandOnce(
        command,
        timeoutMs,
        onChunk,
        expectedCount,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const payload = JSON.parse(trimmed);
        if (payload.error) {
          throw new Error(payload.error);
        }

        finalResponse = String(payload.response || "");
        onChunk?.(finalResponse, Boolean(payload.done));
      }
    }

    if (buffer.trim()) {
      const payload = JSON.parse(buffer.trim());
      if (payload.error) throw new Error(payload.error);
      finalResponse = String(payload.response || "");
      onChunk?.(finalResponse, true);
    }

    return finalResponse;
  } catch (error) {
    if (/streaming not supported|failed to fetch|404/i.test(error?.message || "")) {
      return await fetchFirePanelListCommandOnce(
        command,
        timeoutMs,
        onChunk,
        expectedCount,
      );
    }
    throw error;
  }
}

async function fetchFirePanelListCommandOnce(
  command,
  timeoutMs,
  onChunk,
  expectedCount,
) {
  const res = await apiFetch("/api/telnet/fire-panel/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, timeoutMs, expectedCount }),
  });
  const data = await parseApiJsonResponse(res);
  if (!res.ok) {
    throw new Error(data?.error || "Command failed");
  }

  const response = String(data.response || "");
  onChunk?.(response, true);
  return response;
}
