'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { ProgressPanel } from './ProgressPanel';

import { BriefSchema, type Brief } from '@/lib/studio/contracts';
import { Button } from '@/components/ui/button';

const FIELDS: Array<{
  key: keyof Brief;
  label: string;
  placeholder: string;
  required: boolean;
  rows: number;
}> = [
  {
    key: 'goal',
    label: 'Goal',
    placeholder:
      'What should this piece achieve? e.g. Convince engineering leaders to adopt trunk-based development.',
    required: true,
    rows: 3,
  },
  {
    key: 'audience',
    label: 'Audience',
    placeholder: 'Who is this for? e.g. Skeptical senior engineers at mid-size companies.',
    required: true,
    rows: 2,
  },
  {
    key: 'constraints',
    label: 'Constraints',
    placeholder: 'Length, format, things to avoid… e.g. Under 1200 words, no vendor pitches.',
    required: false,
    rows: 2,
  },
  {
    key: 'sourceNotes',
    label: 'Source notes',
    placeholder: 'Raw material: facts, quotes, links, half-formed ideas the draft should build on.',
    required: false,
    rows: 5,
  },
];

export function BriefForm({
  generating,
  onSubmit,
}: {
  generating: boolean;
  onSubmit: (brief: Brief) => void;
}) {
  const [values, setValues] = useState<Record<keyof Brief, string>>({
    goal: '',
    audience: '',
    constraints: '',
    sourceNotes: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  if (generating) {
    return (
      <div className="mx-auto max-w-2xl">
        <ProgressPanel
          message="Exploring 4 different ways to write this…"
          hint="Each pathway is a genuinely different strategy — thesis, structure, tone and tradeoffs. This usually takes 30-60 seconds."
        />
      </div>
    );
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = BriefSchema.safeParse(values);

    if (!parsed.success) {
      setValidationError('Please fill in at least the goal and the audience.');

      return;
    }

    setValidationError(null);
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Start with a brief</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe what you want to write. The studio will explore several distinct pathways before
          a single word of the draft is generated.
        </p>
      </div>

      <div className="space-y-5">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`brief-${field.key}`} className="mb-1.5 block text-sm font-medium">
              {field.label}
              {field.required ? (
                <span className="ml-1 text-destructive" aria-hidden>
                  *
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>
              )}
            </label>
            <textarea
              id={`brief-${field.key}`}
              rows={field.rows}
              value={values[field.key]}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        ))}
      </div>

      {validationError ? <p className="mt-3 text-sm text-destructive">{validationError}</p> : null}

      <div className="mt-6 flex justify-end">
        <Button type="submit">
          <Sparkles />
          Explore pathways
        </Button>
      </div>
    </form>
  );
}
