import { z } from 'zod';

/**
 * Model gateway for the demo studio slice. All Anthropic calls go through
 * here — no provider SDK imports anywhere else (server-only module; never
 * import from client components).
 */

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';

export function getModelId(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------
export type GatewayErrorKind = 'config' | 'api' | 'parse' | 'validation';

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;

  constructor(kind: GatewayErrorKind, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.kind = kind;
  }
}

export class GatewayConfigError extends GatewayError {
  constructor(message: string) {
    super('config', message);
    this.name = 'GatewayConfigError';
  }
}

export class GatewayApiError extends GatewayError {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super('api', message);
    this.name = 'GatewayApiError';
    this.status = status;
    this.body = body;
  }
}

export class GatewayParseError extends GatewayError {
  readonly raw: string;

  constructor(message: string, raw = '') {
    super('parse', message);
    this.name = 'GatewayParseError';
    this.raw = raw;
  }
}

export class GatewayValidationError extends GatewayError {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super('validation', message);
    this.name = 'GatewayValidationError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Raw call
// ---------------------------------------------------------------------------
export interface CallClaudeOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
}

/** Calls the Anthropic Messages API and returns concatenated text output. */
export async function callClaude({
  system,
  user,
  maxTokens = 4096,
}: CallClaudeOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new GatewayConfigError('ANTHROPIC_API_KEY is not configured on the server');
  }

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: getModelId(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');

    throw new GatewayApiError(
      `Anthropic API returned ${res.status}`,
      res.status,
      body.slice(0, 2000),
    );
  }

  const data = (await res.json()) as AnthropicMessageResponse;
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new GatewayParseError('Model response contained no text content');
  }

  return text;
}

// ---------------------------------------------------------------------------
// JSON parsing + schema-validated call with one retry
// ---------------------------------------------------------------------------

/** Parses model output as JSON, stripping markdown code fences if present. */
export function parseJson(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);

  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: grab the outermost object literal in case the model wrapped
    // the JSON in prose.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // fall through to the typed error below
      }
    }

    throw new GatewayParseError('Model output was not valid JSON', cleaned.slice(0, 500));
  }
}

/**
 * Calls Claude and validates the JSON output against `schema`. On parse or
 * validation failure, retries ONCE with the errors appended to the prompt.
 */
export async function callClaudeJson<S extends z.ZodTypeAny>(
  schema: S,
  { system, user, maxTokens }: CallClaudeOptions,
): Promise<z.infer<S>> {
  const attempt = async (userPrompt: string) => {
    const text = await callClaude({ system, user: userPrompt, maxTokens });
    const json = parseJson(text);

    return schema.safeParse(json);
  };

  let failureSummary: string;

  try {
    const first = await attempt(user);

    if (first.success) {
      return first.data;
    }

    failureSummary = JSON.stringify(first.error.issues, null, 2);
  } catch (err) {
    if (err instanceof GatewayParseError) {
      failureSummary = `Output was not parseable JSON: ${err.message}`;
    } else {
      throw err;
    }
  }

  const retryUser = [
    user,
    '',
    'Your previous response failed validation with these errors:',
    failureSummary,
    '',
    'Respond again with ONLY corrected, pure JSON that satisfies the required shape. No prose, no markdown fences.',
  ].join('\n');

  const second = await attempt(retryUser);

  if (second.success) {
    return second.data;
  }

  throw new GatewayValidationError(
    'Model output failed schema validation after one retry',
    second.error.issues,
  );
}

// ---------------------------------------------------------------------------
// Streaming text output (for low-latency, live-rendered regeneration)
// ---------------------------------------------------------------------------

/**
 * Calls the Anthropic Messages API with streaming enabled and returns a
 * ReadableStream of the plain text deltas (no JSON envelope). The caller is
 * responsible for treating the text as untrusted (render via textContent).
 */
export async function callClaudeTextStream({
  system,
  user,
  maxTokens = 1200,
}: CallClaudeOptions): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new GatewayConfigError('ANTHROPIC_API_KEY is not configured on the server');
  }

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: getModelId(),
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok || !res.body) {
    const bodyText = await res.text().catch(() => '');

    throw new GatewayApiError(
      `Anthropic API returned ${res.status}`,
      res.status,
      bodyText.slice(0, 2000),
    );
  }

  const upstream = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const emitFromLine = (line: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();

    if (!trimmed.startsWith('data:')) return;

    const payload = trimmed.slice(5).trim();

    if (!payload || payload === '[DONE]') return;

    try {
      const event = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };

      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        event.delta.text
      ) {
        controller.enqueue(encoder.encode(event.delta.text));
      }
    } catch {
      // ignore keep-alive / non-JSON lines
    }
  };

  // start()-based pump: loops the whole upstream and ALWAYS closes at the end,
  // avoiding the pull-based close-propagation hang.
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await upstream.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          buffer = lines.pop() ?? '';

          for (const line of lines) emitFromLine(line, controller);
        }

        // flush any trailing buffered line
        if (buffer.trim()) emitFromLine(buffer, controller);
      } catch (err) {
        controller.error(err);

        return;
      }

      controller.close();
    },
    cancel() {
      upstream.cancel().catch(() => {});
    },
  });
}
