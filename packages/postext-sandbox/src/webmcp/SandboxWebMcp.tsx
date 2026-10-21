'use client';

// The Sandbox's WebMCP tools, registered for as long as the Sandbox is on
// the page (see ./modelContext.ts for the protocol, ./tools for the tools).
// Renderless; mounted inside the providers it reads.

import { useEffect, useRef } from 'react';
import { useSandboxStore } from '../context/SandboxContext.js';
import { useLargeTargets } from '../ui/largeTargets.js';
import { useLayoutService } from '../worker/LayoutServiceContext.js';
import type { SandboxToolHost } from './host.js';
import { registerWebMcpTools } from './modelContext.js';
import { createSandboxTools } from './tools/index.js';

export function SandboxWebMcp() {
  const store = useSandboxStore();
  const layout = useLayoutService();
  const largeTargets = useLargeTargets();
  const largeTargetsRef = useRef(largeTargets);
  largeTargetsRef.current = largeTargets;
  // The layout service is replaced when React's strict mode disposes the
  // first one: the tools reach whichever is current.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const host: SandboxToolHost = {
      store,
      layout: {
        build: (request) => layoutRef.current.build(request),
        cancel: (clientId) => layoutRef.current.cancel(clientId),
        dispose: () => undefined,
        get disposed() { return layoutRef.current.disposed; },
      },
      largeTargets: {
        get: () => largeTargetsRef.current.large,
        set: (on) => largeTargetsRef.current.setLarge(on),
      },
    };
    const controller = new AbortController();
    registerWebMcpTools(createSandboxTools(host), controller.signal);
    return () => controller.abort();
  }, [store]);

  return null;
}
