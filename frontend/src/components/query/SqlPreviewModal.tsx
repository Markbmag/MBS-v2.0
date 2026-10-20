import { Alert, AlertIcon, Box, Button, HStack, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Skeleton, useToast } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../../api';
import { CodeIcon, CopyIcon } from '../../icons';
import { prettySql } from '../../query/prettySql';
import type { QuerySpec } from '../../query/types';
import { t } from '../../i18n/index.ts';

interface SqlPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  spec: QuerySpec;
  engine: string | undefined;
  onOpenInEditor: (sql: string) => void;
}

/** "View SQL": what the question runs, without running it. */
export function SqlPreviewModal({ isOpen, onClose, spec, engine, onOpenInEditor }: SqlPreviewModalProps) {
  const toast = useToast();
  const compiled = useQuery({
    queryKey: ['compile', spec],
    queryFn: async () => (await http.post<{ sql: string }>('/api/query/compile', { spec })).data.sql,
    enabled: isOpen,
    staleTime: 60_000,
  });
  const sql = compiled.data ? prettySql(compiled.data, engine) : '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t('SQL for this question')}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {compiled.isPending && <Skeleton h="200px" borderRadius="lg" />}
          {compiled.isError && (
            <Alert status="error" borderRadius="lg">
              <AlertIcon />
              {apiErrorMessage(compiled.error, t('Could not build the SQL'))}
            </Alert>
          )}
          {compiled.data && (
            <Box as="pre" fontFamily="mono" fontSize="sm" bg="chipBg" p={4} borderRadius="lg" overflowX="auto" whiteSpace="pre" data-testid="compiled-sql">
              {sql}
            </Box>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              variant="subtle"
              leftIcon={<CopyIcon boxSize={4} />}
              isDisabled={!sql}
              onClick={() => void navigator.clipboard?.writeText(sql).then(() => toast({ title: t('SQL copied'), status: 'success', duration: 1500 }))}
            >
              {t('Copy')}
            </Button>
            <Button leftIcon={<CodeIcon boxSize={4} />} isDisabled={!sql} onClick={() => onOpenInEditor(sql)} data-testid="open-in-sql-editor">
              {t('Open in SQL editor')}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
