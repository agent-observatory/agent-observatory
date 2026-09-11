import type { AtlasEvent } from "@agent-observatory/contracts";

// Evidence selection is deterministic. A match is a retrieval hint, not a finding.
export function selectEvidence(events: AtlasEvent[]) {
  const observations = events.filter((e) => e.kind !== "usage");
  const selected = new Set<number>();
  const choose = (indices: number[], count: number) => {
    for (let n = 0; n < Math.min(count, indices.length); n++) {
      selected.add(
        indices[
          Math.floor(
            (n * (indices.length - 1)) /
              Math.max(1, Math.min(count, indices.length) - 1),
          )
        ],
      );
    }
  };
  const indices = observations.map((_, i) => i);
  choose(
    indices.filter(
      (i) =>
        observations[i].subject_model ||
        observations[i].observations?.length ||
        observations[i].toolOutcome,
    ),
    8,
  );
  choose(
    indices.filter((i) => observations[i].kind === "user"),
    14,
  );
  choose(
    indices.filter(
      (i) =>
        observations[i].kind === "tool_call" &&
        /SKILL\.md|skills\/|skill:\/\//i.test(observations[i].text || ""),
    ),
    6,
  );
  choose(
    indices.filter(
      (i) =>
        observations[i].kind === "tool_result" &&
        /\b(error|failed|exception)\b|오류|실패/i.test(
          observations[i].text || "",
        ),
    ),
    4,
  );
  // Include paired tool call/results before filling the remaining timeline coverage.
  const callIndex = new Map<string, number[]>();
  for (const i of indices) {
    const id = observations[i].callId;
    if (id) callIndex.set(id, [...(callIndex.get(id) || []), i]);
  }
  for (const i of [...selected]) {
    const e = observations[i];
    if (e.callId)
      for (const j of (callIndex.get(e.callId) || []).slice(0, 2))
        selected.add(j);
    if (e.kind === "user" && i + 1 < observations.length) selected.add(i + 1);
  }
  choose(indices, 10);
  const ordered = [...selected].sort((a, b) => a - b);
  // Keep both ends of the selected session range even at the sample cap.
  const picked =
    ordered.length <= 64
      ? ordered
      : Array.from(
          { length: 64 },
          (_, i) => ordered[Math.floor((i * (ordered.length - 1)) / 63)],
        );
  let remaining = 32_000;
  const samples = picked.map((i) => {
    const e = observations[i];
    const original = e.text || "";
    const size = Math.min(
      1000,
      Math.floor(remaining / (picked.length - picked.indexOf(i))),
    );
    const text = excerpt(original, size);
    remaining -= text.length;
    return {
      id: e.id,
      kind: e.kind,
      timestamp: e.timestamp,
      name: e.name,
      callId: e.callId,
      images: e.images,
      subject_model: e.subject_model,
      observations: e.observations,
      toolOutcome: e.toolOutcome,
      text,
      originalCharacters: original.length,
      truncated: text !== original,
    };
  });
  return {
    samples,
    aiInput: {
      strategy: "actionable-evidence-v2",
      events: observations.length,
      samples: samples.length,
      maxCharactersPerSample: 1000,
      characters: 32_000 - remaining,
      truncatedSamples: samples.filter((s) => s.truncated).length,
      totalCharacters: observations.reduce(
        (n, e) => n + (e.text?.length || 0),
        0,
      ),
    },
  };
}
export function excerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  const marker = "\n[…중간 생략 / omitted…]\n";
  const room = Math.max(0, limit - marker.length);
  const head = Math.ceil(room * 0.7);
  return (
    text.slice(0, head) +
    marker.slice(0, limit - room) +
    text.slice(text.length - (room - head))
  );
}
