'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Copy, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { resolveDesignSlot, resolveHeaderFooterConfig, resolvePageTemplate, type DesignSlot, type Dimension, type PageTemplate, type VDTDocument } from 'postext';
import { useSandboxDocRef, useSandboxLabels, useSandboxSelector } from '../../../context/SandboxContext';
import { CollapsibleSection, DimensionInput, FieldGroup, FieldRow, NumberInput, SelectInput, TextControl, ToggleSwitch } from '../../../controls';
import { Button, ConfirmPopover, SegmentedControl } from '../../../ui';
import { SearchScope } from '../../search/SearchScope';
import { applyViewerEdit } from '../../../editor/viewerEdits';
import { templateEditor, useTemplateEditor } from '../../../templates/editorStore';
import {
  addFrame,
  createTemplate,
  descendantsOf,
  duplicateTemplate,
  namesInUse,
  removeTemplate,
  renameTemplate,
  slugify,
  templateAt,
  templateFromLayout,
  uniqueName,
  updateTemplate,
  type TemplateScope,
} from '../../../templates/templateEdits';
import { renameTemplateChanges } from '../../../templates/templateUsage';
import { pageAreas, templateAreaRect } from '../../../templates/frameGeometry';
import { templateSheet } from '../../../templates/templateSheet';
import { SlotEditor } from '../HeaderFooterSection/SlotEditor';
import { FrameProperties } from './FrameProperties';
import { GroupsEditor } from './GroupsEditor';
import { TemplateSheetSvg } from './TemplateSheetSvg';
import { laidHeights, resolveAt, usePageTemplates } from './model';

const MM0: Dimension = { value: 0, unit: 'mm' };

/** The composed page «Save layout as template» reads: the one a frame was
 *  picked on, else the first of the document. */
function layoutSource(doc: VDTDocument | null, pageIndex: number | null) {
  if (!doc) return null;
  const at = pageIndex !== null ? doc.pages[pageIndex] : undefined;
  const page = at?.composed ? at : doc.pages.find((p) => p.composed);
  return page?.composed ? { page, composed: page.composed } : null;
}

/** Design › Page templates (#863): the book's page templates with a
 *  drawing of each and the number of pages using it, the template being
 *  edited (its fields, variants, frames, groups, decoration and running
 *  heads) and the Design-mode switch of the canvas. */
