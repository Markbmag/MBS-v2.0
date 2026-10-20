import { Skeleton, VStack } from '@chakra-ui/react';
import { ConnectionHeader } from '../components/ConnectionHeader';
import { NoConnectionsState } from '../components/EmptyStates';
import { TableExplorer } from '../components/TableExplorer';
import { useWorkspace } from '../workspace/useWorkspace';

export default function BrowsePage() {
  const ws = useWorkspace();
  let content;
  if (!ws.loaded) content = <Skeleton h="400px" borderRadius="2xl" />;
  else if (!ws.active) content = <NoConnectionsState isAdmin={ws.isAdmin} onAdd={ws.openAddConnection} />;
  else
    content = (
      <TableExplorer
        key={`${ws.activeKey}:${ws.explorerTarget.nonce}`}
        connectionKey={ws.activeKey}
        connectionLabel={ws.active.label}
        tables={ws.tables}
        tablesError={ws.tablesError}
        onReloadTables={ws.reloadTables}
        target={ws.explorerTarget}
        limits={ws.limits}
      />
    );
  return (
    <VStack align="stretch" spacing={6}>
      <ConnectionHeader />
      {content}
    </VStack>
  );
}
