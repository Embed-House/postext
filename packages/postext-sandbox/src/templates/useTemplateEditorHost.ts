import { useEffect } from 'react';
import { useSandboxDispatch, useSandboxStateGetter } from '../context/SandboxContext';
import { setTemplateEditorHost } from './editorStore';

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