export const PageTemplatesSection = memo(function PageTemplatesSection() {
  const labels = useSandboxLabels();
  const { templates, write, counts, dispatch, chapters } = usePageTemplates();
  const config = useSandboxSelector((s) => s.config);
  const docRef = useSandboxDocRef();
  const docVersion = useSandboxSelector((s) => s.docVersion);
  const editor = useTemplateEditor();
  const selection = editor.selection;
  const selectedId = selection && templates.some((t) => t.id === selection.templateId) ? selection.templateId : templates[0]?.id ?? null;
  const scope: TemplateScope = selection && selection.templateId === selectedId ? selection.scope : 'base';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the document behind the ref changes with `docVersion`.
  const heights = useMemo(() => laidHeights(docRef?.current ?? null), [docRef, docVersion]);
  const source = useMemo(() => layoutSource(docRef?.current ?? null, selection?.pageIndex ?? null), [docRef, docVersion, selection?.pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (templateId: string, patch: Partial<{ scope: TemplateScope; frame: string | null; group: string | null }> = {}) =>
    templateEditor.select({ templateId, scope: patch.scope ?? 'base', frame: patch.frame ?? null, group: patch.group ?? null, pageIndex: null });

  const pagesText = (n: number) => (n === 1 ? labels.pageTemplatesPagesOne : labels.pageTemplatesPagesMany).replace('__count__', String(n));

  const onNew = () => {
    const out = createTemplate(templates, labels.pageTemplatesNewName);
    write(out.templates);
    select(out.id);
  };
  const onDuplicate = () => {
    if (!selectedId) return;
    const t = templateAt(templates, selectedId)!.template;
    const out = duplicateTemplate(templates, selectedId, labels.pageTemplatesCopyName.replace('__name__', t.name || t.id));
    write(out.templates);
    select(out.id);
  };
  const onSaveLayout = () => {
    const doc = docRef?.current ?? null;
    if (!doc || !source) return;
    const resolved = resolvePageTemplate(config, source.composed.template, source.composed.variant ? { parity: source.composed.variant } : {});
    if (!resolved) return;
    const area = templateAreaRect(resolved.area, pageAreas(source.page, doc.trimOffset));
    const rects = new Map(source.composed.frames.map((f) => [f.name, f.rect]));
    const name = labels.pageTemplatesLayoutName.replace('__name__', resolved.name || resolved.id);
    const out = templateFromLayout(templates, resolved, rects, area, doc.config.page.dpi, name);
    write(out.templates);
    select(out.id);
  };

  return (
    <CollapsibleSection
      title={labels.pageTemplatesSection}
      sectionId="pageTemplates"
      hasOverrides={templates.length > 0}
      onReset={() => dispatch({ type: 'UPDATE_CONFIG', payload: { pageTemplates: undefined } })}
      resetLabel={labels.reset}
      resetConfirmMessage={labels.pageTemplatesResetConfirm}
    >
      <ToggleSwitch
        label={labels.pageTemplatesDesignMode}
        tooltip={labels.pageTemplatesDesignModeTooltip}
        checked={editor.designMode}
        onChange={(v) => templateEditor.setDesignMode(v)}
        isDefault={!editor.designMode}
      />
      {templates.length === 0 && (
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesEmpty}</p>
      )}
      {templates.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0" aria-label={labels.pageTemplatesListLabel}>
          {templates.map((t) => {
            const resolved = resolvePageTemplate({ pageTemplates: templates }, t.id);
            const sheet = resolved ? templateSheet(config, resolved, 'recto', heights.get(t.id)) : null;
            const n = counts.get(t.id) ?? 0;
            const active = t.id === selectedId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => select(t.id)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded border px-1.5 py-1 text-start"
                  style={{ borderColor: active ? 'var(--brand)' : 'var(--rule)', background: active ? 'var(--surface)' : 'transparent' }}
                >
                  {sheet && <TemplateSheetSvg sheet={sheet} width={resolved!.spread ? 72 : 40} />}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium" style={{ color: 'var(--foreground)' }}>{t.name || t.id}</span>
                    <span className="truncate text-[0.7rem]" style={{ color: 'var(--slate)' }}>
                      <span dir="ltr">{t.id}</span>
                      {' · '}
                      {pagesText(n)}
                      {t.extends ? ` · ${labels.pageTemplatesBasedOnShort.replace('__name__', templateAt(templates, t.extends)?.template.name || t.extends)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" icon={<Plus size={12} aria-hidden="true" />} onClick={onNew}>{labels.pageTemplatesNew}</Button>
        <Button variant="outline" size="xs" icon={<Copy size={12} aria-hidden="true" />} onClick={onDuplicate} disabled={!selectedId}>{labels.pageTemplatesDuplicate}</Button>
        <Button variant="outline" size="xs" icon={<LayoutTemplate size={12} aria-hidden="true" />} onClick={onSaveLayout} disabled={!source} aria-describedby={source ? undefined : 'pt-save-layout-none'}>
          {labels.pageTemplatesSaveLayout}
        </Button>
      </div>
      {!source && templates.length > 0 && (
        <p id="pt-save-layout-none" className="mb-2 text-[0.7rem]" style={{ color: 'var(--slate)' }}>{labels.pageTemplatesSaveLayoutNone}</p>
      )}
      {selectedId && (
        <TemplateEditor
          key={selectedId}
          id={selectedId}
          scope={scope}
          pages={counts.get(selectedId) ?? 0}
          heights={heights.get(selectedId)}
          onScope={(s) => select(selectedId, { scope: s, frame: selection?.frame ?? null })}
          frame={selection?.templateId === selectedId ? selection.frame : null}
          onFrame={(f) => templateEditor.select({ templateId: selectedId, scope, frame: f, group: null, pageIndex: selection?.pageIndex ?? null })}
          onRenamed={(next) => {
            for (const ch of chapters) {
              const changes = renameTemplateChanges(ch.markdown, selectedId, next);
              if (changes.length > 0) applyViewerEdit(dispatch, ch.id, changes, ch.markdown.length);
            }
            select(next, { scope });
          }}
          onRemoved={() => templateEditor.select(null)}
        />
      )}
    </CollapsibleSection>
  );
});

interface TemplateEditorProps {
  id: string;
  scope: TemplateScope;
  pages: number;
  heights?: ReadonlyMap<string, number>;
  frame: string | null;
  onScope: (scope: TemplateScope) => void;
  onFrame: (frame: string | null) => void;
  onRenamed: (id: string) => void;
  onRemoved: () => void;
}

function TemplateEditor({ id, scope, pages, heights, frame, onScope, onFrame, onRenamed, onRemoved }: TemplateEditorProps) {
  const labels = useSandboxLabels();
  const { templates, write } = usePageTemplates();
  const config = useSandboxSelector((s) => s.config);
  const own = templateAt(templates, id)?.template;
  const [idDraft, setIdDraft] = useState(id);
  useEffect(() => setIdDraft(id), [id]);
  const resolved = resolveAt({ pageTemplates: templates }, id, own?.spread ? 'base' : scope);
  if (!own || !resolved) return null;
  const spread = resolved.spread;
  const effScope: TemplateScope = spread ? 'base' : scope;
  const scoped = (effScope === 'base' ? own : own.variants?.[effScope]) ?? {};
  const sheet = templateSheet(config, resolved, effScope === 'verso' ? 'verso' : 'recto', heights);
  const set = (patch: Partial<PageTemplate>) => write(updateTemplate(templates, id, effScope, patch));
  const has = (k: keyof PageTemplate) => (k === 'name' || k === 'extends' || k === 'spread' || k === 'gutter' || k === 'role' ? own[k] : (scoped as Record<string, unknown>)[k]) !== undefined;
  const parents = templates.filter((t) => t.id !== id && !descendantsOf(templates, id).includes(t.id));

  const commitId = () => {
    const next = slugify(idDraft);
    if (!next || next === id || templates.some((t) => t.id === next)) {
      setIdDraft(id);
      return;
    }
    write(renameTemplate(templates, id, next));
    onRenamed(next);
  };

  const headSelect = (k: 'header' | 'footer') => {
    const value = (scoped as Record<string, unknown>)[k] as DesignSlot | false | undefined;
    const mode = value === false ? 'hidden' : value === undefined ? 'book' : 'own';
    return (
      <>
        <SelectInput
          label={k === 'header' ? labels.pageTemplatesHeader : labels.pageTemplatesFooter}
          value={mode}
          options={[
            { value: 'book', label: labels.pageTemplatesHeadBook },
            { value: 'hidden', label: labels.pageTemplatesHeadHidden },
            { value: 'own', label: labels.pageTemplatesHeadOwn },
          ]}
          onChange={(v) => set({ [k]: v === 'book' ? undefined : v === 'hidden' ? false : { elements: [] } })}
          tooltip={labels.pageTemplatesHeadTooltip}
          isDefault={!has(k)}
          onReset={() => set({ [k]: undefined })}
        />
        {mode === 'own' && value && (
          <SlotEditor slotKey={k} raw={value} resolved={resolveHeaderFooterConfig(value, k)} onUpdate={(slot) => set({ [k]: slot ?? { elements: [] } })} />
        )}
      </>
    );
  };

  const grid = scoped.grid;
  const decoration: DesignSlot = scoped.decoration ?? { elements: [] };
  const addNewFrame = () => {
    const name = uniqueName(namesInUse(templates, id), 'frame');
    write(addFrame(templates, id, effScope, { name, width: { value: 60, unit: 'mm' }, height: { value: 40, unit: 'mm' }, placement: { anchor: { to: 'container', edge: 'top-left' }, offset: { x: MM0, y: MM0 } } }));
    onFrame(name);
  };

  return (
    <SearchScope title={`${own.name ?? ''} ${own.id}`} overridden>
      <div className="rounded border p-2" style={{ borderColor: 'var(--rule)' }}>
        {!spread && (
          <FieldRow stacked label={labels.pageTemplatesScope} tooltip={labels.pageTemplatesScopeTooltip}>
            <SegmentedControl<TemplateScope>
              value={effScope}
              onValueChange={onScope}
              ariaLabel={labels.pageTemplatesScope}
              size="sm"
              fill
              options={[
                { value: 'base', label: labels.pageTemplatesScopeBase },
                { value: 'recto', label: labels.pageTemplatesScopeRecto },
                { value: 'verso', label: labels.pageTemplatesScopeVerso },
              ]}
            />
          </FieldRow>
        )}
        <div className="mx-auto my-2" style={{ maxWidth: spread ? '100%' : '13rem' }}>
          <TemplateSheetSvg
            sheet={sheet}
            width={spread ? 280 : 200}
            fluid
            selectedFrame={frame}
            onSelectFrame={(n) => onFrame(n)}
            frameLabel={labels.pageTemplatesSheetFrame}
            gutterLabel={labels.pageTemplatesGutter}
          />
        </div>
        <p className="mb-2 text-[0.7rem]" style={{ color: 'var(--slate)' }}>
          {spread ? labels.pageTemplatesSheetSpreadHint : labels.pageTemplatesSheetHint}
        </p>

        <FieldGroup title={labels.pageTemplatesGroupTemplate}>
          <FieldRow stacked label={labels.idLabel} tooltip={labels.pageTemplatesIdTooltip} hint={pages > 0 ? labels.pageTemplatesIdHint : undefined}>
            <TextControl value={idDraft} onChange={setIdDraft} onBlur={commitId} ariaLabel={labels.idLabel} widthCh={18} />
          </FieldRow>
          <FieldRow stacked label={labels.pageTemplatesName} tooltip={labels.pageTemplatesNameTooltip}>
            <TextControl value={own.name ?? ''} onChange={(v) => set({ name: v || undefined })} ariaLabel={labels.pageTemplatesName} placeholder={own.id} widthCh={18} />
          </FieldRow>
          <SelectInput
            label={labels.pageTemplatesBasedOn}
            value={own.extends ?? ''}
            options={[{ value: '', label: labels.pageTemplatesBasedOnNone }, ...parents.map((t) => ({ value: t.id, label: t.name || t.id }))]}
            onChange={(v) => set({ extends: v || undefined })}
            tooltip={labels.pageTemplatesBasedOnTooltip}
            isDefault={!has('extends')}
            onReset={() => set({ extends: undefined })}
          />
          <ToggleSwitch label={labels.pageTemplatesSpread} tooltip={labels.pageTemplatesSpreadTooltip} checked={spread} onChange={(v) => set({ spread: v || undefined })} isDefault={!has('spread')} onReset={() => set({ spread: undefined })} />
          {spread && (
            <DimensionInput label={labels.pageTemplatesGutter} value={resolved.gutter} onChange={(d) => set({ gutter: d })} tooltip={labels.pageTemplatesGutterTooltip} isDefault={!has('gutter')} onReset={() => set({ gutter: undefined })} />
          )}
          <SelectInput
            label={labels.pageTemplatesArea}
            value={resolved.area}
            options={[
              { value: 'content', label: labels.pageTemplatesAreaContent },
              { value: 'trim', label: labels.pageTemplatesAreaTrim },
              { value: 'bleed', label: labels.pageTemplatesAreaBleed },
            ]}
            onChange={(v) => set({ area: v as PageTemplate['area'] })}
            tooltip={labels.pageTemplatesAreaTooltip}
            isDefault={!has('area')}
            onReset={() => set({ area: undefined })}
          />
          {/* The pages a frame's content goes on to (#859). */}
          <SelectInput
            label={labels.pageTemplatesOverflowTemplate}
            value={resolved.overflowTemplate ?? ''}
            options={[{ value: '', label: labels.pageTemplatesOverflowTemplateSame }, ...templates.filter((t) => t.id !== id).map((t) => ({ value: t.id, label: t.name || t.id }))]}
            onChange={(v) => set({ overflowTemplate: v || undefined })}
            tooltip={labels.pageTemplatesOverflowTemplateTooltip}
            isDefault={!has('overflowTemplate')}
            onReset={() => set({ overflowTemplate: undefined })}
          />
          <NumberInput
            label={labels.pageTemplatesGridColumns}
            value={resolved.grid?.columns ?? 0}
            min={0}
            max={24}
            onChange={(n) => set({ grid: n === 0 ? undefined : { ...(grid ?? {}), columns: n, rows: grid?.rows ?? resolved.grid?.rows ?? 1 } })}
            tooltip={labels.pageTemplatesGridTooltip}
            isDefault={!has('grid')}
            onReset={() => set({ grid: undefined })}
          />
          {resolved.grid && (
            <>
              <NumberInput label={labels.pageTemplatesGridRows} value={resolved.grid.rows} min={1} max={48} onChange={(n) => set({ grid: { ...resolved.grid!, ...(grid ?? {}), rows: n } })} isDefault={!has('grid')} />
              <DimensionInput label={labels.pageTemplatesGridColumnGap} value={resolved.grid.columnGap} onChange={(d) => set({ grid: { ...resolved.grid!, ...(grid ?? {}), columnGap: d } })} isDefault={!has('grid')} />
              <DimensionInput label={labels.pageTemplatesGridRowGap} value={resolved.grid.rowGap} onChange={(d) => set({ grid: { ...resolved.grid!, ...(grid ?? {}), rowGap: d } })} isDefault={!has('grid')} />
            </>
          )}
          <ConfirmPopover message={labels.pageTemplatesDeleteConfirm.replace('__count__', String(pages))} onConfirm={() => { write(removeTemplate(templates, id)); onRemoved(); }}>
            {({ open }) => (
              <Button variant="ghost" size="xs" icon={<Trash2 size={12} aria-hidden="true" />} onClick={open}>
                {labels.pageTemplatesDelete}
              </Button>
            )}
          </ConfirmPopover>
        </FieldGroup>

        <FieldGroup title={labels.pageTemplatesGroupFrames} description={labels.pageTemplatesGroupFramesDescription}>
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={labels.pageTemplatesGroupFrames}>
            {resolved.frames.map((f) => (
              <button
                key={f.name}
                type="button"
                aria-pressed={f.name === frame}
                onClick={() => onFrame(f.name === frame ? null : f.name)}
                className="min-h-8 cursor-pointer rounded border px-2 text-xs"
                style={{ borderColor: f.name === frame ? 'var(--brand)' : 'var(--rule)', color: f.name === frame ? 'var(--brand)' : 'var(--foreground)' }}
              >
                <span dir="ltr">{f.name}</span>
              </button>
            ))}
          </div>
          <Button variant="outline" size="xs" icon={<Plus size={12} aria-hidden="true" />} onClick={addNewFrame}>{labels.pageTemplatesFrameAdd}</Button>
          {frame && resolved.frames.some((f) => f.name === frame) && (
            // Keyed by the frame: a field left with a draft in it never commits
            // into the next frame picked.
            <FrameProperties key={`${id}:${effScope}:${frame}`} templateId={id} scope={effScope} name={frame} onRenamed={(n) => onFrame(n)} onRemoved={() => onFrame(null)} />
          )}
        </FieldGroup>

        <FieldGroup title={labels.pageTemplatesGroupGroups} description={labels.pageTemplatesGroupGroupsDescription}>
          <GroupsEditor templateId={id} scope={effScope} />
        </FieldGroup>

        <FieldGroup title={labels.pageTemplatesGroupRunning}>
          {headSelect('header')}
          {headSelect('footer')}
        </FieldGroup>

        <FieldGroup title={labels.pageTemplatesGroupDecoration} description={labels.pageTemplatesGroupDecorationDescription}>
          <SlotEditor
            slotKey="part"
            configPath={`/pageTemplates/${templates.findIndex((t) => t.id === id)}${effScope === 'base' ? '' : `/variants/${effScope}`}/decoration`}
            raw={decoration}
            resolved={resolveDesignSlot(decoration, 'part')}
            onUpdate={(slot) => set({ decoration: slot && slot.elements && slot.elements.length > 0 ? slot : undefined })}
          />
        </FieldGroup>
      </div>
    </SearchScope>
  );
}
