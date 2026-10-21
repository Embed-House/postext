import { useEffect } from 'react';
import { useSandboxDispatch, useSandboxStateGetter } from '../context/SandboxContext.js';
import { setTemplateEditorHost } from './editorStore.js';

/** Lends the page-template editor of the canvas (#863) the book's state
 *  and dispatch while the canvas is mounted. */
export function useTemplateEditorHost(): void {
  const getState = useSandboxStateGetter();
  const dispatch = useSandboxDispatch();
  useEffect(() => {
    setTemplateEditorHost({ getState, dispatch });
    return () => setTemplateEditorHost(null);
  }, [getState, dispatch]);
}
