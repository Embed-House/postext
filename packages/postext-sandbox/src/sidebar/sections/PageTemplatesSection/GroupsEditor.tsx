'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Dimension, FrameGroupConfig } from 'postext';
import { useSandboxLabels } from '../../../context/SandboxContext';
import { DimensionInput, FieldRow, SelectInput, TextControl } from '../../../controls';
import { Button, ConfirmPopover, IconButton } from '../../../ui';
import { addGroup, namesInUse, removeGroup, renameFrame, slugify, templateAt, uniqueName, updateGroup, type TemplateScope } from '../../../templates/templateEdits';
import { resolveAt, usePageTemplates } from './model';

const MM0: Dimension = { value: 0, unit: 'mm' };

interface GroupsEditorProps {
  templateId: string;
  scope: TemplateScope;
}

/** The template's groups: frames stacked or set in a row that share the
 *  space between them (`kind`, members in page order, `gap`, `align`). */
export function GroupsEditor({ templateId, scope }: GroupsEditorProps) {
  const labels = useSandboxLabels();
  const { templates, write } = usePageTemplates();
  const template = resolveAt({ pageTemplates: templates }, templateId, scope);
  if (!template) return null;
  const own = templateAt(templates, templateId)?.template;
  const entries = (scope === 'base' ? own?.groups : own?.variants?.[scope]?.groups) ?? [];

  const add = () => {
    const name = uniqueName(namesInUse(templates, templateId), 'group');
    write(addGroup(templates, templateId, scope, { name, kind: 'stack', frames: [] }));
  };

  return (
    <div>
      {template.groups.length === 0 && (
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesGroupsEmpty}</p>
      )}
      {template.groups.map((g) => {
        const entry = entries.find((e) => e.name === g.name);
        const inOther = new Set(template.groups.filter((o) => o.name !== g.name).flatMap((o) => o.frames));
        return (
          <GroupCard
            key={g.name}
            group={g}
            entry={entry}
            frames={template.frames.map((f) => f.name)}
            taken={inOther}
            onChange={(patch) => write(updateGroup(templates, templateId, scope, g.name, patch))}
            onRename={(next) => {
              if (!namesInUse(templates, templateId).has(next)) write(renameFrame(templates, templateId, g.name, next));
            }}
            onRemove={() => write(removeGroup(templates, templateId, scope, g.name))}
          />
        );
      })}
      <Button variant="outline" size="xs" icon={<Plus size={12} aria-hidden="true" />} onClick={add}>
        {labels.pageTemplatesGroupAdd}
      </Button>
    </div>
  );
}

interface GroupCardProps {
  group: { name: string; kind: 'stack' | 'row'; frames: string[]; gap: Dimension; align: string };
  entry: FrameGroupConfig | undefined;
  frames: string[];
  /** Frames that belong to another group (a frame is in one at most). */
  taken: Set<string>;
  onChange: (patch: Partial<Record<keyof FrameGroupConfig, unknown>>) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

function GroupCard({ group, entry, frames, taken, onChange, onRename, onRemove }: GroupCardProps) {
  const labels = useSandboxLabels();
  const [draft, setDraft] = useState(group.name);
  useEffect(() => setDraft(group.name), [group.name]);
  const has = (k: keyof FrameGroupConfig) => entry?.[k] !== undefined;
  const members = group.frames;
  const toggle = (name: string, on: boolean) => {
    // Members keep the order the frames have in the template.
    const next = on ? frames.filter((f) => f === name || members.includes(f)) : members.filter((m) => m !== name);
    onChange({ frames: next });
  };
  return (
    <div className="mb-2 rounded border p-2" style={{ borderColor: 'var(--rule)' }}>
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium">{group.name}</span>
        <ConfirmPopover message={labels.pageTemplatesGroupDeleteConfirm.replace('__name__', group.name)} onConfirm={onRemove}>
          {({ open }) => <IconButton label={labels.pageTemplatesGroupDelete} icon={<Trash2 size={12} aria-hidden="true" />} onClick={open} />}
        </ConfirmPopover>
      </div>
      <FieldRow label={labels.pageTemplatesGroupName}>
        <TextControl
          value={draft}
          onChange={setDraft}
          onBlur={() => {
            const next = slugify(draft);
            if (next && next !== group.name) onRename(next);
            else setDraft(group.name);
          }}
          ariaLabel={labels.pageTemplatesGroupName}
          widthCh={14}
        />
      </FieldRow>
      <SelectInput
        label={labels.pageTemplatesGroupKind}
        value={group.kind}
        variant="segmented"
        options={[
          { value: 'stack', label: labels.pageTemplatesGroupKindStack },
          { value: 'row', label: labels.pageTemplatesGroupKindRow },
        ]}
        onChange={(v) => onChange({ kind: v })}
        tooltip={labels.pageTemplatesGroupKindTooltip}
        isDefault={!has('kind')}
        onReset={() => onChange({ kind: undefined })}
      />
      <DimensionInput label={labels.pageTemplatesGroupGap} value={group.gap ?? MM0} onChange={(d) => onChange({ gap: d })} isDefault={!has('gap')} onReset={() => onChange({ gap: undefined })} />
      <SelectInput
        label={labels.pageTemplatesGroupAlign}
        value={group.align}
        options={[
          { value: 'start', label: labels.pageTemplatesGroupAlignStart },
          { value: 'center', label: labels.pageTemplatesGroupAlignCenter },
          { value: 'end', label: labels.pageTemplatesGroupAlignEnd },
          { value: 'space-between', label: labels.pageTemplatesGroupAlignBetween },
        ]}
        onChange={(v) => onChange({ align: v })}
        tooltip={labels.pageTemplatesGroupAlignTooltip}
        isDefault={!has('align')}
        onReset={() => onChange({ align: undefined })}
      />
      <fieldset className="m-0 mt-1 border-0 p-0">
        <legend className="mb-1 p-0 text-xs" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesGroupMembers}</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {frames.map((f) => (
            <label key={f} className="flex min-h-6 items-center gap-1 text-xs" style={{ opacity: taken.has(f) ? 0.5 : 1 }}>
              <input type="checkbox" checked={members.includes(f)} disabled={taken.has(f)} onChange={(e) => toggle(f, e.target.checked)} />
              {f}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
