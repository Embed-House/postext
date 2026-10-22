'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { Resource, ScoreFormat } from 'postext';
import { scoreFormatOfFile } from 'postext';
import { useSandboxLabels, useSandboxSelector } from '../../context/SandboxContext.js';
import { FieldRow } from '../../controls/FieldRow.js';
import { Button } from '../../ui/index.js';

const inputClass = 'min-w-0 flex-1 rounded border bg-transparent px-2 py-1.5';
const inputStyle = { borderColor: 'var(--pt-control-border)', color: 'var(--foreground)', fontSize: 13, lineHeight: '20px' } as const;
const FORMATS: ScoreFormat[] = ['abc', 'musicxml', 'mei', 'humdrum'];
const FILE_ACCEPT = '.abc,.musicxml,.mei,.krn';

interface ScoreEditorProps {
  resource: Resource;
  onChange: (partial: Partial<Resource>) => void;
}

/** A score resource's notation (#1172): its format, the named score style
 *  it is set in, and the notation itself, typed or read from a file. The
 *  text is committed when the field loses focus (or on Ctrl/Cmd+Enter), so
 *  the book is not engraved again on every key. */
export function ScoreEditor({ resource, onChange }: ScoreEditorProps) {
  const labels = useSandboxLabels();
  const scoreStyles = useSandboxSelector((s) => s.config.scoreStyles) ?? [];
  const score = resource.score ?? { format: 'abc' as const, source: '' };
  const [draft, setDraft] = useState(score.source);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(score.source), [score.source]);

  const write = (partial: Partial<NonNullable<Resource['score']>>) => onChange({ score: { ...score, ...partial } });
  const commit = () => {
    if (draft !== score.source) write({ source: draft });
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const format = scoreFormatOfFile(file.name) ?? score.format;
    const source = await file.text();
    setDraft(source);
    write({ format, source });
  };
  const styleId = score.styleId;

  return (
    <>
      <FieldRow stacked label={labels.resourceScoreFormatLabel} tooltip={labels.resourceScoreFormatTooltip} className="mb-0">
        <select
          value={score.format}
          onChange={(e) => write({ format: e.target.value as ScoreFormat })}
          aria-label={labels.resourceScoreFormatLabel}
          className={inputClass}
          style={inputStyle}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>{labels[`resourceScoreFormat_${f}` as const]}</option>
          ))}
        </select>
      </FieldRow>
      <FieldRow stacked label={labels.resourceScoreStyleLabel} hint={labels.resourceScoreStyleHint} className="mb-0">
        <select
          value={styleId ?? ''}
          onChange={(e) => {
            const next = { ...score };
            if (e.target.value) next.styleId = e.target.value;
            else delete next.styleId;
            onChange({ score: next });
          }}
          aria-label={labels.resourceScoreStyleLabel}
          className={inputClass}
          style={inputStyle}
        >
          <option value="">{labels.resourceScoreStyleDefault}</option>
          {scoreStyles.map((s) => (
            <option key={s.id} value={s.id}>{s.name || s.id}</option>
          ))}
          {styleId && !scoreStyles.some((s) => s.id === styleId) && (
            <option value={styleId}>{labels.resourceTableStyleMissing.replace('__id__', styleId)}</option>
          )}
        </select>
      </FieldRow>
      <FieldRow stacked label={labels.resourceScoreSourceLabel} hint={labels.resourceScoreSourceHint} className="mb-0">
        <textarea
          dir="ltr"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          aria-label={labels.resourceScoreSourceLabel}
          rows={10}
          className={`${inputClass} w-full resize-y font-mono`}
          style={{ ...inputStyle, fontSize: 12, lineHeight: '18px', tabSize: 8, whiteSpace: 'pre', overflowX: 'auto' }}
        />
      </FieldRow>
      <div>
        <input
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void readFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button variant="outline" size="xs" icon={<Upload size={12} />} onClick={() => fileRef.current?.click()}>
          {labels.resourceScoreImport}
        </Button>
      </div>
    </>
  );
}
