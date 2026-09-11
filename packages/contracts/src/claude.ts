import { type AtlasEvent, type ObservableReference } from "./index.js";
import { sanitizeEventImages } from "./images.js";

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function imageText(value: unknown) {
  const image = object(value);
  const source = object(image?.source);
  if (image?.type !== "image" || source?.type !== "base64") return null;
  if (
    typeof source.media_type !== "string" ||
    !/^image\/[a-z0-9.+-]+$/i.test(source.media_type) ||
    typeof source.data !== "string"
  )
    return "[image:invalid omitted: local-only]";
  // This is only an in-memory bridge to the shared metadata sanitizer. It
  // deliberately accepts no URL source and never performs a network fetch.
  return `data:${source.media_type};base64,${source.data}`;
}

function blockText(value: unknown) {
  const block = object(value);
  if (block?.type === "text" && typeof block.text === "string")
    return block.text;
  return imageText(block);
}

function text(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(blockText).filter(Boolean).join("\n");
  return "";
}

function skillObservation(
  name: unknown,
  input: unknown,
): ObservableReference[] | undefined {
  // Claude's explicit Skill tool call is an invocation record. A textual
  // mention, a generic file read, or an arbitrary input path is not one.
  const skill = object(input)?.skill;
  if (
    name !== "Skill" ||
    typeof skill !== "string" ||
    !/^[A-Za-z0-9._:-]{1,300}$/.test(skill)
  )
    return undefined;
  return [{ kind: "skill", evidence: "invoked", id: skill }];
}

function observedModel(record: RecordValue, message: RecordValue) {
  const model = typeof message.model === "string" ? message.model : undefined;
  const reasoning =
    typeof record.effort === "string" ? record.effort : undefined;
  return model || reasoning
    ? {
        harness: "claude-code" as const,
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
      }
    : undefined;
}

function identified(id: string, events: Omit<AtlasEvent, "id">[]) {
  return events.map((event, index) => ({
    ...event,
    id: events.length === 1 ? id : `${id}:${index}`,
  }));
}

// Accept only record shapes observed in Claude Code JSONL. Thinking blocks and
// unknown records are deliberately excluded rather than guessed.
export function claudeCodeEvents(record: unknown, id: string): AtlasEvent[] {
  const r = object(record);
  if (!r) return [];
  const base = { timestamp: timestamp(r.timestamp) };
  const message = object(r.message);

  if (r.type === "assistant" && message) {
    const content = message.content;
    if (Array.isArray(content)) {
      const model = observedModel(r, message);
      const events: Omit<AtlasEvent, "id">[] = [];
      for (const value of content) {
        const item = object(value);
        if (!item) continue;
        if (item.type === "text" && typeof item.text === "string") {
          events.push({
            ...base,
            kind: "assistant",
            text: item.text,
            ...(model ? { subject_model: model } : {}),
          });
        }
        if (item.type === "tool_use") {
          const input = item.input;
          const observations = skillObservation(item.name, input);
          events.push({
            ...base,
            kind: "tool_call",
            name: typeof item.name === "string" ? item.name : "unknown",
            ...(typeof item.id === "string" ? { callId: item.id } : {}),
            text:
              typeof input === "string" ? input : JSON.stringify(input ?? {}),
            ...(observations ? { observations } : {}),
            ...(model ? { subject_model: model } : {}),
          });
        }
      }
      return identified(id, events);
    }
    const value = text(content);
    const model = observedModel(r, message);
    return value
      ? identified(id, [
          {
            ...base,
            kind: "assistant",
            text: value,
            ...(model ? { subject_model: model } : {}),
          },
        ])
      : [];
  }

  if (r.type !== "user" || !message) return [];
  const content = message.content;
  if (typeof content === "string")
    return identified(id, [{ ...base, kind: "user", text: content }]);
  if (!Array.isArray(content)) return [];
  const events: Omit<AtlasEvent, "id">[] = [];
  for (const value of content) {
    const item = object(value);
    if (!item) continue;
    if (item.type === "text" && typeof item.text === "string")
      events.push({ ...base, kind: "user", text: item.text });
    if (item.type === "image") {
      const value = imageText(item);
      if (value) events.push({ ...base, kind: "user", text: value });
    }
    if (item.type === "tool_result") {
      events.push({
        ...base,
        kind: "tool_result",
        ...(typeof item.tool_use_id === "string"
          ? { callId: item.tool_use_id }
          : {}),
        text: text(item.content),
        toolOutcome:
          typeof item.is_error === "boolean"
            ? { status: item.is_error ? "failed" : "succeeded" }
            : { status: "unknown" },
      });
    }
  }
  return identified(id, events);
}

export function claudeCodeEvent(
  record: unknown,
  id: string,
): AtlasEvent | null {
  return claudeCodeEvents(record, id)[0] || null;
}

export async function claudeCodeEventsWithImages(record: unknown, id: string) {
  return Promise.all(
    claudeCodeEvents(record, id).map((event) => sanitizeEventImages(event)),
  );
}

export async function claudeCodeEventWithImages(record: unknown, id: string) {
  const [event] = await claudeCodeEventsWithImages(record, id);
  return event || null;
}
