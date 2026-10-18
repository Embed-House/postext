'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { AnchorEdge, Dimension, ElementPlacement, FrameGroupConfig } from 'postext';
import { useSandboxLabels } from '../../../context/SandboxContext';
import { DimensionInput, FieldRow, SelectInput, TextControl } from '../../../controls';
import { Button, ConfirmPopover, IconButton } from '../../../ui';
import { addGroup, moveMember, namesInUse, removeGroup, renameFrame, slugify, templateAt, uniqueName, updateGroup, type TemplateScope } from '../../../templates/templateEdits';
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
            targets={[...template.frames.map((f) => ({ name: f.name, group: false })), ...template.groups.filter((o) => o.name !== g.name).map((o) => ({ name: o.name, group: true }))]}
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
  group: { name: string; kind: 'stack' | 'row'; frames: string[]; gap: Dimension; align: string; placement?: ElementPlacement };
  entry: FrameGroupConfig | undefined;
  frames: string[];
  /** What the group's own box may hang from: the frames and the other
   *  groups. */
  targets: { name: string; group: boolean }[];
  /** Frames that belong to another group (a frame is in one at most). */
  taken: Set<string>;
  onChange: (patch: Partial<Record<keyof FrameGroupConfig, unknown>>) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}

function GroupCard({ group, entry, frames, targets, taken, onChange, onRename, onRemove }: GroupCardProps) {
  const labels = useSandboxLabels();
  const [draft, setDraft] = useState(group.name);
  useEffect(() => setDraft(group.name), [group.name]);
  const has = (k: keyof FrameGroupConfig) => entry?.[k] !== undefined;
  const members = group.frames;
  // A frame ticked joins at the end; the order is the one listed, and the
  // arrows change it (#991).
  const toggle = (name: string, on: boolean) => {
    onChange({ frames: on ? [...members, name] : members.filter((m) => m !== name) });
  };
  const listed = [...members.filter((m) => frames.includes(m)), ...frames.filter((f) => !members.includes(f))];
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
      <GroupBoxFields placement={group.placement} targets={targets} isSet={has('placement')} onChange={(p) => onChange({ placement: p })} />
      <fieldset className="m-0 mt-1 border-0 p-0">
        <legend className="mb-1 p-0 text-xs" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesGroupMembers}</legend>
        <p className="mb-1 text-[0.7rem]" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesGroupMembersHint}</p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {listed.map((f) => {
            const at = members.indexOf(f);
            return (
              <li key={f} className="flex min-h-6 items-center gap-1 text-xs" style={{ opacity: taken.has(f) ? 0.5 : 1 }}>
                <label className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input type="checkbox" checked={at >= 0} disabled={taken.has(f)} onChange={(e) => toggle(f, e.target.checked)} />
                  <span className="w-4 shrink-0 text-end tabular-nums" aria-hidden="true" style={{ color: 'var(--slate)' }}>{at >= 0 ? at + 1 : ''}</span>
                  <span className="truncate" dir="ltr">{f}</span>
                </label>
                {at >= 0 && (
                  <>
                    <IconButton size={24} label={labels.pageTemplatesGroupMemberUp.replace('__name__', f)} icon={<ArrowUp size={12} aria-hidden="true" />} disabled={at === 0} onClick={() => onChange({ frames: moveMember(members, f, -1) })} />
                    <IconButton size={24} label={labels.pageTemplatesGroupMemberDown.replace('__name__', f)} icon={<ArrowDown size={12} aria-hidden="true" />} disabled={at === members.length - 1} onClick={() => onChange({ frames: moveMember(members, f, 1) })} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}

const NINE_POINT: AnchorEdge[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const ELEMENT_EDGES: AnchorEdge[] = ['below', 'above', 'right-of', 'left-of', 'align-top', 'align-bottom', 'align-left', 'align-right'];

/** A group's own box (#856): without one the group is the union of its
 *  frames' boxes; with one, its spare room is shared out (`grow`, `align`)
 *  and its frames yield inside it (`shrink`). */
function GroupBoxFields({ placement, targets, isSet, onChange }: {
  placement: ElementPlacement | undefined;
  targets: { name: string; group: boolean }[];
  isSet: boolean;
  onChange: (p: ElementPlacement | undefined) => void;
}) {
  const labels = useSandboxLabels();
  const to = placement?.anchor.to ?? 'none';
  const element = to.startsWith('#');
  const edges = element ? [...ELEMENT_EDGES, ...NINE_POINT] : NINE_POINT;
  const edgeLabel: Record<string, string> = {
    'top-left': labels.headerFooterFrameEdgeTopLeft, top: labels.headerFooterFrameEdgeTop, 'top-right': labels.headerFooterFrameEdgeTopRight,
    left: labels.headerFooterFrameEdgeLeft, center: labels.headerFooterFrameEdgeCenter, right: labels.headerFooterFrameEdgeRight,
    'bottom-left': labels.headerFooterFrameEdgeBottomLeft, bottom: labels.headerFooterFrameEdgeBottom, 'bottom-right': labels.headerFooterFrameEdgeBottomRight,
    'right-of': labels.headerFooterElementEdgeRightOf, 'left-of': labels.headerFooterElementEdgeLeftOf, below: labels.headerFooterElementEdgeBelow,
    above: labels.headerFooterElementEdgeAbove, 'align-top': labels.headerFooterElementEdgeAlignTop, 'align-bottom': labels.headerFooterElementEdgeAlignBottom,
    'align-left': labels.headerFooterElementEdgeAlignLeft, 'align-right': labels.headerFooterElementEdgeAlignRight,
  };
  const options = [
    { value: 'none', label: labels.pageTemplatesGroupBoxUnion },
    { value: 'container', label: labels.pageTemplatesAnchorArea },
    { value: 'page', label: labels.headerFooterAnchorToPage },
    { value: 'bleed', label: labels.headerFooterAnchorToBleed },
    ...targets.map((t) => ({ value: `#${t.name}`, label: (t.group ? labels.pageTemplatesAnchorGroup : labels.pageTemplatesAnchorFrame).replace('__name__', t.name) })),
  ];
  if (!options.some((o) => o.value === to)) options.push({ value: to, label: to });
  const size = placement?.size;
  const sizeField = (k: 'width' | 'height', label: string) => {
    const v = size?.[k];
    const fixed = typeof v === 'object' && v !== null;
    return (
      <>
        <SelectInput
          label={label}
          value={fixed ? 'fixed' : 'fill'}
          options={[{ value: 'fixed', label: labels.pageTemplatesSizeFixed }, { value: 'fill', label: labels.pageTemplatesSizeFill }]}
          onChange={(m) => onChange({ ...placement!, size: { ...(size ?? {}), [k]: m === 'fixed' ? { value: k === 'width' ? 100 : 80, unit: 'mm' } : 'fill' } })}
          isDefault={!fixed}
        />
        {fixed && <DimensionInput label={labels.pageTemplatesSizeValue} value={v as Dimension} onChange={(d) => onChange({ ...placement!, size: { ...(size ?? {}), [k]: d } })} />}
      </>
    );
  };
  return (
    <>
      <SelectInput
        label={labels.pageTemplatesGroupBox}
        value={to}
        options={options}
        onChange={(v) => {
          if (v === 'none') return onChange(undefined);
          const el = v.startsWith('#');
          const keep = placement && placement.anchor.to.startsWith('#') === el;
          onChange({ ...(placement ?? {}), anchor: { to: v as ElementPlacement['anchor']['to'], edge: keep ? placement!.anchor.edge : el ? 'below' : 'top-left' }, offset: placement?.offset ?? { x: MM0, y: MM0 } });
        }}
        tooltip={labels.pageTemplatesGroupBoxTooltip}
        isDefault={!isSet}
        onReset={() => onChange(undefined)}
      />
      {placement && (
        <>
          <SelectInput
            label={element ? labels.headerFooterElementEdge : labels.headerFooterFrameEdge}
            value={placement.anchor.edge}
            options={edges.map((e) => ({ value: e, label: edgeLabel[e] ?? e }))}
            onChange={(v) => onChange({ ...placement, anchor: { ...placement.anchor, edge: v as AnchorEdge } })}
          />
          <DimensionInput label={labels.headerFooterElementOffsetX} value={placement.offset?.x ?? MM0} min={-2000} onChange={(d) => onChange({ ...placement, offset: { x: d, y: placement.offset?.y ?? MM0 } })} />
          <DimensionInput label={labels.headerFooterElementOffsetY} value={placement.offset?.y ?? MM0} min={-2000} onChange={(d) => onChange({ ...placement, offset: { x: placement.offset?.x ?? MM0, y: d } })} />
          {sizeField('width', labels.pageTemplatesWidth)}
          {sizeField('height', labels.pageTemplatesHeight)}
        </>
      )}
    </>
  );
}
