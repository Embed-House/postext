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
