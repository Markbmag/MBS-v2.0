import { useState } from 'react';
import {
  Alert, AlertIcon, Box, Button, Divider, FormControl, FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalHeader, ModalOverlay, Text, VStack, useToast,
} from '@chakra-ui/react';
import { apiErrorMessage, http, setToken } from '../api';
import { subscriptions } from '../automation/api';
import { t } from '../i18n/index.ts';

/** Your account: the email address for subscriptions, and your password. */
export function AccountDialog({ username, email, onClose, onEmail }: { username: string; email: string | null; onClose: () => void; onEmail: (e: string | null) => void }) {
  const toast = useToast();
  const [address, setAddress] = useState(email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState<'email' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveEmail = async () => {
    setBusy('email');
    setError(null);
    try {
      onEmail(await subscriptions.setMyEmail(address.trim()));
      toast({ status: 'success', title: t('Email saved'), duration: 1500 });
    } catch (e) {
      setError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(null);
    }
  };
  const savePassword = async () => {
    setBusy('password');
    setError(null);
    try {
      const out = (await http.put<{ token: string }>('/api/account/password', { current, new: next })).data;
      setToken(out.token); // the old sessions ended; this browser keeps working with a new one
      setCurrent('');
      setNext('');
      setRepeat('');
      toast({ status: 'success', title: t('Password changed'), description: t('Other browsers where you were signed in are signed out.'), duration: 4000 });
    } catch (e) {
      setError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(null);
    }
  };
  const mismatch = repeat !== '' && repeat !== next;
  return (
    <Modal isOpen onClose={onClose} size="md" isCentered>
      <ModalOverlay />
      <ModalContent data-testid="account-dialog">
        <ModalHeader fontSize="md">{t('Your account · {name}', { name: username })}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={5}>
          <VStack align="stretch" spacing={4}>
            <Box>
              <Text fontSize="sm" color="mutedText" mb={2}>
                {t('Subscriptions and alerts that include you are sent to this address. Nobody else sees it.')}
              </Text>
              <HStack>
                <Input size="sm" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@company.com" data-testid="account-email" />
                <Button size="sm" onClick={() => void saveEmail()} isLoading={busy === 'email'} isDisabled={address.trim() === (email ?? '')} data-testid="account-email-save">
                  {t('Save')}
                </Button>
              </HStack>
            </Box>
            <Divider />
            <VStack align="stretch" spacing={2}>
              <Text fontSize="sm" fontWeight={600}>
                {t('Change your password')}
              </Text>
              <FormControl>
                <FormLabel fontSize="xs">{t('Current password')}</FormLabel>
                <Input size="sm" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" data-testid="pw-current" />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs">{t('New password (at least 8 characters)')}</FormLabel>
                <Input size="sm" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" data-testid="pw-new" />
              </FormControl>
              <FormControl isInvalid={mismatch}>
                <FormLabel fontSize="xs">{t('New password again')}</FormLabel>
                <Input size="sm" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" data-testid="pw-repeat" />
              </FormControl>
              <Button size="sm" variant="brand" alignSelf="flex-start" onClick={() => void savePassword()} isLoading={busy === 'password'}
                isDisabled={!current || next.length < 8 || next !== repeat} data-testid="pw-save">
                {t('Change password')}
              </Button>
            </VStack>
            {error && (
              <Alert status="error" borderRadius="md" fontSize="sm">
                <AlertIcon />
                {error}
              </Alert>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
