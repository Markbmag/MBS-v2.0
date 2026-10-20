import { useContext } from 'react';
import { WorkspaceContext } from './context';
import type { WorkspaceValue } from './context';

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return value;
}
