'use client';

import { createContext, useContext } from 'react';
import type { SettingsGroupId } from '../sidebar/sections/registry';

/** Opens a group of the Design panel (clearing any search), for a section
 *  that points at a setting kept in another group. Null outside the panel. */
export const OpenSettingsGroupContext = createContext<((id: SettingsGroupId) => void) | null>(null);

export function useOpenSettingsGroup(): ((id: SettingsGroupId) => void) | null {
  return useContext(OpenSettingsGroupContext);
}

const groupRequests = new Set<(id: SettingsGroupId) => void>();

/** Ask the Design panel, when it is open, for a group. False when no panel
 *  took the request (it is closed: store the group and open the panel). */
export function requestSettingsGroup(id: SettingsGroupId): boolean {
  for (const open of groupRequests) open(id);
  return groupRequests.size > 0;
}

/** The Design panel's side of {@link requestSettingsGroup}. */
export function onSettingsGroupRequest(open: (id: SettingsGroupId) => void): () => void {
  groupRequests.add(open);
  return () => { groupRequests.delete(open); };
}

/** The switches of the Design panel's header: the explanations under each
 *  setting, and the filter that leaves only the settings the book changed. */
export interface SettingsPanelSwitches {
  help?: boolean;
  changedOnly?: boolean;
}

const switchRequests = new Set<(switches: SettingsPanelSwitches) => void>();
let changedOnlyShown = false;

/** Ask the Design panel, when it is open, to set its header's switches.
 *  False when no panel took the request (it is closed: the explanations
 *  switch is then stored for its next opening, and the filter, which the
 *  panel does not keep, is asked for again once it is open). */
export function requestSettingsSwitches(switches: SettingsPanelSwitches): boolean {
  for (const apply of switchRequests) apply(switches);
  return switchRequests.size > 0;
}

/** The Design panel's side of {@link requestSettingsSwitches}. */
export function onSettingsSwitchesRequest(apply: (switches: SettingsPanelSwitches) => void): () => void {
  switchRequests.add(apply);
  return () => { switchRequests.delete(apply); };
}

/** The Design panel says whether it lists only the changed settings (false
 *  when it closes: the filter does not outlive the panel). */
export function reportSettingsChangedOnly(on: boolean): void {
  changedOnlyShown = on;
}

/** Whether the Design panel lists only the changed settings now. */
export function settingsChangedOnly(): boolean {
  return changedOnlyShown;
}

/** A section of the Design panel asked for from the pages (#865): a
 *  design element, a style, a template picked on a page opens where it is
 *  edited. */
export interface SettingsSectionRequest {
  group: SettingsGroupId;
  /** The section to bring into view; null: the group's page alone. */
  section: string | null;
}

let pendingSection: SettingsSectionRequest | null = null;
const sectionRequests = new Set<(req: SettingsSectionRequest) => void>();

/** Ask the Design panel for a group and a section in it. The request waits
 *  for the panel when it is closed (opened by the caller): the panel takes
 *  it when it mounts. False when no panel took it now. */
export function requestSettingsSection(req: SettingsSectionRequest): boolean {
  pendingSection = req;
  for (const open of sectionRequests) open(req);
  return sectionRequests.size > 0;
}

/** The Design panel's side of {@link requestSettingsSection}. */
export function onSettingsSectionRequest(open: (req: SettingsSectionRequest) => void): () => void {
  sectionRequests.add(open);
  return () => { sectionRequests.delete(open); };
}

/** The section request not yet shown for `group` (taken: it is shown
 *  once). */
export function takeSettingsSection(group: SettingsGroupId): string | null {
  if (!pendingSection || pendingSection.group !== group) return null;
  const section = pendingSection.section;
  pendingSection = null;
  return section;
}

/** The group of the section request waiting for the panel, if any. */
export function pendingSettingsGroup(): SettingsGroupId | null {
  return pendingSection?.group ?? null;
}
